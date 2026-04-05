import { WebSocket } from "ws";
import { exec } from "child_process";
import express from "express";
import cors from "cors";

const HA_HOST = "hahnca.com:8123";
const HA_ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIzM2Y2MmI0MWZjYTY0YTE1YWU2MjFlZDg2NGJmM2NmYyIsImlhdCI6MTc3MDc5NjQ0NywiZXhwIjoyMDg2MTU2NDQ3fQ.AoUSLrAjOWEhR2pQVeuuykKYPoXqyrnmecQMQkdrgp8";
const TV_PORT = 3004;
const TV_ENTITY_ID = "media_player.living_room_tv";
const CAST_ENTITY_ID = "media_player.living_room_tv_2";
const REMOTE_ENTITY_ID = "remote.living_room_tv";
const IR_REMOTE_ID = "remote.tv_ir";
const IR_DEVICE = "bdv_n7100w";
const ROKU_REMOTE_ID = "remote.roku_2";
const BRAVIA_HOST = "192.168.1.12";
const BRAVIA_PORT = 2870;
const EMBY_HOST = "hahnca.com:8920";
const EMBY_API_KEY = "1c399bd079d549cba8c916244d3add2b";

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

// ─── Emby WebSocket ─────────────────────────────────────────────────────────

function handleEmbySession(s) {
  let device = null;
  if (s.DeviceName === "Living Room TV") device = "google";
  else if (s.DeviceName === "Roku 2") device = "roku";
  if (!device) return;
  const playing = s.NowPlayingItem?.Name ?? null;
  const remoteCtrl = s.SupportsRemoteControl ?? false;
  const paused = s.PlayState?.IsPaused ?? null;
  const prev = prevSessions[device];
  if (prev) {
    const changed =
      (prev.playing === null && playing !== null) ||
      (!prev.remoteCtrl && remoteCtrl) ||
      prev.paused !== paused;
    if (changed) {
      activeDevice = device;
      log(`activeDevice: ${device}`);
    }
  }
  prevSessions[device] = { playing, remoteCtrl, paused };
}

function connectEmby() {
  const deviceId = "tv-server";
  const url = `wss://${EMBY_HOST}/embywebsocket?api_key=${EMBY_API_KEY}&deviceId=${deviceId}`;
  log("connecting to Emby WebSocket...");
  const embyWs = new WebSocket(url, { rejectUnauthorized: false });

  embyWs.on("open", () => {
    log("emby ws opened");
    embyWs.send(
      JSON.stringify({ MessageType: "SessionsStart", Data: "0,1500" }),
    );
  });

  embyWs.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (_) {
      return;
    }
    if (msg.MessageType === "Sessions" && Array.isArray(msg.Data)) {
      for (const s of msg.Data) handleEmbySession(s);
    }
  });

  embyWs.on("error", (err) => loge("emby ws error:", err.message));
  embyWs.on("close", () => {
    log("emby ws closed, reconnecting in 5s");
    setTimeout(connectEmby, 5000);
  });
}

// ─── HA WebSocket ────────────────────────────────────────────────────────────

let ws = null;
let cmdId = 0;
let authenticated = false;
let castState = "unknown";
let tvPowerState = "unknown";
let tvMode = "google"; // "google" | "roku"
let activeDevice = null; // "google" | "roku"
const prevSessions = {};

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
      const tv = msg.result.find((s) => s.entity_id === TV_ENTITY_ID);
      if (tv) tvPowerState = tv.state;
    }
  } else if (msg.type === "event") {
    const event = msg.event;
    if (event?.event_type === "state_changed") {
      const id = event.data?.new_state?.entity_id;
      const state = event.data?.new_state?.state;
      if (id === CAST_ENTITY_ID) castState = state;
      if (id === TV_ENTITY_ID) tvPowerState = state;
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

app.get("/tv/mode/:mode", (req, res) => {
  const mode = req.params.mode;
  if (mode !== "google" && mode !== "roku") {
    res.status(400).json({ ok: false, error: "unknown mode" });
    return;
  }
  tvMode = mode;
  log(`mode set to ${mode}`);
  if (mode === "roku") {
    callService("media_player", "turn_on", "media_player.roku_2");
    callService("media_player", "turn_on", TV_ENTITY_ID);
    setTimeout(
      () =>
        callService("remote", "send_command", ROKU_REMOTE_ID, {
          command: "Home",
        }),
      2000,
    );
    setTimeout(
      () =>
        callService("media_player", "select_source", "media_player.roku_2", {
          source: "Emby",
        }),
      5000,
    );
  } else {
    callService("media_player", "turn_on", TV_ENTITY_ID);
    setTimeout(
      () =>
        callService("remote", "send_command", REMOTE_ENTITY_ID, {
          command: "KEYCODE_HOME",
        }),
      2000,
    );
    setTimeout(
      () =>
        callService("remote", "turn_on", REMOTE_ENTITY_ID, {
          activity: "tv.emby.embyatv",
        }),
      5000,
    );
  }
  res.json({ ok: true, mode });
});

app.get("/tv/emby", (req, res) => {
  callService("remote", "turn_on", REMOTE_ENTITY_ID, {
    activity: "tv.emby.embyatv",
  });
  res.json({ ok: true });
});

app.get("/tv/off", (req, res) => {
  if (tvMode === "roku") {
    callService("media_player", "turn_off", "media_player.roku_2");
    callService("media_player", "turn_off", TV_ENTITY_ID);
  } else {
    callService("remote", "turn_off", REMOTE_ENTITY_ID);
  }
  res.json({ ok: true });
});

app.get("/tv/key/:key", (req, res) => {
  const GOOGLE_KEY_MAP = {
    ok: "KEYCODE_DPAD_CENTER",
    up: "KEYCODE_DPAD_UP",
    down: "KEYCODE_DPAD_DOWN",
    left: "KEYCODE_DPAD_LEFT",
    right: "KEYCODE_DPAD_RIGHT",
    home: "KEYCODE_HOME",
    back: "KEYCODE_BACK",
  };
  const ROKU_KEY_MAP = {
    ok: "Select",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    home: "Home",
    back: "Back",
  };
  const keyMap = tvMode === "roku" ? ROKU_KEY_MAP : GOOGLE_KEY_MAP;
  const remoteId = tvMode === "roku" ? ROKU_REMOTE_ID : REMOTE_ENTITY_ID;
  const command = keyMap[req.params.key];
  if (!command) {
    res.status(400).json({ ok: false, error: "unknown key" });
    return;
  }
  const cmd = {
    type: "call_service",
    domain: "remote",
    service: "send_command",
    target: { entity_id: remoteId },
    service_data: { command },
  };
  sendCmd(cmd);
  log(`[${tvMode}] remote.send_command ${command}`);
  res.json({ ok: true, command, mode: tvMode });
});

// ─── Bravia UPnP ─────────────────────────────────────────────────────────────

function braviaPing() {
  return new Promise((resolve) => {
    exec(`ping -c1 -W1 ${BRAVIA_HOST}`, (err) => resolve(!err));
  });
}

function braviaFetch(action, body) {
  return fetch(
    `http://${BRAVIA_HOST}:${BRAVIA_PORT}/control/RenderingControl`,
    {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"urn:schemas-upnp-org:service:RenderingControl:1#${action}"`,
      },
      body,
      signal: AbortSignal.timeout(1000),
    },
  );
}

async function braviaSetVolume(volume) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${volume}</DesiredVolume></u:SetVolume></s:Body></s:Envelope>`;
  const res = await braviaFetch("SetVolume", body);
  return res.ok;
}

async function braviaGetVolume() {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetVolume></s:Body></s:Envelope>`;
  const res = await braviaFetch("GetVolume", body);
  const text = await res.text();
  const m = text.match(/<CurrentVolume>(\d+)<\/CurrentVolume>/);
  return m ? parseInt(m[1]) : null;
}

async function braviaSetMute(muted) {
  const val = muted ? "1" : "0";
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:SetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${val}</DesiredMute></u:SetMute></s:Body></s:Envelope>`;
  const res = await braviaFetch("SetMute", body);
  return res.ok;
}

async function braviaGetMute() {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetMute></s:Body></s:Envelope>`;
  const res = await braviaFetch("GetMute", body);
  const text = await res.text();
  const m = text.match(/<CurrentMute>(\d+)<\/CurrentMute>/);
  return m ? m[1] === "1" : null;
}

app.get("/tv/vol/:dir", async (req, res) => {
  const dir = req.params.dir;
  if (dir !== "up" && dir !== "down") {
    res.status(400).json({ ok: false, error: "unknown dir" });
    return;
  }
  const command = dir === "up" ? "vol_up" : "vol_down";
  callService("remote", "send_command", IR_REMOTE_ID, {
    device: IR_DEVICE,
    command,
  });
  log(`vol ${dir}: IR sent`);
  res.json({ ok: true });
});

app.get("/tv/mute", (req, res) => {
  callService("remote", "send_command", IR_REMOTE_ID, {
    device: IR_DEVICE,
    command: "mute",
  });
  log("mute IR sent");
  res.json({ ok: true });
});

app.get("/tv/mutestate", async (req, res) => {
  const [muted, pingOk] = await Promise.all([
    braviaGetMute().catch(() => null),
    braviaPing(),
  ]);
  const haOn =
    tvPowerState !== "off" &&
    tvPowerState !== "unavailable" &&
    tvPowerState !== "unknown";
  res.json({
    ok: true,
    muted,
    power: muted !== null || pingOk || haOn ? "on" : "off",
    activeDevice,
  });
});

app.get("/tv/status", (req, res) => {
  res.json({
    entity: CAST_ENTITY_ID,
    state: castState,
    mode: tvMode,
    tvPower: tvPowerState,
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

connectHa();
connectEmby();

app.listen(TV_PORT, () => {
  log(`listening on port ${TV_PORT}`);
});
