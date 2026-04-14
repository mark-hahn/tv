import { spawn } from "child_process";
import * as fs from "fs";

const EMB_LOG_PATH = "/root/dev/apps/tv/apps/asr/data/emb.log";
const MAX_CHUNK = 8 * 1024;
const TAIL_RESTART_MS = 1000;

function sendChunks(ws, text, statusKey) {
  if (!text) return false;
  if (!ws || ws.readyState !== 1) return false;
  for (let i = 0; i < text.length; i += MAX_CHUNK) {
    try {
      ws.send(
        JSON.stringify({
          id: "0",
          status: statusKey,
          data: text.slice(i, i + MAX_CHUNK),
        }),
      );
    } catch (e) {
      return false;
    }
  }
  return true;
}

function startEmbTail(ws) {
  if (ws._embTailProc) {
    ws._embTailProc.kill();
    ws._embTailProc = null;
  }

  const proc = spawn("tail", ["-n", "200", "-f", EMB_LOG_PATH]);
  ws._embTailProc = proc;

  proc.stdout.on("data", (data) => {
    if (ws._embTailProc !== proc) return;
    sendChunks(ws, data.toString(), "emb-log");
  });

  proc.stderr.on("data", () => {});
  proc.on("error", () => {});

  proc.on("close", () => {
    if (ws._embTailProc === proc) ws._embTailProc = null;
    if (ws.readyState === 1) {
      setTimeout(() => {
        if (ws.readyState === 1 && !ws._embTailProc) startEmbTail(ws);
      }, TAIL_RESTART_MS);
    }
  });
}

export function handleEmb(ws, id, params) {
  const { action } = params || {};

  if (action === "tail") {
    startEmbTail(ws);

    if (!ws._embCleanupAttached) {
      ws.on("close", () => {
        if (ws._embTailProc) {
          ws._embTailProc.kill();
          ws._embTailProc = null;
        }
      });
      ws._embCleanupAttached = true;
    }

    try {
      ws.send(JSON.stringify({ id, status: "ok", data: "tailing" }));
    } catch (e) {}
  } else if (action === "clear") {
    try {
      fs.writeFileSync(EMB_LOG_PATH, "", "utf8");
    } catch (e) {}
    try {
      ws.send(JSON.stringify({ id, status: "ok" }));
    } catch (e) {}
  }
}
