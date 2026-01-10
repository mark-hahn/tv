import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function parseKeyValueFile(text) {
  const creds = {};
  const lines = String(text ?? '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (!key) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    creds[key] = value;
  }
  return creds;
}

function defaultCredPath() {
  // Default is torrents/qb-cred.txt (sibling of src/)
  return path.resolve(__dirname, '..', 'qb-cred.txt');
}

/**
 * Loads a KEY=VALUE creds file.
 *
 * @param {string | undefined} credPath
 * @returns {Promise<{ creds: Record<string, string>, loaded: boolean, path: string }>} 
 */
export async function loadCreds(credPath) {
  const resolved = credPath ? path.resolve(credPath) : defaultCredPath();

  try {
    const text = await fs.readFile(resolved, 'utf8');
    return { creds: parseKeyValueFile(text), loaded: true, path: resolved };
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
      return { creds: {}, loaded: false, path: resolved };
    }
    throw e;
  }
}
