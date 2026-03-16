import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";

const MEDIA_ROOT = "/mnt/media/tv";
const MAX_FIX_WS_CHUNK = 8 * 1024;

let fixProc = null;

function sendFixChunks(ws, text) {
  if (!text) return false;
  if (!ws || ws.readyState !== 1) return false;
  for (let i = 0; i < text.length; i += MAX_FIX_WS_CHUNK) {
    const chunk = text.slice(i, i + MAX_FIX_WS_CHUNK);
    try {
      ws.send(
        JSON.stringify({
          id: "0",
          status: "fix-log",
          data: chunk,
        }),
      );
    } catch (e) {
      console.error("[FIX] ws send error", e);
      return false;
    }
  }
  return true;
}

function resolvePath(reqPath) {
  let targetPath = reqPath || "";
  if (targetPath && !path.isAbsolute(targetPath)) {
    targetPath = path.resolve(MEDIA_ROOT, targetPath);
  }
  return targetPath;
}

function startFfmpeg(ws, id, targetPath) {
  if (fixProc) {
    try {
      ws.send(
        JSON.stringify({
          id,
          status: "ok",
          data: { error: "ffmpeg is already running" },
        }),
      );
    } catch (e) {}
    return;
  }

  // targetPath can be a single file or a directory
  // For a directory, find all video files and re-encode them
  // For a single file, re-encode just that file
  const isDir =
    fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();

  let filesToProcess = [];
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

  if (filesToProcess.length === 0) {
    try {
      ws.send(
        JSON.stringify({
          id,
          status: "ok",
          data: { error: "No video files found in " + targetPath },
        }),
      );
    } catch (e) {}
    return;
  }

  // Reply immediately so client knows we started
  try {
    ws.send(
      JSON.stringify({
        id,
        status: "ok",
        data: { stdout: "Starting ffmpeg..." },
      }),
    );
  } catch (e) {}

  processFiles(ws, filesToProcess, 0);
}

function processFiles(ws, files, idx) {
  if (idx >= files.length) {
    sendFixChunks(ws, "\n[fix] EXIT code=0\n");
    fixProc = null;
    return;
  }

  const inputFile = files[idx];
  const dir = path.dirname(inputFile);
  const ext = path.extname(inputFile);
  const base = path.basename(inputFile, ext);
  const tmpFile = path.join(dir, base + ".fix" + ext);

  sendFixChunks(
    ws,
    `\n--- [${idx + 1}/${files.length}] ${path.basename(inputFile)} ---\n`,
  );

  const args = [
    "-i",
    inputFile,
    "-map",
    "0",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-c:a",
    "copy",
    "-c:s",
    "copy",
    "-y",
    tmpFile,
  ];

  const proc = spawn("ffmpeg", args);
  fixProc = proc;

  proc.stdout.on("data", (data) => {
    sendFixChunks(ws, data.toString());
  });

  proc.stderr.on("data", (data) => {
    sendFixChunks(ws, data.toString());
  });

  proc.on("error", (err) => {
    sendFixChunks(ws, `\n[fix] ERROR: ${err.message}\n`);
    fixProc = null;
  });

  proc.on("close", (code, signal) => {
    if (fixProc !== proc) return; // killed

    if (code === 0) {
      // Replace original with re-encoded file
      try {
        fs.renameSync(inputFile, inputFile + ".bak");
        fs.renameSync(tmpFile, inputFile);
        fs.unlinkSync(inputFile + ".bak");
        sendFixChunks(ws, `[fix] Replaced ${path.basename(inputFile)}\n`);
      } catch (e) {
        sendFixChunks(ws, `[fix] Rename error: ${e.message}\n`);
      }
      processFiles(ws, files, idx + 1);
    } else {
      sendFixChunks(ws, `\n[fix] EXIT code=${code} signal=${signal}\n`);
      // Clean up temp file on failure
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch (e) {}
      fixProc = null;
    }
  });
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
    const running = fixProc !== null;
    try {
      ws.send(JSON.stringify({ id, status: "ok", data: { running } }));
    } catch (e) {}
  } else if (action === "kill") {
    if (fixProc) {
      fixProc.kill("SIGTERM");
      fixProc = null;
    }
    try {
      ws.send(
        JSON.stringify({ id, status: "ok", data: { stdout: "Kill sent" } }),
      );
    } catch (e) {}
  }
}
