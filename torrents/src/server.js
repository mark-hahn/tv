import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as search from './search.js';
import * as download from './download.js';
import { tvdbProxyGet } from './tvdb-proxy.js';
import { getQbtInfo, spaceAvail } from './usb.js';

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

const TVPROC_LOG_WIN = 'C:\\Users\\mark\\apps\\tv-series-client\\samples\\sample-tvproc\\tv.log';
const TVPROC_LOG_WSL = '/mnt/c/Users/mark/apps/tv-series-client/samples/sample-tvproc/tv.log';
const TVPROC_LOG_LINUX = '/mnt/media/archive/dev/apps/tv-proc/tv.log';

function getTvprocLogPath() {
  const override = process.env.TVPROC_LOG_PATH;
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (process.platform === 'win32') return TVPROC_LOG_WIN;
  if (process.env.WSL_DISTRO_NAME) return TVPROC_LOG_WSL;
  return TVPROC_LOG_LINUX;
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
  const logPath = getTvprocLogPath();
  try {
    const txt = await fs.promises.readFile(logPath, 'utf8');
    res.type('text/plain').send(txt);
  } catch (error) {
    const code = error?.code;
    if (code === 'ENOENT') {
      res.status(404).json({ error: 'tvproc log file not found', path: logPath });
      return;
    }
    console.error('tvproc error:', error);
    res.status(500).json({ error: error?.message || String(error), path: logPath });
  }
});

app.post('/api/tvproc/trim', async (req, res) => {
  const logPath = getTvprocLogPath();
  const keepLines = Number(req?.body?.keepLines);
  const n = Number.isFinite(keepLines) && keepLines > 0 ? Math.floor(keepLines) : 1000;

  try {
    const txt = await fs.promises.readFile(logPath, 'utf8');
    const lines = String(txt).split(/\r?\n/);
    const originalLines = lines.length;
    const kept = lines.slice(Math.max(0, originalLines - n));
    const out = kept.join('\n') + (kept.length ? '\n' : '');
    await fs.promises.writeFile(logPath, out, 'utf8');
    res.json({ ok: true, path: logPath, originalLines, keptLines: kept.length });
  } catch (error) {
    const code = error?.code;
    if (code === 'ENOENT') {
      res.status(404).json({ error: 'tvproc log file not found', path: logPath });
      return;
    }
    console.error('tvproc trim error:', error);
    res.status(500).json({ error: error?.message || String(error), path: logPath });
  }
});

app.post('/api/tvproc/clear', async (req, res) => {
  const logPath = getTvprocLogPath();
  try {
    // Truncate to zero bytes.
    await fs.promises.writeFile(logPath, '', 'utf8');
    res.json({ ok: true, path: logPath, cleared: true });
  } catch (error) {
    const code = error?.code;
    if (code === 'ENOENT') {
      res.status(404).json({ error: 'tvproc log file not found', path: logPath });
      return;
    }
    console.error('tvproc clear error:', error);
    res.status(500).json({ error: error?.message || String(error), path: logPath });
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
