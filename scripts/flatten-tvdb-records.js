#!/usr/bin/env node
/**
 * Flatten TVDB Records Migration
 *
 * This script flattens nested emby/gap/disk/sync objects in tvdb.json
 * and removes the show.name property (keeping only show.Name).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to tvdb.json (relative to where script is run from)
const TVDB_PATH = path.join(process.cwd(), "data", "tvdb.json");

console.log("========================================");
console.log("TVDB Migration: Flatten Nested Objects");
console.log("========================================\n");

// Read tvdb.json
console.log("Loading:", TVDB_PATH);
const tvdbData = JSON.parse(fs.readFileSync(TVDB_PATH, "utf8"));
const shows = Object.values(tvdbData);
console.log(`Found ${shows.length} shows\n`);

console.log("Flattening nested objects...\n");

let flattenedCount = 0;
let removedNameCount = 0;
let errors = 0;

for (const show of shows) {
  try {
    // Remove duplicate show.name property (keep only show.Name)
    if (show.name && show.Name) {
      delete show.name;
      removedNameCount++;
    } else if (show.name && !show.Name) {
      // If only lowercase name exists, convert to Name
      show.Name = show.name;
      delete show.name;
      removedNameCount++;
    }

    // Flatten emby object
    if (show.emby && typeof show.emby === "object") {
      const embyData = show.emby;

      // Map emby properties to PascalCase top-level properties
      if (embyData.id !== undefined) show.Id = embyData.id;
      if (embyData.path !== undefined) show.Path = embyData.path;
      if (embyData.dateCreated !== undefined)
        show.DateCreated = embyData.dateCreated;
      if (embyData.premiereDate !== undefined)
        show.PremiereDate = embyData.premiereDate;
      if (embyData.inToTry !== undefined) show.InToTry = embyData.inToTry;
      if (embyData.inContinue !== undefined)
        show.InContinue = embyData.inContinue;
      if (embyData.inMark !== undefined) show.InMark = embyData.inMark;
      if (embyData.inLinda !== undefined) show.InLinda = embyData.inLinda;
      if (embyData.isFavorite !== undefined)
        show.IsFavorite = embyData.isFavorite;
      if (embyData.isPlayed !== undefined) show.Played = embyData.isPlayed;
      if (embyData.playCount !== undefined) show.PlayCount = embyData.playCount;
      if (embyData.lastPlayedDate !== undefined)
        show.LastPlayedDate = embyData.lastPlayedDate;
      if (embyData.overview !== undefined) show.Overview = embyData.overview;
      if (embyData.genres !== undefined) show.Genres = embyData.genres;

      // Remove nested emby object
      delete show.emby;
      flattenedCount++;
    }

    // Flatten gap object
    if (show.gap && typeof show.gap === "object") {
      // Gap properties are already PascalCase, spread them to top level
      Object.assign(show, show.gap);
      delete show.gap;
      flattenedCount++;
    }

    // Flatten disk object
    if (show.disk && typeof show.disk === "object") {
      const diskData = show.disk;

      // Map disk properties to PascalCase top-level properties
      if (diskData.date !== undefined) show.Date = diskData.date;
      if (diskData.size !== undefined) show.Size = diskData.size;
      if (diskData.noFiles !== undefined) show.NoFiles = diskData.noFiles;

      // Remove nested disk object
      delete show.disk;
      flattenedCount++;
    }

    // Flatten sync object (if exists)
    if (show.sync && typeof show.sync === "object") {
      const syncData = show.sync;

      // Keep camelCase for sync properties
      if (syncData.lastEmbySync !== undefined)
        show.lastEmbySync = syncData.lastEmbySync;
      if (syncData.lastTvdbSync !== undefined)
        show.lastTvdbSync = syncData.lastTvdbSync;
      if (syncData.lastDiskSync !== undefined)
        show.lastDiskSync = syncData.lastDiskSync;

      // Remove nested sync object
      delete show.sync;
      flattenedCount++;
    }
  } catch (err) {
    console.error(
      `Error processing show: ${show.Name || show.name || "unknown"}`,
      err.message,
    );
    errors++;
  }
}

// Create backup
const backupPath = TVDB_PATH + ".before-flatten-migration";
console.log("Creating backup:", backupPath);
fs.writeFileSync(backupPath, JSON.stringify(tvdbData, null, 2));

// Save flattened data
console.log("Saving flattened data:", TVDB_PATH);
fs.writeFileSync(TVDB_PATH, JSON.stringify(tvdbData, null, 2));

console.log("\n========================================");
console.log("Migration Complete!");
console.log("========================================");
console.log(`Total shows:        ${shows.length}`);
console.log(`Flattened objects:  ${flattenedCount}`);
console.log(`Removed name prop:  ${removedNameCount}`);
console.log(`Errors:             ${errors}`);
console.log(`\nBackup saved to: ${backupPath}`);
console.log("\nNext steps:");
console.log("1. Verify the migration by checking a few records in tvdb.json");
console.log("2. Deploy updated code changes");
console.log("3. If everything works, you can delete the backup file");
console.log("\nTo restore from backup if needed:");
console.log(`  cp ${backupPath} ${TVDB_PATH}`);
