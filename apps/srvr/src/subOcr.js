// l/I confusions in subtitle files: a file made by OCR from a DVD or Blu-ray
// image track, whose sans-serif fonts draw lowercase l and capital I alike,
// has them swapped throughout ("taIking Iike OIiver Twist", "probIem",
// "weII", "l'm", "lt's"). They read badly, and the judge (subJudge.js)
// matches captions to the heard words by their text, so a damaged file loses
// pairs and coverage. A word is repaired when some of its I's read as l's
// (or, at its start, its l as an I) make a word that OpenSubtitles' English
// text (glueWords.txt, as subGlue.js uses it) has at least ODDS times as
// often as the word as written, and at least MIN_COUNT times in all; of
// several such readings the most frequent wins. The table holds the OCR
// garbage itself ("iike" 8,435 times), so being in it means nothing; the
// odds do. A contraction is read a half at a time ("l'm", "I'II"), as the
// table keeps the halves; a lone l before an apostrophe becomes I only before
// m, ll, ve or d, all English puts after "I'", so French's "l'argent" stays.
// A file is repaired only when it is English (MIN_ENGLISH_SHARE of its words
// are very common English words; French and Spanish files have none but
// "a", "on" and "me"). A word in capitals is left alone (its I's are right),
// and so is a file with fewer than MIN_FILE_FIXES repairs: a clean file is
// not touched for one odd word. The step is the sidecar repair in
// subPrepare.js, before the glued-words split, whose dictionary tests the
// confusions would defeat.

import { parseSrt, serializeSrt, cleanSrt } from "@tv/share";
import { wordTable } from "./subGlue.js";

const ODDS = 100;
const MIN_COUNT = 200;
const MIN_FILE_FIXES = 3;
// an English file: this share of its words turn up ENGLISH_MIN times in
// OpenSubtitles' English text, the words other languages share left out
const ENGLISH_MIN = 1000000;
const MIN_ENGLISH_SHARE = 0.15;
const NOT_ENGLISH_PROOF = new Set(["a", "on", "me", "no", "son", "the"]);
// what English puts after "I'"
const AFTER_I = new Set(["m", "ll", "ve", "d"]);
// at most this many I's in a word are tried in every combination
const MAX_I = 6;

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const lower = (w) => w.toLowerCase().replace(/’/g, "'");

// The readings of word with some of its capital I's as l's, and, when it
// starts with a lowercase l and may be the pronoun (not the tail of a
// contraction: nothing after an apostrophe is), with that as an I.
function readings(word, tail) {
  const out = [];
  const at = [];
  for (let i = 0; i < word.length && at.length < MAX_I; i++) if (word[i] === "I") at.push(i);
  for (let mask = 1; mask < 1 << at.length; mask++) {
    const chars = [...word];
    at.forEach((i, k) => {
      if (mask & (1 << k)) chars[i] = "l";
    });
    out.push(chars.join(""));
  }
  if (word[0] === "l" && !tail) out.push(`I${word.slice(1)}`);
  return out;
}

// A word in capitals: no lowercase letter and a capital other than I, so
// "INSTRUCTOR" and "FBI", but not "II" (an OCR'd "ll").
const inCapitals = (part) => !/[a-z]/.test(part) && /[A-HJ-Z]/.test(part);

// The repair of one word or part of a contraction, or null: {to, count}.
function repairPart(part, t, tail = false) {
  if (inCapitals(part) || !/I|^l/.test(part)) return null;
  const own = t.counts.get(lower(part)) ?? 0;
  let best = null;
  for (const r of readings(part, tail)) {
    const count = t.counts.get(lower(r)) ?? 0;
    if (count >= MIN_COUNT && count >= ODDS * own && (!best || count > best.count)) best = { to: r, count };
  }
  return best;
}

// The word with each of its parts between apostrophes repaired, or null. A
// lone l before an apostrophe is the pronoun only before AFTER_I.
function repair(word, t) {
  const parts = word.split(/(['’])/);
  let changed = false;
  const out = parts.map((p, i) => {
    if (p === "'" || p === "’") return p;
    const r = repairPart(p, t, i > 0);
    if (!r) return p;
    changed = true;
    return r.to;
  });
  // "I'II": the only thing after "I'" that is two of one letter is "ll" ("ii"
  // is Roman numeral II elsewhere, so the odds do not say so)
  if (/^[Il]$/.test(parts[0]) && parts[2] === "II") {
    out[2] = "ll";
    changed = true;
  }
  if (parts[0] === "l" && parts.length > 1 && !AFTER_I.has(lower(out[2] ?? ""))) {
    out[0] = "l";
    changed = out.some((p, i) => p !== parts[i]);
  }
  return changed ? out.join("") : null;
}

// Whether the text is English, by the share of its words that are very
// common English words.
function isEnglish(text, t) {
  const words = lower(text).match(/[a-z]+/g) ?? [];
  if (!words.length) return false;
  const english = words.filter((w) => !NOT_ENGLISH_PROOF.has(w) && (t.counts.get(w) ?? 0) >= ENGLISH_MIN).length;
  return english / words.length >= MIN_ENGLISH_SHARE;
}

// The srt text with its l/I confusions repaired: {text, fixes: [{from, to,
// ocr: true}]}, or null when the file has fewer than MIN_FILE_FIXES.
export async function fixOcr(text) {
  const t = await wordTable();
  if (!isEnglish(text, t)) return null;
  const entries = parseSrt(text);
  const fixes = [];
  for (const e of entries) {
    const lines = e.text.split("\n");
    let changed = false;
    lines.forEach((line, li) => {
      const fixed = line.replace(WORD_RE, (word) => {
        const to = repair(word, t);
        if (!to) return word;
        fixes.push({ from: word, to, ocr: true });
        return to;
      });
      if (fixed !== line) {
        lines[li] = fixed;
        changed = true;
      }
    });
    if (changed) e.text = lines.join("\n");
  }
  if (fixes.length < MIN_FILE_FIXES) return null;
  return { text: cleanSrt(serializeSrt(entries)), fixes };
}
