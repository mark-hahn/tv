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
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { setTimeout as sleep } from "timers/promises";
import axios from "axios";
import FormData from "form-data";
import { logHere, unilog, setUnilogSink } from "@tv/share";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRVR_LOG_URL = "http://127.0.0.1:8739/api/log";
setUnilogSink(({ logId, message }) => {
  fetch(SRVR_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logId, pid: "tv-asr", message }),
  }).catch(() => {});
});
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

const timeMatchMgn = 0.3;
const apiTemperature = 0;
const apiResponseFormat = "verbose_json";
const apiPrompt = null;

// Audio quality settings
const AUDIO_CONFIGS = {
  low: { rate: 16000, bitrate: "64k" },
  medium: { rate: 22050, bitrate: "128k" },
  high: { rate: 44100, bitrate: "192k" },
  max: { rate: 48000, bitrate: "256k" },
};
const audioConfig = AUDIO_CONFIGS["max"];

/* ---------------- API Key and setup ---------------- */
const keyPath = path.join(__dirname, "secrets/mistral-asr-key.txt");
let apiKey;
try {
  apiKey = fs.readFileSync(keyPath, "utf8").trim();
} catch (e) {
  unilog(344, `❌ Unable to read API key from ${keyPath}: ${e.message}`);
  process.exit(1);
}

const model = "voxtral-mini-latest";
const allowedExt = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"]);
const FILE_LIMIT_BYTES = 24 * 1024 * 1024;
// Conservative starting estimate of FLAC bytes/sec for processed speech.
// Will be updated via EMA as chunks are processed.
const ADAPTIVE_INITIAL_BPS = 45000;

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
    unilog(348, `Warning: Could not get duration for ${file}: ${e.message}`);
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
      if (attempt > MAX_RETRIES) {
        unilog(1738, `API request gave up after ${attempt} attempts: ${status}${body ? ` body=${JSON.stringify(body)}` : ""}`);
        throw new Error(`max retries reached after ${attempt} attempts`);
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      unilog(1739, `API request failed (attempt ${attempt}/${MAX_RETRIES + 1}): ${status}${body ? ` body=${JSON.stringify(body)}` : ""}, retrying in ${delay}ms`);
      await sleep(delay);
      continue;
    }
    if (response && response.status === 200) {
      response.data.delay = Date.now() - apiStart;
      return response.data;
    }
    // Non-200 but no exception (unlikely) — log and retry
    const status = response?.status || "unknown";
    if (attempt > MAX_RETRIES) {
      unilog(1740, `API response gave up after ${attempt} attempts: ${status}`);
      throw new Error(`max retries reached after ${attempt} attempts`);
    }
    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
    unilog(1741, `API response failed (attempt ${attempt}/${MAX_RETRIES + 1}): ${status}, retrying in ${delay}ms`);
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
      unilog(
        354,
        `skipping invalid segment in chunk ${chunkInfo.chunkIndex}:`,
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
        // Always concatenate in start-time order — never discard text
        const prev = segOut.pop();
        const mergedStart = Math.min(prev.start, start);
        const mergedEnd = Math.max(prev.end, end);
        const mergedText =
          prev.start <= start ? prev.text + " " + text : text + " " + prev.text;
        segOut.push({
          start: mergedStart,
          end: mergedEnd,
          text: mergedText,
          norm: normalizeText(mergedText),
        });
        continue;
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

  // Passes 2 and 3 previously collapsed segments with identical text, but
  // speakers legitimately repeat words and phrases, so no text is discarded.
  const finalSegs = segOut;

  // Split segments that are longer than 42 chars into smaller chunks
  // with linearly interpolated timestamps.
  const MAX_CHARS = 42;

  const HONORIFICS = new Set([
    "mr.",
    "mrs.",
    "miss",
    "ms.",
    "mx.",
    "dr.",
    "prof.",
    "esq.",
    "rev.",
    "fr.",
    "sr.",
    "br.",
    "gen.",
    "col.",
    "maj.",
    "capt.",
    "lt.",
    "sgt.",
    "cpl.",
    "pvt.",
    "adm.",
    "gov.",
    "sen.",
    "rep.",
    "pres.",
    "amb.",
    "hm",
    "hrh",
    "he",
  ]);

  // Split words into n balanced chunks: minimise variance in character lengths
  // subject to no chunk > MAX_CHARS and no chunk ending on an honorific.
  // N=2: exhaustive scan of all valid split points.
  // N≥3: greedy proportional (target = remaining_chars / remaining_lines).
  function balancedChunks(ws, n) {
    if (n === 1) return [ws];
    if (n === 2) {
      let bestSplit = Math.ceil(ws.length / 2);
      let bestDiff = Infinity;
      let cumLen = 0;
      for (let i = 0; i < ws.length - 1; i++) {
        cumLen += i === 0 ? ws[i].length : 1 + ws[i].length;
        const len2 = ws.slice(i + 1).join(" ").length;
        if (cumLen > MAX_CHARS || len2 > MAX_CHARS) continue;
        if (HONORIFICS.has(ws[i].toLowerCase())) continue;
        const diff = Math.abs(cumLen - len2);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestSplit = i + 1;
        }
      }
      return [ws.slice(0, bestSplit), ws.slice(bestSplit)];
    }
    // N >= 3
    const result = [];
    let off = 0;
    for (let c = 0; c < n; c++) {
      if (c === n - 1) {
        result.push(ws.slice(off));
        break;
      }
      const rem = ws.slice(off);
      const target = rem.join(" ").length / (n - c);
      let cumLen = 0,
        bestI = 1,
        bestDiff = Infinity;
      for (let i = 0; i < rem.length - 1; i++) {
        cumLen += i === 0 ? rem[i].length : 1 + rem[i].length;
        if (cumLen > MAX_CHARS) break;
        if (HONORIFICS.has(rem[i].toLowerCase())) continue;
        const diff = Math.abs(cumLen - target);
        if (diff <= bestDiff) {
          bestDiff = diff;
          bestI = i + 1;
        }
      }
      result.push(ws.slice(off, off + bestI));
      off += bestI;
    }
    return result;
  }

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
    const chunks = balancedChunks(words, numChunks);
    let wordOffset = 0;
    for (const chunkWords of chunks) {
      const chunkSize = chunkWords.length;
      const chunkStart = seg.start + (wordOffset / totalWords) * totalDur;
      const chunkEnd =
        seg.start + ((wordOffset + chunkSize) / totalWords) * totalDur;
      splitSegs.push({
        start: chunkStart,
        end: chunkEnd,
        text: chunkWords.join(" "),
        splitCreated: true,
      });
      wordOffset += chunkSize;
    }
  }

  // Cross-entry honorific fix: if a segment's text ends with an honorific,
  // move it to the start of the next segment so the honorific stays with the
  // following name. Iterate backwards to avoid index shifting after splices.
  for (let i = splitSegs.length - 2; i >= 0; i--) {
    const seg = splitSegs[i];
    if (!seg.splitCreated) continue;
    const words = seg.text.trim().split(/\s+/);
    const lastWord = words[words.length - 1];
    if (!HONORIFICS.has(lastWord.toLowerCase())) continue;
    const next = splitSegs[i + 1];
    next.text = lastWord + " " + next.text;
    if (words.length === 1) {
      splitSegs.splice(i, 1);
    } else {
      seg.text = words.slice(0, -1).join(" ");
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
  unilog(355, `\n[${ts()}] Wrote: ${path.basename(outputPath)}`);
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
  unilog(
    356,
    `[${ts()}] VAD: threshold=${bestThreshold.toFixed(1)}dB, ` +
      `${bestMidpoints.length} silences → ${chunks.length} chunks ` +
      `(max est ${(maxEst / 1e6).toFixed(1)}MB)`,
  );
  return chunks;
}

/* ---------------- Main processing function ---------------- */
async function processOneVideo(videoPath) {
  const fileStart = Date.now();
  unilog(357, `\n[${ts()}] Processing: ${path.basename(videoPath)}`);
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const rawWavFile = path.join(tmpDir, "audio_raw.wav");
  const processedWavFile = path.join(tmpDir, "audio_processed.wav");
  try {
    await extractAudio(videoPath, rawWavFile);
    unilog(358, `Preprocessing audio...`);
    await preprocessAudio(rawWavFile, processedWavFile);
    const finalWavFile = processedWavFile;
    const totalDur = await getDurationSec(finalWavFile);
    unilog(359, `Duration: ${totalDur.toFixed(0)}s, VAD chunking`);
    const allSegments = [];
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
          unilog(
            360,
            `Chunk ${chunkIndex} oversize: ${(e.size / 1e6).toFixed(2)}MB → retry ${(newEnd - chunkStart).toFixed(0)}s (-20%)`,
          );
          adaptiveBPS = adaptiveBPS * 0.5 + measuredBPS * 0.5;
          chunkEnd = Math.min(newEnd, chunkEndVad);
          await extractChunkWav(finalWavFile, chunkStart, chunkEnd, wavPath);
        }
      }
      // If this chunk was retried shorter, slide next chunk's start forward to avoid a gap
      if (chunkEnd < chunkEndVad && chunkIndex + 1 < vadChunkList.length) {
        vadChunkList[chunkIndex + 1].start = chunkEnd;
      }
      const actualDur = chunkEnd - chunkStart;
      const measuredBPS = uploadInfo.size / actualDur;
      const prevBPS = adaptiveBPS;
      adaptiveBPS = adaptiveBPS * 0.5 + measuredBPS * 0.5;
      unilog(
        361,
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
        if (apiData.segments && apiData.segments.length > 0) {
          allSegments.push(...processSegments(apiData.segments, chunkInfo));
        } else {
          unilog(362, `Chunk ${chunkIndex}: ⚠️ no segments`);
        }
      } catch (err) {
        unilog(
          363,
          `Chunk ${chunkIndex}: ${chunkStart.toFixed(0)}s-${chunkEnd.toFixed(0)}s ❌ ${err.message}`,
        );
      }
    }
    if (allSegments.length === 0) {
      throw new Error("No transcription segments found");
    }
    if (retryCount > 0) {
      unilog(364, `VAD chunking: ${retryCount} oversize retries`);
    }
    const outputPath = getSrtPath(videoPath);
    writeSRT(allSegments, outputPath);
  } catch (err) {
    unilog(
      365,
      `❌ Failed to process: ${path.basename(videoPath)}, ${err.message}`,
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
  unilog(
    366,
    `Elapsed: ${String(eMin).padStart(2, "0")}:${String(eSec).padStart(2, "0")}`,
  );
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
