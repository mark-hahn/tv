import fs from 'fs';
import path from 'node:path';
import process from 'node:process';

export const DEFAULT_TV_DATA_DIR = '/mnt/media/archive/dev/apps/tv-data';

export function getTvDataDir() {
  const v = typeof process.env.TV_DATA_DIR === 'string' ? process.env.TV_DATA_DIR.trim() : '';
  return v ? v : DEFAULT_TV_DATA_DIR;
}

export function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

export function getSecretsDir() {
  const dirPath = path.join(getTvDataDir(), 'secrets');
  ensureDir(dirPath);
  return dirPath;
}

export function getApiBaseDir() {
  const dirPath = path.join(getTvDataDir(), 'api');
  ensureDir(dirPath);
  return dirPath;
}

export function getApiCookiesDir() {
  const dirPath = path.join(getApiBaseDir(), 'cookies');
  ensureDir(dirPath);
  return dirPath;
}

export function getApiMiscDir() {
  const dirPath = path.join(getApiBaseDir(), 'misc');
  ensureDir(dirPath);
  return dirPath;
}

export function preferSharedReadPath(sharedPath, legacyPath) {
  try {
    if (sharedPath && fs.existsSync(sharedPath)) return sharedPath;
  } catch {
    // ignore
  }
  return legacyPath;
}
