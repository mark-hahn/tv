// unilog client routine. Active client log sites call `unilog(logId, message)`.
// Events are batched and POSTed fire-and-forget to tv-srvr's /api/log; on unload
// the queue is flushed with sendBeacon so tail events are not lost. It still
// calls console.* so the browser console and vite-console.log mirror are intact.
// (This plumbing uses plain console with `// no-unilog`.)

import { config } from "./config.js";
import { setGlobalMessage } from "./globalMessages.js";
import { ref } from "vue";

const LOG_URL = `${config.tvSrvrUrl}/api/log`;
const FLUSH_MS = 2000;
const MAX_BATCH = 50;
const PID = "client";

// Generate a unique GUID for this client instance to detect multiple clients.
function generateGuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const CLIENT_HASH = generateGuid();
export const loggingDisabled = ref(false);

let queue = [];
let timer = null;

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(flush, FLUSH_MS);
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  if (loggingDisabled.value) {
    queue = [];
    return;
  }
  const batch = queue;
  queue = [];
  fetch(LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    keepalive: true,
  })
    .then((response) => response.json())
    .then((data) => {
      if (data && data.loggingDisabled) {
        loggingDisabled.value = true;
        setGlobalMessage({
          id: "logging-disabled",
          text: "Logging disabled",
          position: 0,
          duration: 0,
        });
      }
    })
    .catch(() => {
      // best-effort: never break the app because logging failed
    });
}

// Join multiple args the way console.* does so multi-arg calls copy through.
function unilogJoin(parts) {
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      try {
        return typeof p === "object" ? JSON.stringify(p) : String(p);
      } catch {
        return String(p);
      }
    })
    .join(" ");
}

// The single call every active client log site invokes at runtime (variadic).
export function unilog(logId, ...parts) {
  try {
    if (loggingDisabled.value) return;
    queue.push({
      logId,
      pid: PID,
      message: unilogJoin(parts),
      clientHash: CLIENT_HASH,
    });
    if (queue.length >= MAX_BATCH) flush();
    else scheduleFlush();
  } catch {
    // ignore
  }
}

// Author placeholder — runtime NO-OP, rewritten to a real `unilog(<id>, ...)` by
// the deploy reconciler. Write
//   logHere({ lvl, tag, grp, typ }, ...msgArgs)
// where a log belongs; never hand-write `unilog(...)`. The first arg is a param
// object (all values must be static string literals):
//   lvl: "info" | "warn" | "error" | "debug"  (default "info")
//   tag: category string                        (default none)
//   grp: group name or array of names           (default none)
//   typ: group_type applied only to new groups  (default none)
// The remaining args are the message; with none the site logs "<missing>".
export function logHere() {}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (queue.length === 0) return;
    try {
      navigator.sendBeacon(
        LOG_URL,
        new Blob([JSON.stringify(queue)], { type: "application/json" }),
      );
      queue = [];
    } catch {
      // ignore
    }
  });
}
