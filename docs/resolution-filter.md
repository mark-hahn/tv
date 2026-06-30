# Resolution / Quality Download Blocking

Every place in the code that **blocks a download because a file already exists**
(on disk, in the DB, in flexget history, or already sent to qBittorrent). The
blocking is almost always **resolution/quality aware** — an existing file blocks
a new one only when it is the _same or better_ quality. A _strictly better_ new
file is allowed through (and the worse file is renamed to `.old`).

There are two independent download pipelines, each with its own blocking gates:

1. **srvr / flexget → qBittorrent** (`apps/srvr/index.js`) — decides whether to
   even _send_ a torrent to qBittorrent.
2. **down / USB rsync cycle** (`apps/down/src/main.js` + `worker.js`) — decides
   whether to _rsync_ a finished file from the USB host to the Emby disk.

The **tor pane** and **qbt pane** force-download paths deliberately **bypass**
the down-side existence checks (see [Forced downloads](#forced-downloads-bypass)).

---

## 0. Shared quality primitive: `getResolution()`

[packages/share/src/index.js](packages/share/src/index.js#L564)

Both pipelines compare quality through the shared `getResolution(nameOrPath)`
helper:

- **Step 1** — parse `\b(\d{3,4})p\b` out of the name (e.g. `1080p` → `1080`).
  If it is a standard resolution it is returned immediately.
- **Step 2** — optionally probe the real file height via `probeFileFn`.
- **Step 3** — normalize a non-standard height to the nearest quality bucket.
- Returns `null` when nothing is known. Callers almost always coerce that to a
  default of `480` (`getResolution(x) ?? 480`).

Two other quality dimensions are layered on top of resolution everywhere:

- **bit depth** — `10` if the title contains `10bit`/`hdr`, else `8`.
- **bad group** — release group is in the bad-groups set; a non-bad group beats
  a bad group at equal resolution+depth.

---

## 1. srvr → qBittorrent gate: `processFlexgetCandidate()`

[apps/srvr/index.js](apps/srvr/index.js#L7381)

This runs for every candidate torrent flexget surfaces. In order, it blocks
(returns without sending to qBittorrent) when:

### 1a. Exact URL already seen

[apps/srvr/index.js](apps/srvr/index.js#L7393) — if the candidate `url` already
appears anywhere in `flexgetHistory`, return immediately. Not quality-based.

### 1b. Episode watched / past a season gap

[apps/srvr/index.js](apps/srvr/index.js#L7430) — if the episode is already
watched, or the season is past the first on-disk season gap, the candidate is
stored as a _rejected_ candidate (`storeFlexgetRejectedCandidate`) and **not**
downloaded. Not quality-based.

### 1c. Same file from another provider (title + quality dedup)

[apps/srvr/index.js](apps/srvr/index.js#L7460) — normalizes title and quality;
if an entry with the **same normalized title and same normalized quality**
already exists it is treated as a duplicate. The only action is to keep the
copy with more seeds. No new download. This is where "same quality" explicitly
blocks a re-download from a different tracker.

### 1d. Episode already on disk — the core resolution gate

[apps/srvr/index.js](apps/srvr/index.js#L7528)

```
episodeOnDisk = epd.hasFile(rec.episodeData, season, episode)
diskRes  = getEpisodeDiskResolution(rec.path, season, episode)   // strict regex
diskGroup= getEpisodeDiskGroup(rec.path, season, episode)
newRes   = parseResolutionStrict(ptt.resolution || title, quality)
```

Blocking decision when the episode is on disk:

- **No resolution parseable on the new candidate** (`newRes` falsy) → `SKIP(no-resolution)`.
- **`diskRes > newRes`** → `SKIP(disk-…p>=new-…p)` (disk is higher res).
- **`diskRes === newRes` AND `(!diskIsBadGroup || newIsBadGroup)`** → `SKIP`
  (same resolution, and the disk copy is _not_ a worse-group than the new one).
- **Otherwise** → it is an _upgrade_: `addUrlToQbt(url)` is called and the
  candidate is marked sent (`SENT(upgrade-…p->…p)`).

So at equal resolution the **only** way a new file gets through is when the disk
file is a **bad group** and the new one is **not**. A strictly higher resolution
always gets through.

- `getEpisodeDiskResolution()` — [apps/srvr/index.js](apps/srvr/index.js#L7279) —
  reads the season folder and matches the first `SxxExx` video file, extracting
  resolution by **strict filename regex** (`2160p/1080p/720p/576p/480p/384p`),
  returning `0` if unknown.
- `getEpisodeDiskGroup()` — [apps/srvr/index.js](apps/srvr/index.js#L7305).
- `parseResolutionStrict()` — [apps/srvr/index.js](apps/srvr/index.js#L7268) —
  strict regex on title+quality, returns `0` (not a fallback) when unknown.

### 1e. Not on disk but previously sent — upgrade-only

[apps/srvr/index.js](apps/srvr/index.js#L7561)

- If **never sent before** (`!lastSent`) → send (`SENT(first)`).
- If already sent, only send when `flexgetIsBetterCrossRun(newCandidate, lastSent)`
  is true, otherwise `SKIP(worse)`. This blocks re-sending a same/worse quality
  candidate that was already handed to qBittorrent earlier.

### Quality comparators used above

- `flexgetIsBetterCrossRun()` — [apps/srvr/index.js](apps/srvr/index.js#L7232) —
  resolution, then bad-group tiebreaker.
- `flexgetIsBetterSameRun()` — [apps/srvr/index.js](apps/srvr/index.js#L7212) —
  resolution → bit depth → seeds → bad group.
- `flexgetBitDepth()` — [apps/srvr/index.js](apps/srvr/index.js#L7189).
- `flexgetIsBadGroup()` — [apps/srvr/index.js](apps/srvr/index.js#L7204).

---

## 2. down USB-rsync gate: `checkFileExists()` / `checkFile()`

[apps/down/src/main.js](apps/down/src/main.js#L2899)

This is the per-file gate in the USB scan cycle. **All of these checks are
guarded by `!processingForced`**, so forced/tor downloads skip them. In order:

### 2a. File already on disk (exact filename)

[apps/down/src/main.js](apps/down/src/main.js#L2967) — if the destination file
(`destTitle` or `fname`) already exists in the season folder, mark it finished
(using the disk mtime as the date) and skip. `ALREADY ON DISK`. Not
quality-based — this is an exact-name match.

### 2b. Episode already watched

[apps/down/src/main.js](apps/down/src/main.js#L3024) — `SKIP (episode watched)`.

### 2c. Already in-progress

[apps/down/src/main.js](apps/down/src/main.js#L3055) — present in
`tv-inProgress.json`. Skip to avoid duplicate queue entries.

### 2d. Already queued / finished in tv.json

[apps/down/src/main.js](apps/down/src/main.js#L3070) — present in `tvJsonTitles`
→ `already downloaded` (finished) or `already queued`.

### 2e. Not in Emby

[apps/down/src/main.js](apps/down/src/main.js#L3088) — `NOT IN EMBY, SKIPPING`.
Not quality-based.

### 2f. Flex resolution gate (automatic downloads only)

[apps/down/src/main.js](apps/down/src/main.js#L3128)

`fromFlex = !processingForced && !fromTor`. For a flex file with a real S/E:

It builds `flexSeStr` (`SxxExx`) and reads `flexget-history.json`. Two branches:

**Branch A — history key exists with a most-recently-sent candidate**
[apps/down/src/main.js](apps/down/src/main.js#L3180):

- Find any existing disk file for that `SxxExx`.
- If **not on disk** → allow (file was sent but never landed), download
  regardless of quality.
- If **on disk** → compute and compare:
  ```
  diskRes  = getResolution(_diskFile) ?? 480
  usbRes   = getResolution(fname)     ?? 480
  diskDepth/usbDepth = flexBitDepth(...)        // 10 if 10bit/hdr else 8
  diskGroup/usbGroup → badGroupsSet membership
  usbBetterThanDisk =
        usbRes > diskRes
     || (usbRes === diskRes && usbDepth > diskDepth)
     || (usbRes === diskRes && usbDepth === diskDepth && diskIsBad && !usbIsBad)
  ```

  - If **not better** → `FLEX SKIP (disk file same/better quality)` (block).
  - If **better** → rename the disk file to `.old` and let the better USB file
    download.

**Branch B — no history key for this episode**
[apps/down/src/main.js](apps/down/src/main.js#L3263):

- Same disk lookup + identical `usbIsBetter` comparison (resolution → bit depth
  → bad-group tiebreak).
- If not better → `FLEX SKIP (disk file same/better quality)` (block).
- If better → rename worse disk file to `.old`, then download.

**Watched check** [apps/down/src/main.js](apps/down/src/main.js#L3358) — after
the disk comparison, a final `FLEX SKIP (episode watched)`.

`flexBitDepth()` is defined at
[apps/down/src/main.js](apps/down/src/main.js#L2873). (Note:
`flexFileIsBetterThanSent()` at
[apps/down/src/main.js](apps/down/src/main.js#L2877) is a sibling comparator
implementing the same resolution → depth → bad-group ordering against a _sent_
flexget entry.)

### 2g. Within-cycle S/E dedup (bad group)

[apps/down/src/main.js](apps/down/src/main.js#L3389) — if two files for the same
`SxxExx` arrive in one USB scan, a bad-group copy loses to a non-bad-group copy;
otherwise first-seen wins. The loser's queued entry is deleted. This is a
quality (bad-group) based block, not resolution.

### 2h. `checkFile()` finished-row guard

[apps/down/src/main.js](apps/down/src/main.js#L2300) — when a DB row is already
`finished`, it verifies the local file still exists; if so it skips with
`already downloaded`; if the file was deleted it still skips (logs
`local file deleted`). The DVD path also skips DB rows that already exist
([apps/down/src/main.js](apps/down/src/main.js#L1585)).

---

## 3. worker.js — the actual file replacement

[apps/down/src/worker.js](apps/down/src/worker.js#L204)

The worker performs the _only_ real rename-to-`.old`: right before rsync writes,
any existing same-`SxxExx` video file is renamed to `.old`. This happens **only
after the quality gate in main.js already approved the replacement** (comment at
[apps/down/src/worker.js](apps/down/src/worker.js#L204-L205)). For forced
downloads it instead deletes the destination first
([apps/down/src/worker.js](apps/down/src/worker.js#L193)) and skips the rename.

---

## Forced downloads (bypass)

The tor pane and qbt pane intentionally skip the existence/quality gates:

- `POST /forceDown` and `POST /torFiles`
  ([apps/down/src/main.js](apps/down/src/main.js#L860)) register files as
  `forcedFiles` / `torFilePaths`.
- `processingForced` short-circuits every `!processingForced` check in §2.
- `fromTor` files set `fromFlex = false`, so the §2f flex resolution gate is
  skipped entirely
  ([apps/down/src/main.js](apps/down/src/main.js#L3131)).
- Client triggers: qbt "Force Usb" / alt-click
  ([apps/client/src/components/qbt.vue](apps/client/src/components/qbt.vue#L1331))
  and the paneHelp note "Alt+click torrent — force-download (bypass
  already-downloaded checks)".

---

## Summary table

| Gate                       | File                              | Resolution-aware? | Blocks when                                             |
| -------------------------- | --------------------------------- | ----------------- | ------------------------------------------------------- |
| URL dedup                  | srvr `processFlexgetCandidate` 1a | no                | same url already seen                                   |
| watched / season-gap       | srvr 1b                           | no                | episode watched or past season gap                      |
| same title+quality         | srvr 1c                           | quality (exact)   | same normalized title+quality exists                    |
| **episode on disk**        | srvr 1d                           | **yes**           | `diskRes > newRes`, or equal res & disk not worse-group |
| previously sent            | srvr 1e                           | yes               | not better than last sent (res, bad-group)              |
| on disk (exact name)       | down 2a                           | no                | dest filename exists                                    |
| watched                    | down 2b / 2f                      | no                | episode watched                                         |
| in-progress                | down 2c                           | no                | in tv-inProgress.json                                   |
| tv.json queued/finished    | down 2d                           | no                | title already in tv.json                                |
| not in Emby                | down 2e                           | no                | show not in Emby                                        |
| **flex on disk (hist)**    | down 2f-A                         | **yes**           | USB not > disk (res → depth → bad-group)                |
| **flex on disk (no hist)** | down 2f-B                         | **yes**           | USB not > disk (res → depth → bad-group)                |
| cycle S/E dedup            | down 2g                           | bad-group         | bad group vs non-bad in same cycle                      |
| finished-row               | down 2h                           | no                | DB row finished                                         |
