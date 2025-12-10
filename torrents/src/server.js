import express from 'express';
import https from 'https';
import dotenv from 'dotenv';
import fs from 'fs';
import * as search from './search.js';
import * as caption from './caption.js';

dotenv.config();

console.log(''); // Blank line on restart

const app = express();
const PORT = 3001;

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

// POST /api/hasCaptions - Check if torrent has captions
app.post('/api/hasCaptions', async (req, res) => {
  try {
    const { detailUrl, provider } = req.body;
    
    if (!detailUrl || !provider) {
      return res.status(400).json({ error: 'Missing detailUrl or provider' });
    }
    
    const hasCaptions = await caption.hasCaptions(detailUrl, provider);
    res.json({ hasCaptions });
  } catch (error) {
    console.error('hasCaptions error:', error);
    res.status(500).json({ error: error.message });
  }
});

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log('\n\n');
  console.log(`\n ==== server running on localhost:${PORT} ====`);
});
