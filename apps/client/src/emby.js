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

function isTvdbShowRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }
  const recName =
    typeof record.Name === "string"
      ? record.Name.trim()
      : typeof record.name === "string"
        ? record.name.trim()
        : "";
  return !!recName;
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
    if (!isTvdbShowRecord(tvdb)) continue;
    tvdb.InToTry = toTryIds.has(tvdb.Id);
    tvdb.InContinue = continueIds.has(tvdb.Id);
    tvdb.InMark = markIds.has(tvdb.Id);
    tvdb.InLinda = lindaIds.has(tvdb.Id);
  }
}

// Phase 2: Helper function to sync rejects into tvdb
function syncRejects(allTvdb, rejectsIn) {
  for (const tvdb of Object.values(allTvdb)) {
    if (!isTvdbShowRecord(tvdb)) continue;
    const normalizedName = normShowName(tvdb.Name);
    tvdb.reject = (rejectsIn || []).some(
      (r) => normShowName(r) === normalizedName,
    );
  }
  // Update module-level rejects for isReject()
  rejects = (rejectsIn || []).map(normShowName).filter(Boolean);
  rejectsSet = new Set(rejects);
}

// Phase 2: Helper function to set wait strings for shows
async function setWaitStrings(allTvdb) {
  for (const tvdb of Object.values(allTvdb)) {
    if (!isTvdbShowRecord(tvdb)) continue;
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

// Thin loadAllShows - fetches tvdb from server, applies computed props
export async function loadAllShows() {
  const loadStart = Date.now();
  const allTvdb = await tvdb.getAllTvdb(0);

  // Ensure computed properties are set
  for (const rec of Object.values(allTvdb)) {
    if (!isTvdbShowRecord(rec)) continue;
    if (!rec.Name && rec.name) rec.Name = rec.name;
    if (!rec.TvdbId && rec.tvdbId) rec.TvdbId = rec.tvdbId;
    if (!rec.Id) rec.Id = `noemby-${rec.tvdbId || rec.TvdbId}`;
    if (rec.genres && !rec.Genres)
      rec.Genres = rec.genres.map((g) => (typeof g === "string" ? g : g.name));
    if (rec.status === "Ended") rec.Ended = true;
    if (rec.overview && !rec.Overview) rec.Overview = rec.overview;
    if (rec.originalCountry && !rec.OriginalCountry)
      rec.OriginalCountry = rec.originalCountry;
    if (rec.lastAired && !rec.LastAired) rec.LastAired = rec.lastAired;
    if (!rec.Ratings)
      rec.Ratings =
        rec.imdbRatings ||
        rec.remotes?.find((r) => r.name?.startsWith("IMDB"))?.ratings ||
        null;
    rec.Reject = !!(rec.reject || rec.Reject);
    if (rec.waitStr && !rec.WaitStr) rec.WaitStr = rec.waitStr;
    if (rec.note && !rec.Notes) rec.Notes = rec.note;
    rec.NotReady = rec.inEmby === false;
    rec.WatchGap = rec.watchGap || false;
    rec.WatchGapSeason = rec.watchGapSeason;
    rec.WatchGapEpisode = rec.watchGapEpisode;
    rec.FileGap =
      !(rec.notReady === false && rec.InToTry) &&
      (rec.fileGap || rec.fileEndError || rec.seasonWatchedThenNofile);
    if (rec.InToTry === undefined) rec.InToTry = false;
    if (rec.InContinue === undefined) rec.InContinue = false;
    if (rec.InMark === undefined) rec.InMark = false;
    if (rec.InLinda === undefined) rec.InLinda = false;
    if (rec.Played === undefined) rec.Played = false;
    if (rec.PlayCount === undefined) rec.PlayCount = 0;
    if (rec.Date === undefined) rec.Date = "2017-12-05";
    if (rec.Size === undefined) rec.Size = 0;
    if (rec.NoFiles === undefined) rec.NoFiles = false;

    // DEBUG Swiss Toni
    if (rec.Name === "Swiss Toni") {
      console.log("[DEBUG Swiss Toni] after computed props:", {
        notReady: rec.notReady,
        inEmby: rec.inEmby,
        fileGap: rec.fileGap,
        fileEndError: rec.fileEndError,
        seasonWatchedThenNofile: rec.seasonWatchedThenNofile,
        FileGap: rec.FileGap,
        NotReady: rec.NotReady,
        InToTry: rec.InToTry,
      });
    }
  }

  const showRecords = Object.values(allTvdb).filter((r) => isTvdbShowRecord(r));
  const elapsed = Date.now() - loadStart;
  console.log(
    `loadAllShows completed in ${elapsed}ms, ${showRecords.length} shows`,
  );
  allShows = showRecords;
  return { allShows: showRecords, allTvdb };
}

// (legacy - no longer called)
async function _oldLoadAllShows() {
  const loadStart = Date.now();

  const ensureEmbyRemoteUrlMatchesRecordId = async (recordKey, record) => {
    if (!isTvdbShowRecord(record)) return record;
    const key = String(recordKey || "").trim();
    if (!key) return record;

    const recordId = String(record?.Id || "").trim();
    if (!recordId) return record;
    if (!Array.isArray(record.remotes)) return record;

    const embyRemoteIndex = record.remotes.findIndex((r) => r?.name === "Emby");
    if (embyRemoteIndex < 0) return record;

    const expectedUrl = urls.embyPageUrl(recordId);
    const currentUrl = String(
      record.remotes[embyRemoteIndex]?.url || "",
    ).trim();
    if (currentUrl === expectedUrl) return record;

    record.remotes[embyRemoteIndex] = {
      ...record.remotes[embyRemoteIndex],
      url: expectedUrl,
    };
    console.warn(
      `[loadAllShows] Fixed Emby remote URL mismatch for key=\"${key}\": id=${recordId} oldUrl=\"${currentUrl}\" newUrl=\"${expectedUrl}\"`,
    );

    try {
      const updated = await srvr.setTvdbFields({
        name: key,
        remotes: record.remotes,
      });
      if (isTvdbShowRecord(updated)) {
        allTvdb[key] = updated;
        return updated;
      }
    } catch (e) {
      console.error(
        `[loadAllShows] Failed to persist fixed Emby remote URL for key=\"${key}\"`,
        e,
      );
    }

    return record;
  };

  const findTvdbEntryByTvdbId = (tvdbMap, targetTvdbId) => {
    const id = String(targetTvdbId || "").trim();
    if (!id) return null;
    for (const [key, record] of Object.entries(tvdbMap || {})) {
      const recId = String(record?.tvdbId || record?.TvdbId || "").trim();
      if (recId && recId === id) return { key, record };
    }
    return null;
  };

  const embyHasTvdbRecord = (embyItems, tvdbRecord, tvdbKeyName) => {
    const keyName = String(tvdbKeyName || "").trim();
    const recordTvdbId = String(
      tvdbRecord?.tvdbId || tvdbRecord?.TvdbId || "",
    ).trim();
    return (embyItems || []).some((s) => {
      const embyName = String(s?.Name || "").trim();
      if (keyName && embyName === keyName) return true;
      if (!recordTvdbId) return false;
      const embyTvdbId = String(s?.ProviderIds?.Tvdb || s?.TvdbId || "").trim();
      const matchedByTvdbId = embyTvdbId && embyTvdbId === recordTvdbId;
      if (matchedByTvdbId && keyName && embyName && embyName !== keyName) {
        console.info(
          `[loadAllShows] hasEmby matched by tvdbId=${recordTvdbId} with name variant: emby="${embyName}" cacheKey="${keyName}"`,
        );
      }
      return matchedByTvdbId;
    });
  };

  const findLikelySameShowCandidate = (tvdbMap, embyShowName, embyTvdbId) => {
    const queryName = String(embyShowName || "").trim();
    if (!queryName) return null;

    const normalizeAggressiveTitle = (name) => {
      let out = String(name || "");
      const idx = out.indexOf("(");
      if (idx >= 0) out = out.slice(0, idx);
      return out
        .toLowerCase()
        .replace(/\./g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    };

    const incomingTvdbId = String(embyTvdbId || "").trim();
    const normalizedQuery = normalizeAggressiveTitle(queryName);
    if (!normalizedQuery) return null;

    const variantMatches = [];
    for (const [key, record] of Object.entries(tvdbMap || {})) {
      const candidateName = String(record?.Name || record?.name || "").trim();
      if (!candidateName || candidateName === queryName) continue;
      if (normalizeAggressiveTitle(candidateName) !== normalizedQuery) continue;
      variantMatches.push({ key, record, candidateName });
    }

    if (variantMatches.length === 0) return null;

    // Prefer candidate with same TVDB id when available; otherwise first variant match.
    let chosen = variantMatches[0];
    if (incomingTvdbId) {
      const byTvdbId = variantMatches.find(({ record }) => {
        const candidateTvdbId = String(
          record?.tvdbId || record?.TvdbId || "",
        ).trim();
        return candidateTvdbId && candidateTvdbId === incomingTvdbId;
      });
      if (byTvdbId) chosen = byTvdbId;
    }

    const chosenTvdbId = String(
      chosen.record?.tvdbId || chosen.record?.TvdbId || "",
    ).trim();

    return {
      key: chosen.key || chosen.candidateName,
      record: chosen.record,
      likelyById: !!(
        incomingTvdbId &&
        chosenTvdbId &&
        incomingTvdbId === chosenTvdbId
      ),
    };
  };

  // 1. Fetch all data sources in parallel (HTTP is fast now!)
  const [embyShows, rejectsIn, allTvdbResult] = await Promise.all([
    axios.get(urls.showListUrl(cred, 0, 10000)),
    srvr.getRejects(),
    tvdb.getAllTvdb(0), // hasEmby = 0: load all shows
  ]);

  // 2. Get authoritative tvdb data (our source of truth)
  // Note: gaps, notes, noEmbys now stored in tvdb.json (Phase 5)
  const allTvdb = allTvdbResult;
  const now = Date.now();

  // Diagnostic & Fix: Check for key/Name mismatches and fix them
  const keysToDelete = [];
  for (const [key, show] of Object.entries(allTvdb)) {
    if (!isTvdbShowRecord(show)) {
      console.warn(
        `[loadAllShows] Ignoring non-show TVDB entry at key="${key}"`,
        show,
      );
      continue;
    }

    const properName = show.Name;
    if (!properName) {
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
      console.warn(`loadAllShows: no tvdbId for ${name}, skipping`);
      continue;
    }

    // Get emby path (used for new record creation)
    const embyPath = embyShow.Path.split("/").pop();

    // Resolve existing tvdb record by exact key first, then by tvdbId.
    let tvdbKey = name;
    let tvdbRecord = allTvdb[tvdbKey];
    if (!tvdbRecord && tvdbId) {
      const byTvdbId = findTvdbEntryByTvdbId(allTvdb, tvdbId);
      if (byTvdbId) {
        tvdbKey = byTvdbId.key;
        tvdbRecord = byTvdbId.record;
        if (tvdbKey !== name) {
          console.info(
            `[loadAllShows] Name variant matched by tvdbId=${tvdbId}: emby="${name}" cacheKey="${tvdbKey}"`,
          );
        }
      }
    }

    const canonicalName = tvdbRecord?.Name || name;

    // Build update object with Emby data (for creating/refreshing records)
    const updateFields = {
      name: canonicalName,
      showId: embyShow.Id,
      tvdbId,
      embyPath,
      "emby.genres": embyShow.Genres || [],
      "emby.overview": embyShow.Overview || "",
      dateCreated: embyShow.DateCreated?.substring(0, 10),
      premiereDate: embyShow.PremiereDate?.substring(0, 10),
      lastEmbySync: now,
      // Include UserData properties for new record creation
      isPlayed: embyShow.UserData?.Played || false,
      playCount: embyShow.UserData?.PlayCount || 0,
    };

    // Create or update tvdb record
    if (!tvdbRecord || tvdbRecord.Id !== embyShow.Id) {
      if (!tvdbRecord) {
        const likelyCandidate = findLikelySameShowCandidate(
          allTvdb,
          name,
          tvdbId,
        );
        if (likelyCandidate) {
          const existing = likelyCandidate.record;
          console.error(
            `[loadAllShows] Blocked tvdb record create for emby="${name}"; likely same-show candidate exists: cacheKey="${likelyCandidate.key}"`,
          );
          evtBus.emit("tvdb-mismatch", {
            reason: "likely-same-show-candidate",
            action: "blocked-create",
            name,
            showId: embyShow.Id,
            tvdbId,
            existing: {
              key: likelyCandidate.key,
              name: existing?.Name || existing?.name || "",
              tvdbId: existing?.tvdbId || existing?.TvdbId || "",
              Id: existing?.Id || "",
              inEmby: existing?.inEmby,
            },
            details: {
              likelyById: likelyCandidate.likelyById,
            },
          });
          continue;
        }
      }

      // Check for true mismatches and block creation/update to prevent duplicate or cross-linked records.
      // Important: missing/empty cached Id means "not linked yet" and should be linkable.
      const cachedShowId =
        tvdbRecord?.Id == null ? "" : String(tvdbRecord.Id).trim();
      const incomingShowId =
        embyShow?.Id == null ? "" : String(embyShow.Id).trim();
      const cachedTvdbId =
        tvdbRecord?.tvdbId == null ? "" : String(tvdbRecord.tvdbId).trim();
      const incomingTvdbId = tvdbId == null ? "" : String(tvdbId).trim();

      const hasCachedShowId = cachedShowId !== "";
      const hasCachedTvdbId = cachedTvdbId !== "";

      // If the cached record was not in Emby (inEmby: false) and the tvdbIds agree,
      // its stored Id is stale/noemby — allow the incoming Emby show to link it.
      const cachedNotInEmby = tvdbRecord?.inEmby === false;
      const tvdbIdsAgree =
        hasCachedTvdbId &&
        incomingTvdbId !== "" &&
        cachedTvdbId === incomingTvdbId;

      const showIdMismatch =
        hasCachedShowId &&
        incomingShowId !== "" &&
        cachedShowId !== incomingShowId &&
        !(cachedNotInEmby && tvdbIdsAgree);
      const tvdbIdMismatch =
        hasCachedTvdbId &&
        incomingTvdbId !== "" &&
        cachedTvdbId !== incomingTvdbId;

      if (tvdbRecord && (showIdMismatch || tvdbIdMismatch)) {
        evtBus.emit("tvdb-mismatch", {
          reason: "cache-mismatch-blocked",
          action: "blocked-create",
          name,
          showId: embyShow.Id,
          tvdbId,
          existing: {
            key: tvdbKey,
            name: tvdbRecord?.Name || tvdbKey,
            tvdbId: tvdbRecord.tvdbId,
            Id: tvdbRecord.Id,
            inEmby: tvdbRecord?.inEmby,
          },
          details: {
            mismatchType: showIdMismatch ? "showId" : "tvdbId",
          },
        });
        console.error(
          `[loadAllShows] Blocked create/update on cache mismatch: emby=\"${name}\" cacheKey=\"${tvdbKey}\" embyId=${embyShow.Id} cacheId=${tvdbRecord.Id} embyTvdbId=${tvdbId} cacheTvdbId=${tvdbRecord.tvdbId}`,
        );
        continue;
      }

      // Existing cache record + same tvdbId + missing Id: link/update this record directly.
      // Do not call getNewTvdb here to avoid create-style behavior.
      if (tvdbRecord && !hasCachedShowId && incomingShowId !== "") {
        console.log(
          `[loadAllShows] Linking existing tvdb record to Emby Id: key=\"${tvdbKey}\" tvdbId=${incomingTvdbId} embyId=${incomingShowId}`,
        );
        const linkedRecord = await srvr.setTvdbFields({
          name: tvdbKey,
          Id: incomingShowId,
          tvdbId: incomingTvdbId,
          inEmby: true,
          Path: embyPath,
          Genres: updateFields["emby.genres"],
          Overview: updateFields["emby.overview"],
          DateCreated: updateFields.dateCreated,
          PremiereDate: updateFields.premiereDate,
          lastEmbySync: now,
          Played: updateFields.isPlayed,
          PlayCount: updateFields.playCount,
        });
        if (isTvdbShowRecord(linkedRecord)) {
          allTvdb[tvdbKey] = linkedRecord;
          await ensureEmbyRemoteUrlMatchesRecordId(tvdbKey, linkedRecord);
        } else {
          console.warn(
            `[loadAllShows] setTvdbFields link response was not a show record for key=\"${tvdbKey}\"`,
            linkedRecord,
          );
        }
        continue;
      }

      const epicounts = await getEpisodeCounts(embyShow);

      // Add TvdbId to show object for server request
      const showWithTvdbId = {
        ...embyShow,
        Name: canonicalName,
        TvdbId: tvdbId,
      };
      const param = Object.assign(
        { show: showWithTvdbId },
        epicounts,
        updateFields,
      );

      tvdbRecord = await srvr.getNewTvdb(param);
      const upsertedKey = tvdb.upsertTvdbCacheRecord(
        allTvdb,
        tvdbRecord,
        tvdbKey,
      );
      const fixedKey = String(upsertedKey || tvdbKey || "").trim();
      const fixedRecord = fixedKey ? allTvdb[fixedKey] : tvdbRecord;
      if (fixedKey && fixedRecord) {
        const syncedRecord = await ensureEmbyRemoteUrlMatchesRecordId(
          fixedKey,
          fixedRecord,
        );
        if (isTvdbShowRecord(syncedRecord)) {
          tvdbRecord = syncedRecord;
        }
      }
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

      // Sync user data from Emby
      if (embyShow.UserData) {
        tvdbRecord.Played = embyShow.UserData.Played || false;
        tvdbRecord.PlayCount = embyShow.UserData.PlayCount || 0;
      }

      // Mark show as being in Emby — notify server when inEmby actually changes
      // so the pickup callback fires
      const wasInEmby = tvdbRecord.inEmby;
      tvdbRecord.inEmby = true;

      // Note: gap and note already in tvdb (Phase 5), don't overwrite
      tvdbRecord.lastEmbySync = now;

      if (!wasInEmby) {
        await srvr.setTvdbFields({
          name: tvdbKey,
          inEmby: true,
          dontEnqueue: true,
        });
      }

      await ensureEmbyRemoteUrlMatchesRecordId(tvdbKey, tvdbRecord);
    }
  }

  // 4. Process shows not in Emby (inEmby === false)
  const noEmbys = Object.values(allTvdb).filter(
    (t) => isTvdbShowRecord(t) && !t?.inEmby,
  );
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
    if (!isTvdbShowRecord(tvdbRecord)) continue;
    if (tvdbRecord.inEmby === false) continue;

    const hasEmby = embyHasTvdbRecord(embyShows.data.Items, tvdbRecord, name);
    const hasNoEmby = noEmbys.some((s) => s.name === name);

    if (!hasEmby && !hasNoEmby) {
      console.log(
        `loadAllShows: marking ${name} as not in Emby (no show found)`,
      );
      const updatedRecord = await srvr.setTvdbFields({
        name,
        inEmby: false,
        dontSave: true,
      });
      if (isTvdbShowRecord(updatedRecord)) {
        allTvdb[name] = updatedRecord;
        await ensureEmbyRemoteUrlMatchesRecordId(name, updatedRecord);
      } else {
        console.warn(
          `[loadAllShows] Ignoring non-show setTvdbFields response while marking not-in-Emby for "${name}"`,
          updatedRecord,
        );
      }
      // Diagnostic: check if we just created an undefined key
      if (name === undefined) {
        console.error(
          `[loadAllShows] BUG: setTvdbFields called with name=undefined at line 355`,
          { name, tvdbRecord },
        );
      }
    } else if (hasEmby && !tvdbRecord.Id) {
      // Has Emby show but tvdb missing Id - update it
      const embyShow = embyShows.data.Items.find((s) => {
        if (s.Name === name) return true;
        const sTvdbId = String(s?.ProviderIds?.Tvdb || s?.TvdbId || "").trim();
        const recTvdbId = String(
          tvdbRecord?.tvdbId || tvdbRecord?.TvdbId || "",
        ).trim();
        return !!(sTvdbId && recTvdbId && sTvdbId === recTvdbId);
      });
      console.log(`loadAllShows: updating tvdb Id for ${name}`);
      const updatedRecord = await srvr.setTvdbFields({
        name,
        Id: embyShow.Id,
        dontSave: true,
      });
      if (isTvdbShowRecord(updatedRecord)) {
        allTvdb[name] = updatedRecord;
      } else {
        console.warn(
          `[loadAllShows] Ignoring non-show setTvdbFields response while updating Id for "${name}"`,
          updatedRecord,
        );
      }
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

  // 6.6. Sync reject flags from config arrays (authoritative source)
  syncRejects(allTvdb, rejectsIn);

  // 7. Ensure computed properties are set (since nested objects are now flattened)
  for (const tvdb of Object.values(allTvdb)) {
    if (!isTvdbShowRecord(tvdb)) continue;
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
        tvdb.imdbRatings ||
        tvdb.remotes?.find((r) => r.name?.startsWith("IMDB"))?.ratings ||
        null;
    }
    if (tvdb.reject && !tvdb.Reject) tvdb.Reject = tvdb.reject;
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
    if (tvdb.Played === undefined) tvdb.Played = false;
    if (tvdb.PlayCount === undefined) tvdb.PlayCount = 0;
    if (tvdb.Date === undefined) tvdb.Date = "2017-12-05";
    if (tvdb.Size === undefined) tvdb.Size = 0;
    if (tvdb.NoFiles === undefined) tvdb.NoFiles = false;
  }

  const showRecords = Object.values(allTvdb).filter((r) => isTvdbShowRecord(r));

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
        if (!isTvdbShowRecord(value)) continue;
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

  // If this is a noemby/preview show, fetch from TVDB API
  if (show.inEmby === false) {
    const tvdbId = show.TvdbId || show.tvdbId;
    if (!tvdbId) {
      console.warn("getSeriesMap: Preview show has no tvdbId");
      return [];
    }
    try {
      const allTvdbData = await tvdb.getAllTvdb(0);
      const watchedEpis = allTvdbData?.[show.Name]?.watchedEpis || null;
      const result = await srvr.getSeriesMapFromTvdb({ tvdbId, watchedEpis });
      if (result.success && result.seriesMap) {
        return result.seriesMap;
      }
      console.error("getSeriesMap: Failed to fetch from TVDB:", result.error);
      return [];
    } catch (err) {
      console.error("getSeriesMap: Error fetching from TVDB:", err);
      return [];
    }
  }

  const seriesMap = [];
  let pruning = prune;
  const seasonsRes = await axios.get(urls.childrenUrl(cred, seriesId));
  const missingEpisodeNumbers = [];
  const emptySeasons = [];

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
      if (!Number.isFinite(episodeNumber)) {
        if (missingEpisodeNumbers.length < 12) {
          missingEpisodeNumbers.push({
            season: seasonNumber,
            indexNumber: episodeRec?.IndexNumber ?? null,
            id: episodeRec?.Id ?? null,
            name: episodeRec?.Name ?? null,
            locationType: episodeRec?.LocationType ?? null,
          });
        }
        continue;
      }

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
    if (episodes.length === 0) {
      emptySeasons.push(seasonNumber);
    }
    seriesMap.push([seasonNumber, episodes]);
  }

  if (missingEpisodeNumbers.length > 0) {
    console.warn("[map-debug] episodes missing numeric IndexNumber", {
      show: show?.Name,
      showId: seriesId,
      sample: missingEpisodeNumbers,
    });
  }

  // Emby can return empty seasons for some shows even when TVDB has episodes.
  // Backfill only those empty seasons from TVDB so map cells render as missing files.
  if (emptySeasons.length > 0) {
    const tvdbId = show?.TvdbId || show?.tvdbId;
    if (tvdbId) {
      try {
        const allTvdbData = await tvdb.getAllTvdb(0);
        const watchedEpis = allTvdbData?.[show.Name]?.watchedEpis || null;
        const fallback = await srvr.getSeriesMapFromTvdb({
          tvdbId,
          watchedEpis,
        });
        const fallbackMap = new Map(
          (fallback?.seriesMap || []).map((s) => [s[0], s[1]]),
        );
        for (let i = 0; i < seriesMap.length; i++) {
          const [seasonNum, episodes] = seriesMap[i];
          if (episodes.length > 0) continue;
          const tvdbEpisodes = fallbackMap.get(seasonNum);
          if (Array.isArray(tvdbEpisodes) && tvdbEpisodes.length > 0) {
            seriesMap[i] = [seasonNum, tvdbEpisodes];
          }
        }
      } catch (err) {
        console.warn(
          "[map-debug] failed TVDB fallback for empty Emby seasons",
          {
            show: show?.Name,
            showId: seriesId,
            tvdbId,
            emptySeasons,
            error: err?.message || String(err),
          },
        );
      }
    }

    // If a season is still empty after TVDB fallback, synthesize missing-file cells
    // using the largest known episode index from other seasons.
    const maxEpisodeNum = seriesMap.reduce((maxNum, seasonEntry) => {
      const seasonEpisodes = Array.isArray(seasonEntry?.[1])
        ? seasonEntry[1]
        : [];
      for (const epEntry of seasonEpisodes) {
        const epNum = Number(epEntry?.[0]);
        if (Number.isFinite(epNum) && epNum > maxNum) maxNum = epNum;
      }
      return maxNum;
    }, 0);

    if (maxEpisodeNum > 0) {
      const synthesized = [];
      for (let i = 0; i < seriesMap.length; i++) {
        const [seasonNum, episodes] = seriesMap[i];
        if (!Array.isArray(episodes) || episodes.length > 0) continue;
        const syntheticEpisodes = [];
        for (let epNum = 1; epNum <= maxEpisodeNum; epNum++) {
          syntheticEpisodes.push([
            epNum,
            {
              error: false,
              played: false,
              avail: false,
              noFile: true,
              unaired: false,
              deleted: false,
              path: null,
            },
          ]);
        }
        seriesMap[i] = [seasonNum, syntheticEpisodes];
        synthesized.push(seasonNum);
      }
      if (synthesized.length > 0) {
        console.warn("[map-debug] synthesized episodes for empty seasons", {
          show: show?.Name,
          showId: seriesId,
          seasons: synthesized,
          inferredEpisodeCount: maxEpisodeNum,
        });
      }
    }
  }

  return seriesMap;
};

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
  // Trigger immediate gap check for this show
  if (showName) {
    srvr
      .triggerEmbySync(id, showName)
      .catch((err) => console.error("triggerEmbySync failed:", err));
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
  // Trigger immediate gap check for this show
  if (showName) {
    srvr
      .triggerEmbySync(id, showName)
      .catch((err) => console.error("triggerEmbySync failed:", err));
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
  // Trigger immediate gap check for this show
  if (showName) {
    srvr
      .triggerEmbySync(id, showName)
      .catch((err) => console.error("triggerEmbySync failed:", err));
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
  // Trigger immediate gap check for this show
  if (showName) {
    srvr
      .triggerEmbySync(id, showName)
      .catch((err) => console.error("triggerEmbySync failed:", err));
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

export const getTvdbIdFromEmbyItem = async (embyId) => {
  const idStr = String(embyId || "").trim();
  if (!idStr || idStr.startsWith("noemby-")) return "";
  try {
    const url =
      `https://hahnca.com:8920/emby/Users/${markUsrId}/Items/${idStr}` +
      `?Fields=ProviderIds&api_key=${apiKey}`;
    const res = await axios({ method: "get", url });
    return String(res.data?.ProviderIds?.Tvdb || "").trim();
  } catch {
    return "";
  }
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

  // Run server-side Emby sweep so inEmby status is current before caller reloads
  try {
    await srvr.embySync();
  } catch (e) {
    console.error(
      "createShowFolderAndRefreshEmby: embySync failed",
      e?.message || e,
    );
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
