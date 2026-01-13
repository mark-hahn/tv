#!/usr/bin/env node
'use strict';

// Self-check: observe persistence activity during downloads.
//
// tv-proc now persists downloads in SQLite (data/tv.sqlite). SQLite writes are
// implemented via a database file plus WAL/SHM sidecars, and multiple logical
// updates may coalesce into fewer filesystem events.
//
// This script polls:
// - http://127.0.0.1:3003/downloads
// - data/tv.sqlite (+ -wal/-shm) fs events/mtime
// and reports (best-effort) activity aligned with add/finish events.

const fs = require('fs');
const path = require('path');

const TV_DB_PATH = path.join(__dirname, '..', 'data', 'tv.sqlite');
const BASE_URL = process.env.TVPROC_URL || 'http://127.0.0.1:3003';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const idx = args.indexOf(name);
  if (idx === -1) return def;
  const v = args[idx + 1];
  if (v == null) return def;
  return v;
};

const seconds = Math.max(10, parseInt(getArg('--seconds', '60'), 10) || 60);
const intervalMs = Math.max(250, parseInt(getArg('--interval', '1000'), 10) || 1000);
const graceMs = Math.max(intervalMs * 2, parseInt(getArg('--grace', String(intervalMs * 3)), 10) || intervalMs * 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const statMtimeMs = () => {
  try {
    const st = fs.statSync(TV_DB_PATH);
    return st.mtimeMs;
  } catch {
    return null;
  }
};

const fetchJson = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt.slice(0, 200)}`);
  }
  return await res.json();
};

const postStartProc = async () => {
  try {
    await fetchJson(`${BASE_URL}/startProc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch (e) {
    // Non-fatal: script can still observe ongoing workers.
    console.error('[self-check] startProc failed:', e && e.message ? e.message : String(e));
  }
};

const indexByProcId = (arr) => {
  const m = new Map();
  for (const e of Array.isArray(arr) ? arr : []) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.procId !== 'number') continue;
    m.set(e.procId, e);
  }
  return m;
};

const isDownloading = (status) => status === 'downloading';

(async () => {
  console.log('[self-check] starting...');
  console.log(`[self-check] url=${BASE_URL} seconds=${seconds} intervalMs=${intervalMs} graceMs=${graceMs}`);

  await postStartProc();

  // Baseline snapshot: existing entries should not count as "add" events.
  let prevDownloads;
  try {
    prevDownloads = await fetchJson(`${BASE_URL}/downloads`);
  } catch {
    prevDownloads = [];
  }
  let prevIdx = indexByProcId(prevDownloads);
  let prevMtime = statMtimeMs();

  const now = () => Date.now();

  // Expected events that should cause a flush.
  const expected = []; // {type, at, details, matched}

  // Observe persistence activity via fs.watch.
  // Note: SQLite may write tv.sqlite, tv.sqlite-wal, and tv.sqlite-shm.
  const flushEvents = []; // {at, eventType}
  const unexpectedFlushes = []; // {at, eventType}
  const matchedFlushes = []; // {at, eventType, matchedTo}

  let watcher;
  try {
    const base = path.basename(TV_DB_PATH);
    const wal = base + '-wal';
    const shm = base + '-shm';
    watcher = fs.watch(path.dirname(TV_DB_PATH), { persistent: true }, (eventType, filename) => {
      if (!filename) return;
      const fn = String(filename);
      if (fn !== base && fn !== wal && fn !== shm) return;
      flushEvents.push({ at: Date.now(), eventType: String(eventType || '') });
    });
  } catch (e) {
    console.error('[self-check] fs.watch not available:', e && e.message ? e.message : String(e));
    watcher = null;
  }

  const start = now();
  const end = start + seconds * 1000;

  while (now() < end) {
    let downloads;
    try {
      downloads = await fetchJson(`${BASE_URL}/downloads`);
    } catch (e) {
      console.error('[self-check] downloads fetch failed:', e && e.message ? e.message : String(e));
      await sleep(intervalMs);
      continue;
    }

    const idx = indexByProcId(downloads);

    // Detect add events (new procId).
    for (const [procId, e] of idx.entries()) {
      if (!prevIdx.has(procId)) {
        expected.push({
          type: 'add',
          at: now(),
          details: { procId, title: e.title, status: e.status },
        });
      }
    }

    // Detect finish events (downloading -> non-downloading).
    for (const [procId, prevE] of prevIdx.entries()) {
      const curE = idx.get(procId);
      if (!curE) continue;
      if (isDownloading(prevE.status) && !isDownloading(curE.status)) {
        expected.push({
          type: 'finish',
          at: now(),
          details: { procId, from: prevE.status, to: curE.status, title: curE.title },
        });
      }
    }

    // Keep mtime for informational purposes only.
    prevMtime = statMtimeMs();

    prevIdx = idx;

    await sleep(intervalMs);
  }

  // Stop watcher.
  try {
    if (watcher) watcher.close();
  } catch {}

  // Match flush events to expected add/finish events.
  for (const fe of flushEvents) {
    const windowStart = fe.at - graceMs;
    const windowEnd = fe.at + graceMs;
    let matchedTo = null;
    for (const ev of expected) {
      if (ev.matched) continue;
      if (ev.at >= windowStart && ev.at <= windowEnd) {
        ev.matched = true;
        matchedTo = { type: ev.type, at: ev.at, details: ev.details };
        break;
      }
    }
    if (matchedTo) {
      matchedFlushes.push({ at: fe.at, eventType: fe.eventType, matchedTo });
    } else {
      unexpectedFlushes.push({ at: fe.at, eventType: fe.eventType });
    }
  }

  const totalExpected = expected.length;
  const matchedExpected = expected.filter((e) => e.matched).length;

  console.log('');
  console.log('[self-check] results');
  console.log(JSON.stringify({
    expectedEvents: totalExpected,
    matchedExpectedEvents: matchedExpected,
    flushEventsSeen: flushEvents.length,
    unexpectedFlushes: unexpectedFlushes.length,
  }, null, 2));

  // Note: we do not strictly assert that every expected event had a distinct observed flush,
  // because polling/FS watcher timing can coalesce multiple writes.

  if (unexpectedFlushes.length) {
    console.log('');
    console.log('[self-check] unexpected sqlite file events (first 5)');
    for (const u of unexpectedFlushes.slice(0, 5)) {
      console.log(JSON.stringify(u, null, 2));
    }
  }

  process.exit(0);
})().catch((e) => {
  console.error('[self-check] fatal:', e && e.stack ? e.stack : String(e));
  process.exit(1);
});
