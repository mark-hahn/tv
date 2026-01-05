
# tv.json

`tv.json` is the runtime “download status” database for tv-proc. It is stored on disk at `data/tv.json` and served over HTTP via `GET /downloads`.

It is intentionally small and append/update-only. In multi-worker mode, both the main process and worker processes write `tv.json`, so reads use an mtime-aware cache.

## File location and API

- Disk path: `data/tv.json`
- Endpoint: `GET /downloads` returns the current cached array (loaded via `readTvJson()`)

Finished authority:

- `data/tv-finished.json` is the authority for what is already finished; tv-proc does not infer “finished” from disk state.

## Object schema

Each entry describes one “candidate file” that tv-proc has considered. Entries are stored as objects in an array.

Common fields:

- `localPath` (string): Destination directory for the file, always a directory path ending in `/`.
	- Example: `/mnt/media/tv/It's Always Sunny in Philadelphia/Season 17/`
- `title` (string): The **filename** (not the TVDB show title).
	- Example: `its.always.sunny.in.philadelphia.s17e02.1080p.web.h264-successfulcrab.mkv`
- `status` (string): State of this file.
	- Typical values: `waiting`, `downloading`, `finished`
	- Also used for exceptional states: `stopped`, `Missing`, `rsync exit code 23`, etc.
- `progress` (number): Percent complete, usually an integer 0–100.

- `speed` (number|null): Download speed in bits/sec, updated while downloading.
	- Computed as the moving average of the last three instantaneous samples.
	- Preserved when the entry becomes `finished`.
- `eta` (number|null): Unix timestamp (seconds) for estimated completion time.
	- Set only while downloading when rsync reports time remaining.
	- Cleared (`null`) when a file is marked `finished`.
- `sequence` (number): Per-cycle sequence counter (used for ordering/diagnostics).
- `fileSize` (number): File size in bytes.
- `season` / `episode` (number): Parsed from the filename.
- `dateStarted` / `dateEnded` (number): Unix timestamps in seconds.

Multi-download fields:

- `worker` (number|null): Worker id (1–9) currently assigned to download this file.
	- `null` at app load and when not actively owned by a worker.
- `priority` (number): Sort key for scheduling.
	- Defaults to `0`.
	- When `/startProc?title=...` is used, the newest matching title gets `priority = unixNow()`.

### Important note: `title` vs TV series title

The stored `title` field is derived from the filename (`fname`). The TV series name (from TVDB/cache/mapping) influences the destination directory (`localPath`), not the `title` field.

## Cache flow (read/write)

### Reading (`readTvJson`)

`readTvJson()` is the single source of truth for reads:

1. If the on-disk `mtime` matches the cached version, it returns the cached array immediately.
2. Otherwise it reads `data/tv.json` from disk, parses it as an array, then performs a one-time normalization + de-dupe + prune.
3. If normalization/de-dupe changed anything, it writes the cleaned array back to disk and stores it in `tvJsonCache`.

Normalization performed on read:

- Ensures `localPath` is a directory path ending in `/`.
- Ensures `title` is a plain filename (not a full path).
- Ensures `fileSize` is numeric bytes (does not stat the on-disk file).
- Converts `dateStarted`/`dateEnded` into unix seconds.
- Backfills `progress` if missing (`100` when `finished`, `0` when `downloading`).

Worker normalization performed on boot:

- Clears `worker` back to `null`.

Pruning performed on read:

- `pruneOldTvJson()` drops entries older than ~30 days, based on `dateEnded` if present, otherwise `dateStarted`.

### Updating (`upsertTvJson`)

`upsertTvJson(localPath, title, patch)` updates one entry:

- Identity rule: an item is primarily identified by **(localPath, title)**.
- It updates in memory (`tvJsonCache = arr`) every time.
- Disk writes are intentionally limited:
	- It writes to disk only when a new item is added, or when a download is marked `finished`.

In multi-worker mode, workers update `tv.json` progress/ETA/speed while downloading.

## How entries are created and updated

### 1) Pre-population: `waiting`

At the start of a cycle, tv-proc iterates through eligible remote files and pre-populates `tv.json` with entries that will likely be processed.

For each eligible episode file, it calls:

- `upsertTvJson(<season dir>, <fname>, { status: 'waiting', sequence, fileSize, season, episode })`

This provides visibility before any download actually starts.

### 2) Download start: `downloading`

When a file is selected and tv-proc decides it needs downloading, it queues the entry for a worker:

- main sets `worker: <id>` when a worker is assigned
- worker sets `status: 'downloading'`, `progress: 0`, and `dateStarted: unixNow()`

### 3) Progress + ETA updates during rsync

While `rsync` runs, the worker parses `--info=progress2` output:

- `progress` is derived from the `%` seen in rsync output.
- `eta` is computed when rsync prints a time remaining:
	- Accepts either `MM:SS` or `HH:MM:SS`.
	- Stored as an absolute unix timestamp: `eta = unixNow() + remainingSeconds`.

These updates patch `tv.json` directly from the worker process.

### 4) Completion: `finished`

When rsync completes successfully, the worker marks:

- `status: 'finished'`
- `progress: 100`
- `eta: null`
- `dateEnded: unixNow()`

The worker clears `worker: null` so the entry is no longer owned.

## Duplicate handling

Duplicates can occur when:

- Pre-population guessed a different destination directory (`localPath`) for the same filename, then later processing used a different (correct) directory.

There are two de-dupe passes:

1. **Load-time de-dupe (in `readTvJson`)**
	 - Groups by `(title, fileSize)` and keeps the “most recent” entry.
	 - Recency is based on `dateEnded`/`dateStarted`, with tie-breakers on status and progress.
	 - When it removes entries, it logs a line like: `[dedupe] readTvJson removed N duplicate entries`.

2. **Runtime de-dupe (in `upsertTvJson`)**
	 - If multiple entries share the same `title` (filename), keep only one.
	 - Chooses the best entry using:
		 - newest `dateEnded`/`dateStarted`,
		 - higher status rank (`finished` > `downloading` > `future`),
		 - higher `progress`,
		 - and prefers the entry for the `localPath` currently being updated.
	 - Logs when it removes duplicates:
		 - `[dedupe] removed N duplicate(s) for "<title>", kept: <status> @ <path>`

## When tv.json is flushed to disk

`data/tv.json` is written when:

- `readTvJson()` performs normalization or load-time de-dupe (startup).
- `upsertTvJson()` adds a new item.
- `upsertTvJson()` marks an item as `finished`.

