// Pure SRT subtitle text helpers: time <-> ms conversion, parse/serialize,
// formatting strip, "rolling" de-flicker sanitization, and the line layout
// shared with ASR. No I/O, no state.

// Characters a subtitle may hold: ASCII, Latin accented letters, typographic
// dashes, quotes and ellipsis, € ™, and music symbols. Anything else (the
// U+FFFD of a misdecoded file, controls, zero-widths, a BOM) is removed.
const UNEXPECTED_CHARS =
  /[^\t\n\r\x20-\x7E -ſ‐-‧‰-›€™♩-♯]/g;

export function srtTimeToMs(timeStr) {
  // "hh:mm:ss,mmm" -> ms
  const m = /^([0-9]{2}):([0-9]{2}):([0-9]{2}),([0-9]{3})$/.exec(
    String(timeStr || "").trim(),
  );
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4]);
  if (![hh, mm, ss, ms].every((n) => Number.isFinite(n))) return null;
  return ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
}

export function msToSrtTime(msTotal) {
  let ms = Number(msTotal);
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  ms = Math.floor(ms);
  const hh = Math.floor(ms / 3600000);
  ms -= hh * 3600000;
  const mm = Math.floor(ms / 60000);
  ms -= mm * 60000;
  const ss = Math.floor(ms / 1000);
  ms -= ss * 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function stripSrtFormatting(srt) {
  return srt
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\h/g, " ")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n");
}

export function parseSrtTimeMs(t) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
  if (!m) return 0;
  return (
    parseInt(m[1]) * 3600000 +
    parseInt(m[2]) * 60000 +
    parseInt(m[3]) * 1000 +
    parseInt(m[4])
  );
}

export function formatSrtTimeMs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(mm).padStart(3, "0")}`;
}

export function parseSrt(srt) {
  const entries = [];
  const blocks = srt.trim().split(/\r?\n\r?\n+/);
  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    const timeLine = lines.find((l) => /-->/.test(l));
    if (!timeLine) continue;
    const tm = /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/.exec(
      timeLine,
    );
    if (!tm) continue;
    const startMs = parseSrtTimeMs(tm[1]);
    const endMs = parseSrtTimeMs(tm[2]);
    const timeIdx = lines.indexOf(timeLine);
    const text = lines
      .slice(timeIdx + 1)
      .join("\n")
      .trim();
    if (!text) continue;
    entries.push({ startMs, endMs, text });
  }
  return entries;
}

export function serializeSrt(entries) {
  return (
    entries
      .map(
        (e, i) =>
          `${i + 1}\n${formatSrtTimeMs(e.startMs)} --> ${formatSrtTimeMs(e.endMs)}\n${e.text}`,
      )
      .join("\n\n") + "\n"
  );
}

// Merge consecutive identical-text entries where the gap is < 250 ms.
function mergeRepeats(entries) {
  if (entries.length === 0) return entries;
  const merged = [];
  let cur = { ...entries[0] };
  for (let i = 1; i < entries.length; i++) {
    const next = entries[i];
    if (next.text === cur.text && next.startMs - cur.endMs < 250) {
      cur = { ...cur, endMs: next.endMs };
    } else {
      merged.push(cur);
      cur = { ...next };
    }
  }
  merged.push(cur);
  return merged;
}

// Fix "rolling/scrolling" subtitle format that causes on-screen flashing.
// Pattern: the same text appears in back-to-back entries with a tiny gap, and
// short (<250 ms) transitional entries carry one line from the previous cue
// and one from the next. Emby renders each entry independently so the 40 ms
// gap causes a visible blink.
export function derollSrt(entries) {
  if (entries.length === 0) return entries;

  // Pass 1: merge consecutive identical-text entries where the gap is < 250 ms.
  const merged = mergeRepeats(entries);

  // Detect rolling format: >15 % of merged entries are very short (<250 ms).
  const shortCount = merged.filter((e) => e.endMs - e.startMs < 250).length;
  if (shortCount < 3 || shortCount / merged.length <= 0.15) return merged;

  // Pass 2: remove short (<250 ms) transitional entries that share at least one
  // text line with an immediately adjacent entry (gap < 500 ms on either side).
  const result = [];
  for (let i = 0; i < merged.length; i++) {
    const e = merged[i];
    if (e.endMs - e.startMs >= 250) {
      result.push(e);
      continue;
    }
    const eLines = new Set(
      e.text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const prevGap = i > 0 ? e.startMs - merged[i - 1].endMs : Infinity;
    const nextGap =
      i < merged.length - 1 ? merged[i + 1].startMs - e.endMs : Infinity;

    let shared = false;
    if (prevGap < 500 && i > 0) {
      const prevLines = merged[i - 1].text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (prevLines.some((l) => eLines.has(l))) shared = true;
    }
    if (!shared && nextGap < 500 && i < merged.length - 1) {
      const nextLines = merged[i + 1].text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (nextLines.some((l) => eLines.has(l))) shared = true;
    }
    if (!shared) result.push(e);
  }
  return result;
}

// Subtitle geometry, shared with ASR: lines are at most this wide, and the
// cues ASR and vetting's fill make from timed words hold at most
// MAX_CUE_LINES of them, cut where a sentence or clause ends or the speaker
// pauses, as evenly as they can be (cueGroups). Other files' cues are never
// cut.
export const MAX_LINE_CHARS = 60;
const MAX_CUE_LINES = 2;
// The most lines a cue is balanced over; past this its lines are just filled.
const MAX_WRAP_LINES = 3;
// Splits this close to the most even one compete on punctuation.
const NEAR_EVEN_CHARS = 8;
// A run of speech ends at a sentence end once it is at least this full.
const SENTENCE_BREAK_MIN = 56;
const SENTENCE_END = /[.!?]["\')\]]?$/;
const CLAUSE_END = /[,;:]["\')\]]?$/;
// What cutting a run of speech between two words costs, in characters of
// unevenness: nothing after a sentence end, CUT_CLAUSE after a clause end,
// else CUT_WORD less up to PAUSE_BONUS for the pause before the next word
// (all of it from PAUSE_FULL_MS).
const CUT_CLAUSE = 12;
const CUT_WORD = 30;
const PAUSE_BONUS = 15;
const PAUSE_FULL_MS = 500;

// Whether words fit on MAX_CUE_LINES lines (filled in order, which takes the
// fewest).
export function fitsCue(words) {
  let lines = 1;
  let len = 0;
  for (const w of words) {
    if (len === 0) len = w.length;
    else if (len + 1 + w.length <= MAX_LINE_CHARS) len += 1 + w.length;
    else {
      lines++;
      len = w.length;
    }
  }
  return lines <= MAX_CUE_LINES;
}

function cutCost(word, pauseMs) {
  if (SENTENCE_END.test(word)) return 0;
  if (CLAUSE_END.test(word)) return CUT_CLAUSE;
  return CUT_WORD - PAUSE_BONUS * Math.min(1, Math.max(0, pauseMs) / PAUSE_FULL_MS);
}

// A run of words (texts, and pauses[i] the ms after word i) cut into the
// fewest pieces that each fit a cue, at the cuts that cost least: each
// piece's distance in characters from an even share of the run, plus cutCost
// at each cut. Returns where each piece ends, as a word index.
function splitRun(texts, pauses) {
  const n = texts.length;
  // fitEnd[i]: one past the last word a piece starting at word i can hold
  const fitEnd = texts.map((_, i) => {
    let j = i + 1;
    while (j < n && fitsCue(texts.slice(i, j + 1))) j++;
    return j;
  });
  let count = 0;
  for (let i = 0; i < n; i = fitEnd[i]) count++;
  if (count <= 1) return [n];
  const pre = [0];
  for (const t of texts) pre.push(pre.at(-1) + t.length + 1);
  const share = (pre[n] - 1) / count;
  // cost[j]: the least cost of the first j words in k pieces; back[k][j]
  // where its last piece starts
  let cost = Array(n + 1).fill(Infinity);
  cost[0] = 0;
  const back = [];
  for (let k = 0; k < count; k++) {
    const next = Array(n + 1).fill(Infinity);
    const from = Array(n + 1).fill(-1);
    for (let i = 0; i < n; i++) {
      if (cost[i] === Infinity) continue;
      const cut = i === 0 ? 0 : cutCost(texts[i - 1], pauses[i - 1]);
      for (let j = i + 1; j <= fitEnd[i]; j++) {
        const c = cost[i] + cut + Math.abs(pre[j] - pre[i] - 1 - share);
        if (c < next[j]) {
          next[j] = c;
          from[j] = i;
        }
      }
    }
    back.push(from);
    cost = next;
  }
  const ends = [];
  for (let k = count - 1, j = n; k >= 0; k--) {
    ends.unshift(j);
    j = back[k][j];
  }
  return ends;
}

// Timed words [{text, s, e}] (ms), in order, grouped into cues: a run of
// speech ends at a pause of more than maxGapMs, or at a sentence end once it
// is SENTENCE_BREAK_MIN full, and each run is cut by splitRun. Returns the
// cues' words, [[word]].
export function cueGroups(words, maxGapMs) {
  const runs = [];
  let cur = null;
  let len = 0;
  for (const w of words) {
    const last = cur?.at(-1);
    if (!cur || w.s - last.e > maxGapMs || (SENTENCE_END.test(last.text) && len >= SENTENCE_BREAK_MIN)) {
      cur = [w];
      len = w.text.length;
      runs.push(cur);
    } else {
      cur.push(w);
      len += 1 + w.text.length;
    }
  }
  return runs.flatMap((run) => {
    const texts = run.map((w) => w.text);
    const pauses = run.map((w, i) => (i + 1 < run.length ? run[i + 1].s - w.e : 0));
    let start = 0;
    return splitRun(texts, pauses).map((end) => {
      const piece = run.slice(start, end);
      start = end;
      return piece;
    });
  });
}

// Every way to put count words on n lines, as the word each later line starts at.
function* lineStarts(count, n, from = 1) {
  if (n === 1) return yield [];
  for (let i = from; i <= count - n + 1; i++)
    for (const rest of lineStarts(count, n - 1, i + 1)) yield [i, ...rest];
}

// Wrap a cue onto the fewest lines of MAX_LINE_CHARS, as even as they can be.
// Among the splits within NEAR_EVEN_CHARS of the most even, the one ending
// lines at a sentence, then at a clause, wins, then the one whose bottom line
// is the widest, then the most even.
export function wrapLines(words) {
  const text = words.join(" ");
  if (text.length <= MAX_LINE_CHARS || words.length < 2) return text;
  // n lines hold n * MAX_LINE_CHARS characters and the n - 1 spaces between
  const lineCount = Math.ceil((text.length + 1) / (MAX_LINE_CHARS + 1));
  for (let n = lineCount; n <= MAX_WRAP_LINES; n++) {
    const fits = [];
    for (const starts of lineStarts(words.length, n)) {
      const cuts = [0, ...starts, words.length];
      const lines = starts
        .concat(words.length)
        .map((end, k) => words.slice(cuts[k], end).join(" "));
      const lens = lines.map((l) => l.length);
      const widest = Math.max(...lens);
      if (widest > MAX_LINE_CHARS) continue;
      const punct = starts.reduce(
        (sum, i) =>
          sum +
          (SENTENCE_END.test(words[i - 1])
            ? 0
            : CLAUSE_END.test(words[i - 1])
              ? 1
              : 2),
        0,
      );
      fits.push({
        lines,
        punct,
        uneven: widest - Math.min(...lens),
        topHeavy: lens[n - 1] < widest ? 1 : 0,
      });
    }
    if (!fits.length) continue;
    const mostEven = Math.min(...fits.map((f) => f.uneven));
    const pick = fits
      .filter((f) => f.uneven <= mostEven + NEAR_EVEN_CHARS)
      .sort(
        (a, b) =>
          a.punct - b.punct || a.topHeavy - b.topHeavy || a.uneven - b.uneven,
      )[0];
    return pick.lines.join("\n");
  }
  // ponytail: past MAX_WRAP_LINES (only junk blocks) or with a word wider than
  // a line, lines are just filled; balance them if real cues ever get there
  const lines = [];
  for (const w of words) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + 1 + w.length <= MAX_LINE_CHARS)
      lines[last] += " " + w;
    else lines.push(w);
  }
  return lines.join("\n");
}

// Lay every cue out the way ASR's are, keeping its timing: its lines joined
// into one and wrapped by wrapLines. A cue whose lines start new speakers'
// "-" keeps one line per speaker when each fits.
export function reflowSrt(entries) {
  return entries.map((e) => {
    const parts = e.text
      .split(/\n(?=\s*-)/)
      .map((p) => p.split(/\s+/).filter(Boolean));
    const speakers = parts.map((p) => p.join(" "));
    const text =
      speakers.length > 1 && speakers.every((s) => s.length <= MAX_LINE_CHARS)
        ? speakers.join("\n")
        : wrapLines(parts.flat());
    return { ...e, text };
  });
}

// ---- ASR's cues (the `+` file) from timed words ----

// measured word gaps larger than this never share a cue
const ASR_GAP_MS = 1000;
// Cue display-duration bounds.
const GUARD_MIN_MS = 350;
const GUARD_MAX_MS = 12000;
const GUARD_CHARS_PER_SEC = 16;
// A cue may outlast the speech a little, but not by multiples — anything past
// this is a line stretched across a silence.
const displayCap = (chars) => {
  const spoken = Math.min(GUARD_MAX_MS, Math.max(GUARD_MIN_MS, (chars / GUARD_CHARS_PER_SEC) * 1000));
  return { spoken, max: Math.min(GUARD_MAX_MS, spoken * 2.5 + 1000) };
};
// Every cue clears the screen before the next appears.
const CUE_GAP_MS = 80;
// A cue must stay up long enough to read even when the words it covers were
// spoken in a fraction of a second ("No.", "4%.").
const MIN_CUE_MS = 900;
// Cues starting closer together than this are effectively simultaneous
// (overlapping dialogue). Merge them when the text fits, otherwise force
// them apart, so no cue is ever crammed into a flash.
const CUE_MERGE_MS = 450;
// enough that the earlier cue can always reach MIN_CUE_MS
const MIN_CUE_SPACING_MS = MIN_CUE_MS + CUE_GAP_MS;

// Order the cues, hold each one long enough to read, and clear it before the
// next appears. Applied last, so nothing downstream can reintroduce a flash.
function normalizeCues(cues) {
  cues.sort((a, b) => a.startMs - b.startMs);

  const flat = (t) => t.replace(/\n/g, " ");
  const merged = [];
  for (const cue of cues) {
    const prev = merged[merged.length - 1];
    const joined = prev ? `${flat(prev.text)} ${flat(cue.text)}`.split(" ") : [];
    if (prev && cue.startMs - prev.startMs < CUE_MERGE_MS && fitsCue(joined)) {
      prev.text = wrapLines(joined);
      prev.endMs = Math.max(prev.endMs, cue.endMs);
      continue;
    }
    merged.push({ ...cue });
  }

  // give every cue room to be read; this also guarantees the end below can
  // always reach its minimum without running into the next cue
  for (let i = 1; i < merged.length; i++) {
    const floor = merged[i - 1].startMs + MIN_CUE_SPACING_MS;
    if (merged[i].startMs < floor) merged[i].startMs = floor;
  }

  for (let i = 0; i < merged.length; i++) {
    const cue = merged[i];
    const cap = displayCap(flat(cue.text).length);
    const room = i + 1 < merged.length ? merged[i + 1].startMs - CUE_GAP_MS : Infinity;
    const wanted = Math.max(cue.endMs, cue.startMs + Math.min(MIN_CUE_MS, cap.max));
    cue.endMs = Math.max(cue.startMs + GUARD_MIN_MS, Math.min(wanted, room));
  }
  return merged.map((c) => ({
    startMs: Math.max(0, Math.round(c.startMs)),
    endMs: Math.max(0, Math.round(c.endMs)),
    text: c.text,
  }));
}

// ASR's cues from its timed words [{text, s, e}] (ms), as cueGroups groups
// them, each from its first word's start to its last word's end:
// [{startMs, endMs, text}].
export function asrCues(words) {
  const cues = cueGroups(words, ASR_GAP_MS).map((g) => {
    const startMs = g[0].s;
    let endMs = g.at(-1).e;
    if (endMs <= startMs) endMs = startMs + GUARD_MIN_MS;
    const text = wrapLines(g.map((w) => w.text));
    const cap = displayCap(text.length);
    if (endMs - startMs > cap.max) endMs = startMs + Math.max(GUARD_MIN_MS, cap.spoken * 1.6 + 400);
    return { startMs, endMs, text };
  });
  return normalizeCues(cues);
}

// A cue ending in a letter or digit stops mid-phrase.
const MID_PHRASE = /[A-Za-z0-9]$/;
// The share of an ASR file's cue starts that are its transcript's word starts
// when the file is as asr.js wrote it (a few are pushed apart).
const TRANSCRIPT_MATCH = 0.9;

// A cue's words timed by where each sits in its text, between the cue's start
// and end: [{text, s, e}].
function spreadWords(c) {
  const texts = c.text.split(/\s+/).filter(Boolean);
  const total = texts.join(" ").length;
  const at = (chars) => c.startMs + (Math.min(chars, total) / total) * (c.endMs - c.startMs);
  let chars = 0;
  return texts.map((text) => {
    const s = at(chars);
    chars += text.length + 1;
    return { text, s, e: at(chars) };
  });
}

// An ASR file made before its cues were cut as they are now, cut again. With
// words, its video's word-timed transcript [[text, s, e]], when
// TRANSCRIPT_MATCH of the file's cues start on one of their starts (no hand
// timing has moved it): made again from them, as asr.js makes a new one. Otherwise from the file alone:
// each cue that ends mid-phrase is joined with the cues after it up to one
// that does not (within ASR_GAP_MS), and each cue too long for MAX_CUE_LINES
// is taken alone, and asrCues cuts them again, their words timed by
// spreadWords, so a cut inside an old cue gets an estimated start. Every other
// cue stays as it is.
export function recueSrt(srtText, words = null) {
  const cues = parseSrt(srtText);
  if (words) {
    const starts = new Set(words.map(([, s]) => s));
    if (cues.filter((c) => starts.has(c.startMs)).length >= TRANSCRIPT_MATCH * cues.length)
      return cleanSrt(serializeSrt(asrCues(words.map(([text, s, e]) => ({ text, s, e })))));
  }
  const out = [];
  const made = new Set();
  for (let i = 0; i < cues.length; ) {
    let j = i + 1;
    while (
      j < cues.length &&
      MID_PHRASE.test(cues[j - 1].text) &&
      cues[j].startMs - cues[j - 1].endMs <= ASR_GAP_MS
    )
      j++;
    const stretch = cues.slice(i, j);
    if (stretch.length === 1 && fitsCue(stretch[0].text.split(/\s+/))) out.push(stretch[0]);
    else
      for (const c of asrCues(stretch.flatMap(spreadWords))) {
        made.add(c);
        out.push(c);
      }
    i = j;
  }
  // a stretch's last cue may have been held past the next one's start
  for (let k = 0; k + 1 < out.length; k++)
    if (made.has(out[k]))
      out[k].endMs = Math.max(out[k].startMs + GUARD_MIN_MS, Math.min(out[k].endMs, out[k + 1].startMs - CUE_GAP_MS));
  return cleanSrt(serializeSrt(out));
}

// Returns sanitized SRT string if anything changed, null if unchanged.
export function sanitizeSrt(raw) {
  const stripped = stripSrtFormatting(raw).replace(UNEXPECTED_CHARS, "");
  const entries = parseSrt(stripped);
  // Sort by start time to fix out-of-order entries from embedded extraction
  const sorted = [...entries].sort((a, b) => a.startMs - b.startMs);
  // Merge entries with identical timestamps (two cues at same time → one entry)
  const merged = [];
  for (const e of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && prev.startMs === e.startMs && prev.endMs === e.endMs) {
      prev.text = prev.text + "\n" + e.text;
    } else {
      merged.push({ ...e });
    }
  }
  const reordered = sorted.some((e, i) => e !== entries[i]);
  const changed =
    reordered || merged.length !== entries.length || stripped !== raw;
  // repeats again after the reflow: the same words broken differently match
  // only once joined
  const out = serializeSrt(mergeRepeats(reflowSrt(derollSrt(merged))));
  if (changed || out !== serializeSrt(merged)) return out;
  return null;
}

// A subtitle file's bytes as text. Bytes that are not valid UTF-8 are taken
// as Windows-1252, the usual encoding of older English .srt files, so its
// curly quote 0x92 comes out as ’ instead of U+FFFD.
export function decodeSrt(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // not UTF-8
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// The text every subtitle file is written as: sanitized, or as it came when
// there was nothing to fix.
export function cleanSrt(raw) {
  return sanitizeSrt(raw) ?? raw;
}
