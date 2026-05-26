---
description: Down server documentation and context
---

> **Warning:** Written **2026-05-24**. Verify against source files before relying on specifics.

# Down Server (`apps/down`)

## Key Facts
- Runs on `hahnca.com` under pm2 — port **3003**. Source: `apps/down/src/`. No build step.
- Watches USB seedbox (`xobtlu@oracle.usbx.me`) for completed downloads → copies to `/mnt/media/tv/`
- Cycle every **5 min**; trigger via `POST /startProc`. Up to **8 concurrent rsync workers**.

## Key Source Files
- `main.js` — cycle driver and decision chain
- `worker.js` — one worker per download (rsync with progress)
- `tvJson.js` — SQLite wrapper + worker pool manager

## Key Data Files (remote)
- `srvr/data/tvdb.json` — Emby show map (`{inEmby, watchedEpis, ...}` keyed by show name)
- `srvr/data/flexget-history.json` — quality-gate reference
- `data/tv.sqlite` — download DB (table: `tv_entries`)
- `tv-inProgress.json` — per-cycle guard against duplicate processing

## Database: `tv_entries`
| Column | Notes |
|---|---|
| `title` (PK) | Original USB filename |
| `procId` | Sequential; used for ordering/capping |
| `status` | `waiting` / `downloading` / `finished` / error string |
| `destTitle` | Renamed filename for disk (null = same as title) |
| `seriesName` | Canonical TVDB name |
| `season`, `episode` | Parsed integers |
| `usbPath`, `localPath` | Remote folder + local destination dir |

## Decision Chain (order; first fail skips the file)
1. Locked path (`!unrar.lock`)
2. Extension not in allowed list
3. Previous error entry in DB
4. Already in DB (any status)
5. In-progress map
6. `TV_BLOCKED` substring list
7. Title/season/episode parse fails
8. Not `type === "episode"`
9. TVDB lookup fails + not in Emby map
10. Series name remapping (`data/tv-map`)
11. Not `inEmby: true` in Emby map
12. Already on disk (same file)
13. Watched episode in `watchedEpis`
14. Flex quality gate (resolution + bit-depth comparison)
15. → Queue entry created (`status: 'waiting'`)

## Download Modes
- **Forced** (`/forceDown`): all filters bypassed; existing local file deleted first
- **From-tor** (`/torFiles` or `/forceDown` with `fromTor:true`): skips quality gate; respects Emby/watched/disk checks
- **Flex** (default): full filter chain

## HTTP Endpoints (port 3003)
| Path | Description |
|---|---|
| `GET/POST /startProc` | Trigger immediate USB scan |
| `POST /retry` | Delete DB entry + rescan |
| `GET /downloads` | Last 200 SQLite entries |
| `GET/POST /checkFiles` | Which filenames are already downloaded |
| `POST /forceDown` | Force-download `{files, fromTor}` |
| `POST /torFiles` | Register tor-origin paths |
| `POST /deleteProcids` | Delete entries + local files by procId |
| `POST /deleteErrors` | Delete all error entries |
| `POST /delItems` | Delete by title list |
| `GET /movieDownloads` | Movie copy job status |
| `POST /movieCycle` | Trigger movie cycle |
| `POST /movieKill` | Kill movie dd streams |

## Other Pipelines
- **Movie pipeline**: polls qBittorrent at `oracle.usbx.me:12041` every 60s; parallel `dd` over SSH to `/mnt/media/movies/`
- **DVD pipeline**: VOB/IFO/BUP staged to `/mnt/media/tmp-dvd/` → `makemkvcon` → MKVs renamed into Season dir
