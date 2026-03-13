# TVDB Update Background Task — Variables Set

## How the Task Runs

`updateTvdbLocal()` in `apps/srvr/src/tvdb.js` is a recursive `setTimeout` loop. It finds the stalest show (oldest `saved` timestamp), enqueues it, and processes it through a 3-push pipeline. Default interval is 2 minutes between shows.

Pipeline: **Pre-tick** → **Push 1** (getTvdbData) → **Push 2** (perShowCallback) → **Push 3** (Rotten Tomatoes)

---

## Push 1 — `getTvdbData()` (tvdb.js)

Fetches TVDB API extended data with TMDB fallback. Sets these fields on the tvdb record:

| Field                | Source                                                     |
| -------------------- | ---------------------------------------------------------- |
| `Name`               | Canonical show name from TVDB                              |
| `tvdbId`             | TVDB series ID                                             |
| `originalNetwork`    | TVDB extended API `originalNetwork.name`                   |
| `seasonCount`        | Input > TVDB API count > existing                          |
| `episodeCount`       | Input > TVDB API count > existing                          |
| `image`              | TVDB English poster → existing → TMDB fallback             |
| `score`              | TVDB score → existing → TMDB                               |
| `overview`           | TVDB → existing → TMDB                                     |
| `firstAired`         | TVDB → existing → TMDB                                     |
| `lastAired`          | TVDB `lastAired` or `firstAired` → existing → TMDB         |
| `nextAired`          | TVDB → existing                                            |
| `averageRuntime`     | TVDB → existing → TMDB                                     |
| `originalCountry`    | TVDB → existing → TMDB                                     |
| `originalLanguage`   | TVDB → existing → TMDB                                     |
| `status`             | TVDB `status.name` (e.g. "Ended") → existing → TMDB        |
| `remote_ids`         | Raw `remoteIds` array from TVDB API                        |
| `characters`         | Actors with character name, image, etc. from TVDB extended |
| `added`              | PST date, set once on first creation                       |
| `saved`              | `Date.now()` — updated every refresh                       |
| `trailers`           | TVDB English trailers + IMDB video appended                |
| `wikiUrl`            | Cached or fetched from Wikipedia search API                |
| `redditUrl`          | Cached or fetched from Reddit search API                   |
| `imdbUrl`            | From IMDB scrape or TVDB remoteId                          |
| `imdbRatings`        | Scraped from IMDB page (Playwright)                        |
| `imdbVideo`          | Extracted from IMDB page HTML                              |
| `imdbId`             | Extracted from `imdbUrl` via regex `tt\d+`                 |
| `lastMetadataUpdate` | `Date.now()`                                               |

TMDB-only fallback fields (set only when TVDB data is missing): `backdrop`, `genres`, `homepage`, `tagline`, `type`, `numberOfSeasons`, `numberOfEpisodes`, `inProduction`, `createdBy`, `productionCompanies`, `spokenLanguages`

---

## Push 2 — `perShowCallback` (index.js)

Disk check + lastWatched + gap detection. Calls `emby.gapCheckOne()` → `getShowState()`.

| Field           | Logic                                                       |
| --------------- | ----------------------------------------------------------- |
| `Date`          | Disk modification date from `getShowDiskInfo()`             |
| `Size`          | Disk size from `getShowDiskInfo()`                          |
| `NoFiles`       | `true` if no disk folder found                              |
| `lastWatched`   | Fetched from Emby via `fetchLastWatchedDate()`              |
| `lastDiskCheck` | `Date.now()`                                                |
| `full`          | `true` if show is in Emby and all aired episodes have files |
| `lastGapCheck`  | `Date.now()`                                                |

### Gap fields (from `getShowState`):

| Field                     | Meaning                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `notReady`                | Next-to-watch episode has no file, or show has no episodes                    |
| `anyWatched`              | At least one episode has been watched                                         |
| `watchGap`                | Unwatched episode(s) between watched episodes (watched → unwatched → watched) |
| `watchGapSeason`          | Season number where watch gap was first detected                              |
| `watchGapEpisode`         | Episode number where watch gap was first detected                             |
| `fileGap`                 | Missing file between episodes that have files (see calc logic below)          |
| `fileGapSeason`           | Season number where file gap was detected                                     |
| `fileGapEpisode`          | Episode number where file gap was detected                                    |
| `fileEndError`            | >2 consecutive no-file aired episodes at end of a season                      |
| `seasonWatchedThenNofile` | Fully watched season followed by a season with no files/watched/unaired       |

### fileGap calculation logic

`fileGap` is detected in `getShowState()` via three paths, all suppressed when `skipMissingFileGap` is true (all episodes unaired, start date in future, or status is "upcoming").

**Path 1 — Hole in the file sequence (episode loop)**

Two tracking vars drive in-loop detection:

- `haveFileShow` — `true` once any episode has a file.
- `noFileAfterFile` — `true` when an episode has no file and `haveFileShow` is already `true`.

When a later episode _does_ have a file while `noFileAfterFile` is `true`, the gap is confirmed: pattern is **file → no-file → file**.

```
for each episode (in season/episode order):
    haveFileShow ||= haveFile
    if haveFileShow and not haveFile:
        noFileAfterFile = true
    if not fileGap and noFileAfterFile and haveFile:
        fileGapSeason = current season   (only if not already set)
        fileGapEpisode = current episode  (only if not already set)
        fileGap = true
```

`fileGapSeason`/`fileGapEpisode` point to the episode that resumed files (the one _after_ the gap).

**Path 2 — No files at all**

After the loop, if there are episodes but zero files, zero watched, and zero unaired:

```
if not fileGap and sawAnyEpisode and not haveFileShow and not anyWatched and not anyUnaired:
    fileGapSeason = firstNoFileSeason
    fileGapEpisode = firstNoFileEpisode
    fileGap = true
```

This catches shows added to Emby that have no media files yet.

**Path 3 — Next-to-watch has no file**

If the next episode to watch (after watched ones) was found but has no file, and no other gap/error flag is already set:

```
if checkedReady and not ready and anyWatched
   and not watchGap and not fileGap and not fileEndError and not seasonWatchedThenNofile:
    fileGapSeason = firstNoFileSeason
    fileGapEpisode = firstNoFileEpisode
    fileGap = true
```

This catches the case where the user has watched some episodes and the very next one is missing its file, even if there aren't enough consecutive missing files to trigger `fileEndError`.

**skipMissingFileGap suppression**

When active (all unaired, future start date, or "upcoming" status), all file-missing signals are cleared:
`fileGap`, `fileGapSeason`, `fileGapEpisode`, `fileEndError`, `seasonWatchedThenNofile` are all reset to false/null.

---

## Push 3 — Rotten Tomatoes (tvdb.js)

| Field           | Logic                               |
| --------------- | ----------------------------------- |
| `rottenUrl`     | From `rottenSearch()` scrape        |
| `rottenRatings` | `criticsScore/audienceScore` string |

---

## Pre-tick — `runEmbyFullSweep()` (index.js)

Runs before processing each show. Syncs all Emby shows into tvdb records.

| Field            | Logic                                                 |
| ---------------- | ----------------------------------------------------- |
| `Id`             | Emby show ID                                          |
| `tvdbId`         | Backfilled from Emby ProviderIds                      |
| `Path`           | Emby path folder name                                 |
| `Genres`         | Emby genres array                                     |
| `Overview`       | Emby overview                                         |
| `DateCreated`    | Emby DateCreated (YYYY-MM-DD)                         |
| `PremiereDate`   | Emby PremiereDate (YYYY-MM-DD)                        |
| `IsFavorite`     | Emby UserData                                         |
| `Played`         | Emby UserData.Played                                  |
| `PlayCount`      | Emby UserData.PlayCount                               |
| `LastPlayedDate` | Emby last played date                                 |
| `InToTry`        | In "To Try" Emby collection                           |
| `InContinue`     | In "Continue" collection                              |
| `InMark`         | In "Mark" collection                                  |
| `InLinda`        | In "Linda" collection                                 |
| `inEmby`         | `true` for found shows, `false` for disappeared shows |
| `lastEmbySync`   | `Date.now()`                                          |
| `WaitStr`        | Formatted upcoming air date e.g. `{3-15}`             |

---

## Other Fields (set via various paths)

| Field               | Context                                                   |
| ------------------- | --------------------------------------------------------- |
| `Notes`             | User notes (manual)                                       |
| `Reject` / `reject` | Reject flag (kept in sync)                                |
| `Pickup` / `pickup` | Pickup flag (kept in sync)                                |
| `leftEmby`          | YYYY-MM-DD when show was removed from Emby                |
| `downloadStatus`    | Download tracking status                                  |
| `downloadLastCheck` | Download last check timestamp                             |
| `tvmazeId`          | TVMaze cross-reference ID                                 |
| `tvmazeStatus`      | TVMaze status                                             |
| `watchedEpis`       | `[[seasonNum, ep1, ep2, ...], ...]` — watched episode map |
| `watchedCount`      | From param object                                         |
