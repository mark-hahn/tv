import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as search from './search.js';
import * as download from './download.js';
import fetchTorrentsInfo from './qb-info.js';

console.log(''); // Blank line on restart

const app = express();

const QBT_TEST_PORT = 3001;
const TEST_QBT      = false

// Load SSL certificate
const httpsOptions = {
  key: fs.readFileSync('./cookies/localhost-key.pem'),
  cert: fs.readFileSync('./cookies/localhost-cert.pem')
};

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.json());

// Initialize torrent search providers
search.initializeProviders();

// One-time startup probe for qb-info (runs only when TEST_QBT is enabled)
if (TEST_QBT) (async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const parseKeyValueFile = (text) => {
    const out = {};
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trimStart();

      // Allow common shell-style quoting in the cred file:
      //   QB_PASS='secret'
      //   QB_PASS="secret"
      // Strip surrounding quotes only when they match.
      const trimmedEnd = value.trimEnd();
      if (trimmedEnd.length >= 2) {
        const first = trimmedEnd[0];
        const last = trimmedEnd[trimmedEnd.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
          value = trimmedEnd.slice(1, -1);
        } else {
          value = trimmedEnd;
        }
      } else {
        value = trimmedEnd;
      }
      if (key) out[key] = value;
    }
    return out;
  };

  const credPath = process.env.QB_CRED_PATH
    ? path.resolve(process.env.QB_CRED_PATH)
    : path.resolve(__dirname, '..', 'qb-cred.txt');
  let fileCreds = {};
  let fileCredsLoaded = false;
  try {
    const text = await fs.promises.readFile(credPath, 'utf8');
    fileCreds = parseKeyValueFile(text);
    fileCredsLoaded = true;
  } catch {
    // no file / unreadable
  }

  const qbUser = process.env.QB_USER || fileCreds.QB_USER;
  const qbPass = process.env.QB_PASS || fileCreds.QB_PASS;

  const sshTarget = process.env.SSH_TARGET || fileCreds.SSH_TARGET;
  const qbPort = process.env.QB_PORT
    ? Number(process.env.QB_PORT)
    : (fileCreds.QB_PORT ? Number(fileCreds.QB_PORT) : undefined);
  const localPort = process.env.LOCAL_PORT
    ? Number(process.env.LOCAL_PORT)
    : (fileCreds.LOCAL_PORT ? Number(fileCreds.LOCAL_PORT) : undefined);

  console.log(
    'qb-info probe: creds source=' +
      (process.env.QB_USER || process.env.QB_PASS ? 'env' : (fileCredsLoaded ? `file(${credPath})` : 'none')) +
      `, user=${qbUser || '(missing)'}` +
      `, passLen=${qbPass ? String(qbPass).length : 0}` +
      `, sshTarget=${sshTarget || '(default)'}` +
      `, qbPort=${Number.isFinite(qbPort) ? qbPort : '(default)'}`
  );
  if (!qbUser || !qbPass) {
    console.log('qb-info probe: skipped (QB_USER/QB_PASS not set)');
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
