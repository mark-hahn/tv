// movie-rsync.js — polls qBittorrent for completed movies in /home/xobtlu/movies
// and rsyncs each one to /mnt/media/movies on the local server.
import childProcess from "node:child_process";
import fs from "node:fs";

const USB_HOST = "xobtlu@oracle.usbx.me";
const USB_MOVIES_PATH = "/home/xobtlu/movies";
const LOCAL_MOVIES_PATH = "/mnt/media/movies";

const QB_HOST = "oracle.usbx.me";
const QB_PORT = 12041;
const QB_USER = "xobtlu";
const QB_PASS = "90-TYUrtyasd";

const NORMAL_INTERVAL_MS = 60 * 1000;
const FAST_INTERVAL_MS = 5 * 1000;
const FAST_MODE_MAX_MS = 60 * 1000;

// Map: filePath → job object
const jobs = new Map();

let _qbCookie = null;
let _cycleTimer = null;
let _cycling = false;
let _fastMode = false;
let _fastModeStart = 0;
let _prevFinishedNames = new Set();

async function qbLogin() {
  const res = await fetch(`http://${QB_HOST}:${QB_PORT}/api/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent(QB_USER)}&password=${encodeURIComponent(QB_PASS)}`,
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/SID=([^;]+)/);
  if (!m) throw new Error("qb login failed: no SID in response");
  return `SID=${m[1]}`;
}

async function getQbtCookie() {
  if (!_qbCookie) _qbCookie = await qbLogin();
  return _qbCookie;
}

async function getMovieTorrents() {
  let cookie;
  try {
    cookie = await getQbtCookie();
  } catch {
    _qbCookie = null;
    return [];
  }
  const res = await fetch(`http://${QB_HOST}:${QB_PORT}/api/v2/torrents/info`, {
    headers: { Cookie: cookie },
  });
  if (res.status === 403) {
    _qbCookie = null;
    return [];
  }
  if (!res.ok) return [];
  const all = await res.json().catch(() => []);
  if (!Array.isArray(all)) return [];
  const FINISHED = new Set(["uploading", "stalledUP", "stoppedUP", "forcedUP"]);
  return all.filter(
    (t) =>
      String(t.save_path || "").replace(/\/+$/, "") === USB_MOVIES_PATH &&
      FINISHED.has(String(t.state || "")),
  );
}

function parseRsyncProgress(line) {
  // e.g.: "238,551,040   1%   10.49MB/s    0:26:59"
  const m = line.match(/^([\d,]+)\s+(\d+)%\s+([\d.]+\w+\/s)\s+([\d:]+)/);
  if (m)
    return {
      bytes_done: parseInt(m[1].replace(/,/g, "")),
      percent: parseInt(m[2]),
      rate: m[3],
      eta: m[4],
    };
  return null;
}

// Returns true if a new rsync job was started, false if skipped.
function startRsyncFile(filePath, totalBytes) {
  if (jobs.has(filePath)) return false;
  const nameParts = filePath.split("/");
  const basename = nameParts[nameParts.length - 1];
  const destPath = `${LOCAL_MOVIES_PATH}/${basename}`;

  // Get existing partial size to compute real percent during resume
  let startOffset = 0;
  try {
    startOffset = fs.statSync(destPath).size;
    if (totalBytes > 0 && startOffset >= totalBytes) return false;
  } catch {
    // File doesn't exist yet — proceed
  }

  // Kill any orphaned rsync for this file (e.g. from a previous pm2 instance)
  childProcess.spawnSync("pkill", ["-f", `rsync.*${basename}`]);

  const src = `${USB_HOST}:${filePath}`;
  const dst = `${LOCAL_MOVIES_PATH}/`;

  const job = {
    name: basename,
    status: "Downloading",
    percent: 0,
    total_bytes: totalBytes || 0,
    rate: "",
    eta: "",
    _proc: null,
  };
  jobs.set(filePath, job);

  const proc = childProcess.spawn("rsync", [
    "-e",
    "ssh",
    "--progress",
    "--append",
    "--",
    src,
    dst,
  ]);
  job._proc = proc;

  let buf = "";
  const processChunk = (data) => {
    buf += data.toString();
    const lines = buf.split(/[\r\n]+/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const p = parseRsyncProgress(line.trim());
      if (p) {
        // p.bytes_done is bytes transferred in this session only.
        // Compute real percent using startOffset + session bytes.
        if (totalBytes > 0) {
          const realDone = startOffset + p.bytes_done;
          job.percent = Math.min(
            100,
            Math.round((realDone / totalBytes) * 100),
          );
        } else {
          job.percent = p.percent;
        }
        job.rate = p.rate;
        job.eta = p.eta;
      }
    }
  };

  proc.stdout.on("data", processChunk);
  proc.stderr.on("data", processChunk);

  proc.on("close", (code) => {
    job._proc = null;
    if (code === 0) {
      job.status = "Finished";
      // Rename source file on USB to prevent re-download
      childProcess.spawn("ssh", [
        USB_HOST,
        `mv -- '${filePath}' '${filePath}.done'`,
      ]);
    } else {
      job.status = `Error (exit ${code})`;
    }
  });

  return true;
}

async function findVideoFilesInPath(remotePath) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn("ssh", [
      USB_HOST,
      `find ${remotePath} -type f \\( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.avi' -o -iname '*.m4v' -o -iname '*.ts' \\) -printf '%p\t%s\n' 2>/dev/null`,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.on("close", () => {
      const results = out
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const tab = line.lastIndexOf("\t");
          if (tab === -1) return { path: line, size: 0 };
          return {
            path: line.slice(0, tab),
            size: parseInt(line.slice(tab + 1)) || 0,
          };
        });
      resolve(results);
    });
    proc.on("error", () => resolve([]));
  });
}

async function runCycle() {
  _cycling = true;
  let torrents;
  try {
    torrents = await getMovieTorrents();
  } catch {
    _cycling = false;
    return;
  }

  // Detect newly finished qBt torrents → enter fast mode
  const currentFinishedNames = new Set(
    torrents.map((t) => String(t.name || "")),
  );
  for (const name of currentFinishedNames) {
    if (!_prevFinishedNames.has(name)) {
      _fastMode = true;
      _fastModeStart = Date.now();
      break;
    }
  }
  _prevFinishedNames = currentFinishedNames;

  let anyStarted = false;
  for (const t of torrents) {
    const torrentPath = `${USB_MOVIES_PATH}/${String(t.name || "")}`;
    const files = await findVideoFilesInPath(torrentPath).catch(() => []);
    for (const { path: filePath, size } of files) {
      if (startRsyncFile(filePath, size)) anyStarted = true;
    }
  }

  // Rsync started → back to normal interval
  if (anyStarted) _fastMode = false;

  // Fast mode expired after 1 min → revert
  if (_fastMode && Date.now() - _fastModeStart >= FAST_MODE_MAX_MS)
    _fastMode = false;
  _cycling = false;
}

function scheduleNextCycle() {
  if (_cycleTimer) clearTimeout(_cycleTimer);
  const delay = _fastMode ? FAST_INTERVAL_MS : NORMAL_INTERVAL_MS;
  _cycleTimer = setTimeout(() => {
    runCycle()
      .catch(() => {})
      .finally(scheduleNextCycle);
  }, delay);
}

export function startCycling() {
  scheduleNextCycle();
}

export function stopCycling() {
  if (_cycleTimer) clearTimeout(_cycleTimer);
  _cycleTimer = null;
}

export async function triggerCycle() {
  if (_cycleTimer) clearTimeout(_cycleTimer);
  _cycleTimer = null;
  await runCycle().catch(() => {});
  scheduleNextCycle();
}

export function getMovieDownJobs() {
  return {
    cycling: _cycling,
    jobs: Array.from(jobs.values()).map((j) => ({
      name: j.name,
      status: j.status,
      percent: j.percent,
      total_bytes: j.total_bytes,
      rate: j.rate,
      eta: j.eta,
    })),
  };
}

export function killAll() {
  for (const job of jobs.values()) {
    if (job._proc) {
      job._proc.kill();
      job._proc = null;
    }
    if (job.status === "Downloading") job.status = "Killed";
  }
}
