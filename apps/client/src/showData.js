import * as tvdb from "./tvdb.js";
import * as srvr from "./srvr.js";
import { episodeDataToWatchedEpis } from "@tv/share";
import { logHere } from "./log.js";
import { unilog } from "./log.js";

let allShows = null;

function isTvdbShowRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }
  const recName =
    typeof record.name === "string"
      ? record.name.trim()
      : typeof record.Name === "string"
        ? record.Name.trim()
        : "";
  return !!recName;
}

// Thin loadAllShows - fetches tvdb from server, applies computed props
export async function loadAllShows() {
  const loadStart = Date.now();
  const allTvdb = await tvdb.getAllTvdb(0);

  // Ensure computed properties are set
  for (const rec of Object.values(allTvdb)) {
    if (!isTvdbShowRecord(rec)) continue;
    tvdb.applyComputedProps(rec);
  }

  const showRecords = Object.values(allTvdb).filter((r) => isTvdbShowRecord(r));
  const elapsed = Date.now() - loadStart;
  unilog(2567, `loadAllShows completed in ${elapsed}ms, ${showRecords.length} shows`);
  allShows = showRecords;
  return { allShows: showRecords, allTvdb };
}

//////////// misc functions //////////////

// Gap checking is now done on the server
// Server will send updated tvdb data via WebSocket RPC

export const getSeriesMap = async (show, prune = false) => {

  // A show outside the library (or a preview) comes straight from TVDB.
  if (show.inLibrary === false) {
    const tvdbId = show.tvdbId;
    if (!tvdbId) {
      unilog(2568, `getSeriesMap: Preview show ${show.name} has no tvdbId`);
      return [];
    }
    try {
      const allTvdbData = await tvdb.getAllTvdb(0);
      // Get watchedEpis if it exists, otherwise pass undefined (not null)
      // Passing null means "unknown/cleared", passing undefined means "use default"
      // This preserves watchedCount when watchedEpis array is not available
      const tvdbRecord = allTvdbData?.[show.name];
      const watchedEpis = episodeDataToWatchedEpis(tvdbRecord?.episodeData);
      const result = await srvr.getSeriesMapFromTvdb({ tvdbId, watchedEpis });
      if (result.success && result.seriesMap) {
        return result.seriesMap;
      }
      unilog(2569, `getSeriesMap: Failed to fetch ${show.name} from TVDB: ${result.error}`);
      return [];
    } catch (err) {
      unilog(2570, `getSeriesMap: Error fetching ${show.name} from TVDB: ${err.message || err}`);
      return [];
    }
  }

  // Library shows come from tv-srvr, which refreshes episodeData from its
  // sources and builds the map from it, TVDB's episodes included.
  const res = await srvr.getSeriesMap({ showName: show.name });
  if (!res?.success || !Array.isArray(res.seriesMap))
    throw new Error(`getSeriesMap failed for ${show.name}: ${res?.error}`);
  const seriesMap = res.seriesMap;

  if (prune) {
    // Watched files go, in order, up to the first unwatched episode that
    // has a file.
    const pathsToDeleteBatch = [];
    stop: for (const [, episodes] of seriesMap) {
      for (const [, cell] of episodes) {
        if (!cell.played && cell.avail) break stop;
        if (cell.path) pathsToDeleteBatch.push(cell.path);
      }
    }
    if (pathsToDeleteBatch.length > 0) {
      unilog(2571, `batch deleting ${pathsToDeleteBatch.length} files for ${show.name}`);
      try {
        await srvr.deletePaths(pathsToDeleteBatch);
        unilog(2572, `batch delete ok for ${show.name}`);
      } catch (e) {
        unilog(2573, `batch delete FAILED for ${show.name}: ${e?.message ?? e}`);
      }
    }
  }

  return seriesMap;
};

export const createShowFolder = async ({
  showName,
  tvdbId,
  seriesMapSeasons,
  tvdbData,
  onStatus,
  createTimeoutMs = 15000,
} = {}) => {
  const withTimeout = async (promise, ms, label) => {
    const timeoutMs = Math.max(0, Number(ms) || 0);
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(
        () => reject(new Error(`timeout waiting for ${label}`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(t);
    }
  };

  const nameStr = String(showName || "").trim();
  const tvdbIdStr = String(tvdbId || "").trim();
  const hasTvdbData =
    !!tvdbData &&
    typeof tvdbData === "object" &&
    Object.keys(tvdbData).length > 0;
  const seasons = Array.isArray(seriesMapSeasons)
    ? seriesMapSeasons
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b)
    : [];

  if (!nameStr)
    return { createdFolder: false, status: "badargs", err: "missing showName" };
  if (!tvdbIdStr)
    return { createdFolder: false, status: "badargs", err: "missing tvdbId" };
  if (!hasTvdbData)
    return { createdFolder: false, status: "badargs", err: "missing tvdbData" };

  try {
    if (typeof onStatus === "function") onStatus("Creating folder...");
    await withTimeout(
      srvr.createShowFolder({
        showName: nameStr,
        tvdbId: tvdbIdStr,
        seriesMapSeasons: seasons,
        tvdbData,
      }),
      createTimeoutMs,
      "createShowFolder",
    );
  } catch (e) {
    return {
      createdFolder: false,
      status: "createfailed",
      err: e?.message || String(e),
    };
  }

  // tv-srvr puts the show in the library as it creates the folder.
  return { createdFolder: true, status: "ok" };
};

