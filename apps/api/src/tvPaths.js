import fs from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/api/src -> apps/api
const API_ROOT_DIR = path.resolve(__dirname, "..");

const API_DATA_DIR = path.join(API_ROOT_DIR, "data");
const API_SECRETS_DIR = path.join(API_ROOT_DIR, "secrets");
const API_MISC_DIR = path.join(API_DATA_DIR, "misc");

export function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

export function getSecretsDir() {
  const dirPath = API_SECRETS_DIR;
  ensureDir(dirPath);
  return dirPath;
}

export function getApiBaseDir() {
  const dirPath = API_ROOT_DIR;
  ensureDir(dirPath);
  return dirPath;
}

export function getApiCookiesDir() {
  // Historical name: cookie-related files now live under data/.
  const dirPath = API_DATA_DIR;
  ensureDir(dirPath);
  return dirPath;
}

export function getApiDataDir() {
  const dirPath = API_DATA_DIR;
  ensureDir(dirPath);
  return dirPath;
}

export function getApiSecretsDir() {
  const dirPath = API_SECRETS_DIR;
  ensureDir(dirPath);
  return dirPath;
}

export function getApiMiscDir() {
  const dirPath = API_MISC_DIR;
  ensureDir(dirPath);
  return dirPath;
}

export function preferSharedReadPath(sharedPath, legacyPath) {
  // Compatibility shim: callers may provide a current-path and an old-path.
  // Prefer the current-path if present, otherwise fall back.
  try {
    if (sharedPath && fs.existsSync(sharedPath)) return sharedPath;
  } catch {}
  try {
    if (legacyPath && fs.existsSync(legacyPath)) return legacyPath;
  } catch {}
  return sharedPath;
}
