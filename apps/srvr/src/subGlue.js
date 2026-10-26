// Glued words in subtitle files: two or more words run together, the space
// between them lost, most often where a release's converter dropped a line
// break ("thisbefore", "you'reexploiting"). A word that is not a common word
// itself is split into the likeliest words it can be read as, by how often
// each turns up in OpenSubtitles' English text (glueWords.txt, built by
// scripts/glue-words.js), when all of:
//   - it is not capitalized mid-sentence, nor anywhere in its file so (a
//     name), unless its first word is "I"; a word in capitals, or with a
//     capital inside it, is left alone, and so are a dropped g ("stuffin'")
//     and a stutter ("ffff");
//   - it is not in an English dictionary;
//   - it turns up at most MAX_REPEATS times in its file, and in no other
//     episode's subtitle files of the show: names, slang and compounds recur,
//     glued words do not;
//   - the words apart are SPLIT_ODDS times likelier than the word, or another
//     sidecar of the video has them apart near the cue;
//   - no OpenSubtitles download or .asr.srt of the video has the word itself
//     near the cue, and another word of its cue is a very common English one;
//   - and its file has at least MIN_FILE_GLUED such words with a word like
//     "the" or "his" in them: a release that glues words glues many, while
//     the others hold compounds ("airfreight").
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

const TV_DIR = "/mnt/media/tv";
const GLUE_WORDS_PATH = "/root/dev/apps/tv/apps/srvr/data/glueWords.txt";
// How often a word must turn up in OpenSubtitles' text to be a common word:
// one a glued word can be split into, and one that is never split itself.
// "a" and "i" are the only one-letter words a glued word is split into.
export const MIN_PART = 200;
// How much likelier the words apart must be than the word as written.
const SPLIT_ODDS = 100;
// How often a word the list does not have is counted as turning up.
const UNSEEN = 0.5;
export const MIN_WORD_LEN = 5;
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
const MAX_REPEATS = 2;
const MIN_FILE_GLUED = 3;
// How often a word must turn up for a glued word with it in to count towards
// MIN_FILE_GLUED ("the", "his", "but"): two other words run together are
// most often a compound ("airfreight").
const PLAIN_MIN = 500000;
// A cue is read only when another of its words turns up this often: the rest
// are another language, or too short to tell.
const ENGLISH_MIN = 1000000;
// How far either side of a cue another sidecar's cues are read.
const NEAR_MS = 10000;
// How long the words of a show's subtitle files are kept once read.
const SHOW_WORDS_TTL_MS = 10 * 60 * 1000;

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
// What a capitalized word that starts a sentence comes after.
const START_RE = /(^|[.!?:\-–—"“([♪…])$/;

const lower = (w) => w.toLowerCase().replace(/’/g, "'");
// The words of srt text, lower case, with plain apostrophes.
const wordsOf = (text) => lower(text).match(/[a-z]+(?:'[a-z]+)*/g) ?? [];

// ---- the word table ----

let tablePromise = null;

// The word table: {counts, never, total}. counts has the common words' counts
// in OpenSubtitles' text, never the real words a glued word's split would
// otherwise be taken for, total the count of all words. subOcr.js reads it
// too (wordTable).
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
  const never = new Set();
  let total = 0;
  for (const line of (await fsp.readFile(GLUE_WORDS_PATH, "utf8")).split("\n")) {
    if (!line) continue;
    if (line.startsWith("#total ")) {
      total = Number(line.slice("#total ".length));
      continue;
    }
    const sp = line.indexOf(" ");
    if (sp < 0) never.add(line);
    else counts.set(line.slice(0, sp), Number(line.slice(sp + 1)));
  }
  if (!total) throw new Error(`${GLUE_WORDS_PATH} has no #total line`);
  return { counts, never, total };
}

const common = (w, t) => (t.counts.get(w) ?? 0) >= MIN_PART;
const isPart = (w, t) =>
  (w.length >= 2 || w === "a" || w === "i") && !FRAGMENTS.has(w) && common(w, t);
const logP = (w, t) => Math.log((t.counts.get(w) ?? UNSEEN) / t.total);

// Whether w'suffix is a contraction.
function contraction(w, suffix, t) {
  if (suffix === "t") return NT_HEADS.has(w);
  if (suffix === "m") return w === "i";
  if (suffix === "re") return RE_HEADS.has(w);
  if (suffix === "ve") return VE_HEADS.has(w);
  return isPart(w, t);
}

// The likeliest way to write w, letters only, as two to MAX_PARTS common
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
// {parts, likely, known}, or null when it is a common word or can't be split.
// likely when the parts are SPLIT_ODDS times likelier than tok, known when tok
// is a real word (t.never). A contraction's ending stays on its word ("whatshe's": what she's),
// and one run into the next word is split after it ("you'reexploiting":
// you're exploiting).
export function splitGlued(tok, t) {
  const m = /^([a-z]+)(?:'([a-z]+))?$/.exec(tok);
  if (!m) return null;
  const [, head, tail] = m;
  let parts, score, asOne;
  if (tail === undefined || SUFFIXES.includes(tail)) {
    if (common(head, t)) return null;
    const seg = segment(head, t, tail);
    if (!seg) return null;
    parts = seg.parts;
    if (tail !== undefined) parts[parts.length - 1] += `'${tail}`;
    score = seg.score;
    asOne = logP(head, t);
  } else {
    const suffix = SUFFIXES.find((s) => tail.startsWith(s) && tail.length > s.length);
    if (!suffix || !contraction(head, suffix, t)) return null;
    const rest = tail.slice(suffix.length);
    if (rest.length < MIN_RUN_INTO_LEN) return null;
    const seg = isPart(rest, t)
      ? { parts: [rest], score: logP(rest, t) }
      : segment(rest, t);
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
  const likely = score - asOne > Math.log(SPLIT_ODDS);
  return { parts, likely, known: t.never.has(tok) || t.never.has(head) };
}

// ---- the words of a show's other episodes ----

// showDir -> {at, words}; words maps a word to the one episode it is in, or
// to "*" when it is in more than one.
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

// The words of every subtitle file under showDir, by episode. A file with no
// video beside it is an episode of its own.
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
      for (const w of new Set(wordsOf(await fsp.readFile(path.join(dir, d.name), "utf8")))) {
        const k = words.get(w);
        if (k === undefined) words.set(w, key);
        else if (k !== key) words.set(w, "*");
      }
    }
  }
  showWordsCache.set(showDir, { at: now, words });
  return words;
}

// Those of toks in a subtitle file of another episode of the video's show.
async function seenInOtherEpisodes(videoPath, toks) {
  const words = await showWords(showDirOf(videoPath));
  const mine = episodeKey(path.dirname(videoPath), path.basename(videoPath));
  return new Set(
    [...toks].filter((w) => {
      const k = words.get(w);
      return k !== undefined && k !== mine;
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
// beside siblings, the video's other sidecars ([{text, outside}], outside for
// an OpenSubtitles download or its .asr.srt, which come from outside the
// release): {text, fixes: [{from, to, confirmed}]}, confirmed when a sibling
// has the words apart; null when nothing is glued.
export async function fixGlued(videoPath, text, siblings) {
  const t = await table();
  const entries = parseSrt(text);
  const counts = new Map();
  const names = new Set();
  const found = [];
  entries.forEach((e, ei) => {
    const english = wordsOf(e.text).some((w) => (t.counts.get(w) ?? 0) >= ENGLISH_MIN);
    e.text.split("\n").forEach((line, li) => {
      for (const m of line.matchAll(WORD_RE)) {
        const word = m[0];
        const tok = lower(word);
        counts.set(tok, (counts.get(tok) ?? 0) + 1);
        const capital = /^[A-Z]/.test(word);
        const start = START_RE.test(line.slice(0, m.index).trimEnd());
        if (capital && !start) names.add(tok);
        if (!english || tok.length < MIN_WORD_LEN || !/^[A-Za-z][a-z'’]*$/.test(word)) continue;
        // A dropped letter ("stuffin'", "'bout") or a stutter ("ffff").
        const around = `${line[m.index - 1] ?? ""}${line[m.index + word.length] ?? ""}`;
        if (/['’]/.test(around) || /^(.{1,3})\1+$/.test(tok)) continue;
        if (tok.endsWith("in") && common(`${tok}g`, t)) continue;
        const split = splitGlued(tok, t);
        if (split) found.push({ ei, li, offset: m.index, word, tok, capital, start, ...split });
      }
    });
  });
  const iFirst = (f) => f.parts[0] === "i" || f.parts[0].startsWith("i'");
  const cands = found.filter(
    (f) =>
      (iFirst(f) || (!names.has(f.tok) && (!f.capital || f.start))) &&
      !f.known &&
      counts.get(f.tok) <= MAX_REPEATS,
  );
  // Enough glued words with a plain word in them.
  const enough = (fs) =>
    new Set(
      fs
        .filter((f) => f.parts.some((p) => (t.counts.get(p.split("'")[0]) ?? 0) >= PLAIN_MIN))
        .map((f) => f.tok),
    ).size >= MIN_FILE_GLUED;
  if (!enough(cands)) return null;
  const sibs = siblings.map((s) => ({ entries: parseSrt(s.text), outside: s.outside }));
  for (const f of cands) {
    const e = entries[f.ei];
    const phrase = ` ${f.parts.join(" ")} `;
    const near = sibs.map((s) => ({ outside: s.outside, text: nearText(s.entries, e) }));
    f.confirmed = near.some((s) => s.text.includes(phrase));
    f.denied = near.some((s) => s.outside && s.text.includes(` ${f.tok} `));
  }
  const unsure = cands.filter((f) => !f.denied && (f.likely || f.confirmed));
  const seen =
    unsure.length > 0
      ? await seenInOtherEpisodes(videoPath, new Set(unsure.map((f) => f.tok)))
      : new Set();
  const fixes = unsure.filter((f) => !seen.has(f.tok));
  if (!enough(fixes)) return null;
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
    fixes: fixes.map((f) => ({ from: f.word, to: written(f), confirmed: f.confirmed })),
  };
}
