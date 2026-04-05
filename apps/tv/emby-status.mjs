#!/usr/bin/env node
import WebSocket from "ws";

const EMBY_HOST = "hahnca.com:8920";
const EMBY_API_KEY = "1c399bd079d549cba8c916244d3add2b";
const DEVICES = ["Living Room TV", "Roku 2"];
const COLS = [
  "Timestamp",
  "Device",
  "Client",
  "Playing",
  "Paused",
  "RemoteCtrl",
  "LastActive",
  "Active",
];
const WIDTHS = [5, 14, 9, 40, 6, 10, 12, 6];

function now() {
  const d = new Date();
  const pst = new Date(
    d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
  );
  const mm = String(pst.getMinutes()).padStart(2, "0");
  const ss = String(pst.getSeconds()).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatSession(s, ts, active) {
  const last = new Date(s.LastActivityDate);
  const lastActive = last.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return [
    ts,
    s.DeviceName,
    s.Client,
    s.NowPlayingItem
      ? `${s.NowPlayingItem.SeriesName} - ${s.NowPlayingItem.Name}`
      : "none",
    s.NowPlayingItem ? String(s.PlayState?.IsPaused) : "-",
    String(s.SupportsRemoteControl),
    lastActive,
    String(active),
  ];
}

function sessionKey(s, active) {
  return JSON.stringify({
    playing: s.NowPlayingItem
      ? `${s.NowPlayingItem.SeriesName} - ${s.NowPlayingItem.Name}`
      : null,
    paused: s.NowPlayingItem ? s.PlayState?.IsPaused : null,
    remote: s.SupportsRemoteControl,
    active,
  });
}

const prevKeys = {};

function printRows(sessions, ts) {
  const relevant = sessions
    .filter((s) => DEVICES.includes(s.DeviceName))
    .sort(
      (a, b) => DEVICES.indexOf(a.DeviceName) - DEVICES.indexOf(b.DeviceName),
    );
  // Compute per-device active flag: true if this device has the latest LastActivityDate
  const maxDate = Math.max(
    ...relevant.map((s) => new Date(s.LastActivityDate).getTime()),
  );
  const activeMap = Object.fromEntries(
    relevant.map((s) => [
      s.DeviceName,
      new Date(s.LastActivityDate).getTime() === maxDate,
    ]),
  );

  // Check if anything changed
  let anyChange = false;
  for (const s of relevant) {
    const key = sessionKey(s, activeMap[s.DeviceName]);
    if (prevKeys[s.DeviceName] !== key) {
      anyChange = true;
      break;
    }
  }
  if (!anyChange) return;

  // Update keys and print all rows
  for (const s of relevant) {
    prevKeys[s.DeviceName] = sessionKey(s, activeMap[s.DeviceName]);
    const cells = formatSession(s, ts, activeMap[s.DeviceName]);
    console.log(
      cells
        .map((c, i) => c.padEnd(WIDTHS[i]))
        .join("  ")
        .trimEnd(),
    );
  }
  console.log();
}

const ws = new WebSocket(
  `wss://${EMBY_HOST}/embywebsocket?api_key=${EMBY_API_KEY}&deviceId=emby-status-monitor`,
  { rejectUnauthorized: false },
);

ws.on("open", () => {
  const header = COLS.map((c, i) => c.padEnd(WIDTHS[i]))
    .join("  ")
    .trimEnd();
  const sep = WIDTHS.map((w) => "-".repeat(w)).join("  ");
  console.log(header);
  console.log(sep);
  ws.send(JSON.stringify({ MessageType: "SessionsStart", Data: "0,0" }));
});

ws.on("message", (data) => {
  try {
    const msg = JSON.parse(data);
    if (msg.MessageType !== "Sessions") return;
    printRows(msg.Data, now());
  } catch {}
});

ws.on("error", (err) => {
  console.error("ws error:", err.message);
});

ws.on("close", () => {
  console.error("ws closed");
  process.exit(1);
});
