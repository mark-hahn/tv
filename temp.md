# getSeriesMap Function Documentation

## Overview

There are two implementations of `getSeriesMap` in the codebase, each sourcing episode data from different providers:

1. **emby.js** - Gets episode data from the Emby media server
2. **tvdb.js** - Gets episode data from TVDB API

## Function Signatures

### Emby Version

```javascript
export const getSeriesMap = async(show, (prune = false));
```

### TVDB Version

```javascript
export const getSeriesMap = async(show);
export const getSeriesMapByTvdbId = async(tvdbId);
```

## Return Value

Both functions return a **seriesMap** array with the following structure:

```javascript
[
  [seasonNumber, [
    [episodeNumber, {
      error: boolean,      // gap marker (watch gap or file gap)
      played: boolean,     // whether episode has been watched
      avail: boolean,      // whether episode file is available
      noFile: boolean,     // whether episode has no file path
      unaired: boolean,    // whether episode hasn't aired yet
      deleted: boolean,    // whether episode was deleted (prune mode)
      path: string,        // file path (emby only)
      aired: string        // air date (tvdb only)
    }],
    ...
  ]],
  ...
]
```

## Data Sources

### Emby Implementation (`emby.js`)

**Source:** Emby media server API

**Process:**

1. Takes show object with `Id` property
2. Returns empty array if `show.inEmby === false`
3. Fetches seasons via `urls.childrenUrl(cred, seriesId)`
4. For each season:
   - Fetches unaired episodes via `urls.childrenUrl(cred, seasonId, true)`
   - Fetches available episodes via `urls.childrenUrl(cred, seasonId)`
5. For each episode:
   - Extracts file path from `MediaSources[0].Path`
   - Determines played status from `UserData.Played`
   - Determines availability from `LocationType != "Virtual"`
   - Sets error flag if episode matches WatchGap or FileGap markers
6. If `prune = true`, deletes watched episodes and marks them as deleted

**Emby-specific properties:**

- `path`: actual file system path to video file
- `played`: tracked by Emby user data
- More reliable availability info

### TVDB Implementation (`tvdb.js`)

**Source:** TVDB API

**Process:**

1. Takes show object with `Name` or `name` property
2. Searches TVDB via `srchTvdbData(showNameStr)`
3. Finds best matching show using `showNamesMatch()` logic
4. Extracts `tvdb_id` from best match
5. Calls `getSeriesMapByTvdbId(tvdbId)` which:
   - Fetches all episodes via paginated API: `series/{tvdbId}/episodes/default`
   - Loops through pages (up to 100 episodes per page, max 50 pages)
   - Groups episodes by season number
6. For each episode:
   - Determines if unaired by comparing `aired` date to current date
   - Sets `avail = !unaired` (inverse of unaired status)
   - Always sets `noFile = true` (TVDB doesn't track files)
   - Always sets `played = false` (TVDB doesn't track watch status)

**TVDB-specific properties:**

- `aired`: original air date string from TVDB
- `noFile`: always true (TVDB has no file info)
- `played`: always false (TVDB has no watch data)
- Less reliable availability (based only on air date)

## Usage Context

**Emby version is used when:**

- Show exists in Emby media library
- Need actual file paths and watch status
- Performing prune operations
- Need accurate file availability

**TVDB version is used when:**

- Show not in Emby (web search results)
- Need theoretical episode list with air dates
- Determining what episodes exist for a show
- Fallback when Emby data unavailable

## Typical Call Sites

From actors.vue:

```javascript
const in1 = await emby.getSeriesMap(show);
const in2 = await tvdb.getSeriesMap(show);
```

From list.vue (with prune):

```javascript
let seriesMapIn = await emby.getSeriesMap(show, action == "prune");
if (!seriesMapIn.length) {
  seriesMapIn = await tvdb.getSeriesMap(show);
}
```

## All Call Sites

### [actors.vue](apps/client/src/components/actors.vue)

**Line 539** - Prefetch TVDB data for noemby shows (called in background for caching)

```javascript
const in2 = await tvdb.getSeriesMap(show);
```

**Lines 686-727** - `getSeriesMapInForArrows()` method (wrapper):

- Tries Emby first: `await emby.getSeriesMap(show)`
- Falls back to TVDB: `await tvdb.getSeriesMap(show)`
- Used for keyboard navigation (left/right arrows between episodes)
- Caches TVDB results for noemby shows

**Line 744** - Left arrow handler (navigate to previous episode)

```javascript
const seriesMapIn = await this.getSeriesMapInForArrows(this.currentShow);
```

**Line 819** - Right arrow handler (navigate to next episode)

```javascript
const seriesMapIn = await this.getSeriesMapInForArrows(this.currentShow);
```

**Line 906** - Build season map for episode grid display

```javascript
const seriesMapIn = await emby.getSeriesMap(this.currentShow);
```

### [list.vue](apps/client/src/components/list.vue)

**Line 1187** - Web add feature (adding shows from TVDB search)

```javascript
const seriesMapIn = await tvdb.getSeriesMapByTvdbId(tvdbId);
```

- Gets season map during web add to display available seasons
- Uses timeout wrapper (60 seconds)

**Lines 1839-1843** - Map pane episode display

```javascript
let seriesMapIn = await emby.getSeriesMap(show, action == "prune");
if (!seriesMapIn || seriesMapIn.length === 0) {
  seriesMapIn = await tvdb.getSeriesMap(show);
}
```

- Tries Emby first (may prune episodes if requested)
- Falls back to TVDB if Emby returns no data
- Primary method for displaying episode map grid

### [tor.vue](apps/client/src/components/tor.vue)

**Line 1732** - Calculate needed episodes for torrent downloads

```javascript
const seriesMapIn = await emby.getSeriesMap(show);
```

- Uses Emby only (needs actual file availability)
- Determines which episodes still need to be downloaded

## Call Pattern Summary

1. **Primary pattern**: Try Emby first, fallback to TVDB
   - Used in actors.vue (arrows navigation)
   - Used in list.vue (map pane)

2. **Emby only**: When file info is required
   - tor.vue (download planning)
   - actors.vue (episode grid display)

3. **TVDB only**: For web-added shows
   - list.vue (web add feature)
   - actors.vue (prefetch/caching for noemby shows)

4. **With prune**: Only in list.vue map pane
   - `await emby.getSeriesMap(show, action == "prune")`
   - Deletes watched episodes from disk
