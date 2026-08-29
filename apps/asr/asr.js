#!/usr/bin/env node
// --- asr.js portability header (injected) ---
// Force temp files to /tmp regardless of environment
try {
  process.env.TMPDIR = "/tmp";
  process.env.TMP = "/tmp";
  process.env.TEMP = "/tmp";
} catch (_) {}
// -------------------------------------------

// https://ai.google.dev/gemini-api/docs/audio

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { setTimeout as sleep } from "timers/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { logHere, unilog, setUnilogSink } from "@tv/share";

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


// Audio quality settings
const AUDIO_CONFIGS = {
  low: { rate: 16000, bitrate: "64k" },
  medium: { rate: 22050, bitrate: "128k" },
  high: { rate: 44100, bitrate: "192k" },
  max: { rate: 48000, bitrate: "256k" },
};
const audioConfig = AUDIO_CONFIGS["max"];

/* ---------------- API Key and setup ---------------- */
const keyPath = path.join(__dirname, "secrets/gemini-api-key.txt");
let apiKey;
try {
  apiKey = fs.readFileSync(keyPath, "utf8").trim();
} catch (e) {
  unilog(344, `❌ Unable to read API key from ${keyPath}: ${e.message}`);
  process.exit(1);
}

const GEMINI_MODEL = "gemini-3.6-flash";
const allowedExt = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"]);
const AUDIO_MIME = "audio/flac";
// Gemini processes the whole track in one call, so the flac goes through the
// Files API rather than inline base64 (which caps out around 20MB).
const FILE_POLL_MS = 2000;
const FILE_POLL_MAX = 150;
// Cues come back as a JSON array matching this schema.
const CAPTION_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      start: { type: "string" },
      end: { type: "string" },
      text: { type: "string" },
    },
    required: ["start", "end", "text"],
  },
};

// What bounds a single call is the model's 65,536 output-token cap, not the
// documented 9.5-hour audio cap: a measured run produced 28.7 output tokens per
// second of audio, so 65536 * 0.5 (safety factor) / 28.7 is about 1140s. Longer
// audio is split into parts, each transcribed on its own.
const MAX_PART_SEC = 1140;
// Silence shorter than this is not a candidate cut point.
const SILENCE_MIN_DUR = 0.3;
// silencedetect noise thresholds the search runs between. Strict finds only
// near-total silence (few cuts, long spans); loose counts any quiet moment
// (many cuts, short spans, and a risk of cutting through soft speech).
const SILENCE_DB_STRICT = -50;
const SILENCE_DB_LOOSE = -20;
const SILENCE_SEARCH_ITERS = 8;
// How far from an ideal part boundary a silence may be and still be used. Past
// this the boundary is a hard cut, which can split a word.
const CUT_SNAP_SEC = 90;
// Cues the model places outside the part it was handed are dropped.
const PART_EDGE_TOLERANCE_SEC = 1;

// gemini-3.6-flash paid-tier rates, US dollars per million tokens. Thinking
// tokens bill as output. Both rates double on 2027-01-01.
const COST_PER_MTOK_IN = 0.75;
const COST_PER_MTOK_OUT = 3.75;

// Set by processOneVideo so the run's unilog rows can name the file even from
// inside callApi.
let currentVideoName = "";

const genAI = new GoogleGenerativeAI(apiKey);
const geminiModel = genAI.getGenerativeModel({ model: GEMINI_MODEL });
const fileManager = new GoogleAIFileManager(apiKey);

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

function getStubPath(videoPath) {
  const dir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));
  return path.join(dir, `${baseName}.mb.chosen`);
}

function hasEmbSidecar(videoPath) {
  const dir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const prefix = `${baseName}.mb`;
  try {
    return fs
      .readdirSync(dir)
      .some(
        (f) =>
          f.startsWith(prefix) &&
          /^mb\d+\.srt$/.test(f.slice(baseName.length + 1)),
      );
  } catch {
    return false;
  }
}

function isVideoFile(p) {
  return allowedExt.has(path.extname(p).toLowerCase());
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) {
        resolve({ out, err });
      } else {
        reject(new Error(`${cmd} exited ${code}\n${err || out}`));
      }
    });
  });
}

const ENGLISH_LANG_TAGS = new Set(["eng", "en", "english"]);

// Returns array of subtitle stream objects (english or unknown language only), or null on ffprobe error.
async function getSubtitleStreams(videoPath) {
  try {
    const { out } = await run("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      videoPath,
    ]);
    const streams = JSON.parse(out).streams || [];
    return streams.filter((s) => {
      if (s.codec_type !== "subtitle") return false;
      const lang = (s.tags?.language || "").toLowerCase().trim();
      // Keep stream if language is unknown/unset or is English
      return lang === "" || ENGLISH_LANG_TAGS.has(lang);
    });
  } catch (e) {
    unilog(
      345,
      `Warning: could not probe ${path.basename(videoPath)} for subtitles: ${e.message}`,
    );
    return null;
  }
}

const TEXT_SUB_CODECS = new Set([
  "ass",
  "ssa",
  "subrip",
  "webvtt",
  "mov_text",
  "text",
]);

// Extract each text subtitle stream to an emb<n>.srt sidecar, stripping ASS/font tags.
async function extractTextSubtitles(videoPath, subtitleStreams) {
  const dir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const textStreams = subtitleStreams.filter((s) =>
    TEXT_SUB_CODECS.has(s.codec_name),
  );
  let n = 1;
  for (const stream of textStreams) {
    const srtPath = path.join(dir, `${baseName}.mb${n}.srt`);
    n++;
    if (await pathExists(srtPath)) continue;
    try {
      await run("ffmpeg", [
        "-y",
        "-i",
        videoPath,
        "-map",
        `0:${stream.index}`,
        "-c:s",
        "srt",
        "-f",
        "srt",
        srtPath,
      ]);
      let text = await fsp.readFile(srtPath, "utf8");
      text = text.replace(/\{[^}]*\}/g, "");
      text = text.replace(/<font[^>]*>/gi, "");
      text = text.replace(/<\/font>/gi, "");
      text = text.replace(/<\/?(b|i|u)>/gi, "");
      await fsp.writeFile(srtPath, text, "utf8");
      unilog(
        346,
        `extracted text sub stream ${stream.index} → ${path.basename(srtPath)}`,
      );
    } catch (e) {
      unilog(
        347,
        `failed to extract stream ${stream.index} from ${path.basename(videoPath)}: ${e.message}`,
      );
    }
  }
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
async function extractAudio(inputVideo, outWav) {
  const args = [
    "-y",
    "-i",
    inputVideo,
    "-ac",
    "1",
    "-ar",
    String(audioConfig.rate),
    "-b:a",
    audioConfig.bitrate,
    "-vn",
  ];
  args.push(outWav);
  await run("ffmpeg", args);
}

/*
  filters that change energy floor, spectral content, and dynamic range 
  are what most ASR/VADs use to decide “speech vs. noise.”

   agate=threshold=0.001:ratio=2:attack=10:release=100"

1) agate (noise gate) — biggest lever on VAD
    Why: Directly alters the noise floor and tail of words; 
         too aggressive makes VAD think speech is silence.
    Sweep: threshold: 0.0005 → 0.001 → 0.003 → 0.01 (linear amp; 
           ≈ -66 → -60 → -50.5 → -40 dBFS)  ratio: 2 → 4 → 8
    attack/release: attack=5–20, release=80–300 ms 
          (short attack/release can chop syllables, confusing VAD)
    Baseline on/off test: run once without agate, once with your chosen settings.

0) Baseline:  ffmpeg -i in.wav -ac 1 -ar 16000 -c:a pcm_s16le out-baseline.wav

2) Bandlimit only: 
     ffmpeg -i in.wav -ac 1 -ar 16000 -af "highpass=f=80,lowpass=f=8000" 
            -c:a pcm_s16le out-bandlimit.wav

3) + Gentle compression:
     ffmpeg -i in.wav -ac 1 -ar 16000 
            -af "highpass=f=80,lowpass=f=8000,acompressor=threshold=0.003:ratio=3:attack=20:release=400" 
           -c:a pcm_s16le out-comp.wav

4) + Mild gate:
      ffmpeg -i in.wav -ac 1 -ar 16000 -
      af "highpass=f=80,lowpass=f=8000,acompressor=threshold=0.003:ratio=3:attack=20:release=400,agate=threshold=0.001:ratio=2:attack=10:release=120" 
      -c:a pcm_s16le out-gate.wav

6) Add RNNoise:
    ffmpeg -i in.wav -ac 1 -ar 16000 
    -af "highpass=f=80,lowpass=f=8000,acompressor=threshold=0.003:ratio=3:attack=20:release=400,arnndn=m=./arnndn-models/std.rnnn" 
    -c:a pcm_s16le out-denoise.wav

    # A) arnndn with standard model
    ffmpeg -i in.wav -ac 1 -ar 16000 -af "arnndn=m=./arnndn-models/std.rnnn" out-arnndn.wav
    
    # B) afftdn only
    ffmpeg -i in.wav -ac 1 -ar 16000 -af "afftdn=nf=-25" out-afftdn.wav
    
    # C) baseline (no denoise)
    ffmpeg -i in.wav -ac 1 -ar 16000 -c:a pcm_s16le out-baseline.wav
                        
*/

const AUDIO_FILTER =
  "highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11";

async function preprocessAudio(inputWav, outputWav) {
  await run("ffmpeg", [
    "-y",
    "-i",
    inputWav,
    "-af",
    AUDIO_FILTER,
    "-ac",
    "1",
    "-ar",
    String(audioConfig.rate),
    "-b:a",
    audioConfig.bitrate,
    "-f",
    "wav",
    outputWav,
  ]);
}

/* ---------------- Transcription ---------------- */
// Encode one span of the processed wav to flac. `-ss` goes after `-i` so the
// seek is accurate — every cue timestamp in the part is relative to this start.
async function encodePart(wavPath, start, end, flacPath) {
  await run("ffmpeg", [
    "-y",
    "-i",
    wavPath,
    "-ss",
    start.toFixed(3),
    "-to",
    end.toFixed(3),
    "-c:a",
    "flac",
    flacPath,
  ]);
  return flacPath;
}

// Upload the flac and wait for Gemini to finish processing it.
async function uploadAudio(flacPath) {
  const upload = await fileManager.uploadFile(flacPath, {
    mimeType: AUDIO_MIME,
    displayName: path.basename(flacPath),
  });
  let file = upload.file;
  for (let i = 0; file.state === FileState.PROCESSING && i < FILE_POLL_MAX; i++) {
    await sleep(FILE_POLL_MS);
    file = await fileManager.getFile(file.name);
    pane(`  upload poll ${i + 1}/${FILE_POLL_MAX}: ${file.state}`);
  }
  if (file.state !== FileState.ACTIVE) {
    throw new Error(
      `uploaded audio is ${file.state} after ` +
        `${(FILE_POLL_MAX * FILE_POLL_MS) / 1000}s, not ACTIVE`,
    );
  }
  return { fileData: { mimeType: file.mimeType, fileUri: file.uri } };
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 5000;
const RETRY_STATUSES = [429, 500, 503];

const PROMPT = `Generate accessibility captions (subtitles for the deaf and
hard of hearing) for this audio track. This is the user's own personal media file and
the captions are for their private playback use only.

Listen to the recording and produce one caption cue for each utterance you hear.
Each cue needs a start time, an end time, and the words that were said.

Rules for the cues:
- Times use HH:MM:SS,mmm and must line up with the audio.
- the times must be accurate to 100ms.
- Keep each cue to a single short line or two of dialogue; split long speeches
  into several consecutive cues rather than one long block.
- Cover all audible dialogue, including background and overlapping speech.

Return a JSON array of objects with the fields "start", "end", and "text",
and nothing else.`;

async function callApi(fileData) {
  const apiStart = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await geminiModel.generateContent({
        contents: [{ role: "user", parts: [{ text: PROMPT }, fileData] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: CAPTION_SCHEMA,
        },
      });
      const response = result.response;
      const finish = response.candidates?.[0]?.finishReason ?? "none";
      const usage = response.usageMetadata ?? {};
      pane(
        `Gemini finished: ${finish}, ${usage.totalTokenCount ?? 0} tokens, ` +
          `${Date.now() - apiStart}ms`,
      );
      if (finish !== "STOP") {
        throw new Error(`Gemini stopped early: ${finish}`);
      }
      return { text: response.text(), usage };
    } catch (err) {
      const retryable = RETRY_STATUSES.includes(err.status);
      if (!retryable || attempt > MAX_RETRIES) {
        pane(`Gemini request failed: ${err.message}`);
        unilog(2283, `ASR: gemini retries failed "${currentVideoName}"`);
        throw err;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      pane(
        `Gemini request failed (attempt ${attempt}/${MAX_RETRIES}): ` +
          `${err.status}, retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
}

// Parts are separate calls, so their usage is summed for the run's one row.
function addUsage(total, usage) {
  total.promptTokenCount += usage.promptTokenCount ?? 0;
  total.candidatesTokenCount += usage.candidatesTokenCount ?? 0;
  total.thoughtsTokenCount += usage.thoughtsTokenCount ?? 0;
  return total;
}

// Token counts and what they cost, as one string both the pane and the run's
// finished row use: `in 17113, out 19446 (7750 thinking), $0.0858`.
function formatUsage(usage) {
  const inTok = usage.promptTokenCount ?? 0;
  const cueTok = usage.candidatesTokenCount ?? 0;
  const thinkTok = usage.thoughtsTokenCount ?? 0;
  const outTok = cueTok + thinkTok;
  const cost =
    (inTok * COST_PER_MTOK_IN + outTok * COST_PER_MTOK_OUT) / 1_000_000;
  return `in ${inTok}, out ${outTok} (${thinkTok} thinking), $${cost.toFixed(4)}`;
}

// Gemini returns "HH:MM:SS,mmm" (or with a period) — convert to seconds.
function srtTimeToSec(timeStr) {
  const parts = String(timeStr).replace(",", ".").split(":");
  if (parts.length !== 3) {
    throw new Error(`invalid time format: ${timeStr}`);
  }
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);
  if (!Number.isFinite(hours + minutes + seconds)) {
    throw new Error(`invalid time format: ${timeStr}`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

// Pull the JSON array of cues out of the response and turn it into segments.
function processSegments(responseText) {
  let jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("could not find JSON in Gemini response");
  }
  let cues;
  try {
    cues = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`invalid JSON in Gemini response: ${e.message}`);
  }
  if (!Array.isArray(cues)) cues = [cues];

  const segments = [];
  for (const cue of cues) {
    if (!cue.text?.trim()) continue;
    try {
      segments.push({
        start: srtTimeToSec(cue.start),
        end: srtTimeToSec(cue.end),
        text: cue.text.trim(),
      });
    } catch (e) {
      pane(`skipping cue with bad timing: ${e.message}`);
    }
  }
  return segments;
}

// Warn about stretches the model returned nothing for — usually a sign it
// skipped part of the track rather than the show actually being silent.
const GAP_THRESHOLD_SEC = 30;
function reportGaps(segments) {
  let prevEnd = 0;
  for (const seg of segments) {
    if (seg.start - prevEnd >= GAP_THRESHOLD_SEC) {
      pane(
        `gap of ${Math.round(seg.start - prevEnd)}s with no cues: ` +
          `${toSrtTime(prevEnd)} -> ${toSrtTime(seg.start)}`,
      );
    }
    prevEnd = Math.max(prevEnd, seg.end);
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

/* ---------------- Splitting long audio ---------------- */

// Midpoints of every detected silence, which are the only places a part
// boundary may fall. silencedetect reports on stderr.
async function detectSilences(wavPath, noiseDb, minDur) {
  const { err } = await run("ffmpeg", [
    "-i",
    wavPath,
    "-af",
    `silencedetect=noise=${noiseDb}dB:duration=${minDur}`,
    "-f",
    "null",
    "-",
  ]);
  const starts = [];
  const ends = [];
  for (const line of err.split("\n")) {
    let m = line.match(/silence_start:\s*([\d.]+)/);
    if (m) {
      starts.push(parseFloat(m[1]));
      continue;
    }
    m = line.match(/silence_end:\s*([\d.]+)/);
    if (m) ends.push(parseFloat(m[1]));
  }
  const midpoints = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    midpoints.push((starts[i] + ends[i]) / 2);
  }
  return midpoints;
}

// The longest stretch between adjacent cut candidates. A span is atomic — no
// grouping can put it in a part shorter than itself — so this is what decides
// whether a legal split exists at all.
function maxSpan(midpoints, totalDur) {
  const cuts = [0, ...midpoints, totalDur];
  let longest = 0;
  for (let i = 1; i < cuts.length; i++) {
    longest = Math.max(longest, cuts[i] - cuts[i - 1]);
  }
  return longest;
}

// Ideal part boundaries: equal-length targets. Splitting evenly beats greedily
// filling parts, which leaves a runt final part whose per-call thinking tokens
// are wasted. Boundaries depend only on duration, so they are known before any
// silence is detected.
function partTargets(totalDur) {
  const nParts = Math.ceil(totalDur / MAX_PART_SEC);
  const targets = [];
  for (let k = 1; k < nParts; k++) targets.push((k * totalDur) / nParts);
  return { nParts, targets };
}

// How many target boundaries have a cut candidate close enough to snap to.
function coveredTargets(midpoints, targets) {
  return targets.filter((t) =>
    midpoints.some((m) => Math.abs(m - t) <= CUT_SNAP_SEC),
  ).length;
}

// Find the strictest silence threshold that puts a cut candidate near every
// target boundary. Strictest is preferred because a loose threshold calls soft
// speech "silence" and cuts through a word — but strict alone is not enough:
// maxSpan only asks whether some legal partition exists, which is satisfied
// trivially and would settle on a threshold with too few candidates to snap to.
async function findCutCandidates(wavPath, totalDur, targets) {
  let lo = SILENCE_DB_STRICT;
  let hi = SILENCE_DB_LOOSE;
  let best = null;
  let bestThreshold = hi;
  for (let i = 0; i < SILENCE_SEARCH_ITERS; i++) {
    const threshold = (lo + hi) / 2;
    const midpoints = await detectSilences(
      wavPath,
      threshold.toFixed(1),
      SILENCE_MIN_DUR,
    );
    const longest = maxSpan(midpoints, totalDur);
    const covered = coveredTargets(midpoints, targets);
    pane(
      `  silence pass ${i + 1}/${SILENCE_SEARCH_ITERS}: ` +
        `${threshold.toFixed(1)}dB, ${midpoints.length} silences, ` +
        `longest span ${longest.toFixed(0)}s, ` +
        `${covered}/${targets.length} boundaries covered`,
    );
    if (longest > MAX_PART_SEC || covered < targets.length) {
      lo = threshold; // not enough cuts where they are needed — loosen
    } else {
      best = midpoints; // keep the candidates that actually passed
      bestThreshold = threshold;
      hi = threshold; // try stricter
    }
  }
  if (!best) {
    best = await detectSilences(
      wavPath,
      String(SILENCE_DB_LOOSE),
      SILENCE_MIN_DUR,
    );
    bestThreshold = SILENCE_DB_LOOSE;
  }
  pane(
    `silence: threshold=${bestThreshold.toFixed(1)}dB, ` +
      `${best.length} cut candidates, longest span ` +
      `${maxSpan(best, totalDur).toFixed(0)}s, ` +
      `${coveredTargets(best, targets)}/${targets.length} boundaries covered`,
  );
  return best;
}

// Snap each ideal boundary to the nearest silence, falling back to a hard cut
// when the search could not find one close enough.
function planParts(midpoints, totalDur, targets) {
  if (targets.length === 0) return [{ start: 0, end: totalDur }];

  const bounds = [0];
  let hardCuts = 0;
  for (const want of targets) {
    const prev = bounds[bounds.length - 1];
    let nearest = null;
    let nearestDist = Infinity;
    for (const m of midpoints) {
      if (m <= prev) continue;
      const dist = Math.abs(m - want);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = m;
      }
    }
    if (nearest === null || nearestDist > CUT_SNAP_SEC) {
      hardCuts++;
      bounds.push(Math.max(want, prev + 1));
    } else {
      bounds.push(nearest);
    }
  }
  bounds.push(totalDur);

  if (hardCuts > 0) {
    pane(
      `${hardCuts} hard cut(s): no silence near the boundary, a word may split`,
    );
  }

  const parts = [];
  for (let i = 1; i < bounds.length; i++) {
    parts.push({ start: bounds[i - 1], end: bounds[i] });
  }
  return parts;
}

// Transcribe one part and shift its cues onto the full recording's timeline.
async function transcribePart(wavPath, part, index, count) {
  const flacPath = path.join(
    tmpDir,
    `part-${String(index).padStart(3, "0")}.flac`,
  );
  await encodePart(wavPath, part.start, part.end, flacPath);
  const flacMb = fs.statSync(flacPath).size / 1e6;
  const label = count > 1 ? `part ${index + 1}/${count} ` : "";
  pane(
    `Uploading ${label}${flacMb.toFixed(1)}MB of audio to Gemini ` +
      `(${part.start.toFixed(0)}s-${part.end.toFixed(0)}s)`,
  );
  const fileData = await uploadAudio(flacPath);

  pane(`Transcribing ${label}with ${GEMINI_MODEL}`);
  const { text, usage } = await callApi(fileData);

  // Cues are relative to the part, so shift them; drop anything the model
  // placed outside the audio it was actually given.
  const partDur = part.end - part.start;
  const segments = [];
  for (const seg of processSegments(text)) {
    if (seg.end <= seg.start) continue;
    if (seg.start < -PART_EDGE_TOLERANCE_SEC) continue;
    if (seg.start > partDur + PART_EDGE_TOLERANCE_SEC) continue;
    segments.push({
      start: part.start + seg.start,
      end: part.start + seg.end,
      text: seg.text,
    });
  }
  return { segments, usage, flacPath };
}

/* ---------------- SRT generation ---------------- */
function writeSRT(segments, outputPath) {
  if (!segments || segments.length === 0) {
    throw new Error(`Video has no segments to write: ${outputPath}`);
  }
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  let srtContent = "";
  let index = 0;
  for (const seg of sorted) {
    srtContent += `${++index}\n`;
    srtContent += `${toSrtTime(seg.start)} --> ${toSrtTime(seg.end)}\n`;
    srtContent += `${seg.text}\n\n`;
  }
  fs.writeFileSync(outputPath, srtContent, "utf8");
  pane(`Wrote: ${path.basename(outputPath)}`);
}

/* ---------------- Main processing function ---------------- */
async function processOneVideo(videoPath) {
  currentVideoName = path.basename(videoPath);
  unilog(2284, `ASR: starting "${currentVideoName}"`);
  pane(`Processing: ${currentVideoName}`);
  const rawWavFile = path.join(tmpDir, "audio_raw.wav");
  const processedWavFile = path.join(tmpDir, "audio_processed.wav");
  const partFiles = [];
  try {
    await extractAudio(videoPath, rawWavFile);
    pane(`Preprocessing audio...`);
    await preprocessAudio(rawWavFile, processedWavFile);
    const totalDur = await getDurationSec(processedWavFile);
    pane(`Duration: ${totalDur.toFixed(0)}s`);

    // One call per part. Anything inside the output-token budget stays a
    // single call and never runs the silence search.
    let parts;
    const { nParts, targets } = partTargets(totalDur);
    if (nParts <= 1) {
      parts = [{ start: 0, end: totalDur }];
    } else {
      pane(`Longer than ${MAX_PART_SEC}s, splitting on silence`);
      const midpoints = await findCutCandidates(
        processedWavFile,
        totalDur,
        targets,
      );
      parts = planParts(midpoints, totalDur, targets);
      pane(
        `split into ${parts.length} parts: ` +
          parts
            .map((p) => `${p.start.toFixed(0)}-${p.end.toFixed(0)}s`)
            .join(", "),
      );
    }

    const segments = [];
    const usage = {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 0,
    };
    for (let i = 0; i < parts.length; i++) {
      const part = await transcribePart(
        processedWavFile,
        parts[i],
        i,
        parts.length,
      );
      partFiles.push(part.flacPath);
      segments.push(...part.segments);
      addUsage(usage, part.usage);
      if (parts.length > 1) {
        pane(`part ${i + 1}/${parts.length}: ${part.segments.length} cues`);
      }
    }

    if (segments.length === 0) {
      throw new Error("No transcription segments found");
    }
    pane(`Transcribed ${segments.length} cues`);
    reportGaps(segments);

    const outputPath = getSrtPath(videoPath);
    writeSRT(segments, outputPath);
    const usageText = formatUsage(usage);
    pane(`Usage: ${parts.length} call(s), ${usageText}`);
    unilog(2287, `ASR: finished, ${usageText}`);
  } catch (err) {
    pane(`❌ Failed to process: ${currentVideoName}, ${err.message}`);
    throw err;
  } finally {
    // Cleanup
    try {
      if (await pathExists(rawWavFile)) await fsp.unlink(rawWavFile);
      if (await pathExists(processedWavFile))
        await fsp.unlink(processedWavFile);
      for (const f of partFiles) {
        if (await pathExists(f)) await fsp.unlink(f);
      }
    } catch (_) {}
  }
}

/* ---------------- Entry point ---------------- */

const inputPath = process.argv[2];
if (!inputPath) {
  unilog(367, "No input file");
  process.exit(1);
}
(async () => {
  await run("ffmpeg", ["-version"]);
  await run("ffprobe", ["-version"]);
  await processOneVideo(path.resolve(inputPath));
})().catch((err) => {
  unilog(368, err.message);
  process.exit(1);
});
