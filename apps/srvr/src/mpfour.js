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
// Mirrors only back chksrt subtitle review, never full playback, so 10 minutes
// is plenty to check sync — cutting encodes short here saves real time on hevc.
const MIRROR_MAX_SECS = 600;

let busy = false;
let reordering = false;
// videoFilePaths still awaiting a mirror, in encode order.
let mp4Pending = [];
// Episodes the intro flow opens, newest first. Encoded ahead of the chksrt
// queue: intro is interactive (someone is watching a "Waiting for video"
// overlay) while chksrt is batch work nobody waits on. Kept as a separate list
// rather than reordering subQueueChkSrt so it cannot fight reorderChkSrtQueue's
// hevc-to-tail policy — which would otherwise push exactly the slow encodes
// intro cares about most to the back.
let introPriority = [];
// Supplies the intro episode of every chksrt-queued show, so one mirror serves
// both features. Injected by index.js, which owns the tvdb records.
let introEpisodePaths = () => [];
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

function wantedByChkSrt(resolved) {
  return subsState.subQueueChkSrt.some(
    (e) => e?.videoFilePath && path.resolve(e.videoFilePath) === resolved,
  );
}

// Kill the running encode only when neither consumer still wants the mirror.
// Two features share one mirror now, so either dropping its claim must leave
// the other's alone. A pending (not yet started) file needs nothing — it simply
// stops appearing in candidatePaths().
function abortIfUnwanted(resolved, reason) {
  if (!currentEncode || currentEncode.videoFilePath !== resolved) return false;
  if (wantedByChkSrt(resolved) || introPriority.includes(resolved)) return false;
  currentEncode.aborted = true;
  currentEncode.child?.kill("SIGKILL");
  unilog(1416, `aborted encode, ${reason}: ${path.basename(resolved)}`);
  return true;
}

// Called when a chksrt result is saved. The save has already removed the entry
// from subQueueChkSrt, so chksrt no longer wants it; intro may still.
export function cancelEncode(videoFilePath) {
  return abortIfUnwanted(path.resolve(videoFilePath), "chksrt result saved");
}

// Called when a show's intro is configured, so intro no longer wants a mirror
// for this episode. Drops the claim and stops the encode if chksrt has none.
export function dropIntro(videoFilePath) {
  if (!videoFilePath) return false;
  const resolved = path.resolve(videoFilePath);
  const at = introPriority.indexOf(resolved);
  if (at >= 0) introPriority.splice(at, 1);
  return abortIfUnwanted(resolved, "intro configured");
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
    // -ac 2: downmix to stereo — browsers require stereo AAC.
    // -aac_coder fast: ~2x faster than the default twoloop and the audio encode
    // is nearly the whole job here; quality is moot for a throwaway review mirror.
    args.push("-c:a", "aac", "-aac_coder", "fast", "-b:a", "128k", "-ac", "2");
  }
  args.push(
    "-sn",
    "-dn",
    "-t",
    String(MIRROR_MAX_SECS),
    "-movflags",
    "+faststart",
    tmp,
  );
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
        // How much of the source this mirror covers. Not validated today (every
        // consumer uses MIRROR_MAX_SECS), but without it a mirror's length is
        // unknowable without probing — so raising the cap later would silently
        // keep serving short mirrors. Mirrors written before this field exist
        // have no maxSecs and are a mix of 600s and full-length.
        maxSecs: MIRROR_MAX_SECS,
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

// True when this file still needs an mp4 mirror built: a tv-tree path, not in
// its FAIL_RETRY_MS cooldown, still on disk, and with no valid mirror yet.
async function needsEncode(videoFilePath) {
  if (!videoFilePath) return false;
  if (!mpfourPathFor(videoFilePath)) return false;
  const failed = failedAt.get(videoFilePath);
  if (failed && Date.now() - failed < FAIL_RETRY_MS) return false;
  if (!fs.existsSync(videoFilePath)) return false;
  if (await mpfourValid(videoFilePath)) return false;
  return true;
}

// Move an episode to the head of the intro priority list — someone just opened
// it for intro marking, so it outranks anything queued ahead of it. Called on
// the needsIntro flip, which is a real event, so the log is not chatty.
export function prioritizeIntro(videoFilePath) {
  if (!videoFilePath) return;
  const resolved = path.resolve(videoFilePath);
  if (!mpfourPathFor(resolved)) return; // outside the tv tree, never mirrored
  const at = introPriority.indexOf(resolved);
  if (at === 0) return;
  if (at > 0) introPriority.splice(at, 1);
  introPriority.unshift(resolved);
  unilog(1963, `intro priority head: ${path.basename(resolved)}`);
}

// Candidate paths in encode order: intro episodes first, then the chksrt queue,
// deduped so a file in both is only considered once.
function candidatePaths() {
  const seen = new Set();
  const out = [];
  for (const p of introPriority) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  for (const entry of subsState.subQueueChkSrt) {
    if (!entry?.videoFilePath) continue;
    const resolved = path.resolve(entry.videoFilePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

// Pull the intro episode of every chksrt-queued show into the priority list, so
// the mirror that gets built first is the one both features will use. Appends
// in chksrt-queue order and never reorders what is already there — this runs
// every 5s, so moving entries would churn the list (and the log) forever, and
// would also undo any head position set by prioritizeIntro.
async function refreshIntroPriority() {
  let paths;
  try {
    paths = introEpisodePaths() || [];
  } catch (e) {
    unilog(1964, `intro episode lookup failed: ${e.message}`);
    return;
  }
  for (const p of paths) {
    if (!p) continue;
    const resolved = path.resolve(p);
    if (!mpfourPathFor(resolved)) continue;
    if (introPriority.includes(resolved)) continue;
    // Skip already-mirrored files, else prune drops them and the next sweep
    // re-adds them, logging on every tick.
    if (!(await needsEncode(resolved))) continue;
    introPriority.push(resolved);
    unilog(1967, `intro mirror queued: ${path.basename(resolved)}`);
  }
}

// Drop entries that no longer need an encode (mirrored, gone, or in failure
// cooldown) so the list cannot grow without bound.
async function pruneIntroPriority() {
  const kept = [];
  for (const p of introPriority) {
    if (await needsEncode(p)) kept.push(p);
  }
  introPriority = kept;
}

async function nextNeedingEncode() {
  for (const p of candidatePaths()) {
    if (await needsEncode(p)) return p;
  }
  return null;
}

// chksrt-queue files still awaiting an mp4 mirror (the encode backlog,
// including the one currently encoding), in queue order. Drives the "Mp4"
// hdrMsg — [0] is the head show, length is the count.
async function computePending() {
  const pending = [];
  for (const p of candidatePaths()) {
    if (await needsEncode(p)) pending.push(p);
  }
  return pending;
}

// Live encode backlog (videoFilePaths, queue order) for the header.
export function getMp4Pending() {
  return mp4Pending;
}

// Recompute the backlog and, when it changes, refresh the hdrMsgs so the "Mp4"
// count/head tick as each mirror completes.
async function refreshMp4Count() {
  const pending = await computePending();
  const changed =
    pending.length !== mp4Pending.length ||
    pending.some((p, i) => p !== mp4Pending[i]);
  if (changed) {
    mp4Pending = pending;
    syncBatchMsgs();
  }
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
  await refreshIntroPriority();
  await pruneIntroPriority();
  // Refresh every tick, even while an encode from a prior tick is running, so
  // the count drops promptly when the user clears chksrt entries mid-encode.
  await refreshMp4Count();
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
      await refreshMp4Count();
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
  if (deps?.introEpisodePaths) introEpisodePaths = deps.introEpisodePaths;
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
