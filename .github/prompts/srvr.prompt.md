---
description: srvr server documentation and context
---

> **Timestamp: 2026-05-24** — Code changes frequently. Verify against `apps/srvr/index.js`.

# srvr Server (`apps/srvr`)

## Key Facts
- Entry: `apps/srvr/index.js` (~7400 lines). Source modules in `apps/srvr/src/`. No build step.
- Ports: **8736** WebSocket (plain) · **8737** HTTPS REST API · **8739** HTTP internal (127.0.0.1, for `down` server)

## Key Data Files (remote: `/root/dev/apps/tv/apps/srvr/data/`)
- `tvdb.json` — master show map keyed by show name; fields: `inEmby`, `watchedEpis`, `filesOnDisk`, TVDB metadata
- `flexget-history.json` — FlexGet torrent history
- `subQueue.json`, `subQueueChkSrt.json`, `subQueueGenSrt.json` — subtitle pipeline queues
- `misc/srvr.log` — main log

## WebSocket Notifications (server → all clients, port 8736)
`tvdbUpdated` · `showUpdating` · `showQueueEmpty` · `nowPlaying` · `missingEpisodeWarning` · `showDiskChanged` · `asr-log` · `asr-queue-update` · `chksrt-count` · `subs-progress` · `emb-log` · `tvMuteState` · `subtitleMismatch` · `tvRemoteAction` · `tvRemoteLock` · `tvRemoteUnlock`

## Key Endpoint Groups (port 8737)
| Group | Key Paths |
|---|---|
| Show/TVDB data | `GET /api/getAllTvdb`, `POST /api/getSeriesMapFromTvdb`, `POST /api/getSeriesMapFromEmby`, `POST /api/setTvdbFields`, `POST /api/getNewTvdb` |
| Emby integration | `POST /api/triggerEmbySync`, `POST /api/refreshEmbyItem`, `GET /api/getDevices`, `POST /api/embySync` |
| File system | `POST /api/getFile`, `POST /api/deletePath`, `POST /api/createShowFolder`, `POST /api/delSeasonFiles` |
| Subtitle pipeline | `POST /api/asr/subs/enqueue`, `POST /api/asr/gensrt/enqueue`, `GET /api/asr/chksrt/list`, `POST /api/asr/chksrt/select` |
| ASR queue | `GET /api/asr/queue`, `POST /api/asr/queue/add`, `GET /api/asr/log`, `POST /api/asr/kill` |
| Video streaming | `GET /api/stream`, `GET /api/subtitle`, `GET /api/episodeStats` |
| Flexget | `GET /api/flexget-history`, `POST /api/flexget-run`, `GET /api/flexget-status`, `GET /api/flexget-config` |
| Misc | `POST /api/saveNote`, `GET /api/getLastViewed`, `GET/POST /api/getSharedFilters`, `POST /api/getTmdb`, `GET /api/snooze-list` |

## Background Tasks
- **Flexget**: scheduled torrent downloads via `/root/.local/bin/flexget`; config at `apps/srvr/config/config.yml`
- **Emby sweep**: periodic library sync; updates `tvdb.json` `inEmby` + `watchedEpis` fields
- **Subtitle pipeline**: `subQueue` → emb extraction + OpenSubs → ASR decision; one ASR job at a time (CPU load check before start)
- **TVDB update queue**: processes shows in background; broadcasts `tvdbUpdated` on each change
- **chokidar file watcher**: monitors `/mnt/media/tv`; adds new video files to `subQueue`
