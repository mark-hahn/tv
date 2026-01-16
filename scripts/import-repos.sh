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

if [[ -z "$TV_SERIES_CLIENT_URL" || -z "$TV_SERIES_SRVR_URL" || -z "$TV_PROC_URL" || -z "$TORRENTS_SRVR_URL" ]]; then
  cat <<'EOF'
Missing one or more repo URLs.

Set env vars then re-run:
  export TV_SERIES_CLIENT_URL=git@github.com:<owner>/tv-series-client.git
  export TV_SERIES_SRVR_URL=git@github.com:<owner>/tv-series-srvr.git
  export TV_PROC_URL=git@github.com:<owner>/tv-proc.git
  export TORRENTS_SRVR_URL=git@github.com:<owner>/torrents-srvr.git

Then:
  ./scripts/import-repos.sh
EOF
  exit 2
fi

echo "Cloning imports into $ROOT_DIR/.imports ..."
rm -rf .imports/tv-series-client .imports/tv-series-srvr .imports/tv-proc .imports/torrents-srvr

git clone --depth 1 "$TV_SERIES_CLIENT_URL" .imports/tv-series-client
git clone --depth 1 "$TV_SERIES_SRVR_URL" .imports/tv-series-srvr
git clone --depth 1 "$TV_PROC_URL" .imports/tv-proc
git clone --depth 1 "$TORRENTS_SRVR_URL" .imports/torrents-srvr

echo "NOTE: This script only clones. Next step is moving code into apps/* and wiring deps."
