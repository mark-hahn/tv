// Torrent search logic
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalize } from './normalize.js';

// torrent-search-api is CommonJS, need dynamic import
const TorrentSearchApi = (await import('torrent-search-api')).default;

const SAVE_SAMPLE_TORRENTS = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TORRENTS_DIR = path.resolve(__dirname, '..');
const COOKIES_DIR = path.join(TORRENTS_DIR, 'cookies');
const IPTORRENTS_CUSTOM_PATH = path.join(TORRENTS_DIR, 'iptorrents-custom.json');

// Load cookies from files
function loadCookiesArray(filename) {
  const filepath = path.join(COOKIES_DIR, filename);
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
      // Prefer custom provider config when present; otherwise fall back to built-in.
      if (fs.existsSync(IPTORRENTS_CUSTOM_PATH)) {
        TorrentSearchApi.removeProvider('IpTorrents');
        const customIptConfig = JSON.parse(fs.readFileSync(IPTORRENTS_CUSTOM_PATH, 'utf8'));
        TorrentSearchApi.loadProvider(customIptConfig);
      } else {
        console.error(`IPTorrents custom config missing: ${IPTORRENTS_CUSTOM_PATH} (using default provider config)`);
      }
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

  const sanitizeForProviderSearch = (name) => {
    return String(name || '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Temporarily override cookies if cf_clearance provided
  const iptCookiesForSearch = iptCookies ? [...iptCookies] : [];
  const tlCookiesForSearch = tlCookies ? [...tlCookies] : [];
  
  if (iptCf) {
    // Remove existing cf_clearance and add new one
    const filtered = iptCookiesForSearch.filter(c => !c.startsWith('cf_clearance='));
    filtered.push(`cf_clearance=${iptCf}`);
    try {
      if (fs.existsSync(IPTORRENTS_CUSTOM_PATH)) {
        TorrentSearchApi.removeProvider('IpTorrents');
        const customIptConfig = JSON.parse(fs.readFileSync(IPTORRENTS_CUSTOM_PATH, 'utf8'));
        TorrentSearchApi.loadProvider(customIptConfig);
      } else {
        console.error(`IPTorrents custom config missing: ${IPTORRENTS_CUSTOM_PATH} (cf_clearance override will use default provider config)`);
      }
      TorrentSearchApi.enableProvider('IpTorrents', filtered);
      console.log('Using provided IPTorrents cf_clearance');
    } catch (e) {
      console.error('Failed to apply IPTorrents cf_clearance override:', e.message);
    }
  }
  
  if (tlCf) {
    // Remove existing cf_clearance and add new one
    const filtered = tlCookiesForSearch.filter(c => !c.startsWith('cf_clearance='));
    filtered.push(`cf_clearance=${tlCf}`);
    TorrentSearchApi.enableProvider('TorrentLeech', filtered);
    console.log('Using provided TorrentLeech cf_clearance');
  }
  
  // Provider search:
  // - Sanitize the show name for provider searching (strip punctuation, collapse whitespace)
  // - Also try a parens-stripped variant
  // - Keep provider category as "TV" (existing behavior)
  let torrents = [];
  const baseName = String(showName || '').trim();
  const hasParens = baseName.match(/\([^)]+\)\s*$/);
  const nameWithoutParens = hasParens ? baseName.replace(/\([^)]+\)\s*$/, '').trim() : '';

  const sanitized = sanitizeForProviderSearch(baseName);
  const sanitizedWithoutParens = nameWithoutParens ? sanitizeForProviderSearch(nameWithoutParens) : '';

  const queries = [sanitized, sanitizedWithoutParens].filter(Boolean);
  const seenQuery = new Set();
  const uniqueQueries = [];
  for (const q of queries) {
    const key = q.toUpperCase();
    if (seenQuery.has(key)) continue;
    seenQuery.add(key);
    uniqueQueries.push(q);
  }

  const resultsArrays = await Promise.all(
    uniqueQueries.map(async (q) => {
      try {
        const r = await TorrentSearchApi.search(q, 'TV', limit);
        return Array.isArray(r) ? r : [];
      } catch {
        return [];
      }
    })
  );

  const combined = resultsArrays.flat();
  const seen = new Set();
  torrents = combined.filter(t => {
    const key = `${t.provider}|${t.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  console.log(`Total torrents returned: ${torrents.length}`);

  // Count by provider in raw results (before normalization/filtering).
  // The UI uses this to decide whether to show "missing provider" cookie warnings.
  const rawProviderCounts = {};
  torrents.forEach(t => {
    const provider = t.provider || 'Unknown';
    rawProviderCounts[provider] = (rawProviderCounts[provider] || 0) + 1;
  });
  
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
  // Allow season-range torrents through even if parsed.season is missing
  const tvOnly = matches.filter(torrent => {
    const hasSeason = torrent.parsed.season !== undefined && torrent.parsed.season !== null;
    const hasSeasonRange = !!torrent.seasonRange?.isRange;
    return hasSeason || hasSeasonRange;
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
    // (debug removed)
  } else {
    // (debug removed)
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
  const isNoEmby = needed && needed.includes('noemby');
  const isForce = needed && needed.includes('force');
  
  if (isNoEmby) {
    // For noemby, return all season torrents and episode torrents for seasons without a season torrent
    const seasonsByNumber = {};
    
    // Group torrents by season
    filtered2.forEach(torrent => {
      const season = torrent.parsed.season;
      if (season === undefined || season === null) return;
      
      if (!seasonsByNumber[season]) {
        seasonsByNumber[season] = { seasonTorrents: [], episodeTorrents: [] };
      }
      
      if (!torrent.parsed.episode) {
        // This is a season torrent
        seasonsByNumber[season].seasonTorrents.push(torrent);
      } else {
        // This is an episode torrent
        seasonsByNumber[season].episodeTorrents.push(torrent);
      }
    });
    
    // Build filtered list: all season torrents, and episode torrents only for seasons without season torrents
    filtered = [];
    Object.keys(seasonsByNumber).sort((a, b) => Number(a) - Number(b)).forEach(seasonNum => {
      const seasonData = seasonsByNumber[seasonNum];
      if (seasonData.seasonTorrents.length > 0) {
        // Season torrents exist, include all of them
        filtered.push(...seasonData.seasonTorrents);
        
        // Exception: for season 1, also include episode 1 torrents
        if (Number(seasonNum) === 1) {
          const s01e01Torrents = seasonData.episodeTorrents.filter(t => t.parsed.episode === 1);
          filtered.push(...s01e01Torrents);
        }
      } else {
        // No season torrents, include all episode torrents
        filtered.push(...seasonData.episodeTorrents);
      }
    });
  } else if (isForce) {
    // For force, return all torrents without filtering
    filtered = filtered2;
  } else if (isLoadAll) {
    // For loadall, return all season torrents and episode torrents for seasons without a season torrent
    const seasonsByNumber = {};
    
    // Group torrents by season
    filtered2.forEach(torrent => {
      const season = torrent.parsed.season;
      if (season === undefined || season === null) return;
      
      if (!seasonsByNumber[season]) {
        seasonsByNumber[season] = { seasonTorrents: [], episodeTorrents: [] };
      }
      
      if (!torrent.parsed.episode) {
        // This is a season torrent
        seasonsByNumber[season].seasonTorrents.push(torrent);
      } else {
        // This is an episode torrent
        seasonsByNumber[season].episodeTorrents.push(torrent);
      }
    });
    
    // Build filtered list: all season torrents, and episode torrents only for seasons without season torrents
    filtered = [];
    Object.keys(seasonsByNumber).sort((a, b) => Number(a) - Number(b)).forEach(seasonNum => {
      const seasonData = seasonsByNumber[seasonNum];
      if (seasonData.seasonTorrents.length > 0) {
        // Season torrents exist, include all of them
        filtered.push(...seasonData.seasonTorrents);
        
        // Exception: for season 1, also include episode 1 torrents
        if (Number(seasonNum) === 1) {
          const s01e01Torrents = seasonData.episodeTorrents.filter(t => t.parsed.episode === 1);
          filtered.push(...s01e01Torrents);
        }
      } else {
        // No season torrents, include all episode torrents
        filtered.push(...seasonData.episodeTorrents);
      }
    });
  } else if (needed && needed.length > 0) {
    // Track which needed entries were matched
    const matchedNeeded = new Set();
    
    // Filter torrents based on needed array
    filtered = filtered2.filter(torrent => {
      const { season, episode } = torrent.parsed;
      const range = torrent.seasonRange;
      
      // Skip if resolution exists but is not 1080 or 720
      if (torrent.parsed.resolution) {
        const res = torrent.parsed.resolution;
        if (!res.includes('1080') && !res.includes('720')) {
          return false;
        }
      }
      
      // Handle season range torrents: ignore parsed season/episode and match any season in range
      if (range && range.isRange) {
        const start = Number(range.startSeason);
        const end = Number(range.endSeason);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          for (let s = start; s <= end; s++) {
            const seasonStr = `S${String(s).padStart(2, '0')}`;
            if (needed.includes(seasonStr)) {
              matchedNeeded.add(seasonStr);
              return true;
            }
          }
        }
        return false;
      }

      // Non-range: Check if it's a season or episode torrent
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
  }
  // Sort torrents (apply to both loadall and regular cases)
  filtered.sort((a, b) => {
    // Skip sorting for dummy torrents (they stay at the end)
    if (a.notorrent || b.notorrent) {
      return a.notorrent ? 1 : -1;
    }

    // Highest-priority: sort by the same label shown in the UI (season/episode at left).
    // Ordering: season packs first, then season-range packs, then individual episodes.
    const key = (t) => {
      const range = t.seasonRange;
      if (range && range.isRange) {
        const startSeason = Number(range.startSeason);
        const endSeason = Number(range.endSeason);
        return {
          season: Number.isFinite(startSeason) ? startSeason : 9999,
          kind: 1, // range
          episode: 0,
          endSeason: Number.isFinite(endSeason) ? endSeason : 9999
        };
      }

      const season = Number(t?.parsed?.season);
      const episode = Number(t?.parsed?.episode);
      const hasSeason = Number.isFinite(season);
      const hasEpisode = Number.isFinite(episode) && episode > 0;

      return {
        season: hasSeason ? season : 9999,
        kind: hasEpisode ? 2 : 0, // 0 season pack, 2 episode
        episode: hasEpisode ? episode : 0,
        endSeason: 0
      };
    };

    const ak = key(a);
    const bk = key(b);

    if (ak.season !== bk.season) return ak.season - bk.season;
    if (ak.kind !== bk.kind) return ak.kind - bk.kind;
    if (ak.kind === 1 && ak.endSeason !== bk.endSeason) return ak.endSeason - bk.endSeason;
    if (ak.kind === 2 && ak.episode !== bk.episode) return ak.episode - bk.episode;
    
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
  
  // (debug sample saving removed)
  
  return {
    show: showName,
    count: filtered.length,
    torrents: filtered,
    rawProviderCounts
  };
}
