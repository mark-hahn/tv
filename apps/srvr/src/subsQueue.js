// subsQueue — subtitle/ASR queue domain extracted from index.js.
//
// Owns three persistent queues and their background loops:
//   subQueue        emb-sub extraction + opensubtitles + ASR triage
//   subQueueChkSrt  human "check srt" review queue
//   asrQueue        whisper ASR transcription queue
// plus the OPN (opensubtitles) sidecar downloader and chksrt snooze/history.
//
// All mutable state lives on the exported `subsState` object so that route
// handlers (which reassign e.g. chksrtHistory and mutate arrays in place) and
// this module share one authoritative reference. The messaging "batch header"
// hub (syncBatchMsgs) is injected via init() to avoid a circular import with
// index.js (index owns the hub because it also reads reencode/bif state).

import fs from "fs";
import * as path from "node:path";
import * as cp from "child_process";
import fetch from "node-fetch";
import { unilog, logHere, parseFileSeasonEpisode } from "@tv/share";
import * as epd from "@tv/share";
import { SRVR_DATA_DIR } from "./srvrPaths.js";
import cron from "node-cron";
import { notifyClients } from "./messaging.js";
import { showNameFromFilePath } from "./disk.js";
import { resFindEpisodeVideos, videoFileExtensions } from "./videoFiles.js";
import { sanitizeSrt, stripSrtFormatting } from "./srt.js";
import {
  getSubsToken,
  loadSubsLogin,
  openSubtitlesDownloadWithRetry,
  subsSearch,
} from "./opensubtitles.js";
import { encodeFileIdBase32 } from "./subFiles.js";
import { BATCH_SCHED, subExtractQueue } from "./batchQueue.js";
import * as tvdb from "./tvdb.js";

// ---- hard-wired constants (no env vars per repo convention) ----
const tvDir = "/mnt/media/tv";
const SUB_QUEUE_PATH = "/root/dev/apps/tv/apps/asr/data/subQueue.json";
const SUB_QUEUE_CHKSRT_PATH =
  "/root/dev/apps/tv/apps/asr/data/subQueueChkSrt.json";
const ASR_QUEUE_PATH = "/root/dev/apps/tv/apps/asr/data/asrQueue.json";
const SUBTITLE_LOG_PATH = "/root/dev/apps/tv/apps/asr/data/subtitle.log";
const SUBTITLE_LOG_DIR = "/root/dev/apps/tv/apps/asr/data/subtitle-logs/";
const ASR_JS_PATH = "/root/dev/apps/tv/apps/asr/asr.js";
const CHKSRT_HISTORY_PATH = path.join(SRVR_DATA_DIR, "chksrt-history.json");
const CHKSRT_SNOOZED_PATH = path.join(SRVR_DATA_DIR, "chksrt-snoozed.json");
const OPN_CHECK_HISTORY_PATH = path.join(
  SRVR_DATA_DIR,
  "opn-check-history.json",
);
const OPN_DAILY_LIMIT = 500;
const ASR_LOG_BUFFER_MAX = 500;
const EMB_LOG_BUFFER_MAX = 500;
const CHKSRT_SNOOZE_MS = 24 * 60 * 60 * 1000;

// ---- shared mutable state (single authoritative reference) ----
export const subsState = {
  subQueue: [],
  subQueueChkSrt: [],
  asrQueue: [],
  chksrtHistory: [],
  chksrtSnoozed: {},
  opnCheckHistory: {},
  opnDailyCount: 0,
  opnDailyCountDate: "",
  subQueueBusy: false,
  chkSubQueueDelay: 10_000,
  asrQueueDelay: 10_000,
  currentlyProcessingSubPath: null,
  genSrtRunning: false,
  genSrtChild: null,
  subQueuePendingNow: false,
  asrLogBuffer: [],
  embLogBuffer: [],
  // monotonic completion counters — the watchdog uses these to tell a stuck
  // queue (depth>0 but counter flat) apart from a merely idle one.
  subDone: 0,
  asrDone: 0,
};

// ---- injected hub (set by init) ----
let syncBatchMsgs = () => {};
const asrLogListeners = new Set();
const asrQueueListeners = new Set();
const embLogListeners = new Set();
const subsProgressListeners = new Set();
export function init(deps) {
  if (deps?.syncBatchMsgs) syncBatchMsgs = deps.syncBatchMsgs;
}

export function onAsrLog(listener) {
  asrLogListeners.add(listener);
  return () => asrLogListeners.delete(listener);
}

function notifyAsrLogListeners(line) {
  for (const listener of asrLogListeners) listener(line);
}

export function onEmbLog(listener) {
  embLogListeners.add(listener);
  return () => embLogListeners.delete(listener);
}

function publishEmbLog(line) {
  subsState.embLogBuffer.push(line);
  if (subsState.embLogBuffer.length > EMB_LOG_BUFFER_MAX) {
    subsState.embLogBuffer = subsState.embLogBuffer.slice(-EMB_LOG_BUFFER_MAX);
  }
  notifyClients("emb-log", line);
  for (const listener of embLogListeners) listener(line);
}

export function onSubsProgress(listener) {
  subsProgressListeners.add(listener);
  return () => subsProgressListeners.delete(listener);
}

function publishSubsProgress(payload) {
  notifyClients("subs-progress", payload);
  for (const listener of subsProgressListeners) listener(payload);
}

export function getAsrQueueSnapshot() {
  return {
    count: subsState.asrQueue.length,
    running: subsState.genSrtRunning,
    entries: subsState.asrQueue,
  };
}

export function onAsrQueueChange(listener) {
  asrQueueListeners.add(listener);
  return () => asrQueueListeners.delete(listener);
}

export function publishAsrQueueUpdate(extra = {}) {
  const payload = { ...getAsrQueueSnapshot(), ...extra };
  notifyClients("asr-queue-update", payload);
  for (const listener of asrQueueListeners) listener(payload);
  return payload;
}

// ---- status getters for the watchdog heartbeat / header ----
export function getSubStatus() {
  return {
    count: subsState.subQueue.length,
    busy: subsState.subQueueBusy,
    chkCount: subsState.subQueueChkSrt.length,
    currentPath: subsState.currentlyProcessingSubPath,
    headName: subsState.subQueueBusy
      ? showNameFromFilePath(subsState.currentlyProcessingSubPath || "")
      : showNameFromFilePath(subsState.subQueue[0]?.videoFilePath || ""),
    done: subsState.subDone,
  };
}
export function getAsrStatus() {
  return {
    count: subsState.asrQueue.length,
    running: subsState.genSrtRunning,
    headName: showNameFromFilePath(subsState.asrQueue[0]?.videoPath || ""),
    done: subsState.asrDone,
  };
}

// ---- persistence ----
function persistSubQueue() {
  fs.writeFileSync(SUB_QUEUE_PATH, JSON.stringify(subsState.subQueue), "utf8");
}
function persistSubQueueChkSrt() {
  fs.writeFileSync(
    SUB_QUEUE_CHKSRT_PATH,
    JSON.stringify(subsState.subQueueChkSrt),
    "utf8",
  );
}
function cleanChkSrtQueue() {
  const before = subsState.subQueueChkSrt.length;
  subsState.subQueueChkSrt = subsState.subQueueChkSrt.filter(
    (e) => e?.videoFilePath && fs.existsSync(e.videoFilePath),
  );
  if (subsState.subQueueChkSrt.length !== before) {
    unilog(
      508,
      `cleaned ${before - subsState.subQueueChkSrt.length} missing file(s) from queue`,
    );
    persistSubQueueChkSrt();
  }
}
function persistAsrQueue() {
  fs.writeFileSync(ASR_QUEUE_PATH, JSON.stringify(subsState.asrQueue), "utf8");
}
// The asr log buffer holds tagged entries { text, detail }. detail:false is the
// normal Queued/Starting/Done output; detail:true is the per-chunk asr.js
// progress that the pane's Tail toggle shows/hides. Both live in one buffer so
// they stay interleaved in true arrival order.
function appendAsrLog(text, detail = false) {
  const entry = { text, detail };
  subsState.asrLogBuffer.push(entry);
  if (subsState.asrLogBuffer.length > ASR_LOG_BUFFER_MAX) {
    subsState.asrLogBuffer = subsState.asrLogBuffer.slice(-ASR_LOG_BUFFER_MAX);
  }
  if (!detail) {
    try {
      fs.appendFileSync(SUBTITLE_LOG_PATH, text + "\n", "utf8");
    } catch (e) {
      unilog(1556, `subtitle.log append failed: ${e.message}`);
    }
    notifyClients("asr-log", text);
  }
  notifyAsrLogListeners(entry);
}

// Detailed asr.js progress arrives out-of-band via the unilog collector
// (routes/unilog.js), not on the child's stdout. Mirror it into the same buffer
// as a detail entry so it interleaves and rides the same asrLog channel.
function appendAsrTail(text) {
  appendAsrLog(text, true);
}
function addToAsrQueue(entries) {
  let added = 0;
  for (const entry of entries) {
    if (!subsState.asrQueue.some((e) => e.videoPath === entry.videoPath)) {
      subsState.asrQueue.push(entry);
      added++;
    }
  }
  if (added > 0) {
    persistAsrQueue();
    publishAsrQueueUpdate();
    syncBatchMsgs();
    subsState.asrQueueDelay = 500;
  }
}
function enqueueSubQueue(entry, toFront) {
  if (subsState.currentlyProcessingSubPath === entry.videoFilePath) return;
  const idx = subsState.subQueue.findIndex(
    (e) => e.videoFilePath === entry.videoFilePath,
  );
  if (idx !== -1) {
    const existing = subsState.subQueue[idx];
    if (!entry.lowPriority && existing.lowPriority) {
      subsState.subQueue.splice(idx, 1);
      subsState.subQueue.unshift({
        ...existing,
        lowPriority: false,
        fromUI: entry.fromUI ?? existing.fromUI,
      });
    }
    return;
  }
  if (toFront) subsState.subQueue.unshift(entry);
  else subsState.subQueue.push(entry);
  syncBatchMsgs();
}
function enqueueSubQueueChkSrt(entry, toFront) {
  const idx = subsState.subQueueChkSrt.findIndex(
    (e) => e.videoFilePath === entry.videoFilePath,
  );
  if (idx !== -1) {
    const existing = subsState.subQueueChkSrt[idx];
    if (!entry.lowPriority && existing.lowPriority) {
      subsState.subQueueChkSrt.splice(idx, 1);
      subsState.subQueueChkSrt.unshift({
        ...existing,
        lowPriority: false,
        fromUI: entry.fromUI ?? existing.fromUI,
      });
    }
    return;
  }
  if (toFront) subsState.subQueueChkSrt.unshift(entry);
  else subsState.subQueueChkSrt.push(entry);
  const showName = showNameFromFilePath(entry.videoFilePath);
  if (removeFromChksrtSnoozed(showName, entry.videoFilePath)) {
    persistChksrtSnoozed();
  }
}
function loadQueues() {
  try {
    subsState.subQueue = JSON.parse(fs.readFileSync(SUB_QUEUE_PATH, "utf8"));
  } catch {
    subsState.subQueue = [];
  }
  try {
    subsState.subQueueChkSrt = JSON.parse(
      fs.readFileSync(SUB_QUEUE_CHKSRT_PATH, "utf8"),
    );
  } catch {
    subsState.subQueueChkSrt = [];
  }
  try {
    subsState.asrQueue = JSON.parse(fs.readFileSync(ASR_QUEUE_PATH, "utf8"));
  } catch {
    subsState.asrQueue = [];
  }
}

function loadChksrtHistory() {
  try {
    const raw = JSON.parse(fs.readFileSync(CHKSRT_HISTORY_PATH, "utf8"));
    subsState.chksrtHistory = Array.isArray(raw) ? raw : [];
  } catch {
    subsState.chksrtHistory = [];
  }
}
function persistChksrtHistory() {
  try {
    fs.writeFileSync(
      CHKSRT_HISTORY_PATH,
      JSON.stringify(subsState.chksrtHistory),
      "utf8",
    );
  } catch (e) {
    unilog(513, "persist error:", e.message);
  }
}
function loadChksrtSnoozed() {
  try {
    const raw = JSON.parse(fs.readFileSync(CHKSRT_SNOOZED_PATH, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      // normalize legacy string entries to {videoFilePath, snoozedAt}
      for (const [show, entries] of Object.entries(raw)) {
        if (Array.isArray(entries)) {
          raw[show] = entries.map((e) =>
            typeof e === "string" ? { videoFilePath: e, snoozedAt: 0 } : e,
          );
        }
      }
      subsState.chksrtSnoozed = raw;
    } else {
      subsState.chksrtSnoozed = {};
    }
  } catch {
    subsState.chksrtSnoozed = {};
  }
}
function persistChksrtSnoozed() {
  try {
    fs.writeFileSync(
      CHKSRT_SNOOZED_PATH,
      JSON.stringify(subsState.chksrtSnoozed),
      "utf8",
    );
  } catch (e) {
    unilog(514, "persist error:", e.message);
  }
}
function getChksrtSnoozedForShow(showName) {
  const entries = subsState.chksrtSnoozed?.[showName];
  return Array.isArray(entries) ? entries : [];
}
function addToChksrtSnoozed(showName, videoFilePath) {
  const current = getChksrtSnoozedForShow(showName);
  if (current.some((e) => e.videoFilePath === videoFilePath)) return false;
  subsState.chksrtSnoozed[showName] = [
    ...current,
    { videoFilePath, snoozedAt: Date.now() },
  ];
  return true;
}
function removeFromChksrtSnoozed(showName, videoFilePath) {
  const current = getChksrtSnoozedForShow(showName);
  if (!current.length) return false;
  const next = current.filter((entry) => entry.videoFilePath !== videoFilePath);
  if (next.length === current.length) return false;
  if (next.length > 0) subsState.chksrtSnoozed[showName] = next;
  else delete subsState.chksrtSnoozed[showName];
  return true;
}
function loadOpnCheckHistory() {
  try {
    const raw = JSON.parse(fs.readFileSync(OPN_CHECK_HISTORY_PATH, "utf8"));
    subsState.opnCheckHistory =
      raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    subsState.opnCheckHistory = {};
  }
}
function persistOpnCheckHistory() {
  try {
    fs.writeFileSync(
      OPN_CHECK_HISTORY_PATH,
      JSON.stringify(subsState.opnCheckHistory),
      "utf8",
    );
  } catch (e) {
    unilog(515, "persist error:", e.message);
  }
}
async function fileNeedsSubChecked(videoFilePath, showName) {
  if (subsState.subQueue.some((e) => e.videoFilePath === videoFilePath))
    return false;
  if (subsState.subQueueChkSrt.some((e) => e.videoFilePath === videoFilePath))
    return false;
  if (subsState.asrQueue.some((e) => e.videoPath === videoFilePath))
    return false;
  if (
    getChksrtSnoozedForShow(showName).some(
      (e) => e.videoFilePath === videoFilePath,
    )
  )
    return false;
  // A 1080 resolution-fallback file inherits the 2160's subtitles (they are
  // copied at generation), so it is never sub-checked / extracted on its own.
  if (/1080p/i.test(path.basename(videoFilePath))) {
    const parsedRes = parseFileSeasonEpisode(videoFilePath);
    if (parsedRes?.season != null && parsedRes?.episode != null) {
      const sibs = resFindEpisodeVideos(
        path.dirname(videoFilePath),
        parsedRes.season,
        parsedRes.episode,
      );
      if (sibs.some((v) => v.res === 2160)) return false;
    }
  }
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const dir = path.dirname(videoFilePath);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  const basename = path.basename(base);
  if (
    entries.some(
      (f) =>
        f === basename + ".mb.chosen" ||
        (f.startsWith(basename + ".") && f.endsWith(".srt")),
    )
  )
    return false;
  const tvdbAll = tvdb.getAllTvdbSync?.();
  if (!tvdbAll) return true;
  const tvdbRec = tvdbAll[showName];
  if (!tvdbRec) return true;
  const parsed = parseFileSeasonEpisode(videoFilePath);
  if (!parsed) return true;
  const key = `S${String(parsed.season).padStart(2, "0")}E${String(parsed.episode).padStart(2, "0")}`;
  if (epd.isWatched(tvdbRec.episodeData, parsed.season, parsed.episode))
    return false;
  if (tvdbRec.seriesMap) {
    const ep = tvdbRec.seriesMap[key];
    if (ep && ep.aired && new Date(ep.aired) > new Date()) return false;
  }
  return true;
}
async function generateEmbSrts(
  videoFilePath,
  showname,
  season,
  episode,
  fromUI,
) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  syncBatchMsgs();
  // A failed probe must never look like "this video has no subtitle streams" —
  // that would route a file with embedded subs straight to ASR. Throw instead;
  // processSubQueueEntry drops the entry and the next show scan re-queues it.
  let probeStreams;
  await new Promise((resolve, reject) => {
    cp.execFile(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", videoFilePath],
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(
            new Error(`ffprobe failed for ${videoFilePath}: ${err.message}`),
          );
          return;
        }
        try {
          probeStreams = JSON.parse(stdout).streams || [];
        } catch (e) {
          reject(
            new Error(`ffprobe bad json for ${videoFilePath}: ${e.message}`),
          );
          return;
        }
        resolve();
      },
    );
  });
  const subStreams = probeStreams.filter((s) => s.codec_type === "subtitle");
  const textCodecs = [
    "subrip",
    "ass",
    "ssa",
    "webvtt",
    "mov_text",
    "text",
    "srt",
  ];
  const textStreams = subStreams.filter((s) => {
    const lang = (s.tags?.language || "").toLowerCase();
    return (
      (lang === "eng" || lang === "en" || lang === "") &&
      textCodecs.includes(s.codec_name)
    );
  });
  for (const s of textStreams) {
    const outPath = `${base}.mb${s.index}.srt`;
    if (fs.existsSync(outPath)) {
      if (fromUI) publishEmbLog(`exists: ${path.basename(outPath)}`);
      continue;
    }
    await subExtractQueue.run(
      () =>
        new Promise((resolve) => {
          cp.execFile(
            BATCH_SCHED[0],
            [
              ...BATCH_SCHED.slice(1),
              "ffmpeg",
              "-v",
              "quiet",
              "-i",
              videoFilePath,
              "-map",
              `0:${s.index}`,
              "-c:s",
              "srt",
              "-f",
              "srt",
              "pipe:1",
            ],
            { maxBuffer: 4 * 1024 * 1024 },
            (err, stdout) => {
              if (!err && stdout) {
                const sanitized = sanitizeSrt(stdout);
                if (sanitized !== null) {
                  fs.writeFileSync(outPath, sanitized, "utf8");
                  if (fromUI) publishEmbLog(`extracted ${outPath}`);
                } else {
                  const fname = path.basename(outPath);
                  if (fromUI) publishEmbLog(`No change: ${fname}`);
                }
              }
              resolve();
            },
          );
        }),
    );
  }
  const hasNonText = subStreams.some((s) => !textCodecs.includes(s.codec_name));
  const pgsOnly = hasNonText && textStreams.length === 0;
  const hasEmbText = textStreams.length > 0;
  syncBatchMsgs();
  return { pgsOnly, hasEmbText };
}
async function applyOpenSubSrts(videoFilePath, showname, season, episode) {
  const moviesDir = "/mnt/media/movies";
  const isMovie = videoFilePath.startsWith(moviesDir + "/");
  let results;
  if (isMovie) {
    const filename = path.basename(videoFilePath, path.extname(videoFilePath));
    const yearMatch = filename.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : null;
    const title = yearMatch
      ? filename.slice(0, yearMatch.index).replace(/\./g, " ").trim()
      : filename.replace(/\./g, " ");
    try {
      results = await subsSearch({ query: title, year });
    } catch (e) {
      unilog(7, `opensubs search err: ${e.message}`);
      return;
    }
  } else {
    const tvdbAll = tvdb.getAllTvdbSync?.();
    if (!tvdbAll) return;
    const tvdbRec = tvdbAll[showname];
    if (!tvdbRec?.imdbId) {
      unilog(8, `opensubs skip no imdb: ${videoFilePath}`);
      return;
    }
    try {
      results = await subsSearch({
        imdb_id: tvdbRec.imdbId,
        season,
        episode,
      });
    } catch (e) {
      unilog(9, `opensubs search err: ${e.message}`);
      return;
    }
  }
  const items = Array.isArray(results?.data) ? results.data : [];
  if (items.length === 0) {
    unilog(10, `opensubs no results: ${path.basename(videoFilePath)}`);
    return;
  }
  unilog(
    516,
    `opensubs ${items.length} results: ${path.basename(videoFilePath)}`,
  );
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const opnDir = path.dirname(videoFilePath);
  const opnBasename = path.basename(base);
  let existingOpnCount = 0;
  try {
    existingOpnCount = fs
      .readdirSync(opnDir)
      .filter(
        (f) =>
          f.startsWith(opnBasename) &&
          /^\.opn[A-Z2-7]{5}\.srt$/i.test(f.slice(opnBasename.length)),
      ).length;
  } catch {}
  if (existingOpnCount >= 5) return;
  let dlCount = 0;
  for (const r of items) {
    if (existingOpnCount + dlCount >= 5) break;
    const fid = r.file_id || r.attributes?.files?.[0]?.file_id;
    if (!fid) continue;
    const tag = "opn" + encodeFileIdBase32(fid).slice(1);
    const outPath = `${base}.${tag}.srt`;
    if (fs.existsSync(outPath)) continue;
    try {
      const login = loadSubsLogin();
      let dl = await openSubtitlesDownloadWithRetry({
        apiKey: login.apiKey,
        token: getSubsToken(),
        fileId: fid,
      });
      if (!dl?.resp?.ok) continue;
      const url = typeof dl.body?.link === "string" ? dl.body.link.trim() : "";
      if (!url) continue;
      const resp = await fetch(url, { headers: { Accept: "*/*" } });
      if (!resp.ok) continue;
      const txt = await resp.text();
      await fs.promises.writeFile(outPath, stripSrtFormatting(txt), "utf8");
      dlCount++;
      // TEMP: log api filename for release matching
    } catch (e) {
      unilog(11, `opensubs dl err ${fid}: ${e.message}`);
    }
  }
}
async function generateSrtWithAsr(videoFilePath, fromUI) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const srtPath = base + ".asr.srt";
  if (!fs.existsSync(videoFilePath)) {
    subsState.asrLogBuffer = [];
    appendAsrLog(
      `=== Skipped: ${path.basename(videoFilePath)} (video file gone) ===`,
    );
    unilog(1400, `dropping asr queue entry, file gone: ${videoFilePath}`);
    return;
  }
  if (fs.existsSync(srtPath)) {
    subsState.asrLogBuffer = [];
    appendAsrLog(
      `=== Skipped: ${path.basename(videoFilePath)} (srt already exists) ===`,
    );
    unilog(12, `asr skip exists: ${videoFilePath}`);
    unilog(13, `skipped (srt exists): ${videoFilePath}`);
    return;
  }
  subsState.asrLogBuffer = [];
  appendAsrLog("");
  appendAsrLog(`=== Queued: ${path.basename(videoFilePath)} ===`);
  unilog(14, `asr start: ${videoFilePath}`);
  subsState.genSrtRunning = true;
  publishAsrQueueUpdate({ running: true });
  syncBatchMsgs();
  // Not on ffmpegQueue: transcription is a remote API call and the local ffmpeg
  // work is audio-only, so it never competes with the re-encodes for cores.
  // startAsrQueueLoop's genSrtRunning guard already keeps this to one at a time.
  try {
    await new Promise((resolve, reject) => {
      appendAsrLog(`=== Starting: ${path.basename(videoFilePath)} ===`);
      const child = cp.spawn(
        BATCH_SCHED[0],
        [...BATCH_SCHED.slice(1), "node", ASR_JS_PATH, videoFilePath],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      subsState.genSrtChild = child;
      child.stdout.on("data", (d) => {
        appendAsrLog(d.toString().trimEnd());
      });
      child.stderr.on("data", (d) => {
        appendAsrLog(d.toString().trimEnd());
      });
      child.on("close", (code) => {
        subsState.genSrtChild = null;
        if (code === 0) resolve();
        else if (code === null) reject(new Error(`__cancelled__`));
        else reject(new Error(`asr.js exited ${code}`));
      });
    });
    unilog(15, `asr done: ${videoFilePath}`);
    appendAsrLog(`=== Done: ${path.basename(videoFilePath)} ===`);
    if (fromUI)
      publishSubsProgress({
        path: videoFilePath,
        status: "asr-done",
      });
  } catch (e) {
    unilog(16, `asr error: ${e.message}`);
    if (e.message === "__cancelled__") {
      appendAsrLog(
        `File ${path.basename(videoFilePath)} processing cancelled.`,
      );
    } else {
      appendAsrLog(`=== Error: ${e.message} ===`);
    }
  } finally {
    subsState.genSrtRunning = false;
    subsState.genSrtChild = null;
    syncBatchMsgs();
    publishAsrQueueUpdate({ running: false });
  }
}
function doSubQueueNow() {
  subsState.chkSubQueueDelay = 500;
  if (!subsState.subQueueBusy) {
    processSubQueueEntry().catch((e) => unilog(519, "error:", e.message));
  } else if (!subsState.subQueuePendingNow) {
    subsState.subQueuePendingNow = true;
    const poll = () => {
      if (!subsState.subQueueBusy) {
        subsState.subQueuePendingNow = false;
        processSubQueueEntry().catch((e) => unilog(520, "error:", e.message));
      } else {
        setTimeout(poll, 1000);
      }
    };
    setTimeout(poll, 1000);
  }
}
async function processSubQueueEntry() {
  if (subsState.subQueue.length === 0) return;
  const entry = subsState.subQueue.shift();
  persistSubQueue();
  subsState.subQueueBusy = true;
  subsState.currentlyProcessingSubPath = entry.videoFilePath;
  try {
    // The file can vanish between enqueue and now — most often a 1080 demoted to
    // a hidden `.mkv.alt` fallback, which already inherits the 2160's subtitles.
    if (!fs.existsSync(entry.videoFilePath)) {
      unilog(
        1401,
        `dropping sub queue entry, file gone: ${entry.videoFilePath}`,
      );
      return;
    }
    const parsed = parseFileSeasonEpisode(entry.videoFilePath);
    const showName = showNameFromFilePath(entry.videoFilePath);
    const { pgsOnly, hasEmbText } =
      (await generateEmbSrts(
        entry.videoFilePath,
        showName,
        parsed?.season,
        parsed?.episode,
        entry.fromUI,
      )) || {};
    await sleep(1000);
    await applyOpenSubSrts(
      entry.videoFilePath,
      showName,
      parsed?.season,
      parsed?.episode,
    );
    await sleep(1000);
    const base = entry.videoFilePath.replace(/\.[^.]+$/, "");
    const dir = path.dirname(entry.videoFilePath);
    const basename = path.basename(base);
    let dirEntries;
    try {
      dirEntries = fs.readdirSync(dir);
    } catch {
      dirEntries = [];
    }
    const hasSidecar = dirEntries.some(
      (f) =>
        f === basename + ".mb.chosen" ||
        (f.startsWith(basename + ".") && f.endsWith(".srt")),
    );
    if (!hasSidecar && !pgsOnly && !hasEmbText) {
      addToAsrQueue([
        {
          videoPath: entry.videoFilePath,
          showName,
          season: parsed?.season ?? 0,
          episode: parsed?.episode ?? 0,
          fromUI: entry.fromUI,
          lowPriority: entry.lowPriority,
          source: entry.fromUI ? "ASR pane" : "subtitle pipeline",
          addedAt: Date.now(),
        },
      ]);
    } else {
      enqueueSubQueueChkSrt(
        { videoFilePath: entry.videoFilePath, fromUI: entry.fromUI },
        false,
      );
      cleanChkSrtQueue();
      persistSubQueueChkSrt();
      notifyClients("chksrt-count", subsState.subQueueChkSrt.length);
      syncBatchMsgs();
      if (entry.fromUI)
        publishSubsProgress({
          path: entry.videoFilePath,
          status: "chksrt",
        });
    }
  } finally {
    subsState.subQueueBusy = false;
    subsState.currentlyProcessingSubPath = null;
    subsState.chkSubQueueDelay = 500;
    subsState.subDone++;
  }
}
function startSubQueueLoop() {
  const loop = async () => {
    if (subsState.subQueue.length === 0) {
      subsState.chkSubQueueDelay = 10_000;
    } else {
      await processSubQueueEntry().catch((e) => unilog(521, "", e.message));
    }
    setTimeout(loop, subsState.chkSubQueueDelay);
  };
  setTimeout(loop, subsState.chkSubQueueDelay);
}
function startAsrQueueLoop() {
  const loop = async () => {
    if (!subsState.genSrtRunning && subsState.asrQueue.length > 0) {
      const entry = subsState.asrQueue[0];
      subsState.asrQueueDelay = 500;
      generateSrtWithAsr(entry.videoPath, entry.fromUI)
        .catch((e) => unilog(522, "", e.message))
        .finally(() => {
          if (subsState.asrQueue[0]?.videoPath === entry.videoPath) {
            subsState.asrQueue.shift();
            persistAsrQueue();
            subsState.asrDone++;
            publishAsrQueueUpdate({ running: false });
          }
        });
    }
    if (subsState.asrQueue.length === 0) subsState.asrQueueDelay = 10_000;
    setTimeout(loop, subsState.asrQueueDelay);
  };
  setTimeout(loop, subsState.asrQueueDelay);
}

// Daily rotation of the ASR subtitle.log (runs at 5am LA).
cron.schedule(
  "0 5 * * *",
  () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = yesterday.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "2-digit",
      day: "2-digit",
    });
    const mmdd = now.replace("/", "-").replace(/,.*/, "");
    const dest = SUBTITLE_LOG_DIR + "subtitle-" + mmdd + ".log";
    try {
      fs.mkdirSync(SUBTITLE_LOG_DIR, { recursive: true });
      if (fs.existsSync(SUBTITLE_LOG_PATH))
        fs.renameSync(SUBTITLE_LOG_PATH, dest);
      fs.writeFileSync(SUBTITLE_LOG_PATH, "", "utf8");
      unilog(523, "subtitle.log rotated to", dest);
    } catch (e) {
      unilog(524, "log rotate error:", e.message);
    }
  },
  { timezone: "America/Los_Angeles" },
);

// ---- OPN (opensubtitles) sidecar downloader ----
function resetOpnDailyCountIfNeeded() {
  const todayLA = new Date()
    .toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })
    .replace(/\//g, "-");
  if (subsState.opnDailyCountDate !== todayLA) {
    subsState.opnDailyCount = 0;
    subsState.opnDailyCountDate = todayLA;
  }
}

function getOpnSidecarPath(videoFilePath, fileId) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const tag = "opn" + encodeFileIdBase32(fileId).slice(1);
  return `${base}.${tag}.srt`;
}

function hasOpnSidecar(videoFilePath) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const dir = path.dirname(videoFilePath);
  const basename = path.basename(base);
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  return dirEntries.some(
    (entry) =>
      entry.startsWith(basename) &&
      /^\.opn[A-Z2-7]{5}\.srt$/i.test(entry.slice(basename.length)),
  );
}

// A saved chksrt decision (`<base>.mb.chosen`) means no sidecar srt is
// wanted for this video — never download opn srts once it exists.
function hasChosenMarker(videoFilePath) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  return fs.existsSync(`${base}.mb.chosen`);
}

async function tryDownloadOpnSrtForVideo({
  showName,
  tvdbRecord,
  videoFilePath,
  parsed,
  key,
  logPrefix,
}) {
  if (!tvdbRecord.inEmby || !tvdbRecord.imdbId) return { attempted: false };
  if (!fs.existsSync(videoFilePath)) return { attempted: false, missing: true };
  if (hasChosenMarker(videoFilePath)) return { attempted: false, chosen: true };
  if (hasOpnSidecar(videoFilePath)) {
    return { attempted: true, downloaded: false, alreadyPresent: true };
  }

  resetOpnDailyCountIfNeeded();
  if (subsState.opnDailyCount >= OPN_DAILY_LIMIT) {
    unilog(17, `${logPrefix} quota exceeded for ${showName} ${key}`);
    return { attempted: true, downloaded: false, quotaExceeded: true };
  }

  let results;
  try {
    results = await subsSearch({
      imdb_id: tvdbRecord.imdbId,
      season: parsed.season,
      episode: parsed.episode,
      language: "en",
    });
  } catch (e) {
    if (e?.message?.includes("406") || e?.details?.status === 406) {
      unilog(18, `${logPrefix} quota exceeded for ${showName} ${key}`);
    } else {
      unilog(19, `${logPrefix} search err ${showName} ${key}: ${e.message}`);
    }
    return { attempted: true, downloaded: false, error: e };
  }

  const items = Array.isArray(results?.data) ? results.data : [];
  if (items.length === 0) {
    unilog(20, `${logPrefix} no results: ${showName} ${key}`);
    return { attempted: true, downloaded: false };
  }

  const result = items[0];
  const fileId = result.file_id || result.attributes?.files?.[0]?.file_id;
  if (!fileId) {
    unilog(21, `${logPrefix} missing file id: ${showName} ${key}`);
    return { attempted: true, downloaded: false };
  }

  const outPath = getOpnSidecarPath(videoFilePath, fileId);
  if (fs.existsSync(outPath)) {
    return { attempted: true, downloaded: false, alreadyPresent: true };
  }

  try {
    const login = loadSubsLogin();
    const dl = await openSubtitlesDownloadWithRetry({
      apiKey: login.apiKey,
      token: getSubsToken(),
      fileId,
    });
    if (!dl?.resp?.ok) {
      if (dl?.resp?.status === 406) {
        unilog(22, `${logPrefix} quota exceeded (dl) for ${showName} ${key}`);
      } else {
        unilog(
          536,
          `${logPrefix} download err ${showName} ${key}: HTTP ${dl?.resp?.status ?? "unknown"}`,
        );
      }
      return { attempted: true, downloaded: false };
    }
    const url = typeof dl.body?.link === "string" ? dl.body.link.trim() : "";
    if (!url) {
      unilog(23, `${logPrefix} missing download link: ${showName} ${key}`);
      return { attempted: true, downloaded: false };
    }
    const resp = await fetch(url, { headers: { Accept: "*/*" } });
    if (!resp.ok) {
      unilog(
        537,
        `${logPrefix} fetch err ${showName} ${key}: HTTP ${resp.status}`,
      );
      return { attempted: true, downloaded: false };
    }
    const txt = await resp.text();
    await fs.promises.writeFile(outPath, stripSrtFormatting(txt), "utf8");
    subsState.opnDailyCount++;
    unilog(24, `${logPrefix}: ${outPath}`);
    return { attempted: true, downloaded: true, outPath };
  } catch (e) {
    unilog(
      538,
      `${logPrefix} dl err ${showName} ${key} fid=${fileId}: ${e.message}`,
    );
    return { attempted: true, downloaded: false, error: e };
  }
}

async function checkAndDownloadOpnSrt(showName, tvdbRecord) {
  if (!tvdbRecord.inEmby) return;
  if (!tvdbRecord.imdbId) return;

  resetOpnDailyCountIfNeeded();
  if (subsState.opnDailyCount >= OPN_DAILY_LIMIT) return;

  const ed = tvdbRecord.episodeData;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  const eligible = [];
  const showFolder = path.join(tvDir, showName);
  let seasonDirs;
  try {
    seasonDirs = fs.readdirSync(showFolder);
  } catch {
    return;
  }

  for (const seasonDir of seasonDirs) {
    const seasonPath = path.join(showFolder, seasonDir);
    try {
      if (!fs.statSync(seasonPath).isDirectory()) continue;
    } catch {
      continue;
    }
    let files;
    try {
      files = fs.readdirSync(seasonPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!videoFileExtensions.includes(f.split(".").pop())) continue;
      const fp = path.join(seasonPath, f);
      const parsed = parseFileSeasonEpisode(fp);
      if (!parsed) continue;
      const key = `S${String(parsed.season).padStart(2, "0")}E${String(parsed.episode).padStart(2, "0")}`;
      if (epd.isWatched(ed, parsed.season, parsed.episode)) continue;

      const airedStr = epd.getAired(ed, parsed.season, parsed.episode);
      if (!airedStr) continue;
      const airedMs = new Date(airedStr).getTime();
      if (isNaN(airedMs) || airedMs < oneYearAgo || airedMs > now) continue;
      if (hasOpnSidecar(fp)) continue;
      if (hasChosenMarker(fp)) continue;

      const histKey = `${showName}|||${key}`;
      const lastCheck = subsState.opnCheckHistory[histKey];
      if (lastCheck && now - lastCheck < twentyFourHours) continue;

      eligible.push({ filePath: fp, key, airedMs, parsed, histKey });
    }
  }

  if (eligible.length === 0) return;

  eligible.sort((a, b) => a.airedMs - b.airedMs);
  const { filePath, key, parsed, histKey } = eligible[0];
  subsState.opnCheckHistory[histKey] = now;
  persistOpnCheckHistory();

  const result = await tryDownloadOpnSrtForVideo({
    showName,
    tvdbRecord,
    videoFilePath: filePath,
    parsed,
    key,
    logPrefix: "opn-bg",
  });

  if (result?.downloaded) {
    delete subsState.opnCheckHistory[histKey];
    persistOpnCheckHistory();
    if (removeFromChksrtSnoozed(showName, filePath)) {
      persistChksrtSnoozed();
      enqueueSubQueueChkSrt(
        { videoFilePath: filePath, fromUI: false, lowPriority: false },
        false,
      );
      persistSubQueueChkSrt();
      notifyClients("chksrt-count", subsState.subQueueChkSrt.length);
      syncBatchMsgs();
      unilog(25, `opn-bg unsnooze ${showName}: ${filePath}`);
    }
  }
}

async function processChksrtSnoozedForShow(showName, tvdbRecord) {
  const snoozedEntries = [...getChksrtSnoozedForShow(showName)];
  if (snoozedEntries.length === 0) return;

  let queueChanged = false;
  let snoozedChanged = false;
  for (const { videoFilePath, snoozedAt } of snoozedEntries) {
    if (Date.now() - snoozedAt < CHKSRT_SNOOZE_MS) continue;
    removeFromChksrtSnoozed(showName, videoFilePath);
    snoozedChanged = true;

    if (!fs.existsSync(videoFilePath)) continue;

    const alreadyQueued = subsState.subQueueChkSrt.some(
      (entry) => entry.videoFilePath === videoFilePath,
    );
    if (alreadyQueued) continue;

    const parsed = parseFileSeasonEpisode(videoFilePath);
    if (parsed) {
      const key = `S${String(parsed.season).padStart(2, "0")}E${String(parsed.episode).padStart(2, "0")}`;
      await tryDownloadOpnSrtForVideo({
        showName,
        tvdbRecord,
        videoFilePath,
        parsed,
        key,
        logPrefix: "opn-snooze",
      });
    } else {
      unilog(26, `opn-snooze parse err ${showName}: ${videoFilePath}`);
    }

    enqueueSubQueueChkSrt(
      { videoFilePath, fromUI: false, lowPriority: false },
      false,
    );
    unilog(27, `chksrt unsnooze (24h) ${showName}: ${videoFilePath}`);
    queueChanged = true;
  }

  if (snoozedChanged) persistChksrtSnoozed();
  if (queueChanged) {
    persistSubQueueChkSrt();
    notifyClients("chksrt-count", subsState.subQueueChkSrt.length);
    syncBatchMsgs();
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export {
  persistSubQueue,
  persistSubQueueChkSrt,
  cleanChkSrtQueue,
  persistAsrQueue,
  appendAsrLog,
  appendAsrTail,
  addToAsrQueue,
  enqueueSubQueue,
  enqueueSubQueueChkSrt,
  loadQueues,
  loadChksrtHistory,
  persistChksrtHistory,
  loadChksrtSnoozed,
  persistChksrtSnoozed,
  getChksrtSnoozedForShow,
  addToChksrtSnoozed,
  removeFromChksrtSnoozed,
  loadOpnCheckHistory,
  persistOpnCheckHistory,
  fileNeedsSubChecked,
  generateEmbSrts,
  applyOpenSubSrts,
  generateSrtWithAsr,
  doSubQueueNow,
  processSubQueueEntry,
  startSubQueueLoop,
  startAsrQueueLoop,
  resetOpnDailyCountIfNeeded,
  getOpnSidecarPath,
  hasOpnSidecar,
  tryDownloadOpnSrtForVideo,
  checkAndDownloadOpnSrt,
  processChksrtSnoozedForShow,
};
