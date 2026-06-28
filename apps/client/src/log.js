// unilog client routine. Active client log sites call `unilog(logId, message)`.
// Events are batched and POSTed fire-and-forget to tv-srvr's /api/log; on unload
// the queue is flushed with sendBeacon so tail events are not lost. It still
// calls console.* so the browser console and vite-console.log mirror are intact.
// (This plumbing uses plain console with `// no-unilog`.)

import { config } from "./config.js";

const LOG_URL = `${config.tvSrvrUrl}/api/log`;
const FLUSH_MS = 2000;
const MAX_BATCH = 50;
const PID = "client";

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
  const batch = queue;
  queue = [];
  fetch(LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    keepalive: true,
  }).catch(() => {
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
    queue.push({ logId, pid: PID, message: unilogJoin(parts) });
    if (queue.length >= MAX_BATCH) flush();
    else scheduleFlush();
  } catch {
    // ignore
  }
}

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
