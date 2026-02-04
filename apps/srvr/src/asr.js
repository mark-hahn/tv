import { spawn, execFile } from "child_process";
import * as path from "path";

const ASR_BIN = "/root/dev/apps/tv/apps/asr/asr.sh";
const MEDIA_ROOT = "/mnt/media/tv";
const SHOW_RAW = false;

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
      console.log(`[ASR TAIL] data: ${data.length} bytes`);
      try {
        let textToSend = data.toString();
        if (!SHOW_RAW) {
          // Process lines to add timestamps
          const now = new Date();
          const timeStr = now.toLocaleTimeString("en-US", { hour12: false });
          // Split by newline
          let lines = textToSend.split("\n");

          // Filter out RAW lines if needed
          lines = lines.filter((line) => {
            if (!line.trim()) return true; // keep empty lines for now (except trailing handled below)
            return !line.includes("RAW:");
          });

          // If the last element is empty string (due to trailing \n), keep it empty.
          textToSend = lines
            .map((line, idx) => {
              if (idx === lines.length - 1 && line === "") return "";
              if (!line.trim()) return line; // preserve empty lines without timestamp?
              return `[${timeStr}] ${line}`;
            })
            .join("\n");
        }

        ws.send(
          JSON.stringify({
            id: "0",
            status: "asr-log",
            data: textToSend,
          }),
        );
      } catch (e) {
        console.error("[ASR TAIL] ws send error", e);
        proc.kill();
      }
    });

    proc.stderr.on("data", (data) => {
      console.log(`[ASR TAIL] stderr: ${data}`);
      try {
        ws.send(
          JSON.stringify({
            id: "0",
            status: "asr-log",
            data: "ERR: " + data.toString(),
          }),
        );
      } catch (e) {
        proc.kill();
      }
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
