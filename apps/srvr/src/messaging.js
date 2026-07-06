// The client messaging hub: the app WebSocket server, the connected-client
// set, the broadcast primitives (notifyClients / setGlobalMessage), and the
// active-server-message registry that is replayed to new connections. The
// per-connection message handler stays in index.js (it is coupled to many
// server features); this module owns only the socket infra and broadcast fan-out.

import { WebSocketServer } from "ws";
import { unilog } from "@tv/share";

export const wss = new WebSocketServer({ port: 8736 });
unilog(60, "wss listening on port 8736");

export const connectedClients = new Set();

// Broadcast notification to all connected clients
export const notifyClients = (notification, data = null) => {
  if (connectedClients.size === 0) return;

  const msg = JSON.stringify({
    id: 0,
    notification,
    data,
  });

  for (const ws of connectedClients) {
    if (ws.readyState === 1) {
      try {
        ws.send(msg);
      } catch (e) {
        unilog(615, "send error:", e.message);
      }
    }
  }
};

// GLOBAL-MSG: server-side entry point (see global-msg-instr.md). Broadcasts a
// message object to all clients with the same signature as the client
// setGlobalMessage(): { id, action, text, position, duration }.
// Also maintains activeServerMessages so new connections can be caught up.
export const activeServerMessages = new Map(); // id -> msgObj

export const setGlobalMessage = (msgObj) => {
  if (msgObj && msgObj.id) {
    const id = String(msgObj.id);
    if (msgObj.action === "hide") {
      activeServerMessages.delete(id);
    } else {
      activeServerMessages.set(id, msgObj);
    }
  }
  notifyClients("setGlobalMessage", msgObj);
};
