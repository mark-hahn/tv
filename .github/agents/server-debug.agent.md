---
description: "Use when: debugging on the remote server (hahnca.com), querying unilog logs directly with sqlite3, inspecting pm2 process state, checking server files, or any question answered by looking at what the server logged."
tools: [read, edit, search, execute, todo]
---

You are debugging on **hahnca.com** (the remote server). You have direct filesystem
access — no SSH hop needed. Key facts:

- **Workspace root:** `/root/dev/apps/tv/`
- **pm2 processes:** `tv-srvr`, `tv-down`, `tv-api`, `tv-asr`
- **pm2 logs:** `pm2 logs <name> --lines 100`
- **unilog DB:** `/root/dev/apps/tv/unilog/unilog.sqlite` (read-only queries only — tv-srvr is the sole writer)
- **Timestamps** everywhere are PST `YYYY/MM/DD HH:MM:SS` (hour 24 normalized to 00)

---

# What unilog is

unilog is a centralized, database-backed logging system. It replaces scattered
`console.log` / `log` / `loge` calls with numbered `unilog(<id>, …)` calls that
record every emission as a structured row in SQLite. You can query logs across
**all** processes from one place instead of grepping separate pm2 log files.

Every log call in source looks like:

```js
unilog(412, `detected add: ${p}`);
```

The numeric id links to a `log_sites` row that carries the metadata: source file,
line, level, tag, description. At runtime only the id + rendered message are stored
in `log_events`; a JOIN reattaches the location info.

---

# Querying unilog with sqlite3

Set a shell alias at the start of your session:

```bash
alias ulog='sqlite3 -readonly /root/dev/apps/tv/unilog/unilog.sqlite'
```

The `-readonly` flag prevents accidental writes to the live DB.

## Schema

`log_sites` — one row per instrumentation point in source:

| column                      | meaning                                          |
| --------------------------- | ------------------------------------------------ |
| `log_id`                    | PK; the number in `unilog(<id>, …)`              |
| `tag`                       | optional category, e.g. `chokidar`               |
| `description`               | human note about the site                        |
| `level`                     | `info` \| `warn` \| `error` \| `debug`           |
| `src_file`                  | repo-relative path, e.g. `apps/srvr/index.js`    |
| `src_line`                  | 1-based line number                              |
| `project`                   | `srvr`, `down`, `api`, …                         |
| `created_at` / `removed_at` | PST timestamps; `removed_at` set when tombstoned |

`log_events` — one row per runtime emission:

| column    | meaning                                     |
| --------- | ------------------------------------------- |
| `id`      | autoincrement sequence                      |
| `log_id`  | FK → `log_sites.log_id`                     |
| `pid`     | emitting process, e.g. `tv-srvr`, `tv-down` |
| `ts`      | PST timestamp (stamped by the collector)    |
| `message` | rendered message                            |

Almost every useful query JOINs the two on `log_id`.

## Interactive session setup

```bash
sqlite3 -readonly /root/dev/apps/tv/unilog/unilog.sqlite
sqlite> .mode column
sqlite> .headers on
sqlite> .width 6 19 8 28 5 8 60
```

## Common queries

### Most recent events (all processes)

```bash
ulog "SELECT e.ts, e.pid, s.src_file||':'||s.src_line AS loc, e.message
      FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
      ORDER BY e.id DESC LIMIT 100;"
```

### Recent events from one file

```bash
ulog "SELECT e.ts, e.pid, s.src_line, e.message
      FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
      WHERE s.src_file LIKE '%srvr/index.js%'
      ORDER BY e.id DESC LIMIT 100;"
```

### Events from a specific source line

```bash
ulog "SELECT e.ts, e.pid, e.message
      FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
      WHERE s.src_file LIKE '%srvr/index.js%' AND s.src_line = 311
      ORDER BY e.id DESC LIMIT 100;"
```

### By log_id

```bash
ulog "SELECT e.ts, e.pid, e.message FROM log_events e
      WHERE e.log_id = 42 ORDER BY e.id DESC LIMIT 50;"
```

### By process and level

```bash
ulog "SELECT e.ts, s.src_file||':'||s.src_line AS loc, e.message
      FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
      WHERE e.pid = 'tv-down' AND s.level = 'error'
      ORDER BY e.id DESC LIMIT 50;"
```

### By tag

```bash
ulog "SELECT e.ts, e.pid, e.message
      FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
      WHERE s.tag = 'chokidar' ORDER BY e.id DESC LIMIT 50;"
```

### Message substring search

```bash
ulog "SELECT e.ts, e.pid, s.src_file||':'||s.src_line AS loc, e.message
      FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
      WHERE e.message LIKE '%intro%'
      ORDER BY e.id DESC LIMIT 50;"
```

### Time-bounded (last hour)

```bash
ulog "SELECT e.ts, e.pid, e.message
      FROM log_events e JOIN log_sites s ON e.log_id = s.log_id
      WHERE e.pid = 'tv-srvr' AND e.ts >= datetime('now','-1 hour')
      ORDER BY e.id ASC LIMIT 200;"
```

> `ts` is `YYYY/MM/DD HH:MM:SS` (slashes). For exact `datetime()` math convert:
> `replace(substr(e.ts,1,10),'/','-')||substr(e.ts,11) >= datetime('now','-1 hour')`

### List instrumentation sites in a file

```bash
ulog "SELECT log_id, src_line, tag, level, description
      FROM log_sites
      WHERE src_file LIKE '%srvr/index.js%' AND removed_at IS NULL
      ORDER BY src_line;"
```

### Live tail

```bash
watch -n2 "sqlite3 -readonly /root/dev/apps/tv/unilog/unilog.sqlite \
  \"SELECT e.ts, e.pid, e.message FROM log_events e
    ORDER BY e.id DESC LIMIT 20;\""
```

## Tips

- Filter `s.removed_at IS NULL` to exclude deleted sites.
- Discover pid values: `ulog "SELECT DISTINCT pid FROM log_events;"`
- `level` lives on `log_sites` not `log_events` — level filters need the JOIN.
- Busiest sites: `ulog "SELECT log_id, COUNT(*) n FROM log_events GROUP BY log_id ORDER BY n DESC LIMIT 20;"`
- **Never run UPDATE/INSERT/DELETE** — tv-srvr is the only writer.
