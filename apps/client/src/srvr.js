import { config } from "./config.js";
import evtBus from "./evtBus.js";

const WS_URL = "wss://hahnca.com/tv-srvr";
const HTTP_URL = "https://hahnca.com/tv-srvr";

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
    console.log("opened websocket (ASR only)");
    haveSocket = true;
  };

  ws.onclose = () => {
    console.log("websocket closed, trying open in 2 secs");
    haveSocket = false;
    rejectAllPending({ error: "websocket closed" });
    setTimeout(openWs, 2000);
  };

  ws.onerror = (err) => {
    console.error(("websocket error:", err));
    haveSocket = false;
    rejectAllPending({ error: "websocket error", details: err });
  };
};

openWs();

// WebSocket call - only for ASR streaming
const fCall = (fname, param) => {
  const id = ++nextId;
  const promise = new Promise((resolve, reject) => {
    calls.push({ id, fname, param, resolve, reject });
  });
  if (typeof param == "object") param = JSON.stringify(param);
  const msg = JSON.stringify({ id, fname, param });

  if (!haveSocket) {
    setTimeout(() => fCall(fname, param), 100);
  } else {
    ws.send(msg);
  }
  return promise;
};

// HTTP call - for all non-streaming operations
const httpCall = async (endpoint, param, method = "GET") => {
  const url = `${HTTP_URL}${endpoint}`;
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

  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw error;
  }
  return response.json();
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

  const { id, status, data: result } = parts;

  // console.log("handling msg:", id, status);
  if (status === "asr-log") {
    evtBus.emit("asr-log", result);
    return;
  }

  if (id == "0") return;

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
  await delGap([show.Id, true]);
  if (show.Pickup) await delPickup(show.Name);
  await delNoEmby(show.Name);
  await deletePath(show.Path);
  // don't ever delete from remotes
  // don't ever delete from rejects
  // don't ever delete from tvdb
  console.log("deleted show from server:", show.Name);
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

// Shared filters (cross-computer)
export function getSharedFilters() {
  return httpCall("/api/getSharedFilters");
}
export function setSharedFilters(sharedFilters) {
  return httpCall("/api/setSharedFilters", sharedFilters, "POST");
}

export function deletePath(path) {
  return httpCall("/api/deletePath", path, "POST");
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
  return httpCall("/api/getSubFileIds", showName, "POST");
}

export function getRejects() {
  return httpCall("/api/getRejects");
}
export function addReject(name) {
  return httpCall("/api/addReject", name, "POST");
}
export function delReject(name) {
  return httpCall("/api/delReject", name, "POST");
}

export function getPickups() {
  return httpCall("/api/getPickups");
}
export function addPickup(name) {
  return httpCall("/api/addPickup", name, "POST");
}
export function delPickup(name) {
  return httpCall("/api/delPickup", name, "POST");
}

export function getNoEmbys() {
  return httpCall("/api/getNoEmbys");
}
export function addNoEmby(show) {
  return httpCall("/api/addNoEmby", show, "POST");
}
export function delNoEmby(name) {
  return httpCall("/api/delNoEmby", name, "POST");
}

export function getGaps() {
  return httpCall("/api/getGaps");
}
export function addGap(gapIdGapSave) {
  return httpCall("/api/addGap", gapIdGapSave, "POST");
}
export function delGap(gapIdSave) {
  return httpCall("/api/delGap", gapIdSave, "POST");
}

export function getAllTvdb() {
  return httpCall("/api/getAllTvdb");
}
export function getNewTvdb(params) {
  return httpCall("/api/getNewTvdb", params, "POST");
}

export function handleAsr(params) {
  return fCall("handleAsr", params);
}
export function setTvdbFields(params) {
  return httpCall("/api/setTvdbFields", params, "POST");
}
export function getRemotesCmd(params) {
  return httpCall("/api/getRemotes", params, "POST");
}
export function getActorPage(params) {
  return httpCall("/api/getActorPage", { name: params }, "POST");
}

export function sendEmail(emailData) {
  return httpCall("/api/sendEmail", emailData, "POST");
}

export function getTmdb(params) {
  return httpCall("/api/getTmdb", params, "POST");
}

// Persistent per-show notes
export function saveNote(showName, noteText) {
  return httpCall("/api/saveNote", { showName, noteText }, "POST");
}
export function getNote(showName) {
  return httpCall("/api/getNote", showName, "POST");
}
export function getAllNotes() {
  return httpCall("/api/getAllNotes");
}

// File browser
export async function getFile(path) {
  try {
    const res = await httpCall("/api/getFile", path, "POST");
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
