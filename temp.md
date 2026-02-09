# Emby API Calls in loadAllShows

This document describes all Emby API calls made during the `loadAllShows()` function in [apps/client/src/emby.js](apps/client/src/emby.js#L120).

## Overview

The `loadAllShows()` function fetches TV show data from Emby and syncs it with local tvdb.json. The function makes API calls in parallel where possible to optimize performance.

## Initial Parallel API Calls (Step 1)

These calls are made simultaneously at the start:

### 1. Get All TV Shows

**Endpoint:** `GET /emby/Users/{userId}/Items`

```javascript
axios.get(urls.showListUrl(cred, 0, 10000));
```

**URL Pattern:**

```
https://hahnca.com:8920/emby/Users/894c752d448f45a3a1260ccaabd0adff/Items
  ?SortBy=SortName
  &SortOrder=Ascending
  &IncludeItemTypes=Series
  &Recursive=true
  &Fields=Name,Id,IsFavorite,Played,UnplayedItemCount,DateCreated,
          ExternalUrls,Genres,Overview,Path,People,PremiereDate,
          IsUnaired,ProviderIds
  &StartIndex=0
  &ParentId=4514ec850e5ad0c47b58444e17b6346c
  &Limit=10000
  &X-Emby-Token={token}
```

**Purpose:** Fetch all TV series in the library with metadata and user data

**Returns:** List of all TV shows with:

- Basic info (Name, Id, Path)
- User data (IsFavorite, Played, UnplayedItemCount, PlayCount, LastPlayedDate)
- Metadata (Genres, Overview, DateCreated, PremiereDate)
- Provider IDs (TvdbId)

---

## Per-Show API Calls (Step 3 - When Creating New tvdb Entry)

These calls are made only when a show needs a new tvdb record created (no existing record or ID mismatch):

### 2. Get Seasons for Episode Count

**Endpoint:** `GET /emby/Users/{userId}/Items`

```javascript
const seasonsRes = await axios.get(urls.childrenUrl(cred, showId));
```

**URL Pattern:**

```
https://hahnca.com:8920/emby/Users/894c752d448f45a3a1260ccaabd0adff/Items
  ?ParentId={showId}
  &Fields=MediaSources,DateCreated,Genres,Overview,People,
          ProviderIds,ExternalUrls,Path,SortName,ProductionYear,
          Status,UserData,PlayAccess,IsFolder,Type,Tags,PremiereDate
  &X-Emby-Token={token}
```

**Purpose:** Get all seasons for a show to count episodes

**Called from:** `getEpisodeCounts(embyShow)` helper function

---

### 7. Get Episodes per Season (Multiple Calls)

**Endpoint:** `GET /emby/Users/{userId}/Items`

```javascript
const episodesRes = await axios.get(urls.childrenUrl(cred, seasonId));
```

**URL Pattern:** Same as above with ParentId={seasonId}

**Purpose:** Get all episodes in each season to count total/watched episodes

**Called from:** `getEpisodeCounts(embyShow)` helper function

**Note:** This call is made once per numbered season (Season 0 and special seasons are skipped)

---

## Conditional API Calls (Error Recovery)

### 4. Delete Show from Emby (If no TvdbId)

**Endpoint:** `DELETE /emby/Items/{id}`

```javascript
await axios.delete(url, {
  headers: {
    "X-Emby-Authorization": authHdr,
    "X-Emby-Token": cred.token,
  },
});
```

**URL Pattern:**

```
https://hahnca.com:8920/emby/Items/{showId}
  ?X-Emby-Client=EmbyWeb
  &X-Emby-Device-Name=Chrome
  &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
  &X-Emby-Client-Version=4.6.4.0
  &X-Emby-Token={token}
```

**Purpose:** Remove shows from Emby that have no TvdbId (invalid metadata)

**Condition:** Only called when `!tvdbId || tvdbId == "0"`

---

## Summary

### Guaranteed Calls (Every Time)

1. Get all TV shows (1 call)

**Total: 1 API call**

### Conditional Per-Show Calls

- Get seasons + episodes: Only when creating new tvdb records
  - 1 call per show (get seasons)
  - N calls per show (get episodes for each numbered season)
- Delete show: Only for shows missing TvdbId

### Performance Notes

- Per-show episode counting only happens when tvdb records need creation/refresh
- Most shows on subsequent loads reuse existing tvdb data and only update user data (no extra API calls)

### Timing

Typical execution time: ~500-2000ms depending on:

- Number of shows needing new tvdb records
- Number of seasons per show being processed
- Network latency to Emby server
