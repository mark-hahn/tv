#!/usr/bin/env bash
set -euo pipefail

# Prints the expected remote directories for the current tv monorepo deploy layout
# (main checkout + git worktrees).

REMOTE_HOST="${REMOTE_HOST:-hahnca.com}"

# Note: on hahnca.com, /root/dev is symlinked to /mnt/media/archive/dev.
REMOTE_APPS_ROOT="${REMOTE_APPS_ROOT:-~/dev/apps}"
REMOTE_MAIN_DIR="${REMOTE_MAIN_DIR:-${REMOTE_APPS_ROOT}/tv}"
REMOTE_WORKTREES_DIR="${REMOTE_WORKTREES_DIR:-${REMOTE_APPS_ROOT}/tv-worktrees}"

echo "Remote host: ${REMOTE_HOST}"
echo "Remote apps root: ${REMOTE_APPS_ROOT}"
echo "Main checkout: ${REMOTE_MAIN_DIR}"
echo "Worktrees root: ${REMOTE_WORKTREES_DIR}"
echo
echo "Expected remote app directories:"
echo "  ${REMOTE_MAIN_DIR}"
echo "  ${REMOTE_WORKTREES_DIR}/<ref>    (e.g. ${REMOTE_WORKTREES_DIR}/main)"
echo
echo "Create them (if ssh is configured):"
echo "  ssh ${REMOTE_HOST} 'mkdir -p ${REMOTE_APPS_ROOT} ${REMOTE_WORKTREES_DIR}'"

echo
echo "Bootstrap (recommended):"
echo "  ssh ${REMOTE_HOST} 'curl -fsSL https://raw.githubusercontent.com/mark-hahn/tv/main/scripts/remote/bootstrap.sh | bash'"
