// The client messaging hub: the app WebSocket server, the connected-client
// set, the broadcast primitives (notifyClients / setGlobalMessage), and the
// active-server-message registry that is replayed to new connections. The
// per-connection message handler stays in index.js (it is coupled to many
// server features); this module owns only the socket infra and broadcast fan-out.

import { WebSocket, WebSocketServer } from "ws";
import { unilog } from "@tv/share";

export const wss = new WebSocketServer({ port: 8736 });
unilog(60, "wss listening on port 8736");

export const connectedClients = new Set();

const localChannelSources = new Map();
const channelClients = new Map();
const channelPeers = new Map();
const peerChannels = new Map();
const pendingSnapshotRequests = new Map();
const channelMeta = new Map();
let nextSnapshotRequestId = 0;

const touchChannelMeta = (name, field) => {
  if (!name) return;
  const meta = channelMeta.get(name) || {};
  meta[field] = Date.now();
  channelMeta.set(name, meta);
  if (name !== "channelsDebug") queueChannelsDebugUpdate();
};

const getChannelDebugSnapshot = () => {
  const names = new Set([
    ...localChannelSources.keys(),
    ...channelPeers.keys(),
    ...channelClients.keys(),
  ]);
  return [...names].sort().map((name) => {
    const local = localChannelSources.has(name);
    const peer = channelPeers.get(name);
    const meta = channelMeta.get(name) || {};
    return {
      name,
      owner: local ? "local" : peer ? "peer" : "none",
      peerOpen: peer ? peer.readyState === WebSocket.OPEN : null,
      subscribers: channelClients.get(name)?.size || 0,
      lastSnapshotAt: meta.lastSnapshotAt || null,
      lastDeltaAt: meta.lastDeltaAt || null,
      lastSubAt: meta.lastSubAt || null,
    };
  });
};

let channelsDebugUpdateTimer = null;
function queueChannelsDebugUpdate() {
  if (channelsDebugUpdateTimer) return;
  channelsDebugUpdateTimer = setTimeout(() => {
    channelsDebugUpdateTimer = null;
    const msg = {
      ch: "channelsDebug",
      op: "delta",
      data: getChannelDebugSnapshot(),
    };
    for (const ws of channelClients.get("channelsDebug") || []) sendJson(ws, msg);
  }, 0);
}

const sendJson = (ws, obj) => {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch (e) {
    unilog(1477, `channel send failed: ${e.message}`);
    return false;
  }
};

export const registerLocalChannel = (name, source) => {
  if (!name || !source?.snapshot) throw new Error("invalid local channel");
  if (localChannelSources.has(name))
    throw new Error(`duplicate channel ${name}`);
  localChannelSources.set(name, source);
};

export const publishChannelSnapshot = (name, data, targetWs = null) => {
  touchChannelMeta(name, "lastSnapshotAt");
  const msg = { ch: name, op: "snapshot", data };
  if (targetWs) {
    sendJson(targetWs, msg);
    return;
  }
  for (const ws of channelClients.get(name) || []) sendJson(ws, msg);
};

export const publishChannelDelta = (name, data) => {
  touchChannelMeta(name, "lastDeltaAt");
  const msg = { ch: name, op: "delta", data };
  for (const ws of channelClients.get(name) || []) sendJson(ws, msg);
};

const sendPeerControl = (name, op, extra = {}) => {
  const peer = channelPeers.get(name);
  if (!peer) return false;
  return sendJson(peer, { ch: name, op, ...extra });
};

const notifyChannelUnavailable = (name) => {
  const msg = { ch: name, op: "unavailable" };
  for (const ws of channelClients.get(name) || []) sendJson(ws, msg);
};

const registerPeerChannels = (ws, channels) => {
  if (!Array.isArray(channels)) return true;
  connectedClients.delete(ws);
  const owned = peerChannels.get(ws) || new Set();
  peerChannels.set(ws, owned);

  for (const name of channels) {
    if (!name || localChannelSources.has(name)) continue;
    const current = channelPeers.get(name);
    if (current && current !== ws && current.readyState === WebSocket.OPEN) {
      unilog(1478, `duplicate channel owner rejected: ${name}`);
      continue;
    }
    channelPeers.set(name, ws);
    owned.add(name);
    queueChannelsDebugUpdate();
    if ((channelClients.get(name)?.size || 0) > 0) {
      sendPeerControl(name, "sub");
    }
  }
  return true;
};

const handlePeerChannelFrame = (ws, frame) => {
  const peer = channelPeers.get(frame.ch);
  if (peer !== ws) return true;

  if (frame.op === "snapshot" && frame.requestId !== undefined) {
    const target = pendingSnapshotRequests.get(frame.requestId);
    pendingSnapshotRequests.delete(frame.requestId);
    if (target) publishChannelSnapshot(frame.ch, frame.data, target);
    return true;
  }

  if (frame.op === "snapshot") {
    publishChannelSnapshot(frame.ch, frame.data);
    return true;
  }

  if (frame.op === "delta") {
    publishChannelDelta(frame.ch, frame.data);
    return true;
  }

  return true;
};

export const unsubscribeChannel = (ws, name) => {
  const clients = channelClients.get(name);
  if (!clients?.delete(ws)) return;
  if (clients.size === 0) {
    channelClients.delete(name);
    const localSource = localChannelSources.get(name);
    if (localSource) localSource.onLastUnsubscriber?.();
    else sendPeerControl(name, "unsub");
  }
};

export const unsubscribeAllChannels = (ws) => {
  for (const name of [...channelClients.keys()]) unsubscribeChannel(ws, name);

  const owned = peerChannels.get(ws);
  if (!owned) return;
  peerChannels.delete(ws);
  for (const name of owned) {
    if (channelPeers.get(name) !== ws) continue;
    channelPeers.delete(name);
    queueChannelsDebugUpdate();
    notifyChannelUnavailable(name);
  }
};

export const handleChannelFrame = (ws, frame) => {
  if (frame?.op === "register") return registerPeerChannels(ws, frame.channels);

  const name = frame?.ch;
  const op = frame?.op;
  if (!name || !op) return false;

  if (peerChannels.has(ws)) return handlePeerChannelFrame(ws, frame);

  const source = localChannelSources.get(name);
  if (op === "sub") {
    let clients = channelClients.get(name);
    if (!clients) {
      clients = new Set();
      channelClients.set(name, clients);
    }
    const wasEmpty = clients.size === 0;
    clients.add(ws);
    touchChannelMeta(name, "lastSubAt");
    if (source) {
      if (wasEmpty) source.onFirstSubscriber?.();
      publishChannelSnapshot(name, source.snapshot(), ws);
      return true;
    }

    const peer = channelPeers.get(name);
    if (peer) {
      if (wasEmpty) sendPeerControl(name, "sub");
      else {
        const requestId = ++nextSnapshotRequestId;
        pendingSnapshotRequests.set(requestId, ws);
        sendPeerControl(name, "snapshot-request", { requestId });
      }
    } else {
      sendJson(ws, { ch: name, op: "unavailable" });
    }
    return true;
  }

  if (op === "unsub") {
    unsubscribeChannel(ws, name);
    return true;
  }

  return false;
};

registerLocalChannel("channelsDebug", {
  snapshot: () => getChannelDebugSnapshot(),
});

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

registerLocalChannel("globalMessages", {
  snapshot: () => ({ messages: [...activeServerMessages.values()] }),
});

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
  publishChannelDelta("globalMessages", msgObj);
};
