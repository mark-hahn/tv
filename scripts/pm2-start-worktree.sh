#!/usr/bin/env bash
set -euo pipefail

# Start (or restart) PM2 processes from a specific worktree checkout.
#
# Usage:
#   ./scripts/pm2-start-worktree.sh <worktree_dir> [pm2_env]
#
# Example:
#   ./scripts/pm2-start-worktree.sh ~/dev/apps/tv-worktrees/main production

worktree_dir="${1:-}"
pm2_env="${2:-production}"

if [[ -z "$worktree_dir" ]]; then
  echo "usage: $0 <worktree_dir> [pm2_env]" >&2
  exit 2
fi

cd "$worktree_dir"

if [[ ! -f ecosystem.config.cjs ]]; then
  echo "missing ecosystem.config.cjs in $worktree_dir" >&2
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

echo "[pm2] started via $worktree_dir (env=$pm2_env)"
