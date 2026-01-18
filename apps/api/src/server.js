import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import parseTorrent from 'parse-torrent';
import * as search from './search.js';
import * as download from './download.js';
import { tvdbProxyGet } from './tvdb-proxy.js';
import { getQbtInfo, delQbtTorrent, spaceAvail, flexgetHistory, addQbtTorrent } from './usb.js';
import { startReel, getReel } from './reelgood.js';
import { checkFiles as tvProcCheckFiles } from './tv-proc.js';
import {
  getApiCookiesDir,
  getApiMiscDir,
  getSecretsDir,
  preferSharedReadPath,
} from './tvPaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatPstTimestamp(date = new Date()) {
  // Match the reelgood logger behavior: approximate PST/PDT using month.
  const now = date instanceof Date ? date : new Date();
  const month = now.getUTCMonth();
  const isDST = month >= 2 && month <= 10; // Approximate DST period (Mar-Nov)
  const offsetHours = isDST ? -7 : -8;
  const pstTime = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);

  const mm = String(pstTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(pstTime.getUTCDate()).padStart(2, '0');
  const hh = String(pstTime.getUTCHours()).padStart(2, '0');
  const min = String(pstTime.getUTCMinutes()).padStart(2, '0');
  const ss = String(pstTime.getUTCSeconds()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}:${ss}`;
}

function appendCallsLog({ endpoint, method, ok, result, error }) {
  try {
    const outPath = path.join(getApiMiscDir(), 'calls.log');
    const asArray = Array.isArray(result)
      ? result.map(String)
      : (result && typeof result === 'object' && Array.isArray(result.existingTitles))
        ? result.existingTitles.map(String)
        : [];
    const last5 = asArray.length > 5 ? asArray.slice(-5) : asArray;
    const payload = {
      ts: formatPstTimestamp(new Date()),
      endpoint,
      method,
      ok: Boolean(ok),
      last5,
      count: Array.isArray(result) ? result.length : null,
      error: error ? { message: error?.message || String(error), stack: error?.stack || null } : null,
    };
    const txt = `==========\n${JSON.stringify(payload, null, 2)}\n`;
    fs.appendFileSync(outPath, txt, 'utf8');
  } catch {
    // ignore logging failures
  }
}

function appendDownloadsRequestLog(reqBody) {
  try {
    const outPath = path.join(getApiMiscDir(), 'temp.txt');
    const body = reqBody && typeof reqBody === 'object' ? reqBody : {};

    const hasTl = body.tl != null;
    const tlBody = hasTl ? body.tl : null;
    const torrent = hasTl
      ? (tlBody && typeof tlBody === 'object' && 'torrent' in tlBody ? tlBody.torrent : tlBody)
      : body.torrent;

    const torrentObj = torrent && typeof torrent === 'object' ? torrent : null;
    const raw = torrentObj && typeof torrentObj.raw === 'object' ? torrentObj.raw : null;

    const safeStr = (v, max = 240) => {
      const s = v == null ? '' : String(v);
      if (s.length <= max) return s;
      return s.slice(0, max) + `…(+${s.length - max})`;
    };

    const payload = {
      ts: new Date().toISOString(),
      endpoint: '/downloads',
      hasTl,
      forceDownload: body.forceDownload === true,
      topKeys: Object.keys(body || {}).slice(0, 50),
      tlKeys: tlBody && typeof tlBody === 'object' ? Object.keys(tlBody).slice(0, 50) : null,
      torrentKeys: torrentObj ? Object.keys(torrentObj).slice(0, 50) : null,
      torrent: torrentObj
        ? {
            provider: torrentObj?.provider || raw?.provider || undefined,
            rawYear: raw?.year ?? undefined,
            id: raw?.id ?? torrentObj?.id ?? undefined,
            fid: raw?.fid ?? undefined,
            title: safeStr(raw?.title ?? torrentObj?.title ?? torrentObj?.clientTitle ?? ''),
            filename: safeStr(raw?.filename ?? ''),
            detailUrl: safeStr(torrentObj?.detailUrl ?? ''),
            rawKeys: raw ? Object.keys(raw).slice(0, 50) : null,
          }
        : null,
    };

    fs.appendFileSync(outPath, JSON.stringify(payload) + '\n', 'utf8');
  } catch {
    // ignore logging failures
  }
}

function tvEntryHasError(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!('error' in entry)) return false;
  const v = entry.error;
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim();
    return Boolean(s) && s !== '0';
  }
  return v !== 0 && v !== false;
}

function tvEntriesErrorTitles(tvEntries) {
  const list = Array.isArray(tvEntries) ? tvEntries : [];
  return list.filter(tvEntryHasError);
}

function extractYearFromString(s) {
  const text = String(s || '');
  const m = text.match(/\b(19\d{2}|20\d{2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n < 1950 || n > 2050) return null;
  return n;
}

console.error('[torrents-server] module loaded', {
  ts: new Date().toISOString(),
  cwd: process.cwd(),
  node: process.version,
});

function readRequiredFile(filePath, label) {
  try {
    return fs.readFileSync(filePath);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Missing required ${label} at ${filePath}. (${msg})`);
  }
}

const app = express();

const QBT_TEST_PORT   = 3001;
const DUMP_INFO       = false;
const FILTER_TORRENTS = false;
// const FILTER_TORRENTS = {hash:   "629746091b23ec0617405e8cc6f1eee486447629"};
// const FILTER_TORRENTS = {filter: 'downloading'}

// Load SSL certificate (prefer shared cookie store)
const httpsOptions = {
  key: readRequiredFile(path.join(getApiCookiesDir(), 'localhost-key.pem'), 'TLS key (localhost-key.pem)'),
  cert: readRequiredFile(path.join(getApiCookiesDir(), 'localhost-cert.pem'), 'TLS cert (localhost-cert.pem)'),
};

// CORS notes:
// - Public browser traffic hits this service through nginx.
// - nginx already injects CORS headers on that path.
// - If we *also* set them here, nginx may forward a second header and some
//   clients will observe a combined value like "*, *" (invalid), which breaks
//   browser CORS.
//
// So: only emit CORS headers for direct (non-proxied) browser requests.
app.use((req, res, next) => {
  const hasOrigin = typeof req.headers.origin === 'string' && req.headers.origin.length > 0;
  const disableInternalCors = process.env.DISABLE_INTERNAL_CORS === '1';
  const behindProxy = Boolean(
    req.headers['x-forwarded-host'] ||
    req.headers['x-forwarded-proto'] ||
    req.headers['x-forwarded-for']
  );

  if (hasOrigin && !behindProxy && !disableInternalCors) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    const reqHeaders = req.headers['access-control-request-headers'];
    res.setHeader(
      'Access-Control-Allow-Headers',
      typeof reqHeaders === 'string' && reqHeaders.trim()
        ? reqHeaders
        : 'Content-Type, Authorization'
    );
  }

  if (req.method === 'OPTIONS' && hasOrigin) {
    // Preflight: return no-content. If proxied, nginx will attach CORS headers.
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json());

const OPENSUBTITLES_BASE_URL = 'https://api.opensubtitles.com/api/v1';

function getRootSecretsDir() {
  // Checkout-independent shared secrets directory (created if missing).
  return getSecretsDir();
}

function getSubsLoginPath() {
  return path.join(getRootSecretsDir(), 'subs-login.txt');
}

function getSubsTokenReadPath() {
  return path.join(getRootSecretsDir(), 'subs-token.txt');
}

function getSubsTokenWritePath() {
  return path.join(getRootSecretsDir(), 'subs-token.txt');
}

async function readTextIfExists(filePath) {
  try {
    const txt = await fs.promises.readFile(filePath, 'utf8');
    return String(txt || '').trim();
  } catch {
    return '';
  }
}

async function readJsonIfExists(filePath) {
  try {
    const txt = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function writeTextFile(filePath, text) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, String(text || '') + '\n', 'utf8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function osFetchJson(url, { apiKey, token, method = 'GET', jsonBody } = {}) {
  const headers = {
    Accept: 'application/json',
    // Some edge/CDN configurations behave better when a UA is present.
    'User-Agent': 'tv-series-client/1.0 (torrents-proxy)',
    'X-User-Agent': 'tv-series-client/1.0 (torrents-proxy)',
  };
  if (apiKey) headers['Api-Key'] = apiKey;
  if (token) headers.Authorization = `Bearer ${token}`;

  let body;
  if (jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(jsonBody);
  }

  const resp = await fetch(url, { method, headers, body });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    data,
    text,
  };
}

async function osLoginAndPersistToken() {
  const loginPath = getSubsLoginPath();
  const login = await readJsonIfExists(loginPath);
  const apiKey = String(login?.apiKey || '').trim();
  const username = String(login?.username || '').trim();
  const password = String(login?.password || '').trim();
  if (!apiKey || !username || !password) {
    throw new Error(`Missing apiKey/username/password in ${loginPath}`);
  }

  const resp = await osFetchJson(`${OPENSUBTITLES_BASE_URL}/login`, {
    apiKey,
    method: 'POST',
    jsonBody: { username, password },
  });

  if (!resp.ok) {
    const detail = resp.data ? JSON.stringify(resp.data) : resp.text;
    throw new Error(`OpenSubtitles login failed: HTTP ${resp.status} ${resp.statusText} ${detail}`);
  }

  const token = String(resp.data?.token || '').trim();
  if (!token) {
    throw new Error('OpenSubtitles login response missing token');
  }
  await writeTextFile(getSubsTokenWritePath(), token);
  return { apiKey, token };
}

function normalizeImdbIdToDigits(imdbId) {
  const raw = String(imdbId || '').trim();
  if (!raw) return '';
  const s = raw.toLowerCase().startsWith('tt') ? raw.slice(2) : raw;
  const digits = s.replace(/\D/g, '');
  return digits;
}

async function loadLocalCfClearance(provider) {
  try {
    const p = String(provider || '').trim();
    if (!p) return '';
    const inPath = path.join(getApiCookiesDir(), 'cf-clearance.local.json');
    const raw = await fs.promises.readFile(inPath, 'utf8');
    const j = JSON.parse(raw);
    const v = j && typeof j === 'object' && !Array.isArray(j) ? j[p] : '';
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

// POST /api/cf_clearance - Persist provider cf_clearance values for local tooling
// Body: { ipt_cf?: string, tl_cf?: string }
app.post('/api/cf_clearance', async (req, res) => {
  try {
    const body = req.body || {};
    const ipt = typeof body.ipt_cf === 'string' ? body.ipt_cf.trim() : '';
    const tl = typeof body.tl_cf === 'string' ? body.tl_cf.trim() : '';

    const outPath = path.join(getApiCookiesDir(), 'cf-clearance.local.json');
    let current = {};
    try {
      const raw = await fs.promises.readFile(outPath, 'utf8');
      const j = JSON.parse(raw);
      if (j && typeof j === 'object' && !Array.isArray(j)) current = j;
    } catch {
      // ignore
    }

    if (ipt) current.iptorrents = ipt;
    if (tl) current.torrentleech = tl;

    await fs.promises.writeFile(outPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
    console.error('[cf_clearance] saved', {
      path: outPath,
      keys: Object.keys(current),
      iptLen: current.iptorrents ? String(current.iptorrents).length : 0,
      tlLen: current.torrentleech ? String(current.torrentleech).length : 0,
    });

    res.json({ ok: true, path: outPath, keys: Object.keys(current) });
  } catch (error) {
    console.error('[cf_clearance] error', error);
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

async function flexget() {
  return flexgetHistory();
}

// Initialize torrent search providers
search.initializeProviders();

if (FILTER_TORRENTS && typeof FILTER_TORRENTS === 'object' && !Array.isArray(FILTER_TORRENTS)) {
  (async () => {
    try {
      const info = await getQbtInfo(FILTER_TORRENTS);
      const outPath = path.resolve(__dirname, '..', '..', 'samples','sample-qbt', 'qbt-info.json');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(info, null, 2), 'utf8');
      console.log(`qbt startup dump wrote ${Array.isArray(info) ? info.length : 0} torrents -> ${outPath}`);
    } catch (e) {
      console.error('qbt startup dump error:', e);
    }
  })();
}

// API endpoint
app.get('/api/tvdb/*', tvdbProxyGet);

app.post('/api/tvproc/startProc', async (req, res) => {
  const jsonPath = getTvprocJsonPath();
  try {
    await fs.promises.writeFile(jsonPath, '[]\n', 'utf8');
    res.json({ ok: true, path: jsonPath, cleared: true });
  } catch (error) {
    const code = error?.code;
    if (code === 'ENOENT') {
      res.json({ ok: true, path: jsonPath, cleared: true });
      return;
    }
    console.error('tvproc clear error:', error);
    res.status(500).json({ error: error?.message || String(error), path: jsonPath });
  }
});

app.get('/api/tvproc/startProc', async (req, res) => {
  try {
    const title = req.query.title;
    if (!title) {
      return res.status(400).json({ error: 'title parameter required' });
    }
    const url = `https://hahnca.com/tvproc/startProc?title=${encodeURIComponent(title)}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('startProc proxy error:', error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.get('/api/qbt/info', async (req, res) => {
  try {
    const q = req.query || {};
    const filterObj = {};
    if (typeof q.hash === 'string' && q.hash) filterObj.hash = q.hash;
    if (typeof q.category === 'string' && q.category) filterObj.category = q.category;
    if (typeof q.tag === 'string' && q.tag) filterObj.tag = q.tag;
    if (typeof q.filter === 'string' && q.filter) filterObj.filter = q.filter;

    const useFilter = Object.keys(filterObj).length > 0 ? filterObj : undefined;
    const info = await getQbtInfo(useFilter);

    if (DUMP_INFO) {
      try {
        const outPath = path.resolve(__dirname, '..', '..', 'samples', 'sample-qbt', 'qbt-info.json');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(info, null, 2), 'utf8');
      } catch (e) {
        console.error('qbt info dump error:', e);
      }
    }

    res.json(info);
  } catch (error) {
    console.error('qbt info error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Client helper: delTorrent(<hash>)
// Deletes torrent in qBittorrent, including files by default.
app.post('/api/qbt/delTorrent', async (req, res) => {
  try {
    const q = req.query || {};
    const b = req.body || {};

    const hash = (typeof b.hash === 'string' && b.hash)
      ? b.hash
      : (typeof q.hash === 'string' && q.hash) ? q.hash : '';

    if (!hash) {
      res.status(400).json({ error: 'hash required' });
      return;
    }

    const deleteFiles = (typeof b.deleteFiles === 'boolean') ? b.deleteFiles : true;
    const result = await delQbtTorrent({ hash, deleteFiles });
    res.json(result);
  } catch (error) {
    console.error('qbt delTorrent error:', error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.get('/api/space/avail', async (req, res) => {
  try {
    const info = await spaceAvail();
    res.json(info);
  } catch (error) {
    console.error('spaceAvail error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/flexget', async (req, res) => {
  try {
    const txt = await flexget();
    res.type('text/plain').send(txt);
  } catch (error) {
    console.error('flexget error:', error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.get('/api/search', async (req, res) => {
  const showName = req.query.show;
  const limit = parseInt(req.query.limit) || 100;
  const iptCfRaw = req.query.ipt_cf;
  const tlCfRaw = req.query.tl_cf;
  let needed = [];
  
  // Parse needed array if provided
  if (req.query.needed) {
    try {
      needed = JSON.parse(req.query.needed);
    } catch (err) {
      console.error('Error parsing needed array:', err);
    }
  }
  
  if (!showName) {
    return res.status(400).json({ error: 'Show name is required' });
  }

  try {
    // If the client doesn't pass cf_clearance values, fall back to the local persisted file.
    // This allows the UI to avoid localStorage for cookies.
    const iptCf = (typeof iptCfRaw === 'string' && iptCfRaw.trim()) ? iptCfRaw.trim() : await loadLocalCfClearance('iptorrents');
    const tlCf = (typeof tlCfRaw === 'string' && tlCfRaw.trim()) ? tlCfRaw.trim() : await loadLocalCfClearance('torrentleech');
    const result = await search.searchTorrents({ showName, limit, iptCf, tlCf, needed });
    res.json(result);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/subs/search?imdb_id=1234567&page=1
// GET /api/subs/search?q=tt0083399&page=1
// GET /api/subs/search?q=osdb:18563&page=1
// - Reads secrets/subs-login.txt (JSON: {apiKey, username, password})
// - Uses secrets/subs-token.txt (token string)
// - If not logged in, auto-logins and retries once
app.get('/api/subs/search', async (req, res) => {
  try {
    const qRaw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const imdbIdDigits = normalizeImdbIdToDigits(req.query.imdb_id);
    if (!qRaw && !imdbIdDigits) {
      return res.status(400).json({ error: 'imdb_id or q query parameter required' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const loginPath = getSubsLoginPath();
    const login = await readJsonIfExists(loginPath);
    const apiKey = String(login?.apiKey || '').trim();
    if (!apiKey) {
      return res.status(500).json({ error: `Missing apiKey in ${loginPath}` });
    }

    let token = await readTextIfExists(getSubsTokenReadPath());

    const url = new URL(`${OPENSUBTITLES_BASE_URL}/subtitles`);
    if (qRaw) {
      url.searchParams.set('query', qRaw);
    } else {
      // For TV shows, OpenSubtitles stores most episode subtitles under the *parent* (series) imdb id.
      // Using imdb_id here often returns only a tiny subset.
      url.searchParams.set('parent_imdb_id', imdbIdDigits);
    }
    url.searchParams.set('page', String(page));

    // Hint to reduce payload; client still filters.
    url.searchParams.set('languages', 'en');

    const transientStatuses = new Set([429, 500, 502, 503, 504, 520, 522, 524]);

    const fetchWithRetry = async () => {
      let last = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        last = await osFetchJson(url.toString(), { apiKey, token });
        if (last.ok) return last;
        if (!transientStatuses.has(last.status)) return last;
        await sleep(300 * (attempt + 1) * (attempt + 1));
      }
      return last;
    };

    let resp = await fetchWithRetry();

    // OpenSubtitles auth errors are typically 401/403.
    if (!resp.ok && (resp.status === 401 || resp.status === 403)) {
      const fresh = await osLoginAndPersistToken();
      token = fresh.token;
      resp = await fetchWithRetry();
    }

    if (!resp.ok) {
      let detail = resp.data || resp.text;
      if (typeof detail === 'string') {
        const s = detail.trim();
        if (s.toLowerCase().includes('<!doctype html') || s.toLowerCase().includes('<html')) {
          detail = s.slice(0, 1200);
        }
      }
      res.status(resp.status || 500).json({
        error: `OpenSubtitles subtitles request failed: HTTP ${resp.status} ${resp.statusText}`,
        detail,
      });
      return;
    }

    res.json(resp.data);
  } catch (error) {
    console.error('[subs] search error:', error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

async function handleDownloadRequest(req, res) {
  try {
    const body = req.body || {};
    const hasTl = body.tl != null;
    const tlBody = hasTl ? body.tl : null;
    const torrent = hasTl
      ? (tlBody && typeof tlBody === 'object' && 'torrent' in tlBody ? tlBody.torrent : tlBody)
      : body.torrent;
    const forceDownload = body.forceDownload === true;
    // Temporary: hardwire debug on so we always return/emit extra diagnostics.
    const debug = true;

    appendDownloadsRequestLog(body);

    if (debug) {
      console.error('[downloads] request', {
        forceDownload,
        provider: torrent?.provider || torrent?.raw?.provider || undefined,
        id: torrent?.raw?.id || torrent?.id || undefined,
        title: torrent?.raw?.title || torrent?.title || undefined,
      });
    }

    // Standard wrapper shape returned to the client.
    const baseWrapper = { existingTitles: [], existingProcids: [], tvEntries: [], errorTitles: [] };

    if (!torrent) {
      res.status(400).json({ ...baseWrapper, success: false, stage: 'validate', error: 'Torrent data is required' });
      return;
    }

    // Default behavior: consult tv-proc before uploading.
    if (!forceDownload) {
      const fetched = await download.fetchTorrentFile(torrent);
      if (!fetched || typeof fetched !== 'object') {
        res.json({ ...baseWrapper, success: false, stage: 'fetch-torrent', error: 'Unexpected fetchTorrentFile result' });
        return;
      }
      if (!fetched.success) {
        res.json({ ...baseWrapper, ...fetched });
        return;
      }

      const valid = download.validateTorrentBytes(fetched.torrentData);
      if (!valid.success) {
        res.json({ ...baseWrapper, ...valid });
        return;
      }

      // Guardrail: if the request implies a specific year, and the torrent's internal name
      // includes a conflicting year, refuse to upload (prevents "wrong show" mismatches).
      try {
        const expectedYear =
          (Number.isFinite(Number(torrent?.raw?.year)) ? Number(torrent?.raw?.year) : null) ||
          extractYearFromString(torrent?.raw?.title || torrent?.title || torrent?.clientTitle);

        if (expectedYear && expectedYear >= 1950 && expectedYear <= 2050) {
          const parsed = parseTorrent(fetched.torrentData);
          const parsedName = String(parsed?.name || '').trim();
          const actualYear = extractYearFromString(parsedName);
          if (actualYear && actualYear !== expectedYear) {
            const requestedTitle = String(torrent?.raw?.title || torrent?.title || torrent?.clientTitle || '').trim();
            res.json({
              ...baseWrapper,
              success: false,
              stage: 'validate-torrent-metadata',
              error: `Torrent year mismatch (requested ${expectedYear}, torrent says ${actualYear})`,
              yearError: `${actualYear}|${expectedYear}|${requestedTitle}`,
              expectedYear,
              actualYear,
              torrentName: parsedName || undefined,
              downloadUrl: fetched?.downloadUrl || undefined,
              provider: fetched?.provider || undefined,
            });
            return;
          }
        }
      } catch {
        // ignore metadata validation failures
      }

      let titles = [];
      try {
        titles = download.extractTorrentFileTitles(fetched.torrentData);
      } catch (e) {
        res.json({ ...baseWrapper, success: false, stage: 'parse-torrent', error: e?.message || String(e) });
        return;
      }

      let tvProcResult = baseWrapper;
      try {
        appendCallsLog({ endpoint: 'tv-proc:/checkFiles request', method: 'POST', ok: true, result: titles });
        tvProcResult = await tvProcCheckFiles(titles);
        appendCallsLog({ endpoint: 'tv-proc:/checkFiles response', method: 'POST', ok: true, result: tvProcResult });
      } catch (e) {
        appendCallsLog({ endpoint: 'tv-proc:/checkFiles', method: 'POST', ok: false, result: null, error: e });
        res.json({ ...baseWrapper, success: false, stage: 'tv-proc', error: e?.message || String(e) });
        return;
      }

      // If any file titles are already present, do NOT send to qBittorrent.
      const existingTitles = Array.isArray(tvProcResult?.existingTitles) ? tvProcResult.existingTitles : [];
      const errorTitles = tvEntriesErrorTitles(tvProcResult?.tvEntries);
      if (existingTitles.length > 0 || errorTitles.length > 0) {
        res.json(errorTitles.length > 0 ? { ...tvProcResult, errorTitles } : tvProcResult);
        return;
      }

      const hint = torrent?.raw?.filename || torrent?.raw?.title || 'download.torrent';
      let addRes;
      const addTag = `tapi_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      try {
        addRes = await addQbtTorrent({ torrentData: fetched.torrentData, filename: hint, tags: addTag });
      } catch (e) {
        if (debug) console.error('[downloads] qbt add threw', { addTag, error: e?.message || String(e) });
        res.json({ ...tvProcResult, success: false, stage: 'qbt-add', error: e?.message || String(e) });
        return;
      }

      if (debug) console.error('[downloads] qbt add response', { addTag, ok: addRes.ok, status: addRes.status, text: addRes.text });

      if (!addRes.ok) {
        // qB sometimes returns "Fails." but still adds the torrent. If we can find a torrent
        // with the unique tag we used for this request, treat it as success.
        try {
          const tagged = await getQbtInfo({ tag: addTag });
          const list = Array.isArray(tagged) ? tagged : [];
          if (list.length > 0) {
            if (debug) console.error('[downloads] qbt add disambiguated as success via tag', { addTag, count: list.length });
            if (debug) {
              res.json({ ...tvProcResult, success: true, stage: 'qbt-add', qbAdd: addRes, qbtTag: addTag });
              return;
            }
            res.json(tvProcResult);
            return;
          }
        } catch {
          // ignore
        }

        // qB uses 200 OK with body "Fails." for duplicates and other add failures.
        // Disambiguate by checking whether the torrent exists after the add attempt.
        let infoHash = '';
        try {
          const parsed = parseTorrent(fetched.torrentData);
          infoHash = String(parsed?.infoHash || '').trim().toLowerCase();
        } catch {
          // ignore
        }

        if (infoHash) {
          try {
            const qbtInfo = await getQbtInfo({ hash: infoHash });
            const list = Array.isArray(qbtInfo) ? qbtInfo : [];
            if (list.length > 0) {
              const existing = list[0] || {};
              const existingName = String(existing?.name || '').trim();
              const fallbackTitle = String(torrent?.raw?.title || torrent?.title || torrent?.clientTitle || '').trim();
              const title = existingName || fallbackTitle || infoHash;
              if (debug) console.error('[downloads] qbt add disambiguated as duplicate via hash', { addTag, infoHash, title });
              res.json({
                ...tvProcResult,
                success: false,
                stage: 'qbt',
                error: `QbitTorrent already has torrent ${title}`,
                hash: infoHash,
                qbt: {
                  name: existingName || undefined,
                  state: existing?.state || undefined,
                  progress: typeof existing?.progress === 'number' ? existing.progress : undefined,
                },
              });
              return;
            }
          } catch {
            // ignore
          }
        }

        res.json({ ...tvProcResult, success: false, stage: 'qbt-add', error: `qBittorrent add failed: ${addRes.text || 'Fails.'}`, qbAdd: addRes });
        return;
      }

      // In this mode, always return the tv-proc wrapper unchanged.
      if (debug) {
        console.error('[downloads] qbt add success', { addTag });
        res.json({ ...tvProcResult, success: true, stage: 'qbt-add', qbAdd: addRes, qbtTag: addTag });
        return;
      }
      res.json(tvProcResult);
      return;
    }

    // Force mode: still run tv-proc; skip only the qBittorrent hash pre-check.
    const fetched = await download.fetchTorrentFile(torrent);
    if (!fetched || typeof fetched !== 'object') {
      res.json({ ...baseWrapper, success: false, stage: 'fetch-torrent', error: 'Unexpected fetchTorrentFile result' });
      return;
    }
    if (!fetched.success) {
      res.json({ ...baseWrapper, ...fetched });
      return;
    }

    const valid = download.validateTorrentBytes(fetched.torrentData);
    if (!valid.success) {
      res.json({ ...baseWrapper, ...valid });
      return;
    }

    // Same guardrail in force mode.
    try {
      const expectedYear =
        (Number.isFinite(Number(torrent?.raw?.year)) ? Number(torrent?.raw?.year) : null) ||
        extractYearFromString(torrent?.raw?.title || torrent?.title || torrent?.clientTitle);

      if (expectedYear && expectedYear >= 1950 && expectedYear <= 2050) {
        const parsed = parseTorrent(fetched.torrentData);
        const parsedName = String(parsed?.name || '').trim();
        const actualYear = extractYearFromString(parsedName);
        if (actualYear && actualYear !== expectedYear) {
          const requestedTitle = String(torrent?.raw?.title || torrent?.title || torrent?.clientTitle || '').trim();
          res.json({
            ...baseWrapper,
            success: false,
            stage: 'validate-torrent-metadata',
            error: `Torrent year mismatch (requested ${expectedYear}, torrent says ${actualYear})`,
            yearError: `${actualYear}|${expectedYear}|${requestedTitle}`,
            expectedYear,
            actualYear,
            torrentName: parsedName || undefined,
            downloadUrl: fetched?.downloadUrl || undefined,
            provider: fetched?.provider || undefined,
            debug,
          });
          return;
        }
      }
    } catch {
      // ignore metadata validation failures
    }

    let titles = [];
    try {
      titles = download.extractTorrentFileTitles(fetched.torrentData);
    } catch (e) {
      res.json({ ...baseWrapper, success: false, stage: 'parse-torrent', error: e?.message || String(e) });
      return;
    }

    let tvProcResult = baseWrapper;
    try {
      appendCallsLog({ endpoint: 'tv-proc:/checkFiles request', method: 'POST', ok: true, result: titles });
      tvProcResult = await tvProcCheckFiles(titles);
      appendCallsLog({ endpoint: 'tv-proc:/checkFiles response', method: 'POST', ok: true, result: tvProcResult });
    } catch (e) {
      appendCallsLog({ endpoint: 'tv-proc:/checkFiles', method: 'POST', ok: false, result: null, error: e });
      // Don't upload if tv-proc fails.
      res.json({ ...baseWrapper, success: false, stage: 'tv-proc', error: e?.message || String(e) });
      return;
    }

    // If any file titles are already present, do NOT send to qBittorrent.
    const existingTitles = Array.isArray(tvProcResult?.existingTitles) ? tvProcResult.existingTitles : [];
    const errorTitles = tvEntriesErrorTitles(tvProcResult?.tvEntries);
    if (existingTitles.length > 0 || errorTitles.length > 0) {
      res.json(errorTitles.length > 0 ? { ...tvProcResult, errorTitles } : tvProcResult);
      return;
    }

    const hint = torrent?.raw?.filename || torrent?.raw?.title || 'download.torrent';
    let addRes;
    const addTag = `tapi_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
      addRes = await addQbtTorrent({ torrentData: fetched.torrentData, filename: hint, tags: addTag });
    } catch (e) {
      if (debug) console.error('[downloads] qbt add threw (force)', { addTag, error: e?.message || String(e) });
      res.json({ ...tvProcResult, success: false, stage: 'qbt-add', error: e?.message || String(e) });
      return;
    }

    if (debug) console.error('[downloads] qbt add response (force)', { addTag, ok: addRes.ok, status: addRes.status, text: addRes.text });

    if (!addRes.ok) {
      // Same as non-force mode: if the torrent shows up with our unique tag, the add succeeded.
      try {
        const tagged = await getQbtInfo({ tag: addTag });
        const list = Array.isArray(tagged) ? tagged : [];
        if (list.length > 0) {
          if (debug) console.error('[downloads] qbt add disambiguated as success via tag (force)', { addTag, count: list.length });
          let infoHash = '';
          try {
            const parsed = parseTorrent(fetched.torrentData);
            infoHash = String(parsed?.infoHash || '').trim().toLowerCase();
          } catch {
            // ignore
          }

          res.json({
            ...tvProcResult,
            success: true,
            provider: fetched.provider,
            method: fetched.method,
            downloadUrl: fetched.downloadUrl,
            qbAdd: addRes,
            bytes: fetched.bytes,
            hash: infoHash || undefined,
            qbtTag: addTag,
            debug,
          });
          return;
        }
      } catch {
        // ignore
      }

      let infoHash = '';
      try {
        const parsed = parseTorrent(fetched.torrentData);
        infoHash = String(parsed?.infoHash || '').trim().toLowerCase();
      } catch {
        // ignore
      }

      if (infoHash) {
        try {
          const qbtInfo = await getQbtInfo({ hash: infoHash });
          const list = Array.isArray(qbtInfo) ? qbtInfo : [];
          if (list.length > 0) {
            const existing = list[0] || {};
            const existingName = String(existing?.name || '').trim();
            const fallbackTitle = String(torrent?.raw?.title || torrent?.title || torrent?.clientTitle || '').trim();
            const title = existingName || fallbackTitle || infoHash;
            res.json({
              ...tvProcResult,
              success: false,
              stage: 'qbt',
              error: `QbitTorrent already has torrent ${title}`,
              hash: infoHash,
              qbt: {
                name: existingName || undefined,
                state: existing?.state || undefined,
                progress: typeof existing?.progress === 'number' ? existing.progress : undefined,
              },
            });
            return;
          }
        } catch {
          // ignore
        }
      }

      res.json({ ...tvProcResult, success: false, stage: 'qbt-add', error: `qBittorrent add failed: ${addRes.text || 'Fails.'}`,
        qbAdd: addRes,
      });
      return;
    }

    let infoHash = '';
    try {
      const parsed = parseTorrent(fetched.torrentData);
      infoHash = String(parsed?.infoHash || '').trim().toLowerCase();
    } catch {
      // ignore
    }

    res.json({
      ...tvProcResult,
      success: true,
      provider: fetched.provider,
      method: fetched.method,
      downloadUrl: fetched.downloadUrl,
      qbAdd: addRes,
      bytes: fetched.bytes,
      hash: infoHash || undefined,
      debug,
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ existingTitles: [], existingProcids: [], success: false, stage: 'exception', error: error?.message || String(error) });
  }
}

// POST /api/download - Download a torrent file
app.post('/api/download', handleDownloadRequest);

// Back-compat alias for older clients/nginx rewrites.
app.post('/downloads', handleDownloadRequest);

app.get('/api/startreel', async (req, res) => {
  try {
    const q = req.query || {};
    let showTitles = [];
    if (typeof q.showTitles === 'string' && q.showTitles) {
      try {
        const parsed = JSON.parse(q.showTitles);
        if (Array.isArray(parsed)) showTitles = parsed;
      } catch {
        showTitles = q.showTitles.split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    const reset = (String(q.reset || '').trim().toLowerCase() === '1') || (String(q.reset || '').trim().toLowerCase() === 'true');
    const result = await startReel(showTitles, { reset });
    appendCallsLog({ endpoint: '/api/startreel', method: 'GET', ok: true, result });
    res.json(result);
  } catch (error) {
    console.error('startReel error:', error);
    appendCallsLog({ endpoint: '/api/startreel', method: 'GET', ok: false, result: null, error });
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/startreel', async (req, res) => {
  try {
    const body = req.body || {};
    const showTitles = Array.isArray(body.showTitles) ? body.showTitles : [];
    const reset = body.reset === true || String(body.reset || '').trim().toLowerCase() === 'true' || String(body.reset || '').trim() === '1';
    const result = await startReel(showTitles, { reset });
    appendCallsLog({ endpoint: '/api/startreel', method: 'POST', ok: true, result });
    res.json(result);
  } catch (error) {
    console.error('startReel error:', error);
    appendCallsLog({ endpoint: '/api/startreel', method: 'POST', ok: false, result: null, error });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/getreel', async (req, res) => {
  try {
    // Keep this endpoint responsive; nginx /torrents-api/ uses default timeouts.
    const result = await getReel({ maxMs: 45000 });
    appendCallsLog({ endpoint: '/api/getreel', method: 'GET', ok: true, result });
    res.json(result);
  } catch (error) {
    console.error('getReel error:', error);
    appendCallsLog({ endpoint: '/api/getreel', method: 'GET', ok: false, result: null, error });
    res.status(500).json({ error: error.message });
  }
});

https.createServer(httpsOptions, app).listen(QBT_TEST_PORT, () => {
  // Always print a startup line, even when TORRENTS_DEBUG disables console.log.
  process.stderr.write(`=\n`);
  process.stderr.write(`========== torrents server started on port ${QBT_TEST_PORT} ==========\n`);
  process.stderr.write(`=\n`);
});
