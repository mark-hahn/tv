#!/usr/bin/env bash
set -euo pipefail

# Remote runtime bootstrap for the tv deploy directory.
#
# Intended target location:
#   ~/dev/apps/tv
#
# This script does NOT use git.
# It assumes the code has already been deployed to the target directory
# (typically via the local ./srvr rsync script).
#
# What this does:
# - Ensures the deploy directory exists
# - Ensures nvm + Node version from .nvmrc
# - Enables corepack/pnpm and installs deps
# - Ensures pm2 is installed
# - Starts/restarts PM2 from the deploy directory
#
# Usage (on hahnca.com):
#   curl -fsSL https://raw.githubusercontent.com/mark-hahn/tv/main/scripts/remote/bootstrap.sh | bash
#
# Optional env vars:
#   TV_REMOTE_DIR        (default: "$HOME/dev/apps/tv")
#   INSTALL_NVM=1        (default: 1) auto-install nvm if missing
#   START_PM2=1          (default: 1) start/restart pm2 processes

TV_REMOTE_DIR="${TV_REMOTE_DIR:-$HOME/dev/apps/tv}"
INSTALL_NVM="${INSTALL_NVM:-1}"
START_PM2="${START_PM2:-1}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    return 1
  fi
}

need_cmd bash

mkdir -p "$TV_REMOTE_DIR"

if [[ ! -d "$TV_REMOTE_DIR" ]]; then
  echo "missing deploy dir: $TV_REMOTE_DIR" >&2
  exit 1
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
cd "$TV_REMOTE_DIR"
if [[ ! -f .nvmrc ]]; then
  echo "missing .nvmrc in $TV_REMOTE_DIR" >&2
  echo "Deploy the code first (e.g. from WSL: ./srvr), then re-run." >&2
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

# Install deps in the deploy dir (safe to re-run).
( cd "$TV_REMOTE_DIR" && pnpm install )

# Ensure pm2
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[tv] installing pm2"
  npm install -g pm2
fi

if [[ "$START_PM2" == "1" ]]; then
  "$TV_REMOTE_DIR/scripts/pm2-start-worktree.sh" "$TV_REMOTE_DIR" production
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
