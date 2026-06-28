
# IGNORE THIS PLAN -- it will be replaced by unilog/unilog-plan.md

# unilog — Universal Logging Plan (authoritative, merged)

This document merges `unilog/univ-logs-plan.md` (the runtime/store design) and
`unilog/univ-log-agent-plan.md` (the log-authoring agent) into one plan, and folds in
the authoritative decisions from `unilog/unilog-instr.md`. Where the two old plans
disagreed, the decisions in `unilog-instr.md` win and are applied here.

This is a plan only. No source code is changed by writing it.

> Naming: the feature was originally "universal logging"; it is now **unilog**. That
> name is used for docs, data stores, the DB, the centralized runtime function
> (`unilog(...)`), and tooling.

---

## 1. What unilog is

unilog replaces most logging in the app, both server and client. It has two parts:

- **unilog tooling** — adds/removes log calls in source code.
  - Copilot chat adds log sites based on prompts; a **thin AI agent** automates the
    actual editing (a deterministic CLI is **not** used — decision 0).
  - **Reconciliation** turns staged edits into live log sites and keeps the DB in
    sync. It runs at: **code deployment** and **process start on the server**.
- **unilog logging** — at runtime, instrumented call sites invoke the centralized
  `unilog(...)` routine, which centralizes writing events to the DB (client and
  server paths both funnel through it).

Later, a **log viewer** tab pane will read the DB to display results. No reader is
built yet.

### Locations (decided in `unilog-instr.md`)

- DB (remote): `/root/dev/apps/tv/unilog/unilog.sqlite`
  — this **replaces** the earlier `/logs/all-logging.sqlite`.
- Tooling scripts (local laptop): `/root/apps/tv/unilog/`
- Docs (local): `/root/apps/tv/unilog/`

---

## 2. Store — SQLite (decided)

SQLite at `/root/dev/apps/tv/unilog/unilog.sqlite`.

- Machine-readable, trivially scannable by Copilot chat (`sqlite3 … "SELECT …"`).
- No daily rotation.
- Cheap structured queries by tag, file, level, time, group — ideal for the log pane.
- WAL mode + `busy_timeout` so the future log pane can read while the writer writes.

The DB has three tables: `log_groups`, `log_sites`, `log_events`. There is **no
`logRegistry.json`** (decisions 1.6, 3, and `univ-logs-plan.md §3`): `log_sites` is
the registry and single source of truth.

### 2.1 `log_groups` (new — see §6 for the group design and id logic)

```sql
CREATE TABLE IF NOT EXISTS log_groups (
  group_id     INTEGER PRIMARY KEY,          -- unique integer id (DB-owner allocated)
  kind         TEXT NOT NULL,                -- 'prompt'|'conversation'|'flow'|'file'|'task'
  ts           TEXT NOT NULL,                -- 'yyyy/mm/dd hh:mm:ss' (PST) group created
  description  TEXT,                          -- human/agent description of the group
  nat_key      TEXT,                          -- natural key used to resolve stubs -> group_id
  parent_id    INTEGER,                       -- broader group (e.g. prompt -> conversation)
  session_id   TEXT                           -- copilot conversation id when known
);
CREATE INDEX IF NOT EXISTS idx_groups_kind   ON log_groups(kind);
CREATE INDEX IF NOT EXISTS idx_groups_parent ON log_groups(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_natkey ON log_groups(nat_key);
```

### 2.2 `log_sites` (one row per source call site)

```sql
CREATE TABLE IF NOT EXISTS log_sites (
  log_id      INTEGER PRIMARY KEY,            -- unique integer logging id (never reused)
  group_id    INTEGER,                        -- FK -> log_groups.group_id (usually set)
  tag         TEXT,                           -- legacy tag, e.g. "bif" (back-compat only; see §3.1)
  description TEXT,                           -- short description / sanitized prompt (see §7.4)
  src_file    TEXT,                           -- path of source file
  src_line    INTEGER,                        -- line number (refreshed on reconcile; may drift)
  old_log     TEXT,                           -- legacy log file the prior call targeted (provenance)
  project     TEXT,                           -- srvr|api|down|asr|tv|client|share
  level       TEXT,                           -- default level for the site (info|warn|error)
  removed_at  TEXT                            -- tombstone (NULL = active)
);
CREATE INDEX IF NOT EXISTS idx_sites_group ON log_sites(group_id);
CREATE INDEX IF NOT EXISTS idx_sites_file  ON log_sites(src_file);
```

- **No `is_error` column** (decision 1.3) — error is determined by `level`.
- **No `prompt` column** (decision 10.8) — the prompt is stored in `description`
  after a sanity check (§7.4).
- `tag` is kept **only** as a separate back-compat field (decision 0.1), never inside
  the stored message. Eventually tags become unused because `log_id` + `description`
  - `group_id` are sufficient; tags have historically been inconsistent.

### 2.3 `log_events` (one row per runtime emission)

```sql
CREATE TABLE IF NOT EXISTS log_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id    INTEGER,                          -- FK -> log_sites.log_id
  level     TEXT NOT NULL,                    -- 'debug'|'info'|'warn'|'error'
  pid       TEXT,                             -- emitting process, e.g. 'tv-srvr'
  ts        TEXT NOT NULL,                    -- 'yyyy/mm/dd hh:mm:ss' PST
  message   TEXT NOT NULL                     -- full message text (never truncated)
);
CREATE INDEX IF NOT EXISTS idx_events_logid ON log_events(log_id);
CREATE INDEX IF NOT EXISTS idx_events_ts    ON log_events(ts);
CREATE INDEX IF NOT EXISTS idx_events_level ON log_events(level);
```

- Message size is **not** capped in the DB. Over-long existing messages are shortened
  at the source first as the first rollout step (§8).
- `pid`/`ts` are stamped by the collector (the DB owner), not the caller, so
  cross-process ordering stays consistent.
- An FTS5 index on `message` can be added later if the log pane needs fast text search.

---

## 3. No Normalized log object

The earlier "Normalized log object" concept is dropped (per `unilog-instr.md`): it is
replaced by the combination of a `log_sites` row plus a `log_events` row. If a
normalized shape is convenient in code it may be built **ephemerally**, but it is not a
stored or transported contract.

### 3.1 The `[tag]` no longer lives in the message

Decision 0.1 / 7.3: the `[tag]` prefix is **not** stored inside `message` and is
**not** passed in the message expression. The tag lives in `log_sites.tag` (back-compat
only). Example: a flexget "run started" log stores `message = "run started"` with
`tag = "flexget"` — the log viewer can render `[flexget]` later if it wants.

---

## 4. Types of logging sites

The reconciler and agent recognize four site kinds:

1. **Traditional write** — legacy `console.*` / wrapper / `appendFile`. These are the
   calls unilog will eventually replace.
2. **Traditional write with blocking comment** — a legacy log line ending in
   `// no-unilog`. unilog must **never** replace or add a call at this site. Used for
   debugging unilog itself and for short-term old-style logging.
3. **unilog call stub** — written by the agent while editing a source file, commented
   out as:
   ```js
   // unilog-stub: unilog('info', `queued ${showName}`); // group:<nat_key>
   ```
   The stub is **not** live. During reconciliation it becomes an active site by
   removing the leading `// unilog-stub: ` and allocating the `log_id` (§5). This is
   what guarantees the DB always matches the active calls: nothing is in the DB until
   reconciliation activates the stub.
4. **Active unilog call site** — the live call that logs an event:
   ```js
   unilog(412, "info", `queued ${showName}`); // unilog-id: 412
   ```
   It calls the centralized `unilog(...)` function and carries a trailing
   `// unilog-id: <n>` comment tying the row back to source.

### 4.1 Existing-log handling at a site (decided)

- When a unilog stub or active call is added to a site, any existing **old-style**
  logging at that same site is **removed**.
- There is **never** a traditional call sitting next to a new unilog call at any phase
  of development.
- unilog calls **never** append to any old log file. New logging is **DB-only**
  (decisions 10.1, and `univ-logs-plan.md §0.1`).

---

## 5. Reconciliation (deploy + process start)

Reconciliation is the single mechanism that keeps source and DB in sync. It runs on
`./srvr*` deploys and on server process start. It does **not** reconcile everything —
only **changed files** (decisions 6, 10.2). The DB is **not** updated at edit time;
all DB writes are deferred to reconciliation.

For each changed file, the reconciler:

1. **Activates stubs.** For every `// unilog-stub:` line: strip the prefix, allocate
   the next `log_id` (`SELECT max(log_id)+1`, DB-owner serialized — §9), resolve the
   group natural key to a `group_id` (creating the group if new — §6), write the
   `log_id` into the call and its `// unilog-id: N` comment, and insert the
   `log_sites` row.
2. **Auto-upgrades stray old-style logging.** Any old-style `console.*` (or wrapper)
   call in the changed file that is **not** marked `// no-unilog` and is **not**
   already an active unilog site is upgraded to a unilog call using the **same upgrade
   logic** as the one-time scan (§8.2). (Decision 10.4 — this replaces lint-gated
   control; see §10.)
3. **Refreshes `src_line`.** Re-scan all `// unilog-id:` comments in the file and
   `UPDATE` each site's `src_line` (inserting/removing lines shifts everything below).
   Only the changed file needs rescanning; other files are unaffected.
4. **Skips unsupported contexts.** Files that cannot host unilog (§7.1) are ignored;
   their old-style logging is left alone (decision 10.6).

Because activation and id allocation happen only at reconciliation, the DB is always a
faithful image of the **deployed/running** code, never of un-deployed edits.

### 5.1 Anchor ambiguity → escalate to the agent

If reconciliation or the agent cannot unambiguously locate an insertion/edit point
(anchor matches 0 or >1 lines), the problem is **passed up to the agent** to narrow,
rather than guessed (decision 10.5). Anchor drift is a common AI-edit failure mode and
is handled by re-prompting, not by silent heuristics.

---

## 6. unilog groups (new feature) — design + id logic

Most `log_sites` rows reference exactly one `group_id`. A group is a named collection
of call sites. Recognized `kind`s:

- `prompt` — sites added by one Copilot prompt.
- `conversation` — sites added across one Copilot conversation/session.
- `flow` — sites that trace a program flow (e.g. a button press → its action).
- `file` — sites in one source file (e.g. `tvdb.js`).
- `task` — sites in one server task (e.g. `tv-down`, `tv-srvr`).

The group feature is primarily for the **log viewer** (filter/trace by provenance or
flow) and secondarily for removal selectors (§7.3).

### 6.1 Why a single `group_id` per site, with hierarchy

A site is naturally created by **one prompt**, inside **one conversation**, touching
**one file**, in **one task**, and may belong to **one flow**. Those are not mutually
exclusive, but storing five FKs per site is heavy and most groupings are derivable:

- `file` and `task` groups are **derivable** from `src_file`/`project` at query time,
  so they do not need to be the site's primary group (they can be materialized as
  `log_groups` rows for the viewer, with membership computed by path/project).
- `prompt` is the **finest provenance** that is _not_ derivable from code, so it is the
  primary `group_id` written on each site.
- `conversation` is the parent of `prompt` (a conversation spawns many prompts), linked
  via `log_groups.parent_id`.
- `flow` is an **optional, explicitly-authored** grouping; when the agent is told a set
  of sites form a flow, it tags those stubs with the flow's natural key and the
  reconciler links them. A site's primary group can be the flow group when the user is
  explicitly instrumenting a flow; otherwise it is the prompt group.

So: `log_sites.group_id` = the most specific _authored_ group (flow if explicitly
instrumenting a flow, else prompt). `parent_id` chains prompt → conversation. File and
task groupings are computed for the viewer and do not consume the per-site slot.

### 6.2 Id allocation logic (deferred, like `log_id`)

Group ids cannot be allocated at edit time because all DB writes are deferred to
reconciliation (§5). So:

- The stub carries a **natural key** `nat_key` instead of a numeric id, e.g.
  `conv:<sessionId>` / `prompt:<sessionId>#<seq>` / `flow:<slug>`.
- At reconciliation the **DB owner (tv-srvr)** resolves the natural key:
  `SELECT group_id FROM log_groups WHERE nat_key = ?`. If absent, it creates the group
  (`group_id = max(group_id)+1`, `ts = now PST`, `kind`, `description`, `parent_id`),
  then assigns that numeric `group_id` to the new site rows.
- The same DB owner serializes both `log_id` and `group_id` allocation (§9), so there
  are no races. Numeric ids are stable and never reused; natural keys exist only to
  bridge edit-time → reconcile-time.

This keeps groups consistent with the rest of the model: **the agent never invents a
numeric id; the DB owner does, once, at reconciliation.**

---

## 7. The log-authoring agent

A thin AI agent (decision 0) is the sanctioned path for adding/removing unilog calls.
It edits **only** logging and never refactors unrelated code. It does **not** run a
deterministic `log-add.js` CLI, does **not** write `logRegistry.json`, and does **not**
add any house-style traditional log (decisions 0, 1.6, 3). It does **not** put tooling
in `scripts/` (that dir is for one-time scripts only — decision 3); unilog tooling
lives in `/root/apps/tv/unilog/`.

Agent responsibilities per request (e.g. _"log when a bif build is queued in srvr"_):

1. Read the target region; find a unique anchor near the insertion point (escalate if
   ambiguous — §5.1).
2. Remove any old-style log at that site (§4.1) and insert a **unilog stub** (kind 3),
   with the group natural key for the current prompt/conversation/flow.
3. Choose `level` (info/warn/error) and a short `description` (the sanitized prompt —
   §7.4). The message expression carries **no** `[tag]` (§3.1).
4. Report back: file:line, level, group, description, and the exact inserted stub.
   (No `log_id` yet — that is assigned at reconciliation.)

The agent does **not** touch the DB at edit time (decision 10.2). Activation,
id/group allocation, and `src_line` refresh all happen at reconciliation (§5).

### 7.1 Out-of-scope contexts the agent must ignore (decision 10.6)

- `apps/android/**` — must not send logging.
- Tampermonkey `*.user.js` — foreign browser contexts.
- The `unilog/` folder itself — unilog tooling logs with **traditional writes carrying
  the `// no-unilog` blocking comment** (per `unilog-instr.md` scope decision).
- gitignored build output, `temp*`, `node_modules`, `scripts/`, `apps/*/scripts/`, and
  ad-hoc root files (`*.cjs`, `scan-playback-positions.js`, …).

In these, the agent does not add unilog; existing old-style logging stays as-is.

### 7.2 `.vue` SFCs (decision 10.7)

Insert/scan only within `<script>` regions of `.vue` files; line counting for
`// unilog-id:` comments works as for `.js`, and the reconciler's per-file rescan
handles the shifts.

### 7.3 Removing log lines

Removal **only** deletes the call from the source file and **tombstones** the site
(`removed_at`); `log_events` rows are **never** deleted, so historical messages stay
interpretable forever via the tombstoned `log_sites` row.

Selectors (no "delete all by id" — decisions 8, 10.9; ids are unique so it would be a
single row anyway):

| selector                        | resolves to                                                       |
| ------------------------------- | ----------------------------------------------------------------- |
| delete last added               | most recently added non-removed site                              |
| delete by location              | `--file F --line N` → the `// unilog-id` at that spot             |
| delete all in this conversation | every site whose group chains to the conversation `group_id`      |
| delete all in a flow            | every site in the flow `group_id`                                 |
| delete all since date/time      | every site added on/after T                                       |
| delete by description (fuzzy)   | fuzzy match on `description`; **preview + confirm before delete** |

The conversation/session id is the closest thing to "grouping by flow" for deletes
(decision 10.9), and is modeled as a `conversation` group (§6). Multi-match selectors
must preview the full hit list and require confirmation before editing.

For each removal: delete the source line, set `removed_at` at reconciliation, and
refresh sibling `src_line`s in that file.

### 7.4 Description = sanitized prompt (decision 10.8)

There is **no** separate `prompt` column. The creating prompt is stored in
`description` **after a prompt sanity check**. If the check fails (prompt is too long,
malformed, contains quotes/newlines that don't summarize the intent, or is otherwise
unsuitable), the agent **falls back to a context-generated description** derived from
the surrounding code. This sanity check must be developed and tested **before**
rollout (alongside the old-style-upgrade logic — §8.2).

---

## 8. Rollout (phased)

### 8.0 First step — remove large legacy log lines (decided, one-time)

Before anything else, remove the legacy code that writes the over-long log lines listed
in the **Long Log-Line Report** in `temp2.md`. These lines will **not** be replaced by
new logging.

- Remove every log line called out in that report (≈33 location-families; tv-down
  dominates by volume, tv-srvr by per-line size — the tvdb `enqueue … from:<stack>`
  dump, `tvdb push … <field diff>`, the down `------ … SKIPPING …` / `not blocked`
  progress lines, chokidar `sub check … files=<all paths>`, etc.).
- Be careful not to break code.
- This is a one-time operation done as the **first** rollout step.

The rest of the legacy `console.*` / `appendFile` writes are removed **later**, per
project, once events are confirmed flowing (and **without deferring** old-style removal
beyond that — decision: follow `univ-logs-plan.md` suggestions _except_ "Defer
old-file removal", which is overridden by `unilog-instr.md`).

### 8.1 Infra (no call-site edits)

- Create `unilog/` dir on remote + SQLite schema bootstrap (`log_groups`, `log_sites`,
  `log_events`) at `/root/dev/apps/tv/unilog/unilog.sqlite`.
- Add the centralized `unilog(...)` writer to `@tv/share` (DB-direct inside `tv-srvr`;
  POST to `/api/log` elsewhere — §11).
- Add `POST /api/log` to `tv-srvr`.
- Add the client `unilog` routine (`apps/client/src/log.js`) that POSTs (batched,
  fire-and-forget; `navigator.sendBeacon` on unload).
- Deploy and smoke-test a few manual events end-to-end.

### 8.2 Develop + test the upgrade & sanity logic (precondition)

Before instrumenting at scale, build and test:

- **Old-style → unilog upgrade** logic: detect `console.*`/wrapper/`appendFile` sites
  (skip `// no-unilog`), derive `level` from the method (`warn`→warn, `error`→error,
  else info), strip any `[tag]` into `log_sites.tag`, and emit the unilog stub/call.
  This is the **same** logic used by reconciliation (§5 step 2) and by the one-time
  scan — one implementation, reused (decision 10.4).
- **Prompt sanity check** + context-generated fallback for `description` (§7.4).

### 8.3 Instrument call sites (per project, one at a time)

- Run the upgrade over each project, deferring DB writes to reconciliation. Process
  files so inserted lines don't corrupt recorded `src_line` (rescan per file).
- Order so each can be deployed independently: `srvr` → `api` → `down` → `asr` → `tv`
  → `client` (`./srvr <name>` per the repo workflow).
- Human pass to refine weak descriptions.

### 8.4 Verify after each server

`pm2 logs` shows no crash/restart loop; `unilog.sqlite` receives rows. (Per repo rule:
whenever a deploy triggers a pm2 restart, check `pm2 logs` for crash loops.)

---

## 9. Concurrency & id allocation

- The **DB owner (tv-srvr)** is the single allocator of both `log_id` and `group_id`
  during reconciliation: `SELECT max(...)+1`, serialized within that one process, so
  concurrent reconciliations cannot collide (decision 10.3 — one owner resolves/avoids
  multi-path conflicts).
- `log_id` and `group_id` are PRIMARY KEYs, so any duplicate insert fails loudly as a
  second safety net.
- Ids are allocated once and **never reused**; removed sites are tombstoned.
- The agent never allocates numeric ids (it emits stubs with natural keys), so there is
  no model-side coordination to get wrong.

---

## 10. Lint: monitor, don't control (decision 10.4 + suggestions)

No lint check **controls** changes. Old-style logging is detected and auto-upgraded by
the reconciler over changed files (§5 step 2). A lint rule **may** exist purely for
**monitoring/visibility** (e.g. surfacing un-upgraded `console.*` without
`// no-unilog`), but it never gates or blocks edits.

---

## 11. Runtime architecture — how events reach the DB

One collector owns the DB (Option A; Option B "every process writes directly" is
rejected). The shared `unilog(...)` routine in `@tv/share`:

- **In `tv-srvr`:** writes the event **directly** to `unilog.sqlite`.
- **Everywhere else** (`tv-api`, `tv-down`, `tv-tv`, asr/down workers, client): POSTs
  the event to `tv-srvr` `POST /api/log`, which stamps `pid` + PST `ts` and calls the
  same writer.

```
client  unilog ─POST /api/log─┐
tv-api  unilog ─POST /api/log─┤
tv-down unilog ─POST /api/log─┼─►  tv-srvr  /api/log  ─►  unilog writer ─► SQLite
tv-tv   unilog ─POST /api/log─┘                                  │
tv-srvr unilog ──────────────────────in-process call────────────┘
```

- `unilog(id, level, message)` is the call shape; `tag`, `description`, `group_id`, and
  `src_*` live in `log_sites` (looked up by `id`), not in the call.
- Store/POST failures must be swallowed (best-effort) so logging never throws into
  business logic.
- Timestamps use PST `yyyy/mm/dd hh:mm:ss`; an hour of `24` is normalized to `00`
  (existing repo convention).

---

## 12. Suggestions

- **Agent-first, no CLI.** Per decision 0, build the agent + reconciler upgrade logic;
  skip a `log-add.js` CLI entirely. Reliability lives in the reconciler (one shared
  upgrade implementation).
- **`unilog-doctor`** maintenance command (in `unilog/`) that reports: drift between
  `src_line` and actual `// unilog-id:` positions, orphaned `// unilog-id:` comments
  (in source but not DB), orphaned `log_sites` rows (in DB but not source), and
  un-activated stubs. Run after big refactors so the two never silently diverge.
- **`unilog/logq.sh "SELECT …"`** one-line query helper for debugging scans.
- **FTS5 on `message`** added later if the log viewer needs fast text search.
- **Centralize `level` derivation** in one helper so the upgrade stays mechanical.
- **Materialize file/task groups lazily** for the viewer (computed from
  `src_file`/`project`) rather than storing them per site (§6.1).

---

## 13. Ambiguities / contradictions / impossibilities

1. **`unilog(...)` id vs. deferred allocation.** The active call embeds a numeric
   `log_id`, but ids are only assigned at reconciliation. Resolved by the stub→active
   transition: the stub has no id; reconciliation writes the id into both the call and
   its `// unilog-id:` comment. Implication: a freshly-edited (un-reconciled) file has
   stubs only — it must not be expected to log until deployed/started. (Consistent with
   "DB always matches active calls.")

2. **Group natural keys require a stable conversation/session id.** Copilot does not
   guarantee the agent a conversation id. The plan uses `nat_key` (`conv:<sessionId>`,
   `prompt:<sessionId>#<seq>`, `flow:<slug>`) and `/memories/session/` to track ids per
   conversation. If a conversation spans restarts or session memory is cleared, the
   `conversation` group may be incomplete. Flagged; flow/prompt grouping via explicit
   `nat_key` is unaffected.

3. **"Most sites reference a group" but a site fits several group kinds.** Resolved in
   §6.1 by making the per-site `group_id` the most-specific _authored_ group (flow else
   prompt), chaining to conversation via `parent_id`, and computing file/task groups for
   the viewer. If the user actually wants a site to be a _direct_ member of several
   groups simultaneously, a `log_site_groups` junction table would be needed instead —
   flagged as a possible future change.

4. **Schema growth across the merged tables (decision 10.11).** Relative to
   `univ-logs-plan.md`, this plan adds `log_groups` entirely, adds `group_id` + `level`
   to `log_sites`, removes the never-present `is_error`, and keeps `tag` only for
   back-compat. `description` now carries the sanitized prompt (no separate `prompt`
   column). These are intentional and supersede the old schemas.

5. **Reconciliation auto-upgrade vs. "agent is the only path."** Since reconciliation
   itself upgrades stray old-style logging (decision 10.4), the agent is _not_ literally
   the only writer of unilog calls — the reconciler also creates them. This is intended:
   the agent authors intentful logs; the reconciler sweeps up the rest. No lint gate is
   used (§10).

6. **One-time long-line removal may overlap with later legacy removal.** §8.0 removes a
   specific set of over-long lines first; §8.3+/later removes remaining legacy writes.
   The two passes must not double-edit the same site — the long-line set is removed (not
   upgraded), so those locations should be excluded from the later upgrade sweep.

7. **`old_log` provenance after legacy removal.** `old_log` records where a site's prior
   logging went. Once legacy file logging is removed, the column is purely historical
   provenance; it is retained (not required) for the viewer and audit.
