import { WebSocket } from "ws";
import { exec, spawn } from "child_process";
import express from "express";
import cors from "cors";

const HA_HOST = "hahnca.com:8123";
const HA_ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIzM2Y2MmI0MWZjYTY0YTE1YWU2MjFlZDg2NGJmM2NmYyIsImlhdCI6MTc3MDc5NjQ0NywiZXhwIjoyMDg2MTU2NDQ3fQ.AoUSLrAjOWEhR2pQVeuuykKYPoXqyrnmecQMQkdrgp8";
const TV_PORT = 3004;
const BRAVIA_ENTITY_ID = "media_player.bravia_k_65xr70";
const REMOTE_ENTITY_ID = "remote.bravia_k_65xr70";
const FIRE_TV_ENTITY_ID = "media_player.fire_tv_192_168_1_47";
const FIRE_TV_REMOTE_ID = "remote.fire_tv_192_168_1_47";
const FIRE_TV_IP = "192.168.1.47";

const EMBY_HOST = "hahnca.com:8920";
const EMBY_API_KEY = "1c399bd079d549cba8c916244d3add2b";
const SRVR_INTERNAL_URL = "http://127.0.0.1:8739";

const GOOGLE_HOME_DELAY_MS = 0; // ms after TV turns on before sending Home key
const GOOGLE_EMBY_DELAY_MS = 100; // ms after TV turns on before launching Emby
const FIRE_HOME_DELAY_MS = 0; // ms after Fire TV turns on before sending home key
const FIRE_EMBY_DELAY_MS = 5000; // ms after Fire TV turns on before launching Emby

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
let fireTvState = "unknown";
let braviaHaMuted = null;
let braviaHaPower = "unknown";
let braviaMediaContentType = null;
let braviaMediaTitle = null;
let tvMode = "off"; // "google" | "fire" | "off" | "other" — set only from HA push
let activeDevice = null;
let lastOffAt = 0;
let lastOnAt = 0;
let pendingGoogleHome = false;
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
      const bravia = msg.result.find((s) => s.entity_id === BRAVIA_ENTITY_ID);
      if (bravia) {
        braviaHaPower = bravia.state;
        braviaHaMuted = bravia.attributes?.is_volume_muted ?? null;
        braviaMediaContentType = bravia.attributes?.media_content_type ?? null;
        braviaMediaTitle = bravia.attributes?.media_title ?? null;
        const st = braviaHaPower;
        if (st === "off" || st === "unavailable" || st === "unknown")
          tvMode = "off";
        else if (braviaMediaTitle === "Smart TV") tvMode = "google";
        else if (
          braviaMediaTitle === "Fire TV Stick" ||
          braviaMediaTitle === "HDMI 2"
        )
          tvMode = "fire";
        else tvMode = "other";
        log(
          `get_states: braviaState=${st} mediaTitle=${braviaMediaTitle} tvMode=${tvMode}`,
        );
      }
    }
  } else if (msg.type === "event") {
    const event = msg.event;
    if (event?.event_type === "state_changed") {
      const id = event.data?.new_state?.entity_id;
      const state = event.data?.new_state?.state;
      const prev = event.data?.old_state?.state;
      const WATCHED = new Set([
        REMOTE_ENTITY_ID,
        FIRE_TV_ENTITY_ID,
        FIRE_TV_REMOTE_ID,
        BRAVIA_ENTITY_ID,
      ]);
      if (WATCHED.has(id) && state !== prev) {
        log(`HA state: ${id} ${prev} -> ${state}`);
      }
      if (id === FIRE_TV_ENTITY_ID) fireTvState = state;
      if (id === BRAVIA_ENTITY_ID) {
        const attrs = event.data?.new_state?.attributes;
        log(
          `BRAVIA attrs: title=${attrs?.media_title ?? "null"} mediaType=${attrs?.media_content_type ?? "null"} muted=${attrs?.is_volume_muted ?? "null"} pendingGoogleHome=${pendingGoogleHome}`,
        );
        const prevPower = braviaHaPower;
        braviaHaPower = state;
        if (attrs) {
          braviaHaMuted = attrs.is_volume_muted ?? null;
          braviaMediaContentType = attrs.media_content_type ?? null;
          braviaMediaTitle = attrs.media_title ?? null;
        }
        // TV just turned on with pendingGoogleHome flag set
        const wasGooglePending = pendingGoogleHome;
        if (pendingGoogleHome && prevPower !== "on" && state === "on") {
          pendingGoogleHome = false;
          log("googlebtn: TV on — sending Home in 5s");
          setTimeout(() => {
            log("googlebtn: sending Home");
            callService("remote", "send_command", REMOTE_ENTITY_ID, {
              command: "Home",
            });
          }, GOOGLE_HOME_DELAY_MS);
          setTimeout(
            () =>
              callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
                media_content_type: "app",
                media_content_id:
                  "com.sony.dtv.tv.emby.embyatv.tv.emby.embyatv.startup.StartupActivity",
              }),
            GOOGLE_EMBY_DELAY_MS,
          );
        }
        // HDMI 2 selected but no CEC signal → Fire Stick is in standby; wake it
        // Skip if wasGooglePending — we don't want Fire Stick CEC hijacking the input
        if (
          braviaMediaTitle === "HDMI 2" &&
          braviaMediaContentType === null &&
          !wasGooglePending
        ) {
          log("HDMI 2 with no signal — waking Fire Stick");
          callService("media_player", "turn_on", FIRE_TV_ENTITY_ID);
        }
        // Keep tvMode in sync with what the TV is actually showing
        if (state === "off" || state === "unavailable" || state === "unknown")
          tvMode = "off";
        else if (braviaMediaTitle === "Smart TV") tvMode = "google";
        else if (
          braviaMediaTitle === "Fire TV Stick" ||
          braviaMediaTitle === "HDMI 2"
        )
          tvMode = "fire";
        else tvMode = "other";
        pushTvState().catch(() => {});
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

app.get("/tv/googlebtn", (req, res) => {
  log(
    `googlebtn from ${client(req)} braviaHaPower=${braviaHaPower} mediaTitle=${braviaMediaTitle}`,
  );
  callService("media_player", "turn_on", BRAVIA_ENTITY_ID);
  if (braviaHaPower === "on") {
    // TV already on — send home immediately
    log("googlebtn: TV already on, sending Home now");
    callService("remote", "send_command", REMOTE_ENTITY_ID, {
      command: "Home",
    });
    setTimeout(() => {
      log("googlebtn: +10s launching Emby via play_media");
      callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
        media_content_type: "app",
        media_content_id:
          "com.sony.dtv.tv.emby.embyatv.tv.emby.embyatv.startup.StartupActivity",
      });
    }, GOOGLE_EMBY_DELAY_MS);
  } else {
    // TV off — wait for state_changed on transition to "on"
    pendingGoogleHome = true;
    log(`googlebtn: TV not on (${braviaHaPower}), set pendingGoogleHome=true`);
  }
  res.json({ ok: true });
});

// ─── Persistent adb shell ────────────────────────────────────────────────────
let fireShell = null;
let fireShellReady = false;
let fireShellStdoutBuf = "";
let fireShellPending = null; // { marker, resolve } — at most one in-flight

function spawnFireShell() {
  if (fireShell) {
    fireShell.removeAllListeners();
    fireShell.stdin.destroy();
    fireShell.kill();
  }
  fireShellReady = false;
  fireShell = spawn("adb", ["-s", `${FIRE_TV_IP}:5555`, "shell"]);
  fireShellStdoutBuf = "";
  fireShell.stdout.on("data", (chunk) => {
    fireShellStdoutBuf += chunk.toString();
    if (
      fireShellPending &&
      fireShellStdoutBuf.includes(fireShellPending.marker)
    ) {
      const { resolve } = fireShellPending;
      fireShellPending = null;
      resolve();
    }
  });
  fireShell.on("spawn", () => {
    log("[fire] adb shell spawned");
    fireShellReady = true;
  });
  fireShell.on("error", (err) => {
    log(`[fire] adb shell error: ${err.message}`);
    fireShellReady = false;
  });
  fireShell.on("close", (code) => {
    log(`[fire] adb shell closed (${code}), reconnecting in 2s...`);
    fireShellReady = false;
    fireShell = null;
    setTimeout(connectFireShell, 2000);
  });
}

function connectFireShell() {
  exec(`adb connect ${FIRE_TV_IP}:5555`, (err, stdout) => {
    if (err) {
      log(`[fire] adb connect failed: ${err.message}, retrying in 5s...`);
      setTimeout(connectFireShell, 5000);
    } else {
      log(`[fire] adb connect: ${stdout.trim()}`);
      spawnFireShell();
    }
  });
}

let fireKeySeq = 0;
function fireKeyevent(keycode) {
  return new Promise((resolve, reject) => {
    if (!fireShellReady || !fireShell) {
      reject(new Error("fire shell not ready"));
      return;
    }
    const marker = `__K${++fireKeySeq}__`;
    fireShellPending = { marker, resolve };
    fireShell.stdin.write(
      `input keyevent ${keycode} && echo ${marker}\n`,
      (err) => {
        if (err) {
          fireShellPending = null;
          reject(err);
        }
      },
    );
  });
}

function adbExecP(cmd, label) {
  return new Promise((resolve) => {
    exec(`adb -s ${FIRE_TV_IP}:5555 ${cmd}`, (err, stdout, stderr) => {
      if (err && stderr && stderr.includes("not found")) {
        log(`[fire] adb ${label}: device not found, connecting...`);
        exec(`adb connect ${FIRE_TV_IP}:5555`, () => {
          exec(`adb -s ${FIRE_TV_IP}:5555 ${cmd}`, (err2) => {
            if (err2)
              log(`[fire] adb ${label} error after connect: ${err2.message}`);
            else log(`[fire] adb ${label} ok (after connect)`);
            resolve();
          });
        });
      } else if (err) {
        log(`[fire] adb ${label} error: ${err.message}`);
        resolve();
      } else {
        log(`[fire] adb ${label} ok`);
        resolve();
      }
    });
  });
}

function adbExec(cmd, label) {
  adbExecP(cmd, label);
}

connectFireShell();

app.get("/tv/firebtn", (req, res) => {
  log(`firebtn from ${client(req)}`);
  callService("media_player", "turn_on", FIRE_TV_ENTITY_ID);
  setTimeout(
    () => adbExec("shell input keyevent 3", "home"),
    FIRE_HOME_DELAY_MS,
  );
  setTimeout(
    () =>
      adbExec(
        "shell am start -n tv.emby.embyatv/.startup.StartupActivity",
        "emby launch",
      ),
    FIRE_EMBY_DELAY_MS,
  );
  res.json({ ok: true });
});

app.get("/tv/on", (req, res) => {
  log(`on from ${client(req)}`);
  callService("media_player", "turn_on", BRAVIA_ENTITY_ID);
  res.json({ ok: true });
});

app.get("/tv/mode/:mode", (req, res) => {
  const mode = req.params.mode;
  if (mode !== "google" && mode !== "fire") {
    res.status(400).json({ ok: false, error: "unknown mode" });
    return;
  }
  log(`mode set to ${mode} from ${client(req)} (legacy route)`);
  if (mode === "fire") {
    callService("media_player", "turn_on", FIRE_TV_ENTITY_ID);
    setTimeout(
      () =>
        adbExec(
          "shell am start -n tv.emby.embyatv/.startup.StartupActivity",
          "emby launch",
        ),
      5000,
    );
  } else {
    // google
    callService("media_player", "turn_on", BRAVIA_ENTITY_ID);
    setTimeout(
      () =>
        callService("remote", "send_command", REMOTE_ENTITY_ID, {
          command: "Home",
        }),
      GOOGLE_HOME_DELAY_MS,
    );
    setTimeout(
      () =>
        callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
          media_content_type: "app",
          media_content_id:
            "com.sony.dtv.tv.emby.embyatv.tv.emby.embyatv.startup.StartupActivity",
        }),
      GOOGLE_EMBY_DELAY_MS,
    );
  }
  lastOnAt = Date.now();
  res.json({ ok: true, mode });
  fetch(`${SRVR_INTERNAL_URL}/internal/tv-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ muted: null, power: "on", activeDevice, mode }),
  }).catch(() => {});
});

app.get("/tv/emby", (req, res) => {
  if (tvMode === "fire") {
    adbExec(
      "shell am start -n tv.emby.embyatv/.startup.StartupActivity",
      "emby",
    );
  } else if (tvMode === "google") {
    callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
      media_content_type: "app",
      media_content_id:
        "com.sony.dtv.tv.emby.embyatv.tv.emby.embyatv.startup.StartupActivity",
    });
  } else {
    log(`emby ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  res.json({ ok: true });
});

app.get("/tv/off", (req, res) => {
  log(`off from ${client(req)} (mode: ${tvMode})`);
  callService("media_player", "turn_off", BRAVIA_ENTITY_ID);
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

app.get("/tv/key/:key", async (req, res) => {
  const GOOGLE_KEY_MAP = {
    ok: "Confirm",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    home: "Home",
    back: "Return",
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
  const keyMap = tvMode === "fire" ? FIRE_KEY_MAP : GOOGLE_KEY_MAP;
  const remoteId = REMOTE_ENTITY_ID;
  const command = keyMap[req.params.key];
  if (!command) {
    res.status(400).json({ ok: false, error: "unknown key" });
    return;
  }

  if (tvMode !== "fire" && tvMode !== "google") {
    log(`key ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }

  if (tvMode === "fire") {
    const n = Math.min(parseInt(req.query.n) || 1, 20);
    const keys = Array(n).fill(command).join(" ");
    if (fireShellReady) {
      await fireKeyevent(keys);
      log(`[fire] keyevent ${command}×${n} via shell from ${client(req)}`);
    } else {
      await adbExecP(`shell input keyevent ${keys}`, `keyevent ${keys}`);
      log(`[fire] adb keyevent ${keys} from ${client(req)}`);
    }
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
  if (tvMode !== "google" && tvMode !== "fire") {
    log(`vol ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  callService("remote", "send_command", REMOTE_ENTITY_ID, {
    command: dir === "up" ? "VolumeUp" : "VolumeDown",
  });
  log(`vol ${dir} sent from ${client(req)}`);
  res.json({ ok: true });
});

app.get("/tv/mute", (req, res) => {
  if (tvMode !== "google" && tvMode !== "fire") {
    log(`mute ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  callService("media_player", "volume_mute", BRAVIA_ENTITY_ID, {
    is_volume_muted: !braviaHaMuted,
  });
  log(`mute sent via HA Bravia from ${client(req)}`);
  res.json({ ok: true });
});

async function pushTvState() {
  const recentlyOn = Date.now() - lastOnAt < 30000;
  const recentlyOff = Date.now() - lastOffAt < 30000;
  let power;
  if (recentlyOff && Date.now() - lastOffAt < 5000) {
    power = "off";
  } else if (recentlyOff) {
    power = "off";
  } else if (tvMode === "fire") {
    const fireOn =
      fireTvState !== "off" &&
      fireTvState !== "unavailable" &&
      fireTvState !== "unknown";
    const braviaOn =
      braviaHaPower !== "off" &&
      braviaHaPower !== "unavailable" &&
      braviaHaPower !== "unknown";
    power = fireOn || braviaOn ? "on" : "off";
  } else {
    const braviaOn =
      braviaHaPower !== "off" &&
      braviaHaPower !== "unavailable" &&
      braviaHaPower !== "unknown";
    power = braviaOn || recentlyOn ? "on" : "off";
  }
  await fetch(`${SRVR_INTERNAL_URL}/internal/tv-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      power,
      muted: power === "off" ? null : braviaHaMuted,
      mode: tvMode,
      activeDevice,
      state: braviaHaPower,
      mediaContentType: braviaMediaContentType,
      mediaTitle: braviaMediaTitle,
    }),
  }).catch(() => {});
}

app.get("/tv/mutestate", async (req, res) => {
  const haOn =
    braviaHaPower !== "off" &&
    braviaHaPower !== "unavailable" &&
    braviaHaPower !== "unknown";
  res.json({
    ok: true,
    muted: braviaHaMuted,
    power: haOn ? "on" : "off",
    activeDevice,
  });
});

app.get("/tv/openapp", (req, res) => {
  const uri = req.query.uri;
  if (!uri) {
    res.status(400).json({ ok: false, error: "missing uri" });
    return;
  }
  if (tvMode !== "google") {
    log(`openapp ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  log(`openapp uri=${uri} from ${client(req)}`);
  callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
    media_content_type: "app",
    media_content_id: uri,
  });
  res.json({ ok: true });
});

app.get("/tv/status", (req, res) => {
  res.json({
    entity: BRAVIA_ENTITY_ID,
    state: braviaHaPower,
    mode: tvMode,
    muted: braviaHaMuted,
    mediaContentType: braviaMediaContentType,
    mediaTitle: braviaMediaTitle,
    activeDevice,
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

connectHa();
connectEmby();

app.listen(TV_PORT, () => {
  log(`listening on port ${TV_PORT}`);
});

setInterval(pushTvState, 2000);
