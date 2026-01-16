#!/usr/bin/env bash
set -euo pipefail

# Template: import the old repos into this monorepo.
# Fill in the SSH URLs (or export them as env vars) then run:
#   ./scripts/import-repos.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p .imports

TV_SERIES_CLIENT_URL="${TV_SERIES_CLIENT_URL:-}"
TV_SERIES_SRVR_URL="${TV_SERIES_SRVR_URL:-}"
TV_PROC_URL="${TV_PROC_URL:-}"
TORRENTS_SRVR_URL="${TORRENTS_SRVR_URL:-}"

# Defaults (discovered from GitHub account). Override via env vars if needed.
TV_SERIES_CLIENT_URL="${TV_SERIES_CLIENT_URL:-git@github.com:mark-hahn/tv-series-client.git}"
TV_SERIES_SRVR_URL="${TV_SERIES_SRVR_URL:-git@github.com:mark-hahn/tv-series-srvr.git}"
TV_PROC_URL="${TV_PROC_URL:-git@github.com:mark-hahn/tv-proc.git}"
TORRENTS_SRVR_URL="${TORRENTS_SRVR_URL:-git@github.com:mark-hahn/torrents-srvr.git}"

if [[ -z "$TV_SERIES_CLIENT_URL" || -z "$TV_SERIES_SRVR_URL" || -z "$TV_PROC_URL" || -z "$TORRENTS_SRVR_URL" ]]; then
  echo "Missing one or more repo URLs" >&2
  exit 2
fi

echo "Cloning imports into $ROOT_DIR/.imports ..."
rm -rf .imports/tv-series-client .imports/tv-series-srvr .imports/tv-proc .imports/torrents-srvr

git clone --depth 1 "$TV_SERIES_CLIENT_URL" .imports/tv-series-client
git clone --depth 1 "$TV_SERIES_SRVR_URL" .imports/tv-series-srvr
git clone --depth 1 "$TV_PROC_URL" .imports/tv-proc
git clone --depth 1 "$TORRENTS_SRVR_URL" .imports/torrents-srvr

echo "NOTE: This script only clones. Next step is moving code into apps/* and wiring deps."
