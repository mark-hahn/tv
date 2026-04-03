import { createRequire } from "module";
import { WebSocket } from "ws";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const require = createRequire(import.meta.url);
const { Client: CastClient } = require("castv2");

const HA_HOST = "hahnca.com:8123";
const HA_ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIzM2Y2MmI0MWZjYTY0YTE1YWU2MjFlZDg2NGJmM2NmYyIsImlhdCI6MTc3MDc5NjQ0NywiZXhwIjoyMDg2MTU2NDQ3fQ.AoUSLrAjOWEhR2pQVeuuykKYPoXqyrnmecQMQkdrgp8";
const TV_PORT = 3004;
const CHROMECAST_IP = "192.168.1.42";
const CHROMECAST_PORT = 8009;
const DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845";

// PST LA timestamp  MM-DD HH:mm
function ts() {
  return new Date()
    .toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
}

function log(...args) {
  console.log(`[TV ${ts()}]`, ...args);
}
function loge(...args) {
  console.error(`[TV ${ts()}] ERROR`, ...args);
}

// ─── Direct Chromecast connection (castv2) ───────────────────────────────────

let castClient = null;
let castRcvChannel = null;
let castReqId = 1;
let castReady = false;

function connectCast() {
  log(`castv2: connecting to ${CHROMECAST_IP}:${CHROMECAST_PORT}...`);
  castReady = false;
  castRcvChannel = null;

  const client = new CastClient();
  castClient = client;

  client.connect({ host: CHROMECAST_IP, port: CHROMECAST_PORT }, () => {
    const connCh = client.createChannel(
      "sender-0",
      "receiver-0",
      "urn:x-cast:com.google.cast.tp.connection",
      "JSON",
    );
    const hbCh = client.createChannel(
      "sender-0",
      "receiver-0",
      "urn:x-cast:com.google.cast.tp.heartbeat",
      "JSON",
    );
    castRcvChannel = client.createChannel(
      "sender-0",
      "receiver-0",
      "urn:x-cast:com.google.cast.receiver",
      "JSON",
    );

    connCh.send({ type: "CONNECT" });
    const hbTimer = setInterval(() => {
      if (castReady) hbCh.send({ type: "PING" });
    }, 5000);

    castReady = true;
    log("castv2: connected and ready");

    client.on("error", (err) => {
      clearInterval(hbTimer);
      castReady = false;
      log("castv2: error:", err.message, "— reconnecting in 5s");
      setTimeout(connectCast, 5000);
    });
  });

  client.on("error", (err) => {
    if (!castReady) {
      log("castv2: connect error:", err.message, "— reconnecting in 10s");
      setTimeout(connectCast, 10000);
    }
  });
}

function castTurnOn() {
  if (!castReady || !castRcvChannel) {
    loge("castv2: not ready, falling back to HA");
    if (castEntityId) callService("media_player", "turn_on", castEntityId);
    return;
  }
  const reqId = castReqId++;
  log(`castv2: LAUNCH ${DEFAULT_MEDIA_RECEIVER_APP_ID} reqId=${reqId}`);
  castRcvChannel.send({
    type: "LAUNCH",
    appId: DEFAULT_MEDIA_RECEIVER_APP_ID,
    requestId: reqId,
  });
}

// ─── HA WebSocket ────────────────────────────────────────────────────────────

let ws = null;
let cmdId = 0;
let authenticated = false;
let castEntityId = null; // discovered at startup
let castState = "unknown";

function sendCmd(cmd) {
  setTimeout(() => {
    if (!cmd.noId) cmd.id = ++cmdId;
    delete cmd.noId;
    if (ws) ws.send(JSON.stringify(cmd));
    else loge("sendCmd with no ws");
  }, 100);
}

function callService(domain, service, entityId, serviceData = {}) {
  const cmd = {
    type: "call_service",
    domain,
    service,
    target: { entity_id: entityId },
  };
  if (Object.keys(serviceData).length > 0) cmd.service_data = serviceData;
  sendCmd(cmd);
  log(`callService ${domain}.${service} -> ${entityId}`);
}

function handleStateChange(newState) {
  if (newState.entity_id === castEntityId) {
    castState = newState.state;
  }
}

function handleMsg(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    loge("JSON parse error:", raw);
    return;
  }

  if (msg.type === "auth_required") {
    log("ws: auth_required");
    sendCmd({ noId: true, type: "auth", access_token: HA_ACCESS_TOKEN });
  } else if (msg.type === "auth_ok") {
    log("ws: auth_ok");
    authenticated = true;
    sendCmd({ type: "get_states" });
    sendCmd({ type: "subscribe_events", event_type: "state_changed" });
  } else if (msg.type === "auth_invalid") {
    loge("ws: auth_invalid");
    process.exit(1);
  } else if (msg.type === "result") {
    if (!msg.success) {
      loge("command failed id:", msg.id, msg.error);
      return;
    }
    if (Array.isArray(msg.result)) {
      // initial get_states response — discover chromecast entity
      if (!castEntityId) discoverCast(msg.result);
      for (const s of msg.result) handleStateChange(s);
    }
  } else if (msg.type === "event") {
    const event = msg.event;
    if (event?.event_type === "state_changed" && event.data?.new_state) {
      handleStateChange(event.data.new_state);
    }
  }
}

function discoverCast(states) {
  const EXCLUDED_CLASSES = new Set(["speaker", "receiver"]);
  const candidates = states.filter((s) => {
    if (!s.entity_id.startsWith("media_player.")) return false;
    const attrs = s.attributes || {};
    if (attrs.assumed_state === true) return false;
    const cls = attrs.device_class;
    if (cls && EXCLUDED_CLASSES.has(cls)) return false;
    return true;
  });

  if (candidates.length === 0) {
    loge("FATAL: no Chromecast/TV media_player found in HA states");
    process.exit(1);
  }

  castEntityId = candidates[0].entity_id;
  castState = candidates[0].state;
  log(`discovered cast entity: ${castEntityId} (state: ${castState})`);

  if (candidates.length > 1) {
    log(
      "multiple candidates, using first:",
      candidates.map((c) => c.entity_id).join(", "),
    );
  }
}

function connectHa() {
  log("connecting to HA WebSocket...");
  ws = new WebSocket(`wss://${HA_HOST}/api/websocket`, {
    rejectUnauthorized: false,
  });

  ws.on("open", () => {
    log("ws opened");
  });
  ws.on("message", (data) => handleMsg(data.toString()));
  ws.on("error", (err) => loge("ws error:", err.message));
  ws.on("close", () => {
    log("ws closed, reconnecting in 5s");
    authenticated = false;
    ws = null;
    setTimeout(connectHa, 5000);
  });
}

// ─── Express ─────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());

app.get("/tv/on", (req, res) => {
  castTurnOn();
  res.json({ ok: true, method: castReady ? "castv2" : "ha" });
});

app.get("/tv/off", (req, res) => {
  if (!castEntityId) {
    res
      .status(503)
      .json({ ok: false, error: "cast entity not yet discovered" });
    return;
  }
  callService("media_player", "turn_off", castEntityId);
  res.json({ ok: true, entity: castEntityId });
});

app.get("/tv/status", (req, res) => {
  res.json({ entity: castEntityId, state: castState });
});

// ─── Start ───────────────────────────────────────────────────────────────────

connectHa();
connectCast();

app.listen(TV_PORT, () => {
  log(`listening on port ${TV_PORT}`);
});
