// subsQueue — subtitle/ASR queue domain extracted from index.js.
//
// Owns two persistent queues and their background loops:
//   subQueue  what a video gets when it lands on disk (the add-to-disk steps):
//             its text tracks copied out to sidecars, new subtitle files
//             named and glued words split; and subtitle vetting (subVet.js),
//             for entries marked full or cheap
//   asrQueue  complete ASR (asr.js): the `+` file and the word-timed
//             transcript a full vetting judges by
// Every subtitle is a sanitized sidecar .srt; src/subs.js has the rest.
//
// All mutable state lives on the exported `subsState` object so that route
// handlers and this module share one authoritative reference. The messaging
// "batch header" hub (syncBatchMsgs) is injected via init() to avoid a
// circular import with index.js (index owns the hub because it also reads the
// other queues' state).

import fs from "fs";
import os from "os";
import * as path from "node:path";
import * as cp from "child_process";
import {
  unilog,
  logHere,
  parseFileSeasonEpisode,
  cleanSrt,
  vidIsVideoName,
  vidDeleteWithSidecars,
} from "@tv/share";
import cron from "node-cron";
import { notifyClients } from "./messaging.js";
import { showNameFromFilePath } from "./showPaths.js";
import { BATCH_SCHED, subExtractQueue } from "./batchQueue.js";
import * as tvdb from "./tvdb.js";
import * as subs from "./subs.js";
import { stillsBusy } from "./stills.js";
import { getRecodePending } from "./recode.js";
import { addBlockedName } from "./blockedNames.js";
import { fixGluedSidecars } from "./subPrepare.js";
import { vetVideo } from "./subVet.js";
import { videoInfo, englishTrack } from "./subSpotCheck.js";

// ---- hard-wired constants (no env vars per repo convention) ----
const moviesDir = "/mnt/media/movies";
const SUB_QUEUE_PATH = "/root/dev/apps/tv/apps/asr/data/subQueue.json";
const ASR_QUEUE_PATH = "/root/dev/apps/tv/apps/asr/data/asrQueue.json";
const SUBTITLE_LOG_PATH = "/root/dev/apps/tv/apps/asr/data/subtitle.log";
const SUBTITLE_LOG_DIR = "/root/dev/apps/tv/apps/asr/data/subtitle-logs/";
const ASR_JS_PATH = "/root/dev/apps/tv/apps/asr/asr.js";
const ASR_LOG_BUFFER_MAX = 500;
const EMB_LOG_BUFFER_MAX = 500;
// A sidecar this code names itself, as opposed to one that arrived as it is.
// Case-sensitive like sidecarType (subOrigin.js), so a name it calls S is not
// taken for a named one; an opn tag grows past 5 characters with the file id.
export const NAMED_SIDECAR_RE = /\.(?:[THS]\d+|mb\d+|opn[A-Za-z2-7]{5,}|asr)\.srt$/;

// ---- shared mutable state (single authoritative reference) ----
export const subsState = {
  subQueue: [],
  asrQueue: [],
  subQueueBusy: false,
  chkSubQueueDelay: 10_000,
  asrQueueDelay: 10_000,
  currentlyProcessingSubPath: null,
  // A request for the video being processed now, made during its run: the
  // entry is queued again with it once the run is done.
  subAgain: null,
  // What the in-flight sub entry is doing right now, for the Queues pane. Sub
  // gets no time estimate: its cost is mostly fixed overhead plus an external
  // API with retries, so there is nothing about the file to predict from.
  subStage: null,
  subStartedAt: 0,
  // asr.js progress, scraped from the child's own log lines as they arrive.
  // totalDur is the audio length in seconds, used to scale the ETA.
  asrStage: null,
  asrStartedAt: 0,
  asrTotalDur: 0,
  genSrtRunning: false,
  genSrtChild: null,
  // set while an abort is in flight so the child's exit reads as cancelled
  // rather than as a failure, whatever code the signal produces
  genSrtAborting: false,
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
function persistAsrQueue() {
  fs.writeFileSync(ASR_QUEUE_PATH, JSON.stringify(subsState.asrQueue), "utf8");
}
// The asr log buffer holds entries { text } — the Queued/Starting/Done lines
// plus asr.js's own progress, in one buffer so they stay interleaved in true
// arrival order. The pane shows all of them.
// asr.js reports its own stage as it goes — "Processing: <name>",
// "Duration: Ns, uploading NMB of audio", "Submitted job <id>",
// "Transcribed N words into N cues". Those lines are the only channel out of
// the child process, so the pane's stage text is scraped from them here as
// they land. The transcription job is opaque while it runs — see
// asrRemainingSecs for what that costs the ETA.
function trackAsrProgress(text) {
  for (const line of String(text).split("\n")) {
    if (line.includes("Processing: ")) {
      subsState.asrStage = "extracting audio";
      subsState.asrTotalDur = 0;
      continue;
    }
    const dur = line.match(/Duration: ([\d.]+)s/);
    if (dur) {
      subsState.asrTotalDur = parseFloat(dur[1]);
      subsState.asrStage = "uploading audio";
      continue;
    }
    if (line.includes("Submitted job ")) {
      subsState.asrStage = "transcribing";
      continue;
    }
    if (line.includes("(attempt ")) {
      subsState.asrStage = "transcribing, retrying";
      continue;
    }
    if (line.includes("Transcribed ")) {
      subsState.asrStage = "writing subtitles";
    }
  }
}
function appendAsrLog(text) {
  trackAsrProgress(text);
  const entry = { text };
  subsState.asrLogBuffer.push(entry);
  if (subsState.asrLogBuffer.length > ASR_LOG_BUFFER_MAX) {
    subsState.asrLogBuffer = subsState.asrLogBuffer.slice(-ASR_LOG_BUFFER_MAX);
  }
  try {
    fs.appendFileSync(SUBTITLE_LOG_PATH, text + "\n", "utf8");
  } catch (e) {
    unilog(1556, `subtitle.log append failed: ${e.message}`);
  }
  notifyClients("asr-log", text);
  notifyAsrLogListeners(entry);
}

// Some asr.js progress arrives out-of-band via the unilog collector
// (routes/unilog.js) rather than on the child's stdout. Mirror it into the same
// buffer so it interleaves and rides the same asrLog channel.
function appendAsrTail(text) {
  appendAsrLog(text);
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
// The vetting two requests for one video ask for together: full over cheap.
const mergeVet = (a, b) => (a === "full" || b === "full" ? "full" : a || b || undefined);
// Two requests for one video as one: either one's naming, replacement or
// vetting stands, with the more urgent priority.
const mergeSubRequest = (a, b) =>
  a
    ? {
        ...a,
        renameS: !!(a.renameS || b.renameS),
        replaced: !!(a.replaced || b.replaced),
        vet: mergeVet(a.vet, b.vet),
        lowPriority: !!(a.lowPriority && b.lowPriority),
        fromUI: !!(a.fromUI || b.fromUI),
      }
    : { ...b };
function enqueueSubQueue(entry, toFront) {
  // A request for the video being processed now runs it again once this run
  // is done, so a subtitle file that arrives, or the video changing, mid-run
  // is not lost.
  if (subsState.currentlyProcessingSubPath === entry.videoFilePath) {
    subsState.subAgain = mergeSubRequest(subsState.subAgain, entry);
    return;
  }
  const idx = subsState.subQueue.findIndex(
    (e) => e.videoFilePath === entry.videoFilePath,
  );
  if (idx !== -1) {
    const existing = subsState.subQueue[idx];
    if (entry.renameS) existing.renameS = true;
    if (entry.replaced) existing.replaced = true;
    existing.vet = mergeVet(existing.vet, entry.vet);
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
function loadQueues() {
  try {
    subsState.subQueue = JSON.parse(fs.readFileSync(SUB_QUEUE_PATH, "utf8"));
  } catch {
    subsState.subQueue = [];
  }
  try {
    subsState.asrQueue = JSON.parse(fs.readFileSync(ASR_QUEUE_PATH, "utf8"));
  } catch {
    subsState.asrQueue = [];
  }
}
// Stage text for the in-flight sub entry, for the Queues pane.
function setSubStage(stage) {
  if (subsState.subQueueBusy) subsState.subStage = stage;
}
// Whether the sweep should take the video: not yet through the add-to-disk
// steps, watched or not, whatever subtitle files it already has.
function sweepWantsVideo(videoFilePath) {
  if (subsState.subQueue.some((e) => e.videoFilePath === videoFilePath))
    return false;
  if (subsState.asrQueue.some((e) => e.videoPath === videoFilePath))
    return false;
  return !subs.isProcessed(videoFilePath);
}
// Copy the video's English (or untagged) text tracks out to sanitized
// sidecars: <base>.T<n>.srt, or .H<n>.srt for one flagged as describing music
// and sound, n being the track's stream index. Forced and image tracks are
// left where they are. Returns whether the video has such a track at all.
async function extractEmbSrts(videoFilePath, fromUI) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  syncBatchMsgs();
  setSubStage("probing subtitle streams");
  // A failed probe must never look like "this video has no subtitle streams" —
  // that would route a file with embedded subs straight to ASR. Throw instead;
  // processSubQueueEntry drops the entry and the sweep re-queues it.
  // Except a file ffprobe reads but can't make out (a broken download): it
  // never will, so its name is blocked and it is deleted with its sidecars.
  let probeStreams;
  let broken = false;
  await new Promise((resolve, reject) => {
    cp.execFile(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_streams", videoFilePath],
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          broken = /Invalid data found/.test(stderr);
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
  }).catch(async (e) => {
    if (broken) {
      const name = path.basename(videoFilePath);
      await addBlockedName(name);
      vidDeleteWithSidecars(videoFilePath);
      e.message += ` (not a readable video: deleted, ${name} blocked)`;
    }
    throw e;
  });
  const textCodecs = [
    "subrip",
    "ass",
    "ssa",
    "webvtt",
    "mov_text",
    "text",
    "srt",
  ];
  const textStreams = probeStreams.filter((s) => {
    const lang = (s.tags?.language || "").toLowerCase();
    return (
      s.codec_type === "subtitle" &&
      (lang === "eng" || lang === "en" || lang === "") &&
      textCodecs.includes(s.codec_name) &&
      s.disposition?.forced !== 1
    );
  });
  let extracted = 0;
  for (const s of textStreams) {
    const sdh =
      s.disposition?.hearing_impaired === 1 ||
      /\b(sdh|cc)\b/i.test(s.tags?.title || "");
    const outPath = `${base}.${sdh ? "H" : "T"}${s.index}.srt`;
    extracted++;
    // mb<n> is the name this copy went by before.
    if (fs.existsSync(outPath) || fs.existsSync(`${base}.mb${s.index}.srt`)) {
      if (fromUI) publishEmbLog(`exists: ${path.basename(outPath)}`);
      continue;
    }
    // A copy deleted as unusable or from another cut, or by a full vetting
    // under this version, is not made again.
    if (subs.misfitRemembered(outPath)) {
      if (fromUI) publishEmbLog(`skipped, a misfit: ${path.basename(outPath)}`);
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
              if (!err && stdout.includes("-->")) {
                fs.writeFileSync(outPath, cleanSrt(stdout), "utf8");
                if (fromUI) publishEmbLog(`extracted ${outPath}`);
              }
              resolve();
            },
          );
        }),
    );
  }
  syncBatchMsgs();
  return textStreams.length > 0;
}
// Add text as one of the video's S files: <base>.S<n>.srt, n one past the
// highest there. Text an S file already has is a second copy and is not added.
// Returns the new file's name, or null.
async function addSFile(videoFilePath, text) {
  const dir = path.dirname(videoFilePath);
  let maxN = 0;
  for (const s of subs.listSidecars(videoFilePath)) {
    const m = /^S(\d+)$/.exec(s.suffix);
    if (!m) continue;
    maxN = Math.max(maxN, Number(m[1]));
    const has = await fs.promises.readFile(path.join(dir, s.file), "utf8");
    if (has === text) return null;
  }
  const name = `${subs.videoStem(videoFilePath)}.S${maxN + 1}.srt`;
  await fs.promises.writeFile(path.join(dir, name), text, "utf8");
  return name;
}
// Subtitle files that arrived for the video's episode, under whatever names
// they came with, become its S files, sanitized.
async function renameSFiles(videoFilePath, season, episode) {
  const dir = path.dirname(videoFilePath);
  const stem = subs.videoStem(videoFilePath);
  const names = await fs.promises.readdir(dir);
  const otherStems = names
    .filter((n) => vidIsVideoName(n))
    .map((n) => subs.videoStem(n))
    .filter((s) => s !== stem);
  for (const name of names) {
    if (!name.endsWith(".srt") || name.startsWith(".")) continue;
    if (NAMED_SIDECAR_RE.test(name)) continue;
    const own = name === `${stem}.srt` || name.startsWith(`${stem}.`);
    // Another video's own subtitle file stays its own.
    if (!own && otherStems.some((o) => name.startsWith(`${o}.`))) continue;
    const se = parseFileSeasonEpisode(name, path.basename(dir));
    if (se?.season !== season || se?.episode !== episode) continue;
    const src = path.join(dir, name);
    const dstName = await addSFile(
      videoFilePath,
      cleanSrt(await fs.promises.readFile(src, "utf8")),
    );
    if (dstName)
      unilog(2685, `${showNameFromFilePath(videoFilePath)}: ${name} is now ${dstName}`);
    await fs.promises.unlink(src);
  }
}
// A full vetting waiting on this video's ASR, queued again once its
// transcript is stored.
function vetAgain(videoFilePath) {
  enqueueSubQueue(
    { videoFilePath, fromUI: false, lowPriority: false, vet: "full" },
    false,
  );
  persistSubQueue();
  doSubQueueNow();
}
// A complete ASR of the video: its `+` file, and its word-timed transcript
// stored for vetting (subs.saveTranscript). entry.vet: a full vetting waits
// on it, so it is made even over an old `+` file, unless the transcript is
// stored already, and the vetting is queued again once it is. entry.track:
// the audio track, else the English one (the first with none).
async function generateSrtWithAsr(entry) {
  const videoFilePath = entry.videoPath;
  const fromUI = entry.fromUI;
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
  const track =
    entry.track ?? Math.max(0, englishTrack((await videoInfo(videoFilePath)).audioLangs));
  if (entry.vet ? subs.getTranscript(videoFilePath, track) : fs.existsSync(srtPath)) {
    subsState.asrLogBuffer = [];
    appendAsrLog(
      `=== Skipped: ${path.basename(videoFilePath)} (${entry.vet ? "transcript" : "srt"} already exists) ===`,
    );
    unilog(12, `asr skip exists: ${videoFilePath}`);
    if (entry.vet) vetAgain(videoFilePath);
    return;
  }
  const wordsPath = path.join(os.tmpdir(), `asr-words-${process.pid}-${Date.now()}.json`);
  subsState.asrLogBuffer = [];
  appendAsrLog("");
  appendAsrLog(`=== Queued: ${path.basename(videoFilePath)} ===`);
  unilog(14, `asr start: ${videoFilePath}`);
  subsState.genSrtRunning = true;
  subsState.genSrtAborting = false;
  subsState.asrStartedAt = Date.now();
  subsState.asrStage = "starting";
  subsState.asrTotalDur = 0;
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
        [
          ...BATCH_SCHED.slice(1),
          "node",
          ASR_JS_PATH,
          videoFilePath,
          JSON.stringify(asrVocabForShow(showNameFromFilePath(videoFilePath))),
          String(track),
          wordsPath,
        ],
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
        if (subsState.genSrtAborting) reject(new Error(`__cancelled__`));
        else if (code === 0) resolve();
        else if (code === null) reject(new Error(`__cancelled__`));
        else reject(new Error(`asr.js exited ${code}`));
      });
    });
    unilog(15, `asr done: ${videoFilePath}`);
    subs.saveTranscript(
      videoFilePath,
      track,
      JSON.parse(await fs.promises.readFile(wordsPath, "utf8")),
    );
    appendAsrLog(`=== Done: ${path.basename(videoFilePath)} ===`);
    if (entry.vet) vetAgain(videoFilePath);
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
    await fs.promises.rm(wordsPath, { force: true });
    subsState.genSrtRunning = false;
    subsState.genSrtChild = null;
    subsState.genSrtAborting = false;
    subsState.asrStage = null;
    syncBatchMsgs();
    publishAsrQueueUpdate({ running: false });
  }
}
// Character names from the show's tvdb record, for Speechmatics
// additional_vocab. "Dr. Owen Maestro / Rob Huebel" yields the full names
// plus each name word, so both "Owen" and "Maestro" are boosted.
const VOCAB_TITLES = new Set(["dr", "nurse", "lt", "mr", "mrs", "ms"]);
function asrVocabForShow(showName) {
  const rec = tvdb.getAllTvdbSync?.()?.[showName];
  const terms = new Set();
  for (const char of rec?.characters || []) {
    for (const name of (char.character || "").split("/")) {
      const words = name
        .trim()
        .split(/\s+/)
        .filter((w) => w && !VOCAB_TITLES.has(w.toLowerCase().replace(".", "")));
      if (!words.length) continue;
      terms.add(words.join(" "));
      for (const w of words) if (w.length > 2) terms.add(w);
    }
  }
  return [...terms];
}

// Stop the running asr.js. It kills its own ffmpeg children on SIGTERM,
// so the whole tree goes down; the queue then moves on to the next entry.
function abortAsr() {
  const child = subsState.genSrtChild;
  if (!subsState.genSrtRunning || !child) {
    return { ok: false, error: "no ASR job is running" };
  }
  subsState.genSrtAborting = true;
  appendAsrLog("=== Abort requested ===");
  child.kill("SIGTERM");
  unilog(2289, `asr abort requested for ${path.basename(subsState.asrQueue[0]?.videoPath || "unknown")}`);
  return { ok: true };
}

// Queues pane's Clear: drop every waiting entry; a running one finishes.
function clearSubQueue() {
  subsState.subQueue = subsState.subQueue.filter(
    (e) => e.videoFilePath === subsState.currentlyProcessingSubPath,
  );
  subsState.subAgain = null;
  persistSubQueue();
  syncBatchMsgs();
}
function clearAsrQueue() {
  subsState.asrQueue.splice(subsState.genSrtRunning ? 1 : 0);
  persistAsrQueue();
  publishAsrQueueUpdate();
  syncBatchMsgs();
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
// A full vetting that needs the video's complete ASR queues it. Nothing is
// added for a video already waiting.
function queueVetAsr(videoFilePath, showName, season, episode, { track }) {
  if (subsState.asrQueue.some((e) => e.videoPath === videoFilePath)) return;
  addToAsrQueue([
    {
      videoPath: videoFilePath,
      showName,
      season: season ?? 0,
      episode: episode ?? 0,
      fromUI: false,
      lowPriority: false,
      vet: true,
      track,
      source: "subtitle vetting",
      addedAt: Date.now(),
    },
  ]);
}
// What a video gets when it lands on disk, or when the sweep or the local
// pane's Subs button names it: its text tracks copied out, new subtitle files
// named and glued words split (subGlue.js). An entry marked vet ("full" or
// "cheap", from the per-show step or the end of a watch) is vetted after
// them (subVet.js); a cheap one of a video already through them skips them,
// as cheap vetting cleans every file itself.
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
  // safe: every step skips what is already there.
  // The sweep's entries come after all other batch work: while stills, a
  // recode or ASR is running or queued, only the others are taken. One already
  // running carries on to its end.
  const othersBusy =
    stillsBusy() ||
    getRecodePending().length > 0 ||
    subsState.genSrtRunning ||
    subsState.asrQueue.length > 0;
  const entry = othersBusy
    ? subsState.subQueue.find((e) => !e.lowPriority)
    : subsState.subQueue[0];
  if (!entry) return;
  const videoFilePath = entry.videoFilePath;
  subsState.subQueueBusy = true;
  subsState.currentlyProcessingSubPath = videoFilePath;
  subsState.subStartedAt = Date.now();
  subsState.subStage = "starting";
  try {
    // The file can vanish between enqueue and now — most often a duplicate
    // lower-resolution download that was deleted.
    if (!fs.existsSync(videoFilePath)) {
      unilog(
        1401,
        `dropping sub queue entry, file gone: ${videoFilePath}`,
      );
      return;
    }
    if (videoFilePath.startsWith(moviesDir + "/")) {
      unilog(2681, `movies get no subtitle processing: ${videoFilePath}`);
      return;
    }
    const parsed = parseFileSeasonEpisode(videoFilePath);
    const showName = showNameFromFilePath(videoFilePath);
    const rec = tvdb.getAllTvdbSync?.()?.[showName];
    const season = parsed?.season;
    const episode = parsed?.episode;
    const isEpisode = Number.isInteger(season) && Number.isInteger(episode);
    // The video is another file under the same name (rewritten in place):
    // what was learned about the old one goes, and so do the copies of its
    // embedded tracks, which are taken again from this one. Its other
    // sidecars stay, to be judged against it like any others.
    if (entry.replaced) {
      subs.forgetVideo(videoFilePath);
      subs.unmarkProcessed(videoFilePath);
      for (const s of subs.listSidecars(videoFilePath))
        if (s.type === "T" || s.type === "H")
          await fs.promises.unlink(path.join(path.dirname(videoFilePath), s.file));
    }
    const addToDisk = !(entry.vet === "cheap" && subs.isProcessed(videoFilePath));
    if (addToDisk) {
      await extractEmbSrts(videoFilePath, entry.fromUI);
      if (isEpisode && entry.renameS) {
        setSubStage("naming subtitle files");
        await renameSFiles(videoFilePath, season, episode);
      }
      setSubStage("splitting glued words");
      await fixGluedSidecars(videoFilePath);
      subs.markProcessed(videoFilePath);
    }
    // A vetting whose search or download fails throws: the episode is not
    // marked vetted, and its show's next update queues it again.
    if (entry.vet) {
      setSubStage(`${entry.vet} subtitle vetting`);
      const vetted = await vetVideo({
        videoPath: videoFilePath,
        level: entry.vet,
        showName,
        rec,
        season,
        episode,
        setStage: setSubStage,
      });
      if (vetted.needsAsr) queueVetAsr(videoFilePath, showName, season, episode, vetted);
    }
  } catch (e) {
    // A failed fetch says only "fetch failed"; what went wrong is in its cause.
    const cause = e.cause ? ` (${e.cause.code || e.cause.message})` : "";
    unilog(2814, `${showNameFromFilePath(videoFilePath)}: subtitle steps of ${path.basename(videoFilePath)} failed at "${subsState.subStage}": ${e.message}${cause}`);
  } finally {
    // However it ended, the local pane is waiting to hear the file is done.
    if (entry.fromUI)
      publishSubsProgress({ path: videoFilePath, status: "done" });
    // Matched by path, not by index: an enqueue during the run can unshift
    // ahead of this entry, so the head is not necessarily still it.
    const idx = subsState.subQueue.findIndex(
      (e) => e.videoFilePath === videoFilePath,
    );
    if (idx !== -1) subsState.subQueue.splice(idx, 1);
    // Asked for again during the run: queued once more.
    const again = subsState.subAgain;
    subsState.subAgain = null;
    if (again) {
      if (again.lowPriority) subsState.subQueue.push(again);
      else subsState.subQueue.unshift(again);
      syncBatchMsgs();
    }
    if (idx !== -1 || again) persistSubQueue();
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
      // The steps' own errors are logged inside it; one that lands here came
      // from outside them.
      await processSubQueueEntry().catch((e) => {
        const cause = e.cause ? ` (${e.cause.code || e.cause.message})` : "";
        unilog(2820, `${e.message}${cause}`);
      });
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
      generateSrtWithAsr(entry)
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

// ---- Queues pane ----------------------------------------------------------

// Flat whole-run estimate: a run is dominated by the upload plus the remote
// batch job, together roughly 20s for a 20-minute episode and ~2 min for a
// 45-minute one.
const ASR_RUN_SECS = 60;

// Seconds left on the running ASR job. The transcription job is opaque —
// nothing reports position within the audio while it runs — so this is a
// flat estimate counting down from the start, not measured progress.
function asrRemainingSecs() {
  if (!subsState.genSrtRunning) return 0;
  const elapsed = (Date.now() - subsState.asrStartedAt) / 1000;
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
  persistAsrQueue,
  appendAsrLog,
  appendAsrTail,
  addToAsrQueue,
  enqueueSubQueue,
  loadQueues,
  sweepWantsVideo,
  extractEmbSrts,
  generateSrtWithAsr,
  abortAsr,
  clearSubQueue,
  clearAsrQueue,
  doSubQueueNow,
  processSubQueueEntry,
  startSubQueueLoop,
  startAsrQueueLoop,
};
