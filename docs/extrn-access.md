# External locations accessed (excluding hahnca.com + localhost)

## 1) Remote server / seedbox hosts

- `oracle.usbx.me` (as `xobtlu@oracle.usbx.me`)
  - Access: `ssh` shell commands and `rsync` file transfer.
  - Where: `apps/down/src/main.js`, `apps/down/src/tvJson.js`, `apps/down/src/worker.js`, `apps/srvr/index.js`.

- `QB_HOST` from `apps/api/secrets/qbt-cred.txt` (dynamic host, often seedbox)
  - Access: `ssh` via `execFileAsync("ssh", ...)` for remote commands; HTTP qBittorrent WebUI via `fetch("http://${qbHost}:${qbPort}/api/v2/...)
  - Where: `apps/api/src/usb.js`.

## 2) External HTTP(S) APIs / sites

- `api4.thetvdb.com`
  - Access: HTTP API calls via `fetch` and `request` (`POST /v4/login`, `GET /v4/search`, `/v4/series/...`).
  - Where: `apps/srvr/src/tvdb.js`, `apps/down/src/main.js`, `apps/srvr/scripts/create-tvdb-template.js`.

- `api.tvmaze.com`
  - Access: HTTP API calls via `fetch` (`/shows?page=...`, `/updates/shows?since=day`, `/shows/{id}`).
  - Where: `apps/api/src/tvmaze.js`.

- `api.themoviedb.org`
  - Access: direct HTTP API fallback via `fetch` (`/3/tv/{id}/aggregate_credits?...`).
  - Where: `apps/srvr/src/tmdb.js`.

- `api.opensubtitles.com`
  - Access: HTTP API calls via `fetch` (`/api/v1/login`, `/subtitles`, `/download`).
  - Where: `apps/srvr/index.js`, `apps/api/src/server.js`.

- OpenSubtitles returned subtitle file URL host (dynamic)
  - Access: direct subtitle download via `fetch(url)` after getting `link` from OpenSubtitles `/download` response.
  - Where: `apps/srvr/index.js`.

- `api.mistral.ai`
  - Access: HTTP API call via `axios.post` (`/v1/audio/transcriptions`).
  - Where: `apps/asr/asr.js`.

- `www.imdb.com`
  - Access: `fetch(...)` for search/profile pages and Playwright `page.goto(...)` for scraping reviews/credits.
  - Where: `apps/srvr/src/tvdb.js`, `apps/api/src/server.js`, `apps/api/src/reviews.js`, `apps/api/src/imdb-credits.js`.

- `www.googleapis.com`
  - Access: HTTP API calls via `fetch` to Custom Search API (`/customsearch/v1`).
  - Where: `apps/srvr/src/tvdb.js`.

- `www.rottentomatoes.com`
  - Access: Playwright navigation/scraping via `page.goto(...)`.
  - Where: `apps/srvr/src/rotten.js`.

- `www.torrentleech.org`
  - Access: provider search (via `torrent-search-api`), plus direct page/torrent download via `fetch` and `curl`.
  - Where: `apps/api/src/search.js`, `apps/api/src/download.js`.

- `iptorrents.com`
  - Access: provider search (via `torrent-search-api`), plus direct page/torrent download flow via `fetch`/`curl` using provider detail URLs.
  - Where: `apps/api/src/search.js`, `apps/api/src/download.js`.

- `raw.githubusercontent.com`
  - Access: bootstrap/install script download via `curl -fsSL ... | bash`.
  - Where: `scripts/remote/bootstrap.sh`.

## 3) SDK-driven service endpoint (host hidden in SDK)

- Mailtrap API (exact host resolved by SDK at runtime)
  - Access: `MailtrapClient(...).send(...)` over HTTPS.
  - Where: `apps/srvr/src/email.js`.
