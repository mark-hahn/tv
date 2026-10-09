// Checks of an episode's subtitle files against the words of its own audio,
// heard by ASR on two short clips of the video. The pieces subPrepare.js puts
// together, and spotCheckSubs, a dry check of one video that writes nothing.
//
// The clips are the CLIP_S stretches with the most dialogue cues in the first
// and in the last third of the cues of the first sidecar, by type, that has
// dialogue, cut from the video's English audio track. A clip that gives none
// of the files MIN_PAIRS pairs (music, or a scene in another language) is
// tried once more at the next busiest stretch of its third.
//
// Per clip, each cue near it whose first words occur exactly once in the
// clip's words pairs with them, and the median of (word start - cue start) is
// the clip's offset: positive when the captions come before the words. A clip
// is solid for a file with MIN_PAIRS pairs whose median is pinned to within
// MAX_UNCERTAINTY_MS (their median distance from it over the square root of
// their count).
//
// Verdicts:
//   good       the clips agree within AGREE_MS, on an offset from
//              -GOOD_LATE_MS to GOOD_EARLY_MS
//   fixable    the clips agree on an offset outside that, or a third clip in
//              the middle shows the file runs at another rate, which a stretch
//              fixes
//   wrong cut  both clips solid but disagreeing: no single shift fits
//   can't tell a clip is not solid
//   unusable   too little dialogue (a signs track), or not in English
//
// Cues that run past the video's end are no verdict of their own: a file from
// another cut is found by its clips, and one at another rate is stretched to
// fit like any other. Only a file that can't be told and runs more than
// PAST_END_S past the end is taken to be from another cut (judgeFile).

import fsp from "fs/promises";
import os from "os";
import * as cp from "child_process";
import { promisify } from "util";
import { setTimeout as sleep } from "timers/promises";
import * as path from "node:path";
import {
  parseSrt,
  vidIsVideoName,
  cleanSrt,
  srtTimeToMs,
  msToSrtTime,
  unilog,
  logHere,
} from "@tv/share";
import { BATCH_SCHED } from "./batchQueue.js";
import { sidecarType } from "./subOrigin.js";
import { syncSubToAudio } from "./subSync.js";

const TV_DIR = "/mnt/media/tv";
const SM_KEY_PATH = "/root/dev/apps/tv/apps/asr/secrets/speechmatics-key.txt";
const SM_API = "https://asr.api.speechmatics.com/v2";
const SM_OPERATING_POINT = "enhanced";
const SM_POLL_MS = 1000;
const SM_POLL_MAX = 300;
const SM_RETRY_MS = 2000;
const CLIP_S = 120;
const AUDIO_RATE = 16000;
const TYPE_ORDER = ["T", "H", "V", "S", "+"];
// Audio track language tags that are English. An untagged first track counts
// as English too.
const ENGLISH_TAGS = new Set(["eng", "en"]);
// Fewer dialogue cues than this a minute of video is a signs or forced track.
const MIN_CUES_PER_MIN = 3;
// A file that can't be told whose cues end further than this past the
// video's end is from another cut.
const PAST_END_S = 5;
// English subtitles have at least 0.29 of their words among ENGLISH_WORDS,
// Portuguese, Spanish and French ones 0.09 at most.
const MIN_ENGLISH_SHARE = 0.18;
const ENGLISH_WORDS = new Set(
  "the you i to a and it is that of what me in this we my your dont on have be no not know just for he was with are do so all can get its im like okay yeah oh well right here there they she him her but go up out now how why who will if at about one want think got come".split(
    " ",
  ),
);
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

// The cues of an .srt with their spoken words; cues with none are left out.
export function cuesOf(srtText) {
  return parseSrt(srtText)
    .map((c) => ({ ...c, words: wordsOf(c.text) }))
    .filter((c) => c.words.length > 0);
}

// The video's duration and the language tag of each audio track, in order.
export async function videoInfo(videoFile) {
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
export function englishTrack(audioLangs) {
  const i = audioLangs.findIndex((l) => ENGLISH_TAGS.has(l));
  if (i >= 0) return i;
  return audioLangs[0] === "" || audioLangs[0] === "und" ? 0 : -1;
}

// Why a sidecar with these cues cannot be checked, or null.
function unusableWhy(cues, durS) {
  const perMin = cues.length / (durS / 60);
  if (perMin < MIN_CUES_PER_MIN)
    return `${perMin.toFixed(1)} dialogue cues a minute`;
  const words = cues.flatMap((c) => c.words);
  const share = words.filter((w) => ENGLISH_WORDS.has(w)).length / words.length;
  if (share < MIN_ENGLISH_SHARE)
    return `not English (${share.toFixed(2)} common English words)`;
  return null;
}

// The video's sidecars in type order: {file, type, cues, why, unusable,
// pastEndS}, why being what keeps one from being checked, pastEndS how far its
// last cue ends past the video's end.
export async function readSidecars(videoFile, durS) {
  const dir = path.dirname(videoFile);
  const stem = path.basename(videoFile).replace(/\.[^.]+$/, "");
  const names = (await fsp.readdir(dir)).filter(
    (f) => f.endsWith(".srt") && (f === `${stem}.srt` || f.startsWith(`${stem}.`)),
  );
  const files = [];
  for (const file of names) {
    const text = await fsp.readFile(path.join(dir, file), "utf8");
    const cues = cuesOf(text);
    const why = unusableWhy(cues, durS);
    const type = sidecarType(file.slice(stem.length + 1, -".srt".length));
    const pastEndS = Math.max(0, ...cues.map((c) => c.endMs / 1000)) - durS;
    files.push({ file, type, cues, why, unusable: !!why, pastEndS });
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

// A Speechmatics request, sent once more after SM_RETRY_MS when it fails with
// no answer at all (a dropped connection): a job already submitted is paid for.
async function smFetch(what, url, opts) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    unilog(2813, `speechmatics ${what} failed, retrying: ${e.message} (${e.cause?.code || e.cause?.message})`);
    await sleep(SM_RETRY_MS);
    try {
      return await fetch(url, opts);
    } catch (e2) {
      // A failed fetch says only "fetch failed"; why is in its cause.
      const c = e2.cause;
      const why = c ? `${c.code ? `${c.code} ` : ""}${c.message}` : e2.message;
      throw new Error(`speechmatics ${what} ${url} failed twice: ${why}`);
    }
  }
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
  const sub = await smFetch("submit", `${SM_API}/jobs`, { method: "POST", body: form, headers });
  if (!sub.ok)
    throw new Error(`speechmatics submit: ${sub.status} ${(await sub.text()).slice(0, 200)}`);
  const { id } = await sub.json();
  for (let i = 0; ; i++) {
    if (i >= SM_POLL_MAX) throw new Error(`speechmatics job ${id} not done`);
    await sleep(SM_POLL_MS);
    const res = await smFetch("poll", `${SM_API}/jobs/${id}`, { headers });
    if (!res.ok) throw new Error(`speechmatics poll: ${res.status}`);
    const { job } = await res.json();
    if (job.status === "done") break;
    if (job.status !== "running" && job.status !== "accepted")
      throw new Error(`speechmatics job ${id}: ${job.status}`);
  }
  const res = await smFetch("transcript", `${SM_API}/jobs/${id}/transcript?format=json-v2`, { headers });
  if (!res.ok) throw new Error(`speechmatics transcript: ${res.status}`);
  const { results } = await res.json();
  return results
    .filter((r) => r.type === "word")
    .map((r) => ({
      w: wordsOf(r.alternatives[0].content).join(""),
      ms: Math.round(r.start_time * 1000),
    }));
}

// The words heard in the CLIP_S clips starting at froms, cut one after the
// other, so the disk is not split between them, and transcribed at once.
// Adds the time each part took to timing.
async function hear(videoFile, track, froms, timing) {
  const [sched, ...schedArgs] = BATCH_SCHED;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "spot-check-"));
  try {
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
    timing.cutMs += cutAt - startedAt;
    timing.asrMs += Date.now() - cutAt;
    return heard;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

// The clip offset of these cues: {ms, pairs, spreadMs}, ms null with no pair.
function clipOffset(cues, clip) {
  const fromMs = clip.fromS * 1000;
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
    for (let i = 0; i + p.length <= clip.heard.length; i++)
      if (p.every((w, j) => clip.heard[i + j].w === w)) hits.push(i);
    if (hits.length === 1) offsets.push(fromMs + clip.heard[hits[0]].ms - c.startMs);
  }
  if (offsets.length === 0) return { ms: null, pairs: 0, spreadMs: null };
  offsets.sort((a, b) => a - b);
  const ms = median(offsets);
  const spreadMs = median(offsets.map((o) => Math.abs(o - ms)).sort((a, b) => a - b));
  return { ms, pairs: offsets.length, spreadMs };
}

const solid = (c) =>
  c.pairs >= MIN_PAIRS && c.spreadMs / Math.sqrt(c.pairs) <= MAX_UNCERTAINTY_MS;

const centerMs = (clip) => clip.fromS * 1000 + (CLIP_S * 1000) / 2;

// The two clips for a video, placed by the first of files and retried as
// above: {clips: [{fromS, heard}, {fromS, heard}], middle: null}. Adds the
// time it took and the retries to timing.
export async function hearClips(videoFile, track, files, timing) {
  const placer = files[0];
  const part = Math.ceil(placer.cues.length / 3);
  const thirds = [placer.cues.slice(0, part), placer.cues.slice(-part)];
  const froms = thirds.map((t) => windowsByCount(placer.cues, t)[0]);
  const tried = [...froms];
  const heard = await hear(videoFile, track, froms, timing);
  const clips = froms.map((fromS, i) => ({ fromS, heard: heard[i] }));
  for (let i = 0; i < clips.length; i++) {
    if (files.some((f) => clipOffset(f.cues, clips[i]).pairs >= MIN_PAIRS)) continue;
    const next = windowsByCount(placer.cues, thirds[i]).find((s) =>
      tried.every((t) => Math.abs(s - t) >= CLIP_S),
    );
    if (next === undefined) continue;
    tried.push(next);
    const [words] = await hear(videoFile, track, [next], timing);
    clips[i] = { fromS: next, heard: words };
    timing.retries = (timing.retries ?? 0) + 1;
  }
  return { clips, middle: null };
}

// A third clip, at the busiest stretch of the middle third of the first of
// files' cues that the other two do not cover, or null when there is none.
export async function hearMiddle(videoFile, track, files, set, timing) {
  const cues = files[0].cues;
  const part = Math.ceil(cues.length / 3);
  const fromS = windowsByCount(cues, cues.slice(part, -part)).find((s) =>
    set.clips.every((c) => Math.abs(s - c.fromS) >= CLIP_S),
  );
  if (fromS === undefined) return null;
  const [heard] = await hear(videoFile, track, [fromS], timing);
  return { fromS, heard };
}

const offsetVerdict = (offsetMs) =>
  offsetMs >= -GOOD_LATE_MS && offsetMs <= GOOD_EARLY_MS ? "good" : "fixable";

// The verdict for a file with these cues against the clips:
// {verdict, offsetMs, fix, clips, needsMiddle}. fix moves the cues to fit
// (see fixedText); needsMiddle says a middle clip could tell whether a file
// from another cut only runs at another rate.
export function judge(cues, set) {
  const [a, b] = set.clips.map((c) => clipOffset(cues, c));
  const clips = [a, b];
  if (!solid(a) || !solid(b)) return { verdict: "can't tell", clips };
  if (Math.abs(a.ms - b.ms) <= AGREE_MS) {
    const offsetMs = Math.round((a.ms + b.ms) / 2);
    return { verdict: offsetVerdict(offsetMs), offsetMs, fix: { offsetMs }, clips };
  }
  if (set.middle) {
    const m = clipOffset(cues, set.middle);
    clips.push(m);
    if (solid(m)) {
      const [ca, cb, cm] = [set.clips[0], set.clips[1], set.middle].map(centerMs);
      const onLine = a.ms + ((b.ms - a.ms) * (cm - ca)) / (cb - ca);
      if (Math.abs(m.ms - onLine) <= AGREE_MS)
        return {
          verdict: "fixable",
          offsetMs: Math.round((a.ms + b.ms) / 2),
          fix: { drift: [[ca, a.ms], [cb, b.ms]] },
          clips,
        };
    }
  }
  return { verdict: "wrong cut", clips, needsMiddle: !set.middle };
}

// The ms fix (see fixedText) moves a cue at ms by.
function shiftAt(fix, ms) {
  if (!fix.drift) return fix.offsetMs;
  const [[a, oa], [b, ob]] = fix.drift;
  return oa + ((ob - oa) * (ms - a)) / (b - a);
}

// judge for a sidecar from readSidecars, with why for a wrong cut that only
// its end shows.
export function judgeFile(f, set) {
  const r = judge(f.cues, set);
  if (r.verdict !== "can't tell" || !(f.pastEndS > PAST_END_S)) return r;
  return { ...r, verdict: "wrong cut", why: `cues run ${Math.round(f.pastEndS)} s past the end` };
}

// The .srt with every cue moved by fix: {offsetMs}, or {drift: [[atMs, ms],
// [atMs, ms]]}, the offsets at two times, for a file at another rate, which
// moves each cue by the offset on the line through them. Never below 0, and
// through cleanSrt.
export function fixedText(srtText, fix) {
  const move = (ms) => ms + shiftAt(fix, ms);
  const at = (t) => msToSrtTime(Math.max(0, Math.round(move(srtTimeToMs(t)))));
  const timeLineRe =
    /^([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(\s*-->\s*)([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(.*)$/;
  const lines = srtText.split(/\r?\n/).map((line) => {
    const m = timeLineRe.exec(line);
    return m ? `${at(m[1])}${m[2]}${at(m[3])}${m[4]}` : line;
  });
  return cleanSrt(lines.join("\n"));
}

// Clips as stored in subs.db, and back.
export const clipsToJson = (set) => ({
  clips: set.clips.map((c) => ({ fromS: c.fromS, words: c.heard.map((h) => [h.w, h.ms]) })),
  middle: set.middle
    ? { fromS: set.middle.fromS, words: set.middle.heard.map((h) => [h.w, h.ms]) }
    : null,
});
const clipFromJson = (c) => ({ fromS: c.fromS, heard: c.words.map(([w, ms]) => ({ w, ms })) });
export const clipsFromJson = (data) => ({
  clips: data.clips.map(clipFromJson),
  middle: data.middle ? clipFromJson(data.middle) : null,
});

// The verdicts for the sidecars of the video at relPath (under TV_DIR), with
// nothing written: {method, audioTrack, clipsFromS, retries, cutMs, asrMs,
// files: [{file, type, verdict, offsetMs, why, clips}]}. With no English audio
// track each file is checked by audio matching instead, which reads the whole
// video.
export async function spotCheckSubs({ path: relPath }) {
  const videoFile = path.resolve(TV_DIR, String(relPath || ""));
  if (!videoFile.startsWith(TV_DIR + "/") || !vidIsVideoName(videoFile))
    throw new Error(`not a tv video: ${relPath}`);
  const { durS, audioLangs } = await videoInfo(videoFile);
  const files = await readSidecars(videoFile, durS);
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
  if (usable.length > 0 && track >= 0) {
    const set = await hearClips(videoFile, track, usable, result);
    for (const f of usable) Object.assign(f, judge(f.cues, set));
    if (usable.some((f) => f.needsMiddle)) {
      set.middle = await hearMiddle(videoFile, track, usable, set, result);
      if (set.middle) for (const f of usable) Object.assign(f, judge(f.cues, set));
    }
    result.clipsFromS = [...set.clips, ...(set.middle ? [set.middle] : [])].map(
      (c) => c.fromS,
    );
  } else
    for (const f of usable) {
      const srtPath = path.join(path.dirname(relPath), f.file);
      try {
        const { offsetMs } = await syncSubToAudio({ path: srtPath, dryRun: true });
        Object.assign(f, { verdict: offsetVerdict(offsetMs), offsetMs });
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
