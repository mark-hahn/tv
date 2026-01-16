#!/usr/bin/env bash
set -euo pipefail

# Syncs the legacy remote tv-shared implementation into this monorepo package:
#   packages/share/src/index.js

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE_HOST="${REMOTE_HOST:-hahnca.com}"
# Use an absolute default to avoid shell-specific ~ expansion issues over ssh.
REMOTE_TV_SHARED_DIR="${REMOTE_TV_SHARED_DIR:-/root/dev/apps/tv-shared}"
REMOTE_INDEX_JS="${REMOTE_TV_SHARED_DIR%/}/index.js"

DEST_FILE="packages/share/src/index.js"

tmpfile="$(mktemp)"
trap 'rm -f "$tmpfile"' EXIT

echo "Syncing tv-shared from ${REMOTE_HOST}:${REMOTE_INDEX_JS} -> ${DEST_FILE}"

if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_HOST" "test -f \"$REMOTE_INDEX_JS\""; then
  echo "Remote file not found: ${REMOTE_HOST}:${REMOTE_INDEX_JS}" >&2
  echo "Hint: override REMOTE_TV_SHARED_DIR (current: ${REMOTE_TV_SHARED_DIR})" >&2
  exit 2
fi

ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_HOST" "cat \"$REMOTE_INDEX_JS\"" > "$tmpfile"

if [[ ! -s "$tmpfile" ]]; then
  echo "Remote file was empty: ${REMOTE_HOST}:${REMOTE_INDEX_JS}" >&2
  exit 2
fi

mkdir -p "$(dirname "$DEST_FILE")"
cp "$tmpfile" "$DEST_FILE"

node -e "const s=require('./packages/share/src'); if(!s.smartTitleMatch) { process.exit(3) } console.log('ok:', Object.keys(s).join(','))" >/dev/null

echo "Done. Review changes with: git diff -- ${DEST_FILE}"
