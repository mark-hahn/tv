#!/usr/bin/env node
// unilog/query.js — query the remote unilog database (read-only)
//
// This is the ONLY supported way to read unilog data. It SSHes to the remote
// server and runs sqlite3 with -readonly, so it can never disturb tv-srvr
// (the single writer). Do not open the DB directly.
//
// Usage: node unilog/query.js [filters] [options]
//
// Filters (at least one required, except with --groups / --sql):
//   --file F        partial src_file match (e.g. server.js or apps/srvr)
//   --line N        exact src_line — use with --file
//   --id N          log_id (repeatable: --id 3 --id 7)
//   --level L       info | warn | error | debug
//   --pid P         process name (e.g. tv-srvr, tv-down, tv-api)
//   --project P     project column: srvr | down | api | asr | client | tv
//   --group G       group name, partial + case-insensitive (repeatable)
//   --msg TXT       message contains TXT (case-insensitive)
//   --since TS      'YYYY/MM/DD HH:MM:SS[.SSS]' or a modifier like '-1 hour'
//
// Output / mode:
//   --last N        max rows (default 50). Always the NEWEST N matches.
//   --asc           print oldest-first (still the newest N matches)
//   --visible       ONLY unhidden events (what the client log pane shows).
//                   Hidden events are included by default — they are ~85% of
//                   the table and usually the ones you are debugging.
//   --nodup         drop dedup-suppressed repeats (hide=2), keep group-hidden
//   --sites         list matching log_sites instead of events (+ event counts)
//   --groups        list all groups with site + event counts
//   --sql "SELECT…" run arbitrary read-only SQL (escape hatch for aggregates)
//   --json          emit raw JSON rows instead of formatted lines
//   --dry-run       print the SQL instead of running it

import { execSync } from "node:child_process";

const DB = "/root/dev/apps/tv/unilog/unilog.sqlite";
const SSH_HOST = "hahnca.com";

// "all" is accepted but a no-op — hidden events are included by default now.
// It stays listed so it parses as a flag instead of swallowing the next arg.
const FLAGS = [
  "asc",
  "sites",
  "groups",
  "all",
  "visible",
  "nodup",
  "json",
  "dry-run",
];

function parseArgs(argv) {
  const a = { ids: [], groups: [], last: 50 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const key = t.slice(2);
    if (FLAGS.includes(key)) a[key === "dry-run" ? "dryRun" : key] = true;
    else if (key === "id") a.ids.push(Number(argv[++i]));
    else if (key === "group") a.groups.push(argv[++i]);
    else a[key] = argv[++i];
  }
  a.last = Number(a.last);
  return a;
}

function q(s) {
  return String(s).replace(/'/g, "''");
}

// e.ts is stamped as PST 'YYYY/MM/DD HH:MM:SS.SSS' (see unilog/docs/unilog-db.md).
// sqlite's datetime('now', modifier) is UTC and uses '-' separators, so
// comparing it directly against e.ts was both wrong timezone AND a string
// format mismatch ('/' > '-' in ASCII, so the WHERE clause always matched).
// Instead resolve --since to the same PST '/'-separated format in JS.
function pstTimestamp(d) {
  const date = d
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .replace(/-/g, "/");
  let time = d.toLocaleTimeString("en-GB", {
    timeZone: "America/Los_Angeles",
    hour12: false,
  });
  if (time.startsWith("24:")) time = "00:" + time.slice(3);
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${date} ${time}.${ms}`;
}

function resolveSince(since) {
  if (/^\d{4}\//.test(since)) return since;
  const m = since
    .trim()
    .match(/^([+-]?\d+)\s*(second|minute|hour|day|week|month|year)s?$/i);
  if (!m) {
    console.error(`error: unrecognized --since value: ${since}`); // no-unilog
    process.exit(1);
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const d = new Date();
  if (unit === "second") d.setSeconds(d.getSeconds() + n);
  else if (unit === "minute") d.setMinutes(d.getMinutes() + n);
  else if (unit === "hour") d.setHours(d.getHours() + n);
  else if (unit === "day") d.setDate(d.getDate() + n);
  else if (unit === "week") d.setDate(d.getDate() + n * 7);
  else if (unit === "month") d.setMonth(d.getMonth() + n);
  else if (unit === "year") d.setFullYear(d.getFullYear() + n);
  return pstTimestamp(d);
}

// --- SQL builders -----------------------------------------------------------

function siteWhere(o) {
  const w = [];
  if (o.file) w.push(`s.src_file LIKE '%${q(o.file)}%'`);
  if (o.line) w.push(`s.src_line = ${Number(o.line)}`);
  if (o.level) w.push(`s.level = '${q(o.level)}'`);
  if (o.project) w.push(`s.project = '${q(o.project)}'`);
  if (o.ids.length) w.push(`s.log_id IN (${o.ids.map(Number).join(",")})`);
  if (o.groups.length) {
    const names = o.groups
      .map((g) => `lg.description LIKE '%${q(g)}%'`)
      .join(" OR ");
    w.push(
      `s.log_id IN (SELECT sg.log_id FROM site_groups sg ` +
        `JOIN log_groups lg ON lg.group_id = sg.group_id WHERE ${names})`,
    );
  }
  return w;
}

function buildSql(o) {
  if (o.sql) return o.sql.trim().replace(/;*$/, ";");

  if (o.groups_ /* --groups listing */) {
    return (
      `SELECT lg.group_id, lg.description, lg.hide, ` +
      `COUNT(DISTINCT sg.log_id) AS sites, ` +
      `(SELECT COUNT(*) FROM log_events e JOIN site_groups s2 ` +
      `  ON s2.log_id = e.log_id WHERE s2.group_id = lg.group_id) AS events ` +
      `FROM log_groups lg LEFT JOIN site_groups sg ON sg.group_id = lg.group_id ` +
      `GROUP BY lg.group_id ORDER BY lg.description COLLATE NOCASE;`
    );
  }

  const where = siteWhere(o);

  if (o.sites) {
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return (
      `SELECT s.log_id, s.project, s.src_file, s.src_line, s.level, ` +
      `s.removed_at, s.description, ` +
      `(SELECT COUNT(*) FROM log_events e WHERE e.log_id = s.log_id) AS events, ` +
      `(SELECT GROUP_CONCAT(lg.description, ', ') FROM site_groups sg ` +
      `  JOIN log_groups lg ON lg.group_id = sg.group_id ` +
      `  WHERE sg.log_id = s.log_id) AS grps ` +
      `FROM log_sites s ${w} ORDER BY s.log_id;`
    );
  }

  const evWhere = [...where];
  if (o.pid) evWhere.push(`e.pid = '${q(o.pid)}'`);
  if (o.msg) evWhere.push(`e.message LIKE '%${q(o.msg)}%'`);
  // Hidden events are the norm (~85% of the table) and are exactly what you
  // need when debugging, so they are included by default. --visible opts into
  // the client log pane's view; --nodup drops only dedup-suppressed repeats.
  if (o.visible) evWhere.push(`(e.hide IS NULL OR e.hide = 0)`);
  else if (o.nodup) evWhere.push(`(e.hide IS NULL OR e.hide <> 2)`);
  if (o.since) evWhere.push(`e.ts >= '${q(resolveSince(o.since))}'`);

  const w = evWhere.length ? `WHERE ${evWhere.join(" AND ")}` : "";
  // Always take the newest N; --asc only flips the print order (see fmt).
  return (
    `SELECT e.id, e.ts, e.pid, e.hide, s.src_file, s.src_line, s.level, ` +
    `e.message FROM log_events e JOIN log_sites s ON e.log_id = s.log_id ` +
    `${w} ORDER BY e.id DESC LIMIT ${Number(o.last)};`
  );
}

// --- output -----------------------------------------------------------------

function fmtEvents(rows, o) {
  const list = o.asc ? [...rows].reverse() : rows;
  for (const r of list) {
    const loc = `${r.src_file}:${r.src_line}`;
    const meta = [
      r.level !== "info" && r.level,
      r.hide === 1 && "hidden",
      r.hide === 2 && "dup",
    ]
      .filter(Boolean)
      .join(" ");
    const msg = String(r.message ?? "").replace(/\n/g, "\n    ");
    console.log(`${r.ts} ${r.pid} ${loc}${meta ? " " + meta : ""}  ${msg}`); // no-unilog
  }
}

function fmtSites(rows) {
  for (const r of rows) {
    const meta = [
      r.level !== "info" && r.level,
      r.grps && `{${r.grps}}`,
      r.removed_at && "REMOVED",
    ]
      .filter(Boolean)
      .join(" ");
    const loc = `${r.src_file}:${r.src_line}`;
    console.log(
      // no-unilog
      `id=${String(r.log_id).padEnd(5)}${String(r.project || "-").padEnd(8)}` +
        `n=${String(r.events).padEnd(7)}${loc}  ${meta}  ${r.description || ""}`.trimEnd(),
    );
  }
}

function fmtGroups(rows) {
  for (const r of rows) {
    const hide = r.hide ? " HIDE" : "";
    console.log(
      // no-unilog
      `${String(r.group_id).padStart(3)}  ${String(r.description).padEnd(24)}` +
        `sites=${String(r.sites).padEnd(5)}events=${r.events}${hide}`,
    );
  }
}

function fmtTable(rows) {
  const cols = Object.keys(rows[0]);
  console.log(cols.join(" | ")); // no-unilog
  for (const r of rows) console.log(cols.map((c) => r[c]).join(" | ")); // no-unilog
}

// --- main -------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
opts.groups_ = opts.groups === true; // bare --groups flag = listing mode
if (opts.groups_) opts.groups = [];

const hasFilter =
  opts.file ||
  opts.ids.length ||
  opts.level ||
  opts.pid ||
  opts.project ||
  opts.groups.length ||
  opts.msg ||
  opts.since;

if (!hasFilter && !opts.groups_ && !opts.sql) {
  console.error(
    // no-unilog
    "error: need a filter (--file --id --level --pid --project --group --msg --since)\n" +
      '       or a mode (--groups, --sites with a filter, --sql "SELECT …")',
  );
  process.exit(1);
}

const sql = buildSql(opts);

if (opts.dryRun) {
  console.log(sql); // no-unilog
  process.exit(0);
}

let raw;
try {
  raw = execSync(`ssh ${SSH_HOST} "sqlite3 -readonly -json ${DB}"`, {
    input: sql,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  console.error("query failed:", e.stderr || e.message); // no-unilog
  process.exit(1);
}

let rows;
try {
  rows = raw.trim() ? JSON.parse(raw) : [];
} catch {
  console.log(raw); // no-unilog — non-SELECT output passes through
  process.exit(0);
}

if (!rows.length) {
  const hint = opts.visible
    ? " — --visible excludes hidden events, try dropping it"
    : "";
  console.log(`(no results)${hint}`); // no-unilog
  process.exit(0);
}

if (opts.json)
  console.log(JSON.stringify(rows, null, 2)); // no-unilog
else if (opts.sql) fmtTable(rows);
else if (opts.groups_) fmtGroups(rows);
else if (opts.sites) fmtSites(rows);
else fmtEvents(rows, opts);
