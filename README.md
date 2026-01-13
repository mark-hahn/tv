# torrents-server

Small HTTPS JSON API for:

- Searching private torrent sites (IPTorrents, TorrentLeech)
- Fetching/downloading `.torrent` files and optionally uploading them to a remote qBittorrent watch folder
- A few helper/proxy endpoints used by the TV UI (TVDB proxy, OpenSubtitles search, “reel”/Reelgood workflow)

This repo is intended to run locally behind nginx (nginx sets the CORS headers).

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- `curl` available on the host (used to fetch `.torrent` files)
- If you use the remote-watch-folder feature: SSH/SFTP access to the remote box

## Install

```bash
npm install
```

## Run

### Local (foreground)

```bash
npm start
```

The server listens on **HTTPS port 3001**.

### PM2 (production-ish)

This repo includes a PM2 config:

```bash
pm2 start ecosystem.config.cjs
pm2 logs torrents-server
```

Note: `ecosystem.config.cjs` sets `cwd` to `/mnt/media/archive/dev/apps/torrents`. If you run from a different path, update that field.

## TLS certs (required)

The server expects these files:

- `cookies/localhost-key.pem`
- `cookies/localhost-cert.pem`

They are typically self-signed for local-only use.

## Credentials & local files

Most secrets are intentionally **not** committed (see `.gitignore`).

### Torrent provider cookies

These are Playwright-style cookie JSON arrays (each cookie has `{name,value,...}`):

- `cookies/iptorrents.json`
- `cookies/torrentleech.json`

Optional Cloudflare bypass values (written by the `/api/cf_clearance` endpoint):

- `cookies/cf-clearance.local.json`

### Remote watch folder / SFTP upload

`/api/usb/addTorrent` and related helpers use:

- `cookies/download-cred.txt`

Format is `KEY=VALUE` lines. Required keys:

- `SFTP_PASS`
- Either (`SFTP_HOST` + `SFTP_USER`) **or** `SSH_TARGET` (as `user@host`)

Optional keys:

- `SFTP_PORT` (default 22)
- `REMOTE_WATCH_DIR` (default `/home/<user>/watch/qbittorrent`)

See `cookies/download-cred.template.txt` for a starter template.

### qBittorrent Web UI creds (and SSH target)

Some endpoints read:

- `cookies/qbt-cred.txt`

Expected keys:

- `QB_HOST` (either `host` or `user@host`)
- `QB_PORT`
- `QB_USER` (optional if `QB_HOST` is `user@host`)
- `QB_PASS`

### OpenSubtitles

Create a `subs-login.txt` JSON file in one of:

- `secrets/subs-login.txt` (preferred)
- `../secrets/subs-login.txt` (legacy layout)

Format:

```json
{ "apiKey": "...", "username": "...", "password": "..." }
```

The server will create/update `secrets/subs-token.txt` automatically after logging in.

### Reelgood (“reel”) state files

Generated/updated at runtime:

- `reel-shows.json` (map of already-seen show titles)
- `reelgood-titles.json` (recent results list)
- `reelgood.log` (reelgood workflow log)
- `calls.log` (server call log for `/api/startreel` and `/api/getreel`)

The Reelgood persistence uses atomic writes to avoid truncated JSON files.

## API

All routes are served from `src/server.js`.

### Search torrents

`GET /api/search`

Query params:

- `show` (required)
- `limit` (optional, default 100)
- `needed` (optional JSON array, e.g. `["S01", "S02E03"]`)
- `ipt_cf`, `tl_cf` (optional cf_clearance overrides; otherwise reads `cookies/cf-clearance.local.json`)

Example:

```bash
curl -k "https://localhost:3001/api/search?show=Stranger%20Things&limit=50"
```

#### Search filtering & warnings

The server normalizes provider results, then applies a few **hard filters** to keep the list TV-focused and relevant:

- **Name match**: keeps only results whose parsed title matches `show` (with several normalization variants).
- **TV-only**: drops items with no season/episode info (movies, etc). Season-range torrents (e.g. `S01-S04`) are allowed.
- **Year match** (optional): if `show` contains a year like `"Foo (2011)"`, keeps torrents that either have no year or match that year.
- **Title excludes**: drops obvious unwanted variants by substring (currently `2160`, `nordic`, `mobile`).

The server no longer hard-filters on:

- **480p / low-res**
- **0 seeds**

Instead, it annotates returned torrents so the client can decide what to hide.

Response fields:

- Each torrent may include `warnings: [{ code, message }, ...]`.
  - `code=low_res_480` for likely 480p/low-res releases
  - `code=zero_seeds` for `seeds <= 0`
- The top-level response includes `warningSummary` (a count map of warning codes across returned torrents).

#### Search logging

Search stages/counts and filter reasons are appended to `tor-results.txt` in the project root.

### Download helpers

- `POST /api/download` – Higher-level download flow (JSON body `{ torrent, forceDownload?: true }`)
  - If `forceDownload:true` is **not** provided, the server fetches the `.torrent`, extracts file titles, calls `POST http://localhost:3003/checkFiles`, and **skips** the qBittorrent upload when any titles were already downloaded. In this mode it returns the tv-proc response array.
- `POST /api/torrentFile` – Fetch raw `.torrent` bytes (no detail-page scraping)

### Upload `.torrent` to remote watch folder

`POST /api/usb/addTorrent`

- Content-Type: `application/x-bittorrent`
- Optional header: `x-torrent-filename`

### qBittorrent / system info

- `GET /api/qbt/info` (optional filters: `hash`, `category`, `tag`, `filter`)
- `GET /api/space/avail`
- `GET /api/flexget`

### OpenSubtitles

`GET /api/subs/search`

- `imdb_id=tt1234567` or `q=...`
- `page=1`

### TVDB proxy

`GET /api/tvdb/*`

Proxies requests to `api4.thetvdb.com` so the browser doesn’t need to send TVDB auth headers.

### Reelgood (“reel”) workflow

- `POST /api/startreel` body `{ showTitles: ["Already Have This", ...] }`
- `GET /api/startreel?showTitles=["..."]` (also supports comma-separated)
- `GET /api/getreel`

High-level flow:

1. Call `startreel` once to fetch and cache the Reelgood “new TV” home page.
2. Poll `getreel` to process/return the next accepted/rejected show(s).

## Troubleshooting

- **Cloudflare blocks / HTML instead of `.torrent`**: update `cookies/cf-clearance.local.json` (via the UI or `POST /api/cf_clearance`).
- **Missing cookies**: ensure `cookies/iptorrents.json` / `cookies/torrentleech.json` exist and are valid Playwright cookie arrays.
- **TLS errors**: generate `cookies/localhost-key.pem` + `cookies/localhost-cert.pem`, or terminate TLS at nginx and adjust the server accordingly.
- **Reel results look stale / repeated**: check `calls.log`, `reelgood.log`, and validate JSON with:

  ```bash
  node test/reelgood-validate.js
  ```

## Tests / scripts

- `node test/curl-test.js <torrent-url>` – replay a browser curl profile to fetch a `.torrent` into `test/curl-test.torrent`
- `node test/reelgood-validate.js` – validates reelgood state/logging files
