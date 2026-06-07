#!/bin/bash

REPO="sftp:hahnca.com:/mnt/media/backup/mlap"
PASSWORD_FILE="$HOME/.restic-password"
BACKUP_PATHS=("/root" "/etc" "/mnt/c/Users/mark")
LOG="$HOME/mlap-bkup/mlap-bkup.log"
ts() { TZ="America/Los_Angeles" date "+%Y/%m/%d %H:%M:%S"; }
log() { echo "$(ts) $*" >> "$LOG"; }

init_repo() {
    if ! restic -r "$REPO" -p "$PASSWORD_FILE" snapshots >/dev/null 2>&1; then
        echo "Initializing repository at $REPO..."
        restic -r "$REPO" -p "$PASSWORD_FILE" init
    else
        echo "Repository already initialized."
    fi
}

run_backup() {
    echo "Starting backup to $REPO..."
    restic -r "$REPO" -p "$PASSWORD_FILE" backup \
        "${BACKUP_PATHS[@]}" \
        --exclude-file="$HOME/backup-ignore" \
        --one-file-system \
        --tag "automated"
}

if [ ! -f "$PASSWORD_FILE" ]; then
    echo "Error: $PASSWORD_FILE not found."
    exit 1
fi

log "backup started"
START=$(date +%s)

finish() {
    ELAPSED=$(( $(date +%s) - START ))
    MIN=$(( ELAPSED / 60 ))
    SEC=$(( ELAPSED % 60 ))
    [[ -z "$RESULT" ]] && { [[ $STATUS -eq 0 ]] && RESULT="success" || [[ $STATUS -eq 3 ]] && RESULT="success (unable to read some files)" || RESULT="failed (exit $STATUS)"; }
    log "done  elapsed: ${MIN}m ${SEC}s  status: $RESULT"
    echo >> "$LOG"
}
trap 'trap - EXIT INT TERM; STATUS=130; RESULT="cancelled"; finish' INT TERM
trap 'STATUS=$?; finish' EXIT

init_repo
run_backup
STATUS=$?
trap - EXIT
finish

# Put Windows to sleep
if [ "$1" == "--sleep" ]; then
    /mnt/c/Windows/System32/rundll32.exe powrprof.dll,SetSuspendState 0,1,0
fi
