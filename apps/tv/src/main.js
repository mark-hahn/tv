import { WebSocket, WebSocketServer } from "ws";
import { exec, execFile } from "child_process";
import { promisify } from "util";
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
let tvChannelPeer = null;
let tvPictureChannelPollTimer = null;
let tvPictureChannelLastJson = "";
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
const BRAVIA_TV_IP = "192.168.1.86:34047";
const BRAVIA_TV_HOST = "192.168.1.86";
// Wireless debugging picks a new random port in here on every TV boot.
const BRAVIA_ADB_PORT_RANGE = "30000-49999";
const ADB_CMD_TIMEOUT_MS = 5000; // ms before a single adb command is given up on
const ADB_HANDSHAKE_MS = 3000; // ms for a just-connected port to come up as a real adb device
const ADB_PAIR_TIMEOUT_MS = 30000; // ms before adb pair is given up on
const NMAP_TIMEOUT_MS = 60000; // ms before the adb port scan is given up on
const ADB_CHECK_MS = 30000; // ms between checks that the tv's adb connection is still up
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
// tvapp's ctrl socket does not always send a close when it goes away -- the
// activity stopping in the background can leave the tcp connection established with
// nothing on the far end, and the leg then looks open forever, so the phone is
// never told tvapp is down and its keys go nowhere. A ping every interval with
// no pong by the next one is what catches that.
const TVAPP_PING_MS = 2000;
// Sideloaded, but still in the tv's own application list, so opening tvapp needs
// no adb — which matters, because the tv's adb port moves on every reboot.
const BRAVIA_APP_CONTROL_URL = "http://192.168.1.86/sony/appControl";
const BRAVIA_SYSTEM_URL = "http://192.168.1.86/sony/system";
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
const CMD_BACK = "b"; // back one level; at tvapp's top level it stays put
const CMD_PLAY = "e"; // play what tvapp's cursor is on, else its show's next-up
const CMD_SELECT_SHOW = "s"; // select a show by name
const CMD_PLAY_EPISODE = "p"; // play one specific episode of the selected show: p,<season>,<episode>
const CMD_CLEAR_STATE = "r"; // back to a bare show list
const CMD_CUSTOM_CHANGED = "c"; // the shared filter settings changed
// A live camera over the whole screen, hand-mirrored in CtrlServer.java. The
// argument is a page url that plays it, or CAM_OFF to take it back off; what
// the page does is no business of this file's. See
// docs/tv-videostream-contract.md.
const CMD_SHOW_CAM = "v";
const CAM_OFF = "off";
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

const SRVR_INTERNAL_URL = "http://127.0.0.1:8739";

// Power-key power-on sequence: wait for the set -> Google TV input -> tvapp
// HA reports the set "on" the moment its network processor answers, which is
// well before the ui can take a key. The set is asked for its own power status
// until it says "active", so nothing is sent into a tv that is still coming up.
const POWERON_AWAKE_POLL_MS = 500; // ms between power-status probes after HA says on
const POWERON_AWAKE_WAIT_MS = 15000; // ms to wait for the set to report active
const POWERON_HOME_SETTLE_MS = 1500; // ms after Home before launching tvapp

// Scrub control
const SCRUB_START_COUNT = 4; // number of slow keys before speeding up
const SCRUB_RATE_FWD_SLOW = 750; // ms between right keys for first N
const SCRUB_RATE_FWD_FAST = 100; // ms between right keys after first N
const SCRUB_RATE_REV_SLOW = 100; // ms between left keys for first N
const SCRUB_RATE_REV_FAST = 100; // ms between left keys after first N
const SCRUB_DEADMAN_TIMEOUT = 2000; // ms without ping before auto-stop

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

// ─── HA WebSocket ────────────────────────────────────────────────────────────

let ws = null;
let cmdId = 0;
let authenticated = false;
let braviaHaMuted = null;
let braviaHaPower = "unknown";
let braviaMediaContentType = null;
let braviaMediaTitle = null;
let tvMode = "off"; // "google" | "tv" | "off" | "other" — set only from HA push
let lastOffAt = 0;
let lastOnAt = 0;
let pendingGoogleTvapp = false;
// Whichever show is most relevant right now — the client's own browsing
// selection.
// tvapp is told to select this whenever it starts fresh, so opening it while
// a show it started itself is mid-playback doesn't override its own correct
// selection with some unrelated show the client happens to have open.
let lastRelevantShow = null;

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
      const WATCHED = new Set([REMOTE_ENTITY_ID, BRAVIA_ENTITY_ID]);
      if (WATCHED.has(id) && state !== prev) {
        unilog(384, `HA state: ${id} ${prev} -> ${state}`);
      }
      if (id === BRAVIA_ENTITY_ID) {
        const attrs = event.data?.new_state?.attributes;
        unilog(2506, `BRAVIA attrs: title=${attrs?.media_title ?? "null"} mediaType=${attrs?.media_content_type ?? "null"} muted=${attrs?.is_volume_muted ?? "null"} pendingGoogleTvapp=${pendingGoogleTvapp}`);
        const prevPower = braviaHaPower;
        braviaHaPower = state;
        if (attrs) {
          braviaHaMuted = attrs.is_volume_muted ?? null;
          braviaMediaContentType = attrs.media_content_type ?? null;
          braviaMediaTitle = attrs.media_title ?? null;
        }
        // TV just turned on from a googlebtn press — open tvapp
        if (pendingGoogleTvapp && prevPower !== "on" && state === "on") {
          pendingGoogleTvapp = false;
          unilog(1952, `googlebtn: TV on — running power-on sequence`);
          googlePowerOnSequence();
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
    // TV already on — the input may still be the tuner, so run the same
    // sequence rather than dropping tvapp onto whatever is up
    unilog(1953, `googlebtn: TV already on, running power-on sequence`);
    googlePowerOnSequence();
  } else {
    // TV off — wait for state_changed on transition to "on"
    pendingGoogleTvapp = true;
    unilog(
      1904,
      `googlebtn: TV not on (${braviaHaPower}), set pendingGoogleTvapp=true`,
    );
  }
  res.json({ ok: true });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const execAsync = promisify(exec);

// The TV's adb serial (host:port) when hahnca.com's adb server has a live
// connection to it, else null. Only asks the local adb server, so it is cheap
// enough for the play path.
async function braviaAdbSerial() {
  const { stdout } = await execAsync("adb devices", {
    timeout: ADB_CMD_TIMEOUT_MS,
  });
  for (const line of stdout.split("\n")) {
    const [serial, state] = line.trim().split("\t");
    if (state === "device" && serial.startsWith(`${BRAVIA_TV_HOST}:`))
      return serial;
  }
  return null;
}

// Wireless debugging moves to a new random port on every TV boot, so this
// scans for it: each open port in the range is tried and the one adb accepts
// is kept. The others are not adb and never get past "offline", so they are
// dropped again.
async function connectBraviaAdb() {
  const known = await braviaAdbSerial();
  if (known) return known;
  // Plain -Pn reports this TV as down; the tcp connect scan sees it.
  const { stdout } = await execAsync(
    `nmap -Pn -sT --disable-arp-ping -p ${BRAVIA_ADB_PORT_RANGE} --open -oG - ${BRAVIA_TV_HOST}`,
    { timeout: NMAP_TIMEOUT_MS },
  );
  const ports = [...stdout.matchAll(/(\d+)\/open/g)].map((m) => m[1]);
  for (const port of ports) {
    const target = `${BRAVIA_TV_HOST}:${port}`;
    await execAsync(`adb connect ${target}`, {
      timeout: ADB_CMD_TIMEOUT_MS,
    }).catch(() => {});
    const isAdb = await execAsync(`adb -s ${target} wait-for-device`, {
      timeout: ADB_HANDSHAKE_MS,
    }).then(
      () => true,
      () => false,
    );
    if (isAdb) {
      unilog(2457, `tv adb connected on ${target}`);
      return target;
    }
    await execAsync(`adb disconnect ${target}`, {
      timeout: ADB_CMD_TIMEOUT_MS,
    }).catch(() => {});
  }
  unilog(2458, `no open tv port took an adb connection (${ports.length} open) -- pairing needed`);
  return null;
}

// Whether the tv's adb connection is up, for the web client's TV ADB error.
// A tv that is not on has nothing to connect to, so that is not an error.
let braviaAdbOk = true;

async function checkBraviaAdb() {
  const ok = braviaHaPower !== "on" || (await braviaAdbSerial()) !== null;
  if (ok === braviaAdbOk) return;
  braviaAdbOk = ok;
  unilog(2465, `tv adb ${ok ? "ok" : "lost"}`);
  await pushTvState();
}

setInterval(() => {
  checkBraviaAdb().catch((e) => {
    unilog(2466, `tv adb check failed: ${e.message}`);
  });
}, ADB_CHECK_MS);

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

app.get("/tv/on", (req, res) => {
  unilog(416, `on from ${client(req)}`);
  callService("media_player", "turn_on", BRAVIA_ENTITY_ID);
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

app.get("/tv/key/:key", async (req, res) => {
  const keyMap = GOOGLE_KEY_MAP;
  const remoteId = REMOTE_ENTITY_ID;
  const command = keyMap[req.params.key];
  if (!command) {
    res.status(400).json({ ok: false, error: "unknown key" });
    return;
  }

  if (tvMode !== "google" && tvMode !== "tv") {
    unilog(420, `key ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
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

// ─── Bravia (via HA Sony Bravia integration) ─────────────────────────────────
// State is tracked from HA WebSocket in braviaHaMuted / braviaHaPower.
// Volume/mute control via HA media_player services.

app.get("/tv/vol/:dir", (req, res) => {
  const dir = req.params.dir;
  if (dir !== "up" && dir !== "down") {
    res.status(400).json({ ok: false, error: "unknown dir" });
    return;
  }
  if (tvMode !== "google" && tvMode !== "tv") {
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
  if (tvMode !== "google" && tvMode !== "tv") {
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
  if (tvMode !== "google" && tvMode !== "tv") {
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
      state: braviaHaPower,
      mediaContentType: braviaMediaContentType,
      mediaTitle: braviaMediaTitle,
      adbOk: braviaAdbOk,
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
  } else {
    unilog(431, `openapp ignored — tvMode=${tvMode}`);
    res.json({ ok: false, error: "wrong mode" });
  }
});

app.get("/tv/playvideo", async (req, res) => {
  const url = req.query.url;
  if (!url) {
    res.status(400).json({ ok: false, error: "missing url" });
    return;
  }
  if (tvMode === "google") {
    unilog(432, `playvideo google url=${url} from ${client(req)}`);
    // Wireless debugging's port moves on every tv boot, so use whichever
    // connection hahnca.com's adb currently has.
    const serial = await braviaAdbSerial();
    if (!serial) {
      unilog(2468, `playvideo: no adb connection to the tv`);
      res.json({ ok: false, error: "no adb connection to the tv" });
      return;
    }
    // The url comes straight off a public query string. execFile keeps it
    // away from hahnca.com's shell, but adb shell still hands the command to
    // the tv's own sh, so every value is single-quoted for that.
    const shq = (v) => `'${v.replaceAll("'", `'\\''`)}'`;
    // Extract YouTube video ID from URL
    const ytMatch = url.match(/[?&]v=([^&]+)/);
    let remoteCmd;
    if (ytMatch) {
      const videoId = ytMatch[1];
      unilog(433, `playvideo launching YouTube video ${videoId} via adb`);
      // Use adb to send intent directly to YouTube app
      remoteCmd = `am start -a android.intent.action.VIEW -d ${shq(`https://www.youtube.com/watch?v=${videoId}`)} com.google.android.youtube.tv`;
    } else {
      unilog(434, `playvideo: non-YouTube URL, launching in VLC`);
      // For IMDB or other video URLs, open in VLC
      remoteCmd = `am start -a android.intent.action.VIEW -d ${shq(url)} -t 'video/*' org.videolan.vlc`;
    }
    unilog(435, `playvideo cmd: ${remoteCmd}`);
    execFile("adb", ["-s", serial, "shell", remoteCmd], (err, stdout, stderr) => {
      if (err) {
        unilog(436, `playvideo adb error: ${err.message}`);
      }
      if (stderr) unilog(437, `playvideo adb stderr: ${stderr}`);
      if (stdout) unilog(438, `playvideo adb stdout: ${stdout}`);
    });
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

const publishTvPictureChannel = async () => {
  const payload = await getTvPicturePayload();
  const json = snapshotJson(payload);
  if (json === tvPictureChannelLastJson) return;
  tvPictureChannelLastJson = json;
  tvChannelPeer?.publishDelta("tvPicture", payload);
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

const startTvChannelPeer = () => {
  if (tvChannelPeer) return;
  tvChannelPeer = new ChannelPeer({
    channels: {
      tvPicture: {
        snapshot: getTvPictureChannelSnapshot,
        onFirstSubscriber: startTvPictureChannelPolling,
        onLastUnsubscriber: stopTvPictureChannelPolling,
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
      let alive = false;
      let pingTimer = null;

      sock.on("open", () => {
        wasOpen = true;
        quietDialFail = false;
        unilog(1879, `phone ${from} bridged to tvapp`);
        sendPhone(MSG_TVAPP_UP);
        alive = true;
        pingTimer = setInterval(() => {
          // Nothing answered the last ping, so this is one of the dead legs:
          // terminating it runs the close path below, which tells the phone
          // tvapp is down and starts dialling again.
          if (!alive) {
            unilog(2355, `tvapp leg for phone ${from} went quiet`);
            sock.terminate();
            return;
          }
          alive = false;
          sock.ping();
        }, TVAPP_PING_MS);
      });
      sock.on("pong", () => {
        alive = true;
      });
      sock.on("close", () => {
        clearInterval(pingTimer);
        if (wasOpen) sendPhone(MSG_TVAPP_DOWN);
        redial();
      });
      sock.on("error", (e) => {
        if (!quietDialFail) {
          quietDialFail = true;
          unilog(1880, `tvapp dial failed: ${e.message}`);
          // Down is otherwise only sent when an open leg closes. A phone that
          // reconnects after tvapp has already gone gets a leg that never
          // opens, so it is told here that there is nothing to drive.
          if (!wasOpen) sendPhone(MSG_TVAPP_DOWN);
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
      } else if (msg === CMD_BACK || msg === CMD_PLAY) {
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
  bridge.on("error", (e) => unilog(1883, `bridge socket error: ${e.message}`));
}

// Opens tvapp on the tv so Android tvapprc mode has something to control.
// Sideloaded as it is, tvapp still shows up in the tv's own application list, so
// this needs no adb — which matters, because the tv's adb port moves on reboot.
// Puts one of the tv's own apps on screen through the set's app api. Resolves
// once the set has answered, so two launches in a row land in that order --
// which is what a sequence of launches relies on.
async function launchBraviaApp(uri, name) {
  try {
    const res = await fetch(BRAVIA_APP_CONTROL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-PSK": BRAVIA_PSK },
      body: JSON.stringify({
        method: "setActiveApp",
        version: "1.0",
        id: 1,
        params: [{ uri }],
      }),
    });
    const body = await res.json();
    if (body.error) {
      unilog(2351, `tv refused to open ${name}: ${JSON.stringify(body.error)}`);
      return;
    }
    unilog(2352, `asked the tv to open ${name}`);
  } catch (e) {
    unilog(2353, `could not ask the tv to open ${name}: ${e.message}`);
  }
}

async function launchTvapp() {
  await launchBraviaApp(TVAPP_BRAVIA_URI, "tvapp");
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

// Every place that starts tvapp fresh (as against tvapp already being up and
// just wanting the focus back, see /tv/opentvapp) funnels through here so it
// always comes up on lastRelevantShow rather than whatever it last happened
// to have selected before it was closed. Resolves false if tvapp never came up.
// The power key brings the whole stack up in order. The set can come back on
// the broadcast tuner, so the input is put on Google Android TV first, and
// then tvapp is launched.
// The set's own answer to "are you up?", straight from its REST api rather
// than HA's cached view of it. Null while it is unreachable, which is what a
// tv that has only just been woken looks like from here.
async function braviaPowerStatus() {
  try {
    const resp = await fetch(BRAVIA_SYSTEM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-PSK": BRAVIA_PSK },
      body: JSON.stringify({
        method: "getPowerStatus",
        params: [],
        id: 1,
        version: "1.0",
      }),
    });
    const body = await resp.json();
    return body.result?.[0]?.status ?? null;
  } catch (e) {
    unilog(2249, `power status probe failed: ${e.message}`);
    return null;
  }
}

// Resolves true once the set answers "active". Resolves false on timeout, and
// the sequence runs anyway — a tv that is up but not answering its api is
// still better served by the keys than by nothing.
async function waitForBraviaAwake() {
  const until = Date.now() + POWERON_AWAKE_WAIT_MS;
  while (Date.now() < until) {
    if ((await braviaPowerStatus()) === "active") return true;
    await sleep(POWERON_AWAKE_POLL_MS);
  }
  return false;
}

async function googlePowerOnSequence() {
  const startedAt = Date.now();
  const awake = await waitForBraviaAwake();
  unilog(2250, `power-on: tv ${awake ? "active" : "never reported active"} after ${Date.now() - startedAt}ms`);
  if (tvMode !== "google") {
    unilog(
      1954,
      `power-on: tvMode=${tvMode}, sending Home for Google TV input`,
    );
    callService("remote", "send_command", REMOTE_ENTITY_ID, {
      command: "Home",
    });
    await sleep(POWERON_HOME_SETTLE_MS);
  }
  await openTvappSelectingShow();
}

// playIt adds the commands that turn a bare open into the info/map panes' TV
// button: the Shows button's clear first, so nothing inside cardMisc is
// focused, then the play once the show is selected -- the show's own next-up
// episode, or, with seasonEpisode ("<season>,<episode>"), that one specific
// episode (the map pane's selection).
async function openTvappSelectingShow(
  showName = null,
  playIt = false,
  seasonEpisode = null,
) {
  // The Shows key means a clean tvapp screen, so a camera view ends here too.
  // Reached when the phone's bridge leg is down, so tvapp never saw the key
  // and could not take its own overlay off. No restore: this is about to put
  // tvapp up itself.
  if (videoStream) await stopVideoStream("shows key", false);
  await launchTvapp();
  const sock = await dialTvappUntilOpen(TVAPP_SELECT_DIAL_TIMEOUT_MS);
  if (!sock) {
    unilog(1907, `tvapp never came up`);
    return false;
  }
  const wanted = showName ?? lastRelevantShow;
  if (playIt) sock.send(CMD_CLEAR_STATE);
  if (wanted) sock.send(`${CMD_SELECT_SHOW},${wanted}`);
  if (playIt) {
    sock.send(
      seasonEpisode ? `${CMD_PLAY_EPISODE},${seasonEpisode}` : CMD_PLAY,
    );
  }
  sock.close();
  return true;
}

// The client's own browsing selection, which is what lastRelevantShow is, so a
// Shows-button open of tvapp comes up on it.
app.post("/tv/clientShow", (req, res) => {
  const { show } = req.body ?? {};
  if (show) lastRelevantShow = show;
  res.json({ ok: true });
});

// The info and map panes' TV button: the tvapprc remote's Shows button
// followed by a click on this show. tvapp already up means the Shows button's
// clear -- back to a bare show list -- and then the named show is selected and
// played; tvapp down means the Shows button's open, with that show selected
// and played on its way up instead of just landing on lastRelevantShow. A
// season and episode (the map pane's selection) play that one episode instead
// of the show's own next-up pick.
app.get("/tv/showintvapp", async (req, res) => {
  const showName = req.query.showName;
  const { season, episode } = req.query;
  const seasonEpisode =
    season != null && episode != null ? `${season},${episode}` : null;
  if (!showName) {
    res.json({ ok: false, error: "no showName" });
    return;
  }
  lastRelevantShow = showName;
  const openSock = await probeTvappOpen();
  if (openSock) {
    openSock.send(CMD_CLEAR_STATE);
    openSock.send(`${CMD_SELECT_SHOW},${showName}`);
    openSock.send(
      seasonEpisode ? `${CMD_PLAY_EPISODE},${seasonEpisode}` : CMD_PLAY,
    );
    openSock.close();
    res.json({ ok: true, action: "played" });
    return;
  }
  const opened = await openTvappSelectingShow(showName, true, seasonEpisode);
  res.json(
    opened
      ? { ok: true, action: "opened" }
      : { ok: false, error: "tvapp did not come up" },
  );
});

app.post("/tv/tvapprc/back", async (req, res) => {
  const ok = await sendTvappCommand(CMD_BACK);
  res.json(ok ? { ok: true } : { ok: false, error: "tvapp is not open" });
});

// Picture settings' adb Connect button. With a port and code from the TV
// (Developer options > Wireless debugging > Pair device with pairing code) it
// pairs hahnca.com first; with neither it only hunts down the port wireless
// debugging moved to, which is all a reboot takes while the pairing holds.
app.post("/tv/adbconnect", async (req, res) => {
  const { port = "", code = "" } = req.body ?? {};
  // Both go into a shell command line.
  if (!/^\d*$/.test(port) || !/^\d*$/.test(code) || !port !== !code) {
    res.json({ ok: false, error: "port and code must both be digits, or both empty" });
    return;
  }
  try {
    if (port) {
      const { stdout } = await execAsync(
        `adb pair ${BRAVIA_TV_HOST}:${port} ${code}`,
        { timeout: ADB_PAIR_TIMEOUT_MS },
      );
      unilog(2461, `adb pair: ${stdout.trim()}`);
    }
    const serial = await connectBraviaAdb();
    await checkBraviaAdb();
    res.json(
      serial
        ? { ok: true, serial }
        : { ok: false, error: "no tv port took an adb connection -- pair first" },
    );
  } catch (e) {
    unilog(2462, `adb connect failed: ${e.message}`);
    res.json({ ok: false, error: e.message });
  }
});

// tv-srvr calls this when the web client's Send button saves new shared filter
// settings. tvapp re-fetches its Custom list on it, which is why nothing there
// polls for the change: the Send button is the only thing that can make one.
// Not open, or not on the Custom sort, and it simply comes to nothing.
app.get("/tv/tvappcustom", async (req, res) => {
  const ok = await sendTvappCommand(CMD_CUSTOM_CHANGED);
  res.json({ ok });
});

// The phone's Shows key when its bridge socket is down, which it is whenever
// the phone has sat idle for a while. It does all that the bridge's open
// message does.
app.get("/tv/opentvapp", async (req, res) => {
  unilog(1846, `opentvapp from ${client(req)}`);
  const opened = await openTvappSelectingShow();
  res.json(opened ? { ok: true } : { ok: false, error: "tvapp did not come up" });
});

// ---- a live video stream on the screen -----------------------------------
//
// hvac2 asks for this over localhost (both run on hahnca.com under pm2) and
// hands over a url and nothing else. This file owns the television: its power
// and the overlay; tvapp pauses its own video under the overlay. It does not know what the url
// serves, and hvac2 does not know any of the above. The interface is fixed by
// docs/tv-videostream-contract.md.
//
// Deliberately generic -- "videostream", not "doorbell". That the camera on
// the far end happens to be a Ring doorbell is hvac2's business.

// Default hold, and the ceiling on one a caller asks for.
const VIDEOSTREAM_DEFAULT_HOLD_MS = 90 * 1000;
const VIDEOSTREAM_MAX_HOLD_MS = 300 * 1000;
const VIDEOSTREAM_MIN_HOLD_MS = 5 * 1000;
// The only urls that will be handed to the WebView. Not a security boundary --
// the route is localhost-only -- but a typo that reaches the television shows
// as a black screen with no other explanation.
const VIDEOSTREAM_URL_PREFIX = "https://hahnca.com/";
// Long enough for a television that was off to be listening.
const VIDEOSTREAM_TV_ON_MS = 2500;

// {url, label, since, expiresAt, holdMs, timer, interrupted}
let videoStream = null;

/**
 * The dead-man's switch. hvac2 pings for as long as it wants the view up, so a
 * crash there -- or a pm2 restart mid-view -- cannot leave a camera on the
 * television with the show underneath paused indefinitely.
 */
function armVideoStreamHold(holdMs) {
  if (!videoStream) return;
  const hold = Math.min(
    Math.max(Number(holdMs) || VIDEOSTREAM_DEFAULT_HOLD_MS, VIDEOSTREAM_MIN_HOLD_MS),
    VIDEOSTREAM_MAX_HOLD_MS,
  );
  clearTimeout(videoStream.timer);
  videoStream.holdMs = hold;
  videoStream.expiresAt = Date.now() + hold;
  videoStream.timer = setTimeout(() => {
    unilog(2411, `hold lapsed after ${hold}ms`);
    void stopVideoStream("hold lapsed");
  }, hold);
}

async function showVideoStream(url, label, holdMs) {
  // The same url again: re-arm and say yes. A caller retrying is not an error,
  // and it must not tear down a working view to put the same one back.
  if (videoStream && videoStream.url === url) {
    armVideoStreamHold(holdMs);
    return {
      ok: true,
      expiresAt: videoStream.expiresAt,
      interrupted: videoStream.interrupted,
    };
  }
  if (videoStream) return { ok: false, reason: "busy" };

  let interrupted = null;

  if (tvMode === "off") {
    callService("media_player", "turn_on", BRAVIA_ENTITY_ID);
    await sleep(VIDEOSTREAM_TV_ON_MS);
  }

  // The camera variant of opening tvapp: no show selection, because the list
  // is not what anyone is about to look at.
  let sock = await probeTvappOpen();
  if (sock) {
    interrupted = "tvapp";
  } else {
    await launchTvapp();
    sock = await dialTvappUntilOpen(TVAPP_SELECT_DIAL_TIMEOUT_MS);
  }
  if (!sock) {
    unilog(2413, `tvapp never came up`);
    return { ok: false, reason: "tvappDown" };
  }

  sock.send(`${CMD_SHOW_CAM},${url}`);
  sock.close();
  videoStream = {
    url,
    label,
    since: Date.now(),
    expiresAt: 0,
    holdMs: VIDEOSTREAM_DEFAULT_HOLD_MS,
    timer: null,
    interrupted,
  };
  armVideoStreamHold(holdMs);
  unilog(2414, `showing ${label ?? url}${interrupted ? ` over ${interrupted}` : ""}`);
  return { ok: true, expiresAt: videoStream.expiresAt, interrupted };
}

/**
 * One way out for all three ways a view can end -- hvac2 asking, the hold
 * lapsing, and the remote's Back key (which tvapp reports by calling the stop
 * route itself). One restore path means the show cannot be left paused by the
 * one case nobody tested.
 */
async function stopVideoStream(why, restore = true) {
  const was = videoStream;
  videoStream = null;
  // Stopping when nothing is up is a success, not an error: our idea of the
  // state can be the stale one.
  if (!was) return { ok: true, restored: null };
  clearTimeout(was.timer);
  await sendTvappCommand(`${CMD_SHOW_CAM},${CAM_OFF}`);

  let restored = null;
  if (!restore) {
    // The Shows key, and the tvapp open behind it. The caller wants tvapp on
    // the screen as it is. The view is still cleared, which is what stops the
    // hold timer and frees the next Door press.
    unilog(2419, `stopped ${was.label ?? was.url} (${why}) without restoring`);
    return { ok: true, restored: null };
  }
  if (was.interrupted === "tvapp") {
    // tvapp was already up and is still up; hiding the overlay is the restore.
    restored = "tvapp";
  }
  unilog(2415, `stopped ${was.label ?? was.url} (${why}) restored=${restored ?? "none"}`);
  return { ok: true, restored };
}

app.post("/tv/videostream", async (req, res) => {
  const { url, label, holdMs } = req.body ?? {};
  if (typeof url !== "string" || !url.startsWith(VIDEOSTREAM_URL_PREFIX)) {
    unilog(2416, `refused url ${url}`);
    res.json({ ok: false, reason: "badUrl" });
    return;
  }
  res.json(
    await showVideoStream(url, typeof label === "string" ? label : null, holdMs),
  );
});

app.post("/tv/videostream/ping", (req, res) => {
  if (!videoStream) {
    res.json({ ok: false, reason: "notShowing" });
    return;
  }
  armVideoStreamHold(videoStream.holdMs);
  res.json({ ok: true, expiresAt: videoStream.expiresAt });
});

app.post("/tv/videostream/stop", async (req, res) => {
  // restore:false is tvapp saying the Shows key ended the view. Everything
  // else -- hvac2, the hold lapsing, the Back key -- wants what the view
  // interrupted put back.
  const restore = req.body?.restore !== false;
  res.json(await stopVideoStream(`stop from ${client(req)}`, restore));
});

app.get("/tv/videostream/status", (req, res) => {
  if (!videoStream) {
    res.json({ showing: false });
    return;
  }
  res.json({
    showing: true,
    url: videoStream.url,
    label: videoStream.label,
    since: videoStream.since,
    expiresAt: videoStream.expiresAt,
    interrupted: videoStream.interrupted,
  });
});

app.listen(TV_PORT, () => {
  unilog(456, `listening on port ${TV_PORT}`);
  startTvChannelPeer();
  startTvapprcBridge();
});

setInterval(pushTvState, 2000);
