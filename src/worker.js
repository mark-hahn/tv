'use strict';

// worker_threads entrypoint (no shared buffers)
// - receives a copy of the entry object
// - runs rsync: <usbHost>:<usbPath><title> -> <localPath><title>
// - updates local entry.progress/entry.eta during transfer
// - sends {type:"update", entry} to tvJson.js on updates
// - sends {type:"finished", entry} on completion/error, then exits

const { parentPort, workerData } = require('worker_threads');
const { spawn, execFile } = require('child_process');
const path = require('path');

const unixNow = () => Math.floor(Date.now() / 1000);

const { entry: entry0, usbHost } = workerData || {};
let entry = entry0 && typeof entry0 === 'object' ? { ...entry0 } : null;

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
  const s = String(stderrText || '').trim();
  if (!s) return '';
  // Keep it single-line and reasonably short for tv.log.
  const oneLine = s.replace(/[\r\n]+/g, ' | ').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 280) return oneLine;
  return oneLine.slice(0, 277) + '...';
};

const escapeForDoubleQuotes = (s) => String(s || '').replace(/([\\"\$`])/g, '\\$1');

const sshExec = (host, remoteCmd, timeoutMs = 15000) => {
  return new Promise((resolve, reject) => {
    const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, remoteCmd];
    execFile('ssh', args, { timeout: timeoutMs, maxBuffer: 1024 * 256 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
};

const parseMissingChangeDir = (stderrText) => {
  const s = String(stderrText || '');
  if (!/change_dir\s+"[^"]+"\s+failed:\s+No such file or directory/i.test(s)) return null;
  const m = s.match(/change_dir\s+"([^"]+)"/i);
  return m && m[1] ? m[1] : null;
};

const locateUsbPathByTitle = async (usbHost1, title1) => {
  if (!usbHost1 || !title1) return null;
  // Find the first exact filename match under ~/files (remote cwd assumed to be $HOME).
  // Using -name for exact match; suppress errors for transient readdir races.
  const cmd = `find files -ignore_readdir_race -type f -name "${escapeForDoubleQuotes(title1)}" -print -quit 2>/dev/null`;
  const res = await sshExec(usbHost1, cmd, 20000);
  const line = String(res.stdout || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean);
  if (!line) return null;
  if (!line.startsWith('files/')) return null;
  const dir = path.posix.dirname(line);
  if (!dir || dir === '.' || dir === 'files') return null;
  const inside = dir.slice('files/'.length);
  if (!inside) return null;
  return `~/files/${inside}/`;
};

const finish = (statusText) => {
  if (!entry) {
    try {
      parentPort.postMessage({ type: 'finished', entry: { procId: null, status: statusText || 'error', dateEnded: unixNow() } });
    } catch {}
    try {
      process.exit(0);
    } catch {}
    return;
  }

  entry.status = statusText;
  entry.eta = null;
  entry.dateEnded = unixNow();
  postUpdate('finished');
  try {
    process.exit(0);
  } catch {}
};

const main = () => {
  if (!entry || entry.procId == null) {
    finish('bad procId');
    return;
  }

  const usbPath = entry.usbPath;
  const localPath = entry.localPath;
  const title = entry.title;

  if (!usbHost || !usbPath || !localPath || !title) {
    finish('missing fields');
    return;
  }

  const ensureTrailingSlash = (s) => (String(s || '').endsWith('/') ? String(s || '') : `${String(s || '')}/`);

  // rsync source/dest per spec
  const makeSrcDst = () => {
    const usbPath2 = ensureTrailingSlash(entry.usbPath);
    const localPath2 = ensureTrailingSlash(localPath);
    const src = `${usbHost}:${usbPath2}${title}`;
    const dst = `${localPath2}${title}`;
    return { src, dst, usbPath2, localPath2 };
  };

  // Ensure our status starts as downloading
  entry.status = 'downloading';
  entry.progress = 0;
  entry.eta = null;
  entry.speed = 0;
  entry.dateEnded = null;
  postUpdate('update');

  const startRsync = (attempt) => {
    const { src, dst, usbPath2 } = makeSrcDst();
    const rsyncArgs = ['-av', '-e', 'ssh', '--timeout=20', '--info=progress2', src, dst];
    const p = spawn('rsync', rsyncArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    // Capture rsync stderr so failures can be diagnosed.
    // Keep last N bytes to avoid unbounded memory use.
    const STDERR_MAX = 8192;
    let stderrBuf = '';

    let lastProgress = entry.progress || 0;
    let lastProgressUpdateTime = 0;
    const progressUpdateInterval = 500;

    // Speed estimate based on rsync progress2 byte counter deltas.
    let lastBytes = null;
    let lastBytesTimeMs = null;
    const speedSamples = [];

    const parseTransferredBytes = (chunk) => {
      // Typical progress2 lines contain: "   123,456,789  12% ..."
      const m = chunk.match(/\s*([\d,]+)\s+(\d+)%/);
      if (!m) return null;
      const s = m[1].replace(/,/g, '');
      if (!/^\d+$/.test(s)) return null;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : null;
    };

    p.stdout.on('data', (data) => {
      const chunk = data.toString();
      const pm = chunk.match(/(\d+)%/);
      if (!pm) return;

      const pct = parseInt(pm[1], 10);
      if (!Number.isFinite(pct)) return;

      if (pct > lastProgress && (Date.now() - lastProgressUpdateTime) >= progressUpdateInterval) {
        lastProgress = pct;
        lastProgressUpdateTime = Date.now();
        entry.progress = pct;

        const nowMs = Date.now();
        const bytes = parseTransferredBytes(chunk);
        let etaSec = null;

        if (bytes != null) {
          if (lastBytes != null && lastBytesTimeMs != null && bytes >= lastBytes) {
            const dtSec = (nowMs - lastBytesTimeMs) / 1000;
            if (dtSec > 0) {
              const dBytes = bytes - lastBytes;
              const instBitsPerSec = Math.round((dBytes * 8) / dtSec);
              const inst = Number.isFinite(instBitsPerSec) && instBitsPerSec >= 0 ? instBitsPerSec : 0;

              speedSamples.push(inst);
              while (speedSamples.length > 3) speedSamples.shift();
              const sum = speedSamples.reduce((a, b) => a + b, 0);
              entry.speed = speedSamples.length ? Math.round(sum / speedSamples.length) : 0;
            }
          }
          lastBytes = bytes;
          lastBytesTimeMs = nowMs;
        }

        etaSec = parseEtaSeconds(chunk);
        if (etaSec != null) {
          entry.eta = unixNow() + etaSec;
        }

        postUpdate('update');
      }
    });

    p.stderr.on('data', (data) => {
      try {
        stderrBuf += data.toString();
        if (stderrBuf.length > STDERR_MAX) {
          stderrBuf = stderrBuf.slice(stderrBuf.length - STDERR_MAX);
        }
      } catch {
        // ignore
      }
    });

    p.on('close', async (code) => {
      if (code !== 0) {
        const stderrSummary = summarizeStderr(stderrBuf);

        if (code === 23) {
          const missingDir = parseMissingChangeDir(stderrBuf);
          if (missingDir && attempt === 1) {
            // Try to locate the file under ~/files and retry once with corrected usbPath.
            try {
              const newUsbPath = await locateUsbPathByTitle(usbHost, title);
              if (newUsbPath && newUsbPath !== usbPath2) {
                entry.usbPath = newUsbPath;
                entry.status = 'downloading';
                entry.progress = 0;
                entry.eta = null;
                entry.speed = 0;
                postUpdate('update');
                startRsync(2);
                return;
              }
            } catch {
              // ignore and fall through to final error
            }

            finish(`Missing: remote folder not found: ${missingDir}`);
            return;
          }

          // Keep Missing errors short and actionable.
          const { src: srcNow } = makeSrcDst();
          if (missingDir) {
            finish(`Missing: remote folder not found: ${missingDir}`);
            return;
          }
          if (/No such file or directory/i.test(stderrBuf)) {
            finish(`Missing: remote file not found: ${srcNow}`);
            return;
          }
          finish(stderrSummary ? `Missing: ${stderrSummary}` : 'Missing');
          return;
        }

        const msg = stderrSummary ? `rsync exit code ${code}: ${stderrSummary}` : `rsync exit code ${code}`;
        finish(msg);
        return;
      }
      entry.progress = 100;
      finish('finished');
    });

    p.on('error', (err) => {
      finish(err && err.message ? err.message : 'rsync spawn error');
    });
  };

  startRsync(1);
};

main();
