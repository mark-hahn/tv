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
const N_STREAMS = 8;

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

// Returns true if a new download job was started, false if skipped.
function startRsyncFile(filePath, totalBytes) {
  if (jobs.has(filePath)) return false;
  const nameParts = filePath.split("/");
  const basename = nameParts[nameParts.length - 1];
  const destPath = `${LOCAL_MOVIES_PATH}/${basename}`;

  try {
    const stat = fs.statSync(destPath);
    if (totalBytes > 0 && stat.size >= totalBytes) return false;
  } catch {}

  childProcess.spawnSync("pkill", ["-f", `rsync.*${basename}`]);

  const job = {
    name: basename,
    status: "Splitting",
    percent: 0,
    total_bytes: totalBytes || 0,
    rate: "",
    eta: "",
    _procs: [],
  };
  jobs.set(filePath, job);

  runSplitRsync(filePath, basename, destPath, totalBytes, job).catch(() => {
    if (["Splitting", "Downloading", "Combining"].includes(job.status))
      job.status = "Error";
  });

  return true;
}

async function runSplitRsync(filePath, basename, destPath, totalBytes, job) {
  const fileDir = filePath.split("/").slice(0, -1).join("/");
  const chunkPrefix = `.chk_${basename}_`;
  const usbChunkPrefix = `${fileDir}/${chunkPrefix}`;
  const chunkSize =
    totalBytes > 0 ? Math.ceil(totalBytes / N_STREAMS) : 1073741824;

  // Step 1: split file on USB
  const splitOk = await new Promise((resolve) => {
    const proc = childProcess.spawn("ssh", [
      USB_HOST,
      `split -b ${chunkSize} -- '${filePath}' '${usbChunkPrefix}' && echo SPLIT_DONE`,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.on("close", (code) =>
      resolve(code === 0 && out.includes("SPLIT_DONE")),
    );
    proc.on("error", () => resolve(false));
  });
  if (!splitOk) {
    job.status = "Error (split)";
    return;
  }

  // Get sorted chunk list from USB
  const chunkPaths = await new Promise((resolve) => {
    const proc = childProcess.spawn("ssh", [
      USB_HOST,
      `ls '${usbChunkPrefix}'* 2>/dev/null | sort`,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.on("close", () => resolve(out.trim().split("\n").filter(Boolean)));
    proc.on("error", () => resolve([]));
  });
  if (chunkPaths.length === 0) {
    job.status = "Error (no chunks)";
    return;
  }

  // Step 2: rsync all chunks in parallel
  job.status = "Downloading";
  const n = chunkPaths.length;
  const chunkBytesDone = new Array(n).fill(0);
  const chunkStartOffsets = new Array(n).fill(0);
  const chunkRatesMBps = new Array(n).fill(0);
  const chunkEtaSecs = new Array(n).fill(0);
  let errorChunk = null;
  let completedCount = 0;

  await new Promise((resolve) => {
    for (let i = 0; i < n; i++) {
      const chunkPath = chunkPaths[i];
      const chunkName = chunkPath.split("/").pop();
      const localChunk = `${LOCAL_MOVIES_PATH}/${chunkName}`;
      try {
        chunkStartOffsets[i] = fs.statSync(localChunk).size;
      } catch {}

      const proc = childProcess.spawn("rsync", [
        "-e",
        "ssh",
        "--progress",
        "--append",
        "--",
        `${USB_HOST}:${chunkPath}`,
        `${LOCAL_MOVIES_PATH}/`,
      ]);
      job._procs.push(proc);

      let buf = "";
      const onData = (data) => {
        buf += data.toString();
        const lines = buf.split(/[\r\n]+/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const p = parseRsyncProgress(line.trim());
          if (!p) continue;
          chunkBytesDone[i] = chunkStartOffsets[i] + p.bytes_done;
          const rm = p.rate.match(/^([\d.]+)(KB|MB|GB)\/s$/i);
          if (rm) {
            let mbps = parseFloat(rm[1]);
            const u = rm[2].toUpperCase();
            if (u === "GB") mbps *= 1024;
            if (u === "KB") mbps /= 1024;
            chunkRatesMBps[i] = mbps;
          }
          const ep = p.eta.split(":").map(Number);
          if (ep.length === 3)
            chunkEtaSecs[i] = ep[0] * 3600 + ep[1] * 60 + ep[2];
          else if (ep.length === 2) chunkEtaSecs[i] = ep[0] * 60 + ep[1];

          if (totalBytes > 0) {
            const done = chunkBytesDone.reduce((a, b) => a + b, 0);
            job.percent = Math.min(100, Math.round((done / totalBytes) * 100));
          }
          const totalMBps = chunkRatesMBps.reduce((a, b) => a + b, 0);
          if (totalMBps >= 1024)
            job.rate = `${(totalMBps / 1024).toFixed(2)}GB/s`;
          else if (totalMBps >= 1) job.rate = `${totalMBps.toFixed(1)}MB/s`;
          else job.rate = `${(totalMBps * 1024).toFixed(0)}KB/s`;
          const maxEta = Math.max(...chunkEtaSecs);
          const eh = Math.floor(maxEta / 3600);
          const em = Math.floor((maxEta % 3600) / 60);
          const es = maxEta % 60;
          job.eta =
            eh > 0
              ? `${eh}:${String(em).padStart(2, "0")}:${String(es).padStart(2, "0")}`
              : `${em}:${String(es).padStart(2, "0")}`;
        }
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      proc.on("close", (code) => {
        if (code !== 0 && errorChunk === null) errorChunk = i;
        if (++completedCount === n) resolve();
      });
      proc.on("error", () => {
        if (++completedCount === n) resolve();
      });
    }
  });

  job._procs = [];
  if (errorChunk !== null) {
    job.status = `Error (chunk ${errorChunk})`;
    return;
  }

  // Step 3: concatenate chunks into final file
  job.status = "Combining";
  const localChunks = chunkPaths.map(
    (cp) => `${LOCAL_MOVIES_PATH}/${cp.split("/").pop()}`,
  );
  const catCmd = `cat ${localChunks.map((p) => `'${p}'`).join(" ")} > '${destPath}'`;
  const catOk = await new Promise((resolve) => {
    const proc = childProcess.spawn("sh", ["-c", catCmd]);
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
  if (!catOk) {
    job.status = "Error (combine)";
    return;
  }

  job.percent = 100;
  job.status = "Finished";

  // Clean up local chunks
  for (const p of localChunks) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }

  // Clean up USB chunks and rename source to .done
  const rmList = chunkPaths.map((p) => `'${p}'`).join(" ");
  childProcess.spawn("ssh", [
    USB_HOST,
    `rm -f ${rmList} && mv -- '${filePath}' '${filePath}.done'`,
  ]);
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
    for (const proc of job._procs || []) {
      try {
        proc.kill();
      } catch {}
    }
    job._procs = [];
    if (["Splitting", "Downloading", "Combining"].includes(job.status)) {
      job.status = "Killed";
    }
  }
}
