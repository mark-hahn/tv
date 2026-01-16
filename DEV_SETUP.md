# TV Monorepo (WSL-first) Dev Setup

This repo is the new monorepo named **tv**.

## Goals / constraints

- Do all CLI work in WSL (Node/pnpm/git/scripts).
- Use pnpm + Turborepo (local cache) for orchestration.
- Windows is only VS Code UI + browser.
- Keep the repo on the WSL filesystem (not `/mnt/c`).
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
```

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
- `packages/share` → old `tv-shared` (no git/GitHub in old world)

Package naming uses `@tv/<name>`.

## Remote server layout

Remote code lives under:

- `hahnca.com:~/dev/apps/tv-series-srvr`
- `hahnca.com:~/dev/apps/tv-proc`
- `hahnca.com:~/dev/apps/torrents-srvr`
- `hahnca.com:~/dev/apps/tv-shared`

The remote dir `tv-series-client` is only for hosting built production files.

## Worktrees + PM2 (deploy pattern)

The intended pattern is:

- Use Git worktrees for deploy checkouts (per branch/release).
- PM2 processes set `cwd` to the deployed worktree/app folder.

This repo includes minimal scaffolding for that pattern:

- [ecosystem.config.cjs](ecosystem.config.cjs) (PM2 config; `cwd` is inside the worktree)
- [scripts/worktree-add.sh](scripts/worktree-add.sh) (create a worktree checkout)
- [scripts/pm2-start-worktree.sh](scripts/pm2-start-worktree.sh) (start/restart PM2 from that worktree)

Example (run on the remote host):

```bash
cd ~/dev/apps/tv   # your "main" checkout of the monorepo
./scripts/worktree-add.sh main ~/dev/apps/tv-worktrees/main
./scripts/pm2-start-worktree.sh ~/dev/apps/tv-worktrees/main production
```

## Importing existing repos

Use [scripts/import-repos.sh](scripts/import-repos.sh) (template) once the GitHub SSH URLs/branches are confirmed.

## Sync tv-shared from remote

The shared module originally lived on the remote server as `tv-shared` (not a GitHub repo). In this monorepo it is represented as `@tv/share` under `packages/share`.

To sync the implementation from the remote server into this repo:

```bash
cd /root/apps/tv
./scripts/sync-tv-shared.sh
```

By default it pulls from `hahnca.com:/root/dev/apps/tv-shared/index.js`. Override if needed:

- `REMOTE_HOST` (default: `hahnca.com`)
- `REMOTE_TV_SHARED_DIR` (default: `/root/dev/apps/tv-shared`)

