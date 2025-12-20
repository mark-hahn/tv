import * as srvr from "./srvr.js";
import * as util from "./util.js";
import { config } from "./config.js";

// Route TVDB calls through the local torrents server proxy.
// This avoids browser-to-TVDB CORS issues (Authorization header).
const TVDB_PROXY_BASE = `${config.torrentsApiUrl}/api/tvdb`;

async function tvdbFetch(path, init) {
  const url = `${TVDB_PROXY_BASE}/${String(path).replace(/^\/+/, '')}`;
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`tvdb proxy error: ${res.status} ${text}`.trim());
  }
  return res;
}

let allTvdb = null;
export const getAllTvdb = async () => {
  // all data in tvdb.json
  // cached in allTvdb
  allTvdb ??= await srvr.getAllTvdb();
  return allTvdb;
}

//////////// search for TvDb Data //////////////

export const srchTvdbData = async (searchStr) => {
  const srchUrl = 'search?type=series&query=' + encodeURIComponent(searchStr);
  const srchRes = await tvdbFetch(srchUrl);
  const srchResObj = await srchRes.json();
  const data = srchResObj.data;
  if(!data || data.length == 0) return null;
  return data;
}

// export const markTvdbDeleted = 
//   async (showName, markDelete) => {
//     const tvdbData = allTvdb[showName];
//     if(!tvdbData) return;
//     if(markDelete) tvdbData.deleted = util.dateWithTZ();
//     else    delete tvdbData.deleted;
//     // console.log('markTvdbDeleted:', 
//     //     {showName, markDelete, str: str.substring(-100, 100)});
//     // if(!tvdbData.image) {
//     //   alert('no image in tvdbData');
//     //   return;
//     // }
//     // addTvdb can add or update tvdb.json
//     await srvr.addTvdb(tvdbData);
//     allTvdb[showName] = tvdbData;
//   };

//////////// get waitStr //////////////

export async function getWaitStr(show) {
  let waitStr = '';
  try {
    const tvdbData = await allTvdb[show.Name];
    if(tvdbData) {
      const lastAired = tvdbData.lastAired;
      if(!lastAired) return '';
      const lastAiredDay  = lastAired;
      const lastAiredNoYr = lastAired.slice(5).replace(/^0/, ' ');  
      const today = util.fmtDate();
      if(lastAiredDay >= today) waitStr = `{${lastAiredNoYr}}`;
      // console.log('getWaitStr:', show.Name, 
      //     {waitStr, lastAiredDay, lastAiredNoYr, today}); 
    }
  } 
  catch(e) { 
    console.error('getWaitStr, tvdb data error:', show.Name, e); 
    return '';
  }
  return waitStr; 
}

//////////// get episode data //////////////

export const getEpisode = async (showName, seasonNum, episodeNum) => {
  // Get series ID from allTvdb
  if (!allTvdb) await getAllTvdb();
  const tvdbData = allTvdb[showName];
  
  if (!tvdbData || !tvdbData.tvdbId) {
    console.error('getEpisode: no tvdbId found for show:', showName);
    return null;
  }
  
  const seriesId = tvdbData.tvdbId;
  
  // Fetch episodes to get episode ID
  const episodeUrl = `series/${seriesId}/episodes/default?season=${seasonNum}&episodeNumber=${episodeNum}`;
  
  const episodeRes = await tvdbFetch(episodeUrl);
  const episodeResObj = await episodeRes.json();
  const episodes = episodeResObj.data?.episodes;
  
  if (!episodes || episodes.length === 0) {
    console.error('getEpisode: no episode found for:', {showName, seasonNum, episodeNum});
    return null;
  }
  
  const episodeId = episodes[0].id;
  
  // Fetch and return extended episode data
  const extendedUrl = `episodes/${episodeId}/extended`;
  
  const extendedRes = await tvdbFetch(extendedUrl);
  const extendedResObj = await extendedRes.json();
  return extendedResObj.data;
}

//////////// get episode guest actors //////////////

export const getEpisodeGuests = async (showName, seasonNum, episodeNum) => {
  try {
    // First check if we have episode data in allTvdb cache
    if (!allTvdb) await getAllTvdb();
    const tvdbData = allTvdb[showName];
    
    if (tvdbData?.seasons?.[seasonNum]?.episodes?.[episodeNum]?.characters) {
      // Episode guest data exists in cache
      const characters = tvdbData.seasons[seasonNum].episodes[episodeNum].characters;
      const guests = characters
        .filter(char => char.type === 3 || char.isFeatured === false)
        .map(char => ({
          name: char.name,
          personName: char.personName,
          image: char.image || null,
          personImgURL: char.image || null,
          url: null,
          type: char.type,
          isFeatured: char.isFeatured
        }));
      return guests;
    }
    
    // Fall back to API call if not in cache
    const episodeData = await getEpisode(showName, seasonNum, episodeNum);
    
    if (!episodeData || !episodeData.characters) {
      console.log('getEpisodeGuests: no character data for episode:', {showName, seasonNum, episodeNum});
      return [];
    }
    
    // Filter for guest stars (type 3 or isFeatured false)
    const guests = episodeData.characters
      .filter(char => char.type === 3 || char.isFeatured === false)
      .map(char => ({
        name: char.name,
        personName: char.personName,
        image: char.image || null,
        personImgURL: char.image || null,
        url: null,
        type: char.type,
        isFeatured: char.isFeatured
      }));
    
    return guests;
  } catch (error) {
    console.error('getEpisodeGuests error:', error);
    return [];
  }
}

//////////// get series map from tvdb //////////////

/**
 * Match a show name using the same logic as normalize
 * Cleans both names and compares multiple variations
 */
function cleanVariations(title) {
  const applyBase = (t) => {
    return t
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // Remove diacritics
      .trim()                           // Trim whitespace
      .replace(/\s+/g, ' ')             // Collapse whitespace to single space
      .replace(/\b(and|the)\b/gi, '')   // Remove words "and" and "the"
      .replace(/\s+/g, ' ')             // Collapse whitespace again
      .trim()                           // Trim again
      .toUpperCase();                   // Convert to uppercase
  };
  
  return [
    // 1) Just base changes
    applyBase(title),
    
    // 2) Remove paren chars at end leaving contents
    applyBase(title.replace(/\(([^)]+)\)\s*$/, '$1')),
    
    // 3) Remove paren chars at end including contents
    applyBase(title.replace(/\([^)]+\)\s*$/, '')),
    
    // 4) Remove any non alphanum chars
    applyBase(title.replace(/[^a-zA-Z0-9\s]/g, '')),
    
    // 5) Change 2 and remove any non alphanum chars
    applyBase(title.replace(/\(([^)]+)\)\s*$/, '$1').replace(/[^a-zA-Z0-9\s]/g, '')),
    
    // 6) Change 3 and remove any non alphanum chars
    applyBase(title.replace(/\([^)]+\)\s*$/, '').replace(/[^a-zA-Z0-9\s]/g, ''))
  ];
}

/**
 * Check if two show names match using normalize-style logic
 */
function showNamesMatch(tvdbShowName, searchShowName) {
  const tvdbVariations = cleanVariations(tvdbShowName);
  const searchVariations = cleanVariations(searchShowName);
  
  for (const tvdbVar of tvdbVariations) {
    for (const searchVar of searchVariations) {
      if (tvdbVar === searchVar) {
        return true;
      }
    }
  }
  return false;
}

export const getSeriesMap = async (show) => {
  // Search for the show on tvdb
  const searchResults = await srchTvdbData(show.Name);
  if (!searchResults || searchResults.length === 0) {
    console.error('getSeriesMap: no results found for:', show.Name);
    return [];
  }
  
  // Find best matching show using matching logic
  let bestMatch = null;
  
  for (const result of searchResults) {
    if (showNamesMatch(result.name, show.Name)) {
      // If multiple matches, prefer exact case or first match
      const resultName = result.name.toUpperCase();
      const showName = show.Name.toUpperCase();
      
      if (!bestMatch || resultName === showName) {
        bestMatch = result;
        if (resultName === showName) break; // Stop if exact match found
      }
    }
  }
  
  if (!bestMatch) {
    console.error('getSeriesMap: no matching show found for:', show.Name);
    return [];
  }
  
  const tvdbId = bestMatch.tvdb_id || bestMatch.id;
  if (!tvdbId) {
    console.error('getSeriesMap: no tvdb_id in best match for:', show.Name);
    return [];
  }
  
  // matched show found; proceed to fetch episodes
  
  const seriesMap = [];
  let allEpisodes = [];
  let page = 0;
  let safety = 0;
  const seenPages = new Set();
  // fetch all episodes across pages
  
  // Fetch all episodes with pagination using /episodes/default endpoint
  while (true) {
    seenPages.add(page);

    const episodesUrl = `series/${tvdbId}/episodes/default?page=${page}&seasonType=official&perPage=100`;
    
    let episodesRes;
    try {
      episodesRes = await tvdbFetch(episodesUrl);
    } catch (e) {
      console.error('getSeriesMap: failed to fetch episodes:', {tvdbId, page, err: e?.message || e});
      break;
    }
    const episodesObj = await episodesRes.json();
    const episodes = episodesObj.data?.episodes || [];
    const links = episodesObj.links || {};
    
    allEpisodes = allEpisodes.concat(episodes);
    
    // Derive the next page from the link value (could be number or URL string)
    let nextPage = null;
    if (links.next !== undefined && links.next !== null) {
      if (Number.isFinite(links.next)) {
        nextPage = links.next;
      } else if (typeof links.next === 'string') {
        const match = links.next.match(/page=(\d+)/);
        if (match) nextPage = Number(match[1]);
      } else if (links.next) {
        // Fallback: any truthy next means try the next integer page
        nextPage = page + 1;
      }
    }

    if (nextPage === null) break;
    if (seenPages.has(nextPage)) break; // avoid loops
    if (safety++ > 50) break; // hard cap
    page = nextPage;
  }
  
  // finished fetching all episodes
  
  // Group episodes by season
  const seasonMap = {};
  for (const epData of allEpisodes) {
    const seasonNum =
      epData.seasonNumber ??
      epData.airedSeason ??
      epData.airedSeasonNumber ??
      epData.season ??
      (typeof epData.seasonName === 'string' && epData.seasonName.match(/\d+/) ? Number(epData.seasonName.match(/\d+/)[0]) : undefined);

    const episodeNum = epData.number ?? epData.airedEpisodeNumber ?? epData.episodeNumber;
    
    if (seasonNum === undefined || seasonNum === null || seasonNum === 0) continue; // Skip specials (season 0)
    
    if (!seasonMap[seasonNum]) {
      seasonMap[seasonNum] = [];
    }
    
    // Compute unaired/avail using aired date if present
    let unaired = true;
    let avail = false;
    if (epData.aired) {
      try {
        const airedDate = new Date(epData.aired);
        const today = new Date();
        // Compare by date only (ignore timezones): aired <= today -> not unaired
        const airedYMD = new Date(airedDate.getFullYear(), airedDate.getMonth(), airedDate.getDate());
        const todayYMD = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        unaired = airedYMD > todayYMD;
        avail = !unaired;
      } catch(e) {
        unaired = false;
        avail = true;
      }
    }

    seasonMap[seasonNum].push([episodeNum, {
      error: false,
      played: false,      // tvdb doesn't track watch status
      avail: avail,
      noFile: true,       // tvdb provides no file info
      unaired: unaired,
      deleted: false
    }]);
  }
  
  // Convert to seriesMap format (season number sorted)
  const seasonNums = Object.keys(seasonMap).map(Number).sort((a, b) => a - b);
  for (const seasonNum of seasonNums) {
    seriesMap.push([seasonNum, seasonMap[seasonNum]]);
  }
  return seriesMap;
}