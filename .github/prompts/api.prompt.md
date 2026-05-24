# API Server Documentation

> **Warning:** This document was generated on **2026-05-24 14:07 PDT**. The code may have changed since then. Always verify against the source files in `apps/api/src/`.

---

## Overview

`apps/api` is the backend service that powers the TV remote web client. It runs as an HTTPS Express server on **port 3001** on `hahnca.com`, managed by pm2 under the name `tv-api`. It is the central hub for:

- Torrent searching and downloading
- qBittorrent management
- USB server file management
- Show browsing recommendations (using a local TVmaze SQLite database)
- Subtitle search via OpenSubtitles
- Actor credits scraping from IMDb
- Review scraping from Rotten Tomatoes and IMDb
- Mediainfo / file inspection
- Proxy calls to the `down` server's `tv-proc` service

All browser traffic reaches this server through nginx (which injects CORS headers). The server only adds CORS headers itself for direct, non-proxied requests.

---

## Endpoints Provided

### Torrent Search & Download

| Method | Path                | Description                                                                                                                                 |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/search`       | Search torrents across all providers. Query params: `show`, `tvdbId`, `limit`, `needed` (JSON array), `more`, `category`, `ipt_cf`, `tl_cf` |
| `POST` | `/api/download`     | Download a torrent — fetches file, checks with tv-proc, adds to qBittorrent                                                                 |
| `POST` | `/downloads`        | Alias for `/api/download` (back-compat for nginx rewrites)                                                                                  |
| `POST` | `/api/tor/files`    | List files inside a torrent without downloading                                                                                             |
| `GET`  | `/api/torrent-file` | Fetch a torrent via public providers (TPB/LIM/EZT) and add to qBittorrent; also accepts `?magnet=` and `?link=` params                      |
| `GET`  | `/api/tor/sent`     | Return the `tor-sent.json` dedup map (hash → timestamp)                                                                                     |
| `POST` | `/api/tor/sent`     | Record torrent hashes as sent (dedup tracking)                                                                                              |
| `POST` | `/api/cf_clearance` | Persist Cloudflare `cf_clearance` cookies for IPTorrents / TorrentLeech (body: `{ipt_cf, tl_cf}`)                                           |

### qBittorrent

| Method | Path                  | Description                                                                                         |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/qbt/info`       | Get torrent list from qBittorrent; accepts filter query params: `hash`, `category`, `tag`, `filter` |
| `POST` | `/api/qbt/delTorrent` | Delete a torrent (and files by default); body: `{hash, deleteFiles}`                                |
| `POST` | `/api/qbt/recheck`    | Recheck torrent data integrity; body: `{hash}` or `"all"`                                           |
| `POST` | `/api/qbt/addMagnet`  | Add a magnet URL directly to qBittorrent; body: `{magnetUrl}`                                       |

### USB Server Files

| Method | Path                    | Description                                                                       |
| ------ | ----------------------- | --------------------------------------------------------------------------------- |
| `GET`  | `/api/usb/files`        | List files on USB server under `/home/xobtlu/files`                               |
| `GET`  | `/api/usb/movies`       | List movies on USB server under `/home/xobtlu/movies`                             |
| `POST` | `/api/usb/prune`        | Prune old files on USB server to free space                                       |
| `GET`  | `/api/usb/prune/status` | Get current USB prune operation status                                            |
| `POST` | `/api/usb/rename`       | Rename a file on the USB server; body: `{oldPath, newName}`                       |
| `POST` | `/api/usb/deleteFiles`  | Delete files on USB server; body: `{paths: string[]}`                             |
| `POST` | `/api/usb/deleteMovies` | Delete movies on USB server; body: `{paths: string[]}`                            |
| `POST` | `/api/usb/mediainfo`    | Run `mediainfo` on a file on the USB server via SSH; body: `{relPath, movieMode}` |

### Local Media Files

| Method | Path                       | Description                                                                         |
| ------ | -------------------------- | ----------------------------------------------------------------------------------- |
| `GET`  | `/api/local/files`         | List files in `/mnt/media/tv`                                                       |
| `GET`  | `/api/local/movies`        | List files in `/mnt/media/movies`                                                   |
| `GET`  | `/api/local/error-files`   | List files in `/mnt/media/tv-errors`                                                |
| `POST` | `/api/local/rename`        | Rename a local media file; body: `{oldPath, newName, errsMode}`                     |
| `POST` | `/api/local/move-to-trial` | Move a file to the trial folder; body: `{relPath}`                                  |
| `POST` | `/api/local/mediainfo`     | Run `mediainfo` + `ffprobe` on a local file; body: `{relPath, errsMode, movieMode}` |

### Show Browsing (TVmaze Database)

| Method | Path                       | Description                                                              |
| ------ | -------------------------- | ------------------------------------------------------------------------ |
| `GET`  | `/api/getBrowseShow`       | Get next show(s) for the browse UI; returns `{titles, pendingBrowsedId}` |
| `POST` | `/api/getBrowseShow`       | Same as GET (back-compat)                                                |
| `GET`  | `/api/getAllBrowse`        | Get full browse card list                                                |
| `GET`  | `/api/browseSearch?q=text` | Search TVmaze SQLite by show name                                        |
| `POST` | `/api/ackBrowsed`          | Mark a show as browsed; body: `{tvmazeId}`                               |
| `POST` | `/api/removeBrowseCard`    | Remove a show from browse-cards.json; body: `{tvdbId?, name?}`           |
| `POST` | `/api/unackBrowsed`        | Reset browsed flag so a show re-enters rotation; body: `{tvdbId}`        |

### Subtitles (OpenSubtitles)

| Method | Path               | Description                                                                                                                  |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/subs/search` | Search OpenSubtitles for subtitles. Query params: `imdb_id` or `q`, `page`. Auto-logs in and refreshes token on auth failure |

### Reviews & Actors

| Method | Path                          | Description                                                                        |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------- |
| `GET`  | `/api/reviews/getReviews`     | Scrape Rotten Tomatoes critic/audience reviews via Playwright. Query: `url`, `btn` |
| `GET`  | `/api/reviews/getImdbReviews` | Scrape IMDb reviews via Playwright. Query: `imdbId`                                |
| `POST` | `/api/getActorPage`           | Look up an actor's IMDb page URL; falls back to Wikipedia. Body: `{name}`          |
| `POST` | `/api/getActorCredits`        | Scrape full IMDb filmography for an actor via Playwright. Body: `{name}`           |

### Space & Utilities

| Method | Path               | Description                                  |
| ------ | ------------------ | -------------------------------------------- |
| `GET`  | `/api/space/avail` | qBittorrent drive free space                 |
| `GET`  | `/api/space/usb`   | USB server drive free space                  |
| `GET`  | `/api/space/srvr`  | `/mnt/media` drive free space                |
| `GET`  | `/api/flexget`     | Recent FlexGet download history (plain text) |

### tv-proc Proxy

| Method | Path                    | Description                                                                                                             |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/tvproc/startProc` | Proxy `GET` to `down` server `startProc`; query: `title`                                                                |
| `POST` | `/api/tvproc/startProc` | Clear `tvproc.json` (used to reset tv-proc state)                                                                       |
| `POST` | `/api/tvproc/forceDown` | Force-download a list of files; proxies to `down` server at `http://127.0.0.1:3003/forceDown` and posts history entries |

---

## Internal Service Dependencies

| Service                            | Address                                                                           | Purpose                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `down` / tv-proc                   | `http://127.0.0.1:3003`                                                           | Checks whether torrent file titles are already downloaded before sending to qBittorrent (`POST /checkFiles`) |
| `hahnca.com/tv-down-dev/startProc` | HTTPS                                                                             | Proxied startProc call for `down` server                                                                     |
| qBittorrent Web API                | Configured in `secrets/qbt-cred.txt` (`QB_HOST`, `QB_PORT`, `QB_USER`, `QB_PASS`) | Torrent management                                                                                           |
| FlexGet                            | via SSH to qBittorrent host                                                       | Download history                                                                                             |
| USB server                         | `xobtlu@oracle.usbx.me` via SSH                                                   | File listing, rename, delete, mediainfo, prune                                                               |

---

## External API Usage

| API                                                      | Purpose                                                       | Auth                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **TVmaze** `https://api.tvmaze.com/shows?page=N`         | Bulk show index — synced nightly into SQLite                  | None (public)                                                                                                 |
| **TVDB** `https://api4.thetvdb.com/v4`                   | Fill in missing `premiered` dates for TVmaze shows            | API key + PIN hardcoded in `tvmaze.js`                                                                        |
| **OpenSubtitles** `https://api.opensubtitles.com/api/v1` | Subtitle search                                               | API key + username/password from `secrets/subs-login.txt`; bearer token persisted in `secrets/subs-token.txt` |
| **IPTorrents**                                           | Private torrent search                                        | Cookies from `data/iptorrents.json` + `cf_clearance`; HTTP proxied via USB server SSH                         |
| **TorrentLeech**                                         | Private torrent search                                        | Cookies from `data/torrentleech.json` + `cf_clearance`; HTTP proxied via USB server SSH                       |
| **ThePirateBay** `https://apibay.org/q.php`              | Public torrent search                                         | None                                                                                                          |
| **Limetorrents / Eztv**                                  | Public torrent search via `torrent-search-api`                | None                                                                                                          |
| **IMDb** `https://www.imdb.com`                          | Actor page lookup (fetch) + filmography scraping (Playwright) | None                                                                                                          |
| **Rotten Tomatoes**                                      | Critic/audience review scraping via Playwright                | None                                                                                                          |

### SSH Tunnel for Torrent Providers

IPTorrents and TorrentLeech requests do **not** originate from `hahnca.com` directly. Instead, `sshTunnel.js` runs `ssh xobtlu@oracle.usbx.me curl ...` so the outbound connection comes from the USB server's IP. This is done to avoid IP blocks on the private trackers.

---

## Database

### `data/tvmaze.sqlite`

A local SQLite database (via `better-sqlite3`) holding the full TVmaze show index. Used by the browse feature.

**Table: `shows`**

| Column           | Type       | Notes                                    |
| ---------------- | ---------- | ---------------------------------------- |
| `tvmaze_id`      | INTEGER PK | TVmaze ID                                |
| `tvdb_id`        | INTEGER    | TheTVDB ID                               |
| `imdb_id`        | TEXT       | IMDb ID                                  |
| `name`           | TEXT       | Show name                                |
| `premiered`      | INTEGER    | Unix epoch of premiere date              |
| `status`         | TEXT       | e.g. "Running", "Ended"                  |
| `type`           | TEXT       | e.g. "Scripted"                          |
| `language`       | TEXT       |                                          |
| `tvmaze_updated` | INTEGER    | TVmaze last-updated timestamp            |
| `fetched_at`     | INTEGER    | When this row was written                |
| `browsed`        | INTEGER    | 0/1 — whether already shown in browse UI |
| `data_json`      | TEXT       | Full TVmaze show JSON payload            |

**Table: `meta`** — key/value store for sync state (e.g. last synced page).

**Sync schedule:** Runs at startup (incremental from last seen page) and nightly at 3:00 AM local time. Uses TVmaze's rate limit (20 calls per 10 seconds with backoff on 429). If `premiered` is missing for a show, it attempts a TVDB lookup to fill it.

**DB clear flag:** If `data/misc/tvmaze-clear-flag` exists on disk at startup, the DB is deleted and rebuilt from scratch.

---

## Flat Data Files

All files live under `data/` on the remote server (`/root/dev/apps/tv/apps/api/data/`).

| File                            | Description                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `tvmaze.sqlite`                 | TVmaze show database (see above)                                                               |
| `browse-cards.json`             | Rolling list (max 200) of shows surfaced by the browse feature; JSON array of title strings    |
| `iptorrents.json`               | IPTorrents credentials/cookies                                                                 |
| `iptorrents-custom.json`        | IPTorrents provider customization overrides                                                    |
| `torrentleech.json`             | TorrentLeech credentials/cookies                                                               |
| `cf_clearance-cookies.json`     | Persisted Cloudflare `cf_clearance` values; JSON `{iptorrents: "...", torrentleech: "..."}`    |
| `curl-tl.txt`                   | A raw `curl` command export (from browser DevTools) used to build TorrentLeech request headers |
| `curl-ipt.txt`                  | Same for IPTorrents                                                                            |
| `misc/tor-sent.json`            | Dedup map of torrent hashes → timestamp, preventing double-sends                               |
| `misc/tvmaze-sync-summary.json` | Last TVmaze sync run summary                                                                   |
| `misc/tvmaze-page.json`         | Intermediate TVmaze page state                                                                 |
| `misc/tvmaze-clear-flag`        | If present at startup, causes DB to be wiped and rebuilt                                       |

### Secrets (`secrets/`)

| File                 | Description                                                                 |
| -------------------- | --------------------------------------------------------------------------- |
| `qbt-cred.txt`       | qBittorrent connection details (`QB_HOST`, `QB_PORT`, `QB_USER`, `QB_PASS`) |
| `subs-login.txt`     | OpenSubtitles credentials JSON (`{apiKey, username, password}`)             |
| `subs-token.txt`     | Persisted OpenSubtitles bearer token                                        |
| `localhost-key.pem`  | TLS private key (server listens on HTTPS)                                   |
| `localhost-cert.pem` | TLS certificate                                                             |

---

## Logs

All logs are on the remote server under `/root/dev/apps/tv/apps/api/data/misc/`.

| File                       | Contents                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `calls.log`                | Append-only log for key endpoint calls (getBrowseShow, checkFiles, reviews). JSON blocks with timestamp, endpoint, ok/fail, last 5 result items. |
| `review-calls.log`         | Detailed start/end log for review scraping calls (`getReviews`, `getImdbReviews`).                                                               |
| `temp.txt`                 | Download request/response diagnostic log. Records torrent provider, IDs, titles, and qBittorrent response for each `/api/download` call.         |
| `tvmaze-sync.log`          | TVmaze nightly sync progress — one line per page synced (if log flag is enabled).                                                                |
| `tvmaze-sync-summary.json` | JSON summary of the most recent TVmaze sync (totals, timing).                                                                                    |
| `tor-results.txt`          | Torrent search results log (if log flag is enabled in `search.js`).                                                                              |

Log timestamps use PST/PDT (approximate DST via month), format `MM-DD HH:mm` or `MM-DD HH:mm:ss`.

---

## Torrent Search Architecture

Torrent searching runs in a **child process** (`search-worker.js` / `searchInChild.js`) to isolate Playwright and provider library state from the main server process.

Providers searched:

- **IPTorrents** (private) — via SSH curl tunnel, cookies from `data/iptorrents.json`
- **TorrentLeech** (private) — via SSH curl tunnel, cookies from `data/torrentleech.json`
- **ThePirateBay** — direct API call to `apibay.org/q.php`
- **Limetorrents** — via `torrent-search-api`
- **Eztv** — via `torrent-search-api`

IPT/TL results are cached in `/tmp` by show name to support "load more" requests without re-querying.

---

## Download Flow

When `POST /api/download` is called:

1. Fetch the torrent file from the provider (via SSH curl for IPT/TL, direct HTTP for public providers).
2. Validate the torrent bytes (checks it is a real `.torrent`, not a Cloudflare challenge page).
3. Optionally validate year from torrent metadata against the requested year to catch wrong-show matches.
4. Extract file titles from the torrent.
5. Ask `tv-proc` (`http://127.0.0.1:3003/checkFiles`) whether any titles are already downloaded. If yes, return without adding to qBittorrent.
6. Add the torrent to qBittorrent via its Web API.
7. Disambiguate "Fails." responses from qBittorrent by checking if the torrent appeared under the unique tag used for the request.
8. Record a history entry via `@tv/share postHistory` (type: `torSent` or `torErr`).

`forceDownload=true` skips the qBittorrent duplicate hash pre-check but still runs tv-proc and year validation.

---

## Browse Feature

`browse.js` queries `tvmaze.sqlite` via `getCandidateShows()` (exported from `tvmaze.js`) to find shows not yet browsed. Filtering rules applied:

- Show must be English-language
- Excludes non-English-primary countries (large blocklist in `browse.js`)
- Excludes types: Award Show, Documentary, Game Show, News, Panel Show, Reality, Sports, Talk Show, Variety
- Excludes genres: anime, children, documentary, reality, music, talk, stand-up, travel, war, etc.
- Language detection of show description via `franc-min`

Results are cached in `data/browse-cards.json`. `ackBrowsed` sets `browsed=1` in the DB. `unackBrowsed` resets it.

---

## Playwright Usage

Three features use Playwright (headless Chromium) on the server:

| Feature                 | Module            | Notes                                                                                     |
| ----------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| Rotten Tomatoes reviews | `reviews.js`      | Navigates to `{rottenUrl}/s01/reviews/{all-critics\|all-audience}`, extracts review cards |
| IMDb reviews            | `reviews.js`      | Navigates to IMDb reviews page for a title                                                |
| Actor credits           | `imdb-credits.js` | Scrapes actor's full filmography from IMDb; results cached in-memory for 7 days           |

Playwright requests are serialized through a `BrowserQueue` to avoid concurrent browser launches. Actor credits also deduplicate in-flight requests to the same actor.

---

## Process Management

pm2 app name: **`tv-api`**  
Entry point: `src/server.js`  
Config: `ecosystem.config.cjs`  
Environment: `NODE_ENV=production`, `DISABLE_INTERNAL_CORS=1`

The server listens on HTTPS port **3001**. nginx on `hahnca.com` proxies public client traffic to it and injects CORS headers on that path.
