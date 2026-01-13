'use strict';

// tvJson.js
// - Owns tvJsonCache (Map keyed by title)
// - Creates workers and processes messages from workers
// - Exports ONLY: addEntry(entry), getDownloads()

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const BASEDIR = path.join(__dirname, '..');
const DATA_DIR = path.join(BASEDIR, 'data');

const TV_JSON_PATH = path.join(DATA_DIR, 'tv.json');
const TV_FINISHED_PATH = path.join(DATA_DIR, 'tv-finished.json');
const TV_INPROGRESS_PATH = path.join(DATA_DIR, 'tv-inProgress.json');
const TV_LOG_PATH = path.join(BASEDIR, 'misc', 'tv.log');

const WORKER_SCRIPT = path.join(__dirname, 'worker.js');

const MAX_WORKERS = 8;
const usbHost = 'xobtlu@oracle.usbx.me';

// PST/PDT formatting
const PST_TZ = 'America/Los_Angeles';

const appendTvLog = (line) => {
  try {
    fs.mkdirSync(path.dirname(TV_LOG_PATH), { recursive: true });
  } catch {}
  try {
    fs.appendFileSync(TV_LOG_PATH, line);
  } catch {}
};

const dateStr = (ms) => {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: PST_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(ms));
    const m = {};
    for (const p of parts) {
      if (p && p.type && p.value) m[p.type] = p.value;
    }
    return `${m.year}/${m.month}/${m.day}-${m.hour}:${m.minute}:${m.second}`;
  } catch {
    const d = new Date(ms);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}/${month}/${day}-${hours}:${minutes}:${seconds}`;
  }
};

const readJson = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJsonAtomic = (filePath, obj) => {
  try {
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, '.' + path.basename(filePath) + '.tmp.' + process.pid + '.' + Date.now());
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, filePath);
  } catch {}
};

const readMap = (filePath) => {
  const obj = readJson(filePath, {});
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  return obj;
};

const writeMap = (filePath, mapObj) => {
  // mapObj values are already formatted strings
  writeJsonAtomic(filePath, mapObj);
};

// ---- in-memory state (single authority) ------------------------------------

let tvJsonCache = new Map();
let workerCount = 0;
let nextProcId = 0;

let finishedMap = null;
let inProgressCache = null;

const unixNow = () => Math.floor(Date.now() / 1000);

const flushTvJsonToDisk = () => {
  const arr = Array.from(tvJsonCache.values());
  arr.sort((a, b) => {
    const ap = (a && typeof a.procId === 'number') ? a.procId : Number.POSITIVE_INFINITY;
    const bp = (b && typeof b.procId === 'number') ? b.procId : Number.POSITIVE_INFINITY;
    return ap - bp;
  });
  writeJsonAtomic(TV_JSON_PATH, arr);
};

const ensureMapFileExists = (filePath, defaultObj) => {
  try {
    if (!fs.existsSync(filePath)) {
      writeJsonAtomic(filePath, defaultObj);
    }
  } catch {}
};

const ensureMapsLoaded = () => {
  if (!finishedMap) finishedMap = readMap(TV_FINISHED_PATH);
  if (!inProgressCache) inProgressCache = readMap(TV_INPROGRESS_PATH);
};

const flushInProgress = () => {
  if (!inProgressCache) return;
  writeMap(TV_INPROGRESS_PATH, inProgressCache);
};

const addInProgress = (title) => {
  if (!title) return;
  ensureMapsLoaded();
  inProgressCache[String(title)] = dateStr(Date.now());
  flushInProgress();
};

const removeInProgress = (title) => {
  if (!title) return;
  ensureMapsLoaded();
  if (Object.prototype.hasOwnProperty.call(inProgressCache, String(title))) {
    delete inProgressCache[String(title)];
    flushInProgress();
  }
};

const loadOnStart = () => {
  ensureMapFileExists(TV_FINISHED_PATH, {});
  ensureMapFileExists(TV_INPROGRESS_PATH, {});

  const arr = readJson(TV_JSON_PATH, []);
  tvJsonCache = new Map();
  if (Array.isArray(arr)) {
    for (const e of arr) {
      if (!e || typeof e !== 'object') continue;
      const t = e.title ? String(e.title) : '';
      if (!t) continue;
      tvJsonCache.set(t, e);
    }
  }

  // Reset any in-progress or downloading entries to waiting on start.
  // Spec: if entry has inProgress:true at reload, set inProgress:false and status:"waiting".
  for (const [t, e0] of tvJsonCache.entries()) {
    const e = e0 && typeof e0 === 'object' ? e0 : null;
    if (!e) continue;

    // Migrate legacy queued status.
    if (e.status === 'future') {
      e.status = 'waiting';
    }

    if (e.inProgress === true) {
      e.inProgress = false;
      e.status = 'waiting';
      e.progress = 0;
      e.eta = null;
      e.speed = 0;
      e.dateEnded = null;
      continue;
    }

    if (e.status === 'downloading') {
      e.status = 'waiting';
      e.progress = 0;
      e.eta = null;
      e.speed = 0;
      e.dateEnded = null;
    }

    // Keep Map key in sync with entry.title.
    if (t !== String(e.title || '')) {
      tvJsonCache.delete(t);
      const nt = e.title ? String(e.title) : '';
      if (nt) tvJsonCache.set(nt, e);
    }
  }

  // Determine nextProcId from existing entries (max+1) so procId stays unique.
  let maxId = -1;
  for (const e of tvJsonCache.values()) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.procId === 'number' && Number.isInteger(e.procId) && e.procId > maxId) {
      maxId = e.procId;
    }
  }
  nextProcId = maxId + 1;

  // Assign procId to any entries missing it.
  for (const e of tvJsonCache.values()) {
    if (!e || typeof e !== 'object') continue;
    if (!(typeof e.procId === 'number' && Number.isInteger(e.procId))) {
      e.procId = nextProcId++;
    }
  }

  // Load finished/errors/inProgress maps for immediate updates.
  finishedMap = readMap(TV_FINISHED_PATH);

  // One-time migration: if legacy tv-errors.json exists, mark matching tv.json entries as error:true then delete it.
  // Any mismatches are ignored.
  try {
    const legacyErrorsPath = path.join(DATA_DIR, 'tv-errors.json');
    if (fs.existsSync(legacyErrorsPath)) {
      const legacy = readMap(legacyErrorsPath);
      for (const k of Object.keys(legacy || {})) {
        const title = String(k || '');
        if (!title) continue;
        const existing = tvJsonCache.get(title);
        if (existing && typeof existing === 'object') {
          existing.error = true;
        }
      }
      try { fs.unlinkSync(legacyErrorsPath); } catch {}
    }
  } catch {}
  // On restart/reload, treat all prior in-progress markers as stale.
  // We already reset any persisted entry.inProgress=true back to waiting above.
  // Clearing the map prevents duplicate suppression from getting stuck.
  inProgressCache = {};
  flushInProgress();

  // Start up to MAX_WORKERS oldest waiting entries.
  tryStartNextWorkers();
  flushTvJsonToDisk();
};

const findOldestWaitingIndex = () => {
  let bestTitle = null;
  let bestProcId = null;
  for (const [t, e] of tvJsonCache.entries()) {
    if (!e || typeof e !== 'object') continue;
    if (e.status !== 'waiting') continue;
    const pid = (typeof e.procId === 'number' && Number.isInteger(e.procId)) ? e.procId : null;
    if (bestTitle == null) {
      bestTitle = t;
      bestProcId = pid;
      continue;
    }
    if (pid == null && bestProcId == null) continue;
    if (pid == null) continue;
    if (bestProcId == null || pid < bestProcId) {
      bestTitle = t;
      bestProcId = pid;
    }
  }
  return bestTitle;
};

const tryStartNextWorkers = () => {
  while (workerCount < MAX_WORKERS) {
    const title = findOldestWaitingIndex();
    if (!title) return;
    startWorkerForTitle(title);
  }
};

const replaceByProcId = (entry) => {
  if (!entry || typeof entry !== 'object') return;
  const title = entry.title ? String(entry.title) : '';
  if (title) {
    tvJsonCache.set(title, entry);
    return;
  }
  const pid = entry.procId;
  if (typeof pid !== 'number') return;
  for (const [t, e] of tvJsonCache.entries()) {
    if (e && typeof e === 'object' && e.procId === pid) {
      tvJsonCache.set(t, entry);
      return;
    }
  }
};

const handleFinish = (entry) => {
  try {
    if (!entry || typeof entry !== 'object') return;
    const title = entry.title ? String(entry.title) : '';
    const status = entry.status ? String(entry.status) : '';
    if (!title) return;

    ensureMapsLoaded();

    const ts = Date.now();
    const tsStr = dateStr(ts);

    if (status === 'finished') {
      finishedMap[title] = tsStr;
      writeMap(TV_FINISHED_PATH, finishedMap);
      removeInProgress(title);
      return;
    }

    if (status && status !== 'downloading' && status !== 'waiting') {
      appendTvLog(`${tsStr} ERROR ${title}: ${status}\n`);

      const existing = tvJsonCache.get(title);
      if (existing && typeof existing === 'object') {
        existing.error = true;
      }
      removeInProgress(title);
    }
  } catch {}
};

const startWorkerForTitle = (title) => {
  const entry0 = tvJsonCache.get(title);
  if (!entry0 || typeof entry0 !== 'object') return;

  // Assign procId on worker creation (spec) if missing.
  const entry = { ...entry0 };
  if (!(typeof entry.procId === 'number' && Number.isInteger(entry.procId))) {
    entry.procId = nextProcId++;
  }

  // Mark inProgress before downloading.
  entry.inProgress = true;
  addInProgress(entry.title);

  entry.status = 'downloading';
  entry.progress = 0;
  entry.eta = null;
  entry.speed = 0;
  entry.dateStarted = unixNow();
  entry.dateEnded = null;

  // Replace cache immediately so /downloads reflects the procId.
  tvJsonCache.set(String(entry.title || title), entry);
  flushTvJsonToDisk();

  workerCount++;

  const w = new Worker(WORKER_SCRIPT, {
    workerData: {
      entry,
      usbHost,
    },
  });

  let finishedReceived = false;

  const onMessage = (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'update' && msg.entry) {
      replaceByProcId(msg.entry);
      return;
    }

    if (msg.type === 'finished' && msg.entry) {
      finishedReceived = true;
      const doneEntry = { ...msg.entry, inProgress: false };
      replaceByProcId(doneEntry);
      workerCount = Math.max(0, workerCount - 1);

      handleFinish(doneEntry);
      flushTvJsonToDisk();

      // Start exactly one oldest waiting (spec: keep the pipeline full).
      const nextTitle = findOldestWaitingIndex();
      if (nextTitle) startWorkerForTitle(nextTitle);
    }
  };

  w.on('message', onMessage);
  w.on('error', (e) => {
    // Treat worker error as a finish with an error status.
    const errEntry = { ...entry, status: (e && e.message) ? String(e.message) : 'worker error', dateEnded: unixNow(), eta: null, inProgress: false };
    replaceByProcId(errEntry);
    workerCount = Math.max(0, workerCount - 1);
    handleFinish(errEntry);
    flushTvJsonToDisk();

    const nextTitle = findOldestWaitingIndex();
    if (nextTitle) startWorkerForTitle(nextTitle);
  });
  w.on('exit', () => {
    // If the worker exits without sending finished, record something actionable.
    if (finishedReceived) return;
    const errEntry = { ...entry, status: 'worker exited without finished', dateEnded: unixNow(), eta: null, inProgress: false };
    replaceByProcId(errEntry);
    workerCount = Math.max(0, workerCount - 1);
    handleFinish(errEntry);
    flushTvJsonToDisk();

    const nextTitle = findOldestWaitingIndex();
    if (nextTitle) startWorkerForTitle(nextTitle);
  });
};

// Initialize on module load.
loadOnStart();

// ---- exports ---------------------------------------------------------------

const addEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return;

  // Store entry as a plain object. procId is assigned when/if a worker starts.
  const e = { ...entry };

  // Assign procId on add so /downloads sorting/capping is deterministic.
  if (!(typeof e.procId === 'number' && Number.isInteger(e.procId))) {
    e.procId = nextProcId++;
  }

  // Ensure minimal fields exist.
  // Queue status is "waiting" (formerly "future").
  if (!e.status || e.status === 'future') e.status = 'waiting';
  if (typeof e.progress !== 'number') e.progress = 0;
  if (e.eta === undefined) e.eta = null;
  if (typeof e.speed !== 'number') e.speed = 0;
  if (!e.dateStarted) e.dateStarted = 0;
  if (!e.dateEnded) e.dateEnded = null;

  // Record inProgress in the de-dupe map, but only set entry.inProgress=true when worker starts.
  e.inProgress = false;
  addInProgress(e.title);

  const title = e.title ? String(e.title) : '';
  if (!title) return;
  tvJsonCache.set(title, e);
  flushTvJsonToDisk();

  if (workerCount < MAX_WORKERS) {
    // Start worker for this newly added entry.
    startWorkerForTitle(title);
  }
};

// Record a non-download (cycle) error directly on tv.json entries.
const markError = (titleOrEntry, reason) => {
  try {
    const entry = (titleOrEntry && typeof titleOrEntry === 'object') ? titleOrEntry : null;
    const t = entry ? String(entry.title || '') : (titleOrEntry ? String(titleOrEntry) : '');
    if (!t) return;
    ensureMapsLoaded();

    const tsStr = dateStr(Date.now());
    const msg = entry && entry.reason ? String(entry.reason) : (reason ? String(reason) : 'error');
    appendTvLog(`${tsStr} ERROR ${t}: ${msg}\n`);

    const existing = tvJsonCache.get(t);
    const patch = {
      title: t,
      usbPath: entry && entry.usbPath ? String(entry.usbPath) : (existing && existing.usbPath ? existing.usbPath : ''),
      localPath: entry && entry.localPath ? String(entry.localPath) : (existing && existing.localPath ? existing.localPath : ''),
      procId: (existing && typeof existing.procId === 'number') ? existing.procId : nextProcId++,
      status: msg,
      error: true,
      inProgress: false,
      progress: 0,
      eta: null,
      speed: 0,
      dateStarted: (existing && existing.dateStarted) ? existing.dateStarted : 0,
      dateEnded: unixNow(),
    };

    tvJsonCache.set(t, Object.assign({}, existing || {}, patch));
    flushTvJsonToDisk();

    // If it was ever marked inProgress, clear it.
    removeInProgress(t);
  } catch {}
};

const getDownloads = () => {
  try {
    const arr = Array.from(tvJsonCache.values());
    arr.sort((a, b) => {
      const ap = (a && typeof a.procId === 'number') ? a.procId : Number.POSITIVE_INFINITY;
      const bp = (b && typeof b.procId === 'number') ? b.procId : Number.POSITIVE_INFINITY;
      return ap - bp;
    });
    return arr.length > 200 ? arr.slice(arr.length - 200) : arr;
  } catch {
    return [];
  }
};

// Prune tv.json entries when their corresponding USB folder has been deleted.
// existingUsbDirs: Set of relative directory paths under "files/" on the usbHost.
const pruneMissingUsbDirs = (existingUsbDirs) => {
  try {
    if (!existingUsbDirs || typeof existingUsbDirs.has !== 'function') return;

    const normalizeUsbDir = (usbPath) => {
      let p = String(usbPath || '');
      p = p.replace(/^~\//, '');
      p = p.replace(/^\/+/g, '');
      if (p.startsWith('files/')) p = p.slice('files/'.length);
      if (p.startsWith('~/files/')) p = p.slice('~/files/'.length);
      p = p.replace(/^files\//, '');
      p = p.replace(/^\.\/?/, '');
      p = p.replace(/\/+$/g, '');
      return p;
    };

    let changed = false;
    for (const [title, e] of tvJsonCache.entries()) {
      if (!e || typeof e !== 'object') continue;
      const usbDir = normalizeUsbDir(e.usbPath);
      if (!usbDir) continue;
      if (!existingUsbDirs.has(usbDir)) {
        tvJsonCache.delete(title);
        removeInProgress(title);
        changed = true;
      }
    }
    if (changed) flushTvJsonToDisk();
  } catch {}
};

module.exports = {
  addEntry,
  getDownloads,
  markError,
  pruneMissingUsbDirs,
};
