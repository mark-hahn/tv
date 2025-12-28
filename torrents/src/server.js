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

const TORRENTS_DEBUG = process.env.TORRENTS_DEBUG === '1';
if (!TORRENTS_DEBUG) {
  // Remove debug noise in production.
  console.log = () => {};
  console.warn = () => {};
}

console.error('[torrents-server] module loaded', {
  ts: new Date().toISOString(),
  cwd: process.cwd(),
  node: process.version,
  TORRENTS_DEBUG,
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

app.post('/api/tvproc/forceFile', async (req, res) => {
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

app.get('/api/tvproc/forceFile', async (req, res) => {
  try {
    const title = req.query.title;
    if (!title) {
      return res.status(400).json({ error: 'title parameter required' });
    }
    const url = `https://hahnca.com/tvproc/forceFile?title=${encodeURIComponent(title)}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('forceFile proxy error:', error);
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

    try {
      const detailUrl = torrent?.detailUrl;
      const provider = String(torrent?.raw?.provider || '').toLowerCase().includes('torrentleech') || String(detailUrl || '').toLowerCase().includes('torrentleech')
        ? 'torrentleech'
        : String(torrent?.raw?.provider || '').toLowerCase().includes('iptorrents') || String(detailUrl || '').toLowerCase().includes('iptorrents')
          ? 'iptorrents'
          : (torrent?.raw?.provider || 'unknown');
      const cf = cfClearance && typeof cfClearance === 'object' ? cfClearance : {};
      if (provider === 'torrentleech') {
        console.error('[TL] /api/download request:', {
          hasCfClearance: Boolean(cf.torrentleech),
          cfLen: cf.torrentleech ? String(cf.torrentleech).length : 0,
          detailUrl,
        });
      }
    } catch {
      // ignore debug logging errors
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
