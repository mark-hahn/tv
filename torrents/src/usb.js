import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKeyValueFile } from './qb-cred.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * @returns {Promise<any>} Parsed JSON returned by qBittorrent (typically an array of torrent objects)
 */
export async function getQbtInfo() {
  const { qbHost, qbPort, qbUser, qbPass } = await loadQbtCreds();
  const baseUrl = `http://${qbHost}:${qbPort}`;

  const cookie = await qbLogin({ baseUrl, qbUser, qbPass });

  const res = await fetch(new URL('/api/v2/torrents/info', baseUrl), {
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
