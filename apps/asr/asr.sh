#!/usr/bin/env bash
# asr — thin wrapper: run asr.js ONCE for a folder or a single file
# This version includes better debugging and path handling for PM2 environments

set -euo pipefail

# Debug log for environment troubleshooting
DEBUG_LOG="/tmp/asr-debug.log"
# Also try to log to a global location we can find easily if tmp is private
GLOBAL_DEBUG="/mnt/media/tv/asr-debug-global.log"

exec 2>>"$DEBUG_LOG"
# Mirror stderr to global log
{ echo "--- asr run $(date) ---"; echo "Args: $*"; } >> "$GLOBAL_DEBUG"

echo "--- asr run $(date) ---" >> "$DEBUG_LOG"
echo "Args: $*" >> "$DEBUG_LOG"
echo "User: $(whoami)" >> "$DEBUG_LOG"
echo "PATH: $PATH" >> "$DEBUG_LOG"

BASE_MEDIA="/mnt/media/tv"
RUNTIME_DIR="/root/dev/apps/tv/apps/asr"
ASR_JS_PATH="$RUNTIME_DIR/asr.js"

# Robust PATH
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Find Node
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
    if [[ -x "/usr/bin/node" ]]; then NODE_BIN="/usr/bin/node";
    elif [[ -x "/usr/local/bin/node" ]]; then NODE_BIN="/usr/local/bin/node";
    else NODE_BIN="node"; fi
fi
echo "Using Node: $NODE_BIN" >> "$DEBUG_LOG"

# Runtime env
TMPDIR="/tmp"; export TMPDIR TMP="$TMPDIR" TEMP="$TMPDIR"
ASR_TMPDIR="/tmp/asr-$PPID"; export ASR_TMPDIR
ASR_SECRETS_DIR="$RUNTIME_DIR/secrets"; export ASR_SECRETS_DIR

# ---------- helpers ----------
resolve_path() {
  local p="$1"
  if [[ -z "$p" ]]; then
    printf '%s' "$PWD"
  elif [[ "$p" = /* ]]; then
    printf '%s' "$p"
  elif [[ "$p" = ~* ]]; then
    # shellcheck disable=SC2086
    printf '%s' "$(eval echo "$p")"
  elif [[ "$p" == ./* || "$p" == ../* ]]; then
    printf '%s' "$(realpath -m -- "$PWD/$p")"
  else
    printf '%s' "$BASE_MEDIA/$p"
  fi
}

start_tail() { 
  # Use tail -F (follow name + retry) to handle race condition where file is created shortly after start
  # -n +1 outputs the whole file starting from line 1
  exec tail -F -n +1 "$LOG_FILE"
}

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid; pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null
}

cleanup_stale_pid() { if [[ -f "$PID_FILE" ]] && ! is_running; then rm -f "$PID_FILE"; fi; }

kill_run() {
  local pid=""; [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "${pid:-}" ]] || ! kill -0 "$pid" 2>/dev/null; then
    echo "No asr running"; rm -f "$PID_FILE"; exit 0
  fi
  echo "SIGTERM to process-group $pid"; kill -TERM "-$pid" 2>/dev/null || true; sleep 1
  kill -0 "$pid" 2>/dev/null && { echo "SIGKILL to process-group $pid"; kill -KILL "-$pid" 2>/dev/null || true; }
  rm -f "$PID_FILE"; echo "Stopped."
}

# ---------- parse args ----------
subcmd=""
opts=()
param=""

if (( $# >= 1 )); then
  case "$1" in
    tail|kill|status|last|log|clear|help|-h|--help)
      subcmd="$1"; shift
      param="${1-}"
      ;;
    *)
      # Main run
      while (( $# )); do
        case "$1" in
          --) shift; break ;;
          --*) opts+=("$1"); shift ;;
          *) param="$1"; shift; break ;;
        esac
      done
      if (( $# )); then
        echo "ERROR: multiple non-option arguments detected." >&2
        exit 2
      fi
      ;;
  esac
fi

# Resolve target & mode
TARGET_PATH="$(resolve_path "${param:-}")"
MODE="dir"
TARGET_DIR="$TARGET_PATH"
INPUT_PATH="$TARGET_PATH"
if [[ -e "$TARGET_PATH" && ! -d "$TARGET_PATH" ]]; then
  MODE="file"
  TARGET_DIR="$(dirname "$TARGET_PATH")"
  INPUT_PATH="$TARGET_PATH"
fi

DATA_DIR="$RUNTIME_DIR/data"
mkdir -p "$DATA_DIR"
LOG_FILE="$DATA_DIR/asr.log"
PID_FILE="$DATA_DIR/asr.pid"
SEASON_PATH_FILE="$DATA_DIR/seasonPath"

usage() {
  echo "Usage: asr [target-path] [options]"
  echo "       asr tail"
  echo "       asr kill"
  echo "       asr status"
  echo "       asr log"
  echo "       asr clear"
  exit 1
}

# For singleton operations, we may not need a valid target for some commands
case "$subcmd" in
  help|-h|--help) usage; exit 0 ;;
  tail)
    start_tail ;;
  kill)
    kill_run; exit 0 ;;
  status)
    if is_running; then 
      echo "asr is running (PID $(cat "$PID_FILE"))"
      if [[ -f "$SEASON_PATH_FILE" ]]; then
        echo "Processing: $(cat "$SEASON_PATH_FILE")"
      fi
    else 
      echo "asr is NOT running"
      [[ -f "$PID_FILE" ]] && echo "(stale PID file present: $PID_FILE)"
    fi
    exit 0 ;;
  last)
    exit 0 ;; # truncated for brevity, not used here
  log)
    echo "$LOG_FILE"; exit 0 ;;
  clear)
    : > "$LOG_FILE"
    echo "Log cleared."
    exit 0 ;;
esac

# ---------- main run ----------
[[ -f "$ASR_JS_PATH" ]] || { echo "ERROR: asr.js not found at $ASR_JS_PATH"; exit 1; }
[[ -e "$TARGET_PATH" || -d "$TARGET_DIR" ]] || { echo "ERROR: target not found: $TARGET_PATH"; exit 1; }

cleanup_stale_pid
if is_running; then
  echo "asr already running in: $TARGET_DIR (PID $(cat "$PID_FILE"))"
  echo "Use: asr tail \"$param\"  |  asr kill \"$param\""
  exit 1
fi

echo "Mode: $MODE"
echo "Input: $INPUT_PATH"
echo "Target dir: $TARGET_DIR"
echo "Writing log to: $LOG_FILE"
echo "Starting background process..." >> "$DEBUG_LOG"

# Ensure log file exists immediately to avoid race condition with tail
# Create or empty the log file on new run
: > "$LOG_FILE"

export ASR_MODE ASR_INPUT ASR_NODE_BIN ASR_JS_ENTRY ASR_PID_FILE ORIGINAL_PWD
ASR_MODE="$MODE"
ASR_INPUT="$INPUT_PATH"

echo "$TARGET_DIR" > "$SEASON_PATH_FILE"

ASR_NODE_BIN="$NODE_BIN"
ASR_JS_ENTRY="$ASR_JS_PATH"
ASR_PID_FILE="$PID_FILE"
ORIGINAL_PWD="$TARGET_DIR"
export LOG_FILE PID_FILE TARGET_DIR

if ((${#opts[@]})); then
  ASR_OPTS_SERIALIZED="$(printf '%q ' "${opts[@]}")"; export ASR_OPTS_SERIALIZED
  export ASR_HAS_OPTS="1"
fi

# Use setsid to detach
setsid bash -c '
  exec >/tmp/asr-background.log 2>&1
  set -x
  set -euo pipefail
  trap "" HUP INT
  trap "st=\$?; echo \"[asr] EXIT \$st\" | tee -a \"\$LOG_FILE\"; rm -f \"\$ASR_PID_FILE\"; exit \$st" EXIT
  
  # exec </dev/null
  echo $$ > "$ASR_PID_FILE"
  export TMPDIR="/tmp" TMP="/tmp" TEMP="/tmp"
  cd "'"$RUNTIME_DIR"'"

  { echo "[asr] start $(date)"; echo "Node: $ASR_NODE_BIN"; } >> "$LOG_FILE"

  if [[ "${ASR_HAS_OPTS:-}" = "1" ]]; then
    read -r -a _OPTS <<< "${ASR_OPTS_SERIALIZED:-}"
    { printf "[asr] exec: "; printf "%q " "$ASR_NODE_BIN" "$ASR_JS_ENTRY" "${_OPTS[@]}" "$ASR_INPUT"; printf "\n"; } | tee -a "$LOG_FILE"
    ( "$ASR_NODE_BIN" "$ASR_JS_ENTRY" "${_OPTS[@]}" "$ASR_INPUT" ) 2>&1 | tee -a "$LOG_FILE"
  else
    { printf "[asr] exec: "; printf "%q " "$ASR_NODE_BIN" "$ASR_JS_ENTRY" "$ASR_INPUT"; printf "\n"; } | tee -a "$LOG_FILE"
    ( "$ASR_NODE_BIN" "$ASR_JS_ENTRY" "$ASR_INPUT" ) 2>&1 | tee -a "$LOG_FILE"
  fi
' &

runner_pid=$!
# Do not overwrite PID file here; inner script does it authentically.
echo "Runner PID (wrapper): $runner_pid"
echo "asr is RUNNING in: $TARGET_DIR"
echo "Log file: $LOG_FILE"

# Parent exits
exit 0
