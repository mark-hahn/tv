---
description: API server documentation and context
---

> **Warning:** Generated **2026-05-24**. Verify against `apps/api/src/`.

# API Server (`apps/api`)

## Key Facts
- Port **3001** HTTPS, pm2 name `tv-api`. Source: `apps/api/src/`. No build step.
- nginx proxies all browser traffic; server adds CORS only for direct/non-proxied requests.
- Dependencies: `down` server at `http://127.0.0.1:3003` (tv-proc proxy), qBittorrent Web API.

## Endpoint Groups
| Group | Key Paths | Purpose |
|---|---|---|
| Torrent | `/api/search`, `/api/download`, `/api/tor/*`, `/api/torrent-file` | Search providers, send to qBittorrent |
| qBittorrent | `/api/qbt/info`, `/api/qbt/delTorrent`, `/api/qbt/addMagnet` | qBit management |
| USB files | `/api/usb/files`, `/api/usb/movies`, `/api/usb/rename`, `/api/usb/deleteFiles` | USB server file ops |
| Local media | `/api/local/files`, `/api/local/movies`, `/api/local/mediainfo` | `/mnt/media/tv` + `/mnt/media/movies` |
| Browse | `/api/getBrowseShow`, `/api/browseSearch`, `/api/ackBrowsed`, `/api/removeBrowseCard` | TVmaze-backed show discovery |
| Subtitles | `/api/subs/search` | OpenSubtitles search |
| Reviews/actors | `/api/reviews/getReviews`, `/api/reviews/getImdbReviews`, `/api/getActorCredits` | RT + IMDb via Playwright |
| tv-proc proxy | `/api/tvproc/startProc`, `/api/tvproc/forceDown` | Proxy to `down` server |
| Utilities | `/api/space/avail`, `/api/space/usb`, `/api/space/srvr`, `/api/flexget` | Space + FlexGet history |

## Database: `data/tvmaze.sqlite`
Table `shows`: `tvmaze_id`, `tvdb_id`, `imdb_id`, `name`, `premiered`, `status`, `type`, `browsed`, `data_json`
Synced nightly at 3am + on startup. Table `meta` holds sync state (last page). Cleared if `data/misc/tvmaze-clear-flag` exists.

## Key Data Files (remote: `/root/dev/apps/tv/apps/api/data/`)
- `browse-cards.json` — rolling browse card list (max 200)
- `iptorrents.json`, `torrentleech.json` — tracker credentials/cookies
- `cf_clearance-cookies.json` — Cloudflare clearance values
- `misc/tor-sent.json` — torrent hash dedup map

## External APIs
| API | Purpose | Auth |
|---|---|---|
| TVmaze `api.tvmaze.com/shows?page=N` | Full show index sync | Public |
| TVDB `api4.thetvdb.com/v4` | Fill missing premiered dates | Key + PIN hardcoded in `tvmaze.js` |
| OpenSubtitles `api.opensubtitles.com` | Subtitle search | Creds in `secrets/subs-login.txt`; token in `secrets/subs-token.txt` |
| IPTorrents, TorrentLeech | Private torrent search | Cookies + cf_clearance; **proxied via USB SSH** |
| ThePirateBay `apibay.org/q.php` | Public torrent search | None |
| IMDb, Rotten Tomatoes | Actor/review scraping | Playwright (headless) |

## SSH Tunnel
IPTorrents and TorrentLeech requests run as `ssh xobtlu@oracle.usbx.me curl ...` to avoid IP blocks on the private trackers.
