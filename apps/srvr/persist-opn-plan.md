# Plan: Persistent OpenSubtitles Check in perShowCallback

## Goal

For every unwatched, recently-aired, in-Emby episode that has no `.opnABCDE.srt` sidecar,
periodically check OpenSubtitles and download a file when one becomes available.
One file per show per `tryLocalGetTvdb` run, picking the oldest eligible episode first.

---

## Data Needed

### Per-episode air dates

- Needed to check "aired within the past year"
- **Not** currently stored in `tvdb.json` — only `seasonPremiereDates` (year/month) is stored
- `tvdbSeriesMap` (fetched from TVDB API during `tryLocalGetTvdb`) has per-episode `aired` dates
- **Plan**: extract and persist a flat `episodeAiredDates: { "S01E01": "2021-10-06", ... }` map
  onto the tvdb record during `tryLocalGetTvdb`, alongside `seasonPremiereDates`
- **Internet access**: uses the already-happening TVDB API call — no extra request

### Per-episode last-check timestamps

- Needed to enforce 24-hour recheck throttle
- **Plan**: persist a file `SRVR_DATA_DIR/opn-check-history.json`
  - Format: `{ "ShowName|||S01E01": <timestamp_ms>, ... }`
  - Loaded at startup, written after each check attempt
- No internet access needed

---

## Where the Logic Runs

**Inside `perShowCallback`** (`index.js`) — called from `tryLocalGetTvdb` after the tvdb record
is refreshed. The show's `tvdb.json` record is up to date at this point.

---

## Algorithm (per show, per `tryLocalGetTvdb`)

1. If show is not `inEmby` → skip
2. If show has no `imdbId` → skip (can't search OpenSubtitles)
3. Scan all video files under the show's directory
4. For each video file, check:
   - Parse `SxxExx` from filename
   - Look up `episodeAiredDates[key]` — if missing or more than 1 year ago → skip
   - Look up `watchedEpis` — if episode is watched → skip
   - Check disk: if any `.opnABCDE.srt` sidecar already exists → skip
   - Look up `opnCheckHistory["ShowName|||SxxExx"]` — if checked within past 24 hours → skip
5. From all remaining eligible episodes, pick the **oldest by aired date**
6. Record the check timestamp in `opnCheckHistory` (even if no result) — prevents retry for 24h
7. Call `subsSearch` (already exists in `index.js`) with the show's `imdbId` + season + episode
   - **Internet access**: OpenSubtitles API search request
8. If results found:
   - Take the first `file_id`
   - Call `openSubtitlesDownloadWithRetry` → get CDN link → fetch content → write `.opnXXXXX.srt`
   - **Internet access**: OpenSubtitles download API + CDN fetch
   - Log to subtitle log via `logSubtitle`
9. If quota exceeded (HTTP 406) → log and skip (do not stop other processing)
10. Download at most **one file per show per call** (return after first successful or attempted download)

---

## Changes Required

### `apps/srvr/src/tvdb.js`

- In `tryLocalGetTvdb`, where `tvdbSeriesMap` is already in hand:
  - Extract `episodeAiredDates` map from it (alongside existing `seasonPremiereDates` logic)
  - Save onto `processRecord.episodeAiredDates` and persist to `tvdb.json`

### `apps/srvr/index.js`

- Add `OPN_CHECK_HISTORY_PATH` constant and load/persist functions (same pattern as `chksrtHistory`)
- Add `checkAndDownloadOpnSrt(showName, tvdbRecord)` async function:
  - Implements the algorithm above
  - Uses existing `subsSearch`, `openSubtitlesDownloadWithRetry`, `encodeFileIdBase32`,
    `stripSrtFormatting`, `logSubtitle` helpers
- Call `checkAndDownloadOpnSrt` at end of `perShowCallback` (in `index.js`)

---

## Contradictions / Ambiguities

- **`watchedEpis` key format**: stored as array `[[seasonNum, ep1, ep2, ...], ...]` in `tvdb.json`,
  but `fileNeedsSubChecked` accesses it as `tvdbRec.watchedEpis?.[key]?.watched` — that lookup
  would always return `undefined`. The actual watched check should use the array format.
  **Suggestion**: build a `Set` of `SxxExx` keys from `watchedEpis` array at the start of the function.

- **`episodeAiredDates` freshness**: once saved to `tvdb.json`, these dates won't be re-fetched
  unless `tryLocalGetTvdb` runs for that show again. For ongoing shows, new episodes get added
  during normal TVDB update cycles so this is fine.

- **Rate limiting**: the VIP tier allows 1,000 downloads/day. With ~300 in-Emby shows,
  each `tryLocalGetTvdb` run could consume up to 300 downloads if every show has an eligible
  episode. Shows cycle through `tryLocalGetTvdb` continuously — may need an additional global
  daily cap (e.g. 500 downloads/day) to leave headroom for normal subtitle pipeline use.
  **Suggestion**: add a global `opnDailyCount` counter that resets at midnight and stops
  background checks when it reaches a configurable limit.

- **`perShowCallback` is async**: already awaited in `tryLocalGetTvdb`, so async network calls
  inside it are safe.

- **No `.opnABCDE.srt` check**: the sidecar glob pattern `opn` + 5 chars is already used in
  `fileNeedsSubChecked` and `hasSidecar` checks — same pattern can be reused.
