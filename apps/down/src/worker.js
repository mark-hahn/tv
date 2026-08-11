// worker_threads entrypoint (no shared buffers)
// - receives a copy of the entry object
// - runs rsync: <usbHost>:<usbPath><title> -> <localPath><title>
// - updates local entry.progress/entry.eta during transfer
// - sends {type:"update", entry} to tvJson.js on updates
// - sends {type:"finished", entry} on completion/error, then exits

import { parentPort, workerData } from "node:worker_threads";
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { logHere, setUnilogSink, unilog } from "@tv/share";

const SRVR_LOG_URL = "http://127.0.0.1:8739/api/log";
const PARTIAL_DIR_PREFIX = ".rsync-tmp-";
// The worker exits as soon as it finishes, so in-flight log POSTs have to be
// awaited before process.exit or they never reach tv-srvr.
const pendingLogPosts = new Set();
setUnilogSink(({ logId, ts, message }) => {
  const post = fetch(SRVR_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logId, pid: "tv-down-worker", ts, message }),
  })
    .catch(() => {})
    .finally(() => pendingLogPosts.delete(post));
  pendingLogPosts.add(post);
});

const flushLogs = async () => {
  while (pendingLogPosts.size) {
    await Promise.all([...pendingLogPosts]);
  }
};

const unixNow = () => Math.floor(Date.now() / 1000);

const { entry: entry0, usbHost } = workerData || {};
let entry = entry0 && typeof entry0 === "object" ? { ...entry0 } : null;

// Track active rsync process so abort messages can kill it.
let rsyncProc = null;

// The per-transfer partial dir is resumable across retries of this same entry,
// but nothing will ever resume it once the entry is aborted or has failed for
// good, so remove it then instead of leaving a multi-GB orphan behind.
const removePartialDir = () => {
  if (!entry || !entry.localPath || entry.procId == null) return;
  const dir = path.join(
    entry.localPath,
    `${PARTIAL_DIR_PREFIX}${entry.procId}`,
  );
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    unilog(2033, `could not remove partial dir ${dir}: ${e.message}`);
  }
};

parentPort.on("message", (msg) => {
  if (msg && msg.type === "abort") {
    try {
      if (rsyncProc) rsyncProc.kill("SIGKILL");
    } catch {}
    removePartialDir();
    try {
      process.exit(0);
    } catch {}
  }
});

const parseEtaSeconds = (chunk) => {
  // rsync progress2 shows remaining time as MM:SS or HH:MM:SS
  const m = chunk.match(/(\d+):(\d+)(?::(\d+))?/);
  if (!m) return null;
  if (m[3] !== undefined) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = parseInt(m[3], 10);
    if (![hh, mm, ss].every(Number.isFinite)) return null;
    return hh * 3600 + mm * 60 + ss;
  }
  const mm2 = parseInt(m[1], 10);
  const ss2 = parseInt(m[2], 10);
  if (![mm2, ss2].every(Number.isFinite)) return null;
  return mm2 * 60 + ss2;
};

const postUpdate = (type) => {
  try {
    parentPort.postMessage({ type, entry });
  } catch {}
};

const summarizeStderr = (stderrText) => {
  const s = String(stderrText || "").trim();
  if (!s) return "";
  // Keep it single-line and reasonably short for tv.log.
  const oneLine = s
    .replace(/[\r\n]+/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
  if (oneLine.length <= 280) return oneLine;
  return oneLine.slice(0, 277) + "...";
};

const escapeForDoubleQuotes = (s) =>
  String(s || "").replace(/([\\"\$`])/g, "\\$1");

const sshExec = (host, remoteCmd, timeoutMs = 15000) => {
  return new Promise((resolve, reject) => {
    const args = [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      host,
      remoteCmd,
    ];
    execFile(
      "ssh",
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 256 },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      },
    );
  });
};

const parseMissingChangeDir = (stderrText) => {
  const s = String(stderrText || "");
  if (!/change_dir\s+"[^"]+"\s+failed:\s+No such file or directory/i.test(s))
    return null;
  const m = s.match(/change_dir\s+"([^"]+)"/i);
  return m && m[1] ? m[1] : null;
};

const locateUsbPathByTitle = async (usbHost1, title1) => {
  if (!usbHost1 || !title1) return null;
  // Find the first exact filename match under ~/files (remote cwd assumed to be $HOME).
  // Using -name for exact match; suppress errors for transient readdir races.
  const cmd = `find files -ignore_readdir_race -type f -name "${escapeForDoubleQuotes(title1)}" -print -quit 2>/dev/null`;
  const res = await sshExec(usbHost1, cmd, 20000);
  const line = String(res.stdout || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find(Boolean);
  if (!line) return null;
  if (!line.startsWith("files/")) return null;
  const dir = path.posix.dirname(line);
  if (!dir || dir === "." || dir === "files") return null;
  const inside = dir.slice("files/".length);
  if (!inside) return null;
  return `files/${inside}/`;
};

const finish = (statusText) => {
  if (!entry) {
    try {
      parentPort.postMessage({
        type: "finished",
        entry: {
          procId: null,
          status: statusText || "error",
          dateEnded: unixNow(),
        },
      });
    } catch {}
    flushLogs().finally(() => {
      try {
        process.exit(0);
      } catch {}
    });
    return;
  }

  entry.status = statusText;
  entry.eta = null;
  entry.dateEnded = unixNow();
  postUpdate("finished");
  flushLogs().finally(() => {
    try {
      process.exit(0);
    } catch {}
  });
};

const main = () => {
  if (!entry || entry.procId == null) {
    finish("bad procId");
    return;
  }

  const usbPath = entry.usbPath;
  const localPath = entry.localPath;
  const title = entry.title;

  if (!usbHost || !usbPath || !localPath || !title) {
    finish("missing fields");
    return;
  }

  const ensureTrailingSlash = (s) =>
    String(s || "").endsWith("/") ? String(s || "") : `${String(s || "")}/`;

  // rsync source/dest per spec
  const makeSrcDst = () => {
    // Strip leading ~/ so --protect-args doesn't break tilde expansion.
    // rsync over SSH defaults the remote cwd to the user's home, so
    // "files/foo/" is equivalent to "~/files/foo/".
    const rawUsbPath = ensureTrailingSlash(entry.usbPath);
    const usbPath2 = rawUsbPath.startsWith("~/")
      ? rawUsbPath.slice(2)
      : rawUsbPath;
    const localPath2 = ensureTrailingSlash(localPath);
    const src = `${usbHost}:${usbPath2}${title}`;
    const dst = `${localPath2}${entry.destTitle || title}`;
    return { src, dst, usbPath2, localPath2 };
  };

  // rsync can exit non-zero after the file has in fact landed intact (e.g. a
  // partial-dir cleanup error at the very end). Returns the byte size when the
  // local file exists and matches the remote size, else null. checkPath is the
  // partial file on a resumed transfer, which writes there instead of to dst.
  const verifyLandedIntact = async (checkPath) => {
    const { src, dst } = makeSrcDst();
    const local = checkPath || dst;
    if (!fs.existsSync(local)) return null;
    let localSize = 0;
    try {
      const st = fs.statSync(local);
      if (!st.isFile()) return null;
      localSize = st.size;
    } catch (e) {
      unilog(2028, `could not stat local file for ${title}: ${e.message}`);
      return null;
    }
    if (localSize <= 0) return null;
    const remotePath = src.slice(src.indexOf(":") + 1);
    let remoteSize = 0;
    try {
      const res = await sshExec(
        usbHost,
        `stat -c %s "${escapeForDoubleQuotes(remotePath)}" 2>/dev/null`,
        20000,
      );
      remoteSize = Number(String(res.stdout || "").trim());
    } catch (e) {
      unilog(2029, `could not stat remote file for ${title}: ${e.message}`);
      return null;
    }
    if (!Number.isFinite(remoteSize) || remoteSize <= 0) return null;
    return localSize === remoteSize ? localSize : null;
  };

  // Ensure our status starts as downloading
  entry.status = "downloading";
  entry.progress = 0;
  entry.eta = null;
  entry.speed = 0;
  entry.dateEnded = null;
  postUpdate("update");

  // Rename any existing same-SxxExx video file to .old right before rsync writes.
  // This is the only place the rename happens — done iff a higher-quality file
  // is actually about to replace it (we already passed the quality gate in main.js).
  {
    const { dst } = makeSrcDst();
    const localDir = path.dirname(dst);
    const seMatch = (entry.destTitle || title).match(/S(\d{2})E(\d{2})/i);
    if (seMatch) {
      const seRe = new RegExp(`S${seMatch[1]}E${seMatch[2]}`, "i");
      const videoExts = new Set([
        "mkv",
        "mp4",
        "avi",
        "mov",
        "m4v",
        "wmv",
        "ts",
        "m2ts",
      ]);
      try {
        const existing = fs.readdirSync(localDir);
        for (const f of existing) {
          if (!seRe.test(f)) continue;
          const ext = f.split(".").pop().toLowerCase();
          if (!videoExts.has(ext)) continue;
          const fPath = path.join(localDir, f);
          let oldDst = fPath + ".old";
          while (fs.existsSync(oldDst)) oldDst = oldDst + ".old";
          try {
            fs.renameSync(fPath, oldDst);
          } catch (e) {
            // ignore rename failure — rsync will still proceed
          }
        }
      } catch (e) {
        // localDir doesn't exist yet — nothing to rename
      }
    }
  }

  // Terminal failure: no retry will resume this entry, so drop its partial dir.
  const failFinish = (statusText) => {
    removePartialDir();
    finish(statusText);
  };

  // rsync writes into the per-transfer partial dir for the whole transfer and
  // only moves the file to its final name at the very end.
  const partialFilePath = () => {
    const { dst } = makeSrcDst();
    return path.join(
      path.dirname(dst),
      `${PARTIAL_DIR_PREFIX}${entry.procId}`,
      path.basename(dst),
    );
  };

  const fileBytes = (p) => {
    const st = fs.statSync(p, { throwIfNoEntry: false });
    return st && st.isFile() ? st.size : 0;
  };

  // Bytes of this transfer that are on disk right now, wherever rsync is
  // currently putting them.
  const bytesOnDisk = () => {
    const { dst } = makeSrcDst();
    return Math.max(fileBytes(partialFilePath()), fileBytes(dst));
  };

  // A transfer that wrote into the partial dir still has to be moved to its
  // real name. Returns false when the move failed and the entry has already
  // been finished with the error.
  const promoteFile = (fromPath) => {
    const { dst } = makeSrcDst();
    if (fromPath === dst) return true;
    try {
      fs.renameSync(fromPath, dst);
    } catch (e) {
      unilog(2131, `could not move finished ${title} into place: ${e.message}`);
      failFinish(`could not move finished file into place: ${e.message}`);
      return false;
    }
    removePartialDir();
    return true;
  };

  const startRsync = async (attempt) => {
    const { src, dst, usbPath2 } = makeSrcDst();

    // fileSize is the exact remote byte count, so bytes-on-disk gives a true
    // percentage. Without it there is nothing to divide by and rsync's own
    // progress output is the only source.
    const totalBytes = Number(entry.fileSize) > 0 ? Number(entry.fileSize) : 0;

    // A restarted tv-down kills the rsyncs it left behind and starts them over
    // against a multi-GB partial. Plain rsync then runs its delta-transfer
    // search across both copies before it sends a byte — on these files that
    // takes longer than the gap between restarts, so the transfer never
    // advanced and the card sat at 0% the whole time. --append-verify sends
    // only the missing tail and checksums the whole file at the end, resending
    // it if the part already here turns out not to match.
    //
    // rsync rejects --append with --partial-dir, so a resume writes straight
    // into the partial file (still hidden from the library scanner inside the
    // partial dir) and the close handler moves it into place.
    const partialPath = partialFilePath();
    const partialBytes = fileBytes(partialPath);

    // The restart can also land on a partial that is already whole: rsync had
    // written every byte and was killed before it could move the file into
    // place. Running rsync again would only rescan a file that is already
    // finished, so confirm the size against the remote and promote it here.
    if (totalBytes > 0 && partialBytes >= totalBytes) {
      const landedBytes = await verifyLandedIntact(partialPath);
      if (landedBytes) {
        unilog(2132, `${title} was already complete in the partial dir at ${landedBytes} bytes — moved into place without re-running rsync`);
        if (!promoteFile(partialPath)) return;
        entry.progress = 100;
        finish("finished");
        return;
      }
    }

    const resuming =
      totalBytes > 0 && partialBytes > 0 && partialBytes < totalBytes;
    const rsyncDst = resuming ? partialPath : dst;

    const rsyncArgs = [
      "-av",
      "--protect-args",
      ...(resuming
        ? ["--append-verify", "--partial"]
        : // Per-transfer partial dir. A shared ".rsync-tmp" is deleted by
          // whichever transfer into this season dir finishes first, which made
          // concurrent transfers fail their final stat/rename after the data
          // had landed.
          [`--partial-dir=${PARTIAL_DIR_PREFIX}${entry.procId}`]),
      "-e",
      "ssh",
      "--timeout=20",
      "--info=progress2",
      src,
      rsyncDst,
    ];
    const p = spawn("rsync", rsyncArgs, { stdio: ["ignore", "pipe", "pipe"] });
    rsyncProc = p;

    // Capture rsync stderr so failures can be diagnosed.
    // Keep last N bytes to avoid unbounded memory use.
    const STDERR_MAX = 8192;
    let stderrBuf = "";

    let lastProgress = entry.progress || 0;
    let lastProgressUpdateTime = 0;
    const progressUpdateInterval = 500;

    // Speed estimate based on byte counter deltas.
    let lastBytes = null;
    let lastBytesTimeMs = null;
    const speedSamples = [];

    const sampleSpeed = (bytes, nowMs) => {
      if (lastBytes != null && lastBytesTimeMs != null && bytes >= lastBytes) {
        const dtSec = (nowMs - lastBytesTimeMs) / 1000;
        if (dtSec > 0) {
          const instBitsPerSec = Math.round(((bytes - lastBytes) * 8) / dtSec);
          speedSamples.push(
            Number.isFinite(instBitsPerSec) && instBitsPerSec >= 0
              ? instBitsPerSec
              : 0,
          );
          while (speedSamples.length > 3) speedSamples.shift();
          const sum = speedSamples.reduce((a, b) => a + b, 0);
          entry.speed = speedSamples.length
            ? Math.round(sum / speedSamples.length)
            : 0;
        }
      }
      lastBytes = bytes;
      lastBytesTimeMs = nowMs;
    };

    // rsync prints nothing on stdout while it is checksumming a resumed
    // partial, which used to leave the card at 0% for the whole scan even
    // though most of the file was already here. Poll the bytes on disk so the
    // card shows the real position from the first tick.
    const DISK_POLL_MS = 1000;
    let diskPollTimer = null;
    let lastPostedBytes = null;
    let lastPostedSpeed = null;

    const pollDisk = () => {
      const bytes = bytesOnDisk();
      sampleSpeed(bytes, Date.now());
      const pct = Math.min(99, Math.floor((bytes / totalBytes) * 100));
      if (pct > lastProgress) {
        lastProgress = pct;
        entry.progress = pct;
      }
      const remaining = totalBytes - bytes;
      entry.eta =
        entry.speed > 0 && remaining > 0
          ? unixNow() + Math.round((remaining * 8) / entry.speed)
          : null;
      if (bytes === lastPostedBytes && entry.speed === lastPostedSpeed) return;
      lastPostedBytes = bytes;
      lastPostedSpeed = entry.speed;
      postUpdate("update");
    };

    const stopDiskPoll = () => {
      if (diskPollTimer) clearInterval(diskPollTimer);
      diskPollTimer = null;
    };

    if (totalBytes) {
      pollDisk();
      diskPollTimer = setInterval(pollDisk, DISK_POLL_MS);
    }

    const parseTransferredBytes = (chunk) => {
      // Typical progress2 lines contain: "   123,456,789  12% ..."
      const m = chunk.match(/\s*([\d,]+)\s+(\d+)%/);
      if (!m) return null;
      const s = m[1].replace(/,/g, "");
      if (!/^\d+$/.test(s)) return null;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : null;
    };

    p.stdout.on("data", (data) => {
      // With a known total the disk poll is the sole source of progress; the
      // stdout stream still has to be drained so the pipe cannot fill up.
      if (totalBytes) return;

      const chunk = data.toString();
      const pm = chunk.match(/(\d+)%/);
      if (!pm) return;

      const pct = parseInt(pm[1], 10);
      if (!Number.isFinite(pct)) return;

      if (
        pct > lastProgress &&
        Date.now() - lastProgressUpdateTime >= progressUpdateInterval
      ) {
        lastProgress = pct;
        lastProgressUpdateTime = Date.now();
        entry.progress = pct;

        const bytes = parseTransferredBytes(chunk);
        if (bytes != null) sampleSpeed(bytes, Date.now());

        const etaSec = parseEtaSeconds(chunk);
        if (etaSec != null) {
          entry.eta = unixNow() + etaSec;
        }

        postUpdate("update");
      }
    });

    p.stderr.on("data", (data) => {
      try {
        stderrBuf += data.toString();
        if (stderrBuf.length > STDERR_MAX) {
          stderrBuf = stderrBuf.slice(stderrBuf.length - STDERR_MAX);
        }
      } catch {
        // ignore
      }
    });

    p.on("close", async (code) => {
      stopDiskPoll();
      if (code !== 0) {
        const stderrSummary = summarizeStderr(stderrBuf);

        // Before reporting any failure, check whether the file actually made
        // it. If it did, report the error detail but finish as a success so
        // the down card shows no error.
        const landedBytes = await verifyLandedIntact(
          resuming ? rsyncDst : null,
        );
        if (landedBytes) {
          if (!promoteFile(rsyncDst)) return;
          unilog(2030, `rsync exit code ${code} for ${title}: ${stderrSummary || "no stderr"}`);
          unilog(2031, `rsync for ${title} actually succeeded: local file is complete at ${landedBytes} bytes, matching the remote`);
          entry.progress = 100;
          finish("finished");
          return;
        }

        if (code === 23) {
          const missingDir = parseMissingChangeDir(stderrBuf);
          if (missingDir && attempt === 1) {
            // Try to locate the file under ~/files and retry once with corrected usbPath.
            try {
              const newUsbPath = await locateUsbPathByTitle(usbHost, title);
              if (newUsbPath && newUsbPath !== usbPath2) {
                unilog(1752, `rsync missing remote folder for ${title} on attempt ${attempt}: ${missingDir}; retrying with ${newUsbPath}`);
                entry.usbPath = newUsbPath;
                entry.status = "downloading";
                entry.progress = 0;
                entry.eta = null;
                entry.speed = 0;
                postUpdate("update");
                runRsync(2);
                return;
              }
            } catch {
              // ignore and fall through to final error
            }

            unilog(1753, `rsync gave up for ${title} after ${attempt} attempts: remote folder not found: ${missingDir}`);
            failFinish(`Missing: remote folder not found: ${missingDir}`);
            return;
          }

          // Keep Missing errors short and actionable.
          const { src: srcNow } = makeSrcDst();
          if (missingDir) {
            unilog(1754, `rsync gave up for ${title} after ${attempt} attempts: remote folder not found: ${missingDir}`);
            failFinish(`Missing: remote folder not found: ${missingDir}`);
            return;
          }
          if (/No such file or directory/i.test(stderrBuf)) {
            unilog(1755, `rsync gave up for ${title} after ${attempt} attempts: remote file not found: ${srcNow}`);
            failFinish(`Missing: remote file not found: ${srcNow}`);
            return;
          }
          unilog(1756, `rsync gave up for ${title} after ${attempt} attempts: ${stderrSummary || "Missing"}`);
          failFinish(stderrSummary ? `Missing: ${stderrSummary}` : "Missing");
          return;
        }

        const msg = stderrSummary
          ? `rsync exit code ${code}: ${stderrSummary}`
          : `rsync exit code ${code}`;
        failFinish(msg);
        return;
      }
      if (!promoteFile(rsyncDst)) return;
      entry.progress = 100;
      finish("finished");
    });

    p.on("error", (err) => {
      stopDiskPoll();
      failFinish(err && err.message ? err.message : "rsync spawn error");
    });
  };

  // startRsync stats the remote before it decides how to run, so nothing may
  // throw past it unnoticed and leave the entry stuck as downloading forever.
  const runRsync = (attempt) => {
    startRsync(attempt).catch((e) => {
      unilog(2133, `could not start rsync for ${title}: ${e.message}`);
      failFinish(e && e.message ? e.message : "rsync start error");
    });
  };

  runRsync(1);
};

main();
