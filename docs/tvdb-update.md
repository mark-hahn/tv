# TVDB Update Logic

How a show record in `tvdb.db` gets refreshed: who triggers it, the queues it
passes through, what each stage writes, and how disk changes (chokidar), the gap
check, and remote links fit in.

Everything here runs in **tv-srvr** (`apps/srvr`), the single writer of
`apps/srvr/data/tvdb.db`. The main files are:

| file                     | role                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `apps/srvr/src/tvdb.js`  | in-memory `allTvdb`, both queues, TVDB/IMDB/Rotten/wiki scraping  |
| `apps/srvr/src/tvdbDb.js`| the only SQLite access layer (`loadAllShows`/`saveShow`/…)        |
| `apps/srvr/index.js`     | callbacks into the loop, chokidar watcher, Emby sweep, gap check  |
| `apps/srvr/src/disk.js`  | `refreshEpisodeData` — the one authoritative episodeData refresh  |
| `apps/srvr/src/emby.js`  | `gapCheckOne` / `gapCheckBatch` — the gap ("chkgap") computation  |

## 1. Storage and the in-memory copy

`tvdbDb.js` opens `data/tvdb.db` (WAL, `busy_timeout=5000`) and dies immediately
if the file is missing. Schema is one table: `shows(name TEXT PRIMARY KEY, json
TEXT)`.

- `loadAllShows()` — parses every row into `{ [name]: record }` and remembers the
  exact JSON per name in `lastSavedJson`.
- `saveShow(name, record)` — re-stringifies and **skips the write when the JSON is
  byte-identical** to what was last saved. This is what keeps the constant
  background churn from writing.
- `deleteShow(name)`, `saveAllShows(all)` (a transaction that also deletes rows no
  longer present in memory), `backupDb()` (`VACUUM INTO tvdb.db.bak`).

On module load `tvdb.js` builds `allTvdb` from `loadAllShows()` and runs the
startup migrations in this order: `migrateRemotesToFlatProps` →
`stripLegacyLastWatched` → `stripDeadFields` → `normalizeAllTvdbTimestampFields`,
then `saveAllShows`. A failure here throws and aborts startup.

Two timers then run for the life of the process (`tvdb.js`):

- **sweep** every 5 min — `normalizeAllTvdbTimestampFields` + `saveAllShows`, so
  anything mutated in memory by any code path eventually lands in the db.
- **backup** at startup and every 24 h — `backupDb()`.

`getAllTvdbSync()` hands out the live `allTvdb` object, so callers that mutate a
record are mutating the in-memory truth; they must call `saveTvdbSync()` (or rely
on the 5-minute sweep) to persist.

### Timestamp normalization

`TVDB_TIMESTAMP_RESOLUTION` maps each timestamp field to `day` / `sec` / `ms`
(`saved`, `date`, `dateCreated`, `lastGapCheck`, `lastPlayedDate`, `leftEmby` in
ms; `firstAired`, `lastAired`, `nextAired`, `premiereDate` day-only;
`last-downloaded` in seconds). `normalizeTvdbTimestampValue` accepts epoch
seconds/ms, `YYYY-MM-DD`, `YYYY/MM/DD hh:mm:ss[.mmm]` or anything `Date.parse`
handles, and rewrites it to PST at the field's resolution (hour `24` → `00`).
Every save path runs the record through `normalizeTvdbTimestampFields` first.

## 2. The two queues

### `showProcessQueue` — per-show full refresh

The outer work queue. Items are `{ name, skipRotten, isBackground }`.

`enqueueShowProcess(showName, opts)`:

- drops the request if the show is already `currentlyProcessingShow` or already in
  the queue (logged, not silent);
- `opts.priority` unshifts, otherwise pushes;
- fires `enqueueCallback` only on the 0→1 transition (avoids flooding clients on
  bulk enqueues);
- kicks `tryLocalGetTvdb` on a `setTimeout(…, 0)` so a queued show starts right
  away instead of waiting for the next tick.

Who enqueues:

| source | call |
| ------ | ---- |
| `POST /api/triggerShowSelect` (client selects a show) | `enqueueShowProcess(name, { skipRotten: true })` |
| `POST /api/triggerShowGapCheck` | `enqueueShowProcess(name, { priority: true })` |
| `POST /api/refreshEmbyItem` | after a 4 s Emby settle delay, `enqueueShowProcess(name)` |
| `setTvdbFields` (any field write, unless `dontEnqueue`) | `enqueueShowProcess(name)` |
| background timer | stalest show, `{ isBackground: true }` |

### `newTvdbQueue` — TVDB API scrape

The inner queue, drained by `chkTvdbQueue()`, strictly one at a time
(`chkTvdbQueueRunning`). Items are `{ ws, id, paramObj, resolve }` and are
**popped from the end**, so `unshift` (used by every internal caller) is FIFO.

`chkTvdbQueue()`:

1. snapshots the old record *before* `getTvdbData` overwrites `allTvdb[name]` —
   otherwise every change comparison would be trivially equal;
2. skips items whose WebSocket has closed;
3. calls `getTvdbData(paramObj, resolve, reject)`;
4. on resolve: normalizes timestamps, diffs `lastAired` / `status` / season count /
   remotes count / `overview` / `imdbRatings` / `rottenRatings` into a change list
   ("push1"), stores `allTvdb[keyName]`, stamps `saved`, `saveShow(...)`, and
   notifies clients **only when something actually changed**;
5. `paramObj.transient` requests (info-pane previews) skip all of that — nothing is
   written to `allTvdb` or the db;
6. `paramObj.suppressNotify` (used by the background loop) defers the push and
   leaves `_hasChanges` on the record for the caller to read.

## 3. `getTvdbData` — the TVDB scrape itself

Requires `show.tvdbId`; without one it resolves with just the name.

1. **Canonicalization.** Scans `allTvdb` for another record with the same
   `tvdbId`; if found, that record's name wins and the input name is treated as an
   alias. At the end the duplicate key is deleted from memory and the db.
2. `GET https://api4.thetvdb.com/v4/series/{tvdbId}/extended` with a bearer token
   from `getToken()` (login with the hard-wired apikey/pin, cached 20 h).
3. Pulls `firstAired`, `lastAired`, `nextAired`, `overview`, `remoteIds`,
   `averageRuntime`, `originalCountry/Language/Network`, `status`, `trailers`,
   `genres`; poster via `getTvdbImageUrl` (first English `type === 2` artwork),
   cast via `getTvdbCharacters`, crew via `getTvmazeCrew(tvdbId)`.
4. **Counts.** `getApiCounts` from the extended payload; if the episode count is
   missing it falls back to `getDefaultOrderCounts` (the `episodes/default`
   endpoint). `chooseCount` picks between the caller-supplied, existing, and API
   counts.
5. **Remotes** (skipped for `transient`, which only extracts the IMDB url from
   `remoteIds` so the reviews pane can load) — see §6.
6. **Fallbacks.** If image/overview/firstAired/status are missing, `getTmdbFallback`
   queries TMDB; a still-missing poster falls back to the TVDB *search* thumbnail
   (upcoming shows often have only that). The `preserve(new, existing, tmdb)`
   helper never lets a blank API value overwrite a stored one.
7. **Field merge.** Emby-side (`id`, `path`, `dateCreated`, `premiereDate`,
   `inToTry`/`inContinue`/`inMark`/`inLinda`, `played`, `playCount`,
   `lastPlayedDate`), disk-side (`date`, `size`, `noFiles`), `tvmazeId`, `leftEmby`,
   `anticipating`, `sitcom`, `hiddenFromRow`, `last-downloaded`, `seasonIntros`,
   and the flat gap fields are all carried forward from `existing` when the new
   payload does not supply them. `episodeData`, `quality` and
   `seasonPremiereDates` are runtime state and are always preserved as-is —
   `getTvdbData` never computes them.
8. **inEmby.** `fromEmbySync` forces `true`; otherwise `show.inEmby ?? existing
   .inEmby ?? false`. The Emby button in `remotes` is added/removed to match.
   `notReady` defaults to `true` for an inEmby show until the gap check runs.
9. `waitStr` is recomputed from the *existing* `episodeData` (fresh episode data
   isn't fetched at this stage — the loop refreshes it right after).
10. `setImdbId` extracts `ttNNNNNNN` from `imdbUrl`/remotes.
11. If `inEmby` or `status` changed, `pickupChangeCallback` fires → `index.js`
    adds/removes the show in flexget pickups and clears its snooze entry.

## 4. `tryLocalGetTvdb` — the per-show pipeline

One show at a time (`tryLocalGetTvdbBusy`). Steps for the dequeued show:

1. **preTvdbTickCallback** — `index.js` runs `runEmbyFullSweep` on every 10th
   *background* tick (§5).
2. Dequeue, set `currentlyProcessingShow`, capture `waitStrBefore`, notify clients
   `showUpdating`.
3. **Early map refresh** (foreground only, inEmby only):
   `refreshEpisodeData(name, rec, { sources: ["emby", "disk"] })` + push, so an open
   map pane updates immediately instead of waiting on the slow TVDB scrape. No db
   write here.
4. **push1** — queue a `newTvdbQueue` entry (`fast: false`, `suppressNotify: true`)
   and await it: the full TVDB scrape from §3.
5. **episodeData** — `refreshEpisodeData(name, rec)` with all three sources, then
   `saveShow`.
6. **waitStr flip** — if `!!waitStrBefore !== !!waitStrAfter`,
   `waitStrChangedCallback` hides (waitStr appeared) or unhides (waitStr cleared)
   the show in Emby by backdating/restoring `DateCreated` / `LastPlayedDate`.
7. **push2** — `perShowCallback` (§5): subtitle scan, resolution fallback,
   `lastPlayedDate`, compact-NNN filename fix, gap check, `needsIntro`, bif queue,
   OpenSubtitles check.
8. **Combined notify** — one `tvdbUpdated` push if push1 *or* push2 changed
   anything; otherwise just a "no changes" log.
9. **crew backfill** — `getTvmazeCrew` for records whose `crew` is not yet an array
   (`null` = never fetched, `[]` = fetched and empty).
10. **push3** — Rotten Tomatoes scrape (`getRemote(null, 99, name)`), skipped when
    `skipRotten` (i.e. user-selected shows). Updates `rottenUrl`/`rottenRatings`,
    replaces the Rotten entry in `remotes`, saves and pushes. It is last because it
    is the slowest step (its duration is logged).
11. `queueDrainCallback` → `showQueueEmpty` when the queue is empty; then reschedule
    itself in 1 s (queue non-empty) or `TVDB_UPDATE_DELAY_MS` (5 min).

### The background timer

`updateTvdbLocal()` runs every `TVDB_UPDATE_DELAY_MS` (5 min; 5 s if
`FAST_UPDATE` is flipped on). When the queue is empty it picks the **stalest**
record by `saved` (a record with no `saved` wins outright) and enqueues it as
background work. `updateCycleCount % 10 !== 0` selects inEmby shows; every 10th
cycle picks a non-Emby show instead, so the non-Emby side of the library still
gets refreshed without competing with it.

## 5. `index.js` callbacks

`tvdb.js` holds no imports of `index.js`; the wiring is by setter to avoid a
circular import.

| setter | what index.js does |
| ------ | ------------------ |
| `setNotifyCallback` | `debouncedTvdbPush` — 500 ms per-show debounce, then WS `tvdbUpdated` with the record |
| `setEnqueueCallback` | WS `showUpdating` |
| `setQueueDrainCallback` | WS `showQueueEmpty` |
| `setPickupChangeCallback` | add/remove flexget pickup, drop snooze entry |
| `setRefreshEpisodeDataCallback` | `disk.refreshEpisodeData` |
| `setPreTvdbTickCallback` | `runEmbyFullSweep` on every 10th background tick |
| `setPerShowCallback` | the push2 body below |
| `setWaitStrChangedCallback` | hide/unhide in Emby on a waitStr flip |

### perShowCallback (push2)

For inEmby shows: walks the show folder and enqueues any video needing a subtitle
check (`fileNeedsSubChecked` → `enqueueSubQueue`, low priority), then
`scanShowForResFallback` (keeps a hidden 1080 `.alt` beside unwatched 2160s).
Then, for shows with an Emby id:

- `fetchLatestPlayedInfo` → `lastPlayedDate`;
- `fixCompactEpisodeNaming` — Emby reads `101-Title.avi` as episode 101; the files
  are renamed to `SxxExx - Title.ext`, Emby is refreshed, and the code waits 8 s
  before the gap check reads the new data;
- **gap check** (§7) → assigns the gap fields, stamps `lastGapCheck`, drops the
  transient `allAiredHaveFile`/`allAiredWatched`/`allWatchedOrHaveFile` keys;
- `full` = inEmby && every episode is watched or has a file;
- `needsIntro` = inEmby && no season has a configured intro (`trimPos`/`skipDur`/
  `none: true`) && unwatched episodes remain && at least one season has files. A
  flip calls `bifQueue.handleNeedsIntroChange` to queue or cancel `.bif` generation;
- finally `checkAndDownloadOpnSrt` + `processChksrtSnoozedForShow`.

For non-Emby shows it forces the error fields to known constants (`fileGap`,
`fileEndError`, `watchGap`, `seasonWatchedThenNofile` and their season/episode
fields false/null, `full: false`, `needsIntro: false`, `notReady: true`).

It returns `{ hasChanges, changes }` so the loop can decide whether to push.

### `runEmbyFullSweep`

Reconciles the whole library against Emby; one running plus one queued (a request
while running sets `embyFullSweepQueued` and re-runs afterwards). It snapshots
every record as JSON first so it can push exactly the ones that changed.

1. Fetch the Emby series list plus the four collections (toTry / continue / mark /
   linda) in parallel.
2. **Key cleanup** — records whose map key ≠ `record.name` are re-keyed (or dropped
   via `setTvdbFields({ $delTvdb })` when the correct key already exists).
3. **Sync each Emby show**: match by name, else by `tvdbId`. No match →
   `getNewTvdb` with `fromEmbySync: true` (blocked if `findCandidate` finds a
   likely-same-show record under a normalized title, to avoid duplicates). Match →
   update `id`, `path`, `genres`, `overview`, `dateCreated`, `premiereDate`,
   `played`, `playCount`, the four collection flags, and backfill a missing
   `name`/`tvdbId` (merging and deleting a duplicate record if one owns that
   tvdbId).
4. **Disappeared shows** → `inEmby = false`, `notReady = true`, all four collection
   flags false, the show folder is deleted from disk so Emby cannot re-add it, and
   `handlePickupChange` removes the pickup.
5. **Stale non-Emby fields** are forced back to constants.
6. `saveTvdbSync()`, then a debounced push for every record whose JSON changed and
   for every deleted record.

## 6. Remote links

`getRemotes(show, tvdbRemotes, fast)` builds the `remotes` display array and a
`flatUrls` object of props that are persisted (`wikiUrl`, `wikiVerified`,
`imdbUrl`, `imdbRatings`, `imdbReviewers`, `imdbVideo`, `rottenUrl`,
`rottenRatings`). The `remotes` array itself is a computed convenience — it is
rebuilt from those flat props on each refresh. `redditUrl`/`redditVerified` are no
longer fetched; stored values are left untouched.

Buttons, in order:

- **Emby** — `urls.embyPageUrl(showId)`, present only when `inEmby`.
- **Rotten** — always from the cached `rottenUrl` (plus `rottenRatings` in the
  label). Only push3 of the background loop actually scrapes (`rottenSearch`);
  when there is no cached url a slug url `rottentomatoes.com/tv/<name>` is
  HEAD-checked with `isValidUrl` and used if it responds.
- **Google** — a plain search url, no fetch.
- **Wikipedia** — `getRemote(…, 18, …)` searches the MediaWiki API
  (`list=search&srsearch=<name> tv series`) for the url, then `verifyRemoteName`
  loads the page, extracts the `<title>` (dropping a trailing `(2024 TV series)`
  disambiguator) and compares it to the show name with a Levenshtein similarity on
  lower-case letters only; it must exceed `WIKI_SIMILARITY_MIN` (0.8). The result
  caches into `wikiVerified`. **`null` = inconclusive** (5xx, unparseable page,
  network error) and is never cached — the button is kept and re-checked later.
  Only an explicit `false` hides the button. `fast: true` tests once and reuses the
  stored result; the background path (`fast: false`) re-verifies every time so a
  renamed article is caught.
- **IMDB** — `fast: true` uses the cache when `imdbUrl` and `imdbRatings` are both
  present. Otherwise the id is resolved through a fallback chain: TVDB `remoteIds`
  type 2 → the record's stored `imdbId` → a fresh TVDB extended fetch → TMDB
  `external_ids` → the IMDB suggestion API filtered through `smartTitleMatch`.
  Ratings come from the published IMDB **dataset** (`imdbRatings.js`), which is
  never CAPTCHA-blocked. The page fetch is only for the trailer video and the
  reviewer count: a headless Playwright context loads the title page, waits for
  JSON-LD/`h1` and then for the rating widget, and one `evaluate` extracts rating,
  reviewer count and video url. If the AWS WAF challenge is detected (or the
  response isn't ok), `gateImdbFetches()` blocks *all* IMDB page fetches for 12 h
  and drops the browser context — every further attempt is another strike against
  the WAF, and ratings are unaffected because they come from the dataset.
- Other `tvdbRemotes` types are fetched in parallel; only type 4 (Official Website)
  currently maps to a button.

Wikipedia, the remaining tvdbRemotes and IMDB all run concurrently under
`Promise.all`. The IMDB button label becomes `IMDB (8.4) (120k)` and an IMDB video
is appended to `trailers` as "IMDB Video". `trailers` are filtered to English.

## 7. Gap check ("chkgap")

`emby.gapCheckOne(showId, showName, tvdbRecord)` is pure computation over
`rec.episodeData` — no Emby HTTP call; the freshness comes from
`refreshEpisodeData` having run first. `gapCheckBatch` is just a loop over it.

`getShowState` walks seasons in order, then episodes in order, tracking watched /
has-file / aired state per episode (a file on disk overrides "unaired"; once an
unaired episode is seen everything after it is unaired too). It produces:

| field | meaning |
| ----- | ------- |
| `notReady` | the next episode to watch is not ready (no file where one is needed) |
| `anyWatched` | any episode watched |
| `watchGap` (+`Season`/`Episode`) | a watched episode after an unwatched one |
| `fileGap` (+`Season`/`Episode`) | a missing file before an episode that has one, or no files at all, or the first unwatched episode has no file |
| `fileEndError` (+`Season`/`Episode`) | more than two trailing aired episodes with no file and unwatched |
| `seasonWatchedThenNofile` (+…) | a fully-watched season followed by a season with nothing watched and no files |
| `allAiredHaveFile`, `allAiredWatched`, `allWatchedOrHaveFile` | transient; `allWatchedOrHaveFile` drives `full` |

Suppression: if the show is not inEmby, all its episodes are unaired, its
`firstAired` is in the future, its status is "upcoming", or it is a "trying" show
(nothing watched and only the first episode has a file), every file-missing and
watch-gap signal is cleared.

Where it runs:

- **push2** of the per-show loop — `gapCheckOne` directly on the record.
- **after a disk change** — `runGapCheckForShows([one show], false)`, which also
  refreshes `lastPlayedDate` and calls `tvdb.updateTvdbWithGapData`.
- `updateTvdbWithGapData(gapData)` (in `tvdb.js`) applies a batch keyed by Emby
  show id, stamps `lastGapCheck` on every processed show, and `saveAllShows` once.

`runGapCheckBatch()` (10 least-recently-checked shows, `GAP_CHECK_INTERVAL`,
`DISK_SYNC_INTERVAL`) is **dead code**: the periodic timers were removed once
`tryLocalGetTvdb`'s per-show tick took over. The `watchgap.log` file in the data
dir is still appended by `runGapCheckForShows`.

## 8. chokidar — disk change → record update

`index.js` watches `/mnt/media/tv` (`tvDir`) with one chokidar instance:
`ignoreInitial`, dotfiles ignored (that is why in-progress encodes use a hidden
`.` prefix), native inotify (no polling), `depth: 99`, and
`awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }` so a file is
only reported once it stops growing.

`extractShowNameFromPath` takes the first path segment under `tvDir` as the show
name. Events are debounced per show for `DISK_CHANGE_DEBOUNCE_MS` (3 s) via
`changedShows`, which also accumulates the set of changed files.

**`add`** (video extensions and `.bif` only): updates that show's disk cache, then
on the debounce timer — for inEmby shows — runs
`reconcileDuplicateEpisodeVideos` (a replacement download that raced the old file
leaves two active videos for one episode; the lower-res one is demoted, and if the
new file itself lost, it is not enqueued), enqueues subtitle checks at normal
priority and runs them immediately, re-scans the resolution fallback, then calls
`handleShowDiskChange`.

**`unlink`**: a trailing `.alt` is stripped before the extension check so a hidden
1080 fallback counts as a video deletion; re-scans the resolution fallback (a
deleted `.alt` must be regenerated) then `handleShowDiskChange`.

### `handleShowDiskChange(showName)`

Serialized per show: a second call while one is in flight sets a pending flag and
re-runs once, 1 s after the first finishes.

1. Capture `waitStrBefore` and whether the show had any episodes on disk.
2. `getShowDiskInfo` → update the disk cache; `refreshEpisodeData(… sources:
   ["disk"])` → `saveTvdbSync()` → debounced push. A missing folder drops the cache
   entry.
3. WS `showDiskChanged`.
4. `embyRefreshManager.request("chokidar:<show>")` — all `Library/Refresh` calls
   funnel through this manager: one scan running plus one queued generation, ≥3 s
   between scans, it polls the Emby scheduled task and pushes `libraryProgress` /
   `libraryRefreshDone`. The await returns only when *this* request's own scan is
   done.
5. `runGapCheckForShows([this show], false)` → refresh watched state
   (`refreshEpisodeData … sources: ["emby"]`) → `saveTvdbSync()`.
6. **Hide only, never unhide.** If the show is already hidden and has episodes,
   `reapplyHideIfAlreadyHidden` re-backdates the new episode (Emby gives it
   `DateCreated = now` regardless of `hiddenFromRow`, so it would otherwise pop to
   the front of "latest tv"). If it is not hidden, has episodes, and `waitStr` is
   set either newly or because the first episodes just landed,
   `hideShowIfNeeded`. Unhiding is deliberately left to the background loop:
   this handler never re-scrapes TVDB, so `waitStr` can read as transiently
   cleared just because TVDB hasn't published the next air date yet.

### The other chokidar (tv-down)

`apps/down/src/tvJson.js` runs its own watchers — one per directory under
`TV_ROOT`, `depth: 0`, no `add`/`addDir` listeners. They exist only to catch
moves/renames (via the `raw` event, since chokidar has no rename event) and
directory deletions, and they trigger `tvResync()`. Deleting the SQLite row on
`unlink` is intentionally a no-op, or down would re-download episodes that were
deliberately deleted.

`down` never writes `tvdb.db`. It posts `last-downloaded` through
`POST /api/setTvdbFields`, retrying from a pending list when tv-srvr is down or
the show key doesn't match yet.

## 9. `refreshEpisodeData` — the single episodeData writer

`disk.refreshEpisodeData(showName, rec, { sources })`, in `apps/srvr/src/disk.js`,
is the only place `rec.episodeData` is built. Sources default to all three and can
be limited by the caller:

1. **tvdb** — `getSeriesMap(rec.tvdbId)` (paginated `series/{id}/episodes/default`,
   `seasonType=official`, 100/page, season 0 skipped) sets each episode's `aired`.
2. **emby** — `emby.getSeriesMap` sets `watched`, `id` and resume `pos`
   (inEmby shows with an id only).
3. **disk** — `getShowDiskInfo(folder)` sets `file`, `res` and the `bif` flag,
   clears files for episodes no longer on disk, and updates `rec.date`,
   `rec.size`, `rec.noFiles`. When the folder name differs from the show name the
   file is stored as `folder//file`.

Then it derives `rec.quality`, `rec.watchedCount`, fills `seasonPremiereDates`
once from the TVDB map, recomputes `rec.waitStr` via `calculateWaitStr`, strips
non-Emby shows down to aired/watched, and deletes the legacy per-episode props
(`watchedEpis`, `filesOnDisk`, `fileQuality`, `episodeAiredDates`). A refresh
taking over 1.5 s logs an emby/disk breakdown.

### `calculateWaitStr`

Per season, take the unwatched episodes' effective dates (an episode with a file on
disk counts as available since `2000-01-01`), sort ascending, and require
`start >= airDate[i] + (2 - i)` days for every rank `i` — i.e. you can start once
enough episodes have banked up that you won't catch up to the release schedule.
The season minimum wins. Result: `""` when it is safe to start now (or the wait is
more than a year out), otherwise `{M/D}` / `{YY-M/D}` for a wait in a later year,
and `null` when there is no data to decide. `null` never overwrites a stored value.

## 10. Other write paths

- **`setTvdbFields(params)`** (`POST /api/setTvdbFields`) — the general field
  writer and the only way another process may change a record. Supports
  `$delTvdb`, `$rename`, `$delete: [fields]`, dotted `emby.` / `disk.` / `sync.`
  prefixes, and normalizes timestamp values on the way in. It keeps the Emby button
  in sync, fires `pickupChangeCallback` on `inEmby`/`status` change, and re-runs
  `setImdbId`. Setting `saved: 0` forces a fresh TVDB scrape by queueing a
  `newTvdbQueue` entry. Flags: `dontSave`, `dontNotify`, `dontEnqueue` (otherwise
  every call enqueues a full per-show refresh).
- **`getNewTvdb(params)`** — creates or replaces a record; always `fast: true`, so
  it uses cached remotes rather than re-scraping.
- **`saveTvdbSync()`** — normalize + `saveAllShows`; used by every index.js path
  that mutated records in place.
- **`saveSeasonIntro`**, **`migrateWatchedCount`**, **`updateTvdbWithGapData`** —
  targeted writers that go through the same `saveShow`/`saveAllShows` layer.

## 11. Client-visible events

| event | when |
| ----- | ---- |
| `showUpdating` | a show was enqueued (0→1) or has started processing |
| `tvdbUpdated` | a record changed — debounced 500 ms per show, carries the record |
| `showQueueEmpty` | the process queue drained |
| `showDiskChanged` | chokidar disk change handled for a show |
| `libraryProgress` / `libraryRefreshDone` | Emby library scan progress/completion |

The client triggers refreshes with `POST /api/triggerShowSelect` (on selection,
skips Rotten), `POST /api/triggerShowGapCheck` (priority) and
`POST /api/refreshEmbyItem`.
