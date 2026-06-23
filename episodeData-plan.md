# Plan: consolidate per-episode data into a single `episodeData` property

## 1. Goal

Replace four large, separately-stored per-episode properties on each `tvdb.json`
show record with one consolidated property, `episodeData`:

| Old property         | Old storage shape                                  | New key   | New value                          |
| -------------------- | -------------------------------------------------- | --------- | ---------------------------------- |
| `filesOnDisk`        | `[[season, ep, ep, ...], ...]` (season-first rows) | `hasFile` | `true` when a video file exists    |
| `fileQuality`        | `{ "S02E03": 1080, ... }` (object keyed `SxxExx`)  | `res`     | integer resolution (e.g. `1080`)   |
| `episodeAiredDates`  | `{ "S01E01": "2011-11-30", ... }` (date strings)   | `aired`   | unix timestamp                     |
| `watchedEpis`        | `[[season, ep, ep, ...], ...]` (season-first rows) | `watched` | `true` when the episode is watched |

## 2. Target on-disk (`tvdb.json`) representation

```jsonc
"episodeData": [
  null,                       // season 0 (no specials) -> null
  [                           // season 1
    null,                     // episode 0 (unused) -> null
    { "hasFile": true, "res": 1080, "aired": 1322611200, "watched": true },  // s01e01
    { "aired": 1323216000, "watched": true }                                  // s01e02 (no file/res yet)
  ],
  null,                       // season 2 absent -> null
  [ /* season 3 ... */ ]
]
```

Rules:

- `episodeData` is an array; its 0-based index is the season number (season 0..N).
- Each season entry is an array whose 0-based index is the episode number (episode 0..N).
- **Sparseness is encoded with `null`**, not `[]`:
  - A season with no data is stored as `null` (e.g. `episodeData[0]` for shows
    with no season 0).
  - Holes inside a season array serialize as `null` (JSON has no true sparse
    arrays, so missing slots become `null` automatically).
  - I chose `null` over `[]` because (a) it is what a JS sparse array already
    serializes holes to, keeping read/write code uniform, and (b) it is smaller
    than `[]` and unambiguous.
- Each present episode is an object containing **only the keys that have data**.
  Absent keys mean "unknown" (e.g. an aired-but-not-downloaded episode has
  `aired` + maybe `watched`, but no `hasFile`/`res`). This keeps records small.
- Booleans are only ever stored as `true`. A `false`/absent `hasFile` or
  `watched` is represented by the key being missing (matches the current model
  where `filesOnDisk`/`watchedEpis` only list positive entries).

## 3. Target in-memory representation

**Decision: the in-memory representation is identical to the on-disk structure**
— the same nested, `null`-sparse array of plain episode objects, used directly
off the parsed `tvdb.json`. No separate parsed/expanded form is built.

Rationale:

- The structure is already a natural 2-D lookup (`episodeData[season][episode]`),
  which is what almost every consumer wants. A flat `SxxExx` map or per-season
  `Set`s would be a second representation to keep in sync.
- Keeping one shape means the migration, the disk-scan writers, and the readers
  all speak the same language, and total code shrinks (the current code repeatedly
  rebuilds `Set`s/`Map`s from `watchedEpis`/`filesOnDisk`).
- It avoids the risk the instructions warned about (more code changing, less safe)
  only where it does not help; the few hot loops that today build a per-season
  `Set` can keep doing so locally from `episodeData`.

A small set of pure helpers (see §4) is added to `packages/share/src/index.js`
so every app reads/writes through one tested API instead of re-implementing the
season-first row walk.

## 4. New shared helpers (`packages/share/src/index.js`)

All helpers treat a missing season/episode/key as "unknown" and never throw.

```js
// Read accessors
getEpisode(episodeData, season, episode)      // -> episode object | null
hasFileOnDisk(episodeData, season, episode)    // -> boolean
getEpisodeRes(episodeData, season, episode)    // -> int | null
getAired(episodeData, season, episode)         // -> timestamp | null
isWatched(episodeData, season, episode)        // -> boolean

// Iteration
forEachEpisode(episodeData, cb)                // cb(season, episode, epObj)
watchedKeySet(episodeData)                     // -> Set("S01E01", ...) (compat shim)
diskKeySet(episodeData)                        // -> Set("1-1", ...)    (compat shim)
seasonsOnDisk(episodeData)                      // -> sorted [season, ...] with any hasFile

// Write helpers (mutating, used by writers/migration)
setEpisodeFlag(episodeData, season, episode, key, value)
setSeasonFromList(episodeData, season, eps, key)   // bulk set hasFile/watched
computeQualityFromEpisodeData(episodeData)         // replaces computeShowQuality
countWatched(episodeData)                          // replaces calculateWatchedCount
```

`computeShowQuality(fileQuality)` is replaced by `computeQualityFromEpisodeData`
(same "most common resolution, ties → highest" logic, sourced from each
episode's `res`).

## 5. Producers to update (writers)

| Location                                                            | Today writes                          | Change                                                                            |
| ------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/srvr/index.js` `getShowsFromDisk` / `getShowDiskInfo`        | returns `[date,size,filesOnDisk,fileQuality]` | return `[date,size,episodeDiskData]` where `episodeDiskData` carries `hasFile`+`res` per episode |
| `apps/srvr/index.js` perShow disk check (~L2502-2524)              | `tvdbRecord.filesOnDisk/.fileQuality` | merge disk `hasFile`/`res` into `tvdbRecord.episodeData` (preserve `aired`/`watched`) |
| `apps/srvr/index.js` `/api/populateFilesOnDisk` (~L3884)          | sets `filesOnDisk/fileQuality`        | merge disk fields into `episodeData`                                              |
| `apps/srvr/index.js` chokidar handlers (~L7933, ~L8319)           | sets `filesOnDisk/fileQuality`        | merge disk fields into `episodeData`                                              |
| `apps/srvr/index.js` chokidar watchedEpis refresh (~L8362)        | sets `watchedEpis/watchedCount`       | merge `watched` into `episodeData`; `watchedCount = countWatched(...)`            |
| `apps/srvr/src/tvdb.js` record build (~L1983-1987)                | preserves the four old props          | preserve single `episodeData`                                                     |
| `apps/srvr/src/tvdb.js` update path (~L2341, ~L2383-2400)         | sets `watchedEpis`, `episodeAiredDates` | merge `watched`/`aired` into `episodeData`                                        |

**Merge semantics:** disk scans (`hasFile`/`res`) and Emby/TVDB scans
(`watched`/`aired`) update *different keys* of the same episode object. Writers
must merge into the existing `episodeData` rather than overwrite the whole array,
otherwise a disk scan would wipe `aired`/`watched` and vice-versa. A disk re-scan
should also clear `hasFile`/`res` for episodes no longer present (handled by
rebuilding the disk-derived keys for the seasons the scan covers).

## 6. Consumers to update (readers)

| Location                                                                    | Reads today                              | Change                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| `apps/srvr/src/tvdb.js` `calculateWaitStr`                                   | `episodeAiredDates`,`watchedEpis`,`filesOnDisk` | iterate `episodeData` (`aired`/`watched`/`hasFile`) — see §7 |
| `apps/srvr/src/tvdb.js` `calculateWatchedCount`                             | `watchedEpis`                            | `countWatched(episodeData)`                                     |
| `apps/srvr/src/tvdb.js` `seriesMapToWatchedEpis` / `applyWatchedEpisToSeriesMap` | array form                          | keep producing legacy array form for the seriesMap API, fed from/into `episodeData` (see §8) |
| `apps/srvr/src/emby.js` gap check (~L248-255)                              | `filesOnDisk` → `S-E` set                | `diskKeySet(episodeData)`                                       |
| `apps/srvr/index.js` `checkAndDownloadOpnSrt` (~L2319-2365)               | `watchedEpis` + `episodeAiredDates`      | `isWatched(...)` + `getAired(...)`                              |
| `apps/srvr/index.js` `getFirstFilesOnDiskSeasonGap` (~L6749)             | `filesOnDisk`                            | `seasonsOnDisk(episodeData)`                                    |
| `apps/srvr/index.js` flexget (~L6857-6963)                               | `watchedEpis`, `filesOnDisk`             | `isWatched(...)`, `hasFileOnDisk(...)`                          |
| `apps/srvr/index.js` `needsIntro` compute (~L2592)                       | `filesOnDisk.length > 0`                 | `seasonsOnDisk(episodeData).length > 0`                         |
| `apps/srvr/index.js` subtitle eligibility (~L1048) **(see §9 — current bug)** | `watchedEpis?.[key]?.watched`       | `isWatched(episodeData, season, episode)`                      |
| `packages/share` `computeShowQuality`                                     | `fileQuality`                            | `computeQualityFromEpisodeData`                                |
| `apps/down/src/main.js` (~L3050, ~L3365)                                 | `watchedEpis` array (from emby map)      | `isWatched(...)` against `episodeData`                          |
| `apps/client/src/tvdb.js`                                                 | `seriesMapToWatchedEpis` (UI only)       | unaffected if seriesMap API stays array-based (see §8)         |
| `scripts/find-asr-only-for-processing.js`                                 | `watchedEpis`                            | read `episodeData` via helper (or inline)                      |

## 7. Detail: `calculateWaitStr` + the `aired` timestamp change (IMPORTANT)

`calculateWaitStr` currently relies on `aired` being a **`YYYY-MM-DD` string**:

- It compares `airDate > today` lexically (string compare) to detect future eps.
- It does `new Date(unwatchedDates[i]).getTime()` to do day math.
- `effectiveDate = hasDiskFile && airDate > today ? today : airDate`.

The instruction requires `aired` to become a **unix timestamp**, so this function
(and the OpenSubtitles eligibility check, which does
`new Date(airedStr).getTime()`) must be reworked to numeric comparisons:

- Compare against `todayMs` (a numeric midnight-today), not a string.
- `effectiveDate` becomes a number.
- The `new Date(...).getTime()` calls are dropped (value is already ms/sec).

This is a behavioral-equivalence rewrite, not a cosmetic one, and is the
highest-risk part of the change. It is called out so it is not missed.

## 8. seriesMap API boundary (`getSeriesMapFromTvdb`, client)

`seriesMapToWatchedEpis` / `applyWatchedEpisToSeriesMap` exist in **both**
`apps/srvr/src/tvdb.js` and `apps/client/src/tvdb.js`, and the
`/api/getSeriesMapFromTvdb` request/response still passes `watchedEpis` in the
legacy `[[season, ...eps], ...]` array form.

Plan: **keep the seriesMap API contract (legacy array form) unchanged.** Convert
to/from `episodeData` only at the server boundary:

- When calling `getSeriesMap`, derive the legacy `watchedEpis` array from
  `episodeData` (new helper `episodeDataToWatchedEpis`).
- The client and its copy of the helpers need **no change**, minimizing
  client/Android risk. (Per repo rules, client + Android UI must stay in sync; by
  not changing the wire format we avoid touching the Android app at all.)

## 9. Pre-existing bug uncovered (needs a decision)

`apps/srvr/index.js` ~L1048:

```js
if (tvdbRec.watchedEpis?.[key]?.watched) return false;
```

`watchedEpis` is an **array of season-first rows**, but this indexes it like an
**object keyed by `"S01E01"`** and reads `.watched`. That condition is therefore
**always false today** (dead/broken code). Under the new model,
`episodeData[season][episode].watched` *does* exist, so a faithful port would make
this check start working and begin **skipping watched episodes** for subtitle
download — a behavior change.

Decision needed: port it to working `isWatched(...)` (fixes the latent bug, but
changes subtitle behavior) **or** preserve today's effective behavior (treat as
always-false / drop the line). My recommendation: port to `isWatched(...)`, since
the surrounding code clearly intends to skip watched episodes, but it should be
an explicit, logged change.

## 10. Migration

A one-time migration script (`scripts/migrate-to-episodeData.js`, following the
existing `scripts/migrate-*.js` pattern) converts every record:

1. Build `episodeData` from the four old props:
   - `watchedEpis` rows → `watched: true`
   - `filesOnDisk` rows → `hasFile: true`
   - `fileQuality["SxxExx"]` → `res`
   - `episodeAiredDates["SxxExx"]` (date string) → `aired` (converted to unix
     timestamp — see §11 for the unit decision)
2. Delete the four old properties from the record.
3. Recompute `quality` via `computeQualityFromEpisodeData` and `watchedCount` via
   `countWatched` and assert they equal the previously stored values (sanity check).

**Operational note (repo rule):** `tv-srvr` must be **stopped** before the
migration writes `tvdb.json` directly on disk, to avoid the running server
overwriting it with a stale in-memory copy. Take a backup copy of `tvdb.json`
first. Deploy the code that reads/writes `episodeData` and the migration together
(server stays down across migrate → deploy → restart) so a restarted old/new
server never sees a half-converted file.

## 11. Open decisions / ambiguities / suggestions

1. **`aired` timestamp unit.** The instruction says "unix timestamp" but the
   source is date-only (`YYYY-MM-DD`). I will store **unix seconds at UTC
   midnight** of that date (consistent with the conventional meaning of "unix
   timestamp"). Suggestion to confirm: if you would rather avoid `*1000`
   conversions in JS date math, store **milliseconds** instead — pick one before
   implementation. (Impacts §7.)

2. **`res` source is sparser than `hasFile`.** Today `fileQuality` only gets an
   entry when the resolution probes successfully *and* the filename title matches;
   `filesOnDisk` lists every parsed episode file. So some episodes will have
   `hasFile: true` with no `res`. That is expected and fine
   (`computeQualityFromEpisodeData` ignores missing `res`), but noting it so the
   absence of `res` is not treated as a bug.

3. **`aired` is the superset.** `aired` exists for every TVDB-listed episode,
   including ones with no file and not watched. So many `episodeData` cells will
   contain only `{ aired }`. This is by design.

4. **Episode 0 / season 0 slots.** Episode numbers normally start at 1, so
   `episodeData[s][0]` is almost always `null`. Season 0 (specials) is supported
   but usually `null`. No special handling required; just flagging the wasted
   index-0 slot.

5. **Whole-array overwrite hazard.** As noted in §5, several writers currently do
   `tvdbRecord.filesOnDisk = ...` (full replace). They must become merges into
   `episodeData` so a disk scan does not erase `aired`/`watched`. This is the main
   correctness pitfall.

6. **Two copies of the helpers.** `seriesMapToWatchedEpis` etc. are duplicated in
   srvr and client. Keeping the seriesMap wire format unchanged (§8) means only
   the server copy interacts with `episodeData`; the client copy stays as-is.

7. **No impossibilities found.** The four old shapes map cleanly onto
   `episodeData`. The only lossy/behavioral points are the `aired` string→timestamp
   conversion (§7) and the latent L1048 bug (§9).

## 12. Suggested implementation order

1. Add shared helpers + `computeQualityFromEpisodeData` (with unit tests).
2. Write + dry-run the migration script (no file changes; report a diff).
3. Update writers (§5) to merge into `episodeData`.
4. Update readers (§6), including the `calculateWaitStr`/OpenSubtitles numeric
   rewrite (§7).
5. Decide §9 and §11.1, apply.
6. Stop `tv-srvr`, back up `tvdb.json`, run migration, deploy, restart, verify
   `pm2 logs` for restart/crash loops.
```
