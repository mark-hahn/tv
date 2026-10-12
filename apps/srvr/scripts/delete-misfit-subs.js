// Deletes the subtitle files the checks remember as unusable or from another
// cut (subs.db checks: verdict "unusable" or "wrong cut", valid while the
// file keeps the size and mtime it had), which the checks left on disk
// before they deleted such files themselves (subPrepare.js dropOrHide). An
// .asr.srt is never deleted here: it keeps ASR from running again. tv-srvr's
// watcher sees each delete and keeps the verdict as the memory of why.
//
//   cd /root/dev/apps/tv/apps/srvr
//   node scripts/delete-misfit-subs.js [--dry]
//
// subs.db is opened read only; tv-srvr is its only writer.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SUBS_DB = "/root/dev/apps/tv/apps/srvr/data/subs.db";
const TV_DIR = "/mnt/media/tv";

const dry = process.argv.includes("--dry");
const db = new Database(SUBS_DB, { readonly: true });
const rows = db
  .prepare(`SELECT file, verdict, size, mtimeMs, detail FROM checks WHERE verdict IN ('unusable', 'wrong cut')`)
  .all();

let deleted = 0;
let kept = 0;
for (const row of rows) {
  if (!row.file.startsWith(TV_DIR + "/") || row.file.endsWith(".asr.srt")) continue;
  const st = fs.statSync(row.file, { throwIfNoEntry: false });
  if (!st) continue;
  if (st.size !== row.size || Math.round(st.mtimeMs) !== row.mtimeMs) {
    kept++;
    console.log(`changed since its check, kept: ${path.basename(row.file)}`);
    continue;
  }
  console.log(`${dry ? "would delete" : "deleted"} ${row.verdict} (${row.detail}): ${row.file}`);
  if (!dry) fs.unlinkSync(row.file);
  deleted++;
}
console.log(`${dry ? "would delete" : "deleted"} ${deleted} file(s), kept ${kept} changed since their check`);
