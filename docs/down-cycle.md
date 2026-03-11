# tv-down Cycle — Detailed Walkthrough

## Overview

The cycle runs every **5 minutes** (configurable via `PROCESS_INTERVAL_MS`). It is fully stateless — all maps are re-read from disk at the start of each cycle and no state is carried over. A single cycle is one pass through every file on the USB server, deciding what to queue for download.

---

## Trigger

- **Timer**: `scheduleNextCycle()` sets a 5-minute `setTimeout` → `runCycle()`
- **HTTP** `GET/POST /startProc` on port 3003: calls `runCycle()` immediately (or sets `cycleRestartNeeded` if one is already running)
- **HTTP** `POST /forceDown` with a JSON array of file paths: sets `forcedFiles` then starts a cycle that skips the USB scan and processes only those files

`runCycle()` guards against concurrent execution with `cycleRunning = true`. It calls `reloadState()` and `resetCycleState()`, then hands off to `delOldFiles`.

---

## Step 1: `reloadState()`

Reads from disk every cycle (no caching):

- `tv-blocked.json` → `blocked` — list of filename substrings to permanently skip
- `tv-map` — manual series name remappings (e.g. "Old Name" → "New Name")

---

## Step 2: `delOldFiles()`

Runs at most once per hour (`PRUNE_INTERVAL_MS = 3600000 ms`).

- SSH to USB server: `find ~/files -mtime +21 -exec rm -rf {} \;` — deletes files older than 21 days
- SSH to USB server: `find files -type d` — gets current directory list
- `tvJson.hourlyUsbPruneAndTvResync(dirs)` — prunes DB entries whose USB folder no longer exists, and re-syncs Emby data

After prune (or if it's not time yet), hands off to `checkFiles`.

---

## Step 3: `checkFiles()`

### 3a. Get the file list

Either:

- **Normal mode**: SSH `find files -type f -printf '%CY-%Cm-%Cd-%P-%s\n'` filtered to exclude `.r00`-style rar parts, `.srr`, `.sfv`, `.nfo`, `.nzb`, `.jpg`, `.png`, `.txt`, `.sub`, `.idx`, `.srt` files
- **Forced mode**: use the `forcedFiles` array directly (passed in via `/forceDown`)

### 3b. Load per-cycle state (all fresh — no cross-cycle caching)

- `inProgress` ← `tv-inProgress.json` (files currently being rsync'd)
- `tvJsonTitles` ← `tvJson.getTitlesMap()` — all filenames already in the SQLite DB
- `embyMap` ← `srvr/data/tvdb.json` — maps series names to `{ inEmby, Path, ... }`
- `tvdbCache = {}` — reset to empty (TVDB responses are only cached within a single cycle)

### 3c. Sort and find lock files

Files are parsed with `parse-torrent-title`, sorted by `title / season / episode / basename` so episodes are processed in order.

Any line ending in `!unrar.lock` adds its path to `skipPaths` — files in that folder are skipped while unrar is running.

### 3d. Iterate: calls `checkFile` via `process.nextTick` for each file in turn

---

## Step 4: `checkFile()` — per-file gate

For each file popped from `usbFiles`:

1. **Skip locked path** — if `usbFilePath` starts with any `skipPaths` entry, skip
2. **Extension filter** — skip `.nfo`, `.idx`, `.sub`, `.txt`, `.jpg`, `.jpeg`, `.gif`, `.part`, and 6-char extensions
3. **Error skip** — if already in `tvJsonTitles` with `error: true`, skip (won't retry broken files without a manual retry)
4. **Already queued** — if already in `tvJsonTitles` (non-error), skip
5. **In-progress** — if in `inProgress` map, skip
6. **Blocked** — if `fname` contains any key from `blocked`, skip
7. **Parse filename** with `parse-torrent-title`:
   - extracts `title`, `season`, `episode`, `type` from the filename
   - also parses the parent folder name as `parsedFolder`
   - `parseTitleFromFilename(fname, folderName, parsed)` → `title`
   - `parseTitleFromFilename(folderName, "", parsedFolder)` → `folderTitle` (fallback for abbreviated filenames; set to `null` if same as `title`)
   - `parseFileSeasonEpisode(...)` → `season`, `episode`
8. **Missing S/E** — if `title` parses but `season`/`episode` are missing:
   - checks if `title` matches any emby show via `smartTitleMatch`; if not, silently skips (not a TV show)
   - if it looks like a TV show but S/E can't be parsed, calls `badFile()` → written to `reject.log`
9. **Non-episode** (`type !== "episode"`) → `badFile()`
10. If all checks pass → `process.nextTick(chkTvDB)`

---

## Step 5: `chkTvDB()` — TVDB series name resolution

Goal: resolve the parsed `title` (e.g. `"mitchell and webb"`) to an official TVDB series name (e.g. `"The Mitchell and Webb Situation"`).

1. **Cache check**: if `tvdbCache[title]` already set (from earlier in this same cycle), use it and go directly to `checkFileExists`
2. **Build query variants**: if `title` contains `" and "`, also try the `" & "` variant
3. **TVDB API call**: `GET https://api4.thetvdb.com/v4/search?type=series&q=<title>`
4. **No results + more variants**: retry with next variant (e.g. `" & "` version)
5. **No results at all**:
   - `smartTitleMatch(title, embyInEmbyNames)` — check if title looks like an emby show
   - If **not** in emby: if `folderTitle` exists and differs from `title`, swap `title = folderTitle; folderTitle = null` and retry `chkTvDB` from the top (handles abbreviated filenames like `tmaws.s01e01.avi` → folder `The.Mitchell.And.Webb.Situation.S01.DVDRip` → resolves properly)
   - If still no match: silently skip (not a TV show)
   - If it looks like an emby show but TVDB has no match: `badFile("thetvdb: no series match")`
6. **Results returned**:
   - `smartTitleMatch(title, tvdbNames)` → picks the best-matching name from the TVDB results
   - If no match: if `folderTitle` exists, retry with folder title (same retry path as above)
   - If match found: apply manual `map[]` remapping if present, set `tvdbCache[title] = seriesName`
   - → `setTimeout(checkFileExists, rsyncDelay)` (1 second delay)

---

## Step 6: `checkFileExists()` — Emby filter + queue

1. **Resolve Emby folder path**: `smartTitleMatch(seriesName, Object.keys(embyMap))` gets the canonical emby key → `embyMap[key].Path` gives the folder name on disk (e.g. `"The Mitchell And Webb Situation"`)
2. **Compute paths**:
   - `tvSeasonPath = /mnt/media/tv/<embyFolder>/Season <N>`
   - `tvFilePath = tvSeasonPath/<fname>`
   - `usbPath = ~/files/<torrent-folder>/`
3. **Already on disk**: `fs.existsSync(tvFilePath)` → mark finished in DB, skip
4. **Already in-progress** (`tv-inProgress.json`): skip
5. **Already queued** (DB): skip
6. **Emby filter**: `embyMap[seriesName].inEmby` must be `true`. If `false` or missing: silently skip (not wanted)
7. **Queue**: `tvJson.addEntry({ usbPath, localPath, title: fname, seriesName, status: "waiting", season, episode, ... })` — writes a new row to SQLite
8. Updates `tvJsonTitles[fname]` so later files in the same cycle don't double-queue
9. → `process.nextTick(checkFile)` — continue to next file

---

## Step 7: End of file list

When `usbFiles` is empty, `checkFile()` enters its `else` branch:

- Sets `cycleRunning = false`
- If `cycleRestartNeeded` (a `/startProc` came in mid-cycle): immediately calls `runCycle()` again
- Otherwise: `scheduleNextCycle()` — sets the 5-minute timer for the next cycle

---

## Workers (separate from the cycle)

The cycle only **queues** entries (status `"waiting"`). Actual downloading is handled by `worker.js` via `tvJson.js`:

- Workers are started when entries are added and when a worker finishes
- Worker does: rsync from USB → local season folder, updates status/progress in SQLite
- On success: marks `finished`, moves file from inProgress to done
- The client polls `/downloads` on tv-down (port 3003) and `srvr` for display

---

## Key Design Decisions

- **Fully stateless per cycle**: `embyMap`, `tvdbCache`, `inProgress`, `tvJsonTitles` are all re-loaded or reset at cycle start. Changes to `tvdb.json` (e.g. adding a show with `inEmby: true`) take effect on the very next cycle.
- **No cross-cycle TVDB caching**: `tvdbCache = {}` is reset at cycle start. A show that was not in emby last cycle but is added between cycles will be seen correctly.
- **Within-cycle TVDB caching** (`tvdbCache`): if 20 episodes of the same show appear in one cycle, TVDB is only queried once.
- **folderTitle retry**: abbreviated filenames (e.g. `tmaws.s01e01.avi`) that ptt can't parse to a real title fall back to the parent folder name for TVDB resolution.
- **Emby filter**: only shows with `inEmby: true` in `tvdb.json` are downloaded. Everything else is silently skipped (or `badFile()`'d if it looks like it should be a TV show).
