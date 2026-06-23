# episodeData consolidation — conversation notes

## What `aired` is used for

`episodeAiredDates` has exactly two consumers:

1. **`calculateWaitStr`** (`apps/srvr/src/tvdb.js`) — computes the "safe start" date shown in the UI.
2. **`checkAndDownloadOpnSrt`** (`apps/srvr/index.js`) — background OpenSubtitles downloader; uses aired date to filter to episodes aired within the last year and not in the future, and sorts eligible episodes oldest-first.

The `aired` field seen in the live seriesMap (`epData.aired` in `getSeriesMap`, `epData.aired` in `client/src/tvdb.js`) is different — it comes from the TVDB API response and is used for display/unaired detection in the UI, not from the stored `episodeAiredDates`.

## Could those two use a live Emby API instead of the stored cache?

No, not reliably:

- **`calculateWaitStr`**: needs dates for future unaired episodes and works for shows not in Emby. Emby doesn't have future episodes; TVDB is the only source.
- **`checkAndDownloadOpnSrt`**: only runs for `inEmby` shows so Emby _could_ supply `PremiereDate` live, but that would add an HTTP round-trip per show per background sweep and silently fail if Emby is down. The stored cache is better.

## Where `getSeriesMap` gets its data

`getSeriesMap` (`apps/srvr/src/tvdb.js`) calls the **TVDB REST API** directly — `series/{tvdbId}/episodes/default`, paginated at 100 eps/page, bearer-token auth. No Emby involvement.

## How often is `getSeriesMap` called

- **Background timer**: `updateTvdbLocal` fires every 2 minutes (`TVDB_UPDATE_DELAY_MS`), picks the single stalest show, runs `tryLocalGetTvdb`. With ~200 shows each show is processed roughly once every 7 hours.
- Inside `tryLocalGetTvdb`, TVDB `getSeriesMap` is called up to twice per show pass:
  - **L2352** — only if Emby failed or show not in Emby (fallback for `watchedEpis`).
  - **L2361** — fires even when Emby succeeded, purely to refresh `episodeAiredDates`. This is a TVDB API call on every show pass regardless of whether air dates changed.
- **On demand**: `/api/getSeriesMapFromTvdb` (user opens series map view) and `/api/getSeriesMapFromEmby` (TVDB backfill for still-airing shows).

## Could L2361 use the cached `episodeAiredDates` instead?

L2361 is the call that _writes_ the cache, not reads it. But the call could be skipped when the cache is fresh enough (e.g. skip if `lastMetadataUpdate` < 24h, or only refresh if show is still airing). That would reduce TVDB API traffic significantly but is a separate optimization from the consolidation.

`calculateWaitStr` and `checkAndDownloadOpnSrt` already use the stored cache — they never call `getSeriesMap` themselves.

## Does `calculateWaitStr` only need future episode air dates?

No — it needs **all unwatched episode air dates**, past and future.

The algorithm collects every unwatched episode's air date for each season, sorts them ascending, then for each rank `i` (0-indexed) computes:

```
safeStart[i] = airDate[i] + (2 - i) days
```

It takes the **max** across all ranks per season, then the **min** across seasons. This formula is "you need at least 2 episodes available before you start" — rank 0 must have aired ≥ 2 days ago, rank 1 ≥ 1 day ago, rank 2+ can have aired any time.

Past air dates matter in two ways:

1. They determine ranking (a past episode at rank 0 means `safeStart = pastDate + 2`, which is still in the past — contributes nothing to a future wait but is needed to correctly rank later episodes).
2. A very recent past episode at rank 0 (aired within the last 2 days) can produce a `safeStart` that is slightly in the future.

Only if `minWaitDate > today` does the function return a non-empty wait string. If all safeStarts are in the past, it returns `""` (safe to start now). So in practice, only recent-past and future dates drive a non-empty result, but the code must iterate all of them to determine rank correctly. **You cannot drop past air dates from the stored data.**

One subtlety: if an episode has a file on disk but its TVDB air date is in the future, the code overrides its effective date to `today` — so "I have the file even though TVDB says it hasn't aired" is handled correctly.

## When does `checkAndDownloadOpnSrt` run and what conditions trigger it?

**Trigger:** Called at the tail of `perShowCallback` (`apps/srvr/index.js`), which runs once per show per background update cycle. The background timer (`updateTvdbLocal`) fires every 2 minutes, picks the stalest show, and runs the full update pipeline for that show, ending with `checkAndDownloadOpnSrt`. So each show gets one subtitle-check attempt roughly every N×2 minutes (N = number of shows, ~7 hours with 200 shows).

**Show-level gates (early return if any fail):**

1. `tvdbRecord.inEmby` must be true — only shows in Emby are processed.
2. `tvdbRecord.imdbId` must be present — needed for the OpenSubtitles API lookup.
3. `opnDailyCount < 500` — a per-day cap (resets at midnight LA time) limits total downloads to 500/day across all shows.

**Episode eligibility (per video file found on disk):**
Each video file in the show folder is evaluated independently:

1. Episode must not be in `watchedSet` (built from `watchedEpis`).
2. Must have a matching key in `episodeAiredDates`.
3. Air date must be valid, ≤ 1 year ago, and not in the future — i.e. the episode aired recently enough that a subtitle is likely available, but not so recently it might not exist yet.
4. No `.opnXXXXX.srt` sidecar file already present alongside the video.
5. Not checked within the last 24 hours (throttle via `opnCheckHistory`).

**Action:** If any eligible episodes pass all gates, the function picks the **oldest** (by air date) and attempts one subtitle download. It stamps that episode in `opnCheckHistory` to suppress retries for 24 hours. If the download succeeds, the history entry is removed so it won't be permanently skipped.

**Summary of what `aired` is needed for here:** the air-date window filter (within 1 year, not in future) and the oldest-first sort. Both require the exact air date per episode — a boolean "has aired" flag would not be sufficient.

## Is the `unaired` flag in seriesMap the same as "the aired date is in the future"?

Not exactly — it depends on which `getSeriesMap` produced it, and there is one meaningful difference.

**TVDB `getSeriesMap` (`apps/srvr/src/tvdb.js`):**
`unaired` is a pure date comparison:

```js
unaired = airedYMD > todayYMD; // calendar-day, local timezone
avail = !unaired;
```

- Episode airing today → `unaired = false` (today is not > today).
- Missing/invalid air date → `unaired = false`, `avail = false`. The comment explicitly says "unknown air-date should not be treated as unaired".
- So for TVDB: `unaired` means exactly "the air date is tomorrow or later".

**Emby `getSeriesMap` (`apps/srvr/src/emby.js`):**
Emby makes a separate API call with an "include unaired" filter (`childrenUrl(seasonId, true)`) which returns episodes Emby itself considers unaired. Then:

```js
unaired = avail && path ? false : !!unairedObj[episodeNumber];
```

- If the episode has a **physical file on disk** (`avail && path`), `unaired` is forced to `false` regardless of what Emby's unaired API says.
- Otherwise it's whatever Emby's filter returned.

**Key differences between the two:**

| Scenario                                    | TVDB `unaired` | Emby `unaired`                   |
| ------------------------------------------- | -------------- | -------------------------------- |
| Air date is tomorrow                        | `true`         | `true` (if Emby agrees)          |
| Air date is today                           | `false`        | depends on Emby                  |
| Air date in future but file already on disk | `true`         | **`false`** — file presence wins |
| No air date stored                          | `false`        | `false`                          |

The critical case is "file on disk but future air date" — TVDB says unaired, Emby says aired. This is deliberate: if you have the file, Emby treats it as watchable regardless of the official air date.

**Relation to stored `episodeAiredDates`:** The `unaired` flag lives only in the live seriesMap (built on demand, not persisted). The stored `episodeAiredDates` cache contains the raw date string from TVDB; callers like `calculateWaitStr` do their own date comparison against it. They are separate things serving separate purposes.

## If a reliable `unaired` flag were stored per episode in the tvdb record, would it be enough to generate a full seriesMap?

No — for display it would be sufficient, but not for full playback functionality.

**What a seriesMap episode object contains** (from `list.vue` `seriesMapAction` + `mapUtil.js`):
| Field | Source | In tvdb record? |
|---|---|---|
| `error` | always `false` | trivial ✓ |
| `played` | Emby user data | yes — `watchedEpis` ✓ |
| `avail` | Emby `LocationType !== "Virtual"` | approximately: `hasFile && !unaired` |
| `noFile` | no media path in Emby | yes — `filesOnDisk` / `hasFile` ✓ |
| `unaired` | date comparison or Emby unaired API | hypothetically yes if stored ✓ |
| `deleted` | always `false` | trivial ✓ |
| `quality` | `fileQuality[epKey]` | yes — `fileQuality` / `res` ✓ |
| **`path`** | actual file path from Emby | **no** — `filesOnDisk` stores season+episode numbers only, not paths |
| **`id`** | Emby item ID per episode | **no** — not stored anywhere in the tvdb record |

**What is `path` and `id` used for?**

- `path` — the map's play button sends the file path to play the video. Also used for clipboard copy of file paths. Without `path`, the grid can render but episodes cannot be played.
- `id` — the Emby item ID used for Emby playback (`handleSelectedEmby`). Also needed to mark episodes played in Emby.

**`avail` accuracy caveat:** Even with `unaired` stored, computing `avail` from the tvdb record (`hasFile && !unaired`) is an approximation. Emby's `avail` means the episode is indexed in Emby's library (`LocationType !== "Virtual"`). A file newly copied to disk may have `hasFile=true` in the tvdb record but `avail=false` in Emby until Emby finishes scanning. (Note: `list.vue` already overrides `avail`/`noFile` from `filesOnDisk` after fetching the Emby map for this same reason — showing files immediately without waiting for Emby.)

**Conclusion:** With `unaired` stored, the tvdb record is sufficient to render the map grid correctly (all visual states: watched, has-file, unaired, missing, quality). It is not sufficient to enable playback, because `path` and `id` come only from a live Emby query and are not stored. So the Emby `getSeriesMap` call cannot be replaced by a tvdb-record-derived map for the full map UI.

## Is the Emby API called inside `tryLocalGetTvdb`?

Yes — multiple times, through different stages of the per-show pipeline.

**Full sequence of external calls in one `tryLocalGetTvdb` run:**

1. **Pre-tick callback** (`preTvdbTickCallback`, registered in `index.js`):
   - Every 10th background tick, calls `runEmbyFullSweep` → **Emby API** (library scan for new/removed shows).

2. **`getTvdbData`** (runs via `chkTvdbQueue`): — **no Emby calls**
   - TVDB API `series/{tvdbId}/extended` — main metadata
   - TVDB API `getDefaultOrderCounts` — episode/season counts if needed
   - IMDB, Wikipedia, Reddit, Google scraping via `getRemotes`
   - TVMaze API `getTvmazeCrew`
   - TMDB API (optional fallback if image/overview missing)

3. **`emby.getSeriesMap`** — **Emby API** — fetches all seasons/episodes with `played` status and file paths. Used to update `watchedEpis` and `watchedCount`. Only called if `processRecord.inEmby && processRecord.id`.

4. **TVDB `getSeriesMap`** — **TVDB API** — paginated episode list. Used to update `episodeAiredDates` and `seasonPremiereDates`, and as fallback seriesMap if Emby failed.

5. **`perShowCallback`** (registered in `index.js` as the disk+gap check step):
   - `fetchLatestPlayedInfo` → **Emby API** (get `lastPlayedDate`)
   - `fixCompactEpisodeNaming` → **Emby API** (fix mis-indexed episode names)
   - `emby.gapCheckOne` → **Emby API** (iterates every season and episode to compute `watchGap`, `fileGap`, `fileEndError`, etc. — many Emby requests)
   - `checkAndDownloadOpnSrt` → disk reads + OpenSubtitles API (no Emby)

6. **TVMaze crew** — **TVMaze API** — only if `rec.crew` is null (one-time per show).

7. **Rotten Tomatoes scrape** — `getRemote` web scrape (no Emby).

**Summary:** `getTvdbData` itself never calls Emby. The Emby calls are in `tryLocalGetTvdb` directly (step 3) and in `perShowCallback` (step 5). For an `inEmby` show, a single background pass makes roughly 5–10+ Emby API requests (getSeriesMap + fetchLatestPlayedInfo + fixCompact + gapCheckOne season/episode fetches).

## Live scan: how often do TVDB unaired and Emby unaired disagree?

Scan run on 2026-06-22 across all 262 shows with `inEmby=true` + `id` + `episodeAiredDates`. For each stored `SxxExx` key, compared:

- **TVDB unaired**: `airedYMD > todayYMD` (date string from `episodeAiredDates`, evaluated on the server in local time)
- **Emby unaired**: whether the episode appeared in `IsUnaired=true` API response for its season (ignoring file-on-disk override — the scan did not apply the `avail && path → unaired=false` override)

**Results:** 9 mismatches out of 8,891 episodes compared — **0.1% mismatch rate**.

All 9 mismatches, with explanation:

```
Sugar (2024) S02E02  aired=2026-06-26  tvdb=true  emby=false
Sugar (2024) S02E03  aired=2026-07-03  tvdb=true  emby=false
Sugar (2024) S02E04  aired=2026-07-10  tvdb=true  emby=false
Sugar (2024) S02E05  aired=2026-07-17  tvdb=true  emby=false
Sugar (2024) S02E06  aired=2026-07-24  tvdb=true  emby=false
Sugar (2024) S02E07  aired=2026-07-31  tvdb=true  emby=false
Sugar (2024) S02E08  aired=2026-08-07  tvdb=true  emby=false
Not Suitable for Work S01E08  aired=2026-06-23  tvdb=false  emby=true
Not Suitable for Work S01E09  aired=2026-06-23  tvdb=false  emby=true
```

**Root cause of each group:**

- **Sugar (2024) — 7 episodes** (`tvdb=true, emby=false`): These episodes have future TVDB air dates but files already exist on disk. Emby's `IsUnaired=true` filter is answering about Emby's library; since the files are imported, Emby does not flag them as unaired. This is exactly the "file on disk overrides unaired" case documented above (the `avail && path → unaired=false` rule in `emby.js`). TVDB still says they haven't aired per the official schedule.

- **Not Suitable for Work — 2 episodes** (`tvdb=false, emby=true`): Both have `aired=2026-06-23` (the next calendar day). TVDB's date comparison evaluated to `false` because the scan ran at a moment when the server's local clock had already reached June 23 (`todayYMD == airedYMD`, so `airedYMD > todayYMD` is false). Emby, evaluating separately, still considered them unaired. This is a timezone/clock-edge-case: the two systems sampled "today" at slightly different moments or with different timezone offsets.

**Takeaway:** The two unaired flags agree on 99.9% of episodes. The rare mismatches are entirely explained by the two documented cases: (a) files on disk with future TVDB dates, and (b) episodes whose air date is exactly "today" depending on when/where the comparison runs.

## Which unaired calculation is more expensive in terms of API usage?

**TVDB unaired — essentially free.**
`episodeAiredDates` is already populated by the per-show background cycle (the TVDB `getSeriesMap` call, step 4 of `tryLocalGetTvdb`). Computing `airedYMD > todayYMD` at query time is pure local date math on the cached string — zero additional API calls.

**Emby unaired — `1 + N_seasons` API calls per show per use.**
To build the Emby unaired set for one show:

1. One call to list the show's seasons (`/Items?ParentId={seriesId}`)
2. One call per season with `IsUnaired=true` (`/Items?ParentId={seasonId}&IsUnaired=true`)

For the 262 shows scanned above with ~4 seasons on average, that was ~1,300 Emby API requests just to collect unaired sets once across the library.

**Conclusion:** The TVDB approach is orders of magnitude cheaper. If `unaired` were to be stored in `episodeData`, it should be derived from `episodeAiredDates` (already cached at zero extra cost), not from a live Emby query.

## If `unaired` is derived from `episodeData.aired`, could all `getSeriesMap` calls be replaced by `episodeData`?

Not fully — it depends on which call and what it is used for. Each call serves a different purpose:

### Background `tryLocalGetTvdb` — Emby `getSeriesMap` (step 3, L2335)

**Purpose:** Refresh `watchedEpis` (which episodes have been played, according to Emby).

**Can `episodeData` replace it?** No. `episodeData.watched` IS the stored watched state — Emby is its only source of truth. You cannot replace the source with the cache it populates.

### Background `tryLocalGetTvdb` — TVDB `getSeriesMap` L2361 (aired-dates refresh)

**Purpose:** Keep `episodeAiredDates` and `seasonPremiereDates` current from TVDB.

**Can `episodeData` replace it?** Yes, with a staleness check. If `episodeData.aired` was populated recently (e.g. within 24h), this TVDB API call is redundant — it would just re-fetch and re-store the same dates. The call could be skipped when the data is fresh, falling back to a full TVDB `getSeriesMap` only when stale. This is the most impactful optimization available from the consolidation.

### User-triggered `seriesMapAction` in `list.vue` — `emby.getSeriesMap`

This is the call that blocks map opening. It serves two distinct roles:

**Role A — Display:** Builds the grid (watched/available/unaired/quality per cell).
All display fields can be derived from `episodeData`:

| Field     | Derived from                                      |
| --------- | ------------------------------------------------- |
| `played`  | `episodeData.watched`                             |
| `noFile`  | `!episodeData.hasFile`                            |
| `unaired` | `episodeData.aired` date > today                  |
| `avail`   | `episodeData.hasFile && !unaired` (approximation) |
| `quality` | `episodeData.res`                                 |

**Role B — Playback:** When the user clicks an episode to play, the map needs `path` (file path) and `id` (Emby item ID). These are **not** in `episodeData` and require a live Emby call.

**Role C — Watched sync:** The call also updates `watchedEpis` on the client immediately when the map opens (so the grid shows current state, not state from the last background tick ~7 hours ago).

**Conclusion for `seriesMapAction`:**

- Role A (display) **could** be served by `episodeData` immediately, making the map open with no Emby round-trip.
- Role B (playback) still requires Emby — but this call could be deferred until the user actually clicks play (lazy fetch `path`/`id` on demand).
- Role C (watched sync) is the real blocker: if the Emby call is removed from map-open, watched state would lag by up to ~7 hours (time between background `tryLocalGetTvdb` cycles). Whether that is acceptable is a product decision.

### Summary

| Call                                                 | Can `episodeData` replace it? | Notes                                                                        |
| ---------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| Background Emby `getSeriesMap` (watched refresh)     | **No**                        | Source of truth for `watched`; can't be removed                              |
| Background TVDB `getSeriesMap` L2361 (aired refresh) | **Yes, when fresh**           | Skip with staleness check; call only when `episodeData.aired` is stale       |
| Client `seriesMapAction` — display                   | **Yes**                       | Map opens instantly; no Emby call needed just to render the grid             |
| Client `seriesMapAction` — playback `path`/`id`      | **No**                        | Emby call deferred to play-time; lazy                                        |
| Client `seriesMapAction` — watched sync              | **Partial**                   | Removing it means watched state can lag ~7h; background cycle keeps it fresh |

## How expensive is an on-demand full refresh of `episodeData` for one show?

`episodeData` has four components, each with a different refresh cost:

### `aired` — TVDB `getSeriesMap`

- **1–2 TVDB API calls** (paginated at 100 eps; most shows fit in 1 page)
- External internet call to `api4.thetvdb.com`
- Typical latency: 200–600 ms per page

### `watched` — Emby `getSeriesMap`

From `emby.js`: 1 call to list seasons + 2 calls per season (one for unaired flags, one for episodes with played status):

- **1 + 2 × N_seasons Emby API calls**
- Local network calls to `localhost:8096`
- For 4 seasons: 9 calls, ~50 ms each → ~450 ms total

### `hasFile` + `res` — `getShowDiskInfo` (disk scan)

- **0 API calls** — pure filesystem I/O (stat + readdir recursively through season folders)
- For each video file: tries to parse resolution from filename first (e.g. `1080p` in the name → done, ~0 ms)
- If filename has no resolution tag: spawns `ffprobe` subprocess (~100 ms/file) — but most files do have it
- Results memoized in `probedRawHeightByPath` for the server process lifetime, so re-scans within the same run are near-free
- Typical wall time for a show with all files labelled: ~20–50 ms

### Totals for a typical 4-season show with labelled files

| Component       | API calls                | Approx wall time |
| --------------- | ------------------------ | ---------------- |
| `aired`         | 1 TVDB (external)        | ~300 ms          |
| `watched`       | 9 Emby (local)           | ~450 ms          |
| `hasFile`/`res` | 0 (disk only)            | ~30 ms           |
| **Total**       | **1 external + 9 local** | **~800 ms**      |

### Context: how does this compare to the full background cycle?

The full `tryLocalGetTvdb` pass for one show includes all of the above plus: `getTvdbData` (1 TVDB extended call + IMDB/Rotten/Wikipedia scraping + TVMaze), `emby.gapCheckOne` (many more Emby calls per season/episode), Rotten Tomatoes scrape, etc. That totals 5–15+ seconds per show including external scraping.

A focused on-demand `episodeData` refresh is a strict subset of the full cycle — just the three data sources above — and would typically complete in under a second on local network. This makes it viable to trigger on user action (e.g. when opening the map) rather than relying solely on the ~7-hour background cadence.

## Could `gapCheckOne` use `episodeData` instead of calling Emby?

(Assuming `episodeData` includes `path` and `id` per episode.)

**Yes — completely.** `gapCheckOne` delegates to `getShowState` which is the entire logic. Here is what `getShowState` reads from Emby vs what `episodeData` provides:

| `getShowState` reads from Emby                                                          | `episodeData` equivalent                                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Season list from `childrenUrl(showId)` — to know which seasons exist and get season IDs | Iterate season indices in `episodeData`                                                                                      |
| `childrenUrl(seasonId, true)` — `IsUnaired=true` to build `unairedObj`                  | `aired` date > today (derived per episode — same 99.9% accuracy shown in scan above)                                         |
| `childrenUrl(seasonId)` — episodes with `UserData.Played` (watched)                     | `episodeData.watched`                                                                                                        |
| `episode.LocationType != "Virtual"` (emby has the file)                                 | `episodeData.hasFile` — already the disk-based check; also already used as the `onDisk` override inside `getShowState` today |

`getShowState` also uses `showMeta.tvdbStatus` and `showMeta.firstAired` for the `skipMissingFileGap` logic — both are already on the tvdb record, not from Emby.

**Emby API calls eliminated:** `getShowState` currently makes `1 + 2 × N_seasons` Emby requests per show (1 seasons list + 1 unaired + 1 episodes per season). With `episodeData` it makes **0**.

**One subtle difference:** Emby's episode list only includes episodes it has indexed. `episodeData` (sourced from TVDB) includes all episodes including future unaired ones. This is actually better — it matches what `calculateWaitStr` already uses — and `getShowState`'s `unairedFromHere` propagation handles future episodes correctly regardless of source.

**Current partial overlap:** `getShowState` already reads `filesOnDisk` from `showMeta` (the tvdb record) to build `diskFileSet` and uses it as an override when Emby hasn't scanned a file yet (`haveFile = embyHaveFile || onDisk`). With `episodeData.hasFile`, the `embyHaveFile` side becomes redundant — they should agree once Emby finishes scanning, and `hasFile` already represents the truth from disk.

**Impact on the background cycle cost:** Eliminating the Emby `gapCheckOne` calls saves the most Emby API requests of any single optimization — roughly `1 + 2 × N_seasons` calls per show per ~7-hour pass, or ~1,300 calls across 262 shows per full library cycle.

## Would using `episodeData` everywhere possible simplify logic and speed things up?

Yes — both significantly, and the two effects reinforce each other.

### Simplification

The current code has three incompatible storage shapes for per-episode data:

- `watchedEpis` / `filesOnDisk` — season-first arrays `[[season, ep, ep, ...], ...]`
- `fileQuality` / `episodeAiredDates` — flat objects keyed `"SxxExx"`
- `episodeData` — direct `[season][episode]` array indexing

Every consumer today rebuilds lookup structures from scratch. For example:

- `calculateWaitStr` takes three separate parameters and constructs per-season `Map`s and `Set`s from all of them before it can do any logic
- `checkAndDownloadOpnSrt` builds a `watchedSet` by iterating `watchedEpis` rows, then looks up `episodeAiredDates["SxxExx"]` separately
- `gapCheckOne` builds `diskFileSet` from `filesOnDisk`, calls the Emby API for `watched` and `unaired`, then recombines them all per episode
- Flex/torrent logic reads `watchedEpis` and `filesOnDisk` independently with separate iteration loops

With `episodeData[season][episode]`, every consumer does a direct lookup. The rebuilding goes away. Logic that currently spans 20–40 lines of set/map construction collapses to inline field reads.

### Speed

| Consumer today               | Cost today                                     | Cost with `episodeData`                      |
| ---------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `gapCheckOne`                | `1 + 2×N_seasons` Emby calls (~9 for avg show) | **0 API calls** — pure local logic           |
| TVDB L2361 (aired refresh)   | 1–2 TVDB calls per show per background pass    | **Skipped** when data is fresh               |
| `seriesMapAction` (map open) | Blocking Emby call (500–2000 ms)               | **Instant** — build from local `episodeData` |
| `checkAndDownloadOpnSrt`     | 0 API calls (already uses cache)               | Same — marginally faster iteration           |
| `calculateWaitStr`           | 0 API calls (already uses cache)               | Same — marginally simpler code               |

The biggest gain is `gapCheckOne`. Because it runs for every show every background cycle, eliminating its Emby calls cuts the per-show background time by the largest single margin. With ~9 Emby calls saved per show at ~50 ms each, each show pass shrinks by ~450 ms. Across 262 shows that is ~2 minutes of Emby round-trips per full library cycle — time that currently serialises the background loop.

### The one genuine concern: `path`/`id` staleness

If `path` and `id` are stored in `episodeData`, they could become stale if:

- A file is renamed or moved on disk (path changes)
- Emby re-indexes and changes an item's ID (rare — Emby IDs are stable per install)

Mitigation: fall back to a live Emby fetch if playback fails (path not found on disk or Emby returns 404 for the stored ID). Since this happens rarely, the cost is paid only on failure, not on every map open.

### Summary

Using `episodeData` everywhere possible:

- **Removes 3 incompatible storage formats** and all the per-consumer rebuilding code
- **Eliminates all Emby calls from `gapCheckOne`** — the largest single source of Emby traffic in the background cycle
- **Eliminates the blocking Emby call from map open** — UI becomes instant
- **Reduces TVDB calls** when aired data is fresh
- **The only new risk** is stale `path`/`id`, which is rare and recoverable
