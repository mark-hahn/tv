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
  removed_at  TEXT,
  blocked_until TEXT
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

// Migration: add log_sites.blocked_until. tv-watchdog stamps a PST
// "yyyy/mm/dd hh:mm:ss" here when an error burst blocks a site; events from a
// blocked site are dropped on insert until the stamp expires.
try {
  const scols = db.pragma("table_info(log_sites)");
  if (!scols.some((col) => col.name === "blocked_until")) {
    db.exec("ALTER TABLE log_sites ADD COLUMN blocked_until TEXT");
    console.log("[unilogDb] migration: added blocked_until to log_sites"); // no-unilog
  }
} catch (err) {
  console.error("[unilogDb] blocked_until migration failed:", err); // no-unilog
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

// An emitter-supplied ts is only honored in this exact shape; anything else
// falls back to nowPst() at insert time.
const TS_RE = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/;

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

// One runtime emission. ts is stamped here unless the emitter supplied its own
// (the client does, at unilog() call time, so a blocking dialog or a slow batch
// flush can't backdate an event to its arrival time).
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
// hide values on log_events: 0 = visible, 1 = group/manual hidden,
// 2 = dedup-suppressed (kept in the DB for debugging queries; never broadcast
// and never flipped by group Show/Unshow).
export function insertEvent({
  logId,
  pid,
  message,
  ts,
  isHidden = false,
  isDup = false,
}) {
  const hide = isDup ? 2 : isHidden || groupHideForSite(logId) ? 1 : 0;
  const info = insEvent.run(
    logId == null ? null : Number(logId),
    String(pid || "unknown"),
    resolveTs(ts),
    String(message ?? ""),
    hide,
  );
  const row = getEventRow.get(Number(info.lastInsertRowid));
  if (row) row.groups = groupsForSite(row.log_id);
  return row || null;
}

// ---------------------------------------------------------------------------
// down-blocked dedup — the "down blocked" group covers the whole tor/flex → qbt
// → down flow. The same file gets blocked every processing cycle, producing
// identical redundant events. Drop events whose (log_id + message) was already
// seen within the last ~24 hours so the viewer isn't flooded. Only group-members
// are deduped; all other events pass through untouched.
// ---------------------------------------------------------------------------
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // ~24 hours
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

// Seed the cache from DB rows in the last TTL window so a file blocked just
// before a restart isn't immediately re-logged after. ts is a PST wall-clock
// string, so a lexicographic `ts >= cutoff` compare is timezone-correct. Seeded
// entries expire one TTL from startup (mild over-retention, harmless).
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

// Watchdog burst-block: a site whose blocked_until stamp is still in the
// future has its events dropped entirely (not inserted, not broadcast).
const getBlockedUntil = db.prepare(
  "SELECT blocked_until FROM log_sites WHERE log_id = ?",
);

// Exact-repeat guard: ts only has 1-second resolution (see TS_RE), so a burst
// of events from one site fired within the same second — e.g. a main-thread
// stall delaying several queued browser events, all reported with the same
// name+duration — reads as identical rows. Look back over just that site's
// last RECENT_DUP_WINDOW rows (not a global scan) for an exact message+ts
// match and drop the insert entirely when found, rather than storing every
// copy of what is really one moment.
const RECENT_DUP_CHECK_ENABLED = false;
const RECENT_DUP_WINDOW = 40;
const checkRecentDup = db.prepare(
  `SELECT 1 FROM (
     SELECT message, ts FROM log_events WHERE log_id = ? ORDER BY id DESC LIMIT ${RECENT_DUP_WINDOW}
   ) WHERE message = ? AND ts = ? LIMIT 1`,
);

function resolveTs(ts) {
  return TS_RE.test(String(ts ?? "")) ? String(ts) : nowPst();
}

// Dedup wrapper used by BOTH the in-process srvr sink and POST /api/log, so
// local and remote emitters are covered. Returns the joined event row to
// broadcast, or null when the event is dropped: either an exact repeat of a
// recent event at the same site (never inserted at all), or a redundant
// down-blocked event (inserted to DB with hide = 2 but NOT broadcast). A
// down-blocked cache hit does NOT refresh the entry, so a still-blocking file
// re-appears at most once per day as a heartbeat.
export function insertEventDedup({ logId, pid, message, ts }) {
  const id = logId == null ? null : Number(logId);
  if (id != null) {
    const bu = getBlockedUntil.get(id)?.blocked_until;
    if (bu && bu > nowPst()) return null; // site blocked by tv-watchdog
  }
  if (id != null && RECENT_DUP_CHECK_ENABLED) {
    const stampedTs = resolveTs(ts);
    if (checkRecentDup.get(id, String(message ?? ""), stampedTs)) return null;
  }
  if (id != null && dedupIds.has(id)) {
    const now = Date.now();
    pruneDedupCache(now);
    const key = `${id}\u0000${String(message ?? "")}`;
    if (dedupCache.has(key)) {
      dedupDropped++;
      insertEvent({ logId, pid, message, ts, isDup: true }); // kept in DB as hide = 2
      return null; // But don't broadcast to clients
    }
    dedupCache.set(key, now);
  }
  return insertEvent({ logId, pid, message, ts });
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
// includeHidden skips the normal log-pane hide filter for whole-DB searches.
// errors: error-mode read-back — only error-level sites, only the last week,
// and hidden events are INCLUDED (the hide filter is skipped).
export function queryEvents({
  pid,
  level,
  file,
  msg,
  limit,
  beforeId,
  afterId,
  errors,
  includeHidden,
} = {}) {
  const where = [];
  const params = [];
  if (errors) {
    where.push("s.level = 'error'");
    where.push("e.ts >= ?");
    params.push(pstStr(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  } else if (!includeHidden) {
    where.push("(e.hide IS NULL OR e.hide = 0)");
  }
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

// Rolling-window count of level='warn' events in the trailing 60 minutes,
// including hidden/group-blocked rows. Backs the log pane's live rate
// display; tv-watchdog independently re-derives the same count for alerting.
export function warnCountLastHour() {
  const cutoff = pstStr(new Date(Date.now() - 60 * 60 * 1000));
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM log_events e
        JOIN log_sites s ON e.log_id = s.log_id
        WHERE s.level = 'warn' AND e.ts > ?`,
    )
    .get(cutoff).n;
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
// groups' own hide flag so future events default to visible. Only group-hidden
// rows (hide = 1) are unhidden — dedup-suppressed rows (hide = 2) stay hidden.
// Returns the number of event rows changed.
export function showEventsInGroups(groupIds) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) return 0;
  setGroupHide(groupIds, 0);
  const logIds = siteIdsForGroups(groupIds);
  if (logIds.length === 0) return 0;
  const placeholders = logIds.map(() => "?").join(",");
  const result = db
    .prepare(
      `UPDATE log_events SET hide = 0
        WHERE log_id IN (${placeholders}) AND hide = 1`,
    )
    .run(...logIds);
  return result.changes || 0;
}

// Unshow events (set hide = 1) for all events in the given group IDs and set the
// groups' own hide flag so future events default to hidden. Dedup-suppressed
// rows (hide = 2) keep their marker.
// Returns the number of event rows changed.
export function unshowEventsInGroups(groupIds) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) return 0;
  setGroupHide(groupIds, 1);
  const logIds = siteIdsForGroups(groupIds);
  if (logIds.length === 0) return 0;
  const placeholders = logIds.map(() => "?").join(",");
  const result = db
    .prepare(
      `UPDATE log_events SET hide = 1
        WHERE log_id IN (${placeholders}) AND hide = 0`,
    )
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
// Plot pane day-count queries, ascending by day (PST prefix of ts). Counts
// include hidden/dedup rows — a hidden event still represents a real download.
// ---------------------------------------------------------------------------

// Site in apps/down/src/tvJson.js (logTvEntryAdded, no-error branch): one
// event per file queued for download from the usb server. This is every
// download regardless of where it came from.
const DOWN_ENTRY_LOG_ID = 1189;

export function plotDayCounts(plot) {
  if (plot === "down") {
    // Stacked bars: total downloads split into flexget-originated and the
    // remainder (sent by hand from the tor pane).
    const total = db
      .prepare(
        `SELECT substr(ts, 1, 10) AS day, COUNT(*) AS count
           FROM log_events WHERE log_id = ? GROUP BY day ORDER BY day`,
      )
      .all(DOWN_ENTRY_LOG_ID);
    // Every SENT(first|better|upgrade-...) emitted by flexget.js.
    const flexRows = db
      .prepare(
        `SELECT substr(e.ts, 1, 10) AS day, COUNT(*) AS count
           FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
          WHERE s.src_file LIKE '%flexget.js' AND e.message LIKE 'SENT(%'
          GROUP BY day ORDER BY day`,
      )
      .all();
    const flexByDay = new Map(flexRows.map((r) => [r.day, r.count]));
    return total.map((r) => {
      // Flexget sends can outrun the downloads they trigger; cap so the two
      // segments always sum to the day's download total.
      const flex = Math.min(flexByDay.get(r.day) || 0, r.count);
      return { day: r.day, tor: r.count - flex, flex };
    });
  }
  throw new Error(`unknown plot: ${plot}`);
}

// Average downloads per day over whole days only. The log's first and last
// days are partial (retention trim at the start, today still running at the
// end), so both are dropped. Days inside the range with no downloads count as
// zero, which is why the span comes from all events, not just download events.
export function downsPerDay() {
  const span = db
    .prepare(
      "SELECT substr(min(ts), 1, 10) AS first, substr(max(ts), 1, 10) AS last FROM log_events",
    )
    .get();
  if (!span?.first || !span?.last) return 0;

  const dayMs = 24 * 60 * 60 * 1000;
  const toMs = (day) => Date.parse(day.replace(/\//g, "-") + "T00:00:00Z");
  const firstWhole = toMs(span.first) + dayMs;
  const lastWhole = toMs(span.last) - dayMs;
  const days = Math.round((lastWhole - firstWhole) / dayMs) + 1;
  if (days < 1) return 0;

  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM log_events
        WHERE log_id = ? AND substr(ts, 1, 10) BETWEEN ? AND ?`,
    )
    .get(
      DOWN_ENTRY_LOG_ID,
      new Date(firstWhole).toISOString().slice(0, 10).replace(/-/g, "/"),
      new Date(lastWhole).toISOString().slice(0, 10).replace(/-/g, "/"),
    );
  return (row?.count || 0) / days;
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

const delAllSiteGroups = db.prepare("DELETE FROM site_groups WHERE log_id = ?");

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

// Drop every group link on each site, then link only the given groups.
// Returns rows removed and rows added.
export const replaceGroupsOnSites = db.transaction(
  ({ groupIds = [], logIds = [] }) => {
    let removed = 0;
    let added = 0;
    for (const logId of logIds) {
      removed += delAllSiteGroups.run(Number(logId)).changes;
      for (const gid of groupIds)
        added += insSiteGroup.run(Number(logId), Number(gid)).changes;
    }
    return { removed, added };
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
