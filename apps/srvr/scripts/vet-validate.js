// Checks the subtitle vetting judge (src/subJudge.js) against the analysis it
// was built from (subs-final-plan.md, step 10): every file of the fresh100
// and test100 sets in data/sub-analysis on hahnca.com is judged, and its
// verdict, fix line, fill and verdict against the old `+` file are compared
// with a reference dump of the analysis's own logic (vet-validate-ref.py,
// which runs evaluate.py, fill.py and plus.py with the final variant). Reads
// only; writes nothing. On hahnca.com:
//
//   python3 scripts/vet-validate-ref.py /tmp/ref.json
//   node scripts/vet-validate.js /tmp/ref.json

import fs from "fs";
import zlib from "zlib";
import * as path from "node:path";
import { judge, heardFromWords, heardFromPlus, filledText, pyRound, captionsOf } from "../src/subJudge.js";

const SETS_DIR = "/root/dev/apps/tv/apps/srvr/data/sub-analysis";
const PLUS_DIR = path.join(SETS_DIR, "plusfile");
// fix lines closer than this everywhere in the file count as the same
const SAME_FIX_MS = 1;

const refPath = process.argv[2];
if (!refPath) throw new Error("usage: node scripts/vet-validate.js <ref.json>");
const ref = JSON.parse(fs.readFileSync(refPath, "utf8"));
const refOf = new Map(ref.map((r) => [`${r.set}/${r.vid}/${r.name}`, r]));

// The transcript's words as asr.js keeps them: punctuation glued onto the
// word before it.
function transcriptWords(file) {
  const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
  const words = [];
  for (const r of json.results) {
    const content = r.alternatives?.[0]?.content ?? "";
    if (r.type === "word")
      words.push([content, Math.round(r.start_time * 1000), Math.round(r.end_time * 1000)]);
    else if (r.type === "punctuation" && words.length) words.at(-1)[0] += content;
  }
  return words;
}

// evaluate.py's video_files: embedded tracks, T before H and each by index,
// then the downloads in the order they were tried.
function videoFiles(vd) {
  const read = (f) => (fs.existsSync(path.join(vd, f)) ? JSON.parse(fs.readFileSync(path.join(vd, f), "utf8")) : null);
  const tracks = read("tracks.json")?.tracks ?? [];
  const opn = read("opn.json") ?? {};
  const emb = [...tracks]
    .sort((a, b) => (a[0] !== "T") - (b[0] !== "T") || Number(a.slice(1)) - Number(b.slice(1)))
    .map((name) => ({ name, kind: "embedded" }));
  const dls = (opn.search?.tried ?? [])
    .map((fid) => `opn-${fid}`)
    .filter((name) => fs.existsSync(path.join(vd, `${name}.srt`)))
    .map((name) => ({ name, kind: "download" }));
  return [...emb, ...dls];
}

const counts = { files: 0, verdictSame: 0, fixSame: 0, fixCompared: 0, fillSame: 0, fillCompared: 0, plusSame: 0, plusCompared: 0 };
const diffs = [];

function maxFixGap(f1, f2, durMs) {
  if (!f1 || !f2) return f1 === f2 ? 0 : Infinity;
  let worst = 0;
  for (const t of [0, durMs]) {
    const a = f1.a + f1.b * t;
    const b = f2[0] + f2[1] * t;
    worst = Math.max(worst, Math.abs(a - b));
  }
  return worst;
}

for (const set of ["fresh100", "test100"]) {
  const picks = JSON.parse(fs.readFileSync(path.join(SETS_DIR, set, "picks.json"), "utf8"));
  for (const v of picks) {
    const vd = path.join(SETS_DIR, set, "v", v.id);
    const tp = path.join(vd, "transcript.json.gz");
    if (!fs.existsSync(tp)) continue;
    const durMs = pyRound(v.durS * 1000);
    const heard = heardFromWords(transcriptWords(tp), durMs);
    const plusFile = path.join(PLUS_DIR, set, `${v.id}.asr.srt`);
    const plusHeard = fs.existsSync(plusFile) ? heardFromPlus(fs.readFileSync(plusFile, "utf8"), durMs) : null;
    const files = videoFiles(vd)
      .map((f) => ({ ...f, text: fs.readFileSync(path.join(vd, `${f.name}.srt`), "utf8") }))
      .filter((f) => captionsOf(f.text).length > 0);
    // each file's own placed ♪ captions, as its siblings see them
    for (const f of files) {
      f.lyrics = judge({ srtText: f.text, heard, durMs }).lyrics;
      if (plusHeard) f.plusLyrics = judge({ srtText: f.text, heard: plusHeard, durMs }).lyrics;
    }
    files.forEach((f, i) => {
      const sibs = files.filter(
        (g, k) => g !== f && (g.kind === "embedded" || (f.kind === "download" && k < i)),
      );
      const key = `${set}/${v.id}/${f.name}`;
      const r = refOf.get(key);
      if (!r) {
        diffs.push(`${key}: not in the reference`);
        return;
      }
      counts.files++;
      const j = judge({ srtText: f.text, heard, durMs, lyrics: sibs.flatMap((g) => g.lyrics) });
      const kind = j.verdict === "bad" ? j.kind : j.verdict;
      const note = [];
      if (kind === r.verdict) counts.verdictSame++;
      else note.push(`verdict ${kind} (${j.why}) vs ${r.verdict} (${r.why})`);
      if (j.line || r.fix) {
        counts.fixCompared++;
        const gap = maxFixGap(j.line, r.fix, durMs);
        if (gap < SAME_FIX_MS) counts.fixSame++;
        else note.push(`fix differs by ${gap.toFixed(3)} ms`);
      }
      if (r.fills || j.verdict === "missing") {
        counts.fillCompared++;
        const lyrics = sibs.flatMap((g) => g.lyrics);
        const mine = j.verdict === "missing" ? filledText(f.text, heard, durMs, lyrics, j.line).fills : [];
        const theirs = r.fills ?? [];
        const same =
          mine.length === theirs.length &&
          mine.every(
            (m, k) =>
              Math.abs(m.s - theirs[k][0]) < 1 &&
              Math.abs(m.e - theirs[k][1]) < 1 &&
              m.text.replace(/\n/g, " ").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/ +/).filter(Boolean).join(" ") === theirs[k][2],
          );
        if (same) counts.fillSame++;
        else note.push(`fill: ${mine.length} captions vs ${theirs.length}`);
      }
      if (plusHeard && r.plus) {
        counts.plusCompared++;
        const jp = judge({ srtText: f.text, heard: plusHeard, durMs, lyrics: sibs.flatMap((g) => g.plusLyrics) });
        const pk = jp.verdict === "bad" ? jp.kind : jp.verdict;
        // the analysis keeps a fix line only for a good file
        const fixGap = pk === "good" ? maxFixGap(jp.line, r.plusFix, durMs) : 0;
        if (pk === r.plus && fixGap < SAME_FIX_MS) counts.plusSame++;
        else note.push(`plus ${pk} vs ${r.plus}, fix gap ${fixGap.toFixed(3)} ms`);
      }
      if (note.length) diffs.push(`${key} ${v.show}: ${note.join("; ")}`);
    });
  }
}

console.log(JSON.stringify(counts));
console.log(`reference files: ${ref.length}`);
for (const d of diffs) console.log(d);
