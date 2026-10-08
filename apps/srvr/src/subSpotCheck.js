// Spot check of an episode's subtitle files with ASR on two short clips of its
// video. The words heard in the clips, with their times, are matched against
// every sidecar .srt of the episode, and each sidecar gets a verdict. Nothing
// is written.
//
// The clips are the CLIP_S stretches with the most dialogue cues in the first
// and in the last third of the cues of the first sidecar, by type, that has
// dialogue, cut from the video's English audio track. Per clip, each cue near
// it whose first words occur exactly once in the clip's words pairs with them,
// and the median of (word start - cue start) is the clip's offset: positive
// when the captions come before the words. A clip is solid with MIN_PAIRS
// pairs whose median is pinned to within MAX_UNCERTAINTY_MS (their median
// distance from it over the square root of their count).
//
// A clip that gives no sidecar MIN_PAIRS pairs (music, or a scene in another
// language) is tried once more at the next busiest stretch of its third.
//
// With no English audio track the words cannot be matched, so each sidecar is
// checked by audio matching instead (syncSubToAudio, dry), which reads the
// whole video.
//
// Verdicts:
//   good       the clips agree within AGREE_MS, on an offset from
//              -GOOD_LATE_MS to GOOD_EARLY_MS
//   fixable    the clips agree on an offset outside that
//   wrong cut  both clips solid but disagreeing: no single shift fits
//   can't tell a clip is not solid, or audio matching found no single offset
//   unusable   too little dialogue (a signs track), or cues past the video's end

import fsp from "fs/promises";
import os from "os";
import * as cp from "child_process";
import { promisify } from "util";
import { setTimeout as sleep } from "timers/promises";
import * as path from "node:path";
import { parseSrt, vidIsVideoName, unilog } from "@tv/share";
import { BATCH_SCHED } from "./batchQueue.js";
import { sidecarType } from "./subOrigin.js";
import { syncSubToAudio } from "./subSync.js";

const TV_DIR = "/mnt/media/tv";
const SM_KEY_PATH = "/root/dev/apps/tv/apps/asr/secrets/speechmatics-key.txt";
const SM_API = "https://asr.api.speechmatics.com/v2";
const SM_OPERATING_POINT = "enhanced";
const SM_POLL_MS = 1000;
const SM_POLL_MAX = 300;
const CLIP_S = 120;
const AUDIO_RATE = 16000;
const TYPE_ORDER = ["T", "H", "V", "S", "+"];
// Audio track language tags that are English. An untagged first track counts
// as English too.
const ENGLISH_TAGS = new Set(["eng", "en"]);
// Fewer dialogue cues than this a minute of video is a signs or forced track.
const MIN_CUES_PER_MIN = 3;
// Cues ending further than this past the video's end are from another cut.
const PAST_END_S = 5;
// Cues starting this near a clip may pair with its words.
const NEAR_S = 60;
// A cue pairs by its first words, at most this many.
const PREFIX_WORDS = 5;
const MIN_PAIRS = 10;
const MAX_UNCERTAINTY_MS = 80;
const AGREE_MS = 250;
// Captions may come this much before the words and still be good, or this
// much after them.
const GOOD_EARLY_MS = 500;
const GOOD_LATE_MS = 250;

const execFileP = promisify(cp.execFile);

// The spoken words of a cue or of an ASR word, lowercase and bare: tags, sound
// tags and punctuation gone, so "Don't!" and "don't" are both "dont".
function wordsOf(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>|\{[^}]*\}/g, "")
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

const median = (sorted) => sorted[Math.floor(sorted.length / 2)];

// The video's duration and the language tag of each audio track, in order.
async function videoInfo(videoFile) {
  const { stdout } = await execFileP("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type:stream_tags=language",
    "-of",
    "json",
    videoFile,
  ]);
  const info = JSON.parse(stdout);
  const durS = parseFloat(info.format?.duration);
  if (!(durS > 0)) throw new Error(`no duration for ${videoFile}`);
  const audioLangs = info.streams
    .filter((s) => s.codec_type === "audio")
    .map((s) => (s.tags?.language ?? "").toLowerCase());
  if (audioLangs.length === 0) throw new Error(`no audio in ${videoFile}`);
  return { durS, audioLangs };
}

// The index among the audio tracks of the English one, -1 for none.
function englishTrack(audioLangs) {
  const i = audioLangs.findIndex((l) => ENGLISH_TAGS.has(l));
  if (i >= 0) return i;
  return audioLangs[0] === "" || audioLangs[0] === "und" ? 0 : -1;
}

// The video's sidecars in type order, each with its dialogue cues and, when
// it cannot be checked, why.
async function sidecars(videoFile, durS) {
  const dir = path.dirname(videoFile);
  const stem = path.basename(videoFile).replace(/\.[^.]+$/, "");
  const names = (await fsp.readdir(dir)).filter(
    (f) => f.endsWith(".srt") && (f === `${stem}.srt` || f.startsWith(`${stem}.`)),
  );
  const files = [];
  for (const file of names) {
    const all = parseSrt(await fsp.readFile(path.join(dir, file), "utf8"));
    const cues = all
      .map((c) => ({ ...c, words: wordsOf(c.text) }))
      .filter((c) => c.words.length > 0);
    const type = sidecarType(file.slice(stem.length + 1, -".srt".length));
    const perMin = cues.length / (durS / 60);
    const lastEndS = Math.max(0, ...all.map((c) => c.endMs)) / 1000;
    let why = null;
    if (perMin < MIN_CUES_PER_MIN)
      why = `${perMin.toFixed(1)} dialogue cues a minute`;
    else if (lastEndS > durS + PAST_END_S)
      why = `cues run ${Math.round(lastEndS - durS)} s past the end`;
    files.push({ file, type, cues, why, unusable: !!why });
  }
  return files.sort(
    (a, b) =>
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
      a.file.localeCompare(b.file, undefined, { numeric: true }),
  );
}

// The start seconds of the CLIP_S windows centered on picks, busiest first:
// the most cues starting in them.
function windowsByCount(cues, picks) {
  const counted = new Map();
  for (const c of picks) {
    const fromS = Math.max(0, Math.floor((c.startMs + c.endMs) / 2000 - CLIP_S / 2));
    if (counted.has(fromS)) continue;
    counted.set(
      fromS,
      cues.filter(
        (x) => x.startMs >= fromS * 1000 && x.startMs < (fromS + CLIP_S) * 1000,
      ).length,
    );
  }
  return [...counted].sort((a, b) => b[1] - a[1]).map(([fromS]) => fromS);
}

// The words Speechmatics heard in the flac, [{w, ms}], ms from the clip's start.
async function transcribe(flac) {
  const key = (await fsp.readFile(SM_KEY_PATH, "utf8")).trim();
  const headers = { Authorization: `Bearer ${key}` };
  const form = new FormData();
  form.append(
    "config",
    JSON.stringify({
      type: "transcription",
      transcription_config: { language: "en", operating_point: SM_OPERATING_POINT },
    }),
  );
  form.append("data_file", new Blob([await fsp.readFile(flac)]), path.basename(flac));
  const sub = await fetch(`${SM_API}/jobs`, { method: "POST", body: form, headers });
  if (!sub.ok)
    throw new Error(`speechmatics submit: ${sub.status} ${(await sub.text()).slice(0, 200)}`);
  const { id } = await sub.json();
  for (let i = 0; ; i++) {
    if (i >= SM_POLL_MAX) throw new Error(`speechmatics job ${id} not done`);
    await sleep(SM_POLL_MS);
    const res = await fetch(`${SM_API}/jobs/${id}`, { headers });
    if (!res.ok) throw new Error(`speechmatics poll: ${res.status}`);
    const { job } = await res.json();
    if (job.status === "done") break;
    if (job.status !== "running" && job.status !== "accepted")
      throw new Error(`speechmatics job ${id}: ${job.status}`);
  }
  const res = await fetch(`${SM_API}/jobs/${id}/transcript?format=json-v2`, { headers });
  if (!res.ok) throw new Error(`speechmatics transcript: ${res.status}`);
  const { results } = await res.json();
  return results
    .filter((r) => r.type === "word")
    .map((r) => ({
      w: wordsOf(r.alternatives[0].content).join(""),
      ms: Math.round(r.start_time * 1000),
    }));
}

// The clip's offset for these cues: {ms, pairs, spreadMs}, ms null with no pair.
function clipOffset(cues, heard, fromS) {
  const fromMs = fromS * 1000;
  const near = cues.filter(
    (c) =>
      c.startMs >= fromMs - NEAR_S * 1000 &&
      c.startMs < fromMs + (CLIP_S + NEAR_S) * 1000,
  );
  const prefix = (c) => c.words.slice(0, PREFIX_WORDS);
  const count = new Map();
  for (const c of near) {
    const k = prefix(c).join(" ");
    count.set(k, (count.get(k) || 0) + 1);
  }
  const offsets = [];
  for (const c of near) {
    const p = prefix(c);
    if (count.get(p.join(" ")) !== 1) continue;
    const hits = [];
    for (let i = 0; i + p.length <= heard.length; i++)
      if (p.every((w, j) => heard[i + j].w === w)) hits.push(i);
    if (hits.length === 1) offsets.push(fromMs + heard[hits[0]].ms - c.startMs);
  }
  if (offsets.length === 0) return { ms: null, pairs: 0, spreadMs: null };
  offsets.sort((a, b) => a - b);
  const ms = median(offsets);
  const spreadMs = median(offsets.map((o) => Math.abs(o - ms)).sort((a, b) => a - b));
  return { ms, pairs: offsets.length, spreadMs };
}

const offsetVerdict = (offsetMs) => ({
  verdict:
    offsetMs >= -GOOD_LATE_MS && offsetMs <= GOOD_EARLY_MS ? "good" : "fixable",
  offsetMs,
});

function clipsVerdict(clips) {
  const solid = (c) =>
    c.pairs >= MIN_PAIRS && c.spreadMs / Math.sqrt(c.pairs) <= MAX_UNCERTAINTY_MS;
  if (!clips.every(solid)) return { verdict: "can't tell" };
  const [a, b] = clips.map((c) => c.ms);
  if (Math.abs(a - b) > AGREE_MS) return { verdict: "wrong cut" };
  return offsetVerdict(Math.round((a + b) / 2));
}

// Each usable sidecar checked by ASR on clips of the given audio track.
async function checkByAsr(videoFile, track, usable, result) {
  const placer = usable[0];
  const part = Math.ceil(placer.cues.length / 3);
  const thirds = [placer.cues.slice(0, part), placer.cues.slice(-part)];
  const [sched, ...schedArgs] = BATCH_SCHED;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "spot-check-"));
  // Cut one after the other, so the disk is not split between them, then
  // transcribe at once.
  const hear = async (froms) => {
    const startedAt = Date.now();
    const flacs = [];
    for (const fromS of froms) {
      const flac = path.join(tmpDir, `${fromS}.flac`);
      await execFileP(sched, [
        ...schedArgs,
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-ss",
        String(fromS),
        "-t",
        String(CLIP_S),
        "-i",
        videoFile,
        "-map",
        `0:a:${track}`,
        "-ac",
        "1",
        "-ar",
        String(AUDIO_RATE),
        flac,
      ]);
      flacs.push(flac);
    }
    const cutAt = Date.now();
    const heard = await Promise.all(flacs.map(transcribe));
    result.cutMs += cutAt - startedAt;
    result.asrMs += Date.now() - cutAt;
    return heard;
  };
  try {
    const froms = thirds.map((t) => windowsByCount(placer.cues, t)[0]);
    const tried = [...froms];
    const heard = await hear(froms);
    for (let i = 0; i < froms.length; i++) {
      const enough = usable.some(
        (f) => clipOffset(f.cues, heard[i], froms[i]).pairs >= MIN_PAIRS,
      );
      if (enough) continue;
      const next = windowsByCount(placer.cues, thirds[i]).find((s) =>
        tried.every((t) => Math.abs(s - t) >= CLIP_S),
      );
      if (next === undefined) continue;
      tried.push(next);
      froms[i] = next;
      [heard[i]] = await hear([next]);
      result.retries++;
    }
    result.clipsFromS = froms;
    for (const f of usable) {
      f.clips = froms.map((fromS, i) => clipOffset(f.cues, heard[i], fromS));
      Object.assign(f, clipsVerdict(f.clips));
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

// The verdicts for the sidecars of the video at relPath (under TV_DIR):
// {method, audioTrack, clipsFromS, retries, cutMs, asrMs,
//  files: [{file, type, verdict, offsetMs, why, clips}]}.
export async function spotCheckSubs({ path: relPath }) {
  const videoFile = path.resolve(TV_DIR, String(relPath || ""));
  if (!videoFile.startsWith(TV_DIR + "/") || !vidIsVideoName(videoFile))
    throw new Error(`not a tv video: ${relPath}`);
  const { durS, audioLangs } = await videoInfo(videoFile);
  const files = await sidecars(videoFile, durS);
  const usable = files.filter((f) => !f.unusable);
  const track = englishTrack(audioLangs);
  const result = {
    method: track >= 0 ? "asr" : "audio",
    audioTrack: track >= 0 ? track : null,
    clipsFromS: null,
    retries: 0,
    cutMs: 0,
    asrMs: 0,
    files: [],
  };
  if (usable.length > 0 && track >= 0)
    await checkByAsr(videoFile, track, usable, result);
  else
    for (const f of usable) {
      const srtPath = path.join(path.dirname(relPath), f.file);
      try {
        const { offsetMs } = await syncSubToAudio({ path: srtPath, dryRun: true });
        Object.assign(f, offsetVerdict(offsetMs));
      } catch (e) {
        Object.assign(f, { verdict: "can't tell", why: e.message });
      }
    }
  for (const f of files)
    result.files.push({
      file: f.file,
      type: f.type,
      verdict: f.unusable ? "unusable" : (f.verdict ?? "can't tell"),
      offsetMs: f.offsetMs ?? null,
      why: f.why,
      clips: f.clips ?? null,
    });
  const stem = path.basename(videoFile).replace(/\.[^.]+$/, "");
  const summary = result.files
    .map(
      (f) =>
        `${f.file.slice(stem.length + 1)} ${f.verdict}` +
        (f.offsetMs != null ? ` ${f.offsetMs} ms` : ""),
    )
    .join(", ");
  unilog(2788, `${stem} spot check: ${summary}`);
  return result;
}
