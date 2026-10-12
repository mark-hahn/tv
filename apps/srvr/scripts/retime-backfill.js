// Retime backfill driver: gives every unwatched library video that has an
// .asr.srt its retime pass (subPrepare.js: one other subtitle file fitted to
// the .asr.srt), one video at a time through tv-srvr's sub queue, from outside
// tv-srvr, so a deploy's restart of tv-srvr only pauses it. A watched episode
// is never touched. tv-srvr does every write.
//
//   cd /root/dev/apps/tv/apps/srvr
//   nohup node scripts/retime-backfill.js > /tmp/retime-backfill.log 2>&1 &
//
// Shows go most recently played first; within a show, the unwatched episodes
// in season and episode order, specials last. A video that already has a
// retimes row, or whose episode is watched or can't be found, is skipped. The
// run pauses while OpenSubtitles reports fewer than QUOTA_FLOOR downloads left
// for the day, and stops when more than FAIL_STOP_SHARE of its entries fail.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SRVR_URL = "http://127.0.0.1:8739/api";
const TV_DIR = "/mnt/media/tv";
const TVDB_DB = "/root/dev/apps/tv/apps/srvr/data/tvdb.db";
const SUBS_DB = "/root/dev/apps/tv/apps/srvr/data/subs.db";
// Between looks at the sub queue while an entry runs.
const POLL_MS = 2000;
// Between tries while tv-srvr is down.
const RETRY_MS = 10000;
// Downloads to leave OpenSubtitles' day for plays; checked every hour while
// under it.
const QUOTA_FLOOR = 200;
const QUOTA_WAIT_MS = 60 * 60 * 1000;
const FAIL_STOP_SHARE = 0.1;
const VIDEO_EXTS = new Set(["mkv", "mp4", "avi", "m4v", "ts", "webm", "mov", "wmv", "mpg", "mpeg", "m2ts", "divx"]);

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// PST "MM-DD HH:mm".
function stamp() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.month}-${parts.day} ${hour}:${parts.minute}`;
}

const log = (msg) => console.log(`${stamp()} ${msg}`);

// Waits out a tv-srvr restart: tries again until tv-srvr answers.
async function call(route, options) {
  for (;;) {
    try {
      const res = await fetch(`${SRVR_URL}/${route}`, options);
      return { status: res.status, body: await res.json() };
    } catch (e) {
      log(`tv-srvr unreachable (${e.cause?.code ?? e.message}), trying again`);
      await sleep(RETRY_MS);
    }
  }
}

// tvdb.db and subs.db, read only: tv-srvr is their only writer.
const tvdb = new Database(TVDB_DB, { readonly: true });
const subsDb = new Database(SUBS_DB, { readonly: true });
const showRows = tvdb.prepare(`SELECT name, json FROM shows`);
const retimeRow = subsDb.prepare(`SELECT file FROM retimes WHERE video = ?`);
const goodChecks = subsDb.prepare(
  `SELECT file, size, mtimeMs FROM checks WHERE video = ? AND verdict = 'good'`,
);

// Whether a file of the video other than its .asr.srt is checked good now
// (the check holds while the file keeps its size and mtime): such a video
// needs nothing.
function alreadyFine(video) {
  return goodChecks.all(video).some((c) => {
    if (c.file.endsWith(".asr.srt")) return false;
    const st = fs.statSync(c.file, { throwIfNoEntry: false });
    return !!st && st.size === c.size && Math.round(st.mtimeMs) === c.mtimeMs;
  });
}

// The type letter of a sidecar file of the video: T, H, V, S or +.
function typeOf(video, file) {
  const suffix = file.slice(path.basename(video).replace(/\.[^.]+$/, "").length + 1, -".srt".length);
  if (/^(T|mb)\d+$/.test(suffix)) return "T";
  if (/^H\d+$/.test(suffix)) return "H";
  if (/^opn/.test(suffix)) return "V";
  if (suffix === "asr") return "+";
  return "S";
}

// Every library show's record, keyed by its folder name.
function recordsByFolder() {
  const byFolder = new Map();
  for (const { name, json } of showRows.all()) {
    const rec = JSON.parse(json);
    if (!rec.inLibrary) continue;
    byFolder.set(String(rec.path || name).split("/").pop(), rec);
  }
  return byFolder;
}

// The episode record of a video by its name, else by its SxxEyy, or null.
function episodeOf(rec, videoName) {
  const stem = videoName.replace(/\.[^.]+$/, "");
  const ed = rec.episodeData || [];
  for (let s = 0; s < ed.length; s++)
    for (let i = 0; i < (ed[s] || []).length; i++) {
      const ep = ed[s][i];
      if (ep?.file && ep.file.replace(/\.[^.]+$/, "") === stem)
        return { season: s, episode: i + 1, ep };
    }
  const m = stem.match(/S(\d{1,2})E(\d{1,3})/i);
  if (!m) return null;
  const ep = ed[+m[1]]?.[+m[2] - 1];
  return ep ? { season: +m[1], episode: +m[2], ep } : null;
}

// The videos to do: [{video, show, season, episode}], most recently played
// shows first, each show's in season and episode order with specials last.
function candidates() {
  const byFolder = recordsByFolder();
  const shows = [];
  for (const folder of fs.readdirSync(TV_DIR)) {
    const rec = byFolder.get(folder);
    if (!rec) continue;
    const items = [];
    let seasons;
    try {
      seasons = fs.readdirSync(path.join(TV_DIR, folder));
    } catch {
      continue;
    }
    for (const season of seasons) {
      const dir = path.join(TV_DIR, folder, season);
      let files;
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!VIDEO_EXTS.has(f.split(".").pop().toLowerCase())) continue;
        const stem = f.replace(/\.[^.]+$/, "");
        if (!files.includes(`${stem}.asr.srt`)) continue;
        const found = episodeOf(rec, f);
        if (!found) {
          items.push({ video: path.join(dir, f), show: rec.name, unmatched: true });
          continue;
        }
        items.push({ video: path.join(dir, f), show: rec.name, season: found.season, episode: found.episode });
      }
    }
    items.sort(
      (a, b) =>
        (a.season === 0) - (b.season === 0) || a.season - b.season || a.episode - b.episode,
    );
    shows.push({ rec, items });
  }
  shows.sort((a, b) => String(b.rec.lastPlayedDate || "").localeCompare(String(a.rec.lastPlayedDate || "")));
  return shows.flatMap((s) => s.items);
}

// Whether the episode is watched now, read afresh: one watched during the run
// is skipped too.
function watchedNow(item) {
  const rec = recordsByFolder().get(path.basename(path.dirname(path.dirname(item.video))));
  const found = rec && episodeOf(rec, path.basename(item.video));
  return !found || !!found.ep.watched;
}

// Resolves once the sub queue holds no entry for the video.
async function waitDone(video) {
  for (;;) {
    await sleep(POLL_MS);
    const { body } = await call("queues");
    const entries = body?.sub?.entries ?? [];
    const inflight = body?.sub?.inflight;
    if (!entries.some((e) => e.path === video) && inflight?.file !== path.basename(video)) return;
  }
}

async function waitQuota() {
  for (;;) {
    const { body } = await call("subsQuota");
    if (!body || body.remaining >= QUOTA_FLOOR) return;
    log(`OpenSubtitles has ${body.remaining} downloads left today, waiting an hour`);
    await sleep(QUOTA_WAIT_MS);
  }
}

async function main() {
  const items = candidates();
  const counts = { total: items.length, watched: 0, unmatched: 0, done: 0, fine: 0, retimed: {}, nothing: 0, errors: 0 };
  log(`${items.length} videos with an .asr.srt in the library`);
  for (const [i, item] of items.entries()) {
    if (item.unmatched) {
      counts.unmatched++;
      continue;
    }
    if (watchedNow(item)) {
      counts.watched++;
      continue;
    }
    if (retimeRow.get(item.video)) {
      counts.done++;
      continue;
    }
    if (alreadyFine(item.video)) {
      counts.fine++;
      continue;
    }
    await waitQuota();
    const { status, body } = await call("asr/subs/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoPaths: [item.video], lowPriority: true, retime: true }),
    });
    if (status !== 200) {
      counts.errors++;
      log(`${item.show} S${item.season}E${item.episode}: enqueue failed ${status} ${JSON.stringify(body)}`);
    } else {
      await waitDone(item.video);
      const row = retimeRow.get(item.video);
      if (!row) {
        counts.errors++;
        log(`${item.show} S${item.season}E${item.episode}: no retime outcome stored`);
      } else if (row.file) {
        const type = typeOf(item.video, row.file);
        counts.retimed[type] = (counts.retimed[type] || 0) + 1;
        log(`${item.show} S${item.season}E${item.episode}: ${row.file}`);
      } else {
        counts.nothing++;
        log(`${item.show} S${item.season}E${item.episode}: nothing fits`);
      }
    }
    const tried = counts.errors + counts.nothing + Object.values(counts.retimed).reduce((a, b) => a + b, 0);
    if (tried >= 20 && counts.errors > FAIL_STOP_SHARE * tried) {
      log(`stopping: ${counts.errors} of ${tried} entries failed`);
      break;
    }
    if ((i + 1) % 50 === 0) log(`progress ${i + 1}/${items.length}: ${JSON.stringify(counts)}`);
  }
  log(`done: ${JSON.stringify(counts)}`);
}

main().catch((e) => {
  log(`failed: ${e.stack || e}`);
  process.exit(1);
});
