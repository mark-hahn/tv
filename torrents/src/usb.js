import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseKeyValueFile } from './qb-cred.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFileAsync = promisify(execFile);

function resolveCredPath() {
  return path.resolve(__dirname, '..', 'cookies', 'qbt-cred.txt');
}

async function loadQbtCreds() {
  const credPath = resolveCredPath();
  const text = await fs.readFile(credPath, 'utf8');
  const creds = parseKeyValueFile(text);

  let qbHost = creds.QB_HOST;
  const qbPortRaw = creds.QB_PORT;
  let qbUser = creds.QB_USER;
  const qbPass = creds.QB_PASS;

  if (!qbHost) throw new Error(`Missing QB_HOST in ${credPath}`);
  if (!qbPortRaw) throw new Error(`Missing QB_PORT in ${credPath}`);
  if (!qbPass) throw new Error(`Missing QB_PASS in ${credPath}`);

  // If QB_HOST is user@host, derive QB_USER if missing and strip user for HTTP host.
  if (qbHost.includes('@')) {
    const [userPart, hostPart] = qbHost.split('@');
    if (!qbUser && userPart) qbUser = userPart;
    qbHost = hostPart || qbHost;
  }

  if (!qbUser) throw new Error(`Missing QB_USER in ${credPath} (or set QB_HOST as user@host)`);

  const qbPort = Number(qbPortRaw);
  if (!Number.isInteger(qbPort) || qbPort <= 0 || qbPort > 65535) {
    throw new Error(`Invalid QB_PORT in ${credPath}: ${qbPortRaw}`);
  }

  return { qbHost, qbPort, qbUser, qbPass };
}

async function loadQbHostForSsh() {
  const credPath = resolveCredPath();
  const text = await fs.readFile(credPath, 'utf8');
  const creds = parseKeyValueFile(text);
  const qbHost = creds.QB_HOST;
  if (!qbHost) throw new Error(`Missing QB_HOST in ${credPath}`);
  return String(qbHost).trim();
}

function lastNonEmptyLine(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function lastLineStartingWithInt(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^\d+/.test(lines[i])) return lines[i];
  }
  return '';
}

function parseLeadingInt(text) {
  const line = String(text ?? '').trim();
  const m = line.match(/^(\d+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function parseDfForMount(dfText, mountPoint) {
  const text = String(dfText ?? '');
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 2) return undefined;

  // Skip header; find the row whose mountpoint matches.
  const rows = lines.slice(1);

  const parseRow = (row) => {
    const parts = String(row).split(/\s+/);
    if (parts.length < 6) return undefined;
    const target = parts[parts.length - 1];
    const total = Number(parts[1]);
    const used = Number(parts[2]);
    const avail = Number(parts[3]);
    if (!Number.isFinite(total) || !Number.isFinite(used) || !Number.isFinite(avail)) return undefined;
    return { target, total: Math.trunc(total), used: Math.trunc(used), avail: Math.trunc(avail) };
  };

  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed && parsed.target === mountPoint) return { total: parsed.total, used: parsed.used, avail: parsed.avail };
  }

  // If df only printed a single filesystem line, accept it.
  if (rows.length === 1) {
    const parsed = parseRow(rows[0]);
    if (parsed) return { total: parsed.total, used: parsed.used, avail: parsed.avail };
  }

  return undefined;
}

/**
 * Returns four integers describing free space.
 *
 * Units:
 * - usbSpaceTotal/usbSpaceUsed are bytes derived from `du -s` output (1K blocks)
 * - mediaSpaceTotal/mediaSpaceUsed are bytes (from `df -B1`)
 */
export async function spaceAvail() {
  const usbSpaceTotalK = 2e9;
  let usbSpaceUsedK = 0;
  try {
    const qbHost = await loadQbHostForSsh();

    // du may exit non-zero if it hits unreadable directories; still emits a usable summary line.
    // Keep command exactly as requested (cd; du -s) and parse stdout even on non-zero exit.
    const args = [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'LogLevel=ERROR',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      qbHost,
      'cd; du -s'
    ];

    const runDuOnce = async () => {
      try {
        const du = await execFileAsync('ssh', args, {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          windowsHide: true
        });
        return { stdout: String(du.stdout ?? ''), stderr: String(du.stderr ?? ''), err: null };
      } catch (e) {
        const stdout = (e && typeof e === 'object' && 'stdout' in e) ? String(e.stdout ?? '') : '';
        const stderr = (e && typeof e === 'object' && 'stderr' in e) ? String(e.stderr ?? '') : '';
        return { stdout, stderr, err: e };
      }
    };

    const parseDuK = (stdout, stderr) => {
      const duLine =
        lastLineStartingWithInt(stdout) ||
        lastLineStartingWithInt(stderr) ||
        lastNonEmptyLine(stdout) ||
        lastNonEmptyLine(stderr);
      const duK = parseLeadingInt(duLine);
      return Number.isInteger(duK) && duK >= 0 ? duK : undefined;
    };

    // First attempt.
    let attempt = await runDuOnce();
    let duK = parseDuK(attempt.stdout, attempt.stderr);

    // Retry once if we couldn't parse a usable summary.
    if (!Number.isInteger(duK)) {
      attempt = await runDuOnce();
      duK = parseDuK(attempt.stdout, attempt.stderr);
    }

    if (Number.isInteger(duK)) {
      usbSpaceUsedK = duK;
      if (attempt.err && !attempt.stdout && !attempt.stderr) {
        console.error('spaceAvail: ssh du failed (no output):', attempt.err);
      }
    } else {
      if (attempt.err) {
        console.error('spaceAvail: ssh du failed (unparsable output):', attempt.err);
      }
      // Preserve old log shape (stdout-focused) but include stderr for diagnosis.
      console.error('spaceAvail: unexpected ssh du output:', attempt.stdout || attempt.stderr);
    }
  } catch (e) {
    console.error('spaceAvail: ssh du failed (returning usbSpaceUsed=0):', e);
  }

  let mediaSpaceTotal = 0;
  let mediaSpaceUsed = 0;
  try {
    const mediaMount = '/mnt/m-bkup';

    // In Windows/dev environments, the mount may not exist.
    try {
      await fs.access(mediaMount);
    } catch {
      return {
        usbSpaceTotal: Math.trunc(usbSpaceTotalK * 1024),
        usbSpaceUsed: Math.trunc(usbSpaceUsedK * 1024),
        mediaSpaceTotal: 0,
        mediaSpaceUsed: 0
      };
    }

    const df = await execFileAsync('df', ['-B1', '-P', mediaMount], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    const dfText = String(df.stdout ?? '');
    const parsed = parseDfForMount(dfText, mediaMount);
    if (parsed && parsed.used >= 0 && parsed.avail >= 0) {
      // Match `df` semantics: Available excludes reserved blocks.
      // Use (used + avail) so client pctUsed and (total-used) match df Use%/Available.
      mediaSpaceUsed = parsed.used;
      mediaSpaceTotal = parsed.used + parsed.avail;
    } else {
      console.error('spaceAvail: unexpected df output:', dfText);
    }
  } catch (e) {
    console.error('spaceAvail: df failed (returning mediaSpaceTotal/mediaSpaceUsed=0):', e);
  }

  return {
    usbSpaceTotal: Math.trunc(usbSpaceTotalK * 1024),
    usbSpaceUsed: Math.trunc(usbSpaceUsedK * 1024),
    mediaSpaceTotal: Math.trunc(mediaSpaceTotal),
    mediaSpaceUsed: Math.trunc(mediaSpaceUsed)
  };
}

function getSetCookieHeader(headers) {
  // Node's fetch (undici) supports getSetCookie(); fall back to single header.
  const anyHeaders = /** @type {any} */ (headers);
  if (typeof anyHeaders.getSetCookie === 'function') {
    const arr = anyHeaders.getSetCookie();
    if (Array.isArray(arr)) return arr;
  }
  const v = headers.get('set-cookie');
  return v ? [v] : [];
}

function pickCookie(setCookieHeaders) {
  // qBittorrent sets SID=<...>; Path=/; HttpOnly
  for (const raw of setCookieHeaders) {
    const firstPart = String(raw).split(';')[0].trim();
    if (firstPart.toLowerCase().startsWith('sid=')) return firstPart;
  }
  // Fallback: use first cookie if present.
  if (setCookieHeaders.length > 0) {
    return String(setCookieHeaders[0]).split(';')[0].trim();
  }
  return '';
}

async function qbLogin({ baseUrl, qbUser, qbPass }) {
  const body = new URLSearchParams({ username: qbUser, password: qbPass });

  const res = await fetch(new URL('/api/v2/auth/login', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
    body,
  });

  const text = await res.text();
  if (!res.ok || (text !== 'Ok.' && text !== 'Ok')) {
    throw new Error(`qBittorrent login failed: ${text || `HTTP ${res.status}`}`);
  }

  const setCookies = getSetCookieHeader(res.headers);
  const cookie = pickCookie(setCookies);
  if (!cookie) {
    // qB sometimes returns Ok without cookie if something's off.
    throw new Error('qBittorrent login succeeded but no session cookie was returned');
  }

  return cookie;
}

/**
 * Query qBittorrent WebUI /api/v2/torrents/info using creds from torrents/cookies/qbt-cred.txt.
 *
 * Optional filtering is forwarded to qBittorrent as query params.  see misc/notes.txt for details of input
 *
 * @typedef {{
 *   hash?: string | string[],
 *   category?: string,
 *   tag?: string,
 *   filter?: string,
 * }} QbtInfoFilter
 *
 * Notes:
 * - qBittorrent expects hashes to be provided as a single string joined by '|'.
 * - qBittorrent's 'filter' values are WebUI state filters (e.g. downloading, seeding, completed, etc.).
 *
 * @param {QbtInfoFilter | undefined} [filter]
 * @returns {Promise<any>} Parsed JSON returned by qBittorrent (typically an array of torrent objects)
 */
export async function getQbtInfo(filter) {
  const { qbHost, qbPort, qbUser, qbPass } = await loadQbtCreds();
  const baseUrl = `http://${qbHost}:${qbPort}`;

  const cookie = await qbLogin({ baseUrl, qbUser, qbPass });

  const url = new URL('/api/v2/torrents/info', baseUrl);

  if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
    const { hash, category, tag, filter: state } = filter;

    if (hash) {
      const hashes = Array.isArray(hash) ? hash.join('|') : String(hash);
      if (hashes.trim()) url.searchParams.set('hashes', hashes);
    }
    if (category) url.searchParams.set('category', String(category));
    if (tag) url.searchParams.set('tag', String(tag));
    if (state) url.searchParams.set('filter', String(state));
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Cookie: cookie,
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`qBittorrent info failed: HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }

  return res.json();
}
