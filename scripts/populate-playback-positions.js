#!/usr/bin/env node
/**
 * One-time backfill: store Emby UserData.PlaybackPositionTicks into the
 * episodeData tuple at slot [6] (pos) for every episode that has a position > 0.
 *
 * Tuple shape: [aired, watched, id, file, res, bif, pos] with trailing absent
 * slots dropped. pos is only stored when > 0 (standard trailing-drop logic).
 *
 * Run on the REMOTE server with tv-srvr STOPPED (edits tvdb.json directly).
 * Usage: node /root/dev/apps/tv/scripts/populate-playback-positions.js
 */

import fs from "fs";

const REMOTE_TVDB_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json";
const BACKUP_SUFFIX = ".before-pos-backfill";

const EMBY_BASE_URL = "http://hahnca.com:8096/emby";
const EMBY_USER_ID = "894c752d448f45a3a1260ccaabd0adff";
const EMBY_API_KEY = "9863c23d912349599e395950609c84cc";

// Set pos at slot [6] of an episode tuple, padding earlier slots if they were
// dropped. Mirrors encodeTuple trailing-drop: pos > 0 keeps slot 6 present.
function setTuplePos(tuple, pos) {
  if (pos > 0) {
    while (tuple.length < 6) tuple.push(0);
    tuple[6] = pos;
  } else if (tuple.length > 6) {
    tuple.length = 6;
    while (tuple.length > 1 && !tuple[tuple.length - 1]) tuple.length--;
  }
}

async function fetchEpisodePositions(showId) {
  const url =
    `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items` +
    `?ParentId=${showId}&IncludeItemTypes=Episode&Recursive=true` +
    `&Fields=UserData&api_key=${EMBY_API_KEY}&Limit=10000`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  // Map "season.episode" -> { pos, played, id }
  const byKey = new Map();
  for (const ep of data.Items || []) {
    const season = ep.ParentIndexNumber;
    const episode = ep.IndexNumber;
    if (!Number.isInteger(season) || !Number.isInteger(episode)) continue;
    const pos = ep.UserData?.PlaybackPositionTicks || 0;
    if (pos > 0) {
      byKey.set(`${season}.${episode}`, {
        pos,
        played: !!ep.UserData?.Played,
        id: ep.Id,
      });
    }
  }
  return byKey;
}

async function main() {
  if (!fs.existsSync(REMOTE_TVDB_PATH)) {
    console.error(`ERROR: ${REMOTE_TVDB_PATH} not found`);
    console.error("This script must run on the remote server (hahnca.com).");
    process.exit(1);
  }

  console.log(`Loading: ${REMOTE_TVDB_PATH}`);
  const raw = fs.readFileSync(REMOTE_TVDB_PATH, "utf8");
  const tvdbData = JSON.parse(raw);

  const backupPath = REMOTE_TVDB_PATH + BACKUP_SUFFIX;
  fs.writeFileSync(backupPath, raw);
  console.log(`Backup written: ${backupPath}\n`);

  const names = Object.keys(tvdbData);
  console.log(`Found ${names.length} records\n`);

  let showsScanned = 0;
  let showsWithPos = 0;
  let episodesSet = 0;

  for (const name of names) {
    const rec = tvdbData[name];
    if (!rec || typeof rec !== "object") continue;
    if (rec.inEmby === false) continue;
    if (!rec.id) continue;
    if (!Array.isArray(rec.episodeData)) continue;

    showsScanned++;
    let positions;
    try {
      positions = await fetchEpisodePositions(rec.id);
    } catch (e) {
      console.error(`  ${name}: fetch failed (${e.message})`);
      continue;
    }
    if (positions.size === 0) continue;

    const ed = rec.episodeData;
    let setForShow = 0;
    for (const [key, info] of positions) {
      const [season, episode] = key.split(".").map(Number);
      if (!Array.isArray(ed[season])) ed[season] = [];
      let tuple = ed[season][episode - 1];
      if (!Array.isArray(tuple)) {
        // Create a minimal tuple if the slot was absent.
        tuple = [
          0,
          info.played ? 1 : 0,
          info.id ? Number(info.id) : 0,
          0,
          0,
          0,
        ];
        ed[season][episode - 1] = tuple;
      }
      setTuplePos(tuple, info.pos);
      setForShow++;
      episodesSet++;
    }
    if (setForShow > 0) {
      showsWithPos++;
      console.log(`  ${name}: set pos on ${setForShow} episode(s)`);
    }
  }

  fs.writeFileSync(REMOTE_TVDB_PATH, JSON.stringify(tvdbData));
  console.log("\n========================================");
  console.log(`Shows scanned:        ${showsScanned}`);
  console.log(`Shows with positions: ${showsWithPos}`);
  console.log(`Episodes updated:     ${episodesSet}`);
  console.log(`Wrote: ${REMOTE_TVDB_PATH}`);
  console.log("Restart tv-srvr now.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
