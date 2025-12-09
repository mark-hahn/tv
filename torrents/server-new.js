import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';

// torrent-search-api is CommonJS, need dynamic import
const TorrentSearchApi = (await import('torrent-search-api')).default;

dotenv.config();

const app = express();
const PORT = 3001;

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.static('public'));
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
    TorrentSearchApi.enableProvider('IpTorrents', iptCookies);
    console.log('IPTorrents enabled with cookies');
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
  
  if (!showName) {
    return res.status(400).json({ error: 'Show name is required' });
  }

  console.log(`\nSearching for: ${showName}`);

  try {
    // Search each provider individually to see results
    const activeProviders = TorrentSearchApi.getActiveProviders();
    console.log(`Active providers for search: ${activeProviders.map(p => p.name).join(', ')}`);
    
    const torrents = await TorrentSearchApi.search(showName, 'TV', 20);
    
    console.log(`Found ${torrents.length} total results`);
    
    // Count by provider
    const providerCounts = {};
    torrents.forEach(t => {
      providerCounts[t.provider] = (providerCounts[t.provider] || 0) + 1;
    });
    console.log('Results by provider:', providerCounts);
    
    // Debug: log first result to see structure
    if (torrents.length > 0) {
      console.log('Sample result:', JSON.stringify(torrents[0], null, 2));
    }
    
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

app.listen(PORT, () => {
  console.log(`Torrent search server running at http://localhost:${PORT}`);
  console.log(`Active providers: ${TorrentSearchApi.getActiveProviders().map(p => p.name).join(', ')}`);
});
