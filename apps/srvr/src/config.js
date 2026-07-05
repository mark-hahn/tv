// Config + path helpers: text reads with fallback, config file path resolution,
// and dir/file creation guards. Owns CONFIG_DIR (apps/srvr/config).

import fs from "fs";
import * as path from "node:path";
import { unilog } from "@tv/share";
import { SRVR_ROOT_DIR } from "./srvrPaths.js";

export const CONFIG_DIR = path.join(SRVR_ROOT_DIR, "config");

export function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    unilog(504, `FATAL: cannot create dir: ${dir}`, e?.message || e);
    process.exit(1);
  }
}

export function ensureFile(filePath, defaultStr) {
  try {
    if (fs.existsSync(filePath)) return;
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, defaultStr, "utf8");
  } catch (e) {
    unilog(
      505,
      `FATAL: cannot create required file: ${filePath}`,
      e?.message || e,
    );
    process.exit(1);
  }
}

export function firstExistingPath(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return paths && paths[0] ? paths[0] : null;
}

export function readTextOr(filePathOrPaths, fallback) {
  const paths = Array.isArray(filePathOrPaths)
    ? filePathOrPaths
    : [filePathOrPaths];
  for (const p of paths) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {}
  }
  return fallback;
}

export function configReadCandidates(relativePath) {
  // Config is owned by this app under apps/srvr/config.
  return [path.join(SRVR_ROOT_DIR, relativePath)];
}

export function readTextOrWithChosenPath(filePathOrPaths, fallback) {
  const paths = Array.isArray(filePathOrPaths)
    ? filePathOrPaths
    : [filePathOrPaths];
  for (const p of paths) {
    try {
      return { text: fs.readFileSync(p, "utf8"), chosenPath: p };
    } catch {}
  }
  return { text: fallback, chosenPath: null };
}

export function configWritePath(fileName) {
  return path.join(CONFIG_DIR, fileName);
}
