import fs from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/srvr/src -> apps/srvr
export const SRVR_ROOT_DIR = path.resolve(__dirname, "..");

export const SRVR_DATA_DIR = path.join(SRVR_ROOT_DIR, "data");
export const SRVR_SECRETS_DIR = path.join(SRVR_ROOT_DIR, "secrets");
export const SRVR_MISC_DIR = path.join(SRVR_DATA_DIR, "misc");

export function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

export function ensureSrvrDirs() {
  ensureDir(SRVR_DATA_DIR);
  ensureDir(SRVR_SECRETS_DIR);
  ensureDir(SRVR_MISC_DIR);
}
