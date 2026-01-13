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
import { getQbtInfo, delQbtTorrent, spaceAvail, flexgetHistory } from './usb.js';
import { startReel, getReel } from './reelgood.js';
import { checkFiles as tvProcCheckFiles } from './tv-proc.js';

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
    const outPath = path.resolve(__dirname, '..', 'calls.log');
    const asArray = Array.isArray(result) ? result.map(String) : [];
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

console.error('[torrents-server] module loaded', {
  ts: new Date().toISOString(),
  cwd: process.cwd(),
  node: process.version,
});

const app = express();

const QBT_TEST_PORT   = 3001;
const DUMP_INFO       = false;
const FILTER_TORRENTS = false;
// const FILTER_TORRENTS = {hash:   "629746091b23ec0617405e8cc6f1eee486447629"};
// const FILTER_TORRENTS = {filter: 'downloading'}

// Load SSL certificate
const httpsOptions = {
  key: fs.readFileSync(path.resolve(__dirname, '..', 'cookies', 'localhost-key.pem')),
  cert: fs.readFileSync(path.resolve(__dirname, '..', 'cookies', 'localhost-cert.pem'))
};

// Handle CORS preflight quickly.
// CORS response headers are set by nginx (single source of truth).
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

const OPENSUBTITLES_BASE_URL = 'https://api.opensubtitles.com/api/v1';

function getRootSecretsDir() {
  // Back-compat: when torrents lives inside the client repo
  // torrents/src -> torrents -> repo root -> secrets
  const legacy = path.resolve(__dirname, '..', '..', 'secrets');
  if (fs.existsSync(legacy)) return legacy;

  // Standalone: keep secrets alongside the torrents project root
  // torrents/src -> torrents -> secrets
  return path.resolve(__dirname, '..', 'secrets');
}

function getSubsLoginPath() {
  return path.join(getRootSecretsDir(), 'subs-login.txt');
}

function getSubsTokenPath() {
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
  await writeTextFile(getSubsTokenPath(), token);
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
    const inPath = path.resolve(__dirname, '..', 'cookies', 'cf-clearance.local.json');
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

    const outPath = path.resolve(__dirname, '..', 'cookies', 'cf-clearance.local.json');
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

    let token = await readTextIfExists(getSubsTokenPath());

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
    const debug = body.debug === true;

    if (!torrent) {
      res.status(400).json({ error: 'Torrent data is required' });
      return;
    }

    // Default behavior: consult tv-proc before uploading.
    if (!forceDownload) {
      const fetched = await download.fetchTorrentFile(torrent);
      if (!fetched || typeof fetched !== 'object') {
        res.json({ success: false, stage: 'fetch-torrent', error: 'Unexpected fetchTorrentFile result' });
        return;
      }
      if (!fetched.success) {
        res.json(fetched);
        return;
      }

      const valid = download.validateTorrentBytes(fetched.torrentData);
      if (!valid.success) {
        res.json(valid);
        return;
      }

      // New pre-check: if the torrent hash is already present in qBittorrent, stop early.
      let infoHash = '';
      try {
        const parsed = parseTorrent(fetched.torrentData);
        infoHash = String(parsed?.infoHash || '').trim().toLowerCase();
      } catch (e) {
        res.json({ success: false, stage: 'parse-torrent-hash', error: e?.message || String(e) });
        return;
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
            res.json({ success: false, stage: 'qbt', error: `QbitTorrent already downloaded ${title}`, hash: infoHash });
            return;
          }
        } catch (e) {
          res.json({ success: false, stage: 'qbt', error: e?.message || String(e), hash: infoHash });
          return;
        }
      }

      let titles = [];
      try {
        titles = download.extractTorrentFileTitles(fetched.torrentData);
      } catch (e) {
        res.json({ success: false, stage: 'parse-torrent', error: e?.message || String(e) });
        return;
      }

      let alreadyDownloaded = [];
      try {
        appendCallsLog({ endpoint: 'tv-proc:/checkFiles request', method: 'POST', ok: true, result: titles });
        alreadyDownloaded = await tvProcCheckFiles(titles);
        appendCallsLog({ endpoint: 'tv-proc:/checkFiles response', method: 'POST', ok: true, result: alreadyDownloaded });
      } catch (e) {
        appendCallsLog({ endpoint: 'tv-proc:/checkFiles', method: 'POST', ok: false, result: null, error: e });
        res.json({ success: false, stage: 'tv-proc', error: e?.message || String(e) });
        return;
      }

      // If any file titles are already present, do NOT send to qBittorrent.
      if (Array.isArray(alreadyDownloaded) && alreadyDownloaded.length > 0) {
        res.json(debug ? { titles, alreadyDownloaded } : alreadyDownloaded);
        return;
      }

      const hint = torrent?.raw?.filename || torrent?.raw?.title || 'download.torrent';
      const uploaded = await download.uploadTorrentToWatchFolder(fetched.torrentData, hint);
      if (!uploaded.success) {
        res.json(uploaded);
        return;
      }

      // In this mode, always return the tv-proc list (empty).
      res.json(debug ? { titles, alreadyDownloaded: [] } : []);
      return;
    }

    // Force mode: skip tv-proc only; still validate torrent file naming.
    const fetched = await download.fetchTorrentFile(torrent);
    if (!fetched || typeof fetched !== 'object') {
      res.json({ success: false, stage: 'fetch-torrent', error: 'Unexpected fetchTorrentFile result' });
      return;
    }
    if (!fetched.success) {
      res.json(fetched);
      return;
    }

    const valid = download.validateTorrentBytes(fetched.torrentData);
    if (!valid.success) {
      res.json(valid);
      return;
    }

    const hint = torrent?.raw?.filename || torrent?.raw?.title || 'download.torrent';
    const uploaded = await download.uploadTorrentToWatchFolder(fetched.torrentData, hint);
    if (!uploaded.success) {
      res.json(uploaded);
      return;
    }

    res.json({
      success: true,
      provider: fetched.provider,
      method: fetched.method,
      downloadUrl: fetched.downloadUrl,
      remotePath: uploaded.remotePath,
      filename: uploaded.filename,
      bytes: fetched.bytes,
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error?.message || String(error) });
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

    const result = await startReel(showTitles);
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
    const result = await startReel(showTitles);
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
    const result = await getReel();
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
