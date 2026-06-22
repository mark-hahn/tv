#!/usr/bin/env node
/**
 * One-time migration: flat intro fields -> seasonIntros["1"]
 *
 * For each record with any non-null flat trimPos/startMark/skipDur, move them
 * into seasonIntros["1"] = { trimPos, startMark, skipDur } (season 1, so the
 * getSeasonIntro fallback applies them to every season), then delete the flat
 * trimPos/startMark/skipDur fields.
 *
 * Run on the REMOTE server with tv-srvr stopped (editing tvdb.json directly).
 * Usage: node /root/dev/apps/tv/scripts/migrate-flat-intro-to-seasonIntros.js
 */

import fs from "fs";

const REMOTE_TVDB_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json";
const BACKUP_SUFFIX = ".before-seasonIntros-migration";

console.log("========================================");
console.log("TVDB Migration: flat intro -> seasonIntros");
console.log("========================================\n");

if (!fs.existsSync(REMOTE_TVDB_PATH)) {
  console.error(`ERROR: ${REMOTE_TVDB_PATH} not found`);
  console.error("This script must be run on the remote server (hahnca.com).");
  process.exit(1);
}

console.log(`Loading: ${REMOTE_TVDB_PATH}`);
const tvdbDataRaw = fs.readFileSync(REMOTE_TVDB_PATH, "utf8");
const tvdbData = JSON.parse(tvdbDataRaw);

const backupPath = REMOTE_TVDB_PATH + BACKUP_SUFFIX;
fs.writeFileSync(backupPath, tvdbDataRaw);
console.log(`Backup written: ${backupPath}\n`);

const showNames = Object.keys(tvdbData);
console.log(`Found ${showNames.length} shows\n`);

const stats = { migrated: 0, skipped: 0, stragglers: [] };

for (const showName of showNames) {
  const show = tvdbData[showName];
  if (!show || typeof show !== "object") continue;

  const hasFlat =
    show.trimPos != null || show.startMark != null || show.skipDur != null;

  if (hasFlat) {
    show.seasonIntros = show.seasonIntros || {};
    show.seasonIntros["1"] = {
      trimPos: show.trimPos ?? null,
      startMark: show.startMark ?? null,
      skipDur: show.skipDur ?? null,
    };
    delete show.trimPos;
    delete show.startMark;
    delete show.skipDur;
    stats.migrated++;
    console.log(
      `  migrated ${showName} -> seasonIntros["1"]=${JSON.stringify(show.seasonIntros["1"])}`,
    );
  } else {
    stats.skipped++;
  }

  // Catch any straggler flat fields (should be none after the delete above)
  if (show.trimPos != null || show.startMark != null || show.skipDur != null) {
    stats.stragglers.push(showName);
  }
}

fs.writeFileSync(REMOTE_TVDB_PATH, JSON.stringify(tvdbData, null, 2));

console.log("\n========================================");
console.log(`Migrated: ${stats.migrated}`);
console.log(`Skipped (no flat intro data): ${stats.skipped}`);
if (stats.stragglers.length > 0) {
  console.log(
    `WARNING: stragglers still have flat fields: ${stats.stragglers.join(", ")}`,
  );
} else {
  console.log("No stragglers — all flat intro fields removed.");
}
console.log("========================================");
console.log("Done. Restart tv-srvr.");
