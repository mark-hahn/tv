// recode — replaces library videos the tv's player cannot handle with h264 mkv.
//
// The Bravia's Emby player stalls on some mpeg4-ASP files: it holds the stream
// open, its receive window fills, and it reports unpause ~17x a second while the
// picture freezes and the audio cuts. The same player is flawless on h264, so
// the fix is to stop shipping it those files at all. Detection is by codec tag,
// not codec name — DX50 (DivX 5) stalls where XVID, the same `mpeg4` codec,
// plays fine.
//
// Unlike mpfour.js, which writes throwaway mirrors into a parallel tree, this
// replaces the library file. That makes every step conservative: the encode
// lands in a staging tree outside /mnt/media/tv so the file watcher never sees
// a half-written file, the output is decoded end to end before anything moves,
// and the original is moved aside rather than deleted. Originals are purged a
// month later by oldFiles.js.
//
// Runs on its own loop, like mpfour and for the same reason: a full transcode
// must not sit in front of subtitle extraction. BATCH_SCHED keeps it off the
// cores that live streaming and Emby transcodes want.

import fs from "fs";
import fsp from "fs/promises";
import * as cp from "child_process";
import * as path from "node:path";
import { logHere, unilog} from "@tv/share"
import { BATCH_SCHED } from "./batchQueue.js";
import * as urls from "./urls.js";

const TV_DIR = "/mnt/media/tv";
const STAGE_DIR = "/mnt/media/recode-stage";
export const RECODE_ORIGINALS_DIR = "/mnt/media/tv-recode-originals";
// Written beside each moved original: what it was, where it went, and when.
// The purge dates originals from this file and skips any original without one,
// so a file whose age cannot be established is never deleted.
export const RECODE_SIDECAR_SUFFIX = ".recode.json";

const SCAN_INTERVAL_MS = 5_000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const FAIL_RETRY_MS = 60 * 60 * 1000;

// Video codec tags the tv's player stalls on. Tags, not codec names: XVID and
// DX50 are both `mpeg4` and only one of them is a problem. Everything here is
// a DivX-lineage tag from the same era.
const RECODE_VIDEO_TAGS = new Set(["DX50", "DIV3", "DIV4", "DIVX", "MP43", "MP42"]);

// Only these containers are probed. Every tag above is an AVI-era fourcc, and
// this is what keeps the hourly sweep from ffprobing a twelve-thousand-file
// library: it looks at the few dozen files that could possibly match instead.
// A DivX stream inside an mkv would slip past, which has never happened here
// and would show up as the same stall symptom if it ever did.
const RECODE_SOURCE_EXTS = new Set(["avi", "divx"]);

// x264 settings. These sources are SD and short, so `slow` costs about two
// minutes an episode and buys back the quality a second generation of lossy
// encoding would otherwise lose.
const X264_PRESET = "slow";
const X264_CRF = "20";
const AAC_BITRATE = "192k";

// Wall-clock per second of source, measured on the Kiss Me Kate season 3 pass:
// 1698s of 640x480 took 113s. Scaled by pixel count for anything larger, which
// is the only term that moves much at a fixed preset.
const EST_SECS_PER_SRC_SEC_SD = 0.067;
const SD_PIXELS = 640 * 480;

let busy = false;
let queue = []; // videoFilePaths awaiting a recode, in order; head may be running
let currentRecode = null; // { videoFilePath, child, startedAt, progressSecs, durationSecs }
let deferredPath = null; // file skipped because it is playing, to log it once
const failedAt = new Map(); // videoFilePath -> last failure timestamp
// videoFilePath -> { mtimeMs, size, tag, durationSecs } — avoids re-probing the
// whole library on every hourly sweep.
const probeCache = new Map();

function ffprobe(videoFilePath) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        videoFilePath,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const parsed = JSON.parse(stdout);
        const video = (parsed.streams || []).find(
          (s) => s.codec_type === "video",
        );
        resolve({
          tag: video?.codec_tag_string ?? "",
          width: Number(video?.width) || 0,
          height: Number(video?.height) || 0,
          durationSecs: Number(parsed.format?.duration) || 0,
        });
      },
    );
  });
}

// Cached probe, invalidated when the file's mtime/size changes.
async function getProbe(videoFilePath) {
  const stat = await fsp.stat(videoFilePath);
  const hit = probeCache.get(videoFilePath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
  const probed = await ffprobe(videoFilePath);
  const entry = { mtimeMs: stat.mtimeMs, size: stat.size, ...probed };
  probeCache.set(videoFilePath, entry);
  return entry;
}

// True when this file's video tag is one the tv chokes on. The only policy
// question in the module — everything else keys off this answer.
export async function matchesRecodePolicy(videoFilePath) {
  const resolved = path.resolve(videoFilePath);
  if (!resolved.startsWith(TV_DIR + "/")) return false;
  const ext = path.extname(resolved).slice(1).toLowerCase();
  if (!RECODE_SOURCE_EXTS.has(ext)) return false;
  try {
    const { tag } = await getProbe(resolved);
    return RECODE_VIDEO_TAGS.has(tag.toUpperCase());
  } catch (e) {
    unilog(2254, `probe failed for ${path.basename(resolved)}: ${e.message}`);
    return false;
  }
}

// Where the recoded file lands, and where the original is parked.
function outputPathFor(videoFilePath) {
  return videoFilePath.replace(/\.[^.]+$/, "") + ".mkv";
}

function stagePathFor(videoFilePath) {
  const rel = path.resolve(videoFilePath).slice(TV_DIR.length + 1);
  return path.join(STAGE_DIR, rel.replace(/\.[^.]+$/, "") + ".mkv");
}

function originalPathFor(videoFilePath) {
  const rel = path.resolve(videoFilePath).slice(TV_DIR.length + 1);
  return path.join(RECODE_ORIGINALS_DIR, rel);
}

// The tv keeps a file open for the whole episode, so recoding one that is on
// screen would pull it out from under the player. Emby's session list carries
// the real path of whatever each device is playing, which is the direct answer.
async function isPlayingNow(videoFilePath) {
  const resolved = path.resolve(videoFilePath);
  const resp = await fetch(urls.watchingUrl());
  if (resp.status !== 200)
    throw new Error(`emby sessions ${resp.status} ${resp.statusText}`);
  const sessions = await resp.json();
  return (sessions || []).some(
    (s) => s?.NowPlayingItem?.Path && path.resolve(s.NowPlayingItem.Path) === resolved,
  );
}

// ffmpeg under BATCH_SCHED, reporting content-seconds written so the ETA is a
// measurement rather than an estimate once the first status line lands.
function runFfmpeg(args, onSpawn, onProgress) {
  return new Promise((resolve, reject) => {
    const [cmd, ...prefix] = BATCH_SCHED;
    const child = cp.spawn(cmd, [...prefix, "ffmpeg", ...args]);
    onSpawn?.(child);
    let lastErr = "";
    child.stderr.on("data", (d) => {
      const chunk = d.toString();
      const all = chunk.match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g);
      if (all && onProgress) {
        const last = all[all.length - 1].match(
          /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/,
        );
        onProgress(+last[1] * 3600 + +last[2] * 60 + parseFloat(last[3]));
      }
      // Status lines would otherwise be the last thing seen and would become
      // the message of a failure they say nothing about.
      if (!all) lastErr = chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${lastErr.slice(-300)}`));
    });
  });
}

// Decode the finished encode end to end. It is the only thing standing between
// a bad encode and an original that has already been moved aside, and at SD it
// costs a few seconds.
function verifyDecodes(filePath) {
  return new Promise((resolve, reject) => {
    const [cmd, ...prefix] = BATCH_SCHED;
    const child = cp.spawn(cmd, [
      ...prefix,
      "ffmpeg",
      "-v",
      "error",
      "-i",
      filePath,
      "-f",
      "null",
      "-",
    ]);
    let errText = "";
    child.stderr.on("data", (d) => {
      errText += d.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 && !errText.trim()) resolve();
      else
        reject(
          new Error(`verify failed (exit ${code}): ${errText.slice(-300)}`),
        );
    });
  });
}

async function recodeOne(videoFilePath) {
  const startedAt = Date.now();
  const stage = stagePathFor(videoFilePath);
  const output = outputPathFor(videoFilePath);
  const original = originalPathFor(videoFilePath);
  const { durationSecs } = await getProbe(videoFilePath);
  const showName = path.basename(path.dirname(path.dirname(videoFilePath)));

  if (await isPlayingNow(videoFilePath)) {
    // The deferral is re-tested every scan tick for as long as the episode is
    // on screen, so it is logged only when the file being deferred changes.
    if (deferredPath !== videoFilePath) {
      deferredPath = videoFilePath;
      unilog(2255, `${showName}: ${path.basename(videoFilePath)} is playing, deferring recode`);
    }
    return "deferred";
  }
  deferredPath = null;

  // -v error keeps the log quiet, but -stats is what keeps ffmpeg printing the
  // `time=` line the progress reader needs; without it the pane shows an encode
  // stuck at "starting" for its whole run.
  const args = [
    "-y",
    "-v",
    "error",
    "-stats",
    "-i",
    videoFilePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    X264_PRESET,
    "-crf",
    X264_CRF,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    AAC_BITRATE,
    "-ac",
    "2",
    "-sn",
    "-dn",
    stage,
  ];

  await fsp.mkdir(path.dirname(stage), { recursive: true });
  currentRecode = {
    videoFilePath: path.resolve(videoFilePath),
    child: null,
    startedAt,
    progressSecs: 0,
    durationSecs,
  };
  try {
    await runFfmpeg(
      args,
      (child) => {
        currentRecode.child = child;
      },
      (secs) => {
        if (currentRecode) currentRecode.progressSecs = secs;
      },
    );
    await verifyDecodes(stage);
    // Original out of the library first: leaving both in the season folder,
    // even briefly, is what makes the duplicate-episode reconciler pick one.
    await fsp.mkdir(path.dirname(original), { recursive: true });
    await fsp.rename(videoFilePath, original);
    await fsp.writeFile(
      original + RECODE_SIDECAR_SUFFIX,
      JSON.stringify({
        original: path.resolve(videoFilePath),
        recoded: output,
        recodedAt: Date.now(),
      }),
      "utf8",
    );
    await fsp.rename(stage, output);
  } finally {
    await fsp.rm(stage, { force: true });
    currentRecode = null;
  }
  const secs = Math.round((Date.now() - startedAt) / 1000);
  const outSize = (await fsp.stat(output)).size;
  unilog(2256, `${showName}: recoded ${path.basename(videoFilePath)} to mkv in ${secs}s (${(outSize / 1e6).toFixed(0)} MB)`);
  return "done";
}

// True when this file still wants a recode: on disk, matching the tag policy,
// and not inside its failure cooldown.
async function needsRecode(videoFilePath) {
  if (!videoFilePath) return false;
  const failed = failedAt.get(videoFilePath);
  if (failed && Date.now() - failed < FAIL_RETRY_MS) return false;
  if (!fs.existsSync(videoFilePath)) return false;
  return await matchesRecodePolicy(videoFilePath);
}

// Put a file at the head of the queue. Called by the file watcher the moment a
// download lands, so a new file is recoded before anything else looks at it.
export async function enqueueRecode(videoFilePath) {
  const resolved = path.resolve(videoFilePath);
  if (queue.includes(resolved)) return false;
  if (!(await needsRecode(resolved))) return false;
  queue.push(resolved);
  const showName = path.basename(path.dirname(path.dirname(resolved)));
  unilog(2257, `${showName}: queued ${path.basename(resolved)} for recode`);
  return true;
}

// Backstop for the watcher, the same shape the subtitle queue has one for: the
// watcher is a single gate on the only path in, and a walk of the library owes
// nothing to any lookup being right. Also how files already on disk when this
// shipped get picked up.
async function sweepLibrary() {
  let showDirs;
  try {
    showDirs = await fsp.readdir(TV_DIR, { withFileTypes: true });
  } catch (e) {
    unilog(2258, `library sweep failed: ${e.message}`);
    return;
  }
  let added = 0;
  for (const showEnt of showDirs) {
    if (!showEnt.isDirectory()) continue;
    const showDir = path.join(TV_DIR, showEnt.name);
    let seasons;
    try {
      seasons = await fsp.readdir(showDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const seasonEnt of seasons) {
      if (!seasonEnt.isDirectory()) continue;
      const seasonDir = path.join(showDir, seasonEnt.name);
      let files;
      try {
        files = await fsp.readdir(seasonDir);
      } catch {
        continue;
      }
      for (const name of files) {
        const full = path.join(seasonDir, name);
        if (queue.includes(full)) continue;
        if (await enqueueRecode(full)) added++;
      }
    }
  }
  if (added > 0)
    unilog(2259, `library sweep queued ${added} file(s) for recode`);
}

// Seconds this file is expected to take once it starts. Zero until the file has
// been probed, which every queued file has been -- enqueueRecode probes to
// decide whether to queue it at all.
function estimateSecs(videoFilePath) {
  const cached = probeCache.get(videoFilePath);
  if (!cached) return 0;
  const pixels = (cached.width || 640) * (cached.height || 480);
  return Math.round(
    cached.durationSecs * EST_SECS_PER_SRC_SEC_SD * (pixels / SD_PIXELS),
  );
}

// Seconds left on the running encode: measured from content-seconds written per
// wall-second once ffmpeg has said anything, estimated before that.
function remainingSecs() {
  if (!currentRecode) return 0;
  const elapsed = (Date.now() - currentRecode.startedAt) / 1000;
  const done = currentRecode.progressSecs;
  const total = currentRecode.durationSecs;
  if (done > 0 && elapsed > 0 && total > 0) {
    const rate = done / elapsed;
    return Math.max(0, Math.round((total - done) / rate));
  }
  return Math.max(
    0,
    Math.round(total * EST_SECS_PER_SRC_SEC_SD - elapsed),
  );
}

// Live backlog for the header message.
export function getRecodePending() {
  return queue;
}

// Queue contents for the Queues pane, same shape as the mp4 queue: every
// pending file in encode order with the wall-clock time it should finish, plus
// live detail on the one running.
export async function getRecodeQueueStatus() {
  const running = currentRecode;
  let eta = Date.now();
  const entries = [];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    const isRunning = !!running && running.videoFilePath === p;
    const secs = isRunning ? remainingSecs() : estimateSecs(p);
    eta += secs * 1000;
    entries.push({
      n: i + 1,
      file: path.basename(p),
      path: p,
      etaMs: eta,
      running: isRunning,
    });
  }
  const inflight = running
    ? {
        file: path.basename(running.videoFilePath),
        stage:
          running.progressSecs > 0 && running.durationSecs > 0
            ? `recoding ${Math.min(100, Math.round((running.progressSecs / running.durationSecs) * 100))}%`
            : "recoding, starting",
        remainingSecs: remainingSecs(),
        elapsedSecs: Math.round((Date.now() - running.startedAt) / 1000),
      }
    : null;
  return { count: entries.length, inflight, entries };
}

async function scanPass() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const videoFilePath = queue[0];
      if (!videoFilePath) break;
      if (!(await needsRecode(videoFilePath))) {
        queue.shift();
        continue;
      }
      let result;
      try {
        result = await recodeOne(videoFilePath);
        failedAt.delete(videoFilePath);
      } catch (e) {
        failedAt.set(videoFilePath, Date.now());
        unilog(2260, `recode failed for ${path.basename(videoFilePath)}: ${e.message}`);
      }
      // A deferred file stays queued but must not spin: move it to the tail so
      // the rest of the backlog runs while that episode is still on screen.
      if (result === "deferred") {
        queue.push(queue.shift());
        break;
      }
      queue.shift();
    }
  } finally {
    busy = false;
  }
}

// A staged encode killed mid-write (a pm2 restart) leaves a file that would
// otherwise be trusted by the next pass, so the staging tree is emptied at
// startup while nothing of ours is running.
async function removeStaleStageFiles() {
  let entries;
  try {
    entries = await fsp.readdir(STAGE_DIR, {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    return; // staging tree doesn't exist yet
  }
  let removed = 0;
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    await fsp.rm(path.join(ent.parentPath, ent.name), { force: true });
    removed++;
  }
  if (removed > 0)
    unilog(2261, `removed ${removed} stale staged encode(s) from a killed recode`);
}

export function start() {
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  fs.mkdirSync(RECODE_ORIGINALS_DIR, { recursive: true });
  removeStaleStageFiles().catch((e) => {
    unilog(2262, `stage cleanup error: ${e.message}`);
  });
  sweepLibrary().catch((e) => {
    unilog(2263, `initial sweep error: ${e.message}`);
  });
  setInterval(() => {
    sweepLibrary().catch((e) => {
      unilog(2264, `sweep error: ${e.message}`);
    });
  }, SWEEP_INTERVAL_MS);
  setInterval(() => {
    scanPass().catch((e) => {
      unilog(2265, `scan error: ${e.message}`);
    });
  }, SCAN_INTERVAL_MS);
}
