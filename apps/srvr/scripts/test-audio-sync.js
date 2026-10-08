// Tries syncSubToAudio (src/subSync.js) dry on TEST_COUNT random tv episodes:
// nothing is written. Each episode is tried with the one sidecar .srt that
// comes first by type (T, H, opn, S, asr), and the result or the error is
// printed with the video's size and how long it took.
// Run on hahnca.com: cd /root/dev/apps/tv/apps/srvr && node scripts/test-audio-sync.js
import fsp from "fs/promises";
import * as path from "node:path";
import { vidIsVideoName, vidIsSampleName } from "@tv/share";
import { sidecarType } from "../src/subOrigin.js";
import { syncSubToAudio } from "../src/subSync.js";

const TV_DIR = "/mnt/media/tv";
const TEST_COUNT = 20;
const TYPE_ORDER = ["T", "H", "V", "S", "+"];

const out = (line) => process.stdout.write(line + "\n");

const stemOf = (video) => path.basename(video).replace(/\.[^.]+$/, "");

// Every episode video under dir that has sidecars: [{video, srts}].
async function episodes(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const names = entries.filter((e) => e.isFile()).map((e) => e.name);
  const found = [];
  for (const name of names) {
    if (!vidIsVideoName(name) || vidIsSampleName(name)) continue;
    const stem = stemOf(name);
    const srts = names.filter(
      (f) =>
        f.endsWith(".srt") && (f === `${stem}.srt` || f.startsWith(`${stem}.`)),
    );
    if (srts.length) found.push({ video: path.join(dir, name), srts });
  }
  for (const e of entries)
    if (e.isDirectory()) found.push(...(await episodes(path.join(dir, e.name))));
  return found;
}

// The sidecar that comes first by type, then by name.
function firstSidecar(video, srts) {
  const stem = stemOf(video);
  const rank = (f) =>
    TYPE_ORDER.indexOf(sidecarType(f.slice(stem.length + 1, -".srt".length)));
  return [...srts].sort(
    (a, b) =>
      rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }),
  )[0];
}

const all = await episodes(TV_DIR);
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [all[i], all[j]] = [all[j], all[i]];
}
out(`${all.length} episodes with sidecars, trying ${TEST_COUNT}`);
for (const { video, srts } of all.slice(0, TEST_COUNT)) {
  const srt = firstSidecar(video, srts);
  const relPath = path.relative(TV_DIR, path.join(path.dirname(video), srt));
  const gb = ((await fsp.stat(video)).size / 2 ** 30).toFixed(1);
  const startedAt = Date.now();
  let result;
  try {
    const r = await syncSubToAudio({ path: relPath, dryRun: true });
    result = `offset ${r.offsetMs} ms (first third ${r.startOfsMs}, last ${r.endOfsMs})`;
  } catch (e) {
    result = `ERROR ${e.message}`;
  }
  const secs = Math.round((Date.now() - startedAt) / 1000);
  out(`${relPath}  ${gb} GB  ${secs} s\n  ${result}`);
}
process.exit(0);
