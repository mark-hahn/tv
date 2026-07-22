import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

const STATE_PATH = process.argv[2];

if (!STATE_PATH) {
  throw new Error("Missing fix state path");
}

let activeProc = null;
let shuttingDown = false;
let stderrBuf = "";
let progressTimer = null;
let lastProgress = "";
const PROGRESS_INTERVAL_MS = 250;

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(nextState) {
  const tmpPath = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(nextState, null, 2));
  fs.renameSync(tmpPath, STATE_PATH);
}

function patchState(patch) {
  const state = loadState();
  const nextState = {
    ...state,
    ...patch,
    updatedAt: Date.now(),
  };
  saveState(nextState);
  return nextState;
}

function appendLog(text) {
  if (!text) return;
  const state = loadState();
  fs.appendFileSync(state.logPath, text);
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function flushProgress() {
  if (lastProgress) {
    appendLog("\r" + lastProgress);
    lastProgress = "";
  }
}

function processStderr(raw) {
  stderrBuf += stripAnsi(raw.toString());

  while (true) {
    const nIdx = stderrBuf.indexOf("\n");
    const rIdx = stderrBuf.indexOf("\r");

    if (nIdx === -1 && rIdx === -1) break;

    if (nIdx !== -1 && (rIdx === -1 || nIdx <= rIdx)) {
      const line = stderrBuf.slice(0, nIdx + 1);
      stderrBuf = stderrBuf.slice(nIdx + 1);
      flushProgress();
      appendLog(line);
    } else {
      const line = stderrBuf.slice(0, rIdx);
      stderrBuf = stderrBuf.slice(rIdx + 1);
      if (line.length > 0) {
        lastProgress = line;
        if (!progressTimer) {
          progressTimer = setInterval(() => {
            if (lastProgress) {
              flushProgress();
            } else {
              clearInterval(progressTimer);
              progressTimer = null;
            }
          }, PROGRESS_INTERVAL_MS);
        }
      }
    }
  }
}

function resetProgressState() {
  stderrBuf = "";
  lastProgress = "";
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function currentPaths(inputFile) {
  const dir = path.dirname(inputFile);
  const ext = path.extname(inputFile);
  const base = path.basename(inputFile, ext);
  return {
    tmpFile: path.join(dir, base + ".fix-tmp.mkv"),
    finalFile: path.join(dir, base + ".mkv.fixed"),
  };
}

function cleanupTmp(inputFile) {
  const { tmpFile } = currentPaths(inputFile);
  try {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  } catch (e) {}
}

async function encodeFile(inputFile, idx, totalFiles) {
  patchState({
    currentFile: inputFile,
    currentIndex: idx + 1,
    status: "running",
  });
  appendLog(
    `\n--- [${idx + 1}/${totalFiles}] ${path.basename(inputFile)} ---\n`,
  );

  const { tmpFile, finalFile } = currentPaths(inputFile);
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

  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    activeProc = proc;

    proc.stdout.on("data", (data) => {
      appendLog(data.toString());
    });

    proc.stderr.on("data", (data) => {
      processStderr(data);
    });

    proc.on("error", (err) => {
      appendLog(`\n[fix] ERROR: ${err.message}\n`);
      activeProc = null;
      reject(err);
    });

    proc.on("close", (code, signal) => {
      flushProgress();
      resetProgressState();
      activeProc = null;

      if (code === 0) {
        try {
          fs.renameSync(tmpFile, finalFile);
          appendLog(
            `[fix] Done ${path.basename(finalFile)} (original untouched)\n`,
          );
          resolve();
        } catch (err) {
          appendLog(`[fix] Rename error: ${err.message}\n`);
          reject(err);
        }
      } else {
        appendLog(`\n[fix] EXIT code=${code} signal=${signal}\n`);
        cleanupTmp(inputFile);
        reject(new Error(`ffmpeg exited with code=${code} signal=${signal}`));
      }
    });
  });
}

function terminateRunner() {
  shuttingDown = true;
  if (activeProc) {
    try {
      activeProc.kill("SIGTERM");
    } catch (e) {}
  }
}

process.on("SIGTERM", terminateRunner);
process.on("SIGINT", terminateRunner);

async function main() {
  const initialState = patchState({
    pid: process.pid,
    status: "running",
    currentFile: null,
    currentIndex: 0,
  });

  try {
    for (let idx = 0; idx < initialState.files.length; idx += 1) {
      if (shuttingDown) {
        throw new Error("Fix cancelled");
      }
      await encodeFile(initialState.files[idx], idx, initialState.files.length);
    }

    appendLog("\n[fix] EXIT code=0\n");
    patchState({
      status: "completed",
      currentFile: null,
      currentIndex: initialState.files.length,
      finishedAt: Date.now(),
    });
  } catch (err) {
    const status = shuttingDown ? "killed" : "failed";
    if (shuttingDown) {
      appendLog("\n[fix] EXIT code=null signal=SIGTERM\n");
    }
    patchState({
      status,
      currentFile: null,
      finishedAt: Date.now(),
      error: err.message,
    });
    if (!shuttingDown) {
      process.exitCode = 1;
    }
  }
}

await main();
