#!/usr/bin/env node
/**
 * One-time migration: introDur -> trimPos + skipDur
 *
 * Migrate only shows where inEmby is true. Based on existing introDur:
 *   - introDur missing/null -> add no trimPos/skipDur
 *   - introDur === 0        -> trimPos = 0,            skipDur = 0
 *   - introDur > 0          -> trimPos = 0,            skipDur = introDur
 *   - introDur < 0          -> trimPos = abs(introDur), skipDur = 0
 *
 * introDur is left untouched (kept for backwards compatibility).
 *
 * Run on the REMOTE server. Stop all servers first so deploying is only copying.
 * Usage: node /root/dev/apps/tv/scripts/migrate-introdur-to-trimskip.js
 */

import fs from "fs";

const REMOTE_TVDB_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json";
const BACKUP_SUFFIX = ".before-trimskip-migration";

console.log("========================================");
console.log("TVDB Migration: introDur -> trimPos + skipDur");
console.log("========================================\n");

if (!fs.existsSync(REMOTE_TVDB_PATH)) {
  console.error(`ERROR: ${REMOTE_TVDB_PATH} not found`);
  console.error("This script must be run on the remote server (hahnca.com).");
  process.exit(1);
}

console.log(`Loading: ${REMOTE_TVDB_PATH}`);
const tvdbDataRaw = fs.readFileSync(REMOTE_TVDB_PATH, "utf8");
const tvdbData = JSON.parse(tvdbDataRaw);

const showNames = Object.keys(tvdbData);
console.log(`Found ${showNames.length} shows\n`);

const stats = {
  total: showNames.length,
  notInEmby: 0,
  nullIntroDur: 0,
  zero: 0,
  positive: 0,
  negative: 0,
  errors: [],
};

console.log("Migrating shows...");
for (const showName of showNames) {
  const show = tvdbData[showName];
  try {
    if (!show || typeof show !== "object") continue;
    if (show.inEmby !== true) {
      stats.notInEmby++;
      continue;
    }

    const introDur = show.introDur;

    if (introDur == null) {
      // add no trimPos/skipDur
      stats.nullIntroDur++;
      continue;
    }

    if (introDur === 0) {
      show.trimPos = 0;
      show.skipDur = 0;
      stats.zero++;
    } else if (introDur > 0) {
      show.trimPos = 0;
      show.skipDur = introDur;
      stats.positive++;
    } else {
      // introDur < 0
      show.trimPos = Math.abs(introDur);
      show.skipDur = 0;
      stats.negative++;
    }
  } catch (error) {
    stats.errors.push({ showName, error: error.message });
    console.error(`  ERROR processing ${showName}: ${error.message}`);
  }
}

const backupPath = REMOTE_TVDB_PATH + BACKUP_SUFFIX;
console.log(`\nCreating backup: ${backupPath}`);
fs.writeFileSync(backupPath, tvdbDataRaw, "utf8");

console.log(`Saving migrated data: ${REMOTE_TVDB_PATH}`);
fs.writeFileSync(REMOTE_TVDB_PATH, JSON.stringify(tvdbData, null, 2), "utf8");

console.log("\n========================================");
console.log("Migration Complete!");
console.log("========================================");
console.log(`Total shows:            ${stats.total}`);
console.log(`Not in Emby (skipped):  ${stats.notInEmby}`);
console.log(`introDur null (no add): ${stats.nullIntroDur}`);
console.log(`introDur === 0:         ${stats.zero} (trimPos=0, skipDur=0)`);
console.log(
  `introDur > 0:           ${stats.positive} (trimPos=0, skipDur=introDur)`,
);
console.log(
  `introDur < 0:           ${stats.negative} (trimPos=abs, skipDur=0)`,
);
console.log(`Errors:                 ${stats.errors.length}`);

if (stats.errors.length > 0) {
  console.log("\nErrors encountered:");
  stats.errors.forEach((e) => console.log(`  - ${e.showName}: ${e.error}`));
}

console.log(`\nBackup saved to: ${backupPath}`);
console.log(`To restore: cp ${backupPath} ${REMOTE_TVDB_PATH}`);
