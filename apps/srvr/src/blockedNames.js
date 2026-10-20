// The blocked-name list: substrings that keep a torrent or usb file from
// being downloaded unless forced. One per line in data/blockedNames.txt,
// matched case-sensitively. tv-api and tv-down read the file on each use;
// tv-srvr is its only writer.

import fsp from "fs/promises";
import * as path from "node:path";
import { SRVR_DATA_DIR } from "./srvrPaths.js";

const BLOCKED_NAMES_PATH = path.join(SRVR_DATA_DIR, "blockedNames.txt");

export async function readBlockedNames() {
  return (await fsp.readFile(BLOCKED_NAMES_PATH, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// Adds a name unless it is already there; returns the whole list.
export async function addBlockedName(name) {
  const entry = String(name || "").trim();
  if (!entry) throw new Error("name is required");
  const names = await readBlockedNames();
  if (!names.includes(entry)) {
    names.push(entry);
    await fsp.writeFile(BLOCKED_NAMES_PATH, `${names.join("\n")}\n`, "utf8");
  }
  return names;
}
