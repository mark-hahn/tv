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
  process.stdout.write(msg + "\n");
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
async function getFlac(wavPath) {
  const flacPath = path.join(tmpDir, path.basename(wavPath, ".wav") + ".flac");
  await run("ffmpeg", ["-y", "-i", wavPath, "-c:a", "flac", flacPath]);
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
  }
  if (file.state !== FileState.ACTIVE) {
    throw new Error(`uploaded audio is ${file.state}, not ACTIVE`);
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
      const used = response.usageMetadata?.totalTokenCount ?? 0;
      pane(
        `Gemini finished: ${finish}, ${used} tokens, ${Date.now() - apiStart}ms`,
      );
      if (finish !== "STOP") {
        throw new Error(`Gemini stopped early: ${finish}`);
      }
      return response.text();
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
  pane(`[${ts()}] Wrote: ${path.basename(outputPath)}`);
}

/* ---------------- Main processing function ---------------- */
async function processOneVideo(videoPath) {
  currentVideoName = path.basename(videoPath);
  unilog(2284, `ASR: starting "${currentVideoName}"`);
  pane(`[${ts()}] Processing: ${currentVideoName}`);
  const rawWavFile = path.join(tmpDir, "audio_raw.wav");
  const processedWavFile = path.join(tmpDir, "audio_processed.wav");
  let flacFile = null;
  try {
    await extractAudio(videoPath, rawWavFile);
    pane(`Preprocessing audio...`);
    await preprocessAudio(rawWavFile, processedWavFile);
    const totalDur = await getDurationSec(processedWavFile);
    pane(`Duration: ${totalDur.toFixed(0)}s, encoding flac`);

    flacFile = await getFlac(processedWavFile);
    const flacMb = fs.statSync(flacFile).size / 1e6;
    pane(`Uploading ${flacMb.toFixed(1)}MB of audio to Gemini`);
    const fileData = await uploadAudio(flacFile);

    pane(`Transcribing with ${GEMINI_MODEL}`);
    const responseText = await callApi(fileData);
    const segments = processSegments(responseText);
    if (segments.length === 0) {
      throw new Error("No transcription segments found");
    }
    pane(`Transcribed ${segments.length} cues`);
    reportGaps(segments);

    const outputPath = getSrtPath(videoPath);
    writeSRT(segments, outputPath);
    unilog(2285, `ASR: finished "${currentVideoName}"`);
  } catch (err) {
    pane(`❌ Failed to process: ${currentVideoName}, ${err.message}`);
    throw err;
  } finally {
    // Cleanup
    try {
      if (await pathExists(rawWavFile)) await fsp.unlink(rawWavFile);
      if (await pathExists(processedWavFile))
        await fsp.unlink(processedWavFile);
      if (flacFile && (await pathExists(flacFile))) await fsp.unlink(flacFile);
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
