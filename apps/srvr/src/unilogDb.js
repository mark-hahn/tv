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
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id       INTEGER,
  pid          TEXT,
  ts           TEXT NOT NULL,
  message      TEXT NOT NULL,
  hide INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_logid ON log_events(log_id);
CREATE INDEX IF NOT EXISTS idx_events_ts    ON log_events(ts);

CREATE TABLE IF NOT EXISTS log_groups (
  group_id    INTEGER PRIMARY KEY,
  hide        INTEGER DEFAULT 0,
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

// Migration: Rename is_duplicate to hide if needed
try {
  const columns = db.pragma("table_info(log_events)");
  if (columns.some((col) => col.name === "is_duplicate")) {
    db.exec("ALTER TABLE log_events RENAME COLUMN is_duplicate TO hide");
    console.log(
      "[unilogDb] migration: renamed is_duplicate to hide in log_events",
    ); // no-unilog
  } else if (!columns.some((col) => col.name === "hide")) {
    db.exec("ALTER TABLE log_events ADD COLUMN hide INTEGER DEFAULT 0");
    console.log("[unilogDb] migration: added hide column to log_events"); // no-unilog
  }
} catch (err) {
  console.error("[unilogDb] migration failed:", err); // no-unilog
}

// Migration: repurpose log_groups.group_type (string) as a numeric hide flag.
// One-time: adding the fresh hide column clears every group's flag to 0.
try {
  const gcols = db.pragma("table_info(log_groups)");
  const hadGroupType = gcols.some((col) => col.name === "group_type");
  const hasHide = gcols.some((col) => col.name === "hide");
  if (!hasHide) {
    db.exec("ALTER TABLE log_groups ADD COLUMN hide INTEGER DEFAULT 0");
    db.exec("UPDATE log_groups SET hide = 0"); // one-time clear
    console.log("[unilogDb] migration: added hide column to log_groups"); // no-unilog
  }
  if (hadGroupType) {
    db.exec("ALTER TABLE log_groups DROP COLUMN group_type");
    console.log("[unilogDb] migration: dropped group_type from log_groups"); // no-unilog
  }
} catch (err) {
  console.error("[unilogDb] log_groups hide migration failed:", err); // no-unilog
}

// PST 'yyyy/mm/dd hh:mm:ss' for a given Date; hour 24 normalized to 00.
function pstStr(d = new Date()) {
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

// PST 'yyyy/mm/dd hh:mm:ss' for now (repo convention).
export function nowPst() {
  return pstStr();
}

const insEvent = db.prepare(
  "INSERT INTO log_events (log_id, pid, ts, message, hide) VALUES (?, ?, ?, ?, ?)",
);

// Full joined row for one event (event + its site). Used for the live tail
// broadcast and for enriching newly inserted events with their metadata.
const getEventRow = db.prepare(`
  SELECT e.id, e.ts, e.pid, s.log_id, s.src_file, s.src_line,
         s.tag, s.level, e.message, e.hide
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
// True when any group linked to this site has its hide flag set. New events for
// the site are hidden by default when this is true.
const anyGroupHidden = db.prepare(
  `SELECT 1 FROM site_groups sg JOIN log_groups lg ON sg.group_id = lg.group_id
    WHERE sg.log_id = ? AND lg.hide = 1 LIMIT 1`,
);
function groupHideForSite(logId) {
  if (logId == null) return false;
  return !!anyGroupHidden.get(Number(logId));
}

// it to live-tail subscribers. Returns null when the event has no matching site
// (e.g. a null/unknown logId).
export function insertEvent({ logId, pid, message, isHidden = false }) {
  const hidden = isHidden || groupHideForSite(logId);
  const info = insEvent.run(
    logId == null ? null : Number(logId),
    String(pid || "unknown"),
    nowPst(),
    String(message ?? ""),
    hidden ? 1 : 0,
  );
  const row = getEventRow.get(Number(info.lastInsertRowid));
  if (row) row.groups = groupsForSite(row.log_id);
  return row || null;
}

// ---------------------------------------------------------------------------
// down-blocked dedup — the "down blocked" group covers the whole tor/flex → qbt
// → down flow. The same file gets blocked every processing cycle, producing
// identical redundant events. Drop events whose (log_id + message) was already
// seen within the last ~hour so the viewer isn't flooded. Only group-members
// are deduped; all other events pass through untouched.
// ---------------------------------------------------------------------------
const DEDUP_TTL_MS = 60 * 60 * 1000; // ~1 hour
const DEDUP_GROUP = "down blocked";
const dedupCache = new Map(); // `${logId}\u0000${message}` -> insertedAtMs
let dedupIds = new Set(); // log_ids in the down-blocked group
let dedupDropped = 0; // running count of suppressed redundant events

function loadDedupIds() {
  dedupIds = new Set();
  const g = db
    .prepare("SELECT group_id FROM log_groups WHERE description = ?")
    .get(DEDUP_GROUP);
  if (!g) return;
  for (const r of db
    .prepare("SELECT log_id FROM site_groups WHERE group_id = ?")
    .all(g.group_id))
    dedupIds.add(Number(r.log_id));
}

function pruneDedupCache(now) {
  for (const [k, t] of dedupCache)
    if (now - t > DEDUP_TTL_MS) dedupCache.delete(k);
}

// Seed the cache from DB rows in the last hour so a file blocked just before a
// restart isn't immediately re-logged after. ts is a PST wall-clock string, so
// a lexicographic `ts >= cutoff` compare is timezone-correct. Seeded entries
// expire ~1h from startup (mild over-retention, harmless).
function seedDedupCache() {
  if (dedupIds.size === 0) return;
  const now = Date.now();
  const cutoff = pstStr(new Date(now - DEDUP_TTL_MS));
  const placeholders = [...dedupIds].map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT DISTINCT log_id, message FROM log_events
        WHERE ts >= ? AND log_id IN (${placeholders})`,
    )
    .all(cutoff, ...[...dedupIds]);
  for (const r of rows) dedupCache.set(`${r.log_id}\u0000${r.message}`, now);
}

loadDedupIds();
seedDedupCache();

// Running count of redundant down-blocked events dropped since startup.
export function getDedupDropped() {
  return dedupDropped;
}

// Dedup wrapper used by BOTH the in-process srvr sink and POST /api/log, so
// local and remote emitters are covered. Returns the joined event row to
// broadcast, or null when the event is a redundant down-blocked event (inserted
// to DB but NOT broadcast). A cache hit does NOT refresh the entry, so a
// still-blocking file re-appears at most once per hour as a heartbeat.
export function insertEventDedup({ logId, pid, message }) {
  const id = logId == null ? null : Number(logId);
  if (id != null && dedupIds.has(id)) {
    const now = Date.now();
    pruneDedupCache(now);
    const key = `${id}\u0000${String(message ?? "")}`;
    if (dedupCache.has(key)) {
      dedupDropped++;
      insertEvent({ logId, pid, message, isHidden: true }); // Mark as hidden in DB
      return null; // But don't broadcast to clients
    }
    dedupCache.set(key, now);
  }
  return insertEvent({ logId, pid, message });
}

const insGroup = db.prepare(
  "INSERT INTO log_groups (group_id, hide, ts, description) VALUES (?, 0, ?, ?)",
);
const maxGroup = db.prepare(
  "SELECT COALESCE(MAX(group_id), 0) + 1 AS next FROM log_groups",
);

// Allocate + create a group atomically. Returns new group_id.
export const createGroup = db.transaction(({ description }) => {
  const id = maxGroup.get().next;
  insGroup.run(id, nowPst(), description || null);
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

const VALID_LEVELS = new Set(["info", "debug", "warn", "error"]);
const updLevel = db.prepare("UPDATE log_sites SET level = ? WHERE log_id = ?");
// Set the level field for a list of site ids. Returns count of rows changed.
export function setSiteLevel(logIds, level) {
  if (!VALID_LEVELS.has(level)) throw new Error(`invalid level: ${level}`);
  let changed = 0;
  const run = db.transaction(() => {
    for (const id of logIds) changed += updLevel.run(level, Number(id)).changes;
  });
  run();
  return changed;
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
// upward paging). afterId returns events newer than that id (for gap-fill after
// reconnect), returned oldest-first. limit is clamped to a sane range.
export function queryEvents({
  pid,
  level,
  file,
  msg,
  limit,
  beforeId,
  afterId,
} = {}) {
  const where = ["(e.hide IS NULL OR e.hide = 0)"];
  const params = [];
  if (beforeId) {
    where.push("e.id < ?");
    params.push(Number(beforeId));
  }
  if (afterId) {
    where.push("e.id > ?");
    params.push(Number(afterId));
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
  const order = afterId ? "ASC" : "DESC";
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
         ${w} ORDER BY e.id ${order} LIMIT ${lim}`,
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

const PRUNE_TARGET = 90000;

// Delete oldest events so row count stays at or below PRUNE_TARGET.
// Returns the number of rows deleted (0 if no pruning was needed).
export function pruneEvents() {
  const n = countEvents();
  if (n <= PRUNE_TARGET) return 0;
  const toDelete = n - PRUNE_TARGET;
  db.prepare(
    "DELETE FROM log_events WHERE id IN (SELECT id FROM log_events ORDER BY id ASC LIMIT ?)",
  ).run(toDelete);
  return toDelete;
}

// Delete specific events by their IDs.
// Returns the number of rows actually deleted.
export function deleteEvents(eventIds) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) return 0;
  const placeholders = eventIds.map(() => "?").join(",");
  const result = db
    .prepare(`DELETE FROM log_events WHERE id IN (${placeholders})`)
    .run(...eventIds);
  return result.changes || 0;
}

// Show events (set hide = 0) for all events in the given group IDs and clear the
// groups' own hide flag so future events default to visible.
// Returns the number of event rows changed.
export function showEventsInGroups(groupIds) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) return 0;
  setGroupHide(groupIds, 0);
  const logIds = siteIdsForGroups(groupIds);
  if (logIds.length === 0) return 0;
  const placeholders = logIds.map(() => "?").join(",");
  const result = db
    .prepare(`UPDATE log_events SET hide = 0 WHERE log_id IN (${placeholders})`)
    .run(...logIds);
  return result.changes || 0;
}

// Unshow events (set hide = 1) for all events in the given group IDs and set the
// groups' own hide flag so future events default to hidden.
// Returns the number of event rows changed.
export function unshowEventsInGroups(groupIds) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) return 0;
  setGroupHide(groupIds, 1);
  const logIds = siteIdsForGroups(groupIds);
  if (logIds.length === 0) return 0;
  const placeholders = logIds.map(() => "?").join(",");
  const result = db
    .prepare(`UPDATE log_events SET hide = 1 WHERE log_id IN (${placeholders})`)
    .run(...logIds);
  return result.changes || 0;
}

export function listLevels() {
  return db
    .prepare(
      "SELECT DISTINCT level FROM log_sites WHERE level IS NOT NULL ORDER BY level",
    )
    .all()
    .map((r) => r.level);
}

export function getOldestTimestamp() {
  const row = db
    .prepare("SELECT ts FROM log_events ORDER BY id ASC LIMIT 1")
    .get();
  return row?.ts || "";
}

// ---------------------------------------------------------------------------
// Groups management (web client Groups pane).
// tv-srvr is the single writer; all group_id allocation flows through here.
// ---------------------------------------------------------------------------

// One-time cleanup: any group whose description is NULL, blank, or shares its
// description with another group is renamed to `Group <group_id>` (unique).
// Idempotent — safe to run on every startup (no-op once names are unique).
function cleanupGroupDescriptions() {
  const run = db.transaction(() => {
    const upd = db.prepare(
      "UPDATE log_groups SET description = ? WHERE group_id = ?",
    );
    const blanks = db
      .prepare(
        "SELECT group_id FROM log_groups WHERE description IS NULL OR TRIM(description) = ''",
      )
      .all();
    for (const r of blanks) upd.run(`Group ${r.group_id}`, r.group_id);
    const dups = db
      .prepare(
        `SELECT group_id FROM log_groups
          WHERE description IS NOT NULL
            AND description COLLATE NOCASE IN (
              SELECT description FROM log_groups
               WHERE description IS NOT NULL
               GROUP BY description COLLATE NOCASE
              HAVING COUNT(*) > 1
            )`,
      )
      .all();
    for (const r of dups) upd.run(`Group ${r.group_id}`, r.group_id);
  });
  run();
}
cleanupGroupDescriptions();

// Enforce unique group names at the DB level (case-insensitive). Runs after the
// cleanup above so it can never fail on legacy duplicate/blank names.
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_desc ON log_groups(description COLLATE NOCASE)",
);

// Look up a group by exact (case-insensitive) name. Returns group_id or null.
const getGroupByDesc = db.prepare(
  "SELECT group_id FROM log_groups WHERE description = ? COLLATE NOCASE",
);
export function findGroupByDescription(description) {
  if (description == null) return null;
  return getGroupByDesc.get(String(description))?.group_id ?? null;
}

// Find a named group or create it. Returns { id, created }.
export const findOrCreateGroup = db.transaction(({ description }) => {
  const existing = findGroupByDescription(description);
  if (existing != null) return { id: existing, created: false };
  const id = maxGroup.get().next;
  insGroup.run(id, nowPst(), description);
  return { id, created: true };
});

// All named groups, alphabetical (case-insensitive).
export function listGroups() {
  return db
    .prepare(
      `SELECT group_id, hide, description FROM log_groups
        WHERE description IS NOT NULL ORDER BY description COLLATE NOCASE`,
    )
    .all();
}

const delSiteGroup = db.prepare(
  "DELETE FROM site_groups WHERE log_id = ? AND group_id = ?",
);

// Create a named group and link it to the given sites.
// If a group with that description already exists, do nothing.
export const createGroupWithSites = db.transaction(
  ({ description, logIds = [] }) => {
    const exists = db
      .prepare("SELECT 1 FROM log_groups WHERE description = ? COLLATE NOCASE")
      .get(description);
    if (exists) return { created: false };
    const id = maxGroup.get().next;
    insGroup.run(id, nowPst(), description);
    for (const logId of logIds) insSiteGroup.run(Number(logId), id);
    return { created: true, groupId: id, linked: logIds.length };
  },
);

// Link every (groupId × logId) pair. Returns rows actually added.
export const assignGroupsToSites = db.transaction(
  ({ groupIds = [], logIds = [] }) => {
    let added = 0;
    for (const gid of groupIds)
      for (const logId of logIds)
        added += insSiteGroup.run(Number(logId), Number(gid)).changes;
    return { added };
  },
);

// Unlink every (groupId × logId) pair. Returns rows actually removed.
export const removeGroupsFromSites = db.transaction(
  ({ groupIds = [], logIds = [] }) => {
    let removed = 0;
    for (const gid of groupIds)
      for (const logId of logIds)
        removed += delSiteGroup.run(Number(logId), Number(gid)).changes;
    return { removed };
  },
);

// Delete groups and all their site links. Returns pre-delete stats.
export const deleteGroups = db.transaction((groupIds = []) => {
  if (!groupIds.length) return { groups: 0, sites: 0 };
  const nums = groupIds.map(Number);
  const ph = nums.map(() => "?").join(",");
  const sites = db
    .prepare(
      `SELECT COUNT(DISTINCT log_id) AS n FROM site_groups WHERE group_id IN (${ph})`,
    )
    .get(...nums).n;
  db.prepare(`DELETE FROM site_groups WHERE group_id IN (${ph})`).run(...nums);
  db.prepare(`DELETE FROM log_groups WHERE group_id IN (${ph})`).run(...nums);
  return { groups: nums.length, sites };
});

// Distinct site (log_id) ids linked to any of the given groups.
export function siteIdsForGroups(groupIds) {
  if (!groupIds.length) return [];
  const nums = groupIds.map(Number);
  const ph = nums.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT DISTINCT log_id FROM site_groups WHERE group_id IN (${ph})`,
    )
    .all(...nums)
    .map((r) => r.log_id);
}

// Site and event totals for one group: sites joined to the group, and events
// belonging to those sites.
export function groupStats(groupId) {
  const id = Number(groupId);
  const sites = db
    .prepare("SELECT COUNT(*) AS n FROM site_groups WHERE group_id = ?")
    .get(id).n;
  const events = db
    .prepare(
      `SELECT COUNT(*) AS n FROM log_events
        WHERE log_id IN (SELECT log_id FROM site_groups WHERE group_id = ?)`,
    )
    .get(id).n;
  return { sites, events };
}

// Distinct group ids linked to any of the given sites.
export function groupIdsForSites(logIds = []) {
  if (!logIds.length) return [];
  const nums = logIds.map(Number);
  const ph = nums.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT DISTINCT group_id FROM site_groups WHERE log_id IN (${ph})`,
    )
    .all(...nums)
    .map((r) => r.group_id);
}

// Current comma-joined group string for each given site (for row refresh).
export function groupsForSites(logIds = []) {
  const result = {};
  for (const id of logIds) result[id] = groupsForSite(id);
  return result;
}

// Groups not linked to any site that appears in an event (orphaned groups).
export function orphanGroupIds() {
  return db
    .prepare(
      `SELECT group_id FROM log_groups
        WHERE description IS NOT NULL
          AND group_id NOT IN (
            SELECT DISTINCT sg.group_id FROM site_groups sg
             WHERE sg.log_id IN (SELECT DISTINCT log_id FROM log_events)
          )`,
    )
    .all()
    .map((r) => r.group_id);
}

const updGroupHide = db.prepare(
  "UPDATE log_groups SET hide = ? WHERE group_id = ?",
);
// Set the hide flag (0 or 1) on the given groups. Returns count.
export function setGroupHide(groupIds = [], hide = 0) {
  const val = hide ? 1 : 0;
  let changed = 0;
  const run = db.transaction(() => {
    for (const id of groupIds)
      changed += updGroupHide.run(val, Number(id)).changes;
  });
  run();
  return changed;
}

const updGroupName = db.prepare(
  "UPDATE log_groups SET description = ? WHERE group_id = ?",
);
// Rename one group. Refuses if another group already has that name.
export const setGroupName = db.transaction(({ groupId, description }) => {
  const clash = db
    .prepare(
      "SELECT 1 FROM log_groups WHERE description = ? COLLATE NOCASE AND group_id != ?",
    )
    .get(description, Number(groupId));
  if (clash) return { renamed: false };
  updGroupName.run(description, Number(groupId));
  return { renamed: true };
});

export { UNILOG_DB_PATH, db };
