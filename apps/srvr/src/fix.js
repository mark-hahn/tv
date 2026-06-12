import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const MEDIA_ROOT = "/mnt/media/tv";
const FIX_STATE_PATH = "/root/dev/apps/tv/apps/srvr/data/fix-state.json";
const FIX_LOG_PATH = "/root/dev/apps/tv/apps/srvr/data/fix-log.txt";
const FIX_RUNNER_PATH = fileURLToPath(
  new URL("./fix-runner.js", import.meta.url),
);

function ensureFixStateDir() {
  fs.mkdirSync(path.dirname(FIX_STATE_PATH), { recursive: true });
}

function writeJson(filePath, value) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readFixState() {
  const state = readJson(FIX_STATE_PATH);
  if (!state) return null;
  const runnerAlive = isPidRunning(state.pid);
  return {
    ...state,
    runnerAlive,
    running: state.status === "running" && runnerAlive,
  };
}

function writeFixState(state) {
  ensureFixStateDir();
  writeJson(FIX_STATE_PATH, state);
}

function listVideoFiles(targetPath) {
  const isDir =
    fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();

  const filesToProcess = [];
  const VIDEO_EXTS = new Set([
    "mkv",
    "avi",
    "mp4",
    "m4v",
    "mov",
    "wmv",
    "webm",
    "mpg",
    "mpeg",
    "ts",
    "m2ts",
  ]);

  if (isDir) {
    const entries = fs.readdirSync(targetPath);
    for (const entry of entries) {
      const ext = path.extname(entry).slice(1).toLowerCase();
      if (VIDEO_EXTS.has(ext)) {
        filesToProcess.push(path.join(targetPath, entry));
      }
    }
    filesToProcess.sort();
  } else {
    filesToProcess.push(targetPath);
  }

  return filesToProcess;
}

function resolvePath(reqPath) {
  let targetPath = reqPath || "";
  if (targetPath && !path.isAbsolute(targetPath)) {
    targetPath = path.resolve(MEDIA_ROOT, targetPath);
  }
  return targetPath;
}

function sendReply(ws, id, status, data) {
  try {
    ws.send(JSON.stringify({ id, status, data }));
  } catch (e) {}
}

function startFfmpeg(ws, id, targetPath) {
  const activeState = readFixState();
  if (activeState?.running) {
    sendReply(ws, id, "ok", { error: "ffmpeg is already running" });
    return;
  }

  const filesToProcess = listVideoFiles(targetPath);
  if (filesToProcess.length === 0) {
    sendReply(ws, id, "ok", {
      error: "No video files found in " + targetPath,
    });
    return;
  }

  ensureFixStateDir();
  fs.writeFileSync(FIX_LOG_PATH, "");

  const state = {
    status: "starting",
    pid: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    targetPath,
    currentFile: null,
    currentIndex: 0,
    totalFiles: filesToProcess.length,
    files: filesToProcess,
    logPath: FIX_LOG_PATH,
  };
  writeFixState(state);

  const proc = spawn(process.execPath, [FIX_RUNNER_PATH, FIX_STATE_PATH], {
    detached: true,
    stdio: "ignore",
  });
  proc.unref();

  state.pid = proc.pid;
  state.status = "running";
  state.updatedAt = Date.now();
  writeFixState(state);

  sendReply(ws, id, "ok", {
    stdout: "Starting ffmpeg...",
    running: true,
    currentPath: targetPath,
    totalFiles: filesToProcess.length,
  });
}

function tailFixLog(offset = 0) {
  const state = readFixState();
  const logExists = fs.existsSync(FIX_LOG_PATH);
  const stat = logExists ? fs.statSync(FIX_LOG_PATH) : null;
  const size = stat ? stat.size : 0;
  const start =
    Number.isFinite(offset) && offset > 0 && offset <= size ? offset : 0;
  const log = logExists
    ? fs.readFileSync(FIX_LOG_PATH, "utf8").slice(start)
    : "";

  return {
    running: state?.running === true,
    status: state?.status ?? null,
    currentPath: state?.targetPath ?? null,
    currentFile: state?.currentFile ?? null,
    currentIndex: state?.currentIndex ?? 0,
    totalFiles: state?.totalFiles ?? 0,
    log,
    nextOffset: size,
  };
}

export function handleFix(ws, id, params) {
  const { action, path: reqPath } = params || {};

  let targetPath = resolvePath(reqPath);

  // Security check: ensure we are within MEDIA_ROOT
  if (targetPath && !targetPath.startsWith(MEDIA_ROOT)) {
    try {
      ws.send(JSON.stringify({ id, status: "error", error: "Invalid path" }));
    } catch (e) {}
    return;
  }

  if (action === "start") {
    startFfmpeg(ws, id, targetPath);
  } else if (action === "check") {
    const state = readFixState();
    sendReply(ws, id, "ok", {
      running: state?.running === true,
      status: state?.status ?? null,
      currentPath: state?.targetPath ?? null,
      currentFile: state?.currentFile ?? null,
      currentIndex: state?.currentIndex ?? 0,
      totalFiles: state?.totalFiles ?? 0,
      hasLog: fs.existsSync(FIX_LOG_PATH) && fs.statSync(FIX_LOG_PATH).size > 0,
    });
  } else if (action === "tail") {
    sendReply(ws, id, "ok", tailFixLog(Number(params?.offset) || 0));
  } else if (action === "kill") {
    const state = readFixState();
    if (state?.running && Number.isInteger(state.pid)) {
      try {
        process.kill(state.pid, "SIGTERM");
      } catch (e) {}
    }
    sendReply(ws, id, "ok", { stdout: "Kill sent" });
  }
}
