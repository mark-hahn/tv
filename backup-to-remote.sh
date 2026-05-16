#!/bin/bash

REPO="/mnt/media/backup/mlap"
PASSWORD_FILE="$HOME/.restic-password"
BACKUP_PATHS=("/root" "/etc")

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

cleanup() {
    echo "Cleaning up old snapshots..."
    restic -r "$REPO" -p "$PASSWORD_FILE" forget \
        --keep-daily 7 \
        --keep-weekly 4 \
        --prune
}

if [ ! -f "$PASSWORD_FILE" ]; then
    echo "Error: $PASSWORD_FILE not found."
    exit 1
fi

init_repo
run_backup
cleanup
