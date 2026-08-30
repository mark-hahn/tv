// §4 evaluation from asr-timing-handoff.md: word streams from each SRT,
// Levenshtein-aligned, reporting WER and per-word timing error.
// out() not console.log: the deploy reconciler rewrites console.* into
// unilog DB calls, which silenced these result lines once already.
const out = (s) => process.stdout.write(s + "\n");
//   node eval-timing.js <reference.srt> <candidate.srt>
import fs from "fs";

function parseSrt(path) {
  const text = fs.readFileSync(path, "utf8");
  const words = [];
  for (const b of text.split(/\r?\n\r?\n/)) {
    const m = b.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3}) --> (\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!m) continue;
    const s = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const e = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    const lines = b.split(/\r?\n/).slice(2).join(" ");
    const clean = lines
      .replace(/<[^>]*>/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[♪#]/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9' ]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    // spread word times evenly across the cue
    const n = clean.length;
    clean.forEach((w, i) =>
      words.push({ w, t: s + ((e - s) * i) / Math.max(1, n - 1 || 1) }),
    );
  }
  return words;
}

const ref = parseSrt(process.argv[2]);
const hyp = parseSrt(process.argv[3]);

// Levenshtein alignment over word streams (banded for speed)
const R = ref.length,
  H = hyp.length;
const BAND = 800;
const INF = 1e9;
const dp = Array.from({ length: R + 1 }, () => ({}));
const bt = Array.from({ length: R + 1 }, () => ({}));
const lo = (i) => Math.max(0, Math.round((i * H) / R) - BAND);
const hi = (i) => Math.min(H, Math.round((i * H) / R) + BAND);
for (let j = lo(0); j <= hi(0); j++) {
  dp[0][j] = j;
  bt[0][j] = "i";
}
for (let i = 1; i <= R; i++) {
  for (let j = lo(i); j <= hi(i); j++) {
    let best = INF,
      op = null;
    const del = (dp[i - 1][j] ?? INF) + 1;
    if (del < best) (best = del), (op = "d");
    if (j > 0) {
      const ins = (dp[i][j - 1] ?? INF) + 1;
      if (ins < best) (best = ins), (op = "i");
      const same = ref[i - 1].w === hyp[j - 1].w;
      const sub = (dp[i - 1][j - 1] ?? INF) + (same ? 0 : 1);
      if (sub <= best) (best = sub), (op = same ? "m" : "s");
    }
    dp[i][j] = best;
    bt[i][j] = op;
  }
}

// backtrace collecting matched-word timing errors
let i = R,
  j = H;
const errs = [];
const worst = [];
let subs = 0,
  dels = 0,
  inss = 0,
  matches = 0;
while (i > 0 || j > 0) {
  const op = bt[i]?.[j];
  if (op === "m" || op === "s") {
    if (op === "m") {
      errs.push(Math.abs(ref[i - 1].t - hyp[j - 1].t));
      worst.push({ w: ref[i - 1].w, rt: ref[i - 1].t, ht: hyp[j - 1].t });
      matches++;
    } else subs++;
    i--;
    j--;
  } else if (op === "d" || (op === undefined && i > 0)) {
    dels++;
    i--;
  } else {
    inss++;
    j--;
  }
}

errs.sort((a, b) => a - b);
const pct = (p) => errs[Math.min(errs.length - 1, Math.floor(errs.length * p))];
const wer = (((subs + dels + inss) / R) * 100).toFixed(1);
out(`ref ${R} words, hyp ${H} words | WER ${wer}% ` +
    `(sub ${subs}, del ${dels}, ins ${inss}, match ${matches})`);
out(`timing error: median ${pct(0.5).toFixed(2)}s, p90 ${pct(0.9).toFixed(2)}s, ` +
    `max ${errs[errs.length - 1].toFixed(2)}s, >1s: ${errs.filter((e) => e > 1).length}`);
const mmss = (t) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
worst.sort((a, b) => Math.abs(b.rt - b.ht) - Math.abs(a.rt - a.ht));
for (const w of worst.slice(0, 5))
  out(`  worst: "${w.w}" ref ${mmss(w.rt)} vs ours ${mmss(w.ht)} ` +
      `(${Math.abs(w.rt - w.ht).toFixed(2)}s)`);
