import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/asr/src -> apps/asr
const ASR_ROOT_DIR = path.resolve(__dirname, '..');

export function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

export function getAsrBaseDir() {
  const dirPath = ASR_ROOT_DIR;
  ensureDir(dirPath);
  return dirPath;
}

export function getAsrDataDir() {
  const dirPath = path.join(getAsrBaseDir(), 'data');
  ensureDir(dirPath);
  return dirPath;
}

export function getAsrLogsDir() {
  const dirPath = path.join(getAsrDataDir(), 'logs');
  ensureDir(dirPath);
  return dirPath;
}

export function getAsrSecretsDir() {
  const dirPath = path.join(getAsrBaseDir(), 'secrets');
  ensureDir(dirPath);
  return dirPath;
}
