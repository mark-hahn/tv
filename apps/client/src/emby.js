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
    typeof record.name === "string"
      ? record.name.trim()
      : typeof record.Name === "string"
        ? record.Name.trim()
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
    tvdb.inToTry = toTryIds.has(tvdb.id);
    tvdb.inContinue = continueIds.has(tvdb.id);
    tvdb.inMark = markIds.has(tvdb.id);
    tvdb.inLinda = lindaIds.has(tvdb.id);
  }
}

// Phase 2: Helper function to sync rejects into tvdb
function syncRejects(allTvdb, rejectsIn) {
  for (const tvdb of Object.values(allTvdb)) {
    if (!isTvdbShowRecord(tvdb)) continue;
    const normalizedName = normShowName(tvdb.name);
    tvdb.reject = (rejectsIn || []).some(
      (r) => normShowName(r) === normalizedName,
    );
  }
  // Update module-level rejects for isReject()
  rejects = (rejectsIn || []).map(normShowName).filter(Boolean);
  rejectsSet = new Set(rejects);
}

// Thin loadAllShows - fetches tvdb from server, applies computed props
export async function loadAllShows() {
  const loadStart = Date.now();
  const allTvdb = await tvdb.getAllTvdb(0);

  // Ensure computed properties are set
  for (const rec of Object.values(allTvdb)) {
    if (!isTvdbShowRecord(rec)) continue;
    if (!rec.name && rec.Name) rec.name = rec.Name;
    if (!rec.tvdbId && rec.TvdbId) rec.tvdbId = rec.TvdbId;
    if (!rec.id) rec.id = `noemby-${rec.tvdbId}`;
    if (rec.genres && !Array.isArray(rec.genres)) rec.genres = [];
    else if (rec.genres)
      rec.genres = rec.genres.map((g) => (typeof g === "string" ? g : g.name));
    if (rec.status === "Ended") rec.ended = true;
    if (!rec.ratings)
      rec.ratings =
        rec.imdbRatings ||
        rec.remotes?.find((r) => r.name?.startsWith("IMDB"))?.ratings ||
        null;
    rec.reject = !!rec.reject;
    if (rec.note && !rec.notes) rec.notes = rec.note;
    if (rec.notReady === undefined) rec.notReady = rec.inEmby === false;
    rec.watchGap = rec.watchGap || false;
    rec.fileGap =
      rec.fileGap || rec.fileEndError || rec.seasonWatchedThenNofile;
    if (rec.inToTry === undefined) rec.inToTry = false;
    if (rec.inContinue === undefined) rec.inContinue = false;
    if (rec.inMark === undefined) rec.inMark = false;
    if (rec.inLinda === undefined) rec.inLinda = false;
    if (rec.played === undefined) rec.played = false;
    if (rec.playCount === undefined) rec.playCount = 0;
    if (rec.date === undefined) rec.date = "2017-12-05";
    if (rec.size === undefined) rec.size = 0;
    if (rec.noFiles === undefined) rec.noFiles = false;

    // DEBUG Swiss Toni
    if (rec.name === "Swiss Toni") {
      void {
        notReady: rec.notReady,
        inEmby: rec.inEmby,
        fileGap: rec.fileGap,
        fileEndError: rec.fileEndError,
        seasonWatchedThenNofile: rec.seasonWatchedThenNofile,
        inToTry: rec.inToTry,
      };
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

    const recordId = String(record?.id || "").trim();
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
      const recId = String(record?.tvdbId || "").trim();
      if (recId && recId === id) return { key, record };
    }
    return null;
  };

  const embyHasTvdbRecord = (embyItems, tvdbRecord, tvdbKeyName) => {
    const keyName = String(tvdbKeyName || "").trim();
    const recordTvdbId = String(tvdbRecord?.tvdbId || "").trim();
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
      const candidateName = String(record?.name || "").trim();
      if (!candidateName || candidateName === queryName) continue;
      if (normalizeAggressiveTitle(candidateName) !== normalizedQuery) continue;
      variantMatches.push({ key, record, candidateName });
    }

    if (variantMatches.length === 0) return null;

    // Prefer candidate with same TVDB id when available; otherwise first variant match.
    let chosen = variantMatches[0];
    if (incomingTvdbId) {
      const byTvdbId = variantMatches.find(({ record }) => {
        const candidateTvdbId = String(record?.tvdbId || "").trim();
        return candidateTvdbId && candidateTvdbId === incomingTvdbId;
      });
      if (byTvdbId) chosen = byTvdbId;
    }

    const chosenTvdbId = String(chosen.record?.tvdbId || "").trim();

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
  const keysToRename = []; // { oldKey, newKey }
  for (const [key, show] of Object.entries(allTvdb)) {
    if (!isTvdbShowRecord(show)) {
      console.warn(
        `[loadAllShows] Ignoring non-show TVDB entry at key="${key}"`,
        show,
      );
      continue;
    }

    const properName = show.name;
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
        keysToRename.push({ oldKey: key, newKey: properName });
      }
    }
  }

  // Delete the mismatched keys from client cache
  for (const key of keysToDelete) {
    delete allTvdb[key];
  }
  for (const { oldKey } of keysToRename) {
    delete allTvdb[oldKey];
  }

  if (keysToDelete.length > 0 || keysToRename.length > 0) {
    console.log(
      `[loadAllShows] Cleaned up ${keysToDelete.length} deleted + ${keysToRename.length} renamed keys`,
    );

    // Persist renames to server (move record from old key to new key)
    for (const { oldKey, newKey } of keysToRename) {
      try {
        await srvr.setTvdbFields({ name: oldKey, $rename: newKey });
        console.log(
          `[loadAllShows] Renamed key="${oldKey}" -> "${newKey}" on server`,
        );
      } catch (e) {
        console.error(
          `[loadAllShows] Failed to rename key="${oldKey}" -> "${newKey}" on server:`,
          e,
        );
      }
    }

    // Persist deletes to server (true duplicates)
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

    const canonicalName = tvdbRecord?.name || name;

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
      fromEmbySync: true,
      // Include UserData properties for new record creation
      isPlayed: embyShow.UserData?.Played || false,
      playCount: embyShow.UserData?.PlayCount || 0,
    };

    // Create or update tvdb record
    if (!tvdbRecord || tvdbRecord.id !== embyShow.Id) {
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
              name: existing?.name || "",
              tvdbId: existing?.tvdbId || "",
              id: existing?.id || "",
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
        tvdbRecord?.id == null ? "" : String(tvdbRecord.id).trim();
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
            name: tvdbRecord?.name || tvdbKey,
            tvdbId: tvdbRecord.tvdbId,
            id: tvdbRecord.id,
            inEmby: tvdbRecord?.inEmby,
          },
          details: {
            mismatchType: showIdMismatch ? "showId" : "tvdbId",
          },
        });
        console.error(
          `[loadAllShows] Blocked create/update on cache mismatch: emby=\"${name}\" cacheKey=\"${tvdbKey}\" embyId=${embyShow.Id} cacheId=${tvdbRecord.id} embyTvdbId=${tvdbId} cacheTvdbId=${tvdbRecord.tvdbId}`,
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
          id: incomingShowId,
          tvdbId: incomingTvdbId,
          inEmby: true,
          path: embyPath,
          genres: updateFields["emby.genres"],
          overview: updateFields["emby.overview"],
          dateCreated: updateFields.dateCreated,
          premiereDate: updateFields.premiereDate,
          played: updateFields.isPlayed,
          playCount: updateFields.playCount,
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

      // Add tvdbId to show object for server request
      const showWithTvdbId = {
        ...embyShow,
        name: canonicalName,
        tvdbId: tvdbId,
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
      // User data (played, playCount, etc) is synced by background Emby User Data Sync
      // Disk data (date, size) is synced by hourly disk sync
      tvdbRecord.id = embyShow.Id;
      tvdbRecord.path = embyPath;
      tvdbRecord.genres = updateFields["emby.genres"];
      tvdbRecord.overview = updateFields["emby.overview"];
      tvdbRecord.dateCreated = updateFields.dateCreated;
      tvdbRecord.premiereDate = updateFields.premiereDate;

      // Sync user data from Emby
      if (embyShow.UserData) {
        tvdbRecord.played = embyShow.UserData.Played || false;
        tvdbRecord.playCount = embyShow.UserData.PlayCount || 0;
      }

      // Mark show as being in Emby — notify server when inEmby actually changes
      // so the pickup callback fires
      const wasInEmby = tvdbRecord.inEmby;
      tvdbRecord.inEmby = true;

      // Note: gap and note already in tvdb (Phase 5), don't overwrite
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
      const name = noEmbyShow.name;

      // Check if show now exists in Emby (upgrade scenario)
      const tvdbRecord = allTvdb[name];
      if (tvdbRecord?.id && tvdbRecord.inEmby === true) {
        // Show upgraded to Emby - copy collection flags
        console.log("upgrading noEmby to Emby:", name);

        try {
          if (noEmbyShow.inToTry) {
            await saveToTry(tvdbRecord.id, true, name);
            tvdbRecord.inToTry = true;
          }
          if (noEmbyShow.inContinue) {
            await saveContinue(tvdbRecord.id, true, name);
            tvdbRecord.inContinue = true;
          }
          if (noEmbyShow.inMark) {
            await saveMark(tvdbRecord.id, true, name);
            tvdbRecord.inMark = true;
          }
          if (noEmbyShow.inLinda) {
            await saveLinda(tvdbRecord.id, true, name);
            tvdbRecord.inLinda = true;
          }
        } catch (e) {
          console.error("loadAllShows: upgrade noEmby flags failed", name, e);
        }

        // Mark as not in emby anymore in old record
        noEmbyShow.inEmby = false;
        prunedNoEmbyIds.push(noEmbyShow.id);
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
    } else if (hasEmby && !tvdbRecord.id) {
      // Has Emby show but tvdb missing id - update it
      const embyShow = embyShows.data.Items.find((s) => {
        if (s.Name === name) return true;
        const sTvdbId = String(s?.ProviderIds?.Tvdb || s?.TvdbId || "").trim();
        const recTvdbId = String(tvdbRecord?.tvdbId || "").trim();
        return !!(sTvdbId && recTvdbId && sTvdbId === recTvdbId);
      });
      console.log(`loadAllShows: updating tvdb id for ${name}`);
      const updatedRecord = await srvr.setTvdbFields({
        name,
        id: embyShow.Id,
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

  // 6. Sync collection flags from Emby
  await syncCollections(allTvdb);

  // 6.6. Sync reject flags from config arrays (authoritative source)
  syncRejects(allTvdb, rejectsIn);

  // 7. Ensure computed properties are set (since nested objects are now flattened)
  for (const tvdb of Object.values(allTvdb)) {
    if (!isTvdbShowRecord(tvdb)) continue;
    // Ensure Name and TvdbId are set (should already be from migration)
    if (!tvdb.name && tvdb.Name) tvdb.name = tvdb.Name;
    if (!tvdb.tvdbId && tvdb.TvdbId) tvdb.tvdbId = tvdb.TvdbId;

    // Compute id from tvdbId if not set
    if (!tvdb.id) {
      tvdb.id = `noemby-${tvdb.tvdbId}`;
    }

    // Set computed properties
    if (tvdb.genres && !Array.isArray(tvdb.genres)) {
      tvdb.genres = [];
    } else if (tvdb.genres) {
      tvdb.genres = tvdb.genres.map((g) =>
        typeof g === "string" ? g : g.name,
      );
    }
    if (tvdb.status === "Ended") tvdb.ended = true;
    if (!tvdb.ratings) {
      tvdb.ratings =
        tvdb.imdbRatings ||
        tvdb.remotes?.find((r) => r.name?.startsWith("IMDB"))?.ratings ||
        null;
    }
    if (tvdb.reject && !tvdb.reject) tvdb.reject = tvdb.reject;
    if (tvdb.note && !tvdb.notes) tvdb.notes = tvdb.note;

    // Set notReady flag (preserve server-computed value if present)
    if (tvdb.notReady === undefined) tvdb.notReady = tvdb.inEmby === false;

    // Set computed gap properties
    tvdb.watchGap = tvdb.watchGap || false;
    tvdb.fileGap =
      tvdb.fileGap || tvdb.fileEndError || tvdb.seasonWatchedThenNofile;

    // Ensure default values for missing properties
    if (tvdb.inToTry === undefined) tvdb.inToTry = false;
    if (tvdb.inContinue === undefined) tvdb.inContinue = false;
    if (tvdb.inMark === undefined) tvdb.inMark = false;
    if (tvdb.inLinda === undefined) tvdb.inLinda = false;
    if (tvdb.played === undefined) tvdb.played = false;
    if (tvdb.playCount === undefined) tvdb.playCount = 0;
    if (tvdb.date === undefined) tvdb.date = "2017-12-05";
    if (tvdb.size === undefined) tvdb.size = 0;
    if (tvdb.noFiles === undefined) tvdb.noFiles = false;
  }

  const showRecords = Object.values(allTvdb).filter((r) => isTvdbShowRecord(r));

  // Diagnostic: Check for duplicate Name properties in the final showRecords array
  const nameSet = new Set();
  const duplicateNames = [];
  for (const show of showRecords) {
    if (nameSet.has(show.name)) {
      duplicateNames.push(show.name);
    }
    nameSet.add(show.name);
  }
  if (duplicateNames.length > 0) {
    console.error(
      `[loadAllShows] DUPLICATE name properties in showRecords:`,
      duplicateNames,
    );
    // Log details of duplicates - find their keys in allTvdb
    for (const dupName of duplicateNames) {
      const dupes = showRecords.filter((s) => s.name === dupName);
      console.error(`  "${dupName}" appears ${dupes.length} times:`);
      dupes.forEach((d, i) => {
        console.error(
          `    [${i}] id="${d.id}" inEmby=${d.inEmby} tvdbId=${d.tvdbId}`,
        );
      });

      // Find which keys in allTvdb have this name
      console.error(`  Keys in allTvdb with name="${dupName}":`);
      for (const [key, value] of Object.entries(allTvdb)) {
        if (!isTvdbShowRecord(value)) continue;
        if (value.name === dupName) {
          console.error(
            `    key="${key}" id="${value.id}" inEmby=${value.inEmby} sameObject=${value === allTvdb[value.name]}`,
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
    const url = urls.deleteShowUrl(cred, show.id);
    const delRes = await axios.delete(url, {
      headers: {
        "X-Emby-Authorization": authHdr,
        "X-Emby-Token": cred.token,
      },
    });
    const res = delRes.status;
    if (res != 204) {
      const err = `unable to delete ${show.name} from emby: ${delRes.data}`;
      console.error(err);
      return;
    }
    console.log("deleted show from emby:", show.name);
  } catch (error) {
    const errData = error.response?.data || "";
    if (errData.includes("Directory not empty")) {
      const msg = `Cannot delete "${show.name}" - directory still has files. Delete files from disk first.`;
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
  const showId = show.Id || show.id;
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
  const seriesId = show.id;

  // If this is a noemby/preview show, fetch from TVDB API
  if (show.inEmby === false) {
    const tvdbId = show.tvdbId;
    if (!tvdbId) {
      console.warn("getSeriesMap: Preview show has no tvdbId");
      return [];
    }
    try {
      const allTvdbData = await tvdb.getAllTvdb(0);
      const watchedEpis = allTvdbData?.[show.name]?.watchedEpis || null;
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

      if (prune) {
        console.log(
          `[prune] S${seasonNumber}E${episodeNumber}: played=${played} avail=${avail} locationType=${episodeRec?.LocationType ?? "MISSING"} path=${path ?? "(none)"} pruning=${pruning}`,
        );
      }

      if (avail && !path) {
        console.error(
          "avail without path",
          `S${seasonNumber}E${episodeNumber}`,
        );
        continue;
      }

      if (pruning) {
        if (!played && avail) {
          console.log(
            `[prune] STOP at S${seasonNumber}E${episodeNumber}: not watched, has file`,
          );
          pruning = false;
        } else {
          console.log(
            `[prune] deleting S${seasonNumber}E${episodeNumber}: ${path}`,
          );
          try {
            await deleteOneFile(path);
            console.log(`[prune] deleted ok S${seasonNumber}E${episodeNumber}`);
          } catch (e) {
            console.error(
              `[prune] delete FAILED S${seasonNumber}E${episodeNumber}: ${e?.message ?? e}`,
            );
          }
        }
      }

      const error =
        (seasonNumber == show.watchGapSeason &&
          episodeNumber == show.watchGapEpisode &&
          show.watchGap) ||
        (seasonNumber == show.fileGapSeason &&
          episodeNumber == show.fileGapEpisode &&
          show.fileGap) ||
        (seasonNumber == show.fileEndErrorSeason &&
          episodeNumber == show.fileEndErrorEpisode &&
          show.fileEndError) ||
        (seasonNumber == show.seasonWatchedThenNofileSeason &&
          episodeNumber == show.seasonWatchedThenNofileEpisode &&
          show.seasonWatchedThenNofile);

      const noFileVal = !path; // noFile is true when there's no path
      if (show.name === "Pluribus" && unaired) {
        console.log(
          `Pluribus S${seasonNumber}E${episodeNumber}: path=${path}, unaired=${unaired}, noFile=${noFileVal}, played=${played}, avail=${avail}`,
        );
      }

      episodes.push([
        episodeNumber,
        {
          error,
          played,
          avail,
          noFile: noFileVal,
          unaired,
          path,
          id: episodeRec.Id,
        },
      ]);
    }
    if (episodes.length === 0) {
      emptySeasons.push(seasonNumber);
    }
    seriesMap.push([seasonNumber, episodes]);
  }

  if (missingEpisodeNumbers.length > 0) {
    console.warn("[map-debug] episodes missing numeric IndexNumber", {
      show: show?.name,
      showId: seriesId,
      sample: missingEpisodeNumbers,
    });
  }

  // Emby can return empty seasons for some shows even when TVDB has episodes.
  // Backfill only those empty seasons from TVDB so map cells render as missing files.
  if (emptySeasons.length > 0) {
    const tvdbId = show?.tvdbId;
    if (tvdbId) {
      try {
        const allTvdbData = await tvdb.getAllTvdb(0);
        const watchedEpis = allTvdbData?.[show.name]?.watchedEpis || null;
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
            show: show?.name,
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
          show: show?.name,
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
      console.log(`playing1 ${show.name} on  ${deviceName}`);
      setTimeout(async () => {
        await axios({ method: "post", url, data: body });
        console.log(`playing2 ${show.name} on  ${deviceName}`);
      }, 1000);
      return;
    }
  }
};

export const afterLastWatched = async (show) => {
  if (show.inEmby === false) return { status: "noemby" };
  const showId = show.id;
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
    refreshRes = await withTimeout(refreshLib(), 30000, "refreshLib");
    if (refreshRes?.status === "hasTask" && refreshRes?.taskId) {
      const startMs = Date.now();
      let hasSeenRunning = false;
      while (Date.now() - startMs < refreshTimeoutMs) {
        const st = await srvr.embyTaskStatus(refreshRes.taskId);
        if (st?.status === "refreshing") {
          hasSeenRunning = true;
        } else if (hasSeenRunning || st?.status === "refreshdone") {
          break;
        } else if (Date.now() - startMs > 30000) {
          break;
        }
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
    await srvr.triggerEmbySync();
  } catch (e) {
    console.error(
      "createShowFolderAndRefreshEmby: triggerEmbySync failed",
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
    // Treat explicitly completed/cancelled states as done
    if (
      state === "completed" ||
      state === "cancelling" ||
      state === "cancelled"
    ) {
      return { status: "refreshdone" };
    }
    // "Running" means in progress
    if (state === "running") {
      return {
        status: "refreshing",
        taskStatus: stateRaw,
        progress: hasProgress ? progressNum : undefined,
      };
    }
    // "Idle" means completed and reset — treat as done
    if (state === "idle") return { status: "refreshdone" };
    // "Queued" or unknown — task may not have started yet; treat as still pending
    return { status: "refreshing", taskStatus: stateRaw };
  } catch (e) {
    return { status: e?.message || String(e) };
  }
};
