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

// Fix "rolling/scrolling" subtitle format that causes on-screen flashing.
// Pattern: the same text appears in back-to-back entries with a tiny gap, and
// short (<250 ms) transitional entries carry one line from the previous cue
// and one from the next. Emby renders each entry independently so the 40 ms
// gap causes a visible blink.
export function derollSrt(entries) {
  if (entries.length === 0) return entries;

  // Pass 1: merge consecutive identical-text entries where the gap is < 250 ms.
  let merged = [];
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

// Subtitle geometry, shared with ASR's cue building: a cue is at most two
// lines of this width. Splitting is done at sentence, then clause, then word
// boundaries so a cue rarely ends mid-phrase.
export const MAX_LINE_CHARS = 60;
export const MAX_CUE_CHARS = MAX_LINE_CHARS * 2;
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

// Wrap a cue onto two lines, preferring a break after punctuation and
// otherwise the most even split.
export function wrapLines(words) {
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

// Lay every cue out the way ASR's are: its lines joined into one, a cue over
// MAX_CUE_CHARS cut into several by groupWords with its time shared out by
// characters, and each wrapped by wrapLines.
export function reflowSrt(entries) {
  const out = [];
  for (const e of entries) {
    const words = e.text.split(/\s+/).filter(Boolean);
    const total = words.join(" ").length;
    const groups = total > MAX_CUE_CHARS ? groupWords(words) : [words];
    const span = e.endMs - e.startMs;
    let done = 0;
    for (const group of groups) {
      const len = group.join(" ").length;
      out.push({
        startMs: e.startMs + Math.round((done / total) * span),
        endMs: e.startMs + Math.round(((done + len) / total) * span),
        text: wrapLines(group),
      });
      done += len + 1;
    }
  }
  return out;
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
  const out = serializeSrt(reflowSrt(derollSrt(merged)));
  if (changed || out !== serializeSrt(merged)) return out;
  return null;
}

// The text every subtitle file is written as: sanitized, or as it came when
// there was nothing to fix.
export function cleanSrt(raw) {
  return sanitizeSrt(raw) ?? raw;
}
