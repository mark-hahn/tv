# unilog Reconciliation

Reconciliation is the step that turns staged unilog edits in source code into live
log sites in the database, and keeps every active call's recorded location in sync.
It is the single mechanism that guarantees the DB always matches the code that
actually ships.

- **Where it runs:** locally, on the dev laptop, as part of `./srvr <project>`.
- **When it runs:** at **deploy only** — never on server process start.
- **What owns IDs / the DB:** the running `tv-srvr` process is the single ID
  allocator and DB writer; the reconciler talks to it over HTTPS (with an
  ssh + `sqlite3` fallback when srvr is down).
- **DB location (remote):** `/root/dev/apps/tv/unilog/unilog.sqlite`.

Entry point: [unilog/run-reconcile.js](../unilog/run-reconcile.js) (the deploy
driver) over the pure core in [unilog/reconcile.js](../unilog/reconcile.js).

---

## 1. Why reconciliation exists

unilog defers all DB writes to deploy time. The agent (or a human) only ever stages
edits in source — it never allocates a numeric `log_id` and never writes the DB.
Reconciliation is what:

1. activates staged stubs into real `unilog(id, …)` calls,
2. auto-upgrades any leftover old-style single-literal logs,
3. refreshes `src_file` / `src_line` for every existing active call whose line moved,
4. allocates real IDs from the one DB owner and upserts the `log_sites` rows.

Because IDs are assigned only here, a freshly-edited but un-reconciled file contains
stubs only and logs nothing until it is deployed.

---

## 2. Site kinds the reconciler recognizes

Detection of real call sites uses an **AST** parse (`@babel/parser`, and
`@vue/compiler-sfc` for `.vue` `<script>` blocks) via
[unilog/parse.js](../unilog/parse.js) — not line/regex scanning — so tricky literals
like `console.log(")")` or multi-line templates are handled by the grammar.

| kind                           | shape in source                                               | what reconcile does                                  |
| ------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------- |
| **stub**                       | `// unilog-stub {level=info,tag=bif} unilog(\`…\`);`          | activate → `unilog(<id>, …)`, create `log_sites` row |
| **old-style (single literal)** | `console.log(\`…\`)`, `log('…')`, `loge(…)`, `logSubtitle(…)` | upgrade → `unilog(<id>, …)`, create `log_sites` row  |
| **active**                     | `unilog(412, 'info', \`…\`)`                                  | refresh `src_line` only (id read from first arg)     |
| **blocked**                    | any log line ending in `// no-unilog`                         | left untouched (opt-out)                             |

Notes:

- An **active** site is identified purely by `unilog(<NumericLiteral>, …)` — there is
  no trailing `// log-id:` comment; the id _is_ the first argument, read back from the
  AST.
- Only **single-literal** old-style calls auto-upgrade (one string/template argument).
  Multi-arg or non-literal calls are left for the agent to handle (anchor escalation).
- `// no-unilog` on the source line blocks upgrade/replacement everywhere.

---

## 3. Stub grammar and activation

Stubs are written as comments so they are inert until reconciled. Grammar
(see [unilog/unilog-lib.js](../unilog/unilog-lib.js)):

```js
// unilog-stub {level=info,tag=chokidar} unilog(`detected add: ${p}`);
// unilog-stub {level=warn} unilog("low disk");
```

- `level` is `info|warn|error|debug`; `tag` is optional.
- The argument is the **tag-stripped** message expression (no `[tag]` inside the
  message text — the tag is a separate DB field, back-compat only).

Activation replaces the comment with a live call carrying the allocated id:

```js
unilog(412, "info", `detected add: ${p}`);
```

The old-style auto-upgrade transform produces the same result directly: it derives
`level` from the method (`warn→warn`, `error→error`, `loge→error`, else `info`),
pulls a leading `[tag]` out into the `tag` field, and emits `unilog(<id>, …)` in
place of the original call (replaced by exact AST byte offsets, applied end-to-start
so offsets stay valid).

---

## 4. The two-phase core

[unilog/reconcile.js](../unilog/reconcile.js) keeps a pure, DB-free core so it can be
unit-tested with a fake id allocator:

- **Phase 1 — `scanText` (read-only).** Returns `creates` (new stub + old-style sites,
  sorted top-to-bottom) and `refreshes` (existing active sites with their current
  line). Nothing is modified.
- **Phase 2 — `reconcileText` (rewrite).** Given a `nextId()` callback that returns
  ids in source order, it activates stubs and rewrites old-style calls, returning the
  new file text plus the refresh list.

IDs are allocated in **source order** (stubs and upgrades interleaved by start line)
so a file's new ids ascend with line number.

The DB-backed driver `reconcileFilesWithDb(files, …)` ties the two phases together:
for each file it scans, calls `createSiteFn` once per new site (to get a real id),
calls `refreshSiteFn` for each moved active site, then rewrites the file with the
allocated ids. `src_file` is stored **relative to the repo root** (e.g.
`apps/srvr/index.js`) so DB paths match the deployed remote layout.

---

## 5. The deploy driver (`run-reconcile.js`)

Usage:

```bash
node unilog/run-reconcile.js <project|all> [--force]
```

It is invoked automatically by `./srvr` **before** any build/rsync, so the activated
source ships in the same deploy:

```bash
# from ./srvr remote_deploy_one_no_restart(), for srvr and client:
node unilog/run-reconcile.js "$project"
```

Steps:

1. **Resolve the file list.** Hard-wired per-project `include`/`exclude` globs (no env
   vars). unilog's own plumbing files (e.g. `unilogDb.js`, client `log.js`) are
   excluded — they log with `// no-unilog`.
2. **Skip unchanged files.** A sha256 of each file is compared against
   [unilog/reconcile-cache.json](../unilog/reconcile-cache.json); only changed files
   are processed. `--force` processes all files in the project.
3. **Allocate ids + create the group.** A `task`-kind `log_groups` row is created for
   the run, then each new site is created under it. Both go through `tv-srvr`.
4. **Refresh moved sites.** For existing active calls whose line changed, the new
   `src_line` is written back (only stale rows are updated — current values are
   queried first and unchanged ones skipped).
5. **Rewrite source files** in place with the activated/upgraded calls.
6. **Inject the `unilog` import** into any file that gained new calls and didn't
   already have it in scope (`@tv/share` for server code; a relative import of
   `apps/client/src/log.js` for client code; handled inside `<script>` for `.vue`).
7. **Update the cache** with new hashes and current site locations.

---

## 6. ID allocation: one writer, with a fallback

`tv-srvr` is the **only** ID generator and DB writer, which removes any need for
cross-process locking.

- **Normal path (HTTPS):** POST to the running srvr —
  `POST https://hahnca.com/tv-srvr/api/unilog/group`,
  `…/api/unilog/sites`, `…/api/unilog/query-sites`, `…/api/unilog/refresh-sites`.
- **Fallback (ssh + sqlite3):** if srvr is unreachable, the driver runs
  `pm2 stop tv-srvr` once (so there is exactly one writer), then writes
  `unilog.sqlite` directly over ssh with `SELECT COALESCE(MAX(id),0)+1` allocation.
  srvr restarts on deploy anyway.

Timestamps (`ts`, `created_at`) use PST `yyyy/mm/dd hh:mm:ss` with hour `24`
normalized to `00`, matching `apps/srvr/src/unilogDb.js` so all tables agree.

---

## 7. Drift safety: line refresh, collisions, idempotency

- **Line refresh.** Inserting/removing lines shifts active calls below them. The
  reconciler re-reads each file's `unilog(<id>, …)` positions and refreshes
  `src_line` in `log_sites`, so locations stay accurate without re-running every
  file. Only the changed file needs rescanning.
- **Collision guard.** If the same `log_id` is seen in two different files (e.g. a
  copy/paste of an active call), the run reports a `WARNING: log_id collision` and
  skips refreshing that id to avoid oscillation — it must be fixed in source.
- **Idempotent.** Re-running on an already-reconciled, unchanged tree is a no-op:
  the hash cache skips files, and only genuinely stale `src_line` values are written.

---

## 8. Scope

Reconciled projects: `srvr`, `api`, `down`, `asr`, `tv`, `client`. Within each, only
the hard-wired `include` list is processed and the `exclude` list is skipped.

Never reconciled (logged old-style or not at all): `apps/android/**`, Tampermonkey
`*.user.js`, the `unilog/` tooling itself (uses `// no-unilog`), build output,
`temp*`, `node_modules`, `scripts/`, `apps/*/scripts/`, and ad-hoc root files.

---

## 9. Quick reference

```bash
# Reconcile one project (what ./srvr runs for you):
node unilog/run-reconcile.js srvr

# Force-process every file in a project (ignore the hash cache):
node unilog/run-reconcile.js client --force

# Reconcile every project at once:
node unilog/run-reconcile.js all --force
```

Report lines (`[run-reconcile] …`) summarize files processed, sites checked, cache
misses, rows written to the DB, and new sites created.
