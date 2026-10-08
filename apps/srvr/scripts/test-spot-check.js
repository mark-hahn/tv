// Runs spotCheckSubs (src/subSpotCheck.js) on the episodes listed in a file,
// one video path under /mnt/media/tv per line, and prints each sidecar's
// verdict with how long the episode took. Nothing is written.
// Run on hahnca.com: cd /root/dev/apps/tv/apps/srvr && node scripts/test-spot-check.js <list>
import fsp from "fs/promises";
import * as path from "node:path";
import { spotCheckSubs } from "../src/subSpotCheck.js";

const out = (line) => process.stdout.write(line + "\n");
const fmtClip = (c) => (c.ms == null ? "-" : `${c.ms} (${c.pairs}, ±${c.spreadMs})`);

const list = (await fsp.readFile(process.argv[2], "utf8")).split("\n").filter(Boolean);
const times = [];
for (const relPath of list) {
  const startedAt = Date.now();
  try {
    const r = await spotCheckSubs({ path: relPath });
    const secs = (Date.now() - startedAt) / 1000;
    times.push(secs);
    const how =
      r.method === "asr"
        ? `audio a:${r.audioTrack}, clips at ${r.clipsFromS ? r.clipsFromS.map((s) => `${Math.round(s / 60)}m`).join(" & ") : "none"}, ${r.retries} retried`
        : "audio matching";
    out(`${path.basename(relPath)}\n  ${secs.toFixed(1)} s (cut ${(r.cutMs / 1000).toFixed(1)}, asr ${(r.asrMs / 1000).toFixed(1)}), ${how}`);
    const stem = path.basename(relPath).replace(/\.[^.]+$/, "");
    for (const f of r.files) {
      const name = f.file.slice(stem.length + 1);
      const detail = f.why ?? (f.clips ? f.clips.map(fmtClip).join(" | ") : "");
      const ofs = f.offsetMs != null ? ` ${f.offsetMs} ms` : "";
      out(`    ${name.padEnd(14)} ${(f.verdict + ofs).padEnd(18)} ${detail}`);
    }
  } catch (e) {
    out(`${relPath}\n  ERROR ${e.message}`);
  }
}
const avg = times.reduce((a, b) => a + b, 0) / times.length;
out(`\n${times.length} episodes, avg ${avg.toFixed(1)} s, max ${Math.max(...times).toFixed(1)} s`);
process.exit(0);
