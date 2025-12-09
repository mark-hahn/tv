# Torrent Search Tool

Web-based search tool for IPTorrents and TorrentLeech.

## Setup on Your Laptop

1. **Install dependencies:**
   ```bash
   cd torrents
   npm install
   ```

2. **Create .env file** with your credentials:
   ```
   IPT_USERNAME=your_username
   IPT_PASSWORD=your_password
   TL_USERNAME=your_username
   TL_PASSWORD=your_password
   ```

3. **Create cookies directory and add your cookies:**
   ```bash
   mkdir cookies
   ```
   
   Then extract cookies from Firefox (while logged into each site):
   - F12 → Storage → Cookies → iptorrents.com
   - Copy the important cookies (uid, pass, cf_clearance) into `cookies/iptorrents.json`
   - Do the same for torrentleech.org into `cookies/torrentleech.json`

## Usage

**Start the web server:**
```bash
npm start
```

Then open your browser to: `http://localhost:3001`

**Test from command line:**
```bash
npm test
```

## Files

- `server.js` - Express web server
- `torrents.js` - Core search functionality
- `public/index.html` - Web interface
- `cookies/` - Cookie storage (create this folder)
- `.env` - Your credentials (create this file)

## Notes

- This must run on your laptop (not the server) because Cloudflare ties cookies to IP addresses
- Cookies are valid for 7 days
- The web interface provides a nicer way to search than command line
