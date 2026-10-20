---
description: Down server documentation and context
---

> **Warning:** Written **2026-05-24**. Verify against source files before relying on specifics.

# Down Server (`apps/down`)

## Key Facts

- Runs on `hahnca.com` under pm2 — port **3003**. Source: `apps/down/src/`. No build step.
- Watches USB seedbox (`xobtlu@xobtlu.baron.usbx.me`) for completed downloads → copies to `/mnt/media/tv/`
- Cycle every **5 min**; trigger via `POST /startProc`. Up to **8 concurrent rsync workers**.

## Key Source Files

- `main.js` — cycle driver and decision chain
- `worker.js` — one worker per download (rsync with progress)
- `tvJson.js` — SQLite wrapper + worker pool manager

## Key Data Files (remote)

- `srvr/data/tvdb.json` — Emby show map (`{inEmby, watchedEpis, ...}` keyed by show name)
- `srvr/data/blockedNames.txt` — blocked-name substrings, one per line, read every cycle
- `srvr/data/badGroups.txt` — bad release groups
- `data/tv.sqlite` — download DB (table: `tv_entries`)
- `tv-inProgress.json` — per-cycle guard against duplicate processing

## Database: `tv_entries`

| Column                 | Notes                                                 |
| ---------------------- | ----------------------------------------------------- |
| `title` (PK)           | Original USB filename                                 |
| `procId`               | Sequential; used for ordering/capping                 |
| `status`               | `waiting` / `downloading` / `finished` / error string |
| `destTitle`            | Renamed filename for disk (null = same as title)      |
| `seriesName`           | Canonical TVDB name                                   |
| `season`, `episode`    | Parsed integers                                       |
| `usbPath`, `localPath` | Remote folder + local destination dir                 |

## Decision Chain (order; first fail skips the file)

1. Locked path (`!unrar.lock`)
2. Extension not in allowed list
3. Previous error entry in DB
4. Already in DB (any status) — except a finished video whose landed copy is gone: it runs the rest of the chain and goes on the Restore list instead of the queue
5. In-progress map
6. Blocked-name list (`srvr/data/blockedNames.txt`; not for forced files)
7. Title/season/episode parse fails
8. Not `type === "episode"`
9. TVDB lookup fails + not in Emby map
10. Series name remapping (`data/tv-map`)
11. Not `inEmby: true` in Emby map
12. Already on disk (same file)
13. Watched episode in `watchedEpis`
14. Episode videos are judged by `compareRelease` (`@tv/share`), as replacements:
    a forced download running for the episode makes the file wait; it must beat
    any automatic download running for the episode (one download per episode),
    and the episode's recorded video on disk
15. Watched episode
16. A file queued earlier this cycle for the same show and episode: a choice; a
    better new file stops and removes the queued one, even if downloading
17. → Queue entry created (`status: 'waiting'`). A forced video stops every
    automatic download running for its episode.

## Download Modes

- **Forced** (`/forceDown`): all filters bypassed, blocked names included; existing local file deleted first
- **Automatic** (default, flexget and torrent-pane sends alike): full filter chain

## HTTP Endpoints (port 3003)

| Path                   | Description                            |
| ---------------------- | -------------------------------------- |
| `GET/POST /startProc`  | Trigger immediate USB scan             |
| `POST /retry`          | Delete DB entry + rescan               |
| `GET /downloads`       | Last 200 SQLite entries                |
| `GET/POST /checkFiles` | Which filenames are already downloaded |
| `POST /forceDown`      | Force-download `{files}`               |
| `GET /restoreList`     | Usb files that would restore a deleted video |
| `POST /restore`        | Forget a Restore-list file `{title}`   |
| `POST /deleteProcids`  | Delete entries + local files by procId |
| `POST /deleteErrors`   | Delete all error entries               |
| `POST /delItems`       | Delete by title list                   |
| `GET /movieDownloads`  | Movie copy job status                  |
| `POST /movieCycle`     | Trigger movie cycle                    |
| `POST /movieKill`      | Kill movie dd streams                  |

## Other Pipelines

- **Movie pipeline**: polls qBittorrent at `xobtlu.baron.usbx.me:12041` every 60s; parallel `dd` over SSH to `/mnt/media/movies/`
- **DVD pipeline**: VOB/IFO/BUP staged to `/mnt/media/tmp-dvd/` → `makemkvcon` → MKVs renamed into Season dir
