# unilog — Unified Plan (authoritative)

This document **merges** the two earlier plans (`univ-logs-plan.md` — the runtime
logging system; `univ-log-agent-plan.md` — the log-adding agent) into a single
authoritative plan, applies every decision in `unilog-instr.md`, and adds the new
**unilog groups** feature.

It supersedes both old plans. The old plans are left unchanged; only this file is
written.

> Status: plan only. No source code is changed by writing this document.

---

## 1. What unilog is

unilog ("universal logging") replaces most logging in the app — both **server** and
**client**. All logging is managed in one SQLite DB on the remote server. A log-viewer
tab pane will read that DB later.

unilog has **two parts**:

- **unilog tooling** — edits source code to add/upgrade/remove log calls.
  - Copilot chat adds log sites from prompts.
  - A dedicated **unilog agent** automates the actual editing.
  - **Reconciliation** runs at **code deployment only** (never on process start, so the
    deployed source can never diverge from the authoritative local source).
- **unilog logging** — the runtime. When app code runs, log sites are calls into the
  central `unilog(...)` routine. Client and server routines funnel every event into
  the DB.

### Nomenclature & locations (from `unilog-instr.md`)

| thing                      | location                                 |
| -------------------------- | ---------------------------------------- |
| docs                       | `/root/apps/tv/unilog/` (this folder)    |
| tooling scripts (local PC) | `/root/apps/tv/unilog/` (NOT `scripts/`) |
| logging data / DB (remote) | `/root/dev/apps/tv/unilog/unilog.sqlite` |

The DB path **`unilog/unilog.sqlite`** replaces the earlier
`logs/all-logging.sqlite`. The name **unilog** is used everywhere (docs, data, DB).

---

## 2. Store — SQLite (decided)

SQLite at **`/root/dev/apps/tv/unilog/unilog.sqlite`** (remote, owned by `tv-srvr`).

- Machine-readable, trivially scannable from Copilot chat via `sqlite3 … "SELECT …"`.
- No rotation. Cheap structured queries by tag/file/level/time for the future log pane.
- WAL mode + `busy_timeout` so the log pane can read while the writer writes.

### 2.1 Schema

Four tables: `log_sites` (one row per source call site), `log_events` (one row per
runtime emission), `log_groups` (the new groups feature — §5), and `site_groups` (the
many-to-many join between sites and groups — §5).

```sql
CREATE TABLE IF NOT EXISTS log_sites (   -- one row per source call site
  log_id      INTEGER PRIMARY KEY,        -- unique integer id (allocated once, never reused)
  tag         TEXT,                        -- legacy short tag, e.g. "bif" (backwards-compat only; see §2.2)
  description TEXT,                        -- creating prompt, or context-generated summary on sanity-check failure (§7.4)
  level       TEXT NOT NULL,               -- 'debug'|'info'|'warn'|'error'  (lives HERE, not on events)
  src_file    TEXT,                        -- source file path (refreshed by reconciliation; may change if code moves files)
  src_line    INTEGER,                     -- line number (refreshed by reconciliation; may drift between passes)
  old_log     TEXT,                        -- legacy log file the original call targeted (informational)
  project     TEXT,                        -- srvr|api|down|asr|tv|client|share
  created_at  TEXT,                         -- 'yyyy/mm/dd hh:mm:ss' PST, when the site was added
  removed_at  TEXT                          -- tombstone ('yyyy/mm/dd hh:mm:ss'); NULL = active
);

CREATE TABLE IF NOT EXISTS log_events (  -- one row per runtime emission
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id    INTEGER,                       -- FK -> log_sites.log_id
  pid       TEXT,                          -- emitting process, e.g. 'tv-srvr' (stamped by collector)
  ts        TEXT NOT NULL,                 -- 'yyyy/mm/dd hh:mm:ss' PST (stamped by collector)
  message   TEXT NOT NULL                  -- full message text, NO [tag] prefix (§2.2), never truncated
);
CREATE INDEX IF NOT EXISTS idx_events_logid ON log_events(log_id);
CREATE INDEX IF NOT EXISTS idx_events_ts    ON log_events(ts);

CREATE TABLE IF NOT EXISTS log_groups (  -- one row per logical group (§5)
  group_id    INTEGER PRIMARY KEY,         -- unique integer id (allocated by srvr endpoint; never reused)
  group_type  TEXT,                         -- kind of group: prompt|conversation|flow|file|source file|task (not limited to these)
  ts          TEXT NOT NULL,               -- 'yyyy/mm/dd hh:mm:ss' PST, when group was created
  description TEXT                          -- prompt / conversation summary / flow name / file / task name
);

CREATE TABLE IF NOT EXISTS site_groups (  -- many-to-many: which sites belong to which groups (§5)
  log_id   INTEGER NOT NULL,               -- FK -> log_sites.log_id
  group_id INTEGER NOT NULL,               -- FK -> log_groups.group_id
  PRIMARY KEY (log_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_site_groups_group ON site_groups(group_id);
```

### 2.2 Decisions baked into the schema (from `unilog-instr.md`)

- **`level` is on `log_sites`, not `log_events`.** A call site always logs at one
  level; events inherit it. (instr note.)
- **No `is_error` column.** Whether something is an error is read from `level`.
  (1.3, instr.)
- **`tag` is a separate DB field, kept only for backwards compatibility.** The `[tag]`
  prefix is **not** stored inside the message text and is **not** passed in the runtime
  message. Tags will eventually be unused (ids + short descriptions replace them); they
  have often been insufficient and poorly chosen. The log viewer may re-add a `[tag]`
  prefix for display if desired. (0.1, 7.3, instr.)
- **No `prompt` column.** The creating prompt is stored in `description`; a sanity
  check (§7.4) falls back to a context-generated description when the prompt is a poor
  fit. (10.8, instr.)
- **No `session_id` column.** Conversation- and flow-scoped grouping is handled by
  `log_groups` + the `site_groups` join table (§5). (10.9/10.10, instr.)
- **No `logRegistry.json`.** `log_sites` **is** the registry. Ids are allocated by a
  single `tv-srvr` endpoint (§7.2). (1.6 / §3 of old plan, instr.)
- **No "Normalized log object".** The concept is dropped as vague; a `log_sites` +
  `log_events` pair carries everything. It may be used ephemerally in code if handy.
  (instr.)
- **Message size is not capped** in the DB. Over-long _existing_ messages are shortened
  at the source first (§12, §13).

---

## 3. Logging-site types (source-code states)

Every place logging can exist is in exactly one of these states:

1. **Traditional write** — `console.*`, `log()/loge()`, `logSubtitle()`, `appendFile`,
   etc. This is legacy logging awaiting upgrade.
2. **Traditional write with a blocking comment** — the line ends with **`// no-unilog`**.
   unilog must **never** replace or add a call here. Used for debugging unilog itself
   and for short-term old-style logging. (All unilog tooling code uses this style — §11.)
3. **unilog call-site stub** — a commented-out call written by the agent while editing:

   ```js
   // unilog-stub: unilog(/*level*/ 'info', `queued ${showName}`);
   ```

   The stub is inert until reconciliation. On the next deploy, reconciliation
   **activates** it by removing the `// unilog-stub: ` prefix, allocating a `log_id`,
   appending `// log-id: N`, and inserting the `log_sites` row. This guarantees the DB
   always matches the **active** calls. (instr type 3.)

4. **Active unilog call site** — the live call that emits an event:

   ```js
   unilog(412, `queued ${showName}`); // log-id: 412
   ```

   The trailing `// log-id: N` ties the source line to its `log_sites` row.

### 3.1 Existing-log handling (no double logging — ever)

When the agent adds a stub or active unilog call at a site, **any existing old-style
logging at that site is removed**. There is **never** a traditional call next to a new
unilog call at any phase. unilog **never** appends to any old log file. (instr.)

This means the old plan's "transitional also perform the original write" step is
**dropped** — old-style logging is removed at the moment a site is upgraded, not
deferred. (instr: "do not defer old-style logging removal".)

---

## 4. Runtime architecture — how events reach the store

**Option A (decided): one collector owns the DB.** A single writer inside `tv-srvr`
owns `unilog.sqlite`. The shared `unilog(...)` routine (in `@tv/share`) writes
**directly** to the DB only inside `tv-srvr`; every other process (`tv-api`,
`tv-down`, `tv-tv`, asr/down workers, and the **client**) calls the same routine, which
**POSTs** the event to `tv-srvr`'s `POST /api/log`. One write path, one writer — no
multi-process SQLite contention. (instr 10.3: the one DB owner handles both `log_sites`
and runtime events, and resolves/avoids path conflicts.)

```
client routine  ─POST /api/log─┐
tv-api  routine ─POST /api/log─┤
tv-down routine ─POST /api/log─┼─►  tv-srvr  /api/log  ─►  common writer  ─►  unilog.sqlite
tv-tv   routine ─POST /api/log─┘                                   │
tv-srvr routine ───────────────────────in-process call────────────┘
```

The shared `unilog(logId, message)` routine:

1. Looks up the site's `level` from `log_sites` (cached) — level is not passed by the
   caller of an active call.
2. **Stamps `pid` and `ts`** (PST `yyyy/mm/dd hh:mm:ss`; hour `24` → `00`) in the
   **collector**, not the caller, so cross-process ordering is consistent.
3. Persists the `log_events` row (direct in `tv-srvr`, POST elsewhere).

Failures (DB or POST) must never throw into business logic — swallow + best-effort, so
logging can never break the app.

### 4.1 Client specifics

- New shared client routine `apps/client/src/log.js` POSTs to `/api/log`, batched and
  fire-and-forget, with `navigator.sendBeacon` on unload to avoid losing tail events.
- It still calls `console.*` so the browser console and the `apps/client/vite-console.log`
  mirror remain intact for the existing debug workflow.

### 4.2 Server endpoint

- `POST /api/log` on `tv-srvr` validates `{ logId, message }`, stamps `pid` + `ts`
  server-side, and calls the common writer. Reuses srvr's existing express + CORS.

---

## 5. unilog groups (new feature)

`log_groups` lets one or more call sites be collected into a named logical group.
Membership is recorded in the **`site_groups(log_id, group_id)` join table** (decided —
not a CSV column on `log_sites`), so a site can belong to several groups and a group can
hold many sites with clean, normalized queries.

### 5.1 Group kinds

A group represents one of:

- sites added from **one Copilot prompt**;
- sites added across **one Copilot conversation**;
- sites that track a **program flow** (e.g. button press → matching action);
- sites in **one source file** (e.g. `tvdb.js`);
- sites in **one server task** (e.g. `tv-down`, `tv-srvr`).

### 5.2 Group-id design (logic, per instr 10.10)

`group_id` is a **monotonic integer** allocated by the **single srvr endpoint** (the
`tv-srvr` DB owner — §7.2), mirroring `log_id` allocation, so it is race-safe and never
reused. Reasons for an integer key (not, say, a tag or a hash):

- It is **stable and orderable** — the log viewer can show groups newest-first and join
  `log_events → log_sites → site_groups → log_groups` cheaply.
- It is a **clean join key** in `site_groups`, letting a site belong to many groups
  (and a group hold many sites) without CSV parsing.
- It **decouples** the group from any volatile text (prompt wording, file path, flow
  name), which can change without breaking membership.

How each kind gets its id:

- **Prompt / conversation groups:** Copilot does **not** expose a stable conversation
  id, so the unilog agent creates a conversation group on the first add in a chat,
  records its `group_id` in **session memory** (`/memories/session/`), and reuses it for
  subsequent adds in the same conversation. Each prompt may also get its own sub-group.
  The log viewer is responsible for **combining conversations** when it presents them,
  and a delete may target **multiple conversation `group_id`s** at once (§9).
- **Flow groups:** created explicitly when the user wants to trace a flow; the agent
  adds `site_groups` rows linking the relevant sites to that `group_id`.
- **File / task groups:** can be derived deterministically (one group per tracked source
  file or per pm2 task) and pre-populated, or filled lazily as sites are touched.

The `description` field holds the prompt, conversation summary, flow name, file, or task
name as appropriate (Copilot can generate it from log-site code context).

Groups are primarily for the **log viewer** and for **group-scoped deletes** (§10).

---

## 6. Tooling — the unilog agent + a deterministic CLI

Shape: a **thin AI agent over a deterministic CLI** (instr 0). The agent makes the
judgment calls (where to log, level, description); the CLI performs the mechanical edit.
All tooling lives in **`/root/apps/tv/unilog/`** (instr 3 — `scripts/` is reserved for
one-time-use scripts).

```
Copilot chat ──► unilog agent (decisions) ──► unilog/unilog-cli.js (mechanics)
                                                   │
                                       edit source file: insert
                                       `// unilog-stub:` call, remove
                                       old-style logging at that site
```

### 6.1 What the agent does

Given an instruction like _"log when a bif build is queued in srvr"_, the agent:

1. Locates the insertion point via a unique nearby **anchor** string.
2. Chooses **level** (info/warn/error) and a **description** (the prompt, sanity-checked
   — §7.4). It does **not** craft a `[tag]`; the message carries **no** `[tag]` prefix.
3. Inserts a **`// unilog-stub:`** call and **removes** any old-style logging at that
   site (§3.1).
4. Adds the site to the appropriate **group(s)** and records the conversation
   `group_id` in session memory.
5. Reports the file:line, level, description, group(s), and the inserted stub line.

The agent does **only** logging edits — never refactors or touches unrelated code. It
does **not** write to the DB while editing (instr 10.2); the DB is updated later by
reconciliation. It does **not** add any house-style traditional log (instr 3).

### 6.2 What the agent does NOT do

- It does **not** allocate `log_id` itself (reconciliation does — keeps one owner).
- It does **not** ssh to the DB during editing.
- It **ignores** code that can't support unilog (android, `*.user.js`, etc. — §11);
  there, old-style logging simply continues. (instr 10.6.)
- On an **ambiguous anchor** (0 or >1 matches), the CLI refuses and the problem is
  **passed back up to the agent** to narrow — anchor problems are expected in AI code
  editing. (instr 10.5.)

### 6.3 Agent definition

Create `.github/agents/unilog.agent.md` (sibling to `tv-control` / `Explore`).
Restrict its tools to read/search/edit + `run_in_terminal` for the CLI. Body (sketch):

```markdown
---
name: unilog
description: Use whenever a log line must be added, upgraded, or removed. Writes
  a `// unilog-stub:` call (and removes old-style logging at that site). Never
  touches the DB or unrelated code.
tools: [read_file, grep_search, run_in_terminal, replace_string_in_file]
---

You add/upgrade/remove unilog logging and nothing else. For each request:

1. Read the target region; find a unique anchor near the insertion point.
2. Decide level (info/warn/error) and a description (the prompt, sanity-checked).
3. Run `node unilog/unilog-cli.js --dry-run …`; verify the planned edit.
4. Re-run without --dry-run to commit the stub + remove old-style logging.
5. Record the conversation group id in /memories/session/.
6. Report file:line, level, description, group(s), and the inserted line.
   If the anchor is not unique, stop and narrow it (or ask for a line number).
```

If invoked via `runSubagent` instead, the same body becomes the subagent prompt.

---

## 7. Reconciliation — keeping the DB in sync with active calls

Reconciliation is the bridge between edited source and the DB. It runs at **code
deployment only** and operates on **changed files only** — it does
**not** reconcile everything (instr 6), and it **never runs on process start**. The
**same logic/code** is used for the one-time
upgrade scan and for ongoing changed-file reconciliation (instr 10.4).

### 7.1 Per changed file, reconciliation:

1. Skips lines ending in `// no-unilog`.
2. **Activates stubs:** for each `// unilog-stub:` line — request a `log_id` from the
   **srvr id endpoint** (§7.2; the `tv-srvr` owner is the only place any id is
   generated), remove the `// unilog-stub: ` prefix, append `// log-id: N`, and insert
   the `log_sites` row (level, description, src_file, src_line, project, created_at) plus
   any `site_groups` rows for its group memberships.
3. **Auto-upgrades leftover old-style logging** (`console.*` / `log` / `loge` /
   `logSubtitle` / `appendFile`) that lacks `// no-unilog` and is not already a unilog
   call: rewrite it to an active `unilog(...)` call, derive `level` from the method
   (`warn`→warn, `error`→error, else info), move any `[tag]` prefix into the `tag` field
   and **strip it from the message**, request the id from the srvr endpoint, and insert
   the row. (instr 10.4.)
4. **Refreshes `src_file` and `src_line`** for every `// log-id:` site in the file —
   inserting lines shifts everything below, and a site may even **move to a different
   file** if code was relocated, so both columns are updated.
5. **Upserts** all affected rows into `log_sites` / `site_groups` via the single DB owner.
6. Requests any needed **`group_id`s** from the srvr endpoint and writes `log_groups` rows.

### 7.2 Where it runs (deploy only)

- **Deploy (`./srvr*`) — the only activation point.** The deploy invokes the
  local reconciler in `/root/apps/tv/unilog/` **before** the rsync push, so the
  source files it edits (stub activation: prefix removal + `// log-id: N`) are included
  in that same deploy and local ↔ remote stay identical. **All id and group-id
  allocation goes through a single `tv-srvr` endpoint** — the owner is the only place any
  type of id is generated (instr 10.3) — so there is still exactly one writer.
- **No process-start reconciliation.** Reconciliation **never** runs when a process
  starts. If it did, a restart could edit the deployed source and make it diverge from
  the authoritative **local** source. The local workspace is the single source of truth;
  the remote is only ever written by a deploy. (response2.)

### 7.3 Detecting changed files

Deploys are **rsync push only** via `./srvr`; the remote tv project folder has **no
`.git`** (git is used **locally only**, for backup/restore and monitoring source changes
while debugging). Because commits can happen at any time and many deploys occur without
a commit, change detection **must not use git**. Instead, keep a **flat checksum file**
(per tracked source file: sha256 + size) at an appropriate location and compare against
it each deploy; files whose checksum changed are reconciled, then the checksum file is
updated. Externally-modified tracked files (hand edits, another chat) surface as a
deploy warning so drift is visible.

### 7.4 Description sanity check (must be built + tested before rollout)

The `description` stores the creating **prompt** (instr 10.8). A **sanity check**
verifies the prompt actually describes the log site; on failure it **falls back to a
context-generated description**. This check — like the old-style auto-upgrade — must be
**developed and tested before rollout**. (instr 10.4 / 10.8.)

---

## 8. Adding a log — end-to-end example

Request: _"Add an info log in srvr when the flexget run starts."_

1. Agent greps `apps/srvr/index.js`, picks the anchor `flexgetIsRunning = true`.
2. `node unilog/unilog-cli.js --file apps/srvr/index.js --anchor "flexgetIsRunning = true"
--position after --level info --message '`run started`' --dry-run` previews the edit.
   Note the message is **`run started`** — no `[flexget]` prefix (instr 7.3).
3. Commit run inserts
   `// unilog-stub: unilog(/*level*/ 'info', \`run started\`);`
   and removes any old-style log at that site; records the conversation group in session
   memory.
4. On the next `./srvr` deploy, reconciliation activates the stub:
   `unilog(1209, \`run started\`); // log-id: 1209`, allocates id 1209 (srvr endpoint),
and inserts the
`log_sites`row (level=info, description="Add an info log in srvr when the flexget run
starts", project=srvr, created_at=…) plus a`site_groups` row linking it to the
   conversation group.

---

## 9. Removing logs

Removal **deletes the call from the source file** and **tombstones** the site
(`removed_at` set). **`log_events` rows are never deleted** — historical messages stay
forever, and the tombstoned `log_sites` row is kept so old events remain interpretable.
Ids are **never reused**.

CLI: `node unilog/unilog-cli.js --remove <selector>`:

| selector               | flag                            | resolves to                                            |
| ---------------------- | ------------------------------- | ------------------------------------------------------ |
| delete last added      | `--last`                        | highest `created_at` among non-removed sites           |
| delete by location     | `--file F --line N`             | the `// log-id` at that spot                           |
| **delete by group(s)** | `--group G[,H,…]`               | every site linked in `site_groups` to any listed group |
| delete since date/time | `--since "2026/06/27 12:00:00"` | every site with `created_at >= T`                      |
| delete by description  | `--match "bif queued"`          | fuzzy match on `description`; **preview + confirm**    |

For each removal the CLI deletes the source line, sets `removed_at` (via reconciliation/
DB owner), and refreshes sibling `src_line`s. Multi-match selectors (`--group`,
`--since`, `--match`) print the full hit list and require confirmation (or `--yes`).
`--group` **accepts multiple `group_id`s** so several conversations (or flows) can be
deleted in one call.

### 9.1 Group-id is the flow/conversation delete

A **`group_id`** is the single delete specification that removes all log lines
linked to that group via `site_groups`. It **replaces** both "delete all in this
conversation" and "delete all in a flow" (instr). Because a conversation maps to a
group and `--group` takes a list, **multiple conversations** can be removed together.
There is **no "delete all by id"** selector (`log_id` is unique = one site).
(instr 8 / 10.9.)

---

## 10. Scope

- **Included:** client, srvr, api, down, asr, tv, `packages/share`.
- **Excluded — android** (`apps/android/**`): must not send logging.
- **Excluded — the `unilog/` folder itself:** unilog tooling uses traditional writes
  with the `// no-unilog` blocking comment. (instr.)
- **Excluded — gitignored files:** build output, `temp*`, `node_modules`, etc.
- **Excluded — `scripts/`, `apps/*/scripts/`, and root files** (`*.cjs`,
  `scan-playback-positions.js`, etc.): ad-hoc, not pm2-captured.
- **Excluded — Tampermonkey `*.user.js`:** foreign browser contexts.

Excluded code keeps its old-style logging; the agent ignores it (instr 10.6).

---

## 11. Per-project legacy style (for the auto-upgrade to match)

| project | legacy style                                           | legacy destination (informational `old_log`) |
| ------- | ------------------------------------------------------ | -------------------------------------------- |
| srvr    | `console.*` `[tag]`; `logSubtitle()` for subtitle flow | pm2 `tv-srvr-out/err.log`, `subtitle.log`    |
| api     | `console.*` `[tag]`                                    | pm2 `tv-api-out/err.log`                     |
| down    | `console.*`; `tvJson.js` appends `misc/tv.log`         | pm2 `tv-down-*.log`, `tv.log`                |
| asr     | `console.*`                                            | asr log / spawned under `tv-srvr`            |
| tv      | `log()` / `loge()` wrappers                            | pm2 `tv-tv-*.log`, `tv-adb.log`              |
| client  | `apps/client/src/*` `console.*`                        | browser console / `vite-console.log`         |

The auto-upgrade (§7.1.3) reads the `[tag]` prefix into the `tag` field, strips it from
the message, and records the legacy destination as `old_log` (informational only — new
calls never write there).

---

## 12. Rollout (phased, per-server, small deployable steps)

**Rollout step 1 — remove large legacy logging (one-time, FIRST).**
Remove the legacy code that writes the long lines in the **Long Log-Line Report**
(`unilog/unilog-large-lines.md`). These lines are **not** replaced by unilog — they are
simply removed. Be careful not to break code. (instr.) The five biggest wins:

1. `tvdb.js` `enqueue … from: <stack>` ([apps/srvr/src/tvdb.js](apps/srvr/src/tvdb.js#L2019)) — drop/shorten the stack.
2. down `------ … SKIPPING ALREADY DOWNLOADED: <fname>` ([apps/down/src/main.js](apps/down/src/main.js#L2360)) — basename or verbosity gate.
3. down `not blocked <usbLine>` ([apps/down/src/main.js](apps/down/src/main.js#L2437)) — basename only.
4. srvr `[chokidar] sub check … files=<all paths>` ([apps/srvr/index.js](apps/srvr/index.js#L9062)) — log a count.
5. tvdb `tvdb push … <field diff>` ([apps/srvr/src/tvdb.js](apps/srvr/src/tvdb.js#L2319)) — only changed fields.

**Step 2 — build + test the tooling foundations (before any instrumentation).**

- The **old-style auto-upgrade** transform (§7.1.3) — shared with the one-time scan.
- The **description sanity check** + context fallback (§7.4).
- **Dedicated test scripts** to develop and validate the auto-upgrade and sanity-check
  against representative source samples **before rollout** (response §6).
- The **CLI** (`unilog/unilog-cli.js`) and **reconciler** (`unilog/reconcile.js`),
  including stub activation, srvr-endpoint id/group allocation, the checksum change
  file, and `src_file`/`src_line` refresh.

**Step 3 — runtime infra (no call-site edits).**

- Bootstrap `unilog.sqlite` (schema §2.1).
- Add `unilog(...)` + collector to `@tv/share`; add `POST /api/log` to `tv-srvr`; add
  `apps/client/src/log.js`. Smoke-test a few manual events end-to-end.

**Step 4 — instrument per project, one at a time** (order: `srvr → api → down → asr →
tv → client`, each independently deployable via `./srvr <name>`). Reconciliation upgrades
each changed file's old-style calls to unilog, removing the old write at each site (no
dual-write). The remaining bulk of legacy `console.*`/`appendFile` writes is removed as
files are reconciled — **not deferred** beside unilog calls (instr).

**Step 5 — verify** after each server: `pm2 logs` shows no crash/restart loop and
`unilog.sqlite` receives rows. (When deploying a single server, deploy only that server,
e.g. `./srvr srvr`.)

---

## 13. Long-line cleanup reference

The full triage (33 location-families, longest-first, with counts and sample text) is in
`unilog/unilog-large-lines.md`. tv-down dominates by volume; tv-srvr by length. Fixing
~5 locations removes most long-line volume. The Node
`NODE_TLS_REJECT_UNAUTHORIZED` warning is **not** an app log and can only be silenced via
`NODE_OPTIONS=--no-warnings`.

---

## 14. Consolidated decisions

- Store: **SQLite** at `unilog/unilog.sqlite` (remote, `tv-srvr`-owned).
- Architecture: **Option A**, one DB owner; everyone else POSTs `/api/log`.
- **No** `logRegistry.json`, **no** `is_error`, **no** `session_id`/`prompt`/`agroup`
  columns, **no** Normalized log object.
- Group membership lives in a **`site_groups(log_id, group_id)` join table**, not a CSV.
- `level` on `log_sites`; `tag` kept for backwards-compat only and never in the message.
- **All ids (log_id and group_id) are allocated by a single `tv-srvr` endpoint** — the
  owner is the only id generator; allocated once, **never reused**; removed sites
  **tombstoned**.
- DB writes happen at **reconciliation** (deploy only, on changed files), not
  during editing; **deploy is the only activation point**, editing source before the
  rsync push. Reconciliation **never runs on process start** (keeps deployed source from
  diverging from the authoritative local source).
- Change detection uses a **flat checksum file**, not git (remote has no `.git`; deploys
  are rsync-only via `./srvr`).
- Reconciliation refreshes **`src_file` and `src_line`** (code can move between files).
- Old-style logging is removed **at upgrade time** (not deferred); large legacy lines are
  removed **first**.
- Excluded: android, `unilog/`, gitignored, `scripts/`, root files, `*.user.js`.
- `pid`/`ts` stamped in the collector; WAL + `busy_timeout`; batched client POSTs.
- A **lint rule may be used for monitoring only** — it must **not** control or block
  changes; old-style logging is detected and upgraded by reconciliation instead.
  (instr.)

---

## 15. Ambiguities / contradictions / impossibilities

The major open questions from the prior draft are now **resolved** by
`unilog-plan-response`:

1. **Stub activation — resolved.** Deploy is the **only activation point**:
   reconciliation edits source (stub → active + `// log-id: N`) **before** the rsync
   push, so those edits ship in the same deploy. Reconciliation **never runs on process
   start**, so the deployed source can never diverge from the authoritative local
   source. (response 1 / response2.)
2. **Id allocation — resolved.** A single **`tv-srvr` endpoint** generates every id
   (log_id and group_id); nothing else allocates ids. (response 2.)
3. **Group membership — resolved.** Use the **`site_groups(log_id, group_id)` join
   table**, not a CSV column. (response 3.)
4. **Conversation grouping — resolved.** The agent stores each conversation `group_id`
   in **session memory** (`/memories/session/`). The **log viewer** is responsible for
   combining conversations; **deletes accept multiple `group_id`s** so several
   conversations can be removed at once. (response 4.)
5. **Anchor handling — confirmed.** Ambiguous anchors are escalated back to the agent
   to narrow. (response 5 / instr 10.5.)
6. **Auto-upgrade + sanity-check — prerequisites.** Both, plus **dedicated test
   scripts**, must be built and tested **before rollout** (gate on Step 4). (response 6.)
7. **`old_log` — confirmed informational only.** Records where a legacy call _used_ to
   write; new unilog calls never write there; droppable once migration completes.
   (response 7.)

Remaining caveat: conversation `group_id`s depend on session memory; if a conversation
spans restarts or session memory is cleared, that membership may be incomplete — the log
viewer's conversation-combining and multi-group deletes mitigate this.

---

## 16. Suggestions

All suggestions below are **adopted** per `unilog-plan-response` ("follow all
Suggestions"):

- **Build the CLI + reconciler first, the agent second** — most reliability lives in the
  deterministic parts; the agent file is then ~30 lines.
- **`--dry-run` by default** in the agent's first call, then commit — cheap preview, fewer
  accidental edits.
- A **`unilog-doctor`** command that reports drift, orphaned `// log-id:` comments (in
  source but not DB) and orphaned rows (in DB but not source), so the two never silently
  diverge.
- A tiny **query helper** `unilog/unilogq.sh "SELECT …"` for one-line DB scans while
  debugging (in `unilog/`, not `scripts/`).
- Add an **FTS5 index on `message`** later if the log pane needs fast text search.
- **Centralize `level` derivation** (one helper maps `console.warn`→warn,
  `console.error`→error, else info) so the auto-upgrade stays mechanical.
- Keep the **monitoring-only lint rule** purely advisory (instr) — surface un-upgraded
  `console.*` without `// log-id:` / `// no-unilog`, but never block or auto-fix in CI.
