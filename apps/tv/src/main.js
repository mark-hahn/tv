import { WebSocket } from "ws";
import express from "express";
import cors from "cors";

const HA_HOST = "hahnca.com:8123";
const HA_ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIzM2Y2MmI0MWZjYTY0YTE1YWU2MjFlZDg2NGJmM2NmYyIsImlhdCI6MTc3MDc5NjQ0NywiZXhwIjoyMDg2MTU2NDQ3fQ.AoUSLrAjOWEhR2pQVeuuykKYPoXqyrnmecQMQkdrgp8";
const TV_PORT = 3004;
const TV_ENTITY_ID = "media_player.living_room_tv";
const CAST_ENTITY_ID = "media_player.living_room_tv_2";
const REMOTE_ENTITY_ID = "remote.living_room_tv";

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

// ─── HA WebSocket ────────────────────────────────────────────────────────────

let ws = null;
let cmdId = 0;
let authenticated = false;
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
      const s = msg.result.find((s) => s.entity_id === CAST_ENTITY_ID);
      if (s) castState = s.state;
    }
  } else if (msg.type === "event") {
    const event = msg.event;
    if (
      event?.event_type === "state_changed" &&
      event.data?.new_state?.entity_id === CAST_ENTITY_ID
    ) {
      castState = event.data.new_state.state;
    }
  }
}

function connectHa() {
  log("connecting to HA WebSocket...");
  ws = new WebSocket(`wss://${HA_HOST}/api/websocket`, {
    rejectUnauthorized: false,
  });

  ws.on("open", () => log("ws opened"));
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
  callService("media_player", "turn_on", TV_ENTITY_ID);
  res.json({ ok: true });
});

app.get("/tv/off", (req, res) => {
  callService("remote", "turn_off", REMOTE_ENTITY_ID);
  res.json({ ok: true });
});

app.get("/tv/key/:key", (req, res) => {
  const KEY_MAP = {
    ok: "KEYCODE_DPAD_CENTER",
    up: "KEYCODE_DPAD_UP",
    down: "KEYCODE_DPAD_DOWN",
    left: "KEYCODE_DPAD_LEFT",
    right: "KEYCODE_DPAD_RIGHT",    home:  "KEYCODE_HOME",
    back:  "KEYCODE_BACK",  };
  const command = KEY_MAP[req.params.key];
  if (!command) {
    res.status(400).json({ ok: false, error: "unknown key" });
    return;
  }
  const cmd = {
    type: "call_service",
    domain: "remote",
    service: "send_command",
    target: { entity_id: REMOTE_ENTITY_ID },
    service_data: { command },
  };
  sendCmd(cmd);
  log(`remote.send_command ${command}`);
  res.json({ ok: true, command });
});

app.get("/tv/status", (req, res) => {
  res.json({ entity: CAST_ENTITY_ID, state: castState });
});

// ─── Start ───────────────────────────────────────────────────────────────────

connectHa();

app.listen(TV_PORT, () => {
  log(`listening on port ${TV_PORT}`);
});
