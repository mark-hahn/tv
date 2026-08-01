import { config } from "./config.js";
import evtBus from "./evtBus.js";
import { unilog, logHere } from "./log.js";

const HTTP_URL = config.tvSrvrUrl;
const WS_URL = HTTP_URL.replace(/^https/, "wss");
const WS_START_DELAY_MS = 0;
const WS_RECONNECT_DELAY_MS = 10000;
const SLOW_REQUEST_MS = 3000;

// Vite re-executes this module on every edit, but it will NOT dispose the old
// instance: the HMR boundary is the importing .vue component, not this module,
// so vite updates the component, which re-imports this file under a fresh URL
// while the previous instance keeps running. import.meta.hot.dispose() here is
// therefore never called, and its timers/websocket leak. Each stacked instance
// re-runs every poll and handles every server broadcast again, so requests
// arrive at the server in duplicate/triplicate.
//
// So a new instance tears down its predecessor itself, rather than trusting
// vite to do it. The cleanup below is registered on globalThis, the one thing
// that survives the module swap.
if (import.meta.hot) globalThis.__tvSrvrCleanup?.();

// In-flight count is the tell for a stall that never reaches the server: if
// requests time out while this is high, they were queued in the browser behind
// other requests rather than being served slowly.
let inFlight = 0;

// Browser main-thread lag, the mirror of the server's loop-lag monitor. A fetch
// resolves on the main thread, so a blocked main thread makes a fast response
// look like a slow request. Reporting lag alongside every slow/timed-out call
// separates "the server was slow" from "we were too busy to notice it answer".
const LAG_SAMPLE_MS = 500;
// Below this a block isn't worth mentioning: loopLagSuffix() only appends
// " loopLag=Nms" to a slow/timed-out request when the worst block during it
// reached this, so plain network latency (loopLag≈0) doesn't get tagged. The
// old standalone freeze log (site 1452) fired off this too but was removed —
// see the Event Timing observer below for why.
const LAG_REPORT_MS = 1000;
let maxLoopLagMs = 0;
let lagLastAt = performance.now();
// A backgrounded tab gets its timers throttled by the browser to save power,
// which produces the exact same symptom as real jank: this interval fires
// late. Track visibility so a throttled-while-hidden gap can be told apart
// from an actual main-thread freeze that happened while the tab was in front.
// Confirmed via a Firefox Profiler capture (2026-07-14): during a run full of
// "tab backgrounded" reports, the profiler showed zero real gaps and no
// function with more than ~400ms of total self-time — backgrounded gaps are
// not jank, so only the visible-tab case is logged.
let wasHiddenSinceLastTick = document.hidden;
const onVisibilityChange = () => {
  if (document.hidden) wasHiddenSinceLastTick = true;
};
document.addEventListener("visibilitychange", onVisibilityChange);
const lagTimer = setInterval(() => {
  const now = performance.now();
  const lag = Math.round(now - lagLastAt - LAG_SAMPLE_MS);
  lagLastAt = now;
  // A backgrounded-tab lag must never enter maxLoopLagMs: it's not jank (see
  // above), so it has nothing to say about the browser being busy. Left in,
  // it would sit here as a stale high-water mark until some unrelated later
  // request happened to read and reset it via loopLagSuffix(), making that
  // request look jank-related when it wasn't.
  if (!wasHiddenSinceLastTick) {
    if (lag > maxLoopLagMs) maxLoopLagMs = lag;
  }
  wasHiddenSinceLastTick = document.hidden;
}, LAG_SAMPLE_MS);

// Worst main-thread block seen since the last call, then reset — so each slow
// request reports the lag that happened during it, not a stale high-water mark.
const takeMaxLoopLag = () => {
  const lag = maxLoopLagMs;
  maxLoopLagMs = 0;
  return lag;
};

// " loopLag=Nms" when the block was big enough to matter, else "" — most slow
// requests are plain network/server latency with loopLag=0, and printing that
// on every line just buries the cases where the browser was actually the cause.
const loopLagSuffix = () => {
  const lag = takeMaxLoopLag();
  return lag >= LAG_REPORT_MS ? ` loopLag=${lag}ms` : "";
};

// Delay the user actually feels. The timer-lag probe above can't tell a real
// freeze from an idle/asleep/occluded tab — document.hidden only flips on tab
// switch or minimize, not on OS sleep or window occlusion — so it fired
// constantly with no delay anyone experienced. The Event Timing API measures
// the real thing: the gap between a genuine input (click/tap/key) and the next
// paint. It only records when the user actually interacts, so idle, sleep, and
// background gaps can never inflate it. durationThreshold filters to entries at
// or above the report threshold. Feature-gated for safety, but every current
// browser supports "event" (Baseline 2025, Firefox included since v114), so
// this runs everywhere; a browser too old to have it simply gets no perf
// logging, which beats the interaction-less noise a fallback probe would add.
const RESPONSE_REPORT_MS = 1000;
// The browser fires an "event" entry for every event type above the duration
// threshold, not just discrete input — hover/move types (mouseenter, mouseover,
// pointerout, etc.) qualify too, and one hover motion can dispatch a separate
// mouseenter/mouseleave per nested element, flooding the log with entries that
// aren't a "genuine input" per the comment above. Restrict to the click/tap/key
// types that comment actually means.
const REPORTED_EVENT_NAMES = new Set([
  "click",
  "auxclick",
  "dblclick",
  "keydown",
  "keyup",
  "touchstart",
  "touchend",
  "pointerdown",
  "pointerup",
]);
let eventTimingObserver = null;
if (window.PerformanceObserver?.supportedEntryTypes?.includes("event")) {
  eventTimingObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!REPORTED_EVENT_NAMES.has(entry.name)) continue;
      unilog(
        1776,
        `${entry.name} took ${Math.round(entry.duration)}ms to respond`,
      );
    }
  });
  eventTimingObserver.observe({
    type: "event",
    durationThreshold: RESPONSE_REPORT_MS,
  });
}

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

const channelSubscribers = new Map();

const sendChannelControl = (ch, op) => {
  wsSend({ ch, op });
};

export const openChannel = (name, handlers = {}) => {
  let entry = channelSubscribers.get(name);
  if (!entry) {
    entry = { subscribers: new Set() };
    channelSubscribers.set(name, entry);
    sendChannelControl(name, "sub");
  }

  const subscriber = {
    onSnapshot: handlers.onSnapshot,
    onDelta: handlers.onDelta,
    onUnavailable: handlers.onUnavailable,
  };
  entry.subscribers.add(subscriber);

  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      const current = channelSubscribers.get(name);
      if (!current) return;
      current.subscribers.delete(subscriber);
      if (current.subscribers.size === 0) {
        channelSubscribers.delete(name);
        sendChannelControl(name, "unsub");
      }
    },
  };
};

const handleChannelFrame = (frame) => {
  const entry = channelSubscribers.get(frame.ch);
  if (!entry) return true;

  for (const subscriber of [...entry.subscribers]) {
    if (frame.op === "snapshot") subscriber.onSnapshot?.(frame.data);
    else if (frame.op === "delta") subscriber.onDelta?.(frame.data);
    else if (frame.op === "unavailable") subscriber.onUnavailable?.();
  }
  return true;
};

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
  const currentSocket = ws;
  ws.onmessage = (event) => {
    handleMsg(event.data);
  };

  ws.onopen = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    evtBus.emit("ws-reconnected");
    for (const name of channelSubscribers.keys())
      sendChannelControl(name, "sub");
  };

  ws.onclose = () => {
    if (ws !== currentSocket) return;
    ws = null;
    rejectAllPending({ error: "websocket closed" });
    if (wsWanted && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openWs();
      }, WS_RECONNECT_DELAY_MS);
    }
  };

  ws.onerror = (err) => {
    if (ws !== currentSocket) return;
    rejectAllPending({ error: "websocket error", details: err });
  };
};

const wsStartTimer = setTimeout(() => {
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

// A deploy reloads tv-srvr in ~1-2s; a fetch that fails as fully unreachable
// (connection refused, not a timeout) during that window is not a real outage.
// Retrying once after this delay tells the two apart: the retry succeeds for a
// deploy blip and nothing gets logged, while a real outage still fails and is
// reported as before — just ~1.5s later.
const UNREACHABLE_RETRY_DELAY_MS = 1500;

const httpCall = async (endpoint, param, method = "GET", timeoutMs = 30000) => {
  let url = `${HTTP_URL}${endpoint}`;
  const TIMEOUT_MS = timeoutMs;

  const options = { method, headers: { "Content-Type": "application/json" } };

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

  // One fetch attempt with its own abort timer. Returns {response} on success,
  // or {err, timedOut} on failure — never throws, so the caller can decide
  // whether to retry without a try/catch per attempt.
  const attempt = async () => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return { response };
    } catch (err) {
      return { err, timedOut };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const startedAt = performance.now();
  inFlight += 1;

  try {
    let { response, err, timedOut } = await attempt();
    let retried = false;

    // Only a fully unreachable fetch is worth a retry — a timeout or an HTTP
    // error status both mean the server WAS reached, so retrying tells us
    // nothing new there.
    if (err instanceof TypeError && !timedOut) {
      unilog(
        1763,
        `unreachable ${method} ${endpoint}, retrying in ${UNREACHABLE_RETRY_DELAY_MS}ms: ${err.message}`,
      );
      await new Promise((r) => setTimeout(r, UNREACHABLE_RETRY_DELAY_MS));
      retried = true;
      ({ response, err, timedOut } = await attempt());
    }

    const ms = Math.round(performance.now() - startedAt);

    if (err) {
      if (timedOut) {
        unilog(
          1427,
          `timeout ${method} ${endpoint} after ${ms}ms of ${TIMEOUT_MS}ms inFlight=${inFlight}${loopLagSuffix()}`,
        );
        throw new Error("Request timeout");
      }
      // Add more context to network errors. A dead fetch is a TypeError in
      // every browser, but the message differs ("Failed to fetch" in Chrome,
      // "NetworkError when attempting to fetch resource." in Firefox), so
      // match on the type — matching the Chrome text alone made this log dead
      // in Firefox.
      if (err instanceof TypeError) {
        unilog(
          1764,
          `unreachable ${method} ${endpoint}${retried ? " (after retry)" : ""} after ${ms}ms inFlight=${inFlight}${loopLagSuffix()}: ${err.message}`,
        );
        throw new Error(`Network error: Unable to reach server at ${url}`);
      }
      throw err;
    }

    if (ms >= SLOW_REQUEST_MS) {
      unilog(
        1426,
        `slow ${method} ${endpoint} took ${ms}ms status=${response.status} inFlight=${inFlight}${loopLagSuffix()}`,
      );
    }

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw error;
    }
    return response.json();
  } finally {
    inFlight -= 1;
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

  if (parts.ch) {
    handleChannelFrame(parts);
    return;
  }

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
  unilog(
    876,
    `deleteShowFromSrvr: deletePath result for ${show.name}:`,
    result,
  );

  if (result !== "ok") {
    throw new Error(`Failed to delete folder: ${result}`);
  }

  // don't ever delete from remotes
  // don't ever delete from tvdb
  unilog(877, "deleted show from server:", show.name);
}

export const lastViewedCache = {};

const applyLastViewedCache = (lastViewed) => {
  if (!lastViewed || typeof lastViewed !== "object") return;
  Object.assign(lastViewedCache, lastViewed);
};

const lastViewedChannel = openChannel("lastViewed", {
  onSnapshot: applyLastViewedCache,
  onDelta: applyLastViewedCache,
});

// Everything this module starts at module scope, torn down as one unit. The
// call at the top of this file runs the PREVIOUS instance's copy of this before
// the new instance installs its own, so a hot-swap can never leave two live
// lag monitors, lastViewed pollers, or websockets behind.
//
// Idempotent: whichever fires first (the successor's teardown call, or vite's
// dispose on the rare path where it does run) wins, and the second is a no-op.
// Dev-only — vite strips import.meta.hot from production builds.
if (import.meta.hot) {
  let torndown = false;
  const cleanup = () => {
    if (torndown) return;
    torndown = true;
    clearInterval(lagTimer);
    eventTimingObserver?.disconnect();
    clearTimeout(wsStartTimer);
    lastViewedChannel.close();
    for (const handle of [...channelSubscribers.values()]) {
      handle.subscribers.clear();
    }
    channelSubscribers.clear();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    wsWanted = false;
    ws?.close();
    globalThis.__tvSrvrLive -= 1;
  };
  globalThis.__tvSrvrCleanup = cleanup;
  import.meta.hot.dispose(cleanup);

  // Safety net. The teardown above should hold this at 1; anything above that
  // means a side effect escaped cleanup and the app is silently doing N times
  // the work. Watchdog emails on this site.
  globalThis.__tvSrvrLive = (globalThis.__tvSrvrLive || 0) + 1;
  if (globalThis.__tvSrvrLive > 1) {
    unilog(
      1455,
      `stacked srvr.js instances: ${globalThis.__tvSrvrLive} — a side effect escaped teardown`,
    );
  }
}

export function getShowsFromDisk() {
  return httpCall("/api/getShowsFromDisk");
}
export function getUnilogEvents(params) {
  return httpCall("/api/unilog/events", params, "GET", 15000);
}
export function getUnilogOldestTs() {
  return httpCall("/api/unilog/oldest-ts", {}, "GET");
}
export function getUnilogWarnRate() {
  return httpCall("/api/unilog/warn-rate", {}, "GET");
}
export function getUnilogPlotDays(plot) {
  return httpCall("/api/unilog/plot-days", { plot }, "GET");
}
export function getUnilogDownsPerDay() {
  return httpCall("/api/unilog/downs-per-day", {}, "GET");
}
export function getUsbFileDays() {
  return httpCall("/api/usb/file-days", {}, "GET", 60000);
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
export function replaceUnilogGroups(groupIds, logIds) {
  return httpCall("/api/unilog/groups/replace", { groupIds, logIds }, "POST");
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

export function getLocalHistory(params) {
  return httpCall("/api/local/history", params, "POST", 60000);
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

export function tvRemoteKey(params) {
  return httpCall("/api/tvRemoteKey", params, "POST");
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

export async function getSeriesMapFromEmby(params) {
  const t0 = performance.now();
  const res = await httpCall("/api/getSeriesMapFromEmby", params, "POST");
  const ms = Math.round(performance.now() - t0);
  if (ms > 3000)
    unilog(
      1533,
      `slow getSeriesMapFromEmby round-trip ${params?.showName}: ${ms}ms`,
    );
  return res;
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

export function chksrtUnsnooze(videoPath) {
  return httpCall("/api/asr/chksrt/unsnooze", { videoPath }, "POST");
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

export function chksrtSelectShow(showName) {
  return httpCall("/api/asr/chksrt/select-show", { showName }, "POST");
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

export function hideShow(name) {
  return httpCall("/api/hideShow", { name }, "POST");
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
  unilog(879, "getActorCredits called with:", params);
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
