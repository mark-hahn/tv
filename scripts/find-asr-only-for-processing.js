#!/usr/bin/env node
// One-time script: find videos with ONLY a batch .asr.srt sidecar that need
// full subtitle processing. Writes video paths to /root/dev/apps/tv/temp.txt.
// No files are modified.

const fs = require("fs");
const path = require("path");

const TV_DIR = "/mnt/media/tv";
const TVDB_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json";
const OUT_PATH = "/root/dev/apps/tv/temp.txt";

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

// April 15 and April 19, 2026 in LA time — the batch run dates
const BATCH_DATES = new Set(["2026-04-15", "2026-04-19"]);

function toDay(date) {
  return date
    .toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2");
}

// Parse SxxExx from filename, return { season, episode } or null
function parseSeasonEpisode(filePath) {
  const name = path.basename(filePath);
  const m = name.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
  if (!m) return null;
  return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
}

// Build a Set of "S01E01"-style keys that are watched for a show record
function buildWatchedSet(watchedEpis) {
  const set = new Set();
  if (!Array.isArray(watchedEpis)) return set;
  for (const row of watchedEpis) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const seasonNum = row[0];
    for (let i = 1; i < row.length; i++) {
      const epNum = row[i];
      const key =
        "S" +
        String(seasonNum).padStart(2, "0") +
        "E" +
        String(epNum).padStart(2, "0");
      set.add(key);
    }
  }
  return set;
}

// Return true if season has not yet premiered based on seasonPremiereDates
// seasonPremiereDates format: { "1": "2021/10", "2": "2025/07" }
function seasonIsInFuture(seasonPremiereDates, seasonNum) {
  if (!seasonPremiereDates) return false;
  const val = seasonPremiereDates[String(seasonNum)];
  if (!val) return false;
  // Parse YYYY/MM — treat as first day of that month
  const parts = val.split("/");
  if (parts.length < 2) return false;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // 0-indexed
  const premiereDate = new Date(year, month, 1);
  return premiereDate > new Date();
}

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

const tvdb = JSON.parse(fs.readFileSync(TVDB_PATH, "utf8"));

const allVideos = [];
walkDir(TV_DIR, allVideos);

const result = [];
let skippedNotInEmby = 0;
let skippedNoAsrSrt = 0;
let skippedNotBatchDate = 0;
let skippedHasOtherSidecar = 0;
let skippedWatched = 0;
let skippedFutureAir = 0;

for (const vp of allVideos) {
  const showName = vp.replace(TV_DIR + "/", "").split("/")[0];
  const tvdbRec = tvdb[showName];

  if (!tvdbRec || !tvdbRec.inEmby) {
    skippedNotInEmby++;
    continue;
  }

  const base = vp.replace(/\.[^.]+$/, "");
  const dir = path.dirname(vp);
  const basename = path.basename(base);
  const asrSrtName = basename + ".asr.srt";

  let dirEntries;
  try {
    dirEntries = fs.readdirSync(dir);
  } catch {
    continue;
  }

  if (!dirEntries.includes(asrSrtName)) {
    skippedNoAsrSrt++;
    continue;
  }

  // Check asr.srt was created/modified on a batch date
  const asrPath = path.join(dir, asrSrtName);
  let asrStat;
  try {
    asrStat = fs.statSync(asrPath);
  } catch {
    continue;
  }
  const ctimeDay = toDay(asrStat.ctime);
  const mtimeDay = toDay(asrStat.mtime);
  if (!BATCH_DATES.has(ctimeDay) && !BATCH_DATES.has(mtimeDay)) {
    skippedNotBatchDate++;
    continue;
  }

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
  if (hasOther) {
    skippedHasOtherSidecar++;
    continue;
  }

  const parsed = parseSeasonEpisode(vp);
  if (!parsed) {
    // Can't determine episode — include it (no watched/future check possible)
    result.push(vp);
    continue;
  }

  const { season, episode } = parsed;
  const key =
    "S" +
    String(season).padStart(2, "0") +
    "E" +
    String(episode).padStart(2, "0");

  // Skip if watched
  const watchedSet = buildWatchedSet(tvdbRec.watchedEpis);
  if (watchedSet.has(key)) {
    skippedWatched++;
    continue;
  }

  // Skip if season hasn't aired yet
  if (seasonIsInFuture(tvdbRec.seasonPremiereDates, season)) {
    skippedFutureAir++;
    continue;
  }

  result.push(vp);
}

fs.writeFileSync(OUT_PATH, result.join("\n") + "\n", "utf8");

console.log(`\nTotal videos found for processing: ${result.length}`);
console.log(`\nSkipped:`);
console.log(`  Not in Emby:           ${skippedNotInEmby}`);
console.log(`  No .asr.srt:           ${skippedNoAsrSrt}`);
console.log(`  Not a batch date:      ${skippedNotBatchDate}`);
console.log(`  Has other sidecars:    ${skippedHasOtherSidecar}`);
console.log(`  Watched:               ${skippedWatched}`);
console.log(`  Future air date:       ${skippedFutureAir}`);
console.log(`\nOutput written to: ${OUT_PATH}`);
