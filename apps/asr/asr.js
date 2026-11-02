#!/usr/bin/env node
// --- asr.js portability header (injected) ---
// Force temp files to /tmp regardless of environment
try {
  process.env.TMPDIR = "/tmp";
  process.env.TMP = "/tmp";
  process.env.TEMP = "/tmp";
} catch (_) {}
// -------------------------------------------

// https://docs.speechmatics.com — batch transcription, json-v2 transcript

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { setTimeout as sleep } from "timers/promises";
import {
  unilog,
  setUnilogSink,
  logHere,
  cleanSrt,
  serializeSrt,
  asrCues,
} from "@tv/share";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRVR_LOG_URL = "http://127.0.0.1:8739/api/log";
setUnilogSink(({ logId, ts, message }) => {
  fetch(SRVR_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logId, pid: "tv-asr", ts, message }),
  }).catch(() => {});
});
// The Queues pane reads this child's stdout (subsQueue.js), so stdout is the
// channel for everything the pane shows while a run is going. A run writes only
// three rows to the unilog DB — started, finished, and retries-exhausted — so
// every other progress line goes here and here only.
function pane(msg) {
  process.stdout.write(`[${ts()}] ${msg}\n`);
}

let tmpDir = process.env.ASR_TMPDIR
  ? process.env.ASR_TMPDIR
  : path.join(__dirname, "tmp");

// Ensure tmpDir exists
try {
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
} catch (e) {
  unilog(343, `❌ Unable to create temp directory ${tmpDir}: ${e.message}`);
  // fall back to /tmp if local creation fails
  if (!process.env.ASR_TMPDIR) {
    const fallback = path.join("/tmp", "asr-fallback-" + Date.now());
    fs.mkdirSync(fallback, { recursive: true });
    tmpDir = fallback;
  }
}


// Audio extracted for transcription: 16 kHz mono flac keeps the upload small
// and matches what the engine was evaluated with.
const AUDIO_RATE = "16000";

/* ---------------- API Key and setup ---------------- */
const keyPath = path.join(__dirname, "secrets/speechmatics-key.txt");
let apiKey;
try {
  apiKey = fs.readFileSync(keyPath, "utf8").trim();
} catch (e) {
  unilog(344, `❌ Unable to read API key from ${keyPath}: ${e.message}`);
  process.exit(1);
}


/* ---------------- Speechmatics ---------------- */
// One batch job handles a full video natively, so there is no audio
// splitting. The json-v2 transcript carries measured per-word timings, which
// become the cue timings directly.
const SM_API = "https://asr.api.speechmatics.com/v2";
const SM_OPERATING_POINT = "enhanced";
const SM_POLL_MS = 5000;
// a 46-min episode processed in ~95s; this allows a feature film
const SM_POLL_MAX = 240;
// Set by processOneVideo so the run's unilog rows can name the file even from
// inside the transcription helpers.
let currentVideoName = "";

/* ---------------- format logging timestamp  (HH:MM:SS.t) ---------------- */
let scriptStart = Date.now();
function ts() {
  const secs = Math.floor((Date.now() - scriptStart) / 1000);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0")
  );
}

/* ---------------- Utility functions ---------------- */
async function pathExists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getSrtPath(videoPath) {
  const dir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));
  return path.join(dir, `${baseName}.asr.srt`);
}

// tv-srvr aborts a run by sending SIGTERM here. ffmpeg runs as a child of
// this process, so it is killed explicitly rather than left running after
// the job is gone.
const children = new Set();
let aborting = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    aborting = true;
    for (const child of children) child.kill("SIGKILL");
    process.exit(1);
  });
}

function run(cmd, args, opts = {}) {
  if (aborting) return Promise.reject(new Error("aborted"));
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    children.add(p);
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => {
      children.delete(p);
      reject(e);
    });
    p.on("close", (code) => {
      children.delete(p);
      if (code === 0) {
        resolve({ out, err });
      } else {
        reject(new Error(`${cmd} exited ${code}\n${err || out}`));
      }
    });
  });
}

async function getDurationSec(file) {
  try {
    const { out } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ]);
    const sec = parseFloat(out.trim());
    return Number.isFinite(sec) ? Math.floor(sec) : 0;
  } catch (e) {
    pane(`Warning: Could not get duration for ${file}: ${e.message}`);
    return 0;
  }
}

/* ---------------- Audio processing ---------------- */
async function extractAudio(inputVideo, outFlac) {
  await run("ffmpeg", [
    "-y",
    "-i",
    inputVideo,
    "-map",
    `0:a:${audioTrack}`,
    "-ac",
    "1",
    "-ar",
    AUDIO_RATE,
    "-vn",
    outFlac,
  ]);
}

/* ---------------- Transcription ---------------- */

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 5000;
const RETRY_STATUSES = [429, 500, 502, 503];

// fetch against the Speechmatics API, retrying transient failures.
async function smFetch(url, opts, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    if (attempt > 1) await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 2));
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers: { Authorization: `Bearer ${apiKey}`, ...(opts.headers ?? {}) },
      });
    } catch (err) {
      lastErr = err;
      pane(`${label}: ${err.message} (attempt ${attempt}/${MAX_RETRIES + 1})`);
      continue;
    }
    if (res.ok) return res;
    const body = (await res.text()).slice(0, 300);
    lastErr = new Error(`${label}: ${res.status} ${body}`);
    if (!RETRY_STATUSES.includes(res.status)) break;
    pane(`${label}: ${res.status} (attempt ${attempt}/${MAX_RETRIES + 1})`);
  }
  unilog(2307, `ASR: retries failed "${currentVideoName}"`);
  throw lastErr;
}

// Submit the flac, poll the job to completion, and return the measured word
// timings. Punctuation comes back as separate results and glues onto the
// word before it.
async function transcribeAudio(flacPath, vocab) {
  const form = new FormData();
  const transcription_config = {
    language: "en",
    operating_point: SM_OPERATING_POINT,
  };
  if (vocab.length) {
    transcription_config.additional_vocab = vocab.map((content) => ({
      content,
    }));
  }
  form.append(
    "config",
    JSON.stringify({ type: "transcription", transcription_config }),
  );
  form.append(
    "data_file",
    new Blob([await fsp.readFile(flacPath)]),
    path.basename(flacPath),
  );
  const sub = await smFetch(
    `${SM_API}/jobs`,
    { method: "POST", body: form },
    "speechmatics submit",
  );
  const { id } = await sub.json();
  pane(
    `Submitted job ${id} (${SM_OPERATING_POINT}, ${vocab.length} vocab terms)`,
  );

  for (let i = 0; ; i++) {
    if (i >= SM_POLL_MAX) {
      throw new Error(
        `job ${id} not done after ${(SM_POLL_MS * SM_POLL_MAX) / 1000}s`,
      );
    }
    await sleep(SM_POLL_MS);
    const res = await smFetch(`${SM_API}/jobs/${id}`, {}, "speechmatics poll");
    const { job } = await res.json();
    if (job.status === "done") break;
    if (job.status !== "running" && job.status !== "accepted") {
      throw new Error(`job ${id} status: ${job.status}`);
    }
  }

  const res = await smFetch(
    `${SM_API}/jobs/${id}/transcript?format=json-v2`,
    {},
    "speechmatics transcript",
  );
  const json = await res.json();
  const words = [];
  for (const r of json.results) {
    const content = r.alternatives?.[0]?.content ?? "";
    if (r.type === "word") {
      words.push({ w: content, start: r.start_time, end: r.end_time });
    } else if (r.type === "punctuation" && words.length) {
      words[words.length - 1].w += content;
    }
  }
  return words;
}

// Warn about stretches the transcript has nothing for — either genuinely
// dialogue-free or a sign the engine skipped part of the track.
const GAP_THRESHOLD_SEC = 30;
function reportGaps(cues) {
  let prevEnd = 0;
  for (const cue of cues) {
    const start = cue.startMs / 1000;
    if (start - prevEnd >= GAP_THRESHOLD_SEC) {
      pane(
        `gap of ${Math.round(start - prevEnd)}s with no cues: ` +
          `${toSrtTime(prevEnd)} -> ${toSrtTime(start)}`,
      );
    }
    prevEnd = Math.max(prevEnd, cue.endMs / 1000);
  }
}

function toSrtTime(totalSec) {
  const totalMs = Math.max(0, Math.round(totalSec * 1000));
  const h = String(Math.floor(totalMs / 3600000)).padStart(2, "0");
  const m = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, "0");
  const ms3 = String(totalMs % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${ms3}`;
}

/* ---------------- SRT generation ---------------- */
function writeSRT(cues, outputPath) {
  if (!cues || cues.length === 0) {
    throw new Error(`Video has no segments to write: ${outputPath}`);
  }
  fs.writeFileSync(outputPath, cleanSrt(serializeSrt(cues)), "utf8");
  pane(`Wrote: ${path.basename(outputPath)}`);
}

/* ---------------- Main processing function ---------------- */
async function processOneVideo(videoPath) {
  currentVideoName = path.basename(videoPath);
  unilog(2284, `ASR: starting "${currentVideoName}"`);
  pane(`Processing: ${currentVideoName}`);
  const flacFile = path.join(tmpDir, "audio.flac");
  try {
    await extractAudio(videoPath, flacFile);
    const totalDur = await getDurationSec(flacFile);
    const flacMb = fs.statSync(flacFile).size / 1e6;
    pane(`Duration: ${totalDur}s, uploading ${flacMb.toFixed(1)}MB of audio`);

    const words = await transcribeAudio(flacFile, vocab);
    if (words.length === 0) {
      throw new Error("no words transcribed");
    }
    const cues = asrCues(
      words.map((w) => ({ text: w.w, s: w.start * 1000, e: w.end * 1000 })),
    );
    pane(`Transcribed ${words.length} words into ${cues.length} cues`);
    reportGaps(cues);

    const outputPath = getSrtPath(videoPath);
    writeSRT(cues, outputPath);
    // The word-timed transcript, for tv-srvr to keep (subtitle vetting):
    // [[text, startMs, endMs]], text as the cues show it.
    if (wordsOut)
      await fsp.writeFile(
        wordsOut,
        JSON.stringify(
          words.map((w) => [w.w, Math.round(w.start * 1000), Math.round(w.end * 1000)]),
        ),
        "utf8",
      );
    const summary = `${words.length} words from ${(totalDur / 60).toFixed(1)} min of audio`;
    pane(`Usage: ${summary}`);
    unilog(2308, `ASR: finished, ${summary}`);
  } catch (err) {
    pane(`❌ Failed to process: ${currentVideoName}, ${err.message}`);
    throw err;
  } finally {
    try {
      if (await pathExists(flacFile)) await fsp.unlink(flacFile);
    } catch (_) {}
  }
}

/* ---------------- Entry point ---------------- */

const inputPath = process.argv[2];
if (!inputPath) {
  unilog(367, "No input file");
  process.exit(1);
}
// Optional JSON array of names (characters etc.) sent to Speechmatics as
// additional_vocab so it recognizes them instead of near-homophones.
const vocab = process.argv[3] ? JSON.parse(process.argv[3]) : [];
// Optional: the audio track to transcribe (the video's English one), and
// where to write the word-timed transcript.
const audioTrack = process.argv[4] ? Number(process.argv[4]) : 0;
const wordsOut = process.argv[5] || null;
(async () => {
  await run("ffmpeg", ["-version"]);
  await run("ffprobe", ["-version"]);
  await processOneVideo(path.resolve(inputPath));
})().catch((err) => {
  unilog(368, err.message);
  process.exit(1);
});
