import { spawn, execFile } from "child_process";
import * as path from "path";
import { unilog } from "@tv/share";

const ASR_BIN = "/root/dev/apps/tv/apps/asr/asr.sh";
const MEDIA_ROOT = "/mnt/media/tv";
const MAX_ASR_WS_CHUNK = 8 * 1024;
const ASR_TAIL_RESTART_MS = 1000;

function sendAsrChunks(ws, text) {
  if (!text) return false;
  if (!ws || ws.readyState !== 1) return false;
  for (let i = 0; i < text.length; i += MAX_ASR_WS_CHUNK) {
    const chunk = text.slice(i, i + MAX_ASR_WS_CHUNK);
    try {
      ws.send(
        JSON.stringify({
          id: "0",
          status: "asr-log",
          data: chunk,
        }),
      );
    } catch (e) {
      unilog(686, "ws send error", e);
      return false;
    }
  }
  return true;
}

function startTail(ws, targetPath) {
  if (ws._asrTailProc) {
    ws._asrTailProc.kill();
    ws._asrTailProc = null;
  }

  const proc = spawn(ASR_BIN, ["tail", targetPath]);
  ws._asrTailProc = proc;
  ws._asrTailPath = targetPath;

  proc.stdout.on("data", (data) => {
    if (ws._asrTailProc !== proc) return;
    const text = data.toString();
    sendAsrChunks(ws, text);
  });

  proc.stderr.on("data", (data) => {
    if (ws._asrTailProc !== proc) return;
    const text = data.toString();
    sendAsrChunks(ws, "ERR: " + text);
  });

  proc.on("error", (err) => {});

  proc.on("close", (code, signal) => {
    if (ws._asrTailProc === proc) {
      ws._asrTailProc = null;
    }
    if (ws.readyState === 1 && ws._asrTailPath) {
      setTimeout(() => {
        if (ws.readyState === 1 && !ws._asrTailProc) {
          startTail(ws, ws._asrTailPath);
        }
      }, ASR_TAIL_RESTART_MS);
    }
  });
}

export function handleAsr(ws, id, params) {
  const { action, path: reqPath } = params || {};

  let targetPath = reqPath || "";
  // Resolve path relative to MEDIA_ROOT if it's not absolute
  if (targetPath && !path.isAbsolute(targetPath)) {
    targetPath = path.resolve(MEDIA_ROOT, targetPath);
  }

  // Security check: ensure we are within MEDIA_ROOT
  if (targetPath && !targetPath.startsWith(MEDIA_ROOT)) {
    try {
      ws.send(JSON.stringify({ id, status: "error", error: "Invalid path" }));
    } catch (e) {}
    return;
  }

  if (action === "start") {
    execFile(ASR_BIN, [targetPath], (error, stdout, stderr) => {
      const result = error ? { error: error.message, stderr } : { stdout };
      try {
        ws.send(JSON.stringify({ id, status: "ok", data: result }));
      } catch (e) {
        unilog(687, "asr start send error", e);
      }
    });
  } else if (action === "tail") {
    startTail(ws, targetPath);

    if (!ws._asrCleanupAttached) {
      ws.on("close", () => {
        if (ws._asrTailProc) {
          ws._asrTailProc.kill();
          ws._asrTailProc = null;
        }
      });
      ws._asrCleanupAttached = true;
    }

    try {
      ws.send(JSON.stringify({ id, status: "ok", data: "tailing" }));
    } catch (e) {}
  } else if (action === "check") {
    execFile(ASR_BIN, ["status", targetPath], (error, stdout, stderr) => {
      const running = stdout && stdout.includes("asr is running");
      try {
        ws.send(
          JSON.stringify({ id, status: "ok", data: { running, stdout } }),
        );
      } catch (e) {}
    });
  } else if (action === "clear") {
    execFile(ASR_BIN, ["clear", targetPath], (error, stdout, stderr) => {
      try {
        ws.send(JSON.stringify({ id, status: "ok" }));
      } catch (e) {}
    });
  } else if (action === "kill") {
    execFile(ASR_BIN, ["kill", targetPath], (error, stdout, stderr) => {
      const result = error ? { error: error.message, stderr } : { stdout };
      try {
        ws.send(JSON.stringify({ id, status: "ok", data: result }));
      } catch (e) {
        unilog(688, "asr kill send error", e);
      }
    });
  }
}
