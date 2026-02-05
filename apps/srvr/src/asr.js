import { spawn, execFile } from "child_process";
import * as path from "path";

const ASR_BIN = "/root/dev/apps/tv/apps/asr/asr.sh";
const MEDIA_ROOT = "/mnt/media/tv";
const MAX_ASR_WS_CHUNK = 8 * 1024;

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
      console.error("[ASR TAIL] ws send error", e);
      return false;
    }
  }
  return true;
}

export function handleAsr(ws, id, param) {
  let parsedParam = param;
  if (typeof param === "string") {
    try {
      parsedParam = JSON.parse(param);
    } catch (e) {
      console.error("[handleAsr] failed to parse param:", param);
    }
  }
  const { action, path: reqPath } = parsedParam || {};
  console.log(`[handleAsr] action=${action} reqPath=${reqPath}`);

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
        console.error("asr start send error", e);
      }
    });
  } else if (action === "tail") {
    if (ws._asrTailProc) {
      ws._asrTailProc.kill();
      ws._asrTailProc = null;
    }

    const proc = spawn(ASR_BIN, ["tail", targetPath]);
    ws._asrTailProc = proc;

    proc.stdout.on("data", (data) => {
      // Prevent zombie processes from sending data
      if (ws._asrTailProc !== proc) return;

      const text = data.toString();
      console.log(`[ASR TAIL] data: ${text.length} bytes`);
      sendAsrChunks(ws, text);
    });

    proc.stderr.on("data", (data) => {
      const text = data.toString();
      console.log(`[ASR TAIL] stderr: ${text.length} bytes`);
      sendAsrChunks(ws, "ERR: " + text);
    });

    proc.on("close", (code) => {
      ws._asrTailProc = null;
    });

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
        console.error("asr kill send error", e);
      }
    });
  }
}
