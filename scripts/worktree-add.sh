#!/usr/bin/env bash
set -euo pipefail

# Create (or update) a git worktree checkout for a branch/tag/commit.
#
# Usage:
#   ./scripts/worktree-add.sh <ref> [worktree_dir]
#
# Examples:
#   ./scripts/worktree-add.sh main
#   ./scripts/worktree-add.sh release-2026-01-15 ~/dev/apps/tv-worktrees/release-2026-01-15
#   ./scripts/worktree-add.sh v1.2.3

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ref="${1:-}"
if [[ -z "$ref" ]]; then
  echo "usage: $0 <ref> [worktree_dir]" >&2
  exit 2
fi

worktree_dir="${2:-$ROOT_DIR/../tv-worktrees/$ref}"

mkdir -p "$(dirname "$worktree_dir")"

echo "[worktree] repo=$ROOT_DIR"
echo "[worktree] ref=$ref"
echo "[worktree] dir=$worktree_dir"

worktree_add_or_detach() {
  local checkout_ref="$1"
  shift
  if git worktree add "$worktree_dir" "$checkout_ref"; then
    return 0
  fi
  echo "[worktree] branch already in-use; falling back to detached checkout of $checkout_ref" >&2
  git worktree add --detach "$worktree_dir" "$checkout_ref"
}

# Keep refs fresh.
git fetch --all --prune --tags

if git worktree list --porcelain | grep -Fq "worktree $worktree_dir"; then
  echo "[worktree] already exists: $worktree_dir"
  exit 0
fi

# If ref is a local branch name, create/reset it to the remote tracking branch if possible.
if git show-ref --verify --quiet "refs/heads/$ref"; then
  worktree_add_or_detach "$ref"
  exit 0
fi

# If ref is a remote branch (origin/<ref>), create a local branch pointing at it.
if git show-ref --verify --quiet "refs/remotes/origin/$ref"; then
  if git worktree add -B "$ref" "$worktree_dir" "origin/$ref"; then
    exit 0
  fi
  echo "[worktree] branch already in-use; falling back to detached checkout of origin/$ref" >&2
  git worktree add --detach "$worktree_dir" "origin/$ref"
  exit 0
fi

# Otherwise treat as tag/commit-ish and create a detached worktree.
git worktree add --detach "$worktree_dir" "$ref"
