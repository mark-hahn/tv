import * as srvr from "./srvr.js";
import * as util from "./util.js";

let theTvdbToken = null;

let allTvdb = null;
export const getAllTvdb = async () => {
  // all data in tvdb.json
  // cached in allTvdb
  allTvdb ??= await srvr.getAllTvdb();
  return allTvdb;
}

///////////// get theTvdbToken //////////////
// this is a duplicate of the server
// both access tvdb.com independently
const getToken = async () => {
  const loginResp = await fetch(
    'https://api4.thetvdb.com/v4/login', 
    { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 
        JSON.stringify({
            "apikey": "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df",
            "pin": "HXEVSDFF"
        })
    }
  );
  if (!loginResp.ok) {
    console.error(`FATAL: TvDbToken Response: ${loginResp.status}`);
    process.exit();
  }
  const loginJSON = await loginResp.json();
  theTvdbToken = loginJSON.data.token;
}

//////////// search for TvDb Data //////////////

export const srchTvdbData = async (searchStr) => {
  if(!theTvdbToken) await getToken();
  const srchUrl = 'https://api4.thetvdb.com/v4/' +
                  'search?type=series&query='    + 
                   encodeURIComponent(searchStr);
  const srchRes = await fetch(srchUrl,
                    {headers: {
                      'Content-Type': 'application/json',
                      Authorization:'Bearer ' + theTvdbToken}
                    });
  if (!srchRes.ok) {
    console.error(`tvdb search error:`, {searchStr}, srchRes.status);
    return null;
  }
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
  if (!theTvdbToken) await getToken();
  
  // Get series ID from allTvdb
  if (!allTvdb) await getAllTvdb();
  const tvdbData = allTvdb[showName];
  
  if (!tvdbData || !tvdbData.tvdbId) {
    console.error('getEpisode: no tvdbId found for show:', showName);
    return null;
  }
  
  const seriesId = tvdbData.tvdbId;
  
  // Fetch episodes to get episode ID
  const episodeUrl = `https://api4.thetvdb.com/v4/series/${seriesId}/episodes/default?season=${seasonNum}&episodeNumber=${episodeNum}`;
  
  const episodeRes = await fetch(episodeUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + theTvdbToken
    }
  });
  
  if (!episodeRes.ok) {
    console.error(`tvdb episode fetch error:`, {showName, seasonNum, episodeNum, status: episodeRes.status});
    return null;
  }
  
  const episodeResObj = await episodeRes.json();
  const episodes = episodeResObj.data?.episodes;
  
  if (!episodes || episodes.length === 0) {
    console.error('getEpisode: no episode found for:', {showName, seasonNum, episodeNum});
    return null;
  }
  
  const episodeId = episodes[0].id;
  
  // Fetch and return extended episode data
  const extendedUrl = `https://api4.thetvdb.com/v4/episodes/${episodeId}/extended`;
  
  const extendedRes = await fetch(extendedUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + theTvdbToken
    }
  });
  
  if (!extendedRes.ok) {
    console.error('getEpisode: failed to fetch extended data:', {episodeId, status: extendedRes.status});
    return null;
  }
  
  const extendedResObj = await extendedRes.json();
  return extendedResObj.data;
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
  if (!theTvdbToken) await getToken();
  
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

    const episodesUrl = `https://api4.thetvdb.com/v4/series/${tvdbId}/episodes/default?page=${page}&seasonType=official&perPage=100`;
    
    const episodesRes = await fetch(episodesUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + theTvdbToken
      }
    });
    
    if (!episodesRes.ok) {
      console.error('getSeriesMap: failed to fetch episodes:', {tvdbId, page, status: episodesRes.status});
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
    
    // Compute only unaired using aired date; avail is always false since noFile=true
    let unaired = true;
    if (epData.aired) {
      try {
        const airedDate = new Date(epData.aired);
        const today = new Date();
        // Compare by date only (ignore timezones): aired <= today -> not unaired
        const airedYMD = new Date(airedDate.getFullYear(), airedDate.getMonth(), airedDate.getDate());
        const todayYMD = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        unaired = airedYMD > todayYMD;
      } catch(e) {
        unaired = false; // Default to aired if date parse fails
      }
    }

    seasonMap[seasonNum].push([episodeNum, {
      error: false,
      played: false,      // tvdb doesn't track watch status
      avail: false,       // Always false: tvdb provides no file info (noFile=true)
      noFile: true,       // tvdb provides no file info
      unaired: unaired,   // Only useful flag: based on aired date vs today
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