import fs from "fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import { getApiDataDir, getApiMiscDir } from "./tvPaths.js";

const TVMAZE_BASE_URL = "https://api.tvmaze.com";
const SHOW_INDEX_PATH = "/shows";
const PAGE_SIZE = 250;

const RATE_WINDOW_MS = 10_000;
const RATE_MAX_CALLS = 20;

const DAILY_SYNC_HOUR_LOCAL = 3;
const DAILY_SYNC_MINUTE_LOCAL = 0;

const DB_FILENAME = "tvmaze.sqlite";
const SYNC_LOG_FILENAME = "tvmaze-sync.log";
const CLEAR_FLAG_BASENAME = "tvmaze-clear-flag";
const CLEAR_FLAG_ABSPATH =
  "/root/dev/apps/tv/apps/api/data/misc/tvmaze-clear-flag";
const SUMMARY_DUMP_FILENAME = "tvmaze-sync-summary.json";

let _db = null;
let _syncInProgress = false;
let _dailyTimer = null;
let _rateTimestamps = [];

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatLogTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  // Requested format: mm/dd-hh/mm
  return `${mm}/${dd}-${hh}:${min}`;
}

function appendSyncLog(entry) {
  try {
    const outPath = path.join(getApiMiscDir(), SYNC_LOG_FILENAME);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const e =
      entry && typeof entry === "object" ? entry : { message: String(entry) };
    const ts = formatLogTimestamp(new Date());
    const page = e.page ?? e.last_ok_page ?? e.start_page ?? "-";
    const count = e.count ?? e.shows_seen ?? 0;
    const isPageSynced = e.message === "page synced";
    const totalLoaded =
      (e.totals && typeof e.totals === "object"
        ? (e.totals.total_loaded ?? e.totals.shows_seen)
        : null) ?? null;
    const totalInDb =
      (e.totals && typeof e.totals === "object"
        ? e.totals.total_in_db
        : null) ?? null;

    const totalLoadedNum = totalLoaded == null ? NaN : Number(totalLoaded);
    const totalInDbNum = totalInDb == null ? NaN : Number(totalInDb);

    let msg = "";
    if (!isPageSynced && typeof e.message === "string" && e.message.trim())
      msg = e.message.trim();
    if (e.error && typeof e.error === "object" && e.error.message) {
      const em = String(e.error.message).replace(/\s+/g, " ").trim();
      msg = msg ? `${msg} err=${em}` : `err=${em}`;
    }

    // Include PID only when explicitly present (e.g. module loaded log).
    const pid = e?.details?.pid ?? e?.pid ?? null;
    if (!isPageSynced && pid != null) {
      msg = msg ? `${msg} pid=${pid}` : `pid=${pid}`;
    }

    // One line per entry: timestamp with labeled page/shows + optional message
    const totalsSuffix =
      Number.isFinite(totalLoadedNum) || Number.isFinite(totalInDbNum)
        ? ` total-loaded: ${Number.isFinite(totalLoadedNum) ? totalLoadedNum : "-"}, total-in-db: ${Number.isFinite(totalInDbNum) ? totalInDbNum : "-"}`
        : "";
    const isModuleLoaded = e.message === "module loaded";
    const base = isModuleLoaded
      ? `${ts}${totalsSuffix}`
      : `${ts} page: ${page}, shows: ${count}${totalsSuffix}`;
    const line = msg ? `${base} ${msg}` : base;
    fs.appendFileSync(outPath, line + "\n", "utf8");
  } catch {
    // ignore logging failures
  }
}

function appendSyncBlankLine() {
  try {
    const outPath = path.join(getApiMiscDir(), SYNC_LOG_FILENAME);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(outPath, "\n", "utf8");
  } catch {
    // ignore
  }
}

// Log module initialization so process restarts are obvious.
try {
  const payload = {
    ts: new Date().toISOString(),
    level: "info",
    message: "module loaded",
    details: {
      pid: process.pid,
      node: process.version,
      cwd: process.cwd(),
    },
  };
  console.error("[tvmaze] module loaded", payload);
  appendSyncBlankLine();
  appendSyncLog(payload);
} catch {
  // ignore
}

function clearFlagPaths() {
  // Prefer the app's misc dir, but also honor the explicit absolute path requested.
  const localPath = path.join(getApiMiscDir(), CLEAR_FLAG_BASENAME);
  return [localPath, CLEAR_FLAG_ABSPATH];
}

function fileExists(p) {
  try {
    return Boolean(p) && fs.existsSync(p);
  } catch {
    return false;
  }
}

function tryUnlink(p) {
  try {
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

function clearDbIfFlagExists() {
  const paths = clearFlagPaths();
  const hit = paths.find(fileExists);
  if (!hit) return { cleared: false };

  // If DB is already open in this process, close it before deleting.
  try {
    if (_db) {
      _db.close();
      _db = null;
    }
  } catch {
    // ignore
  }

  const dbPath = path.join(getApiDataDir(), DB_FILENAME);
  const deleted = [];
  const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const p of candidates) {
    if (fileExists(p) && tryUnlink(p)) deleted.push(p);
  }

  appendSyncLog({
    level: "info",
    message: "db cleared (flag found)",
    details: { flag: hit, deleted, pid: process.pid },
  });
  console.error("[tvmaze] db cleared (flag found)", { flag: hit, deleted });
  return { cleared: true, flag: hit, deleted };
}

function dumpSyncSummaryJson(summary) {
  try {
    const outPath = path.join(getApiMiscDir(), SUMMARY_DUMP_FILENAME);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  } catch {
    // ignore
  }
}

function logDbIssue(message, details) {
  const payload = {
    ts: new Date().toISOString(),
    level: "fatal",
    message: String(message || "DB issue"),
    details: details ?? null,
  };
  console.error("[tvmaze] fatal", payload);
  appendSyncLog(payload);
}

async function rateLimitGate() {
  const t = nowMs();
  _rateTimestamps = _rateTimestamps.filter((x) => t - x < RATE_WINDOW_MS);
  if (_rateTimestamps.length < RATE_MAX_CALLS) {
    _rateTimestamps.push(t);
    return;
  }

  const earliest = _rateTimestamps[0];
  const waitMs = Math.max(0, RATE_WINDOW_MS - (t - earliest) + 25);
  await sleep(waitMs);
  return rateLimitGate();
}

async function fetchJsonWithBackoff(url) {
  // Rate-limit based on successful attempt scheduling.
  await rateLimitGate();

  const headers = {
    Accept: "application/json; charset=UTF-8",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) tv-api/1.0",
    Referer: "https://www.tvmaze.com/",
  };

  const res = await fetch(url, { method: "GET", headers });

  if (res.status === 404) {
    return { status: 404, json: null, headers: res.headers };
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitSeconds =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 10;
    await sleep(waitSeconds * 1000);
    return fetchJsonWithBackoff(url);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `TVmaze HTTP ${res.status} for ${url}. ${bodyText.slice(0, 200)}`,
    );
  }

  const json = await res.json();
  return { status: res.status, json, headers: res.headers };
}

function openDb() {
  if (_db) return _db;

  const dbPath = path.join(getApiDataDir(), DB_FILENAME);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate from older schema (tvdb_id PRIMARY KEY) to new schema keyed by tvmaze_id.
  try {
    const cols = db.prepare("PRAGMA table_info('shows')").all();
    const hasShows = Array.isArray(cols) && cols.length > 0;
    const colNames = hasShows ? cols.map((c) => c.name) : [];
    const pkCol = hasShows
      ? (cols.find((c) => c.pk === 1)?.name ?? null)
      : null;
    const looksLikeOld =
      hasShows && pkCol === "tvdb_id" && colNames.includes("tvmaze_id");
    if (looksLikeOld) {
      const hasBackup = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='shows_tvdb'",
        )
        .get();
      if (!hasBackup) {
        db.exec("ALTER TABLE shows RENAME TO shows_tvdb");
      }
    }
  } catch {
    // ignore; we'll create the expected tables below
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS shows (
      tvmaze_id INTEGER PRIMARY KEY,
      tvdb_id INTEGER,
      imdb_id TEXT,
      premiered INTEGER,
      status TEXT,
      type TEXT,
      language TEXT,
      tvmaze_updated INTEGER,
      fetched_at INTEGER NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shows_tvdb_id ON shows(tvdb_id);
    CREATE INDEX IF NOT EXISTS idx_shows_imdb_id ON shows(imdb_id);
  `);

  // Lightweight migrations for added columns.
  try {
    const cols = db.prepare("PRAGMA table_info('shows')").all();
    const names = Array.isArray(cols) ? cols.map((c) => c.name) : [];
    if (!names.includes("imdb_id")) {
      db.exec("ALTER TABLE shows ADD COLUMN imdb_id TEXT");
    }
    if (!names.includes("premiered")) {
      db.exec("ALTER TABLE shows ADD COLUMN premiered INTEGER");
    }
    if (!names.includes("status")) {
      db.exec("ALTER TABLE shows ADD COLUMN status TEXT");
    }
    if (!names.includes("type")) {
      db.exec("ALTER TABLE shows ADD COLUMN type TEXT");
    }
    if (!names.includes("language")) {
      db.exec("ALTER TABLE shows ADD COLUMN language TEXT");
    }
    if (names.includes("viewed")) {
      try {
        db.exec("ALTER TABLE shows DROP COLUMN viewed");
      } catch {
        // ignore if sqlite version is too old to support drop column
      }
    }
    if (!names.includes("browsed")) {
      db.exec("ALTER TABLE shows ADD COLUMN browsed INTEGER DEFAULT 0");
    }
  } catch {
    // ignore migration failures
  }

  // Copy any renamed legacy table into the new schema.
  try {
    const legacy = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='shows_tvdb'",
      )
      .get();
    if (legacy) {
      const migrate = db.transaction(() => {
        db.exec(`
          INSERT OR IGNORE INTO shows(tvmaze_id, tvdb_id, tvmaze_updated, fetched_at, data_json)
          SELECT tvmaze_id, tvdb_id, tvmaze_updated, fetched_at, data_json
          FROM shows_tvdb
          WHERE tvmaze_id IS NOT NULL;
        `);
        // Keep the legacy table for now (it is small and can help debugging).
      });
      migrate();
    }
  } catch {
    // ignore migration failures
  }

  _db = db;
  return db;
}

function metaGet(db, key) {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(String(key));
  return row ? row.value : null;
}

function metaSet(db, key, value) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(String(key), String(value));
}

function countShowsInDb(db) {
  const row = db.prepare("SELECT COUNT(1) AS n FROM shows").get();
  return row && row.n != null ? Number(row.n) : 0;
}

function maxTvmazeId(db) {
  const row = db.prepare("SELECT MAX(tvmaze_id) AS max_id FROM shows").get();
  return row && row.max_id != null ? Number(row.max_id) : null;
}

function computeStartPage(maxId) {
  if (!Number.isFinite(maxId) || maxId == null || maxId < 0) return 0;
  return Math.floor(maxId / PAGE_SIZE);
}

function scheduleDaily3am(runFn) {
  if (_dailyTimer) clearTimeout(_dailyTimer);

  const now = new Date();
  const next = new Date(now);
  next.setHours(DAILY_SYNC_HOUR_LOCAL, DAILY_SYNC_MINUTE_LOCAL, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  const delay = next.getTime() - now.getTime();
  _dailyTimer = setTimeout(async () => {
    try {
      await runFn("daily");
    } catch (e) {
      console.error("[tvmaze] daily sync failed", e);
    }

    setInterval(
      () => {
        runFn("daily").catch((e) =>
          console.error("[tvmaze] daily sync failed", e),
        );
      },
      24 * 60 * 60 * 1000,
    );
  }, delay);
}

async function syncTvmazeShows(reason = "startup") {
  if (_syncInProgress) {
    appendSyncLog({
      ts: new Date().toISOString(),
      level: "info",
      message: "sync skipped: already running",
      reason,
    });
    return { skipped: true };
  }

  _syncInProgress = true;
  appendSyncBlankLine();
  const startedAt = nowMs();

  const db = openDb();

  const startMaxId = maxTvmazeId(db);
  const startPage = computeStartPage(startMaxId);

  const selectExisting = db.prepare(
    "SELECT tvdb_id, imdb_id, premiered, status, type, language, tvmaze_updated, data_json FROM shows WHERE tvmaze_id = ?",
  );
  const insertRow = db.prepare(
    "INSERT INTO shows(tvmaze_id, tvdb_id, imdb_id, premiered, status, type, language, browsed, tvmaze_updated, fetched_at, data_json) VALUES(?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
  );
  const updateRow = db.prepare(
    "UPDATE shows SET tvdb_id = ?, imdb_id = ?, premiered = ?, status = ?, type = ?, language = ?, tvmaze_updated = ?, fetched_at = ?, data_json = ? WHERE tvmaze_id = ?",
  );

  let pagesFetched = 0;
  let showsSeen = 0;
  let inserted = 0;
  let updated = 0;
  let lastOkPage = null;
  let lastTvmazeIdSeen = startMaxId ?? null;

  const perPageTx = db.transaction((rows) => {
    const fetchedAt = Math.floor(Date.now() / 1000);
    for (const show of rows) {
      if (!show || typeof show !== "object") continue;

      const tvmazeId = show.id;
      const tvdbId = show?.externals?.thetvdb;
      const tvdbIdNum = tvdbId == null ? null : Number(tvdbId);
      const tvdbIdSafe = Number.isFinite(tvdbIdNum) ? tvdbIdNum : null;
      const imdbId = show?.externals?.imdb;
      const imdbIdSafe =
        typeof imdbId === "string" && imdbId.trim() ? imdbId.trim() : null;

      const premieredMs =
        typeof show.premiered === "string" ? Date.parse(show.premiered) : null;
      const premiered =
        !Number.isNaN(premieredMs) && premieredMs != null
          ? Math.floor(premieredMs / 1000)
          : null;

      const status = typeof show.status === "string" ? show.status : null;
      const type = typeof show.type === "string" ? show.type : null;
      const language = typeof show.language === "string" ? show.language : null;

      const tvmazeUpdated = show.updated == null ? null : Number(show.updated);
      const jsonText = JSON.stringify(show);

      const existing = selectExisting.get(tvmazeId);
      if (!existing) {
        insertRow.run(
          tvmazeId,
          tvdbIdSafe,
          imdbIdSafe,
          premiered,
          status,
          type,
          language,
          tvmazeUpdated,
          fetchedAt,
          jsonText,
        );
        inserted++;
      } else {
        const changed =
          (existing.tvdb_id ?? null) !== (tvdbIdSafe ?? null) ||
          (existing.imdb_id ?? null) !== (imdbIdSafe ?? null) ||
          (existing.premiered ?? null) !== (premiered ?? null) ||
          (existing.status ?? null) !== (status ?? null) ||
          (existing.type ?? null) !== (type ?? null) ||
          (existing.language ?? null) !== (language ?? null) ||
          (existing.tvmaze_updated ?? null) !== (tvmazeUpdated ?? null) ||
          String(existing.data_json || "") !== jsonText;

        if (changed) {
          updateRow.run(
            tvdbIdSafe,
            imdbIdSafe,
            premiered,
            status,
            type,
            language,
            tvmazeUpdated,
            fetchedAt,
            jsonText,
            tvmazeId,
          );
          updated++;
        }
      }

      if (Number.isFinite(tvmazeId)) {
        if (lastTvmazeIdSeen == null || tvmazeId > lastTvmazeIdSeen)
          lastTvmazeIdSeen = tvmazeId;
      }
      showsSeen++;
    }
  });

  let endBy404 = false;
  let end404Page = null;

  try {
    for (let page = startPage; ; page++) {
      const url = `${TVMAZE_BASE_URL}${SHOW_INDEX_PATH}?page=${page}`;
      const { status, json } = await fetchJsonWithBackoff(url);

      if (status === 404) {
        endBy404 = true;
        end404Page = page;
        break;
      }

      if (!Array.isArray(json)) {
        throw new Error(`Unexpected response for ${url}: expected array`);
      }

      const insertedBefore = inserted;
      const updatedBefore = updated;
      const showsSeenBefore = showsSeen;

      pagesFetched++;
      lastOkPage = page;
      perPageTx(json);

      const pageInserted = inserted - insertedBefore;
      const pageUpdated = updated - updatedBefore;
      const pageShowsSeen = showsSeen - showsSeenBefore;
      const pageCount = Array.isArray(json) ? json.length : 0;
      const totalInDb = countShowsInDb(db);
      appendSyncLog({
        ts: new Date().toISOString(),
        level: "info",
        message: "page synced",
        reason,
        page,
        url,
        count: pageCount,
        shows_seen: pageShowsSeen,
        inserted: pageInserted,
        updated: pageUpdated,
        totals: {
          pages_fetched: pagesFetched,
          total_loaded: showsSeen,
          total_in_db: totalInDb,
          inserted,
          updated,
        },
      });

      // Persist progress as we go so a crash can resume.
      metaSet(db, "tvmaze.last_ok_page", String(page));
      if (lastTvmazeIdSeen != null)
        metaSet(db, "tvmaze.last_tvmaze_id", String(lastTvmazeIdSeen));
    }

    const endedAt = nowMs();
    metaSet(db, "tvmaze.last_sync_iso", new Date().toISOString());
    metaSet(db, "tvmaze.last_sync_reason", reason);
    if (lastOkPage != null)
      metaSet(db, "tvmaze.last_ok_page", String(lastOkPage));
    if (end404Page != null)
      metaSet(db, "tvmaze.end_404_page", String(end404Page));

    const summary = {
      ts: new Date().toISOString(),
      level: "info",
      message: "sync complete",
      reason,
      start_page: startPage,
      start_max_tvmaze_id: startMaxId,
      pages_fetched: pagesFetched,
      shows_seen: showsSeen,
      inserted,
      updated,
      last_ok_page: lastOkPage,
      end_by_404: endBy404,
      end_404_page: end404Page,
      last_tvmaze_id_seen: lastTvmazeIdSeen,
      duration_ms: endedAt - startedAt,
      totals: {
        total_loaded: showsSeen,
        total_in_db: countShowsInDb(db),
      },
    };

    console.error("[tvmaze] sync summary", summary);
    dumpSyncSummaryJson(summary);
    appendSyncLog(summary);

    return summary;
  } catch (e) {
    const endedAt = nowMs();
    const errPayload = {
      ts: new Date().toISOString(),
      level: "error",
      message: "sync failed",
      reason,
      start_page: startPage,
      pages_fetched: pagesFetched,
      shows_seen: showsSeen,
      inserted,
      updated,
      last_ok_page: lastOkPage,
      last_tvmaze_id_seen: lastTvmazeIdSeen,
      duration_ms: endedAt - startedAt,
      error: {
        message: e?.message || String(e),
        stack: e?.stack || null,
      },
    };

    console.error("[tvmaze] sync failed", errPayload);
    appendSyncLog(errPayload);
    throw e;
  } finally {
    _syncInProgress = false;
  }
}

async function start() {
  clearDbIfFlagExists();

  try {
    openDb();
  } catch (e) {
    logDbIssue("Unable to open tvmaze sqlite db", {
      error: e?.message || String(e),
    });
    return;
  }

  syncTvmazeShows("startup").catch((e) => {
    console.error("[tvmaze] startup sync failed", e);
  });

  scheduleDaily3am(syncTvmazeShows);
}

// Auto-start when imported.
start();

export function getTvmazeDbPath() {
  return path.join(getApiDataDir(), DB_FILENAME);
}

export async function runTvmazeSyncNow() {
  return syncTvmazeShows("manual");
}

export function getCandidateShows(limit = 100) {
  if (!_db) openDb();
  // We use the new premiered column (integer timestamp) to sort by premiered date descending
  const rows = _db
    .prepare(
      `
    SELECT tvmaze_id, data_json 
    FROM shows 
    WHERE (browsed IS NULL OR browsed = 0) 
    ORDER BY premiered DESC 
    LIMIT ?
  `,
    )
    .all(limit);

  return rows
    .map((r) => {
      try {
        const d = JSON.parse(r.data_json);
        d.tvmaze_id = r.tvmaze_id; // ensure ID is passed
        return d;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function markShowBrowsed(tvmazeId) {
  if (!_db) openDb();
  _db.prepare("UPDATE shows SET browsed = 1 WHERE tvmaze_id = ?").run(tvmazeId);
}
