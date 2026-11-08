// Glued words in subtitle files: two or more words run together, the space
// between them lost, most often where a release's converter dropped a line
// break ("thisbefore", "you'reexploiting"). Two tests: a word in an English
// dictionary (Debian's huge lists, names included) is never split, and one
// that is not is split whenever it can be read as two to MAX_PARTS words of
// a plain dictionary (Debian's mid-size lists, lower case only), the
// likeliest reading by how often each word turns up in OpenSubtitles'
// English text (glueWords.txt, built by scripts/glue-words.js). Besides:
//   - its cue must be English: another of its words is a very common English
//     one, or a word it is split into is and half its file's cues have
//     another such word (a French file's "sois" is not "so is");
//   - the halves of contractions ("re", "ll", "don") and two-letter words
//     but TWO_LETTER are never words it is split into ("youre" stays);
//   - it is not capitalized mid-sentence (after "Mr." too), nor anywhere in
//     its file so (a name), unless its first word is "I"; a word in capitals,
//     or with a capital inside it, is left alone, and so are a dropped g
//     ("stuffin'"), a stutter ("ffff") and part of a hyphenated word;
//   - it turns up at most MAX_REPEATS times in its file and in at most
//     MAX_OTHER_EPISODES other episodes' subtitle files of the show: names,
//     slang and a show's own words recur, glued words do not, but for the T
//     and H copies of the video's release group, which are left out: its
//     converter glues the same words in every episode ("youthink");
//   - the words apart are SPLIT_ODDS times likelier than the word as
//     written, by their counts and its own, or another sidecar of the video
//     has them apart near the cue.
// "an" before a consonant, or "a" before a vowel, is never a split.

import fsp from "fs/promises";
import * as path from "node:path";
import {
  parseSrt,
  serializeSrt,
  cleanSrt,
  parseFileSeasonEpisode,
  vidIsVideoName,
} from "@tv/share";
import { sidecarType } from "./subOrigin.js";

const TV_DIR = "/mnt/media/tv";

const GLUE_WORDS_PATH = "/root/dev/apps/tv/apps/srvr/data/glueWords.txt";
// How often a word must turn up in OpenSubtitles' text to be a common word
// (the dropped-g test, and subOcr.js's counts).
export const MIN_PART = 200;
// The two-letter words a glued word can be split into: even the plain
// dictionary has abbreviations ("cf", "kg", "re").
const TWO_LETTER = new Set([
  "ah", "am", "an", "as", "at", "aw", "ax", "be", "by", "do", "eh", "ex", "go",
  "ha", "he", "hi", "ho", "if", "in", "is", "it", "ma", "me", "my", "no", "of",
  "oh", "on", "or", "ow", "ox", "pa", "so", "to", "uh", "um", "up", "us", "we",
  "ye", "yo",
]);
// How much likelier the words apart must be than the word as written.
const SPLIT_ODDS = 100;
// How often a glued word can turn up in its file, and in how many other
// episodes of its show.
const MAX_REPEATS = 2;
const MAX_OTHER_EPISODES = 1;
// Words in no dictionary that the rules split wrongly ("doof": do of). Add to
// this when one turns up.
const NEVER_SPLIT = new Set([
  "anois", "assesin", "atas", "dogsit", "doinit", "doof", "exceptis", "forseen",
  "herob", "ishy", "mathing", "meso", "middleism", "nowish", "penwomanship",
  "probat", "promy", "redrum", "tono", "unclearable", "ushe", "wellstone",
  "windo", "yoas",
]);
// How often a word the list does not have is counted as turning up.
const UNSEEN = 0.5;
// The shortest word looked at ("Igot").
export const MIN_WORD_LEN = 4;
const MAX_PART_LEN = 20;
const MAX_PARTS = 3;
// The shortest word a contraction can be run into ("you'rethe").
const MIN_RUN_INTO_LEN = 3;
// What can follow the apostrophe of a contraction.
const SUFFIXES = ["re", "ve", "ll", "s", "t", "d", "m"];
// What can come before "n't", and before "'re" and "'ve".
const NT_HEADS = new Set([
  "don", "didn", "doesn", "isn", "wasn", "aren", "weren", "haven", "hasn",
  "hadn", "couldn", "wouldn", "shouldn", "mustn", "needn", "ain", "can", "won",
]);
const RE_HEADS = new Set(["you", "we", "they", "who", "what", "there", "where", "how", "why"]);
const VE_HEADS = new Set([
  "i", "you", "we", "they", "who", "what", "would", "could", "should", "might", "must",
]);
// The halves of contractions, words of their own in OpenSubtitles' text
// ("don" "t"), which a glued word is never split into but before an
// apostrophe.
const FRAGMENTS = new Set(["re", "ve", "ll", ...NT_HEADS].filter((w) => w !== "can" && w !== "won"));
// A cue is read only when another of its words, or a word one of its glued
// words is split into ("Wedon't call itanything!"), turns up this
// often: the rest are another language, or too short to tell.
const ENGLISH_MIN = 1000000;
// A cue English only by what its glued words are split into is read only in
// a file with at least this share of its cues English by another word: French
// "sois" is "so is" (French files 0.19 to 0.25, English ones 0.64 and up).
const ENGLISH_FILE_SHARE = 0.5;
// How far either side of a cue another sidecar's cues are read.
const NEAR_MS = 10000;
// How long the words of a show's subtitle files are kept once read.
const SHOW_WORDS_TTL_MS = 10 * 60 * 1000;

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
// What a capitalized word that starts a sentence comes after.
const START_RE = /(^|[.!?:\-–—"“([♪…])$/;
// Titles whose period ends no sentence: the capital after one is a name's
// ("Mr. Peepee's").
const TITLE_RE = /\b(?:Mr|Mrs|Ms|Dr)\.$/;

const lower = (w) => w.toLowerCase().replace(/’/g, "'");
// The words of srt text, lower case, with plain apostrophes.
const wordsOf = (text) => lower(text).match(/[a-z]+(?:'[a-z]+)*/g) ?? [];

// ---- the word table ----

let tablePromise = null;

// The word table: {counts, pieces, own, real, total}. counts has the common
// words' counts in OpenSubtitles' text, pieces the plain dictionary's words,
// those a glued word is split into, with theirs (0 for none), own those of
// the list's words that would be split, real the huge dictionaries' words,
// never split, total the count of all words. subOcr.js reads it too
// (wordTable).
function table() {
  tablePromise ??= loadTable().catch((e) => {
    tablePromise = null;
    throw e;
  });
  return tablePromise;
}

export const wordTable = table;

async function loadTable() {
  const counts = new Map();
  const pieces = new Map();
  const own = new Map();
  const real = new Set();
  let total = 0;
  for (const line of (await fsp.readFile(GLUE_WORDS_PATH, "utf8")).split("\n")) {
    if (!line) continue;
    if (line.startsWith("#total ")) {
      total = Number(line.slice("#total ".length));
      continue;
    }
    const sp = line.indexOf(" ");
    if (sp < 0) real.add(line);
    else if (line[0] === "+") pieces.set(line.slice(1, sp), Number(line.slice(sp + 1)));
    else if (line[0] === "=") own.set(line.slice(1, sp), Number(line.slice(sp + 1)));
    else counts.set(line.slice(0, sp), Number(line.slice(sp + 1)));
  }
  if (!total) throw new Error(`${GLUE_WORDS_PATH} has no #total line`);
  if (!pieces.size) throw new Error(`${GLUE_WORDS_PATH} has no +pieces: rebuild it`);
  return { counts, pieces, own, real, total };
}

const common = (w, t) => (t.counts.get(w) ?? 0) >= MIN_PART;
const isPart = (w, t) =>
  (w.length >= 3 ? t.pieces.has(w) : w.length === 2 ? TWO_LETTER.has(w) : w === "a" || w === "i") &&
  !FRAGMENTS.has(w);
const logP = (w, t) => Math.log((t.pieces.get(w) || UNSEEN) / t.total);

// Whether w'suffix is a contraction.
function contraction(w, suffix, t) {
  if (suffix === "t") return NT_HEADS.has(w);
  if (suffix === "m") return w === "i";
  if (suffix === "re") return RE_HEADS.has(w);
  if (suffix === "ve") return VE_HEADS.has(w);
  return isPart(w, t);
}

// The likeliest way to write w, letters only, as two to MAX_PARTS plain
// words, "a" or "i" only first: {parts, score}, score the sum of their log
// likelihoods, or null. With suffix, the last word is one that takes it as a
// contraction.
function segment(w, t, suffix) {
  const n = w.length;
  const best = new Array(n + 1).fill(null);
  best[0] = { score: 0, from: 0 };
  for (let i = 1; i <= n; i++)
    for (let j = Math.max(0, i - MAX_PART_LEN); j < i; j++) {
      if (!best[j] || (j === 0 && i === n) || (i - j === 1 && j > 0)) continue;
      const part = w.slice(j, i);
      if (i === n && suffix ? !contraction(part, suffix, t) : !isPart(part, t)) continue;
      const score = best[j].score + logP(part, t);
      if (!best[i] || score > best[i].score) best[i] = { score, from: j };
    }
  if (!best[n]) return null;
  const parts = [];
  for (let i = n; i > 0; i = best[i].from) parts.unshift(w.slice(best[i].from, i));
  return parts.length > MAX_PARTS ? null : { parts, score: best[n].score };
}

// How tok, a lower-case word with plain apostrophes, would be split:
// {parts, likely}, or null when it is a real word or can't be split; likely
// when the parts are SPLIT_ODDS times likelier than tok as written. A
// contraction's ending stays on its word ("whatshe's": what she's), and one
// run into the next word is split after it ("you'reexploiting": you're
// exploiting).
export function splitGlued(tok, t) {
  const m = /^([a-z]+)(?:'([a-z]+))?$/.exec(tok);
  if (!m || t.real.has(tok)) return null;
  const [, head, tail] = m;
  let parts, score, asOne;
  if (tail === undefined || SUFFIXES.includes(tail)) {
    if (t.real.has(head) || NEVER_SPLIT.has(head)) return null;
    const seg = segment(head, t, tail);
    if (!seg) return null;
    parts = seg.parts;
    if (tail !== undefined) parts[parts.length - 1] += `'${tail}`;
    score = seg.score;
    asOne = Math.log((t.own.get(head) || t.counts.get(head) || UNSEEN) / t.total);
  } else {
    const suffix = SUFFIXES.find((s) => tail.startsWith(s) && tail.length > s.length);
    if (!suffix || !contraction(head, suffix, t)) return null;
    const rest = tail.slice(suffix.length);
    if (rest.length < MIN_RUN_INTO_LEN) return null;
    const seg =
      isPart(rest, t) || t.real.has(rest) ? { parts: [rest], score: logP(rest, t) } : segment(rest, t);
    if (!seg || seg.parts.length >= MAX_PARTS) return null;
    parts = [`${head}'${suffix}`, ...seg.parts];
    score = logP(head, t) + seg.score;
    asOne = Math.log(UNSEEN / t.total);
  }
  // "an you" and "a and" are not English.
  for (let i = 1; i < parts.length; i++)
    if (
      (parts[i - 1] === "an" && !/^[aeiouh]/.test(parts[i])) ||
      (parts[i - 1] === "a" && /^[aeio]/.test(parts[i]))
    )
      return null;
  return { parts, likely: score - asOne > Math.log(SPLIT_ODDS) };
}

// ---- the words of a show's other episodes ----

// showDir -> {at, words}; words maps a word to a Map from where it came from
// (copyGroup) to the Set of episodes it is in.
const showWordsCache = new Map();

const showDirOf = (videoPath) =>
  path.join(TV_DIR, path.relative(TV_DIR, videoPath).split(path.sep)[0]);

// The episode a video in dir is: "<season>x<episode>", else its path.
function episodeKey(dir, videoName) {
  const se = parseFileSeasonEpisode(videoName, path.basename(dir));
  return Number.isInteger(se?.season) && Number.isInteger(se?.episode)
    ? `${se.season}x${se.episode}`
    : path.join(dir, videoName);
}

// The release group at the end of a video's name less its extension
// ("...-playWEB": "playweb"), or null.
function releaseGroup(stem) {
  return /-([a-z0-9]{2,})$/i.exec(stem)?.[1].toLowerCase() ?? null;
}

// Where srtName, a sidecar of videoName, came from: the video's release group
// when it is a T or H copy of the video's text tracks, else "".
function copyGroup(videoName, srtName) {
  const stem = videoName.replace(/\.[^.]+$/, "");
  const suffix = srtName.slice(stem.length + 1, -".srt".length);
  return "TH".includes(sidecarType(suffix)) ? (releaseGroup(stem) ?? "") : "";
}

// The words of every subtitle file under showDir, by where they came from and
// episode. A file with no video beside it is an episode of its own.
async function showWords(showDir) {
  const now = Date.now();
  for (const [dir, v] of showWordsCache)
    if (now - v.at >= SHOW_WORDS_TTL_MS) showWordsCache.delete(dir);
  const cached = showWordsCache.get(showDir);
  if (cached) return cached.words;
  const words = new Map();
  const dirs = [showDir];
  while (dirs.length > 0) {
    const dir = dirs.pop();
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const d of entries)
      if (d.isDirectory() && !d.name.startsWith(".")) dirs.push(path.join(dir, d.name));
    const videos = entries.filter((d) => d.isFile() && vidIsVideoName(d.name)).map((d) => d.name);
    for (const d of entries) {
      if (!d.isFile() || !d.name.endsWith(".srt")) continue;
      const owner = videos.find((v) => {
        const stem = v.replace(/\.[^.]+$/, "");
        return d.name === `${stem}.srt` || d.name.startsWith(`${stem}.`);
      });
      const key = owner ? episodeKey(dir, owner) : path.join(dir, d.name);
      const from = owner ? copyGroup(owner, d.name) : "";
      for (const w of new Set(wordsOf(await fsp.readFile(path.join(dir, d.name), "utf8")))) {
        let byFrom = words.get(w);
        if (!byFrom) words.set(w, (byFrom = new Map()));
        if (!byFrom.has(from)) byFrom.set(from, new Set());
        byFrom.get(from).add(key);
      }
    }
  }
  showWordsCache.set(showDir, { at: now, words });
  return words;
}

// Those of toks in the subtitle files of more than MAX_OTHER_EPISODES other
// episodes of the video's show, leaving out the T and H copies of videos of
// its own release group: the release's converter glues the same words in
// every episode.
async function seenInOtherEpisodes(videoPath, toks) {
  const words = await showWords(showDirOf(videoPath));
  const videoName = path.basename(videoPath);
  const mine = episodeKey(path.dirname(videoPath), videoName);
  const group = releaseGroup(videoName.replace(/\.[^.]+$/, ""));
  return new Set(
    [...toks].filter((w) => {
      const others = new Set();
      for (const [from, keys] of words.get(w) ?? [])
        if (!(group && from === group)) for (const k of keys) if (k !== mine) others.add(k);
      return others.size > MAX_OTHER_EPISODES;
    }),
  );
}

// ---- splitting ----

// The words of the cues of entries near entry e, joined by single spaces,
// with a space at each end.
function nearText(entries, e) {
  const near = entries.filter(
    (c) => c.endMs >= e.startMs - NEAR_MS && c.startMs <= e.endMs + NEAR_MS,
  );
  return ` ${near.map((c) => wordsOf(c.text).join(" ")).join(" ")} `;
}

// A glued word as it is written split: "I" in capitals, the first word
// capitalized when the glued one was, the apostrophes as they were.
function written(f) {
  const apos = f.word.includes("’") ? "’" : "'";
  return f.parts
    .map((p, i) => {
      let w = p === "i" || p.startsWith("i'") ? `I${p.slice(1)}` : p;
      if (i === 0 && f.capital) w = w[0].toUpperCase() + w.slice(1);
      return w.replace(/'/g, apos);
    })
    .join(" ");
}

// The srt text of a sidecar of videoPath with its glued words split, read
// beside siblings, the video's other sidecars ([{text}]): {text, fixes:
// [{from, to, likely, confirmed}]}, confirmed when a sibling has the words
// apart near the cue; null when nothing is glued.
export async function fixGlued(videoPath, text, siblings) {
  const t = await table();
  const entries = parseSrt(text);
  const names = new Set();
  const counts = new Map();
  const found = [];
  // Those of cues English only by what their glued words are split into.
  const bySplit = [];
  let englishCues = 0;
  const veryCommon = (w) => (t.counts.get(w.split("'")[0]) ?? 0) >= ENGLISH_MIN;
  entries.forEach((e, ei) => {
    const inCue = [];
    e.text.split("\n").forEach((line, li) => {
      for (const m of line.matchAll(WORD_RE)) {
        const word = m[0];
        const tok = lower(word);
        counts.set(tok, (counts.get(tok) ?? 0) + 1);
        const capital = /^[A-Z]/.test(word);
        const before = line.slice(0, m.index).trimEnd();
        const start = START_RE.test(before) && !TITLE_RE.test(before);
        if (capital && !start) names.add(tok);
        if (tok.length < MIN_WORD_LEN || !/^[A-Za-z][a-z'’]*$/.test(word)) continue;
        // A dropped letter ("stuffin'", "'bout") or a stutter ("ffff").
        const around = `${line[m.index - 1] ?? ""}${line[m.index + word.length] ?? ""}`;
        if (/['’]/.test(around) || /^(.{1,3})\1+$/.test(tok)) continue;
        // A piece of a word with an accented letter ("piñatas").
        if (/[\p{L}\p{M}]/u.test(around)) continue;
        // Part of a hyphenated word ("aRangoo-o-onian").
        if (
          /[A-Za-z]-$/.test(line.slice(0, m.index)) ||
          /^-[A-Za-z]/.test(line.slice(m.index + word.length))
        )
          continue;
        if (tok.endsWith("in") && common(`${tok}g`, t)) continue;
        const split = splitGlued(tok, t);
        if (split) inCue.push({ ei, li, offset: m.index, word, tok, capital, start, ...split });
      }
    });
    const english = wordsOf(e.text).some((w) => (t.counts.get(w) ?? 0) >= ENGLISH_MIN);
    if (english) {
      englishCues++;
      found.push(...inCue);
    } else if (inCue.some((f) => f.parts.some(veryCommon))) bySplit.push(...inCue);
  });
  if (englishCues >= entries.length * ENGLISH_FILE_SHARE) found.push(...bySplit);
  const iFirst = (f) => f.parts[0] === "i" || f.parts[0].startsWith("i'");
  const cands = found.filter(
    (f) =>
      (iFirst(f) || (!names.has(f.tok) && (!f.capital || f.start))) &&
      counts.get(f.tok) <= MAX_REPEATS,
  );
  if (cands.length === 0) return null;
  const seen = await seenInOtherEpisodes(videoPath, new Set(cands.map((f) => f.tok)));
  const sibs = siblings.map((s) => parseSrt(s.text));
  for (const f of cands) {
    const phrase = ` ${f.parts.join(" ")} `;
    f.confirmed = sibs.some((s) => nearText(s, entries[f.ei]).includes(phrase));
  }
  const fixes = cands.filter((f) => !seen.has(f.tok) && (f.likely || f.confirmed));
  if (fixes.length === 0) return null;
  // From the end of each line back, so the offsets of the rest hold.
  for (const f of [...fixes].sort((a, b) => b.offset - a.offset)) {
    const e = entries[f.ei];
    const lines = e.text.split("\n");
    const line = lines[f.li];
    lines[f.li] = line.slice(0, f.offset) + written(f) + line.slice(f.offset + f.word.length);
    e.text = lines.join("\n");
  }
  return {
    text: cleanSrt(serializeSrt(entries)),
    fixes: fixes.map((f) => ({ from: f.word, to: written(f), likely: f.likely, confirmed: f.confirmed })),
  };
}
