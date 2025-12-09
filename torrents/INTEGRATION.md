# Torrent Search Integration Guide

## Overview
This is a standalone web-based torrent search tool that searches IPTorrents and TorrentLeech. It runs locally on your laptop and provides torrent links through a web interface.

## Why It Runs on Laptop (Not Server)
- **Cloudflare Protection**: Both torrent sites use Cloudflare which ties `cf_clearance` cookies to IP addresses
- **Cookie Restrictions**: Cookies generated on one IP won't work on a different IP
- **Solution**: Run on laptop where cookies were originally created via Firefox

## Current Setup
The tool is running at `http://localhost:3001` with:
- Express web server serving a search interface
- Playwright (Firefox) for automated browser searches
- Cookie-based authentication (no login required during search)

## How It Works
1. User enters TV show name in web interface
2. Browser sends request to `/api/search?show=ShowName`
3. Server launches headless Firefox with saved cookies
4. Searches both IPTorrents and TorrentLeech
5. Returns array of torrent detail page URLs
6. Web interface displays results with tracker badges

## API Endpoint
```
GET /api/search?show=ShowName
```

**Response:**
```json
{
  "show": "3rd Rock from the Sun",
  "count": 17,
  "torrents": [
    "https://iptorrents.com/details.php?t=12345",
    "https://www.torrentleech.org/torrent/67890",
    ...
  ]
}
```

## Files Structure
```
torrents/
  ├── server.js           - Express server with /api/search endpoint
  ├── torrents.js         - Core search logic using Playwright
  ├── public/index.html   - Web UI (search form + results display)
  ├── cookies/            - Saved authentication cookies
  │   ├── iptorrents.json
  │   └── torrentleech.json
  ├── .env               - Credentials (fallback if cookies fail)
  └── package.json       - Dependencies: express, playwright, dotenv
```

## Integration Options for Your Client Project

### Option 1: Call the API from Your Project
If your client project runs on the same machine:
```javascript
const response = await fetch('http://localhost:3001/api/search?show=' + encodeURIComponent(showName));
const data = await response.json();
// data.torrents is array of URLs
```

### Option 2: Embed in Iframe
Add to your client HTML:
```html
<iframe src="http://localhost:3001" width="100%" height="600px"></iframe>
```

### Option 3: Import as Module
Copy `torrents.js` to your project and import:
```javascript
import { searchPrivateTrackers } from './torrents.js';

const results = await searchPrivateTrackers('Show Name', {
  iptorrents: { cookies: loadCookies('iptorrents.json') },
  torrentleech: { cookies: loadCookies('torrentleech.json') }
});
```

### Option 4: Proxy Through Your Server
Add route in your client project that proxies to torrent server:
```javascript
app.get('/torrents/search', async (req, res) => {
  const response = await fetch(`http://localhost:3001/api/search?show=${req.query.show}`);
  const data = await response.json();
  res.json(data);
});
```

## Technical Details

### IPTorrents Search
- URL: `https://iptorrents.com/t?q=SHOWNAME&qf=ti`
- Extracts links matching: `a[href*="/details.php"]`
- Returns: `https://iptorrents.com/details.php?t=TORRENTID`

### TorrentLeech Search
- URL: `https://www.torrentleech.org/torrents/browse/list/query/SHOWNAME`
- Returns JSON response: `{ torrentList: [...] }`
- Extracts: `https://www.torrentleech.org/torrent/FID`

### Cookie Management
- Cookies stored in `cookies/*.json` as Playwright cookie format
- Validated with 7-day expiry (168 hours)
- Includes: `uid`, `pass`, `cf_clearance` (Cloudflare token)

## Current Status
✅ Server running at http://localhost:3001
✅ Cookies valid and working
✅ Web interface functional
✅ Both trackers returning results

## Next Steps for Integration
1. Decide which integration option fits your client project
2. Test API calls from your client code
3. Handle torrent URLs (open in new tab, copy to clipboard, etc.)
4. Optional: Style the results to match your client UI

## Troubleshooting
- **No results**: Cookies may have expired, refresh from Firefox
- **Cloudflare errors**: Must run on same machine/IP where cookies were created
- **Server not responding**: Check `npm start` is still running in torrents folder

## Example Usage
```bash
# From terminal
curl "http://localhost:3001/api/search?show=Breaking%20Bad"

# From JavaScript
fetch('http://localhost:3001/api/search?show=Breaking Bad')
  .then(r => r.json())
  .then(data => console.log(data.torrents));
```
