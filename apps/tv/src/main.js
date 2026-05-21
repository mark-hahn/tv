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
const BRAVIA_TV_IP = "192.168.1.85";
const BRAVIA_PICTURE_URL = `http://${BRAVIA_TV_IP}/sony/video`;
const BRAVIA_PSK = "qwerty";

const PIC_TARGETS = [
  "pictureMode",
  "brightness",
  "contrast",
  "sharpness",
  "color",
  "hue",
  "colorTemperature",
  "hdrMode",
  "autoLocalDimming",
  "lightSensor",
];
const PIC_LABELS = {
  brightness: "Brightness",
  contrast: "Contrast",
  sharpness: "Sharpness",
  color: "Color",
  hue: "Hue",
  colorTemperature: "Color Temp",
  pictureMode: "Picture Mode",
  autoLocalDimming: "Local Dimming",
  lightSensor: "Light Sensor",
  hdrMode: "HDR Mode",
};

const EMBY_HOST = "hahnca.com:8920";
const EMBY_API_KEY = "1c399bd079d549cba8c916244d3add2b";
const EMBY_USER_ID = "894c752d448f45a3a1260ccaabd0adff";
const EMBY_BASE_URL = "http://127.0.0.1:8096/emby";
const SRVR_INTERNAL_URL = "http://127.0.0.1:8739";

const GOOGLE_HOME_DELAY_MS = 0; // ms after TV turns on before sending Home key
const GOOGLE_EMBY_DELAY_MS = 250; // ms after TV turns on before launching Emby
const FIRE_HOME_DELAY_MS = 0; // ms after Fire TV turns on before sending home key
const FIRE_EMBY_DELAY_MS = 5000; // ms after Fire TV turns on before launching Emby

// Subtitle nav (IRCC key sequence) delays
const SUB_NAV_PRE_DOWN1_DELAY_MS = 400; // after first prepend Down
const SUB_NAV_PRE_DOWN2_DELAY_MS = 400; // after second prepend Down
const SUB_NAV_PRE_RETURN_DELAY_MS = 600; // after prepend Return
const SUB_NAV_DOWN_OPEN_DELAY_MS = 1000; // after initial Down to open OSD
const SUB_NAV_RIGHT_DELAY_MS = 200; // after each Right arrow
const SUB_NAV_OPEN_DELAY_MS = 500; // after Confirm to open subtitle menu
const SUB_NAV_DOWN_DELAY_MS = 50; // after each Down arrow in subtitle menu
const SUB_NAV_CONFIRM_DELAY_MS = 200; // after last Down arrow before Confirm
const SUB_NAV_BACK_DELAY_MS = 500; // after final Confirm before sending Back
const SUB_NAV_POLL_MS = 10_000; // fast-poll window after nav completes

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

async function getBraviaSetting(target) {
  const resp = await fetch(BRAVIA_PICTURE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-PSK": BRAVIA_PSK },
    body: JSON.stringify({
      method: "getPictureQualitySettings",
      params: [{ target }],
      id: 1,
      version: "1.0",
    }),
  });
  const data = await resp.json();
  return data.result?.[0]?.[0]?.currentValue ?? null;
}

async function setBraviaSetting(target, value) {
  const strValue = String(value);
  const resp = await fetch(BRAVIA_PICTURE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-PSK": BRAVIA_PSK },
    body: JSON.stringify({
      method: "setPictureQualitySettings",
      params: [{ settings: [{ target, value: strValue }] }],
      id: 1,
      version: "1.0",
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
}

// ─── Emby WebSocket ─────────────────────────────────────────────────────────

function handleEmbySession(s) {
  let device = null;
  if (s.DeviceName === "Living Room TV") device = "google";
  if (!device) return;
  const playing = s.NowPlayingItem?.Name ?? null;
  const itemId = s.NowPlayingItem?.Id ?? null;
  const remoteCtrl = s.SupportsRemoteControl ?? false;
  const paused = s.PlayState?.IsPaused ?? null;
  const prev = prevSessions[device];
  const prevItemId = prev?.itemId ?? null;

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

  prevSessions[device] = {
    playing,
    itemId,
    remoteCtrl,
    paused,
  };
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
      season: s.NowPlayingItem.ParentIndexNumber ?? null,
      episode: s.NowPlayingItem.IndexNumber ?? null,
      positionTicks: s.PlayState?.PositionTicks ?? null,
      runtimeTicks: s.NowPlayingItem.RunTimeTicks ?? null,
    }));

  // Dedup key excludes position so position-only changes don't suppress the send
  const key = JSON.stringify(
    playing.map(({ positionTicks, runtimeTicks, ...p }) => p),
  );
  if (key === currentShowName && playing.length === 0) return;
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
  const url = `ws://127.0.0.1:8096/embywebsocket?api_key=${EMBY_API_KEY}&deviceId=${deviceId}`;
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
        else if (braviaMediaTitle === "TV") tvMode = "tv";
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
        else if (braviaMediaTitle === "TV") tvMode = "tv";
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
app.use(express.json());

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

// ─── Persistent adb shell for Bravia (text/keyboard input) ──────────────────
let braviaShell = null;
let braviaShellReady = false;
let braviaShellStdoutBuf = "";
let braviaShellPending = null;
let braviaKeySeq = 0;

function spawnBraviaShell() {
  if (braviaShell) {
    braviaShell.removeAllListeners();
    braviaShell.stdin.destroy();
    braviaShell.kill();
  }
  braviaShellReady = false;
  braviaShell = spawn("adb", ["-s", `${BRAVIA_TV_IP}:5555`, "shell"]);
  braviaShellStdoutBuf = "";
  braviaShell.stdout.on("data", (chunk) => {
    braviaShellStdoutBuf += chunk.toString();
    if (
      braviaShellPending &&
      braviaShellStdoutBuf.includes(braviaShellPending.marker)
    ) {
      const { resolve } = braviaShellPending;
      braviaShellPending = null;
      resolve();
    }
  });
  braviaShell.on("spawn", () => {
    log("[bravia] adb shell spawned");
    braviaShellReady = true;
  });
  braviaShell.on("error", (err) => {
    log(`[bravia] adb shell error: ${err.message}`);
    braviaShellReady = false;
  });
  braviaShell.on("close", (code) => {
    log(`[bravia] adb shell closed (${code}), reconnecting in 2s...`);
    braviaShellReady = false;
    braviaShell = null;
    setTimeout(connectBraviaShell, 2000);
  });
}

function connectBraviaShell() {
  exec(`adb connect ${BRAVIA_TV_IP}:5555`, (err, stdout) => {
    if (err) {
      log(`[bravia] adb connect failed: ${err.message}, retrying in 5s...`);
      setTimeout(connectBraviaShell, 5000);
    } else {
      log(`[bravia] adb connect: ${stdout.trim()}`);
      spawnBraviaShell();
    }
  });
}

function braviaShellCmd(cmd) {
  return new Promise((resolve, reject) => {
    if (!braviaShellReady || !braviaShell) {
      reject(new Error("bravia shell not ready"));
      return;
    }
    const marker = `__B${++braviaKeySeq}__`;
    braviaShellPending = { marker, resolve };
    braviaShell.stdin.write(`${cmd} && echo ${marker}\n`, (err) => {
      if (err) {
        braviaShellPending = null;
        reject(err);
      }
    });
  });
}

connectBraviaShell();

app.get("/tv/keyevent/:code", async (req, res) => {
  if (tvMode !== "google" && tvMode !== "tv") {
    log(`keyevent ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  const code = req.params.code;
  if (!/^[A-Z0-9_]+$/.test(code)) {
    res.status(400).json({ ok: false, error: "invalid keycode" });
    return;
  }
  try {
    await braviaShellCmd(`input keyevent ${code}`);
    log(`[bravia] keyevent ${code} from ${client(req)}`);
    res.json({ ok: true });
  } catch (err) {
    loge(`[bravia] keyevent failed: ${err.message}`);
    res.json({ ok: false, error: err.message });
  }
});

app.get("/tv/text", async (req, res) => {
  const text = req.query.t;
  if (!text) {
    res.status(400).json({ ok: false, error: "missing t" });
    return;
  }
  if (tvMode !== "google" && tvMode !== "tv") {
    log(`text ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  // Escape text for shell: wrap in single quotes, escape single quotes
  const escaped = text.replace(/'/g, "'\\''");
  try {
    await braviaShellCmd(`input text '${escaped}'`);
    log(`[bravia] text '${text}' from ${client(req)}`);
    res.json({ ok: true });
  } catch (err) {
    loge(`[bravia] text failed: ${err.message}`);
    res.json({ ok: false, error: err.message });
  }
});

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
    captions: "ClosedCaption",
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

  if (tvMode !== "fire" && tvMode !== "google" && tvMode !== "tv") {
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
  if (tvMode !== "google" && tvMode !== "fire" && tvMode !== "tv") {
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
  if (tvMode !== "google" && tvMode !== "fire" && tvMode !== "tv") {
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
  if (tvMode === "google") {
    log(`openapp google uri=${uri} from ${client(req)}`);
    callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
      media_content_type: "app",
      media_content_id: uri,
    });
    res.json({ ok: true });
  } else if (tvMode === "fire") {
    log(`openapp fire uri=${uri} from ${client(req)}`);
    adbExecP(`shell am start -n ${uri}`, "openapp");
    res.json({ ok: true });
  } else {
    log(`openapp ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
  }
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

// ─── Emby subtitle control ───────────────────────────────────────────────────

function sendIrcc(command, delayAfterMs) {
  return new Promise((resolve) => {
    callService("remote", "send_command", REMOTE_ENTITY_ID, { command });
    setTimeout(resolve, delayAfterMs);
  });
}

function normalizeCodec(codec) {
  const c = (codec || "").toLowerCase();
  if (c === "hdmv_pgs_subtitle" || c === "pgssub") return "PGS";
  if (c === "subrip") return "SRT";
  if (c === "ass" || c === "ssa") return "ASS";
  if (c === "webvtt") return "VTT";
  return (codec || "").toUpperCase();
}

function subStreamInfo(stream) {
  const codec = normalizeCodec(stream.Codec || "");
  if (stream.IsExternal && stream.Path) {
    const filename = stream.Path.split("/").pop();
    const noSrt = filename.replace(/\.srt$/i, "");
    const lastDot = noSrt.lastIndexOf(".");
    const name = lastDot >= 0 ? noSrt.slice(lastDot + 1) : noSrt;
    let type;
    if (/\.asr\.srt$/i.test(filename)) type = "asr";
    else if (/\.mb\d+\.srt$/i.test(filename)) type = "mbs";
    else if (/\.opn.{4,5}\.srt$/i.test(filename)) type = "opn";
    else type = "srt";
    return { name, type, label: `${name} (${codec})` };
  }
  const isPgs =
    stream.Codec === "hdmv_pgs_subtitle" || stream.Codec === "pgssub";
  const type = isPgs ? "pgs" : "embedded";
  // DisplayTitle already includes codec like "English (ASS)" — use it directly
  const label =
    stream.DisplayTitle || `${stream.Language || "Unknown"} (${codec})`;
  return { name: stream.Language || "Unknown", type, label };
}

app.get("/tv/emby/playing", async (req, res) => {
  try {
    const sessRes = await fetch(
      `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!sessRes.ok) {
      res.json({ ok: false, error: `sessions ${sessRes.status}` });
      return;
    }
    const sessions = await sessRes.json();
    const playing = [];
    for (const s of sessions) {
      if (!s.NowPlayingItem) continue;
      const item = s.NowPlayingItem;
      const sessionId = s.Id;
      const deviceName = s.DeviceName ?? s.Client ?? "Unknown";
      const showName = item.SeriesName || item.Name || "Unknown";
      const subtitleStreamIndex = s.PlayState?.SubtitleStreamIndex ?? -1;
      const seasonNum = item.ParentIndexNumber;
      const episodeNum = item.IndexNumber;
      const episodeCode =
        seasonNum != null && episodeNum != null
          ? `S${String(seasonNum).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`
          : null;

      let streams;
      try {
        const itemRes = await fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${item.Id}?Fields=MediaSources&api_key=${EMBY_API_KEY}`,
          { headers: { Accept: "application/json" } },
        );
        if (itemRes.ok) {
          const itemData = await itemRes.json();
          streams = itemData.MediaSources?.[0]?.MediaStreams;
        }
      } catch (_) {}
      if (!streams) streams = item.MediaSources?.[0]?.MediaStreams;

      const subtitles = [];
      for (const stream of streams ?? []) {
        if (stream.Type !== "Subtitle") continue;
        if (!stream.IsExternal) {
          const lang = (stream.Language || "").toLowerCase();
          if (lang && lang !== "eng" && lang !== "en") continue;
        }
        const { label, type } = subStreamInfo(stream);
        subtitles.push({ index: stream.Index, label, type });
      }

      playing.push({
        sessionId,
        deviceName,
        showName,
        episodeCode,
        subtitleStreamIndex,
        subtitles,
      });
    }
    res.json({ ok: true, playing });
  } catch (err) {
    loge("emby/playing error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.get("/tv/emby/position", async (req, res) => {
  try {
    const sessRes = await fetch(
      `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!sessRes.ok) {
      res.json({ ok: false, error: `sessions ${sessRes.status}` });
      return;
    }
    const sessions = await sessRes.json();
    const session = sessions.find(
      (s) => s.NowPlayingItem && s.DeviceName === "Living Room TV",
    );
    if (!session) {
      res.json({ ok: false, reason: "notPlaying" });
      return;
    }
    res.json({ ok: true, ticks: session.PlayState?.PositionTicks ?? 0 });
  } catch (err) {
    loge("emby/position error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.post("/tv/emby/seek", async (req, res) => {
  const { ticks } = req.body ?? {};
  if (ticks === undefined || ticks === null) {
    res.status(400).json({ ok: false, error: "missing ticks" });
    return;
  }
  try {
    const sessRes = await fetch(
      `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!sessRes.ok) {
      res.json({ ok: false, error: `sessions ${sessRes.status}` });
      return;
    }
    const sessions = await sessRes.json();
    const session = sessions.find(
      (s) => s.NowPlayingItem && s.DeviceName === "Living Room TV",
    );
    if (!session) {
      res.json({ ok: false, reason: "notPlaying" });
      return;
    }
    const seekRes = await fetch(
      `${EMBY_BASE_URL}/Sessions/${session.Id}/Playing/seek?SeekPositionTicks=${ticks}&api_key=${EMBY_API_KEY}`,
      { method: "POST", headers: { Accept: "application/json" } },
    );
    res.json({ ok: seekRes.ok });
  } catch (err) {
    loge("emby/seek error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// seek2: pause → seek → pause → [d3ms] → (repeat)
app.post("/tv/emby/seek2", async (req, res) => {
  const { ticks, d3ms = 500 } = req.body ?? {};
  if (ticks === undefined || ticks === null) {
    res.status(400).json({ ok: false, error: "missing ticks" });
    return;
  }
  try {
    const sessRes = await fetch(
      `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!sessRes.ok) {
      res.json({ ok: false, error: `sessions ${sessRes.status}` });
      return;
    }
    const sessions = await sessRes.json();
    const session = sessions.find(
      (s) => s.NowPlayingItem && s.DeviceName === "Living Room TV",
    );
    if (!session) {
      res.json({ ok: false, reason: "notPlaying" });
      return;
    }
    const id = session.Id;
    await fetch(
      `${EMBY_BASE_URL}/Sessions/${id}/Playing/Pause?api_key=${EMBY_API_KEY}`,
      { method: "POST" },
    );
    const seekRes = await fetch(
      `${EMBY_BASE_URL}/Sessions/${id}/Playing/seek?SeekPositionTicks=${ticks}&api_key=${EMBY_API_KEY}`,
      { method: "POST", headers: { Accept: "application/json" } },
    );
    await fetch(
      `${EMBY_BASE_URL}/Sessions/${id}/Playing/Pause?api_key=${EMBY_API_KEY}`,
      { method: "POST" },
    );
    await new Promise((r) => setTimeout(r, d3ms));
    res.json({ ok: seekRes.ok });
  } catch (err) {
    loge("emby/seek error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// scrub/start: server-side loop — pause → seek → pause → [intervalMs] → repeat
// scrub/stop:  kills the loop
let _scrubState = null;

app.post("/tv/emby/scrub/start", async (req, res) => {
  const { intervalMs = 500, distTicks } = req.body ?? {};
  if (!distTicks) {
    res.status(400).json({ ok: false, error: "missing distTicks" });
    return;
  }
  if (_scrubState) _scrubState.active = false;
  try {
    const sessRes = await fetch(
      `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!sessRes.ok) {
      res.json({ ok: false, error: `sessions ${sessRes.status}` });
      return;
    }
    const sessions = await sessRes.json();
    const session = sessions.find(
      (s) => s.NowPlayingItem && s.DeviceName === "Living Room TV",
    );
    if (!session) {
      res.json({ ok: false, reason: "notPlaying" });
      return;
    }
    const id = session.Id;
    let ticks = session.PlayState?.PositionTicks ?? 0;
    const state = { active: true, lastPing: Date.now() };
    _scrubState = state;
    (async () => {
      while (state.active) {
        if (Date.now() - state.lastPing > 1000) {
          log("scrub dead-man expired, stopping");
          break;
        }
        // Pause → seek → wait
        await fetch(
          `${EMBY_BASE_URL}/Sessions/${id}/Playing/Pause?api_key=${EMBY_API_KEY}`,
          { method: "POST" },
        );
        if (!state.active) break;
        ticks = Math.max(0, ticks + distTicks);
        await fetch(
          `${EMBY_BASE_URL}/Sessions/${id}/Playing/seek?SeekPositionTicks=${ticks}&api_key=${EMBY_API_KEY}`,
          { method: "POST" },
        ).catch(() => {});
        if (!state.active) break;
        await new Promise((r) => setTimeout(r, intervalMs));
        if (!state.active) break;
      }
    })().catch((err) => {
      loge("scrub loop error:", err.message);
      state.active = false;
    });
    res.json({ ok: true });
  } catch (err) {
    loge("scrub/start error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.post("/tv/emby/scrub/ping", (req, res) => {
  if (_scrubState) _scrubState.lastPing = Date.now();
  res.json({ ok: !!_scrubState });
});

app.post("/tv/emby/scrub/stop", (req, res) => {
  if (_scrubState) {
    _scrubState.active = false;
    _scrubState = null;
  }
  res.json({ ok: true });
});

app.post("/tv/emby/subtitle", async (req, res) => {
  const { sessionId, index } = req.body ?? {};
  if (!sessionId || index === undefined) {
    res.status(400).json({ ok: false, error: "missing sessionId or index" });
    return;
  }

  // Fetch streams to determine downCount and audio track count.
  // Menu order: None (0 downs), then each subtitle in stream order (+1 per track).
  // Right arrow count: 2 when single audio track, 3 when multiple audio tracks.
  let downCount;
  let rightCount = 2;
  try {
    const sessRes = await fetch(
      `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!sessRes.ok) {
      res.json({ ok: false, error: `sessions ${sessRes.status}` });
      return;
    }
    const sessions = await sessRes.json();
    const session = sessions.find((s) => s.Id === sessionId);
    if (!session?.NowPlayingItem) {
      res.json({ ok: false, error: "session not found or not playing" });
      return;
    }
    const item = session.NowPlayingItem;
    let streams;
    try {
      const itemRes = await fetch(
        `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${item.Id}?Fields=MediaSources&api_key=${EMBY_API_KEY}`,
        { headers: { Accept: "application/json" } },
      );
      if (itemRes.ok) {
        const itemData = await itemRes.json();
        streams = itemData.MediaSources?.[0]?.MediaStreams;
      }
    } catch (_) {}
    if (!streams) streams = item.MediaSources?.[0]?.MediaStreams ?? [];

    const audioStreams = streams.filter((s) => s.Type === "Audio");
    if (audioStreams.length > 1) rightCount = 3;

    if (index === -1) {
      downCount = 0;
    } else {
      const subStreams = streams.filter((s) => s.Type === "Subtitle");
      const pos = subStreams.findIndex((s) => s.Index === index);
      if (pos === -1) {
        res.json({ ok: false, error: "subtitle index not found in list" });
        return;
      }
      downCount = pos + 1;
    }
  } catch (err) {
    loge("emby/subtitle lookup error:", err.message);
    res.json({ ok: false, error: err.message });
    return;
  }

  log(
    `[emby] subtitle nav: index=${index} downCount=${downCount} rightCount=${rightCount}`,
  );
  const navMs =
    SUB_NAV_PRE_DOWN1_DELAY_MS +
    SUB_NAV_PRE_DOWN2_DELAY_MS +
    SUB_NAV_PRE_RETURN_DELAY_MS +
    SUB_NAV_DOWN_OPEN_DELAY_MS +
    rightCount * SUB_NAV_RIGHT_DELAY_MS +
    SUB_NAV_OPEN_DELAY_MS +
    downCount * SUB_NAV_DOWN_DELAY_MS +
    SUB_NAV_CONFIRM_DELAY_MS +
    SUB_NAV_BACK_DELAY_MS;
  const waitMs = navMs + SUB_NAV_POLL_MS;
  log(`[emby] subtitle nav waitMs=${waitMs}`);
  res.json({ ok: true, waitMs, navMs });

  await sendIrcc("Down", SUB_NAV_PRE_DOWN1_DELAY_MS);
  await sendIrcc("Down", SUB_NAV_PRE_DOWN2_DELAY_MS);
  await sendIrcc("Return", SUB_NAV_PRE_RETURN_DELAY_MS);
  await sendIrcc("Down", SUB_NAV_DOWN_OPEN_DELAY_MS);
  for (let i = 0; i < rightCount; i++) {
    await sendIrcc("Right", SUB_NAV_RIGHT_DELAY_MS);
  }
  await sendIrcc("Confirm", SUB_NAV_OPEN_DELAY_MS);
  for (let i = 0; i < downCount; i++) {
    await sendIrcc("Down", SUB_NAV_DOWN_DELAY_MS);
  }
  await new Promise((r) => setTimeout(r, SUB_NAV_CONFIRM_DELAY_MS));
  await sendIrcc("Confirm", SUB_NAV_BACK_DELAY_MS);
  callService("remote", "send_command", REMOTE_ENTITY_ID, {
    command: "Return",
  });
});

app.post("/tv/emby/subtitle-offset", async (req, res) => {
  const { sessionId, offsetMs } = req.body ?? {};
  if (!sessionId || offsetMs === undefined) {
    res.status(400).json({ ok: false, error: "missing sessionId or offsetMs" });
    return;
  }
  try {
    const r = await fetch(
      `${EMBY_BASE_URL}/Sessions/${sessionId}/Command?api_key=${EMBY_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Name: "SetSubtitleDelay",
          Arguments: { Delay: String(offsetMs) },
        }),
      },
    );
    log(
      `[emby] SetSubtitleDelay ${offsetMs}ms session=${sessionId} -> ${r.status}`,
    );
    res.json({ ok: r.ok });
  } catch (err) {
    loge("emby/subtitle-offset error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// ─── Bravia picture quality settings ─────────────────────────────────────────

app.get("/tv/picture", async (req, res) => {
  try {
    const resp = await fetch(BRAVIA_PICTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-PSK": BRAVIA_PSK },
      body: JSON.stringify({
        method: "getPictureQualitySettings",
        params: [{ target: "" }],
        id: 1,
        version: "1.0",
      }),
    });
    const data = await resp.json();
    const all = data.result?.[0] ?? [];
    const settings = all
      .filter((s) => PIC_TARGETS.includes(s.target))
      .map((s) => {
        const cand = s.candidate?.[0] ?? {};
        if (cand.max !== undefined) {
          return {
            target: s.target,
            label: PIC_LABELS[s.target] ?? s.target,
            value: s.currentValue,
            type: "range",
            min: cand.min,
            max: cand.max,
            step: cand.step ?? 1,
          };
        } else {
          const SKIP_OPTIONS = {};
          const skip = SKIP_OPTIONS[s.target] ?? [];
          const options = s.candidate
            .map((c) => c.value)
            .filter((v) => !skip.includes(v));
          return {
            target: s.target,
            label: PIC_LABELS[s.target] ?? s.target,
            value: s.currentValue,
            type: "enum",
            options,
          };
        }
      })
      .sort(
        (a, b) => PIC_TARGETS.indexOf(a.target) - PIC_TARGETS.indexOf(b.target),
      );
    res.json({ ok: true, settings });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post("/tv/picture", async (req, res) => {
  const { target, value } = req.body ?? {};
  if (!target || value === undefined) {
    res.status(400).json({ ok: false, error: "missing target or value" });
    return;
  }
  try {
    const resp = await fetch(BRAVIA_PICTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-PSK": BRAVIA_PSK },
      body: JSON.stringify({
        method: "setPictureQualitySettings",
        params: [{ settings: [{ target, value }] }],
        id: 1,
        version: "1.0",
      }),
    });
    const data = await resp.json();
    if (data.error) {
      res.json({ ok: false, error: JSON.stringify(data.error) });
      return;
    }
    log(`picture set ${target}=${value}`);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

connectHa();
connectEmby();

app.listen(TV_PORT, () => {
  log(`listening on port ${TV_PORT}`);
});

setInterval(pushTvState, 2000);
