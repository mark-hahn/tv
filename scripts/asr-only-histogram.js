#!/usr/bin/env node
// One-time script: find videos with ONLY a .asr.srt sidecar (no other subtitle sidecars)
// and print ctime + mtime histograms for the .asr.srt files.
// No files are modified.

const fs = require("fs");
const path = require("path");

const TV_DIR = "/mnt/media/tv";
const TVDB_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json";

const VIDEO_EXTS = new Set([
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "flv",
  "mpeg",
  "3gp",
  "m4v",
  "ts",
  "rm",
  "vob",
  "ogv",
  "divx",
]);

const tvdb = JSON.parse(fs.readFileSync(TVDB_PATH, "utf8"));
const inEmbyShows = new Set(Object.keys(tvdb).filter((k) => tvdb[k].inEmby));

function walkDir(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of entries) {
    const fp = path.join(dir, f);
    let stat;
    try {
      stat = fs.statSync(fp);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkDir(fp, results);
    } else {
      const ext = f.split(".").pop().toLowerCase();
      if (VIDEO_EXTS.has(ext)) {
        results.push(fp);
      }
    }
  }
}

const allVideos = [];
walkDir(TV_DIR, allVideos);

// Filter to only videos under shows that are in Emby
const embyVideos = allVideos.filter((vp) => {
  const showName = vp.replace(TV_DIR + "/", "").split("/")[0];
  return inEmbyShows.has(showName);
});

console.log(`Total videos under inEmby shows: ${embyVideos.length}`);

const ctimeHist = {};
const mtimeHist = {};
const matched = [];

for (const vp of embyVideos) {
  const base = vp.replace(/\.[^.]+$/, "");
  const dir = path.dirname(vp);
  const basename = path.basename(base);

  let dirEntries;
  try {
    dirEntries = fs.readdirSync(dir);
  } catch {
    continue;
  }

  const asrSrtName = basename + ".asr.srt";
  if (!dirEntries.includes(asrSrtName)) continue;

  // Must have no other subtitle sidecars
  const hasOther = dirEntries.some((f) => {
    if (f === asrSrtName) return false;
    const suffix = f.slice(basename.length);
    return (
      f === basename + ".mb.chosen" ||
      /^\.(mb\d+|opn.{5})\.srt$/.test(suffix) ||
      /^\.(#[A-Z2-7]+)\.srt$/.test(suffix)
    );
  });
  if (hasOther) continue;

  const asrPath = path.join(dir, asrSrtName);
  let asrStat;
  try {
    asrStat = fs.statSync(asrPath);
  } catch {
    continue;
  }

  // Use LA timezone for day bucketing
  const toDay = (date) =>
    date
      .toLocaleDateString("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2");

  const ctimeDay = toDay(asrStat.ctime);
  const mtimeDay = toDay(asrStat.mtime);

  ctimeHist[ctimeDay] = (ctimeHist[ctimeDay] || 0) + 1;
  mtimeHist[mtimeDay] = (mtimeHist[mtimeDay] || 0) + 1;
  matched.push(vp);
}

console.log(`\nTotal videos with ONLY .asr.srt sidecar: ${matched.length}`);

console.log("\n--- ctime histogram (day of .asr.srt, LA time) ---");
for (const day of Object.keys(ctimeHist).sort()) {
  const bar = "#".repeat(Math.min(ctimeHist[day], 80));
  console.log(`  ${day}: ${String(ctimeHist[day]).padStart(4)}  ${bar}`);
}

console.log("\n--- mtime histogram (day of .asr.srt, LA time) ---");
for (const day of Object.keys(mtimeHist).sort()) {
  const bar = "#".repeat(Math.min(mtimeHist[day], 80));
  console.log(`  ${day}: ${String(mtimeHist[day]).padStart(4)}  ${bar}`);
}
