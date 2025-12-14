import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as search from './search.js';
import * as download from './download.js';
import fetchTorrentsInfo from './qbt-torrents.js';
import { loadCreds } from './qb-cred.js';
import { tvdbProxyGet } from './tvdb-proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(''); // Blank line on restart

const app = express();

const QBT_TEST_PORT = 3001;
const TEST_QBT      = false

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

// One-time startup probe for qb-info (runs only when TEST_QBT is enabled)
if (TEST_QBT) (async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const credPath = path.resolve(__dirname, '..', 'qb-cred.txt');

  const { creds: fileCreds, loaded: fileCredsLoaded } = await loadCreds(credPath);

  const qbUser = fileCreds.QB_USER;
  const qbPass = fileCreds.QB_PASS;

  const sshTarget = fileCreds.SSH_TARGET;
  const qbPort = fileCreds.QB_PORT ? Number(fileCreds.QB_PORT) : undefined;
  const localPort = fileCreds.LOCAL_PORT ? Number(fileCreds.LOCAL_PORT) : undefined;

  console.log(
    'qb-info probe: creds source=' +
      (fileCredsLoaded ? `file(${credPath})` : 'none') +
      `, user=${qbUser || '(missing)'}` +
      `, passLen=${qbPass ? String(qbPass).length : 0}` +
        `, sshTarget=${sshTarget || '(missing)'}` +
      `, qbPort=${Number.isFinite(qbPort) ? qbPort : '(default)'}`
  );
  if (!qbUser || !qbPass) {
    console.log('qb-info probe: skipped (QB_USER/QB_PASS missing in qb-cred.txt)');
    return;
  }

  try {
    const jsonText = await fetchTorrentsInfo({
      qbUser,
      qbPass,
      sshTarget,
      qbPort,
      localPort,
    });

    let torrentsCount = undefined;
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) torrentsCount = parsed.length;
    } catch {
      // ignore parse errors; still log raw length
    }

    console.log(
      `qb-info probe: ok (bytes=${jsonText.length}` +
      (typeof torrentsCount === 'number' ? `, torrents=${torrentsCount}` : '') +
      ')'
    );
  } catch (e) {
    console.error(`qb-info probe: failed: ${e?.message || e}`);
  }
})();

// API endpoint
app.get('/api/tvdb/*', tvdbProxyGet);

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
    res.json({ success: result });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

https.createServer(httpsOptions, app).listen(QBT_TEST_PORT, () => {
  console.log('\n\n');
  console.log(`\n ==== server running on localhost:${QBT_TEST_PORT} ====`);
});
