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
import { unilog, setUnilogSink, logHere } from "@tv/share";

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
// measured word gaps larger than this never share a cue
const SEG_GAP_SEC = 1.0;

// Cue display-duration bounds, applied when building cues from word timings.
const GUARD_MIN_DUR = 0.35;
const GUARD_MAX_DUR = 12.0;
const GUARD_CHARS_PER_SEC = 16;
// A cue may outlast the speech a little, but not by multiples — anything past
// this is a line stretched across a silence.
const displayCap = (chars) => {
  const spoken = Math.min(GUARD_MAX_DUR, Math.max(GUARD_MIN_DUR, chars / GUARD_CHARS_PER_SEC));
  return { spoken, max: Math.min(GUARD_MAX_DUR, spoken * 2.5 + 1) };
};
// Every cue clears the screen before the next appears.
const CUE_GAP_SEC = 0.08;
// A cue must stay up long enough to read even when the words it covers were
// spoken in a fraction of a second ("No.", "4%.").
const MIN_CUE_SEC = 0.9;
// Cues starting closer together than this are effectively simultaneous
// (overlapping dialogue). Merge them when the text fits, otherwise force
// them apart, so no cue is ever crammed into a flash.
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
    "0:a:0",
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

// Build cues from the measured word timings: a new cue starts on a real gap
// in the speech, when the text would overflow a cue, or after a sentence end
// once there is enough to read. The word times ride along so splitLongCues
// can cut on real word boundaries.
function wordsToSegments(words) {
  const segments = [];
  let cur = null;
  for (const w of words) {
    const sentenceEnd =
      cur &&
      SENTENCE_END.test(cur.words[cur.words.length - 1].w) &&
      cur.text.length >= SENTENCE_BREAK_MIN;
    if (
      !cur ||
      w.start - cur.end > SEG_GAP_SEC ||
      cur.text.length + 1 + w.w.length > MAX_CUE_CHARS ||
      sentenceEnd
    ) {
      cur = { start: w.start, end: w.end, text: w.w, words: [w] };
      segments.push(cur);
    } else {
      cur.text += " " + w.w;
      cur.end = w.end;
      cur.words.push(w);
    }
  }
  return segments;
}

// Warn about stretches the transcript has nothing for — either genuinely
// dialogue-free or a sign the engine skipped part of the track.
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

// A long cue becomes several, cut at measured word boundaries, so each piece
// gets a real start and end.
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
    const segments = wordsToSegments(words);
    pane(`Transcribed ${words.length} words into ${segments.length} cues`);
    reportGaps(segments);

    const outputPath = getSrtPath(videoPath);
    writeSRT(splitLongCues(segments), outputPath);
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
(async () => {
  await run("ffmpeg", ["-version"]);
  await run("ffprobe", ["-version"]);
  await processOneVideo(path.resolve(inputPath));
})().catch((err) => {
  unilog(368, err.message);
  process.exit(1);
});
