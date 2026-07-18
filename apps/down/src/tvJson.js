// tvJson.js
// - Owns download state and worker lifecycle
// - Persists state in SQLite
// - Exports: addEntry(entry), getDownloads(), markError(), pruneMissingUsbDirs()

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import Database from "better-sqlite3";
import chokidar from "chokidar";
import { unilog, logHere } from "@tv/share";

const LOG_APPS_DOWN_DATA_MISC_TV_LOG = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASEDIR = path.join(__dirname, "..");

const APP_DIR = BASEDIR;
const DATA_DIR = path.join(APP_DIR, "data");
const MISC_DIR = path.join(DATA_DIR, "misc");
const SRVR_DATA_DIR = path.join(APP_DIR, "..", "srvr", "data");

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

ensureDir(DATA_DIR);
ensureDir(MISC_DIR);

// SQLite backing store
const TV_DB_PATH = path.join(DATA_DIR, "tv.sqlite");
const TV_INPROGRESS_PATH = path.join(DATA_DIR, "tv-inProgress.json");
const TV_LOG_PATH = path.join(MISC_DIR, "tv.log");
const TVDB_DB_PATH = path.join(SRVR_DATA_DIR, "tvdb.db");
const PENDING_TVDB_FIELDS_PATH = path.join(
  DATA_DIR,
  "pending-tvdb-fields.json",
);
const PENDING_TVDB_FIELDS_RETRY_MS = 60 * 1000;

const TV_DB_BACKUP_PATH = path.join(DATA_DIR, "tv.sqlite.backup");

// State is stored under apps/down/data.

// Local TV library root for watcher assignment.
const TV_ROOT = "/mnt/media/tv";
const SRVR_INTERNAL_HOST = "127.0.0.1";
const SRVR_INTERNAL_PORT = 8739;

const WORKER_URL = new URL("./worker.js", import.meta.url);

const MAX_WORKERS = 8;
const usbHost = "xobtlu@xobtlu.baron.usbx.me";

const forcedTitles = new Set();

// PST/PDT formatting
const PST_TZ = "America/Los_Angeles";

const logTvEntryAdded = (title, errorMsg) => {
  try {
    const t = title ? String(title) : "";
    if (!t) return;
    if (errorMsg) {
      unilog(1188, `ERROR: ${t} ${String(errorMsg)}`);
    } else {
      unilog(1189, `${t}`);
    }
  } catch (e) {
    unilog(1190, "<missing>");
  }
};

const dateStr = (ms) => {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: PST_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(ms));
    const m = {};
    for (const p of parts) {
      if (p && p.type && p.value) m[p.type] = p.value;
    }
    const hour = m.hour === "24" ? "00" : m.hour;
    return `${m.year}/${m.month}/${m.day}-${hour}:${m.minute}:${m.second}`;
  } catch {
    const d = new Date(ms);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${year}/${month}/${day}-${hours}:${minutes}:${seconds}`;
  }
};

const readJson = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJsonAtomic = (filePath, obj) => {
  try {
    const dir = path.dirname(filePath);
    const tmp = path.join(
      dir,
      "." + path.basename(filePath) + ".tmp." + process.pid + "." + Date.now(),
    );
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, filePath);
  } catch {}
};

const readMap = (filePath) => {
  const obj = readJson(filePath, {});
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  return obj;
};

const writeMap = (filePath, mapObj) => {
  // mapObj values are already formatted strings
  writeJsonAtomic(filePath, mapObj);
};

// ---- SQLite-backed state (single authority) --------------------------------

let db = null;
let tvdbDb = null;
let workerCount = 0;
let nextProcId = 0;

let inProgressCache = null;

// Maps title -> Worker for in-flight downloads.
const activeWorkers = new Map();
// Titles being aborted — suppresses error recording in exit handler.
const abortingTitles = new Set();

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

const getTvdbDb = () => {
  if (!tvdbDb) {
    tvdbDb = new Database(TVDB_DB_PATH, {
      readonly: true,
      fileMustExist: true,
    });
    tvdbDb.pragma("busy_timeout = 5000");
  }
  return tvdbDb;
};

const unixNow = () => Math.floor(Date.now() / 1000);

const isUnderTvRoot = (localPath) => {
  const lp = localPath ? String(localPath) : "";
  return lp === TV_ROOT || lp.startsWith(TV_ROOT + "/");
};

const postSetTvdbFields = (params) => {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(params);
    const req = http.request(
      {
        host: SRVR_INTERNAL_HOST,
        port: SRVR_INTERNAL_PORT,
        path: "/api/setTvdbFields",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
            return;
          }
          reject(
            new Error(
              `setTvdbFields failed: ${res.statusCode || 0} ${String(body || "").slice(0, 200)}`.trim(),
            ),
          );
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
};

// seriesName from TVDB search usually has a "(YYYY)" year suffix while
// tvdb keys usually don't, so build candidate names and try each.
const stripYearSuffix = (name) => name.replace(/\s*\(\d{4}\)\s*$/, "");

const showFolderFromLocalPath = (localPath) => {
  const lp = localPath ? String(localPath) : "";
  if (!lp.startsWith(TV_ROOT + "/")) return "";
  return lp.slice(TV_ROOT.length + 1).split("/")[0] || "";
};

const buildNameCandidates = (showName, localPath) => {
  const name = String(showName || "").trim();
  const folder = showFolderFromLocalPath(localPath).trim();
  const candidates = [];
  for (const cand of [
    name,
    stripYearSuffix(name),
    folder,
    stripYearSuffix(folder),
  ]) {
    if (cand && !candidates.includes(cand)) candidates.push(cand);
  }
  return candidates;
};

const isTvdbRecord = (v) => v && typeof v === "object" && !Array.isArray(v);

// Resolve a tvdb key from candidates: exact, then case-insensitive,
// then year-stripped keys (tvdb key "Rivals (2024)" vs candidate "Rivals").
// Ambiguous year-stripped matches (two keys strip to the same name) are
// skipped rather than guessed.
const resolveTvdbKey = (tvdb, candidates) => {
  for (const cand of candidates) if (isTvdbRecord(tvdb[cand])) return cand;
  const lowerKeys = new Map();
  const strippedKeys = new Map();
  for (const key of Object.keys(tvdb)) {
    if (!isTvdbRecord(tvdb[key])) continue;
    lowerKeys.set(key.toLowerCase(), key);
    const stripped = stripYearSuffix(key).toLowerCase();
    strippedKeys.set(stripped, strippedKeys.has(stripped) ? false : key);
  }
  for (const cand of candidates) {
    const hit = lowerKeys.get(cand.toLowerCase());
    if (hit) return hit;
  }
  for (const cand of candidates) {
    const hit = strippedKeys.get(stripYearSuffix(cand).toLowerCase());
    if (hit) return hit;
  }
  return null;
};

const resolveTvdbKeyFromFile = (candidates) => {
  const tvdb = {};
  const rows = getTvdbDb().prepare(`SELECT name FROM shows`).all();
  for (const row of rows) tvdb[row.name] = {};
  return resolveTvdbKey(tvdb, candidates);
};

let pendingTvdbFields = null;

const loadPendingTvdbFields = () => {
  if (!pendingTvdbFields) {
    pendingTvdbFields = readMap(PENDING_TVDB_FIELDS_PATH);
  }
  return pendingTvdbFields;
};

const persistPendingTvdbFields = () => {
  writeJsonAtomic(PENDING_TVDB_FIELDS_PATH, loadPendingTvdbFields());
};

const queuePendingTvdbFields = (showName, timestamp, localPath, err) => {
  const key = String(showName || "").trim();
  if (!key) return;
  const queue = loadPendingTvdbFields();
  queue[key] = { timestamp, localPath: String(localPath || "") };
  persistPendingTvdbFields();
  unilog(
    1528,
    `queued last-downloaded update for ${key}: ${err?.message || String(err)}`,
  );
};

const postLastDownloadedToSrvr = async (showName, timestamp, localPath) => {
  const candidates = buildNameCandidates(showName, localPath);
  const ts = Math.trunc(Number(timestamp));
  if (candidates.length === 0 || !Number.isFinite(ts) || ts <= 0) return false;

  for (const name of candidates) {
    const body = await postSetTvdbFields({
      name,
      "last-downloaded": ts,
      dontEnqueue: true,
    });
    // setTvdbFields returns the string "no tvdb" (HTTP 200) on a key miss.
    if (String(body || "").trim() !== '"no tvdb"') return true;
  }

  // All exact candidates missed — resolve fuzzily (case, year suffix)
  // against tvdb db keys and retry with the real key.
  const key = resolveTvdbKeyFromFile(candidates);
  if (key && !candidates.includes(key)) {
    const body = await postSetTvdbFields({
      name: key,
      "last-downloaded": ts,
      dontEnqueue: true,
    });
    if (String(body || "").trim() !== '"no tvdb"') return true;
  }

  unilog(
    1286,
    `last-downloaded: no tvdb record matched ${candidates.join(" | ")}`,
  );
  return false;
};

const recordShowDownloadedInternal = async (showName, timestamp, localPath) => {
  const ts = Math.trunc(Number(timestamp));
  try {
    return await postLastDownloadedToSrvr(showName, ts, localPath);
  } catch (err) {
    queuePendingTvdbFields(showName, ts, localPath, err);
    return false;
  }
};

const retryPendingTvdbFields = async () => {
  const queue = loadPendingTvdbFields();
  const entries = Object.entries(queue);
  if (entries.length === 0) return;

  let changed = false;
  for (const [showName, entry] of entries) {
    try {
      const saved = await postLastDownloadedToSrvr(
        showName,
        entry?.timestamp,
        entry?.localPath || "",
      );
      if (saved) {
        delete queue[showName];
        changed = true;
      }
    } catch (e) {
      unilog(
        1529,
        `pending last-downloaded retry failed for ${showName}: ${e?.message || String(e)}`,
      );
    }
  }

  if (changed) persistPendingTvdbFields();
};

loadPendingTvdbFields();
setInterval(() => {
  retryPendingTvdbFields().catch((e) => {
    unilog(
      1530,
      `pending last-downloaded retry loop failed: ${e?.message || String(e)}`,
    );
  });
}, PENDING_TVDB_FIELDS_RETRY_MS);

export const recordShowDownloaded = async (
  showName,
  timestamp = unixNow(),
  localPath = "",
) => {
  return recordShowDownloadedInternal(showName, timestamp, localPath);
};

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
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: PST_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(ms));
    const m = {};
    for (const p of parts) {
      if (p && p.type && p.value) m[p.type] = p.value;
    }
    const hour = m.hour === "24" ? "00" : m.hour;
    return {
      ymd: `${m.year}-${m.month}-${m.day}`,
      hm: `${hour}:${m.minute}`,
    };
  } catch {
    const d = new Date(ms);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return { ymd: `${y}-${mo}-${da}`, hm: `${hh}:${mm}` };
  }
};

const deleteDbEntryForLocalFilePath = (_filePath) => {
  // Intentionally a no-op: deleting the SQLite record when a local file is
  // removed causes the down server to re-download intentionally deleted
  // episodes on its next cycle.  Records are cleaned up by
  // hourlyUsbPruneAndTvResync once the USB source dir expires.
};

const walkDirectories = (rootDir) => {
  const out = [];
  try {
    const root = String(rootDir || "");
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
        const name = ent.name != null ? String(ent.name) : "";
        if (!name) continue;
        // Avoid pathological recursion; keep it simple.
        if (name === "." || name === "..") continue;
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
  const d = String(dir || "");
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

    w.on("unlink", (p) => {
      try {
        const fp = String(p || "");
        deleteDbEntryForLocalFilePath(fp);
      } catch {}
    });

    // Move/rename events: chokidar doesn't emit a high-level rename event, but it
    // does surface underlying rename/move notifications via `raw`.
    // We do NOT listen to add/addDir.
    w.on("raw", (eventName, eventPath, details) => {
      try {
        const ev = String(eventName || "").toLowerCase();
        const det = details && typeof details === "object" ? details : {};
        const detEvent =
          det && det.event != null ? String(det.event).toLowerCase() : "";
        const p = String(eventPath || "");

        // Only handle move/rename.
        // inotify commonly reports moves/renames as eventName='rename'.
        if (
          ev === "rename" ||
          detEvent.includes("moved") ||
          detEvent.includes("rename")
        ) {
          // Best-effort: only resync when it pertains to the watched dir.
          if (!p || p.startsWith(d)) tvResync();
        }
      } catch {}
    });

    // Directory deletes can manifest as unlinkDir; treat as unlink => resync.
    w.on("unlinkDir", () => tvResync());
    w.on("error", () => {});

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
      try {
        w.close();
      } catch {}
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
        // Pass 2: ensure watchers for all TV_ROOT directories.
        // Note: orphan-pruning (delete finished rows when local file is missing)
        // was removed because it caused re-downloads of intentionally deleted
        // episodes.  Records are now only deleted by hourlyUsbPruneAndTvResync
        // once the USB source directory expires.
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
    if (!existingUsbDirs || typeof existingUsbDirs.has !== "function") {
      tvResync();
      return;
    }

    const normalizeUsbDir = (usbPath) => {
      let p = String(usbPath || "");
      p = p.replace(/^~\//, "");
      p = p.replace(/^\/+/, "");
      if (p.startsWith("files/")) p = p.slice("files/".length);
      if (p.startsWith("~/files/")) p = p.slice("~/files/".length);
      p = p.replace(/^files\//, "");
      p = p.replace(/^\.\/?/, "");
      p = p.replace(/\/+$/g, "");
      return p;
    };

    openDb();
    let rows = [];
    try {
      rows = db
        .prepare(
          "SELECT title, usbPath, localPath, status, error FROM tv_entries",
        )
        .all();
    } catch {
      rows = [];
    }
    if (!Array.isArray(rows) || !rows.length) {
      tvResync();
      return;
    }

    const missingUsbTitles = [];

    for (const r of rows) {
      if (!r) continue;
      const title = r.title != null ? String(r.title) : "";
      if (!title) continue;

      // Only delete finished and non-errored entries.
      const status = r.status != null ? String(r.status) : "";
      const error = r.error == null ? 0 : Number(r.error);
      if (status !== "finished") continue;
      if (Number.isFinite(error) && error !== 0) continue;

      // DVD:makemkv cards and per-file DVD staging entries must never be
      // orphan-pruned — the finished DVD:makemkv card is the guard that
      // prevents re-running makemkv after staging is cleaned up, and
      // staged VOB/IFO/BUP files are intentionally deleted after processing.
      if (title.startsWith("DVD:")) continue;
      const localPathStr = r.localPath != null ? String(r.localPath) : "";
      if (localPathStr.includes("tmp-dvd")) continue;

      // USB-dir pruning: remove records whose USB source dir is gone.
      try {
        const usbDir = normalizeUsbDir(r.usbPath);
        if (usbDir && !existingUsbDirs.has(usbDir)) {
          missingUsbTitles.push(title);
        }
      } catch {}
    }

    const toDelete = [...missingUsbTitles];
    if (toDelete.length) {
      const tx = db.transaction((titles) => {
        for (const t of titles) {
          try {
            stmtDeleteByTitle.run(t);
          } catch {}
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
let lastBackupKey = "";
const backupTimes = new Set(["05:30", "11:30", "17:30", "23:30"]);

const runSqliteBackup = () => {
  try {
    ensureDataDir();
    // Use sqlite3 CLI so backup is consistent even with WAL.
    execFile(
      "sqlite3",
      [TV_DB_PATH, `.backup '${TV_DB_BACKUP_PATH}'`],
      { timeout: 5 * 60 * 1000 },
      () => {},
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
    db.pragma("journal_mode = WAL");
  } catch {}
  try {
    db.pragma("synchronous = NORMAL");
  } catch {}
  try {
    db.pragma("busy_timeout = 5000");
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

  // Add seriesName column if it doesn't exist yet (schema migration).
  try {
    db.prepare("ALTER TABLE tv_entries ADD COLUMN seriesName TEXT").run();
  } catch {}
  try {
    db.prepare("ALTER TABLE tv_entries ADD COLUMN destTitle TEXT").run();
  } catch {}
  try {
    db.prepare("ALTER TABLE tv_entries ADD COLUMN fromFlex INTEGER").run();
  } catch {}

  stmtUpsertByTitle = db.prepare(`
    INSERT INTO tv_entries (
      title, procId, usbPath, localPath, status, progress, eta, speed,
      sequence, fileSize, season, episode, dateStarted, dateEnded,
      inProgress, error, reason, seriesName, destTitle, fromFlex
    ) VALUES (
      @title, @procId, @usbPath, @localPath, @status, @progress, @eta, @speed,
      @sequence, @fileSize, @season, @episode, @dateStarted, @dateEnded,
      @inProgress, @error, @reason, @seriesName, @destTitle, @fromFlex
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
      fileSize=CASE WHEN excluded.fileSize > 0 THEN excluded.fileSize ELSE fileSize END,
      season=excluded.season,
      episode=excluded.episode,
      dateStarted=CASE WHEN excluded.dateStarted > 0 THEN excluded.dateStarted ELSE dateStarted END,
      dateEnded=excluded.dateEnded,
      inProgress=excluded.inProgress,
      error=excluded.error,
      reason=excluded.reason,
      seriesName=excluded.seriesName,
      destTitle=excluded.destTitle,
      fromFlex=excluded.fromFlex
  `);

  stmtGetByTitle = db.prepare("SELECT * FROM tv_entries WHERE title = ?");
  stmtGetByProcId = db.prepare("SELECT * FROM tv_entries WHERE procId = ?");
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
  stmtDeleteByTitle = db.prepare("DELETE FROM tv_entries WHERE title = ?");
  stmtDeleteByProcId = db.prepare("DELETE FROM tv_entries WHERE procId = ?");

  stmtFindOldestWaitingTitle = db.prepare(
    "SELECT title FROM tv_entries WHERE status='waiting' ORDER BY procId ASC LIMIT 1",
  );
  stmtGetMaxProcId = db.prepare(
    "SELECT MAX(procId) AS maxProcId FROM tv_entries",
  );
  // Return the newest 200 rows (by procId) but in ascending procId order
  // so callers can display consistently without extra sorting.
  stmtGetDownloads = db.prepare(
    "SELECT * FROM (SELECT * FROM tv_entries ORDER BY procId DESC LIMIT 200) ORDER BY procId ASC",
  );
  stmtGetTitles = db.prepare("SELECT title, error, status FROM tv_entries");
};

const rowToEntry = (row) => {
  if (!row || typeof row !== "object") return null;
  return {
    procId:
      typeof row.procId === "number"
        ? row.procId
        : row.procId == null
          ? null
          : Number(row.procId),
    usbPath: row.usbPath || "",
    localPath: row.localPath || "",
    title: row.title || "",
    seriesName: row.seriesName || undefined,
    status: row.status || "waiting",
    progress:
      typeof row.progress === "number"
        ? row.progress
        : row.progress == null
          ? 0
          : Number(row.progress),
    eta: row.eta == null ? null : Number(row.eta),
    speed:
      typeof row.speed === "number"
        ? row.speed
        : row.speed == null
          ? 0
          : Number(row.speed),
    sequence:
      typeof row.sequence === "number"
        ? row.sequence
        : row.sequence == null
          ? 0
          : Number(row.sequence),
    fileSize:
      typeof row.fileSize === "number"
        ? row.fileSize
        : row.fileSize == null
          ? 0
          : Number(row.fileSize),
    season:
      typeof row.season === "number"
        ? row.season
        : row.season == null
          ? 0
          : Number(row.season),
    episode:
      typeof row.episode === "number"
        ? row.episode
        : row.episode == null
          ? 0
          : Number(row.episode),
    dateStarted:
      typeof row.dateStarted === "number"
        ? row.dateStarted
        : row.dateStarted == null
          ? 0
          : Number(row.dateStarted),
    dateEnded: row.dateEnded == null ? null : Number(row.dateEnded),
    inProgress: !!row.inProgress,
    error: !!row.error,
    reason: row.reason || undefined,
    destTitle: row.destTitle || undefined,
    fromFlex: row.fromFlex ? true : false,
  };
};

const normalizeEntryForDb = (entry) => {
  const e = entry && typeof entry === "object" ? entry : {};
  const title = e.title ? String(e.title) : "";

  // Defaults match prior tv.json behavior.
  const status0 = e.status ? String(e.status) : "waiting";
  const status = status0 === "future" ? "waiting" : status0;

  let procId =
    typeof e.procId === "number" && Number.isInteger(e.procId)
      ? e.procId
      : null;
  if (procId == null) procId = nextProcId++;

  const progress =
    typeof e.progress === "number" && Number.isFinite(e.progress)
      ? Math.trunc(e.progress)
      : 0;
  const eta = e.eta == null ? null : Math.trunc(Number(e.eta));
  const speed =
    typeof e.speed === "number" && Number.isFinite(e.speed)
      ? Math.trunc(e.speed)
      : 0;
  const sequence =
    typeof e.sequence === "number" && Number.isFinite(e.sequence)
      ? Math.trunc(e.sequence)
      : 0;
  const fileSize =
    typeof e.fileSize === "number" && Number.isFinite(e.fileSize)
      ? Math.trunc(e.fileSize)
      : 0;
  const season =
    typeof e.season === "number" && Number.isFinite(e.season)
      ? Math.trunc(e.season)
      : 0;
  const episode =
    typeof e.episode === "number" && Number.isFinite(e.episode)
      ? Math.trunc(e.episode)
      : 0;
  const dateStarted =
    typeof e.dateStarted === "number" && Number.isFinite(e.dateStarted)
      ? Math.trunc(e.dateStarted)
      : 0;
  const dateEnded =
    e.dateEnded == null ? null : Math.trunc(Number(e.dateEnded));

  return {
    title,
    procId,
    usbPath: e.usbPath ? String(e.usbPath) : "",
    localPath: e.localPath ? String(e.localPath) : "",
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
    reason: e.reason
      ? String(e.reason)
      : e.status && e.status !== status
        ? String(e.status)
        : null,
    seriesName: e.seriesName ? String(e.seriesName) : null,
    destTitle: e.destTitle ? String(e.destTitle) : null,
    fromFlex: e.fromFlex ? 1 : 0,
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
  ensureMapFileExists(TV_INPROGRESS_PATH, {});

  openDb();

  // Normalize persisted statuses on restart.
  try {
    db.prepare(
      "UPDATE tv_entries SET status='waiting' WHERE status='future'",
    ).run();
  } catch {}
  // DVD entries that were mid-download are stale after restart — remove them.
  // The DVD pre-pass will recreate them if needed.
  try {
    db.prepare(
      "DELETE FROM tv_entries WHERE title LIKE 'DVD:%' AND (inProgress=1 OR status='downloading' OR status='waiting')",
    ).run();
  } catch {}
  try {
    db.prepare(
      "UPDATE tv_entries SET inProgress=0, status='waiting', progress=0, eta=NULL, speed=0, dateEnded=NULL WHERE (inProgress=1 OR status='downloading') AND title NOT LIKE 'DVD:%'",
    ).run();
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
    const rows = db
      .prepare(
        "SELECT title FROM tv_entries WHERE procId IS NULL ORDER BY rowid ASC",
      )
      .all();
    if (Array.isArray(rows) && rows.length) {
      const tx = db.transaction((rs) => {
        for (const r of rs) {
          const t = r && r.title ? String(r.title) : "";
          if (!t) continue;
          try {
            db.prepare(
              "UPDATE tv_entries SET procId = ? WHERE title = ? AND procId IS NULL",
            ).run(nextProcId++, t);
          } catch {}
        }
      });
      tx(rows);
    }
  } catch {}

  // One-time migration: if legacy tv-errors.json exists, mark matching entries as error:true then delete it.
  // Any mismatches are ignored.
  try {
    const legacyErrorsPath = path.join(DATA_DIR, "tv-errors.json");
    if (fs.existsSync(legacyErrorsPath)) {
      const legacy = readMap(legacyErrorsPath);
      const keys = Object.keys(legacy || {});
      if (keys.length) {
        const tx = db.transaction((titles) => {
          for (const k of titles) {
            const t = String(k || "");
            if (!t) continue;
            try {
              db.prepare("UPDATE tv_entries SET error=1 WHERE title=?").run(t);
            } catch {}
          }
        });
        tx(keys);
      }
      try {
        fs.unlinkSync(legacyErrorsPath);
      } catch {}
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
  if (!entry || typeof entry !== "object") return;
  updateEntryByProcId(entry);
};

const handleFinish = (entry) => {
  try {
    if (!entry || typeof entry !== "object") return;
    const title = entry.title ? String(entry.title) : "";
    const status = entry.status ? String(entry.status) : "";
    if (!title) return;

    ensureMapsLoaded();

    const ts = Date.now();
    const tsStr = dateStr(ts);

    if (status === "finished") {
      // If this was an error-download to tv-errors, mark it specially.
      const lp = entry.localPath ? String(entry.localPath) : "";
      if (lp.startsWith("/mnt/media/tv-errors")) {
        try {
          openDb();
          db.prepare(
            "UPDATE tv_entries SET status='error-downloaded' WHERE title=?",
          ).run(title);
        } catch {}
      } else if (isUnderTvRoot(lp) && entry.seriesName) {
        recordShowDownloadedInternal(
          entry.seriesName,
          entry.dateEnded || unixNow(),
          lp,
        ).catch(() => {});
      }
      removeInProgress(title);
      return;
    }

    if (status && status !== "downloading" && status !== "waiting") {
      unilog(1192, `${title}: ${status}`);

      // Mark the entry as error in SQLite.
      try {
        openDb();
        db.prepare("UPDATE tv_entries SET error=1 WHERE title=?").run(title);
      } catch {}
      removeInProgress(title);
    }
  } catch {}
};

const startWorkerForTitle = (title) => {
  openDb();
  const row = stmtGetByTitle.get(title);
  const entry0 = rowToEntry(row);
  if (!entry0 || typeof entry0 !== "object") return;

  // Assign procId on worker creation (spec) if missing.
  const entry = { ...entry0 };
  if (!(typeof entry.procId === "number" && Number.isInteger(entry.procId))) {
    entry.procId = nextProcId++;
  }

  if (forcedTitles.has(title)) {
    entry.forced = true;
    forcedTitles.delete(title);
  }

  // Mark inProgress before downloading.
  entry.inProgress = true;
  addInProgress(entry.title);

  entry.status = "downloading";
  entry.progress = 0;
  entry.eta = null;
  entry.speed = 0;
  entry.dateStarted = unixNow();
  entry.dateEnded = null;

  // Persist immediately so /downloads reflects the procId.
  upsertEntry(entry);

  workerCount++;

  const w = new Worker(WORKER_URL, {
    workerData: {
      entry,
      usbHost,
    },
  });
  activeWorkers.set(title, w);

  let finishedReceived = false;

  const onMessage = (msg) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "update" && msg.entry) {
      replaceByProcId(msg.entry);
      return;
    }

    if (msg.type === "finished" && msg.entry) {
      finishedReceived = true;
      activeWorkers.delete(title);
      const doneEntry = { ...msg.entry, inProgress: false };
      replaceByProcId(doneEntry);
      workerCount = Math.max(0, workerCount - 1);

      handleFinish(doneEntry);

      // Start exactly one oldest waiting (spec: keep the pipeline full).
      const nextTitle = findOldestWaitingIndex();
      if (nextTitle) startWorkerForTitle(nextTitle);
    }
  };

  w.on("message", onMessage);
  w.on("error", (e) => {
    activeWorkers.delete(title);
    if (abortingTitles.has(title)) {
      abortingTitles.delete(title);
      workerCount = Math.max(0, workerCount - 1);
      const nextTitle = findOldestWaitingIndex();
      if (nextTitle) startWorkerForTitle(nextTitle);
      return;
    }
    // Treat worker error as a finish with an error status.
    const errEntry = {
      ...entry,
      status: e && e.message ? String(e.message) : "worker error",
      dateEnded: unixNow(),
      eta: null,
      inProgress: false,
    };
    replaceByProcId(errEntry);
    workerCount = Math.max(0, workerCount - 1);
    handleFinish(errEntry);

    const nextTitle = findOldestWaitingIndex();
    if (nextTitle) startWorkerForTitle(nextTitle);
  });
  w.on("exit", () => {
    activeWorkers.delete(title);
    // If the worker was aborted, DB row is already deleted; just update counters.
    if (abortingTitles.has(title)) {
      abortingTitles.delete(title);
      workerCount = Math.max(0, workerCount - 1);
      const nextTitle = findOldestWaitingIndex();
      if (nextTitle) startWorkerForTitle(nextTitle);
      return;
    }
    // If the worker exits without sending finished, record something actionable.
    if (finishedReceived) return;
    const errEntry = {
      ...entry,
      status: "worker exited without finished",
      dateEnded: unixNow(),
      eta: null,
      inProgress: false,
    };
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
  if (!entry || typeof entry !== "object") return;

  openDb();

  // Store entry as a plain object. procId is assigned when/if a worker starts.
  const e = { ...entry };

  // Assign procId on add so /downloads sorting/capping is deterministic.
  if (!(typeof e.procId === "number" && Number.isInteger(e.procId))) {
    e.procId = nextProcId++;
  }

  // Ensure minimal fields exist.
  // Queue status is "waiting" (formerly "future").
  if (!e.status || e.status === "future") e.status = "waiting";
  if (typeof e.progress !== "number") e.progress = 0;
  if (e.eta === undefined) e.eta = null;
  if (typeof e.speed !== "number") e.speed = 0;
  if (!e.dateStarted) e.dateStarted = 0;
  if (!e.dateEnded) e.dateEnded = null;

  if (entry.forced) {
    forcedTitles.add(String(e.title));
  }

  // Record inProgress in the de-dupe map, but only set entry.inProgress=true when worker starts.
  e.inProgress = false;
  addInProgress(e.title);

  const title = e.title ? String(e.title) : "";
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
  if (
    wasExisting &&
    existingEntry &&
    typeof existingEntry.procId === "number" &&
    Number.isInteger(existingEntry.procId)
  ) {
    if (!(typeof e.procId === "number" && Number.isInteger(e.procId))) {
      e.procId = existingEntry.procId;
    }
  }

  upsertEntry(e);

  // Add a tv.log line for every newly-added tv.json entry.
  if (!wasExisting) {
    const isError = !!e.error;
    const errorMsg = isError ? e.reason || e.status || "error" : null;
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
    const entry =
      titleOrEntry && typeof titleOrEntry === "object" ? titleOrEntry : null;
    const t = entry
      ? String(entry.title || "")
      : titleOrEntry
        ? String(titleOrEntry)
        : "";
    if (!t) return;
    ensureMapsLoaded();

    const msg =
      entry && entry.reason
        ? String(entry.reason)
        : reason
          ? String(reason)
          : "error";
    unilog(1193, `${t}: ${msg}`);

    openDb();
    const existing = rowToEntry(stmtGetByTitle.get(t));
    const patch = {
      title: t,
      usbPath:
        entry && entry.usbPath
          ? String(entry.usbPath)
          : existing && existing.usbPath
            ? existing.usbPath
            : "",
      localPath:
        entry && entry.localPath
          ? String(entry.localPath)
          : existing && existing.localPath
            ? existing.localPath
            : "",
      procId:
        existing && typeof existing.procId === "number"
          ? existing.procId
          : nextProcId++,
      status: msg,
      error: true,
      inProgress: false,
      progress: 0,
      eta: null,
      speed: 0,
      dateStarted: existing && existing.dateStarted ? existing.dateStarted : 0,
      dateEnded: unixNow(),
    };

    upsertEntry(Object.assign({}, existing || {}, patch));

    // If it was ever marked inProgress, clear it.
    removeInProgress(t);
  } catch {}
};

const getEntryByTitle = (title) => {
  try {
    openDb();
    return rowToEntry(stmtGetByTitle.get(String(title))) || null;
  } catch {
    return null;
  }
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

// For per-cycle de-dupe in main.js.
const getTitlesMap = () => {
  try {
    openDb();
    const rows = stmtGetTitles.all();
    const out = {};
    for (const r of rows) {
      if (!r || !r.title) continue;
      out[String(r.title)] = {
        error: !!r.error,
        status: r.status || "waiting",
      };
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
    if (!Array.isArray(titles) || titles.length === 0) {
      return { existingTitles: [], existingProcids: [], tvEntries: [] };
    }

    const cleaned = [];
    const seen = new Set();
    for (const t0 of titles) {
      const t = String(t0 || "").trim();
      if (!t) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      cleaned.push(t);
      if (cleaned.length >= 5000) break;
    }

    if (cleaned.length === 0)
      return { existingTitles: [], existingProcids: [], tvEntries: [] };

    openDb();
    const placeholders = cleaned.map(() => "?").join(",");

    // Unfiltered matches (all states/errors) for UI diagnostics.
    const sqlAll = `SELECT * FROM tv_entries WHERE title IN (${placeholders})`;
    const allRows = db.prepare(sqlAll).all(...cleaned);
    const tvEntries = [];
    if (Array.isArray(allRows) && allRows.length) {
      for (const r0 of allRows) {
        const e0 = rowToEntry(r0);
        if (e0) tvEntries.push(e0);
      }
    }

    const sql = `SELECT title, procId FROM tv_entries WHERE title IN (${placeholders}) AND status='finished' AND (error IS NULL OR error=0)`;
    const rows = db.prepare(sql).all(...cleaned);
    if (!Array.isArray(rows) || rows.length === 0)
      return { existingTitles: [], existingProcids: [], tvEntries };

    const existingTitles = [];
    const existingProcids = [];
    for (const r of rows) {
      if (!r) continue;
      const t = r.title != null ? String(r.title) : "";
      if (t) existingTitles.push(t);
      const pid =
        typeof r.procId === "number"
          ? r.procId
          : r.procId == null
            ? null
            : Number(r.procId);
      if (pid != null && Number.isFinite(pid)) existingProcids.push(pid);
    }
    return { existingTitles, existingProcids, tvEntries };
  } catch {
    return { existingTitles: [], existingProcids: [], tvEntries: [] };
  }
};

// Delete local files and matching DB rows by procId.
// Returns { ok:true, deletedProcids:[], skippedProcids:[], errors:[] }
const deleteProcids = (procIds) => {
  const result = {
    ok: true,
    deletedProcids: [],
    skippedProcids: [],
    errors: [],
  };
  try {
    if (!Array.isArray(procIds) || procIds.length === 0) return result;
    openDb();
    ensureMapsLoaded();

    const cleaned = [];
    const seen = new Set();
    for (const p0 of procIds) {
      const pid = typeof p0 === "number" ? p0 : Number(p0);
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

      const title = row.title != null ? String(row.title) : "";
      const localPath = row.localPath != null ? String(row.localPath) : "";

      // Compute local file path safely.
      if (!localPath || !path.isAbsolute(localPath)) {
        result.ok = false;
        result.errors.push({ procId: pid, title, error: "invalid localPath" });
        continue;
      }
      if (
        !title ||
        path.isAbsolute(title) ||
        title.includes("\0") ||
        title.includes("..")
      ) {
        result.ok = false;
        result.errors.push({ procId: pid, title, error: "invalid title path" });
        continue;
      }

      const base = path.resolve(localPath);
      const filePath = path.resolve(localPath, title);
      if (!(filePath === base || filePath.startsWith(base + path.sep))) {
        result.ok = false;
        result.errors.push({
          procId: pid,
          title,
          error: "refuses to delete outside localPath",
        });
        continue;
      }

      // Delete the local file; ENOENT is fine.
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        if (!(e && e.code === "ENOENT")) {
          result.ok = false;
          result.errors.push({
            procId: pid,
            title,
            error: e && e.message ? String(e.message) : "unlink failed",
          });
          continue;
        }
      }

      // Remove DB row.
      try {
        // title is the primary key; delete by title to avoid procId races.
        stmtDeleteByTitle.run(title);
      } catch (e) {
        result.ok = false;
        result.errors.push({
          procId: pid,
          title,
          error: e && e.message ? String(e.message) : "db delete failed",
        });
        continue;
      }

      // Clear inProgress marker so the title can be re-downloaded.
      try {
        removeInProgress(title);
      } catch {}

      result.deletedProcids.push(pid);
    }

    return result;
  } catch (e) {
    result.ok = false;
    result.errors.push({
      error: e && e.message ? String(e.message) : String(e),
    });
    return result;
  }
};

// Prune tv.json entries when their corresponding USB folder has been deleted.
// existingUsbDirs: Set of relative directory paths under "files/" on the usbHost.
const pruneMissingUsbDirs = (existingUsbDirs) => {
  try {
    if (!existingUsbDirs || typeof existingUsbDirs.has !== "function") return;

    const normalizeUsbDir = (usbPath) => {
      let p = String(usbPath || "");
      p = p.replace(/^~\//, "");
      p = p.replace(/^\/+/g, "");
      if (p.startsWith("files/")) p = p.slice("files/".length);
      if (p.startsWith("~/files/")) p = p.slice("~/files/".length);
      p = p.replace(/^files\//, "");
      p = p.replace(/^\.\/?/, "");
      p = p.replace(/\/+$/g, "");
      return p;
    };

    openDb();
    const rows = db.prepare("SELECT title, usbPath FROM tv_entries").all();
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
        try {
          stmtDeleteByTitle.run(t);
        } catch {}
      }
    });
    tx(toDelete);

    for (const t of toDelete) removeInProgress(t);
  } catch {}
};

const retryEntry = (title) => {
  if (!title) return false;
  const t = String(title);
  try {
    openDb();
    const existing = rowToEntry(stmtGetByTitle.get(t));
    if (!existing) return false;
    // Delete the row entirely so the next USB scan cycle re-parses and re-adds it
    // from scratch. Resetting status='waiting' while keeping the row causes the
    // scan to skip it as "already queued" (getTitlesMap returns any row, not just
    // error rows), so the parse never re-runs.
    db.prepare("DELETE FROM tv_entries WHERE title=?").run(t);
    // Remove from finished map so the file isn't considered already done.
    ensureMapsLoaded();
    removeInProgress(t);
    return true;
  } catch {
    return false;
  }
};

const deleteErrorRecords = () => {
  try {
    openDb();
    const info = db
      .prepare("DELETE FROM tv_entries WHERE error IS NOT NULL AND error != 0")
      .run();
    return { ok: true, deleted: info.changes };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : String(e) };
  }
};

// Mark a title as finished in the DB without running a worker.
// Used when the file is already present on disk.
const markFinished = (titleOrEntry, localPath) => {
  const entry =
    titleOrEntry && typeof titleOrEntry === "object" ? titleOrEntry : null;
  const title = entry ? String(entry.title || "") : String(titleOrEntry || "");
  if (!title) return;
  try {
    openDb();
    const now = Math.floor(Date.now() / 1000);
    const existing = stmtGetByTitle.get(title);
    if (existing) {
      // Update all known fields when a full entry is provided, otherwise
      // just flip the status flags.
      if (entry) {
        const patch = normalizeEntryForDb({
          ...rowToEntry(existing),
          ...entry,
          status: "finished",
          inProgress: false,
          progress: 100,
          dateEnded: entry.dateEnded || now,
        });
        upsertEntry(patch);
      } else {
        db.prepare(
          "UPDATE tv_entries SET status='finished', inProgress=0, progress=100, dateEnded=? WHERE title=?",
        ).run(now, title);
      }
    } else {
      const lp = entry?.localPath || (localPath ? String(localPath) : null);
      if (entry) {
        const patch = normalizeEntryForDb({
          ...entry,
          procId: nextProcId++,
          status: "finished",
          inProgress: false,
          progress: 100,
          dateEnded: entry.dateEnded || now,
          dateStarted: entry.dateStarted || entry.dateEnded || now,
          error: false,
        });
        upsertEntry(patch);
      } else {
        db.prepare(
          `INSERT INTO tv_entries (title, procId, localPath, status, inProgress, progress, dateEnded, error)
           VALUES (?, ?, ?, 'finished', 0, 100, ?, 0)`,
        ).run(title, nextProcId++, lp, now);
      }
    }
    removeInProgress(title);
  } catch {
    // non-fatal
  }
};

const getWorkerCount = () => workerCount;

// Direct entry upsert without starting a worker. Used by DVD processing
// to create and update card entries that manage their own lifecycle.
const upsertDvdEntry = (entry) => {
  if (!entry || typeof entry !== "object") return;
  openDb();
  const e = { ...entry };
  if (!(typeof e.procId === "number" && Number.isInteger(e.procId))) {
    e.procId = nextProcId++;
  }
  upsertEntry(e);
  return e.procId;
};

// Delete individual DVD file entries (VOB/IFO/BUP) by exact title.
// Called after makemkv successfully finishes a disc to clean the down pane.
const deleteDvdFileEntries = (titles) => {
  if (!Array.isArray(titles) || titles.length === 0) return;
  openDb();
  const placeholders = titles.map(() => "?").join(",");
  db.prepare(`DELETE FROM tv_entries WHERE title IN (${placeholders})`).run(
    ...titles,
  );
};

const deleteByTitles = (titles) => {
  if (!Array.isArray(titles) || titles.length === 0) return [];
  openDb();
  const localPaths = [];
  for (const title of titles) {
    const row = stmtGetByTitle.get(String(title));
    if (row) {
      const lp = row.localPath ? String(row.localPath) : "";
      if (lp) {
        // localPath is the directory; construct the actual file path
        const fileTitle =
          (row.destTitle ? String(row.destTitle) : "") ||
          String(row.title || title);
        const fullPath = path.join(lp, fileTitle);
        localPaths.push(fullPath);
      }
    }
    removeInProgress(String(title));
    stmtDeleteByTitle.run(String(title));
  }
  return localPaths;
};

// Abort an active (downloading or waiting) entry:
// - sends abort to the worker (kills rsync), or just removes waiting entry
// - deletes the partial local file from disk
// - replaces the DB row with status='user-blocked' so scan cycles skip it forever
// Returns true if the entry was found.
const abortEntry = (title) => {
  if (!title) return false;
  const t = String(title);
  openDb();
  const row = stmtGetByTitle.get(t);
  if (!row) return false;

  // Signal to worker exit/error handlers that this is an intentional abort.
  abortingTitles.add(t);

  // Kill the worker if it's running.
  const w = activeWorkers.get(t);
  if (w) {
    try {
      w.postMessage({ type: "abort" });
    } catch {}
    activeWorkers.delete(t);
  } else {
    // Waiting entry (no worker yet) — no workerCount to decrement.
    abortingTitles.delete(t);
  }

  // Delete the partial local file.
  const localPath = row.localPath ? String(row.localPath) : "";
  if (localPath && path.isAbsolute(localPath)) {
    const tryDelete = (fileName) => {
      if (!fileName) return;
      try {
        const base = path.resolve(localPath);
        const fp = path.resolve(localPath, fileName);
        if (fp === base || fp.startsWith(base + path.sep)) {
          fs.unlinkSync(fp);
        }
      } catch {}
    };
    tryDelete(row.destTitle ? String(row.destTitle) : "");
    tryDelete(row.title ? String(row.title) : "");
  }

  // Replace the DB row with a user-blocked marker so future scan cycles skip this title.
  // The scan cycle skips any title already present in tvJsonTitles (getTitlesMap).
  removeInProgress(t);
  try {
    upsertEntry({
      title: t,
      procId: row.procId != null ? Number(row.procId) : nextProcId++,
      usbPath: row.usbPath ? String(row.usbPath) : "",
      localPath: "",
      status: "user-blocked",
      inProgress: false,
      error: false,
      progress: 0,
      eta: null,
      speed: 0,
      dateStarted: 0,
      dateEnded: Math.floor(Date.now() / 1000),
      reason: "user-blocked",
    });
  } catch {}

  return true;
};

export {
  addEntry,
  markFinished,
  getDownloads,
  getEntryByTitle,
  markError,
  pruneMissingUsbDirs,
  tvResync,
  hourlyUsbPruneAndTvResync,
  getTitlesMap,
  checkFiles,
  deleteProcids,
  retryEntry,
  deleteErrorRecords,
  getWorkerCount,
  upsertDvdEntry,
  deleteDvdFileEntries,
  deleteByTitles,
  abortEntry,
};
