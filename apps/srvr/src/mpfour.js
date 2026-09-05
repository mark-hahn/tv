// mpfour — persistent seekable-mp4 mirrors of chksrt-queue videos.
//
// The chksrt video pane streams through /api/stream; non-mp4 sources arrive as
// a live fMP4 pipe with no Range support, so seeking must wait for the linear
// buffer. This module pre-encodes every file in subQueueChkSrt into an
// h264/aac +faststart mp4 under /mnt/media/mpfour — a tree mirroring
// /mnt/media/tv that emby never scans and nginx serves with Range support —
// letting the player jump anywhere instantly. Every source is downscaled to
// MIRROR_HEIGHT: the mirrors only back subtitle sync review and intro marking,
// where 480p is plenty, and a small file is what keeps the player from
// saturating the client's downlink (and starving its API calls) each time an
// episode opens. Mirrors outlive the original, so chksrt can be re-run after
// the video is deleted; a sidecar .src.json records the original's mtime/size
// and the mirror height so a replaced release or a changed height re-encodes.
// They are not kept forever — oldFiles.js expires a mirror a month after it
// was written, and a mirror still wanted after that is simply rebuilt.
//
// This runs on its own loop, deliberately NOT on the shared serialized
// subExtractQueue (batchQueue.js) — chksrt playback is needed before other
// batch ffmpeg work and must not sit behind it. The same loop keeps hevc
// (slow-transcode) entries at the tail of subQueueChkSrt.

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
// Mirror frame height. Width follows the source aspect (-2 keeps it even).
const MIRROR_HEIGHT = 480;
// The box's Radeon 780M decodes h264/hevc (incl. main10) through VAAPI, and
// scaling on the GPU before the download means only 480p frames cross to the
// libx264 encode: a 2160p hevc source ran 5.4s per 60s of content this way vs
// 8.8s decoding in software. The software pipeline is the retry when VAAPI
// rejects a source (unsupported codec/profile).
const VAAPI_DEVICE = "/dev/dri/renderD128";

// Wall-clock estimates for entries that have not started yet, from a 60s
// benchmark scaled to MIRROR_MAX_SECS (2160p hevc 54s, 1080p h264 31s), rounded
// up for the SCHED_IDLE slowdown. Every mirror is a real encode now, so the
// cost is driven by decode work: pixel count and codec. Resolution is read
// from the filename. The entry actually encoding ignores all of this and
// reports ffmpeg's own progress instead.
const EST_ENCODE_1080_SECS = 40;
const EST_ENCODE_2160_SECS = 75;
const EST_ENCODE_OTHER_SECS = 50;

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
let introEpisodePaths = async () => [];
let currentTmpPath = null;
// { videoFilePath, child, aborted } while an encode is running, else null
let currentEncode = null;
let syncBatchMsgs = () => {};
// Fired when a mirror finishes or the chksrt queue is reordered around one, so
// index.js can push the head-of-queue/intro readiness to clients at once
// instead of on the next poll.
let onMirrorsChanged = () => {};
const failedAt = new Map(); // videoFilePath -> last failure timestamp
// resolved videoFilePath -> true, for every path mpfourValid last found valid.
// The channel snapshots are synchronous, so they read this instead of
// stat'ing; the 5s scan re-validates every queued entry, keeping it fresh.
const validMirrors = new Set();
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
// original's mtime+size and the current MIRROR_HEIGHT; null otherwise
// (missing, stale, full-size from before downscaling, or non-tv path).
export async function mpfourValid(videoFilePath) {
  const mirror = mpfourPathFor(videoFilePath);
  if (!mirror) return null;
  const resolved = path.resolve(videoFilePath);
  const wasValid = validMirrors.has(resolved);
  const verdict = await mpfourValidUncached(resolved, mirror);
  // The cache starts empty on every srvr restart, so the first chksrt snapshot
  // after one reports the head as unmirrored (yellow) even when its mp4 is
  // fine; the scan then fills the cache but nothing republished. Push a fresh
  // snapshot whenever a verdict flips.
  if (validMirrors.has(resolved) !== wasValid) onMirrorsChanged();
  return verdict;
}

async function mpfourValidUncached(resolved, mirror) {
  try {
    const [srcStat, sidecarRaw] = await Promise.all([
      fsp.stat(resolved),
      fsp.readFile(sidecarPathFor(mirror), "utf8"),
    ]);
    const sidecar = JSON.parse(sidecarRaw);
    if (
      sidecar.mtimeMs !== srcStat.mtimeMs ||
      sidecar.size !== srcStat.size ||
      sidecar.height !== MIRROR_HEIGHT
    )
      throw new Error("stale");
    await fsp.access(mirror);
    validMirrors.add(resolved);
    return mirror;
  } catch {
    validMirrors.delete(resolved);
    return null;
  }
}

// Synchronous read of the last mpfourValid() verdict for this path — for the
// channel snapshots, which cannot await.
export function mpfourValidCached(videoFilePath) {
  if (!videoFilePath) return false;
  return validMirrors.has(path.resolve(videoFilePath));
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

// Every mirror is an encode now, so the source's decode cost is what separates
// a quick one (h264, well under a minute) from a slow one (hevc, usually 2160p).
async function slowDecode(videoFilePath) {
  const { videoCodec } = await getCodecs(videoFilePath);
  return videoCodec !== "h264";
}

// Order subQueueChkSrt by how soon each entry can be played: files whose mp4
// mirror is already built and valid come first (instant seeking, no waiting),
// then files still needing a mirror but only a quick encode (h264), then the
// hevc sources, which get the most time to finish before you reach them. Stable
// within each group, so a newly-added entry lands behind its peers.
async function reorderChkSrtQueue() {
  const queue = subsState.subQueueChkSrt;
  if (queue.length < 2) return;
  const mirrored = [];
  const fast = [];
  const slow = [];
  for (const entry of queue) {
    const videoFilePath = entry?.videoFilePath;
    let group = fast;
    if (videoFilePath && fs.existsSync(videoFilePath)) {
      try {
        if (await mpfourValid(videoFilePath)) group = mirrored;
        else if (await slowDecode(videoFilePath)) group = slow;
      } catch (e) {
        unilog(1413, `probe failed for ${path.basename(videoFilePath)}: ${e.message}`);
      }
    }
    group.push(entry);
  }
  const next = [...mirrored, ...fast, ...slow];
  if (next.every((entry, i) => entry === queue[i])) return; // already ordered
  subsState.subQueueChkSrt = next;
  persistSubQueueChkSrt();
  syncBatchMsgs();
  onMirrorsChanged();
  unilog(2327, `reordered chksrt queue: ${mirrored.length} mirrored, ${fast.length} fast, ${slow.length} slow to decode`);
}

// Reorder unless a reorder from another tick is still running.
async function reorderChkSrtQueueOnce() {
  if (reordering) return;
  reordering = true;
  try {
    await reorderChkSrtQueue();
  } finally {
    reordering = false;
  }
}

// Mirror encodes run under SCHED_IDLE: a 2160p transcode saturates ~10 of the
// box's 16 cores, and at normal priority it starves the live /api/stream
// transcode a person is sitting in front of — the intro pane could only buffer
// a few seconds while a mirror nobody is waiting on ran flat out. chrt execs
// ffmpeg in place, so the child pid (and SIGKILL from abortIfUnwanted) still
// lands on ffmpeg itself.
function runFfmpeg(args, onSpawn, onProgress) {
  return new Promise((resolve, reject) => {
    const ffmpeg = cp.spawn("chrt", ["--idle", "0", "ffmpeg", ...args]);
    onSpawn?.(ffmpeg);
    let lastErr = "";
    ffmpeg.stderr.on("data", (d) => {
      lastErr = d.toString();
      // ffmpeg's status line carries `time=HH:MM:SS.xx` — how much content it
      // has written so far. Against the known MIRROR_MAX_SECS target that is a
      // real measurement of how far along this encode is, which beats any
      // a-priori estimate and stays right when SCHED_IDLE starves the job.
      const m = lastErr.match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g);
      if (m && onProgress) {
        const last = m[m.length - 1].match(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
        onProgress(+last[1] * 3600 + +last[2] * 60 + parseFloat(last[3]));
      }
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
  const { audioCodec } = await getCodecs(videoFilePath);
  const inputArgs = (vaapi) =>
    vaapi
      ? [
          "-hwaccel",
          "vaapi",
          "-hwaccel_device",
          VAAPI_DEVICE,
          "-hwaccel_output_format",
          "vaapi",
          "-i",
          videoFilePath,
          "-vf",
          `scale_vaapi=w=-2:h=${MIRROR_HEIGHT}:format=nv12,hwdownload,format=nv12`,
        ]
      : ["-i", videoFilePath, "-vf", `scale=-2:${MIRROR_HEIGHT}`];
  const outputArgs = [
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
  ];
  if (audioCodec === "aac") {
    outputArgs.push("-c:a", "copy");
  } else {
    // -ac 2: downmix to stereo — browsers require stereo AAC.
    // -aac_coder fast: ~2x faster than the default twoloop; quality is moot
    // for a throwaway review mirror.
    outputArgs.push(
      "-c:a",
      "aac",
      "-aac_coder",
      "fast",
      "-b:a",
      "128k",
      "-ac",
      "2",
    );
  }
  outputArgs.push(
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
    startedAt,
    progressSecs: 0,
  };
  const run = (vaapi) =>
    runFfmpeg(
      ["-y", ...inputArgs(vaapi), ...outputArgs],
      (child) => {
        currentEncode.child = child;
      },
      (secs) => {
        if (currentEncode) currentEncode.progressSecs = secs;
      },
    );
  let decode = "vaapi";
  try {
    try {
      await run(true);
    } catch (e) {
      // A kill from cancelEncode() is an intentional abort, not a failure —
      // rethrowing would mark the file failed and skip it for FAIL_RETRY_MS.
      if (currentEncode.aborted) return "aborted";
      // VAAPI refused the source — decode in software instead.
      unilog(2328, `vaapi decode failed, retrying in software: ${path.basename(videoFilePath)}: ${e.message.slice(-200)}`);
      decode = "software";
      currentEncode.progressSecs = 0;
      try {
        await run(false);
      } catch (e2) {
        if (currentEncode.aborted) return "aborted";
        throw e2;
      }
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
        // Frame height the mirror was scaled to; a different MIRROR_HEIGHT
        // invalidates it so old full-size mirrors get rebuilt.
        height: MIRROR_HEIGHT,
      }),
      "utf8",
    );
  } finally {
    currentTmpPath = null;
    currentEncode = null;
    await fsp.rm(tmp, { force: true });
  }
  validMirrors.add(path.resolve(videoFilePath));
  const secs = Math.round((Date.now() - startedAt) / 1000);
  unilog(2329, `encode (${decode} decode) done in ${secs}s: ${path.basename(mirror)}`);
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
    paths = (await introEpisodePaths()) || [];
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

// Seconds this file is expected to take once it starts, driven by how much
// decoding the source needs.
function estimateEncodeSecs(videoFilePath) {
  const name = path.basename(videoFilePath);
  if (/2160p|\buhd\b|\b4k\b/i.test(name)) return EST_ENCODE_2160_SECS;
  if (/1080p/i.test(name)) return EST_ENCODE_1080_SECS;
  return EST_ENCODE_OTHER_SECS;
}

// Seconds left on the running encode. Once ffmpeg has reported any progress
// this is measured, not estimated: content-seconds written per wall-second
// projected out to the MIRROR_MAX_SECS target.
function encodeRemainingSecs() {
  if (!currentEncode) return 0;
  const elapsed = (Date.now() - currentEncode.startedAt) / 1000;
  const done = currentEncode.progressSecs;
  if (done > 0 && elapsed > 0) {
    const rate = done / elapsed;
    return Math.max(0, Math.round((MIRROR_MAX_SECS - done) / rate));
  }
  // Nothing reported yet (still probing) — fall back to the static estimate
  // less time served.
  const est = estimateEncodeSecs(currentEncode.videoFilePath);
  return Math.max(0, Math.round(est - elapsed));
}

// Queue contents for the Queues pane: every pending mirror in encode order,
// each with the wall-clock time it is expected to finish, plus live detail on
// the one running. mp4Pending includes the encoding file, so entry 1 is it.
export async function getMp4QueueStatus() {
  const running = currentEncode;
  let eta = Date.now();
  const entries = [];
  for (let i = 0; i < mp4Pending.length; i++) {
    const p = mp4Pending[i];
    const isRunning = !!running && running.videoFilePath === p;
    const secs = isRunning ? encodeRemainingSecs() : estimateEncodeSecs(p);
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
          running.progressSecs > 0
            ? `encoding ${Math.min(
                100,
                Math.round((running.progressSecs / MIRROR_MAX_SECS) * 100),
              )}% of ${MIRROR_MAX_SECS}s ${MIRROR_HEIGHT}p mirror`
            : "encoding, starting",
        remainingSecs: encodeRemainingSecs(),
        elapsedSecs: Math.round((Date.now() - running.startedAt) / 1000),
      }
    : null;
  return { count: entries.length, inflight, entries };
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
  await reorderChkSrtQueueOnce();
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
        const result = await encodeOne(videoFilePath);
        failedAt.delete(videoFilePath);
        if (result === "done") {
          // Move the fresh mirror to the front of the chksrt queue now rather
          // than on the next tick, then tell the clients.
          await reorderChkSrtQueueOnce();
          onMirrorsChanged();
        }
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

// Expiring old mirrors belongs to oldFiles.js, which owns every scheduled
// delete and its log. The only cleanup here is .tmp.mp4 left behind by an
// encode that was killed mid-write (e.g. a pm2 restart), done once at startup
// while nothing of ours is running.
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
  if (deps?.onMirrorsChanged) onMirrorsChanged = deps.onMirrorsChanged;
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
