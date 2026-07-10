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

export function getTvprocJsonPath() {
  const dirPath = API_DATA_DIR;
  ensureDir(dirPath);
  return path.join(dirPath, "tvproc.json");
}

export function getApiMiscDir() {
  const dirPath = API_MISC_DIR;
  ensureDir(dirPath);
  return dirPath;
}
