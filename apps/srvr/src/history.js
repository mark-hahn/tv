import Database from "better-sqlite3";
import path from "node:path";
import { SRVR_DATA_DIR, ensureDir } from "./srvrPaths.js";

ensureDir(SRVR_DATA_DIR);

const DB_PATH = path.join(SRVR_DATA_DIR, "history.sqlite");

const DEDUP_TYPES = ["chkDown", "skipDown", "rejDown", "browse", "preview"];

let db;
let stmtInsert;
let stmtUpsert;
let stmtGetByTvdbId;
let stmtGetByShowName;
let stmtGetByHash;
let stmtGetBkgndLast;
let stmtBkgndDedup;

const openDb = () => {
  if (db) return;
  db = new Database(DB_PATH);
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
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tvdbId TEXT,
      showName TEXT NOT NULL,
      addTime INTEGER NOT NULL,
      updateTime INTEGER NOT NULL,
      updateCount INTEGER DEFAULT 0,
      description TEXT,
      type TEXT NOT NULL,
      hash TEXT,
      fields TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_history_tvdbId ON history(tvdbId);
    CREATE INDEX IF NOT EXISTS idx_history_showName ON history(showName);
    CREATE INDEX IF NOT EXISTS idx_history_type ON history(type);
    CREATE INDEX IF NOT EXISTS idx_history_hash ON history(hash);
  `);

  // Partial unique index for simple dedup types.
  // SQLite doesn't support CREATE UNIQUE INDEX IF NOT EXISTS with WHERE,
  // so we wrap in try/catch for the already-exists case.
  try {
    db.exec(`
      CREATE UNIQUE INDEX idx_history_dedup ON history(tvdbId, type)
        WHERE type IN ('chkDown','skipDown','rejDown','browse','preview');
    `);
  } catch {}

  stmtInsert = db.prepare(`
    INSERT INTO history (tvdbId, showName, addTime, updateTime, updateCount, description, type, hash, fields)
    VALUES (@tvdbId, @showName, @now, @now, 0, @description, @type, @hash, @fields)
  `);

  stmtUpsert = db.prepare(`
    INSERT INTO history (tvdbId, showName, addTime, updateTime, updateCount, description, type, hash, fields)
    VALUES (@tvdbId, @showName, @now, @now, 0, @description, @type, @hash, @fields)
    ON CONFLICT (tvdbId, type) WHERE type IN ('chkDown','skipDown','rejDown','browse','preview')
    DO UPDATE SET
      updateTime = excluded.updateTime,
      updateCount = updateCount + 1,
      description = excluded.description
  `);

  stmtGetByTvdbId = db.prepare(
    "SELECT * FROM history WHERE tvdbId = ? ORDER BY updateTime DESC",
  );

  stmtGetByShowName = db.prepare(
    "SELECT * FROM history WHERE tvdbId IS NULL AND LOWER(showName) = LOWER(?) ORDER BY updateTime DESC",
  );

  stmtGetByHash = db.prepare(
    "SELECT * FROM history WHERE hash = ? ORDER BY addTime DESC LIMIT 1",
  );

  stmtGetBkgndLast = db.prepare(
    "SELECT * FROM history WHERE tvdbId = ? AND type = 'bkgndUpdate' ORDER BY addTime DESC LIMIT 1",
  );

  stmtBkgndDedup = db.prepare(`
    UPDATE history SET
      updateTime = @now,
      updateCount = updateCount + 1,
      description = @description
    WHERE id = @id
  `);
};

openDb();

export const addEvent = ({
  tvdbId,
  showName,
  type,
  description,
  hash,
  fields,
}) => {
  const now = Date.now();
  const params = {
    tvdbId: tvdbId ?? null,
    showName: showName || "",
    type,
    description: description || null,
    hash: hash || null,
    fields: fields || null,
    now,
  };

  if (DEDUP_TYPES.includes(type)) {
    stmtUpsert.run(params);
    return;
  }

  if (type === "bkgndUpdate") {
    const last = stmtGetBkgndLast.get(tvdbId ?? null);
    if (last && last.fields === (fields || null)) {
      stmtBkgndDedup.run({
        now,
        description: description || null,
        id: last.id,
      });
      return;
    }
    stmtInsert.run(params);
    return;
  }

  stmtInsert.run(params);
};

export const getEvents = (tvdbId) => {
  return stmtGetByTvdbId.all(tvdbId);
};

export const getEventsByName = (showName) => {
  return stmtGetByShowName.all(showName);
};

export const getEventsByHash = (hash) => {
  return stmtGetByHash.get(hash) || null;
};
