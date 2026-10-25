// Subtitle vetting's judge (subs-final-plan.md): one subtitle file against
// the words of its video's English audio, from a complete word-timed ASR
// (heardFromWords) or, for a video with only an old `+` file, from that
// file's caption starts (heardFromPlus). Pure: no I/O. Gap filling and the
// fix line's rewrite of a file are here too.
//
// The steps, the first that fails deciding the verdict:
//   1 unusable  fewer than 3 captions a minute, or under 18% common English
//               words
//   2 the line  clean cues of the file and the transcript paired by 3 words
//               found once in each; fewer than 10 pairs is bad; a line
//               video time = a + b × file time fitted through them (RANSAC
//               with a fixed seed, so verdicts repeat)
//   3 spot      two pairs within 60 s of heard time, both off the line by
//               more than 1200 ms early (the caption before its words) or
//               600 ms late, and within 300 ms of each other, is bad
//   4 refit     dense pairs, each caption's first 3 words against the one
//               3-word run within 2 s of where the line puts it, and the line
//               fitted again through them: the fix line
//   5 minute    a dense pair and those in the 60 s after it, 6 or more, with
//               a median more than 450 ms early or 300 ms late of the fix
//               line, is bad
//   6 missing   any 120 s, stepping 10 s, with 40 or more counted heard words
//               and no caption start makes the file missing
//   7 good
//
// Heard words after the file's last caption in the video's last 6 minutes
// (end material) and inside another file's ♪ captions, padded 1 s, are not
// counted. Every rule and constant here is vetting version 2: a change to
// any of them raises VET_VERSION. Version 2 (10-25) gave the spot and minute
// rules separate early and late limits, from the user's ratings of 162 clips
// (subs-observe.md): captions late bother about twice as much as early, and
// a sustained shift from about 350 ms late. Version 1 failed either rule at
// 500 ms either way, and the minute rule needed 8 pairs.
//
// The analysis that measured these rules (sub-analysis on hahnca.com,
// evaluate.py's whole+refit+mend+mlyr+mslide+segMin6+segE450+segL300+
// spotE1200+spotL600 and planted/fill.py) is matched step for step, down to
// Python's random draws (pyRandom.js), its float sums (pySum) and its
// rounding (pyRound).

import { cleanSrt, msToSrtTime, parseSrt, serializeSrt, srtTimeToMs, wrapLines } from "@tv/share";
import { PyRandom } from "./pyRandom.js";

export const VET_VERSION = 2;

// step 1
const MIN_CAPTIONS_PER_MIN = 3;
const MIN_ENGLISH_SHARE = 0.18;
const ENGLISH_WORDS = new Set(
  "the you i to a and it is that of what me in this we my your dont on have be no not know just for he was with are do so all can get its im like okay yeah oh well right here there they she him her but go up out now how why who will if at about one want think got come".split(
    " ",
  ),
);
// a cue starts 1 s or more after what came before it, and its 3 words are in
// no caption starting within 10 s
const PAUSE_MS = 1000;
const REPEAT_MS = 10000;
const CUE_WORDS = 3;
// step 2
const MIN_CLEAN_PAIRS = 10;
const RANSAC_TOL_MS = 500;
const RANSAC_DRAWS = 400;
const RANSAC_STRETCH_MIN = 0.9;
const RANSAC_STRETCH_MAX = 1.1;
// the two pairs of a draw are at least min(this, a quarter of the pairs'
// span) apart
const RANSAC_SPACING_MS = 120000;
const RANSAC_SEED = 1;
const RANSAC_REFITS = 2;
// step 3
const SPOT_WINDOW_MS = 60000;
// a residual above 0 is a caption before its words (early), below 0 late
const SPOT_EARLY_MS = 1200;
const SPOT_LATE_MS = 600;
const SPOT_AGREE_MS = 300;
// step 4
const DENSE_MS = 2000;
// step 5
const MINUTE_MS = 60000;
const MINUTE_MIN_PAIRS = 6;
const MINUTE_EARLY_MS = 450;
const MINUTE_LATE_MS = 300;
// step 6
const MISSING_WINDOW_MS = 120000;
const MISSING_STEP_MS = 10000;
const MISSING_MIN_WORDS = 40;
const END_MATERIAL_MS = 360000;
const LYRIC_PAD_MS = 1000;
// gap filling
const FILL_EDGE_MS = 200;
const FILL_PAUSE_MS = 700;
const FILL_MAX_MS = 6000;
const FILL_MAX_WORDS = 12;
const FILL_TAIL_MS = 300;
const FILL_GAP_MS = 50;

// Python's whitespace for str patterns, so words split as the analysis split
// them.
const WS = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const BLOCK_SPLIT_RE = new RegExp(`\\n[${WS}]*\\n`);
const NOT_WORD_RE = new RegExp(`[^a-z0-9${WS}]`, "g");
const WS_RUN_RE = new RegExp(`[${WS}]+`);
const TIME_RE = /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/;
const SRT_TIME_LINE_RE =
  /^([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(\s*-->\s*)([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(.*)$/;

// ---- Python's arithmetic ----

// sum() of floats in Python 3.12: Neumaier's compensated summation.
function pySum(xs) {
  if (xs.length === 0) return 0;
  let f = xs[0];
  let c = 0;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}

// round(): halves go to the even neighbour.
export function pyRound(x) {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// statistics.median
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// bisect.bisect_left / bisect_right on a sorted array of numbers
function bisectLeft(xs, x) {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function bisectRight(xs, x) {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < xs[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// ---- captions ----

// "hh:mm:ss,mmm" in ms, cut to the ms below as the analysis read it.
function timeMs(t) {
  const [h, m, s] = t.replace(",", ".").split(":");
  return Math.trunc((parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s)) * 1000);
}

// The spoken words of caption text, lowercase and bare: tags, sound tags, ♪
// and punctuation gone, so "Don't!" and "don't" are both "dont".
export function wordsOf(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>|\{[^}]*\}/g, "")
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, " ")
    .replace(NOT_WORD_RE, "")
    .split(WS_RUN_RE)
    .filter(Boolean);
}

function cmpCaption(x, y) {
  if (x.start !== y.start) return x.start - y.start;
  if (x.end !== y.end) return x.end - y.end;
  const n = Math.min(x.words.length, y.words.length);
  for (let i = 0; i < n; i++)
    if (x.words[i] !== y.words[i]) return x.words[i] < y.words[i] ? -1 : 1;
  return x.words.length - y.words.length;
}

// The captions of an .srt that have spoken words, [{start, end, words}] in
// order.
export function captionsOf(srtText) {
  const out = [];
  for (const block of srtText.split(BLOCK_SPLIT_RE)) {
    const m = TIME_RE.exec(block);
    if (!m) continue;
    const words = wordsOf(block.slice(m.index + m[0].length));
    if (words.length) out.push({ start: timeMs(m[1]), end: timeMs(m[2]), words });
  }
  return out.sort(cmpCaption);
}

// The [start, end] of every caption of an .srt with a ♪ in it, in file time.
export function musicOf(srtText) {
  const out = [];
  for (const block of srtText.split(BLOCK_SPLIT_RE)) {
    const m = TIME_RE.exec(block);
    if (m && block.slice(m.index + m[0].length).includes("♪"))
      out.push([timeMs(m[1]), timeMs(m[2])]);
  }
  return out;
}

const key3 = (words, i) => `${words[i]} ${words[i + 1]} ${words[i + 2]}`;

// How often each 3-word run occurs in the word lists.
function grams3(lists) {
  const count = new Map();
  for (const words of lists)
    for (let i = 0; i + 2 < words.length; i++) {
      const k = key3(words, i);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  return count;
}

// Per caption, how often each 3-word run occurs in it.
const captionGrams = (caps) => caps.map((c) => grams3([c.words]));

// The captions starting within REPEAT_MS of t, as an index range.
function nearRange(starts, t) {
  return [bisectLeft(starts, t - REPEAT_MS + 1), bisectRight(starts, t + REPEAT_MS - 1)];
}

// Clean cues: [start, first 3 words] of each caption with at least 3 words
// that starts PAUSE_MS or more after every caption before it ends, its 3
// words in no other caption starting within REPEAT_MS.
function fileCues(caps) {
  const starts = caps.map((c) => c.start);
  const grams = captionGrams(caps);
  const out = [];
  let prevEnd = -1e9;
  caps.forEach((c, i) => {
    if (c.words.length >= CUE_WORDS && c.start - prevEnd >= PAUSE_MS) {
      const k = key3(c.words, 0);
      const [lo, hi] = nearRange(starts, c.start);
      let n = 0;
      for (let j = lo; j < hi; j++) n += grams[j].get(k) ?? 0;
      if (n === 1) out.push([c.start, k, i]);
    }
    prevEnd = Math.max(prevEnd, c.end);
  });
  return out;
}

// Dense keys: [start, first 3 words] of every caption with at least 3 words
// whose first 3 words occur in no other caption starting within REPEAT_MS.
function captionKeys(caps) {
  const starts = caps.map((c) => c.start);
  const grams = captionGrams(caps);
  const out = [];
  caps.forEach((c) => {
    if (c.words.length < CUE_WORDS) return;
    const k = key3(c.words, 0);
    const [lo, hi] = nearRange(starts, c.start);
    let n = 0;
    for (let j = lo; j < hi; j++) n += grams[j].get(k) ?? 0;
    if (n === 1) out.push([c.start, k]);
  });
  return out;
}

// ---- what was heard ----

// The heard side from a complete ASR: words [[text, startMs, endMs]] in the
// order the ASR gave them, text as the `+` file shows it. A word with no
// letters or digits is left out.
export function heardFromWords(words, durMs) {
  const all = [];
  for (const [text, s, e] of words) {
    const w = String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (w) all.push({ s, e, w, text });
  }
  const run = all.filter((x) => 0 <= x.s && x.s < durMs);
  const seq = run.map((x) => x.w);
  const count = grams3([seq]);
  // a heard cue: 3 words whose first starts PAUSE_MS or more after the word
  // before it ends, found once in the whole transcript
  const cues = new Map();
  const dense = new Map();
  for (let i = 0; i + 2 < run.length; i++) {
    const k = key3(seq, i);
    if (!dense.has(k)) dense.set(k, []);
    dense.get(k).push(run[i].s);
    const gap = run[i].s - (i > 0 ? run[i - 1].e : 0);
    if (gap >= PAUSE_MS && count.get(k) === 1) cues.set(k, run[i].s);
  }
  return {
    plus: false,
    durMs,
    cues,
    dense,
    // the words the missing check counts, before its exemptions
    spoken: run.map((x) => x.s).sort((a, b) => a - b),
    // the words gap filling looks for missing stretches with, and what it
    // fills them from
    fillWords: all,
    fillFrom: all,
  };
}

// The heard side from an old `+` file, which has no word times: only its
// caption starts are used, and each of its words counts at its caption's
// start.
export function heardFromPlus(plusText, durMs) {
  const caps = captionsOf(plusText);
  const count = grams3([caps.flatMap((c) => c.words)]);
  const cues = new Map();
  for (const [u, k] of fileCues(caps)) if (count.get(k) === 1) cues.set(k, u);
  const dense = new Map();
  for (const c of caps) {
    if (c.words.length < CUE_WORDS) continue;
    const k = key3(c.words, 0);
    if (!dense.has(k)) dense.set(k, []);
    dense.get(k).push(c.start);
  }
  const fillWords = caps.flatMap((c) => c.words.map(() => ({ s: c.start, e: c.start })));
  return {
    plus: true,
    durMs,
    cues,
    dense,
    spoken: fillWords
      .map((x) => x.s)
      .filter((s) => 0 <= s && s < durMs)
      .sort((a, b) => a - b),
    fillWords,
    fillFrom: parseSrt(plusText).map((e) => ({ s: e.startMs, e: e.endMs, text: e.text })),
  };
}

// ---- the line ----

// The least-squares line through pairs [[x, y]]: {a, b}, y = a + b x.
function lsq(pairs) {
  const n = pairs.length;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  const sxx = pySum(pairs.map(([x]) => (x - mx) * (x - mx)));
  const b = sxx ? pySum(pairs.map(([x, y]) => (x - mx) * (y - my))) / sxx : 1.0;
  return { a: my - b * mx, b };
}

// One line through most of the pairs, {a, b}, or null: the line through two
// random pairs that has the most pairs within RANSAC_TOL_MS of it, then
// least squares through those, twice.
function ransac(pairs) {
  if (pairs.length < 2) return null;
  const rnd = new PyRandom(RANSAC_SEED);
  const xs = pairs.map(([x]) => x);
  const span = Math.max(...xs) - Math.min(...xs);
  const spacing = Math.min(RANSAC_SPACING_MS, span / 4);
  let best = null;
  for (let draw = 0; draw < RANSAC_DRAWS; draw++) {
    const [[x1, y1], [x2, y2]] = rnd.sample2(pairs);
    if (Math.abs(x2 - x1) < spacing) continue;
    const b = (y2 - y1) / (x2 - x1);
    if (!(RANSAC_STRETCH_MIN < b && b < RANSAC_STRETCH_MAX)) continue;
    const a = y1 - b * x1;
    let n = 0;
    for (const [x, y] of pairs) if (Math.abs(y - (a + b * x)) <= RANSAC_TOL_MS) n++;
    if (best === null || n > best.n) best = { a, b, n };
  }
  let { a, b } = best ?? { a: median(pairs.map(([x, y]) => y - x)), b: 1.0 };
  for (let k = 0; k < RANSAC_REFITS; k++) {
    const inliers = pairs.filter(([x, y]) => Math.abs(y - (a + b * x)) <= RANSAC_TOL_MS);
    if (inliers.length < 2) return null;
    ({ a, b } = lsq(inliers));
  }
  return { a, b };
}

// Clean pairs [file time, heard time]: the file's clean cues whose 3 words
// occur once among all the file's 3-word runs and as a heard cue.
function cleanPairs(caps, heard) {
  const fg = grams3(caps.map((c) => c.words));
  return fileCues(caps)
    .filter(([, k]) => fg.get(k) === 1 && heard.cues.has(k))
    .map(([t, k]) => [t, heard.cues.get(k)]);
}

// Dense pairs [file time, heard time] by the line.
function densePairs(caps, heard, line) {
  const out = [];
  for (const [s, k] of captionKeys(caps)) {
    const p = line.a + line.b * s;
    if (!(0 <= p && p < heard.durMs)) continue;
    const near = (heard.dense.get(k) ?? []).filter((u) => Math.abs(u - p) <= DENSE_MS);
    if (near.length === 1) out.push([s, near[0]]);
  }
  return out;
}

const fmtMin = (ms) => `${(Math.round(ms / 6000) / 10).toFixed(1)} min`;

// Whether a residual is off: more than SPOT_EARLY_MS early or SPOT_LATE_MS
// late.
const spotOff = (r) => r > SPOT_EARLY_MS || r < -SPOT_LATE_MS;

// Two pairs within SPOT_WINDOW_MS, both off the line and within
// SPOT_AGREE_MS of each other: why, or null.
function spotWhy(pairs, { a, b }) {
  const res = pairs
    .map(([x, y]) => [y, y - (a + b * x)])
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  for (let i = 0; i < res.length; i++) {
    const [u, r] = res[i];
    if (!spotOff(r)) continue;
    for (let j = i + 1; j < res.length; j++) {
      const [v, q] = res[j];
      if (v - u > SPOT_WINDOW_MS) break;
      if (spotOff(q) && Math.abs(q - r) <= SPOT_AGREE_MS)
        return `spot: ${Math.round(r)} ms off the line at ${fmtMin(u)}`;
    }
  }
  return null;
}

// A dense pair and those in the MINUTE_MS of heard time after it, at least
// MINUTE_MIN_PAIRS, whose median is more than MINUTE_EARLY_MS early or
// MINUTE_LATE_MS late: why, or null.
function minuteWhy(pairs, { a, b }) {
  const res = pairs
    .map(([s, u]) => [u, u - (a + b * s)])
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const heardAt = res.map(([u]) => u);
  for (let i = 0; i < res.length; i++) {
    const u = res[i][0];
    const to = bisectLeft(heardAt, u + MINUTE_MS);
    if (to - i < MINUTE_MIN_PAIRS) continue;
    const m = median(res.slice(i, to).map(([, r]) => r));
    if (m > MINUTE_EARLY_MS || m < -MINUTE_LATE_MS) return `minute: ${Math.round(m)} ms off at ${fmtMin(u)}`;
  }
  return null;
}

// ---- the missing check ----

// spans [[lo, hi]] padded by LYRIC_PAD_MS and merged
function lyricSpans(lyrics) {
  const out = [];
  for (const [lo, hi] of lyrics
    .map(([lo, hi]) => [lo - LYRIC_PAD_MS, hi + LYRIC_PAD_MS])
    .sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
    if (out.length && lo <= out.at(-1)[1]) out.at(-1)[1] = Math.max(out.at(-1)[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

// Whether a heard word at t counts for the missing check: not end material
// (after the file's last caption start, lastStart, in the video's last
// END_MATERIAL_MS) and not inside another file's ♪ captions.
function countedTest(lastStart, durMs, lyrics) {
  const spans = lyricSpans(lyrics);
  const los = spans.map(([lo]) => lo);
  return (t) => {
    if (t > lastStart && t >= durMs - END_MATERIAL_MS) return false;
    const i = bisectRight(los, t) - 1;
    return !(i >= 0 && t <= spans[i][1]);
  };
}

// The windows [from, to] of MISSING_WINDOW_MS, stepping MISSING_STEP_MS from
// the start of the video, with MISSING_MIN_WORDS or more of the times words
// and none of the sorted caption starts.
function emptyWindows(starts, words, durMs) {
  const out = [];
  const last = Math.max(1, Math.trunc(durMs - MISSING_WINDOW_MS) + 1);
  for (let w0 = 0; w0 < last; w0 += MISSING_STEP_MS) {
    const to = w0 + MISSING_WINDOW_MS;
    const n = bisectLeft(words, to) - bisectLeft(words, w0);
    if (n >= MISSING_MIN_WORDS && bisectLeft(starts, to) === bisectLeft(starts, w0))
      out.push([w0, to]);
  }
  return out;
}

// ---- the judge ----

function unusableWhy(caps, durMs) {
  const perMin = caps.length / (durMs / 60000);
  if (perMin < MIN_CAPTIONS_PER_MIN) return `${perMin.toFixed(1)} captions a minute`;
  const words = caps.flatMap((c) => c.words);
  const share = words.filter((w) => ENGLISH_WORDS.has(w)).length / Math.max(1, words.length);
  if (share < MIN_ENGLISH_SHARE) return `not English (${share.toFixed(2)} common English words)`;
  return null;
}

// The ♪ captions of srtText placed in video time by line, or [].
const placeMusic = (srtText, line) =>
  line ? musicOf(srtText).map(([s, e]) => [line.a + line.b * s, line.a + line.b * e]) : [];

// Judges the subtitle file srtText against heard (heardFromWords or
// heardFromPlus) for a video durMs long. lyrics: the ♪ captions of the
// video's other judged files, placed in video time [[lo, hi]]. Returns
// {verdict, kind, why, line, windows, lyrics, cleanPairs, densePairs}:
//   verdict  "good", "missing" or "bad"
//   kind     for a bad file: "unusable", "too few pairs", "spot" or "minute"
//   line     the fix line {a, b}, video time = a + b × file time, for a good
//            or missing file
//   windows  for a missing file, the windows [from, to] the check failed
//   lyrics   this file's ♪ captions placed in video time by its step-2 line,
//            [] when it has none; for the other files' judging
export function judge({ srtText, heard, durMs, lyrics = [] }) {
  const caps = captionsOf(srtText);
  const clean = cleanPairs(caps, heard);
  const line2 = clean.length >= MIN_CLEAN_PAIRS ? ransac(clean) : null;
  const out = {
    verdict: "bad",
    kind: null,
    why: null,
    line: null,
    windows: [],
    lyrics: placeMusic(srtText, line2),
    cleanPairs: clean.length,
    densePairs: 0,
  };
  const bad = (kind, why) => ({ ...out, kind, why });
  const unusable = unusableWhy(caps, durMs);
  if (unusable) return bad("unusable", unusable);
  if (clean.length < MIN_CLEAN_PAIRS) return bad("too few pairs", `${clean.length} clean pairs`);
  if (!line2) return bad("too few pairs", "no line fits the clean pairs");
  const spot = spotWhy(clean, line2);
  if (spot) return bad("spot", spot);
  const line = ransac(densePairs(caps, heard, line2)) ?? line2;
  const dense = densePairs(caps, heard, line);
  out.densePairs = dense.length;
  const minute = minuteWhy(dense, line);
  if (minute) return bad("minute", minute);
  out.line = line;
  const starts = caps.map((c) => line.a + line.b * c.start).sort((a, b) => a - b);
  const counted = countedTest(starts.at(-1), durMs, lyrics);
  const windows = emptyWindows(starts, heard.spoken.filter(counted), durMs);
  if (windows.length === 0) return { ...out, verdict: "good" };
  return {
    ...out,
    verdict: "missing",
    why: `no captions for ${MISSING_WINDOW_MS / 1000} s at ${fmtMin(windows[0][0])}`,
    windows,
  };
}

// ---- the fix and the fill ----

// srtText with every start and end moved by the line, never below 0, through
// cleanSrt.
export function fixedText(srtText, { a, b }) {
  const at = (t) => msToSrtTime(Math.max(0, Math.round(a + b * srtTimeToMs(t))));
  const lines = srtText.split(/\r?\n/).map((l) => {
    const m = SRT_TIME_LINE_RE.exec(l);
    return m ? `${at(m[1])}${m[2]}${at(m[3])}${m[4]}` : l;
  });
  return cleanSrt(lines.join("\n"));
}

// The fill captions for a file judged missing, [{s, e, text}] in video time:
// each failing window's stretch, from the end of the caption before it (or
// the video's start) to the start of the caption after it (or the video's
// end), captioned from its counted heard words, leaving out those within
// FILL_EDGE_MS of either caption. Heard words are grouped into captions at a
// pause of FILL_PAUSE_MS, past FILL_MAX_MS or at FILL_MAX_WORDS, each ending
// FILL_TAIL_MS after its last word and FILL_GAP_MS before the next. From an
// old `+` file, its captions starting inside a stretch are taken as they are.
function fillCaptions(srtText, heard, durMs, lyrics, { a, b }) {
  const caps = captionsOf(srtText)
    .map((c) => ({ start: a + b * c.start, end: a + b * c.end, words: c.words }))
    .sort(cmpCaption);
  const starts = caps.map((c) => c.start);
  const counted = countedTest(starts.at(-1), durMs, lyrics);
  const from = heard.fillFrom.filter((x) => counted(x.s));
  const times = heard.fillWords.filter((x) => counted(x.s)).map((x) => x.s);
  const holes = new Set();
  for (const [w0] of emptyWindows(starts, times, durMs)) holes.add(bisectLeft(starts, w0));
  const groups = [];
  for (const h of [...holes].sort((p, q) => p - q)) {
    const lo = (h > 0 ? caps[h - 1].end : 0) + FILL_EDGE_MS;
    const hi = (h < caps.length ? caps[h].start : durMs) - FILL_EDGE_MS;
    if (heard.plus) {
      for (const x of from) if (lo <= x.s && x.s <= hi) groups.push({ ...x, asIs: true });
      continue;
    }
    let cur = [];
    for (const x of from) {
      if (!(lo <= x.s && x.e <= hi)) continue;
      if (
        cur.length &&
        (x.s - cur.at(-1).e >= FILL_PAUSE_MS || x.e - cur[0].s > FILL_MAX_MS || cur.length >= FILL_MAX_WORDS)
      ) {
        groups.push(cur);
        cur = [];
      }
      cur.push(x);
    }
    if (cur.length) groups.push(cur);
  }
  return groups.map((g, i) => {
    if (g.asIs) return { s: g.s, e: g.e, text: g.text };
    const next = groups[i + 1];
    let e = g.at(-1).e + FILL_TAIL_MS;
    if (next) e = Math.min(e, (next.asIs ? next.s : next[0].s) - FILL_GAP_MS);
    return { s: g[0].s, e, text: wrapLines(g.map((x) => x.text)) };
  });
}

// A file judged missing (judge's verdict, line and lyrics as given to it),
// moved by its fix line and with each missing stretch captioned from the
// heard words, through cleanSrt: {text, fills}, fills the captions added
// [{s, e, text}].
export function filledText(srtText, heard, durMs, lyrics, line) {
  const fills = fillCaptions(srtText, heard, durMs, lyrics, line);
  const entries = [
    ...parseSrt(fixedText(srtText, line)),
    ...fills.map((f) => ({ startMs: Math.max(0, Math.round(f.s)), endMs: Math.max(0, Math.round(f.e)), text: f.text })),
  ].sort((p, q) => p.startMs - q.startMs);
  return { text: cleanSrt(serializeSrt(entries)), fills };
}
