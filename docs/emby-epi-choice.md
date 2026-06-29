## Emby fields that drive "Next Up" / episode selection

### `UserData` object (per episode, per user)

| Field | Type | Role |
|---|---|---|
| `Played` | bool | Primary "watched" flag — shown in episode lists |
| `PlayCount` | int | Number of completions |
| `PlaybackPositionTicks` | int64 (100-ns ticks) | Resume position. **Should be 0 after completion** |
| `PlayedPercentage` | double (0–100) | % played. Must reach server threshold (~90%) to auto-set `Played` |
| `LastPlayedDate` | ISO 8601 datetime | Used by the "Next Up" algorithm to find the last-watched episode in the series |
| `IsFavorite` | bool | Not relevant to next-up |
| `UnplayedItemCount` | int | On Series/Season items — cached count of unwatched children |

### How "Next Up" actually works (server-side)

`GET /Shows/NextUp?UserId=...` (what the Android app calls) finds: the highest `LastPlayedDate` episode in a series → picks the next sequential one. The web client and Android app both call this same endpoint, but the Android TV app **also** shows a separate "Continue Watching" row which uses `PlaybackPositionTicks > 0`.

---

## What can cause the Android app to re-play a watched episode

### 1. `PlaybackPositionTicks` is non-zero on a played episode (most likely culprit)
If `Played=true` but `PlaybackPositionTicks` is still at some mid-video value, the Android TV Emby app will place that episode in **"Continue Watching"** rather than treating it as done. The web client correctly ignores position on a played episode; the Android app does not. This discrepancy exactly matches your symptom — wrong in Android, correct in web.

You do have a `clearEpisodePositions` endpoint (srvr/index.js line ~4127) that explicitly sets `PlaybackPositionTicks: 0`, but that's only called manually. Episodes that were played directly on the TV may end with a non-zero position if playback stopped before Emby's completion threshold (~90%) even though they were then manually marked Played.

### 2. `LastPlayedDate` gets corrupted by your tvdb push
Your srvr log shows lines like:
```
tvdb push [Nine Perfect Strangers]: lastPlayedDate:2022-...->2023-... full:false->true
```
Your `tvdb.js` builds the update body from:
```js
paramObj.lastPlayedDate || existing.lastPlayedDate || existing.emby?.lastPlayedDate
```
If that resolves to a stale/wrong date and you POST it to `/Users/{userId}/Items/{itemId}/UserData`, Emby's "Next Up" query will re-anchor to the wrong episode as "last watched" and pick its successor — which may already have been watched.

### 3. `PlayedPercentage` not set when manually marking played
Your `clearEpisodePositions` POSTs only `{ PlaybackPositionTicks: 0, Played: isWatched }`. It doesn't include `PlayedPercentage: 100` or `PlayCount`. If Emby's internal logic is checking `PlayedPercentage` (especially on older Android TV client versions), an episode with `Played=true, PlayedPercentage=0` is ambiguous.

### 4. `UnplayedItemCount` on the Series item is stale
Emby caches this on the series/season record and some Android app versions use it. If your app is writing back episode `UserData` in bulk, the series-level count can lag until Emby re-scans.

---

## Can your app cause this?

**The `Sessions/{sessionId}/Viewing` call** (what `viewShowOnLivingRoomTv` uses) only navigates the TV's browse UI to the show. It does **not** pick the episode — the Android TV app's own "Next Up" query does that afterward. So that part of your app is innocent.

**The `updateUserDataUrl` POST** (`/Users/{userId}/Items/{itemId}/UserData`) is the actual risk point. Specifically:
- If it ever sets `PlaybackPositionTicks` to a non-zero value on a completed episode
- If it sets `LastPlayedDate` to a wrong/old timestamp

**Recommended quick diagnostic:** For a show that just re-played a watched episode, call:
```
GET /Users/{userId}/Items/{episodeId}/UserData?api_key=...
```
on the affected episode and check whether `PlaybackPositionTicks > 0` alongside `Played: true`. That combination is almost certainly your bug.

---

## "Last watched" date in the info pane

`info.vue` computed property `lastWatchedDate` reads from `this.show?.lastPlayedDate`, which is the tvdb record's `lastPlayedDate`. That value is populated from **Emby's `UserData.LastPlayedDate`** via two paths:

- **Background task** (`perShowCallback` in the tvdb loop, index.js ~2683): calls `fetchLatestPlayedInfo(showId)`, which queries `GET /Users/{userId}/Items?IsPlayed=true&SortBy=DatePlayed&SortOrder=Descending&Limit=1` on the series — gets the most recently played episode and reads its `UserData.LastPlayedDate`.
- **Emby sync sweep** (index.js ~7798): reads `UserData.LastPlayedDate` from the series-level Emby item during the full sync and stores it in `tvdbRecord.lastPlayedDate`.

So "Last watched" = the `LastPlayedDate` of the most recently played episode in the series, as Emby reports it. It is a **series-level** date — not per-episode.

---

## Does the tvdb background task write UserData back to Emby?

**No.** The background task (`tryLocalGetTvdb` / `perShowCallback` / `refreshEpisodeData`) only **reads** from Emby's UserData — it never POSTs to `/Users/{userId}/Items/{itemId}/UserData`.

The only code that writes to Emby UserData is the manual `clearEpisodePositions` endpoint (index.js ~4127), which is called explicitly from the client. The background loop is read-only with respect to Emby.

---

## `tryLocalGetTvdb`, `perShowCallback`, and `refreshEpisodeData`

### `tryLocalGetTvdb` (srvr/src/tvdb.js)

The single-threaded background engine that processes one show at a time from the `showProcessQueue`. It is the outer orchestrator — everything else runs inside it.

**What it does, in order:**
1. **Guard**: if already busy or queue is empty, returns immediately.
2. **Pre-tick callback** (`preTvdbTickCallback`): on every 10th background tick, runs a full Emby sweep (`runEmbyFullSweep`) to pick up newly added/removed shows and update series-level UserData across all shows.
3. **Dequeue**: pops the next show name (plus `skipRotten` / `isBackground` flags) from the queue.
4. **TVDB refresh** (`chkTvdbQueue` → `newTvdbQueue`): fetches fresh metadata from the TVDB API (episode counts, titles, aired dates, IMDB scores). Awaits completion via a Promise.
5. **`refreshEpisodeData`** (via registered callback): rebuilds the show's consolidated `episodeData` array from three sources — TVDB aired dates, Emby watched/id/position, and disk files.
6. **`perShowCallback`**: runs the per-show side-effects (subtitle scan, `lastPlayedDate` update, gap check, `needsIntro` computation). Returns a `{ hasChanges, changes }` result.
7. **Combined notify**: if either the TVDB refresh or `perShowCallback` produced changes, fires one `tvdbUpdated` WS notification to all clients.
8. **TVmaze crew fetch**: if the show has no `crew` array yet, fetches it from TVmaze once.
9. **Rotten Tomatoes scrape** (push3): unless `skipRotten` is set, scrapes RT for fresh ratings.
10. **Reschedule**: if more shows are queued, runs again after 1 s; otherwise after `TVDB_UPDATE_DELAY_MS` (~2 min).

**What controls whether a show is processed:**
- Shows are enqueued by `enqueueShowProcess(showName, opts)`. Callers include: `updateTvdbLocal` (background timer picks the stalest show every cycle), client-triggered endpoints (`triggerShowSelect`, `triggerShowGapCheck`), and show-state change events.
- `updateTvdbLocal` every ~2 min picks the show with the oldest `tvdbRecord.saved` timestamp, cycling through `inEmby` and non-`inEmby` shows (every 10th cycle processes a non-Emby show).
- The `isBackground` flag is set when the timer selects the show; it is `false` when triggered by the client. This controls whether `preTvdbTickCallback` runs the Emby sweep (only on background ticks) and how the history log entry is labelled (`bkgndUpdate` vs `clientUpdate`).

---

### `refreshEpisodeData` (srvr/index.js ~3205)

Rebuilds the show's `episodeData` compact array from up to three sources. Called from `tryLocalGetTvdb` after the TVDB refresh, and also directly from some API endpoints.

**What it does (controlled by `opts.sources`, default all three):**

1. **TVDB** (`sources.includes("tvdb")`): calls `tvdb.getSeriesMap(tvdbId)` → writes `aired` date into each episode slot. Requires `rec.tvdbId`.
2. **Emby** (`sources.includes("emby")` and `rec.inEmby` and `rec.id`): calls `emby.getSeriesMap({ id, name, tvdbId })` → for each episode writes `watched` (from `UserData.Played`), `id` (Emby item ID), and `pos` (from `UserData.PlaybackPositionTicks`). This is the canonical sync of Emby watched state into local storage.
3. **Disk** (`sources.includes("disk")`): scans the show folder on disk → for each episode writes `file` name, `res` (resolution), and updates `rec.date`, `rec.size`, `rec.noFiles`. Also clears `file` for episodes no longer present on disk.

After all three sources, it updates derived fields on the record: `watchedCount`, `seasonCount`, `episodeCount`, `quality`, `fileQuality`, `filesOnDisk`, `episodeAiredDates`, `seasonPremiereDates`, `waitStr`.

**Conditions:**
- Skipped sources are controlled by `opts.sources`. For example, `{ sources: ["emby", "disk"] }` skips the TVDB aired-date fetch (used when you only need to refresh watch state, not metadata).
- Emby source is skipped if `rec.inEmby` is falsy or `rec.id` is missing.
- TVDB source is skipped if `rec.tvdbId` is missing.

---

### `perShowCallback` (registered in srvr/index.js ~2635)

A callback invoked by `tryLocalGetTvdb` after `refreshEpisodeData` completes. Handles all per-show side-effects that depend on an up-to-date record.

**What it does:**
1. **Snooze cleanup**: removes the show from the snooze list if it is in Emby.
2. **Subtitle scan**: for `inEmby` shows, scans each season folder for video files that need subtitle checking and enqueues them in the subtitle queue.
3. **`lastPlayedDate` update** (if `inEmby` and `rec.id`): calls `fetchLatestPlayedInfo(showId)` — hits Emby's `?IsPlayed=true&SortBy=DatePlayed&SortOrder=Descending&Limit=1` endpoint — and updates `tvdbRecord.lastPlayedDate` if it changed.
4. **Compact episode name fix**: calls `fixCompactEpisodeNaming` to correct episodes indexed as e.g. E101 when the file is actually S01E01.
5. **Gap check** (if `inEmby`): calls `emby.gapCheckOne` → updates `watchGap`, `fileGap`, `fileEndError`, `seasonWatchedThenNofile`, `anyWatched`, `full`, and `needsIntro` on the record.
6. **Non-Emby shows**: sets all gap/error fields to their known-false constants.
7. **`needsIntro` flip handling**: if `needsIntro` changed, enqueues or cancels BIF generation for the show.
8. **History log**: writes a `bkgndUpdate` or `clientUpdate` history entry with the list of changed fields.
9. **Save + notify**: if any fields changed, saves the tvdb JSON file and (if `suppressNotify` is false) fires a debounced WS push to clients.
10. **OpenSubtitles check**: downloads one missing `.opnXXXXX.srt` per show if available.

Returns `{ hasChanges: bool, changes: string[] }` so `tryLocalGetTvdb` can decide whether to fire the combined notify.

**`suppressNotify`**: always `true` when called from `tryLocalGetTvdb` — the combined push1+push2 notify is sent by `tryLocalGetTvdb` itself after both steps complete, so clients get one notification instead of two.

---

### Call sequence summary

```
updateTvdbLocal (timer, ~2 min)
  └─ enqueueShowProcess(stalestShow, { isBackground: true })
       └─ tryLocalGetTvdb()
            ├─ preTvdbTickCallback()          [every 10th bg tick: runEmbyFullSweep]
            ├─ chkTvdbQueue()                 [TVDB API fetch → updates allTvdb record]
            ├─ refreshEpisodeData()           [TVDB aired + Emby watched/id/pos + disk files]
            ├─ perShowCallback()
            │    ├─ subtitle scan
            │    ├─ fetchLatestPlayedInfo()   [Emby: most recent LastPlayedDate]
            │    ├─ fixCompactEpisodeNaming()
            │    ├─ gapCheckOne()             [Emby: watchGap, fileGap, full, needsIntro]
            │    └─ checkAndDownloadOpnSrt()
            ├─ combined notify → clients
            ├─ TVmaze crew fetch (once)
            └─ Rotten Tomatoes scrape (push3)
```

Client-triggered (e.g. `triggerShowSelect`) follows the same path but with `isBackground: false`, skipping the Emby sweep in `preTvdbTickCallback` and labelling history as `clientUpdate`.
