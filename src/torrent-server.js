import express from 'express';
import { searchPrivateTrackers } from './torrents.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3001;

// Serve static HTML
app.use(express.static('public'));
app.use(express.json());

// API endpoint for searching torrents
app.get('/api/search', async (req, res) => {
  const showName = req.query.show;
  
  if (!showName) {
    return res.status(400).json({ error: 'Show name is required' });
  }

  console.log(`Searching for: ${showName}`);

  try {
    const credentials = {
      iptorrents: {
        username: process.env.IPT_USERNAME,
        password: process.env.IPT_PASSWORD
      },
      torrentleech: {
        username: process.env.TL_USERNAME,
        password: process.env.TL_PASSWORD
      }
    };

    const results = await searchPrivateTrackers(showName, credentials);
    
    res.json({
      show: showName,
      count: results.length,
      torrents: results
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Torrent search server running at http://localhost:${PORT}`);
  console.log(`Open your browser and go to http://localhost:${PORT}`);
});
