#!/usr/bin/env bash
set -euo pipefail

# Start (or restart) PM2 processes from a specific deploy directory.
#
# Usage:
#   ./scripts/pm2-start-worktree.sh <deploy_dir> [pm2_env]
#
# Example:
#   ./scripts/pm2-start-worktree.sh ~/dev/apps/tv production

deploy_dir="${1:-}"
pm2_env="${2:-production}"

if [[ -z "$deploy_dir" ]]; then
  echo "usage: $0 <deploy_dir> [pm2_env]" >&2
  exit 2
fi

cd "$deploy_dir"

if [[ ! -f ecosystem.config.cjs ]]; then
  echo "missing ecosystem.config.cjs in $deploy_dir" >&2
  exit 1
fi

# Install deps if needed (safe to re-run).
if [[ -f pnpm-lock.yaml ]]; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
  fi
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
  else
    echo "pnpm not found on PATH" >&2
    exit 1
  fi
fi

pm2 start ecosystem.config.cjs --env "$pm2_env" --update-env
pm2 save

echo "[pm2] started via $deploy_dir (env=$pm2_env)"
