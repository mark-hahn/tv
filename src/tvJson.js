'use strict';

// tvJson.js
// - Owns download state and worker lifecycle
// - Persists state in SQLite (replaces data/tv.json and in-memory tvJsonCache)
// - Exports: addEntry(entry), getDownloads(), markError(), pruneMissingUsbDirs()

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');
const chokidar = require('chokidar');

const BASEDIR = path.join(__dirname, '..');
const DATA_DIR = path.join(BASEDIR, 'data');

// SQLite backing store (replaces data/tv.json)
const TV_DB_PATH = path.join(DATA_DIR, 'tv.sqlite');
// Legacy JSON path (migration-only)
const TV_JSON_PATH = path.join(DATA_DIR, 'tv.json');
const TV_FINISHED_PATH = path.join(DATA_DIR, 'tv-finished.json');
const TV_INPROGRESS_PATH = path.join(DATA_DIR, 'tv-inProgress.json');
const TV_LOG_PATH = path.join(BASEDIR, 'misc', 'tv.log');

const TV_DB_BACKUP_PATH = path.join(DATA_DIR, 'tv.sqlite.backup');

// Local TV library root for watcher assignment.
const TV_ROOT = '/mnt/media/tv';

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
let stmtDeleteByProcId = null;
let stmtFindOldestWaitingTitle = null;
let stmtGetMaxProcId = null;
let stmtGetDownloads = null;
let stmtGetTitles = null;

const unixNow = () => Math.floor(Date.now() / 1000);

// ---- tvResync + chokidar watchers -----------------------------------------

// One chokidar watcher per directory under TV_ROOT.
const dirWatchers = new Map(); // dirPath -> FSWatcher

let tvResyncInFlight = false;
let tvResyncQueued = false;

const safeExists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

const safeIsDir = (p) => {
  try {
    const st = fs.statSync(p);
    return !!(st && st.isDirectory());
  } catch {
    return false;
  }
};

const toPstParts = (ms) => {
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
    return {
      ymd: `${m.year}-${m.month}-${m.day}`,
      hm: `${m.hour}:${m.minute}`,
    };
  } catch {
    const d = new Date(ms);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return { ymd: `${y}-${mo}-${da}`, hm: `${hh}:${mm}` };
  }
};

const deleteDbEntryForLocalFilePath = (filePath) => {
  try {
    const fp = String(filePath || '');
    if (!fp || !path.isAbsolute(fp)) return;

    // Derive (localPath, title) from the filesystem event.
    const title = path.basename(fp);
    const dir = path.dirname(fp);
    if (!title || !dir) return;

    const localPath1 = dir;
    const localPath2 = dir.endsWith(path.sep) ? dir : (dir + path.sep);
    const localPath3 = localPath2.replace(/\/+$/g, '/')
      .replace(/\\+$/g, path.sep);

    openDb();

    // NOTE: requested behavior: delete only finished non-errored rows in tv.sqlite;
    // do not touch any other datastore.
    try {
      db.prepare(
        "DELETE FROM tv_entries WHERE title=? AND status='finished' AND (error IS NULL OR error=0) AND (localPath=? OR localPath=? OR localPath=?)"
      ).run(title, localPath1, localPath2, localPath3);
    } catch {}
  } catch {}
};

const walkDirectories = (rootDir) => {
  const out = [];
  try {
    const root = String(rootDir || '');
    if (!root) return out;
    if (!safeIsDir(root)) return out;

    const stack = [root];
    const seen = new Set();
    const MAX_DIRS = 200000;

    while (stack.length) {
      const dir = stack.pop();
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      out.push(dir);
      if (out.length >= MAX_DIRS) break;

      let ents;
      try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const ent of ents) {
        if (!ent || !ent.isDirectory()) continue;
        const name = ent.name != null ? String(ent.name) : '';
        if (!name) continue;
        // Avoid pathological recursion; keep it simple.
        if (name === '.' || name === '..') continue;
        const child = path.join(dir, name);
        stack.push(child);
      }
    }

    return out;
  } catch {
    return out;
  }
};

const ensureWatcherForDir = (dir) => {
  const d = String(dir || '');
  if (!d) return false;
  if (dirWatchers.has(d)) return false;
  if (!safeIsDir(d)) return false;

  try {
    const w = chokidar.watch(d, {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: false,
    });

    w.on('unlink', (p) => {
      try {
        const fp = String(p || '');
        deleteDbEntryForLocalFilePath(fp);
      } catch {}
    });

    // Move/rename events: chokidar doesn't emit a high-level rename event, but it
    // does surface underlying rename/move notifications via `raw`.
    // We do NOT listen to add/addDir.
    w.on('raw', (eventName, eventPath, details) => {
      try {
        const ev = String(eventName || '').toLowerCase();
        const det = details && typeof details === 'object' ? details : {};
        const detEvent = det && det.event != null ? String(det.event).toLowerCase() : '';
        const p = String(eventPath || '');

        // Only handle move/rename.
        // inotify commonly reports moves/renames as eventName='rename'.
        if (ev === 'rename' || detEvent.includes('moved') || detEvent.includes('rename')) {
          // Best-effort: only resync when it pertains to the watched dir.
          if (!p || p.startsWith(d)) tvResync();
        }
      } catch {}
    });

    // Directory deletes can manifest as unlinkDir; treat as unlink => resync.
    w.on('unlinkDir', () => tvResync());
    w.on('error', () => {});

    dirWatchers.set(d, w);
    return true;
  } catch {
    return false;
  }
};

const ensureTvRootWatchers = () => {
  const result = { ok: true, watched: 0, added: 0, removed: 0 };
  try {
    const dirs = walkDirectories(TV_ROOT);
    const set = new Set(dirs);

    for (const d of dirs) {
      if (!dirWatchers.has(d)) {
        const added = ensureWatcherForDir(d);
        if (added) result.added++;
      }
    }

    // Drop watchers for directories that no longer exist.
    for (const [d, w] of dirWatchers.entries()) {
      if (set.has(d)) continue;
      try { w.close(); } catch {}
      dirWatchers.delete(d);
      result.removed++;
    }

    result.watched = dirWatchers.size;
    return result;
  } catch (e) {
    result.ok = false;
    return result;
  }
};

// First pass: delete orphaned finished rows whose localPath/title file is missing.
// Second pass: ensure all directories under TV_ROOT have watchers.
const tvResync = () => {
  try {
    if (tvResyncInFlight) {
      tvResyncQueued = true;
      return;
    }
    tvResyncInFlight = true;

    setImmediate(() => {
      try {
        openDb();

        // Only delete finished rows (never delete errored entries).
        let rows = [];
        try {
          rows = db.prepare("SELECT title, localPath, status, error FROM tv_entries").all();
        } catch {
          rows = [];
        }

        const toDelete = [];
        for (const r of rows) {
          if (!r) continue;
          const title = r.title != null ? String(r.title) : '';
          const localPath = r.localPath != null ? String(r.localPath) : '';
          const status = r.status != null ? String(r.status) : '';
          const error = r.error == null ? 0 : Number(r.error);
          if (!title) continue;

          // Orphan definition for this resync: finished but missing local file.
          if (status !== 'finished') continue;
          if (Number.isFinite(error) && error !== 0) continue;

          if (!localPath || !path.isAbsolute(localPath)) {
            toDelete.push(title);
            continue;
          }
          if (path.isAbsolute(title) || title.includes('\0') || title.includes('..')) {
            toDelete.push(title);
            continue;
          }

          const filePath = path.resolve(localPath, title);
          if (!safeExists(filePath)) {
            toDelete.push(title);
          }
        }

        if (toDelete.length) {
          const tx = db.transaction((titles) => {
            for (const t of titles) {
              try { stmtDeleteByTitle.run(t); } catch {}
            }
          });
          tx(toDelete);
        }

        // Pass 2: ensure watchers for all TV_ROOT directories.
        try {
          ensureTvRootWatchers();
        } catch {}
      } finally {
        tvResyncInFlight = false;
        if (tvResyncQueued) {
          tvResyncQueued = false;
          tvResync();
        }
      }
    });
  } catch {
    tvResyncInFlight = false;
  }
};

// Hourly prune hook: combine missing USB-dir pruning with orphan local-file pruning.
// existingUsbDirs: Set of relative directory paths under "files/" on the usbHost.
const hourlyUsbPruneAndTvResync = (existingUsbDirs) => {
  try {
    if (!existingUsbDirs || typeof existingUsbDirs.has !== 'function') {
      tvResync();
      return;
    }

    const normalizeUsbDir = (usbPath) => {
      let p = String(usbPath || '');
      p = p.replace(/^~\//, '');
      p = p.replace(/^\/+/, '');
      if (p.startsWith('files/')) p = p.slice('files/'.length);
      if (p.startsWith('~/files/')) p = p.slice('~/files/'.length);
      p = p.replace(/^files\//, '');
      p = p.replace(/^\.\/?/, '');
      p = p.replace(/\/+$/g, '');
      return p;
    };

    openDb();
    let rows = [];
    try {
      rows = db.prepare('SELECT title, usbPath, localPath, status, error FROM tv_entries').all();
    } catch {
      rows = [];
    }
    if (!Array.isArray(rows) || !rows.length) {
      tvResync();
      return;
    }

    const missingUsbTitles = [];
    const orphanFinishedTitles = [];

    for (const r of rows) {
      if (!r) continue;
      const title = r.title != null ? String(r.title) : '';
      if (!title) continue;

      // Only delete finished and non-errored entries.
      const status = r.status != null ? String(r.status) : '';
      const error = r.error == null ? 0 : Number(r.error);
      if (status !== 'finished') continue;
      if (Number.isFinite(error) && error !== 0) continue;

      // USB-dir pruning (existing behavior)
      try {
        const usbDir = normalizeUsbDir(r.usbPath);
        if (usbDir && !existingUsbDirs.has(usbDir)) {
          missingUsbTitles.push(title);
        }
      } catch {}

      // Orphan pruning: finished but missing local file.
      const localPath = r.localPath != null ? String(r.localPath) : '';
      if (!localPath || !path.isAbsolute(localPath)) {
        orphanFinishedTitles.push(title);
        continue;
      }
      if (path.isAbsolute(title) || title.includes('\0') || title.includes('..')) {
        orphanFinishedTitles.push(title);
        continue;
      }
      const filePath = path.resolve(localPath, title);
      if (!safeExists(filePath)) {
        orphanFinishedTitles.push(title);
      }
    }

    const toDelete = Array.from(new Set([...missingUsbTitles, ...orphanFinishedTitles]));
    if (toDelete.length) {
      const tx = db.transaction((titles) => {
        for (const t of titles) {
          try { stmtDeleteByTitle.run(t); } catch {}
        }
      });
      tx(toDelete);
    }

    // Finish with watcher resync (pass 2).
    try {
      ensureTvRootWatchers();
    } catch {}
  } catch {
    tvResync();
  }
};

// Scheduled SQLite backup at 05:30, 11:30, 17:30, 23:30 PST.
let lastBackupKey = '';
const backupTimes = new Set(['05:30', '11:30', '17:30', '23:30']);

const runSqliteBackup = () => {
  try {
    ensureDataDir();
    // Use sqlite3 CLI so backup is consistent even with WAL.
    execFile(
      'sqlite3',
      [TV_DB_PATH, `.backup '${TV_DB_BACKUP_PATH}'`],
      { timeout: 5 * 60 * 1000 },
      () => {}
    );
  } catch {}
};

const startBackupScheduler = () => {
  try {
    setInterval(() => {
      try {
        const { ymd, hm } = toPstParts(Date.now());
        if (!backupTimes.has(hm)) return;
        const key = `${ymd} ${hm}`;
        if (key === lastBackupKey) return;
        lastBackupKey = key;
        runSqliteBackup();
      } catch {}
    }, 20 * 1000);
  } catch {}
};

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
  stmtDeleteByProcId = db.prepare('DELETE FROM tv_entries WHERE procId = ?');

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
      // If procId not found, only fall back to title upsert when the title
      // already exists (procId mismatch). Do NOT insert a new row here; that
      // can resurrect rows intentionally deleted via /deleteProcids.
      try {
        const existing = stmtGetByTitle.get(v.title);
        if (existing) upsertEntry(entry);
      } catch {}
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

// On module load, run a resync (DB orphan cleanup + watcher assignment) and start backup schedule.
try {
  tvResync();
} catch {}
try {
  startBackupScheduler();
} catch {}

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

// Return the subset of titles that are finished and have no error.
// Used by the HTTP endpoint /checkFiles.
const checkFiles = (titles) => {
  try {
    if (!Array.isArray(titles) || titles.length === 0) return [];

    const cleaned = [];
    const seen = new Set();
    for (const t0 of titles) {
      const t = String(t0 || '').trim();
      if (!t) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      cleaned.push(t);
      if (cleaned.length >= 5000) break;
    }

    if (cleaned.length === 0) return { existingTitles: [], existingProcids: [] };

    openDb();
    const placeholders = cleaned.map(() => '?').join(',');
    const sql = `SELECT title, procId FROM tv_entries WHERE title IN (${placeholders}) AND status='finished' AND (error IS NULL OR error=0)`;
    const rows = db.prepare(sql).all(...cleaned);
    if (!Array.isArray(rows) || rows.length === 0) return { existingTitles: [], existingProcids: [] };

    const existingTitles = [];
    const existingProcids = [];
    for (const r of rows) {
      if (!r) continue;
      const t = r.title != null ? String(r.title) : '';
      if (t) existingTitles.push(t);
      const pid = (typeof r.procId === 'number') ? r.procId : (r.procId == null ? null : Number(r.procId));
      if (pid != null && Number.isFinite(pid)) existingProcids.push(pid);
    }
    return { existingTitles, existingProcids };
  } catch {
    return { existingTitles: [], existingProcids: [] };
  }
};

// Delete local files and matching DB rows by procId.
// Returns { ok:true, deletedProcids:[], skippedProcids:[], errors:[] }
const deleteProcids = (procIds) => {
  const result = { ok: true, deletedProcids: [], skippedProcids: [], errors: [] };
  try {
    if (!Array.isArray(procIds) || procIds.length === 0) return result;
    openDb();
    ensureMapsLoaded();

    const cleaned = [];
    const seen = new Set();
    for (const p0 of procIds) {
      const pid = (typeof p0 === 'number') ? p0 : Number(p0);
      if (!Number.isFinite(pid)) continue;
      const pid2 = Math.trunc(pid);
      if (pid2 < 0) continue;
      if (seen.has(pid2)) continue;
      seen.add(pid2);
      cleaned.push(pid2);
      if (cleaned.length >= 5000) break;
    }
    if (cleaned.length === 0) return result;

    for (const pid of cleaned) {
      let row;
      try {
        row = stmtGetByProcId.get(pid);
      } catch {
        row = null;
      }

      if (!row) {
        result.skippedProcids.push(pid);
        continue;
      }

      const title = row.title != null ? String(row.title) : '';
      const localPath = row.localPath != null ? String(row.localPath) : '';

      // Compute local file path safely.
      if (!localPath || !path.isAbsolute(localPath)) {
        result.ok = false;
        result.errors.push({ procId: pid, title, error: 'invalid localPath' });
        continue;
      }
      if (!title || path.isAbsolute(title) || title.includes('\0') || title.includes('..')) {
        result.ok = false;
        result.errors.push({ procId: pid, title, error: 'invalid title path' });
        continue;
      }

      const base = path.resolve(localPath);
      const filePath = path.resolve(localPath, title);
      if (!(filePath === base || filePath.startsWith(base + path.sep))) {
        result.ok = false;
        result.errors.push({ procId: pid, title, error: 'refuses to delete outside localPath' });
        continue;
      }

      // Delete the local file; ENOENT is fine.
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        if (!(e && e.code === 'ENOENT')) {
          result.ok = false;
          result.errors.push({ procId: pid, title, error: (e && e.message) ? String(e.message) : 'unlink failed' });
          continue;
        }
      }

      // Remove DB row.
      try {
        // title is the primary key; delete by title to avoid procId races.
        stmtDeleteByTitle.run(title);
      } catch (e) {
        result.ok = false;
        result.errors.push({ procId: pid, title, error: (e && e.message) ? String(e.message) : 'db delete failed' });
        continue;
      }

      // Clear finished/inProgress markers so the title can be re-downloaded.
      try {
        if (title && finishedMap && Object.prototype.hasOwnProperty.call(finishedMap, title)) {
          delete finishedMap[title];
          writeMap(TV_FINISHED_PATH, finishedMap);
        }
      } catch {}
      try {
        removeInProgress(title);
      } catch {}

      result.deletedProcids.push(pid);
    }

    return result;
  } catch (e) {
    result.ok = false;
    result.errors.push({ error: (e && e.message) ? String(e.message) : String(e) });
    return result;
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
  tvResync,
  hourlyUsbPruneAndTvResync,
  getTitlesMap,
  checkFiles,
  deleteProcids,
};
