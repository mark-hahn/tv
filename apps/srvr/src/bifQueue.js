// BIF sidecar-generation queue: the persisted "needs a .bif" queue, the
// single-worker create/cancel lifecycle (serialized through the shared batch
// ffmpeg queue), and the reaction to a show's needsIntro flag. This module owns
// its queue state; index.js injects syncBatchMsgs (which reads the getters
// below) to avoid an import cycle.

import fs from "fs";
import fsp from "fs/promises";
import * as cp from "child_process";
import * as path from "node:path";
import { unilog } from "@tv/share";
import * as epd from "@tv/share";
import { SRVR_ROOT_DIR, SRVR_DATA_DIR } from "./srvrPaths.js";
import { BATCH_SCHED, ffmpegQueue } from "./batchQueue.js";

const BIF_NEEDED_QUEUE_PATH = path.join(SRVR_DATA_DIR, "bifNeededQueue.json");
const BIF_CREATING_PATH = path.join(SRVR_DATA_DIR, "bifCreatingData.json");
const RUN_BIF_PATH = path.join(SRVR_ROOT_DIR, "scripts", "run-bif.js");

let bifNeededQueue = []; // [{ showName, bifPath }, ...] persisted
let bifCheckTimer = null; // single backoff timer handle
// Track current BIF show name since the entry is shifted before onDone fires.
let currentBifShowName = null;

// Injected by index.js (syncBatchMsgs reads getBifCount/getBifHeadName).
let syncBatchMsgs = () => {};
export function init(deps) {
  syncBatchMsgs = deps.syncBatchMsgs;
}

// Batch-status getters read by index.js syncBatchMsgs.
export function getBifCount() {
  return bifNeededQueue.length + (currentBifShowName ? 1 : 0);
}
export function getBifHeadName() {
  return currentBifShowName || bifNeededQueue[0]?.showName || "";
}
// Every show represented in the queue — the label appends "++" when >1.
export function getBifShowNames() {
  return [currentBifShowName, ...bifNeededQueue.map((e) => e.showName)];
}

export function loadBifNeededQueue() {
  try {
    const raw = JSON.parse(fs.readFileSync(BIF_NEEDED_QUEUE_PATH, "utf8"));
    bifNeededQueue = Array.isArray(raw) ? raw : [];
  } catch {
    bifNeededQueue = [];
  }
}

// Startup: clear any stale creating-lock (no worker survives a restart),
// restore the persisted queue, and resume processing.
export function resumeOnStartup() {
  try {
    fs.unlinkSync(BIF_CREATING_PATH);
  } catch {}
  loadBifNeededQueue();
  checkBifNeededQueue();
}
function persistBifNeededQueue() {
  try {
    fs.writeFileSync(
      BIF_NEEDED_QUEUE_PATH,
      JSON.stringify(bifNeededQueue),
      "utf8",
    );
  } catch (e) {
    unilog(509, "persist queue error:", e.message);
  }
}

// True when a pid is still alive (signal 0 probes without killing).
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists but not ours
  }
}

// Read the creating-lock file, or null when absent/invalid.
function readBifCreating() {
  try {
    return JSON.parse(fs.readFileSync(BIF_CREATING_PATH, "utf8"));
  } catch {
    return null;
  }
}

// Schedule a single (non-stacking) checkBifNeededQueue call.
function scheduleBifCheck(ms) {
  if (bifCheckTimer) clearTimeout(bifCheckTimer);
  bifCheckTimer = setTimeout(() => {
    bifCheckTimer = null;
    checkBifNeededQueue();
  }, ms);
}

// Pull the next bif spec off the queue and start generating it, with CPU
// backoff and one-at-a-time serialization.
export function checkBifNeededQueue() {
  if (bifNeededQueue.length === 0) return;
  const started = startBifCreate(bifNeededQueue[0]);
  if (!started) {
    scheduleBifCheck(5000);
    return;
  }
  bifNeededQueue.shift();
  persistBifNeededQueue();
  setImmediate(checkBifNeededQueue);
}

// Launch a background worker process that generates the .bif file. Returns
// true when a worker was launched, false when one is already running.
function startBifCreate(bifNeededObj) {
  const lock = readBifCreating();
  if (lock) {
    // Clear a stale lock left by a dead worker; otherwise honor it.
    if (pidAlive(lock.pid)) return false;
    unilog(3, `clearing stale lock (pid ${lock.pid} dead)`);
    try {
      fs.unlinkSync(BIF_CREATING_PATH);
    } catch {}
  }
  let child;
  try {
    child = cp.spawn(
      BATCH_SCHED[0],
      [...BATCH_SCHED.slice(1), "node", RUN_BIF_PATH, bifNeededObj.bifPath],
      {
        detached: true, // own process group so cancel can kill ffmpeg too
        stdio: "ignore",
      },
    );
  } catch (e) {
    unilog(510, "spawn error:", e.message);
    return false;
  }
  try {
    fs.writeFileSync(
      BIF_CREATING_PATH,
      JSON.stringify({
        showName: bifNeededObj.showName,
        pid: child.pid,
        bifPath: bifNeededObj.bifPath,
      }),
      "utf8",
    );
  } catch (e) {
    unilog(511, "lock write error:", e.message);
  }
  currentBifShowName = bifNeededObj.showName;
  syncBatchMsgs();
  // Hold the batch ffmpeg queue for the duration of the BIF child process so
  // BIF and other batch ffmpeg jobs (subtitle extraction, re-encode) never
  // run concurrently.
  ffmpegQueue.run(
    () =>
      new Promise((resolve) => {
        const onDone = () => {
          try {
            fs.unlinkSync(BIF_CREATING_PATH);
          } catch {}
          unilog(4, `bif done ${bifNeededObj.showName}`);
          currentBifShowName = null;
          syncBatchMsgs();
          checkBifNeededQueue();
          resolve();
        };
        child.on("exit", onDone);
        child.on("error", (e) => {
          unilog(512, `worker error ${bifNeededObj.showName}:`, e.message);
          onDone();
        });
      }),
  );
  child.unref();
  return true;
}

// Enqueue one or more video files for BIF generation, skipping any that are
// already queued, in-flight, or already have a .bif on disk. Returns the count
// actually added.
export async function enqueueBif(showName, paths) {
  const lock = readBifCreating();
  const inFlightPath = lock && pidAlive(lock.pid) ? lock.bifPath : null;
  let added = 0;
  for (const videoPath of paths) {
    if (!videoPath) continue;
    const base = path.basename(videoPath);
    if (bifNeededQueue.some((o) => o.bifPath === videoPath)) {
      unilog(48, `skip (queued) ${showName}: ${base}`);
      continue;
    }
    if (inFlightPath === videoPath) {
      unilog(49, `skip (in-flight) ${showName}: ${base}`);
      continue;
    }
    const parsed = path.parse(videoPath);
    const bifDiskPath = path.join(parsed.dir, `${parsed.name}-320-10.bif`);
    try {
      await fsp.access(bifDiskPath);
      unilog(50, `skip (on-disk) ${showName}: ${base}`);
      continue;
    } catch {
      /* not on disk */
    }
    bifNeededQueue.push({ showName, bifPath: videoPath });
    added++;
  }
  if (added > 0) {
    persistBifNeededQueue();
    unilog(51, `enqueued ${added} file(s) for ${showName}`);
    checkBifNeededQueue();
  }
  return added;
}

// Abort an in-flight bif generation for a show (and clear its lock).
export function cancelBifCreate(showName) {
  const lock = readBifCreating();
  if (!lock || lock.showName !== showName) return;
  try {
    process.kill(-lock.pid, "SIGTERM"); // kill the whole process group
  } catch {
    try {
      process.kill(lock.pid, "SIGTERM");
    } catch {}
  }
  try {
    fs.unlinkSync(BIF_CREATING_PATH);
  } catch {}
  unilog(5, `cancel ${showName} pid=${lock.pid}`);
  currentBifShowName = null;
  syncBatchMsgs();
}

// React to a show's needsIntro flipping. On true: maybe queue a bif. On false:
// cancel any in-flight/queued bif for the show.
export function handleNeedsIntroChange(showName, rec, needsIntro) {
  if (needsIntro) {
    // A .bif already exists somewhere in the show folder.
    if (epd.getBifEpisode(rec.episodeData) !== null) return;
    // Need at least one unwatched episode.
    let hasUnwatched = false;
    epd.forEachEpisode(rec.episodeData, (s, e) => {
      if (!epd.isWatched(rec.episodeData, s, e)) hasUnwatched = true;
    });
    if (!hasUnwatched) return;
    // Need at least one video file; capture the first file's path as bifPath.
    const fileSeasons = epd.seasonsWithFile(rec.episodeData);
    if (fileSeasons.length === 0) return;
    const showFolderName = showName.includes("/")
      ? showName
      : (rec.path || rec.emby?.path || showName).split("/").pop();
    let bifPath = null;
    for (const s of fileSeasons) {
      const season = rec.episodeData[s];
      for (let i = 0; i < season.length; i++) {
        if (epd.hasFile(rec.episodeData, s, i + 1)) {
          bifPath = epd.getFullPath(rec.episodeData, showFolderName, s, i + 1);
          break;
        }
      }
      if (bifPath) break;
    }
    if (!bifPath) return;
    // Dedupe: skip if this show is already queued.
    if (bifNeededQueue.some((o) => o.showName === showName)) return;
    bifNeededQueue.push({ showName, bifPath });
    persistBifNeededQueue();
    unilog(6, `queued ${showName} ${bifPath}`);
    syncBatchMsgs();
    checkBifNeededQueue();
  } else {
    cancelBifCreate(showName);
    const before = bifNeededQueue.length;
    bifNeededQueue = bifNeededQueue.filter((o) => o.showName !== showName);
    if (bifNeededQueue.length !== before) {
      persistBifNeededQueue();
      checkBifNeededQueue();
    }
  }
}
