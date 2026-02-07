import axios from "axios";
import * as tvdb from "./tvdb.js";
import * as srvr from "./srvr.js";
import * as urls from "./urls.js";
import * as util from "./util.js";
import evtBus from "./evtBus.js";

const gapWorker = new Worker(new URL("gap-worker.js", import.meta.url), {
  type: "module",
});

const name = "mark";
const pwd = "90-MNBbnmyui";
const apiKey = "1112c1f515824d66bf2f8618fdb67312";
const markUsrId = "894c752d448f45a3a1260ccaabd0adff";
const authHdr =
  `UserId="${markUsrId}", ` +
  'Client="MyClient", Device="myDevice", ' +
  'DeviceId="123456", Version="1.0.0"';

let token = "";
let cred = null;
let allTvdb = null;

////////////////////////  INIT  ///////////////////////

const getToken = async () => {
  const config = {
    method: "post",
    url:
      "https://hahnca.com:8920" +
      "/emby/Users/AuthenticateByName" +
      `?api_key=${apiKey}`,
    headers: { Authorization: authHdr },
    data: { Username: name, Pw: pwd },
  };
  const embyShows = await axios(config);
  token = embyShows.data.AccessToken;
};

export async function init() {
  await getToken();
  cred = { markUsrId, token };
  urls.init(cred);
}

let rejects = null;
let rejectsSet = null;

function normShowName(name) {
  if (name === undefined || name === null) return "";
  // Collapse any embedded newlines/tabs and extra spaces coming from JSON files.
  // Keep punctuation as-is (we still want exact-ish matching).
  return String(name)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const isReject = (name) => {
  if (!rejectsSet) return false;
  return rejectsSet.has(normShowName(name).toLowerCase());
};

// Phase 2: Helper function to sync collection flags into tvdb
async function syncCollections(allTvdb) {
  const [toTryRes, continueRes, markRes, lindaRes] = await Promise.all([
    axios.get(urls.collectionListUrl(cred, toTryCollId)),
    axios.get(urls.collectionListUrl(cred, continueCollId)),
    axios.get(urls.collectionListUrl(cred, markCollId)),
    axios.get(urls.collectionListUrl(cred, lindaCollId)),
  ]);

  const toTryIds = new Set(toTryRes.data.Items.map((i) => i.Id));
  const continueIds = new Set(continueRes.data.Items.map((i) => i.Id));
  const markIds = new Set(markRes.data.Items.map((i) => i.Id));
  const lindaIds = new Set(lindaRes.data.Items.map((i) => i.Id));

  for (const tvdb of Object.values(allTvdb)) {
    if (tvdb.deleted) continue;
    const embyId = tvdb.emby?.id;
    if (embyId && !embyId.startsWith("noemby-")) {
      tvdb.emby.inToTry = toTryIds.has(embyId);
      tvdb.emby.inContinue = continueIds.has(embyId);
      tvdb.emby.inMark = markIds.has(embyId);
      tvdb.emby.inLinda = lindaIds.has(embyId);
    }
  }
}

// Phase 2: Helper function to sync rejects and pickups into tvdb
function syncRejectsAndPickups(allTvdb, rejectsIn, pickups) {
  // Build normalized name lookup
  const showsByNormName = new Map();
  for (const [name, tvdb] of Object.entries(allTvdb)) {
    if (!tvdb.deleted) {
      const key = normShowName(name).toLowerCase();
      showsByNormName.set(key, tvdb);
    }
  }

  // Mark rejects in tvdb
  const rejectsList = (rejectsIn || []).map(normShowName).filter(Boolean);
  for (const rejectName of rejectsList) {
    const key = rejectName.toLowerCase();
    const tvdb = showsByNormName.get(key);
    if (tvdb) tvdb.reject = true;
  }

  // Mark pickups in tvdb
  for (const pickupName of pickups || []) {
    const key = normShowName(pickupName).toLowerCase();
    const tvdb = showsByNormName.get(key);
    if (tvdb) tvdb.pickup = true;
  }

  // Update module-level rejects for isReject()
  rejects = rejectsList;
  rejectsSet = new Set(rejects.map((n) => n.toLowerCase()));
}

// Phase 2: Helper function to set wait strings for shows
async function setWaitStrings(allTvdb) {
  for (const tvdb of Object.values(allTvdb)) {
    if (tvdb.deleted) continue;
    try {
      const show = { Name: tvdb.name, Id: tvdb.emby?.id };
      const waitStr = await tvdb.getWaitStr(show);
      if (waitStr) tvdb.waitStr = waitStr;
    } catch (e) {
      // Ignore errors
    }
  }
}

// Phase 2: Refactored loadAllShows - simplified, uses tvdb as source of truth
export async function loadAllShows() {
  const loadStart = Date.now();

  // 1. Fetch all data sources in parallel (HTTP is fast now!)
  const [embyShows, diskShows, rejectsIn, pickups, allTvdbResult] =
    await Promise.all([
      axios.get(urls.showListUrl(cred, 0, 10000)),
      srvr.getShowsFromDisk(),
      srvr.getRejects(),
      srvr.getPickups(),
      tvdb.getAllTvdb(),
    ]);

  // 2. Get authoritative tvdb data (our source of truth)
  // Note: gaps, notes, noEmbys now stored in tvdb.json (Phase 5)
  allTvdb = allTvdbResult;
  const now = Date.now();

  let shows = [];

  // 3. Sync Emby shows into tvdb (update tvdb records with Emby user data)
  for (const embyShow of embyShows.data.Items) {
    const name = embyShow.Name;
    const tvdbId = embyShow?.ProviderIds?.Tvdb || embyShow?.TvdbId;

    if (!tvdbId || tvdbId == "0") {
      console.error(`loadAllShows: no tvdbId for ${name}, deleting from Emby`);
      try {
        await deleteShowFromEmby(embyShow);
      } catch (e) {
        // ignore delete error
      }
      continue;
    }

    // Get disk info
    const embyPath = embyShow.Path.split("/").pop();
    const diskInfo = diskShows[embyPath];
    const diskDate = diskInfo ? diskInfo[0] : null;
    const diskSize = diskInfo ? diskInfo[1] : 0;
    const noFiles = !diskInfo;

    // Build update object with Emby + disk data
    const updateFields = {
      name,
      showId: embyShow.Id,
      tvdbId,
      embyPath,
      "emby.genres": embyShow.Genres || [],
      "emby.overview": embyShow.Overview || "",
      dateCreated: embyShow.DateCreated?.substring(0, 10),
      premiereDate: embyShow.PremiereDate?.substring(0, 10),
      isFavorite: embyShow.UserData?.IsFavorite || false,
      isPlayed: embyShow.UserData?.Played || false,
      playCount: embyShow.UserData?.PlayCount || 0,
      lastPlayedDate: embyShow.UserData?.LastPlayedDate || null,
      unplayedCount: embyShow.UserData?.UnplayedItemCount || 0,
      diskDate,
      diskSize,
      noFiles,
      lastEmbySync: now,
      lastDiskCheck: now,
    };

    // Create or update tvdb record
    let tvdbRecord = allTvdb[name];
    if (!tvdbRecord || tvdbRecord.showId !== embyShow.Id) {
      // Need to create/refresh tvdb record
      const reason = !tvdbRecord
        ? "no existing tvdb entry"
        : `showId mismatch (${tvdbRecord.showId} != ${embyShow.Id})`;

      console.log(`loadAllShows: creating/updating tvdb (${reason})`, {
        name,
        showId: embyShow.Id,
        tvdbId,
      });

      // Check for true mismatches (pop modal for user attention)
      if (
        tvdbRecord &&
        (tvdbRecord.showId !== embyShow.Id ||
          (tvdbRecord.tvdbId &&
            tvdbId &&
            String(tvdbRecord.tvdbId) !== String(tvdbId)))
      ) {
        evtBus.emit("tvdb-mismatch", {
          name,
          showId: embyShow.Id,
          tvdbId,
          existing: {
            tvdbId: tvdbRecord.tvdbId,
            showId: tvdbRecord.showId,
            deleted: tvdbRecord.deleted,
          },
        });
      }

      const epicounts = await getEpisodeCounts(embyShow);

      // Add TvdbId to show object for server request
      const showWithTvdbId = { ...embyShow, TvdbId: tvdbId };
      const param = Object.assign(
        { show: showWithTvdbId },
        epicounts,
        updateFields,
      );

      tvdbRecord = await srvr.getNewTvdb(param);
      allTvdb[name] = tvdbRecord;
    } else {
      // Update existing tvdb record with Emby user data
      tvdbRecord.emby = tvdbRecord.emby || {};
      tvdbRecord.disk = tvdbRecord.disk || {};
      tvdbRecord.sync = tvdbRecord.sync || {};

      tvdbRecord.emby.id = embyShow.Id;
      tvdbRecord.emby.path = embyPath;
      tvdbRecord.emby.genres = updateFields["emby.genres"];
      tvdbRecord.emby.overview = updateFields["emby.overview"];
      tvdbRecord.emby.dateCreated = updateFields.dateCreated;
      tvdbRecord.emby.premiereDate = updateFields.premiereDate;
      tvdbRecord.emby.isFavorite = updateFields.isFavorite;
      tvdbRecord.emby.isPlayed = updateFields.isPlayed;
      tvdbRecord.emby.playCount = updateFields.playCount;
      tvdbRecord.emby.lastPlayedDate = updateFields.lastPlayedDate;
      tvdbRecord.emby.unplayedCount = updateFields.unplayedCount;

      tvdbRecord.disk.date = diskDate;
      tvdbRecord.disk.size = diskSize;
      tvdbRecord.disk.noFiles = noFiles;

      // Note: gap and note already in tvdb (Phase 5), don't overwrite

      tvdbRecord.sync.lastEmbySync = now;
      tvdbRecord.sync.lastDiskCheck = now;
    }
  }

  // 4. Process noEmby shows (Phase 5: now stored in tvdb with noemby- IDs)
  const noEmbys = Object.values(allTvdb).filter((t) =>
    t.emby?.id?.startsWith("noemby-"),
  );
  const prunedNoEmbyIds = [];

  await Promise.all(
    noEmbys.map(async (noEmbyShow) => {
      const name = noEmbyShow.name;

      // Check if show now exists in Emby (upgrade scenario)
      const tvdbRecord = allTvdb[name];
      if (tvdbRecord?.emby?.id && !tvdbRecord.emby.id.startsWith("noemby-")) {
        // Show upgraded to Emby - copy collection flags
        console.log("upgrading noEmby to Emby:", name);

        try {
          if (noEmbyShow.emby.inToTry) {
            await saveToTry(tvdbRecord.emby.id, true);
            tvdbRecord.emby.inToTry = true;
          }
          if (noEmbyShow.emby.inContinue) {
            await saveContinue(tvdbRecord.emby.id, true);
            tvdbRecord.emby.inContinue = true;
          }
          if (noEmbyShow.emby.inMark) {
            await saveMark(tvdbRecord.emby.id, true);
            tvdbRecord.emby.inMark = true;
          }
          if (noEmbyShow.emby.inLinda) {
            await saveLinda(tvdbRecord.emby.id, true);
            tvdbRecord.emby.inLinda = true;
          }
        } catch (e) {
          console.error("loadAllShows: upgrade noEmby flags failed", name, e);
        }

        // Mark as deleted in tvdb (will be cleaned up)
        noEmbyShow.deleted = true;
        prunedNoEmbyIds.push(noEmbyShow.emby.id);
        return;
      }

      // Check if S01E01 is unaired (for WaitStr)
      try {
        const seriesMap = await tvdb.getSeriesMap(noEmbyShow);
        const s1 = seriesMap.find(([seasonNumber]) => seasonNumber === 1);
        if (s1) {
          const e1 = s1[1].find(([episodeNumber]) => episodeNumber === 1);
          if (e1?.[1]?.unaired === true) {
            noEmbyShow.S1E1Unaired = true;
            const airDate = e1?.[1]?.aired;
            if (airDate) {
              const dateStr = airDate.slice(5).replace(/^0/, " ").trim();
              noEmbyShow.waitStr = `{${dateStr}}`;
            }
          }
        }
      } catch (e) {
        console.error("loadAllShows: getSeriesMap error for noemby", name, e);
      }
    }),
  );

  // 5. Mark tvdb records as deleted if no matching show exists
  for (const [name, tvdbRecord] of Object.entries(allTvdb)) {
    if (tvdbRecord.deleted) continue;

    const hasEmby = embyShows.data.Items.some((s) => s.Name === name);
    const hasNoEmby = noEmbys.some((s) => s.name === name);

    if (!hasEmby && !hasNoEmby) {
      console.log(`loadAllShows: marking ${name} as deleted (no show found)`);
      allTvdb[name] = await srvr.setTvdbFields({
        name,
        deleted: util.fmtDate(),
        dontSave: true,
      });
    } else if (hasEmby && !tvdbRecord.showId) {
      // Has Emby show but tvdb missing showId - update it
      const embyShow = embyShows.data.Items.find((s) => s.Name === name);
      console.log(`loadAllShows: updating tvdb showId for ${name}`);
      allTvdb[name] = await srvr.setTvdbFields({
        name,
        showId: embyShow.Id,
        dontSave: true,
      });
    }
  }

  // 6. Sync collection flags (toTry, continue, mark, linda)
  await syncCollections(allTvdb);

  // 7. Sync rejects and pickups
  syncRejectsAndPickups(allTvdb, rejectsIn, pickups);

  // 8. Set WaitStr for shows with unaired episodes
  await setWaitStrings(allTvdb);

  // 9. Build show list from tvdb (return tvdb records as shows)
  // We need to convert back to old "show" format for compatibility with existing client code
  // In Phase 6, we'll update components to use new structure directly
  for (const [name, tvdbRecord] of Object.entries(allTvdb)) {
    if (tvdbRecord.deleted) continue;

    // Build show object in old format (for backward compatibility during transition)
    const show = {
      // Core identity
      Name: tvdbRecord.name,
      Id: tvdbRecord.emby?.id || `noemby-${tvdbRecord.tvdbId}`,
      TvdbId: tvdbRecord.tvdbId,

      // Emby data
      DateCreated: tvdbRecord.emby?.dateCreated || tvdbRecord.added,
      PremiereDate: tvdbRecord.emby?.premiereDate,
      IsFavorite: tvdbRecord.emby?.isFavorite,
      Played: tvdbRecord.emby?.isPlayed,
      PlayCount: tvdbRecord.emby?.playCount,
      LastPlayedDate: tvdbRecord.emby?.lastPlayedDate,
      Path: tvdbRecord.emby?.path,

      // Disk data
      Date: tvdbRecord.disk?.date || "2017-12-05",
      Size: tvdbRecord.disk?.size || 0,
      NoFiles: tvdbRecord.disk?.noFiles || false,

      // TVDB metadata
      OriginalCountry: tvdbRecord.originalCountry,
      Overview: tvdbRecord.emby?.overview || tvdbRecord.overview || "",
      Genres:
        tvdbRecord.emby?.genres || tvdbRecord.genres?.map((g) => g.name) || [],
      Ended: tvdbRecord.status === "Ended",
      LastAired: tvdbRecord.lastAired,
      Ratings: tvdbRecord.remotes?.find((r) => r.ratings)?.ratings || 0,
      averageRuntime: tvdbRecord.averageRuntime,

      // Collection flags
      InToTry: tvdbRecord.emby?.inToTry || false,
      InContinue: tvdbRecord.emby?.inContinue || false,
      InMark: tvdbRecord.emby?.inMark || false,
      InLinda: tvdbRecord.emby?.inLinda || false,

      // Other flags
      Reject: tvdbRecord.reject || false,
      Pickup: tvdbRecord.pickup || false,
      WaitStr: tvdbRecord.waitStr,
      NotReady: tvdbRecord.emby?.id?.startsWith("noemby-") || false,
      S1E1Unaired: false, // Will be set for noEmby shows above

      // Gap and notes
      ...tvdbRecord.gap, // Spread gap data if exists
      Notes: tvdbRecord.note || "",

      // Keep reference to tvdb record for internal use
      _tvdb: tvdbRecord,
    };

    shows.push(show);
  }

  // Phase 5: gaps, notes now stored in tvdb.json - no separate cleanup needed

  const elapsed = Date.now() - loadStart;
  console.log(`Phase 2: loadAllShows completed in ${elapsed}ms`);
  return shows;
}

//////////// misc functions //////////////

export function startGapWorker(allShows, cb) {
  gapWorker.onerror = (err) => {
    console.error("Worker:", err.message);
  };
  const allShowsIdName = [];
  for (let show of allShows) {
    const id = show.Id;
    if (id.startsWith("noemby-")) {
      show.NotReady = true;
      continue;
    }
    const tvdbData = allTvdb?.[show.Name] || {};
    allShowsIdName.push({
      showId: id,
      showName: show.Name,
      firstAired: tvdbData.firstAired,
      tvdbStatus: tvdbData.status,
    });
  }
  gapWorker.onmessage = cb;
  gapWorker.postMessage({ cred, allShowsIdName });
}

export function startUpdateWorker(allShows, cb) {
  gapWorker.onerror = (err) => {
    console.error("Worker:", err.message);
  };
  const allShowsIdName = [];
  for (let show of allShows) {
    const id = show.Id;
    if (id.startsWith("noemby-")) {
      show.NotReady = true;
      continue;
    }
    const tvdbData = allTvdb?.[show.Name] || {};
    allShowsIdName.push({
      showId: id,
      showName: show.Name,
      firstAired: tvdbData.firstAired,
      tvdbStatus: tvdbData.status,
    });
  }
  gapWorker.onmessage = cb;
  gapWorker.postMessage({ cred, allShowsIdName });
}

const toTryCollId = "1468316";
const continueCollId = "4719143";
const markCollId = "4697672";
const lindaCollId = "4706186";

export async function deleteShowFromEmby(show) {
  try {
    const url = urls.deleteShowUrl(cred, show.Id);
    const delRes = await axios.delete(url, {
      headers: {
        "X-Emby-Authorization": authHdr,
        "X-Emby-Token": cred.token,
      },
    });
    const res = delRes.status;
    if (res != 204) {
      const err = `unable to delete ${show.Name} from emby: ${delRes.data}`;
      console.error(err);
      return;
    }
    console.log("deleted show from emby:", show.Name);
  } catch (error) {
    const errData = error.response?.data || "";
    if (errData.includes("Directory not empty")) {
      const msg = `Cannot delete "${show.Name}" - directory still has files. Delete files from disk first.`;
      console.error(msg);
      alert(msg);
    } else {
      console.error("deleteShowFromEmby error:", error);
      console.error("Response data:", errData);
    }
    throw error;
  }
}

const deleteOneFile = async (path) => {
  if (!path) return;
  console.log("deleting file:", path);
  try {
    await srvr.deletePath(path);
  } catch (e) {
    console.error("deletePath:", path, e);
    throw e;
  }
};

// action from click on episode in map
export const editEpisode = async (
  seriesId,
  seasonNumIn,
  episodeNumIn,
  delFile = false,
  setWatched = null,
) => {
  let lastWatchedRec = null;

  const seasonsRes = await axios.get(urls.childrenUrl(cred, seriesId));
  for (let key in seasonsRes.data.Items) {
    let seasonRec = seasonsRes.data.Items[key];
    const seasonNumber = +seasonRec.IndexNumber;
    if (seasonNumber != seasonNumIn) continue;

    const seasonId = seasonRec.Id;
    const episodesRes = await axios.get(urls.childrenUrl(cred, seasonId));
    for (let key in episodesRes.data.Items) {
      const episodeRec = episodesRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      const userData = episodeRec?.UserData;
      const watched = userData?.Played;

      if (episodeNumber != episodeNumIn) {
        if (watched) lastWatchedRec = episodeRec;
        continue;
      }

      if (delFile) {
        const path = episodeRec?.MediaSources?.[0]?.Path;
        try {
          await srvr.deletePath(path);
        } catch (e) {
          console.error("deleteOneFile:", path, e);
          throw e;
        }
      }

      const episodeId = episodeRec.Id;
      userData.Played = setWatched !== null ? setWatched : !watched;
      if (!userData.LastPlayedDate) userData.LastPlayedDate = util.fmtDate();
      const url = urls.postUserDataUrl(cred, episodeId);
      const setDataRes = await axios({
        method: "post",
        url: url,
        data: userData,
      });
      // console.log("toggled watched", {
      //               episode: `S${seasonNumber}E${episodeNumber}`,
      //               post_url: url,
      //               post_res: setDataRes
      //             });
    }
  }
};

// reset last Watched to first unwatched episode
export const setLastWatched = async (seriesId) => {
  let seasonNumber;
  let lastWatchedEpisodeRec = null;
  const seasonsRes = await axios.get(urls.childrenUrl(cred, seriesId));
  seasonLoop: for (let key in seasonsRes.data.Items) {
    let seasonRec = seasonsRes.data.Items[key];
    seasonNumber = +seasonRec.IndexNumber;
    const seasonId = +seasonRec.Id;
    const episodesRes = await axios.get(urls.childrenUrl(cred, seasonId));
    for (let key in episodesRes.data.Items) {
      const episodeRec = episodesRes.data.Items[key];
      const userData = episodeRec?.UserData;
      const watched = userData?.Played;
      if (watched) lastWatchedEpisodeRec = episodeRec;
      else if (lastWatchedEpisodeRec) break seasonLoop;
    }
  }
  if (lastWatchedEpisodeRec) {
    console.log({ lastWatchedEpisodeRec });
    const episodeId = lastWatchedEpisodeRec.Id;
    const episodeNumber = +lastWatchedEpisodeRec.IndexNumber;
    const userData = lastWatchedEpisodeRec?.UserData;

    userData.LastPlayedDate = util.fmtDate();
    const url = urls.postUserDataUrl(cred, episodeId);
    const setDateRes = await axios({
      method: "post",
      url: url,
      data: userData,
    });
    console.log("set lastPlayedDate", {
      seasonNumber,
      episodeNumber,
      post_res: setDateRes,
    });
  }
};

export const getEpisodeCounts = async (show) => {
  const showId = show.Id;
  let seasonCount = 0;
  let episodeCount = 0;
  let watchedCount = 0;
  if (show.Id.startsWith("noemby-"))
    return { seasonCount, episodeCount, watchedCount };
  try {
    const seasonsRes = await axios.get(urls.childrenUrl(cred, showId));
    let skippedEpisodeCount = 0;
    const skippedEpisodes = [];
    for (let key in seasonsRes.data.Items) {
      const seasonRec = seasonsRes.data.Items[key];
      const seasonNumber = Number(seasonRec?.IndexNumber);

      // Ignore non-numbered / special seasons for aggregate counts (matches map behavior).
      if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
        continue;
      }

      seasonCount++;
      const seasonId = seasonRec.Id;
      const episodesRes = await axios.get(urls.childrenUrl(cred, seasonId));
      for (let key in episodesRes.data.Items) {
        const episodeRec = episodesRes.data.Items[key];
        const episodeNumber = Number(episodeRec?.IndexNumber);

        // Emby will sometimes return items that don't have a parsable episode number
        // (e.g. filenames like "S04.EXTRA..."). Don't count these, otherwise
        // Series pane totals can disagree with the Map (which effectively ignores them).
        if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) {
          skippedEpisodeCount++;
          if (skippedEpisodes.length < 10) {
            skippedEpisodes.push({
              seasonNumber,
              indexNumber: episodeRec?.IndexNumber,
              name: episodeRec?.Name,
              path: episodeRec?.Path,
            });
          }
          continue;
        }

        episodeCount++;
        const userData = episodeRec?.UserData;
        if (userData?.Played) watchedCount++;
      }
    }

    // Intentionally no logging here; we just skip malformed items.
  } catch (e) {
    console.error("getEpisodeCounts error:", e);
    return { seasonCount: 0, episodeCount: 0, watchedCount: 0 };
  }
  return { seasonCount, episodeCount, watchedCount };
};

export const getSeriesMap = async (show, prune = false) => {
  const seriesId = show.Id;

  // If this is a noemby show (from web search), return empty map
  if (seriesId.startsWith("noemby-")) {
    return [];
  }

  const seriesMap = [];
  let pruning = prune;
  const seasonsRes = await axios.get(urls.childrenUrl(cred, seriesId));
  for (let key in seasonsRes.data.Items) {
    let seasonRec = seasonsRes.data.Items[key];
    let seasonId = seasonRec.Id;
    const seasonNumber = +seasonRec.IndexNumber;
    const unairedObj = {};
    const unairedRes = await axios.get(urls.childrenUrl(cred, seasonId, true));
    for (let key in unairedRes.data.Items) {
      const episodeRec = unairedRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      unairedObj[episodeNumber] = true;
    }
    const episodes = [];
    const episodesRes = await axios.get(urls.childrenUrl(cred, seasonId));
    for (let key in episodesRes.data.Items) {
      let episodeRec = episodesRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      if (episodeNumber === undefined) continue;

      const path = episodeRec?.MediaSources?.[0]?.Path;
      const played = !!episodeRec?.UserData?.Played;
      const avail = episodeRec?.LocationType != "Virtual";
      const unaired = !!unairedObj[episodeNumber];

      if (avail && !path) {
        console.error(
          "avail without path",
          `S${seasonNumber}E${episodeNumber}`,
        );
        continue;
      }

      let deleted = false;
      if (pruning) {
        if (!played && avail) pruning = false;
        else {
          await deleteOneFile(path);
          deleted = avail; // set even if error
        }
      }

      const error =
        (seasonNumber == show.WatchGapSeason &&
          episodeNumber == show.WatchGapEpisode &&
          show.WatchGap) ||
        (seasonNumber == show.FileGapSeason &&
          episodeNumber == show.FileGapEpisode &&
          show.FileGap);

      const noFileVal = !path; // noFile is true when there's no path
      if (show.Name === "Pluribus" && unaired) {
        console.log(
          `Pluribus S${seasonNumber}E${episodeNumber}: path=${path}, unaired=${unaired}, noFile=${noFileVal}, played=${played}, avail=${avail}`,
        );
      }

      episodes.push([
        episodeNumber,
        { error, played, avail, noFile: noFileVal, unaired, deleted, path },
      ]);
    }
    seriesMap.push([seasonNumber, episodes]);
  }
  return seriesMap;
};

export async function saveFav(id, fav) {
  const config = {
    method: fav ? "post" : "delete",
    url: urls.favoriteUrl(cred, id),
  };
  let favRes = await axios(config);
  if (favRes.status != 200) throw new Error("unable to save favorite");

  // Phase 4: Update tvdb immediately
  const show = allShows.find((s) => s.Id === id);
  if (show && allTvdb[show.Name]) {
    allTvdb[show.Name].emby.isFavorite = fav;
    await srvr.setTvdbFields(show.Name, { "emby.isFavorite": fav });
  }
}

export async function saveToTry(id, inToTry) {
  const config = {
    method: inToTry ? "post" : "delete",
    url: urls.collectionUrl(cred, id, toTryCollId),
  };
  let toTryRes;
  try {
    toTryRes = await axios(config);
  } catch (e) {
    console.error(`saveToTry, id:${id}, inToTry:${inToTry}`);
    throw e;
  }
  if (toTryRes.status !== 204) {
    const err = "unable to save totry" + toTryRes.data;
    console.error(err);
    throw new Error(err);
  }

  // Phase 4: Update tvdb immediately
  const show = allShows.find((s) => s.Id === id);
  if (show && allTvdb[show.Name]) {
    allTvdb[show.Name].emby.inToTry = inToTry;
    await srvr.setTvdbFields(show.Name, { "emby.inToTry": inToTry });
  }
}

export async function saveContinue(id, inContinue) {
  const config = {
    method: inContinue ? "post" : "delete",
    url: urls.collectionUrl(cred, id, continueCollId),
  };
  let continueRes;
  try {
    continueRes = await axios(config);
  } catch (e) {
    console.error(`saveContinue, id:${id}, inContinue:${inContinue}`);
    throw e;
  }
  if (continueRes.status !== 204) {
    const err = "unable to save Continue" + continueRes.data;
    console.error(err);
    throw new Error(err);
  }

  // Phase 4: Update tvdb immediately
  const show = allShows.find((s) => s.Id === id);
  if (show && allTvdb[show.Name]) {
    allTvdb[show.Name].emby.inContinue = inContinue;
    await srvr.setTvdbFields(show.Name, { "emby.inContinue": inContinue });
  }
}

export async function saveMark(id, inMark) {
  const config = {
    method: inMark ? "post" : "delete",
    url: urls.collectionUrl(cred, id, markCollId),
  };
  let markRes;
  try {
    markRes = await axios(config);
  } catch (e) {
    console.error(`saveMark, id:${id}, inMark:${inMark}`);
    throw e;
  }
  if (markRes.status !== 204) {
    const err = "unable to save Mark " + markRes.data;
    console.error(err);
    throw new Error(err);
  }

  // Phase 4: Update tvdb immediately
  const show = allShows.find((s) => s.Id === id);
  if (show && allTvdb[show.Name]) {
    allTvdb[show.Name].emby.inMark = inMark;
    await srvr.setTvdbFields(show.Name, { "emby.inMark": inMark });
  }
}

export async function saveLinda(id, inLinda) {
  const config = {
    method: inLinda ? "post" : "delete",
    url: urls.collectionUrl(cred, id, lindaCollId),
  };
  let lindaRes;
  try {
    lindaRes = await axios(config);
  } catch (e) {
    console.error(`saveLinda, id:${id}, inLinda:${inLinda}`);
    throw e;
  }
  if (lindaRes.status !== 204) {
    const err = "unable to save Linda" + lindaRes.data;
    console.error(err);
    throw new Error(err);
  }

  // Phase 4: Update tvdb immediately
  const show = allShows.find((s) => s.Id === id);
  if (show && allTvdb[show.Name]) {
    allTvdb[show.Name].emby.inLinda = inLinda;
    await srvr.setTvdbFields(show.Name, { "emby.inLinda": inLinda });
  }
}

export const createNoemby = async (show) => {
  const dateStr = util.fmtDate();
  Object.assign(show, {
    Id: "noemby-" + Math.random(),
    DateCreated: dateStr,
    Date: dateStr,
    NotReady: true,
    Seasons: [],
    InToTry: true,
  });
  await srvr.addNoEmby(show);
  return show;
};

export const deleteNoemby = async (name) => {
  console.log("deleteNoemby:", name);
  await srvr.delNoEmby(name);
};

export const startStop = async (show, episodeId, watchButtonTxt) => {
  console.log("startStop:", show, episodeId, watchButtonTxt);
  const devices = await srvr.getDevices();
  for (const device of devices) {
    const { deviceName, sessionId } = device;
    if (watchButtonTxt.startsWith("Stop")) {
      const buttonDeviceName = watchButtonTxt.split(" ")[1];
      if (buttonDeviceName != deviceName) continue;
      const { url, body } = urls.stopUrl(sessionId);
      await axios({ method: "post", url, data: body });
      console.log(`stopped1 ${deviceName}`);
      setTimeout(async () => {
        await axios({ method: "post", url, data: body });
        console.log(`stopped2 ${deviceName}`);
      }, 1000);
      return;
    } else {
      const buttonDeviceName = watchButtonTxt.split(" ")[2];
      if (buttonDeviceName != deviceName) continue;
      const { url, body } = urls.playUrl(sessionId, episodeId);
      await axios({ method: "post", url, data: body });
      console.log(`playing1 ${show.Name} on  ${deviceName}`);
      setTimeout(async () => {
        await axios({ method: "post", url, data: body });
        console.log(`playing2 ${show.Name} on  ${deviceName}`);
      }, 1000);
      return;
    }
  }
};

export const afterLastWatched = async (showId) => {
  if (showId.startsWith("noemby-")) return { status: "noemby" };
  const seasonsRes = await axios.get(urls.childrenUrl(cred, showId));
  const seasonItems = seasonsRes.data.Items;
  for (let key in seasonItems) {
    let seasonRec = seasonItems[key];
    const seasonNumber = Number(seasonRec.IndexNumber);

    // Skip non-numbered / special seasons.
    if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) continue;
    const seasonId = seasonRec.Id;
    const unairedObj = {};
    const unairedRes = await axios.get(urls.childrenUrl(cred, seasonId, true));
    for (let key in unairedRes.data.Items) {
      const episode = unairedRes.data.Items[key];
      const episodeNumber = Number(episode.IndexNumber);
      if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) continue;
      unairedObj[episodeNumber] = true;
    }
    const episodesRes = await axios.get(urls.childrenUrl(cred, seasonId));
    const episodeItems = episodesRes.data.Items;
    for (let key in episodeItems) {
      const episodeRec = episodeItems[key];
      const userData = episodeRec.UserData;
      const watched = userData.Played;
      if (watched) continue;

      // Ignore "episode" items without a numeric index (e.g. S04.EXTRA...)
      const episodeNumber = Number(episodeRec.IndexNumber);
      if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) continue;
      const episodeId = episodeRec.Id;
      const haveFile = episodeRec.LocationType != "Virtual";
      const unaired = !!unairedObj[episodeNumber];
      return {
        seasonNumber,
        episodeNumber,
        episodeId,
        status: unaired ? "unaired" : haveFile ? "ok" : "missing",
      };
    }
  }
  return { status: "allWatched" };
};

export const refreshLib = async () => {
  try {
    await axios({
      method: "post",
      url: `https://hahnca.com:8920/emby/Library/Refresh?api_key=${apiKey}`,
    });

    const tasksRes = await axios({
      method: "get",
      url: `https://hahnca.com:8920/emby/ScheduledTasks?api_key=${apiKey}`,
    });

    const tasks = Array.isArray(tasksRes?.data) ? tasksRes.data : [];
    const isLibraryRefreshTask = (t) => {
      const n = String(t?.Name || "").toLowerCase();
      // Emby task names vary a bit across versions/translations.
      // Keep this intentionally broad but scoped to "library" + (scan|refresh).
      if (!n.includes("library")) return false;
      if (n.includes("scan") || n.includes("refresh")) return true;
      // Common variants seen in some builds.
      return /scan\s+media\s+library|refresh\s+media\s+library|scan\s+library|refresh\s+library/.test(
        n,
      );
    };

    const task = tasks.find(isLibraryRefreshTask);
    if (!task?.Id) return { status: "notask" };
    return { status: "hasTask", taskId: task.Id };
  } catch (e) {
    return { status: e?.message || String(e) };
  }
};

export const createShowFolderAndRefreshEmby = async ({
  showName,
  tvdbId,
  seriesMapSeasons,
  tvdbData,
  onStatus,
  createTimeoutMs = 15000,
  refreshTimeoutMs = 120000,
} = {}) => {
  const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
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

  let createdFolder = false;

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
    createdFolder = true;
  } catch (e) {
    return {
      createdFolder: false,
      status: "createfailed",
      err: e?.message || String(e),
    };
  }

  // Refresh Emby so the new folder gets scanned. Ignore refresh errors, but report them.
  let refreshRes = null;
  try {
    if (typeof onStatus === "function") onStatus("Refreshing Emby...");
    refreshRes = await refreshLib();
    if (refreshRes?.status === "hasTask" && refreshRes?.taskId) {
      const startMs = Date.now();
      while (Date.now() - startMs < refreshTimeoutMs) {
        const st = await withTimeout(
          taskStatus(refreshRes.taskId),
          15000,
          "emby task status",
        );
        if (st?.status !== "refreshing") break;
        await sleep(2000);
      }
    }
  } catch (e) {
    return {
      createdFolder: true,
      status: "refreshfailed",
      err: e?.message || String(e),
      refreshRes,
    };
  }

  return { createdFolder: true, status: "ok", refreshRes };
};

export const taskStatus = async (taskId) => {
  try {
    const tasksRes = await axios({
      method: "get",
      url: `https://hahnca.com:8920/emby/ScheduledTasks?api_key=${apiKey}`,
    });

    const tasks = Array.isArray(tasksRes?.data) ? tasksRes.data : [];
    const task = tasks.find((t) => String(t?.Id) === String(taskId));
    if (!task) return { status: "refreshdone" };

    const stateRaw = String(task?.State || task?.Status || "").trim();
    const state = stateRaw.toLowerCase();
    const progressNum = Number(task?.CurrentProgressPercentage);
    const hasProgress = Number.isFinite(progressNum);

    if (hasProgress && progressNum >= 100) return { status: "refreshdone" };
    if (state && state !== "running") return { status: "refreshdone" };

    return {
      status: "refreshing",
      taskStatus: stateRaw,
      progress: hasProgress ? progressNum : undefined,
    };
  } catch (e) {
    return { status: e?.message || String(e) };
  }
};
