'use strict';

// tvJson.js
// - Owns download state and worker lifecycle
// - Persists state in SQLite (replaces data/tv.json and in-memory tvJsonCache)
// - Exports: addEntry(entry), getDownloads(), markError(), pruneMissingUsbDirs()

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const Database = require('better-sqlite3');

const BASEDIR = path.join(__dirname, '..');
const DATA_DIR = path.join(BASEDIR, 'data');

// SQLite backing store (replaces data/tv.json)
const TV_DB_PATH = path.join(DATA_DIR, 'tv.sqlite');
// Legacy JSON path (migration-only)
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

const logTvEntryAdded = (title, errorMsg) => {
  try {
    const t = title ? String(title) : '';
    if (!t) return;
    const tsStr = dateStr(Date.now());
    if (errorMsg) {
      appendTvLog(`${tsStr} ===> ERROR: ${t} ${String(errorMsg)}\n`);
    } else {
      appendTvLog(`${tsStr} ${t}\n`);
    }
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

// ---- SQLite-backed state (single authority) --------------------------------

let db = null;
let workerCount = 0;
let nextProcId = 0;

let finishedMap = null;
let inProgressCache = null;

let stmtUpsertByTitle = null;
let stmtGetByTitle = null;
let stmtGetByProcId = null;
let stmtUpdateByProcId = null;
let stmtDeleteByTitle = null;
let stmtFindOldestWaitingTitle = null;
let stmtGetMaxProcId = null;
let stmtGetDownloads = null;
let stmtGetTitles = null;

const unixNow = () => Math.floor(Date.now() / 1000);

const ensureDataDir = () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
};

const openDb = () => {
  if (db) return;
  ensureDataDir();
  db = new Database(TV_DB_PATH);

  try {
    db.pragma('journal_mode = WAL');
  } catch {}
  try {
    db.pragma('synchronous = NORMAL');
  } catch {}
  try {
    db.pragma('busy_timeout = 5000');
  } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS tv_entries (
      title TEXT PRIMARY KEY,
      procId INTEGER,
      usbPath TEXT,
      localPath TEXT,
      status TEXT,
      progress INTEGER,
      eta INTEGER,
      speed INTEGER,
      sequence INTEGER,
      fileSize INTEGER,
      season INTEGER,
      episode INTEGER,
      dateStarted INTEGER,
      dateEnded INTEGER,
      inProgress INTEGER,
      error INTEGER,
      reason TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tv_entries_procId_unique ON tv_entries(procId);
    CREATE INDEX IF NOT EXISTS idx_tv_entries_status_procId ON tv_entries(status, procId);
  `);

  stmtUpsertByTitle = db.prepare(`
    INSERT INTO tv_entries (
      title, procId, usbPath, localPath, status, progress, eta, speed,
      sequence, fileSize, season, episode, dateStarted, dateEnded,
      inProgress, error, reason
    ) VALUES (
      @title, @procId, @usbPath, @localPath, @status, @progress, @eta, @speed,
      @sequence, @fileSize, @season, @episode, @dateStarted, @dateEnded,
      @inProgress, @error, @reason
    )
    ON CONFLICT(title) DO UPDATE SET
      procId=excluded.procId,
      usbPath=excluded.usbPath,
      localPath=excluded.localPath,
      status=excluded.status,
      progress=excluded.progress,
      eta=excluded.eta,
      speed=excluded.speed,
      sequence=excluded.sequence,
      fileSize=excluded.fileSize,
      season=excluded.season,
      episode=excluded.episode,
      dateStarted=excluded.dateStarted,
      dateEnded=excluded.dateEnded,
      inProgress=excluded.inProgress,
      error=excluded.error,
      reason=excluded.reason
  `);

  stmtGetByTitle = db.prepare('SELECT * FROM tv_entries WHERE title = ?');
  stmtGetByProcId = db.prepare('SELECT * FROM tv_entries WHERE procId = ?');
  stmtUpdateByProcId = db.prepare(`
    UPDATE tv_entries SET
      usbPath=@usbPath,
      localPath=@localPath,
      status=@status,
      progress=@progress,
      eta=@eta,
      speed=@speed,
      sequence=@sequence,
      fileSize=@fileSize,
      season=@season,
      episode=@episode,
      dateStarted=@dateStarted,
      dateEnded=@dateEnded,
      inProgress=@inProgress,
      error=@error,
      reason=@reason
    WHERE procId=@procId
  `);
  stmtDeleteByTitle = db.prepare('DELETE FROM tv_entries WHERE title = ?');

  stmtFindOldestWaitingTitle = db.prepare(
    "SELECT title FROM tv_entries WHERE status='waiting' ORDER BY procId ASC LIMIT 1"
  );
  stmtGetMaxProcId = db.prepare('SELECT MAX(procId) AS maxProcId FROM tv_entries');
  // Return the newest 200 rows (by procId) but in ascending procId order
  // so callers can display consistently without extra sorting.
  stmtGetDownloads = db.prepare(
    'SELECT * FROM (SELECT * FROM tv_entries ORDER BY procId DESC LIMIT 200) ORDER BY procId ASC'
  );
  stmtGetTitles = db.prepare('SELECT title, error FROM tv_entries');
};

const rowToEntry = (row) => {
  if (!row || typeof row !== 'object') return null;
  return {
    procId: (typeof row.procId === 'number') ? row.procId : (row.procId == null ? null : Number(row.procId)),
    usbPath: row.usbPath || '',
    localPath: row.localPath || '',
    title: row.title || '',
    status: row.status || 'waiting',
    progress: (typeof row.progress === 'number') ? row.progress : (row.progress == null ? 0 : Number(row.progress)),
    eta: row.eta == null ? null : Number(row.eta),
    speed: (typeof row.speed === 'number') ? row.speed : (row.speed == null ? 0 : Number(row.speed)),
    sequence: (typeof row.sequence === 'number') ? row.sequence : (row.sequence == null ? 0 : Number(row.sequence)),
    fileSize: (typeof row.fileSize === 'number') ? row.fileSize : (row.fileSize == null ? 0 : Number(row.fileSize)),
    season: (typeof row.season === 'number') ? row.season : (row.season == null ? 0 : Number(row.season)),
    episode: (typeof row.episode === 'number') ? row.episode : (row.episode == null ? 0 : Number(row.episode)),
    dateStarted: (typeof row.dateStarted === 'number') ? row.dateStarted : (row.dateStarted == null ? 0 : Number(row.dateStarted)),
    dateEnded: row.dateEnded == null ? null : Number(row.dateEnded),
    inProgress: !!row.inProgress,
    error: !!row.error,
    reason: row.reason || undefined,
  };
};

const normalizeEntryForDb = (entry) => {
  const e = entry && typeof entry === 'object' ? entry : {};
  const title = e.title ? String(e.title) : '';

  // Defaults match prior tv.json behavior.
  const status0 = e.status ? String(e.status) : 'waiting';
  const status = status0 === 'future' ? 'waiting' : status0;

  let procId = (typeof e.procId === 'number' && Number.isInteger(e.procId)) ? e.procId : null;
  if (procId == null) procId = nextProcId++;

  const progress = (typeof e.progress === 'number' && Number.isFinite(e.progress)) ? Math.trunc(e.progress) : 0;
  const eta = (e.eta == null) ? null : Math.trunc(Number(e.eta));
  const speed = (typeof e.speed === 'number' && Number.isFinite(e.speed)) ? Math.trunc(e.speed) : 0;
  const sequence = (typeof e.sequence === 'number' && Number.isFinite(e.sequence)) ? Math.trunc(e.sequence) : 0;
  const fileSize = (typeof e.fileSize === 'number' && Number.isFinite(e.fileSize)) ? Math.trunc(e.fileSize) : 0;
  const season = (typeof e.season === 'number' && Number.isFinite(e.season)) ? Math.trunc(e.season) : 0;
  const episode = (typeof e.episode === 'number' && Number.isFinite(e.episode)) ? Math.trunc(e.episode) : 0;
  const dateStarted = (typeof e.dateStarted === 'number' && Number.isFinite(e.dateStarted)) ? Math.trunc(e.dateStarted) : 0;
  const dateEnded = (e.dateEnded == null) ? null : Math.trunc(Number(e.dateEnded));

  return {
    title,
    procId,
    usbPath: e.usbPath ? String(e.usbPath) : '',
    localPath: e.localPath ? String(e.localPath) : '',
    status,
    progress,
    eta,
    speed,
    sequence,
    fileSize,
    season,
    episode,
    dateStarted,
    dateEnded,
    inProgress: e.inProgress ? 1 : 0,
    error: e.error ? 1 : 0,
    reason: e.reason ? String(e.reason) : (e.status && e.status !== status ? String(e.status) : null),
  };
};

const upsertEntry = (entry) => {
  openDb();
  const v = normalizeEntryForDb(entry);
  if (!v.title) return;
  try {
    stmtUpsertByTitle.run(v);
  } catch {
    // Best effort; avoid crashing download pipeline.
  }
};

const updateEntryByProcId = (entry) => {
  openDb();
  const v = normalizeEntryForDb(entry);
  if (!v.title || v.procId == null) {
    upsertEntry(entry);
    return;
  }
  try {
    const info = stmtUpdateByProcId.run(v);
    if (!info || info.changes === 0) {
      // If procId not found, fall back to title upsert.
      upsertEntry(entry);
    }
  } catch {
    upsertEntry(entry);
  }
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

  openDb();

  // One-time migration: import data/tv.json into SQLite if DB is empty.
  try {
    const cnt = db.prepare('SELECT COUNT(1) AS n FROM tv_entries').get();
    const n = cnt && typeof cnt.n === 'number' ? cnt.n : 0;
    if (n === 0 && fs.existsSync(TV_JSON_PATH)) {
      const arr = readJson(TV_JSON_PATH, []);
      if (Array.isArray(arr)) {
        const insertMany = db.transaction((rows) => {
          for (const e of rows) {
            if (!e || typeof e !== 'object') continue;
            const t = e.title ? String(e.title) : '';
            if (!t) continue;
            // Preserve existing procId when present.
            const clone = { ...e };
            if (!(typeof clone.procId === 'number' && Number.isInteger(clone.procId))) {
              clone.procId = nextProcId++;
            }
            upsertEntry(clone);
          }
        });
        insertMany(arr);
      }
    }
  } catch {}

  // Normalize persisted statuses on restart.
  try {
    db.prepare("UPDATE tv_entries SET status='waiting' WHERE status='future'").run();
  } catch {}
  try {
    db.prepare("UPDATE tv_entries SET inProgress=0, status='waiting', progress=0, eta=NULL, speed=0, dateEnded=NULL WHERE inProgress=1 OR status='downloading'").run();
  } catch {}

  // Establish nextProcId from existing entries.
  try {
    const row = stmtGetMaxProcId.get();
    const maxId = row && row.maxProcId != null ? Number(row.maxProcId) : -1;
    nextProcId = (Number.isFinite(maxId) ? maxId : -1) + 1;
  } catch {
    nextProcId = 0;
  }

  // Assign procId to any rows missing it.
  try {
    const rows = db.prepare('SELECT title FROM tv_entries WHERE procId IS NULL ORDER BY rowid ASC').all();
    if (Array.isArray(rows) && rows.length) {
      const tx = db.transaction((rs) => {
        for (const r of rs) {
          const t = r && r.title ? String(r.title) : '';
          if (!t) continue;
          try {
            db.prepare('UPDATE tv_entries SET procId = ? WHERE title = ? AND procId IS NULL').run(nextProcId++, t);
          } catch {}
        }
      });
      tx(rows);
    }
  } catch {}

  // Load finished/errors/inProgress maps for immediate updates.
  finishedMap = readMap(TV_FINISHED_PATH);

  // One-time migration: if legacy tv-errors.json exists, mark matching entries as error:true then delete it.
  // Any mismatches are ignored.
  try {
    const legacyErrorsPath = path.join(DATA_DIR, 'tv-errors.json');
    if (fs.existsSync(legacyErrorsPath)) {
      const legacy = readMap(legacyErrorsPath);
      const keys = Object.keys(legacy || {});
      if (keys.length) {
        const tx = db.transaction((titles) => {
          for (const k of titles) {
            const t = String(k || '');
            if (!t) continue;
            try {
              db.prepare('UPDATE tv_entries SET error=1 WHERE title=?').run(t);
            } catch {}
          }
        });
        tx(keys);
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
};

const findOldestWaitingIndex = () => {
  try {
    openDb();
    const r = stmtFindOldestWaitingTitle.get();
    return r && r.title ? String(r.title) : null;
  } catch {
    return null;
  }
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
  updateEntryByProcId(entry);
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

      // Mark the entry as error in SQLite.
      try {
        openDb();
        db.prepare('UPDATE tv_entries SET error=1 WHERE title=?').run(title);
      } catch {}
      removeInProgress(title);
    }
  } catch {}
};

const startWorkerForTitle = (title) => {
  openDb();
  const row = stmtGetByTitle.get(title);
  const entry0 = rowToEntry(row);
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

  // Persist immediately so /downloads reflects the procId.
  upsertEntry(entry);

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

    const nextTitle = findOldestWaitingIndex();
    if (nextTitle) startWorkerForTitle(nextTitle);
  });
};

// Initialize on module load.
loadOnStart();

// ---- exports ---------------------------------------------------------------

const addEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return;

  openDb();

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

  let wasExisting = false;
  let existingEntry = null;
  try {
    const r0 = stmtGetByTitle.get(title);
    wasExisting = !!r0;
    existingEntry = rowToEntry(r0);
  } catch {
    wasExisting = false;
    existingEntry = null;
  }

  // If this title already exists and caller didn't provide procId,
  // preserve the existing procId so ordering stays stable.
  if (wasExisting && existingEntry && typeof existingEntry.procId === 'number' && Number.isInteger(existingEntry.procId)) {
    if (!(typeof e.procId === 'number' && Number.isInteger(e.procId))) {
      e.procId = existingEntry.procId;
    }
  }

  upsertEntry(e);

  // Add a tv.log line for every newly-added tv.json entry.
  if (!wasExisting) {
    const isError = !!e.error;
    const errorMsg = isError ? (e.reason || e.status || 'error') : null;
    logTvEntryAdded(title, errorMsg);
  }

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

    openDb();
    const existing = rowToEntry(stmtGetByTitle.get(t));
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

    upsertEntry(Object.assign({}, existing || {}, patch));

    // If it was ever marked inProgress, clear it.
    removeInProgress(t);
  } catch {}
};

const getDownloads = () => {
  try {
    openDb();
    const rows = stmtGetDownloads.all();
    const out = [];
    for (const r of rows) {
      const e = rowToEntry(r);
      if (e) out.push(e);
    }
    return out;
  } catch {
    return [];
  }
};

// For per-cycle de-dupe in main.js (replaces reading data/tv.json).
const getTitlesMap = () => {
  try {
    openDb();
    const rows = stmtGetTitles.all();
    const out = {};
    for (const r of rows) {
      if (!r || !r.title) continue;
      out[String(r.title)] = { error: !!r.error };
    }
    return out;
  } catch {
    return {};
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

    openDb();
    const rows = db.prepare('SELECT title, usbPath FROM tv_entries').all();
    if (!Array.isArray(rows) || !rows.length) return;

    const toDelete = [];
    for (const r of rows) {
      if (!r || !r.title) continue;
      const usbDir = normalizeUsbDir(r.usbPath);
      if (!usbDir) continue;
      if (!existingUsbDirs.has(usbDir)) {
        toDelete.push(String(r.title));
      }
    }

    if (!toDelete.length) return;

    const tx = db.transaction((titles) => {
      for (const t of titles) {
        try { stmtDeleteByTitle.run(t); } catch {}
      }
    });
    tx(toDelete);

    for (const t of toDelete) removeInProgress(t);
  } catch {}
};

module.exports = {
  addEntry,
  getDownloads,
  markError,
  pruneMissingUsbDirs,
  getTitlesMap,
};
