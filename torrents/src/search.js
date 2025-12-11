// Torrent search logic
import fs from 'fs';
import path from 'path';
import { normalize } from './normalize.js';

// torrent-search-api is CommonJS, need dynamic import
const TorrentSearchApi = (await import('torrent-search-api')).default;

const SAVE_SAMPLE_TORRENTS = false;
const DUMP_NEEDED          = false;
const SAVE_ALL_RAW         = false;

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
export async function searchTorrents({ showName, limit = 1000, iptCf, tlCf, needed = [] }) {
  console.log(`\nSearching for: ${showName} (limit: ${limit})`);
  console.log('Enabled providers:', TorrentSearchApi.getActiveProviders().join(', '));
  
  // Dump needed array if debugging enabled
  if (DUMP_NEEDED) {
    const neededPath = path.join(process.cwd(), '..', 'sample-torrents', 'needed.json');
    try {
      fs.writeFileSync(neededPath, JSON.stringify(needed, null, 2), 'utf8');
      console.log(`Wrote needed array to needed.json: ${needed.length} entries`);
    } catch (err) {
      console.error('Error writing needed.json:', err.message);
    }
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
  
  // Check if show name has parens at end and search both variants
  let torrents = [];
  const hasParens = showName.match(/\([^)]+\)\s*$/);
  
  if (hasParens) {
    const nameWithoutParens = showName.replace(/\([^)]+\)\s*$/, '').trim();
    console.log(`Searching with original name: "${showName}"`);
    console.log(`Also searching without parens: "${nameWithoutParens}"`);
    
    // Search with both names
    const [results1, results2] = await Promise.all([
      TorrentSearchApi.search(showName, 'TV', limit),
      TorrentSearchApi.search(nameWithoutParens, 'TV', limit)
    ]);
    
    // Combine results and remove duplicates
    const combined = [...results1, ...results2];
    const seen = new Set();
    torrents = combined.filter(t => {
      // Create unique key based on title and provider
      const key = `${t.provider}|${t.title}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    
    console.log(`Results from "${showName}": ${results1.length}`);
    console.log(`Results from "${nameWithoutParens}": ${results2.length}`);
    console.log(`Combined after deduplication: ${torrents.length}`);
  } else {
    torrents = await TorrentSearchApi.search(showName, 'TV', limit);
  }
  
  console.log(`Total torrents returned: ${torrents.length}`);
  
  // Count by provider in raw results
  const rawProviderCounts = {};
  torrents.forEach(t => {
    const provider = t.provider || 'Unknown';
    rawProviderCounts[provider] = (rawProviderCounts[provider] || 0) + 1;
  });
  console.log('Raw provider counts:', rawProviderCounts);
  
  // Dump all raw torrents for debugging
  if (SAVE_ALL_RAW) {
    try {
      const rawDumpPath = path.join(process.cwd(), '..', 'sample-torrents', 'all-raw.json');
      fs.writeFileSync(rawDumpPath, JSON.stringify(torrents, null, 2));
      console.log(`Wrote ${torrents.length} raw torrents to all-raw.json`);
    } catch (err) {
      console.error('Error writing all-raw.json:', err.message);
    }
  }
    
  // Normalize and filter torrents
  const normalized = torrents.map(t => normalize(t, showName));
  const matches = normalized.filter(t => t.nameMatch);
  
  // Add year to raw data
  matches.forEach(torrent => {
    if (torrent.raw) {
      // If parsed.year exists, use it
      if (torrent.parsed.year) {
        torrent.raw.year = torrent.parsed.year;
      } else {
        // Try to extract year from title - matches (YYYY) or year surrounded by non-alphanumeric
        const yearRegex = /\((\d{4})\)|[^\w](\d{4})[^\w]/g;
        const years = [];
        let match;
        while ((match = yearRegex.exec(torrent.raw.title)) !== null) {
          const year = parseInt(match[1] || match[2]);
          if (year > 1950 && year < 2050) {
            years.push(year);
          }
        }
        // Use the lowest year if any were found
        if (years.length > 0) {
          torrent.raw.year = Math.min(...years);
        }
      }
    }
  });
  
  // Add detailUrl to torrent
  matches.forEach(torrent => {
    if (torrent.raw) {
      const provider = torrent.raw.provider?.toLowerCase();
      
      if (provider === 'torrentleech' && torrent.raw.fid) {
        torrent.detailUrl = `https://www.torrentleech.org/torrent/${torrent.raw.fid}#torrentinfo`;
      } else if (provider === 'iptorrents' && torrent.raw.desc) {
        torrent.detailUrl = torrent.raw.desc;
      }
    }
  });
  
  // Filter out torrents without season information (movies, etc.)
  const tvOnly = matches.filter(torrent => {
    return torrent.parsed.season !== undefined && torrent.parsed.season !== null;
  });
  
  // Filter by year if show name contains a year
  let yearFiltered = tvOnly;
  const showYearRegex = /\((\d{4})\)/g;
  const showYears = [];
  let showYearMatch;
  while ((showYearMatch = showYearRegex.exec(showName)) !== null) {
    const year = parseInt(showYearMatch[1]);
    if (year > 1950 && year < 2050) {
      showYears.push(year);
    }
  }
  
  if (showYears.length > 0) {
    const showYear = Math.min(...showYears);
    yearFiltered = tvOnly.filter(torrent => {
      // Keep torrents that either don't have a year or match the show year
      return !torrent.raw.year || torrent.raw.year === showYear;
    });
    console.log(`Filtered by year ${showYear}: ${tvOnly.length} -> ${yearFiltered.length} torrents`);
  }
  
  // Filter out unwanted torrents by excluded strings in title
  const excludedStrings = ['2160', 'nordic', '480', 'mobile'];
  const filtered1 = yearFiltered.filter(torrent => {
    const title = torrent.raw.title.toLowerCase();
    return !excludedStrings.some(excluded => title.includes(excluded));
  });
  
  // Filter out torrents with 0 seeds
  const filtered2 = filtered1.filter(torrent => {
    const seeds = parseInt(torrent.raw?.seeds || 0);
    return seeds > 0;
  });
  
  const finalCount = showYearMatch ? `${yearFiltered.length} after year filter -> ` : '';
  console.log(`Filtered: ${matches.length} name matches -> ${tvOnly.length} with season info -> ${finalCount}${filtered1.length} without ${excludedStrings.join('/')} -> ${filtered2.length} with seeds`);
  
  // Add seasonEpisode to all torrents
  filtered2.forEach(torrent => {
    const { season, episode } = torrent.parsed;
    if (season !== undefined && season !== null) {
      if (!episode) {
        torrent.parsed.seasonEpisode = `S${String(season).padStart(2, '0')}`;
      } else {
        torrent.parsed.seasonEpisode = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
      }
    }
  });
  
  // Filter and sort based on needed array
  let filtered = filtered2;
  const isLoadAll = needed && needed.includes('loadall');
  
  if (needed && needed.length > 0 && !isLoadAll) {
    // Track which needed entries were matched
    const matchedNeeded = new Set();
    
    // Filter torrents based on needed array
    filtered = filtered2.filter(torrent => {
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
          return true;
        }
      } else {
        // Episode torrent - check if SxxExx is in needed
        const episodeStr = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
        if (needed.includes(episodeStr)) {
          matchedNeeded.add(episodeStr);
          return true;
        }
      }
      
      return false;
    });
    
    // Add dummy torrents for unmatched needed entries
    needed.forEach(entry => {
      if (entry !== 'loadall' && !matchedNeeded.has(entry)) {
        filtered.push({ notorrent: entry });
      }
    });
  }
  
  // Sort torrents (apply to both loadall and regular cases)
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
  if (SAVE_SAMPLE_TORRENTS) {
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
          fs.writeFileSync(filename, JSON.stringify(torrent, null, 2));
          savedProviders.add(provider);
        }
      }
    });
  }
  
  return {
    show: showName,
    count: filtered.length,
    torrents: filtered
  };
}
