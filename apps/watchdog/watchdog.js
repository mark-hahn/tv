// tv-watchdog — an independent background monitor (pm2 task: tv-watchdog).
//
// It reads the unilog SQLite DB and pm2's process status, and raises
// tier-1 (liveness) + tier-2 (error-rate) alerts to its OWN log stream and a
// persistent alert file, plus emails error summaries (throttled, deduped). It
// shares no code with tv-srvr, so a bug in tv-srvr cannot take the watchdog
// down with it. Its ONLY write to the app DB is stamping log_sites.blocked_until
// when an error burst blocks a site (tv-srvr enforces the block on insert).
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
const { MailtrapClient } = require("mailtrap");

// ---- config (hard-wired constants, no env vars per repo convention) ----
const UNILOG_DB_PATH = "/root/dev/apps/tv/unilog/unilog.sqlite";
const ALERT_LOG_PATH = "/root/dev/apps/tv/unilog/watchdog-alerts.log";
const PM2_TARGET = "tv-srvr";

const CHECK_INTERVAL_MS = 60 * 1000; // run all checks every 60s
const HEARTBEAT_MAX_AGE_MS = 6 * 60 * 1000; // no "hb" event in 6m => stuck/dead
const ERROR_COUNT_WARN = 30; // > this many error events in one clock hour => warn
const EMAIL_MIN_INTERVAL_MS = 60 * 60 * 1000; // at most one error email per hour
const BURST_COUNT = 5; // more than this many errors ...
const BURST_WINDOW_MS = 5 * 1000; // ... within this span => burst
const BURST_BLOCK_MS = 60 * 60 * 1000; // burst blocks the emitting site(s) 1h
const MAILTRAP_TOKEN_PATH =
  "/root/dev/apps/tv/apps/watchdog/mailtrap-token.txt";
const RESTART_SPIKE = 3; // >= this many restarts between cycles => crash loop
const HEALTHY_UPTIME_MS = 5 * 60 * 1000; // uptime past this clears crash-loop
// Sites that email the moment they fire, instead of waiting for the throttled
// hourly error digest. For a site that means "the app is silently doing double
// work", an hour-late digest is too late to be useful.
//   1455 - client srvr.js: stacked HMR instances (a side effect escaped teardown)
const WATCH_SITES = [1455];
const WATCH_EMAIL_MIN_INTERVAL_MS = 10 * 60 * 1000; // per-site email throttle
// Tier-3 "stuck queue" detection from the heartbeat's queue depths + the
// monotonic completion counters (subDone/asrDone). A queue is stuck if its
// depth stays > 0 across the whole window while its completion counter never
// advances. Windows differ because a single ASR job legitimately runs for many
// minutes, while a sub-extraction item should finish quickly. Heartbeat cadence
// is ~2 min, so N beats ≈ 2N minutes.
const SUB_STUCK_BEATS = 4; // ~8m: subQ>0 & subDone flat => stuck
const ASR_STUCK_BEATS = 20; // ~40m: asrQ>0 & asrDone flat => stuck
const SWEEP_STUCK_BEATS = 12; // ~24m: sweep=1 the whole time => stuck
const HB_CADENCE_MIN = 2; // tv-srvr emits one heartbeat every 2 minutes

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

// ---- email (mailtrap, same pattern as bkupall/mailer.js) ----
const MAIL_TOKEN = fs.readFileSync(MAILTRAP_TOKEN_PATH, "utf8").trim();
const mailClient = new MailtrapClient({
  endpoint: "https://send.api.mailtrap.io/",
  token: MAIL_TOKEN,
});
async function sendMail(subject, text) {
  try {
    await mailClient.send({
      from: { email: "mark@hahnca.com", name: "tv-watchdog" },
      to: [{ email: "mark@hahnca.com" }],
      subject,
      text: text || subject,
      category: "tv-watchdog",
    });
    emit("EMAIL", "info", `sent: ${subject}`);
  } catch (err) {
    emit("EMAIL", "warn", `send failed: ${err.message}`);
  }
}

// ---- alert sink ----
// Dedup ignores dates/timestamps/counts: every digit run is stripped before
// comparing, so "49 error events ... x49" and "45 error events ... x45" are the
// SAME alert and neither the alert log nor the pm2 out log gets re-emissions.
function stripNums(s) {
  return String(s).replace(/\d+/g, "#");
}
const activeAlerts = new Map(); // key -> { skel, message }
function emit(kind, level, message) {
  const line = `${pstStr()} [${level}] ${kind}: ${message}`;
  // stdout.write, NOT console.log: the deploy reconciler upgrades console.*
  // into unilog(), and the watchdog's own alert stream must stay independent
  // of unilog (no sink registered here — it would silently drop the line).
  process.stdout.write(line + "\n");
  try {
    fs.appendFileSync(ALERT_LOG_PATH, line + "\n");
  } catch {}
}
function raise(key, level, message) {
  const skel = stripNums(message);
  if (activeAlerts.get(key)?.skel === skel) return; // dupe (numbers ignored)
  activeAlerts.set(key, { skel, message });
  emit("ALERT", level, `[${key}] ${message}`);
}
function clear(key) {
  const was = activeAlerts.get(key);
  if (!was) return;
  activeAlerts.delete(key);
  emit("RESOLVED", "info", `[${key}] cleared (was: ${was.message})`);
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
function maxEventId() {
  const d = getDb();
  if (!d) return null;
  try {
    return d.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM log_events").get()
      .m;
  } catch {
    return null;
  }
}
// Error-level events newer than afterId, oldest first, joined with their site.
function errorEventsAfter(afterId) {
  const d = getDb();
  if (!d) return null;
  try {
    return d
      .prepare(
        `SELECT e.id, e.ts, e.message, s.log_id, s.src_file, s.src_line
           FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
          WHERE s.level = 'error' AND e.id > ?
          ORDER BY e.id`,
      )
      .all(afterId);
  } catch {
    return null;
  }
}

// Events from the WATCH_SITES list newer than afterId, oldest first.
function watchedEventsAfter(afterId, siteIds) {
  const d = getDb();
  if (!d) return null;
  try {
    const marks = siteIds.map(() => "?").join(",");
    return d
      .prepare(
        `SELECT e.id, e.ts, e.message, s.log_id, s.src_file, s.src_line
           FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
          WHERE s.log_id IN (${marks}) AND e.id > ?
          ORDER BY e.id`,
      )
      .all(...siteIds, afterId);
  } catch {
    return null;
  }
}

// The most recent `limit` heartbeats, newest first, each parsed into a
// { subQ, chkQ, asrQ, bif, renc, flex, sweep, clients, subDone, asrDone } map.
function recentHeartbeats(limit) {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d
      .prepare(
        `SELECT message FROM log_events
          WHERE pid = 'tv-srvr' AND message LIKE 'hb %'
          ORDER BY id DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map((r) => {
      const o = {};
      for (const m of r.message.matchAll(/(\w+)=(-?\d+)/g))
        o[m[1]] = Number(m[2]);
      return o;
    });
  } catch {
    return [];
  }
}

// ---- error stream: hourly tally, burst block, deduped + throttled email ----
// A cursor (last processed log_events.id) makes every error event count exactly
// once: hourly tallies never overlap, and no error is reported in two hours.
let errorCursor = null; // last log_events.id already processed
let hourKey = null; // PST "yyyy/mm/dd hh" the running tally belongs to
let hourTally = 0; // error events seen in that hour
let hourSites = new Map(); // log_id -> { file, line, n }
const pendingErrors = new Map(); // stripped msg -> {count,sites,example,firstTs,lastTs,firstId,lastId}
let lastEmailMs = 0; // last email send time (1/hour throttle)

// Epoch ms from a PST "yyyy/mm/dd hh:mm:ss" string. Parsed with a fixed UTC
// suffix — absolute value is offset, but diffs between two stamps are correct.
function tsToMs(ts) {
  return Date.parse(ts.replace(/\//g, "-").replace(" ", "T") + "Z");
}

// Sites with more than BURST_COUNT error events inside one BURST_WINDOW_MS
// span. Runs over all new events together; every site appearing in an
// offending window is returned (log_id -> "file:line, site: N" label).
function burstSites(events) {
  const out = new Map();
  const evs = events
    .map((e) => ({ ...e, ms: tsToMs(e.ts) }))
    .sort((a, b) => a.ms - b.ms);
  for (let i = 0; i + BURST_COUNT < evs.length; i++) {
    if (evs[i + BURST_COUNT].ms - evs[i].ms <= BURST_WINDOW_MS) {
      for (let j = i; j <= i + BURST_COUNT; j++)
        out.set(
          evs[j].log_id,
          `${evs[j].src_file}:${evs[j].src_line}, site: ${evs[j].log_id}`,
        );
    }
  }
  return out;
}

// The watchdog's ONLY app-DB write: stamp log_sites.blocked_until so tv-srvr
// drops the site's events until the stamp expires. Short-lived rw connection.
function blockSites(logIds, untilPst) {
  let wdb = null;
  try {
    wdb = new Database(UNILOG_DB_PATH);
    wdb.pragma("busy_timeout = 4000");
    const upd = wdb.prepare(
      "UPDATE log_sites SET blocked_until = ? WHERE log_id = ?",
    );
    for (const id of logIds) upd.run(untilPst, id);
    return true;
  } catch (e) {
    emit("ALERT", "warn", `[burst-block] block write failed: ${e.message}`);
    return false;
  } finally {
    try {
      wdb?.close();
    } catch {}
  }
}

// Send everything accumulated since the last email, then reset the throttle.
// burstLabels (array) switches to the burst subject + blocked-sites section.
async function flushEmail(burstLabels) {
  let total = 0;
  const lines = [];
  for (const e of pendingErrors.values()) {
    total += e.count;
    lines.push(
      `${e.count}x ${[...e.sites].join(", ")}, event: ${e.firstId}${e.count > 1 ? ` ... ${e.lastId}` : ""}`,
    );
    lines.push(`   ${e.firstTs}${e.count > 1 ? ` ... ${e.lastTs}` : ""}`);
    lines.push(`   ${e.example}`);
    lines.push("");
  }
  let subject;
  if (burstLabels) {
    subject = `tv-watchdog: error burst — blocked ${burstLabels.length} site(s) for 1h`;
    lines.push(
      `blocked for 1h (> ${BURST_COUNT} errors in ${BURST_WINDOW_MS / 1000}s):`,
    );
    for (const l of burstLabels) lines.push(`   ${l}`);
  } else {
    subject = `tv-watchdog: ${total} error event(s), ${pendingErrors.size} unique`;
  }
  pendingErrors.clear();
  lastEmailMs = Date.now();
  await sendMail(subject, lines.join("\n"));
}

// Watched sites email immediately (own cursor + own per-site throttle, so this
// is independent of the hourly error digest and its throttle).
let watchCursor = null;
const watchLastEmailMs = new Map(); // log_id -> last email ms

async function checkWatchedSites() {
  const max = maxEventId();
  if (max == null) return;
  if (watchCursor == null) {
    watchCursor = max; // first run: only report firings from now on
    return;
  }
  const events = watchedEventsAfter(watchCursor, WATCH_SITES);
  if (events == null) return;
  watchCursor = max;
  if (events.length === 0) return;

  const bySite = new Map();
  for (const ev of events) {
    const g = bySite.get(ev.log_id) || { count: 0, first: ev, last: ev };
    g.count++;
    g.last = ev;
    bySite.set(ev.log_id, g);
  }

  for (const [logId, g] of bySite) {
    const where = `${g.first.src_file}:${g.first.src_line}`;
    raise(
      `watch-site-${logId}`,
      "warn",
      `site ${logId} fired ${g.count}x at ${where}: ${g.last.message}`,
    );
    const last = watchLastEmailMs.get(logId) || 0;
    if (Date.now() - last < WATCH_EMAIL_MIN_INTERVAL_MS) continue;
    watchLastEmailMs.set(logId, Date.now());
    await sendMail(
      `tv-watchdog: site ${logId} fired (${where})`,
      [
        `site ${logId} fired ${g.count}x`,
        `${where}`,
        "",
        `first: ${g.first.ts}  event ${g.first.id}`,
        `last:  ${g.last.ts}  event ${g.last.id}`,
        "",
        g.last.message,
      ].join("\n"),
    );
  }
}

async function checkErrors() {
  const max = maxEventId();
  if (max == null) return; // db unreadable — the "db" alert already covers it
  if (errorCursor == null) {
    errorCursor = max; // first run: only report errors from now on
    return;
  }
  const events = errorEventsAfter(errorCursor);
  if (events == null) return;
  errorCursor = max;

  // non-overlapping hourly tally -> error-rate alert
  const hk = pstStr().slice(0, 13);
  if (hk !== hourKey) {
    hourKey = hk;
    hourTally = 0;
    hourSites = new Map();
  }
  hourTally += events.length;
  for (const ev of events) {
    const s = hourSites.get(ev.log_id) || {
      file: ev.src_file,
      line: ev.src_line,
      n: 0,
    };
    s.n++;
    hourSites.set(ev.log_id, s);
  }
  if (hourTally > ERROR_COUNT_WARN) {
    const top = [...hourSites.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 5)
      .map(([id, s]) => `${s.file}:${s.line}(id${id})x${s.n}`)
      .join(", ");
    raise(
      "error-rate",
      "warn",
      `${hourTally} error events in hour ${hourKey} — top: ${top}`,
    );
  } else {
    clear("error-rate");
  }

  // dedupe into the pending email queue (numbers/timestamps stripped)
  for (const ev of events) {
    const key = stripNums(ev.message);
    const e = pendingErrors.get(key) || {
      count: 0,
      sites: new Set(),
      example: ev.message,
      firstTs: ev.ts,
      lastTs: ev.ts,
      firstId: ev.id,
      lastId: ev.id,
    };
    e.count++;
    e.lastTs = ev.ts;
    e.lastId = ev.id;
    e.sites.add(`${ev.src_file}:${ev.src_line}, site: ${ev.log_id}`);
    pendingErrors.set(key, e);
  }

  // burst: block the site(s) for 1h and email immediately — this bypasses the
  // hourly email throttle and restarts it.
  const bursts = burstSites(events);
  if (bursts.size > 0) {
    const until = pstStr(new Date(Date.now() + BURST_BLOCK_MS));
    // Never block a watched site: the burst IS the signal we want emailed, so
    // muting it for an hour would silence the alarm it is meant to raise.
    blockSites(
      [...bursts.keys()].filter((id) => !WATCH_SITES.includes(id)),
      until,
    );
    const labels = [...bursts.values()];
    emit(
      "ALERT",
      "warn",
      `[burst-block] blocked until ${until}: ${labels.join(", ")}`,
    );
    await flushEmail(labels);
    return;
  }

  // routine path: at most one email per hour, only when errors are pending
  if (
    pendingErrors.size > 0 &&
    Date.now() - lastEmailMs >= EMAIL_MIN_INTERVAL_MS
  ) {
    await flushEmail(null);
  }
}

// ---- checks ----
let lastRestarts = null;
async function runChecks() {
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

  // 4. error-rate (tier 2) + error emails: cursor-based, burst block, throttle
  await checkErrors();

  // 4b. watched sites (WATCH_SITES): email as soon as one fires
  await checkWatchedSites();

  // 5. stuck queues / stuck sweep (tier 3). Uses heartbeat queue depths plus
  // the monotonic subDone/asrDone completion counters. A restart resets the
  // counters to 0, so a post-restart window has newest < oldest and is never
  // mistaken for "flat" (no false positive).
  const beats = recentHeartbeats(ASR_STUCK_BEATS); // newest first
  const flat = (arr, key) =>
    arr.every((b) => Number.isFinite(b[key])) &&
    arr[0][key] === arr[arr.length - 1][key];

  const subBeats = beats.slice(0, SUB_STUCK_BEATS);
  if (
    subBeats.length === SUB_STUCK_BEATS &&
    subBeats.every((b) => b.subQ > 0) &&
    flat(subBeats, "subDone")
  ) {
    raise(
      "sub-queue-stuck",
      "warn",
      `sub queue stuck at ${subBeats[0].subQ}, no completions in ${SUB_STUCK_BEATS * HB_CADENCE_MIN}m`,
    );
  } else {
    clear("sub-queue-stuck");
  }

  const asrBeats = beats.slice(0, ASR_STUCK_BEATS);
  if (
    asrBeats.length === ASR_STUCK_BEATS &&
    asrBeats.every((b) => b.asrQ > 0) &&
    flat(asrBeats, "asrDone")
  ) {
    raise(
      "asr-queue-stuck",
      "warn",
      `asr queue stuck at ${asrBeats[0].asrQ}, no completions in ${ASR_STUCK_BEATS * HB_CADENCE_MIN}m`,
    );
  } else {
    clear("asr-queue-stuck");
  }

  const sweepBeats = beats.slice(0, SWEEP_STUCK_BEATS);
  if (
    sweepBeats.length === SWEEP_STUCK_BEATS &&
    sweepBeats.every((b) => b.sweep === 1)
  ) {
    raise(
      "sweep-stuck",
      "warn",
      `emby full sweep running for > ${SWEEP_STUCK_BEATS * HB_CADENCE_MIN}m`,
    );
  } else {
    clear("sweep-stuck");
  }
}

// stdout.write, NOT console.log — see emit() above.
process.stdout.write(
  `${pstStr()} [info] tv-watchdog started — every ${CHECK_INTERVAL_MS / 1000}s, db ${UNILOG_DB_PATH}\n`,
);
runChecks();
setInterval(runChecks, CHECK_INTERVAL_MS);
