import axios from "axios";
import * as tvdb from "./tvdb.js";
import * as srvr from "./srvr.js";
import * as urls from "./urls.js";
import * as util from "./util.js";
import evtBus from "./evtBus.js";

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
let allShows = null;

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
    .trim()
    .toLowerCase();
}

export const isReject = (name) => {
  if (!rejectsSet) return false;
  return rejectsSet.has(normShowName(name));
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
    tvdb.InToTry = toTryIds.has(tvdb.Id);
    tvdb.InContinue = continueIds.has(tvdb.Id);
    tvdb.InMark = markIds.has(tvdb.Id);
    tvdb.InLinda = lindaIds.has(tvdb.Id);
  }
}

// Phase 2: Helper function to sync rejects and pickups into tvdb
function syncRejectsAndPickups(allTvdb, rejectsIn, pickups) {
  // Set reject and pickup flags for all shows
  for (const tvdb of Object.values(allTvdb)) {
    const normalizedName = normShowName(tvdb.Name);
    tvdb.reject = (rejectsIn || []).some(
      (r) => normShowName(r) === normalizedName,
    );
    tvdb.pickup = (pickups || []).some(
      (p) => normShowName(p) === normalizedName,
    );
  }
  // Update module-level rejects for isReject()
  rejects = (rejectsIn || []).map(normShowName).filter(Boolean);
  rejectsSet = new Set(rejects);
}

// Phase 2: Helper function to set wait strings for shows
async function setWaitStrings(allTvdb) {
  for (const tvdb of Object.values(allTvdb)) {
    if (tvdb.inEmby === false) continue;
    try {
      const show = { Name: tvdb.Name, Id: tvdb.Id };
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
  // On initial load, only load shows with inEmby: true (hasEmby = 1)
  // The rest will be loaded when user changes hasemby filter
  const [embyShows, rejectsIn, pickups, allTvdbResult] = await Promise.all([
    axios.get(urls.showListUrl(cred, 0, 10000)),
    srvr.getRejects(),
    srvr.getPickups(),
    tvdb.getAllTvdb(1), // hasEmby = 1: load only shows with inEmby true
  ]);

  // 2. Get authoritative tvdb data (our source of truth)
  // Note: gaps, notes, noEmbys now stored in tvdb.json (Phase 5)
  const allTvdb = allTvdbResult;
  const now = Date.now();

  // Diagnostic & Fix: Check for key/Name mismatches and fix them
  const keysToDelete = [];
  for (const [key, show] of Object.entries(allTvdb)) {
    const properName = show.Name;
    if (!properName) {
      console.error(
        `[loadAllShows] Show with key="${key}" has no Name property!`,
        show,
      );
      continue;
    }

    if (key !== properName) {
      console.warn(
        `[loadAllShows] Key/Name mismatch found - key="${key}" Name="${properName}"`,
      );

      // Check if there's already an entry with the correct key
      const correctEntry = allTvdb[properName];
      if (correctEntry && correctEntry !== show) {
        // Both entries exist - prefer the one with the correct key, delete the mismatched one
        console.warn(
          `[loadAllShows] Duplicate detected. Deleting mismatched entry with key="${key}"`,
        );
        keysToDelete.push(key);
      } else if (!correctEntry) {
        // No entry with correct key - move this one to the correct key
        console.warn(
          `[loadAllShows] Moving entry from key="${key}" to key="${properName}"`,
        );
        allTvdb[properName] = show;
        keysToDelete.push(key);
      }
    }
  }

  // Delete the mismatched keys
  for (const key of keysToDelete) {
    delete allTvdb[key];
  }

  if (keysToDelete.length > 0) {
    console.log(
      `[loadAllShows] Cleaned up ${keysToDelete.length} mismatched keys:`,
      keysToDelete,
    );

    // Persist the cleanup by deleting the bad keys from the server
    for (const badKey of keysToDelete) {
      try {
        await srvr.setTvdbFields({ name: badKey, $delTvdb: true });
        console.log(
          `[loadAllShows] Deleted key="${badKey}" from server tvdb.json`,
        );
      } catch (e) {
        console.error(
          `[loadAllShows] Failed to delete key="${badKey}" from server:`,
          e,
        );
      }
    }
  }

  // 3. Sync Emby shows into tvdb (update tvdb records with Emby user data)
  // Diagnostic: Check for duplicate show names in Emby
  const embyShowNames = new Map();
  for (const embyShow of embyShows.data.Items) {
    if (embyShowNames.has(embyShow.Name)) {
      console.warn(
        `[loadAllShows] DUPLICATE Emby show name detected: "${embyShow.Name}"`,
        {
          first: { Id: embyShowNames.get(embyShow.Name), Name: embyShow.Name },
          second: { Id: embyShow.Id, Name: embyShow.Name },
        },
      );
    }
    embyShowNames.set(embyShow.Name, embyShow.Id);
  }

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

    // Get emby path (used for new record creation)
    const embyPath = embyShow.Path.split("/").pop();

    // Build update object with Emby data (for creating NEW records only)
    const updateFields = {
      name,
      showId: embyShow.Id,
      tvdbId,
      embyPath,
      "emby.genres": embyShow.Genres || [],
      "emby.overview": embyShow.Overview || "",
      dateCreated: embyShow.DateCreated?.substring(0, 10),
      premiereDate: embyShow.PremiereDate?.substring(0, 10),
      lastEmbySync: now,
    };

    // Create or update tvdb record
    let tvdbRecord = allTvdb[name];
    if (!tvdbRecord || tvdbRecord.Id !== embyShow.Id) {
      // Need to create/refresh tvdb record
      const reason = !tvdbRecord
        ? "no existing tvdb entry"
        : `Id mismatch (${tvdbRecord.Id} != ${embyShow.Id})`;

      // Check for true mismatches (pop modal for user attention)
      if (
        tvdbRecord &&
        (tvdbRecord.Id !== embyShow.Id ||
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
            Id: tvdbRecord.Id,
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
      // Update existing tvdb record with Emby metadata for new shows only
      // User data (Played, PlayCount, etc) is synced by background Emby User Data Sync
      // Disk data (Date, Size) is synced by hourly disk sync
      tvdbRecord.Id = embyShow.Id;
      tvdbRecord.Path = embyPath;
      tvdbRecord.Genres = updateFields["emby.genres"];
      tvdbRecord.Overview = updateFields["emby.overview"];
      tvdbRecord.DateCreated = updateFields.dateCreated;
      tvdbRecord.PremiereDate = updateFields.premiereDate;

      // Mark show as being in Emby
      tvdbRecord.inEmby = true;

      // Note: gap and note already in tvdb (Phase 5), don't overwrite
      tvdbRecord.lastEmbySync = now;
    }
  }

  // 4. Process shows not in Emby (inEmby === false)
  const noEmbys = Object.values(allTvdb).filter((t) => !t?.inEmby);
  const prunedNoEmbyIds = [];

  await Promise.all(
    noEmbys.map(async (noEmbyShow) => {
      const name = noEmbyShow.Name;

      // Check if show now exists in Emby (upgrade scenario)
      const tvdbRecord = allTvdb[name];
      if (tvdbRecord?.Id && tvdbRecord.inEmby === true) {
        // Show upgraded to Emby - copy collection flags
        console.log("upgrading noEmby to Emby:", name);

        try {
          if (noEmbyShow.InToTry) {
            await saveToTry(tvdbRecord.Id, true, name);
            tvdbRecord.InToTry = true;
          }
          if (noEmbyShow.InContinue) {
            await saveContinue(tvdbRecord.Id, true, name);
            tvdbRecord.InContinue = true;
          }
          if (noEmbyShow.InMark) {
            await saveMark(tvdbRecord.Id, true, name);
            tvdbRecord.InMark = true;
          }
          if (noEmbyShow.InLinda) {
            await saveLinda(tvdbRecord.Id, true, name);
            tvdbRecord.InLinda = true;
          }
        } catch (e) {
          console.error("loadAllShows: upgrade noEmby flags failed", name, e);
        }

        // Mark as not in emby anymore in old record
        noEmbyShow.inEmby = false;
        prunedNoEmbyIds.push(noEmbyShow.Id);
        return;
      }
    }),
  );

  // 5. Update inEmby status if no matching show exists
  for (const [name, tvdbRecord] of Object.entries(allTvdb)) {
    if (tvdbRecord.inEmby === false) continue;

    const hasEmby = embyShows.data.Items.some((s) => s.Name === name);
    const hasNoEmby = noEmbys.some((s) => s.name === name);

    if (!hasEmby && !hasNoEmby) {
      console.log(
        `loadAllShows: marking ${name} as not in Emby (no show found)`,
      );
      allTvdb[name] = await srvr.setTvdbFields({
        name,
        inEmby: false,
        dontSave: true,
      });
      // Diagnostic: check if we just created an undefined key
      if (name === undefined) {
        console.error(
          `[loadAllShows] BUG: setTvdbFields called with name=undefined at line 355`,
          { name, tvdbRecord },
        );
      }
    } else if (hasEmby && !tvdbRecord.Id) {
      // Has Emby show but tvdb missing Id - update it
      const embyShow = embyShows.data.Items.find((s) => s.Name === name);
      console.log(`loadAllShows: updating tvdb Id for ${name}`);
      allTvdb[name] = await srvr.setTvdbFields({
        name,
        Id: embyShow.Id,
        dontSave: true,
      });
      // Diagnostic: check if we just created an undefined key
      if (name === undefined) {
        console.error(
          `[loadAllShows] BUG: setTvdbFields called with name=undefined at line 368`,
          { name, tvdbRecord, embyShow },
        );
      }
    }
  }

  // 6. Set WaitStr for shows with unaired episodes
  await setWaitStrings(allTvdb);

  // 6.5. Sync collection flags from Emby
  await syncCollections(allTvdb);

  // 7. Ensure computed properties are set (since nested objects are now flattened)
  for (const tvdb of Object.values(allTvdb)) {
    // Ensure Name and TvdbId are set (should already be from migration)
    if (!tvdb.Name && tvdb.name) tvdb.Name = tvdb.name;
    if (!tvdb.TvdbId && tvdb.tvdbId) tvdb.TvdbId = tvdb.tvdbId;

    // Compute Id from tvdbId if not set
    if (!tvdb.Id) {
      tvdb.Id = `noemby-${tvdb.tvdbId || tvdb.TvdbId}`;
    }

    // Set computed properties
    if (tvdb.genres && !tvdb.Genres) {
      tvdb.Genres = tvdb.genres.map((g) =>
        typeof g === "string" ? g : g.name,
      );
    }
    if (tvdb.status === "Ended") tvdb.Ended = true;
    if (tvdb.overview && !tvdb.Overview) tvdb.Overview = tvdb.overview;
    if (tvdb.originalCountry && !tvdb.OriginalCountry) {
      tvdb.OriginalCountry = tvdb.originalCountry;
    }
    if (tvdb.lastAired && !tvdb.LastAired) tvdb.LastAired = tvdb.lastAired;
    if (!tvdb.Ratings) {
      tvdb.Ratings =
        tvdb.remotes?.find((r) => r.name?.startsWith("IMDB"))?.ratings || null;
    }
    if (tvdb.reject && !tvdb.Reject) tvdb.Reject = tvdb.reject;
    if (tvdb.pickup && !tvdb.Pickup) tvdb.Pickup = tvdb.pickup;
    if (tvdb.waitStr && !tvdb.WaitStr) tvdb.WaitStr = tvdb.waitStr;
    if (tvdb.note && !tvdb.Notes) tvdb.Notes = tvdb.note;

    // Set NotReady flag
    tvdb.NotReady = tvdb.inEmby === false;

    // Set computed gap properties (uppercase versions for backward compatibility)
    tvdb.WatchGap = tvdb.watchGap || false;
    tvdb.WatchGapSeason = tvdb.watchGapSeason;
    tvdb.WatchGapEpisode = tvdb.watchGapEpisode;
    tvdb.FileGap =
      !(tvdb.notReady === false && tvdb.InToTry) &&
      (tvdb.fileGap || tvdb.fileEndError || tvdb.seasonWatchedThenNofile);

    // Ensure default values for missing properties
    if (tvdb.InToTry === undefined) tvdb.InToTry = false;
    if (tvdb.InContinue === undefined) tvdb.InContinue = false;
    if (tvdb.InMark === undefined) tvdb.InMark = false;
    if (tvdb.InLinda === undefined) tvdb.InLinda = false;
    if (tvdb.IsFavorite === undefined) tvdb.IsFavorite = false;
    if (tvdb.Played === undefined) tvdb.Played = false;
    if (tvdb.PlayCount === undefined) tvdb.PlayCount = 0;
    if (tvdb.Date === undefined) tvdb.Date = "2017-12-05";
    if (tvdb.Size === undefined) tvdb.Size = 0;
    if (tvdb.NoFiles === undefined) tvdb.NoFiles = false;
  }

  const showRecords = Object.values(allTvdb);

  // Diagnostic: Check for duplicate Name properties in the final showRecords array
  const nameSet = new Set();
  const duplicateNames = [];
  for (const show of showRecords) {
    if (nameSet.has(show.Name)) {
      duplicateNames.push(show.Name);
    }
    nameSet.add(show.Name);
  }
  if (duplicateNames.length > 0) {
    console.error(
      `[loadAllShows] DUPLICATE Name properties in showRecords:`,
      duplicateNames,
    );
    // Log details of duplicates - find their keys in allTvdb
    for (const dupName of duplicateNames) {
      const dupes = showRecords.filter((s) => s.Name === dupName);
      console.error(`  "${dupName}" appears ${dupes.length} times:`);
      dupes.forEach((d, i) => {
        console.error(
          `    [${i}] Id="${d.Id}" inEmby=${d.inEmby} tvdbId=${d.tvdbId}`,
        );
      });

      // Find which keys in allTvdb have this Name
      console.error(`  Keys in allTvdb with Name="${dupName}":`);
      for (const [key, value] of Object.entries(allTvdb)) {
        if (value.Name === dupName) {
          console.error(
            `    key="${key}" Id="${value.Id}" inEmby=${value.inEmby} sameObject=${value === allTvdb[value.Name]}`,
          );
        }
      }
    }
  }

  const elapsed = Date.now() - loadStart;
  console.log(
    `loadAllShows completed in ${elapsed}ms, ${showRecords.length} shows`,
  );
  allShows = showRecords;
  return { allShows: showRecords, allTvdb };
}

//////////// misc functions //////////////

// Gap checking is now done on the server
// Server will send updated tvdb data via WebSocket RPC

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
    // Trigger gap check for deleted show
    srvr
      .triggerEmbySync(show.Id, show.Name)
      .catch((err) => console.error("triggerEmbySync failed:", err));
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
  showName = null,
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

      // Trigger gap check for this show (watched status affects gap calculation)
      if (showName) {
        srvr
          .triggerEmbySync(seriesId, showName)
          .catch((err) => console.error("triggerEmbySync failed:", err));
      }
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
  if (show.inEmby === false) return { seasonCount, episodeCount, watchedCount };
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
  if (show.inEmby === false) {
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
      // If episode has a file, it can't be unaired (Emby's unaired endpoint is unreliable)
      const unaired = avail && path ? false : !!unairedObj[episodeNumber];

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
}

export async function saveToTry(id, inToTry, showName) {
  const config = {
    method: inToTry ? "post" : "delete",
    url: urls.collectionUrl(cred, id, toTryCollId),
  };
  let toTryRes;
  try {
    toTryRes = await axios(config);
  } catch (e) {
    console.error(`saveToTry error, id:${id}, inToTry:${inToTry}`, e);
    throw e;
  }
  if (toTryRes.status !== 204) {
    const err =
      "unable to save totry, status=" +
      toTryRes.status +
      ", data=" +
      JSON.stringify(toTryRes.data);
    console.error(err);
    throw new Error(err);
  }
}

export async function saveContinue(id, inContinue, showName) {
  const config = {
    method: inContinue ? "post" : "delete",
    url: urls.collectionUrl(cred, id, continueCollId),
  };
  let continueRes;
  try {
    continueRes = await axios(config);
  } catch (e) {
    console.error(`saveContinue error, id:${id}, inContinue:${inContinue}`, e);
    throw e;
  }
  if (continueRes.status !== 204) {
    const err =
      "unable to save Continue, status=" +
      continueRes.status +
      ", data=" +
      JSON.stringify(continueRes.data);
    console.error(err);
    throw new Error(err);
  }
}

export async function saveMark(id, inMark, showName) {
  const config = {
    method: inMark ? "post" : "delete",
    url: urls.collectionUrl(cred, id, markCollId),
  };
  let markRes;
  try {
    markRes = await axios(config);
  } catch (e) {
    console.error(`saveMark error, id:${id}, inMark:${inMark}`, e);
    throw e;
  }
  if (markRes.status !== 204) {
    const err =
      "unable to save Mark, status=" +
      markRes.status +
      ", data=" +
      JSON.stringify(markRes.data);
    console.error(err);
    throw new Error(err);
  }
}

export async function saveLinda(id, inLinda, showName) {
  const config = {
    method: inLinda ? "post" : "delete",
    url: urls.collectionUrl(cred, id, lindaCollId),
  };
  let lindaRes;
  try {
    lindaRes = await axios(config);
  } catch (e) {
    console.error(`saveLinda error, id:${id}, inLinda:${inLinda}`, e);
    throw e;
  }
  if (lindaRes.status !== 204) {
    const err =
      "unable to save Linda, status=" +
      lindaRes.status +
      ", data=" +
      JSON.stringify(lindaRes.data);
    console.error(err);
    throw new Error(err);
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

export const afterLastWatched = async (show) => {
  if (show.inEmby === false) return { status: "noemby" };
  const showId = show.Id;
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

    // Note: triggerFullGapCheck should be called by the caller if needed
    // (not all library refreshes require gap checks)

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
