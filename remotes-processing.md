# URL Calculation, Score Scraping, tvdb.json Usage, and Caching by Situation

---

## Situation 1: Info Pane Loaded (`onSetUpSeries` in info.vue)

### Sequence

1. `GET /api/getAllTvdb?hasEmby=0` — full tvdb.json loaded into server's in-memory `allTvdb`; returned to client and cached in client's module-level `allTvdb` variable (only refreshed when that variable is null).
2. Look up `allTvdb[show.Name]` by name or tvdbId for `tvdbData`.
3. If `tvdbData` is missing OR has no image: `POST /api/getNewTvdb` with `{fast: true, transient: false}`.
   - Server forces `fast: true` for all `getNewTvdb` calls regardless of what client passes.
   - `getTvdbData(fast=true)` runs:
     - Fetches `https://api4.thetvdb.com/v4/series/{tvdbId}/extended` (TVDB API).
     - Since `transient=false`: calls `getRemotes(show, remoteIds, fast=true)` on server (see below).
     - Saves result to `allTvdb` and `tvdb.json`.
4. `setRemotes()` called in info.vue (awaited in normal mode; non-blocking via `void` in preview).
   - Client calls `tvdb.getRemotes(showName, tvdbId, remoteIds, showContext, fast=true)`.
   - **Client cache check first**: if `allTvdb[name].remotes` exists and `inEmby` context matches → returns cached remotes, no server call.
   - If not cached: `POST /api/getRemotes` with `{fast: true}` → `getRemotesCmd` → `getRemotes(fast=true)` on server.
   - On return, result is stored back into client's `allTvdb[name].remotes`.

### URLs Calculated

| Remote             | How URL is determined                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emby               | `{embyServer}/web/index.html#!/itemdetails.aspx?id={Id}` — only if `show.inEmby` is true                                                          |
| Rotten             | From `allTvdb[name].rottenUrl` (flat prop) OR falls back to constructed `https://www.rottentomatoes.com/tv/{cleanName}`                           |
| Google             | Always constructed: `https://www.google.com/search?q={name}%20tv%20show`                                                                          |
| Wikipedia          | From `allTvdb[name].wikiUrl` (flat prop) OR fetched live if missing                                                                               |
| Reddit             | From `allTvdb[name].redditUrl` (flat prop) OR fetched live if missing                                                                             |
| IMDB               | From `allTvdb[name].imdbUrl/imdbRatings` cache if score is present; otherwise **Playwright scrape** via TVDB remoteId type=2 or `imdbId` fallback |
| Other TVDB remotes | Fetched live via TVDB remote type lookup (IMDB type=2 is handled separately, not in this loop)                                                    |

### Scores Scraped

- **IMDB rating + trailer video** — Playwright scrape only when `imdbRatings` is not already in tvdb.json cache. Rotten is never scraped here.

### Used from tvdb.json

- `rottenUrl`, `rottenRatings` — Rotten URL and score label (e.g. `"78%/65%"`)
- `imdbUrl`, `imdbRatings`, `imdbVideo` — IMDB URL, rating, trailer video
- `wikiUrl`, `redditUrl` — Wikipedia and Reddit URLs (if cached; else fetched live and then saved)

### Cached

- Full `allTvdb` in client memory from `getAllTvdb(0)` response.
- `allTvdb[name].remotes` array set on client after `/api/getRemotes` returns.

---

## Situation 2: Show Selected in Gallery in Browse Pane

### Sequence

1. browse.vue emits `selectShowFromCardTitle` event with show name.
2. list.vue `selectShowFromCardTitle` matches show in `allShows`, calls `onSelectShow(match, true)`.
3. `onSelectShow` → `saveVisShow`:
   - Emits `setUpSeries` event → info.vue `onSetUpSeries` runs (**same flow as Situation 1**).
   - Calls `srvr.triggerShowSelect(show.Name)` → `POST /api/triggerShowSelect`:
     - Server: `tvdb.enqueueShowProcess(showName, { skipRotten: true })` — adds show to background process queue with **Rotten scraping skipped**.

### Additional background trigger

`triggerShowSelect` runs the show through the full background `tryLocalGetTvdb` task but with `skipRotten: true`, meaning:

- TVDB API extended fetch
- `getRemotes(fast=false)` — always scrapes IMDB live (regardless of cache), fetches live Wikipedia/Reddit/other; Rotten is NOT scraped here (cache/fallback only).
- seriesMap fetch, perShowCallback, notifications sent to clients
- **No push3 Rotten scrape** (skipRotten=true)

---

## Situation 2a: Preview Mode Entered → Switched to Info Pane

### Sequence

1. User clicks a search result for a show not yet in the list (not in Emby/known).
2. `previewSearchChoice` in list.vue creates a fake show: `{ Id: "noemby-preview-...", inEmby: false, Name, TvdbId, ImdbId }`.
3. `saveVisShow` with `{skipHighlight, skipPersist, skipHistory, forceSetUpSeries: true}` emits `setUpSeries`.
   - Also calls `triggerShowSelect(showName)` → server enqueues show with `skipRotten: true`. If show has no record in allTvdb yet, the background task logs a "no record" error and exits immediately.
4. info.vue `onSetUpSeries` runs with `this.previewMode = true`:
   - Calls `tvdb.getAllTvdb(0)` (uses cached client allTvdb if available).
   - `allTvdb[show.Name]` is null (new show, not yet known).
   - Calls `srvr.getNewTvdb(paramObj)` with **`transient: true`** (because previewMode=true).
     - Server forces `fast: true`.
     - `getTvdbData(fast=true, transient=true)`:
       - Fetches `https://api4.thetvdb.com/v4/series/{tvdbId}/extended` (TVDB API).
       - **Skips `getRemotes()` entirely** because `transient=true`.
       - Instead: extracts IMDB URL directly from TVDB's `remoteIds` array (no network calls to IMDB/Rotten/etc).
       - Returns `tvdbData` with `remotes: []` (empty).
     - Result is NOT saved to `tvdb.json` (transient, no `allTvdb` write).
     - Client caches it in its in-memory `allTvdb` via `tvdb.upsertTvdbCacheRecord`.
5. `seriesReady = true` is set **immediately** (before remotes are loaded) so info renders fast.
6. `void this.setRemotes()` runs asynchronously after render:
   - `remoteFetchMode` is 'fast' → `fast = true`.
   - Client checks `allTvdb[name].remotes` → empty (nothing cached from transient fetch).
   - Calls `POST /api/getRemotes` with `{fast: true}` → same fast path as Situation 1.
   - Emby remote not included (show.inEmby=false). Rotten URL from cache or guessed URL.

### URLs Calculated (preview fast path)

| Remote    | Source                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emby      | Absent (inEmby=false)                                                                                                                                                                                |
| Rotten    | From `allTvdb[name].rottenUrl` if it exists; otherwise constructed guessed URL                                                                                                                       |
| Google    | Always constructed                                                                                                                                                                                   |
| Wikipedia | From cache or live fetch                                                                                                                                                                             |
| Reddit    | From cache or live fetch                                                                                                                                                                             |
| IMDB      | From `allTvdb[name].imdbUrl` cache; IMDB URL also extracted from TVDB remoteIds during transient `getTvdbData` and stored in `fetchedUrls.imdbUrl` (returned in tvdbData but not saved to tvdb.json) |

### Scores Scraped

- Transient `getNewTvdb` fetch skips all remotes entirely.
- Subsequent `getRemotes(fast=true)` call: **IMDB Playwright scrape** only if `imdbRatings` not in cache. Rotten is never scraped here.

### Used from tvdb.json

- `rottenUrl`, `imdbUrl`, `imdbRatings`, `wikiUrl`, `redditUrl` — same as Situation 1 for the remotes fetch.
- The TVDB extended API call does NOT read from `tvdb.json` (always fresh from API).

### Cached

- `tvdbData` upserted into client's in-memory `allTvdb` only (NOT saved to server `tvdb.json`).
- `allTvdb[name].remotes` set on client after getRemotes returns.

---

## Situation 3: TVDB Update Background Task (`tryLocalGetTvdb`)

### Cadence

Runs continuously: timer fires `TVDB_UPDATE_DELAY_MS` (2 minutes by default) after the end of each show's processing. `updateTvdbLocal` selects the stalest show (smallest `saved` timestamp) and enqueues it.

### Sequence per Show

**Phase 1 — Full TVDB + Remotes refresh:**

- `getTvdbData(fast=false)` called via `chkTvdbQueue`:
  - Fetches `https://api4.thetvdb.com/v4/series/{tvdbId}/extended` (TVDB API).
  - Since `transient=undefined` (falsy): calls `getRemotes(show, remoteIds, fast=false)`.

**Inside `getRemotes(fast=false)`:**

| Remote             | Action                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Emby               | URL constructed if `inEmby`                                                                  |
| Rotten Tomatoes    | From `allTvdb[name].rottenUrl` cache OR constructed guessed URL — **never scraped here**     |
| Google             | URL constructed                                                                              |
| Wikipedia          | From `allTvdb[name].wikiUrl` cache OR live Google-based scrape; persisted if missing         |
| Reddit             | From `allTvdb[name].redditUrl` cache OR live scrape; persisted if missing                    |
| **IMDB**           | Always **Playwright scraped** live for fresh rating — cache is never used here               |
| Other TVDB remotes | Live fetch via remote type lookup (type=18 Wikipedia and type=2 IMDB skipped from main loop) |

- Result merged into `allTvdb[name]` and saved to `tvdb.json` (flat props: `imdbUrl`, `imdbRatings`, `imdbVideo`, `wikiUrl`, `redditUrl`, plus `remotes` array). Note: `rottenUrl`/`rottenRatings` are NOT written here — only push3 writes those.

**Phase 2 — Series Map + Disk/Gap Check:**

- Series map fetched from Emby (if inEmby) or TVDB API fallback.
- `perShowCallback` runs (disk check, gap check) — "push2".

**Push 1+2 combined notification:**

- Combined changes from `getTvdbData` (push1) and `perShowCallback` (push2) sent to clients via `notifyCallback`.

**Phase 3 (Push 3) — Delayed Rotten Tomatoes:**

- If `skipRotten=false` (which it is for timer-driven processing):
  - **Second Playwright Rotten scrape**: `getRemote(null, 99, processRecord.Name)` called again.
  - `allTvdb[name].rottenUrl` and `allTvdb[name].rottenRatings` updated.
  - `tvdb.json` saved again.
  - Separate `notifyCallback` sent to clients specifically with fresh Rotten scores.

### Scores Scraped

- **IMDB rating + trailer video** — always Playwright scraped live in `getRemotes(fast=false)` during Phase 1; cached value is never used.
- **Rotten Tomatoes critics score + audience score** — Playwright scrape in push3 only. Not scraped in Phase 1 `getRemotes`.

### Used from tvdb.json

- `wikiUrl`, `redditUrl` — used as cache; fetched live and written back if missing.
- `imdbId` — used as fallback if IMDB not found in TVDB remoteIds.
- `watchedEpis` — passed to `getSeriesMap` for TVDB fallback series map construction.
- `inEmby`, `Id`, `tvdbId`, `seasonCount`, `episodeCount`, `watchedCount` — used to populate paramObj.
- `saved` — timestamp used by `updateTvdbLocal` to select stalest show.

### Cached / Persisted

- Full updated record in server `allTvdb` (in-memory) and `tvdb.json` on disk.
- Flat props written: `rottenUrl`, `rottenRatings`, `imdbUrl`, `imdbRatings`, `imdbVideo`, `wikiUrl`, `redditUrl`.
- `remotes` array updated in `allTvdb[name]`.
- `saved` timestamp updated.

---

## When Is Rotten Tomatoes Scrape Delayed to After All Other Remotes?

**Push 3 in `tryLocalGetTvdb`** is the delayed scrape. It runs only in the timer-driven background task (NOT when `skipRotten=true`, which is set by `triggerShowSelect`).

It is explicitly deferred until after:

1. Full TVDB API extended data fetch
2. All other remotes fetched (`getRemotes(fast=false)` — IMDB Playwright scrape if score not cached, Wikipedia/Reddit live fetches, other TVDB remotes)
3. Series map fetched (from Emby or TVDB)
4. `perShowCallback` (disk check, gap check)
5. **Push 1+2 combined notification sent to clients**

Only then does push3 do the Rotten Playwright scrape and send its own separate notification.

This ordering lets clients receive the main data update (episode counts, dates, IMDB scores, series map) promptly without waiting for Rotten's Playwright browser automation, which is the slowest scrape. Rotten's fresh scores then arrive as a follow-on push.
