// Torrent search logic
import fs from 'fs';
import path from 'path';
import { normalize } from './normalize.js';

// torrent-search-api is CommonJS, need dynamic import
const TorrentSearchApi = (await import('torrent-search-api')).default;

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

// Initialize providers
let iptCookies = null;
let tlCookies = null;

export function initializeProviders() {
  iptCookies = loadCookiesArray('iptorrents.json');
  tlCookies = loadCookiesArray('torrentleech.json');

  if (iptCookies) {
    try {
      // Remove default IPTorrents and load custom one
      TorrentSearchApi.removeProvider('IpTorrents');
      const customIptConfig = JSON.parse(fs.readFileSync('./iptorrents-custom.json', 'utf8'));
      TorrentSearchApi.loadProvider(customIptConfig);
      TorrentSearchApi.enableProvider('IpTorrents', iptCookies);
    } catch (e) {
      console.error('Failed to enable IPTorrents:', e.message);
    }
  }

  if (tlCookies) {
    try {
      TorrentSearchApi.enableProvider('TorrentLeech', tlCookies);
    } catch (e) {
      console.error('Failed to enable TorrentLeech:', e.message);
    }
  }
}

/**
 * Search for torrents
 * @param {Object} params - Search parameters
 * @param {string} params.showName - Name of the show to search for
 * @param {number} params.limit - Maximum number of results
 * @param {string} params.iptCf - Optional IPTorrents cf_clearance override
 * @param {string} params.tlCf - Optional TorrentLeech cf_clearance override
 * @param {Array} params.needed - Optional array of needed episodes (e.g., ["S01", "S02E03"])
 * @returns {Object} Search results with torrents array
 */
export async function searchTorrents({ showName, limit = 100, iptCf, tlCf, needed = [] }) {
  console.log(`\nSearching for: ${showName} (limit: ${limit})`);
  
  // Write needed array to file (even if empty, for debugging)
  const filename = `needed-${showName.replace(/\s+/g, '-')}.json`;
  const samplePath = path.join(process.cwd(), 'sample-torrents', filename);
  
  try {
    fs.writeFileSync(samplePath, JSON.stringify(needed, null, 2));
    console.log(`Wrote needed episodes to ${filename}: ${needed.length} items`);
  } catch (err) {
    console.error(`Error writing ${filename}:`, err.message);
  }

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
    
  // Normalize and filter torrents
  const normalized = torrents.map(t => normalize(t, showName));
  const matches = normalized.filter(t => t.nameMatch);
  
  // Count by provider (for matches only)
  const providerCounts = {};
  matches.forEach(t => {
    const provider = t.raw.provider;
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;
  });
  console.log(providerCounts);
  
  // Save one sample torrent from each provider for debugging
  const sampleDir = '../sample-torrents';
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }
  
  const savedProviders = new Set();
  matches.forEach(torrent => {
    const provider = torrent.raw.provider;
    if (!savedProviders.has(provider)) {
      const filename = `${sampleDir}/${provider.toLowerCase()}-sample.json`;
      fs.writeFileSync(filename, JSON.stringify(torrent.raw, null, 2));
      savedProviders.add(provider);
    }
  });
  
  return {
    show: showName,
    count: matches.length,
    torrents: matches
  };
}
