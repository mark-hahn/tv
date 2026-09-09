// stills — film-strip stills straight from the original video, and a short
// 480p window transcoded the moment one is clicked. This replaced the mp4
// mirror (mpfour): intro marking and chksrt review used to wait 50–130s for a
// mirror encode before anything could be seen; now the strip is up in 1–20s
// and the video in under a second.
//
// Stills: one every STILL_GAP_SECS over the first STILL_SPAN_SECS, in a single
// ffmpeg pass. The decode is chosen by the source's keyframe spacing. A dense
// source (modern WEB rips keep a keyframe every 2–4s) decodes only I-frames
// (-skip_frame nokey) and takes the keyframe nearest each grid mark — about a
// second for 600s of 2160p hevc, and no picture repeats because the keyframes
// are closer together than the grid. A sparse source (10s keyframes on older
// SD rips and x265 scene encodes) decodes every reference frame instead
// (-skip_frame noref), 5–20s; skipping B-frames outright (bidir) is not an
// option because these streams use them as references and the pictures come
// out corrupt. Builds run one at a time — they share the one GPU decoder and
// two in parallel finish no sooner than two in sequence — with the episode
// someone is opening right now jumping the line.
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
const STILL_SPAN_SECS = 600;
// Twice the 200px the strip renders them at, for hidpi.
const STILL_WIDTH = 400;
const STILL_QUALITY = 4;
// Keyframes this close together or closer make nearest-keyframe stills exact
// enough that no grid mark repeats its neighbour's picture.
const DENSE_MAX_GAP_SECS = STILL_GAP_SECS;
const WINDOW_SECS = 140;
const WINDOW_HEIGHT = 480;
const SIDECAR_NAME = "src.json";

// resolved videoFilePath -> job, for the life of the process.
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
async function validSidecar(dir, srcStat) {
  const sc = await readSidecar(dir);
  if (
    !sc ||
    sc.mtimeMs !== srcStat.mtimeMs ||
    sc.size !== srcStat.size ||
    sc.gapSecs !== STILL_GAP_SECS ||
    sc.spanSecs !== STILL_SPAN_SECS ||
    sc.width !== STILL_WIDTH
  )
    return null;
  return sc;
}

// Duration plus keyframe spacing over the first STILL_SPAN_SECS, one ffprobe.
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
        `%+${STILL_SPAN_SECS}`,
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

function stillsArgs(videoFilePath, dense, vaapi, dir) {
  const scale = vaapi
    ? `scale_vaapi=w=${STILL_WIDTH}:h=-2:format=nv12,hwdownload,format=nv12`
    : `scale=${STILL_WIDTH}:-2`;
  return [
    ...(vaapi ? vaapiInputArgs : []),
    "-skip_frame",
    dense ? "nokey" : "noref",
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

// The Nth image is the grid mark (N-1)*STILL_GAP_SECS, so a set is just a
// count: no rename pass, and the client computes each still's position.
async function buildStills(job) {
  const srcStat = await fsp.stat(job.path);
  await fsp.rm(job.dir, { recursive: true, force: true });
  await fsp.mkdir(job.dir, { recursive: true });
  const { durationSec, keyframes, maxGap } = await probe(job.path);
  job.durationSec = durationSec;
  job.dense = maxGap <= DENSE_MAX_GAP_SECS;
  job.total = Math.ceil(Math.min(durationSec, STILL_SPAN_SECS) / STILL_GAP_SECS);
  const onSpawn = (child) => {
    job.child = child;
  };
  try {
    await runFfmpeg(stillsArgs(job.path, job.dense, true, job.dir), onSpawn);
    job.decode = "vaapi";
  } catch (e) {
    unilog(2395, `vaapi stills failed, retrying in software: ${path.basename(job.path)}: ${e.message.slice(-200)}`);
    await fsp.rm(job.dir, { recursive: true, force: true });
    await fsp.mkdir(job.dir, { recursive: true });
    await runFfmpeg(stillsArgs(job.path, job.dense, false, job.dir), onSpawn);
    job.decode = "software";
  }
  const count = (await fsp.readdir(job.dir)).filter((n) => n.endsWith(".jpg")).length;
  job.total = count;
  await fsp.writeFile(
    path.join(job.dir, SIDECAR_NAME),
    JSON.stringify({
      src: job.path,
      mtimeMs: srcStat.mtimeMs,
      size: srcStat.size,
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
  unilog(2396, `${count} stills (${job.dense ? "nokey" : "noref"}, ${job.decode}, keyframe gap ${maxGap.toFixed(1)}s) in ${secs}s: ${path.basename(job.path)}`);
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
      job.error = e.message;
      unilog(2397, `stills failed for ${path.basename(job.path)}: ${e.message}`);
    })
    .finally(() => {
      job.doneAt = Date.now();
      job.child = null;
      running = null;
      pump();
    });
}

// Make sure this episode's stills exist or are on their way. A valid set on
// disk is adopted without a build; otherwise the build is queued — at the
// front when `urgent` (someone is opening this episode right now), else at the
// back (the sweep over shows that will want an intro). Returns at once; poll
// stillsStatus for progress.
export async function startStills(videoFilePath, { urgent = false } = {}) {
  const resolved = path.resolve(videoFilePath);
  const dir = stillsDirFor(resolved);
  if (!dir) throw new Error("outside the tv tree");
  const existing = jobs.get(resolved);
  if (existing) {
    if (urgent && existing.queued) {
      const at = pending.indexOf(existing);
      if (at > 0) {
        pending.splice(at, 1);
        pending.unshift(existing);
      }
    }
    return existing;
  }
  const job = {
    path: resolved,
    dir,
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
  jobs.set(resolved, job);
  const sc = await validSidecar(dir, await fsp.stat(resolved));
  if (sc) {
    job.queued = false;
    job.startedAt = job.doneAt = Date.now();
    job.total = sc.total;
    job.durationSec = sc.durationSec;
    job.dense = sc.dense;
    job.decode = "cached";
    return job;
  }
  if (urgent) pending.unshift(job);
  else pending.push(job);
  pump();
  return job;
}

// Progress for the client: how many stills exist right now, whether the build
// is finished, and where to fetch them.
export async function stillsStatus(videoFilePath) {
  const resolved = path.resolve(videoFilePath);
  const dir = stillsDirFor(resolved);
  if (!dir) throw new Error("outside the tv tree");
  let count = 0;
  try {
    count = (await fsp.readdir(dir)).filter((n) => n.endsWith(".jpg")).length;
  } catch {
    count = 0;
  }
  const job = jobs.get(resolved);
  return {
    count,
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

function windowArgs(videoFilePath, startSec, audioIndex, vaapi) {
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
    vaapi
      ? `scale_vaapi=w=-2:h=${WINDOW_HEIGHT}:format=nv12,hwdownload,format=nv12`
      : `scale=-2:${WINDOW_HEIGHT}`,
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
export function streamWindow(videoFilePath, startSec, audioIndex, req, res) {
  const resolved = path.resolve(videoFilePath);
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
    child = cp.spawn("ffmpeg", windowArgs(resolved, startSec, audioIndex, vaapi));
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
