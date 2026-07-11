import { config } from "./config.js";
import evtBus from "./evtBus.js";
import { unilog } from "./log.js";

const HTTP_URL = config.tvSrvrUrl;
const WS_URL = HTTP_URL.replace(/^https/, "wss");
const WS_START_DELAY_MS = 0;
const WS_RECONNECT_DELAY_MS = 10000;
const LAST_VIEWED_START_DELAY_MS = 0;
const LAST_VIEWED_POLL_MS = 10 * 1000;
const LAST_VIEWED_TIMEOUT_MS = 8000;

// Stable per-page client id, used to ignore our own echoed remote actions
// (a live duplicate socket — e.g. a Vite HMR leftover — would otherwise make a
// single UI collide with itself). Stored on globalThis so it survives HMR.
export const clientId =
  globalThis.__tvClientId ||
  (globalThis.__tvClientId = Math.random().toString(36).slice(2));

let ws;
let reconnectTimer = null;
let wsWanted = false;

const openWs = () => {
  if (
    ws?.readyState === WebSocket.OPEN ||
    ws?.readyState === WebSocket.CONNECTING
  )
    return;
  ws = new WebSocket(WS_URL);
  attachWsHandlers();
};

let handleMsg = null;

const isSocketOpen = () => ws?.readyState === WebSocket.OPEN;

const waitForSocket = async (timeoutMs) => {
  if (isSocketOpen()) return true;
  const start = Date.now();
  while (!isSocketOpen() && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return isSocketOpen();
};

const ensureWs = async ({ waitMs = 0 } = {}) => {
  wsWanted = true;
  openWs();
  if (waitMs <= 0) return isSocketOpen();
  return waitForSocket(waitMs);
};

const calls = [];
let nextId = 0;

const rejectAllPending = (reason) => {
  const err = reason || { error: "websocket disconnected" };
  while (calls.length) {
    const call = calls.shift();
    try {
      call.reject(err);
    } catch {
      // ignore
    }
  }
};

const attachWsHandlers = () => {
  ws.onmessage = (event) => {
    handleMsg(event.data);
  };

  ws.onopen = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    evtBus.emit("ws-reconnected");
  };

  ws.onclose = () => {
    rejectAllPending({ error: "websocket closed" });
    if (wsWanted && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openWs();
      }, WS_RECONNECT_DELAY_MS);
    }
  };

  ws.onerror = (err) => {
    rejectAllPending({ error: "websocket error", details: err });
  };
};

setTimeout(() => {
  ensureWs().catch((err) => {
    unilog(870, "Failed to start WebSocket", err);
  });
}, WS_START_DELAY_MS);

export const wsSend = (obj) => {
  ensureWs({ waitMs: 5000 })
    .then((ready) => {
      if (ready) ws.send(JSON.stringify(obj));
    })
    .catch((err) => {
      unilog(871, "WebSocket send failed", err);
    });
};

// WebSocket call - only for ASR streaming
const fCall = async (fname, param) => {
  await ensureWs({ waitMs: 5000 });

  if (!isSocketOpen()) throw { error: "websocket closed" };

  const id = ++nextId;
  const promise = new Promise((resolve, reject) => {
    calls.push({ id, fname, param, resolve, reject });
  });
  // Send object directly as part of JSON message
  const msg = JSON.stringify({ id, fname, param });
  ws.send(msg);
  return promise;
};

const httpCall = async (endpoint, param, method = "GET", timeoutMs = 30000) => {
  let url = `${HTTP_URL}${endpoint}`;
  const TIMEOUT_MS = timeoutMs;
  const controller = new AbortController();
  let timedOut = false;

  const options = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
  };

  if (method === "GET" && param) {
    const params = new URLSearchParams(
      typeof param === "string" ? { param } : param,
    );
    url = `${url}?${params}`;
  } else if (method === "POST") {
    if (param !== undefined) {
      options.body = JSON.stringify(param);
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw error;
    }
    return response.json();
  } catch (err) {
    if (timedOut) {
      throw new Error("Request timeout");
    }
    // Add more context to network errors
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      throw new Error(`Network error: Unable to reach server at ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

handleMsg = async (msg) => {
  if (msg instanceof Blob) {
    const text = await msg.text();
    msg = text;
  }
  msg = msg.toString();

  let parts;
  try {
    parts = JSON.parse(msg);
  } catch (e) {
    unilog(872, "skipping bad message:", msg);
    return;
  }

  const { id, notification, status, data: result } = parts;

  // Handle ASR logs (server->client push)
  if (status === "asr-log") {
    evtBus.emit("asr-log", result);
    return;
  }

  // Handle Fix/ffmpeg logs (server->client push)
  if (status === "fix-log") {
    evtBus.emit("fix-log", result);
    return;
  }

  // Handle server->client notifications (id === 0)
  if (id === 0 && notification) {
    evtBus.emit(notification, result);
    return;
  }

  if (id == "0") return;

  // Handle responses to client->server calls
  const callIdx = calls.findIndex((call) => call.id == id);
  if (callIdx < 0) {
    unilog(873, "no matching id from msg:", id);
    return;
  }
  const call = calls[callIdx];
  calls.splice(callIdx, 1);
  const { fname, param, resolve, reject } = call;
  if (status != "ok" && result !== "cancelled")
    unilog(874, "Reject from server:", { id, fname, param, status, result });

  // console.log("parsing ws result:", {id, result});
  // const res = JSON.parse(result);
  const res = result;
  if (status == "ok") resolve(res);
  else reject(res);
  /*
  try {
    // console.log("parsing ws result:", {id, result});
    const res = JSON.parse(result);
    if (status == "ok") resolve(res);
    else reject(res);
  } catch (err) {
    const msg = `handleMsg, error parsing ws result:`;
    console.error(msg, { id, result, err });
    reject(msg);
  }
  */
};

export async function deleteShowFromSrvr(show) {
  await delGap({ gapId: show.id, save: true });
  await delNoEmby(show.name);

  // Delete entire show folder from disk
  // Extract just the folder name from the Emby path (e.g., "/tv/ShowName" -> "ShowName")
  const showFolder = show.path.split("/").pop();
  unilog(
    875,
    "deleteShowFromSrvr: deleting folder:",
    showFolder,
    "for show:",
    show.name,
  );
  const result = await deletePath(showFolder);
  unilog(876, "deleteShowFromSrvr: deletePath result:", result);

  if (result !== "ok") {
    throw new Error(`Failed to delete folder: ${result}`);
  }

  // don't ever delete from remotes
  // don't ever delete from rejects
  // don't ever delete from tvdb
  unilog(877, "deleted show from server:", show.name);
}

export const lastViewedCache = {};

let lastViewedCacheUpdating = false;
let lastViewedCacheFailureCount = 0;

const updateLastViewedCache = async () => {
  if (lastViewedCacheUpdating) return;
  lastViewedCacheUpdating = true;
  try {
    const lastViewed = await httpCall(
      "/api/getLastViewed",
      null,
      "GET",
      LAST_VIEWED_TIMEOUT_MS,
    );
    Object.assign(lastViewedCache, lastViewed);
    lastViewedCacheFailureCount = 0;
  } catch (err) {
    lastViewedCacheFailureCount += 1;
    if (
      lastViewedCacheFailureCount === 1 ||
      lastViewedCacheFailureCount % 10 === 0
    ) {
      unilog(878, "Failed to update lastViewed cache", err.message || String(err));
    }
  } finally {
    lastViewedCacheUpdating = false;
  }
};
setTimeout(updateLastViewedCache, LAST_VIEWED_START_DELAY_MS);
setInterval(updateLastViewedCache, LAST_VIEWED_POLL_MS);

export function getShowsFromDisk() {
  return httpCall("/api/getShowsFromDisk");
}
export function getUnilogEvents(params) {
  return httpCall("/api/unilog/events", params, "GET", 15000);
}
export function getUnilogOldestTs() {
  return httpCall("/api/unilog/oldest-ts", {}, "GET");
}
export function setUnilogSiteLevel(ids, level) {
  return httpCall("/api/unilog/set-level", { ids, level }, "POST");
}
export function deleteUnilogEvents(eventIds) {
  return httpCall("/api/unilog/delete-events", { eventIds }, "POST");
}
export function showUnilogEvents(groupIds) {
  return httpCall("/api/unilog/show-events", { groupIds }, "POST");
}
export function unshowUnilogEvents(groupIds) {
  return httpCall("/api/unilog/unshow-events", { groupIds }, "POST");
}
export function getUnilogGroups() {
  return httpCall("/api/unilog/groups", {}, "GET");
}
export function getUnilogOrphanGroups() {
  return httpCall("/api/unilog/groups/orphans", {}, "GET");
}
export function getUnilogGroupStats(groupId) {
  return httpCall("/api/unilog/groups/stats", { groupId }, "GET");
}
export function createUnilogGroup(description, logIds) {
  return httpCall("/api/unilog/groups/create", { description, logIds }, "POST");
}
export function assignUnilogGroups(groupIds, logIds) {
  return httpCall("/api/unilog/groups/assign", { groupIds, logIds }, "POST");
}
export function removeUnilogGroups(groupIds, logIds) {
  return httpCall("/api/unilog/groups/remove", { groupIds, logIds }, "POST");
}
export function deleteUnilogGroups(groupIds) {
  return httpCall("/api/unilog/groups/delete", { groupIds }, "POST");
}
export function getUnilogGroupSiteIds(groupIds) {
  return httpCall("/api/unilog/groups/site-ids", { groupIds }, "POST");
}
export function getUnilogGroupIdsForSites(logIds) {
  return httpCall("/api/unilog/groups/ids-for-sites", { logIds }, "POST");
}
export function getUnilogGroupsForSites(logIds) {
  return httpCall("/api/unilog/groups/for-sites", { logIds }, "POST");
}
export function setUnilogGroupName(groupId, description) {
  return httpCall(
    "/api/unilog/groups/set-name",
    { groupId, description },
    "POST",
  );
}
export function unilogSubscribe() {
  wsSend({ id: 0, fname: "unilogSubscribe" });
}
export function unilogUnsubscribe() {
  wsSend({ id: 0, fname: "unilogUnsubscribe" });
}
export function createShowFolder(params) {
  return httpCall("/api/createShowFolder", params, "POST");
}
export function embySync() {
  return httpCall("/api/embySync", {}, "POST");
}

// Save and verify a new reddit loid cookie on the server
export function setLoidCookie(cookie) {
  return httpCall("/api/setLoidCookie", { cookie }, "POST");
}

// Shared filters (cross-computer)
export function getSharedFilters() {
  return httpCall("/api/getSharedFilters", null, "GET", 8000);
}
export function setSharedFilters(sharedFilters) {
  return httpCall("/api/setSharedFilters", sharedFilters, "POST");
}

export function deletePath(path) {
  return httpCall("/api/deletePath", { path }, "POST");
}
export function deletePaths(paths) {
  return httpCall("/api/deletePaths", { paths }, "POST");
}
export function delSeasonFiles(showName, showPath, season) {
  return httpCall(
    "/api/delSeasonFiles",
    { showName, showPath, season },
    "POST",
  );
}
export function updateTvdb() {
  return httpCall("/api/updateTvdb", null, "POST");
}

export function accessTvdb(params) {
  return httpCall("/api/accessTvdb", params, "POST");
}

export function getTvmazeCrew(params) {
  return httpCall("/api/getTvmazeCrew", params, "POST");
}

let _vipCache = null;
export async function getVipActors() {
  if (_vipCache) return _vipCache;
  _vipCache = httpCall("/api/getVipActors", null, "GET")
    .then((list) => {
      return Array.isArray(list) ? new Set(list) : new Set();
    })
    .catch(() => new Set());
  return _vipCache;
}

export async function setVipActors(list) {
  _vipCache = Promise.resolve(new Set(list));
  return httpCall("/api/setVipActors", { list }, "POST");
}

export function getGroupCounts() {
  return httpCall("/api/getGroupCounts");
}

export function getBadGroups() {
  return httpCall("/api/getBadGroups");
}
export function toggleBadGroup(group) {
  return httpCall("/api/toggleBadGroup", { group }, "POST");
}

export function incrementGroupCount(group) {
  return httpCall("/api/incrementGroupCount", { group }, "POST");
}

export function getDevices() {
  return httpCall("/api/getDevices");
}

export function skipIntro(deviceName) {
  return httpCall(
    "/api/skipIntro",
    { pressedAt: Date.now(), deviceName },
    "POST",
  );
}

export function trimIntro(deviceName) {
  return httpCall("/api/trimIntro", { deviceName }, "POST");
}

export function embyViewShow(showId, showName) {
  return httpCall("/api/embyViewShow", { showId, showName }, "POST");
}

export function getLastViewed() {
  return httpCall("/api/getLastViewed");
}

// OpenSubtitles (server-side search)
// tv-srvr should implement this endpoint.
// params: { imdb_id?: string, q?: string, page?: number }
export function subsSearch(params) {
  return httpCall("/api/subsSearch", params, "POST");
}

// Search OpenSubtitles for each video path.
// videoPaths: string[]
// Returns: { results: [{ videoPath, items: [...], error? }] }
export function searchOpn(videoPaths) {
  return httpCall("/api/opn/search", { videoPaths }, "POST", 60000);
}

// Apply subtitle files to media files on the server.
// fileIdObjs: [{ file_id:number, showName:string, season:number, episode:number }, ...]
// Returns: "ok" or { error: string }
export function applySubFiles(fileIdObjs) {
  return httpCall("/api/applySubFiles", fileIdObjs, "POST", 120000);
}

// Delete previously applied subtitle files on the server.
// fileIdObjs: [{ file_id:number, showName:string, season:number, episode:number }, ...]
// Returns: "ok" or { error: string }
export function deleteSubFiles(fileIdObjs) {
  return httpCall("/api/deleteSubFiles", fileIdObjs, "POST");
}

// Offset (trim) existing subtitle files on the server.
// fileIdObjs: [{ file_id:number, showName:string, season:number, episode:number, offset:number }, ...]
// Returns: "ok" or { error: string } or { ok:true, failures:[...], applied:[...] }
export function offsetSubFiles(fileIdObjs) {
  return httpCall("/api/offsetSubFiles", fileIdObjs, "POST");
}

// Apply the slider offset to an SRT file in-place.
// { videoPath:string, srtFile:string, offsetMs:number }
export function applySubOffset(params) {
  return httpCall("/api/applySubOffset", params, "POST");
}

// Scan the show folder for existing subtitle files and return their file-id base32 strings.
// showName: string
// Returns: string[] (e.g. ["ASD2H", "IF8JH"])
export function getSubFileIds(showName) {
  return httpCall("/api/getSubFileIds", { showName }, "POST");
}

export function getNoEmbys() {
  return httpCall("/api/getNoEmbys");
}
export function addNoEmby(show) {
  return httpCall("/api/addNoEmby", show, "POST");
}
export function delNoEmby(name) {
  return httpCall("/api/delNoEmby", { name }, "POST");
}

export function getGaps() {
  return httpCall("/api/getGaps");
}

export function triggerEmbySync() {
  return httpCall("/api/triggerEmbySync", {}, "POST");
}

export function requestEmbyLibraryRefresh() {
  return httpCall("/api/requestEmbyLibraryRefresh", {}, "POST");
}

export function getEmbyLibraryRefreshStatus() {
  return httpCall("/api/embyLibraryRefreshStatus", null, "GET");
}

export function embyTaskStatus(taskId) {
  return httpCall(
    `/api/embyTaskStatus?taskId=${encodeURIComponent(taskId)}`,
    null,
    "GET",
  );
}

export function refreshEmbyItem(showId, showName) {
  return httpCall("/api/refreshEmbyItem", { showId, showName }, "POST");
}

export function triggerShowGapCheck(showId, showName) {
  return httpCall("/api/triggerShowGapCheck", { showId, showName }, "POST");
}
export function triggerShowSelect(showName) {
  return httpCall("/api/triggerShowSelect", { showName }, "POST");
}
export function addGap(params) {
  return httpCall("/api/addGap", params, "POST");
}
export function delGap(gapIdSave) {
  return httpCall("/api/delGap", gapIdSave, "POST");
}

export function getAllTvdb(hasEmby = 0) {
  return httpCall(`/api/getAllTvdb?hasEmby=${hasEmby}`);
}
export function getNewTvdb(params) {
  return httpCall("/api/getNewTvdb", params, "POST");
}

export function searchTvdbByImdbId(params) {
  return httpCall("/api/searchTvdbByImdbId", params, "POST");
}

export function getSeriesMapFromTvdb(params) {
  return httpCall("/api/getSeriesMapFromTvdb", params, "POST");
}

export function getSeriesMapFromEmby(params) {
  return httpCall("/api/getSeriesMapFromEmby", params, "POST");
}

export function clearEpisodePositions(showName, cells) {
  return httpCall("/api/clearEpisodePositions", { showName, cells }, "POST");
}

export function setWatchedEpis(params) {
  return httpCall("/api/setWatchedEpis", params, "POST");
}

export function handleAsr(params) {
  return fCall("handleAsr", params);
}

export function embApply(reqPath) {
  return httpCall("/api/asr/emb/apply", { path: reqPath }, "POST");
}

export function enqueueSubs(videoPaths, fromUI) {
  return httpCall("/api/asr/subs/enqueue", { videoPaths, fromUI }, "POST");
}

export function enqueueGenSrt(videoPaths, fromUI) {
  return httpCall("/api/asr/gensrt/enqueue", { videoPaths, fromUI }, "POST");
}

export function generateEmb(videoPaths) {
  return httpCall("/api/asr/emb/generate", { videoPaths }, "POST");
}

export function handleFix(params) {
  return fCall("handleFix", params);
}

export function getChksrtList() {
  return httpCall("/api/asr/chksrt/list");
}

export function enqueueChksrt(videoPaths) {
  return httpCall("/api/asr/chksrt/enqueue", { videoPaths }, "POST");
}

export function chksrtOk(videoPath) {
  return httpCall("/api/asr/chksrt/ok", { videoPath }, "POST");
}

export function chksrtGenSrt(videoPath) {
  return httpCall("/api/asr/chksrt/gensrt", { videoPath }, "POST");
}

export function chksrtSnooze(videoPath) {
  return httpCall("/api/asr/chksrt/snooze", { videoPath }, "POST");
}

export function chksrtSelect(videoPath, selectedSrtPath) {
  return httpCall(
    "/api/asr/chksrt/select",
    { videoPath, selectedSrtPath },
    "POST",
  );
}

export function getChksrtHistory() {
  return httpCall("/api/asr/chksrt/history");
}

export function addChksrtHistory(entry) {
  return httpCall("/api/asr/chksrt/history/add", entry, "POST");
}

export function getAsrLog() {
  return httpCall("/api/asr/log");
}

export function getAsrQueue() {
  return httpCall("/api/asr/queue");
}

export function addToAsrQueue(videoPaths) {
  return httpCall("/api/asr/queue/add", { videoPaths }, "POST");
}

export function removeFromAsrQueue(videoPath) {
  return httpCall("/api/asr/queue/remove", { videoPath }, "POST");
}

export function killAsrProcess() {
  return httpCall("/api/asr/kill", {}, "POST");
}

export function setTvdbFields(params) {
  return httpCall("/api/setTvdbFields", params, "POST");
}

export function introFirstFile(showName) {
  return httpCall(
    `/api/introFirstFile?showName=${encodeURIComponent(showName)}`,
    null,
    "GET",
  );
}

export function hasBif(videoPath) {
  return httpCall(
    `/api/hasBif?path=${encodeURIComponent(videoPath)}`,
    null,
    "GET",
  );
}

export function enqueueBif(showName, paths) {
  return httpCall("/api/bif/enqueue", { showName, paths }, "POST");
}

export function saveSeasonIntro(name, season, field, value) {
  return httpCall(
    "/api/saveSeasonIntro",
    { name, season, field, value },
    "POST",
  );
}

export function introNextFile(showName, season, episode) {
  return httpCall(
    `/api/introNextFile?showName=${encodeURIComponent(showName)}&season=${season}&episode=${episode}`,
    null,
    "GET",
  );
}
export function getRemotesCmd(params) {
  return httpCall("/api/getRemotes", params, "POST");
}

export async function getActorPage(params) {
  const response = await fetch(`${config.torrentsApiUrl}/api/getActorPage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: params }),
  });
  if (!response.ok) {
    throw new Error(
      `getActorPage failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.json();
}

export async function getActorCredits(params) {
  unilog(879, "getActorCredits called with:", params, new Date().toISOString());
  const response = await fetch(`${config.torrentsApiUrl}/api/getActorCredits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: params }),
  });
  unilog(880, "fetch completed with status:", response.status);
  if (!response.ok) {
    throw new Error(
      `getActorCredits failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.json();
}

export function searchActorsInNonEmby(params) {
  return httpCall("/api/searchActorsInNonEmby", params, "POST");
}

export function getTmdb(params) {
  return httpCall("/api/getTmdb", params, "POST");
}

export function searchTmdbPerson(params) {
  return httpCall("/api/searchTmdbPerson", params, "POST");
}

export function getStreamProviders(params) {
  return httpCall("/api/getStreamProviders", params, "POST");
}

// File browser
export async function getFile(path) {
  try {
    const res = await httpCall("/api/getFile", { path }, "POST");
    return res;
  } catch (err) {
    unilog(881, "HTTP getFile error:", err);
    throw err;
  }
}

// Reviews
export async function getReviews(url, buttonName) {
  // Use http fetch to call the backend api, not fCall (websocket)
  // Construct the query parameters
  const params = new URLSearchParams({
    url: url || "",
    btn: buttonName || "",
  });

  const response = await fetch(
    `${config.torrentsApiUrl}/api/reviews/getReviews?` + params.toString(),
  );
  if (!response.ok) {
    throw new Error(
      `getReviews failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.json();
}

export async function getImdbReviews(imdbId) {
  const params = new URLSearchParams({
    imdbId: imdbId || "",
  });

  const response = await fetch(
    `${config.torrentsApiUrl}/api/reviews/getImdbReviews?` + params.toString(),
  );
  if (!response.ok) {
    throw new Error(
      `getImdbReviews failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.json();
}

export function debugTvdb(params) {
  return httpCall("/api/debugTvdb", params, "POST");
}

export async function getSitcoms() {
  const response = await fetch(`${HTTP_URL}/api/getSitcoms`);
  if (!response.ok) {
    throw new Error(
      `getSitcoms failed: ${response.status} ${response.statusText}`,
    );
  }
  const result = await response.json();
  return result.sitcoms || [];
}
