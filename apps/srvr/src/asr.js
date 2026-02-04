import { spawn, execFile } from "child_process";

const ASR_BIN = "/usr/local/bin/asr";

export function handleAsr(ws, id, param) {
  const { action, path } = param || {};

  if (action === "start") {
    execFile(ASR_BIN, [path], (error, stdout, stderr) => {
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

    const proc = spawn(ASR_BIN, ["tail", path]);
    ws._asrTailProc = proc;

    proc.stdout.on("data", (data) => {
      try {
        ws.send(
          JSON.stringify({
            id: "0",
            status: "asr-log",
            data: data.toString(),
          }),
        );
      } catch (e) {
        proc.kill();
      }
    });

    proc.stderr.on("data", (data) => {
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
    execFile(ASR_BIN, ["status", path], (error, stdout, stderr) => {
      const running = stdout && stdout.includes("asr is running");
      try {
        ws.send(
          JSON.stringify({ id, status: "ok", data: { running, stdout } }),
        );
      } catch (e) {}
    });
  } else if (action === 'kill') {
    execFile(ASR_BIN, ['kill', path], (error, stdout, stderr) => {
          const result = error ? { error: error.message, stderr } : { stdout };
          try {
              ws.send(JSON.stringify({ id, status: 'ok', data: result }));
          } catch(e) { console.error('asr kill send error', e); }
    });
  }
}
