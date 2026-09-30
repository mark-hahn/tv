// stills — film-strip stills straight from the original video, and a short
// 480p window transcoded the moment one is clicked. This replaced the mp4
// mirror (mpfour): intro marking and chksrt review used to wait 50–130s for a
// mirror encode before anything could be seen; now the strip is up in 1–20s
// and the video in under a second.
//
// Stills: one every STILL_GAP_SECS over the first STILL_SPAN_SECS, in a single
// ffmpeg pass. A set may be offset by a whole number of seconds (0..MAX_OFFSET_SECS)
// so the strip can be re-scanned between the grid marks; offset 0 lives in the
// episode's stills dir and offset N in its off<N> subdir, all kept. The decode is chosen by the source's keyframe spacing. A dense
// source (modern WEB rips keep a keyframe every 2–4s) decodes only I-frames
// (-skip_frame nokey) and takes the keyframe nearest each grid mark — about a
// second for 600s of 2160p hevc, and no picture repeats because the keyframes
// are closer together than the grid. A sparse source (10s keyframes on older
// SD rips and x265 scene encodes) decodes every reference frame instead
// (-skip_frame noref), 5–20s; skipping B-frames outright (bidir) is not an
// option because these streams use them as references and the pictures come
// out corrupt. Builds run one at a time — they share the one GPU decoder and
// two in parallel finish no sooner than two in sequence — and the episode
// someone is opening right now does not just jump the line, it takes the slot:
// the sweep build in it is killed and requeued, so an open strip pane never
// waits out work nobody asked for.
//
// Window: WINDOW_SECS of 480p from the requested start as fragmented mp4 on
// the response, into the client's MediaSource. The first fragment is on the
// wire ~0.4s after the request and the encode runs ~12x realtime, so playback
// never catches it. Any stills build is SIGSTOPped while a window streams —
// a window under a running stills pass was 3–4x slower — and SIGCONTed after.

import fsp from "fs/promises";
import * as cp from "child_process";
import * as path from "node:path";
import { logHere, unilog} from "@tv/share"

const TV_DIR = "/mnt/media/tv";
const STILLS_DIR = "/mnt/media/stills";
// Host nginx serves the stills tree from, as /stills.
const NGINX_ORIGIN = "https://hahnca.com";
const VAAPI_DEVICE = "/dev/dri/renderD128";
const STILL_GAP_SECS = 5;
const STILL_SPAN_SECS = 1200;
// tvapp's scrub stills (playStills): the whole file on the same grid, in this
// subdir of the episode's stills dir.
const PLAY_SUBDIR = "play";
// A play set's still spacing: tvapp's hold steps one still at a time, so this
// sets how many it shows a second (50 for a held right). Keyframes are about
// 2s apart in most files, so a finer grid would mostly repeat pictures.
const PLAY_GAP_SECS = 2.5;
// ffmpegs a play set runs at once. 12 made about 39 stills a second off a 1080p
// mkv, against 28 for 8; 16 made no more.
const PLAY_THREADS = 12;
// A new set makes every PLAY_COARSE-th still (15s) first, so a hold on a set
// still building has a picture every 15s before it has them all.
const PLAY_COARSE = 6;
// tvapp shows a still full screen, and its UI is 1920x1080 on the 4K set.
// Smaller sources stay their own size. The keyframe's decode is what a still
// costs, and the width hardly changes it: 0.22s for a 2160p hevc still at 400
// wide, 0.24s at 1920.
const PLAY_WIDTH = 1920;
// Twice the 200px the strip renders them at, for hidpi.
const STILL_WIDTH = 400;
const STILL_QUALITY = 4;
// Keyframes this close together or closer make nearest-keyframe stills exact
// enough that no grid mark repeats its neighbour's picture.
const DENSE_MAX_GAP_SECS = STILL_GAP_SECS;
// Keyframe spacing is measured over this much of the head, not the whole
// STILL_SPAN_SECS: a single encode's GOP is constant, and reading packet flags
// for 1200s of cold 2160p takes 15s — a strip that sat empty that whole time
// and then filled all at once. A 120s sample reads in ~1.4s, so ffmpeg starts
// almost at once and the images land live from the second the pane opens.
const PROBE_SPAN_SECS = 120;
const WINDOW_SECS = 140;
const WINDOW_HEIGHT = 480;
const SIDECAR_NAME = "src.json";
// Message a preempted build rejects with; pump() requeues on job.preempted
// rather than on this, so it never needs matching.
const PREEMPTED = "preempted by an urgent build";
export const MAX_OFFSET_SECS = 4;

// "<resolved videoFilePath>#<offset>" -> job, for the life of the process.
const jobs = new Map();
// Jobs waiting for the one build slot, in run order.
const pending = [];
let running = null;
let windowsRunning = 0;

// Stills directory for a tv-library video, or null outside the tv tree.
export function stillsDirFor(videoFilePath) {
  const resolved = path.resolve(videoFilePath);
  if (!resolved.startsWith(TV_DIR + "/")) return null;
  const rel = resolved.slice(TV_DIR.length + 1).replace(/\.[^.]+$/, "");
  return path.join(STILLS_DIR, rel);
}

// Where one offset's set lives: the stills dir itself for 0, off<N> under it.
function offsetDir(dir, offset) {
  return offset === 0 ? dir : path.join(dir, `off${offset}`);
}

function jobKey(resolved, offset) {
  return `${resolved}#${offset}`;
}

// Drop one set's images and sidecar, leaving other offsets' subdirs alone.
async function clearSet(dir) {
  await fsp.mkdir(dir, { recursive: true });
  for (const name of await fsp.readdir(dir)) {
    if (name.endsWith(".jpg") || name === SIDECAR_NAME)
      await fsp.rm(path.join(dir, name), { force: true });
  }
}

function stillsUrlBase(dir) {
  return (
    NGINX_ORIGIN +
    dir
      .replace("/mnt/media", "")
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/")
  );
}

async function readSidecar(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, SIDECAR_NAME), "utf8"));
  } catch {
    return null;
  }
}

// A finished set for this exact source file under the current constants.
async function validSidecar(dir, srcStat, offset) {
  const sc = await readSidecar(dir);
  if (
    !sc ||
    sc.mtimeMs !== srcStat.mtimeMs ||
    sc.size !== srcStat.size ||
    (sc.offsetSecs ?? 0) !== offset ||
    sc.gapSecs !== STILL_GAP_SECS ||
    sc.spanSecs !== STILL_SPAN_SECS ||
    sc.width !== STILL_WIDTH
  )
    return null;
  return sc;
}

// Duration plus keyframe spacing over the first PROBE_SPAN_SECS, one ffprobe.
function probe(videoFilePath) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-read_intervals",
        `%+${PROBE_SPAN_SECS}`,
        "-show_entries",
        "format=duration:packet=pts_time,flags",
        "-print_format",
        "json",
        videoFilePath,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const out = JSON.parse(stdout);
        const keys = (out.packets || [])
          .filter((p) => (p.flags || "").includes("K"))
          .map((p) => parseFloat(p.pts_time))
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        let maxGap = 0;
        for (let i = 1; i < keys.length; i++)
          maxGap = Math.max(maxGap, keys[i] - keys[i - 1]);
        resolve({
          durationSec: parseFloat(out.format?.duration) || 0,
          keyframes: keys.length,
          maxGap,
        });
      },
    );
  });
}

// HDR sources (PQ or HLG, BT.2020) must be tone-mapped to SDR BT.709 before
// they go to the browser: an untouched PQ signal squeezed into 8-bit and still
// tagged bt2020/smpte2084 is colour-managed by Chrome into blown-out cyan.
export const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);
const hdrCache = new Map();

function isHdr(videoFilePath) {
  const hit = hdrCache.get(videoFilePath);
  if (hit !== undefined) return hit;
  const p = new Promise((resolve, reject) => {
    cp.execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=color_transfer",
        "-of",
        "default=nw=1:nk=1",
        videoFilePath,
      ],
      (err, stdout) => {
        if (err) reject(err);
        else resolve(HDR_TRANSFERS.has(stdout.trim()));
      },
    );
  });
  hdrCache.set(videoFilePath, p);
  return p;
}

// zscale/tonemap in software: the AMD VAAPI driver has no HDR tone-map VPP,
// and at WINDOW_HEIGHT the scaled frames are small enough for it to be cheap.
export const TONEMAP =
  "zscale=t=linear:npl=100,tonemap=hable:desat=0," +
  "zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p";

function runFfmpeg(args, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn("ffmpeg", ["-y", "-v", "error", ...args]);
    onSpawn?.(child);
    let lastErr = "";
    child.stderr.on("data", (d) => {
      lastErr = (lastErr + d.toString()).slice(-2000);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code ?? signal}: ${lastErr.slice(-300)}`));
    });
  });
}

const vaapiInputArgs = [
  "-hwaccel",
  "vaapi",
  "-hwaccel_device",
  VAAPI_DEVICE,
  "-hwaccel_output_format",
  "vaapi",
];

function stillsArgs(videoFilePath, dense, vaapi, dir, offset) {
  const scale = vaapi
    ? `scale_vaapi=w=${STILL_WIDTH}:h=-2:format=nv12,hwdownload,format=nv12`
    : `scale=${STILL_WIDTH}:-2`;
  return [
    ...(vaapi ? vaapiInputArgs : []),
    "-skip_frame",
    dense ? "nokey" : "noref",
    // Input seek: output time 0 is source time `offset`, so every grid mark
    // below lands `offset` seconds later than the offset-0 set's.
    ...(offset > 0 ? ["-ss", String(offset)] : []),
    "-t",
    String(STILL_SPAN_SECS),
    "-i",
    videoFilePath,
    "-an",
    "-sn",
    "-vf",
    `fps=1/${STILL_GAP_SECS},${scale}`,
    "-q:v",
    String(STILL_QUALITY),
    // Each jpg lands by rename, so a reader listing the dir mid-run never
    // sees a half-written file — that is what lets the strip fill in live.
    "-atomic_writing",
    "1",
    path.join(dir, "%05d.jpg"),
  ];
}

// The Nth image is the grid mark offset+(N-1)*STILL_GAP_SECS, so a set is
// just a count: no rename pass, and the client computes each still's position.
async function buildStills(job) {
  const srcStat = await fsp.stat(job.path);
  await clearSet(job.dir);
  const { durationSec, keyframes, maxGap } = await probe(job.path);
  job.durationSec = durationSec;
  job.dense = maxGap <= DENSE_MAX_GAP_SECS;
  job.total = Math.ceil(
    Math.min(Math.max(durationSec - job.offset, 0), STILL_SPAN_SECS) / STILL_GAP_SECS,
  );
  // Preempted during the probe, where there is no child to kill: bail here
  // instead, before taking the decoder.
  if (job.preempted) throw new Error(PREEMPTED);
  const onSpawn = (child) => {
    job.child = child;
    // Preempted in the gap before the spawn landed.
    if (job.preempted) child.kill("SIGKILL");
    // A window opened while this build was still probing: it is suspended on
    // arrival, the same as one the window found already running.
    else if (windowsRunning > 0) child.kill("SIGSTOP");
  };
  try {
    await runFfmpeg(stillsArgs(job.path, job.dense, true, job.dir, job.offset), onSpawn);
    job.decode = "vaapi";
  } catch (e) {
    // A killed build is not a vaapi failure — no software retry, just go.
    if (job.preempted) throw new Error(PREEMPTED);
    unilog(2395, `vaapi stills failed, retrying in software: ${path.basename(job.path)}: ${e.message.slice(-200)}`);
    await clearSet(job.dir);
    await runFfmpeg(stillsArgs(job.path, job.dense, false, job.dir, job.offset), onSpawn);
    job.decode = "software";
  }
  // Past the decode, with the whole set on disk: a kill that landed just after
  // ffmpeg exited cleanly must not throw the set away for a rebuild. Finishing
  // from here is a sidecar write, and the slot frees either way.
  job.preempted = false;
  const count = (await fsp.readdir(job.dir)).filter((n) => n.endsWith(".jpg")).length;
  job.total = count;
  await fsp.writeFile(
    path.join(job.dir, SIDECAR_NAME),
    JSON.stringify({
      src: job.path,
      mtimeMs: srcStat.mtimeMs,
      size: srcStat.size,
      offsetSecs: job.offset,
      gapSecs: STILL_GAP_SECS,
      spanSecs: STILL_SPAN_SECS,
      width: STILL_WIDTH,
      total: count,
      durationSec,
      dense: job.dense,
      keyframes,
      maxGap,
    }),
    "utf8",
  );
  const secs = ((Date.now() - job.startedAt) / 1000).toFixed(1);
  unilog(2430, `${count} stills offset ${job.offset}s (${job.dense ? "nokey" : "noref"}, ${job.decode}, keyframe gap ${maxGap.toFixed(1)}s) in ${secs}s: ${path.basename(job.path)}`);
}

// Take the build slot for an urgent job by killing the sweep build sitting in
// it: somebody has a strip pane open on their episode right now, and the sweep
// is only working ahead. Urgent builds are never preempted — two strips opened
// at once take their turns. A child SIGSTOPped under a streaming window takes
// the SIGKILL anyway; a build still in its probe has no child and bails on the
// flag. The kill is asynchronous, so the caller leaves its job at the front of
// `pending` and pump() starts it when the slot actually clears.
function preemptForUrgent() {
  if (!running || running.urgent || running.preempted) return;
  running.preempted = true;
  running.child?.kill("SIGKILL");
  unilog(2436, `preempted sweep stills build for ${path.basename(running.path)}`);
}

// A preempted build goes back in the queue to start over — its partial set is
// cleared when it runs again — behind the urgent jobs that took the slot but
// ahead of the rest of the sweep, since it was next.
function requeuePreempted(job) {
  job.preempted = false;
  job.queued = true;
  job.startedAt = null;
  job.total = 0;
  job.dense = null;
  job.decode = null;
  const at = pending.findIndex((j) => !j.urgent);
  pending.splice(at === -1 ? pending.length : at, 0, job);
}

// Start the next queued build if the slot is free.
function pump() {
  if (running || pending.length === 0) return;
  const job = pending.shift();
  running = job;
  job.queued = false;
  job.startedAt = Date.now();
  job.promise = buildStills(job)
    .catch((e) => {
      // A preempted build is not a failed one: it is requeued below and must
      // leave no error for the pane to show.
      if (job.preempted) return;
      job.error = e.message;
      unilog(2397, `stills failed for ${path.basename(job.path)}: ${e.message}`);
    })
    .finally(() => {
      job.child = null;
      running = null;
      if (job.preempted) requeuePreempted(job);
      else job.doneAt = Date.now();
      pump();
    });
}

// Make sure this episode's stills at `offset` exist or are on their way. A
// valid set on disk is adopted without a build; otherwise the build is queued
// — at the front when `urgent` (someone is opening this episode right now),
// taking the slot off a sweep build that holds it, else at the back (the sweep
// over shows that will want an intro). Returns at once; poll stillsStatus for
// progress.
export async function startStills(
  videoFilePath,
  { urgent = false, offset = 0 } = {},
) {
  const resolved = path.resolve(videoFilePath);
  const base = stillsDirFor(resolved);
  if (!base) throw new Error("outside the tv tree");
  const dir = offsetDir(base, offset);
  const existing = jobs.get(jobKey(resolved, offset));
  if (existing) {
    if (urgent) {
      // Somebody is waiting on this one now, so it stops being preemptable.
      // Already running is already what they want; queued goes to the front
      // and takes the slot.
      existing.urgent = true;
      if (existing.queued) {
        const at = pending.indexOf(existing);
        if (at > 0) {
          pending.splice(at, 1);
          pending.unshift(existing);
        }
        preemptForUrgent();
      }
    }
    return existing;
  }
  const job = {
    path: resolved,
    dir,
    offset,
    urgent,
    preempted: false,
    queued: true,
    total: 0,
    startedAt: null,
    doneAt: null,
    error: null,
    child: null,
    dense: null,
    decode: null,
    durationSec: 0,
  };
  jobs.set(jobKey(resolved, offset), job);
  const sc = await validSidecar(dir, await fsp.stat(resolved), offset);
  if (sc) {
    job.queued = false;
    job.startedAt = job.doneAt = Date.now();
    job.total = sc.total;
    job.durationSec = sc.durationSec;
    job.dense = sc.dense;
    job.decode = "cached";
    return job;
  }
  if (urgent) {
    pending.unshift(job);
    preemptForUrgent();
  } else {
    pending.push(job);
  }
  pump();
  return job;
}

// Play sets building now, by resolved video path: { stop, done }. Only the
// newest play's set builds: each is up to PLAY_THREADS ffmpegs, and a set
// left building for every episode flipped through piled them up on the disk.
// A stopped set carries on from where it got to the next time its episode
// plays.
const playBuilds = new Map();
let newestPlay = null;

// tvapp's scrub stills for an episode it is about to play, which it shows
// while left/right is held. Starts the set building unless it is already on
// disk or on its way, stopping any other set's build, and returns at once with
// where it is. startMs is where the video starts; the stills nearest it come
// first.
export function playStills(videoFilePath, startMs) {
  const resolved = path.resolve(videoFilePath);
  const dir = path.join(stillsDirFor(resolved), PLAY_SUBDIR);
  newestPlay = resolved;
  for (const [file, build] of playBuilds) if (file !== resolved) build.stop = true;
  const running = playBuilds.get(resolved);
  if (!running) startPlayBuild(resolved, dir, startMs);
  // Played again while its stop winds down: it starts over once that has,
  // unless yet another episode has been played by then.
  else if (running.stop)
    running.done.then(() => {
      if (newestPlay === resolved && !playBuilds.has(resolved))
        startPlayBuild(resolved, dir, startMs);
    });
  return { urlBase: stillsUrlBase(dir), gapMs: PLAY_GAP_SECS * 1000 };
}

function startPlayBuild(file, dir, startMs) {
  const build = { stop: false };
  build.done = buildPlayStills(file, dir, startMs / 1000, build)
    .catch((e) => {
      unilog(2653, `play stills failed for ${path.basename(file)}: ${e.message}`);
    })
    .finally(() => playBuilds.delete(file));
  playBuilds.set(file, build);
}

// The intro strip's one pass reads the whole file, minutes for a big one, so a
// play set is one short ffmpeg per grid mark instead: the input seek goes
// through the mkv's index to the keyframe at or before the mark, and that one
// frame is decoded, a few MB read per still. Software decode, one thread each:
// no GPU needed, so these stay out of the intro builds' slot, and one decoder
// thread hands out its first frame without waiting for more packets. Order:
// the coarse marks from the start to the end, then from the start back to 0,
// then the marks between them in the same order. Each still lands by rename,
// so tvapp can use a set before it is finished. The sidecar is written
// `partial` at the start, so a build stopped part way (build.stop) keeps its
// stills and the next one makes only the rest.
async function buildPlayStills(file, dir, startSec, build) {
  const srcStat = await fsp.stat(file);
  const sc = await readSidecar(dir);
  const sameSet =
    sc &&
    sc.mtimeMs === srcStat.mtimeMs &&
    sc.size === srcStat.size &&
    sc.gapSecs === PLAY_GAP_SECS &&
    sc.width === PLAY_WIDTH;
  if (sameSet && !sc.partial) return;
  const startedAt = Date.now();
  if (!sameSet) await clearSet(dir);
  const { durationSec, dvProfile } = await probePlay(file);
  const sidecar = {
    src: file,
    mtimeMs: srcStat.mtimeMs,
    size: srcStat.size,
    gapSecs: PLAY_GAP_SECS,
    width: PLAY_WIDTH,
    durationSec,
  };
  await fsp.writeFile(
    path.join(dir, SIDECAR_NAME),
    JSON.stringify({ ...sidecar, partial: true }),
    "utf8",
  );
  const stillName = (n) => `${String(n + 1).padStart(5, "0")}.jpg`;
  const have = new Set(await fsp.readdir(dir));
  const count = Math.ceil(durationSec / PLAY_GAP_SECS);
  const first = Math.min(count - 1, Math.round(startSec / PLAY_GAP_SECS));
  const rank = (n) =>
    (n % PLAY_COARSE ? 2 * count : 0) + (n < first ? count : 0) + Math.abs(n - first);
  const order = [...Array(count).keys()]
    .filter((n) => !have.has(stillName(n)))
    .sort((a, b) => rank(a) - rank(b));
  let next = 0;
  let failed = 0;
  let lastErr = "";
  const worker = async () => {
    while (!build.stop && next < order.length) {
      const n = order[next++];
      await runFfmpeg(
        playStillArgs(file, n * PLAY_GAP_SECS, path.join(dir, stillName(n)), dvProfile === 5),
      ).catch((e) => {
        failed++;
        lastErr = e.message;
      });
    }
  };
  await Promise.all(Array.from({ length: PLAY_THREADS }, worker));
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (failed > 0)
    unilog(2654, `${failed} of ${count} play stills failed for ${path.basename(file)}: ${lastErr.slice(-200)}`);
  if (build.stop) {
    unilog(2655, `play stills stopped after ${next} of ${order.length} in ${secs}s, another episode played: ${path.basename(file)}`);
    return;
  }
  await fsp.writeFile(
    path.join(dir, SIDECAR_NAME),
    JSON.stringify({ ...sidecar, total: count - failed }),
    "utf8",
  );
  unilog(2656, `${order.length - failed} play stills (${count} in the set) in ${secs}s: ${path.basename(file)}`);
}

// Dolby Vision profile 5 has no HDR10 base layer: decoded as plain video its
// frames come out tinted magenta, so libplacebo applies the DV metadata on the
// GPU (Vulkan) and maps it to SDR. Twice the time of a plain still.
const DV5_FILTER =
  `libplacebo=w=min(${PLAY_WIDTH}\\,iw):h=-2:apply_dolbyvision=1:colorspace=bt709:` +
  "color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p";

function playStillArgs(videoFilePath, sec, out, dv5) {
  return [
    ...(dv5 ? ["-init_hw_device", "vulkan"] : []),
    "-threads",
    "1",
    "-noaccurate_seek",
    "-ss",
    String(sec),
    "-i",
    videoFilePath,
    "-an",
    "-sn",
    "-frames:v",
    "1",
    // The keyframe is stamped before the mark, and the image muxer's default
    // constant rate drops every frame until the mark: 150 decoded and 1.5MB
    // read for a still, not 1 and 200KB.
    "-fps_mode",
    "passthrough",
    "-vf",
    dv5 ? DV5_FILTER : `scale=min(${PLAY_WIDTH}\\,iw):-2`,
    "-q:v",
    String(STILL_QUALITY),
    "-update",
    "1",
    "-atomic_writing",
    "1",
    out,
  ];
}

// Duration, and the Dolby Vision profile (null for none).
export function probePlay(videoFilePath) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "format=duration:stream_side_data=dv_profile",
        "-of",
        "json",
        videoFilePath,
      ],
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const out = JSON.parse(stdout);
        const durationSec = parseFloat(out.format?.duration);
        if (!(durationSec > 0)) {
          reject(new Error(`no duration: ${stdout.trim()}`));
          return;
        }
        const dv = (out.streams?.[0]?.side_data_list || []).find((d) => d.dv_profile != null);
        resolve({ durationSec, dvProfile: dv?.dv_profile ?? null });
      },
    );
  });
}

// Progress for the client: how many stills exist right now, whether the build
// is finished, and where to fetch them.
export async function stillsStatus(videoFilePath, offset = 0) {
  const resolved = path.resolve(videoFilePath);
  const base = stillsDirFor(resolved);
  if (!base) throw new Error("outside the tv tree");
  const dir = offsetDir(base, offset);
  let count = 0;
  try {
    count = (await fsp.readdir(dir)).filter((n) => n.endsWith(".jpg")).length;
  } catch {
    count = 0;
  }
  const job = jobs.get(jobKey(resolved, offset));
  return {
    count,
    offsetSecs: offset,
    gapMs: STILL_GAP_SECS * 1000,
    urlBase: stillsUrlBase(dir),
    started: !!job,
    queued: !!job?.queued,
    queuedBehind: job?.queued ? pending.indexOf(job) + (running ? 1 : 0) : 0,
    done: !!job && job.doneAt !== null,
    error: job?.error ?? null,
    total: job?.total ?? 0,
    durationSec: job?.durationSec ?? 0,
    dense: job?.dense ?? null,
    decode: job?.decode ?? null,
    elapsedMs:
      job && job.startedAt !== null
        ? (job.doneAt ?? Date.now()) - job.startedAt
        : null,
  };
}

function signalStillsBuild(sig) {
  if (running?.child) running.child.kill(sig);
}

function windowArgs(videoFilePath, startSec, audioIndex, vaapi, hdr) {
  const vf = vaapi
    ? hdr
      ? `scale_vaapi=w=-2:h=${WINDOW_HEIGHT}:format=p010,hwdownload,format=p010le,${TONEMAP}`
      : `scale_vaapi=w=-2:h=${WINDOW_HEIGHT}:format=nv12,hwdownload,format=nv12`
    : hdr
      ? `scale=-2:${WINDOW_HEIGHT},${TONEMAP}`
      : `scale=-2:${WINDOW_HEIGHT}`;
  return [
    "-v",
    "error",
    ...(vaapi ? vaapiInputArgs : []),
    "-ss",
    String(startSec),
    "-t",
    String(WINDOW_SECS),
    "-i",
    videoFilePath,
    "-vf",
    vf,
    "-map",
    "0:v:0",
    "-map",
    audioIndex != null ? `0:${audioIndex}` : "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    // 2s fragments, so the browser has something to show within a second.
    "-g",
    "48",
    // Browsers require stereo aac for MSE.
    "-c:a",
    "aac",
    "-aac_coder",
    "fast",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-sn",
    "-dn",
    "-f",
    "mp4",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
  ];
}

// Stream WINDOW_SECS of 480p from startSec onto res as fragmented mp4. VAAPI
// first; if it dies before a byte is written the source is one VAAPI cannot
// decode, so the same window is restarted in software.
export async function streamWindow(videoFilePath, startSec, audioIndex, req, res) {
  const resolved = path.resolve(videoFilePath);
  const hdr = await isHdr(resolved);
  const startedAt = Date.now();
  let bytes = 0;
  let firstByteMs = null;
  let closed = false;
  let finished = false;
  let child = null;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "no-cache");
  windowsRunning++;
  signalStillsBuild("SIGSTOP");
  const finish = () => {
    if (finished) return;
    finished = true;
    windowsRunning--;
    if (windowsRunning === 0) signalStillsBuild("SIGCONT");
    if (!res.writableEnded) res.end();
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    unilog(2398, `window from ${startSec}s: first byte ${firstByteMs ?? "never"}ms, ${(bytes / 1e6).toFixed(1)}MB in ${secs}s${closed ? " (client closed)" : ""}: ${path.basename(resolved)}`);
  };
  const start = (vaapi) => {
    child = cp.spawn("ffmpeg", windowArgs(resolved, startSec, audioIndex, vaapi, hdr));
    let lastErr = "";
    child.stdout.on("data", (d) => {
      if (bytes === 0) firstByteMs = Date.now() - startedAt;
      bytes += d.length;
    });
    child.stdout.pipe(res, { end: false });
    child.stderr.on("data", (d) => {
      lastErr = (lastErr + d.toString()).slice(-1000);
    });
    child.on("error", (e) => {
      unilog(2399, `window ffmpeg spawn error: ${e.message}`);
      finish();
    });
    child.on("exit", (code) => {
      if (closed) {
        finish();
        return;
      }
      if (code !== 0 && bytes === 0 && vaapi) {
        unilog(2400, `vaapi window failed, retrying in software: ${path.basename(resolved)}: ${lastErr.slice(-200)}`);
        start(false);
        return;
      }
      if (code !== 0) {
        unilog(2401, `window ffmpeg exit ${code}: ${lastErr.slice(-300)}`);
      }
      finish();
    });
  };
  const kill = () => {
    closed = true;
    if (child && !child.killed) child.kill("SIGKILL");
  };
  req.on("close", kill);
  res.on("close", kill);
  start(true);
}
