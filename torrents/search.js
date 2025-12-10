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

// Parse size string to bytes for comparison
function parseSizeToBytes(sizeStr) {
  if (!sizeStr) return 0;
  
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|GiB|MiB|KiB|TB|TiB)?$/i);
  if (!match) return 0;
  
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  
  const multipliers = {
    'B': 1,
    'KB': 1024,
    'KIB': 1024,
    'MB': 1024 * 1024,
    'MIB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'GIB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024,
    'TIB': 1024 * 1024 * 1024 * 1024
  };
  
  return value * (multipliers[unit] || 1);
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
  const samplePath = path.join(process.cwd(), '..', 'sample-torrents', filename);
  
  try {
    fs.writeFileSync(samplePath, JSON.stringify(needed, null, 2));
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
  
  // Filter and sort based on needed array
  let filtered = matches;
  const isNoEmby = needed && needed.includes('noemby');
  
  if (needed && needed.length > 0 && !isNoEmby) {
    // Track which needed entries were matched
    const matchedNeeded = new Set();
    
    // Filter torrents based on needed array
    filtered = matches.filter(torrent => {
      const { season, episode } = torrent.parsed;
      
      // Skip if resolution exists but is not 1080 or 720
      if (torrent.parsed.resolution) {
        const res = torrent.parsed.resolution;
        if (!res.includes('1080') && !res.includes('720')) {
          return false;
        }
      }
      
      // Check if it's a season or episode torrent
      if (!episode) {
        // Season torrent - check if Sxx is in needed
        const seasonStr = `S${String(season).padStart(2, '0')}`;
        if (needed.includes(seasonStr)) {
          matchedNeeded.add(seasonStr);
          // Add seasonEpisode to parsed
          torrent.parsed.seasonEpisode = seasonStr;
          return true;
        }
      } else {
        // Episode torrent - check if SxxExx is in needed
        const episodeStr = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
        if (needed.includes(episodeStr)) {
          matchedNeeded.add(episodeStr);
          // Add seasonEpisode to parsed
          torrent.parsed.seasonEpisode = episodeStr;
          return true;
        }
      }
      
      return false;
    });
    
    // Add dummy torrents for unmatched needed entries
    needed.forEach(entry => {
      if (entry !== 'noemby' && !matchedNeeded.has(entry)) {
        filtered.push({ notorrent: entry });
      }
    });
  }
  
  // Sort torrents (apply to both noemby and regular cases)
  filtered.sort((a, b) => {
    // Skip sorting for dummy torrents (they stay at the end)
    if (a.notorrent || b.notorrent) {
      return a.notorrent ? 1 : -1;
    }
    
    // Season torrents before episode torrents
    const aIsSeason = !a.parsed.episode;
    const bIsSeason = !b.parsed.episode;
    if (aIsSeason !== bIsSeason) {
      return aIsSeason ? -1 : 1;
    }
    
    // Sort by seasonEpisode value (S01 before S02, S01E01 before S01E02)
    const aSeasonEp = a.parsed.seasonEpisode || '';
    const bSeasonEp = b.parsed.seasonEpisode || '';
    if (aSeasonEp && bSeasonEp && aSeasonEp !== bSeasonEp) {
      return aSeasonEp.localeCompare(bSeasonEp);
    }
    
    // 1080 before 720
    const aHas1080 = a.parsed.resolution?.includes('1080') || false;
    const bHas1080 = b.parsed.resolution?.includes('1080') || false;
    if (aHas1080 !== bHas1080) {
      return aHas1080 ? -1 : 1;
    }
    
    // 10-bit before non-10-bit
    const aHas10bit = a.parsed.bitDepth === 10;
    const bHas10bit = b.parsed.bitDepth === 10;
    if (aHas10bit !== bHas10bit) {
      return aHas10bit ? -1 : 1;
    }
    
    // More seeds before fewer seeds
    const aSeeds = a.raw?.seeds || 0;
    const bSeeds = b.raw?.seeds || 0;
    if (aSeeds !== bSeeds) {
      return bSeeds - aSeeds; // More seeds first
    }
    
    // Larger size before smaller size (low priority)
    const aSize = a.raw?.size;
    const bSize = b.raw?.size;
    
    // If one has size and the other doesn't, prioritize the one with size
    if (aSize && !bSize) return -1;
    if (!aSize && bSize) return 1;
    
    // If both have size, compare them
    if (aSize && bSize) {
      const aSizeBytes = parseSizeToBytes(aSize);
      const bSizeBytes = parseSizeToBytes(bSize);
      if (aSizeBytes !== bSizeBytes) {
        return bSizeBytes - aSizeBytes; // Larger first
      }
    }
    
    // TorrentLeech before IPTorrents (lowest priority)
    const aProvider = a.raw?.provider?.toLowerCase() || '';
    const bProvider = b.raw?.provider?.toLowerCase() || '';
    const aIsTL = aProvider === 'torrentleech';
    const bIsTL = bProvider === 'torrentleech';
    if (aIsTL !== bIsTL) {
      return aIsTL ? -1 : 1;
    }
    
    return 0;
  });
  
  // Count by provider (for filtered results only)
  const providerCounts = {};
  filtered.forEach(t => {
    if (t.raw) {
      const provider = t.raw.provider;
      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    }
  });
  console.log(providerCounts);
  
  // Save one sample torrent from each provider for debugging
  const sampleDir = '../sample-torrents';
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }
  
  const savedProviders = new Set();
  filtered.forEach(torrent => {
    if (torrent.raw) {
      const provider = torrent.raw.provider;
      if (!savedProviders.has(provider)) {
        const filename = `${sampleDir}/${provider.toLowerCase()}-sample.json`;
        fs.writeFileSync(filename, JSON.stringify(torrent.raw, null, 2));
        savedProviders.add(provider);
      }
    }
  });
  
  return {
    show: showName,
    count: filtered.length,
    torrents: filtered
  };
}
