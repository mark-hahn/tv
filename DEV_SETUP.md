# TV Monorepo (WSL-first) Dev Setup

This project is the monorepo named **tv**.

## Goals / constraints

- Do all CLI work in WSL (Node/pnpm/git/scripts).
- Use pnpm + Turborepo (local cache) for orchestration.
- Vite dev server runs in WSL; Windows is typically only VS Code UI + a browser connecting to the WSL dev server.
- Keep the project directory on the WSL filesystem (not `/mnt/c`).
- Remote Linux server: `hahnca.com`.

## Prereqs (WSL)

1) Install `nvm` and Node (pin exact version)

```bash
cd /root/apps/tv

# nvm install (if needed)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install
nvm use
node -v


Node version is pinned by [.nvmrc](.nvmrc).

2) Enable pnpm via Corepack

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v
```

## Install + run (WSL)

```bash
cd /root/apps/tv
pnpm install
pnpm dev
```

`pnpm dev` starts only `@tv/client` (Vite) by default.

### Remote-only servers

Per project convention, server-side apps run on the remote host (`hahnca.com`) and you should not start them locally:

- `@tv/srvr` (tv-series-srvr)
- `@tv/down` (tv-proc)
- `@tv/api` (torrents-srvr)

If you ever need to intentionally run all dev tasks locally (not recommended), the repo includes a guarded command:

```bash
TV_ALLOW_LOCAL_SERVERS=1 pnpm dev:all
```

## Client: expected remote endpoints/ports

These are the network endpoints currently hard-coded/assumed by `@tv/client`.

These are intentionally the *legacy URL paths* (e.g. `/tv-series-srvr`, `/tvproc`, `/torrents-api`) kept for compatibility; nginx routes them to the new monorepo services (`@tv/srvr`, `@tv/down`, `@tv/api`).

Note: the `https://hahnca.com/...` and `wss://hahnca.com/...` URLs are the public nginx-facing endpoints (443); the “internal port” numbers are just what the services bind to on the host.

- **Torrents API (remote `@tv/api`)**: `https://hahnca.com/torrents-api`
  - Used for most API calls (search/download/qBittorrent UI info, etc).
  - Also used as a TVDB proxy: `https://hahnca.com/torrents-api/api/tvdb/*`.
  - Remote internal port is `3001` (typically reverse-proxied behind HTTPS).

- **tv-proc (remote `@tv/down`)**: `https://hahnca.com/tvproc`
  - Client uses: `/downloads`, `/startProc` (POST), `/deleteProcids` (POST).
  - Remote internal port is `3003` (typically reverse-proxied behind HTTPS).

- **tv-series-srvr websocket (remote `@tv/srvr`)**: `wss://hahnca.com/tv-series-srvr`
  - Remote internal websocket port is `8736` (typically reverse-proxied behind WSS).

- **Emby/Jellyfin-style API**: `https://hahnca.com:8920/emby/*` (explicit port `8920`).

- **Show images**: `https://hahnca.com/tv/<Show Name>/(poster.jpg|landscape.jpg|clearlogo.png)`.

## Repo layout

- `apps/client` → old `tv-series-client`
- `apps/srvr` → old `tv-series-srvr`
- `apps/down` → old `tv-proc`
- `apps/api` → old `torrents-srvr`
- `packages/share` → shared utilities (formerly `tv-shared`)

Package naming uses `@tv/<name>`.

## Remote server layout

The deployed server-side code directory is:

- `hahnca.com:~/dev/apps/tv`

The remote dir `tv-series-client` is only for hosting built production files.

## PM2 (deploy pattern)

The current pattern is:

- Deploy the repo directly to `~/dev/apps/tv` on the remote host.
- PM2 processes set `cwd` to the app folder inside that checkout.

## Shared data/secrets across deploys

Deploy directories should not maintain their own `data/` or `secrets/` state, because redeploys can clobber or diverge runtime state.

All server-side apps in this repo now support a shared data root via `TV_DATA_DIR` (defaults to `/root/dev/apps/tv-data`).

Expected layout under `TV_DATA_DIR`:

- `secrets/` (shared secrets)
- `api/cookies/` (torrents API cookies, creds, local certs)
- `down/data/` + `down/misc/` (tv-proc state/logs)
- `srvr/data/` + `srvr/misc/` (tv-series-srvr state/logs)

Example (run from WSL to deploy + restart on the remote host):

```bash
cd /root/apps/tv
./srvr
```


<!-- -->


