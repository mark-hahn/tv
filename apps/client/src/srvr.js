import { config } from "./config.js";
import evtBus from "./evtBus.js";

const HTTP_URL = config.tvSrvrUrl;
const WS_URL = HTTP_URL.replace(/^https/, "wss");

let ws;
const openWs = () => {
  ws = new WebSocket(WS_URL);
  attachWsHandlers();
};

let handleMsg = null;
let haveSocket = false;

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
    haveSocket = true;
  };

  ws.onclose = () => {
    haveSocket = false;
    rejectAllPending({ error: "websocket closed" });
    setTimeout(openWs, 2000);
  };

  ws.onerror = (err) => {
    haveSocket = false;
    rejectAllPending({ error: "websocket error", details: err });
  };
};

openWs();

// WebSocket call - only for ASR streaming
const fCall = async (fname, param) => {
  if (!haveSocket) {
    const start = Date.now();
    // Wait up to 5 seconds for WebSocket to connect
    while (!haveSocket && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  if (!haveSocket) throw { error: "websocket closed" };

  const id = ++nextId;
  const promise = new Promise((resolve, reject) => {
    calls.push({ id, fname, param, resolve, reject });
  });
  // Send object directly as part of JSON message
  const msg = JSON.stringify({ id, fname, param });
  ws.send(msg);
  return promise;
};

// HTTP call - for all non-streaming operations
const waitForServer = async () => {
  if (haveSocket) return;
  const start = Date.now();
  // Wait up to 5 seconds for WebSocket to connect
  while (!haveSocket && Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  // If still no socket, log warning but proceed (HTTP might work independently)
  if (!haveSocket) {
    console.warn(
      "waitForServer: proceeding without WebSocket connection (timeout)",
    );
  }
};

const httpCall = async (endpoint, param, method = "GET") => {
  const url = `${HTTP_URL}${endpoint}`;
  const TIMEOUT_MS = 30000; // 30 second timeout

  // Wait for server readiness to avoid startup errors if server is restarting
  await waitForServer();

  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (method === "GET" && param) {
    const params = new URLSearchParams(
      typeof param === "string" ? { param } : param,
    );
    return fetch(`${url}?${params}`).then((r) => r.json());
  } else if (method === "POST") {
    if (param !== undefined) {
      options.body = JSON.stringify(param);
    }
  }

  try {
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), TIMEOUT_MS);
    });

    // Race between fetch and timeout
    const response = await Promise.race([fetch(url, options), timeoutPromise]);

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw error;
    }
    return response.json();
  } catch (err) {
    // Add more context to network errors
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      throw new Error(`Network error: Unable to reach server at ${url}`);
    }
    throw err;
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
    console.error("skipping bad message:", msg);
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
    console.error("no matching id from msg:", id);
    return;
  }
  const call = calls[callIdx];
  calls.splice(callIdx, 1);
  const { fname, param, resolve, reject } = call;
  if (status != "ok" && result !== "cancelled")
    console.error("Reject from server:", { id, fname, param, status, result });

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
  console.log(
    "deleteShowFromSrvr: deleting folder:",
    showFolder,
    "for show:",
    show.name,
  );
  const result = await deletePath(showFolder);
  console.log("deleteShowFromSrvr: deletePath result:", result);

  if (result !== "ok") {
    throw new Error(`Failed to delete folder: ${result}`);
  }

  // don't ever delete from remotes
  // don't ever delete from rejects
  // don't ever delete from tvdb
  console.log("deleted show from server:", show.name);
}

export const lastViewedCache = {};

const updateLastViewedCache = async () => {
  const lastViewed = await getLastViewed();
  Object.assign(lastViewedCache, lastViewed);
};
setTimeout(updateLastViewedCache, 0);
setInterval(updateLastViewedCache, 10 * 1000); // every 10 secs

export function getShowsFromDisk() {
  return httpCall("/api/getShowsFromDisk");
}
export function createShowFolder(params) {
  return httpCall("/api/createShowFolder", params, "POST");
}
export function embySync() {
  return httpCall("/api/embySync", {}, "POST");
}

// Shared filters (cross-computer)
export function getSharedFilters() {
  return httpCall("/api/getSharedFilters");
}
export function setSharedFilters(sharedFilters) {
  return httpCall("/api/setSharedFilters", sharedFilters, "POST");
}

export function deletePath(path) {
  return httpCall("/api/deletePath", { path }, "POST");
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

export function getDevices() {
  return httpCall("/api/getDevices");
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

// Apply subtitle files to media files on the server.
// fileIdObjs: [{ file_id:number, showName:string, season:number, episode:number }, ...]
// Returns: "ok" or { error: string }
export function applySubFiles(fileIdObjs) {
  return httpCall("/api/applySubFiles", fileIdObjs, "POST");
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

// Scan the show folder for existing subtitle files and return their file-id base32 strings.
// showName: string
// Returns: string[] (e.g. ["ASD2H", "IF8JH"])
export function getSubFileIds(showName) {
  return httpCall("/api/getSubFileIds", { showName }, "POST");
}

export function getRejects() {
  return httpCall("/api/getRejects");
}
export function addReject(name, tvdbId) {
  return httpCall("/api/addReject", { name, tvdbId }, "POST");
}
export function delReject(name, tvdbId) {
  return httpCall("/api/delReject", { name, tvdbId }, "POST");
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

export function triggerEmbySync(showId, showName) {
  return httpCall("/api/triggerEmbySync", { showId, showName }, "POST");
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

export function handleAsr(params) {
  return fCall("handleAsr", params);
}

export function handleFix(params) {
  return fCall("handleFix", params);
}

export function setTvdbFields(params) {
  const keys = Object.keys(params || {}).filter((k) => k !== "name");
  const stack = new Error().stack.split("\n").slice(1, 5).join(" | ");
  console.log(
    `[tvdb loop3] setTvdbFields name=${params?.name} keys=[${keys.join(",")}] dontEnqueue=${params?.dontEnqueue} from: ${stack}`,
  );
  return httpCall("/api/setTvdbFields", params, "POST");
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
  console.log(
    "[SRVR.JS] getActorCredits called with:",
    params,
    new Date().toISOString(),
  );
  const response = await fetch(`${config.torrentsApiUrl}/api/getActorCredits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: params }),
  });
  console.log("[SRVR.JS] fetch completed with status:", response.status);
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

export function sendEmail(emailData) {
  return httpCall("/api/sendEmail", { body: emailData }, "POST");
}

export function getTmdb(params) {
  return httpCall("/api/getTmdb", params, "POST");
}

export function getStreamProviders(params) {
  return httpCall("/api/getStreamProviders", params, "POST");
}

// Persistent per-show notes
export function saveNote(showName, noteText) {
  return httpCall("/api/saveNote", { showName, noteText }, "POST");
}
export function getNote(showName) {
  return httpCall("/api/getNote", { showName }, "POST");
}
export function getAllNotes() {
  return httpCall("/api/getAllNotes");
}

// File browser
export async function getFile(path) {
  try {
    const res = await httpCall("/api/getFile", { path }, "POST");
    return res;
  } catch (err) {
    console.error("HTTP getFile error:", err);
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
