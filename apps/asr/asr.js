#!/usr/bin/env node
// --- asr.js portability header (injected) ---
// Force temp files to /tmp regardless of environment
try {
  process.env.TMPDIR = "/tmp";
  process.env.TMP = "/tmp";
  process.env.TEMP = "/tmp";
} catch (_) {}
// -------------------------------------------

// https://docs.mistral.ai/capabilities/audio/
// https://console.mistral.ai/usage

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { setTimeout as sleep } from "timers/promises";
import axios from "axios";
import FormData from "form-data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let tmpDir = process.env.ASR_TMPDIR
  ? process.env.ASR_TMPDIR
  : path.join(__dirname, "tmp");

// Ensure tmpDir exists
try {
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
} catch (e) {
  console.error(`❌ Unable to create temp directory ${tmpDir}: ${e.message}`);
  // fall back to /tmp if local creation fails
  if (!process.env.ASR_TMPDIR) {
    const fallback = path.join("/tmp", "asr-fallback-" + Date.now());
    fs.mkdirSync(fallback, { recursive: true });
  }
}

/* ---------------- CLI argument parsing ---------------- */
const rawArgs = process.argv.slice(2);

const flagsKVP = new Map(
  rawArgs
    .filter((a) => a.startsWith("--") && a.includes("="))
    .map((a) => {
      const eq = a.indexOf("=");
      return [a.slice(0, eq), a.slice(eq + 1)];
    }),
);
const switches = new Set(
  rawArgs.filter((a) => a.startsWith("--") && !a.includes("=")),
);
const positional = rawArgs.filter((a) => !a.startsWith("--"));

function getNum(name, dflt) {
  if (flagsKVP.has(name)) return Number(flagsKVP.get(name));
  return dflt;
}
const timeMatchMgn = getNum("--time-match-mgn", 0.3);
const testMins = getNum("--test-mins", 0);
const audioQuality = flagsKVP.get("--audio-quality") || "max";

const apiTemperature = getNum("--temperature", 0);
const apiResponseFormat = flagsKVP.get("--response-format") || "verbose_json";
const apiPrompt = flagsKVP.get("--prompt") || null;
const runBackground = switches.has("--background");
const dumpRawArg = flagsKVP.get("--dump-raw") || null;
const DUMP_RAW_API = dumpRawArg !== null;
const effectiveDumpPath = dumpRawArg;
if (DUMP_RAW_API) fs.writeFileSync(effectiveDumpPath, "", "utf8"); // truncate on start

// Audio quality settings
const AUDIO_CONFIGS = {
  low: { rate: 16000, bitrate: "64k" },
  medium: { rate: 22050, bitrate: "128k" },
  high: { rate: 44100, bitrate: "192k" },
  max: { rate: 48000, bitrate: "256k" },
};
const audioConfig = AUDIO_CONFIGS[audioQuality];

/* ---------------- Input validation ---------------- */
if (!runBackground && positional.length === 0) {
  console.error("❌ Error: No input file specified");
  process.exit(1);
}
const inputPath = runBackground ? "" : path.resolve(positional[0]);

/* ---------------- API Key and setup ---------------- */
const keyPath = path.join(__dirname, "secrets/mistral-asr-key.txt");
let apiKey;
try {
  apiKey = fs.readFileSync(keyPath, "utf8").trim();
} catch (e) {
  console.error(`❌ Unable to read API key from ${keyPath}: ${e.message}`);
  process.exit(1);
}

const model = "voxtral-mini-latest";
const allowedExt = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"]);
const FILE_LIMIT_BYTES = 24 * 1024 * 1024;
// Conservative starting estimate of FLAC bytes/sec for processed speech.
// Will be updated via EMA as chunks are processed.
const ADAPTIVE_INITIAL_BPS = 45000;

/* ---------------- Background processing constants ---------------- */
const TV_ROOT = "/mnt/media/tv";
const TVDB_JSON_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json";
const BKGND_LOG_PATH = path.join(__dirname, "data", "asr-bkgnd.log");
const PENDING_PATH = path.join(__dirname, "data", "pending.txt");
const BKGND_TMPDIR = "/tmp/asr-bkgnd";
const CPU_LOAD_MAX = 3;
const TEST_SHOWS = null;
const CPU_PAUSE_MS = 10_000;
const PAUSE_DURATION_MS = 10 * 60_000;
const PAUSE_POLL_MS = 15_000;

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
  return path.join(dir, `${baseName}.enx.srt`);
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
    console.warn(`Warning: Could not get duration for ${file}: ${e.message}`);
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
  if (testMins > 0) args.push("-t", String(testMins * 60));
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
  flagsKVP.get("--audio-filter") ||
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
  const statSize = (await fsp.stat(flacPath)).size;
  if (statSize > FILE_LIMIT_BYTES) {
    const err = new Error(
      `FLAC too large: ${(statSize / 1e6).toFixed(1)}MB > ${(FILE_LIMIT_BYTES / 1e6).toFixed(0)}MB`,
    );
    err.code = "FLAC_TOO_LARGE";
    err.size = statSize;
    throw err;
  }
  return {
    path: flacPath,
    mime: "audio/flac",
    filename: path.basename(flacPath),
    size: statSize,
  };
}

async function extractChunkWav(inWav, start, end, outWav) {
  await run("ffmpeg", [
    "-y",
    "-i",
    inWav,
    "-ss",
    start.toFixed(2),
    "-to",
    end.toFixed(2),
    "-c:a",
    "pcm_s16le",
    "-avoid_negative_ts",
    "make_zero",
    outWav,
  ]);
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 5000;
const API_TIMEOUT = 120000; // 2 mins

async function callApi(uploadInfo) {
  const buf = await fsp.readFile(uploadInfo.path);
  const apiStart = Date.now();
  let attempt = 0;
  while (true) {
    const form = new FormData();
    form.append("file", buf, {
      filename: uploadInfo.filename,
      contentType: uploadInfo.mime,
    });
    form.append("model", model);
    // Timestamps are incompatible with language prediction on the API.
    // If we're requesting timestamps, omit the `language` field (treat as None)
    // and explicitly set return_language=false to disable language prediction.
    form.append("return_language", "false");
    // The API expects a plain 'segment' value for timestamp_granularities
    // when submitted via multipart/form-data. Append the plain string.
    form.append("timestamp_granularities", "segment");
    form.append("response_format", apiResponseFormat);
    form.append("temperature", String(apiTemperature));
    if (apiPrompt) form.append("prompt", apiPrompt);
    attempt++;
    let response = null;
    try {
      response = await axios.post(
        "https://api.mistral.ai/v1/audio/transcriptions",
        form,
        {
          headers: { Authorization: `Bearer ${apiKey}`, ...form.getHeaders() },
          timeout: API_TIMEOUT,
        },
      );
      // Log successful response (trim audio bytes)
    } catch (err) {
      // err may be an AxiosError with response data
      const status = err?.response?.status || err.message || "unknown";
      const body = err?.response?.data || err?.toString();
      console.error(
        `[${ts()}] API request failed (attempt ${attempt}): ${status}`,
      );
      if (body) console.error(JSON.stringify(body));
      if (attempt > MAX_RETRIES) {
        throw new Error(`max retries reached after ${attempt} attempts`);
      }
      console.error(`[${ts()}] Retrying...`);
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
      continue;
    }
    if (response && response.status === 200) {
      response.data.delay = Date.now() - apiStart;
      return response.data;
    }
    // Non-200 but no exception (unlikely) — log and retry
    const status = response?.status || "unknown";
    console.error(`[${ts()}] API error: ${status}, retrying`);
    if (attempt == 1)
      console.log(
        "chunk, size:",
        uploadInfo.size,
        "- file:",
        uploadInfo.filename,
      );
    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
    await sleep(delay);
    continue;
  }
}
function processSegments(segments, chunkInfo) {
  if (!segments || segments.length === 0) return [];
  const processedSegments = [];
  for (const segment of segments) {
    if (
      segment.start === undefined ||
      segment.end === undefined ||
      !segment.text?.trim()
    ) {
      console.warn(
        `[warn] skipping invalid segment in chunk ${chunkInfo.chunkIndex}:`,
        JSON.stringify(segment),
      );
      continue;
    }
    const start = chunkInfo.chunkStart + segment.start;
    const end = chunkInfo.chunkStart + segment.end;

    const processedSegment = {
      start,
      end,
      text: segment.text.trim(),
      chunk: chunkInfo,
    };
    if (start > chunkInfo.trimStart && start < chunkInfo.trimEnd)
      processedSegments.push(processedSegment);
  }
  return processedSegments;
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
  const sortedSegments = segments.sort((a, b) => a.start - b.start);

  // Helper: normalize text for comparisons (lowercase, remove punctuation,
  // collapse whitespace). We keep original text for output but use normalized
  // form to detect duplicates/repeats.
  function normalizeText(s) {
    if (!s) return "";
    // remove most punctuation but keep apostrophes; collapse whitespace
    const cleaned = s
      .toLowerCase()
      .replace(/[^\w\s'’]/g, " ")
      .replace(/_+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned;
  }

  // First pass: basic overlap de-dup as before, but preserve original text
  // and attach normalized text for later merging heuristics.
  let lastStart = +1e9;
  let lastEnd = -1e9;
  let lastText = null;
  let skipSeg;
  let hadDuplicate = false;
  const segOut = [];
  for (const segment of sortedSegments) {
    const start = segment.start;
    const end = segment.end;
    const text = segment.text.trim();
    try {
      skipSeg = true;
      if (text.length == 0) continue;
      const leftMatch = Math.abs(start - lastStart) < timeMatchMgn;
      const rightMatch = Math.abs(end - lastEnd) < timeMatchMgn;
      if (leftMatch || rightMatch) {
        hadDuplicate = true;
        if (text === lastText) continue;
        if (text.length > lastText.length) {
          continue;
        }
        segOut.pop();
      }
      skipSeg = false;
    } finally {
      if (!skipSeg)
        segOut.push({ start, end, text, norm: normalizeText(text) });
      if (!hadDuplicate) {
        lastStart = start;
        lastEnd = end;
        lastText = text;
      } else lastStart = lastEnd = -1;
      hadDuplicate = false;
    }
  }

  // Second pass: merge adjacent/overlapping segments based on normalized text
  // and collapse runs of short repeated single-token captions.
  const mergedSegs = [];
  const GAP_TOL = 2.0; // seconds - normal gap tolerance
  const SHORT_SEG_MAX_DUR = 2.0; // seconds - consider a segment "short"
  const SHORT_SEG_GAP = 5.0; // seconds - allow joining short repeated segments across this gap
  const SINGLE_TOKEN_WINDOW = 30.0; // seconds - window to collapse repeated single-token captions

  for (const seg of segOut) {
    if (mergedSegs.length === 0) {
      mergedSegs.push({ ...seg });
      continue;
    }
    const last = mergedSegs[mergedSegs.length - 1];
    const gap = seg.start - last.end;
    const segDur = seg.end - seg.start;
    const lastDur = last.end - last.start;
    const lastNorm = last.norm || normalizeText(last.text);
    const segNorm = seg.norm || normalizeText(seg.text);

    let shouldMerge = false;
    if (segNorm === lastNorm && segNorm.length > 0) {
      // Overlap or small gap
      if (seg.start <= last.end + GAP_TOL) shouldMerge = true;
      // Short repeated segments across a slightly larger gap
      else if (
        segDur <= SHORT_SEG_MAX_DUR &&
        lastDur <= SHORT_SEG_MAX_DUR &&
        gap <= SHORT_SEG_GAP
      )
        shouldMerge = true;
      // Single-token repeated captions across a larger window
      else {
        const lastTokens = lastNorm.split(" ").filter(Boolean).length;
        const segTokens = segNorm.split(" ").filter(Boolean).length;
        if (lastTokens === 1 && segTokens === 1 && gap <= SINGLE_TOKEN_WINDOW)
          shouldMerge = true;
      }
    }

    if (shouldMerge) {
      // Merge into last: extend time bounds and prefer the longer original text
      last.end = Math.max(last.end, seg.end);
      last.start = Math.min(last.start, seg.start);
      // Keep original text from the first occurrence (usually fine) but
      // if incoming has more characters, prefer that (richer text)
      if (seg.text.length > last.text.length) last.text = seg.text;
      // Refresh normalized form
      last.norm = segNorm;
    } else {
      mergedSegs.push({ ...seg });
    }
  }

  // Final pass: remove pathological runs where a single short token repeats
  // many times (e.g., repeated "Kanye" one-second captions). Collapse runs
  // that are the same normalized single token into a single caption covering
  // their span.
  const finalSegs = [];
  for (const seg of mergedSegs) {
    if (finalSegs.length === 0) {
      finalSegs.push({ ...seg });
      continue;
    }
    const last = finalSegs[finalSegs.length - 1];
    const lastNorm = last.norm || normalizeText(last.text);
    const segNorm = seg.norm || normalizeText(seg.text);
    const lastTokens = lastNorm.split(" ").filter(Boolean).length;
    const segTokens = segNorm.split(" ").filter(Boolean).length;
    const gap = seg.start - last.end;
    // If both are single-token identical normalized and within a moderate window, collapse
    if (
      lastNorm === segNorm &&
      lastTokens === 1 &&
      segTokens === 1 &&
      gap <= SINGLE_TOKEN_WINDOW
    ) {
      last.end = Math.max(last.end, seg.end);
      // prefer longer/original text for display
      if (seg.text.length > last.text.length) last.text = seg.text;
      continue;
    }
    finalSegs.push({ ...seg });
  }

  // Split segments that are longer than 60 chars into smaller chunks
  // with linearly interpolated timestamps.
  const MAX_CHARS = 60;
  const splitSegs = [];
  for (const seg of finalSegs) {
    if (seg.text.length <= MAX_CHARS) {
      splitSegs.push(seg);
      continue;
    }
    const words = seg.text.trim().split(/\s+/);
    const totalDur = seg.end - seg.start;
    const totalWords = words.length;
    const numChunks = Math.ceil(seg.text.length / MAX_CHARS);
    const baseSize = Math.floor(totalWords / numChunks);
    const remainder = totalWords % numChunks;
    let wordOffset = 0;
    for (let i = 0; i < numChunks; i++) {
      const chunkSize = baseSize + (i < remainder ? 1 : 0);
      const chunkWords = words.slice(wordOffset, wordOffset + chunkSize);
      const chunkStart = seg.start + (wordOffset / totalWords) * totalDur;
      const chunkEnd =
        seg.start + ((wordOffset + chunkSize) / totalWords) * totalDur;
      splitSegs.push({
        start: chunkStart,
        end: chunkEnd,
        text: chunkWords.join(" "),
      });
      wordOffset += chunkSize;
    }
  }

  // Pad short segments (< 1s) up to 0.5s on each side,
  // staying at least 0.2s away from neighboring segments.
  for (let i = 0; i < splitSegs.length; i++) {
    const seg = splitSegs[i];
    if (seg.end - seg.start >= 1.0) continue;
    const prevEnd = i > 0 ? splitSegs[i - 1].end : 0;
    const nextStart = i < splitSegs.length - 1 ? splitSegs[i + 1].start : null;
    const leftPad = Math.max(0, Math.min(0.5, seg.start - prevEnd - 0.2));
    const rightPad = Math.max(
      0,
      Math.min(0.5, nextStart !== null ? nextStart - seg.end - 0.2 : 0.5),
    );
    seg.start -= leftPad;
    seg.end += rightPad;
  }

  // Write SRT from splitSegs using original (prefer first occurrence) text
  let srtContent = "";
  let index = 0;
  for (const seg of splitSegs) {
    const startTime = toSrtTime(seg.start);
    const endTime = toSrtTime(seg.end);
    srtContent += `${++index}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${seg.text}\n\n`;
  }
  fs.writeFileSync(outputPath, srtContent, "utf8");
  console.log(`\n[${ts()}] Wrote: ${path.basename(outputPath)}`);
}

/* ---------------- VAD-based chunking ---------------- */
async function detectSilences(wavPath, noiseDb, minDur) {
  // silencedetect output goes to stderr
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

async function vadChunks(wavPath, initBPS, totalDur) {
  const TARGET = FILE_LIMIT_BYTES * 0.93;
  const SILENCE_MIN_DUR = 0.3;
  // Binary search: lo=-50dB (strict, few cuts), hi=-20dB (loose, many cuts)
  // Find strictest threshold where every speech span fits in TARGET.
  let lo = -50,
    hi = -20;
  let bestMidpoints = null;
  let bestThreshold = hi;
  for (let iter = 0; iter < 8; iter++) {
    const threshold = (lo + hi) / 2;
    const midpoints = await detectSilences(
      wavPath,
      threshold.toFixed(1),
      SILENCE_MIN_DUR,
    );
    const cuts = [0, ...midpoints, totalDur];
    let maxSpan = 0;
    for (let i = 1; i < cuts.length; i++)
      maxSpan = Math.max(maxSpan, cuts[i] - cuts[i - 1]);
    if (maxSpan * initBPS > TARGET) {
      // spans still too big — need more cuts — loosen threshold (raise dB)
      lo = threshold;
    } else {
      // fits — try stricter
      bestMidpoints = midpoints;
      bestThreshold = threshold;
      hi = threshold;
    }
  }
  // Fallback: if no threshold worked, use -20dB (maximum looseness)
  if (!bestMidpoints) {
    bestMidpoints = await detectSilences(wavPath, "-20", SILENCE_MIN_DUR);
    bestThreshold = -20;
  }
  // Greedy combine: merge consecutive silence-delimited spans into chunks <= TARGET
  const cuts = [0, ...bestMidpoints, totalDur];
  const chunks = [];
  let segStart = cuts[0];
  let segEst = 0;
  for (let i = 1; i < cuts.length; i++) {
    const spanEst = (cuts[i] - cuts[i - 1]) * initBPS;
    if (segEst + spanEst > TARGET && segEst > 0) {
      chunks.push({ start: segStart, end: cuts[i - 1] });
      segStart = cuts[i - 1];
      segEst = spanEst;
    } else {
      segEst += spanEst;
    }
  }
  chunks.push({ start: segStart, end: totalDur });
  const maxEst = Math.max(...chunks.map((c) => (c.end - c.start) * initBPS));
  console.log(
    `[${ts()}] VAD: threshold=${bestThreshold.toFixed(1)}dB, ` +
      `${bestMidpoints.length} silences → ${chunks.length} chunks ` +
      `(max est ${(maxEst / 1e6).toFixed(1)}MB)`,
  );
  return chunks;
}

/* ---------------- Main processing function ---------------- */
async function processOneVideo(videoPath) {
  const fileStart = Date.now();
  console.log(`\n[${ts()}] Processing: ${path.basename(videoPath)}`);
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const srtPath = getSrtPath(videoPath);
  if (await pathExists(srtPath)) {
    console.log(`\n${videoName}: Enhanced SRT already exists, skipping.`);
    return;
  }
  const rawWavFile = path.join(tmpDir, "audio_raw.wav");
  const processedWavFile = path.join(tmpDir, "audio_processed.wav");
  try {
    await extractAudio(videoPath, rawWavFile);
    console.log(`[${ts()}] Preprocessing audio...`);
    await preprocessAudio(rawWavFile, processedWavFile);
    const finalWavFile = processedWavFile;
    const totalDur = await getDurationSec(finalWavFile);
    console.log(`[${ts()}] Duration: ${totalDur.toFixed(0)}s, VAD chunking`);
    const allSegments = [];
    let dumpSrtIndex = 0;
    let adaptiveBPS = ADAPTIVE_INITIAL_BPS;
    let retryCount = 0;
    const vadChunkList = await vadChunks(finalWavFile, adaptiveBPS, totalDur);
    for (let chunkIndex = 0; chunkIndex < vadChunkList.length; chunkIndex++) {
      const { start: chunkStart, end: chunkEndVad } = vadChunkList[chunkIndex];
      const wavPath = path.join(
        tmpDir,
        `chunk-${String(chunkIndex).padStart(3, "0")}.wav`,
      );
      await extractChunkWav(finalWavFile, chunkStart, chunkEndVad, wavPath);
      let uploadInfo;
      let chunkEnd = chunkEndVad;
      // FLAC_TOO_LARGE retry: BPS estimate was off; shrink end and retry
      while (true) {
        try {
          uploadInfo = await getFlac(wavPath);
          break;
        } catch (e) {
          if (e.code !== "FLAC_TOO_LARGE") throw e;
          retryCount++;
          const dur = chunkEnd - chunkStart;
          const measuredBPS = e.size / dur;
          const newEnd =
            chunkStart + Math.floor((FILE_LIMIT_BYTES / measuredBPS) * 0.8);
          console.log(
            `[${ts()}] Chunk ${chunkIndex} oversize: ${(e.size / 1e6).toFixed(2)}MB → retry ${(newEnd - chunkStart).toFixed(0)}s (-20%)`,
          );
          adaptiveBPS = adaptiveBPS * 0.5 + measuredBPS * 0.5;
          chunkEnd = Math.min(newEnd, chunkEndVad);
          await extractChunkWav(finalWavFile, chunkStart, chunkEnd, wavPath);
        }
      }
      const actualDur = chunkEnd - chunkStart;
      const measuredBPS = uploadInfo.size / actualDur;
      const prevBPS = adaptiveBPS;
      adaptiveBPS = adaptiveBPS * 0.5 + measuredBPS * 0.5;
      console.log(
        `[${ts()}] Chunk ${chunkIndex}: ${chunkStart.toFixed(0)}s-${chunkEnd.toFixed(0)}s ` +
          `${(uploadInfo.size / 1e6).toFixed(2)}MB, ${measuredBPS.toFixed(0)}B/s ` +
          `(est ${prevBPS.toFixed(0)}→${adaptiveBPS.toFixed(0)})`,
      );
      // No trim/overlap needed — cuts are at silence midpoints
      const chunkInfo = {
        wavPath,
        chunkIndex,
        chunkStart,
        chunkEnd,
        trimStart: chunkStart - 1,
        trimEnd: chunkEnd + 1,
        overlapStart: chunkStart,
        overlapEnd: chunkEnd,
      };
      try {
        const apiData = await callApi(uploadInfo);
        if (DUMP_RAW_API) {
          const segs = apiData.segments || [];
          let srt = `============ Chunk ${chunkIndex}: ${chunkStart.toFixed(0)}s-${chunkEnd.toFixed(0)}s\n`;
          for (const seg of segs) {
            const start = chunkInfo.chunkStart + (seg.start ?? 0);
            const end = chunkInfo.chunkStart + (seg.end ?? seg.start ?? 0);
            srt += `${++dumpSrtIndex}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${seg.text?.trim() ?? ""}\n\n`;
          }
          fs.appendFileSync(effectiveDumpPath, srt, "utf8");
        }
        if (apiData.segments && apiData.segments.length > 0) {
          allSegments.push(...processSegments(apiData.segments, chunkInfo));
        } else {
          console.log(`[${ts()}] Chunk ${chunkIndex}: ⚠️ no segments`);
        }
      } catch (err) {
        console.log(
          `[${ts()}] Chunk ${chunkIndex}: ${chunkStart.toFixed(0)}s-${chunkEnd.toFixed(0)}s ❌ ${err.message}`,
        );
      }
    }
    if (allSegments.length === 0) {
      throw new Error("No transcription segments found");
    }
    if (retryCount > 0) {
      console.log(`[${ts()}] VAD chunking: ${retryCount} oversize retries`);
    }
    const outputPath = getSrtPath(videoPath);
    writeSRT(allSegments, outputPath);
  } catch (err) {
    console.error(
      `[${ts()}] ❌ Failed to process: ${path.basename(
        videoPath,
      )}, ${err.message}`,
    );
    throw err;
  } finally {
    // Cleanup
    try {
      if (await pathExists(rawWavFile)) await fsp.unlink(rawWavFile);
      if (await pathExists(processedWavFile))
        await fsp.unlink(processedWavFile);
    } catch (_) {}
  }

  const elapsed = Date.now() - fileStart;
  const eSecTotal = Math.floor(elapsed / 1000);
  const eMin = Math.floor(eSecTotal / 60);
  const eSec = eSecTotal % 60;
  console.log(
    `Elapsed: ${String(eMin).padStart(2, "0")}:${String(eSec).padStart(2, "0")}`,
  );
}

/* ---------------- Background processing helpers ---------------- */

function deleteLastLogLine(logPath) {
  if (!fs.existsSync(logPath)) return;
  const content = fs.readFileSync(logPath, "utf8");
  const lines = content.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) return;
  lines.pop();
  fs.writeFileSync(
    logPath,
    lines.length > 0 ? lines.join("\n") + "\n" : "",
    "utf8",
  );
}

function loadTvdb() {
  return JSON.parse(fs.readFileSync(TVDB_JSON_PATH, "utf8"));
}

// Atomically consume pending.txt; returns Set of show names (empty Set if no file).
function consumePending() {
  const tmp = PENDING_PATH + ".tmp";
  try {
    fs.renameSync(PENDING_PATH, tmp);
  } catch {
    return new Set();
  }
  try {
    const content = fs.readFileSync(tmp, "utf8");
    fs.unlinkSync(tmp);
    return new Set(
      content
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function pstStamp() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function appendBkgndLog(logPath, videoPath, fromPending) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const relPath = path.relative(TV_ROOT, videoPath);
  const marker = fromPending ? "* " : "  ";
  fs.appendFileSync(logPath, `${pstStamp()} ${marker}${relPath}\n`, "utf8");
}

function bkgndLogStatus(logPath, msg) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${pstStamp()} # ${msg}\n`, "utf8");
}

async function waitForLowCpu() {
  while (true) {
    if (os.loadavg()[0] <= CPU_LOAD_MAX) return;
    await sleep(CPU_PAUSE_MS);
  }
}

async function findCandidateFile(show) {
  if (!show.path) return null;

  // Build set of watched "season:episode" pairs
  const watched = new Set();
  if (Array.isArray(show.watchedEpis)) {
    for (const row of show.watchedEpis) {
      const season = row[0];
      for (let i = 1; i < row.length; i++) watched.add(`${season}:${row[i]}`);
    }
  }

  const showDir = path.join(TV_ROOT, show.path);
  if (!fs.existsSync(showDir)) return null;

  let entries;
  try {
    entries = fs.readdirSync(showDir);
  } catch {
    return null;
  }

  const tuples = [];
  for (const entry of entries) {
    const smatch = entry.match(/^Season\s+(\d+)$/i);
    if (!smatch) continue;
    const seasonNum = parseInt(smatch[1], 10);
    if (seasonNum === 0) continue;
    const seasonDir = path.join(showDir, entry);
    let files;
    try {
      files = fs.readdirSync(seasonDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!isVideoFile(file)) continue;
      const ematch = file.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
      if (!ematch) continue;
      tuples.push({
        season: parseInt(ematch[1], 10),
        episode: parseInt(ematch[2], 10),
        fullPath: path.join(seasonDir, file),
      });
    }
  }

  tuples.sort((a, b) =>
    a.season !== b.season ? a.season - b.season : a.episode - b.episode,
  );

  for (const t of tuples) {
    if (watched.has(`${t.season}:${t.episode}`)) continue;
    if (!(await pathExists(getSrtPath(t.fullPath)))) {
      return {
        videoPath: t.fullPath,
        season: t.season,
        episode: t.episode,
        showName: show.name,
      };
    }
  }
  return null;
}

async function pickNextFile(
  inEmbyShows,
  logPath,
  pendingNames,
  allInEmbyShows,
) {
  // Pending shows bypass the TEST_SHOWS filter — search all inEmby shows
  const pendingPool = allInEmbyShows ?? inEmbyShows;
  if (pendingNames && pendingNames.size > 0) {
    for (const name of pendingNames) {
      const show = pendingPool.find((s) => s.path === name || s.name === name);
      if (!show) continue;
      const result = await findCandidateFile(show);
      if (result) return { ...result, fromPending: true };
    }
  }

  let startIdx = 0;
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const match = lastLine.match(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2} [* ] (.+)$/);
      if (match) {
        const relPath = match[1];
        // First path component is the show directory name (same as show.path)
        const showDir = relPath.split(path.sep)[0];
        const idx = inEmbyShows.findIndex((s) => s.path === showDir);
        if (idx !== -1) startIdx = (idx + 1) % inEmbyShows.length;
      }
    }
  }

  for (let i = 0; i < inEmbyShows.length; i++) {
    const show = inEmbyShows[(startIdx + i) % inEmbyShows.length];
    const result = await findCandidateFile(show);
    if (result) return result;
  }
  return null;
}

async function hasAnyUnwatchedFile(shows) {
  for (const show of shows) {
    const result = await findCandidateFile(show);
    if (result) return true;
  }
  return false;
}

async function runBackgroundLoop() {
  tmpDir = BKGND_TMPDIR;
  fs.mkdirSync(BKGND_TMPDIR, { recursive: true });
  deleteLastLogLine(BKGND_LOG_PATH);
  console.log(`[bkgnd] Starting background ASR loop. Log: ${BKGND_LOG_PATH}`);

  let consecutiveEmpty = 0;
  let cachedTvdb = null;
  let pauseLogged = false;

  while (true) {
    await waitForLowCpu();

    const pending = consumePending();

    if (!cachedTvdb) cachedTvdb = loadTvdb();
    const allInEmby = Object.values(cachedTvdb).filter((s) => s.inEmby);
    let inEmby = allInEmby;
    if (TEST_SHOWS) inEmby = allInEmby.filter((s) => TEST_SHOWS.has(s.path));

    const chosen = await pickNextFile(
      inEmby,
      BKGND_LOG_PATH,
      pending,
      allInEmby,
    );
    if (!chosen) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 10) {
        consecutiveEmpty = 0;
        cachedTvdb = null;
        const allInEmby2 = Object.values(loadTvdb()).filter((s) => s.inEmby);
        let scanShows = allInEmby2;
        if (TEST_SHOWS)
          scanShows = allInEmby2.filter((s) => TEST_SHOWS.has(s.path));
        if (!(await hasAnyUnwatchedFile(scanShows))) {
          if (!pauseLogged) {
            const msg = `No unwatched files found — pausing ${PAUSE_DURATION_MS / 60000} mins`;
            console.log(`[bkgnd] ${msg}`);
            bkgndLogStatus(BKGND_LOG_PATH, msg);
            pauseLogged = true;
          }
          const deadline = Date.now() + PAUSE_DURATION_MS;
          while (Date.now() < deadline) {
            await sleep(PAUSE_POLL_MS);
            const wakeUp = consumePending();
            if (wakeUp.size > 0) {
              fs.mkdirSync(path.dirname(PENDING_PATH), { recursive: true });
              fs.writeFileSync(
                PENDING_PATH,
                [...wakeUp].join("\n") + "\n",
                "utf8",
              );
              pauseLogged = false;
              break;
            }
          }
        } else {
          pauseLogged = false;
        }
      }
      continue;
    }

    consecutiveEmpty = 0;
    pauseLogged = false;
    const { videoPath, fromPending } = chosen;
    appendBkgndLog(BKGND_LOG_PATH, videoPath, fromPending);

    let generated = false;
    try {
      await processOneVideo(videoPath);
      generated = true;
    } catch (err) {
      console.error(`[bkgnd] ❌ ${err.message}`);
    }

    if (generated) {
      cachedTvdb = null;
    } else {
      consecutiveEmpty++;
    }
  }
}

/* ---------------- Main execution ---------------- */
async function main() {
  console.log(`\nConfiguration:`);
  console.log(
    `   Test Mode:        ${testMins > 0 ? `${testMins} minutes` : "OFF"}`,
  );
  console.log(`   Time Match Margin: ${timeMatchMgn}s`);
  console.log(
    `   Audio Quality:     ${audioQuality} (${audioConfig.rate}Hz, ${audioConfig.bitrate})`,
  );
  console.log(`   Preprocessing:     ${AUDIO_FILTER}`);
  console.log(`   API Model:         ${model}`);
  console.log(`   API Temperature:   ${apiTemperature}`);
  console.log(`   API Response:      ${apiResponseFormat}`);
  console.log(`   API Prompt:        ${apiPrompt || "None"}`);
  console.log(
    `   File Size Limit:   ${(FILE_LIMIT_BYTES / 1024 / 1024).toFixed(0)}MB (adaptive)`,
  );
  console.log();

  try {
    if (!(await pathExists(inputPath))) {
      throw new Error(`Input path does not exist: ${inputPath}`);
    }
    const stat = await fsp.stat(inputPath);
    const videoFiles = [];

    if (stat.isFile()) {
      if (!isVideoFile(inputPath)) {
        throw new Error(`File is not a supported video format: ${inputPath}`);
      }
      videoFiles.push(inputPath);
    } else if (stat.isDirectory()) {
      const files = (await fsp.readdir(inputPath)).sort();
      for (const file of files) {
        const fullPath = path.join(inputPath, file);
        const fileStat = await fsp.stat(fullPath);
        if (fileStat.isFile() && isVideoFile(fullPath)) {
          videoFiles.push(fullPath);
        }
      }
    } else {
      throw new Error(`Input is neither file nor directory: ${inputPath}`);
    }
    if (videoFiles.length === 0) {
      throw new Error("No video files found");
    }
    console.log(`Found ${videoFiles.length} video file(s) to process`);
    let processed = 0;
    let failed = 0;
    for (const videoFile of videoFiles) {
      try {
        await processOneVideo(videoFile);
        processed++;
      } catch (err) {
        console.error(
          `[${ts()}] ❌ Failed: ${path.basename(videoFile)} - ${err.message}`,
        );
        failed++;
      }
    }
    if (failed > 0) {
      process.exit(1);
    }
    console.log();
  } catch (err) {
    console.error(`[${ts()}] ❌ Fatal error: ${err.message}`);
    process.exit(1);
  } finally {
    if (typeof closeLogger === "function") {
      closeLogger();
    }
  }
}

// Check dependencies and run
(async () => {
  try {
    await run("ffmpeg", ["-version"]);
    await run("ffprobe", ["-version"]);
    if (runBackground) {
      await runBackgroundLoop();
    } else {
      await main();
    }
  } catch (err) {
    console.error(`[${ts()}] 💥��� Error: ${err.message}`);
    process.exit(1);
  }
})();
