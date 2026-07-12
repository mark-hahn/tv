// mpfour — persistent seekable-mp4 mirrors of chksrt-queue videos.
//
// The chksrt video pane streams through /api/stream; non-mp4 sources arrive as
// a live fMP4 pipe with no Range support, so seeking must wait for the linear
// buffer. This module pre-encodes every file in subQueueChkSrt into an
// h264/aac +faststart mp4 under /mnt/media/mpfour — a tree mirroring
// /mnt/media/tv that emby never scans and nginx serves with Range support —
// letting the player jump anywhere instantly. h264 sources are remuxed
// (-c:v copy, lossless); hevc is transcoded. Mirrors persist so chksrt can be
// re-run later; a sidecar .src.json records the original's path/mtime/size for
// staleness checks, and a daily sweep removes mirrors whose original is gone.
//
// This runs on its own single-file loop, deliberately NOT on the shared
// serialized ffmpegQueue (batchQueue.js) — chksrt playback is needed before
// other recoding work and must not sit behind long re-encode/BIF jobs.

import fs from "fs";
import fsp from "fs/promises";
import * as cp from "child_process";
import * as path from "node:path";
import { logHere, unilog} from "@tv/share"
import { subsState } from "./subsQueue.js";

const TV_DIR = "/mnt/media/tv";
const MPFOUR_DIR = "/mnt/media/mpfour";
const SCAN_INTERVAL_MS = 30_000;
const FAIL_RETRY_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let busy = false;
let currentTmpPath = null;
const failedAt = new Map(); // videoFilePath -> last failure timestamp

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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = cp.spawn("ffmpeg", args);
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

async function encodeOne(videoFilePath) {
  const mirror = mpfourPathFor(videoFilePath);
  const tmp = mirror.replace(/\.mp4$/, ".tmp.mp4");
  const startedAt = Date.now();
  const srcStat = await fsp.stat(videoFilePath);
  const { videoCodec, audioCodec } = await ffprobeCodecs(videoFilePath);
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
  try {
    await runFfmpeg(args);
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
    await fsp.rm(tmp, { force: true });
  }
  const secs = Math.round((Date.now() - startedAt) / 1000);
  const mode = videoCodec === "h264" ? "remux" : "transcode";
  unilog(1405, `${mode} done in ${secs}s: ${path.basename(mirror)}`);
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

// Remove mirrors whose original is gone, orphan sidecars, stale tmp files,
// and any empty directories left behind.
async function sweep() {
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
    if (!ent.isFile()) continue;
    const full = path.join(ent.parentPath, ent.name);
    if (full === currentTmpPath) continue;
    if (ent.name.endsWith(".tmp.mp4")) {
      await fsp.rm(full, { force: true });
      removed++;
      continue;
    }
    if (ent.name.endsWith(".src.json")) continue; // handled with its mp4
    if (!ent.name.endsWith(".mp4")) continue;
    let src = null;
    try {
      src = JSON.parse(await fsp.readFile(sidecarPathFor(full), "utf8")).src;
    } catch {
      // no readable sidecar -> orphan mirror
    }
    if (!src || !fs.existsSync(src)) {
      await fsp.rm(full, { force: true });
      await fsp.rm(sidecarPathFor(full), { force: true });
      removed++;
    }
  }
  // prune empty dirs (deepest first)
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(e.parentPath, e.name))
    .sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    try {
      await fsp.rmdir(dir);
    } catch {
      // not empty — keep
    }
  }
  if (removed > 0) {
    unilog(1407, `sweep removed ${removed} stale mirror file(s)`);
  }
}

export function start() {
  fs.mkdirSync(MPFOUR_DIR, { recursive: true });
  sweep().catch((e) => {
    unilog(1408, `sweep error: ${e.message}`);
  });
  setInterval(() => {
    scanPass().catch((e) => {
      unilog(1409, `scan error: ${e.message}`);
    });
  }, SCAN_INTERVAL_MS);
  setInterval(() => {
    sweep().catch((e) => {
      unilog(1410, `sweep error: ${e.message}`);
    });
  }, SWEEP_INTERVAL_MS);
}
