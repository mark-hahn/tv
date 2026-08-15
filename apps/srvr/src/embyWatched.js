// Emby user-data domain: the played flags Emby keeps for a user, read out of
// its library.db. Emby keys them in UserDataKeys2 as
// "<tvdbId><season:3><episode:3>" rather than by item id, so they outlive the
// show's removal from the library. That makes this the only surviving record
// of what was watched for a show that has left Emby, and the only way to
// restore flags for the shows that lost theirs before episodeData existed.
//
// Emby's live db is WAL-locked and belongs to Emby, so it is never opened
// here — a copy is taken and every read goes to that.

import fs from "fs";
import Database from "better-sqlite3";
import * as util from "./util.js";
import { logHere, unilog} from "@tv/share"

const EMBY_LIBRARY_DB = "/var/lib/emby/data/library.db";
const EMBY_DB_COPY = "/tmp/tv-srvr-emby-library.db";
// "mark" in Emby's LocalUsersv2 — the only user whose viewing this app tracks.
const EMBY_USER_ID = 1;
// The copy only has to be fresh enough to see a show that just left Emby.
const COPY_TTL_MS = 60 * 60 * 1000;

let db = null;
let watchedStmt = null;
let copiedAt = 0;

const closeDb = () => {
  try {
    db?.close();
  } catch (e) {
    unilog(2209, `closing the emby user data copy failed: ${e.message}`);
  }
  db = null;
  watchedStmt = null;
};

// Copy db + wal + shm together so the copy reflects a consistent snapshot
// including commits that have not been checkpointed back into the main file.
const copyDb = () => {
  for (const sfx of ["", "-wal", "-shm"]) {
    const src = EMBY_LIBRARY_DB + sfx;
    const dst = EMBY_DB_COPY + sfx;
    if (sfx && !fs.existsSync(src)) {
      fs.rmSync(dst, { force: true });
      continue;
    }
    fs.copyFileSync(src, dst);
  }
};

const openDb = () => {
  if (db && Date.now() - copiedAt < COPY_TTL_MS) return db;
  closeDb();
  copyDb();
  copiedAt = Date.now();
  db = new Database(EMBY_DB_COPY, { readonly: true });
  watchedStmt = db.prepare(`
    SELECT k.UserDataKey AS key, u.LastPlayedDateInt AS lastPlayed
      FROM UserDataKeys2 k
      JOIN UserDatas u ON u.UserDataKeyId = k.Id
     WHERE u.played = 1 AND u.userId = ? AND k.UserDataKey GLOB ?
  `);
  return db;
};

// The episodes Emby has marked played for this series, as a Map of
// "<season>.<episode>" -> unix seconds it was last played (null when Emby kept
// the played flag but no date). Empty when Emby knows nothing about it. The
// GLOB pins the key to exactly the tvdbId plus six digits, so a series-level
// key (the bare tvdbId) and a longer id that merely starts with the same
// digits are both excluded.
export function getWatchedEpisodes(tvdbId) {
  const id = String(tvdbId ?? "").trim();
  const out = new Map();
  if (!id || !/^\d+$/.test(id)) return out;
  openDb();
  for (const row of watchedStmt.iterate(
    EMBY_USER_ID,
    `${id}[0-9][0-9][0-9][0-9][0-9][0-9]`,
  )) {
    const season = Number(row.key.slice(id.length, id.length + 3));
    const episode = Number(row.key.slice(id.length + 3));
    if (!Number.isInteger(season) || season < 0) continue;
    if (!Number.isInteger(episode) || episode < 1) continue;
    const lastPlayed = Number(row.lastPlayed);
    out.set(
      `${season}.${episode}`,
      Number.isFinite(lastPlayed) && lastPlayed > 0 ? lastPlayed : null,
    );
  }
  return out;
}

// The latest viewing in a getWatchedEpisodes() map, as the record's
// { lastPlayedDate, lastPlayedEpisode } pair — the two always describe the
// same episode. Null when no episode carries a date.
export function latestPlayed(watched) {
  let bestKey = null;
  let bestSec = 0;
  for (const [key, sec] of watched || []) {
    if (!sec || sec <= bestSec) continue;
    bestKey = key;
    bestSec = sec;
  }
  if (!bestKey) return null;
  const [season, episode] = bestKey.split(".").map(Number);
  return {
    lastPlayedDate: util.toPstDateTimeMs(new Date(bestSec * 1000)),
    lastPlayedEpisode: `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
  };
}
