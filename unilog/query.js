#!/usr/bin/env node
// unilog/query.js — query the remote unilog database
//
// Usage: node unilog/query.js [options]
//
// Filters (at least one required):
//   --file F        partial src_file match (e.g. server.js or apps/srvr)
//   --line N        exact src_line — requires --file
//   --id N          log_id (can repeat: --id 3 --id 7)
//   --tag T         tag filter (exact match)
//   --level L       level filter: info|warn|error|debug
//   --pid P         process name filter (e.g. tv-srvr)
//   --msg TXT       message contains TXT (case-insensitive)
//
// Range / output:
//   --last N        number of events (default 50)
//   --since TS      events since timestamp (sqlite datetime expr or 'YYYY/MM/DD HH:MM:SS')
//   --asc           sort ascending (default: newest first)
//   --sites         list matching log_sites instead of events
//   --dry-run       print the SQL instead of running it

import { execSync } from "node:child_process";

const DB = "/root/dev/apps/tv/unilog/unilog.sqlite";
const SSH = "ssh hahnca.com";

function parseArgs(argv) {
  const a = { ids: [], last: 50 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--asc") a.asc = true;
    else if (t === "--sites") a.sites = true;
    else if (t === "--dry-run") a.dryRun = true;
    else if (t === "--id") a.ids.push(Number(argv[++i]));
    else if (t.startsWith("--")) {
      const key = t.slice(2);
      a[key] = argv[++i];
    }
  }
  if (a.last) a.last = Number(a.last);
  return a;
}

function q(s) {
  return s.replace(/'/g, "''");
}

function buildSql(opts) {
  const where = [];

  if (opts.file) where.push(`s.src_file LIKE '%${q(opts.file)}%'`);
  if (opts.line) where.push(`s.src_line = ${Number(opts.line)}`);
  if (opts.tag) where.push(`s.tag = '${q(opts.tag)}'`);
  if (opts.level) where.push(`s.level = '${q(opts.level)}'`);
  if (opts.ids.length) where.push(`s.log_id IN (${opts.ids.join(",")})`);

  if (opts.sites) {
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return `SELECT s.log_id, s.src_file, s.src_line, s.tag, s.level, s.description FROM log_sites s ${w} ORDER BY s.log_id;`;
  }

  // events query — join log_sites so we can filter by file/tag/etc
  const evWhere = [...where];
  if (opts.pid) evWhere.push(`e.pid = '${q(opts.pid)}'`);
  if (opts.msg) evWhere.push(`e.message LIKE '%${q(opts.msg)}%'`);
  if (opts.since) {
    // accept 'YYYY/MM/DD HH:MM:SS' or sqlite datetime expressions like '-1 hour'
    const ts = opts.since.match(/^\d{4}\//)
      ? `'${q(opts.since)}'`
      : `datetime('now','${q(opts.since)}')`;
    evWhere.push(`e.ts >= ${ts}`);
  }

  const w = evWhere.length ? `WHERE ${evWhere.join(" AND ")}` : "";
  const order = opts.asc ? "ASC" : "DESC";
  return (
    `SELECT e.id, e.ts, e.pid, s.src_file, s.src_line, s.tag, s.level, e.message ` +
    `FROM log_events e JOIN log_sites s ON e.log_id = s.log_id ` +
    `${w} ORDER BY e.id ${order} LIMIT ${opts.last};`
  );
}

function fmt(raw, isSites) {
  const rows = raw.trim().split("\n").filter(Boolean);
  if (!rows.length) {
    console.log("(no results)"); // no-unilog
    return;
  }
  for (const row of rows) {
    const cols = row.split("|");
    if (isSites) {
      // log_id | src_file | src_line | tag | level | description
      const [id, file, line, tag, level, desc] = cols;
      const loc = `${file}:${line}`;
      const meta = [tag && `[${tag}]`, level !== "info" && level]
        .filter(Boolean)
        .join(" ");
      console.log(`id=${id}  ${loc}  ${meta}  ${desc || ""}`.trimEnd()); // no-unilog
    } else {
      // id | ts | pid | src_file | src_line | tag | level | message
      const [id, ts, pid, file, line, tag, level, ...msgParts] = cols;
      const msg = msgParts.join("|");
      const loc = `${file}:${line}`;
      const meta = [tag && `[${tag}]`, level !== "info" && level]
        .filter(Boolean)
        .join(" ");
      const prefix = `${ts} ${pid} ${loc}${meta ? " " + meta : ""}`;
      console.log(`${prefix}  ${msg}`); // no-unilog
    }
  }
}

const opts = parseArgs(process.argv.slice(2));

const hasFilter =
  opts.file ||
  opts.ids.length ||
  opts.tag ||
  opts.level ||
  opts.pid ||
  opts.msg ||
  opts.since;

if (!hasFilter) {
  console.error(
    // no-unilog
    "error: provide at least one filter: --file, --id, --tag, --level, --pid, --msg, --since",
  );
  process.exit(1);
}

const sql = buildSql(opts);

if (opts.dryRun) {
  console.log(sql); // no-unilog
  process.exit(0);
}

const cmd = `${SSH} "sqlite3 /root/dev/apps/tv/unilog/unilog.sqlite '${sql.replace(/'/g, "'\\''")}'"`;

let raw;
try {
  raw = execSync(cmd, { encoding: "utf8" });
} catch (e) {
  console.error("query failed:", e.message); // no-unilog
  process.exit(1);
}

fmt(raw, !!opts.sites);
