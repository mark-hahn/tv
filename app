#!/usr/bin/env bash
# Release the native Android TV app (apps/tvapp) to the Sony TV.
# Usage: ./app [device-serial]
# With no argument the device is found by apps/tvapp/connect-tv.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_SCRIPT="$ROOT_DIR/apps/tvapp/build-apk"

if [[ ! -x "$BUILD_SCRIPT" ]]; then
  echo "Error: missing $BUILD_SCRIPT" >&2
  exit 1
fi

exec "$BUILD_SCRIPT" "$@"
