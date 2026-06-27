# Universal Logging — Implementation Plan

Goal: mirror **all** application logging into one central, machine-readable store on
the remote server, while leaving the existing log destinations (pm2 stdout logs,
`subtitle.log`, `tv.log`, `tv-adb.log`, etc.) untouched. No store reader is built
yet — a log-viewer tab pane comes later.

This document is a plan only. No code has been changed (only `temp.md` stats and
this file were written).

---

## 1. Current logging landscape (from `temp.md`)

- ~**1,208** log call sites across **111** files / **80,450** lines.
- Heaviest: `apps/srvr/index.js` (289), `apps/tv/src/main.js` (96, via `log/loge`),
  `apps/client/src/emby.js` (76), `apps/api/src/server.js` (68),
  `apps/client/src/components/list.vue` (63).
- Logging styles in use:
  - **`console.*`** everywhere — captured by pm2 into `*-out.log` / `*-error.log`.
  - **srvr** `logSubtitle()` → appends `apps/asr/data/subtitle.log`.
  - **tv** `log()` / `loge()` wrappers → `console.*` (+ adb write stream).
  - **down** `tvJson.js` → appends `misc/tv.log`.
  - Most lines carry a `[tag]` prefix (`[bif]`, `[asr]`, `[subs]`, `[TV ...]`, …).
- **pm2 processes** (separate OS processes, one DB writer problem — see §4):
  `tv-api`, `tv-down`, `tv-srvr`, `tv-tv`; plus `tv-srvr` spawns `asr` workers and
  `tv-down` spawns workers.

---

## 2. Store choice — recommend SQLite

The instruction allows a flat file or a DB. **Recommend SQLite** at
`/root/dev/apps/tv/logs/all-logging.sqlite`:

- Machine-readable and trivially scannable by Copilot chat (`sqlite3 ... "SELECT …"`).
- No daily rotation needed (instruction only requires rotation for the flat-file case).
- Cheap structured queries by tag, file, level, time — ideal for the future log pane.
- Normalized object maps directly to columns.

Proposed schema:

```sql
CREATE TABLE IF NOT EXISTS log_sites (   -- one row per source call site (the registry)
  log_id      INTEGER PRIMARY KEY,       -- unique integer logging id
  tag         TEXT,                      -- short tag, e.g. "bif"
  description TEXT,                       -- <=15 word flow description
  src_file    TEXT,                       -- path of source file
  src_line    INTEGER,                    -- line number (may go stale; ok)
  old_log     TEXT,                       -- existing log file written to
  project     TEXT
);

CREATE TABLE IF NOT EXISTS log_events (  -- one row per runtime emission
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id    INTEGER,                      -- FK -> log_sites.log_id
  is_error  INTEGER NOT NULL,             -- 0 normal, 1 error
  ts        TEXT NOT NULL,                -- 'yyyy/mm/dd hh:mm:ss' PST
  message   TEXT NOT NULL                 -- full message text
);
CREATE INDEX IF NOT EXISTS idx_events_logid ON log_events(log_id);
CREATE INDEX IF NOT EXISTS idx_events_ts    ON log_events(ts);
```

Splitting site metadata (tag/description/file/line/old_log) into `log_sites` keeps
each runtime row tiny and call sites concise (they pass only `log_id`, level,
message). The normalized "log object" in the instruction is the join of the two
tables. A denormalized single-table variant is possible if a join-free flat file
feel is preferred — noted as an option, not the recommendation.

**If a flat file is mandated instead**: write newline-delimited JSON to
`/root/dev/apps/tv/logs/all-logging.log`, one JSON object per line (each object
carrying all fields), and rotate daily into
`/root/dev/apps/tv/logs/all-logging-rotation/all-logging-YYYY-MM-DD.log` via a
`node-cron` job at 00:00 PST (srvr already uses `node-cron`).

---

## 3. The log registry (ids, tags, descriptions, comments)

- Maintain a generated registry file, e.g. `packages/share/src/logRegistry.json`,
  mapping `log_id -> { tag, description, src_file, src_line, old_log, project }`.
- Each instrumented call site gets a trailing comment `// log-id: <n>`
  (or `# log-id: <n>` for shell, though shell scripts are out of scope here).
- On process start, the shared routine upserts the registry rows into `log_sites`
  so the DB always reflects current metadata; line numbers are refreshed by a
  codemod pass (see §6), accepting that they drift between passes (allowed).
- Tags reuse existing `[tag]` prefixes; descriptions are generated from surrounding
  context, kept under ~15 words, and shared across call sites in the same flow.

---

## 4. Architecture — how lines reach the store

The instruction says "server files should send log lines to a common routine that
writes to log store" and "client → shared client routine → server endpoint → server
common routine". Two viable shapes for the multi-process server side:

- **Option A (recommended): one collector owns the DB.**
  A single writer (in `tv-srvr`) owns `all-logging.sqlite`. The shared "common
  routine" (in `@tv/share`) writes **directly to the DB only inside `tv-srvr`**; the
  other processes (`tv-api`, `tv-down`, `tv-tv`, asr/down workers) call the same
  routine which **POSTs** the event to a srvr endpoint `POST /api/log`. This avoids
  multi-process SQLite write contention and matches the client path exactly (client
  also POSTs to `/api/log`). One code path, one writer.

- **Option B: every process writes the DB directly** using WAL mode +
  `busy_timeout`. Simpler wiring, but 5+ concurrent writers risk lock churn and make
  the "common routine" subtly different from the client path. Not recommended.

Recommended flow:

```
client routine  ─POST /api/log─┐
tv-api  routine ─POST /api/log─┤
tv-down routine ─POST /api/log─┼─►  tv-srvr  /api/log  ─►  common writer  ─►  SQLite
tv-tv   routine ─POST /api/log─┘                                   │
tv-srvr routine ───────────────────────in-process call────────────┘
```

Shared routine responsibilities (single function, e.g. `logEvent(logId, isError, message)`):

1. Build normalized object (PST timestamp `yyyy/mm/dd hh:mm:ss`, registry lookup).
2. Persist to store (direct in srvr, POST elsewhere).
3. **Also perform the original write** (call the real `console.*` / append to the
   old log file) so existing destinations are unchanged.

Failure isolation: store/POST failures must never throw into business logic —
swallow + best-effort, so logging never breaks the app.

### Client specifics

- Add a shared client routine (new `apps/client/src/log.js`) that POSTs to
  `/api/log` (batched, fire-and-forget). All `console.*` in client code route
  through it (it still calls `console.*` so the browser console and
  `apps/client/vite-console.log` mirror are unaffected).
- Batch + `navigator.sendBeacon` on unload to avoid flooding and lost tail events.

### Server endpoint

- `POST /api/log` on `tv-srvr` validates `{ logId, isError, message }`, applies the
  PST timestamp server-side, and calls the common writer. (Reuse existing express +
  CORS already in srvr.)

---

## 5. Normalized log object (per instruction)

```jsonc
{
  "logId": 412, // unique integer per source location
  "isError": false, // error vs normal
  "timestamp": "2026/06/27 14:05:31", // PST, yyyy/mm/dd hh:mm:ss (date-only -> 00:00:00)
  "tag": "bif", // short tag (was "[bif]")
  "description": "queue bif build for show", // <=15 words, from context
  "srcFile": "apps/srvr/index.js", // source path
  "srcLine": 1127, // line number (best-effort, may be stale)
  "oldLog": "/root/.pm2/logs/tv-srvr-out.log", // existing destination
  "message": "[bif] queued The Bear /path/x.bif",
}
```

Timestamp rule already used in the codebase is honored: format `MM-DD HH:mm` is the
console style, but the **store** uses `yyyy/mm/dd hh:mm:ss`; hour `24` is normalized
to `00` (existing repo convention).

---

## 6. Rollout (phased — keep changes small and per-server deployable)

1. **Infra (no call-site edits):**
   - Create `logs/` dir + SQLite schema bootstrap.
   - Add common writer + `logEvent()` to `@tv/share`.
   - Add `POST /api/log` to srvr.
   - Add client `log.js` routine.
   - Deploy & smoke-test with a handful of manual events end-to-end.

2. **Codemod to instrument call sites (per project, one at a time):**
   - AST-based transform (e.g. jscodeshift / Babel for `.js`/`.vue <script>`) that:
     - finds `console.*` / `logSubtitle` / `log` / `loge` call sites,
     - allocates the next `log_id`, derives `tag` from any `[tag]` prefix,
     - generates a draft `description`,
     - rewrites the call to go through the shared routine (preserving the original
       behavior), appends `// log-id: N`, and writes/refreshes `logRegistry.json`.
   - Process files bottom-up (or recompute line numbers post-edit) so inserted lines
     don't corrupt recorded `src_line` values.
   - Order by server so each can be deployed independently: `srvr` → `api` →
     `down` → `asr` → `tv` → `client`. (`./srvr <name>` per the repo workflow.)
   - Human pass to refine auto-generated descriptions where weak.

3. **Verify** after each server: `pm2 logs` shows no crash/restart loop; old log
   files still receive their lines; `all-logging.sqlite` receives rows.

---

## 7. Scope decisions

- **Included:** client, srvr, api, down, asr, tv, packages/share.
- **Excluded — android** (`apps/android/**`): instruction says android must not send
  logging messages.
- **Excluded — gitignored files:** build output, `temp*`, `node_modules`, etc.
  ("nothing in .gitignore should send any logging messages").
- **Scripts (`scripts/`, `apps/*/scripts/`, root `*.cjs`, `scan-playback-positions.js`):**
  one-off maintenance tools, not long-running services. Recommend **excluding** from
  the first rollout (low value, runs ad hoc, no pm2 capture). Flagged as ambiguity #3.
- **Userscripts (`*.user.js`): excluded** — see impossibility #1.

---

## 8. Ambiguities / contradictions / impossibilities

1. **Impossible-ish: Tampermonkey `*.user.js`.** `emby-skip-intro.user.js`,
   `emby-ui.user.js`, `usb-cp-tampermonkey.user.js` are injected into third-party
   pages (Emby / usb.me) in the browser. They cannot reach an internal `/api/log`
   without CORS exposure and a hard-coded server URL, and they are not part of our
   client bundle. Recommend excluding them (they're effectively "android-like"
   foreign contexts). Need confirmation.

2. **Ambiguity: does "writes to log files" include `console.*`?** Strictly,
   `console.log` writes to stdout (pm2 captures it to a file), not to a file the code
   opens. The instruction's intent ("all app logging in central storage") implies
   yes — instrument `console.*` too, with `oldLog` = the pm2 `*-out.log` /
   `*-error.log` path. Assumed yes. Confirm.

3. **Ambiguity: scripts in scope?** "all source files" vs. these being ad-hoc,
   non-service scripts with no pm2 capture and no operational value in the store.
   Plan excludes them initially; easy to add later. Confirm.

4. **Contradiction (soft): "common routine that writes to log store" vs. multiple
   processes.** A literal single shared routine that _writes the DB_ can't be the
   sole writer across 5 processes without contention. Resolved by Option A (one DB
   owner in srvr; others POST through the same routine). This honors the spirit
   ("one common routine") while staying safe. Confirm Option A vs Option B.

5. **Ambiguity: unique id allocation & churn.** Ids must be stable per location, but
   call sites move/delete over time. Plan: ids are allocated once and never reused;
   deleted sites leave a tombstoned `log_sites` row; `src_line` is refreshed on each
   codemod pass (staleness between passes is explicitly allowed).

6. **Ambiguity: description generation at 1,208 sites.** Hand-writing all is large;
   auto-generation will be rough. Plan generates drafts via codemod and refines the
   busiest files first. Acceptable per "generate description from the context".

7. **Flat-file vs DB left to us.** Chosen SQLite (§2). If you prefer the flat file,
   the plan's §2 flat-file fallback (NDJSON + daily cron rotation) applies and the
   `log_sites`/`log_events` split collapses into one object per line.

---

## 9. Suggestions

- **Add a `level` beyond the error boolean** (`debug|info|warn|error`) — the codebase
  already uses `console.warn`; a 2-value boolean loses that. Cheap to store, useful
  for the future pane. (Kept the required `is_error` too.)
- **Batch client + cross-process POSTs** (e.g. flush every ~1s or N events) to avoid
  hammering `/api/log`; use `sendBeacon` on page unload.
- **Add a `pid` / `process` column** (which pm2 app emitted it) — invaluable when
  scanning a unified store across 5 processes.
- **WAL mode + `busy_timeout`** on the SQLite connection even with the single-writer
  design, for safe concurrent reads by the future log pane.
- **Keep a generated `logRegistry.json` in git** so `log-id -> location` lookups work
  offline and in code review, independent of the live DB.
- **Cap message size** (e.g. truncate very long messages) to keep the store bounded.
- **Provide a tiny query helper** (`scripts/logq.sh "SELECT …"`) so Copilot/devs have
  a one-liner to scan the store during debugging.
