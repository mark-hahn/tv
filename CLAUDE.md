# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment Split: Local vs Remote

**Local (this workspace `/root/apps/tv/`)**: source code, Vite dev server only. No server apps run here, no data or secrets stored here.

**Remote (`hahnca.com`, path `/root/dev/apps/tv/`)**: all server apps run here via PM2. The remote directory is NOT a git repo — it is a raw directory that PM2 uses.

- Every path starting with `/root/dev/apps/tv/` is on the remote server.
- Every path starting with `/root/apps/tv/` is on the local PC.
- SSH keys are pre-configured; no permission needed to SSH/read remote files.
- Vite dev server talks to production endpoints on `hahnca.com` (configured in [apps/client/src/config.js](apps/client/src/config.js)).

## Key Commands

```bash
# Run Vite dev server locally (web client only)
./run
# or
cd apps/client && npx vite

# Deploy to remote server (rsync + pm2 restart)
./srvr              # deploy all
./srvr srvr         # deploy only apps/srvr
./srvr api          # deploy only apps/api
./srvr down         # deploy only apps/down
./srvr asr          # deploy only apps/asr
# NOTE: do NOT use ./srvr client -- vite handles the client

# Install dependencies (pnpm workspaces + turbo)
pnpm install

# Lint all packages
pnpm lint

# Android: run metro bundler (foreground, so errors are visible)
cd apps/android && npx expo start --localhost
# Then in another terminal:
adb -s <device-id> reverse tcp:8081 tcp:8081
# Connect Expo Go to: exp://127.0.0.1:8081

# Android: build and install APK (do NOT use eas build -- expo account cancelled)
cd apps/android && ./build-apk [device-serial]
# The script handles checksum caching, rsync to server, gradlew build, download, and adb install
# If signature mismatch: adb uninstall com.hahnca.tvremote first
# Known serials: 9a=56221JEBF01987, 6a=28231JEGR06978
```

## Monorepo Structure

pnpm workspaces + Turborepo. Packages:

| Package          | Description                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `apps/client`    | Vue 3 web client (Vite build, served at `/shows/`)                                         |
| `apps/srvr`      | Main backend — Express + WebSocket, serves show data, Emby integration, TVDB/TMDB          |
| `apps/api`       | Torrent search backend — Playwright-based scraping of IPTorrents/TorrentLeech              |
| `apps/down`      | Download manager — polls USB server, moves files into structured TV folder                 |
| `apps/tv`        | TV hardware control — Sony Bravia + Fire TV via Home Assistant, Broadlink IR               |
| `apps/asr`       | Automatic subtitle recognition — Mistral audio API                                         |
| `apps/android`   | React Native / Expo Go Android remote control app                                          |
| `packages/share` | Shared utilities (title normalization, filename parsing, history) used by client + servers |

## Architecture

### Communication Flow

- **Web client** (`apps/client`) connects to `srvr` over WebSocket (`wss://hahnca.com/tv-srvr`) for real-time updates and uses HTTP REST for data queries.
- **Android app** (`apps/android/App.js`) connects to the same `srvr` WebSocket endpoint and same HTTP API. It registers itself with `fname: "register"` on connect.
- **`srvr`** is the central hub: it holds the TVDB JSON cache (`data/tvdb.json`), interfaces with Emby (media server), and coordinates with `api`, `down`, and `tv` services.
- **`api`** runs Playwright in a headless browser (requires `xvfb-run` in PM2) to scrape torrent sites.
- **Nginx** on `hahnca.com` proxies `/tv-srvr`, `/tv-api`, `/tv-down`, `/tv-tv` to the respective PM2 processes. Config at `hahnca.com:/etc/nginx/conf.d/server.conf`.

### Data and Secrets

- **Data** (mutable runtime state) lives in each app's `data/` folder — only exists on remote.
- **Secrets** live in each app's `secrets/` folder — only exists on remote.
- Primary database: `apps/down/data/tv.sqlite` (SQLite via `better-sqlite3`).
- Show metadata cache: `apps/srvr/data/tvdb.json`.

### Web Client (`apps/client`)

Vue 3 SPA. Layout is a multi-pane UI with a sidebar buttons column and tabbed right panes. Key components:

- `App.vue` — root layout, global CSS including `background-color: var(--btn-bg, whitesmoke) !important` on buttons inside named panes (`#tor`, `#info`, `#actors`, etc.). **To change button background dynamically, set `--btn-bg` CSS variable, not `backgroundColor` inline style.**
- `tvpane.vue` — TV remote control UI (shared concern with Android app)
- `srvr.js` — WebSocket + HTTP client that talks to `apps/srvr`

### Android App (`apps/android`)

React Native single-file app (`App.js`). Mirrors the functionality of `tvpane.vue` in the web client. **When changing UI in `tvpane.vue` or the android folder, apply the same change to the other.** Only check for android impact when changes are in `tv-pane` or `android`.

## Coding Rules

- **No environment variables** — use hard-wired uppercase constants at the top of each file.
- **No file-missing fallbacks** — if a file is missing, fail fast.
- **Prefer async over sync** — avoid `void` to paper over async/await problems.
- **No unrelated changes** — don't refactor or clean up outside the problem scope.
- **No cosmetic changes**.
- **Never test `show.id` for `noemby-` prefix** — check `show.inEmby` instead.
- **`tvdb.deleted` no longer exists** — do not set or read it.
- **Timestamps** for logging: PST/LA, format `MM-DD HH:mm`.
- **Date parsing**: if hour is `24`, replace with `00` (e.g. `24:43:49` → `00:43:49`).
- When deploying, deploy only the changed server(s) — not everything.

## Log Locations (on remote)

| Log             | Path                                                   |
| --------------- | ------------------------------------------------------ |
| srvr            | `apps/srvr/data/misc/srvr.log`                         |
| download        | `apps/down/data/misc/tv.log`                           |
| torrent results | `apps/api/data/tor-results.txt`                        |
| asr             | `apps/asr/data/asr.log` (remote), `/tmp/asr-debug.log` |
