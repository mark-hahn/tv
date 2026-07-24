import axios from "axios";
import * as tvdb from "./tvdb.js";
import * as srvr from "./srvr.js";
import * as urls from "./urls.js";
import * as util from "./util.js";
import evtBus from "./evtBus.js";
import { episodeDataToWatchedEpis } from "@tv/share";
import { logHere, unilog } from "./log.js";

const name = "mark";
const pwd = "90-MNBbnmyui";
const apiKey = "1112c1f515824d66bf2f8618fdb67312";

const EMBY_REQUEST_TIMEOUT = 10000;
const EMBY_MAX_RETRIES = 2;
const EMBY_RETRY_DELAY = 500;

async function axiosGetWithRetry(url, retries = EMBY_MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, { timeout: EMBY_REQUEST_TIMEOUT });
    } catch (e) {
      const isLastAttempt = attempt === retries;
      const isNetworkError =
        e.message === "Network Error" || e.code === "ECONNABORTED";

      if (!isLastAttempt && isNetworkError) {
        const delay = EMBY_RETRY_DELAY * (attempt + 1);
        unilog(1761, `Emby request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms: ${url}: ${e?.message || String(e)}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      unilog(1762, `Emby request gave up (attempt ${attempt + 1}/${retries + 1}): ${url}: ${e?.message || String(e)}`);
      throw e;
    }
  }
}
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

// Phase 2: Helper function to sync collection flags into tvdb
async function syncCollections(allTvdb) {
  const [toTryRes, continueRes, markRes, lindaRes] = await Promise.all([
    axiosGetWithRetry(urls.collectionListUrl(cred, toTryCollId)),
    axiosGetWithRetry(urls.collectionListUrl(cred, continueCollId)),
    axiosGetWithRetry(urls.collectionListUrl(cred, markCollId)),
    axiosGetWithRetry(urls.collectionListUrl(cred, lindaCollId)),
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
  unilog(
    1075,
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
    unilog(
      811,
      `Fixed Emby remote URL mismatch for key=\"${key}\": id=${recordId} oldUrl=\"${currentUrl}\" newUrl=\"${expectedUrl}\"`,
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
      unilog(
        812,
        `Failed to persist fixed Emby remote URL for key=\"${key}\"`,
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
        unilog(
          813,
          `hasEmby matched by tvdbId=${recordTvdbId} with name variant: emby="${embyName}" cacheKey="${keyName}"`,
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
  const [embyShows, allTvdbResult] = await Promise.all([
    axiosGetWithRetry(urls.showListUrl(cred, 0, 10000)),
    tvdb.getAllTvdb(0), // hasEmby = 0: load all shows
  ]);

  // 2. Get authoritative tvdb data (our source of truth)
  // Note: gaps and noEmbys now stored in tvdb.json (Phase 5)
  const allTvdb = allTvdbResult;
  const now = Date.now();

  // Diagnostic & Fix: Check for key/Name mismatches and fix them
  const keysToDelete = [];
  const keysToRename = []; // { oldKey, newKey }
  for (const [key, show] of Object.entries(allTvdb)) {
    if (!isTvdbShowRecord(show)) {
      unilog(814, `Ignoring non-show TVDB entry at key="${key}"`, show);
      continue;
    }

    const properName = show.name;
    if (!properName) {
      continue;
    }

    if (key !== properName) {
      unilog(
        815,
        `Key/Name mismatch found - key="${key}" Name="${properName}"`,
      );

      // Check if there's already an entry with the correct key
      const correctEntry = allTvdb[properName];
      if (correctEntry && correctEntry !== show) {
        // Both entries exist - prefer the one with the correct key, delete the mismatched one
        unilog(
          816,
          `Duplicate detected. Deleting mismatched entry with key="${key}"`,
        );
        keysToDelete.push(key);
      } else if (!correctEntry) {
        // No entry with correct key - move this one to the correct key
        unilog(817, `Moving entry from key="${key}" to key="${properName}"`);
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
    unilog(
      818,
      `Cleaned up ${keysToDelete.length} deleted + ${keysToRename.length} renamed keys`,
    );

    // Persist renames to server (move record from old key to new key)
    for (const { oldKey, newKey } of keysToRename) {
      try {
        await srvr.setTvdbFields({ name: oldKey, $rename: newKey });
        unilog(819, `Renamed key="${oldKey}" -> "${newKey}" on server`);
      } catch (e) {
        unilog(
          820,
          `Failed to rename key="${oldKey}" -> "${newKey}" on server:`,
          e,
        );
      }
    }

    // Persist deletes to server (true duplicates)
    for (const badKey of keysToDelete) {
      try {
        await srvr.setTvdbFields({ name: badKey, $delTvdb: true });
        unilog(821, `Deleted key="${badKey}" from server tvdb.json`);
      } catch (e) {
        unilog(822, `Failed to delete key="${badKey}" from server:`, e);
      }
    }
  }

  // 3. Sync Emby shows into tvdb (update tvdb records with Emby user data)
  // Diagnostic: Check for duplicate show names in Emby
  const embyShowNames = new Map();
  for (const embyShow of embyShows.data.Items) {
    if (embyShowNames.has(embyShow.Name)) {
      unilog(823, `DUPLICATE Emby show name detected: "${embyShow.Name}"`, {
        first: { Id: embyShowNames.get(embyShow.Name), Name: embyShow.Name },
        second: { Id: embyShow.Id, Name: embyShow.Name },
      });
    }
    embyShowNames.set(embyShow.Name, embyShow.Id);
  }

  for (const embyShow of embyShows.data.Items) {
    const name = embyShow.Name;
    const tvdbId = embyShow?.ProviderIds?.Tvdb || embyShow?.TvdbId;

    if (!tvdbId || tvdbId == "0") {
      unilog(1074, `loadAllShows: no tvdbId for ${name}, skipping`);
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
          unilog(
            824,
            `Name variant matched by tvdbId=${tvdbId}: emby="${name}" cacheKey="${tvdbKey}"`,
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
          unilog(
            825,
            `Blocked tvdb record create for emby="${name}"; likely same-show candidate exists: cacheKey="${likelyCandidate.key}"`,
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
        unilog(
          826,
          `Blocked create/update on cache mismatch: emby=\"${name}\" cacheKey=\"${tvdbKey}\" embyId=${embyShow.Id} cacheId=${tvdbRecord.id} embyTvdbId=${tvdbId} cacheTvdbId=${tvdbRecord.tvdbId}`,
        );
        continue;
      }

      // Existing cache record + same tvdbId + missing Id: link/update this record directly.
      // Do not call getNewTvdb here to avoid create-style behavior.
      if (tvdbRecord && !hasCachedShowId && incomingShowId !== "") {
        unilog(
          827,
          `Linking existing tvdb record to Emby Id: key=\"${tvdbKey}\" tvdbId=${incomingTvdbId} embyId=${incomingShowId}`,
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
          unilog(
            828,
            `setTvdbFields link response was not a show record for key=\"${tvdbKey}\"`,
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

      // Note: gap already in tvdb (Phase 5), don't overwrite
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
        unilog(829, "upgrading noEmby to Emby:", name);

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
          unilog(830, "loadAllShows: upgrade noEmby flags failed", name, e);
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
      unilog(
        831,
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
        unilog(
          832,
          `Ignoring non-show setTvdbFields response while marking not-in-Emby for "${name}"`,
          updatedRecord,
        );
      }
      // Diagnostic: check if we just created an undefined key
      if (name === undefined) {
        unilog(
          833,
          `BUG: setTvdbFields called with name=undefined at line 355`,
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
      unilog(1073, `loadAllShows: updating tvdb id for ${name}`);
      const updatedRecord = await srvr.setTvdbFields({
        name,
        id: embyShow.Id,
        dontSave: true,
      });
      if (isTvdbShowRecord(updatedRecord)) {
        allTvdb[name] = updatedRecord;
      } else {
        unilog(
          834,
          `Ignoring non-show setTvdbFields response while updating Id for "${name}"`,
          updatedRecord,
        );
      }
      // Diagnostic: check if we just created an undefined key
      if (name === undefined) {
        unilog(
          835,
          `BUG: setTvdbFields called with name=undefined at line 368`,
          { name, tvdbRecord, embyShow },
        );
      }
    }
  }

  // 6. Sync collection flags from Emby
  await syncCollections(allTvdb);

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
    unilog(836, `DUPLICATE name properties in showRecords:`, duplicateNames);
    // Log details of duplicates - find their keys in allTvdb
    for (const dupName of duplicateNames) {
      const dupes = showRecords.filter((s) => s.name === dupName);
      unilog(1072, `  "${dupName}" appears ${dupes.length} times:`);
      dupes.forEach((d, i) => {
        unilog(
          837,
          `    [${i}] id="${d.id}" inEmby=${d.inEmby} tvdbId=${d.tvdbId}`,
        );
      });

      // Find which keys in allTvdb have this name
      unilog(1071, `  Keys in allTvdb with name="${dupName}":`);
      for (const [key, value] of Object.entries(allTvdb)) {
        if (!isTvdbShowRecord(value)) continue;
        if (value.name === dupName) {
          unilog(
            838,
            `    key="${key}" id="${value.id}" inEmby=${value.inEmby} sameObject=${value === allTvdb[value.name]}`,
          );
        }
      }
    }
  }

  const elapsed = Date.now() - loadStart;
  unilog(
    1070,
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
      unilog(839, err);
      return;
    }
    unilog(840, "deleted show from emby:", show.name);
  } catch (error) {
    const errData = error.response?.data || "";
    if (errData.includes("Directory not empty")) {
      const msg = `Cannot delete "${show.name}" - directory still has files. Delete files from disk first.`;
      unilog(841, msg);
      alert(msg);
    } else {
      unilog(842, `deleteShowFromEmby error for ${show.name}:`, error);
      unilog(843, `Response data for ${show.name}:`, errData);
    }
    throw error;
  }
}

const deleteOneFile = async (path) => {
  if (!path) return;
  unilog(844, "deleting file:", path);
  try {
    await srvr.deletePath(path);
  } catch (e) {
    unilog(845, "deletePath:", path, e);
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

  const seasonsRes = await axiosGetWithRetry(urls.childrenUrl(cred, seriesId));
  for (let key in seasonsRes.data.Items) {
    let seasonRec = seasonsRes.data.Items[key];
    const seasonNumber = +seasonRec.IndexNumber;
    if (seasonNumber != seasonNumIn) continue;

    const seasonId = seasonRec.Id;
    const episodesRes = await axiosGetWithRetry(
      urls.childrenUrl(cred, seasonId),
    );
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
          unilog(846, "deleteOneFile:", path, e);
          throw e;
        }
      }

      const episodeId = episodeRec.Id;
      userData.Played = setWatched !== null ? setWatched : !watched;
      const url = urls.postUserDataUrl(cred, episodeId);
      await axios({
        method: "post",
        url: url,
        data: userData,
      });
    }
  }
};

export const getEpisodeCounts = async (show) => {
  const showId = show.Id || show.id;
  let seasonCount = 0;
  let episodeCount = 0;
  let watchedCount = 0;
  if (show.inEmby === false) return { seasonCount, episodeCount, watchedCount };
  try {
    const seasonsRes = await axiosGetWithRetry(urls.childrenUrl(cred, showId));
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
      const episodesRes = await axiosGetWithRetry(
        urls.childrenUrl(cred, seasonId),
      );
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
    const showName = show.Name || show.name || "unknown";
    unilog(
      847,
      `getEpisodeCounts error for "${showName}" (id=${showId}):`,
      e.message || e,
    );
    if (e.config?.url) {
      unilog(1069, `  Failed URL: ${e.config.url}`);
    }
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
      unilog(1068, `getSeriesMap: Preview show ${show.name} has no tvdbId`);
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
      unilog(
        848,
        `getSeriesMap: Failed to fetch ${show.name} from TVDB: ${result.error}`,
      );
      return [];
    } catch (err) {
      unilog(
        849,
        `getSeriesMap: Error fetching ${show.name} from TVDB: ${err.message || err}`,
      );
      return [];
    }
  }

  const seriesMap = [];
  let pruning = prune;
  const pathsToDeleteBatch = [];
  const seasonsRes = await axiosGetWithRetry(urls.childrenUrl(cred, seriesId));
  const missingEpisodeNumbers = [];
  const emptySeasons = [];

  for (let key in seasonsRes.data.Items) {
    let seasonRec = seasonsRes.data.Items[key];
    let seasonId = seasonRec.Id;
    const seasonNumber = +seasonRec.IndexNumber;
    const unairedObj = {};
    const unairedRes = await axiosGetWithRetry(
      urls.childrenUrl(cred, seasonId, true),
    );
    for (let key in unairedRes.data.Items) {
      const episodeRec = unairedRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      unairedObj[episodeNumber] = true;
    }
    const episodes = [];
    const episodesRes = await axiosGetWithRetry(
      urls.childrenUrl(cred, seasonId),
    );
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
        unilog(
          850,
          `S${seasonNumber}E${episodeNumber}: played=${played} avail=${avail} locationType=${episodeRec?.LocationType ?? "MISSING"} path=${path ?? "(none)"} pruning=${pruning}`,
        );
      }

      if (avail && !path) {
        unilog(851, "avail without path", `S${seasonNumber}E${episodeNumber}`);
        continue;
      }

      if (pruning) {
        if (!played && avail) {
          unilog(
            852,
            `STOP at S${seasonNumber}E${episodeNumber}: not watched, has file`,
          );
          pruning = false;
        } else {
          unilog(853, `queuing S${seasonNumber}E${episodeNumber}: ${path}`);
          if (path) pathsToDeleteBatch.push(path);
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

  if (pathsToDeleteBatch.length > 0) {
    unilog(
      1067,
      `batch deleting ${pathsToDeleteBatch.length} files for ${show.name}`,
    );
    try {
      await srvr.deletePaths(pathsToDeleteBatch);
      unilog(1066, `batch delete ok for ${show.name}`);
    } catch (e) {
      unilog(1065, `batch delete FAILED for ${show.name}: ${e?.message ?? e}`);
    }
  }

  if (missingEpisodeNumbers.length > 0) {
    unilog(855, "episodes missing numeric IndexNumber", {
      show: show?.name,
      showId: seriesId,
      sample: missingEpisodeNumbers,
    });
  }

  // Emby can return empty seasons, or partially-populated seasons (e.g. an
  // airing show whose future unaired episodes Emby hasn't created yet).
  // Backfill from TVDB so missing episodes render correctly: aired-but-absent
  // episodes show as missing files ("-") and unaired episodes show "u".
  // Partial-season backfill only matters for shows that are still airing.
  const needPartialBackfill = !show?.ended;
  if (emptySeasons.length > 0 || needPartialBackfill) {
    const tvdbId = show?.tvdbId;
    if (tvdbId) {
      try {
        const allTvdbData = await tvdb.getAllTvdb(0);
        // Get watchedEpis without forcing null fallback
        const tvdbRecord = allTvdbData?.[show.name];
        const watchedEpis = episodeDataToWatchedEpis(tvdbRecord?.episodeData);
        const fallback = await srvr.getSeriesMapFromTvdb({
          tvdbId,
          watchedEpis,
        });
        const fallbackMap = new Map(
          (fallback?.seriesMap || []).map((s) => [s[0], s[1]]),
        );
        for (let i = 0; i < seriesMap.length; i++) {
          const [seasonNum, episodes] = seriesMap[i];
          const tvdbEpisodes = fallbackMap.get(seasonNum);
          if (!Array.isArray(tvdbEpisodes) || tvdbEpisodes.length === 0) {
            continue;
          }
          if (episodes.length === 0) {
            // Whole season missing in Emby: use TVDB episodes as-is.
            seriesMap[i] = [seasonNum, tvdbEpisodes];
            continue;
          }
          // Partial season: append episodes TVDB knows about but Emby never
          // returned. Emby has no file for an episode it didn't return, so
          // force avail/noFile to reflect "no file"; keep unaired from TVDB so
          // future episodes render "u" instead of blank.
          const haveEpNums = new Set(episodes.map(([epNum]) => epNum));
          let added = false;
          for (const [epNum, tvdbEpi] of tvdbEpisodes) {
            if (haveEpNums.has(epNum)) continue;
            episodes.push([
              epNum,
              { ...tvdbEpi, avail: false, noFile: true, path: null },
            ]);
            added = true;
          }
          if (added) {
            episodes.sort((a, b) => a[0] - b[0]);
            seriesMap[i] = [seasonNum, episodes];
          }
        }
      } catch (err) {
        unilog(856, "failed TVDB backfill for Emby seasons", {
          show: show?.name,
          showId: seriesId,
          tvdbId,
          emptySeasons,
          error: err?.message || String(err),
        });
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
        unilog(857, "synthesized episodes for empty seasons", {
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
    unilog(
      858,
      `saveToTry error for ${showName}, id:${id}, inToTry:${inToTry}`,
      e,
    );
    throw e;
  }
  if (toTryRes.status !== 204) {
    const err =
      `unable to save totry for ${showName}, status=` +
      toTryRes.status +
      ", data=" +
      JSON.stringify(toTryRes.data);
    unilog(859, err);
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
    unilog(
      860,
      `saveContinue error for ${showName}, id:${id}, inContinue:${inContinue}`,
      e,
    );
    throw e;
  }
  if (continueRes.status !== 204) {
    const err =
      `unable to save Continue for ${showName}, status=` +
      continueRes.status +
      ", data=" +
      JSON.stringify(continueRes.data);
    unilog(861, err);
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
    unilog(
      862,
      `saveMark error for ${showName}, id:${id}, inMark:${inMark}`,
      e,
    );
    throw e;
  }
  if (markRes.status !== 204) {
    const err =
      `unable to save Mark for ${showName}, status=` +
      markRes.status +
      ", data=" +
      JSON.stringify(markRes.data);
    unilog(863, err);
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
    unilog(
      864,
      `saveLinda error for ${showName}, id:${id}, inLinda:${inLinda}`,
      e,
    );
    throw e;
  }
  if (lindaRes.status !== 204) {
    const err =
      `unable to save Linda for ${showName}, status=` +
      lindaRes.status +
      ", data=" +
      JSON.stringify(lindaRes.data);
    unilog(865, err);
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
  unilog(866, "deleteNoemby:", name);
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
  unilog(867, "startStop:", show, episodeId, watchButtonTxt);
  const devices = await srvr.getDevices();
  for (const device of devices) {
    const { deviceName, sessionId } = device;
    if (watchButtonTxt.startsWith("Stop")) {
      const buttonDeviceName = watchButtonTxt.split(" ")[1];
      if (buttonDeviceName != deviceName) continue;
      const { url, body } = urls.stopUrl(sessionId);
      await axios({ method: "post", url, data: body });
      unilog(1064, `stopped1 ${deviceName}`);
      setTimeout(async () => {
        await axios({ method: "post", url, data: body });
        unilog(1063, `stopped2 ${deviceName}`);
      }, 1000);
      return;
    } else {
      const buttonDeviceName = watchButtonTxt.split(" ")[2];
      if (buttonDeviceName != deviceName) continue;
      const { url, body } = urls.playUrl(sessionId, episodeId);
      await axios({ method: "post", url, data: body });
      unilog(1062, `playing1 ${show.name} on  ${deviceName}`);
      setTimeout(async () => {
        await axios({ method: "post", url, data: body });
        unilog(1061, `playing2 ${show.name} on  ${deviceName}`);
      }, 1000);

      // Auto-trim: jump to absolute trimPos when playback starts
      if (show?.trimPos != null && show.trimPos > 0) {
        setTimeout(async () => {
          try {
            await srvr.trimIntro(deviceName);
          } catch (e) {
            unilog(868, `trim intro error for ${show.name}:`, e);
          }
        }, 2500);
      }

      return;
    }
  }
};

export const afterLastWatched = async (show) => {
  if (show.inEmby === false) return { status: "noemby" };
  const showId = show.id;
  const seasonsRes = await axiosGetWithRetry(urls.childrenUrl(cred, showId));
  const seasonItems = seasonsRes.data.Items;
  for (let key in seasonItems) {
    let seasonRec = seasonItems[key];
    const seasonNumber = Number(seasonRec.IndexNumber);

    // Skip non-numbered / special seasons.
    if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) continue;
    const seasonId = seasonRec.Id;
    const unairedObj = {};
    const unairedRes = await axiosGetWithRetry(
      urls.childrenUrl(cred, seasonId, true),
    );
    for (let key in unairedRes.data.Items) {
      const episode = unairedRes.data.Items[key];
      const episodeNumber = Number(episode.IndexNumber);
      if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) continue;
      unairedObj[episodeNumber] = true;
    }
    const episodesRes = await axiosGetWithRetry(
      urls.childrenUrl(cred, seasonId),
    );
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
    await srvr.requestEmbyLibraryRefresh();
    return { status: "ok" };
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
  try {
    if (typeof onStatus === "function") onStatus("Refreshing Emby...");

    // Register for progress and completion before triggering to avoid race condition
    const donePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timeout waiting for libraryRefreshDone")),
        refreshTimeoutMs,
      );

      function onDone() {
        clearTimeout(timer);
        evtBus.off("libraryRefreshDone", onDone);
        evtBus.off("libraryProgress", onProgress);
        resolve();
      }

      function onProgress(data) {
        if (typeof onStatus !== "function") return;
        if (data?.pct != null)
          onStatus(`Scan: ${Number(data.pct).toFixed(0)}%`);
        else if (data?.status) onStatus(String(data.status));
      }

      evtBus.on("libraryRefreshDone", onDone);
      evtBus.on("libraryProgress", onProgress);
    });

    await srvr.requestEmbyLibraryRefresh();
    await donePromise;
  } catch (e) {
    return {
      createdFolder: true,
      status: "refreshfailed",
      err: e?.message || String(e),
    };
  }

  // Run server-side Emby sweep and wait for it to finish so inEmby status
  // is current before the caller reloads the show list.
  try {
    if (typeof onStatus === "function") onStatus("Syncing...");
    await srvr.embySync();
  } catch (e) {
    unilog(
      869,
      "createShowFolderAndRefreshEmby: embySync failed",
      e?.message || e,
    );
  }

  return { createdFolder: true, status: "ok" };
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
