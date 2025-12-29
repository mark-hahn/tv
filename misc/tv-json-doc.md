
# tv.json

`tv.json` is the runtime “download status” database for tv-proc. It is stored on disk at `data/tv.json` and served over HTTP via `GET /downloads`.

It is intentionally small and append/update-only: the code keeps an in-memory cache (`tvJsonCache`) and only writes to disk at specific moments.

## File location and API

- Disk path: `data/tv.json`
- Endpoint: `GET /downloads` returns the current cached array (loaded via `readTvJson()`)
- Cache reset: `GET|POST /clearCache` **hard-resets** by writing `[]` to `data/tv.json` and setting `tvJsonCache = []`

## Object schema

Each entry describes one “candidate file” that tv-proc has considered. Entries are stored as objects in an array.

Common fields:

- `localPath` (string): Destination directory for the file, always a directory path ending in `/`.
	- Example: `/mnt/media/tv/It's Always Sunny in Philadelphia/Season 17/`
- `title` (string): The **filename** (not the TVDB show title).
	- Example: `its.always.sunny.in.philadelphia.s17e02.1080p.web.h264-successfulcrab.mkv`
- `status` (string): State of this file.
	- Typical values: `future`, `downloading`, `finished`
	- Also used for exceptional states: `stopped`, `Missing`, `rsync exit code 23`, etc.
- `progress` (number): Percent complete, usually an integer 0–100.
- `speed` (number|null): Download speed in bytes/sec, updated while downloading.
	- Computed as the average of the last five instantaneous samples.
	- Preserved when the entry becomes `finished`.
- `eta` (number|null): Unix timestamp (seconds) for estimated completion time.
	- Set only while downloading when rsync reports time remaining.
	- Cleared (`null`) when a file is marked `finished`.
- `sequence` (number): Per-cycle sequence counter (used for ordering/diagnostics).
- `fileSize` (number): File size in bytes.
- `season` / `episode` (number): Parsed from the filename.
- `dateStarted` / `dateEnded` (number): Unix timestamps in seconds.

### Important note: `title` vs TV series title

The stored `title` field is derived from the filename (`fname`). The TV series name (from TVDB/cache/mapping) influences the destination directory (`localPath`), not the `title` field.

## Cache flow (read/write)

### Reading (`readTvJson`)

`readTvJson()` is the single source of truth for reads:

1. If `tvJsonCache` is non-null, it returns the cached array immediately.
2. Otherwise it reads `data/tv.json` from disk, parses it as an array, then performs a one-time normalization + de-dupe + prune.
3. If normalization/de-dupe changed anything, it writes the cleaned array back to disk and stores it in `tvJsonCache`.

Normalization performed on read:

- Ensures `localPath` is a directory path ending in `/`.
- Ensures `title` is a plain filename (not a full path).
- Ensures `fileSize` is numeric bytes (tries to stat the on-disk file when possible).
- Converts `dateStarted`/`dateEnded` into unix seconds.
- Backfills `progress` if missing (`100` when `finished`, `0` when `downloading`).

Pruning performed on read:

- `pruneOldTvJson()` drops entries older than ~30 days, based on `dateEnded` if present, otherwise `dateStarted`.

### Updating (`upsertTvJson`)

`upsertTvJson(localPath, title, patch)` updates one entry:

- Identity rule: an item is primarily identified by **(localPath, title)**.
- It updates in memory (`tvJsonCache = arr`) every time.
- Disk writes are intentionally limited:
	- It writes to disk only when a new item is added, or when a download is marked `finished`.

This is why mid-download progress/ETA changes can be visible via `GET /downloads` (cache) without constantly rewriting `data/tv.json`.

## How entries are created and updated

### 1) Pre-population: `future`

At the start of a cycle, tv-proc iterates through eligible remote files and pre-populates `tv.json` with entries that will likely be processed.

For each eligible episode file, it calls:

- `upsertTvJson(<season dir>, <fname>, { status: 'future', sequence, fileSize, season, episode })`

This provides visibility before any download actually starts.

### 2) Download start: `downloading`

When a file is selected and tv-proc decides it needs downloading, it transitions the entry:

- `status: 'future' → 'downloading'`
- sets `progress: 0`
- sets `dateStarted: unixNow()`

### 3) Progress + ETA updates during rsync

While `rsync` runs, tv-proc parses `--info=progress2` output:

- `progress` is derived from the `%` seen in rsync output.
- `eta` is computed when rsync prints a time remaining:
	- Accepts either `MM:SS` or `HH:MM:SS`.
	- Stored as an absolute unix timestamp: `eta = unixNow() + remainingSeconds`.

These updates call `upsertTvJson(..., { status: 'downloading', progress, eta })`.
Because `upsertTvJson` normally avoids disk writes for mid-download updates, these are typically **cache-only** until the file finishes.

### 4) Completion: `finished`

When rsync completes successfully, tv-proc marks:

- `status: 'finished'`
- `progress: 100`
- `eta: null`
- `dateEnded: unixNow()`

Because `status === 'finished'`, `upsertTvJson` writes the updated array back to `data/tv.json`.

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

