import fs                  from "fs";
import * as cp             from 'child_process';
import * as path           from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import {rimraf}            from 'rimraf'
import * as view           from './src/lastViewed.js';
import * as utilNode       from "util";
import * as emby           from './src/emby.js';
import * as tvdb           from './src/tvdb.js';
import * as util           from "./src/util.js";
import * as email          from './src/email.js';
import * as tmdb           from './src/tmdb.js';
import fetch               from 'node-fetch';
import { parse as parseTorrentTitle } from 'parse-torrent-title';

const dontupload  = false;

const DEFAULT_TV_DATA_DIR = '/root/dev/apps/tv/data';
const TV_DATA_DIR = (typeof process.env.TV_DATA_DIR === 'string' && process.env.TV_DATA_DIR.trim())
  ? process.env.TV_DATA_DIR.trim()
  : DEFAULT_TV_DATA_DIR;

const SRVR_DATA_DIR = path.join(TV_DATA_DIR, 'srvr', 'data');
const SECRETS_DIR = path.join(TV_DATA_DIR, 'secrets');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error(`[tv-srvr] FATAL: cannot create dir: ${dir}`, e?.message || e);
    process.exit(1);
  }
}

function ensureFile(filePath, defaultStr) {
  try {
    if (fs.existsSync(filePath)) return;
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, defaultStr, 'utf8');
  } catch (e) {
    console.error(`[tv-srvr] FATAL: cannot create required file: ${filePath}`, e?.message || e);
    process.exit(1);
  }
}

function firstExistingPath(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return paths && paths[0] ? paths[0] : null;
}

ensureDir(SRVR_DATA_DIR);
ensureDir(SECRETS_DIR);

process.setMaxListeners(50);
const tvDir = '/mnt/media/tv';
const exec  = utilNode.promisify(cp.exec);

function readTextOr(filePath, fallback) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function readJsonTextOr(filePath, fallbackObj) {
  return readTextOr(filePath, JSON.stringify(fallbackObj));
}

const headerStr  = readTextOr('config/config1-header.txt',   '');
const rejectStr  = readJsonTextOr('config/config2-rejects.json', []);
const middleStr  = readTextOr('config/config3-middle.txt',   '');
const pickupStr  = readJsonTextOr('config/config4-pickups.json', []);
const footerStr  = readTextOr('config/config5-footer.txt',   '');

const noEmbyPath = path.join(SRVR_DATA_DIR, 'noemby.json');
const gapsPath   = path.join(SRVR_DATA_DIR, 'gaps.json');

// Strict: persisted state must live under TV_DATA_DIR.
ensureFile(noEmbyPath, '[]');
ensureFile(gapsPath, '[]');

const noEmbyStr  = readJsonTextOr(noEmbyPath, []);
let gapsStr = readTextOr(gapsPath, '[]');

// Strict: shared secrets are checkout-independent under TV_DATA_DIR/secrets.
const subsLoginPath = path.join(SECRETS_DIR, 'subs-login.txt');
const subsTokenReadPath = path.join(SECRETS_DIR, 'subs-token.txt');
const subsTokenWritePath = path.join(SECRETS_DIR, 'subs-token.txt');

// OpenSubtitles requires a real app User-Agent; it will 403 on generic ones (e.g. node-fetch).
const openSubtitlesUserAgent = 'tv-series-srvr v1.0.0';

let subsTokenCache = null;
try {
  const token = fs.readFileSync(subsTokenReadPath, 'utf8');
  subsTokenCache = typeof token === 'string' && token.trim() ? token.trim() : null;
} catch {
  subsTokenCache = null;
}

const notesPath = path.join(SRVR_DATA_DIR, 'notes.json');
ensureFile(notesPath, '{}');
let notesCache = {};
try {
  const notesStr = fs.readFileSync(notesPath, 'utf8');
  notesCache = JSON.parse(notesStr || '{}') || {};
} catch (e) {
  // First run or corrupt JSON: create/reset to empty.
  try {
    ensureDir(path.dirname(notesPath));
    fs.writeFileSync(notesPath, '{}', 'utf8');
  } catch {}
  notesCache = {};
}

// Ensure we never keep/persist empty notes.
try {
  let changed = false;
  const cleaned = {};
  for (const [rawKey, rawVal] of Object.entries(notesCache ?? {})) {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key) {
      changed = true;
      continue;
    }

    const val = rawVal === undefined || rawVal === null ? '' : String(rawVal);
    if (val.trim() === '') {
      changed = true;
      continue;
    }

    if (key !== rawKey || val !== rawVal) changed = true;
    cleaned[key] = val;
  }

  if (changed) {
    notesCache = cleaned;
    try {
      fs.writeFileSync(notesPath, JSON.stringify(notesCache), 'utf8');
    } catch {}
  }
} catch {}

const rejects      = JSON.parse(rejectStr);
const pickups      = JSON.parse(pickupStr);
const noEmbys      = JSON.parse(noEmbyStr);
const gaps         = JSON.parse(gapsStr);
const notes        = notesCache;

function encodeFileIdBase32(fileId) {
  // base-32 using RFC4648 alphabet: A-Z then 2-7.
  // Output is minimal-length (no left padding).
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let n = Number(fileId);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.floor(n);

  let out = '';
  do {
    const digit = n % 32;
    out = alphabet[digit] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  // Prefix with '#' so these can be uniquely identified for later deletion.
  return '#' + out;
}

function encodeFileIdBase32Legacy(fileId) {
  // Legacy base-32 encoding used by older subtitle filenames:
  // alphabet: A-P then a-p.
  // Output is minimal-length (no left padding).
  const alphabet = 'ABCDEFGHIJKLMNOPabcdefghijklmnop';
  let n = Number(fileId);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.floor(n);

  let out = '';
  do {
    const digit = n % 32;
    out = alphabet[digit] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  return '#' + out;
}

function encodeFileIdBase32LegacyAZ05(fileId) {
  // Legacy base-32 encoding used briefly:
  // alphabet: A-Z then 0-5.
  // Output is minimal-length (no left padding).
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let n = Number(fileId);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.floor(n);

  let out = '';
  do {
    const digit = n % 32;
    out = alphabet[digit] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  return '#' + out;
}

const deleteSubFiles = async (id, param, resolve, reject) => {
  if (param === undefined || param === null || param === '') {
    reject([id, { error: 'deleteSubFiles: missing params' }]);
    return;
  }

  const fileIdObjs = util.jParse(param, 'deleteSubFiles');
  if (!Array.isArray(fileIdObjs) || fileIdObjs.length === 0) {
    reject([id, { error: 'deleteSubFiles: expected non-empty array' }]);
    return;
  }

  const showName = typeof fileIdObjs[0]?.showName === 'string' ? fileIdObjs[0].showName : '';
  if (!showName || showName.trim() === '') {
    reject([id, { error: 'deleteSubFiles: missing showName' }]);
    return;
  }
  if (showName.includes('/') || showName.includes('\\')) {
    reject([id, { error: 'deleteSubFiles: invalid showName' }]);
    return;
  }
  for (const entry of fileIdObjs) {
    if (typeof entry?.showName !== 'string' || entry.showName !== showName) {
      reject([id, { error: 'deleteSubFiles: all entries must have same showName' }]);
      return;
    }
  }

  const localShowPath = path.join(tvDir, showName);
  try {
    const st = fs.statSync(localShowPath);
    if (!st.isDirectory()) {
      reject([id, { error: `Show directory missing: ${localShowPath} (n/a)` }]);
      return;
    }
  } catch {
    reject([id, { error: `Show directory missing: ${localShowPath} (n/a)` }]);
    return;
  }

  const searchTags = new Set();
  const fileIdsByTag = new Map();
  const fidToNewTag = new Map();
  for (const entry of fileIdObjs) {
    const file_id = entry?.file_id;
    if (!Number.isFinite(Number(file_id))) {
      reject([id, { error: 'deleteSubFiles: invalid file_id' }]);
      return;
    }
    const fid = Number(file_id);
    const tagNew = encodeFileIdBase32(fid);
    const tagLegacy = encodeFileIdBase32Legacy(fid);
    const tagLegacy2 = encodeFileIdBase32LegacyAZ05(fid);
    fidToNewTag.set(fid, tagNew);

    for (const tag of [tagNew, tagLegacy, tagLegacy2]) {
      searchTags.add(tag);
      if (!fileIdsByTag.has(tag)) fileIdsByTag.set(tag, new Set());
      fileIdsByTag.get(tag).add(fid);
    }
  }

  const deletedFids = new Set();
  const deleted = [];
  const appliedSet = new Set();
  const failures = [];

  const recurs = async (dirPath) => {
    if (dirPath === tvDir + '/.stfolder') return;
    let dirents;
    try {
      dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
      failures.push({ path: dirPath, error: `readdir failed: ${e.message}` });
      return;
    }

    for (const d of dirents) {
      if (d.isSymbolicLink && d.isSymbolicLink()) continue;
      const p = path.join(dirPath, d.name);
      if (d.isDirectory()) {
        await recurs(p);
        continue;
      }
      if (!d.isFile()) continue;
      if (!d.name || !d.name.toLowerCase().endsWith('.srt')) continue;

      const noExt = d.name.slice(0, -4); // remove .srt
      const lastDot = noExt.lastIndexOf('.');
      if (lastDot < 0) continue;
      const tag = noExt.slice(lastDot + 1);
      if (!searchTags.has(tag)) continue;

      try {
        fs.unlinkSync(p);
        deleted.push(p);
        const fids = fileIdsByTag.get(tag);
        if (fids) {
          for (const fid of fids) {
            appliedSet.add(fid);
            deletedFids.add(fid);
          }
        }
      } catch (e) {
        failures.push({ path: p, tag, error: `unlink failed: ${e.message}` });
      }
    }
  };

  await recurs(localShowPath);

  // Report notFound in terms of the *new* tag, but consider legacy deletions as found.
  const notFound = [];
  for (const fid of fidToNewTag.keys()) {
    if (!deletedFids.has(fid)) notFound.push(fidToNewTag.get(fid));
  }

  resolve([id, { ok: true, applied: Array.from(appliedSet), deletedCount: deleted.length, notFoundCount: notFound.length, notFound, failures }]);
};

const getSubFileIds = async (id, param, resolve, reject) => {
  const showName = rpcParamToString(param).trim();
  if (!showName) {
    reject([id, { error: 'getSubFileIds: missing showName' }]);
    return;
  }
  if (showName.includes('/') || showName.includes('\\')) {
    reject([id, { error: 'getSubFileIds: invalid showName' }]);
    return;
  }

  const localShowPath = path.join(tvDir, showName);
  try {
    const st = fs.statSync(localShowPath);
    if (!st.isDirectory()) {
      reject([id, { error: `Show directory missing: ${localShowPath} (n/a)` }]);
      return;
    }
  } catch {
    reject([id, { error: `Show directory missing: ${localShowPath} (n/a)` }]);
    return;
  }

  // Match current Base32 tag style: .#<A-Z2-7>.srt
  const tagRe = /\.\#([A-Z2-7]+)\.srt$/;
  const foundSet = new Set();
  const found = [];

  const recurs = (dirPath) => {
    if (dirPath === tvDir + '/.stfolder') return;
    let dirents;
    try {
      dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (d.isSymbolicLink && d.isSymbolicLink()) continue;
      const p = path.join(dirPath, d.name);
      if (d.isDirectory()) {
        recurs(p);
        continue;
      }
      if (!d.isFile()) continue;
      const name = d.name;
      if (!name || !name.toLowerCase().endsWith('.srt')) continue;
      const m = tagRe.exec(name);
      if (!m) continue;
      const tag = m[1];
      if (foundSet.has(tag)) continue;
      foundSet.add(tag);
      found.push(tag);
    }
  };

  recurs(localShowPath);
  resolve([id, found]);
};

function srtTimeToMs(timeStr) {
  // "hh:mm:ss,mmm" -> ms
  const m = /^([0-9]{2}):([0-9]{2}):([0-9]{2}),([0-9]{3})$/.exec(String(timeStr || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4]);
  if (![hh, mm, ss, ms].every((n) => Number.isFinite(n))) return null;
  return (((hh * 60 + mm) * 60 + ss) * 1000 + ms);
}

function msToSrtTime(msTotal) {
  let ms = Number(msTotal);
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  ms = Math.floor(ms);
  const hh = Math.floor(ms / 3600000);
  ms -= hh * 3600000;
  const mm = Math.floor(ms / 60000);
  ms -= mm * 60000;
  const ss = Math.floor(ms / 1000);
  ms -= ss * 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

const offsetSubFiles = async (id, param, resolve, reject) => {
  if (param === undefined || param === null || param === '') {
    reject([id, { error: 'offsetSubFiles: missing params' }]);
    return;
  }

  const fileIdObjs = util.jParse(param, 'offsetSubFiles');
  if (!Array.isArray(fileIdObjs) || fileIdObjs.length === 0) {
    reject([id, { error: 'offsetSubFiles: expected non-empty array' }]);
    return;
  }

  const showName = typeof fileIdObjs[0]?.showName === 'string' ? fileIdObjs[0].showName : '';
  if (!showName || showName.trim() === '') {
    reject([id, { error: 'offsetSubFiles: missing showName' }]);
    return;
  }
  if (showName.includes('/') || showName.includes('\\')) {
    reject([id, { error: 'offsetSubFiles: invalid showName' }]);
    return;
  }
  for (const entry of fileIdObjs) {
    if (typeof entry?.showName !== 'string' || entry.showName !== showName) {
      reject([id, { error: 'offsetSubFiles: all entries must have same showName' }]);
      return;
    }
  }

  const localShowPath = path.join(tvDir, showName);
  try {
    const st = fs.statSync(localShowPath);
    if (!st.isDirectory()) {
      reject([id, { error: `Show directory missing: ${localShowPath} (n/a)` }]);
      return;
    }
  } catch {
    reject([id, { error: `Show directory missing: ${localShowPath} (n/a)` }]);
    return;
  }

  // Validate offset is present on every entry and identical.
  const offsetRaw = fileIdObjs[0]?.offset;
  const offsetMs = Math.trunc(Number(offsetRaw));
  if (!Number.isFinite(offsetMs)) {
    reject([id, { error: 'offsetSubFiles: invalid offset' }]);
    return;
  }
  for (const entry of fileIdObjs) {
    const o = Math.trunc(Number(entry?.offset));
    if (!Number.isFinite(o) || o !== offsetMs) {
      reject([id, { error: 'offsetSubFiles: offset must be the same on every entry' }]);
      return;
    }
  }

  const failures = [];
  const appliedSet = new Set();

  const addFailure = (cand, stage, status, details, error) => {
    const fid = Number(cand?.file_id);
    const showName = typeof cand?.showName === 'string' ? cand.showName : undefined;
    const season = cand?.season;
    const episode = cand?.episode;

    let reason = '';
    if (status !== undefined && status !== null) reason = `${stage} HTTP ${status}`;
    else if (error) reason = `${stage}: ${error}`;
    else reason = stage;

    const rec = { file_id: fid, showName, season, episode, reason, stage, status };
    if (details !== undefined) rec.details = details;
    failures.push(rec);
  };

  // Build tag set and scan show folder once for all matching SRTs.
  const searchTags = new Set();
  for (const entry of fileIdObjs) {
    const fid = Number(entry?.file_id);
    if (!Number.isFinite(fid)) {
      addFailure(entry, 'input', undefined, undefined, 'invalid file_id');
      continue;
    }
    searchTags.add(encodeFileIdBase32(fid));
    searchTags.add(encodeFileIdBase32Legacy(fid));
    searchTags.add(encodeFileIdBase32LegacyAZ05(fid));
  }

  const pathsByTag = new Map();
  const recurs = (dirPath) => {
    if (dirPath === tvDir + '/.stfolder') return;
    let dirents;
    try {
      dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
      failures.push({ path: dirPath, error: `readdir failed: ${e.message}` });
      return;
    }
    for (const d of dirents) {
      if (d.isSymbolicLink && d.isSymbolicLink()) continue;
      const p = path.join(dirPath, d.name);
      if (d.isDirectory()) {
        recurs(p);
        continue;
      }
      if (!d.isFile()) continue;
      if (!d.name || !d.name.toLowerCase().endsWith('.srt')) continue;
      const noExt = d.name.slice(0, -4);
      const lastDot = noExt.lastIndexOf('.');
      if (lastDot < 0) continue;
      const tag = noExt.slice(lastDot + 1);
      if (!searchTags.has(tag)) continue;
      if (!pathsByTag.has(tag)) pathsByTag.set(tag, []);
      pathsByTag.get(tag).push(p);
    }
  };

  recurs(localShowPath);

  const timeLineRe = /^([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(\s*-->\s*)([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(.*)$/;

  for (const entry of fileIdObjs) {
    const fid = Number(entry?.file_id);
    if (!Number.isFinite(fid)) {
      addFailure(entry, 'input', undefined, undefined, 'invalid file_id');
      continue;
    }

    const tags = [encodeFileIdBase32(fid), encodeFileIdBase32Legacy(fid), encodeFileIdBase32LegacyAZ05(fid)];
    const srtPaths = [];
    const seen = new Set();
    for (const t of tags) {
      const arr = pathsByTag.get(t);
      if (!arr) continue;
      for (const p of arr) {
        if (seen.has(p)) continue;
        seen.add(p);
        srtPaths.push(p);
      }
    }

    if (srtPaths.length === 0) {
      addFailure(entry, 'find', undefined, { tags }, 'subtitle .srt not found');
      continue;
    }

    let anyUpdated = false;
    for (const srtPath of srtPaths) {
      let text;
      try {
        text = fs.readFileSync(srtPath, 'utf8');
      } catch (e) {
        addFailure(entry, 'read', undefined, { path: srtPath }, e.message);
        continue;
      }

      const lines = String(text).split(/\r?\n/);
      let changed = false;
      let matched = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = timeLineRe.exec(line);
        if (!m) continue;
        const startMs = srtTimeToMs(m[1]);
        const endMs = srtTimeToMs(m[3]);
        if (startMs === null || endMs === null) continue;
        matched++;
        const newStart = Math.max(0, startMs + offsetMs);
        const newEnd = Math.max(0, endMs + offsetMs);
        lines[i] = `${msToSrtTime(newStart)}${m[2]}${msToSrtTime(newEnd)}${m[4] || ''}`;
        changed = true;
      }

      if (matched === 0) {
        addFailure(entry, 'parse', undefined, { path: srtPath }, 'no timing lines found');
        continue;
      }
      if (!changed) {
        // Shouldn't happen if matched>0, but keep it safe.
        addFailure(entry, 'parse', undefined, { path: srtPath }, 'no changes applied');
        continue;
      }

      try {
        fs.writeFileSync(srtPath, lines.join('\n'), 'utf8');
        anyUpdated = true;
      } catch (e) {
        addFailure(entry, 'write', undefined, { path: srtPath }, e.message);
      }
    }

    if (anyUpdated) {
      appliedSet.add(fid);
    }
  }

  resolve([id, { ok: true, applied: Array.from(appliedSet), failures }]);
};

function parseSeasonEpisodeFromFilename(fileName) {
  // Uses parse-torrent-title. Returns { season, episode } or null.
  if (!fileName) return null;
  const base = String(fileName);

  let parsed;
  try {
    parsed = parseTorrentTitle(base);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const season = Number.isFinite(Number(parsed.season)) ? Number(parsed.season) :
    (Array.isArray(parsed.seasons) && parsed.seasons.length ? Number(parsed.seasons[0]) : NaN);
  const episode = Number.isFinite(Number(parsed.episode)) ? Number(parsed.episode) :
    (Array.isArray(parsed.episodes) && parsed.episodes.length ? Number(parsed.episodes[0]) : NaN);

  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return { season, episode };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeImdbId(imdbId) {
  if (imdbId === undefined || imdbId === null) return '';
  const s = String(imdbId).trim();
  if (!s) return '';
  // remove leading tt and any non-digits
  return s.replace(/^tt/i, '').replace(/\D/g, '');
}

function loadSubsLogin() {
  let loginStr;
  try {
    loginStr = fs.readFileSync(subsLoginPath, 'utf8');
  } catch (e) {
    throw new Error(`subsSearch: missing ${subsLoginPath}`);
  }

  let login;
  try {
    login = JSON.parse(loginStr);
  } catch (e) {
    throw new Error(`subsSearch: invalid JSON in ${subsLoginPath}`);
  }

  const apiKey = typeof login?.apiKey === 'string' ? login.apiKey.trim() : '';
  const username = typeof login?.username === 'string' ? login.username.trim() : '';
  const password = typeof login?.password === 'string' ? login.password.trim() : '';

  if (!apiKey) throw new Error('subsSearch: missing apiKey');
  // username/password only required for login refresh path

  return { apiKey, username, password };
}

async function persistSubsToken(token) {
  const t = typeof token === 'string' ? token.trim() : '';
  if (!t) throw new Error('subsSearch: empty token');
  subsTokenCache = t;
  try {
    fs.mkdirSync(path.dirname(subsTokenWritePath), { recursive: true });
  } catch {}
  await util.writeFile(subsTokenWritePath, t);
}

async function openSubtitlesLogin({ apiKey, username, password }) {
  if (!username || !password) {
    throw new Error('subsSearch: cannot login (missing username/password)');
  }

  const url = 'https://api.opensubtitles.com/api/v1/login';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'User-Agent': openSubtitlesUserAgent,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    body = { error: (text || '').slice(0, 500) };
  }

  if (!resp.ok) {
    const msg = body?.message || body?.error || `OpenSubtitles login failed (${resp.status})`;
    throw new Error(`subsSearch: ${msg}`);
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) throw new Error('subsSearch: login succeeded but no token returned');
  return token;
}

async function openSubtitlesSubtitles({ apiKey, token, imdbDigits, page }) {
  const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
  url.search = new URLSearchParams({
    parent_imdb_id: imdbDigits,
    page: String(page),
    languages: 'en',
  }).toString();

  const headers = {
    'Api-Key': apiKey,
    'User-Agent': openSubtitlesUserAgent,
    'Accept': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url.toString(), { headers });

  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    body = { error: text || `OpenSubtitles non-JSON response (${resp.status})` };
  }

  return { resp, body };
}

async function openSubtitlesDownload({ apiKey, token, fileId }) {
  const url = 'https://api.opensubtitles.com/api/v1/download';
  const headers = {
    'Api-Key': apiKey,
    'User-Agent': openSubtitlesUserAgent,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ file_id: fileId }),
  });

  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    body = { error: (text || '').slice(0, 500) };
  }

  return { resp, body };
}

async function openSubtitlesDownloadWithRetry({ apiKey, token, fileId, maxAttempts = 3 }) {
  // Retry transient upstream errors.
  const retryStatus = new Set([502, 503, 504]);
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      last = await openSubtitlesDownload({ apiKey, token, fileId });
      if (last?.resp?.ok) return last;
      const status = last?.resp?.status;
      if (retryStatus.has(status)) {
        console.log(`[subs] OpenSubtitles /download HTTP ${status} (file_id=${fileId}, attempt=${attempt}/${maxAttempts})`);
      }
      if (retryStatus.has(status) && attempt < maxAttempts) {
        await sleep(400 * attempt);
        continue;
      }
      return last;
    } catch (e) {
      // Network error / fetch throw: retry.
      if (attempt < maxAttempts) {
        await sleep(400 * attempt);
        continue;
      }
      throw e;
    }
  }
  return last;
}

const subsSearch = async (id, param, resolve, reject) => {
  const parsed = util.jParse(param, 'subsSearch');
  const imdbDigits = normalizeImdbId(parsed?.imdb_id);
  let page = parsed?.page;

  if (!imdbDigits) {
    reject([id, { error: 'subsSearch: missing imdb_id' }]);
    return;
  }

  if (page === undefined || page === null || page === '') page = 1;
  page = Number(page);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let login;
  try {
    login = loadSubsLogin();
  } catch (e) {
    reject([id, { error: e.message }]);
    return;
  }

  // First attempt with existing token (if any)
  try {
    const { resp, body } = await openSubtitlesSubtitles({
      apiKey: login.apiKey,
      token: subsTokenCache,
      imdbDigits,
      page,
    });

    if (resp.ok) {
      resolve([id, body]);
      return;
    }

    // Refresh token on auth failure and retry once.
    if (resp.status === 401 || resp.status === 403) {
      const newToken = await openSubtitlesLogin(login);
      await persistSubsToken(newToken);

      const retry = await openSubtitlesSubtitles({
        apiKey: login.apiKey,
        token: subsTokenCache,
        imdbDigits,
        page,
      });

      if (retry.resp.ok) {
        resolve([id, retry.body]);
        return;
      }

      reject([id, { error: `subsSearch: OpenSubtitles HTTP ${retry.resp.status}`, details: retry.body }]);
      return;
    }

    reject([id, { error: `subsSearch: OpenSubtitles HTTP ${resp.status}`, details: body }]);
  } catch (e) {
    reject([id, { error: `subsSearch: ${e.message}` }]);
  }
};

function gapEntryHasGap(gap) {
  if (!gap || typeof gap !== 'object') return false;

  // Boolean flags that indicate a gap condition.
  if (gap.FileGap === true) return true;
  if (gap.WatchGap === true) return true;
  if (gap.NotReady === true) return true;

  // Explicit season/episode markers (allow 0).
  if (gap.FileGapSeason !== null && gap.FileGapSeason !== undefined) return true;
  if (gap.FileGapEpisode !== null && gap.FileGapEpisode !== undefined) return true;
  if (gap.WatchGapSeason !== null && gap.WatchGapSeason !== undefined) return true;
  if (gap.WatchGapEpisode !== null && gap.WatchGapEpisode !== undefined) return true;

  // Non-empty wait string can also indicate a gap state.
  if (typeof gap.WaitStr === 'string' && gap.WaitStr.trim() !== '') return true;

  return false;
}

function stripGapTransientFields(gap) {
  if (!gap || typeof gap !== 'object') return false;
  let changed = false;

  // `Waiting` is transient client state; never persist it.
  if (Object.prototype.hasOwnProperty.call(gap, 'Waiting')) {
    delete gap.Waiting;
    changed = true;
  }

    // Legacy field removed from the data model; never persist it.
  if (Object.prototype.hasOwnProperty.call(gap, 'BlockedGap')) {
    delete gap.BlockedGap;
    changed = true;
  }

  return changed;
}

// Prune gaps on load: only keep shows that currently have gaps.
try {
  if (gaps && typeof gaps === 'object' && !Array.isArray(gaps)) {
    let changed = false;
    for (const [gapId, gap] of Object.entries(gaps)) {
      // Never persist transient/removed fields.
      if (stripGapTransientFields(gap)) changed = true;
      if (!gapEntryHasGap(gap)) {
        delete gaps[gapId];
        changed = true;
      }
    }
    if (changed) {
      try {
        fs.writeFileSync(gapsPath, JSON.stringify(gaps), 'utf8');
      } catch {}
    }
  }
} catch {}

// Set up callback for tvdb to add shows to pickup list
tvdb.setAddToPickupsCallback((showName) => {
  // Check if already in pickup list
  const alreadyInPickups = pickups.some(
    pickup => pickup.toLowerCase() === showName.toLowerCase()
  );
  if (!alreadyInPickups) {
    console.log('Auto-adding to pickups (not in emby):', showName);
    pickups.push(showName);
    // Save and upload config asynchronously without blocking
    (async () => {
      await trySaveConfigYml(null, null, () => {}, () => {});
    })();
  }
});

const videoFileExtensions = [
  "mp4", "mkv", "avi", "mov", "wmv", "flv", "mpeg",
  "3gp", "m4v", "ts", "rm", "vob", "ogv", "divx"
];

function safeShowFolderName(rawName) {
  if (typeof rawName !== 'string') return null;

  let name = rawName.trim();
  if (!name) return null;

  // Prevent traversal / invalid names: remove path separators and trailing dots/spaces.
  name = name.replaceAll('/', ' ').replaceAll('\\', ' ');
  name = name.replace(/[\x00-\x1F\x7F]/g, ' ');
  name = name.replace(/[\.\s]+$/g, '');
  name = name.replace(/\s{2,}/g, ' ').trim();
  if (!name) return null;

  return name;
}

function seasonFolderName(season) {
  // Keep consistent with existing convention used elsewhere: `Season ${season}`.
  // If season is a number, keep it unpadded (Season 1). If it's a string like "01", preserve it.
  if (season === null || season === undefined) return null;
  const s = typeof season === 'number' ? String(season) : String(season).trim();
  if (!s) return null;
  return `Season ${s}`;
}

function rpcParamToString(param) {
  // Param is usually a raw string, but tolerate JSON-stringified strings.
  if (param === undefined || param === null) return '';
  if (typeof param !== 'string') return String(param);
  const trimmed = param.trim();
  if (trimmed === '') return '';
  if (trimmed === 'null') return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : String(parsed);
    } catch {
      return param;
    }
  }
  return param;
}

function fmtDateWithTZ(date, utcOut = false) {
  let year, month, day;
  if(utcOut) {
    year = date.getUTCFullYear();
    month = String(date.getUTCMonth() + 1).padStart(2, '0');
    day = String(date.getUTCDate()).padStart(2, '0');
  } else {
    year = date.getFullYear();
    month = String(date.getMonth() + 1).padStart(2, '0');
    day = String(date.getDate()).padStart(2, '0');
  }
  return `${year}-${month}-${day}`;
}

const getShowsFromDisk = async (id, _param, resolve, reject) => {
  let   errFlg = null;
  const shows = {};

  let maxDate, totalSize;

  const recurs = async (path) => {
    if(errFlg || path == tvDir + '/.stfolder') return;
    try {
      const fstat = fs.statSync(path);
      if(fstat.isDirectory()) {
        const dir = fs.readdirSync(path);
        for (const dirent of dir) 
          await recurs(path + '/' + dirent);
        return;
      }
      const sfx = path.split('.').pop();
      if(videoFileExtensions.includes(sfx)) {
        const date = fmtDateWithTZ(fstat.mtime);
        maxDate    = Math.max(maxDate, date);
      }
      totalSize += fstat.size;
    }
    catch (err) {
      errFlg = err;
    }
  }

  const dir =  fs.readdirSync(tvDir);
  for (const dirent of dir) {
    const showPath = tvDir + '/' + dirent;
    const fstat   = fs.statSync(showPath);
    const maxDate = fmtDateWithTZ(fstat.mtime);
    totalSize = 0;

    await recurs(showPath);

    shows[dirent] = [maxDate, totalSize];
    if(totalSize == 0) {
      console.log('empty show:', dirent);
    }
  }
  if(errFlg) {
    reject([id, `getShowsFromDisk: ${dirent}, ${err.message}`]);
    return;
  }
  else {
    resolve([id, shows]);
    return;
  }
}
 
const upload = async () => {
  let str = headerStr;
  str += '        - "dummy"\n';
  for(let name of rejects)
    str += '        - "' + name.replace(/"/g, '') + '"\n';
  console.log({str});
  str += middleStr;
  for(let name of pickups)
    str += '        - "' + name.replace(/"/g, '') + '"\n';
  str += footerStr;
  console.log('creating config.yml');
  await util.writeFile('config/config.yml', str);

  if(dontupload) {
    console.log("---- didn't upload config.yml ----");
    return 'ok';
  }

  console.log('uploading config.yml');
  const timeBeforeUSB = new Date().getTime();
  const {stdout} = await exec(
          'rsync -av config/config.yml xobtlu@oracle.usbx.me:' +
          '/home/xobtlu/.config/flexget/config.yml');
  console.log(
      'upload delay:', new Date().getTime() - timeBeforeUSB);

  const rx = new RegExp('total size is ([0-9,]*)');
  const matches = rx.exec(stdout);
  if(!matches || parseInt(matches[1].replace(',', '')) < 1000) {
    console.error('\nERROR: config.yml upload failed\n', stdout, '\n');
    return `config.yml upload failed: ${stdout.toString()}`;
  }
  console.log('uploaded config.yml, size:', matches[1]);
  return 'ok';
}

const reload = async () => {
  if(dontupload) {
    console.log("---- didn't reload ----");
    return 'ok';
  }

  console.log('reloading config.yml');
  const timeBeforeUSB = new Date().getTime();
  const {stdout} = await exec(
    'ssh xobtlu@oracle.usbx.me /home/xobtlu/reload-cmd');
  console.log(
      'reload delay:', new Date().getTime() - timeBeforeUSB);

  if(!stdout.includes('Config successfully reloaded'))  {
    console.log('\nERROR: config.yml reload failed\n', stdout, '\n');
    return `config.yml reload failed: ${stdout.toString()}`;
  }
  console.log('reloaded config.yml');
  return 'ok';
}

let saving = false;

const trySaveConfigYml = async (id, result, resolve, reject) => {
  if(saving) return ['busy', id, result, resolve, reject];
  saving = true;
  rejects.sort((a,b) => { 
    return (a.toLowerCase() > b.toLowerCase() ? +1 : -1);
  });
  pickups.sort((a,b) => { 
    const aname = a.replace(/The\s/i, '');
    const bname = b.replace(/The\s/i, '');
    return (aname.toLowerCase() > bname.toLowerCase() ? +1 : -1);
  });
  await util.writeFile('config/config2-rejects.json', rejects);
  await util.writeFile('config/config4-pickups.json', pickups);

  let errResult = null;

  const uploadRes = await upload();
  if(uploadRes != 'ok') errResult = uploadRes;
  if(!errResult) {
    const reloadRes = await reload();
    if(reloadRes != 'ok') errResult = reloadRes;
  }

  if(errResult) {
    console.log('trySaveConfigYml error:', errResult);
    saving = false;
    return ['err', id, errResult, resolve, reject];
  }

  saving = false;
  return ['ok', id, result, resolve, reject];
};

// this always sends a response to the client
// can be called and forgotten
const saveConfigYml = async (idIn, resultIn, resolveIn, rejectIn) => {
  const tryRes = await trySaveConfigYml(idIn, resultIn, resolveIn, rejectIn);    
  const [status, id, result, resolve, reject] = tryRes;
  switch(status) {
    case 'busy': 
      setTimeout(() => saveConfigYml(id, result, resolve, reject), 1000); 
      break;
    case 'ok':  resolve([id, result]); break;
    case 'err': reject( [id, tryRes]); break;
  }
}

const getRejects = (id, _param, resolve, _reject) => {
  resolve([id, rejects]);
};

const addReject = (id, name, resolve, reject) => {
  console.log('addReject', id, name);
  for(const [idx, rejectNameStr] of rejects.entries()) {
    if(rejectNameStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- removing old matching reject:', rejectNameStr);
      rejects.splice(idx, 1);
      break;
    }
  }
  console.log('-- adding reject:', name);
  rejects.push(name);
  saveConfigYml(id, 'ok', resolve, reject);
}

const delReject = (id, name, resolve, reject) => {
  console.log('delReject', id, name);
  let deletedOne = false;
  for(const [idx, rejectNameStr] of rejects.entries()) {
    if(rejectNameStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- deleting reject:', rejectNameStr);
      rejects.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if(!deletedOne) {
    console.log('-- reject not deleted -- no match:', name);
    resolve([id, 'delReject not deleted: ' + name]);
    return
  }
  saveConfigYml(id, 'ok', resolve, reject);
}

const getPickups = (id, _param, resolve, _reject) => {
  resolve([id, pickups]);
};

const addPickup = (id, name, resolve, reject) => {
  console.log('addPickup', id, name);
  for(const [idx, pickupNameStr] of pickups.entries()) {
    if(pickupNameStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- removing old matching pickup:', pickupNameStr);
      pickups.splice(idx, 1);
      break;
    }
  }
  console.log('-- adding pickup:', name);
  pickups.push(name);
  saveConfigYml(id, 'ok', resolve, reject);
}

const delPickup = (id, name, resolve, reject) => {
  console.log('delPickup', id, name);
  let deletedOne = false;
  for(const [idx, pickupNameStr] of pickups.entries()) {
    if(pickupNameStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- deleting pickup:', pickupNameStr);
      pickups.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if(!deletedOne) {
    resolve([id, 'delPickup no match: ' + name]);
    console.log('pickup not deleted, no match:', name);
    return;
  }
  saveConfigYml(id, 'ok', resolve, reject);
}

const getNoEmbys = (id, _param, resolve, _reject) => {
  resolve([id, noEmbys]);
};

const addNoEmby = async (id, showStr, resolve) => {
  const show = JSON.parse(showStr);
  // if(show.Reject) return;
  const name = show.Name;
  console.log('addNoEmby', id, name);
  for(const [idx, show] of noEmbys.entries()) {
    if(show.Name.toLowerCase() === name.toLowerCase()) {
      console.log('removing old noemby:', name);
      noEmbys.splice(idx, 1);
      break;
    }
  }
  console.log('adding noemby:', name);
  noEmbys.push(show);
  await util.writeFile(noEmbyPath, noEmbys); 
  resolve([id, 'ok']);
}

const delNoEmby = async (id, name, resolve, reject) => {
  console.log('delNoEmby', id, name);
  let deletedOne = false;
  for(const [idx, show] of noEmbys.entries()) {
    if(!show.Name ||
        show.Name.toLowerCase() === name.toLowerCase()) {
      console.log('deleting no-emby because now in emby:', name);
      noEmbys.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if(!deletedOne) {
    console.log('no noembys deleted, no match:', name);
    resolve([id, 'delNoEmby no match:' + name]);
    return;
  }
  await util.writeFile(noEmbyPath, noEmbys); 
  resolve([id, 'ok']);
}

const getGaps = (id, _param, resolve, _reject) => {
  resolve([id, gaps]);
};

const addGap = async (id, gapIdGapSave, resolve, _reject) => {
  const [gapId, gap, save] = JSON.parse(gapIdGapSave);
  // console.logapIdGapSaveg('addGap', id, {gapIdGapSave});
  if (gapId !== null && gapId !== undefined) {
    stripGapTransientFields(gap);
    if (gapEntryHasGap(gap)) gaps[gapId] = gap;
    else delete gaps[gapId];
  }
  if(save) await util.writeFile(gapsPath, gaps); 
  resolve([id, 'ok']);
}

const delGap = async (id, gapIdSave, resolve, _reject) => {
  console.log('delGap', id, {gapIdSave});
  const [gapId, save] = JSON.parse(gapIdSave);
  if(gapId !== null) delete gaps[gapId];
  if(save) {
    await util.writeFile(gapsPath, gaps); 
  }
  resolve([id, 'ok']);
}

const delSeasonFiles = async (id, param, resolve, reject) => {
  const params = util.jParse(param, 'delSeasonFiles');
  const showName = params?.showName;
  const showPath = params?.showPath;
  const season = params?.season;

  if (!showName || !showPath || season === undefined || season === null) {
    reject([id, {err: 'delSeasonFiles: requires showName, showPath, season'}]);
    return;
  }

  const seasonDir = path.join(showPath, `Season ${season}`);
  console.log(`[delSeasonFiles] ${showName}: ${seasonDir}`);

  if (!fs.existsSync(seasonDir)) {
    reject([id, {err: `no such dir: ${seasonDir}`}]);
    return;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(seasonDir);
  } catch (e) {
    reject([id, {err: `delSeasonFiles: readdir failed: ${e.message}`}]);
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(seasonDir, entry);
    console.log(`[delSeasonFiles] deleting: ${entryPath}`);
    try {
      await rimraf(entryPath);
    } catch (e) {
      reject([id, {err: `delSeasonFiles: delete failed: ${e.message}`}]);
      return;
    }
  }

  resolve([id, {status: 'ok'}]);
}

const createShowFolder = async (id, param, resolve, reject) => {
  const params = util.jParse(param, 'createShowFolder');
  const showNameRaw = params?.showName;
  const seriesMapSeasons = params?.seriesMapSeasons;

  console.log('[createShowFolder] request', {
    id,
    showName: showNameRaw,
    tvdbId: params?.tvdbId,
    seriesMapSeasons,
  });

  const showName = safeShowFolderName(showNameRaw);
  if (!showName) {
    console.log('[createShowFolder] invalid showName', { showNameRaw });
    reject([id, { err: 'createShowFolder: invalid showName' }]);
    return;
  }

  const showPath = path.join(tvDir, showName);
  const existed = fs.existsSync(showPath);

  try {
    fs.mkdirSync(showPath, { recursive: true });
    console.log('[createShowFolder] show dir', { showPath, existed });
  } catch (e) {
    reject([id, { err: `createShowFolder: mkdir failed: ${e.message}` }]);
    return;
  }

  if (Array.isArray(seriesMapSeasons)) {
    for (const season of seriesMapSeasons) {
      const seasonDirName = seasonFolderName(season);
      if (!seasonDirName) continue;
      const seasonPath = path.join(showPath, seasonDirName);
      try {
        fs.mkdirSync(seasonPath, { recursive: true });
        console.log('[createShowFolder] season dir', { season, seasonPath });
      } catch (e) {
        reject([id, { err: `createShowFolder: mkdir season failed: ${e.message}` }]);
        return;
      }
    }
  } else if (seriesMapSeasons !== undefined) {
    console.log('[createShowFolder] seriesMapSeasons not an array; skipping season dirs', {
      seriesMapSeasonsType: typeof seriesMapSeasons,
    });
  }

  resolve([id, { ok: true, created: !existed, path: showPath }]);
}

let sharedFilters = null;

const setSharedFilters = (id, param, resolve, reject) => {
  // Client sends JSON.stringify(object) or "null".
  if (param === '' || param === undefined || param === null) {
    sharedFilters = null;
    resolve([id, { ok: true }]);
    return;
  }

  const parsed = util.jParse(param, 'setSharedFilters');
  if (parsed === null) {
    sharedFilters = null;
    resolve([id, { ok: true }]);
    return;
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    reject([id, { err: 'setSharedFilters: expected object or null' }]);
    return;
  }

  sharedFilters = parsed;
  resolve([id, { ok: true }]);
};

const getSharedFilters = (id, _param, resolve, _reject) => {
  resolve([id, sharedFilters]);
};

const getNote = (id, param, resolve, reject) => {
  const showName = rpcParamToString(param).trim();
  if (!showName) {
    reject([id, { err: 'getNote: missing showName' }]);
    return;
  }
  resolve([id, notesCache[showName] ?? '' ]);
};

const getAllNotes = (id, _param, resolve, _reject) => {
  // Return a shallow copy so callers can't mutate server cache by reference.
  // Also defensively filter empty notes.
  const out = {};
  for (const [key, val] of Object.entries(notesCache)) {
    if (typeof val === 'string' && val.trim() !== '') out[key] = val;
  }
  resolve([id, out]);
};

const saveNote = async (id, param, resolve, reject) => {
  if (param === undefined || param === null || param === '') {
    reject([id, { err: 'saveNote: missing params' }]);
    return;
  }

  const parsed = util.jParse(param, 'saveNote');
  let showName;
  let noteText;

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    showName = parsed.showName;
    noteText = parsed.noteText;
  } else {
    reject([id, { err: 'saveNote: expected { showName, noteText }' }]);
    return;
  }

  if (typeof showName !== 'string' || showName.trim() === '') {
    reject([id, { err: 'saveNote: invalid showName' }]);
    return;
  }
  if (noteText === undefined || noteText === null) noteText = '';
  if (typeof noteText !== 'string') noteText = String(noteText);

  const key = showName.trim();

  // Never store empty notes: treat as delete.
  if (noteText.trim() === '') {
    if (notesCache[key] === undefined) {
      resolve([id, 'ok']);
      return;
    }
    delete notesCache[key];
    try {
      await util.writeFile(notesPath, notesCache);
    } catch (e) {
      reject([id, { err: `saveNote: write failed: ${e.message}` }]);
      return;
    }
    resolve([id, 'ok']);
    return;
  }

  const prev = notesCache[key];
  if (prev === noteText) {
    resolve([id, 'ok']);
    return;
  }

  notesCache[key] = noteText;
  try {
    // Flush to disk on every change.
    await util.writeFile(notesPath, notesCache);
  } catch (e) {
    reject([id, { err: `saveNote: write failed: ${e.message}` }]);
    return;
  }

  resolve([id, 'ok']);
};

const getFile = (id, param, resolve, reject) => {
  // Param is usually a raw string path (per RPC protocol). Allow "" => tvDir.
  let requestedPath = param;
  if (requestedPath === undefined || requestedPath === null) requestedPath = '';

  // If someone accidentally JSON.stringified a string, tolerate it.
  if (typeof requestedPath === 'string') {
    const trimmed = requestedPath.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || trimmed === 'null') {
      try {
        requestedPath = JSON.parse(trimmed);
      } catch {
        // keep as-is
        requestedPath = param;
      }
    }
  }

  if (typeof requestedPath !== 'string') {
    reject([id, { err: 'getFile: param must be a string path' }]);
    return;
  }

  const rawPath = requestedPath.trim();
  const basePath = tvDir;
  const targetPath = rawPath ? path.resolve(rawPath) : path.resolve(basePath);

  // Safety: only allow listings within tvDir.
  const allowedRoot = path.resolve(basePath) + path.sep;
  if (!(targetPath + path.sep).startsWith(allowedRoot) && targetPath !== path.resolve(basePath)) {
    reject([id, { err: `getFile: path not allowed: ${rawPath}` }]);
    return;
  }

  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (e) {
    reject([id, { err: `getFile: stat failed: ${e.message}` }]);
    return;
  }

  if (!stat.isDirectory()) {
    reject([id, { err: 'getFile: path is not a directory' }]);
    return;
  }

  let dirents;
  try {
    dirents = fs.readdirSync(targetPath, { withFileTypes: true });
  } catch (e) {
    reject([id, { err: `getFile: readdir failed: ${e.message}` }]);
    return;
  }

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });

  dirents.sort((a, b) => collator.compare(a.name, b.name));

  const out = [];
  for (const d of dirents) {
    const name = d.name;
    if (!name) continue;

    if (d.isDirectory()) {
      const childPath = path.join(targetPath, name);
      try {
        const childDirents = fs.readdirSync(childPath, { withFileTypes: true });
        const childNames = childDirents
          .map((cd) => cd.name)
          .filter(Boolean)
          .sort((a, b) => collator.compare(a, b));
        out.push({ [name]: childNames });
      } catch {
        // If we can't read the directory, still return it with empty children.
        out.push({ [name]: [] });
      }
    } else {
      out.push(name);
    }
  }

  resolve([id, out]);
};

const applySubFiles = async (id, param, resolve, reject) => {
  if (param === undefined || param === null || param === '') {
    reject([id, { error: 'applySubFiles: missing params' }]);
    return;
  }

  const fileIdObjs = util.jParse(param, 'applySubFiles');
  if (!Array.isArray(fileIdObjs) || fileIdObjs.length === 0) {
    reject([id, { error: 'applySubFiles: expected non-empty array' }]);
    return;
  }

  const showName = typeof fileIdObjs[0]?.showName === 'string' ? fileIdObjs[0].showName : '';
  if (!showName || showName.trim() === '') {
    reject([id, { error: 'applySubFiles: missing showName' }]);
    return;
  }
  if (showName.includes('/') || showName.includes('\\')) {
    reject([id, { error: 'applySubFiles: invalid showName' }]);
    return;
  }
  for (const entry of fileIdObjs) {
    if (typeof entry?.showName !== 'string' || entry.showName !== showName) {
      reject([id, { error: 'applySubFiles: all entries must have same showName' }]);
      return;
    }
  }

  const localShowPath = path.join(tvDir, showName);
  try {
    const st = fs.statSync(localShowPath);
    if (!st.isDirectory()) {
      reject([id, { error: `Show directory missing: ${localShowPath} (n/a)` }]);
      return;
    }
  } catch {
    reject([id, { error: `Show directory missing: ${localShowPath} (n/a)` }]);
    return;
  }

  let login;
  try {
    login = loadSubsLogin();
  } catch (e) {
    reject([id, { error: e.message }]);
    return;
  }

  const failures = [];
  const appliedSet = new Set();

  const addFailure = (cand, stage, status, details, error) => {
    const fid = Number(cand?.file_id);
    const showName = typeof cand?.showName === 'string' ? cand.showName : undefined;
    const season = cand?.season;
    const episode = cand?.episode;

    let reason = '';
    if (status !== undefined && status !== null) reason = `${stage} HTTP ${status}`;
    else if (error) reason = `${stage}: ${error}`;
    else reason = stage;

    const rec = { file_id: fid, showName, season, episode, reason, stage, status };
    if (details !== undefined) rec.details = details;
    failures.push(rec);
  };

  // Step 1-4: update entries with local paths, validate, compute fileIdBase32.
  // Note: we fetch OpenSubtitles /download links lazily per video file so one bad
  // file_id (e.g. transient 502) doesn't fail the entire batch.
  const seasonExistsCache = new Map();
  for (const entry of fileIdObjs) {
    const file_id = entry?.file_id;
    const season = entry?.season;
    const episode = entry?.episode;

    if (!Number.isFinite(Number(file_id))) {
      reject([id, { error: 'applySubFiles: invalid file_id' }]);
      return;
    }
    if (!Number.isFinite(Number(season))) {
      reject([id, { error: `applySubFiles: invalid season (${file_id})` }]);
      return;
    }
    if (!Number.isFinite(Number(episode))) {
      reject([id, { error: `applySubFiles: invalid episode (${file_id})` }]);
      return;
    }

    entry.localShowPath = localShowPath + '/';

    // Verify local show path exists.
    try {
      const stShow = fs.statSync(localShowPath);
      if (!stShow.isDirectory()) {
        reject([id, { error: `Show directory missing: ${entry.localShowPath} (${file_id})` }]);
        return;
      }
    } catch {
      reject([id, { error: `Show directory missing: ${entry.localShowPath} (${file_id})` }]);
      return;
    }

    // If the requested season folder doesn't exist, record a failure but keep going.
    const seasonNum = Number(season);
    const expectedSeasonPath = path.join(localShowPath, `Season ${seasonNum}`);
    let seasonExists = seasonExistsCache.get(seasonNum);
    if (seasonExists === undefined) {
      try {
        seasonExists = fs.statSync(expectedSeasonPath).isDirectory();
      } catch {
        seasonExists = false;
      }
      seasonExistsCache.set(seasonNum, seasonExists);
    }
    if (!seasonExists) {
      entry._missingSeasonDir = true;
      addFailure(entry, 'localSeason', undefined, { path: expectedSeasonPath }, 'Season directory missing');
    }

    entry.fileIdBase32 = encodeFileIdBase32(Number(file_id));
  }

  // Persist the augmented request for inspection.
  try {
    await util.writeFile('samples/fileIdObjs.json', fileIdObjs);
  } catch (e) {
    reject([id, { error: `applySubFiles: write failed: ${e.message}` }]);
    return;
  }

  // Build lookup by season/episode.
  const byKey = new Map();
  for (const entry of fileIdObjs) {
    const key = `${Number(entry.season)}-${Number(entry.episode)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  }

  const srtCacheByFileId = new Map();
  const srtUrlCacheByFileId = new Map();
  const failedByFileId = new Map();

  // For each video file in all season dirs under localShowPath, write a matching srt.
  let seasonDirents;
  try {
    seasonDirents = fs.readdirSync(localShowPath, { withFileTypes: true });
  } catch (e) {
    reject([id, { error: `applySubFiles: readdir failed: ${e.message}` }]);
    return;
  }

  const foundKeys = new Set();

  for (const dirent of seasonDirents) {
    if (!dirent.isDirectory()) continue;
    const seasonPath = path.join(localShowPath, dirent.name);

    let fileDirents;
    try {
      fileDirents = fs.readdirSync(seasonPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fd of fileDirents) {
      if (!fd.isFile()) continue;
      const fileName = fd.name;
      const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
      if (!videoFileExtensions.includes(ext)) continue;

      const parsed = parseSeasonEpisodeFromFilename(fileName);
      if (!parsed) continue;

      const key = `${parsed.season}-${parsed.episode}`;
      const candidates = byKey.get(key);
      if (!candidates || candidates.length === 0) continue;

      foundKeys.add(key);

      const fileBase = fileName.slice(0, -(ext.length + 1));

      // Find the first candidate that (a) doesn't already exist on disk and
      // (b) successfully downloads. Only write one new srt per video per call.
      let wroteOneForThisVideo = false;
      for (const cand of candidates) {
        const srtName = `${fileBase}.${cand.fileIdBase32}.srt`;
        const outPath = path.join(seasonPath, srtName);
        if (fs.existsSync(outPath)) continue;

        const fid = Number(cand.file_id);

        // Don't create a duplicate if the legacy-tagged subtitle already exists.
        const legacyTag1 = encodeFileIdBase32Legacy(fid);
        const legacyPath1 = path.join(seasonPath, `${fileBase}.${legacyTag1}.srt`);
        if (fs.existsSync(legacyPath1)) continue;

        const legacyTag2 = encodeFileIdBase32LegacyAZ05(fid);
        const legacyPath2 = path.join(seasonPath, `${fileBase}.${legacyTag2}.srt`);
        if (fs.existsSync(legacyPath2)) continue;

        // If this file_id already failed earlier in this call, skip it.
        if (failedByFileId.has(fid)) continue;

        let srtText = srtCacheByFileId.get(fid);
        if (srtText === undefined) {
          // Resolve (and cache) /download link for this file_id.
          let url = srtUrlCacheByFileId.get(fid) || null;
          if (!url) {
            try {
              let dl = await openSubtitlesDownloadWithRetry({ apiKey: login.apiKey, token: subsTokenCache, fileId: fid });
              if (!dl?.resp?.ok && (dl?.resp?.status === 401 || dl?.resp?.status === 403)) {
                const newToken = await openSubtitlesLogin(login);
                await persistSubsToken(newToken);
                dl = await openSubtitlesDownloadWithRetry({ apiKey: login.apiKey, token: subsTokenCache, fileId: fid });
              }

              if (!dl?.resp?.ok) {
                const status = dl?.resp?.status;
                if (status === 502 || status === 503 || status === 504) {
                  console.log(`[subs] OpenSubtitles /download HTTP ${status} (file_id=${fid})`);
                }
                addFailure(cand, 'download', status, dl?.body);
                failedByFileId.set(fid, { stage: 'download', status });
                continue;
              }

              url = typeof dl.body?.link === 'string' ? dl.body.link.trim() : '';
              if (!url) {
                addFailure(cand, 'download', dl?.resp?.status, dl?.body, 'missing link');
                failedByFileId.set(fid, { stage: 'download', status: dl?.resp?.status });
                continue;
              }
              srtUrlCacheByFileId.set(fid, url);
              cand.srtFileUrl = url;
            } catch (e) {
              addFailure(cand, 'download', null, undefined, e?.message || String(e));
              failedByFileId.set(fid, { stage: 'download', status: null });
              continue;
            }
          } else {
            cand.srtFileUrl = url;
          }

          try {
            const resp = await fetch(url, { headers: { 'Accept': '*/*' } });
            if (!resp.ok) {
              const status = resp.status;
              if (status === 502 || status === 503 || status === 504) {
                console.log(`[subs] OpenSubtitles .srt GET HTTP ${status} (file_id=${fid})`);
              }
              addFailure(cand, 'srt', status);
              failedByFileId.set(fid, { stage: 'srt', status });
              continue;
            }
            srtText = await resp.text();
            srtCacheByFileId.set(fid, srtText);
          } catch (e) {
            addFailure(cand, 'srt', null, undefined, e?.message || String(e));
            failedByFileId.set(fid, { stage: 'srt', status: null });
            continue;
          }
        }

        try {
          await fs.promises.writeFile(outPath, srtText, 'utf8');
          appliedSet.add(fid);
          wroteOneForThisVideo = true;
          break;
        } catch {
          // If write fails, try next candidate (maybe different season path or name).
          continue;
        }
      }

      if (wroteOneForThisVideo) {
        // Ensure only one new srt per video per call.
        continue;
      }
    }
  }

  // Any requested season/episode with no matching video file should be reported.
  for (const [key, entries] of byKey.entries()) {
    if (foundKeys.has(key)) continue;
    for (const entry of entries) {
      if (entry?._missingSeasonDir) continue; // already reported a more specific failure
      addFailure(entry, 'match', undefined, { key }, 'No matching video file');
    }
  }

  resolve([id, { ok: true, applied: Array.from(appliedSet), failures }]);
};

const deletePath = async (id, path, resolve, _reject) => {
  // console.log('deletePath', id, path);
  try {
    await rimraf(path);
  }
  catch(e) {
    console.log('error removing path:', path, e.message)
    resolve([id, e.message]);
    return
  }
  resolve([id, 'ok']);
};

const sendEmailHandler = async (id, bodyText, resolve, reject) => {
  console.log('sendEmailHandler', id, bodyText);
  try {
    await email.sendEmail(bodyText);
    resolve([id, 'ok']);
  } catch (error) {
    reject([id, error.message]);
  }
};

//////////////////  CALL FUNCTION SYNCHRONOUSLY  //////////////////

const queue = [];
let running = false;

const runOne = () => {
  if(running || queue.length == 0) return;
  running = true;

  const {ws, id, fname, param} = queue.pop();
  if(ws.readyState !== WebSocket.OPEN) return;

  let resolve = null;
  let reject  = null;

  // param called when promise is resolved or rejected
  // there is one unique promise for each function call
  const promise = new Promise((resolveIn, rejectIn) => {
    resolve = resolveIn; 
    reject  = rejectIn;
  });

  promise
  .then((idResult) => {
    const [id, result] = idResult;
    // console.log('resolved:', id);
    ws.send(`${id}~~~ok~~~${JSON.stringify(result)}`); 
    running = false;
    runOne();
  })
  .catch((idError) => {
    console.error('idResult err:', {idError});
    const [id, error] = idError;
    ws.send(`${id}~~~err~~~${JSON.stringify(error)}`); 
    running = false;
    runOne();
  });

  // call function fname
  switch (fname) {
    case 'getShowsFromDisk':   getShowsFromDisk(       id,    '', resolve, reject); break;
    case 'deletePath':    deletePath(        id, param, resolve, reject); break;

    case 'getDevices':    emby.getDevices(   id,    '', resolve, reject); break;
    case 'getLastViewed': view.getLastViewed(id,    '', resolve, reject); break;

    case 'getRejects':  getRejects(id, '',    resolve, reject); break;
    case 'addReject':   addReject( id, param, resolve, reject); break;
    case 'delReject':   delReject( id, param, resolve, reject); break;

    case 'getPickups':  getPickups(id, '',    resolve, reject); break;
    case 'addPickup':   addPickup( id, param, resolve, reject); break;
    case 'delPickup':   delPickup( id, param, resolve, reject); break;

    case 'getNoEmbys':  getNoEmbys(id, '',    resolve, reject); break;
    case 'addNoEmby':   addNoEmby( id, param, resolve, reject); break;
    case 'delNoEmby':   delNoEmby( id, param, resolve, reject); break;
    
    case 'getGaps':     getGaps(   id, '',    resolve, reject); break;
    case 'addGap':      addGap(    id, param, resolve, reject); break;
    case 'delGap':      delGap(    id, param, resolve, reject); break;

    case 'delSeasonFiles': delSeasonFiles(id, param, resolve, reject); break;
    
    case 'getAllTvdb':    tvdb.getAllTvdb(   id, param, resolve, reject); break;
    case 'getNewTvdb':    tvdb.getNewTvdb(   id, param, resolve, reject); break;
    case 'setTvdbFields': tvdb.setTvdbFields(id, param, resolve, reject); break;
    case 'getRemotes':    tvdb.getRemotesCmd(id, param, resolve, reject); break;
    case 'getActorPage':  tvdb.getActorPage( id, param, resolve, reject); break;
    case 'sendEmail':     sendEmailHandler(  id, param, resolve, reject); break;
    
    case 'getTmdb':       tmdb.getTmdb(      id, param, resolve, reject); break;

    case 'setSharedFilters': setSharedFilters(id, param, resolve, reject); break;
    case 'getSharedFilters': getSharedFilters(id, param, resolve, reject); break;

    case 'getNote':  getNote( id, param, resolve, reject); break;
    case 'saveNote': saveNote(id, param, resolve, reject); break;
    case 'getAllNotes': getAllNotes(id, param, resolve, reject); break;

    case 'getFile': getFile(id, param, resolve, reject); break;

    case 'subsSearch': subsSearch(id, param, resolve, reject); break;

    case 'applySubFiles': applySubFiles(id, param, resolve, reject); break;

    case 'deleteSubFiles': deleteSubFiles(id, param, resolve, reject); break;

    case 'getSubFileIds': getSubFileIds(id, param, resolve, reject); break;

    case 'offsetSubFiles': offsetSubFiles(id, param, resolve, reject); break;

    case 'createShowFolder': createShowFolder(id, param, resolve, reject); break;

    default: reject([id, 'unknownfunction: ' + fname]);
  };
}

//////////////////  WEBSOCKET SERVER  //////////////////

const wss = new WebSocketServer({ port: 8736 });
console.log('wss listening on port 8736');

const appSocketName = 'web app websocket';

wss.on('connection', (ws) => {
  let socketName = 'unknown websocket';

  ws.on('message', (data) => {
    const msg = data.toString();
    const firstSep = msg.indexOf('~~~');
    const secondSep = firstSep >= 0 ? msg.indexOf('~~~', firstSep + 3) : -1;
    if(firstSep < 0 || secondSep < 0) {
      console.error('ignoring bad message:', msg);
      return;
    }
    const id = msg.slice(0, firstSep);
    const fname = msg.slice(firstSep + 3, secondSep);
    const param = msg.slice(secondSep + 3);
    if(socketName != appSocketName) {
      socketName = appSocketName;
      console.log(socketName + ' connected');
    }
    if(fname == 'getNewTvdb') {
      tvdb.getNewTvdb(ws, id, param) 
    }
    else {
      queue.unshift({ws, id, fname, param});
      runOne();
    }
  });

  ws.on('error', (err) => {
    console.error(socketName, 'error:', err.message);
    socketName = 'unknown websocket';
  });

  ws.on('close', () => {
    // log(socketName + ' closed');
    socketName = 'unknown websocket';
  });
});
