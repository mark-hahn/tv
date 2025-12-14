import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function stripOptionalQuotes(value) {
  const trimmedEnd = String(value ?? '').trimEnd();
  if (trimmedEnd.length < 2) return trimmedEnd;
  const first = trimmedEnd[0];
  const last = trimmedEnd[trimmedEnd.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmedEnd.slice(1, -1);
  }
  return trimmedEnd;
}

export function parseKeyValueFile(text) {
  const out = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    const value = stripOptionalQuotes(line.slice(eq + 1).trimStart());
    if (key) out[key] = value;
  }
  return out;
}

export function defaultCredPath() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', 'qb-cred.txt');
}

export async function loadCreds(credPath) {
  const resolved = credPath ? path.resolve(credPath) : defaultCredPath();
  try {
    const text = await fs.readFile(resolved, 'utf8');
    return { creds: parseKeyValueFile(text), loaded: true, path: resolved };
  } catch {
    return { creds: {}, loaded: false, path: resolved };
  }
}
