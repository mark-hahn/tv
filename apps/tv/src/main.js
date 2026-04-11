import { WebSocket } from "ws";
import { exec, spawn } from "child_process";
import { createInterface } from "readline";
import express from "express";
import cors from "cors";

const HA_HOST = "hahnca.com:8123";
const HA_ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIzM2Y2MmI0MWZjYTY0YTE1YWU2MjFlZDg2NGJmM2NmYyIsImlhdCI6MTc3MDc5NjQ0NywiZXhwIjoyMDg2MTU2NDQ3fQ.AoUSLrAjOWEhR2pQVeuuykKYPoXqyrnmecQMQkdrgp8";
const TV_PORT = 3004;
const TV_ENTITY_ID = "media_player.bravia_k_65xr70";
const CAST_ENTITY_ID = "media_player.living_room_tv_2";
const REMOTE_ENTITY_ID = "remote.bravia_k_65xr70";
// TV_ENTITY_ID and BRAVIA_ENTITY_ID are the same device; BRAVIA_ENTITY_ID used for vol/mute
const IR_REMOTE_ID = "remote.tv_ir";
const IR_DEVICE = "bdv_n7100w";
const ROKU_REMOTE_ID = "remote.roku_2";
const FIRE_TV_ENTITY_ID = "media_player.fire_tv_192_168_1_47";
const FIRE_TV_REMOTE_ID = "remote.fire_tv_192_168_1_47";
const FIRE_TV_IP = "192.168.1.47";
const BRAVIA_ENTITY_ID = "media_player.bravia_k_65xr70";
const BROADLINK_HOST = "192.168.1.23";
const BROADLINK_CODES = {
  vol_up:
    "JgBUAEcUEhYmFBMUEhUnFBIVEhUnFBMUExQSFRIAA2BOFBMUJhUSExUUJhQTFRIVJRUTFBQUExQTAANfTBUSFiYUEhUSFSYVExQTFCcUExQSFRMUEwADXw==",
  vol_down:
    "JgBUAEcUJhYmFBMUEhUnFBIVEhUnFBMUExQSFRIAA2BOFCYUJhUSExUUJhQTFRIVJRUTFBQUExQTAANfTBUmFiYUEhUSFSYVExQTFCcUExQSFRMUEwADXw==",
};

const IR_DAEMON_PATH = new URL("./ir-daemon.py", import.meta.url).pathname;
let irProc = null;
const irAckQueue = [];

function startIrDaemon() {
  irProc = spawn("python3", ["-u", IR_DAEMON_PATH]);
  const rl = createInterface({ input: irProc.stdout });
  rl.on("line", (line) => {
    if (line === "OK") {
      const resolve = irAckQueue.shift();
      if (resolve) resolve();
    } else {
      log("ir-daemon:", line);
    }
  });
  irProc.stderr.on("data", (d) => loge("ir-daemon err:", d.toString().trim()));
  irProc.on("exit", (code) => {
    loge("ir-daemon exited", code);
    irProc = null;
    // reject all pending acks
    for (const resolve of irAckQueue.splice(0)) resolve();
  });
}

function broadlinkSend(cmd) {
  if (!irProc) startIrDaemon();
  const code = BROADLINK_CODES[cmd];
  return new Promise((resolve) => {
    irAckQueue.push(resolve);
    irProc.stdin.write(code + "\n");
  });
}
const EMBY_HOST = "hahnca.com:8920";
const EMBY_API_KEY = "1c399bd079d549cba8c916244d3add2b";
const SRVR_INTERNAL_URL = "http://127.0.0.1:8739";

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

function client(req) {
  const ua = req.headers["user-agent"] ?? "";
  const ip = req.ip ?? "";
  if (ua.includes("okhttp")) return `phone(${ip})`;
  if (ua.includes("Mozilla")) return `web(${ip})`;
  return `?(${ip}) ua=${ua}`;
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

const DEVICE_PRIORITY = [
  {
    match: (s) => s.DeviceName === "Google" && s.Client === "AndroidTv",
    label: "Google TV",
    pri: 1,
  },
  {
    match: (s) => s.DeviceName === "Living Room TV",
    label: "Living Room TV",
    pri: 2,
  },
  {
    match: (s) => s.Client === "AndroidTv",
    label: (s) => s.DeviceName,
    pri: 3,
  },
  { match: (s) => s.DeviceName === "Roku 2", label: "Roku", pri: 4 },
];

function deviceLabel(s) {
  for (const rule of DEVICE_PRIORITY) {
    if (rule.match(s))
      return typeof rule.label === "function" ? rule.label(s) : rule.label;
  }
  return s.DeviceName;
}

function devicePriority(s) {
  for (const rule of DEVICE_PRIORITY) {
    if (rule.match(s)) return rule.pri;
  }
  return 99;
}

function updateNowPlaying(sessions) {
  const playing = sessions
    .filter((s) => s.NowPlayingItem?.SeriesName)
    .sort((a, b) => devicePriority(a) - devicePriority(b))
    .map((s) => ({
      showName: s.NowPlayingItem.SeriesName,
      device: deviceLabel(s),
    }));

  const key = JSON.stringify(playing);
  if (key === currentShowName) return;
  currentShowName = key;

  const showName = playing[0]?.showName ?? null;
  fetch(`${SRVR_INTERNAL_URL}/internal/nowPlaying`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ showName, playing }),
  }).catch(() => {});
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
      updateNowPlaying(msg.Data);
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
let fireTvState = "unknown";
let braviaHaMuted = null;
let braviaHaPower = "unknown";
let tvMode = "google"; // "google" | "fire" | "roku"
let activeDevice = null; // "google" | "roku"
let lastOffAt = 0;
let currentShowName = null;
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
      const bravia = msg.result.find((s) => s.entity_id === BRAVIA_ENTITY_ID);
      if (bravia) {
        braviaHaPower = bravia.state;
        braviaHaMuted = bravia.attributes?.is_volume_muted ?? null;
      }
    }
  } else if (msg.type === "event") {
    const event = msg.event;
    if (event?.event_type === "state_changed") {
      const id = event.data?.new_state?.entity_id;
      const state = event.data?.new_state?.state;
      const prev = event.data?.old_state?.state;
      const WATCHED = new Set([
        TV_ENTITY_ID,
        CAST_ENTITY_ID,
        REMOTE_ENTITY_ID,
        IR_REMOTE_ID,
        ROKU_REMOTE_ID,
        "media_player.roku_2",
        FIRE_TV_ENTITY_ID,
        FIRE_TV_REMOTE_ID,
        BRAVIA_ENTITY_ID,
      ]);
      if (WATCHED.has(id) && state !== prev) {
        log(`HA state: ${id} ${prev} -> ${state}`);
      }
      if (id === CAST_ENTITY_ID) castState = state;
      if (id === TV_ENTITY_ID && state !== tvPowerState) {
        tvPowerState = state;
      }
      if (id === FIRE_TV_ENTITY_ID) fireTvState = state;
      if (id === BRAVIA_ENTITY_ID) {
        braviaHaPower = state;
        const attrs = event.data?.new_state?.attributes;
        if (attrs) braviaHaMuted = attrs.is_volume_muted ?? null;
      }
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
  log(`on from ${client(req)}`);
  callService("media_player", "turn_on", TV_ENTITY_ID);
  res.json({ ok: true });
});

app.get("/tv/mode/:mode", (req, res) => {
  const mode = req.params.mode;
  if (mode !== "google" && mode !== "fire" && mode !== "roku") {
    res.status(400).json({ ok: false, error: "unknown mode" });
    return;
  }
  tvMode = mode;
  log(`mode set to ${mode} from ${client(req)}`);
  if (mode === "roku") {
    callService("remote", "send_command", ROKU_REMOTE_ID, { command: "Home" });
    setTimeout(
      () =>
        callService("media_player", "select_source", "media_player.roku_2", {
          source: "Emby",
        }),
      5000,
    );
  } else if (mode === "fire") {
    callService("media_player", "turn_on", FIRE_TV_ENTITY_ID);
    setTimeout(
      () =>
        exec(
          `adb -s ${FIRE_TV_IP}:5555 shell am start -n tv.emby.embyatv/.startup.StartupActivity`,
          (err) => {
            if (err) log(`[fire] adb emby launch error: ${err.message}`);
          },
        ),
      5000,
    );
  } else {
    // google
    callService("media_player", "turn_on", TV_ENTITY_ID);
    setTimeout(
      () =>
        callService("remote", "send_command", REMOTE_ENTITY_ID, {
          command: "KEYCODE_HOME",
        }),
      5000,
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
  fetch(`${SRVR_INTERNAL_URL}/internal/tv-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ muted: null, power: "on", activeDevice, mode }),
  }).catch(() => {});
});

app.get("/tv/emby", (req, res) => {
  if (tvMode === "roku") {
    callService("media_player", "select_source", "media_player.roku_2", {
      source: "Emby",
    });
  } else if (tvMode === "fire") {
    exec(
      `adb -s ${FIRE_TV_IP}:5555 shell am start -n tv.emby.embyatv/.startup.StartupActivity`,
      (err) => {
        if (err) log(`[fire] adb emby error: ${err.message}`);
      },
    );
  } else {
    callService("media_player", "play_media", TV_ENTITY_ID, {
      media_content_type: "app",
      media_content_id:
        "com.sony.dtv.tv.emby.embyatv.tv.emby.embyatv.startup.StartupActivity",
    });
  }
  res.json({ ok: true });
});

app.get("/tv/off", (req, res) => {
  log(`off from ${client(req)} (mode: ${tvMode})`);
  callService("media_player", "turn_off", "media_player.roku_2");
  callService("media_player", "turn_off", TV_ENTITY_ID);
  callService("remote", "turn_off", REMOTE_ENTITY_ID);
  lastOffAt = Date.now();
  res.json({ ok: true });
  fetch(`${SRVR_INTERNAL_URL}/internal/tv-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      muted: null,
      power: "off",
      activeDevice,
      mode: null,
    }),
  }).catch(() => {});
});

app.get("/tv/key/:key", (req, res) => {
  const GOOGLE_KEY_MAP = {
    ok: "Confirm",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    home: "Home",
    back: "Return",
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
  const FIRE_KEY_MAP = {
    ok: "23", // KEYCODE_DPAD_CENTER
    up: "19", // KEYCODE_DPAD_UP
    down: "20", // KEYCODE_DPAD_DOWN
    left: "21", // KEYCODE_DPAD_LEFT
    right: "22", // KEYCODE_DPAD_RIGHT
    home: "3", // KEYCODE_HOME
    back: "4", // KEYCODE_BACK
  };
  const keyMap =
    tvMode === "roku"
      ? ROKU_KEY_MAP
      : tvMode === "fire"
        ? FIRE_KEY_MAP
        : GOOGLE_KEY_MAP;
  const remoteId = tvMode === "roku" ? ROKU_REMOTE_ID : REMOTE_ENTITY_ID;
  const command = keyMap[req.params.key];
  if (!command) {
    res.status(400).json({ ok: false, error: "unknown key" });
    return;
  }

  if (tvMode === "fire") {
    const n = Math.min(parseInt(req.query.n) || 1, 5);
    const keys = Array(n).fill(command).join(" ");
    exec(`adb -s ${FIRE_TV_IP}:5555 shell input keyevent ${keys}`, (err) => {
      if (err) log(`[fire] adb error: ${err.message}`);
    });
    log(`[fire] adb keyevent ${keys} from ${client(req)}`);
    res.json({ ok: true, command, mode: tvMode });
    return;
  }

  const cmd = {
    type: "call_service",
    domain: "remote",
    service: "send_command",
    target: { entity_id: remoteId },
    service_data: { command },
  };
  const isArrow = ["up", "down", "left", "right"].includes(req.params.key);
  if (isArrow) {
    cmd.id = ++cmdId;
    if (ws) ws.send(JSON.stringify(cmd));
  } else {
    sendCmd(cmd);
  }
  log(`[${tvMode}] remote.send_command ${command} from ${client(req)}`);
  res.json({ ok: true, command, mode: tvMode });
});

// ─── Bravia (via HA Sony Bravia integration) ─────────────────────────────────
// State is tracked from HA WebSocket in braviaHaMuted / braviaHaPower.
// Volume/mute control via HA media_player services.

app.get("/tv/vol/:dir", (req, res) => {
  const dir = req.params.dir;
  if (dir !== "up" && dir !== "down") {
    res.status(400).json({ ok: false, error: "unknown dir" });
    return;
  }
  callService(
    "media_player",
    dir === "up" ? "volume_up" : "volume_down",
    BRAVIA_ENTITY_ID,
  );
  log(`vol ${dir} sent from ${client(req)}`);
  res.json({ ok: true });
});

app.get("/tv/mute", (req, res) => {
  callService("media_player", "volume_mute", BRAVIA_ENTITY_ID, {
    is_volume_muted: !braviaHaMuted,
  });
  log(`mute sent via HA Bravia from ${client(req)}`);
  res.json({ ok: true });
});

async function pushMuteState() {
  const recentlyOff = Date.now() - lastOffAt < 30000;
  if (recentlyOff) {
    await fetch(`${SRVR_INTERNAL_URL}/internal/tv-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        muted: null,
        power: "off",
        activeDevice,
        mode: tvMode,
      }),
    }).catch(() => {});
    return;
  }
  // In fire mode, use fire TV state to determine power
  if (tvMode === "fire") {
    const fireOn =
      fireTvState !== "off" &&
      fireTvState !== "unavailable" &&
      fireTvState !== "unknown";
    const braviaOn =
      braviaHaPower !== "off" &&
      braviaHaPower !== "unavailable" &&
      braviaHaPower !== "unknown";
    const power = fireOn || braviaHaMuted !== null || braviaOn ? "on" : "off";
    await fetch(`${SRVR_INTERNAL_URL}/internal/tv-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        muted: braviaHaMuted,
        power,
        activeDevice,
        mode: tvMode,
      }),
    }).catch(() => {});
    return;
  }
  const haOff =
    tvPowerState === "off" ||
    tvPowerState === "unavailable" ||
    tvPowerState === "unknown";
  if (haOff) {
    await fetch(`${SRVR_INTERNAL_URL}/internal/tv-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        muted: null,
        power: "off",
        activeDevice,
        mode: tvMode,
      }),
    }).catch(() => {});
    return;
  }
  const braviaOn =
    braviaHaPower !== "off" &&
    braviaHaPower !== "unavailable" &&
    braviaHaPower !== "unknown";
  const power = braviaHaMuted !== null || braviaOn ? "on" : "off";
  const effectivePower = Date.now() - lastOffAt < 5000 ? "off" : power;
  await fetch(`${SRVR_INTERNAL_URL}/internal/tv-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      muted: braviaHaMuted,
      power: effectivePower,
      activeDevice,
      mode: tvMode,
    }),
  }).catch(() => {});
}

app.get("/tv/mutestate", async (req, res) => {
  const haOn =
    (braviaHaPower !== "off" &&
      braviaHaPower !== "unavailable" &&
      braviaHaPower !== "unknown") ||
    (tvPowerState !== "off" &&
      tvPowerState !== "unavailable" &&
      tvPowerState !== "unknown");
  res.json({
    ok: true,
    muted: braviaHaMuted,
    power: haOn ? "on" : "off",
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
startIrDaemon();

app.listen(TV_PORT, () => {
  log(`listening on port ${TV_PORT}`);
});

setInterval(pushMuteState, 2000);
