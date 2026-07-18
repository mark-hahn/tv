import fs from "fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SRVR_DATA_DIR } from "./srvrPaths.js";

const TVDB_DB_PATH = path.join(SRVR_DATA_DIR, "tvdb.db");
const TVDB_DB_BAK_PATH = path.join(SRVR_DATA_DIR, "tvdb.db.bak");

if (!fs.existsSync(TVDB_DB_PATH)) {
  throw new Error(
    `[tvdbDb] FATAL: missing ${TVDB_DB_PATH} -- run apps/srvr/scripts/migrate-tvdb-to-sqlite.js`,
  );
}

const db = new Database(TVDB_DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.exec(
  `CREATE TABLE IF NOT EXISTS shows (name TEXT PRIMARY KEY, json TEXT NOT NULL)`,
);

const upsertStmt = db.prepare(`
  INSERT INTO shows (name, json) VALUES (?, ?)
  ON CONFLICT(name) DO UPDATE SET json = excluded.json
`);
const deleteStmt = db.prepare(`DELETE FROM shows WHERE name = ?`);
const lastSavedJson = new Map();

export const loadAllShows = () => {
  const out = {};
  for (const row of db.prepare(`SELECT name, json FROM shows`).iterate()) {
    out[row.name] = JSON.parse(row.json);
    lastSavedJson.set(row.name, row.json);
  }
  return out;
};

export const saveShow = (name, record) => {
  if (!name || !record) return;
  const json = JSON.stringify(record);
  if (lastSavedJson.get(name) === json) return;
  upsertStmt.run(name, json);
  lastSavedJson.set(name, json);
};

export const deleteShow = (name) => {
  if (!name) return;
  deleteStmt.run(name);
  lastSavedJson.delete(name);
};

export const saveAllShows = db.transaction((allTvdb) => {
  for (const [name, record] of Object.entries(allTvdb || {})) {
    saveShow(name, record);
  }
  for (const name of [...lastSavedJson.keys()]) {
    if (!(name in allTvdb)) deleteShow(name);
  }
});

export const backupDb = () => {
  fs.rmSync(TVDB_DB_BAK_PATH, { force: true });
  db.exec(`VACUUM INTO '${TVDB_DB_BAK_PATH.replace(/'/g, "''")}'`);
};
