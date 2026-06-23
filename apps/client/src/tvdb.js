import * as srvr from "./srvr.js";
import * as util from "./util.js";
import { config } from "./config.js";
import { episodeDataToWatchedEpis } from "@tv/share";

// Route TVDB calls through the local torrents server proxy via WebSocket.
// This avoids browser-to-TVDB CORS issues (Authorization header) and keeps secrets on server.

async function tvdbFetch(pathStr, _init, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

  // Parse pathStr into path and query
  const [pathOnly, queryStr] = String(pathStr).split("?");
  const query = {};
  if (queryStr) {
    const usp = new URLSearchParams(queryStr);
    for (const [k, v] of usp) query[k] = v;
  }

  try {
    // Call server
    const res = await srvr.accessTvdb({ path: pathOnly, query });

    if (!res.ok) {
      const errData = res.data || res.error;
      throw new Error(
        `tvdb proxy error: ${res.status} ${typeof errData === "string" ? errData : JSON.stringify(errData)}`.trim(),
      );
    }

    // Mock a Response-like object for compatibility
    return {
      ok: true,
      status: res.status,
      json: () => Promise.resolve(res.data),
      text: () =>
        Promise.resolve(
          typeof res.data === "string" ? res.data : JSON.stringify(res.data),
        ),
    };
  } catch (e) {
    // Retry on network errors
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.warn(
        `tvdbFetch: network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES}):`,
        pathStr,
        e?.message || e,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return tvdbFetch(pathStr, _init, retryCount + 1);
    }
    // Max retries exceeded
    throw e;
  }
}

let allTvdb = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchAllTvdbWithRetry = async (hasEmby = 0) => {
  const retryDelays = [500, 1500];
  let lastErr = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await srvr.getAllTvdb(hasEmby);
    } catch (err) {
      lastErr = err;
      if (attempt === retryDelays.length) break;
      console.warn(
        `getAllTvdb failed, retrying in ${retryDelays[attempt]}ms (attempt ${attempt + 1}/${retryDelays.length + 1})`,
        err,
      );
      await delay(retryDelays[attempt]);
    }
  }

  throw lastErr;
};

// Apply a server-pushed tvdb record into the client allTvdb cache.
// Called by components that listen for tvdbUpdated socket events.
export const applyTvdbPush = (name, record) => {
  if (!allTvdb || !name || !record) return;
  allTvdb[name] = record;
};

export const clearCache = () => {
  allTvdb = null;
};

const normalizeTvdbId = (id) => String(id || "").trim();

export const findTvdbKeyById = (tvdbMap, tvdbId) => {
  const wantedId = normalizeTvdbId(tvdbId);
  if (!wantedId) return null;
  for (const [key, rec] of Object.entries(tvdbMap || {})) {
    const recId = normalizeTvdbId(rec?.tvdbId || rec?.tvdbId);
    if (recId && recId === wantedId) return key;
  }
  return null;
};

export const getTvdbRecordByNameOrId = (tvdbMap, showName, tvdbId) => {
  const keyName = String(showName || "").trim();
  if (keyName && tvdbMap?.[keyName]) {
    return { key: keyName, record: tvdbMap[keyName] };
  }

  const idKey = findTvdbKeyById(tvdbMap, tvdbId);
  if (idKey) {
    return { key: idKey, record: tvdbMap[idKey] };
  }

  return { key: null, record: null };
};

export const upsertTvdbCacheRecord = (tvdbMap, tvdbData, preferredKey = "") => {
  if (!tvdbMap || !tvdbData || typeof tvdbData !== "object") return null;

  const recordId = normalizeTvdbId(tvdbData.tvdbId || tvdbData.tvdbId);
  const nameKey = String(tvdbData.name || tvdbData.name || "").trim();
  const preferred = String(preferredKey || "").trim();

  let targetKey = nameKey || preferred;
  if (recordId) {
    const existingKey = findTvdbKeyById(tvdbMap, recordId);
    if (existingKey) targetKey = existingKey;
  }

  if (!targetKey) return null;

  const existing = tvdbMap[targetKey];
  // Preserve cached remotes if the incoming record has none (e.g. transient fetch skips getRemotes).
  if (
    existing &&
    (!tvdbData.remotes || tvdbData.remotes.length === 0) &&
    Array.isArray(existing.remotes) &&
    existing.remotes.length > 0
  ) {
    tvdbData = { ...tvdbData, remotes: existing.remotes };
  }

  tvdbMap[targetKey] = tvdbData;

  if (recordId) {
    for (const key of Object.keys(tvdbMap)) {
      if (key === targetKey) continue;
      const recId = normalizeTvdbId(
        tvdbMap[key]?.tvdbId || tvdbMap[key]?.tvdbId,
      );
      if (recId && recId === recordId) {
        delete tvdbMap[key];
      }
    }
  }

  return targetKey;
};

// Helper functions for watchedEpis format
/**
 * Extract watchedEpis from seriesMap
 * @param {Array} seriesMap - Format: [[seasonNum, [[epNum, {played, ...}], ...]], ...]
 * @returns {Array} watchedEpis - Format: [[seasonNum, ep1, ep2, ...], ...]
 */
export function seriesMapToWatchedEpis(seriesMap) {
  if (!seriesMap || !Array.isArray(seriesMap)) return [];

  const watchedEpis = [];
  for (const [seasonNum, episodes] of seriesMap) {
    if (!Array.isArray(episodes)) continue;

    const watchedEps = [];
    for (const [episodeNum, epiObj] of episodes) {
      if (epiObj?.played) {
        watchedEps.push(episodeNum);
      }
    }

    // Only include seasons that have watched episodes
    if (watchedEps.length > 0) {
      watchedEps.sort((a, b) => a - b);
      watchedEpis.push([seasonNum, ...watchedEps]);
    }
  }

  return watchedEpis;
}

/**
 * Apply watchedEpis to seriesMap (set played status)
 * @param {Array} seriesMap - Format: [[seasonNum, [[epNum, {played, ...}], ...]], ...]
 * @param {Array} watchedEpis - Format: [[seasonNum, ep1, ep2, ...], ...]
 * @returns {Array} Updated seriesMap with played status
 */
function applyWatchedEpisToSeriesMap(seriesMap, watchedEpis) {
  if (!seriesMap || !Array.isArray(seriesMap)) return seriesMap;
  if (!watchedEpis || !Array.isArray(watchedEpis)) return seriesMap;

  // Build a Set of watched episodes for quick lookup
  const watchedSet = new Map();
  for (const seasonEntry of watchedEpis) {
    if (!Array.isArray(seasonEntry) || seasonEntry.length < 1) continue;
    const [seasonNum, ...episodes] = seasonEntry;
    watchedSet.set(seasonNum, new Set(episodes));
  }

  // Apply played status to seriesMap
  const updatedMap = [];
  for (const [seasonNum, episodes] of seriesMap) {
    const watched = watchedSet.get(seasonNum);
    const updatedEpisodes = [];

    for (const [episodeNum, epiObj] of episodes) {
      const played = watched ? watched.has(episodeNum) : false;
      updatedEpisodes.push([episodeNum, { ...epiObj, played }]);
    }

    updatedMap.push([seasonNum, updatedEpisodes]);
  }

  return updatedMap;
}

export const getAllTvdb = async (hasEmby = 0) => {
  // all data in tvdb.json
  // cached in allTvdb
  // Only cache if hasEmby === 0 (all shows)
  if (hasEmby === 0 && allTvdb) return allTvdb;

  const result = await fetchAllTvdbWithRetry(hasEmby);

  // Only update cache if we're loading all shows
  if (hasEmby === 0) {
    allTvdb = result;
  }

  return result;
};

// Centralized remotes fetching with cache
// Tracks in-flight requests to prevent duplicate fetches
const remotesCache = new Map();
const activeRemotesRequests = new Map();

export const getRemotes = async (
  showName,
  tvdbId,
  remoteIds = [],
  showContext = null,
  fast = true,
) => {
  // Ensure allTvdb is loaded
  if (!allTvdb) await getAllTvdb();

  // Create cache key (include fast flag to separate fast/full caches)
  const key = `${tvdbId || showName}|fast:${fast}`;
  if (!key) return [];

  // Check if already in allTvdb cache (only use cache if it has results)
  // Only use cache for fast requests (full refreshes always fetch fresh)
  if (fast) {
    const found = getTvdbRecordByNameOrId(allTvdb, showName, tvdbId).record;
    const cachedRemotes = Array.isArray(found?.remotes) ? found.remotes : [];
    const hasCachedRemotes = cachedRemotes.length > 0;

    if (hasCachedRemotes) {
      // If caller provides inEmby context, cached remotes must match it.
      // This avoids stale cache showing no Emby button right after a show is added.
      const expectedInEmby =
        showContext?.inEmby === undefined ? null : showContext.inEmby !== false;
      const hasEmbyRemote = cachedRemotes.some((r) => r?.name === "Emby");
      const cacheMatchesInEmby =
        expectedInEmby === null ||
        (expectedInEmby ? hasEmbyRemote : !hasEmbyRemote);

      if (cacheMatchesInEmby) {
        return cachedRemotes;
      }
    }
  }

  // Check if in-flight request exists
  if (activeRemotesRequests.has(key)) {
    return activeRemotesRequests.get(key);
  }

  // Create the fetch promise
  const fetchPromise = (async () => {
    try {
      const params = {
        show: {
          name: showName,
          tvdbId: tvdbId,
          // Include inEmby and Id from showContext if available
          ...(showContext?.inEmby !== undefined && {
            inEmby: showContext.inEmby,
          }),
          ...(showContext?.id !== undefined &&
            showContext.id !== null && { id: showContext.id }),
        },
        tvdbRemotes: remoteIds,
        fast: fast,
      };

      const res = await srvr.getRemotesCmd(params);
      const results = Array.isArray(res) ? res : [];

      // Store in allTvdb cache if we have a showName and allTvdb entry exists
      // Only cache fast results (full results may have time-sensitive data)
      if (fast && showName && allTvdb) {
        const found = getTvdbRecordByNameOrId(allTvdb, showName, tvdbId);
        const key = found.key || showName;
        if (!allTvdb[key]) allTvdb[key] = {};
        allTvdb[key].remotes = results;
      }

      return results;
    } catch (err) {
      console.error("getRemotes:", err);
      return [];
    } finally {
      activeRemotesRequests.delete(key);
    }
  })();

  // Track in-flight request
  activeRemotesRequests.set(key, fetchPromise);

  return fetchPromise;
};

//////////// search for TvDb Data //////////////

export const srchTvdbData = async (searchStr) => {
  let query = searchStr;
  let year = "";

  // Check for (YYYY) at the end, as supplied by browse.js
  const yearMatch = query.match(/\((\d{4})\)$/);
  if (yearMatch) {
    year = yearMatch[1];
    query = query.replace(/\s*\(\d{4}\)$/, "").trim();
  }

  let srchUrl = "search?type=series&query=" + encodeURIComponent(query);
  if (year) {
    srchUrl += "&year=" + encodeURIComponent(year);
  }

  const srchRes = await tvdbFetch(srchUrl);
  const srchResObj = await srchRes.json();
  const data = srchResObj.data;
  if (!data || data.length == 0) return null;
  return data;
};

export const getGenresByTvdbId = async (tvdbId) => {
  if (!tvdbId) return [];
  try {
    const res = await tvdbFetch(`series/${tvdbId}/extended`);
    const obj = await res.json();
    return obj?.data?.genres?.map((g) => g.name).filter(Boolean) || [];
  } catch (e) {
    return [];
  }
};

export const getTvdbByImdbId = async (imdbId) => {
  if (!imdbId) return null;
  try {
    const res = await tvdbFetch(
      "search/remoteid/" + encodeURIComponent(imdbId),
    );
    const obj = await res.json();
    const item = obj?.data?.[0];
    return item?.series?.id ?? item?.tvdb_id ?? null;
  } catch (e) {
    return null;
  }
};

export const getTvdbSearchByImdbId = async (imdbId) => {
  if (!imdbId) return null;
  try {
    const res = await tvdbFetch(
      "search/remoteid/" + encodeURIComponent(imdbId),
    );
    const obj = await res.json();
    const item = obj?.data?.[0];
    if (!item) return null;
    // remoteid endpoint nests data under item.series or item.movie
    const s = item.series;
    if (!s) {
      // it's a movie or unknown type
      const m = item.movie;
      if (m) return { isMovie: true, name: m.name };
      return null;
    }
    return {
      id: s.id,
      tvdb_id: s.id,
      name: s.name,
      year: s.year,
      image_url: s.image,
      thumbnail: s.image,
      overview: s.overview,
      primary_language: s.originalLanguage,
      country: s.originalCountry,
    };
  } catch (e) {
    return null;
  }
};

//////////// get episode data //////////////

export const getEpisode = async (showName, seasonNum, episodeNum) => {
  // Get series ID from allTvdb
  if (!allTvdb) await getAllTvdb();
  const tvdbData = getTvdbRecordByNameOrId(allTvdb, showName, null).record;

  if (!tvdbData || !tvdbData.tvdbId) {
    console.error("getEpisode: no tvdbId found for show:", showName);
    return null;
  }

  const seriesId = tvdbData.tvdbId;

  // Fetch episodes to get episode ID
  const episodeUrl = `series/${seriesId}/episodes/default?season=${seasonNum}&episodeNumber=${episodeNum}`;

  const episodeRes = await tvdbFetch(episodeUrl);
  const episodeResObj = await episodeRes.json();
  const episodes = episodeResObj.data?.episodes;

  if (!episodes || episodes.length === 0) {
    console.error("getEpisode: no episode found for:", {
      showName,
      seasonNum,
      episodeNum,
    });
    return null;
  }

  const episodeId = episodes[0].id;

  // Fetch and return extended episode data
  const extendedUrl = `episodes/${episodeId}/extended`;

  const extendedRes = await tvdbFetch(extendedUrl);
  const extendedResObj = await extendedRes.json();
  return extendedResObj.data;
};

//////////// look up a person's image across all cached shows //////////////

export const getPersonImageFromCache = (personName) => {
  if (!allTvdb || !personName) return null;
  const norm = String(personName).trim().toLowerCase();
  for (const showRecord of Object.values(allTvdb)) {
    if (!Array.isArray(showRecord?.characters)) continue;
    for (const char of showRecord.characters) {
      if (
        String(char.actor || "")
          .trim()
          .toLowerCase() === norm &&
        char.image
      ) {
        return char.image;
      }
    }
  }
  return null;
};

//////////// get episode guest actors //////////////

export const getEpisodeGuests = async (showName, seasonNum, episodeNum) => {
  try {
    // First check if we have episode data in allTvdb cache
    if (!allTvdb) await getAllTvdb();
    const tvdbData = getTvdbRecordByNameOrId(allTvdb, showName, null).record;

    if (tvdbData?.seasons?.[seasonNum]?.episodes?.[episodeNum]?.characters) {
      // Episode guest data exists in cache
      const characters =
        tvdbData.seasons[seasonNum].episodes[episodeNum].characters;
      const guests = characters
        .filter((char) => char.type === 3 || char.isFeatured === false)
        .map((char) => ({
          name: char.name,
          personName: char.personName,
          image: char.image || null,
          personImgURL: char.image || null,
          url: null,
          type: char.type,
          isFeatured: char.isFeatured,
        }));
      return guests;
    }

    // Fall back to API call if not in cache
    const episodeData = await getEpisode(showName, seasonNum, episodeNum);

    if (!episodeData || !episodeData.characters) {
      return [];
    }

    // Filter for guest stars (type 3 or isFeatured false)
    const guests = episodeData.characters
      .filter((char) => char.type === 3 || char.isFeatured === false)
      .map((char) => ({
        name: char.name,
        personName: char.personName,
        image: char.image || null,
        personImgURL: char.image || null,
        url: null,
        type: char.type,
        isFeatured: char.isFeatured,
      }));

    return guests;
  } catch (error) {
    console.error("getEpisodeGuests error:", error);
    return [];
  }
};

//////////// get series map from tvdb //////////////

/**
 * Match a show name using the same logic as normalize
 * Cleans both names and compares multiple variations
 */
function cleanVariations(title) {
  const applyBase = (t) => {
    return t
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
      .trim() // Trim whitespace
      .replace(/\s+/g, " ") // Collapse whitespace to single space
      .replace(/\b(and|the)\b/gi, "") // Remove words "and" and "the"
      .replace(/\s+/g, " ") // Collapse whitespace again
      .trim() // Trim again
      .toUpperCase(); // Convert to uppercase
  };

  return [
    // 1) Just base changes
    applyBase(title),

    // 2) Remove paren chars at end leaving contents
    applyBase(title.replace(/\(([^)]+)\)\s*$/, "$1")),

    // 3) Remove paren chars at end including contents
    applyBase(title.replace(/\([^)]+\)\s*$/, "")),

    // 4) Remove any non alphanum chars
    applyBase(title.replace(/[^a-zA-Z0-9\s]/g, "")),

    // 5) Change 2 and remove any non alphanum chars
    applyBase(
      title.replace(/\(([^)]+)\)\s*$/, "$1").replace(/[^a-zA-Z0-9\s]/g, ""),
    ),

    // 6) Change 3 and remove any non alphanum chars
    applyBase(
      title.replace(/\([^)]+\)\s*$/, "").replace(/[^a-zA-Z0-9\s]/g, ""),
    ),
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
  const showNameStr = show.name || show.name;
  // Search for the show on tvdb
  const searchResults = await srchTvdbData(showNameStr);
  if (!searchResults || searchResults.length === 0) {
    console.error("getSeriesMap: no results found for:", showNameStr);
    return [];
  }

  // Find best matching show using matching logic
  let bestMatch = null;

  for (const result of searchResults) {
    if (showNamesMatch(result.name, showNameStr)) {
      // If multiple matches, prefer exact case or first match
      const resultName = result.name.toUpperCase();
      const targetName = showNameStr.toUpperCase();

      if (!bestMatch || resultName === targetName) {
        bestMatch = result;
        if (resultName === targetName) break; // Stop if exact match found
      }
    }
  }

  if (!bestMatch) {
    console.error("getSeriesMap: no matching show found for:", showNameStr);
    return [];
  }

  const tvdbId = bestMatch.tvdb_id || bestMatch.id;
  if (!tvdbId) {
    console.error("getSeriesMap: no tvdb_id in best match for:", showNameStr);
    return [];
  }

  const seriesMap = await getSeriesMapByTvdbId(tvdbId);

  return seriesMap;
};

export const getSeriesMapByTvdbId = async (tvdbId) => {
  if (!tvdbId) return [];

  // Try to find watchedEpis from allTvdb if available
  let watchedEpis = null;
  if (allTvdb) {
    // Find the show with this tvdbId (coerce to string to handle number/string mismatch)
    for (const [showName, tvdbRecord] of Object.entries(allTvdb)) {
      if (String(tvdbRecord.tvdbId) === String(tvdbId)) {
        watchedEpis = episodeDataToWatchedEpis(tvdbRecord.episodeData);
        break;
      }
    }
  }

  // Fetch episodes directly by TVDB id (avoids name-search mismatch).
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
      console.error("getSeriesMap: failed to fetch episodes. Aborting.", {
        tvdbId,
        page,
        url: episodesUrl,
        error: e,
        message: e.message,
        // If it's a network error, it might not have status, but if it came from proxy it might
      });
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
      } else if (typeof links.next === "string") {
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
      (typeof epData.seasonName === "string" && epData.seasonName.match(/\d+/)
        ? Number(epData.seasonName.match(/\d+/)[0])
        : undefined);

    const episodeNum =
      epData.number ?? epData.airedEpisodeNumber ?? epData.episodeNumber;

    if (seasonNum === undefined || seasonNum === null || seasonNum === 0)
      continue; // Skip specials (season 0)

    if (!seasonMap[seasonNum]) {
      seasonMap[seasonNum] = [];
    }

    // Unknown air-date should not be treated as unaired.
    let unaired = false;
    let avail = false;
    if (epData.aired) {
      try {
        const airedDate = new Date(epData.aired);
        if (Number.isNaN(airedDate.getTime())) {
          throw new Error("invalid aired date");
        }
        const today = new Date();
        // Compare by date only (ignore timezones): aired <= today -> not unaired
        const airedYMD = new Date(
          airedDate.getFullYear(),
          airedDate.getMonth(),
          airedDate.getDate(),
        );
        const todayYMD = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        );
        unaired = airedYMD > todayYMD;
        avail = !unaired;
      } catch (e) {
        unaired = false;
        avail = false;
      }
    }

    seasonMap[seasonNum].push([
      episodeNum,
      {
        error: false,
        played: false, // tvdb doesn't track watch status
        avail: avail,
        noFile: true, // tvdb provides no file info
        unaired: unaired,
        deleted: false,
        aired: epData.aired || null, // Include aired date for WaitStr
      },
    ]);
  }

  // Convert to seriesMap format (season number sorted)
  const seasonNums = Object.keys(seasonMap)
    .map(Number)
    .sort((a, b) => a - b);
  for (const seasonNum of seasonNums) {
    seriesMap.push([seasonNum, seasonMap[seasonNum]]);
  }

  // Apply watchedEpis if available
  if (watchedEpis && watchedEpis.length > 0) {
    return applyWatchedEpisToSeriesMap(seriesMap, watchedEpis);
  }

  return seriesMap;
};

export const fetchExtendedForCrew = async (tvdbId) => {
  if (!tvdbId) return [];
  const res = await srvr.getTvmazeCrew({ tvdbId });
  return Array.isArray(res) ? res : [];
};
