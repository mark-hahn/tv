#!/usr/bin/env node
/**
 * One-time migration script to convert deleted property to inEmby property
 *
 * Changes:
 * - deleted prop (date string) -> inEmby prop (boolean, inverted)
 * - inEmby = true if deleted is falsy
 * - inEmby = false if deleted has a value
 * - Remove deleted property after conversion
 *
 * Run this from the REMOTE server at: /root/dev/apps/tv/apps/srvr/
 * Usage: node /root/apps/tv/scripts/migrate-deleted-to-inemby.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Remote server paths
const REMOTE_TVDB_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json";
const BACKUP_SUFFIX = ".before-inemby-migration";

console.log("========================================");
console.log("TVDB Migration: deleted -> inEmby");
console.log("========================================\n");

// Check if running on remote server
if (!fs.existsSync(REMOTE_TVDB_PATH)) {
  console.error(`ERROR: ${REMOTE_TVDB_PATH} not found`);
  console.error("This script must be run on the remote server at: hahnca.com");
  console.error("SSH to hahnca.com and run from: /root/dev/apps/tv/apps/srvr/");
  process.exit(1);
}

// Load tvdb.json
console.log(`Loading: ${REMOTE_TVDB_PATH}`);
const tvdbDataRaw = fs.readFileSync(REMOTE_TVDB_PATH, "utf8");
const tvdbData = JSON.parse(tvdbDataRaw);

const showNames = Object.keys(tvdbData);
console.log(`Found ${showNames.length} shows\n`);

// Stats
let stats = {
  total: showNames.length,
  hadDeleted: 0,
  noDeleted: 0,
  hadShowId: 0,
  noShowId: 0,
  errors: [],
};

// Migrate each show
console.log("Migrating shows...");
for (const showName of showNames) {
  const show = tvdbData[showName];

  try {
    // Check if deleted exists
    const hasDeleted = show.deleted !== undefined && show.deleted !== null;

    if (hasDeleted) {
      stats.hadDeleted++;
      // deleted exists -> inEmby = false
      show.inEmby = false;
      // Remove deleted property
      delete show.deleted;
    } else {
      stats.noDeleted++;
      // no deleted -> inEmby = true
      show.inEmby = true;
    }

    // Track showId presence
    if (show.showId) {
      stats.hadShowId++;
    } else {
      stats.noShowId++;
    }
  } catch (error) {
    stats.errors.push({ showName, error: error.message });
    console.error(`  ERROR processing ${showName}: ${error.message}`);
  }
}

// Create backup
const backupPath = REMOTE_TVDB_PATH + BACKUP_SUFFIX;
console.log(`\nCreating backup: ${backupPath}`);
fs.writeFileSync(backupPath, tvdbDataRaw, "utf8");

// Save migrated data
console.log(`Saving migrated data: ${REMOTE_TVDB_PATH}`);
fs.writeFileSync(REMOTE_TVDB_PATH, JSON.stringify(tvdbData, null, 2), "utf8");

// Print stats
console.log("\n========================================");
console.log("Migration Complete!");
console.log("========================================");
console.log(`Total shows:        ${stats.total}`);
console.log(`Had deleted prop:   ${stats.hadDeleted} (now inEmby: false)`);
console.log(`No deleted prop:    ${stats.noDeleted} (now inEmby: true)`);
console.log(`Had showId:         ${stats.hadShowId}`);
console.log(`No showId:          ${stats.noShowId}`);
console.log(`Errors:             ${stats.errors.length}`);

if (stats.errors.length > 0) {
  console.log("\nErrors encountered:");
  stats.errors.forEach((e) => {
    console.log(`  - ${e.showName}: ${e.error}`);
  });
}

console.log(`\nBackup saved to: ${backupPath}`);
console.log("\nNext steps:");
console.log("1. Verify the migration by checking a few records in tvdb.json");
console.log("2. Deploy updated code changes");
console.log("3. If everything works, you can delete the backup file");
console.log("\nTo restore from backup if needed:");
console.log(`  cp ${backupPath} ${REMOTE_TVDB_PATH}`);
