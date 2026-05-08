// movie-rsync.js — polls qBittorrent for completed movies in /home/xobtlu/movies
// and rsyncs each one to /mnt/media/movies on the local server.
import childProcess from "node:child_process";

const USB_HOST = "xobtlu@oracle.usbx.me";
const USB_MOVIES_PATH = "/home/xobtlu/movies";
const LOCAL_MOVIES_PATH = "/mnt/media/movies";

const QB_HOST = "oracle.usbx.me";
const QB_PORT = 12041;
const QB_USER = "xobtlu";
const QB_PASS = "90-TYUrtyasd";

// Map: name → job object { name, status, percent, rate, eta, _proc }
const jobs = new Map();

let _qbCookie = null;

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

function startRsync(torrent) {
  const name = String(torrent.name || "");
  if (!name || jobs.has(name)) return;

  const src = `${USB_HOST}:${USB_MOVIES_PATH}/${name}`;
  const dst = `${LOCAL_MOVIES_PATH}/`;

  const job = {
    name,
    status: "Downloading",
    percent: 0,
    bytes_done: 0,
    rate: "",
    eta: "",
    _proc: null,
  };
  jobs.set(name, job);

  const proc = childProcess.spawn("rsync", [
    "-e",
    "ssh",
    "--progress",
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
        job.percent = p.percent;
        job.bytes_done = p.bytes_done;
        job.rate = p.rate;
        job.eta = p.eta;
      }
    }
  };

  proc.stdout.on("data", processChunk);
  proc.stderr.on("data", processChunk);

  proc.on("close", (code) => {
    if (code === 0) {
      job.status = "Finished";
      job._proc = null;
      // Remove finished jobs after 30 seconds
      setTimeout(() => jobs.delete(name), 30000);
    } else {
      job.status = `Error (exit ${code})`;
      job._proc = null;
    }
  });
}

export async function pollAndSync() {
  let torrents;
  try {
    torrents = await getMovieTorrents();
  } catch {
    return;
  }
  for (const t of torrents) {
    startRsync(t);
  }
}

export function getMovieDownJobs() {
  return Array.from(jobs.values()).map((j) => ({
    name: j.name,
    status: j.status,
    percent: j.percent,
    bytes_done: j.bytes_done,
    rate: j.rate,
    eta: j.eta,
  }));
}
