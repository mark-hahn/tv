import { WebSocket, WebSocketServer } from "ws";
import { exec, spawn } from "child_process";
import { createWriteStream, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import express from "express";
import cors from "cors";
import { ChannelPeer } from "@tv/share/channelPeer";
import { unilog, logHere, setUnilogSink } from "@tv/share";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SRVR_LOG_URL = "http://127.0.0.1:8739/api/log";
const TV_PICTURE_CHANNEL_POLL_MS = 3000;
const EMBY_PLAYING_CHANNEL_POLL_MS = 3000;
let tvChannelPeer = null;
let tvPictureChannelPollTimer = null;
let tvPictureChannelLastJson = "";
let embyPlayingChannelPollTimer = null;
let embyPlayingChannelLastJson = "";
setUnilogSink(({ logId, ts, message }) => {
  fetch(SRVR_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logId, pid: "tv-tv", ts, message }),
  }).catch(() => {});
});
mkdirSync(join(__dirname, "../data"), { recursive: true });
const _adbLog = createWriteStream(join(__dirname, "../data/tv-adb.log"), {
  flags: "a",
});
function adbLog(...args) {
  const d = new Date();
  const ye = new Intl.DateTimeFormat("en", {
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(d);
  const mo = new Intl.DateTimeFormat("en", {
    month: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(d);
  const da = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(d);
  const ho = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    hour12: false,
    timeZone: "America/Los_Angeles",
  }).format(d);
  const mi = new Intl.DateTimeFormat("en", {
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(d);
  const se = new Intl.DateTimeFormat("en", {
    second: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(d);
  const line = `[${ye}/${mo}/${da} ${ho}:${mi}:${se}] ${args.join(" ")}\n`;
  const fixedLine = line.replace(/ 24:(\d{2}:\d{2})\]/, " 00:$1]");
  _adbLog.write(fixedLine);
}

const HA_HOST = "hahnca.com:8123";
const HA_ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIzM2Y2MmI0MWZjYTY0YTE1YWU2MjFlZDg2NGJmM2NmYyIsImlhdCI6MTc3MDc5NjQ0NywiZXhwIjoyMDg2MTU2NDQ3fQ.AoUSLrAjOWEhR2pQVeuuykKYPoXqyrnmecQMQkdrgp8";
const TV_PORT = 3004;
const BRAVIA_ENTITY_ID = "media_player.bravia_k_65xr70";
const REMOTE_ENTITY_ID = "remote.bravia_k_65xr70";
const FIRE_TV_ENTITY_ID = "media_player.fire_tv_192_168_1_47";
const FIRE_TV_REMOTE_ID = "remote.fire_tv_192_168_1_47";
const FIRE_TV_IP = "192.168.1.47";
const FIRE_KEY_TIMEOUT_MS = 5000;
const BRAVIA_TV_IP = "192.168.1.86:34047";
const BRAVIA_PICTURE_URL = `http://192.168.1.86/sony/video`;
// setAudioMute takes the state it wants rather than toggling, which is the one
// way to reach a known mute state on this set. Both the HA remote's "Mute"
// command and HA's own media_player.volume_mute are IRCC toggles -- the braviatv
// integration throws away the boolean it is handed -- and its is_volume_muted is
// stuck at false forever, because getVolumeInformation answers 500 on this model.
const BRAVIA_AUDIO_URL = `http://192.168.1.86/sony/audio`;
const BRAVIA_PSK = "qwerty";

// tvapprc bridge. The phone cannot reach the tv directly: the ap isolates
// wireless clients from each other, and both the phone and the tv are on wifi.
// This host is wired, and wireless->wired and wired->wireless both work, so it
// forwards remote commands across the gap. Still a single lan hop each way,
// not a trip out to the public hahnca.com endpoint.
const TVAPPRC_BRIDGE_PORT = 8098;
const TVAPP_CTRL_URL = "ws://192.168.1.86:8099";
const TVAPP_DIAL_RETRY_MS = 2000;
// Sideloaded, but still in the tv's own application list, so opening tvapp needs
// no adb — which matters, because the tv's adb port moves on every reboot.
const BRAVIA_APP_CONTROL_URL = "http://192.168.1.86/sony/appControl";
const TVAPP_BRAVIA_URI =
  "com.sony.dtv.com.hahnca.tvapp.com.hahnca.tvapp.MainActivity";
// Bridge control messages, hand-mirrored in apps/android/App.js. Distinct
// from the remote-to-tvapp protocol, which the bridge forwards without reading.
const MSG_OPEN_TVAPP = "o"; // phone -> bridge: open tvapp on the tv
const MSG_TVAPP_UP = "u"; // bridge -> phone: tvapp is open
const MSG_TVAPP_DOWN = "d"; // bridge -> phone: tvapp has closed
// tvapp's own protocol (apps/tvapp's CtrlServer.java), used directly below --
// not relayed -- so the web client's Shows button works with no phone
// connected at all.
const CMD_BACK_TO_EMBY = "b"; // close tvapp and bring Emby up
const CMD_FORCE_CLOSE_TO_EMBY = "g"; // same, but ignoring tvapp's focus
const CMD_EMBY_SELECTED = "e"; // load tvapp's active show into Emby
const CMD_SELECT_SHOW = "s"; // select a show by name
const CMD_CUSTOM_CHANGED = "c"; // the shared filter settings changed
const TVAPP_PROBE_TIMEOUT_MS = 800;
const TVAPP_SELECT_DIAL_TIMEOUT_MS = 8000;

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
// Emby app launch id on the Bravia Google-TV (Sony appControl uri for com.mb.android)
const EMBY_APP_URI = "com.sony.dtv.com.mb.android.com.mb.android.MainActivity";
// Emby app launch activity on the Fire TV (adb am start -n)
const EMBY_FIRE_ACTIVITY = "com.mb.android/.MainActivity";
// Emby DeviceNames reported by the Emby app on each TV
const TV_DEVICE_NAMES = ["Living Room TV", "Mark's Fire TV"];
const LIVING_ROOM_DEVICE_NAME = "Living Room TV";
const SRVR_INTERNAL_URL = "http://127.0.0.1:8739";

const GOOGLE_HOME_DELAY_MS = 0; // ms after TV turns on before sending Home key
const GOOGLE_EMBY_DELAY_MS = 250; // ms after TV turns on before launching Emby
const VIEW_SHOW_DELAY_MS = 1000; // ms after Emby app launch before firing embyViewShow (fallback)
const PENDING_VIEW_SHOW_MAX_AGE_MS = 10000; // ms before an unsent pending viewshow is dropped
const EMBY_LAUNCH_DELAY_MS = 1500; // ms after launching Emby before sending it the show
const VIEW_SHOW_RESEND_MS = 2000; // ms between show resends while Emby boots
const FIRE_HOME_DELAY_MS = 0; // ms after Fire TV turns on before sending home key
const FIRE_EMBY_DELAY_MS = 5000; // ms after Fire TV turns on before launching Emby

// Scrub control
const SCRUB_START_COUNT = 4; // number of slow keys before speeding up
const SCRUB_RATE_FWD_SLOW = 750; // ms between right keys for first N
const SCRUB_RATE_FWD_FAST = 100; // ms between right keys after first N
const SCRUB_RATE_REV_SLOW = 100; // ms between left keys for first N
const SCRUB_RATE_REV_FAST = 100; // ms between left keys after first N
const SCRUB_DEADMAN_TIMEOUT = 2000; // ms without ping before auto-stop

// Subtitle nav (IRCC key sequence) delay
const SUB_KEY_DELAY = 400; // ms between each key send in subtitle nav sequence
const SUB_NAV_POLL_MS = 10_000; // fast-poll window after nav completes

// Automatic show selection (Emby home-screen key sequence)
const SHOW_SEL_KEY_DELAY = 50; // ms between keys in the show-select sequence
const SHOW_SEL_KEY_FAST_DELAY = 50; // ms between keys in the fast runs
const SHOW_SEL_EPISODE_SCAN = 400; // played episodes fetched when ranking shows
const SHOW_SEL_TZ = "America/Los_Angeles"; // zone "today" is judged in

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
    .replace(",", "")
    .replace(/24:(\d+)/, "00:$1");
}

function log(...args) {
  unilog(369, ``, ...args);
}
function loge(...args) {
  unilog(370, `ERROR`, ...args);
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
  // Episodes carry the show in SeriesName; movies only have Name.
  const showName = s.NowPlayingItem?.SeriesName ?? playing;
  const itemId = s.NowPlayingItem?.Id ?? null;
  const remoteCtrl = s.SupportsRemoteControl ?? false;
  const paused = s.PlayState?.IsPaused ?? null;
  const prev = prevSessions[device];

  if (prev) {
    const changed =
      (prev.playing === null && playing !== null) ||
      (!prev.remoteCtrl && remoteCtrl) ||
      prev.paused !== paused;
    if (changed) activeDevice = device;
  }

  // Emby broadcasts alternate between full and partial "Living Room TV"
  // sessions, so itemId toggles real-id <-> null every ~second. Only act on
  // the real playback session (non-null itemId) and log when the show changes
  // or it pauses/resumes.
  if (itemId !== null) {
    const showChanged = itemId !== lastShowItem[device];
    const pausedChanged = paused !== lastPaused[device];
    if (showChanged || pausedChanged) {
      lastShowItem[device] = itemId;
      lastPaused[device] = paused;
      const state = paused ? "paused" : "playing";
      unilog(371, `activeDevice: ${device} ${state}: ${showName}`);
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
    match: (s) => s.Client === "AndroidTv" || s.Client === "Emby for Android",
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
      id: s.NowPlayingItem.Id ?? null,
    }));

  // Dedup key excludes position so position-only changes don't suppress the send
  const key = JSON.stringify(
    playing.map(({ positionTicks, runtimeTicks, ...p }) => p),
  );
  if (key === currentShowName && playing.length === 0) return;
  currentShowName = key;

  const showName = playing[0]?.showName ?? null;
  if (showName) lastRelevantShow = showName;
  fetch(`${SRVR_INTERNAL_URL}/internal/nowPlaying`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ showName, playing }),
  }).catch(() => {});
}

function connectEmby() {
  const deviceId = "tv-server";
  const url = `ws://127.0.0.1:8096/embywebsocket?api_key=${EMBY_API_KEY}&deviceId=${deviceId}`;
  unilog(372, "connecting to Emby WebSocket...");
  const embyWs = new WebSocket(url, { rejectUnauthorized: false });

  embyWs.on("open", () => {
    unilog(373, "emby ws opened");
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
      checkSubtitleMismatch(msg.Data).catch(() => {});
    }
  });

  embyWs.on("error", (err) => unilog(374, "emby ws error:", err.message));
  embyWs.on("close", () => {
    unilog(1742, `emby ws closed, reconnecting in 5s`);
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
let pendingGoogleTvapp = false;
let pendingFireEmby = false;
let pendingViewShow = null; // { showId, showName } — queued for after Emby launches
let currentShowName = null;
// Whichever show is most relevant right now — the client's own browsing
// selection, or whatever Emby actually started playing, last write wins.
// tvapp is told to select this whenever it starts fresh, so opening it while
// a show it started itself is mid-playback doesn't override its own correct
// selection with some unrelated show the client happens to have open.
let lastRelevantShow = null;
const prevSessions = {};
const lastShowItem = {}; // last real (non-null) NowPlayingItem id per device
const lastPaused = {}; // last pause state of the real playback session per device

// Scrub state
let scrubDirection = null; // 'left' or 'right'
let scrubInterval = null;
let scrubDeadmanTimer = null;
let scrubKeyCount = 0;

function sendCmd(cmd) {
  setTimeout(() => {
    if (!cmd.noId) cmd.id = ++cmdId;
    delete cmd.noId;
    if (ws) ws.send(JSON.stringify(cmd));
    else unilog(376, "sendCmd with no ws");
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
  unilog(377, `callService ${domain}.${service} -> ${entityId}`);
}

function handleMsg(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    unilog(378, "JSON parse error:", raw);
    return;
  }

  if (msg.type === "auth_required") {
    unilog(379, "ws: auth_required");
    sendCmd({ noId: true, type: "auth", access_token: HA_ACCESS_TOKEN });
  } else if (msg.type === "auth_ok") {
    unilog(380, "ws: auth_ok");
    authenticated = true;
    sendCmd({ type: "get_states" });
    sendCmd({ type: "subscribe_events", event_type: "state_changed" });
  } else if (msg.type === "auth_invalid") {
    unilog(381, "ws: auth_invalid");
    process.exit(1);
  } else if (msg.type === "result") {
    if (!msg.success) {
      unilog(382, "command failed id:", msg.id, msg.error);
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
        unilog(
          383,
          `get_states: braviaState=${st} mediaTitle=${braviaMediaTitle} tvMode=${tvMode}`,
        );
        // Bravia ADB disabled — not needed for normal operation (remote/volume/power all go via HA).
        // To re-enable: uncomment this block and the state_changed block below, the variables, and
        // the spawnBraviaShell/connectBraviaShell/braviaShellCmd functions, and the /tv/keyevent
        // and /tv/text routes.
        // if (st === "on" && !braviaAdbEnabled) {
        //   braviaAdbEnabled = true;
        //   braviaAdbBackoff = 2000;
        //   adbLog("TV already on at startup — starting adb connect");
        //   connectBraviaShell();
        // }
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
        unilog(384, `HA state: ${id} ${prev} -> ${state}`);
      }
      if (id === FIRE_TV_ENTITY_ID) fireTvState = state;
      if (id === BRAVIA_ENTITY_ID) {
        const attrs = event.data?.new_state?.attributes;
        unilog(
          385,
          `BRAVIA attrs: title=${attrs?.media_title ?? "null"} mediaType=${attrs?.media_content_type ?? "null"} muted=${attrs?.is_volume_muted ?? "null"} pendingGoogleHome=${pendingGoogleHome} pendingGoogleTvapp=${pendingGoogleTvapp} pendingFireEmby=${pendingFireEmby}`,
        );
        const prevPower = braviaHaPower;
        braviaHaPower = state;
        if (attrs) {
          braviaHaMuted = attrs.is_volume_muted ?? null;
          braviaMediaContentType = attrs.media_content_type ?? null;
          braviaMediaTitle = attrs.media_title ?? null;
        }
        // TV just turned on from a googlebtn press — open tvapp
        const wasGoogleTvappPending = pendingGoogleTvapp;
        if (pendingGoogleTvapp && prevPower !== "on" && state === "on") {
          pendingGoogleTvapp = false;
          unilog(1902, "googlebtn: TV on — launching tvapp");
          openTvappSelectingShow();
        }
        // TV just turned on with pendingGoogleHome flag set
        const wasGooglePending = pendingGoogleHome;
        if (pendingGoogleHome && prevPower !== "on" && state === "on") {
          pendingGoogleHome = false;
          unilog(386, "googlebtn: TV on — sending Home in 5s");
          setTimeout(() => {
            unilog(387, "googlebtn: sending Home");
            callService("remote", "send_command", REMOTE_ENTITY_ID, {
              command: "Home",
            });
          }, GOOGLE_HOME_DELAY_MS);
          setTimeout(
            () =>
              callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
                media_content_type: "app",
                media_content_id: EMBY_APP_URI,
              }),
            GOOGLE_EMBY_DELAY_MS,
          );
          setTimeout(
            () => firePendingViewShow("viewshow(tv-on)"),
            GOOGLE_EMBY_DELAY_MS + VIEW_SHOW_DELAY_MS,
          );
        }
        // pendingFireEmby: launch Emby once FireTV is the active input
        if (
          pendingFireEmby &&
          (braviaMediaTitle === "Fire TV Stick" ||
            braviaMediaTitle === "HDMI 2")
        ) {
          pendingFireEmby = false;
          unilog(388, "firebtn: FireTV active — launching Emby");
          setTimeout(
            () =>
              adbExec(`shell am start -n ${EMBY_FIRE_ACTIVITY}`, "emby launch"),
            FIRE_EMBY_DELAY_MS,
          );
        }
        // HDMI 2 selected but no CEC signal → Fire Stick is in standby; wake it
        // Skip if wasGooglePending/wasGoogleTvappPending — we don't want Fire Stick CEC hijacking the input
        if (
          braviaMediaTitle === "HDMI 2" &&
          braviaMediaContentType === null &&
          !wasGooglePending &&
          !wasGoogleTvappPending
        ) {
          unilog(389, "HDMI 2 with no signal — waking Fire Stick");
          callService("media_player", "turn_on", FIRE_TV_ENTITY_ID);
        }
        // Drive ADB connect from HA power state — disabled (see startup block above for re-enable notes)
        // if (
        //   (state === "off" || state === "unavailable" || state === "unknown") &&
        //   braviaAdbEnabled
        // ) {
        //   braviaAdbEnabled = false;
        //   braviaAdbConnecting = false;
        //   adbLog(`TV ${state} — disabling adb reconnect`);
        //   if (braviaShell) {
        //     braviaShell.removeAllListeners();
        //     braviaShell.stdin.destroy();
        //     braviaShell.kill();
        //     braviaShell = null;
        //     braviaShellReady = false;
        //   }
        // } else if (state === "on" && !braviaAdbEnabled) {
        //   braviaAdbEnabled = true;
        //   braviaAdbBackoff = 2000;
        //   adbLog("TV on — starting adb connect");
        //   connectBraviaShell();
        // }
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
  unilog(390, "connecting to HA WebSocket...");
  ws = new WebSocket(`wss://${HA_HOST}/api/websocket`, {
    rejectUnauthorized: false,
  });

  ws.on("open", () => unilog(391, "ws opened"));
  ws.on("message", (data) => handleMsg(data.toString()));
  ws.on("error", (err) => unilog(392, "ws error:", err.message));
  ws.on("close", () => {
    unilog(1743, `ws closed, reconnecting in 5s`);
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
  unilog(
    394,
    `googlebtn from ${client(req)} braviaHaPower=${braviaHaPower} mediaTitle=${braviaMediaTitle}`,
  );
  callService("media_player", "turn_on", BRAVIA_ENTITY_ID);
  if (braviaHaPower === "on") {
    // TV already on — launch tvapp immediately
    unilog(1903, "googlebtn: TV already on, launching tvapp");
    openTvappSelectingShow();
  } else {
    // TV off — wait for state_changed on transition to "on"
    pendingGoogleTvapp = true;
    unilog(1904, `googlebtn: TV not on (${braviaHaPower}), set pendingGoogleTvapp=true`);
  }
  res.json({ ok: true });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Newest LastActivityDate across the TV's Emby sessions. Emby stamps it on
// every api call the app makes, so a change means the app is talking to the
// server — which is what a restarting Emby ui does and an idle one does not.
async function embyTvLastActivity() {
  try {
    const resp = await fetch(
      `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
      {
        headers: { Accept: "application/json" },
      },
    );
    const sessions = await resp.json();
    const dates = sessions
      .filter((s) => s.DeviceName === LIVING_ROOM_DEVICE_NAME)
      .map((s) => s.LastActivityDate)
      .sort();
    return dates.at(-1) ?? null;
  } catch (e) {
    unilog(1395, `could not read Emby sessions: ${e.message}`);
    return null;
  }
}

// Sends the show to Emby's live session on the TV. Returns true when Emby
// accepted it; the pending show is only cleared on success so a later trigger
// (like the TV-off fallback timer) can try again.
async function firePendingViewShow(label) {
  if (!pendingViewShow) return false;
  const { showId, showName, episodeId, play, at } = pendingViewShow;
  if (Date.now() - at > PENDING_VIEW_SHOW_MAX_AGE_MS) {
    pendingViewShow = null;
    unilog(1390, `${label}: pending viewshow ${showId} too old, dropped`);
    return false;
  }
  unilog(398, `${label}: firing viewshow showId=${showId}`);
  try {
    const resp = await fetch(`${SRVR_INTERNAL_URL}/api/embyViewShow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId, showName, episodeId, play }),
    });
    const result = await resp.json();
    unilog(399, `${label}: viewshow result=${JSON.stringify(result)}`);
    if (!result.found) return false;
    pendingViewShow = null;
    return true;
  } catch (e) {
    unilog(400, `${label}: viewshow failed: ${e.message}`);
    return false;
  }
}

let viewShowSeq = 0; // invalidates older button presses still resending

app.get("/tv/viewshow", async (req, res) => {
  const { showId, showName, episodeId } = req.query;
  // tvapp's Emby button and its show-list OK key ask for playback as well as
  // the show page; every other caller just opens the page.
  const play = req.query.play === "1";
  const seq = ++viewShowSeq;
  unilog(
    401,
    `viewshow from ${client(req)} showId=${showId} showName=${showName} play=${play} braviaHaPower=${braviaHaPower}`,
  );
  pendingViewShow = { showId, showName, episodeId, play, at: Date.now() };
  callService("media_player", "turn_on", BRAVIA_ENTITY_ID);
  res.json({ ok: true });

  if (braviaHaPower !== "on") {
    pendingGoogleHome = true;
    unilog(
      402,
      `viewshow: TV not on (${braviaHaPower}), set pendingGoogleHome=true`,
    );
    return;
  }
  // Bring Emby to the front. When Emby is already the foreground app this does
  // nothing at all — no flash — so it is safe to send every time. No Home key:
  // that is what used to make Emby blink out and reload.
  const activityBefore = await embyTvLastActivity();
  callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
    media_content_type: "app",
    media_content_id: EMBY_APP_URI,
  });
  await sleep(EMBY_LAUNCH_DELAY_MS);

  // Emby's session keeps accepting shows with a 204 even while its ui is
  // restarting (the android process stays alive in the background), so the
  // send itself cannot tell us whether Emby is ready. Its api calls can: a
  // restarting ui talks to the server, an already-open one sits silent.
  const starting = (await embyTvLastActivity()) !== activityBefore;
  if (!starting) {
    await firePendingViewShow("viewshow(open)");
    return;
  }
  // Emby is starting up. It silently drops anything sent while it boots and
  // gives no honest ready signal, so resend the show every couple seconds:
  // boot-time sends are dropped, the first send after the ui is up loads the
  // show, and later resends just re-open the same page.
  const deadline = Date.now() + VIEW_SHOW_DELAY_MS;
  while (Date.now() < deadline) {
    await sleep(VIEW_SHOW_RESEND_MS);
    if (seq !== viewShowSeq) return; // a newer press owns the tv now
    pendingViewShow = { showId, showName, episodeId, play, at: Date.now() };
    await firePendingViewShow("viewshow(booting)");
  }
});

// Toggle the playing/selected episode between its 2160 and 1080 versions, then
// reload it in Emby. Sequence: Home → swap files + library refresh (await) →
// relaunch Emby → load episode. Body: { relPath } from the web local pane, or
// empty from the Android remote (uses the Living Room TV now-playing episode).
app.post("/tv/toggleres", async (req, res) => {
  try {
    const body = req.body ?? {};
    const toggleArg = {};
    let knownEpisodeId = null;
    if (body.relPath) {
      toggleArg.relPath = body.relPath;
    } else {
      const session = await getEmbyPlaybackSession();
      const item = session?.NowPlayingItem;
      if (!item) {
        unilog(1115, `nothing playing on either TV`);
        return res.json({ ok: false, error: "nothing playing" });
      }
      knownEpisodeId = item.Id;
      toggleArg.episodeId = item.Id;
      toggleArg.showName = item.SeriesName;
      toggleArg.season = item.ParentIndexNumber;
      toggleArg.episode = item.IndexNumber;
    }
    unilog(1116, `from ${client(req)} ${JSON.stringify(toggleArg)}`);
    res.json({ ok: true });
    runToggleResSequence(toggleArg, knownEpisodeId);
  } catch (e) {
    unilog(1117, `error: ${e.message}`);
    if (!res.headersSent) res.json({ ok: false, error: e.message });
  }
});

// Home → swap files + await library refresh → relaunch Emby → load episode.
async function runToggleResSequence(toggleArg, knownEpisodeId) {
  try {
    // Stop any live Emby playback session before renaming the file. When a
    // video is actively playing (the Android skip long-press path), Emby keeps
    // a server-side PlayState bound to the current MediaSource; renaming that
    // file out from under it leaves the session stale, so the next OK/play just
    // flashes and bounces back to the play button in an unbreakable loop. A real
    // Stop clears that state. (The web res-button path is used from a stopped
    // state, so there is usually nothing to stop.)
    try {
      const live = await getEmbyPlaybackSession();
      if (live?.Id) {
        await fetch(
          `${EMBY_BASE_URL}/Sessions/${live.ControlSessionId}/Playing/Stop?api_key=${EMBY_API_KEY}`,
          { method: "POST", headers: { Accept: "application/json" } },
        );
      }
    } catch (e) {
      unilog(1120, `stop live session failed: ${e.message}`);
    }
    callService("remote", "send_command", REMOTE_ENTITY_ID, {
      command: "Home",
    });
    const toggleResp = await fetch(
      `${SRVR_INTERNAL_URL}/api/toggleResolution`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toggleArg),
      },
    );
    const result = await toggleResp.json();
    unilog(1118, `toggle result=${JSON.stringify(result)}`);
    if (!result?.ok) return;
    pendingViewShow = {
      showId: result.showId,
      showName: result.showName,
      episodeId: result.episodeId || knownEpisodeId || null,
      at: Date.now(),
    };
    callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
      media_content_type: "app",
      media_content_id: EMBY_APP_URI,
    });
    setTimeout(() => firePendingViewShow("toggleres"), VIEW_SHOW_DELAY_MS);
  } catch (e) {
    unilog(1119, `sequence error: ${e.message}`);
  }
}

// ─── Persistent adb shell ────────────────────────────────────────────────────
let fireShell = null;
let fireShellReady = false;
let fireShellStdoutBuf = "";
let fireShellPending = null; // { marker, resolve } — at most one in-flight
let fireShellUnauthorized = false; // stop fast-retry loop when device hasn't authorized

function spawnFireShell() {
  if (fireShell) {
    fireShell.removeAllListeners();
    fireShell.stdin.destroy();
    fireShell.kill();
  }
  fireShellReady = false;
  fireShellUnauthorized = false;
  fireShell = spawn("adb", ["-s", `${FIRE_TV_IP}:5555`, "shell"]);
  fireShellStdoutBuf = "";
  let fireShellStderrBuf = "";
  fireShell.stdout.on("data", (chunk) => {
    fireShellStdoutBuf += chunk.toString();
    if (
      fireShellPending &&
      fireShellStdoutBuf.includes(fireShellPending.marker)
    ) {
      const { resolve } = fireShellPending;
      fireShellPending = null;
      fireShellStdoutBuf = "";
      resolve();
    }
  });
  fireShell.stderr.on("data", (chunk) => {
    fireShellStderrBuf += chunk.toString();
    if (fireShellStderrBuf.includes("unauthorized")) {
      fireShellUnauthorized = true;
    }
  });
  fireShell.on("spawn", () => {
    unilog(403, "adb shell spawned");
    fireShellReady = true;
  });
  fireShell.on("error", (err) => {
    unilog(404, `adb shell error: ${err.message}`);
    fireShellReady = false;
  });
  fireShell.on("close", (code) => {
    fireShellReady = false;
    fireShell = null;
    if (fireShellUnauthorized) {
      unilog(
        405,
        `adb shell closed (${code}) — device unauthorized, NOT retrying (accept USB debug dialog on FireTV then restart tv-tv)`,
      );
    } else {
      unilog(1744, `adb shell closed (${code}), reconnecting in 2s`);
      setTimeout(connectFireShell, 2000);
    }
  });
}

function connectFireShell() {
  exec(`adb connect ${FIRE_TV_IP}:5555`, (err, stdout) => {
    if (err) {
      unilog(1745, `adb connect failed: ${err.message}, retrying in 5s`);
      setTimeout(connectFireShell, 5000);
    } else {
      unilog(408, `adb connect: ${stdout.trim()}`);
      spawnFireShell();
    }
  });
}

let fireKeySeq = 0;
let fireKeyChain = Promise.resolve();

function fireKeyeventOnce(keycode) {
  return new Promise((resolve, reject) => {
    if (!fireShellReady || !fireShell) {
      reject(new Error("fire shell not ready"));
      return;
    }
    const marker = `__K${++fireKeySeq}__`;
    const clearPending = () => {
      if (fireShellPending && fireShellPending.marker === marker) {
        fireShellPending = null;
      }
    };

    // The device can stop echoing markers while staying connected (e.g. waking
    // up, or launching an app), and that leaves the shell alive so 'close'
    // never fires. Without this the request would hang forever.
    const timer = setTimeout(() => {
      clearPending();
      unilog(
        1424,
        `adb shell did not echo ${marker} within ${FIRE_KEY_TIMEOUT_MS}ms — respawning shell`,
      );
      fireShellReady = false;
      spawnFireShell();
      reject(new Error("fire shell timeout"));
    }, FIRE_KEY_TIMEOUT_MS);

    fireShellPending = {
      marker,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
    };
    fireShell.stdin.write(
      `input keyevent ${keycode} && echo ${marker}\n`,
      (err) => {
        if (err) {
          clearTimeout(timer);
          clearPending();
          reject(err);
        }
      },
    );
  });
}

// The shell tracks one marker at a time, so overlapping presses must be
// serialized — otherwise a later press overwrites fireShellPending and the
// earlier promise is never settled, hanging that request until nginx gives up.
function fireKeyevent(keycode) {
  const run = fireKeyChain.then(
    () => fireKeyeventOnce(keycode),
    () => fireKeyeventOnce(keycode),
  );
  fireKeyChain = run.catch(() => {});
  return run;
}

function adbExecP(cmd, label) {
  return new Promise((resolve) => {
    exec(`adb -s ${FIRE_TV_IP}:5555 ${cmd}`, (err, stdout, stderr) => {
      if (err && stderr && stderr.includes("not found")) {
        unilog(409, `adb ${label}: device not found, connecting...`);
        exec(`adb connect ${FIRE_TV_IP}:5555`, () => {
          exec(`adb -s ${FIRE_TV_IP}:5555 ${cmd}`, (err2) => {
            if (err2)
              unilog(410, `adb ${label} error after connect: ${err2.message}`);
            else unilog(411, `adb ${label} ok (after connect)`);
            resolve();
          });
        });
      } else if (err) {
        unilog(412, `adb ${label} error: ${err.message}`);
        resolve();
      } else {
        unilog(413, `adb ${label} ok`);
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
// DISABLED: Bravia ADB not needed for normal operation. Re-enable by uncommenting
// all sections marked with "Bravia ADB disabled" / "see startup block above".
// let braviaShell = null;
// let braviaShellReady = false;
// let braviaShellStdoutBuf = "";
// let braviaShellPending = null;
// let braviaKeySeq = 0;
// let braviaShellUnauthorized = false;
// let braviaAdbBackoff = 2000; // ms, doubles on each failure up to max
// const BRAVIA_ADB_BACKOFF_MAX = 120000; // 2 minutes
// let braviaAdbEnabled = false; // only attempt when HA says TV is on
// let braviaAdbConnecting = false; // guard against concurrent connect attempts

// function spawnBraviaShell() {
//   if (braviaShell) {
//     braviaShell.removeAllListeners();
//     braviaShell.stdin.destroy();
//     braviaShell.kill();
//   }
//   braviaShellReady = false;
//   braviaShellUnauthorized = false;
//   braviaShell = spawn("adb", ["-s", BRAVIA_TV_IP, "shell"]);
//   braviaShellStdoutBuf = "";
//   let braviaShellStderrBuf = "";
//   braviaShell.stdout.on("data", (chunk) => {
//     braviaShellStdoutBuf += chunk.toString();
//     if (
//       braviaShellPending &&
//       braviaShellStdoutBuf.includes(braviaShellPending.marker)
//     ) {
//       const { resolve } = braviaShellPending;
//       braviaShellPending = null;
//       resolve();
//     }
//   });
//   braviaShell.stderr.on("data", (chunk) => {
//     braviaShellStderrBuf += chunk.toString();
//     if (braviaShellStderrBuf.includes("unauthorized")) {
//       braviaShellUnauthorized = true;
//     }
//   });
//   braviaShell.on("spawn", () => {
//     adbLog("adb shell spawned");
//     braviaShellReady = true;
//   });
//   braviaShell.on("error", (err) => {
//     adbLog(`adb shell error: ${err.message}`);
//     braviaShellReady = false;
//   });
//   braviaShell.on("close", (code) => {
//     braviaShellReady = false;
//     braviaShell = null;
//     if (braviaShellUnauthorized) {
//       const msg = `adb shell closed (${code}) — device unauthorized, NOT retrying`;
//       adbLog(msg);
//       log(`[bravia] ${msg}`);
//     } else {
//       if (braviaAdbEnabled) {
//         adbLog(
//           `adb shell closed (${code}), reconnecting in ${braviaAdbBackoff / 1000}s...`,
//         );
//         setTimeout(connectBraviaShell, braviaAdbBackoff);
//         braviaAdbBackoff = Math.min(
//           braviaAdbBackoff * 2,
//           BRAVIA_ADB_BACKOFF_MAX,
//         );
//       } else {
//         adbLog(`adb shell closed (${code}), TV is off — not retrying`);
//       }
//     }
//   });
// }
//
// function connectBraviaShell() {
//   if (!braviaAdbEnabled) return;
//   if (braviaAdbConnecting) {
//     adbLog("connect already in progress, skipping");
//     return;
//   }
//   braviaAdbConnecting = true;
//   adbLog("Attempting to connect to Bravia shell...");
//   exec(`adb connect ${BRAVIA_TV_IP}`, (err, stdout, stderr) => {
//     braviaAdbConnecting = false;
//     if (!braviaAdbEnabled) return;
//     const out = stdout.trim();
//     const failed =
//       err ||
//       out.includes("failed") ||
//       out.includes("refused") ||
//       out.includes("unable to connect");
//     if (failed) {
//       const reason = err ? err.message : out;
//       adbLog(
//         `adb connect failed: ${reason}, retrying in ${braviaAdbBackoff / 1000}s...`,
//       );
//       setTimeout(connectBraviaShell, braviaAdbBackoff);
//       braviaAdbBackoff = Math.min(braviaAdbBackoff * 2, BRAVIA_ADB_BACKOFF_MAX);
//     } else {
//       adbLog(`adb connect ok: ${out}`);
//       if (out) log(`[bravia] adb connect: ${out}`);
//       braviaAdbBackoff = 2000; // reset on success
//       spawnBraviaShell();
//     }
//   });
// }
//
// function braviaShellCmd(cmd) {
//   return new Promise((resolve, reject) => {
//     if (!braviaShellReady || !braviaShell) {
//       adbLog(`cmd skipped (shell not ready): ${cmd}`);
//       reject(new Error("bravia shell not ready"));
//       return;
//     }
//     adbLog(`cmd: ${cmd}`);
//     const marker = `__B${++braviaKeySeq}__`;
//     braviaShellPending = { marker, resolve };
//     braviaShell.stdin.write(`${cmd} && echo ${marker}\n`, (err) => {
//       if (err) {
//         adbLog(`cmd write error: ${err.message}`);
//         braviaShellPending = null;
//         reject(err);
//       }
//     });
//   });
// }

// ADB connect is disabled — not needed for normal operation.
// Routes below (/tv/keyevent and /tv/text) are also disabled.
// To re-enable: uncomment the variables, functions, and trigger blocks above,
// then uncomment these routes.

// app.get("/tv/keyevent/:code", async (req, res) => {
//   if (tvMode !== "google" && tvMode !== "tv") {
//     log(`keyevent ignored — tvMode=${tvMode}`);
//     res.json({ ok: false, error: "wrong mode" });
//     return;
//   }
//   const code = req.params.code;
//   if (!/^[A-Z0-9_]+$/.test(code)) {
//     res.status(400).json({ ok: false, error: "invalid keycode" });
//     return;
//   }
//   try {
//     await braviaShellCmd(`input keyevent ${code}`);
//     log(`[bravia] keyevent ${code} from ${client(req)}`);
//     res.json({ ok: true });
//   } catch (err) {
//     loge(`[bravia] keyevent failed: ${err.message}`);
//     res.json({ ok: false, error: err.message });
//   }
// });
//
// app.get("/tv/text", async (req, res) => {
//   const text = req.query.t;
//   if (!text) {
//     res.status(400).json({ ok: false, error: "missing t" });
//     return;
//   }
//   if (tvMode !== "google" && tvMode !== "tv") {
//     log(`text ignored — tvMode=${tvMode}`);
//     res.json({ ok: false, error: "wrong mode" });
//     return;
//   }
//   // Escape text for shell: wrap in single quotes, escape single quotes
//   const escaped = text.replace(/'/g, "'\\''");
//   try {
//     await braviaShellCmd(`input text '${escaped}'`);
//     log(`[bravia] text '${text}' from ${client(req)}`);
//     res.json({ ok: true });
//   } catch (err) {
//     loge(`[bravia] text failed: ${err.message}`);
//     res.json({ ok: false, error: err.message });
//   }
// });

app.get("/tv/firebtn", (req, res) => {
  unilog(414, `firebtn from ${client(req)} braviaHaPower=${braviaHaPower}`);
  callService("media_player", "turn_on", FIRE_TV_ENTITY_ID);
  if (braviaHaPower !== "on") {
    // TV display is off — turn it on and wait for FireTV CEC before launching Emby
    callService("media_player", "turn_on", BRAVIA_ENTITY_ID);
    pendingFireEmby = true;
    unilog(
      415,
      "firebtn: TV off — turning on Bravia, set pendingFireEmby=true",
    );
  } else {
    // TV already on — send home and launch Emby with fixed delays
    setTimeout(
      () => adbExec("shell input keyevent 3", "home"),
      FIRE_HOME_DELAY_MS,
    );
    setTimeout(
      () => adbExec(`shell am start -n ${EMBY_FIRE_ACTIVITY}`, "emby launch"),
      FIRE_EMBY_DELAY_MS,
    );
  }
  res.json({ ok: true });
});

app.get("/tv/on", (req, res) => {
  unilog(416, `on from ${client(req)}`);
  callService("media_player", "turn_on", BRAVIA_ENTITY_ID);
  res.json({ ok: true });
});

app.get("/tv/mode/:mode", (req, res) => {
  const mode = req.params.mode;
  if (mode !== "google" && mode !== "fire") {
    res.status(400).json({ ok: false, error: "unknown mode" });
    return;
  }
  unilog(417, `mode set to ${mode} from ${client(req)} (legacy route)`);
  if (mode === "fire") {
    callService("media_player", "turn_on", FIRE_TV_ENTITY_ID);
    setTimeout(
      () => adbExec(`shell am start -n ${EMBY_FIRE_ACTIVITY}`, "emby launch"),
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
          media_content_id: EMBY_APP_URI,
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
    adbExec(`shell am start -n ${EMBY_FIRE_ACTIVITY}`, "emby");
  } else if (tvMode === "google") {
    callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
      media_content_type: "app",
      media_content_id: EMBY_APP_URI,
    });
  } else {
    unilog(418, `emby ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  res.json({ ok: true });
});

app.get("/tv/off", (req, res) => {
  unilog(419, `off from ${client(req)} (mode: ${tvMode})`);
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

app.get("/tv/key/:key", async (req, res) => {
  const keyMap = tvMode === "fire" ? FIRE_KEY_MAP : GOOGLE_KEY_MAP;
  const remoteId = REMOTE_ENTITY_ID;
  const command = keyMap[req.params.key];
  if (!command) {
    res.status(400).json({ ok: false, error: "unknown key" });
    return;
  }

  if (tvMode !== "fire" && tvMode !== "google" && tvMode !== "tv") {
    unilog(420, `key ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }

  if (tvMode === "fire") {
    const n = Math.min(parseInt(req.query.n) || 1, 20);
    const keys = Array(n).fill(command).join(" ");
    let sentViaShell = false;
    if (fireShellReady) {
      try {
        await fireKeyevent(keys);
        unilog(421, `keyevent ${command}×${n} via shell from ${client(req)}`);
        sentViaShell = true;
      } catch (e) {
        unilog(
          1425,
          `shell keyevent ${keys} failed (${e.message}) — falling back to adb exec`,
        );
      }
    }
    if (!sentViaShell) {
      await adbExecP(`shell input keyevent ${keys}`, `keyevent ${keys}`);
      unilog(422, `adb keyevent ${keys} from ${client(req)}`);
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
  unilog(
    423,
    `key=${req.params.key} command=${command} mode=${tvMode} entity=${remoteId} isArrow=${isArrow} haCmd=${JSON.stringify(cmd)}`,
  );
  if (isArrow) {
    cmd.id = ++cmdId;
    if (ws) ws.send(JSON.stringify(cmd));
  } else {
    sendCmd(cmd);
  }
  unilog(424, `remote.send_command ${command} from ${client(req)}`);
  res.json({ ok: true, command, mode: tvMode });
});

// ─── Automatic show selection ───────────────────────────────────────────────
// Walks the Emby home screen to the show most likely wanted next: the most
// recently played show from before today. That row is ordered most-recent-first
// from the left, so the prefix sequence parks focus on the leftmost show and a
// run of right keys counts over to the target.

const SHOW_SEL_PREFIX_SLOW = ["back", "down", "down", "left", "down"];
const SHOW_SEL_PREFIX_LEFTS = 6; // sent fast — walks off the left end of the row
const SHOW_SEL_PREFIX_TAIL = ["right"];

let showSelRunning = false;

// One key through whichever transport the current tvMode uses, then wait.
async function sendSelKey(key, delayAfterMs) {
  if (tvMode !== "fire") {
    await sendIrcc(GOOGLE_KEY_MAP[key], delayAfterMs);
    return;
  }
  const code = FIRE_KEY_MAP[key];
  let sent = false;
  if (fireShellReady) {
    try {
      await fireKeyevent(code);
      sent = true;
    } catch (e) {
      unilog(
        1605,
        `shell keyevent ${key} failed (${e.message}) — falling back to adb exec`,
      );
    }
  }
  if (!sent) await adbExecP(`shell input keyevent ${code}`, `showsel ${key}`);
  await sleep(delayAfterMs);
}

// Shows ranked by when they were last played, most recent first. Emby keeps
// LastPlayedDate on episodes only — Series items always return null — so rank
// episodes and keep each show's newest.
async function showsByLastPlayed() {
  const url =
    `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items` +
    `?IncludeItemTypes=Episode&Recursive=true` +
    `&SortBy=DatePlayed&SortOrder=Descending&Limit=${SHOW_SEL_EPISODE_SCAN}` +
    `&Fields=UserDataLastPlayedDate,SeriesName&api_key=${EMBY_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`emby items ${r.status}`);
  const items = (await r.json()).Items ?? [];
  const newest = new Map();
  for (const it of items) {
    const played = it?.UserData?.LastPlayedDate;
    const show = it?.SeriesName;
    if (!played || !show) continue;
    if (!newest.has(show) || played > newest.get(show))
      newest.set(show, played);
  }
  return [...newest.entries()]
    .map(([name, played]) => ({ name, played }))
    .sort((a, b) => b.played.localeCompare(a.played));
}

// "YYYY-MM-DD" in SHOW_SEL_TZ, so comparing days is a plain string compare.
function showSelDay(when) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOW_SEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(when));
}

// The most recently played show from before today, and its offset from the
// leftmost (most recently played) show in the row.
async function findShowToSelect() {
  const shows = await showsByLastPlayed();
  const today = showSelDay(Date.now());
  const offset = shows.findIndex((s) => showSelDay(s.played) < today);
  if (offset === -1) return null;
  return { ...shows[offset], offset };
}

async function runShowSelect(offset) {
  for (const key of SHOW_SEL_PREFIX_SLOW) {
    await sendSelKey(key, SHOW_SEL_KEY_DELAY);
  }
  for (let i = 0; i < SHOW_SEL_PREFIX_LEFTS; i++) {
    await sendSelKey("left", SHOW_SEL_KEY_FAST_DELAY);
  }
  for (const key of SHOW_SEL_PREFIX_TAIL) {
    await sendSelKey(key, SHOW_SEL_KEY_DELAY);
  }
  for (let i = 0; i < offset; i++) {
    await sendSelKey("right", SHOW_SEL_KEY_FAST_DELAY);
  }
}

// ?offset=N forces the right-key count (skips the Emby lookup); ?dry reports
// the target and sends no keys. Both are for ./sel testing.
app.get("/tv/selectshow", async (req, res) => {
  if (tvMode !== "fire" && tvMode !== "google" && tvMode !== "tv") {
    unilog(1606, `select ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  if (showSelRunning) {
    unilog(1607, `select already running`);
    res.json({ ok: false, error: "already running" });
    return;
  }

  let target;
  if (req.query.offset !== undefined) {
    target = {
      name: "(forced)",
      played: null,
      offset: Number(req.query.offset),
    };
  } else {
    try {
      target = await findShowToSelect();
    } catch (e) {
      unilog(1608, `emby lookup failed: ${e.message}`);
      res.json({ ok: false, error: e.message });
      return;
    }
  }
  if (!target || !Number.isInteger(target.offset) || target.offset < 0) {
    unilog(1609, `no show played before today — nothing to select`);
    res.json({ ok: false, error: "no target show" });
    return;
  }

  const keyCount =
    SHOW_SEL_PREFIX_SLOW.length +
    SHOW_SEL_PREFIX_LEFTS +
    SHOW_SEL_PREFIX_TAIL.length +
    target.offset;
  unilog(
    1610,
    `selecting ${target.name} offset=${target.offset} keys=${keyCount} mode=${tvMode} from ${client(req)}`,
  );

  if (req.query.dry !== undefined) {
    res.json({ ok: true, dry: true, ...target, keyCount });
    return;
  }

  // Answer before driving the keys — the sequence outlasts a sane HTTP wait.
  res.json({ ok: true, ...target, keyCount });

  showSelRunning = true;
  try {
    await runShowSelect(target.offset);
    unilog(1611, `done selecting ${target.name}`);
  } catch (e) {
    unilog(1612, `key sequence failed for ${target.name}: ${e.message}`);
  } finally {
    showSelRunning = false;
  }
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
    unilog(425, `vol ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  // Nothing here has to undo a mute: the set does that itself on any volume
  // command. Branching on braviaHaMuted would not work anyway — see
  // BRAVIA_AUDIO_URL for why it is stuck at false.
  callService("remote", "send_command", REMOTE_ENTITY_ID, {
    command: dir === "up" ? "VolumeUp" : "VolumeDown",
  });
  unilog(426, `vol ${dir} sent from ${client(req)}`);
  res.json({ ok: true });
});

app.get("/tv/mute", (req, res) => {
  if (tvMode !== "google" && tvMode !== "fire" && tvMode !== "tv") {
    unilog(427, `mute ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  callService("remote", "send_command", REMOTE_ENTITY_ID, { command: "Mute" });
  unilog(428, `mute sent from ${client(req)}`);
  res.json({ ok: true });
});

// Asked by tvapp every time a trailer starts, so a mute left over from
// dragging (or anything else) never carries silently into the next one.
// Straight to the set rather than through HA: this states the mute it wants
// instead of toggling, so the result is the same whatever the set was doing,
// and there is no readable mute state to branch on anyway — see
// BRAVIA_AUDIO_URL.
app.get("/tv/unmute", async (req, res) => {
  if (tvMode !== "google" && tvMode !== "fire" && tvMode !== "tv") {
    unilog(1868, `unmute ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
    return;
  }
  try {
    const resp = await fetch(BRAVIA_AUDIO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-PSK": BRAVIA_PSK },
      body: JSON.stringify({
        method: "setAudioMute",
        version: "1.0",
        id: 1,
        params: [{ status: false }],
      }),
    });
    const body = await resp.json();
    if (body.error) {
      unilog(1869, `unmute refused: ${JSON.stringify(body.error)}`);
      res.json({ ok: false, error: "tv refused" });
      return;
    }
    unilog(1870, `unmute sent from ${client(req)}`);
    res.json({ ok: true });
  } catch (e) {
    unilog(1871, `unmute failed: ${e.message}`);
    res.json({ ok: false, error: e.message });
  }
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
      mode: tvMode,
      activeDevice,
      state: braviaHaPower,
      mediaContentType: braviaMediaContentType,
      mediaTitle: braviaMediaTitle,
    }),
  }).catch(() => {});
}

app.get("/tv/openapp", (req, res) => {
  const uri = req.query.uri;
  if (!uri) {
    res.status(400).json({ ok: false, error: "missing uri" });
    return;
  }
  if (tvMode === "google") {
    unilog(429, `openapp google uri=${uri} from ${client(req)}`);
    callService("media_player", "play_media", BRAVIA_ENTITY_ID, {
      media_content_type: "app",
      media_content_id: uri,
    });
    res.json({ ok: true });
  } else if (tvMode === "fire") {
    unilog(430, `openapp fire uri=${uri} from ${client(req)}`);
    adbExecP(`shell am start -n ${uri}`, "openapp");
    res.json({ ok: true });
  } else {
    unilog(431, `openapp ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
  }
});

app.get("/tv/playvideo", (req, res) => {
  const url = req.query.url;
  if (!url) {
    res.status(400).json({ ok: false, error: "missing url" });
    return;
  }
  if (tvMode === "google") {
    unilog(432, `playvideo google url=${url} from ${client(req)}`);
    // Extract YouTube video ID from URL
    const ytMatch = url.match(/[?&]v=([^&]+)/);
    let cmd;
    if (ytMatch) {
      const videoId = ytMatch[1];
      unilog(433, `playvideo launching YouTube video ${videoId} via adb`);
      // Use adb to send intent directly to YouTube app
      cmd = `adb -s ${BRAVIA_TV_IP} shell am start -a android.intent.action.VIEW -d "https://www.youtube.com/watch?v=${videoId}" com.google.android.youtube.tv`;
    } else {
      unilog(434, `playvideo: non-YouTube URL, launching in VLC`);
      // For IMDB or other video URLs, open in VLC
      // Use single quotes in the shell to prevent & interpretation
      cmd = `adb -s ${BRAVIA_TV_IP} shell "am start -a android.intent.action.VIEW -d '${url}' -t 'video/*' org.videolan.vlc"`;
    }
    unilog(435, `playvideo cmd: ${cmd}`);
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        unilog(436, `playvideo adb error: ${err.message}`);
      }
      if (stderr) unilog(437, `playvideo adb stderr: ${stderr}`);
      if (stdout) unilog(438, `playvideo adb stdout: ${stdout}`);
    });
    res.json({ ok: true });
  } else if (tvMode === "fire") {
    unilog(439, `playvideo fire url=${url} from ${client(req)}`);
    adbExecP(
      `shell am start -a android.intent.action.VIEW -d "${url}"`,
      "playvideo",
    );
    res.json({ ok: true });
  } else {
    unilog(440, `playvideo ignored — tvMode=${tvMode}`);
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

// ─── Scrub control ───────────────────────────────────────────────────────────

function stopScrub() {
  if (scrubInterval) {
    clearInterval(scrubInterval);
    scrubInterval = null;
  }
  if (scrubDeadmanTimer) {
    clearTimeout(scrubDeadmanTimer);
    scrubDeadmanTimer = null;
  }
  scrubDirection = null;
  scrubKeyCount = 0;
}

function startScrubDeadman() {
  if (scrubDeadmanTimer) clearTimeout(scrubDeadmanTimer);
  scrubDeadmanTimer = setTimeout(() => {
    unilog(441, "scrub dead-man timeout — stopping scrub");
    stopScrub();
  }, SCRUB_DEADMAN_TIMEOUT);
}

app.post("/tv/scrub/start", (req, res) => {
  const { direction } = req.body ?? {};
  if (direction !== "left" && direction !== "right") {
    res.status(400).json({ ok: false, error: "invalid direction" });
    return;
  }
  unilog(442, `scrub start direction=${direction} from ${client(req)}`);
  stopScrub();
  scrubDirection = direction;
  scrubKeyCount = 0;
  const command = direction === "right" ? "Right" : "Left";

  const sendKey = () => {
    scrubKeyCount++;
    callService("remote", "send_command", REMOTE_ENTITY_ID, { command });

    // Adjust interval after SCRUB_START_COUNT keys
    if (scrubKeyCount === SCRUB_START_COUNT) {
      clearInterval(scrubInterval);
      const fastRate =
        direction === "right" ? SCRUB_RATE_FWD_FAST : SCRUB_RATE_REV_FAST;
      scrubInterval = setInterval(sendKey, fastRate);
    }
  };

  // Send first key immediately
  sendKey();
  // Start interval for subsequent keys with slow rate
  const slowRate =
    direction === "right" ? SCRUB_RATE_FWD_SLOW : SCRUB_RATE_REV_SLOW;
  scrubInterval = setInterval(sendKey, slowRate);
  startScrubDeadman();
  res.json({ ok: true });
});

app.post("/tv/scrub/ping", (req, res) => {
  if (!scrubDirection) {
    res.json({ ok: false, error: "not scrubbing" });
    return;
  }
  startScrubDeadman();
  res.json({ ok: true });
});

app.post("/tv/scrub/stop", (req, res) => {
  unilog(443, `scrub stop from ${client(req)}`);
  stopScrub();
  res.json({ ok: true });
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
  const isForced = !isPgs && !!stream.IsForced;
  const isSdh =
    !isPgs &&
    !isForced &&
    (!!stream.IsHearingImpaired || /\bsdh\b/i.test(stream.Title || ""));
  const type = isPgs ? "pgs" : isForced ? "forced" : isSdh ? "sdh" : "embedded";
  // DisplayTitle already includes codec like "English (ASS)" — use it directly
  const label =
    stream.DisplayTitle || `${stream.Language || "Unknown"} (${codec})`;
  return { name: stream.Language || "Unknown", type, label };
}

// Cache for /tv/emby/playing — avoids hammering Emby Sessions API on every poll
let playingCache = { ts: 0, data: null };
const PLAYING_CACHE_TTL = 3000; // ms

const getEmbyPlayingPayload = async () => {
  const now = Date.now();
  if (playingCache.data && now - playingCache.ts < PLAYING_CACHE_TTL) {
    return playingCache.data;
  }
  try {
    const sessRes = await fetch(
      `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!sessRes.ok) {
      return { ok: false, error: `sessions ${sessRes.status}` };
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

      let chosenSubIndex = null;
      if (episodeCode) {
        try {
          const prefRes = await fetch(
            `${SRVR_INTERNAL_URL}/internal/chksrt/preferred?showName=${encodeURIComponent(showName)}&episodeCode=${encodeURIComponent(episodeCode)}`,
          );
          if (prefRes.ok) {
            const pref = await prefRes.json();
            if (pref) {
              if (pref.embStreamIndex != null) {
                const found = (streams ?? []).find(
                  (s) =>
                    s.Type === "Subtitle" && s.Index === pref.embStreamIndex,
                );
                if (found) chosenSubIndex = found.Index;
              } else if (pref.srtFile) {
                const found = (streams ?? []).find(
                  (s) =>
                    s.Type === "Subtitle" &&
                    s.IsExternal &&
                    s.Path &&
                    s.Path.endsWith("/" + pref.srtFile),
                );
                if (found) chosenSubIndex = found.Index;
              }
            }
          }
        } catch (_) {}
      }

      playing.push({
        sessionId,
        deviceName,
        showName,
        episodeCode,
        subtitleStreamIndex,
        subtitles,
        chosenSubIndex,
      });
    }
    const result = { ok: true, playing };
    playingCache = { ts: Date.now(), data: result };
    return result;
  } catch (err) {
    unilog(444, "emby/playing error:", err.message);
    return { ok: false, error: err.message };
  }
};

app.get("/tv/emby/playing", async (req, res) => {
  res.json(await getEmbyPlayingPayload());
});

app.get("/tv/emby/position", async (req, res) => {
  try {
    const session = await getEmbyPlaybackSession();
    if (!session) {
      res.json({ ok: false, reason: "notPlaying" });
      return;
    }
    res.json({
      ok: true,
      ticks: session.PlayState?.PositionTicks ?? 0,
      paused: !!session.PlayState?.IsPaused,
    });
  } catch (err) {
    unilog(445, "emby/position error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

async function getEmbyPlaybackSession(deviceName = null) {
  const sessRes = await fetch(
    `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
    {
      headers: { Accept: "application/json" },
    },
  );
  if (!sessRes.ok) {
    const error = new Error(`sessions ${sessRes.status}`);
    error.status = sessRes.status;
    throw error;
  }
  const sessions = await sessRes.json();
  const matches = sessions.filter(
    (s) =>
      s.NowPlayingItem &&
      (deviceName
        ? s.DeviceName === deviceName
        : TV_DEVICE_NAMES.includes(s.DeviceName)),
  );
  const session = matches.find((s) => s.SupportsRemoteControl) ?? matches[0];
  if (!session) return null;
  // Commands (seek/pause/stop) must go to the device's remote-controllable
  // session. The Emby app reports playback on one session but only accepts
  // commands on a companion session with the same DeviceId, so always prefer a
  // same-DeviceId sibling; fall back to the playback session for single-session
  // devices.
  const sibling = sessions.find(
    (s) =>
      s.Id !== session.Id &&
      s.DeviceId === session.DeviceId &&
      s.SupportsRemoteControl,
  );
  session.ControlSessionId = sibling?.Id ?? session.Id;
  return session;
}

function seekEmbySession(sessionId, ticks) {
  return fetch(
    `${EMBY_BASE_URL}/Sessions/${sessionId}/Playing/seek?SeekPositionTicks=${ticks}&api_key=${EMBY_API_KEY}`,
    { method: "POST", headers: { Accept: "application/json" } },
  );
}

app.post("/tv/emby/seek", async (req, res) => {
  const { ticks } = req.body ?? {};
  if (ticks === undefined || ticks === null) {
    res.status(400).json({ ok: false, error: "missing ticks" });
    return;
  }
  try {
    const session = await getEmbyPlaybackSession();
    if (!session) {
      res.json({ ok: false, reason: "notPlaying" });
      return;
    }
    if (session.PlayState?.IsPaused) {
      res.json({ ok: false, reason: "paused" });
      return;
    }
    const seekRes = await seekEmbySession(session.ControlSessionId, ticks);
    res.json({ ok: seekRes.ok, reason: seekRes.ok ? undefined : "seekFailed" });
  } catch (err) {
    unilog(446, "emby/seek error:", err.message);
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
    const session = await getEmbyPlaybackSession();
    if (!session) {
      res.json({ ok: false, reason: "notPlaying" });
      return;
    }
    const id = session.ControlSessionId;
    await fetch(
      `${EMBY_BASE_URL}/Sessions/${id}/Playing/Pause?api_key=${EMBY_API_KEY}`,
      { method: "POST" },
    );
    const seekRes = await seekEmbySession(id, ticks);
    await fetch(
      `${EMBY_BASE_URL}/Sessions/${id}/Playing/Pause?api_key=${EMBY_API_KEY}`,
      { method: "POST" },
    );
    await new Promise((r) => {
      setTimeout(r, d3ms);
    });
    res.json({ ok: seekRes.ok });
  } catch (err) {
    unilog(447, "emby/seek error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.post("/tv/emby/subtitle", async (req, res) => {
  const { sessionId, index } = req.body ?? {};
  if (!sessionId || index === undefined) {
    res.status(400).json({ ok: false, error: "missing sessionId or index" });
    return;
  }

  // List position: None = 0, then each subtitle in stream order (+1 per track).
  let oldIndex;
  let targetIndex;
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

    const subStreams = streams.filter((s) => s.Type === "Subtitle");
    const listPosition = (subIndex) => {
      if (subIndex === -1) return 0;
      const pos = subStreams.findIndex((s) => s.Index === subIndex);
      return pos === -1 ? -1 : pos + 1;
    };

    const currentSubIndex = session.PlayState?.SubtitleStreamIndex ?? -1;
    oldIndex = listPosition(currentSubIndex);
    targetIndex = listPosition(index);
    if (oldIndex === -1 || targetIndex === -1) {
      res.json({ ok: false, error: "subtitle index not found in list" });
      return;
    }
  } catch (err) {
    unilog(448, "emby/subtitle lookup error:", err.message);
    res.json({ ok: false, error: err.message });
    return;
  }

  const count = Math.abs(targetIndex - oldIndex);
  unilog(
    449,
    `subtitle nav: index=${index} oldIndex=${oldIndex} targetIndex=${targetIndex} count=${count}`,
  );

  if (count === 0) {
    res.json({ ok: true, waitMs: 0, navMs: 0 });
    return;
  }

  const navMs = (6 + count) * SUB_KEY_DELAY;
  const waitMs = navMs + SUB_NAV_POLL_MS;
  unilog(450, `subtitle nav waitMs=${waitMs}`);
  res.json({ ok: true, waitMs, navMs });

  const dir = targetIndex < oldIndex ? "Up" : "Down";
  await sendIrcc("Confirm", SUB_KEY_DELAY);
  await sendIrcc("Up", SUB_KEY_DELAY);
  await sendIrcc("Confirm", SUB_KEY_DELAY);
  for (let i = 0; i < count; i++) {
    await sendIrcc(dir, SUB_KEY_DELAY);
  }
  await sendIrcc("Confirm", SUB_KEY_DELAY);
  await sendIrcc("Down", SUB_KEY_DELAY);
  await sendIrcc("Confirm", SUB_KEY_DELAY);
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
    unilog(
      451,
      `SetSubtitleDelay ${offsetMs}ms session=${sessionId} -> ${r.status}`,
    );
    res.json({ ok: r.ok });
  } catch (err) {
    unilog(452, "emby/subtitle-offset error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// ─── Bravia picture quality settings ─────────────────────────────────────────

const getTvPicturePayload = async () => {
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
    return { ok: true, settings };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

app.get("/tv/picture", async (req, res) => {
  res.json(await getTvPicturePayload());
});

const snapshotJson = (value) => JSON.stringify(value ?? null);

const getTvPictureChannelSnapshot = async () => {
  const payload = await getTvPicturePayload();
  tvPictureChannelLastJson = snapshotJson(payload);
  return payload;
};

const getEmbyPlayingChannelSnapshot = async () => {
  const payload = await getEmbyPlayingPayload();
  embyPlayingChannelLastJson = snapshotJson(payload);
  return payload;
};

const publishTvPictureChannel = async () => {
  const payload = await getTvPicturePayload();
  const json = snapshotJson(payload);
  if (json === tvPictureChannelLastJson) return;
  tvPictureChannelLastJson = json;
  tvChannelPeer?.publishDelta("tvPicture", payload);
};

const publishEmbyPlayingChannel = async () => {
  const payload = await getEmbyPlayingPayload();
  const json = snapshotJson(payload);
  if (json === embyPlayingChannelLastJson) return;
  embyPlayingChannelLastJson = json;
  tvChannelPeer?.publishDelta("embyPlaying", payload);
};

const startTvPictureChannelPolling = () => {
  if (tvPictureChannelPollTimer) return;
  tvPictureChannelPollTimer = setInterval(() => {
    publishTvPictureChannel().catch((e) => {
      unilog(1507, `tvPicture poll failed: ${e.message}`);
    });
  }, TV_PICTURE_CHANNEL_POLL_MS);
};

const stopTvPictureChannelPolling = () => {
  if (!tvPictureChannelPollTimer) return;
  clearInterval(tvPictureChannelPollTimer);
  tvPictureChannelPollTimer = null;
  tvPictureChannelLastJson = "";
};

const startEmbyPlayingChannelPolling = () => {
  if (embyPlayingChannelPollTimer) return;
  embyPlayingChannelPollTimer = setInterval(() => {
    publishEmbyPlayingChannel().catch((e) => {
      unilog(1508, `embyPlaying poll failed: ${e.message}`);
    });
  }, EMBY_PLAYING_CHANNEL_POLL_MS);
};

const stopEmbyPlayingChannelPolling = () => {
  if (!embyPlayingChannelPollTimer) return;
  clearInterval(embyPlayingChannelPollTimer);
  embyPlayingChannelPollTimer = null;
  embyPlayingChannelLastJson = "";
};

const startTvChannelPeer = () => {
  if (tvChannelPeer) return;
  tvChannelPeer = new ChannelPeer({
    channels: {
      tvPicture: {
        snapshot: getTvPictureChannelSnapshot,
        onFirstSubscriber: startTvPictureChannelPolling,
        onLastUnsubscriber: stopTvPictureChannelPolling,
      },
      embyPlaying: {
        snapshot: getEmbyPlayingChannelSnapshot,
        onFirstSubscriber: startEmbyPlayingChannelPolling,
        onLastUnsubscriber: stopEmbyPlayingChannelPolling,
      },
    },
    log: (message) => unilog(1509, `${message}`),
  });
  tvChannelPeer.start();
};

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
    unilog(453, `picture set ${target}=${value}`);
    publishTvPictureChannel().catch((e) => {
      unilog(1510, `tvPicture publish failed: ${e.message}`);
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

connectHa();
connectEmby();

let lastSubMismatchKey = null;
async function checkSubtitleMismatch(sessions) {
  const lrtv = sessions.find(
    (s) => s.NowPlayingItem && s.DeviceName === "Living Room TV",
  );
  if (!lrtv) {
    lastSubMismatchKey = null;
    return;
  }
  const item = lrtv.NowPlayingItem;
  const seasonNum = item.ParentIndexNumber;
  const episodeNum = item.IndexNumber;
  if (seasonNum == null || episodeNum == null) return;
  const showName = item.SeriesName || item.Name;
  const episodeCode = `S${String(seasonNum).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`;
  const key = `${showName}|${episodeCode}`;
  if (key === lastSubMismatchKey) return;
  const currentSubIndex = lrtv.PlayState?.SubtitleStreamIndex ?? -1;
  if (currentSubIndex === -1) return; // emby hasn't settled on a subtitle yet
  lastSubMismatchKey = key;
  try {
    const prefRes = await fetch(
      `${SRVR_INTERNAL_URL}/internal/chksrt/preferred?showName=${encodeURIComponent(showName)}&episodeCode=${encodeURIComponent(episodeCode)}`,
    );
    if (!prefRes.ok) return;
    const pref = await prefRes.json();
    if (!pref) return;
    let streams = [];
    try {
      const itemRes = await fetch(
        `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${item.Id}?Fields=MediaSources&api_key=${EMBY_API_KEY}`,
        { headers: { Accept: "application/json" } },
      );
      if (itemRes.ok) {
        const itemData = await itemRes.json();
        streams = itemData.MediaSources?.[0]?.MediaStreams ?? [];
      }
    } catch (_) {}
    let chosenSubIndex = null;
    if (pref.embStreamIndex != null) {
      const found = streams.find(
        (s) => s.Type === "Subtitle" && s.Index === pref.embStreamIndex,
      );
      if (found) chosenSubIndex = found.Index;
    } else if (pref.srtFile) {
      const found = streams.find(
        (s) =>
          s.Type === "Subtitle" &&
          s.IsExternal &&
          s.Path &&
          s.Path.endsWith("/" + pref.srtFile),
      );
      if (found) chosenSubIndex = found.Index;
    }
    if (chosenSubIndex === null) return;
    if (currentSubIndex === chosenSubIndex) return;
    unilog(
      454,
      `${showName} ${episodeCode}: current=${currentSubIndex} chosen=${chosenSubIndex}`,
    );
    await fetch(`${SRVR_INTERNAL_URL}/internal/subtitle-mismatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showName, episodeCode }),
    });
  } catch (err) {
    unilog(455, "checkSubtitleMismatch error:", err.message);
  }
}

// Bridges Android tvapprc commands to tvapp and keeps the phone's remote mode in
// step with whether tvapp's command socket is reachable. Each connected phone
// has its own leg to tvapp; commands are absolute key/filter state rather than
// relative pointer motion, so no controller arbitration is needed here.
function startTvapprcBridge() {
  const bridge = new WebSocketServer({ port: TVAPPRC_BRIDGE_PORT });

  bridge.on("connection", (phone, req) => {
    const from = req.socket.remoteAddress;
    let tv = null;
    let dialTimer = null;
    let quietDialFail = false;
    let closed = false;

    const sendPhone = (msg) => {
      if (phone.readyState === WebSocket.OPEN) phone.send(msg);
    };

    const redial = () => {
      if (closed || dialTimer) return;
      dialTimer = setTimeout(() => {
        dialTimer = null;
        dial();
      }, TVAPP_DIAL_RETRY_MS);
    };

    const dial = () => {
      if (closed) return;
      const sock = new WebSocket(TVAPP_CTRL_URL);
      tv = sock;
      let wasOpen = false;

      sock.on("open", () => {
        wasOpen = true;
        quietDialFail = false;
        unilog(1879, `phone ${from} bridged to tvapp`);
        sendPhone(MSG_TVAPP_UP);
      });
      sock.on("close", () => {
        if (wasOpen) sendPhone(MSG_TVAPP_DOWN);
        redial();
      });
      sock.on("error", (e) => {
        if (!quietDialFail) {
          quietDialFail = true;
          unilog(1880, `tvapp dial failed: ${e.message}`);
        }
      });
      sock.on("message", (data) => sendPhone(data.toString()));
    };

    phone.on("message", (data) => {
      const msg = data.toString();
      if (msg === MSG_OPEN_TVAPP) {
        unilog(1881, `phone ${from} opened tvapp`);
        openTvappSelectingShow();
        return;
      }
      if (tv?.readyState === WebSocket.OPEN) {
        tv.send(msg);
      } else if (
        msg === CMD_BACK_TO_EMBY ||
        msg === CMD_FORCE_CLOSE_TO_EMBY ||
        msg === CMD_EMBY_SELECTED
      ) {
        void sendTvappCommand(msg);
      }
    });

    const shutdown = () => {
      closed = true;
      clearTimeout(dialTimer);
      tv?.close();
    };
    phone.on("close", shutdown);
    phone.on("error", shutdown);

    dial();
  });

  bridge.on("listening", () =>
    unilog(1882, `bridge listening on port ${TVAPPRC_BRIDGE_PORT}`),
  );
  bridge.on("error", (e) =>
    unilog(1883, `bridge socket error: ${e.message}`),
  );
}

// Opens tvapp on the tv so Android tvapprc mode has something to control.
// Sideloaded as it is, tvapp still shows up in the tv's own application list, so
// this needs no adb — which matters, because the tv's adb port moves on reboot.
async function launchTvapp() {
  try {
    const res = await fetch(BRAVIA_APP_CONTROL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-PSK": BRAVIA_PSK },
      body: JSON.stringify({
        method: "setActiveApp",
        version: "1.0",
        id: 1,
        params: [{ uri: TVAPP_BRAVIA_URI }],
      }),
    });
    const body = await res.json();
    if (body.error) {
      unilog(1842, `tv refused to open tvapp: ${JSON.stringify(body.error)}`);
      return;
    }
    unilog(1843, "asked the tv to open tvapp");
  } catch (e) {
    unilog(1844, `could not ask the tv to open tvapp: ${e.message}`);
  }
}

// A quick dial to tvapp's ctrl socket: open within TVAPP_PROBE_TIMEOUT_MS
// means tvapp is already up. Same signal the bridge uses to flip Android into
// tvapprc mode, asked here without any phone in the loop.
function probeTvappOpen() {
  return new Promise((resolve) => {
    const sock = new WebSocket(TVAPP_CTRL_URL);
    const timer = setTimeout(() => {
      sock.terminate();
      resolve(null);
    }, TVAPP_PROBE_TIMEOUT_MS);
    sock.on("open", () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

// Redials until tvapp's ctrl socket comes up -- it takes a beat to launch --
// or gives up after timeoutMs.
function dialTvappUntilOpen(timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const sock = new WebSocket(TVAPP_CTRL_URL);
      sock.on("open", () => resolve(sock));
      sock.on("error", () => {
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        setTimeout(attempt, TVAPP_DIAL_RETRY_MS);
      });
    };
    attempt();
  });
}

async function sendTvappCommand(command) {
  const sock = await probeTvappOpen();
  if (!sock) return false;
  sock.send(command);
  sock.close();
  return true;
}

// How long Emby is given to report the playback really over. Asking rather
// than waiting a set time is the whole point: the stop takes as long as it
// takes, and a back key sent while the player is still up is one the player
// swallows -- the show is then left open, which is exactly the "sometimes"
// this replaced.
const EMBY_STOP_POLL_MS = 150;
const EMBY_STOP_WAIT_MS = 4000;
// On top of that, what the player's own exit off the screen takes after the
// session it was playing has gone.
const EMBY_STOP_SETTLE_MS = 700;
// And then long enough for that key to have been delivered before tvapp is
// launched over the top of it. A back key still in flight when tvapp takes the
// screen is a back press tvapp answers, and it leaves for Emby again the
// moment it arrives -- the show still open behind it, and the remote dropped
// back out of tvapprc mode.
const EMBY_BACK_SETTLE_MS = 1000;

/** Resolves once Emby has no playback session left, or the wait runs out. */
async function waitForEmbyStopped() {
  const until = Date.now() + EMBY_STOP_WAIT_MS;
  while (Date.now() < until) {
    await sleep(EMBY_STOP_POLL_MS);
    try {
      if (!(await getEmbyPlaybackSession())) return true;
    } catch (e) {
      unilog(1923, `waiting on emby stop: ${e.message}`);
    }
  }
  unilog(1924, `emby still playing ${EMBY_STOP_WAIT_MS}ms after stop`);
  return false;
}

/**
 * Emby keeps playing behind whatever comes up over it, so switching to tvapp
 * means stopping the video first -- not pausing it: the Shows key is a move
 * between the two apps, not a look away from a show still running. Stopping
 * only drops Emby back onto the show it was playing, so a back key follows to
 * close that too and leave Emby off the show entirely.
 */
async function closeEmbyShow() {
  try {
    const live = await getEmbyPlaybackSession();
    if (!live?.Id) return;
    await fetch(
      `${EMBY_BASE_URL}/Sessions/${live.ControlSessionId}/Playing/Stop?api_key=${EMBY_API_KEY}`,
      { method: "POST", headers: { Accept: "application/json" } },
    );
    await waitForEmbyStopped();
    await sleep(EMBY_STOP_SETTLE_MS);
    callService("remote", "send_command", REMOTE_ENTITY_ID, {
      command: GOOGLE_KEY_MAP.back,
    });
    await sleep(EMBY_BACK_SETTLE_MS);
  } catch (e) {
    unilog(1919, `stop before tvapp open failed: ${e.message}`);
  }
}

// Every place that starts tvapp fresh (as against tvapp already being up and
// just wanting the focus back, see /tv/opentvapp) funnels through here so it
// always comes up on lastRelevantShow rather than whatever it last happened
// to have selected before it was closed. Resolves false if tvapp never came up.
async function openTvappSelectingShow() {
  await closeEmbyShow();
  await launchTvapp();
  const sock = await dialTvappUntilOpen(TVAPP_SELECT_DIAL_TIMEOUT_MS);
  if (!sock) {
    unilog(1907, `tvapp never came up`);
    return false;
  }
  if (lastRelevantShow) sock.send(`${CMD_SELECT_SHOW},${lastRelevantShow}`);
  sock.close();
  return true;
}

// The client's own browsing selection -- one more source (besides Emby
// actually playing something) for lastRelevantShow, so a Shows-button open of
// tvapp can favor it when nothing is currently playing.
app.post("/tv/clientShow", (req, res) => {
  const { show } = req.body ?? {};
  if (show) lastRelevantShow = show;
  res.json({ ok: true });
});

// The web remote's Shows button: straight across between the two apps. From
// tvapp it leaves for Emby playing the show tvapp was sitting on; from Emby it
// stops what is playing and opens tvapp on lastRelevantShow. Every connected
// Android remote follows along for free -- tvapp opening or closing is what
// flips their tvapprc mode on and off already.
app.post("/tv/toggletvapp", async (req, res) => {
  const openSock = await probeTvappOpen();
  if (openSock) {
    unilog(1851, `toggletvapp closing tvapp`);
    openSock.send(CMD_EMBY_SELECTED);
    openSock.close();
    res.json({ ok: true, action: "closed" });
    return;
  }
  const opened = await openTvappSelectingShow();
  if (!opened) {
    res.json({ ok: false, error: "tvapp did not come up" });
    return;
  }
  res.json({ ok: true, action: "opened" });
});

app.post("/tv/tvapprc/back", async (req, res) => {
  const ok = await sendTvappCommand(CMD_BACK_TO_EMBY);
  res.json(ok ? { ok: true } : { ok: false, error: "tvapp is not open" });
});

app.post("/tv/tvapprc/forceback", async (req, res) => {
  const ok = await sendTvappCommand(CMD_FORCE_CLOSE_TO_EMBY);
  res.json(ok ? { ok: true } : { ok: false, error: "tvapp is not open" });
});

// tvapp's back key on its way out to Emby: the show Emby was left playing
// behind it is closed exactly as opening tvapp over a playing show closes it.
// tvapp is already stepping aside as this is asked for, so the back key at the
// end of the close lands on Emby rather than on tvapp.
app.post("/tv/closeembyshow", async (req, res) => {
  await closeEmbyShow();
  res.json({ ok: true });
});

app.post("/tv/tvapprc/emby", async (req, res) => {
  const ok = await sendTvappCommand(CMD_EMBY_SELECTED);
  res.json(ok ? { ok: true } : { ok: false, error: "tvapp is not open" });
});

// tv-srvr calls this when the web client's Send button saves new shared filter
// settings. tvapp re-fetches its Custom list on it, which is why nothing there
// polls for the change: the Send button is the only thing that can make one.
// Not open, or not on the Custom sort, and it simply comes to nothing.
app.get("/tv/tvappcustom", async (req, res) => {
  const ok = await sendTvappCommand(CMD_CUSTOM_CHANGED);
  res.json({ ok });
});

// tvapp asks for this when it needs the set to bring it to the front. It cannot
// come back by itself once backgrounded: Android blocks an activity start from a
// background app, and no permission a sideloaded app can grant itself lifts that.
app.get("/tv/opentvapp", async (req, res) => {
  unilog(1846, `opentvapp from ${client(req)}`);
  await launchTvapp();
  res.json({ ok: true });
});

app.listen(TV_PORT, () => {
  unilog(456, `listening on port ${TV_PORT}`);
  startTvChannelPeer();
  startTvapprcBridge();
});

setInterval(pushTvState, 2000);
