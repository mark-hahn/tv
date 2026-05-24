> **Warning:** This document was written on **2026-05-24**. The code may have changed since then — verify against source files before relying on specifics.

# Down Server (`apps/down`)

## Purpose

The down server is a Node.js service that runs on the remote server (`hahnca.com`). Its job is to watch a USB seedbox (`xobtlu@oracle.usbx.me`) for completed torrent downloads and automatically copy TV episodes to the local media library at `/mnt/media/tv/`. It also handles movie downloads from the same USB host and can process DVD VOB folders using makemkv.

The server runs continuously under pm2. Source is in `apps/down/src/`. There is no build step.

---

## Processing Cycle

### Timing

The cycle runs every **5 minutes** (`PROCESS_INTERVAL_MS`). It can also be triggered immediately via the `/startProc` HTTP endpoint (called by the client's down pane). If a cycle is already running when `/startProc` is received, it sets a flag to restart immediately after the current cycle finishes.

### Guard

At the start of every cycle, the server checks that `/mnt/media/tv/` is accessible and non-empty. If the mount is missing or empty (e.g., after a reboot before the drive spins up), the cycle is skipped and rescheduled.

### Startup sequence

On first start, the server acquires a TheTVDB API v4 bearer token (with exponential backoff, up to 10 retries). The first cycle runs after the token is obtained.

### Cycle steps

1. **`delOldFiles`** — Once per hour, SSHes to the USB host and deletes files older than 30 days from `~/files`. After the prune, scans USB directories and removes SQLite entries whose USB source directory no longer exists (`hourlyUsbPruneAndTvResync`). This runs async so it doesn't block the cycle.

2. **`checkFiles`** — SSHes to the USB host and runs `find files -type f -printf '%CY-%Cm-%Cd-%P-%s\n'` to get every file with its modification date and size. The raw output is filtered to remove `.rar` parts, screenshots, and non-video sidecar types (`.sfv`, `.nzb`, `.srt`, `.sub`, etc. are filtered at the `find` level). The resulting list is sorted by parsed title/season/episode. Also reads per-cycle state: `tv-inProgress.json`, the SQLite titles map, `srvr/data/tvdb.json` (the Emby map), and `srvr/data/flexget-history.json`. Then runs the **DVD pre-pass** to handle VIDEO_TS folders separately. Finally begins iterating files via `checkFile`.

3. **`checkFile`** (loop) — Processes one USB file at a time via `process.nextTick`. For each file, runs the decision chain (see below). If the file passes all filters, it calls `tvJson.addEntry()` to queue a download, which immediately starts a worker if a slot is available (up to 8 concurrent).

4. **Done** — After all files are processed, logs cycle timing and schedules the next cycle.

### Forced mode

When the `/forceDown` endpoint receives a list of USB paths, those files are processed as a forced cycle that bypasses most filters (Emby membership, already-on-disk, quality gate, watched check). If a cycle is running, the current file list is truncated so forced files are processed immediately.

---

## File Selection Decision Chain

Each USB file goes through these checks in order. The first failing check stops processing for that file.

1. **Locked path** — If the file's folder contains a `!unrar.lock` marker (still being extracted), skip.
2. **Extension filter** — Allowed: `mkv mp4 avi ts m2ts wmv srt ass ssa asa srr nfo jpg png`. Anything else is skipped silently.
3. **Previous error** — If the filename is in `tvJsonTitles` with `error=true`, skip. This is a subset of step 4 (step 4 would also skip it), but step 3 fires first so the log says `"SKIPPING *ERROR*"` instead of `"already downloaded/queued"`. Bypassed for forced downloads.
4. **Already in DB** — If the filename is in `tvJsonTitles` (any status, including error), skip. Bypassed for forced.
5. **In-progress map** — If the filename is in `tv-inProgress.json`, skip.
6. **`TV_BLOCKED` list** — Hardcoded filename substrings that are always blocked (see list at top of `main.js`). Examples: `sample`, `.FLEMISH.`, `Featurettes`, `Blacklist`, etc.
7. **Title/season/episode parse** — Uses `parse-torrent-title` on the filename (and folder name as fallback). Must produce a title, season, and episode number. If the file looks like a known Emby show but has no season/episode, it's recorded as an error entry. If it doesn't match any Emby show at all, it's silently skipped.
8. **Type check** — Must be `type === "episode"`. Non-episode files (e.g., movies parsed as such) are rejected.
9. **TheTVDB lookup** — Searches TheTVDB v4 API for the title to get a canonical series name. Results are cached per-cycle. If the file title doesn't match but the parent folder title does, retries with the folder title. If TVDB returns no match and the title is also not in the Emby map, silently skips. If the title IS in Emby but TVDB has no match, records a `thetvdb: no series match` error entry. Also tries `title and ...` → `title & ...` variant for ampersand shows.
10. **Series name remapping** — If the resolved TVDB name has an entry in `data/tv-map`, it is remapped to the mapped name. This handles TVDB name inconsistencies.
11. **Emby membership** — The resolved series name must match a show in `srvr/data/tvdb.json` with `inEmby: true`. Bypassed for forced.
12. **Already on disk** — If the episode file already exists at the target Season path, marks the entry as finished in SQLite and skips the download.
13. **Watched episode filter** — If `embyMap[show].watchedEpis` includes this season+episode, skips. Bypassed for forced.
14. **Flex quality gate** (automatic downloads only, not forced and not from-tor):
    - Checks `srvr/data/flexget-history.json` for the series+S+E key.
    - If the episode has a history entry and is already on disk: only downloads if the USB file has higher resolution (2160 > 1080 > 720 > 480 > 640) or higher bit depth (10-bit > 8-bit). If the USB is better, renames the existing disk file to `.old` before downloading.
    - If there is no flexget history and a same-or-better file is already on disk: skips.
    - If there is flexget history but the file never landed on disk: always downloads regardless of quality.
15. **Queue** — Creates a SQLite entry with `status: 'waiting'`. A worker starts immediately if a slot is free.

### Destination filename renaming

Before queuing, the server may set a `destTitle` (the filename to use on disk, distinct from the SQLite `title` which is always the original USB filename):

- Files without `SxxExx` in the name are renamed to `<EmbyFolderName> SxxExx<ext>` so Emby matches them reliably.
- Files with a compact `NNN` prefix (e.g., `101-Title.avi`) or `NxN` prefix are renamed to `SxxExx - Title<ext>`.
- Files with `NNN` embedded inside the name (e.g., `Show.101.Title.avi`) are also renamed.
- The original USB filename is always preserved in the SQLite `title` column.

---

## Download Workers (`tvJson.js` + `worker.js`)

### Worker pool

`tvJson.js` manages a pool of up to **8 concurrent** Node.js `worker_threads`. Workers are started when entries are added to the DB and when an existing worker finishes.

### What a worker does

Each worker (`worker.js`) handles exactly one file:

1. Sets `entry.status = 'downloading'` and reports to parent via `postMessage`.
2. Renames any existing same-SxxExx video file to `.old` in the target directory (quality upgrade path).
3. Runs `rsync -av --protect-args --partial-dir=.rsync-tmp -e ssh --timeout=20 --info=progress2 <usbHost>:<usbPath><title> <localPath><destTitle>`.
4. Parses rsync `--info=progress2` output to extract `%`, ETA, and speed. Sends progress updates to parent every 500ms.
5. On rsync exit code 23 (missing directory): tries to locate the file under `~/files` via SSH `find` and retries once with the corrected path.
6. On success: sends `{type: 'finished', entry: {status: 'finished'}}`.
7. On failure: sends finished with the error message as `status`.

### Worker lifecycle (parent side)

- On `update`: updates the SQLite row via `updateEntryByProcId`.
- On `finished` with `status === 'finished'`: calls `postHistory` with type `endDown`, removes from `tv-inProgress.json`.
- On `finished` with any error status: marks `error=1` in SQLite, logs to `tv.log`, removes from `tv-inProgress.json`.
- Either way: decrements worker count and starts the next oldest `waiting` entry.

### Error-worth-downloading

Three error reasons cause the file to be downloaded anyway, to `/mnt/media/tv-errors/` instead of the normal Season dir: `parse-torrent-title:...` (couldn't parse S/E), `non-episode`, and `thetvdb: no series match`. These appear in the down pane as `error-downloaded` status.

---

## Movie Pipeline (`movie-rsync.js`)

Runs on a separate timer alongside the TV cycle.

- **Poll interval**: 60 seconds normally; drops to 5 seconds for up to 60 seconds after detecting a newly-finished torrent.
- **Source**: queries qBittorrent Web API at `oracle.usbx.me:12041` for torrents in `/home/xobtlu/movies` with finished states (`uploading`, `stalledUP`, `stoppedUP`, `forcedUP`).
- **Copy method**: parallel `dd` over SSH using 8 streams, with `fallocate` pre-allocation. Files go to `/mnt/media/movies/`.
- **Deduplication**: if the local file already has the expected byte count, creates a `.tv-done` sidecar on the USB side and skips the copy.
- **Completion**: on success, creates `.tv-done` sidecar on USB.
- HTTP endpoints: `GET /movieDownloads`, `POST /movieCycle`, `POST /movieKill`.

---

## DVD Pipeline

When the USB host has torrent folders containing `VIDEO_TS` directories (DVD rips with `.VOB`/`.IFO`/`.BUP` files), the down server handles them with a multi-step pipeline during `checkFiles`:

1. **Scan**: SSHes to find all VOB/IFO/BUP files under VIDEO_TS dirs.
2. **Match to Emby**: parses the torrent folder name to a show title and matches it against the Emby map. Skips if not in Emby.
3. **Stage**: queues each individual VOB/IFO/BUP file as a normal download entry (destination: `/mnt/media/tmp-dvd/`). Workers download them via rsync.
4. **makemkv**: once all files for a disc are staged, runs `/snap/bin/makemkvcon --robot mkv file:<stagingDir> all <outputDir>`. Progress is tracked via `PRGV:` lines in stdout. Timeout: 4 hours.
5. **Move**: output MKVs are sorted by makemkv title index, filtered (MKVs ≥ 2× median size are assumed to be compilation titles and dropped), deduplicated by file size, and renamed to `<ShowName.DotCase>.SxxExx.DVDRip.mkv` in the correct Season directory.
6. **Cleanup**: staging dir and makemkv output dir are deleted. A `DVD:makemkv:<vtsDirRelative>` guard card is written to SQLite with `status: 'finished'` so the disc is never re-processed.
7. The individual VOB/IFO/BUP entries are deleted from SQLite after MKVs are moved.

Season is inferred from path components (e.g., `NORMS1` → season 1, `Season 2` → season 2).

---

## HTTP Endpoints (port 3003)

All endpoints support CORS. Nginx proxies these under `/tv-api/api/tvproc/` and `/tv-api/` prefixes, which the server strips internally.

| Method     | Path              | Description                                                                                                                                                                                        |
| ---------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST` | `/startProc`      | Trigger an immediate USB scan cycle                                                                                                                                                                |
| `POST`     | `/retry`          | Delete a DB entry by `{title}` and trigger rescan; used when a file errored and you want a fresh attempt                                                                                           |
| `GET`      | `/downloads`      | Returns the most recent 200 SQLite entries (ascending procId)                                                                                                                                      |
| `GET/POST` | `/checkFiles`     | Given an array of filenames, returns which are already downloaded (status=finished, error=0). Returns `{existingTitles, existingProcids, tvEntries}`                                               |
| `POST`     | `/deleteProcids`  | Delete DB rows + local files by `{procIds: [...]}`                                                                                                                                                 |
| `POST`     | `/deleteErrors`   | Delete all rows where `error != 0`                                                                                                                                                                 |
| `POST`     | `/forceDown`      | Force-download specific USB file paths. Body: `{files: [...usbFilePaths], fromTor: bool}` or plain array. Bypasses Emby/quality/watched filters. If `fromTor: true`, marks the paths as tor-origin |
| `POST`     | `/torFiles`       | Register USB file paths as tor-origin without forcing an immediate download. They will be treated as from-tor (not flex) when the next normal cycle picks them up                                  |
| `POST`     | `/delItems`       | Delete DB entries and local files by `{titles: [...]}`                                                                                                                                             |
| `GET`      | `/movieDownloads` | Returns current movie copy job status                                                                                                                                                              |
| `POST`     | `/movieCycle`     | Manually trigger a movie cycle                                                                                                                                                                     |
| `POST`     | `/movieKill`      | Kill all active movie dd streams                                                                                                                                                                   |

### Tor vs Flex vs Forced

- **Forced**: file paths explicitly sent via `/forceDown`. All filters bypassed. Existing local file is deleted before re-download.
- **From-tor**: paths registered via `/torFiles` or `/forceDown` with `fromTor: true`. Skip the flex quality gate but still go through Emby/watched/disk-exists checks.
- **Flex** (default): automatic discovery during USB scan. Full filter chain including quality gate.

---

## External APIs Used

| API                 | URL                                                  | Purpose                                                                                               |
| ------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| TheTVDB v4          | `https://api4.thetvdb.com/v4/login` and `/v4/search` | Login for bearer token; search series by title to get canonical name                                  |
| qBittorrent Web API | `http://oracle.usbx.me:12041/api/v2/...`             | Movie pipeline: list finished torrents                                                                |
| srvr history        | `https://hahnca.com/tv-srvr/api/history`             | Fire-and-forget event logging (skipDown, acceptDown, startDown, endDown, errorSync, rejDown, dvdProc) |

---

## Database (`data/tv.sqlite`)

SQLite with WAL mode. Single table: `tv_entries`.

### Schema

| Column        | Type           | Notes                                                                                                                                                           |
| ------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | TEXT PK        | Original USB filename. For DVD staging files, the relative path (e.g., `Show/DISC1/VIDEO_TS/VTS_01_1.VOB`). For DVD guard cards, `DVD:makemkv:<vtsDirRelative>` |
| `procId`      | INTEGER UNIQUE | Sequential ID assigned on add; used for ordering/capping in `/downloads`                                                                                        |
| `usbPath`     | TEXT           | Remote folder path, e.g., `~/files/TorrentFolder/`                                                                                                              |
| `localPath`   | TEXT           | Local destination directory, e.g., `/mnt/media/tv/Show Name/Season 1/`                                                                                          |
| `destTitle`   | TEXT           | Renamed filename to use on disk (null = same as title)                                                                                                          |
| `seriesName`  | TEXT           | Canonical series name from TVDB                                                                                                                                 |
| `status`      | TEXT           | `waiting`, `downloading`, `finished`, `error-downloaded`, or an error message string                                                                            |
| `progress`    | INTEGER        | 0–100                                                                                                                                                           |
| `eta`         | INTEGER        | Unix timestamp of estimated completion                                                                                                                          |
| `speed`       | INTEGER        | Bits per second                                                                                                                                                 |
| `season`      | INTEGER        |                                                                                                                                                                 |
| `episode`     | INTEGER        |                                                                                                                                                                 |
| `fileSize`    | INTEGER        | Bytes                                                                                                                                                           |
| `dateStarted` | INTEGER        | Unix timestamp                                                                                                                                                  |
| `dateEnded`   | INTEGER        | Unix timestamp                                                                                                                                                  |
| `inProgress`  | INTEGER        | 0/1                                                                                                                                                             |
| `error`       | INTEGER        | 0/1                                                                                                                                                             |
| `reason`      | TEXT           | Error reason string                                                                                                                                             |
| `fromFlex`    | INTEGER        | 0/1 — whether this was a flex (automatic) download                                                                                                              |
| `sequence`    | INTEGER        | Per-cycle sequence number                                                                                                                                       |

### Queries useful for debugging

```bash
ssh hahnca.com
cd /root/dev/apps/tv-dev/apps/down
sqlite3 data/tv.sqlite "SELECT procId, title, status, error, reason FROM tv_entries WHERE title LIKE '%ShowName%' ORDER BY procId DESC LIMIT 20;"
sqlite3 data/tv.sqlite "SELECT procId, title, status, error, reason FROM tv_entries WHERE error=1 ORDER BY procId DESC LIMIT 40;"
sqlite3 data/tv.sqlite "SELECT COUNT(*) FROM tv_entries WHERE status='finished';"
```

### Backup

SQLite is backed up with `sqlite3 .backup` four times per day: 05:30, 11:30, 17:30, 23:30 PST. Backup file: `data/tv.sqlite.backup`.

---

## Flat Data Files

| File                      | Description                                                                                                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/tv.sqlite`          | Primary download state (SQLite)                                                                                                                                                                                                                                                     |
| `data/tv.sqlite.backup`   | Scheduled backup                                                                                                                                                                                                                                                                    |
| `data/tv-inProgress.json` | `{filename: "YYYY/MM/DD-HH:MM:SS"}` map of currently in-flight titles. Cleared on restart. Used as a secondary dedup guard alongside the DB                                                                                                                                         |
| `data/tv-map`             | Newline-delimited `OldName,NewName` pairs. TVDB-resolved names matching an entry are remapped. Example: handle TVDB name changes                                                                                                                                                    |
| `data/reject.log`         | Cleared at the start of each cycle. One line per rejected file: `timestamp \| filename \| reason`. Only covers files that reached the `badFile()` path (parse failure, non-episode, TVDB no-match for known Emby show). Silent skips (blocked, extension, not-in-emby) are NOT here |
| `data/misc/tv.log`        | Startup marker (`==== tv-down started ====`). Error lines from workers when a download fails (only when `LOG_APPS_DOWN_DATA_MISC_TV_LOG = true` in `tvJson.js`, which is `false` by default). Trace lines when `DEBUG_SHOW` is set                                                  |

**Cross-server reads** (these files live in `apps/srvr/data/` and are read by down each cycle):

| File                                | Description                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `../srvr/data/tvdb.json`            | Emby show map. Keys are series names; each entry has `inEmby`, `tvdbId`, `path` (Emby folder name), `watchedEpis` |
| `../srvr/data/flexget-history.json` | Flexget download history keyed by `seriesName\x00Sxx\x00Exx`. Used for quality gate decisions                     |

---

## Logs

| Log           | Location                                 | Contents                                                                                                                              |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| pm2 / console | pm2 log for `tv-down`                    | Cycle start/skip messages, TVDB errors, rsync errors, DVD progress. This is the main runtime log                                      |
| `tv.log`      | `data/misc/tv.log`                       | Startup marker; trace output when `DEBUG_SHOW` is set in `main.js`; worker error lines if `LOG_APPS_DOWN_DATA_MISC_TV_LOG` is enabled |
| `reject.log`  | `data/reject.log`                        | Files rejected this cycle with reasons. Cleared each cycle                                                                            |
| History API   | `https://hahnca.com/tv-srvr/api/history` | Every decision (skip, accept, start, end, error) is fire-and-forget posted here                                                       |

---

## Chokidar File Watchers

`tvJson.js` maintains a `chokidar` watcher for every directory under `/mnt/media/tv/`. On `unlink` or `rename`/`move` events, it calls `tvResync()`, which refreshes the set of watched directories. This ensures new Season directories created by downloads are immediately watched. Watchers do **not** delete DB entries when a local file is removed (that would cause re-downloads of intentionally deleted episodes).

---

## Debugging Why a USB File Was or Wasn't Downloaded

### Step 1 — Check `reject.log` (cleared each cycle)

```bash
ssh hahnca.com cat /root/dev/apps/tv-dev/apps/down/data/reject.log
```

Each line: `timestamp | filename | reason`. Reasons include:

- `parse-torrent-title: found title but no season/episode` — filename couldn't be parsed
- `non-episode` — parsed as a movie/special
- `thetvdb: no series match` — TVDB returned nothing and the show IS in Emby

### Step 2 — Check SQLite for the filename

```bash
ssh hahnca.com sqlite3 /root/dev/apps/tv-dev/apps/down/data/tv.sqlite \
  "SELECT procId, title, status, error, reason, seriesName, season, episode FROM tv_entries WHERE title LIKE '%filename%';"
```

- `status='finished'` → already downloaded; down will skip it every cycle
- `error=1` → a previous cycle errored; down will skip it (won't retry unless you call `/retry` or `/deleteErrors`)
- `status='waiting'` or `status='downloading'` → currently queued or in progress

### Step 3 — Check if the show is in Emby

```bash
ssh hahnca.com node -e "
  const d = JSON.parse(require('fs').readFileSync('/root/dev/apps/tv-dev/apps/srvr/data/tvdb.json','utf8'));
  const k = Object.keys(d).find(x => x.toLowerCase().includes('showname'));
  console.log(k, d[k]?.inEmby);
"
```

If `inEmby` is `false` or the show isn't in the file, down will silently skip every episode.

### Step 4 — Enable trace logging for a specific show

In `apps/down/src/main.js`, set `DEBUG_SHOW` to the show name (e.g., `"Lost"`). Restart the server. Every decision for that show will be logged to console (pm2 log) and `tv.log`. Reset to `""` when done.

```js
const DEBUG_SHOW = "Lost"; // set this, then deploy and restart
```

### Step 5 — Check flexget-history.json for quality gate

```bash
ssh hahnca.com node -e "
  const d = JSON.parse(require('fs').readFileSync('/root/dev/apps/tv-dev/apps/srvr/data/flexget-history.json','utf8'));
  const k = Object.keys(d).find(x => x.toLowerCase().includes('showname'));
  console.log(k, JSON.stringify(d[k]));
"
```

If an entry exists for the show+season+episode with a `sent` timestamp, the quality gate is active. The USB file must be higher resolution or bit depth than whatever is on disk.

### Step 6 — Force a retry

Via HTTP (from within the LAN):

```bash
# Retry a specific errored file
curl -X POST http://hahnca.com:3003/retry -H 'Content-Type: application/json' -d '{"title":"filename.mkv"}'

# Clear all error entries
curl -X POST http://hahnca.com:3003/deleteErrors

# Trigger an immediate cycle
curl http://hahnca.com:3003/startProc
```

### Common skip reasons (silent, not in reject.log)

| Reason                         | Explanation                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Extension not in allowed list  | File type not supported                                                                          |
| `TV_BLOCKED` match             | Hardcoded block in `main.js` (e.g., `Featurettes`, `Commentary`, `german`, specific show titles) |
| `inEmby: false`                | Show is in tvdb.json but marked as not in Emby                                                   |
| Show not in tvdb.json at all   | TVDB search returned no results and show name has no Emby match                                  |
| Already on disk                | File already exists at the Season path                                                           |
| Watched episode                | `watchedEpis` in tvdb.json includes this S/E                                                     |
| Already queued/downloaded      | SQLite already has a row for this filename                                                       |
| Flex skip: same/better quality | Disk file is same or better resolution/bit-depth than USB file                                   |

---

## Dependencies

| Package               | Purpose                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| `better-sqlite3`      | SQLite for download state                                                            |
| `chokidar`            | File system watchers on `/mnt/media/tv/`                                             |
| `parse-torrent-title` | Parse title/season/episode from filenames                                            |
| `request`             | HTTP client for TheTVDB API                                                          |
| `mkdirp`              | Recursive directory creation                                                         |
| `rimraf`              | Recursive delete (legacy use)                                                        |
| `@tv/share`           | `smartTitleMatch`, `parseFileSeasonEpisode`, `parseTitleFromFilename`, `postHistory` |

---

## Source Files

| File                          | Description                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `src/main.js`                 | Main cycle logic: USB file scanning, decision chain, HTTP server, DVD pipeline    |
| `src/tvJson.js`               | SQLite state management, worker lifecycle, chokidar watchers, DB backup scheduler |
| `src/worker.js`               | Worker thread: rsync execution, progress parsing, missing-dir retry               |
| `src/movie-rsync.js`          | Movie pipeline: qBittorrent polling, parallel dd copy                             |
| `scripts/self-check-flush.js` | Dev utility: polls `/downloads` and SQLite mtime to observe persistence activity  |
