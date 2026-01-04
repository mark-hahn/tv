'use strict';

// worker_threads entrypoint (no shared buffers)
// - receives a copy of the entry object
// - runs rsync: <usbHost>:<usbPath><title> -> <localPath><title>
// - updates local entry.progress/entry.eta during transfer
// - sends {type:"update", entry} to tvJson.js on updates
// - sends {type:"finished", entry} on completion/error, then exits

const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');

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

  // rsync source/dest per spec
  const src = `${usbHost}:${usbPath}${title}`;
  const dst = `${localPath}${title}`;

  // Ensure our status starts as downloading
  entry.status = 'downloading';
  entry.progress = 0;
  entry.eta = null;
  entry.dateEnded = null;
  postUpdate('update');

  const rsyncArgs = ['-av', '-e', 'ssh', '--timeout=20', '--info=progress2', src, dst];
  const p = spawn('rsync', rsyncArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  let lastProgress = 0;
  let lastProgressUpdateTime = 0;
  const progressUpdateInterval = 500;

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

      const etaSec = parseEtaSeconds(chunk);
      if (etaSec != null) {
        entry.eta = unixNow() + etaSec;
      }

      postUpdate('update');
    }
  });

  p.stderr.on('data', () => {
    // ignore; status will be set on exit code
  });

  p.on('close', (code) => {
    if (code !== 0) {
      const msg = code === 23 ? 'Missing' : `rsync exit code ${code}`;
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

main();
