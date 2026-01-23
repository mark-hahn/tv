import fs from 'fs';
import path from 'node:path';
import process from 'node:process';

export const DEFAULT_TV_DATA_DIR = '/root/dev/apps/tv/data';

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

export function getTvAppRootDir() {
  // TV_DATA_DIR defaults to /root/dev/apps/tv/data, so app root is /root/dev/apps/tv
  const dataDir = getTvDataDir();
  return path.dirname(dataDir);
}

export function getAsrBaseDir() {
  const dirPath = path.join(getTvAppRootDir(), 'apps', 'asr');
  ensureDir(dirPath);
  return dirPath;
}

export function getAsrLogsDir() {
  const dirPath = path.join(getAsrBaseDir(), 'logs');
  ensureDir(dirPath);
  return dirPath;
}

export function getAsrSecretsDir() {
  const dirPath = path.join(getAsrBaseDir(), 'secrets');
  ensureDir(dirPath);
  return dirPath;
}
