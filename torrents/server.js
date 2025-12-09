import express from 'express';
import https from 'https';
import dotenv from 'dotenv';
import fs from 'fs';

// torrent-search-api is CommonJS, need dynamic import
const TorrentSearchApi = (await import('torrent-search-api')).default;

dotenv.config();

const app = express();
const PORT = 3001;

// Load SSL certificate
const httpsOptions = {
  key: fs.readFileSync('./localhost-key.pem'),
  cert: fs.readFileSync('./localhost-cert.pem')
};

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.json());

// Load cookies from files
function loadCookiesArray(filename) {
  const filepath = `./cookies/${filename}`;
  if (fs.existsSync(filepath)) {
    const cookiesJson = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    // Convert Playwright cookie format to cookie string array
    return cookiesJson.map(cookie => `${cookie.name}=${cookie.value}`);
  }
  return null;
}

// Enable providers with cookies
const iptCookies = loadCookiesArray('iptorrents.json');
const tlCookies = loadCookiesArray('torrentleech.json');

if (iptCookies) {
  try {
    // Remove default IPTorrents and load custom one
    TorrentSearchApi.removeProvider('IpTorrents');
    const customIptConfig = JSON.parse(fs.readFileSync('./iptorrents-custom.json', 'utf8'));
    TorrentSearchApi.loadProvider(customIptConfig);
    TorrentSearchApi.enableProvider('IpTorrents', iptCookies);
    console.log('IPTorrents enabled with cookies (custom config)');
  } catch (e) {
    console.error('Failed to enable IPTorrents:', e.message);
  }
}

if (tlCookies) {
  try {
    TorrentSearchApi.enableProvider('TorrentLeech', tlCookies);
    console.log('TorrentLeech enabled with cookies');
  } catch (e) {
    console.error('Failed to enable TorrentLeech:', e.message);
  }
}

// API endpoint
app.get('/api/search', async (req, res) => {
  const showName = req.query.show;
  const limit = parseInt(req.query.limit) || 100; // Default to 100 results
  const iptCf = req.query.ipt_cf; // IPTorrents cf_clearance from query
  const tlCf = req.query.tl_cf;   // TorrentLeech cf_clearance from query
  
  if (!showName) {
    return res.status(400).json({ error: 'Show name is required' });
  }

  console.log(`\nSearching for: ${showName} (limit: ${limit})`);

  try {
    // Temporarily override cookies if cf_clearance provided
    const iptCookiesForSearch = iptCookies ? [...iptCookies] : [];
    const tlCookiesForSearch = tlCookies ? [...tlCookies] : [];
    
    if (iptCf) {
      // Remove existing cf_clearance and add new one
      const filtered = iptCookiesForSearch.filter(c => !c.startsWith('cf_clearance='));
      filtered.push(`cf_clearance=${iptCf}`);
      TorrentSearchApi.removeProvider('IpTorrents');
      const customIptConfig = JSON.parse(fs.readFileSync('./iptorrents-custom.json', 'utf8'));
      TorrentSearchApi.loadProvider(customIptConfig);
      TorrentSearchApi.enableProvider('IpTorrents', filtered);
      console.log('Using provided IPTorrents cf_clearance');
    }
    
    if (tlCf) {
      // Remove existing cf_clearance and add new one
      const filtered = tlCookiesForSearch.filter(c => !c.startsWith('cf_clearance='));
      filtered.push(`cf_clearance=${tlCf}`);
      TorrentSearchApi.enableProvider('TorrentLeech', filtered);
      console.log('Using provided TorrentLeech cf_clearance');
    }
    
    const torrents = await TorrentSearchApi.search(showName, 'TV', limit);
    
    console.log(`Found ${torrents.length} total results`);
    
    // Count by provider
    const providerCounts = {};
    torrents.forEach(t => {
      providerCounts[t.provider] = (providerCounts[t.provider] || 0) + 1;
    });
    console.log('Results by provider:', providerCounts);
    
    // Save one sample torrent from each provider for debugging
    const sampleDir = '../sample-torrents';
    if (!fs.existsSync(sampleDir)) {
      fs.mkdirSync(sampleDir, { recursive: true });
    }
    
    const savedProviders = new Set();
    torrents.forEach(torrent => {
      if (!savedProviders.has(torrent.provider)) {
        const filename = `${sampleDir}/${torrent.provider.toLowerCase()}-sample.json`;
        fs.writeFileSync(filename, JSON.stringify(torrent, null, 2));
        savedProviders.add(torrent.provider);
      }
    });
    
    // Return full torrent objects for now
    res.json({
      show: showName,
      count: torrents.length,
      torrents: torrents
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/selTorrent - Handle torrent selection
app.post('/api/selTorrent', (req, res) => {
  try {
    const { torrent } = req.body;
    
    console.log('selTorrent called with torrent:', torrent);
    
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('selTorrent error:', error);
    res.status(500).json({ error: error.message });
  }
});

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`Torrent search server running at https://localhost:${PORT}`);
  console.log(`Active providers: ${TorrentSearchApi.getActiveProviders().map(p => p.name).join(', ')}`);
});
