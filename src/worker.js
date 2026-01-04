'use strict';

// worker_threads entrypoint
// - reads shared tvJsonCache by procId
// - runs rsync: <usbHost>:<usbPath><title> -> <localPath><title>
// - updates shared progress/eta during transfer
// - on finish/error sets status/dateEnded and posts only: "finished"

const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');

const unixNow = () => Math.floor(Date.now() / 1000);

const { procId, usbHost, sab, sizes } = workerData || {};

const USB_PATH_BYTES = sizes && sizes.USB_PATH_BYTES;
const LOCAL_PATH_BYTES = sizes && sizes.LOCAL_PATH_BYTES;
const TITLE_BYTES = sizes && sizes.TITLE_BYTES;
const STATUS_BYTES = sizes && sizes.STATUS_BYTES;

const encoder = new (global.TextEncoder || require('util').TextEncoder)();
const decoder = new (global.TextDecoder || require('util').TextDecoder)('utf-8');

const usbPathBytes = new Uint8Array(sab.usbPath);
const localPathBytes = new Uint8Array(sab.localPath);
const titleBytes = new Uint8Array(sab.title);
const statusBytes = new Uint8Array(sab.status);

const progress = new Int32Array(sab.progress);
const eta = new Int32Array(sab.eta);
const dateEnded = new Int32Array(sab.dateEnded);

const readFixedString = (bytesView, idx, stride) => {
  const off = idx * stride;
  let end = off;
  const max = off + stride;
  while (end < max && bytesView[end] !== 0) end++;
  if (end === off) return '';
  return decoder.decode(bytesView.subarray(off, end));
};

const writeFixedString = (bytesView, idx, stride, s) => {
  const off = idx * stride;
  bytesView.fill(0, off, off + stride);
  if (!s) return;
  const b = encoder.encode(String(s));
  const n = Math.min(b.length, stride - 1);
  for (let i = 0; i < n; i++) bytesView[off + i] = b[i];
  bytesView[off + n] = 0;
};

const setStatus = (s) => {
  writeFixedString(statusBytes, procId, STATUS_BYTES, s);
};

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

const finish = (statusText) => {
  try {
    setStatus(statusText);
  } catch {}
  try {
    eta[procId] = 0;
  } catch {}
  try {
    dateEnded[procId] = unixNow();
  } catch {}
  try {
    parentPort.postMessage('finished');
  } catch {}
  try {
    process.exit(0);
  } catch {}
};

const main = () => {
  if (procId == null || procId < 0) {
    finish('bad procId');
    return;
  }

  const usbPath = readFixedString(usbPathBytes, procId, USB_PATH_BYTES);
  const localPath = readFixedString(localPathBytes, procId, LOCAL_PATH_BYTES);
  const title = readFixedString(titleBytes, procId, TITLE_BYTES);

  if (!usbHost || !usbPath || !localPath || !title) {
    finish('missing fields');
    return;
  }

  // rsync source/dest per spec
  const src = `${usbHost}:${usbPath}${title}`;
  const dst = `${localPath}${title}`;

  // Ensure our status starts as downloading
  try {
    setStatus('downloading');
  } catch {}
  try {
    progress[procId] = 0;
    eta[procId] = 0;
    dateEnded[procId] = 0;
  } catch {}

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
      try {
        progress[procId] = pct;
      } catch {}

      const etaSec = parseEtaSeconds(chunk);
      if (etaSec != null) {
        try {
          eta[procId] = unixNow() + etaSec;
        } catch {}
      }
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
    try {
      progress[procId] = 100;
    } catch {}
    finish('finished');
  });

  p.on('error', (err) => {
    finish(err && err.message ? err.message : 'rsync spawn error');
  });
};

main();
