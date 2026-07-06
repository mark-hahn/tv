// tv-watchdog — an independent background monitor (pm2 task: tv-watchdog).
//
// It reads the unilog SQLite DB READ-ONLY and pm2's process status, and raises
// tier-1 (liveness) + tier-2 (error-rate) alerts to its OWN log stream and a
// persistent alert file. It never writes to the app DB and shares no code with
// tv-srvr, so a bug in tv-srvr cannot take the watchdog down with it.
//
// Data sources:
//   - pm2 jlist            -> is tv-srvr online? crash-looping?
//   - unilog.sqlite (WAL)  -> server heartbeat freshness + error-event rate
//
// It reuses tv-srvr's already-built better-sqlite3 native module via
// createRequire (no install step, no shared source).

import fs from "fs";
import * as cp from "child_process";
import { createRequire } from "module";

const require = createRequire("/root/dev/apps/tv/apps/srvr/index.js");
const Database = require("better-sqlite3");

// ---- config (hard-wired constants, no env vars per repo convention) ----
const UNILOG_DB_PATH = "/root/dev/apps/tv/unilog/unilog.sqlite";
const ALERT_LOG_PATH = "/root/dev/apps/tv/unilog/watchdog-alerts.log";
const PM2_TARGET = "tv-srvr";

const CHECK_INTERVAL_MS = 60 * 1000; // run all checks every 60s
const HEARTBEAT_MAX_AGE_MS = 6 * 60 * 1000; // no "hb" event in 6m => stuck/dead
const ERROR_WINDOW_MS = 60 * 60 * 1000; // error-rate window: 1 hour
const ERROR_COUNT_WARN = 30; // > this many error events in window => warn
const RESTART_SPIKE = 3; // >= this many restarts between cycles => crash loop
const HEALTHY_UPTIME_MS = 5 * 60 * 1000; // uptime past this clears crash-loop

// ---- PST timestamp helpers (match unilogDb ts "yyyy/mm/dd hh:mm:ss") ----
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
function pstCutoff(msAgo) {
  return pstStr(new Date(Date.now() - msAgo));
}

// ---- alert sink (dedup: only emit on state change, not every cycle) ----
const activeAlerts = new Map(); // key -> message
function emit(kind, level, message) {
  const line = `${pstStr()} [${level}] ${kind}: ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(ALERT_LOG_PATH, line + "\n");
  } catch {}
}
function raise(key, level, message) {
  if (activeAlerts.get(key) === message) return; // already active, unchanged
  activeAlerts.set(key, message);
  emit("ALERT", level, `[${key}] ${message}`);
}
function clear(key) {
  if (!activeAlerts.has(key)) return;
  const was = activeAlerts.get(key);
  activeAlerts.delete(key);
  emit("RESOLVED", "info", `[${key}] cleared (was: ${was})`);
}

// ---- data sources ----
function pm2Status(name) {
  try {
    const out = cp.execSync("pm2 jlist", {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const proc = JSON.parse(out).find((p) => p.name === name);
    if (!proc) return { missing: true };
    return {
      status: proc.pm2_env?.status,
      restarts: proc.pm2_env?.restart_time ?? 0,
      uptimeMs: proc.pm2_env?.pm_uptime
        ? Date.now() - proc.pm2_env.pm_uptime
        : null,
    };
  } catch (e) {
    return { error: e.message };
  }
}

let db = null;
function getDb() {
  if (db) return db;
  try {
    db = new Database(UNILOG_DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 4000");
  } catch {
    db = null;
  }
  return db;
}

function heartbeatCountSince(cutoffPst) {
  const d = getDb();
  if (!d) return null;
  try {
    return d
      .prepare(
        `SELECT count(*) AS n FROM log_events
          WHERE pid = 'tv-srvr' AND message LIKE 'hb %' AND ts > ?`,
      )
      .get(cutoffPst).n;
  } catch {
    return null;
  }
}
function lastHeartbeatTs() {
  const d = getDb();
  if (!d) return null;
  try {
    return (
      d
        .prepare(
          `SELECT ts FROM log_events
            WHERE pid = 'tv-srvr' AND message LIKE 'hb %'
            ORDER BY id DESC LIMIT 1`,
        )
        .get()?.ts || null
    );
  } catch {
    return null;
  }
}
function errorCountSince(cutoffPst) {
  const d = getDb();
  if (!d) return null;
  try {
    return d
      .prepare(
        `SELECT count(*) AS n FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
          WHERE s.level = 'error' AND e.ts > ?`,
      )
      .get(cutoffPst).n;
  } catch {
    return null;
  }
}
function topErrorSites(cutoffPst, limit = 5) {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(
        `SELECT s.log_id, s.src_file, s.src_line, count(*) AS n
           FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
          WHERE s.level = 'error' AND e.ts > ?
          GROUP BY s.log_id ORDER BY n DESC LIMIT ?`,
      )
      .all(cutoffPst, limit);
  } catch {
    return [];
  }
}

// ---- checks ----
let lastRestarts = null;
function runChecks() {
  // 1 + 2. pm2 online + crash loop
  const p = pm2Status(PM2_TARGET);
  let srvrUptimeMs = null;
  if (p.missing) {
    raise("pm2", "critical", `${PM2_TARGET} not found in pm2`);
  } else if (p.error) {
    raise("pm2", "warn", `pm2 jlist failed: ${p.error}`);
  } else {
    srvrUptimeMs = p.uptimeMs;
    if (p.status !== "online")
      raise("pm2", "critical", `${PM2_TARGET} status=${p.status}`);
    else clear("pm2");

    if (lastRestarts != null && p.restarts - lastRestarts >= RESTART_SPIKE) {
      raise(
        "crash-loop",
        "critical",
        `${PM2_TARGET} restarted ${p.restarts - lastRestarts}x since last check (total ${p.restarts})`,
      );
    } else if (p.uptimeMs != null && p.uptimeMs > HEALTHY_UPTIME_MS) {
      clear("crash-loop");
    }
    lastRestarts = p.restarts;
  }

  // 3. heartbeat liveness (tier 1). Skip while the server is too young to have
  // emitted its first beat yet (avoids a false alarm right after a restart).
  const serverTooYoung =
    srvrUptimeMs != null && srvrUptimeMs < HEARTBEAT_MAX_AGE_MS;
  const hb = heartbeatCountSince(pstCutoff(HEARTBEAT_MAX_AGE_MS));
  if (hb === null) {
    raise("db", "warn", `cannot read unilog DB (${UNILOG_DB_PATH})`);
  } else {
    clear("db");
    if (hb === 0 && !serverTooYoung) {
      raise(
        "heartbeat",
        "critical",
        `no tv-srvr heartbeat in ${HEARTBEAT_MAX_AGE_MS / 60000}m (last: ${lastHeartbeatTs() || "never"})`,
      );
    } else {
      clear("heartbeat");
    }
  }

  // 4. error-rate (tier 2)
  const errs = errorCountSince(pstCutoff(ERROR_WINDOW_MS));
  if (errs != null) {
    if (errs > ERROR_COUNT_WARN) {
      const top = topErrorSites(pstCutoff(ERROR_WINDOW_MS))
        .map((r) => `${r.src_file}:${r.src_line}(id${r.log_id})x${r.n}`)
        .join(", ");
      raise(
        "error-rate",
        "warn",
        `${errs} error events in last ${ERROR_WINDOW_MS / 60000}m — top: ${top}`,
      );
    } else {
      clear("error-rate");
    }
  }
}

console.log(
  `${pstStr()} [info] tv-watchdog started — every ${CHECK_INTERVAL_MS / 1000}s, db ${UNILOG_DB_PATH}`,
);
runChecks();
setInterval(runChecks, CHECK_INTERVAL_MS);
