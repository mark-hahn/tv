// Global message store (see global-msg-instr.md).
//
// A reactive Map of message objects keyed by id, rendered as a single row
// (hdrMsg) at the top of list.vue. Messages can be added/removed from anywhere
// in the client via setGlobalMessage(), or pushed from the server which arrives
// as a "setGlobalMessage" notification on the event bus.
import { reactive } from "vue";
import { openChannel } from "./srvr.js";

// id -> { id, text, position, duration, timeAdded }
export const globalMessages = reactive(new Map());

// id -> setTimeout handle (non-reactive bookkeeping)
const expireTimers = new Map();
const serverMessageIds = new Set();

const clearExpireTimer = (id) => {
  const t = expireTimers.get(id);
  if (t) {
    clearTimeout(t);
    expireTimers.delete(id);
  }
};

// Add or remove a global message. Same signature on client and server:
//   { id, action: "show"|"hide", text, position, duration }
export function setGlobalMessage(msg) {
  if (!msg || !msg.id) return;
  const id = String(msg.id);
  const action = msg.action || "show";

  if (action === "hide") {
    clearExpireTimer(id);
    globalMessages.delete(id);
    return;
  }

  const position = Math.min(
    Number.isFinite(msg.position) ? msg.position : 1e9,
    1e9,
  );
  const duration = Number.isFinite(msg.duration) ? msg.duration : 0;

  // Keep the original timeAdded when replacing an existing id so ties keep a
  // stable left-to-right order (oldest leftmost).
  const existing = globalMessages.get(id);
  const timeAdded = existing ? existing.timeAdded : Date.now();

  globalMessages.set(id, {
    id,
    text: String(msg.text ?? ""),
    position,
    duration,
    timeAdded,
  });

  clearExpireTimer(id);
  if (duration > 0) {
    expireTimers.set(
      id,
      setTimeout(() => {
        expireTimers.delete(id);
        globalMessages.delete(id);
      }, duration * 1000),
    );
  }
}

function applyServerMessage(msg) {
  if (msg?.id) serverMessageIds.add(String(msg.id));
  setGlobalMessage(msg);
}

function applyServerMessagesSnapshot(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const nextIds = new Set(
    messages.map((msg) => String(msg?.id || "")).filter(Boolean),
  );
  for (const id of serverMessageIds) {
    if (!nextIds.has(id)) setGlobalMessage({ id, action: "hide" });
  }
  serverMessageIds.clear();
  for (const msg of messages) applyServerMessage(msg);
}

// Concatenated "<id>: <text>" for the hdrMsg row, sorted by position then
// timeAdded (lower position = further left; ties: oldest leftmost).
export function globalMessageText() {
  return [...globalMessages.values()]
    .sort((a, b) => a.position - b.position || a.timeAdded - b.timeAdded)
    .map((m) => m.text)
    .join("   ");
}

// Deferred so this runs after the whole module graph has initialized. srvr.js
// imports log.js, log.js imports this module, and this module imports srvr.js —
// calling openChannel at top level lands in that cycle and hits a temporal dead
// zone ("can't access 'openChannel' before initialization"). A microtask runs
// after top-level module evaluation completes, when the export is ready.
queueMicrotask(() => {
  openChannel("globalMessages", {
    onSnapshot: applyServerMessagesSnapshot,
    onDelta: applyServerMessage,
  });
});
