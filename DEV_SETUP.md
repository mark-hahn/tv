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

This repo currently only includes scaffolding; once the old repos are imported we can add:

- `ecosystem.config.cjs` for `@tv/srvr`, `@tv/down`, `@tv/api`
- `scripts/deploy-remote.sh` to build + rsync only production artifacts

## Importing existing repos

Use [scripts/import-repos.sh](scripts/import-repos.sh) (template) once the GitHub SSH URLs/branches are confirmed.
