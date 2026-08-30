// Invariant checks from asr-timing-handoff.md §4 — all three must be zero.
import fs from "fs";
// out() not console.log: the deploy reconciler rewrites console.* calls
// into unilog DB rows, and these result lines must reach stdout.
const out = (s) => process.stdout.write(s + "\n");

const MIN_CUE_SEC = 0.9;
const MIN_START_GAP = 0.45;
const MAX_LINE_CHARS = 42;
const MAX_CHARS_PER_SEC = 28;

const text = fs.readFileSync(process.argv[2], "utf8");
const blocks = text.split(/\r?\n\r?\n/).filter((b) => b.trim());

const toSec = (h, m, s, ms) => +h * 3600 + +m * 60 + +s + +ms / 1000;

const cues = [];
for (const b of blocks) {
  const m = b.match(
    /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/,
  );
  if (!m) continue;
  const lines = b.split(/\r?\n/).slice(2);
  cues.push({
    start: toSec(m[1], m[2], m[3], m[4]),
    end: toSec(m[5], m[6], m[7], m[8]),
    lines,
    text: lines.join(" "),
  });
}

let short = 0,
  overlap = 0,
  closeStarts = 0,
  longLines = 0,
  fastCues = 0;
for (let i = 0; i < cues.length; i++) {
  const c = cues[i];
  const dur = c.end - c.start;
  if (dur < MIN_CUE_SEC - 0.001) {
    short++;
    out(`  short cue ${i + 1}: ${dur.toFixed(2)}s "${c.text.slice(0, 40)}"`);
  }
  if (i > 0 && c.start < cues[i - 1].end - 0.001) {
    overlap++;
    out(`  overlap at cue ${i + 1}: starts ${c.start.toFixed(2)} before prev end ${cues[i - 1].end.toFixed(2)}`);
  }
  if (i > 0 && c.start - cues[i - 1].start < MIN_START_GAP - 0.001) {
    closeStarts++;
    out(`  close starts at cue ${i + 1}: gap ${(c.start - cues[i - 1].start).toFixed(2)}s`);
  }
  for (const l of c.lines)
    if (l.length > MAX_LINE_CHARS) {
      longLines++;
      out(`  long line cue ${i + 1}: ${l.length} chars "${l}"`);
    }
  if (c.text.length / Math.max(0.01, dur) > MAX_CHARS_PER_SEC) {
    fastCues++;
    out(`  fast cue ${i + 1}: ${(c.text.length / dur).toFixed(1)} ch/s "${c.text.slice(0, 40)}"`);
  }
}

out(`${cues.length} cues | short: ${short} | overlaps: ${overlap} | close starts: ${closeStarts} | lines>42: ${longLines} | >28 ch/s: ${fastCues}`);
process.exit(short + overlap + closeStarts ? 1 : 0);
