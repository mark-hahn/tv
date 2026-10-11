// Episode backfill driver: refreshes every show's episodes from TVDB through
// tv-srvr, one show at a time, from outside tv-srvr -- so a deploy's restart of
// tv-srvr only pauses it. Each refresh also reads the TVDB tags of the show's
// season 0 entries and sorts them into counted specials and extras, which makes
// this the marking backfill of epi-0.md too. A show whose request is cut off
// because tv-srvr is down is asked for again once tv-srvr is back. tv-srvr
// does the writing, as the single writer of tvdb.db.
//
//   cd /root/dev/apps/tv/apps/srvr
//   nohup node scripts/episode-backfill.js [startIndex] > /tmp/episode-backfill.log 2>&1 &
//
// Library shows go first, then the rest, each in name order. startIndex
// (default 0) starts part way through that order, at the index a progress line
// last reported.

const SRVR_URL = "http://127.0.0.1:8739/api";
// Between shows, to pace TVDB.
const GAP_MS = 2000;
// Between tries while tv-srvr is down.
const RETRY_MS = 10000;
const PROGRESS_EVERY = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
async function call(path, options) {
  for (;;) {
    try {
      const res = await fetch(`${SRVR_URL}/${path}`, options);
      return { status: res.status, body: await res.json() };
    } catch (e) {
      log(`tv-srvr unreachable (${e.cause?.code ?? e.message}), trying again`);
      await sleep(RETRY_MS);
    }
  }
}

async function main() {
  const start = Number(process.argv[2] ?? 0);
  const { body: allTvdb } = await call("getAllTvdb?hasLibrary=0");
  const names = Object.keys(allTvdb).sort(
    (a, b) =>
      (allTvdb[b].inLibrary === true) - (allTvdb[a].inLibrary === true) ||
      a.localeCompare(b),
  );
  log(`${names.length} shows, starting at ${start}`);
  let changed = 0;
  let failed = 0;
  for (let i = start; i < names.length; i++) {
    const { status, body } = await call("backfillShowEpisodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: names[i] }),
    });
    if (status !== 200 || !body.ok) {
      failed++;
      log(`${i} ${names[i]} failed: ${body.error ?? status}`);
    } else if (body.changed) changed++;
    if ((i + 1) % PROGRESS_EVERY === 0)
      log(`${i + 1} of ${names.length}, ${changed} changed, ${failed} failed`);
    await sleep(GAP_MS);
  }
  log(`done: ${names.length - start} shows, ${changed} changed, ${failed} failed`);
}

await main();
