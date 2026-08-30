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
import { unilog, setUnilogSink } from "@tv/share";

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


// Audio extracted for transcription
const AUDIO_RATE = "48000";
const AUDIO_BITRATE = "256k";

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
// The model defaults to temperature 1, i.e. sampling, which makes every run
// return different words and a different number of cues. Transcription wants
// the single most likely reading, so decode greedily. Temperature alone is not
// enough — the reasoning the model does before answering is sampled too — so a
// fixed seed pins that as well. Together they make a run reproducible.
const GEMINI_TEMPERATURE = 0;
const GEMINI_SEED = 42;
// The model reasons before answering by default. On transcription that reasoning
// costs ~30% of the bill and ~30% more wall time while scoring slightly worse
// against the broadcast captions, so keep it minimal.
const GEMINI_THINKING_LEVEL = "LOW";
const AUDIO_MIME = "audio/flac";
// Uploads go through the Files API, which has no practical size limit.
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

// A single call is bounded by the model's 65,536 output-token cap: audio costs
// about 28.7 output tokens per second, so 65536 * 0.5 (safety factor) / 28.7 is
// about 1140s. Longer audio is split into parts, each transcribed on its own.
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

// Cue timings come from forced alignment against the audio (ctcalign.py),
// not from the model.
const ALIGNER_PYTHON = "/root/dev/aligner-venv/bin/python";
const ALIGNER_SCRIPT = path.join(__dirname, "ctcalign.py");
const ALIGN_RATE = "16000";
// Guard on the aligner's output. Real drift is smooth, so a cue whose shift
// disagrees sharply with its neighbours' is a local alignment failure; it gets
// the neighbourhood's shift instead.
const GUARD_WINDOW = 11;
const GUARD_MAX_DEVIATION = 2.5;
const GUARD_MIN_DUR = 0.35;
const GUARD_MAX_DUR = 12.0;
const GUARD_CHARS_PER_SEC = 16;
// Nobody speaks faster than this. A cue the aligner squeezed into less time
// than its words could possibly take was mis-aligned, however plausible its
// start looks next to its neighbours.
const MAX_CHARS_PER_SEC = 28;
// A cue may outlast the speech a little, but not by multiples — anything past
// this is the aligner stretching a line across a silence.
const displayCap = (chars) => {
  const spoken = Math.min(GUARD_MAX_DUR, Math.max(GUARD_MIN_DUR, chars / GUARD_CHARS_PER_SEC));
  return { spoken, max: Math.min(GUARD_MAX_DUR, spoken * 2.5 + 1) };
};
// Every cue clears the screen before the next appears.
const CUE_GAP_SEC = 0.08;
// A cue must stay up long enough to read even when the words it covers were
// spoken in a fraction of a second ("No.", "4%.").
const MIN_CUE_SEC = 0.9;
// Cues starting closer together than this are effectively simultaneous — the
// aligner cannot separate overlapping dialogue. Merge them when the text fits,
// otherwise force them apart, so no cue is ever crammed into a flash.
const CUE_MERGE_SEC = 0.45;
// enough that the earlier cue can always reach MIN_CUE_SEC
const MIN_CUE_SPACING = MIN_CUE_SEC + CUE_GAP_SEC;
// Subtitle geometry: a cue is at most two lines of this width. Splitting is
// done at sentence, then clause, then word boundaries so a cue rarely ends
// mid-phrase.
const MAX_LINE_CHARS = 42;
const MAX_CUE_CHARS = MAX_LINE_CHARS * 2;
// Break early at a sentence end once a cue is at least this full.
const SENTENCE_BREAK_MIN = 28;

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

// tv-srvr aborts a run by sending SIGTERM here. ffmpeg and the aligner are
// children of this process, so they are killed explicitly — otherwise a long
// alignment would keep running after the job is gone.
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
async function extractAudio(inputVideo, outWav) {
  const args = [
    "-y",
    "-i",
    inputVideo,
    "-ac",
    "1",
    "-ar",
    AUDIO_RATE,
    "-b:a",
    AUDIO_BITRATE,
    "-vn",
  ];
  args.push(outWav);
  await run("ffmpeg", args);
}

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
    AUDIO_RATE,
    "-b:a",
    AUDIO_BITRATE,
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
          temperature: GEMINI_TEMPERATURE,
          // a RECITATION abort is non-deterministic, so retries bump the seed
          // to nudge the model onto a different decode path
          seed: GEMINI_SEED + attempt - 1,
          thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
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
        const err = new Error(`Gemini stopped early: ${finish}`);
        err.finish = finish;
        throw err;
      }
      return { text: response.text(), usage };
    } catch (err) {
      const retryable =
        RETRY_STATUSES.includes(err.status) || err.finish === "RECITATION";
      if (!retryable || attempt > MAX_RETRIES) {
        pane(`Gemini request failed: ${err.message}`);
        unilog(2283, `ASR: gemini retries failed "${currentVideoName}"`);
        throw err;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      pane(
        `Gemini request failed (attempt ${attempt}/${MAX_RETRIES}): ` +
          `${err.status ?? err.finish}, retrying in ${delay}ms`,
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

// Timestamps come back as "HH:MM:SS,mmm", but the hour field is dropped when
// the audio is under an hour, so "MM:SS,mmm" and even "SS,mmm" turn up. Read
// the fields from the right: seconds, then minutes, then hours.
function srtTimeToSec(timeStr) {
  const fields = String(timeStr).trim().replace(",", ".").split(":");
  if (fields.length < 1 || fields.length > 3) {
    throw new Error(`invalid time format: ${timeStr}`);
  }
  const seconds = parseFloat(fields[fields.length - 1]);
  const minutes = fields.length > 1 ? parseInt(fields[fields.length - 2], 10) : 0;
  const hours = fields.length > 2 ? parseInt(fields[0], 10) : 0;
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

// Ideal part boundaries: equal-length targets, known before any silence is
// detected because they depend only on duration.
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
// speech "silence" and cuts through a word.
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

  // Cues are relative to the part, so shift them; drop anything placed outside
  // the audio the part covered.
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

/* ---------------- Forced alignment ---------------- */

// 16 kHz mono is what the acoustic model wants, and reading a plain PCM wav
// keeps the python side free of audio-decoding dependencies.
async function extractAlignAudio(videoPath, outWav) {
  await run("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-ac",
    "1",
    "-ar",
    ALIGN_RATE,
    "-vn",
    outWav,
  ]);
}

async function alignSegments(videoPath, segments) {
  const wavPath = path.join(tmpDir, "align.wav");
  const cuesPath = path.join(tmpDir, "align-cues.json");
  const timesPath = path.join(tmpDir, "align-times.json");
  try {
    await extractAlignAudio(videoPath, wavPath);
    // rough gemini times ride along so the aligner can window the alignment
    await fsp.writeFile(
      cuesPath,
      JSON.stringify(
        segments.map((s) => ({ text: s.text, start: s.start, end: s.end })),
      ),
      "utf8",
    );
    const { out } = await run(ALIGNER_PYTHON, [
      ALIGNER_SCRIPT,
      cuesPath,
      wavPath,
      timesPath,
    ]);
    pane(out.trim() || "aligner returned no summary");
    return JSON.parse(await fsp.readFile(timesPath, "utf8"));
  } finally {
    for (const f of [wavPath, cuesPath, timesPath]) {
      if (await pathExists(f)) await fsp.unlink(f);
    }
  }
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// Replace gemini's timings with the aligner's, rejecting isolated failures.
function guardAlignment(segments, times) {
  const shift = segments.map((seg, i) =>
    times[i] ? times[i].start - seg.start : null,
  );
  const known = shift.filter((x) => x !== null);
  if (known.length === 0) {
    pane("alignment produced nothing usable, keeping gemini timings");
    return segments;
  }

  let jumps = 0;
  let clamped = 0;
  let kept = 0;
  const out = segments.map((seg, i) => {
    const lo = Math.max(0, i - (GUARD_WINDOW >> 1));
    const hi = Math.min(segments.length, i + (GUARD_WINDOW >> 1) + 1);
    const near = shift.slice(lo, hi).filter((x) => x !== null);
    const consensus = near.length ? median(near) : median(known);

    let start;
    let end;
    if (!times[i]) {
      kept++;
      start = seg.start + consensus;
      end = start + (seg.end - seg.start);
    } else if (
      Math.abs(shift[i] - consensus) > GUARD_MAX_DEVIATION ||
      seg.text.length / Math.max(0.01, times[i].end - times[i].start) >
        MAX_CHARS_PER_SEC
    ) {
      jumps++;
      // a duration that fails the rate test is itself the lie — a rejected
      // cue keeps gemini's duration instead
      const dur = times[i].end - times[i].start;
      const durOk =
        dur > 0 &&
        dur < GUARD_MAX_DUR &&
        seg.text.length / dur <= MAX_CHARS_PER_SEC;
      start = seg.start + consensus;
      end = start + (durOk ? dur : seg.end - seg.start);
    } else {
      start = times[i].start;
      end = times[i].end;
    }

    // a two-word line must never sit on screen for seconds
    const cap = displayCap(seg.text.length);
    const dur = end - start;
    if (
      dur < GUARD_MIN_DUR ||
      dur > cap.max ||
      seg.text.length / Math.max(0.01, dur) > MAX_CHARS_PER_SEC
    ) {
      clamped++;
      end = start + Math.max(GUARD_MIN_DUR, cap.spoken * 1.6 + 0.4);
    }
    // a rejected or unplaceable cue keeps no word times; its split pieces are
    // interpolated across the corrected span instead
    const trusted =
      times[i] &&
      Math.abs(shift[i] - consensus) <= GUARD_MAX_DEVIATION &&
      seg.text.length / Math.max(0.01, times[i].end - times[i].start) <=
        MAX_CHARS_PER_SEC;
    return { ...seg, start, end, words: trusted ? times[i].words : null };
  });

  pane(
    `alignment: ${jumps} isolated jumps rejected, ${clamped} durations ` +
      `clamped, ${kept} cues the aligner could not place`,
  );
  return out;
}

// Order the cues, hold each one long enough to read, and clear it before the
// next appears. Applied last, so nothing downstream can reintroduce a flash.
function normalizeCues(cues) {
  cues.sort((a, b) => a.start - b.start);

  const flat = (t) => t.replace(/\n/g, " ");
  const merged = [];
  for (const cue of cues) {
    const prev = merged[merged.length - 1];
    const joined = prev ? `${flat(prev.text)} ${flat(cue.text)}` : "";
    if (
      prev &&
      cue.start - prev.start < CUE_MERGE_SEC &&
      joined.length <= MAX_CUE_CHARS
    ) {
      prev.text = wrapLines(joined.split(" "));
      prev.end = Math.max(prev.end, cue.end);
      continue;
    }
    merged.push({ ...cue });
  }

  // give every cue room to be read; this also guarantees the end below can
  // always reach its minimum without running into the next cue
  for (let i = 1; i < merged.length; i++) {
    const floor = merged[i - 1].start + MIN_CUE_SPACING;
    if (merged[i].start < floor) merged[i].start = floor;
  }

  for (let i = 0; i < merged.length; i++) {
    const cue = merged[i];
    const cap = displayCap(flat(cue.text).length);
    const room =
      i + 1 < merged.length ? merged[i + 1].start - CUE_GAP_SEC : Infinity;
    const wanted = Math.max(
      cue.end,
      cue.start + Math.min(MIN_CUE_SEC, cap.max),
    );
    cue.end = Math.max(
      cue.start + GUARD_MIN_DUR,
      Math.min(wanted, room),
    );
  }
  return merged;
}

const SENTENCE_END = /[.!?]["\')\]]?$/;
const CLAUSE_END = /[,;:]["\')\]]?$/;

// Group words into cues that fit MAX_CUE_CHARS, breaking at the end of a
// sentence where possible and at a clause otherwise.
function groupWords(words) {
  const groups = [];
  let current = [];
  let len = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const added = len === 0 ? word.length : len + 1 + word.length;
    if (len > 0 && added > MAX_CUE_CHARS) {
      groups.push(current);
      current = [word];
      len = word.length;
      continue;
    }
    current.push(word);
    len = added;
    const last = i === words.length - 1;
    if (last) break;
    if (len >= SENTENCE_BREAK_MIN && SENTENCE_END.test(word)) {
      groups.push(current);
      current = [];
      len = 0;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

// Wrap a cue onto two lines, preferring a break after punctuation and
// otherwise the most even split.
function wrapLines(words) {
  const text = words.join(" ");
  if (text.length <= MAX_LINE_CHARS || words.length < 2) return text;
  let best = -1;
  let bestScore = Infinity;
  let len = 0;
  for (let i = 0; i < words.length - 1; i++) {
    len = len === 0 ? words[i].length : len + 1 + words[i].length;
    const rest = words.slice(i + 1).join(" ").length;
    if (len > MAX_LINE_CHARS || rest > MAX_LINE_CHARS) continue;
    let score = Math.abs(len - rest);
    if (SENTENCE_END.test(words[i])) score -= 40;
    else if (CLAUSE_END.test(words[i])) score -= 20;
    if (score < bestScore) {
      bestScore = score;
      best = i + 1;
    }
  }
  if (best < 0) {
    // no split leaves both lines within the limit, so take the most even one
    // rather than emitting one over-long line
    let even = Math.ceil(words.length / 2);
    let evenDiff = Infinity;
    let run = 0;
    for (let i = 0; i < words.length - 1; i++) {
      run = run === 0 ? words[i].length : run + 1 + words[i].length;
      const diff = Math.abs(run - (text.length - run));
      if (diff < evenDiff) {
        evenDiff = diff;
        even = i + 1;
      }
    }
    best = even;
  }
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}

// A long cue becomes several, cut at word boundaries the aligner measured, so
// each piece gets a real start and end.
function splitLongCues(segments) {
  const out = [];
  let split = 0;
  for (const seg of segments) {
    const words = seg.text.replace(/\s+/g, " ").trim().split(" ");
    const groups = groupWords(words);
    if (groups.length > 1) split++;
    const spoken = seg.words ?? [];
    const span = seg.end - seg.start;
    let wordAt = 0;
    let cursor = seg.start;
    for (const group of groups) {
      if (!group.length) continue;
      const timed = spoken.slice(wordAt, wordAt + group.length);
      let start;
      let end;
      if (timed.length === group.length) {
        start = timed[0].start;
        end = timed[timed.length - 1].end;
      } else {
        start = seg.start + (wordAt / words.length) * span;
        end = seg.start + ((wordAt + group.length) / words.length) * span;
      }
      if (start < cursor) start = cursor;
      if (end <= start) end = start + GUARD_MIN_DUR;
      const text = wrapLines(group);
      const cap = displayCap(text.length);
      if (end - start > cap.max) {
        end = start + Math.max(GUARD_MIN_DUR, cap.spoken * 1.6 + 0.4);
      }
      out.push({ start, end, text });
      cursor = start;
      wordAt += group.length;
    }
  }
  if (split > 0) pane(`split ${split} cues over ${MAX_CUE_CHARS} chars`);
  return normalizeCues(out);
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

    pane(`Aligning ${segments.length} cues against the audio`);
    const aligned = guardAlignment(
      segments,
      await alignSegments(videoPath, segments),
    );

    const outputPath = getSrtPath(videoPath);
    writeSRT(splitLongCues(aligned), outputPath);
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
