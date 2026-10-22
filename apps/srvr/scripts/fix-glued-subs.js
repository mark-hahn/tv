// Glued words driver: has tv-srvr split the glued words in the subtitle files
// of every library show's videos (/api/fixGluedSubs, subGlue.js), show by
// show, from outside tv-srvr, so a deploy's restart of tv-srvr only pauses
// it. tv-srvr does every write and keeps each file's check current. With
// --dry nothing is written, and the log says what would be split.
//
//   cd /root/dev/apps/tv/apps/srvr
//   nohup node scripts/fix-glued-subs.js [--dry] > /tmp/fix-glued-subs.log 2>&1 &

import Database from "better-sqlite3";

const SRVR_URL = "http://127.0.0.1:8739/api";
const TVDB_DB = "/root/dev/apps/tv/apps/srvr/data/tvdb.db";
// Between tries while tv-srvr is down.
const RETRY_MS = 10000;

const DRY = process.argv.includes("--dry");

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
async function call(route) {
  for (;;) {
    try {
      const res = await fetch(`${SRVR_URL}/${route}`);
      return { status: res.status, body: await res.json() };
    } catch (e) {
      log(`tv-srvr unreachable (${e.cause?.code ?? e.message}), trying again`);
      await sleep(RETRY_MS);
    }
  }
}

// tvdb.db read only: tv-srvr is its only writer.
const tvdb = new Database(TVDB_DB, { readonly: true });
const shows = tvdb
  .prepare(`SELECT name, json FROM shows`)
  .all()
  .filter(({ json }) => JSON.parse(json).inLibrary)
  .map(({ name }) => name);

async function main() {
  const counts = { shows: shows.length, videos: 0, files: 0, words: 0, confirmed: 0, errors: 0 };
  log(`${shows.length} library shows${DRY ? ", dry run" : ""}`);
  for (const [i, name] of shows.entries()) {
    const { status, body } = await call(
      `fixGluedSubs?showName=${encodeURIComponent(name)}${DRY ? "&dryRun=1" : ""}`,
    );
    if (status !== 200) {
      counts.errors++;
      log(`${name}: failed ${status} ${JSON.stringify(body)}`);
    } else {
      counts.videos += body.videos;
      for (const { file, fixes } of body.files) {
        counts.files++;
        counts.words += fixes.length;
        counts.confirmed += fixes.filter((x) => x.confirmed).length;
        const list = fixes.map((x) => `${x.from} → ${x.to}${x.confirmed ? " (sib)" : ""}`);
        log(`${name}: ${file}: ${list.join(", ")}`);
      }
    }
    if ((i + 1) % 50 === 0) log(`progress ${i + 1}/${shows.length}: ${JSON.stringify(counts)}`);
  }
  log(`done: ${JSON.stringify(counts)}`);
}

main().catch((e) => {
  log(`failed: ${e.stack || e}`);
  process.exit(1);
});
