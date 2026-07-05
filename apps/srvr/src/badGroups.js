// The bad-release-group registry: owns the in-memory set (loaded from
// data/badGroups.txt), its disk read/sync/write, and the group-badness tests
// used by Flexget candidate scoring.

import fs from "fs";
import * as path from "node:path";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import { SRVR_DATA_DIR } from "./srvrPaths.js";

const BAD_GROUPS_PATH = path.join(SRVR_DATA_DIR, "badGroups.txt");

export function readBadGroupsFromDisk() {
  return fs
    .readFileSync(BAD_GROUPS_PATH, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
}

const badGroups = new Set(
  (() => {
    try {
      return readBadGroupsFromDisk();
    } catch {
      return [];
    }
  })(),
);

export function syncBadGroupsFromDisk() {
  badGroups.clear();
  for (const group of readBadGroupsFromDisk()) badGroups.add(group);
  return [...badGroups].sort();
}

export function writeBadGroupsToDisk(groups) {
  const list = [
    ...new Set(
      groups.map((group) => String(group).trim().toLowerCase()).filter(Boolean),
    ),
  ].sort();
  fs.writeFileSync(
    BAD_GROUPS_PATH,
    list.length ? `${list.join("\n")}\n` : "",
    "utf8",
  );
  badGroups.clear();
  for (const group of list) badGroups.add(group);
  return list;
}

// True if a lowercase group name is in the bad-group registry.
export function hasBadGroup(group) {
  return badGroups.has(group);
}

// True if a torrent title's parsed group is a bad group.
export function isBadGroup(title) {
  const parsed = parseTorrentTitle(
    String(title || "").replace(/\.[a-z0-9]{2,4}$/i, ""),
  );
  return badGroups.has((parsed?.group || "").toLowerCase());
}
