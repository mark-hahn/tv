import fs from "fs";
import path from "node:path";
import Database from "better-sqlite3";

const TVDB_JSON_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json";
const TVDB_JSON_BAK_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json.bak";
const TVDB_DB_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.db";
const TVDB_JSON_ARCHIVE_PATH =
  "/root/dev/apps/tv/apps/srvr/data/tvdb.json.pre-sqlite";
const TVDB_JSON_BAK_ARCHIVE_PATH =
  "/root/dev/apps/tv/apps/srvr/data/tvdb.json.bak.pre-sqlite";

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const targetDbPath = path.resolve(process.argv[2] || TVDB_DB_PATH);
const realDbPath = path.resolve(TVDB_DB_PATH);
const isRealTarget = targetDbPath === realDbPath;

if (fs.existsSync(targetDbPath)) {
  die(`refusing to overwrite existing db: ${targetDbPath}`);
}

if (isRealTarget) {
  for (const archivePath of [
    TVDB_JSON_ARCHIVE_PATH,
    TVDB_JSON_BAK_ARCHIVE_PATH,
  ]) {
    if (fs.existsSync(archivePath))
      die(`archive already exists: ${archivePath}`);
  }
}

let tvdb;
try {
  tvdb = JSON.parse(fs.readFileSync(TVDB_JSON_PATH, "utf8"));
} catch (e) {
  die(`failed to read/parse ${TVDB_JSON_PATH}: ${e.message}`);
}

if (!tvdb || typeof tvdb !== "object" || Array.isArray(tvdb)) {
  die(`${TVDB_JSON_PATH} did not contain an object`);
}

const entries = Object.entries(tvdb);
if (entries.length === 0) die(`${TVDB_JSON_PATH} has 0 records`);

const db = new Database(targetDbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.exec(`CREATE TABLE shows (name TEXT PRIMARY KEY, json TEXT NOT NULL)`);

const insertStmt = db.prepare(`INSERT INTO shows (name, json) VALUES (?, ?)`);
const insertAll = db.transaction((rows) => {
  for (const [name, record] of rows) {
    insertStmt.run(name, JSON.stringify(record));
  }
});

insertAll(entries);

const dbCount = db.prepare(`SELECT COUNT(*) AS count FROM shows`).get().count;
if (dbCount !== entries.length) {
  db.close();
  die(`count mismatch: source=${entries.length} db=${dbCount}`);
}

db.pragma("wal_checkpoint(TRUNCATE)");
db.close();

if (isRealTarget) {
  fs.renameSync(TVDB_JSON_PATH, TVDB_JSON_ARCHIVE_PATH);
  fs.renameSync(TVDB_JSON_BAK_PATH, TVDB_JSON_BAK_ARCHIVE_PATH);
}

const dbSize = fs.statSync(targetDbPath).size;
process.stdout.write(`migrated ${dbCount} records to ${targetDbPath}\n`);
process.stdout.write(`db size ${dbSize} bytes\n`);
if (isRealTarget) {
  process.stdout.write(
    `archived ${TVDB_JSON_PATH} -> ${TVDB_JSON_ARCHIVE_PATH}\n`,
  );
  process.stdout.write(
    `archived ${TVDB_JSON_BAK_PATH} -> ${TVDB_JSON_BAK_ARCHIVE_PATH}\n`,
  );
}
