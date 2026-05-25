# srvr — Server Documentation

> **Timestamp: 2026-05-24**
> ⚠️ Code changes frequently. This document describes the server as of the timestamp above. Details may be out of date.

---

## Overview

`apps/srvr` is the central Node.js backend server for the TV-series web app. It runs on `hahnca.com` under pm2 and provides:

- A **WebSocket server** for real-time push notifications to clients
- An **HTTPS REST API** (port 8737) for all data and file operations
- An **internal HTTP server** (port 8739, localhost only) for inter-service calls from the `down` server
- Background automation: Flexget torrent fetching, Emby library sweeps, subtitle pipeline, and tvdb data management

Entry point: `apps/srvr/index.js` (~7400 lines). Source modules live in `apps/srvr/src/`.

---

## Ports

| Port | Protocol          | Bound to       | Purpose                             |
| ---- | ----------------- | -------------- | ----------------------------------- |
| 8736 | WebSocket (plain) | all interfaces | Real-time push to web clients       |
| 8737 | HTTPS             | all interfaces | REST API consumed by browser client |
| 8739 | HTTP              | 127.0.0.1 only | Internal calls from `down` server   |

---

## WebSocket RPC (port 8736)

The WebSocket server handles a small number of **client-initiated function calls**. Most business logic has been moved to the HTTP API; the WS layer is primarily for:

- **Push notifications** — server broadcasts events to all connected clients via `notifyClients(notification, data)`.
- `register` — client identifies itself (no response).
- `handleAsr` — kill the currently-running ASR (speech-to-text) process.
- `handleFix` — delegate to `src/fix.js` for subtitle fix operations.
- `handleEmb` — delegate to `src/emb.js` for embedded subtitle extraction.
- `tvRemoteAction` — relay TV-remote button presses to all other connected clients (collision avoidance).
- `tvRemoteCollision` / `tvRemoteUnlock` — remote-control locking protocol between multiple clients.
- `skipIntro` — trigger an Emby seek to skip a show's intro on the Living Room TV.

### WebSocket Notifications (server → client)

The server broadcasts these notifications via `notifyClients`:

| Notification                      | Description                                              |
| --------------------------------- | -------------------------------------------------------- |
| `tvdbUpdated`                     | A show's tvdb record changed (debounced 500 ms per show) |
| `showUpdating`                    | A show was enqueued for TVDB processing                  |
| `showQueueEmpty`                  | The TVDB update queue drained                            |
| `nowPlaying`                      | What is currently playing on Emby (from `down` server)   |
| `missingEpisodeWarning`           | A watched episode is being skipped                       |
| `showDiskChanged`                 | A video file was added/removed from `/mnt/media/tv`      |
| `asr-log`                         | A line of ASR (speech recognition) log output            |
| `asr-queue-update`                | ASR queue length / running state changed                 |
| `chksrt-count`                    | Number of items in the subtitle-check queue              |
| `subs-progress`                   | Subtitle pipeline step completed for a video             |
| `emb-log`                         | Embedded subtitle extraction log line                    |
| `tvMuteState`                     | TV mute state relay from `down` server                   |
| `subtitleMismatch`                | Subtitle mismatch detected by internal service           |
| `tvRemoteAction`                  | Remote button press relayed between clients              |
| `tvRemoteLock` / `tvRemoteUnlock` | Remote collision lock/unlock                             |

---

## HTTP REST API (port 8737 — HTTPS)

All routes use the helper `apiWrapper` which extracts `req.query` (GET) or `req.body` (POST) and forwards to the async handler. Errors return `{ error: message }` with HTTP 500.

### Show & TVDB data

| Method | Path                         | Description                                                          |
| ------ | ---------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/getAllTvdb`            | Full tvdb.json object; `?hasEmby=1` filters to Emby shows            |
| GET    | `/api/getShowsFromDisk`      | Scan `/mnt/media/tv` and return `{ showName: [maxDate, totalSize] }` |
| GET    | `/api/getRejects`            | Array of show names in the reject list                               |
| GET    | `/api/getNoEmbys`            | Array of tvdb records where `inEmby === false`                       |
| GET    | `/api/getGaps`               | Gap data extracted from tvdb records                                 |
| POST   | `/api/getNewTvdb`            | Fetch a new show from the TVDB API by name                           |
| POST   | `/api/debugTvdb`             | Debug dump of a tvdb record                                          |
| POST   | `/api/searchTvdbByImdbId`    | Search TVDB by IMDB ID                                               |
| POST   | `/api/getSeriesMapFromTvdb`  | Fetch season/episode list from TVDB API                              |
| POST   | `/api/getSeriesMapFromEmby`  | Fetch season/episode list from Emby                                  |
| POST   | `/api/getRemotes`            | Get IMDB/Rotten Tomatoes links for a show                            |
| POST   | `/api/getActorPage`          | Fetch actor info from TVDB                                           |
| POST   | `/api/searchActorsInNonEmby` | Search actors across non-Emby shows                                  |
| POST   | `/api/accessTvdb`            | Generic TVDB API access                                              |
| POST   | `/api/getTvmazeCrew`         | Fetch crew/cast info from TVmaze                                     |
| GET    | `/api/getVipActors`          | Get the VIP actors list                                              |
| POST   | `/api/setVipActors`          | Update the VIP actors list                                           |
| POST   | `/api/setTvdbFields`         | Set arbitrary fields on a tvdb record                                |
| POST   | `/api/addNoEmby`             | Add a show that isn't in Emby                                        |
| POST   | `/api/delNoEmby`             | Remove a non-Emby show record                                        |

### Reject / Pickup / Gap management

| Method | Path             | Description                                         |
| ------ | ---------------- | --------------------------------------------------- |
| POST   | `/api/addReject` | Add show to reject list (Flexget will not download) |
| POST   | `/api/delReject` | Remove show from reject list                        |
| POST   | `/api/addGap`    | Manually set a gap on a show                        |
| POST   | `/api/delGap`    | Clear a gap on a show                               |

### Emby integration

| Method | Path                       | Description                                           |
| ------ | -------------------------- | ----------------------------------------------------- |
| GET    | `/api/getDevices`          | List active Emby sessions/devices                     |
| POST   | `/api/triggerEmbySync`     | Trigger a full Emby library sweep immediately         |
| POST   | `/api/triggerShowGapCheck` | Re-run gap check for one show                         |
| POST   | `/api/triggerShowSelect`   | Process one show (user selected it in the UI)         |
| POST   | `/api/refreshEmbyItem`     | Refresh Emby metadata for one show, then re-process   |
| POST   | `/api/embySync`            | Run a full Emby sweep (used by createShowFolder flow) |
| GET    | `/api/embyTaskStatus`      | Poll Emby scheduled task status                       |
| POST   | `/api/skipIntro`           | Seek past intro on the Living Room TV                 |

### File system operations

| Method | Path                       | Description                                          |
| ------ | -------------------------- | ---------------------------------------------------- |
| POST   | `/api/getFile`             | List directory contents under `/mnt/media/tv`        |
| POST   | `/api/deletePath`          | Delete a file or directory under `/mnt/media/tv`     |
| POST   | `/api/delSeasonFiles`      | Delete all files in a season folder                  |
| POST   | `/api/createShowFolder`    | Create a show folder + season subdirs + `tvshow.nfo` |
| POST   | `/api/populateFilesOnDisk` | Rescan all shows and update `filesOnDisk` in tvdb    |

### Subtitle pipeline

| Method | Path                          | Description                                           |
| ------ | ----------------------------- | ----------------------------------------------------- |
| POST   | `/api/asr/subs/enqueue`       | Enqueue video files for the subtitle pipeline         |
| POST   | `/api/asr/gensrt/enqueue`     | Enqueue videos for ASR subtitle generation only       |
| POST   | `/api/asr/emb/generate`       | Extract embedded subtitle streams from MKV/MP4        |
| GET    | `/api/asr/chksrt/list`        | Get head of the subtitle-check queue                  |
| POST   | `/api/asr/chksrt/ok`          | Mark the current chksrt item as OK                    |
| POST   | `/api/asr/chksrt/gensrt`      | Move the current chksrt item to ASR generation        |
| POST   | `/api/asr/chksrt/select`      | Choose a subtitle for an episode; deletes others      |
| GET    | `/api/asr/chksrt/history`     | Get the subtitle selection history                    |
| POST   | `/api/asr/chksrt/history/add` | Record a subtitle selection decision                  |
| POST   | `/api/subsSearch`             | Search OpenSubtitles.com for a show/episode           |
| POST   | `/api/deleteSubFiles`         | Delete `.srt` sidecar files by file_id                |
| POST   | `/api/offsetSubFiles`         | Shift timestamps in `.srt` files by ms offset         |
| POST   | `/api/applySubOffset`         | Shift a single `.srt` file by ms offset               |
| GET    | `/api/subtitle-list`          | List subtitle tracks for a video file                 |
| GET    | `/api/episodeSubs`            | List subtitle tracks for a specific episode           |
| GET    | `/api/subtitle`               | Serve a subtitle as WebVTT (embedded or sidecar)      |
| GET    | `/api/episodeStats`           | Video file metadata via ffprobe + parse-torrent-title |
| POST   | `/api/getSubFileIds`          | List `.opnXXXXX` subtitle tags in a show folder       |

### ASR queue

| Method | Path                    | Description                                           |
| ------ | ----------------------- | ----------------------------------------------------- |
| GET    | `/api/asr/queue`        | Current ASR queue entries and running state           |
| POST   | `/api/asr/queue/add`    | Add video paths to the ASR queue                      |
| POST   | `/api/asr/queue/remove` | Remove an entry from the ASR queue (kills if running) |
| GET    | `/api/asr/log`          | Get the in-memory ASR log buffer (last 500 lines)     |
| POST   | `/api/asr/kill`         | Kill the currently running ASR process                |

### Video streaming

| Method | Path                  | Description                                                                                        |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/api/stream`         | Stream a video file; uses ffmpeg transcoding if needed; redirects to nginx for native h264/aac MP4 |
| GET    | `/api/introFirstFile` | Find the first unwatched episode file for a show                                                   |

### Flexget (torrent downloading)

| Method | Path                      | Description                                    |
| ------ | ------------------------- | ---------------------------------------------- |
| GET    | `/api/flexget-history`    | All sent/rejected torrent candidates           |
| POST   | `/api/flexget-run`        | Trigger a manual Flexget run (fire and forget) |
| GET    | `/api/flexget-run-stream` | Trigger Flexget and stream output as SSE       |
| GET    | `/api/flexget-status`     | Whether Flexget is currently running           |
| GET    | `/api/flexget-config`     | Current `config.yml` contents                  |

### Miscellaneous

| Method   | Path                       | Description                                          |
| -------- | -------------------------- | ---------------------------------------------------- |
| POST     | `/api/saveNote`            | Save a text note on a tvdb record; emails the note   |
| POST     | `/api/sendEmail`           | Send an email via Mailtrap                           |
| GET      | `/api/getLastViewed`       | Last-viewed timestamp per show                       |
| GET      | `/api/getSharedFilters`    | Shared filter state held in memory                   |
| POST     | `/api/setSharedFilters`    | Update shared filter state                           |
| GET      | `/api/getGroupCounts`      | Persistent group click counters                      |
| POST     | `/api/incrementGroupCount` | Increment a group click counter                      |
| GET      | `/api/getTmdb`             | TMDB show/episode/cast lookup                        |
| POST     | `/api/searchTmdbPerson`    | TMDB person search                                   |
| POST     | `/api/getStreamProviders`  | TMDB streaming provider lookup                       |
| GET      | `/api/snooze-list`         | List of snoozed shows                                |
| POST     | `/api/snooze`              | Snooze a show                                        |
| POST     | `/api/unsnooze`            | Un-snooze a show                                     |
| GET      | `/api/qbt-open`            | Serve an auto-login HTML page for qBittorrent Web UI |
| POST     | `/api/updateTvdb`          | Trigger a TVDB update cycle manually                 |
| GET/POST | `/api/history`             | Read or append to the history event log              |
| GET      | `/api/history/byHash`      | Look up a history event by torrent hash              |

### Internal endpoints (port 8739, localhost only — called by `down` server)

| Method | Path                           | Description                                   |
| ------ | ------------------------------ | --------------------------------------------- |
| POST   | `/internal/tv-state`           | Relay TV mute state to connected web clients  |
| GET    | `/internal/chksrt/preferred`   | Look up the preferred subtitle for an episode |
| POST   | `/internal/chksrt/mark-warned` | Mark a subtitle-mismatch warning as shown     |
| POST   | `/internal/subtitle-mismatch`  | Notify clients of a subtitle mismatch         |
| POST   | `/internal/nowPlaying`         | Update now-playing state from Emby polling    |

---

## Emby Integration

Emby runs at `http://hahnca.com:8096/emby`. The API key and user ID are hard-wired constants at the top of `index.js`. The `src/emby.js` module handles session/device queries and series-map fetching.

Key operations:

- **Full Emby sweep** (`runEmbyFullSweep`): Syncs all shows, detects new/removed shows, syncs collection flags (toTry, Continue, Mark, Linda), updates `inEmby` status, and queues changed shows for per-show processing. Runs every 10th background tick.
- **Per-show processing** (`tvdb.setPerShowCallback`): For each show, checks disk info, last-watched date, runs a gap check, fixes compact-NNN episode naming, scans for subtitle needs, and downloads OpenSubtitles in background.
- **Collections**: Four Emby collections are tracked by hard-wired ID (`toTry`, `continue`, `mark`, `linda`). Membership is synced into tvdb records as `inToTry`, `inContinue`, `inMark`, `inLinda`.
- **Gap check** (`emby.gapCheckOne`): Compares Emby episode data against tvdb records to detect file gaps, watch gaps, and whether a show is fully watched.
- **File watcher**: Chokidar watches `/mnt/media/tv` for video file adds/removes. On change, it updates tvdb disk info, triggers an Emby library refresh, polls until the scan completes, runs a gap check, and refreshes watchedEpis.
- **Skip intro**: `doSkipIntro` finds the Living Room TV session and seeks past the intro using the show's `introDur` field.

---

## TVDB Data Collection, Storage, and Management

### Storage

- **Primary file**: `apps/srvr/data/tvdb.json` — a single flat JSON object keyed by show name. Also kept at `data/tvdb.json.bak` as a rolling backup.
- On startup, `tvdb.js` loads `tvdb.json`; if it is invalid JSON, it falls back to the `.bak` file.

### tvdb Record Fields (representative)

Each show's record contains:

| Field                                     | Description                                                    |
| ----------------------------------------- | -------------------------------------------------------------- |
| `tvdbId`                                  | The TVDB numeric ID                                            |
| `name`                                    | Canonical show name                                            |
| `id`                                      | Emby item ID (only for `inEmby: true` shows)                   |
| `inEmby`                                  | Whether the show exists in Emby                                |
| `inToTry / inContinue / inMark / inLinda` | Emby collection membership                                     |
| `reject`                                  | Whether the show is on the Flexget reject list                 |
| `watchedEpis`                             | `[[season, ep1, ep2, ...], ...]` — episodes watched per season |
| `filesOnDisk`                             | Same format — video files actually on disk                     |
| `seriesMap`                               | Episode air dates and availability from TVDB API               |
| `episodeAiredDates`                       | `{ "S01E01": "YYYY-MM-DD", ... }`                              |
| `episodeCount / watchedCount`             | Totals                                                         |
| `fileGap / watchGap`                      | Gap indicators computed by `gapCheckOne`                       |
| `imdbId / imdbUrl / imdbRatings`          | IMDB data                                                      |
| `rottenUrl / rottenRatings`               | Rotten Tomatoes data                                           |
| `introDur`                                | Intro duration in ms (negative = skip to abs position)         |
| `lastWatched`                             | Date of last watched episode                                   |
| `lastViewed`                              | Last time the show was viewed in the UI                        |
| `notes`                                   | Free-text note for the show                                    |
| `date / size`                             | Most-recent video file mtime and total folder size             |
| `noFiles`                                 | True if no video files exist on disk                           |
| `full`                                    | True if all aired episodes are either watched or on disk       |
| `needsIntro`                              | True if the show needs an intro duration set                   |
| `path`                                    | Disk folder name (if different from show name)                 |

### Update Cycle

`src/tvdb.js` exports a queue-based update system (`updateTvdb`, `enqueueShowProcess`). Each show is processed sequentially:

1. Fetch series info from TVDB API v4 (with JWT auth, token cached 20 hours).
2. Fetch IMDB rating and Rotten Tomatoes rating using headless Playwright browser.
3. Run the `perShowCallback` (registered in `index.js`) which handles disk, Emby, gap check, subtitle scan, and OpenSubtitles background download.
4. Debounced WebSocket push to clients with the updated record.

TVDB token: authenticates via `https://api4.thetvdb.com/v4/login` with a hard-wired API key and PIN.

---

## Subtitle Pipeline

When a new video file appears (via Chokidar or user request), it enters a three-stage pipeline:

### Stage 1 — Embedded subtitles (`subQueue`)

`generateEmbSrts` uses `ffprobe` to list subtitle streams, then `ffmpeg` to extract English text-based streams to `.mb<index>.srt` sidecar files. Sanitizes and de-rolls the SRT (fixes scrolling subtitle formats). Detects PGS (image-based) subtitles.

### Stage 2 — OpenSubtitles (`subQueue` continued)

`applyOpenSubSrts` searches OpenSubtitles.com via their REST API using the show's IMDB ID + season/episode. Downloads up to 5 subtitle files per episode, naming them `.opnXXXXX.srt` where `XXXXX` is the file_id encoded in base-32 (RFC4648 alphabet). Requires credentials in `secrets/subs-login.txt` (JSON: `apiKey`, `username`, `password`). JWT token is cached and auto-refreshed on expiry or 401.

### Stage 3 — ASR (Automatic Speech Recognition) (`asrQueue`)

If no subtitle was found, the video is queued for ASR via `apps/asr/asr.js`. The ASR process is spawned as a child process; its stdout/stderr is captured into an in-memory ring buffer (`asrLogBuffer`, max 500 lines) and broadcast to clients. Only one ASR job runs at a time. Low-priority jobs wait if system load average exceeds 2.

### Subtitle check queue (`subQueueChkSrt`)

After embedded or OpenSubtitles processing produces sidecars, the episode enters the check queue. The user reviews which subtitle file to keep via the UI (`/api/asr/chksrt/*`). Selections are recorded in `chksrt-history.json`.

### Background OpenSubtitles scan

`checkAndDownloadOpnSrt` runs after each per-show processing cycle and silently downloads one missing `.opnXXXXX.srt` per show per day, subject to a global daily cap of 500 downloads.

### Queue persistence

All queues (`subQueue`, `subQueueChkSrt`, `asrQueue`) are persisted to JSON files in the `asr` server's data directory at `/root/dev/apps/tv/apps/asr/data/` so they survive server restarts.

---

## Flexget (Torrent Automation)

Flexget is a Python RSS/torrent tool that runs as an external process. `srvr` manages it:

- **Config generation**: At startup and before each run, `srvr` assembles `config/config.yml` from five template fragments (`config1-header.txt`, `config2-rejects.json`, `config3-middle.txt`, `config4-pickups.json`, `config5-footer.txt`). The pickups list drives which shows Flexget actively fetches; the rejects list suppresses unwanted matches.
- **Scheduled runs**: Cron fires every 15 minutes (`0 */15 * * * *` in node-cron). Each run calls `runFlexgetAndProcess`.
- **Processing**: Output from `flexget execute --dump accepted` is parsed by `parseFlexgetDumpOutput`. Each accepted entry is matched to a show via `smartTitleMatch`, checked against `watchedEpis` (skip if watched), deduplicated, and compared against existing disk resolution. If it is new or a higher-resolution upgrade, the torrent URL is sent to qBittorrent via its Web API (`/api/v2/torrents/add` with category `tv`).
- **History**: All candidates (sent or skipped) are recorded in `data/flexget-history.json` keyed by `showName\x00Sxx\x00Exx`. This is read by the client's Flexget history pane.
- **qBittorrent credentials**: Read from `../api/secrets/qbt-cred.txt` (key=value format: `QB_HOST`, `QB_USER`, `QB_PASS`, `QB_PORT`).

---

## History Log

`src/history.js` maintains a **SQLite database** at `data/history.sqlite` using `better-sqlite3`.

### Schema

```sql
history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tvdbId TEXT,
  showName TEXT NOT NULL,
  addTime TEXT NOT NULL,      -- PST timestamp
  updateTime TEXT NOT NULL,   -- PST timestamp
  updateCount INTEGER,
  description TEXT,
  type TEXT NOT NULL,
  hash TEXT,
  fields TEXT
)
```

### Event Types

`reject`, `unreject`, `pickup`, `unpickup`, `addEmby`, `remEmby`, `bkgndUpdate`, `clientUpdate`, `skipDown`, `rejDown`, `browse`, `preview`, `addQbt`, and others logged by the `down` server.

Certain types (`skipDown`, `rejDown`, `browse`, `preview`, `addQbt`, `bkgndUpdate`, `clientUpdate`) are **deduplicated**: repeated events update the `updateCount` rather than inserting a new row.

---

## External API Usage

| API                                         | Module                       | Purpose                                         |
| ------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| TVDB API v4 (`api4.thetvdb.com`)            | `src/tvdb.js`                | Episode lists, series info                      |
| IMDB (web scrape via Playwright)            | `src/tvdb.js`                | Ratings, trailer URLs                           |
| Rotten Tomatoes (web scrape via Playwright) | `src/rotten.js`              | Critic/audience scores                          |
| TVmaze REST API                             | `api/src/tvmaze.js` (shared) | Crew/cast lookup by TVDB ID                     |
| TMDB API v3 (`moviedb-promise`)             | `src/tmdb.js`                | Episode guest cast, images, streaming providers |
| OpenSubtitles.com API v1                    | `index.js`                   | Subtitle search + download                      |
| Emby REST API                               | `index.js`, `src/emby.js`    | Show data, sessions, gap checks, seeks          |
| Mailtrap email                              | `src/email.js`               | Send notes by email                             |
| qBittorrent Web API v2                      | `index.js`                   | Add torrent URLs                                |

---

## Data Files and Directories

All paths below are relative to `apps/srvr/` on the remote server (`/root/dev/apps/tv/apps/srvr/`).

| Path                          | Description                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `data/tvdb.json`              | Master show database (keyed by show name)                                             |
| `data/tvdb.json.bak`          | Backup copy of tvdb.json (written on every save)                                      |
| `data/history.sqlite`         | Event history database (SQLite, WAL mode)                                             |
| `data/flexget-history.json`   | Per-episode torrent candidate log                                                     |
| `data/flexget-dump.log`       | Raw stdout from each Flexget run                                                      |
| `data/chksrt-history.json`    | Subtitle selection history per episode                                                |
| `data/opn-check-history.json` | Timestamps of last OpenSubtitles background checks                                    |
| `data/groupCounts.json`       | UI group click counters                                                               |
| `data/snooze-list.json`       | Shows the user has snoozed                                                            |
| `data/misc/srvr.log`          | Optional structured log (only written when `LOG_APPS_SRVR_DATA_MISC_SRVR_LOG = true`) |
| `data/vip-actors.json`        | VIP actor list used in actor pane                                                     |
| `config/config.yml`           | Generated Flexget config (assembled from template parts)                              |
| `config/config1-header.txt`   | Flexget config header template                                                        |
| `config/config2-rejects.json` | Reject list (JSON array of show names)                                                |
| `config/config3-middle.txt`   | Flexget config middle template                                                        |
| `config/config4-pickups.json` | Pickup list (JSON array of show names)                                                |
| `config/config5-footer.txt`   | Flexget config footer template                                                        |
| `secrets/subs-login.txt`      | OpenSubtitles credentials (`{ apiKey, username, password }`)                          |
| `secrets/subs-token.txt`      | Cached OpenSubtitles JWT                                                              |

Paths shared with the `asr` server (on remote, absolute):

| Path                                                  | Description                                     |
| ----------------------------------------------------- | ----------------------------------------------- |
| `/root/dev/apps/tv/apps/asr/data/subQueue.json`       | Subtitle download queue                         |
| `/root/dev/apps/tv/apps/asr/data/subQueueChkSrt.json` | Subtitle check queue                            |
| `/root/dev/apps/tv/apps/asr/data/asrQueue.json`       | ASR generation queue                            |
| `/root/dev/apps/tv/apps/asr/data/subtitle.log`        | Per-entry subtitle pipeline log (rotated daily) |
| `/root/dev/apps/tv/apps/asr/data/subtitle-logs/`      | Archived daily subtitle logs                    |

Media files live at `/mnt/media/tv/<ShowName>/Season <N>/<episode>.mkv`.

---

## Dependencies

Key npm packages:

| Package               | Version   | Purpose                                                        |
| --------------------- | --------- | -------------------------------------------------------------- |
| `express`             | ^4.18     | HTTP REST API server                                           |
| `ws`                  | ^8.18     | WebSocket server                                               |
| `better-sqlite3`      | ^11.10    | SQLite history database                                        |
| `node-fetch`          | ^3.3      | HTTP requests to Emby, TVDB, OpenSubtitles, etc.               |
| `playwright`          | ^1.57     | Headless browser for IMDB/Rotten Tomatoes scraping             |
| `moviedb-promise`     | ^4.0      | TMDB API client                                                |
| `chokidar`            | ^3.5      | File system watcher for `/mnt/media/tv`                        |
| `node-cron`           | ^3.0      | Scheduled tasks (Flexget every 15 min, log rotation at 5 AM)   |
| `parse-torrent-title` | ^2.1      | Parse show/season/episode from torrent filenames               |
| `rimraf`              | ^6.0      | Recursive directory deletion                                   |
| `mailtrap`            | ^4.3      | Email sending                                                  |
| `cors`                | ^2.8      | CORS headers                                                   |
| `@tv/share`           | workspace | Shared utilities (`smartTitleMatch`, `parseFileSeasonEpisode`) |

Runtime dependencies (external binaries):

- `ffmpeg` / `ffprobe` — video probing and subtitle extraction/transcoding
- `flexget` — torrent RSS aggregator (`/root/.local/bin/flexget`)
- `node` — for spawning `apps/asr/asr.js` as a child process

TLS certificates are read from `../api/cookies/localhost-key.pem` and `localhost-cert.pem`.

---

## Logging

- **Console output** is the primary log. pm2 captures it and it is visible with `pm2 logs srvr`.
- The workspace task `log-srvr` tails `/root/dev/apps/tv-dev/apps/srvr/data/misc/srvr.log` (the dev instance copy; the structured file log is currently disabled).
- `data/misc/subtitle.log` is an append-only log of all subtitle pipeline actions, rotated daily at 5 AM PST to `data/misc/subtitle-logs/subtitle-MM-DD.log`.
- `data/flexget-dump.log` appends the raw output of every Flexget run.
- All timestamps in logs use PST (America/Los_Angeles) in `MM-DD HH:mm` format.
