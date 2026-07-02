// unilog DB owner — runs ONLY inside tv-srvr (the single writer).
// All other processes/clients reach the DB via POST /api/log (see index.js).
// Tooling code here uses traditional console writes with the `// no-unilog`
// blocking comment so unilog never instruments its own plumbing.

import fs from "fs";
import path from "node:path";
import Database from "better-sqlite3";

// Hard-wired remote location (no env vars per repo convention).
const UNILOG_DIR = "/root/dev/apps/tv/unilog";
const UNILOG_DB_PATH = path.join(UNILOG_DIR, "unilog.sqlite");

fs.mkdirSync(UNILOG_DIR, { recursive: true });

const db = new Database(UNILOG_DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS log_sites (
  log_id      INTEGER PRIMARY KEY,
  tag         TEXT,
  description TEXT,
  level       TEXT NOT NULL,
  src_file    TEXT,
  src_line    INTEGER,
  old_log     TEXT,
  project     TEXT,
  created_at  TEXT,
  removed_at  TEXT
);

CREATE TABLE IF NOT EXISTS log_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id    INTEGER,
  pid       TEXT,
  ts        TEXT NOT NULL,
  message   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_logid ON log_events(log_id);
CREATE INDEX IF NOT EXISTS idx_events_ts    ON log_events(ts);

CREATE TABLE IF NOT EXISTS log_groups (
  group_id    INTEGER PRIMARY KEY,
  group_type  TEXT,
  ts          TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS site_groups (
  log_id   INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  PRIMARY KEY (log_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_site_groups_group ON site_groups(group_id);
`);

// PST 'yyyy/mm/dd hh:mm:ss'; hour 24 normalized to 00 (repo convention).
export function nowPst() {
  const d = new Date();
  const date = d
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .replace(/-/g, "/");
  let time = d.toLocaleTimeString("en-GB", {
    timeZone: "America/Los_Angeles",
    hour12: false,
  });
  if (time.startsWith("24:")) time = "00:" + time.slice(3);
  return `${date} ${time}`;
}

const insEvent = db.prepare(
  "INSERT INTO log_events (log_id, pid, ts, message) VALUES (?, ?, ?, ?)",
);

// Full joined row for one event (event + its site). Used for the live tail
// broadcast and for enriching newly inserted events with their metadata.
const getEventRow = db.prepare(`
  SELECT e.id, e.ts, e.pid, s.log_id, s.src_file, s.src_line,
         s.tag, s.level, e.message
    FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
   WHERE e.id = ?
`);

// Comma-joined group descriptions for a site (via site_groups -> log_groups).
const getGroupsStr = db.prepare(`
  SELECT GROUP_CONCAT(lg.description, ', ') AS groups
    FROM site_groups sg JOIN log_groups lg ON sg.group_id = lg.group_id
   WHERE sg.log_id = ? AND lg.description IS NOT NULL
`);
export function groupsForSite(logId) {
  if (logId == null) return "";
  return getGroupsStr.get(Number(logId))?.groups || "";
}

// One runtime emission. ts stamped here (the collector), not the caller.
// Returns the full joined row (event + site + groups) so callers can broadcast
// it to live-tail subscribers. Returns null when the event has no matching site
// (e.g. a null/unknown logId).
export function insertEvent({ logId, pid, message }) {
  const info = insEvent.run(
    logId == null ? null : Number(logId),
    String(pid || "unknown"),
    nowPst(),
    String(message ?? ""),
  );
  const row = getEventRow.get(Number(info.lastInsertRowid));
  if (row) row.groups = groupsForSite(row.log_id);
  return row || null;
}

const insGroup = db.prepare(
  "INSERT INTO log_groups (group_id, group_type, ts, description) VALUES (?, ?, ?, ?)",
);
const maxGroup = db.prepare(
  "SELECT COALESCE(MAX(group_id), 0) + 1 AS next FROM log_groups",
);

// Allocate + create a group atomically. Returns new group_id.
export const createGroup = db.transaction(({ groupType, description }) => {
  const id = maxGroup.get().next;
  insGroup.run(id, groupType || null, nowPst(), description || null);
  return id;
});

const insSite = db.prepare(`
  INSERT INTO log_sites
    (log_id, tag, description, level, src_file, src_line, old_log, project, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const maxSite = db.prepare(
  "SELECT COALESCE(MAX(log_id), 0) + 1 AS next FROM log_sites",
);
const insSiteGroup = db.prepare(
  "INSERT OR IGNORE INTO site_groups (log_id, group_id) VALUES (?, ?)",
);

// Allocate + create a site (and its group links) atomically. Returns new log_id.
export const createSite = db.transaction((site) => {
  const id = maxSite.get().next;
  insSite.run(
    id,
    site.tag || null,
    site.description || null,
    site.level || "info",
    site.srcFile || null,
    site.srcLine == null ? null : Number(site.srcLine),
    site.oldLog || null,
    site.project || null,
    nowPst(),
  );
  for (const gid of site.groupIds || []) insSiteGroup.run(id, Number(gid));
  return id;
});

const getSite = db.prepare("SELECT * FROM log_sites WHERE log_id = ?");
const getSiteGroupIds = db.prepare(
  "SELECT group_id FROM site_groups WHERE log_id = ?",
);

// Split a duplicate log_id into a fresh one. When the old id has a DB row, the
// new row is a copy of it (overriding only project/src_file/src_line) and the
// new id inherits the same site_groups rows. When the old id has NO row (a
// hand-typed/bogus id), create a fresh stub-like site instead, linking it to
// any provided groupIds. old_log is preserved/left null (not removed). Returns
// the new log_id. Transactional.
export const createDuplicateSite = db.transaction(
  ({ oldLogId, project, srcFile, srcLine, groupIds = [] }) => {
    const id = maxSite.get().next;
    const orig = oldLogId == null ? null : getSite.get(Number(oldLogId));
    const line = srcLine == null ? null : Number(srcLine);
    if (orig) {
      insSite.run(
        id,
        orig.tag,
        orig.description,
        orig.level || "info",
        srcFile || null,
        line,
        orig.old_log,
        project || null,
        nowPst(),
      );
      for (const r of getSiteGroupIds.all(Number(oldLogId)))
        insSiteGroup.run(id, r.group_id);
    } else {
      insSite.run(
        id,
        null,
        null,
        "info",
        srcFile || null,
        line,
        null,
        project || null,
        nowPst(),
      );
      for (const gid of groupIds) insSiteGroup.run(id, Number(gid));
    }
    return id;
  },
);

const updSiteLoc = db.prepare(
  "UPDATE log_sites SET src_file = ?, src_line = ?, project = COALESCE(?, project) WHERE log_id = ?",
);
export function refreshSite({ logId, srcFile, srcLine, project }) {
  updSiteLoc.run(
    srcFile || null,
    srcLine == null ? null : Number(srcLine),
    project || null,
    Number(logId),
  );
}

export function querySites(logIds) {
  if (!logIds.length) return {};
  const placeholders = logIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT log_id, src_line FROM log_sites WHERE log_id IN (${placeholders})`,
    )
    .all(...logIds.map(Number));
  const result = {};
  for (const r of rows) result[r.log_id] = r.src_line ?? null;
  return result;
}

const tombstone = db.prepare(
  "UPDATE log_sites SET removed_at = ? WHERE log_id = ? AND removed_at IS NULL",
);
export function tombstoneSite(logId) {
  tombstone.run(nowPst(), Number(logId));
}

export function dbInfo() {
  const counts = {};
  for (const t of ["log_sites", "log_events", "log_groups", "site_groups"]) {
    counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  }
  return { path: UNILOG_DB_PATH, counts };
}

// Read-back for the web client log viewer. Returns recent events joined with
// their sites, newest first. Optional filters: pid, level, file (partial),
// msg (partial). beforeId returns only events older than that event id (for
// upward paging). limit is clamped to a sane range.
export function queryEvents({ pid, level, file, msg, limit, beforeId } = {}) {
  const where = [];
  const params = [];
  if (beforeId) {
    where.push("e.id < ?");
    params.push(Number(beforeId));
  }
  if (pid) {
    where.push("e.pid = ?");
    params.push(String(pid));
  }
  if (level) {
    where.push("s.level = ?");
    params.push(String(level));
  }
  if (file) {
    where.push("s.src_file LIKE ?");
    params.push(`%${String(file)}%`);
  }
  if (msg) {
    where.push("e.message LIKE ?");
    params.push(`%${String(msg)}%`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 5000);
  return db
    .prepare(
      `SELECT e.id, e.ts, e.pid, s.log_id, s.src_file, s.src_line,
              s.tag, s.level, e.message,
              (SELECT GROUP_CONCAT(lg.description, ', ')
                 FROM site_groups sg JOIN log_groups lg
                   ON sg.group_id = lg.group_id
                WHERE sg.log_id = s.log_id
                  AND lg.description IS NOT NULL) AS groups
         FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
         ${w} ORDER BY e.id DESC LIMIT ${lim}`,
    )
    .all(...params);
}

// Distinct process names seen in events (for the viewer's pid filter).
export function listPids() {
  return db
    .prepare("SELECT DISTINCT pid FROM log_events ORDER BY pid")
    .all()
    .map((r) => r.pid);
}

export function countEvents() {
  return db.prepare("SELECT COUNT(*) AS n FROM log_events").get().n;
}

export function listLevels() {
  return db
    .prepare(
      "SELECT DISTINCT level FROM log_sites WHERE level IS NOT NULL ORDER BY level",
    )
    .all()
    .map((r) => r.level);
}

export { UNILOG_DB_PATH, db };
