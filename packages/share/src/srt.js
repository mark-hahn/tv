// Pure SRT subtitle text helpers: time <-> ms conversion, parse/serialize,
// formatting strip, "rolling" de-flicker sanitization, and the line layout
// shared with ASR. No I/O, no state.

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

// Subtitle geometry, shared with ASR: lines are at most this wide. ASR cuts
// its cues to fit two lines, at sentence, then clause, then word boundaries
// so a cue rarely ends mid-phrase; other files' cues are never cut.
export const MAX_LINE_CHARS = 60;
export const MAX_CUE_CHARS = MAX_LINE_CHARS * 2;
// The most lines a cue is balanced over; past this its lines are just filled.
const MAX_WRAP_LINES = 3;
// Splits this close to the most even one compete on punctuation.
const NEAR_EVEN_CHARS = 8;
// Break early at a sentence end once a cue is at least this full.
export const SENTENCE_BREAK_MIN = 56;
export const SENTENCE_END = /[.!?]["\')\]]?$/;
const CLAUSE_END = /[,;:]["\')\]]?$/;

// Group words into cues that fit MAX_CUE_CHARS, breaking at the end of a
// sentence where possible and at a clause otherwise.
export function groupWords(words) {
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
  const lineCount = Math.ceil(text.length / MAX_LINE_CHARS);
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

// Returns sanitized SRT string if anything changed, null if unchanged.
export function sanitizeSrt(raw) {
  const stripped = stripSrtFormatting(raw);
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

// The text every subtitle file is written as: sanitized, or as it came when
// there was nothing to fix.
export function cleanSrt(raw) {
  return sanitizeSrt(raw) ?? raw;
}
