# Plan: Convert tvdb.json persistence to SQLite

## Goal

Replace the flat-file persistence of show records (`tvdb.json`, ~15MB, ~1587
records, rewritten in full — twice, primary + `.bak` — on every save) with a
SQLite database used as a simple key-value store. The in-memory data model and
every consumer of it stay exactly as they are; only the load/save layer and the
one cross-process reader (`down`) change.

Benefits: per-record writes instead of ~30MB full rewrites, no more multi-hundred-ms
synchronous `JSON.stringify` stalls of the event loop, and the
"stale in-memory snapshot overwrites the whole file" corruption class shrinks to
row-level blast radius.

## Non-negotiable project conventions (from CLAUDE.md — follow these)

- No environment variables; hard-wired constants at top of file, UPPERCASE names.
- No file-missing fallbacks — die fast if a required file is missing.
- Never hand-write `unilog(id, ...)` calls or pick ids. Existing `unilog` calls
  keep their ids when code moves. Any NEW log site uses the `logHere({...}, "msg")`
  placeholder (see CLAUDE.md "Unilog Debugging").
- Don't make changes unrelated to this conversion; no cosmetic changes.
- All testing happens on the remote server (hahnca.com). Nothing runs locally
  except vite. Deploy with `./srvr srvr` and `./srvr down` (only the projects
  changed). After deploy, check pm2 logs for crash loops.
- Never git commit unless Mark says to.
- Local repo paths are `/root/apps/tv/...`; the same paths on the remote server
  are `/root/dev/apps/tv/...` (raw directory used by pm2, not a repo).

## Current state (verified facts)

- Data file: `SRVR_DATA_DIR/tvdb.json` (+ `tvdb.json.bak`), remote path
  `/root/dev/apps/tv/apps/srvr/data/tvdb.json`. Pretty-printed JSON object
  keyed by show name. ~15MB, 1587 records.
- Owner: `apps/srvr/src/tvdb.js`. Loads the whole file at startup into module
  var `allTvdb` (line ~499, `loadTvdbAtStartup` ~129). Every consumer
  (`disk.js`, `intro.js`, `flexget.js`, `subsQueue.js`, `opensubtitles.js`,
  `index.js`) reads via `getAllTvdbSync()` synchronously and mutates records
  **in place**.
- Save: `saveTvdbFiles(data)` (line ~194) stringifies everything and writes
  both files through `util.writeFile` (apps/srvr/src/util.js ~89-137: per-path
  coalescing queue + atomic tmp/rename). Called after every processed show in
  the background loop and after every user edit.
- `better-sqlite3` is **already a dependency of both srvr and down** and already
  used in `apps/srvr/src/unilogDb.js` and `apps/down/src/tvJson.js` (history DB,
  line ~693, with `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`
  pragmas). Follow those conventions.
- Cross-process access from the `down` app (separate pm2 process `tv-down`):
  - `apps/down/src/main.js` ~371 + ~2129-2150: reads tvdb.json each cycle to
    build `embyMap` (retry loop exists only because srvr rewrites the file).
  - `apps/down/src/tvJson.js` ~41-42, ~276, ~282-291: `resolveTvdbKeyFromFile`
    (reads keys) and `writeLastDownloadedDirect` (fallback WRITER — rewrites the
    whole file when srvr's HTTP `setTvdbFields` endpoint is unreachable).
- Historical one-off scripts also reference tvdb.json (`/root/apps/tv/scripts/*.js`,
  `apps/srvr/scripts/fix-pickups.js`). They are obsolete — do NOT convert them,
  do NOT run them after migration.
- The client never touches the file (goes through the server API). No client work.

## Decisions (already made — do not re-open)

1. **Engine**: better-sqlite3 (already installed, sync API matches the codebase).
2. **Schema**: single KV table, no normalization:
   ```sql
   CREATE TABLE IF NOT EXISTS shows (
     name TEXT PRIMARY KEY,
     json TEXT NOT NULL
   );
   ```
3. **DB path**: `path.join(SRVR_DATA_DIR, "tvdb.db")`
   (remote: `/root/dev/apps/tv/apps/srvr/data/tvdb.db`).
4. **Pragmas**: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`.
5. **Row format**: compact `JSON.stringify(record)` (no pretty-print).
6. **In-memory model unchanged**: `allTvdb`, `getAllTvdbSync()`, in-place
   mutation, exported API signatures of tvdb.js — all untouched.
7. **Two-tier saving**:
   - `saveShow(name)` — upsert one row where the changed record is known.
   - `saveAllTvdb()` — sweep with change detection (see below) for multi-record
     paths, plus a **5-minute insurance `setInterval` sweep** so in-place
     mutations made by other modules (which today ride along on the next full
     save) still persist. This matches or beats today's durability guarantees
     and avoids auditing every mutation site in the codebase.
8. **Backups**: drop `tvdb.json.bak` and the startup backup-recovery logic
   entirely (WAL provides crash safety). Instead run
   `VACUUM INTO '<SRVR_DATA_DIR>/tvdb.db.bak'` (unlink the target first —
   VACUUM INTO refuses to overwrite) once at startup and every 24h via
   `setInterval`.
9. **Single writer**: tv-srvr is the ONLY process that writes `tvdb.db`. down
   opens the db `{ readonly: true }` for its reads. down's current fallback
   direct write (`writeLastDownloadedDirect` — used when srvr's HTTP
   `setTvdbFields` endpoint is unreachable) is REMOVED, not ported: any direct
   row write would be silently overwritten by srvr's in-memory state on its
   next save/sweep (today's flat-file version has the same race, worse — it
   rewrites the whole file from a possibly-stale read). Instead, down queues
   the failed update durably in its own data dir and retries it through the
   normal HTTP API until it succeeds (see Phase 3). This eliminates the race
   instead of shrinking it: every mutation flows through srvr's in-memory
   model, so nothing can be clobbered.
10. **Old file**: after migration rename `tvdb.json` → `tvdb.json.pre-sqlite`
    and `tvdb.json.bak` → `tvdb.json.bak.pre-sqlite`. Keep as archives. Delete
    nothing.

## Phase 1 — new module `apps/srvr/src/tvdbDb.js`

Owns the DB connection and the change-detection cache. Sketch:

```js
import fs from "fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SRVR_DATA_DIR } from "./srvrPaths.js";

const TVDB_DB_PATH = path.join(SRVR_DATA_DIR, "tvdb.db");
const TVDB_DB_BAK_PATH = path.join(SRVR_DATA_DIR, "tvdb.db.bak");

// die fast: migration script must have created the db
if (!fs.existsSync(TVDB_DB_PATH))
  throw new Error(`[tvdbDb] FATAL: missing ${TVDB_DB_PATH} — run apps/srvr/scripts/migrate-tvdb-to-sqlite.js`);

const db = new Database(TVDB_DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.exec(`CREATE TABLE IF NOT EXISTS shows (name TEXT PRIMARY KEY, json TEXT NOT NULL)`);

const upsertStmt = db.prepare(`INSERT INTO shows (name, json) VALUES (?, ?)
                               ON CONFLICT(name) DO UPDATE SET json = excluded.json`);
const deleteStmt = db.prepare(`DELETE FROM shows WHERE name = ?`);

// last JSON string written per key — baseline for change detection
const lastSavedJson = new Map();

export const loadAllShows = () => {
  const out = {};
  for (const row of db.prepare(`SELECT name, json FROM shows`).iterate()) {
    out[row.name] = JSON.parse(row.json);
    lastSavedJson.set(row.name, row.json);
  }
  return out;
};

export const saveShow = (name, record) => {
  const json = JSON.stringify(record);
  if (lastSavedJson.get(name) === json) return;
  upsertStmt.run(name, json);
  lastSavedJson.set(name, json);
};

export const deleteShow = (name) => {
  deleteStmt.run(name);
  lastSavedJson.delete(name);
};

// change-detection sweep over the whole in-memory object; also deletes rows
// whose keys no longer exist in memory
export const saveAllShows = db.transaction((allTvdb) => {
  for (const [name, record] of Object.entries(allTvdb)) saveShow(name, record);
  for (const name of [...lastSavedJson.keys()])
    if (!(name in allTvdb)) deleteShow(name);
});

export const backupDb = () => {
  fs.rmSync(TVDB_DB_BAK_PATH, { force: true });
  db.exec(`VACUUM INTO '${TVDB_DB_BAK_PATH.replace(/'/g, "''")}'`);
};
```

Notes:
- All functions are synchronous (better-sqlite3); single-row calls are
  microseconds. Callers in tvdb.js are `async` — that's fine, don't change
  their signatures.
- Do NOT export the raw `db` handle.
- Transient props like `_hasChanges` occasionally get persisted today (save at
  chkTvdbQueue runs before they're deleted). Do not add stripping logic —
  behavior-preserving conversion only.

## Phase 2 — rewrite persistence in `apps/srvr/src/tvdb.js`

Remove: `TVDB_PATH`, `TVDB_BACKUP_PATH` constants, `ensureFile` calls for them,
`parseTvdbJson`, `loadTvdbAtStartup` (file version), backup-recovery logic, and
`saveTvdbFiles`. Import from `./tvdbDb.js` instead.

**Startup** (replaces lines ~499-506):
```js
let allTvdb = loadAllShows();
stripLegacyLastWatched(migrateRemotesToFlatProps(allTvdb));
saveAllShows(allTvdb);   // persists anything those in-memory migrations changed
```
Keep `migrateRemotesToFlatProps` and `stripLegacyLastWatched`.

**Delete the whole "Phase 5" lastViewed.json migration block** (~lines 508-553).
It already ran on the live server (`lastViewed.json.backup` exists there); it is
dead code tied to the removed file machinery.

**Replace each `saveTvdbFiles(allTvdb)` / `saveTvdbSync()` call site:**

| Site (current line ≈) | Context | Replacement |
|---|---|---|
| 2365 (`chkTvdbQueue`) | one request processed; record is `finalData`, key is `keyName`; a rename path at ~2163 does `delete allTvdb[inputName]` | `saveShow(keyName, finalData)`; where the ~2163 delete fires, also call `deleteShow(inputName)` — trace the actual variable names when editing |
| 2497 (`tryLocalGetTvdb`, after `refreshEpisodeDataCallback`) | one show, `processRecord.name` | `saveShow(processRecord.name, allTvdb[processRecord.name])` |
| ~2544 (crew fetch) | one show, `rec` | `saveShow(processRecord.name, rec)` |
| ~2551+ (rotten push3, inside `tryLocalGetTvdb`) | one show | `saveShow(...)` for that record |
| 2668 (`getRemotesCmd`, calls `saveTvdbSync`) | one show, `show.name` | `saveShow(show.name, allTvdb[show.name])` |
| 2886 (`saveTvdbSync` body) | generic | body becomes `saveAllShows(allTvdb)`; keep the exported async signature and its try/catch |
| 3172 (`setTvdbFields` tail, guarded by `!paramObj.dontSave`) | may be normal edit, `$delTvdb` (deletes at ~3068), or `$rename` (delete old + add new, ~3077) | `$delTvdb` → `deleteShow(name)`; `$rename` → `deleteShow(name)` + `saveShow(newKey, record)`; normal → `saveShow(name, allTvdb[name])`. Keep the `dontSave` guard semantics (skip persist; the sweep catches it later, same as today) |
| 3394 (`updateTvdbWithGapData`) | mutates many records | `saveAllShows(allTvdb)` |
| 3423 (`migrateWatchedCount`) | mutates many records | `saveAllShows(allTvdb)` |

`saveShow` in tvdbDb.js takes `(name, record)`; passing the record explicitly
avoids ambiguity at call sites that hold a direct reference.

**Add timers** (module scope, near the existing update-loop timers):
```js
setInterval(() => saveAllShows(allTvdb), 5 * 60 * 1000);   // insurance sweep
backupDb();
setInterval(backupDb, 24 * 60 * 60 * 1000);                // daily backup
```
Wrap sweep/backup bodies in try/catch with a `logHere({ lvl: "error" }, ...)`
placeholder so a transient failure never kills the process.

Search the file for any remaining references to `TVDB_PATH` /
`TVDB_BACKUP_PATH` / `saveTvdbFiles` after the edit — there must be none.
`util.writeFile` stays (other files use it).

## Phase 3 — convert the `down` app

`apps/down/src/tvJson.js`:
- Replace `TVDB_JSON_PATH` / `TVDB_BACKUP_PATH` constants with
  `TVDB_DB_PATH = path.join(SRVR_DATA_DIR, "tvdb.db")`.
- Add a lazy connection helper:
  `new Database(TVDB_DB_PATH, { readonly: true, fileMustExist: true })`
  with `busy_timeout = 5000`, opened on first use, kept open. READ-ONLY —
  down must never write this db (see Decision 9). A readonly connection can
  read a WAL db fine (same user owns the -shm/-wal files).
- `resolveTvdbKeyFromFile(candidates)`: instead of parsing the whole file,
  `SELECT name FROM shows`, build the same key list, run the existing
  `resolveTvdbKey` matching against `{ name: true }`-style keys — check how
  `resolveTvdbKey` consumes the object (it iterates keys) and preserve that.
- **Delete `writeLastDownloadedDirect` entirely.** Replace the fallback in
  `recordShowDownloadedInternal`'s catch block (~line 322) with a durable
  retry queue:
  - New file `PENDING_TVDB_FIELDS_PATH` in down's own `DATA_DIR` (NOT srvr's),
    e.g. `pending-tvdb-fields.json`, written with the existing
    `writeJsonAtomic` helper. Shape: `{ [showName]: { timestamp, localPath } }`
    — keyed by show name so repeated failures for the same show keep only the
    latest entry (bounded size). Store the ORIGINAL args of
    `recordShowDownloaded` so the retry delivers the true download timestamp,
    not the retry time.
  - On `postSetTvdbFields` failure: upsert the entry, persist the file, log via
    a `logHere({ lvl: "warn" }, ...)` placeholder, return false. Grep callers
    of `recordShowDownloaded` to confirm the return value is only used for
    logging; if a caller branches on it, preserve its behavior.
  - Retry: a `setInterval` (60s) in tvJson.js that, when the queue is
    non-empty, replays each entry through the same internal path
    (`recordShowDownloadedInternal(showName, timestamp, localPath)` — guard
    against re-enqueue recursion by passing a flag or factoring the
    HTTP-attempt logic out). Remove an entry and persist the file only after
    the HTTP call succeeds. Entries retry forever — srvr being down for hours
    is the exact scenario this queue exists for. Load the file at startup so
    entries survive a tv-down restart.

`apps/down/src/main.js` (~371, ~2129-2150):
- Replace `TVDB_JSON_PATH` with the db path; build `embyMap` by
  `SELECT name, json FROM shows` + `JSON.parse` per row into the same
  `{ [name]: record }` shape (identical object to today — do NOT slim it to
  just `inEmby` without first grepping every `embyMap` use).
- Delete the 5-attempt retry loop — SQLite reads are consistent. Keep a single
  try/catch; on failure keep the existing `unilog(1243, ...)` message
  (id preserved) and leave `embyMap = null` as today.

## Phase 4 — migration script `apps/srvr/scripts/migrate-tvdb-to-sqlite.js`

Standalone; imports ONLY `fs`, `path`, `better-sqlite3`. It must NOT import
`src/tvdb.js` or anything that loads it (that starts the update machinery —
this exact mistake corrupted tvdb.json on July 2, 2026).

Behavior:
1. Hard-wired paths (`/root/dev/apps/tv/apps/srvr/data/...`). Optional single
   CLI arg overriding the output db path (used for the dry run).
2. Refuse to run if the target db already exists (print and exit 1).
3. Read + `JSON.parse` tvdb.json; die fast on parse error or if the object has
   0 keys.
4. Create db + table with the pragmas above; insert every record
   (compact stringify) in one transaction.
5. Verify: `SELECT COUNT(*)` must equal the source key count; die fast otherwise.
6. Only when writing to the real path: rename `tvdb.json` →
   `tvdb.json.pre-sqlite` and `tvdb.json.bak` → `tvdb.json.bak.pre-sqlite`.
7. Print record count and db size. Plain `console.log` with `// no-unilog` is
   NOT allowed without permission — use plain output via `process.stdout.write`
   or just `console.log` WITHOUT the suffix and let the reconciler handle it;
   simplest safe choice: `logHere` is for app code, and scripts/ are not
   deployed through the reconciler — use `console.log` plainly here.

## Phase 5 — deployment / cutover (on remote, in this order)

```bash
# 1. stop both writers
ssh hahnca.com "pm2 stop tv-srvr tv-down"

# 2. copy the migration script over (deploy would restart pm2, so scp it first)
scp apps/srvr/scripts/migrate-tvdb-to-sqlite.js hahnca.com:/root/dev/apps/tv/apps/srvr/scripts/

# 3. dry run against a scratch target, verify count == 1587-ish
ssh hahnca.com "cd /root/dev/apps/tv/apps/srvr && node scripts/migrate-tvdb-to-sqlite.js /tmp/tvdb-test.db"
ssh hahnca.com "sqlite3 /tmp/tvdb-test.db 'SELECT COUNT(*) FROM shows'"
ssh hahnca.com "jq length /root/dev/apps/tv/apps/srvr/data/tvdb.json"   # must match

# 4. real migration (renames the json files as its last step)
ssh hahnca.com "cd /root/dev/apps/tv/apps/srvr && node scripts/migrate-tvdb-to-sqlite.js"

# 5. deploy the changed projects (each restarts its pm2 app)
./srvr srvr
./srvr down

# 6. REQUIRED: watch pm2 logs for both apps for crash/restart loops
ssh hahnca.com "pm2 logs tv-srvr --lines 50 --nostream"
ssh hahnca.com "pm2 logs tv-down --lines 50 --nostream"
```

## Phase 6 — verification checklist

1. Row count: `sqlite3 .../tvdb.db "SELECT COUNT(*) FROM shows"` matches
   `jq length .../tvdb.json.pre-sqlite`.
2. `pm2 status` shows both apps online, restart count not climbing.
3. Background loop: wait ≥2 min, confirm a processed show's row updated
   (`SELECT json_extract(json,'$.saved') FROM shows WHERE name='<show>'`
   shows a fresh timestamp).
4. User edit: change a field from the web client (vite dev), confirm the row
   reflects it.
5. down cycle: pm2 logs for tv-down show no embyMap load errors.
6. Confirm `tvdb.json` no longer exists at the old path (only `.pre-sqlite`
   archives) and `tvdb.db.bak` appears after startup.
7. WAL files (`tvdb.db-wal`, `tvdb.db-shm`) present — normal, do not "clean up".
8. Optional (fallback queue): `pm2 stop tv-srvr`, complete a download so
   tv-down records last-downloaded, confirm the entry appears in down's
   `pending-tvdb-fields.json`; `pm2 start tv-srvr`, confirm within ~60s the
   entry drains and the show's row has the ORIGINAL download timestamp.

## Phase 7 — documentation updates (both files, kept in sync)

Update `CLAUDE.md` AND `.github/copilot-instructions.md` (they must not
diverge):
- Replace "tvdb.json is one very long line ... use jq" with: show data lives in
  `/root/dev/apps/tv/apps/srvr/data/tvdb.db`, table `shows(name, json)`.
  Inspect with e.g.
  `sqlite3 -readonly /root/dev/apps/tv/apps/srvr/data/tvdb.db "SELECT json FROM shows WHERE name='X'" | jq .`
- Rewrite the "stop tv-srvr first before modifying tvdb.json" rule for the db:
  **tv-srvr is the single writer of tvdb.db.** Every other process (including
  down, debug scripts, and one-liners) must open it with `-readonly` /
  `{ readonly: true }`; field changes go through the HTTP `setTvdbFields` API.
  For a bulk offline edit, stop tv-srvr first — srvr holds the dataset in
  memory and its saves/sweep will overwrite rows written behind its back.
  Read-only inspection while running is fine. The warning that loading
  `src/tvdb.js` starts background machinery still applies unchanged.
- Note that one-off scripts referencing tvdb.json
  (`scripts/*.js`, `apps/srvr/scripts/fix-pickups.js`) are obsolete and must
  not be run.

## Rollback

Keep until proven stable: `tvdb.json.pre-sqlite`, `tvdb.json.bak.pre-sqlite`.
To roll back: `pm2 stop tv-srvr tv-down`, rename both archives back to their
original names, redeploy the pre-conversion code (`./srvr srvr && ./srvr down`
from the pre-conversion checkout). Data written only to the db after cutover
(watched flags, last-downloaded, ratings refreshes) is lost on rollback —
optionally export first:
`sqlite3 tvdb.db "SELECT json FROM shows"`-based export script, or accept the gap.

## Out of scope — do not touch

- Any consumer of `getAllTvdbSync()` (disk.js, intro.js, flexget.js,
  subsQueue.js, opensubtitles.js, index.js) — no changes needed or wanted.
- `vip-actors.json`, `tvdbTemplate.json`, `lastViewed.json.backup`, all other
  json files in the data dir.
- The client apps (web + android), `@tv/share` (adding a native dep there would
  break the vite build).
- One-off scripts in `scripts/` and `apps/srvr/scripts/` (except the new
  migration script).
- `util.writeFile` machinery (still used by other files).
- unilog system and `unilogDb.js`.
