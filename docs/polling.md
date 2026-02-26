# Polling Locations

## Client-side

### 1. `srvr.js` — lastViewed cache

- **Pane:** none (global client module, always active)
- **Frequency:** every 10 seconds
- **When:** always, starts immediately on app load

### 2. `list.vue` — playing device / watching name

- **Pane:** list
- **Frequency:** every 10 seconds
- **When:** while the list component is mounted (i.e., always after first load)

### 3. `flex.vue` — flex cards

- **Pane:** flex
- **Frequency:** every 10 seconds after previous poll completes
- **When:** only while the flex pane is the active pane (`onPaneChanged`)

### 4. `down.vue` — tvproc download status

- **Pane:** down (but polls in background regardless of active pane)
- **Frequency:** every 5 seconds normally; switches to every 1 second for 30 seconds after a `cycle-started` event
- **When:** always — starts on mount, runs in the background even when the down pane is not visible

### 5. `qbt.vue` — qBittorrent torrent list

- **Pane:** qbt (but polls in background regardless of active pane)
- **Frequency:** every 5 seconds after previous poll completes
- **When:** always — starts on mount, continues regardless of which pane is visible

### 6. `App.vue` — qbt active-download indicator

- **Pane:** none (App-level, drives the "down active" badge)
- **Frequency:** every 5 seconds after previous poll completes
- **When:** always — starts on app `mounted`

### 7. `App.vue` — Emby library refresh progress

- **Pane:** none (App-level progress display)
- **Frequency:** every 2 seconds
- **When:** only during an active Emby library refresh (stops when task is no longer running)

### 8. `buttons.vue` — shared filters

- **Pane:** list (buttons bar inside the list view)
- **Frequency:** every 3 seconds
- **When:** while the buttons component is mounted (always after first load)

### 9. `usb.vue` — prune status

- **Pane:** usb
- **Frequency:** every 400 ms
- **When:** only while a prune operation is actively running (`startPrunePolling` / `stopPrunePolling`)

---

## Server-side

### 10. `srvr/src/lastViewed.js` — Emby devices (what's playing)

- **Server:** srvr
- **Frequency:** every 60 seconds
- **When:** always — plus one immediate call 1 second after startup

### 11. `srvr/index.js` — USB check

- **Server:** srvr
- **Frequency:** every 60 minutes
- **When:** always

### 12. `srvr/index.js` — Emby scan task status (in-process loop)

- **Server:** srvr
- **Frequency:** every 5 seconds
- **When:** only after a chokidar disk-change triggers an Emby library refresh; times out after 5 minutes

### 13. `down/src/main.js` — download cycle

- **Server:** down
- **Frequency:** every 5 minutes after the previous cycle completes
- **When:** always

### 14. `down/src/tvJson.js` — SQLite backup scheduler

- **Server:** down
- **Frequency:** checks every 20 seconds; backup runs at 05:30, 11:30, 17:30, 23:30 PST
- **When:** always
