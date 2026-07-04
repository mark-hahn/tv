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
| `tag`         | TEXT       | Optional category string, e.g. `chokidar`, `ws`. Extracted from a leading `[tag]` in the message or from the stub `{tag=…}` field.                               |
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

| Column        | Type       | Description                                                                   |
| ------------- | ---------- | ----------------------------------------------------------------------------- |
| `group_id`    | INTEGER PK | Auto-incremented by `MAX(group_id)+1` inside a transaction.                   |
| `group_type`  | TEXT       | Free-form category string (optional). Set only when a group is first created. |
| `ts`          | TEXT       | PST timestamp when the group was created.                                     |
| `description` | TEXT       | Group name. **Unique** (case-insensitive) via `idx_groups_desc`.              |

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

| Function                                        | Description                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `insertEvent({ logId, pid, message })`          | Insert one log event. `ts` is stamped here.                                                                 |
| `createSite(site)`                              | Allocate next `log_id`, insert into `log_sites`, link to any `groupIds`. Returns the new id. Transactional. |
| `refreshSite({ logId, srcFile, srcLine })`      | Update `src_file` / `src_line` for an existing active site.                                                 |
| `querySites(logIds[])`                          | Return `{ logId → srcLine }` map for a set of ids.                                                          |
| `tombstoneSite(logId)`                          | Set `removed_at` on a site whose source line was deleted.                                                   |
| `createGroup({ groupType, description })`       | Allocate + insert a `log_groups` row. Returns new `group_id`. Transactional.                                |
| `findGroupByDescription(description)`           | Return the `group_id` for a name (case-insensitive), or null.                                               |
| `findOrCreateGroup({ description, groupType })` | Find a named group or create it. Never changes an existing group's `group_type`. Returns `{ id, created }`. |
| `dbInfo()`                                      | Return `{ path, counts }` with row counts for all four tables.                                              |

---

## Querying

Use [unilog/query.js](../query.js) locally — it SSHes to the remote and runs `sqlite3`:

```bash
node unilog/query.js --file srvr/index.js --last 100          # recent events from a file
node unilog/query.js --file srvr/index.js --line 311 --last 5 # specific source line
node unilog/query.js --id 42 --last 50                        # by log_id
node unilog/query.js --tag chokidar --last 20                  # by tag
node unilog/query.js --pid tv-down --level error --last 20    # by process / level
node unilog/query.js --msg "intro" --last 30                   # message substring
node unilog/query.js --since "-1 hour" --pid tv-srvr --asc    # time-bounded
node unilog/query.js --file srvr/index.js --sites             # list log_sites rows
node unilog/query.js --dry-run --file srvr/index.js           # print SQL only
```

Output format — events: `YYYY/MM/DD HH:MM:SS  pid  file:line  [tag]  message`

Output format — `--sites`: `id=N  file:line  [tag]  level  description`
