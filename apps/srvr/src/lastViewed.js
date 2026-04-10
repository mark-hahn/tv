import fs from "fs";
import * as fsp from "fs/promises";
import * as path from "node:path";
import { jParse } from "./util.js";
import { SRVR_DATA_DIR } from "./srvrPaths.js";
const LAST_VIEWED_PATH = path.join(SRVR_DATA_DIR, "lastViewed.json");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(SRVR_DATA_DIR);

function ensureFile(filePath, defaultStr) {
  if (fs.existsSync(filePath)) return;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, defaultStr, "utf8");
}

ensureFile(LAST_VIEWED_PATH, "{}");

let lastViewed = {};
try {
  const raw = fs.readFileSync(LAST_VIEWED_PATH, "utf8");
  lastViewed = jParse(raw, "lastViewed") || {};
} catch {
  // Fail fast: lastViewed is required state.
  ensureFile(LAST_VIEWED_PATH, "{}");
  const raw = fs.readFileSync(LAST_VIEWED_PATH, "utf8");
  lastViewed = jParse(raw, "lastViewed") || {};
}

export const getLastViewed = async (_params) => {
  return lastViewed;
};

export const getLastViewedSync = () => lastViewed;

let lastRecordedShowName = null;
export const recordNowPlaying = async (showName) => {
  if (!showName || showName === lastRecordedShowName) return;
  lastRecordedShowName = showName;
  lastViewed[showName] = Date.now();
  await fsp.mkdir(path.dirname(LAST_VIEWED_PATH), { recursive: true });
  await fsp.writeFile(LAST_VIEWED_PATH, JSON.stringify(lastViewed));
};
