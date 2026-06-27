// Global message store (see global-msg-instr.md).
//
// A reactive Map of message objects keyed by id, rendered as a single row
// (hdrMsg) at the top of list.vue. Messages can be added/removed from anywhere
// in the client via setGlobalMessage(), or pushed from the server which arrives
// as a "setGlobalMessage" notification on the event bus.
import { reactive } from "vue";
import evtBus from "./evtBus.js";

// id -> { id, text, position, duration, timeAdded }
export const globalMessages = reactive(new Map());

// id -> setTimeout handle (non-reactive bookkeeping)
const expireTimers = new Map();

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

// Concatenated "<id>: <text>" for the hdrMsg row, sorted by position then
// timeAdded (lower position = further left; ties: oldest leftmost).
export function globalMessageText() {
  return [...globalMessages.values()]
    .sort((a, b) => a.position - b.position || a.timeAdded - b.timeAdded)
    .map((m) => `${m.id}: ${m.text}`)
    .join(", ");
}

// Server pushes arrive here via notifyClients("setGlobalMessage", msgObj).
evtBus.on("setGlobalMessage", setGlobalMessage);
