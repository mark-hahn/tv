import Database from "better-sqlite3";
import path from "node:path";
import { SRVR_DATA_DIR, ensureDir } from "./srvrPaths.js";

ensureDir(SRVR_DATA_DIR);

const DB_PATH = path.join(SRVR_DATA_DIR, "history.sqlite");

const DEDUP_TYPES = ["skipDown", "rejDown", "browse", "preview", "addQbt"];

const PST_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const nowPST = () => {
  const d = new Date();
  const base = PST_FMT.format(d).replace(", ", " ");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${base}.${ms}`;
};

let db;
let stmtInsert;
let stmtGetByTvdbId;
let stmtGetByShowName;
let stmtGetByHash;
let stmtGetBkgndLast;
let stmtDedupFind;
let stmtDedupUpdate;

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
      addTime TEXT NOT NULL,
      updateTime TEXT NOT NULL,
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

  stmtInsert = db.prepare(`
    INSERT INTO history (tvdbId, showName, addTime, updateTime, updateCount, description, type, hash, fields)
    VALUES (@tvdbId, @showName, @now, @now, 0, @description, @type, @hash, @fields)
  `);

  stmtDedupFind = db.prepare(`
    SELECT id, fields FROM history
    WHERE LOWER(IFNULL(tvdbId, showName)) = LOWER(@key) AND type = @type
    ORDER BY addTime DESC LIMIT 1
  `);

  stmtDedupUpdate = db.prepare(`
    UPDATE history SET
      updateTime = @now,
      updateCount = updateCount + 1,
      description = @description
    WHERE id = @id
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
  if (!tvdbId && !showName) return;
  const now = nowPST();
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
    const key = tvdbId ?? showName ?? "";
    const last = stmtDedupFind.get({ key, type });
    if (last) {
      stmtDedupUpdate.run({
        now,
        description: description || null,
        id: last.id,
      });
      return;
    }
    stmtInsert.run(params);
    return;
  }

  if (type === "bkgndUpdate" || type === "clientUpdate") {
    const key = tvdbId ?? showName ?? "";
    const last = stmtDedupFind.get({ key, type });
    if (last && last.fields === (fields || null)) {
      stmtDedupUpdate.run({
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
