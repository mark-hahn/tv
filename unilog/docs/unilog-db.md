# unilog Database

SQLite database at `/root/dev/apps/tv/unilog/unilog.sqlite` (remote server only).

- **Single writer:** `tv-srvr` process via [apps/srvr/src/unilogDb.js](../../apps/srvr/src/unilogDb.js).
- **Other processes** emit logs via `POST /api/log` to tv-srvr — never open the DB directly.
- **WAL mode** with 5 s busy-timeout.
- **Timestamps** are PST `YYYY/MM/DD HH:MM:SS` (hour 24 normalized to 00).

---

## Tables

### `log_sites`

One row per instrumentation point in source. Populated at **deploy time** by the reconciler.

| Column        | Type       | Description                                                                                                                                                      |
| ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log_id`      | INTEGER PK | Numeric id used as the first arg of every `unilog(id, …)` call. Auto-incremented by the reconciler (never reused).                                               |
| `tag`         | TEXT       | Unused dead column (kept for historical rows). No longer set by new sites.                                                                                       |
| `description` | TEXT       | Human-readable note set when the site is created. Falls back to a generated snippet of the message expression if the prompt is absent or fails the sanity check. |
| `level`       | TEXT       | `info` \| `warn` \| `error` \| `debug`. Derived from the call method at creation time.                                                                           |
| `src_file`    | TEXT       | Relative path to the source file, e.g. `apps/srvr/index.js`. Refreshed every deploy even when the id is unchanged.                                               |
| `src_line`    | INTEGER    | 1-based line number. Refreshed every deploy.                                                                                                                     |
| `old_log`     | TEXT       | Original call expression before auto-upgrade (for audit). Null for stub-activated sites.                                                                         |
| `project`     | TEXT       | Derived from the file path: the last `apps/<name>` or `packages/<name>` segment, e.g. `srvr`, `down`, `share`.                                                   |
| `created_at`  | TEXT       | PST timestamp when the row was first inserted.                                                                                                                   |
| `removed_at`  | TEXT       | PST timestamp set when the site is tombstoned (source line deleted). Null while active.                                                                          |

### `log_events`

One row per runtime emission.

| Column    | Type                     | Description                                                                 |
| --------- | ------------------------ | --------------------------------------------------------------------------- |
| `id`      | INTEGER PK AUTOINCREMENT | Monotonically increasing event sequence number.                             |
| `log_id`  | INTEGER                  | Foreign key → `log_sites.log_id`. May be null for unregistered emissions.   |
| `pid`     | TEXT                     | Process name, e.g. `tv-srvr`, `tv-down`. Supplied by the caller.            |
| `ts`      | TEXT                     | PST timestamp stamped by the collector (tv-srvr), not the emitting process. |
| `message` | TEXT                     | Rendered message string.                                                    |

Indexes: `idx_events_logid` on `(log_id)`, `idx_events_ts` on `(ts)`.

### `log_groups`

Named groups used to cluster related sites. A `logHere(...)` placeholder declares
its groups via the `grp` param; the reconciler resolves each name to a group here.

| Column        | Type       | Description                                                                  |
| ------------- | ---------- | ---------------------------------------------------------------------------- |
| `group_id`    | INTEGER PK | Auto-incremented by `MAX(group_id)+1` inside a transaction.                  |
| `hide`        | INTEGER    | Hide flag (0/1). When 1, new events for the group's sites default to hidden. |
| `ts`          | TEXT       | PST timestamp when the group was created.                                    |
| `description` | TEXT       | Group name. **Unique** (case-insensitive) via `idx_groups_desc`.             |

Group names are unique: `idx_groups_desc` is a `UNIQUE INDEX` on
`description COLLATE NOCASE`. On startup `cleanupGroupDescriptions()` renames any
NULL, blank, or duplicate name to `Group <group_id>` before the index is enforced.

### `site_groups`

Many-to-many join between `log_sites` and `log_groups`.

| Column     | Type    | Description                 |
| ---------- | ------- | --------------------------- |
| `log_id`   | INTEGER | FK → `log_sites.log_id`.    |
| `group_id` | INTEGER | FK → `log_groups.group_id`. |

Primary key: `(log_id, group_id)`. Index: `idx_site_groups_group` on `(group_id)`.

---

## Key operations (unilogDb.js exports)

| Function                                   | Description                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `insertEvent({ logId, pid, message })`     | Insert one log event. `ts` is stamped here.                                                                 |
| `createSite(site)`                         | Allocate next `log_id`, insert into `log_sites`, link to any `groupIds`. Returns the new id. Transactional. |
| `refreshSite({ logId, srcFile, srcLine })` | Update `src_file` / `src_line` for an existing active site.                                                 |
| `querySites(logIds[])`                     | Return `{ logId → srcLine }` map for a set of ids.                                                          |
| `tombstoneSite(logId)`                     | Set `removed_at` on a site whose source line was deleted.                                                   |
| `createGroup({ description })`             | Allocate + insert a `log_groups` row. Returns new `group_id`. Transactional.                                |
| `findGroupByDescription(description)`      | Return the `group_id` for a name (case-insensitive), or null.                                               |
| `findOrCreateGroup({ description })`       | Find a named group or create it. Returns `{ id, created }`.                                                 |
| `dbInfo()`                                 | Return `{ path, counts }` with row counts for all four tables.                                              |

---

## Querying

**Always use [unilog/query.js](../query.js).** Never open the DB directly and never
hand-roll an `ssh … sqlite3` one-liner — query.js already knows the host, the DB
path, and the schema, and it always passes `-readonly` so it cannot disturb
tv-srvr (the single writer).

```bash
node unilog/query.js --file srvr/index.js --last 100          # recent events from a file
node unilog/query.js --file srvr/index.js --line 311 --last 5 # specific source line
node unilog/query.js --id 42 --last 50                        # by log_id
node unilog/query.js --level error --last 20                  # by level
node unilog/query.js --pid tv-down --level error --last 20    # by process / level
node unilog/query.js --project down --last 30                 # by project column
node unilog/query.js --group "tv play" --last 30              # by group name (partial, no case)
node unilog/query.js --msg "intro" --last 30                  # message substring
node unilog/query.js --since "-1 hour" --pid tv-srvr --asc    # time-bounded
node unilog/query.js --level error --last 50 --visible        # only unhidden events
node unilog/query.js --file srvr/index.js --sites             # list log_sites rows
node unilog/query.js --groups                                 # all groups + counts
node unilog/query.js --json --id 42                           # raw JSON rows
node unilog/query.js --dry-run --file srvr/index.js           # print SQL only
```

Filters combine with AND. At least one filter is required, except for `--groups`
and `--sql`.

### Anything the flags don't cover — `--sql`

`--sql` is the escape hatch for aggregates, joins, `DISTINCT`, `GROUP BY`, and
one-off shapes. It runs against the same read-only connection, so there is never
a reason to reach for the DB directly:

```bash
node unilog/query.js --sql "SELECT s.project, s.level, COUNT(*) n
  FROM log_events e JOIN log_sites s ON s.log_id = e.log_id
  WHERE e.ts >= datetime('now','-1 day') GROUP BY 1,2 ORDER BY n DESC"
```

Writes fail with `attempt to write a readonly database`. Field changes go through
tv-srvr, not here.

### Hidden events

`log_events.hide`: `0` = visible, `1` = group-hidden (the site belongs to a group
with `hide = 1`), `2` = dedup-suppressed duplicate.

**query.js includes hidden events by default.** Hiding is a client log pane
concern — it keeps the live view readable — but the hidden events are usually the
ones worth reading when debugging, and they are the large majority of the table
(~85%: 56k group-hidden and 20k dedup, against 14k visible). Filtering them out
by default would make most targeted queries silently return nothing.

Hidden rows are marked `hidden` (hide=1) or `dup` (hide=2) in the output so the
distinction is never lost. To narrow:

| Flag        | Effect                                               |
| ----------- | ---------------------------------------------------- |
| _(default)_ | everything                                           |
| `--nodup`   | drops dedup repeats (hide=2), keeps group-hidden     |
| `--visible` | only hide=0 — exactly what the client log pane shows |

`--sites` and `--groups` listings are never hide-filtered: a group with `hide = 1`
still lists, marked `HIDE`, and its sites still show their event counts. That
makes them the reliable way in when you don't know what to filter on yet.

### Output formats

| Mode       | Format                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| events     | `YYYY/MM/DD HH:MM:SS  pid  file:line [level] [hidden\|dup]  message`            |
| `--sites`  | `id=N  project  n=events  file:line  [level] [{groups}] [REMOVED]  description` |
| `--groups` | `id  name  sites=N  events=N  [HIDE]`                                           |
| `--sql`    | pipe-joined column header, then one pipe-joined row per result                  |

`--last N` always returns the **newest** N matches; `--asc` only flips the print
order. Multi-line messages are indented under their first line rather than being
split into separate rows.
