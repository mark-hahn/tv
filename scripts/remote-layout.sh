#!/usr/bin/env bash
set -euo pipefail

# Prints the expected remote directories and a helper command to create them.

REMOTE_HOST="${REMOTE_HOST:-hahnca.com}"
REMOTE_ROOT="${REMOTE_ROOT:-~/dev/apps}"

echo "Remote host: ${REMOTE_HOST}"
echo "Remote root: ${REMOTE_ROOT}"
echo
echo "Expected remote app directories:"
echo "  ${REMOTE_ROOT}/tv-series-srvr"
echo "  ${REMOTE_ROOT}/tv-proc"
echo "  ${REMOTE_ROOT}/torrents-srvr"
echo "  ${REMOTE_ROOT}/tv-shared"
echo
echo "Create them (if ssh is configured):"
echo "  ssh ${REMOTE_HOST} 'mkdir -p ${REMOTE_ROOT}/{tv-series-srvr,tv-proc,torrents-srvr,tv-shared}'"
