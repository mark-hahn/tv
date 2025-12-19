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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TORRENTS_DEBUG = process.env.TORRENTS_DEBUG === '1';
if (!TORRENTS_DEBUG) {
  // Remove debug noise in production.
  console.log = () => {};
  console.warn = () => {};
}

const app = express();

const QBT_TEST_PORT   = 3001;
const DUMP_INFO       = false;
const FILTER_TORRENTS = false;
// const FILTER_TORRENTS = {hash:   "629746091b23ec0617405e8cc6f1eee486447629"};
// const FILTER_TORRENTS = {filter: 'downloading'}

const TVPROC_JSON_WIN = 'C:\\Users\\mark\\apps\\tv-series-client\\samples\\sample-tvproc\\tv.json';
const TVPROC_JSON_WSL = '/mnt/c/Users/mark/apps/tv-series-client/samples/sample-tvproc/tv.json';
const TVPROC_JSON_LINUX = '/mnt/media/archive/dev/apps/tv-proc/tv.json';

function getTvprocJsonPath() {
  const override = process.env.TVPROC_JSON_PATH;
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (process.platform === 'win32') return TVPROC_JSON_WIN;
  if (process.env.WSL_DISTRO_NAME) return TVPROC_JSON_WSL;
  return TVPROC_JSON_LINUX;
}

function parseJsonArrayWithContext(txt, filePath) {
  try {
    const arr = JSON.parse(String(txt || '[]'));
    if (!Array.isArray(arr)) {
      const err = new Error('tvproc json must be an array');
      err.code = 'TVPROC_NOT_ARRAY';
      err.path = filePath;
      throw err;
    }
    return arr;
  } catch (e) {
    // Add best-effort line/column for JSON.parse errors like:
    // "Expected double-quoted property name in JSON at position 123 (line 4 column 2)"
    const msg = e?.message || String(e);
    const m = /position\s+(\d+)/i.exec(msg);
    const pos = m ? Number(m[1]) : null;
    let line = null;
    let column = null;
    if (Number.isFinite(pos) && pos >= 0) {
      const s = String(txt || '');
      const upto = s.slice(0, pos);
      line = upto.split(/\n/).length;
      const lastNl = upto.lastIndexOf('\n');
      column = (lastNl >= 0 ? upto.length - lastNl : upto.length + 1);
    }
    const err = new Error(msg);
    err.code = e?.code || 'TVPROC_JSON_PARSE_ERROR';
    err.path = filePath;
    err.pos = Number.isFinite(pos) ? pos : null;
    err.line = line;
    err.column = column;
    throw err;
  }
}

// Load SSL certificate
const httpsOptions = {
  key: fs.readFileSync(path.resolve(__dirname, '..', 'cookies', 'localhost-key.pem')),
  cert: fs.readFileSync(path.resolve(__dirname, '..', 'cookies', 'localhost-cert.pem'))
};

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

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

app.get('/api/tvproc', async (req, res) => {
  const jsonPath = getTvprocJsonPath();
  try {
    const txt = await fs.promises.readFile(jsonPath, 'utf8');
    const arr = parseJsonArrayWithContext(txt, jsonPath);
    res.json(arr);
  } catch (error) {
    const code = error?.code;
    if (code === 'ENOENT') {
      // Treat missing as empty.
      res.json([]);
      return;
    }
    const isParse = code === 'TVPROC_JSON_PARSE_ERROR' || error?.name === 'SyntaxError';
    if (isParse) {
      console.error(`tvproc invalid json: ${jsonPath}: ${error?.message || String(error)}`);
    } else {
      console.error('tvproc error:', error);
    }
    res.status(500).json({
      error: error?.message || String(error),
      path: jsonPath,
      line: error?.line ?? null,
      column: error?.column ?? null
    });
  }
});

app.post('/api/tvproc/trim', async (req, res) => {
  const jsonPath = getTvprocJsonPath();
  const keepLines = Number(req?.body?.keepLines);
  const n = Number.isFinite(keepLines) && keepLines > 0 ? Math.floor(keepLines) : 1000;

  try {
    const txt = await fs.promises.readFile(jsonPath, 'utf8');
    const arr = parseJsonArrayWithContext(txt, jsonPath);
    const originalCount = arr.length;
    const kept = arr.slice(Math.max(0, originalCount - n));
    await fs.promises.writeFile(jsonPath, JSON.stringify(kept, null, 2) + '\n', 'utf8');
    res.json({ ok: true, path: jsonPath, originalCount, keptCount: kept.length });
  } catch (error) {
    const code = error?.code;
    if (code === 'ENOENT') {
      res.json({ ok: true, path: jsonPath, originalCount: 0, keptCount: 0 });
      return;
    }
    console.error('tvproc trim error:', error);
    res.status(500).json({
      error: error?.message || String(error),
      path: jsonPath,
      line: error?.line ?? null,
      column: error?.column ?? null
    });
  }
});

app.post('/api/tvproc/clear', async (req, res) => {
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
  const iptCf = req.query.ipt_cf;
  const tlCf = req.query.tl_cf;
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
    const result = await search.searchTorrents({ showName, limit, iptCf, tlCf, needed });
    res.json(result);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/download - Download a torrent file
app.post('/api/download', async (req, res) => {
  try {
    const { torrent, cfClearance } = req.body;
    
    if (!torrent) {
      return res.status(400).json({ error: 'Torrent data is required' });
    }
    
    const result = await download.download(torrent, cfClearance);

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

https.createServer(httpsOptions, app).listen(QBT_TEST_PORT, () => {
  // Always print a startup line, even when TORRENTS_DEBUG disables console.log.
  process.stderr.write(`=\n`);
  process.stderr.write(`========== torrents server started on port ${QBT_TEST_PORT} ==========\n`);
  process.stderr.write(`=\n`);
});
