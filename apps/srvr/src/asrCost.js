// asrCost — Speechmatics audio hours per Los Angeles day, for the ASR pane's
// Cost chart. Speechmatics' usage API only counts whole UTC days and its job
// list only reaches back about 7 days, so every finished job it lists is kept
// here, synced every 6 hours and before each chart load. The record is whole
// from the UTC day after the first kept job's; jobs before that are counted
// by the usage API's UTC day under the same date, so each job counts once.

import * as path from "node:path";
import fsp from "fs/promises";
import Database from "better-sqlite3";
import { logHere, unilog} from "@tv/share"
import { SRVR_DATA_DIR } from "./srvrPaths.js";

const ASR_JOBS_DB_PATH = path.join(SRVR_DATA_DIR, "asrjobs.db");
const SM_KEY_PATH = "/root/dev/apps/tv/apps/asr/secrets/speechmatics-key.txt";
const SM_API = "https://asr.api.speechmatics.com/v2";
const SM_JOBS_PAGE = 100;
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const db = new Database(ASR_JOBS_DB_PATH);
db.pragma("journal_mode = WAL");
// created is Speechmatics' created_at, an ISO UTC string.
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, created TEXT NOT NULL, durSec INTEGER NOT NULL
  );
`);
const insertJob = db.prepare(
  `INSERT OR IGNORE INTO jobs (id, created, durSec) VALUES (?, ?, ?)`,
);
const firstJob = db.prepare(`SELECT MIN(created) created FROM jobs`);
const jobsBetween = db.prepare(
  `SELECT created, durSec FROM jobs WHERE created >= ? AND created < ?`,
);

const laDate = (iso) =>
  new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });

const smKey = async () => (await fsp.readFile(SM_KEY_PATH, "utf8")).trim();

// Every job Speechmatics still lists, newest first, a page at a time.
// created_before is inclusive, so a page repeats the last one's oldest job.
async function syncJobs() {
  const headers = { Authorization: `Bearer ${await smKey()}` };
  let before = null;
  for (;;) {
    const r = await fetch(
      `${SM_API}/jobs?limit=${SM_JOBS_PAGE}` +
        (before ? `&created_before=${before}` : ""),
      { headers },
    );
    if (!r.ok) throw new Error(`speechmatics jobs: ${r.status}`);
    const { jobs } = await r.json();
    for (const j of jobs)
      if (j.status === "done") insertJob.run(j.id, j.created_at, j.duration);
    if (jobs.length < SM_JOBS_PAGE) return;
    before = jobs.at(-1).created_at;
  }
}

setInterval(
  () =>
    syncJobs().catch((e) =>
      unilog(2775, `asr jobs sync failed: ${e.message}`),
    ),
  SYNC_INTERVAL_MS,
);

// Audio hours for each day of an LA month ("yyyy-mm").
export async function monthHrs(month) {
  await syncJobs();
  const [y, m] = month.split("-").map(Number);
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const hrs = new Array(nDays).fill(0);
  const first = firstJob.get().created;
  // the record's first whole UTC day ("yyyy-mm-dd")
  const cut = first
    ? new Date(Date.parse(first.slice(0, 10)) + DAY_MS)
        .toISOString()
        .slice(0, 10)
    : null;
  if (cut) {
    // a day's margin each side covers the LA month's UTC offset
    const lo = new Date(Date.UTC(y, m - 1, 1) - DAY_MS).toISOString();
    const hi = new Date(Date.UTC(y, m, 1) + DAY_MS).toISOString();
    for (const { created, durSec } of jobsBetween.all(cut > lo ? cut : lo, hi)) {
      const day = laDate(created);
      if (day.startsWith(month)) hrs[+day.slice(8) - 1] += durSec / 3600;
    }
  }
  const key = await smKey();
  await Promise.all(
    hrs.map(async (_, i) => {
      const day = `${month}-${String(i + 1).padStart(2, "0")}`;
      if (cut && day >= cut) return;
      const r = await fetch(`${SM_API}/usage?since=${day}&until=${day}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) throw new Error(`speechmatics usage ${day}: ${r.status}`);
      const { summary } = await r.json();
      hrs[i] += (summary ?? []).reduce((n, s) => n + s.duration_hrs, 0);
    }),
  );
  return hrs;
}
