#!/usr/bin/env bash
set -euo pipefail

# Remote bootstrap for the tv monorepo.
#
# Intended target location (per repo convention):
#   ~/dev/apps/tv
#
# What this does:
# - Ensures the repo exists at ~/dev/apps/tv (clone or update)
# - Ensures nvm + Node version from .nvmrc
# - Enables corepack/pnpm and installs deps
# - Ensures pm2 is installed
# - Creates a worktree checkout and starts PM2 from it (cwd points into worktree)
#
# Usage (on hahnca.com):
#   curl -fsSL https://raw.githubusercontent.com/mark-hahn/tv/main/scripts/remote/bootstrap.sh | bash
#
# Optional env vars:
#   TV_REMOTE_MAIN_DIR   (default: "$HOME/dev/apps/tv")
#   TV_REMOTE_WORKTREES  (default: "$HOME/dev/apps/tv-worktrees")
#   TV_REF               (default: "main")
#   INSTALL_NVM=1        (default: 1) auto-install nvm if missing
#   START_PM2=1          (default: 1) start/restart pm2 processes

TV_REMOTE_MAIN_DIR="${TV_REMOTE_MAIN_DIR:-$HOME/dev/apps/tv}"
TV_REMOTE_WORKTREES="${TV_REMOTE_WORKTREES:-$HOME/dev/apps/tv-worktrees}"
TV_REF="${TV_REF:-main}"
INSTALL_NVM="${INSTALL_NVM:-1}"
START_PM2="${START_PM2:-1}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    return 1
  fi
}

need_cmd git
need_cmd bash

mkdir -p "$(dirname "$TV_REMOTE_MAIN_DIR")"

if [[ -d "$TV_REMOTE_MAIN_DIR/.git" ]]; then
  echo "[tv] updating repo: $TV_REMOTE_MAIN_DIR"
  git -C "$TV_REMOTE_MAIN_DIR" fetch --all --prune --tags
  # Best-effort update main checkout; worktrees are the real deploy units.
  git -C "$TV_REMOTE_MAIN_DIR" checkout -q main || true
  git -C "$TV_REMOTE_MAIN_DIR" pull --ff-only || true
else
  echo "[tv] cloning repo to: $TV_REMOTE_MAIN_DIR"
  # SSH is preferred on this host.
  git clone git@github.com:mark-hahn/tv.git "$TV_REMOTE_MAIN_DIR"
fi

# Ensure nvm + node.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
elif [[ "$INSTALL_NVM" == "1" ]]; then
  need_cmd curl
  echo "[tv] installing nvm into $NVM_DIR"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
else
  echo "nvm not found at $NVM_DIR/nvm.sh; install nvm or set INSTALL_NVM=1" >&2
  exit 1
fi

# Pin Node using the repo's .nvmrc.
cd "$TV_REMOTE_MAIN_DIR"
if [[ ! -f .nvmrc ]]; then
  echo "missing .nvmrc in $TV_REMOTE_MAIN_DIR" >&2
  exit 1
fi

echo "[tv] installing/using node from .nvmrc: $(cat .nvmrc)"
nvm install
nvm use

# pnpm via corepack
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found (corepack should provide it)." >&2
  echo "Try: corepack prepare pnpm@latest --activate" >&2
  exit 1
fi

# Install deps in main checkout (helps worktree installs and shared store).
# Safe to re-run.
( cd "$TV_REMOTE_MAIN_DIR" && pnpm install )

# Ensure pm2
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[tv] installing pm2"
  npm install -g pm2
fi

# Create worktree and optionally start PM2 from it.
mkdir -p "$TV_REMOTE_WORKTREES"
"$TV_REMOTE_MAIN_DIR/scripts/worktree-add.sh" "$TV_REF" "$TV_REMOTE_WORKTREES/$TV_REF"

if [[ "$START_PM2" == "1" ]]; then
  "$TV_REMOTE_MAIN_DIR/scripts/pm2-start-worktree.sh" "$TV_REMOTE_WORKTREES/$TV_REF" production
  echo "[tv] pm2 status:"
  pm2 status
else
  echo "[tv] START_PM2!=1; not starting pm2"
fi

cat <<'EOF'

Next (optional): enable PM2 on boot

  pm2 startup
  pm2 save

EOF
