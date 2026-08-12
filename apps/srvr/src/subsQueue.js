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
// index.js (index owns the hub because it also reads the other queues' state).

import fs from "fs";
import * as path from "node:path";
import * as cp from "child_process";
import fetch from "node-fetch";
import { unilog, logHere, parseFileSeasonEpisode } from "@tv/share";
import * as epd from "@tv/share";
import { SRVR_DATA_DIR } from "./srvrPaths.js";
import cron from "node-cron";
import {
  notifyClients,
  registerLocalChannel,
  publishChannelDelta,
} from "./messaging.js";
import { showNameFromFilePath } from "./showPaths.js";
import { videoFileExtensions } from "./videoFiles.js";
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
const moviesDir = "/mnt/media/movies";
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
  // What the in-flight sub entry is doing right now, for the Queues pane. Sub
  // gets no time estimate: its cost is mostly fixed overhead plus an external
  // API with retries, so there is nothing about the file to predict from.
  subStage: null,
  subStartedAt: 0,
  // asr.js progress, scraped from the child's own log lines as they arrive.
  // posSecs/totalDur are audio seconds, which is what makes a real ETA possible.
  asrStage: null,
  asrStartedAt: 0,
  asrTotalDur: 0,
  asrPosSecs: 0,
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
    headName: showNameFromFilePath(subsState.subQueue[0]?.videoFilePath || ""),
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
function getChkSrtQueueSnapshot() {
  return subsState.subQueueChkSrt.map((e) => ({
    videoFilePath: e.videoFilePath,
    showName: showNameFromFilePath(e.videoFilePath),
  }));
}
registerLocalChannel("chksrtQueue", { snapshot: getChkSrtQueueSnapshot });
function persistSubQueueChkSrt() {
  fs.writeFileSync(
    SUB_QUEUE_CHKSRT_PATH,
    JSON.stringify(subsState.subQueueChkSrt),
    "utf8",
  );
  publishChannelDelta("chksrtQueue", getChkSrtQueueSnapshot());
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
// asr.js reports its own stage as it goes — "Preprocessing audio...",
// "Duration: Ns, VAD chunking", then one "Chunk N: Xs-Ys" per chunk before it
// uploads. Those lines are the only channel out of the child process, so the
// pane's stage text and ETA are scraped from them here as they land.
function trackAsrProgress(text) {
  for (const line of String(text).split("\n")) {
    if (line.includes("Processing: ")) {
      subsState.asrStage = "extracting audio";
      subsState.asrTotalDur = 0;
      subsState.asrPosSecs = 0;
      continue;
    }
    if (line.includes("Preprocessing audio")) {
      subsState.asrStage = "preprocessing audio";
      continue;
    }
    const dur = line.match(/Duration: ([\d.]+)s/);
    if (dur) {
      subsState.asrTotalDur = parseFloat(dur[1]);
      subsState.asrStage = "splitting on silence";
      continue;
    }
    const over = line.match(/Chunk (\d+) oversize/);
    if (over) {
      subsState.asrStage = `chunk ${Number(over[1]) + 1} oversize, retrying`;
      continue;
    }
    const chunk = line.match(/Chunk (\d+): [\d.]+s-([\d.]+)s/);
    if (chunk) {
      subsState.asrPosSecs = parseFloat(chunk[2]);
      subsState.asrStage = `transcribing chunk ${Number(chunk[1]) + 1}`;
    }
  }
}
function appendAsrLog(text, detail = false) {
  trackAsrProgress(text);
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
// Stage text for the in-flight sub entry. Only tracked while the queue loop is
// the caller — generateEmbSrts/applyOpenSubSrts are also reachable from the UI
// endpoints, and that work is not what the pane is reporting on.
function setSubStage(stage) {
  if (subsState.subQueueBusy) subsState.subStage = stage;
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
  setSubStage("probing subtitle streams");
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
  let extracted = 0;
  for (const s of textStreams) {
    const outPath = `${base}.mb${s.index}.srt`;
    extracted++;
    if (fs.existsSync(outPath)) {
      if (fromUI) publishEmbLog(`exists: ${path.basename(outPath)}`);
      continue;
    }
    // subExtractQueue is shared, so this can sit behind an unrelated file's
    // extraction — say so rather than looking stalled.
    setSubStage(
      `extracting embedded subs ${extracted}/${textStreams.length}`,
    );
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
  setSubStage("searching opensubtitles");
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
    // Another rip of this episode already holds this exact OpenSubtitles
    // file — copy its bytes rather than download the same content twice.
    const sibling = findSiblingOpnSrt(videoFilePath, fid);
    if (sibling) {
      setSubStage(`copying opensubtitles ${existingOpnCount + dlCount + 1}/5`);
      try {
        await fs.promises.copyFile(sibling.path, outPath);
        dlCount++;
        unilog(2057, `copied ${tag} from sibling rip: ${path.basename(sibling.path)}`);
        continue;
      } catch (e) {
        unilog(2058, `sibling copy failed for ${path.basename(outPath)}: ${e.message}`);
      }
    }
    setSubStage(
      `downloading opensubtitles ${existingOpnCount + dlCount + 1}/5`,
    );
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
  subsState.asrStartedAt = Date.now();
  subsState.asrStage = "starting";
  subsState.asrTotalDur = 0;
  subsState.asrPosSecs = 0;
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
    subsState.asrStage = null;
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
  // Only one entry at a time. startSubQueueLoop serializes itself by awaiting,
  // but doSubQueueNow can fire between ticks, and the entry now stays at the
  // head while it runs — without this guard both callers would pick up the
  // same entry and process it twice.
  if (subsState.subQueueBusy) return;
  if (subsState.subQueue.length === 0) return;
  // The entry stays in subQueue while it is processed, like asrQueue. It is
  // removed in the finally below, so a run that ends —
  // even by throwing — still drops it; only an interruption that kills the
  // process leaves it behind, and then subQueue.json still has it and it is
  // retried on restart instead of vanishing between queues. Re-running is
  // safe: generateEmbSrts skips .mb<n>.srt files that already exist and
  // applyOpenSubSrts skips .opn tags it already downloaded.
  const entry = subsState.subQueue[0];
  subsState.subQueueBusy = true;
  subsState.currentlyProcessingSubPath = entry.videoFilePath;
  subsState.subStartedAt = Date.now();
  subsState.subStage = "starting";
  try {
    // The file can vanish between enqueue and now — most often a duplicate
    // lower-resolution download demoted to `.old`.
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
    setSubStage("choosing next queue");
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
    // Matched by path, not by index: an enqueue during the run can unshift
    // ahead of this entry, so the head is not necessarily still it.
    const idx = subsState.subQueue.findIndex(
      (e) => e.videoFilePath === entry.videoFilePath,
    );
    if (idx !== -1) {
      subsState.subQueue.splice(idx, 1);
      persistSubQueue();
    }
    subsState.subQueueBusy = false;
    subsState.currentlyProcessingSubPath = null;
    subsState.subStage = null;
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

const OPN_TAG_RE = /\.(opn[A-Z2-7]{5})\.srt$/i;

// Rips of one episode sit side by side in a single season folder, so an
// existing `*.opn<tag>.srt` there already holds exactly what a download for
// this episode would return. Find one so the bytes can be copied instead of
// spending a second OpenSubtitles download on identical content. `fileId`
// narrows the search to one OpenSubtitles file; omit it to take any sibling.
// Returns { path, tag, fileId } or null.
function findSiblingOpnSrt(videoFilePath, fileId) {
  const dir = path.dirname(videoFilePath);
  const ownName = path.basename(videoFilePath);
  const ownBase = ownName.replace(/\.[^.]+$/, "");
  const wantTag =
    fileId === undefined
      ? null
      : ("opn" + encodeFileIdBase32(fileId).slice(1)).toLowerCase();

  // Movies have no season/episode to agree on; one movie folder is the scope.
  const isMovie = videoFilePath.startsWith(moviesDir + "/");
  const own = isMovie ? null : parseFileSeasonEpisode(ownBase);
  if (
    !isMovie &&
    (!Number.isInteger(own?.season) || !Number.isInteger(own?.episode))
  ) {
    return null;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue; // .restmp- and other temp leftovers
    const m = OPN_TAG_RE.exec(entry);
    if (!m) continue;
    const tag = m[1];
    if (wantTag && tag.toLowerCase() !== wantTag) continue;
    const srcBase = entry.slice(0, entry.length - m[0].length);
    if (srcBase === ownBase) continue; // this video's own sidecar
    if (!isMovie) {
      const sib = parseFileSeasonEpisode(srcBase);
      if (sib?.season !== own.season || sib?.episode !== own.episode) continue;
    }
    return { path: path.join(dir, entry), tag, srcBase };
  }
  return null;
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

  // Another rip of this episode already carries an opn srt — copy it rather
  // than search and download the same content again. Checked before the
  // search because result order is not stable, so searching again could hand
  // back a different file_id and download content we already have.
  const sibling = findSiblingOpnSrt(videoFilePath);
  if (sibling) {
    const base = videoFilePath.replace(/\.[^.]+$/, "");
    const outPath = `${base}.${sibling.tag}.srt`;
    try {
      await fs.promises.copyFile(sibling.path, outPath);
      unilog(2059, `${logPrefix} copied ${sibling.tag} from sibling rip for ${showName} ${key}: ${path.basename(sibling.path)}`);
      return { attempted: true, downloaded: true, outPath, copied: true };
    } catch (e) {
      unilog(2060, `${logPrefix} sibling copy failed for ${showName} ${key}: ${e.message}`);
    }
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

// ---- Queues pane ----------------------------------------------------------

// Median of 15 completed runs (log sites 14/15): 14 of them took 62-76s, one
// retried its way to 438s. Episode audio is a near-constant length and the
// remote API dominates, so a flat number is as good as anything until the run
// starts reporting chunk positions.
const ASR_RUN_SECS = 74;

// Seconds left on the running ASR job. Once asr.js has reported a chunk end,
// this is measured — audio seconds done per wall second, projected to the end.
function asrRemainingSecs() {
  if (!subsState.genSrtRunning) return 0;
  const elapsed = (Date.now() - subsState.asrStartedAt) / 1000;
  const { asrTotalDur: total, asrPosSecs: pos } = subsState;
  if (total > 0 && pos > 0 && elapsed > 0) {
    const frac = Math.min(pos / total, 0.999);
    return Math.max(0, Math.round((elapsed * (1 - frac)) / frac));
  }
  return Math.max(0, Math.round(ASR_RUN_SECS - elapsed));
}

// Sub carries no ETA — see the note on subStage in subsState.
export function getSubQueueStatus() {
  const entries = subsState.subQueue.map((e, i) => ({
    n: i + 1,
    file: path.basename(e.videoFilePath),
    path: e.videoFilePath,
    running: i === 0 && subsState.subQueueBusy,
  }));
  const inflight =
    subsState.subQueueBusy && subsState.currentlyProcessingSubPath
      ? {
          file: path.basename(subsState.currentlyProcessingSubPath),
          stage: subsState.subStage || "working",
          elapsedSecs: Math.round(
            (Date.now() - subsState.subStartedAt) / 1000,
          ),
        }
      : null;
  return { count: entries.length, inflight, entries };
}

// ChkSrt is a human review queue — nothing runs on the server, so it has no
// in-flight entry and no ETA.
export function getChkSrtQueueStatus() {
  const entries = subsState.subQueueChkSrt.map((e, i) => ({
    n: i + 1,
    file: path.basename(e.videoFilePath || ""),
    path: e.videoFilePath,
    running: false,
  }));
  return { count: entries.length, inflight: null, entries };
}

export function getAsrQueueStatus() {
  let eta = Date.now();
  const entries = [];
  for (let i = 0; i < subsState.asrQueue.length; i++) {
    const e = subsState.asrQueue[i];
    const running = i === 0 && subsState.genSrtRunning;
    eta += (running ? asrRemainingSecs() : ASR_RUN_SECS) * 1000;
    entries.push({
      n: i + 1,
      file: path.basename(e.videoPath || ""),
      path: e.videoPath,
      etaMs: eta,
      running,
    });
  }
  const head = subsState.asrQueue[0];
  const inflight =
    subsState.genSrtRunning && head
      ? {
          file: path.basename(head.videoPath || ""),
          stage: subsState.asrStage || "starting",
          remainingSecs: asrRemainingSecs(),
          elapsedSecs: Math.round(
            (Date.now() - subsState.asrStartedAt) / 1000,
          ),
        }
      : null;
  return { count: entries.length, inflight, entries };
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
