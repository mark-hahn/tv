import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as search from './search.js';
import * as download from './download.js';
import { tvdbProxyGet } from './tvdb-proxy.js';
import { getQbtInfo, spaceAvail, flexgetHistory } from './usb.js';
import { startReel, getReel } from './reelgood.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Torrent-Filename');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

const OPENSUBTITLES_BASE_URL = 'https://api.opensubtitles.com/api/v1';

function getRootSecretsDir() {
  // torrents/src -> torrents -> repo root -> secrets
  return path.resolve(__dirname, '..', '..', 'secrets');
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

// POST /api/download - Download a torrent file
app.post('/api/download', async (req, res) => {
  try {
    const { torrent } = req.body;
    
    if (!torrent) {
      return res.status(400).json({ error: 'Torrent data is required' });
    }
    
    const result = await download.download(torrent);

    // Keep 200 OK for expected download failures; client treats non-2xx as exception.
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      res.json(result);
      return;
    }
    res.json({ success: Boolean(result) });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/torrentFile - Fetch the raw .torrent bytes directly (no detail-page scraping)
// Body: { torrent }
// Success: application/x-bittorrent
// Failure: JSON (200 OK) with { success:false, stage, error, isCloudflare?, ... }
app.post('/api/torrentFile', async (req, res) => {
  try {
    const { torrent } = req.body || {};
    if (!torrent) {
      res.status(400).json({ success: false, error: 'Torrent data is required' });
      return;
    }

    const result = await download.fetchTorrentFileFromSearchResult(torrent);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      res.status(500).json({ success: false, error: 'Unexpected torrentFile result' });
      return;
    }

    if (!result.success) {
      res.json(result);
      return;
    }

    const torrentData = result.torrentData;
    if (!Buffer.isBuffer(torrentData) || torrentData.length === 0) {
      res.json({ success: false, stage: 'validate', error: 'No torrent bytes returned' });
      return;
    }

    const rawName = torrent?.raw?.filename || 'download.torrent';
    const safeName = String(rawName || 'download.torrent').replace(/[\\/]+/g, '_');

    res.setHeader('Content-Type', 'application/x-bittorrent');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.status(200).send(torrentData);
  } catch (error) {
    console.error('torrentFile error:', error);
    res.status(500).json({ success: false, error: error?.message || String(error) });
  }
});

// POST /api/usb/addTorrent - Upload a .torrent buffer to the remote watch folder
// Content-Type: application/x-bittorrent
// Optional header: x-torrent-filename
app.post(
  '/api/usb/addTorrent',
  express.raw({ type: 'application/x-bittorrent', limit: '10mb' }),
  async (req, res) => {
    try {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ success: false, error: 'Torrent bytes are required' });
        return;
      }
      const hint = String(req.headers['x-torrent-filename'] || '').trim();
      const result = await download.uploadTorrentToWatchFolder(buf, hint);
      res.json(result);
    } catch (error) {
      console.error('usb addTorrent error:', error);
      res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  }
);

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
    res.json(result);
  } catch (error) {
    console.error('startReel error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/startreel', async (req, res) => {
  try {
    const body = req.body || {};
    const showTitles = Array.isArray(body.showTitles) ? body.showTitles : [];
    const result = await startReel(showTitles);
    res.json(result);
  } catch (error) {
    console.error('startReel error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/getreel', async (req, res) => {
  try {
    const result = await getReel();
    res.json(result);
  } catch (error) {
    console.error('getReel error:', error);
    res.status(500).json({ error: error.message });
  }
});

https.createServer(httpsOptions, app).listen(QBT_TEST_PORT, () => {
  // Always print a startup line, even when TORRENTS_DEBUG disables console.log.
  process.stderr.write(`=\n`);
  process.stderr.write(`========== torrents server started on port ${QBT_TEST_PORT} ==========\n`);
  process.stderr.write(`=\n`);
});
