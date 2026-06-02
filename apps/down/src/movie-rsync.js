// movie-rsync.js — polls qBittorrent for completed movies in /home/xobtlu/movies
// and rsyncs each one to /mnt/media/movies on the local server.
import childProcess from "node:child_process";
import fs from "node:fs";

const USB_HOST = "xobtlu@xobtlu.baron.usbx.me";
const USB_MOVIES_PATH = "/home/xobtlu/movies";
const LOCAL_MOVIES_PATH = "/mnt/media/movies";

const QB_HOST = "xobtlu.baron.usbx.me";
const QB_PORT = 12041;
const QB_USER = "xobtlu";
const QB_PASS = "90-TYUrtyasd";

const NORMAL_INTERVAL_MS = 60 * 1000;
const FAST_INTERVAL_MS = 5 * 1000;
const FAST_MODE_MAX_MS = 60 * 1000;
const N_STREAMS = 8;
const BLOCK_SIZE_MB = 1;
const PROGRESS_INTERVAL_MS = 2000;

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

// Returns true if a new download job was started, false if skipped.
function startCopyFile(filePath, totalBytes) {
  if (jobs.has(filePath)) return false;
  const nameParts = filePath.split("/");
  const basename = nameParts[nameParts.length - 1];
  const destPath = `${LOCAL_MOVIES_PATH}/${basename}`;

  try {
    const stat = fs.statSync(destPath);
    if (totalBytes > 0 && stat.size >= totalBytes) {
      // Copy already done — create .tv-done sidecar on USB so it won't be reprocessed
      childProcess.spawn("ssh", [
        USB_HOST,
        `touch -- '${filePath}.tv-done'; rm -f -- '${filePath}.lftp-pget-status'; true`,
      ]);
      return false;
    }
  } catch {}

  childProcess.spawnSync("pkill", ["-f", `ssh.*dd.*${basename}`]);

  const job = {
    name: basename,
    status: "Downloading",
    percent: 0,
    total_bytes: totalBytes || 0,
    rate: "",
    eta: "",
    _procs: [],
    _pollTimer: null,
  };
  jobs.set(filePath, job);

  runParallelDd(filePath, basename, destPath, totalBytes, job).catch(() => {
    if (job.status === "Downloading") job.status = "Error";
  });

  return true;
}

async function runParallelDd(filePath, basename, destPath, totalBytes, job) {
  const BS = BLOCK_SIZE_MB * 1024 * 1024;
  const totalBlocks = Math.ceil(totalBytes / BS);
  const blocksPerStream = Math.ceil(totalBlocks / N_STREAMS);

  // Pre-allocate destination file so all streams can write concurrently
  await new Promise((resolve, reject) => {
    const proc = childProcess.spawn("fallocate", [
      "-l",
      String(totalBytes),
      destPath,
    ]);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`fallocate exit ${code}`)),
    );
    proc.on("error", reject);
  });

  const fd = fs.openSync(destPath, "r+");
  const streamBytesDone = new Array(N_STREAMS).fill(0);
  let completedStreams = 0;
  let errorStream = null;

  // Progress polling
  let prevDone = 0;
  let prevTime = Date.now();
  job._pollTimer = setInterval(() => {
    const done = streamBytesDone.reduce((a, b) => a + b, 0);
    const now = Date.now();
    const elapsed = (now - prevTime) / 1000;
    if (elapsed > 0 && totalBytes > 0) {
      job.percent = Math.min(100, Math.round((done / totalBytes) * 100));
      const bytesPerSec = (done - prevDone) / elapsed;
      const mbps = bytesPerSec / (1024 * 1024);
      if (mbps >= 1024) job.rate = `${(mbps / 1024).toFixed(2)}GB/s`;
      else if (mbps >= 1) job.rate = `${mbps.toFixed(1)}MB/s`;
      else job.rate = `${(mbps * 1024).toFixed(0)}KB/s`;
      const remaining = totalBytes - done;
      const etaSecs = bytesPerSec > 0 ? Math.round(remaining / bytesPerSec) : 0;
      const eh = Math.floor(etaSecs / 3600);
      const em = Math.floor((etaSecs % 3600) / 60);
      const es = etaSecs % 60;
      job.eta =
        eh > 0
          ? `${eh}:${String(em).padStart(2, "0")}:${String(es).padStart(2, "0")}`
          : `${em}:${String(es).padStart(2, "0")}`;
    }
    prevDone = done;
    prevTime = now;
  }, PROGRESS_INTERVAL_MS);

  await new Promise((resolve) => {
    for (let i = 0; i < N_STREAMS; i++) {
      const skipBlocks = i * blocksPerStream;
      const countBlocks = Math.min(blocksPerStream, totalBlocks - skipBlocks);
      if (countBlocks <= 0) {
        if (++completedStreams === N_STREAMS) resolve();
        continue;
      }

      const fileOffset = skipBlocks * BS;
      const proc = childProcess.spawn("ssh", [
        "-o",
        "Compression=no",
        USB_HOST,
        `dd if='${filePath}' bs=${BS} skip=${skipBlocks} count=${countBlocks} 2>/dev/null`,
      ]);
      job._procs.push(proc);

      let writeOffset = fileOffset;
      proc.stdout.on("data", (chunk) => {
        fs.writeSync(fd, chunk, 0, chunk.length, writeOffset);
        writeOffset += chunk.length;
        streamBytesDone[i] += chunk.length;
      });
      proc.on("close", (code) => {
        if (code !== 0 && errorStream === null) errorStream = i;
        if (++completedStreams === N_STREAMS) resolve();
      });
      proc.on("error", () => {
        if (++completedStreams === N_STREAMS) resolve();
      });
    }
  });

  clearInterval(job._pollTimer);
  job._pollTimer = null;
  job._procs = [];
  fs.closeSync(fd);

  if (errorStream !== null) {
    job.status = `Error (stream ${errorStream})`;
    return;
  }

  job.percent = 100;
  job.status = "Finished";
  childProcess.spawn("ssh", [
    USB_HOST,
    `touch -- '${filePath}.tv-done'; rm -f -- '${filePath}.lftp-pget-status'`,
  ]);
}

async function findVideoFilesInPath(remotePath) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn("ssh", [
      USB_HOST,
      `find '${remotePath}' -type f \\( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.avi' -o -iname '*.m4v' -o -iname '*.ts' \\) -printf '%p\t%s\n' 2>/dev/null | while IFS='\t' read -r p s; do [ ! -f "\${p}.tv-done" ] && printf '%s\t%s\n' "\$p" "\$s"; done`,
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
      if (startCopyFile(filePath, size)) anyStarted = true;
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
    if (job._pollTimer) {
      clearInterval(job._pollTimer);
      job._pollTimer = null;
    }
    for (const proc of job._procs || []) {
      try {
        proc.kill();
      } catch {}
    }
    job._procs = [];
    if (job.status === "Downloading") job.status = "Killed";
  }
}
