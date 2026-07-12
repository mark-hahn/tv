// mpfour — persistent seekable-mp4 mirrors of chksrt-queue videos.
//
// The chksrt video pane streams through /api/stream; non-mp4 sources arrive as
// a live fMP4 pipe with no Range support, so seeking must wait for the linear
// buffer. This module pre-encodes every file in subQueueChkSrt into an
// h264/aac +faststart mp4 under /mnt/media/mpfour — a tree mirroring
// /mnt/media/tv that emby never scans and nginx serves with Range support —
// letting the player jump anywhere instantly. h264 sources are remuxed
// (-c:v copy, lossless); hevc is transcoded. Mirrors are kept forever — even
// after the original is deleted — so chksrt can be re-run at any time; a
// sidecar .src.json records the original's mtime/size so a replaced release
// re-encodes.
//
// This runs on its own loop, deliberately NOT on the shared serialized
// ffmpegQueue (batchQueue.js) — chksrt playback is needed before other recoding
// work and must not sit behind long re-encode/BIF jobs. The same loop keeps
// hevc (slow-transcode) entries at the tail of subQueueChkSrt.

import fs from "fs";
import fsp from "fs/promises";
import * as cp from "child_process";
import * as path from "node:path";
import { logHere, unilog} from "@tv/share"
import { subsState, persistSubQueueChkSrt } from "./subsQueue.js";

const TV_DIR = "/mnt/media/tv";
const MPFOUR_DIR = "/mnt/media/mpfour";
const SCAN_INTERVAL_MS = 5_000;
const FAIL_RETRY_MS = 60 * 60 * 1000;

let busy = false;
let reordering = false;
let currentTmpPath = null;
// { videoFilePath, child, aborted } while an encode is running, else null
let currentEncode = null;
let syncBatchMsgs = () => {};
const failedAt = new Map(); // videoFilePath -> last failure timestamp
// videoFilePath -> { mtimeMs, size, videoCodec, audioCodec } — avoids
// re-probing every entry on every 5s scan.
const codecCache = new Map();

// Mirror path for a tv-library video, or null when the path is outside the
// tv tree (movies etc. never get mirrors).
export function mpfourPathFor(videoFilePath) {
  const resolved = path.resolve(videoFilePath);
  if (!resolved.startsWith(TV_DIR + "/")) return null;
  const rel = resolved.slice(TV_DIR.length + 1);
  return path.join(MPFOUR_DIR, rel.replace(/\.[^.]+$/, "") + ".mp4");
}

function sidecarPathFor(mirrorPath) {
  return mirrorPath + ".src.json";
}

// Returns the mirror path when it exists and its sidecar still matches the
// original's mtime+size; null otherwise (missing, stale, or non-tv path).
export async function mpfourValid(videoFilePath) {
  const mirror = mpfourPathFor(videoFilePath);
  if (!mirror) return null;
  try {
    const [srcStat, sidecarRaw] = await Promise.all([
      fsp.stat(path.resolve(videoFilePath)),
      fsp.readFile(sidecarPathFor(mirror), "utf8"),
    ]);
    const sidecar = JSON.parse(sidecarRaw);
    if (sidecar.mtimeMs !== srcStat.mtimeMs || sidecar.size !== srcStat.size)
      return null;
    await fsp.access(mirror);
    return mirror;
  } catch {
    return null;
  }
}

function ffprobeCodecs(videoFilePath) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        videoFilePath,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const streams = JSON.parse(stdout).streams || [];
        resolve({
          videoCodec: streams.find((s) => s.codec_type === "video")
            ?.codec_name,
          audioCodec: streams.find((s) => s.codec_type === "audio")
            ?.codec_name,
        });
      },
    );
  });
}

// Cached codecs, invalidated when the original's mtime/size changes.
async function getCodecs(videoFilePath) {
  const stat = await fsp.stat(videoFilePath);
  const hit = codecCache.get(videoFilePath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
  const codecs = await ffprobeCodecs(videoFilePath);
  const entry = { mtimeMs: stat.mtimeMs, size: stat.size, ...codecs };
  codecCache.set(videoFilePath, entry);
  return entry;
}

// h264 sources are remuxed (seconds); anything else (hevc) needs a full
// transcode (many minutes).
async function needsTranscode(videoFilePath) {
  const { videoCodec } = await getCodecs(videoFilePath);
  return videoCodec !== "h264";
}

// Keep files that need a slow transcode at the tail of subQueueChkSrt, so the
// files you review first are the ones already mirrored (or quick to mirror) and
// the hevc encodes get more time to finish before you reach them. Stable within
// each group, so a newly-added hevc file still lands behind the fast ones.
async function reorderChkSrtQueue() {
  const queue = subsState.subQueueChkSrt;
  if (queue.length < 2) return;
  const fast = [];
  const slow = [];
  for (const entry of queue) {
    const videoFilePath = entry?.videoFilePath;
    let slowOne = false;
    if (videoFilePath && fs.existsSync(videoFilePath)) {
      try {
        slowOne = await needsTranscode(videoFilePath);
      } catch (e) {
        unilog(1413, `probe failed for ${path.basename(videoFilePath)}: ${e.message}`);
      }
    }
    (slowOne ? slow : fast).push(entry);
  }
  const next = [...fast, ...slow];
  if (next.every((entry, i) => entry === queue[i])) return; // already ordered
  subsState.subQueueChkSrt = next;
  persistSubQueueChkSrt();
  syncBatchMsgs();
  unilog(1414, `reordered chksrt queue: ${fast.length} ready/fast ahead of ${slow.length} needing transcode`);
}

function runFfmpeg(args, onSpawn) {
  return new Promise((resolve, reject) => {
    const ffmpeg = cp.spawn("ffmpeg", args);
    onSpawn?.(ffmpeg);
    let lastErr = "";
    ffmpeg.stderr.on("data", (d) => {
      lastErr = d.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${lastErr.slice(-300)}`));
    });
  });
}

// Called when a chksrt result is saved: the mirror for that file is no longer
// needed, so kill its ffmpeg if it happens to be the one running. A pending
// (not yet started) file needs nothing — the save already removed it from
// subQueueChkSrt, which is the only thing the encode loop draws from.
export function cancelEncode(videoFilePath) {
  const resolved = path.resolve(videoFilePath);
  if (!currentEncode || currentEncode.videoFilePath !== resolved) return false;
  currentEncode.aborted = true;
  currentEncode.child?.kill("SIGKILL");
  unilog(1416, `aborted encode, chksrt result saved: ${path.basename(resolved)}`);
  return true;
}

async function encodeOne(videoFilePath) {
  const mirror = mpfourPathFor(videoFilePath);
  const tmp = mirror.replace(/\.mp4$/, ".tmp.mp4");
  const startedAt = Date.now();
  const srcStat = await fsp.stat(videoFilePath);
  const { videoCodec, audioCodec } = await getCodecs(videoFilePath);
  const args = ["-y", "-i", videoFilePath, "-map", "0:v:0", "-map", "0:a:0?"];
  if (videoCodec === "h264") {
    args.push("-c:v", "copy");
  } else {
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
    );
  }
  if (audioCodec === "aac") {
    args.push("-c:a", "copy");
  } else {
    // -ac 2: downmix to stereo — browsers require stereo AAC
    args.push("-c:a", "aac", "-b:a", "128k", "-ac", "2");
  }
  args.push("-sn", "-dn", "-movflags", "+faststart", tmp);
  await fsp.mkdir(path.dirname(mirror), { recursive: true });
  currentTmpPath = tmp;
  currentEncode = {
    videoFilePath: path.resolve(videoFilePath),
    child: null,
    aborted: false,
  };
  try {
    try {
      await runFfmpeg(args, (child) => {
        currentEncode.child = child;
      });
    } catch (e) {
      // A kill from cancelEncode() is an intentional abort, not a failure —
      // rethrowing would mark the file failed and skip it for FAIL_RETRY_MS.
      if (currentEncode.aborted) return "aborted";
      throw e;
    }
    await fsp.rename(tmp, mirror);
    await fsp.writeFile(
      sidecarPathFor(mirror),
      JSON.stringify({
        src: path.resolve(videoFilePath),
        mtimeMs: srcStat.mtimeMs,
        size: srcStat.size,
      }),
      "utf8",
    );
  } finally {
    currentTmpPath = null;
    currentEncode = null;
    await fsp.rm(tmp, { force: true });
  }
  const secs = Math.round((Date.now() - startedAt) / 1000);
  const mode = videoCodec === "h264" ? "remux" : "transcode";
  unilog(1405, `${mode} done in ${secs}s: ${path.basename(mirror)}`);
  return "done";
}

async function nextNeedingEncode() {
  for (const entry of subsState.subQueueChkSrt) {
    const videoFilePath = entry?.videoFilePath;
    if (!videoFilePath) continue;
    if (!mpfourPathFor(videoFilePath)) continue;
    const failed = failedAt.get(videoFilePath);
    if (failed && Date.now() - failed < FAIL_RETRY_MS) continue;
    if (!fs.existsSync(videoFilePath)) continue;
    if (await mpfourValid(videoFilePath)) continue;
    return videoFilePath;
  }
  return null;
}

async function scanPass() {
  // Reorder on every tick, even while an encode is running — a file added
  // during a long transcode must still be sorted into place promptly.
  if (!reordering) {
    reordering = true;
    try {
      await reorderChkSrtQueue();
    } finally {
      reordering = false;
    }
  }
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const videoFilePath = await nextNeedingEncode();
      if (!videoFilePath) break;
      try {
        await encodeOne(videoFilePath);
        failedAt.delete(videoFilePath);
      } catch (e) {
        failedAt.set(videoFilePath, Date.now());
        unilog(1406, `encode failed for ${path.basename(videoFilePath)}: ${e.message}`);
      }
    }
  } finally {
    busy = false;
  }
}

// Mirrors are never removed — they persist so chksrt can be re-run at any time,
// even after the original is deleted. The only cleanup is .tmp.mp4 left behind
// by an encode that was killed mid-write (e.g. a pm2 restart), done once at
// startup while nothing of ours is running.
async function removeStaleTmpFiles() {
  let entries;
  try {
    entries = await fsp.readdir(MPFOUR_DIR, {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    return; // mirror tree doesn't exist yet
  }
  let removed = 0;
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".tmp.mp4")) continue;
    await fsp.rm(path.join(ent.parentPath, ent.name), { force: true });
    removed++;
  }
  if (removed > 0) {
    unilog(1407, `removed ${removed} stale tmp file(s) from a killed encode`);
  }
}

export function start(deps) {
  if (deps?.syncBatchMsgs) syncBatchMsgs = deps.syncBatchMsgs;
  fs.mkdirSync(MPFOUR_DIR, { recursive: true });
  removeStaleTmpFiles().catch((e) => {
    unilog(1408, `tmp cleanup error: ${e.message}`);
  });
  setInterval(() => {
    scanPass().catch((e) => {
      unilog(1409, `scan error: ${e.message}`);
    });
  }, SCAN_INTERVAL_MS);
}
