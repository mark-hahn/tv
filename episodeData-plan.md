# Plan: consolidate per-episode data into a single `episodeData` property

> Revision 2 — incorporates `episodeData-instr-2.md`: adds `path`/`id`, keeps
> `YYYY-MM-DD` aired strings (no unix time), compresses each episode to a
> positional array, and makes `episodeData` the authoritative source refreshed
> on demand by one shared function.

## 1. Goal

Replace the per-episode data spread across four `tvdb.json` properties **plus**
the live Emby/TVDB seriesMap lookups with one consolidated, authoritative
property `episodeData`.

| Old source                              | New tuple slot | Stored value                              |
| --------------------------------------- | -------------- | ----------------------------------------- |
| `episodeAiredDates["SxxExx"]` (string)  | `[0]` aired    | `"YYYY-MM-DD"` string (unchanged format)  |
| `watchedEpis` season-first rows         | `[1]` watched  | `1` / `0`                                 |
| Emby episode item id (seriesMap)        | `[2]` id       | integer Emby id (`0` = none)              |
| disk file name (was `filesOnDisk` nums) | `[3]` file     | video **file name only** (not full path)  |
| `fileQuality["SxxExx"]`                 | `[4]` res      | integer resolution (e.g. `1080`)          |

Two former properties become **derived, not stored**:

- `hasFile` ⇒ a file name is present at slot `[3]`.
- `unaired` ⇒ aired date `[0]` is later than today (`aired > todayYMD`).

## 2. On-disk (`tvdb.json`) representation — compressed positional arrays

```jsonc
"episodeData": [
  null,                  // season 0: no specials -> null (season index is 0-based)
  [                      // season 1 — EPISODE array is 1-BASED: element[0] = episode 1
    ["2026-06-23", 1, 1234, "Rivals.2024.S01E01.HDR.2160p.WEB.h265-GRACE.mkv", 1080], // s01e01
    ["2026-06-30", 1, 1235, "Rivals.2024.S01E02.HDR.2160p.WEB.h265-GRACE.mkv"],       // s01e02 (res unknown)
    ["2026-07-07", 0, 1236],                                                          // s01e03 (in emby, no file)
    ["2026-07-14", 1],                                                                // s01e04 (not in emby, watched)
    ["2026-07-21"]                                                                    // s01e05 (not in emby, unwatched)
  ]
]
```

### Tuple slots (per episode)

| Idx | Field   | Type             | Absent meaning       |
| --- | ------- | ---------------- | -------------------- |
| 0   | aired   | `"YYYY-MM-DD"`   | unknown air date     |
| 1   | watched | `1` / `0`        | `0` (unwatched)      |
| 2   | id      | integer / `0`    | no Emby id           |
| 3   | file    | file-name string | no file on disk      |
| 4   | res     | integer          | resolution unknown   |

### Compression rules (from instr-2)

- **`0` for false/null, `1` for true** — single-char tokens.
- **Trailing absent slots are dropped**; tuple length encodes how much is known:
  - `5` — in Emby, watched, file on disk, resolution known
  - `4` — file on disk, resolution unknown
  - `3` — in Emby, no file
  - `2` — not in Emby, watched (non-Emby shows have no files)
  - `1` — not in Emby, unwatched
- A **non-trailing** null/false still occupies its position as `0`
  (e.g. `["2026-07-07", 0, 1236]` keeps `watched=0` because `id` follows it).
- **Path is the file name only.** Full path is reconstructed as
  `/mnt/media/tv/<folder>/Season <season>/<file name>` (see §6 and §11.1).
- **Season index is 0-based** (`episodeData[0]` = season 0 specials, usually
  `null`); **episode index is 1-based** (`episodeData[s][0]` = episode 1). The
  asymmetry is deliberate: season 0 is a real (rare) season, episode 0 never
  exists, so 1-based episodes avoid a wasted leading `null` in every show.

## 3. In-memory representation

**Decision: in memory is identical to on disk** — the same compressed positional
arrays used directly off parsed `tvdb.json`; save is a direct `JSON.stringify`.
No decode/expand step.

Rationale:

- The trailing-drop compression is awkward to round-trip through an expanded
  object form (every save would have to re-derive which slots to drop). Keeping
  the stored form in memory makes load/save trivial and removes a class of
  encode bugs.
- All positional knowledge (slot indices, 1-based episodes, trailing-drop on
  write) is confined to the shared helpers in §4, so call sites never touch raw
  indices and stay readable.

Rejected alternative: decode each tuple to `{ aired, watched, id, file, res }` in
memory. More readable per episode, but doubles the representation and forces a
non-trivial compress-on-save. Not worth it given the helpers.

## 4. Shared access / update module

New module `packages/share/src/episodeData.js` (re-exported from
`packages/share/src/index.js`) — the single API for all apps. Helpers treat a
missing season/episode/slot as "unknown" and never throw. **Episode args are
1-based; season args are the real season number.**

```js
// Read accessors
getEp(ed, s, e);            // -> tuple | null            (ed[s]?.[e-1])
getAired(ed, s, e);         // -> "YYYY-MM-DD" | null
isWatched(ed, s, e);        // -> boolean
getEmbyId(ed, s, e);        // -> int | null
getFileName(ed, s, e);      // -> string | null
hasFile(ed, s, e);          // -> boolean                 (file name present)
getRes(ed, s, e);           // -> int | null
isUnaired(ed, s, e, today); // -> boolean                 (aired > today)
getFullPath(ed, folder, s, e); // -> reconstructed absolute path | null

// Iteration / aggregate
forEachEpisode(ed, cb);     // cb(season, episode/*1-based*/, tuple)
seasonsPresent(ed);         // -> [seasonNum, ...]
computeQuality(ed);         // -> most-common res (replaces computeShowQuality)
countWatched(ed);           // -> number (replaces calculateWatchedCount)
toSeriesMap(ed, folder, today); // -> legacy [[s,[[e,{...}],...]],...] (see §9)

// Update (mutate + re-trim)
ensureSeason(ed, s);
setEpisode(ed, s, e, { aired, watched, id, file, res }); // merge + trailing-trim
clearFile(ed, s, e);        // drop file+res (file deleted)
stripToAiredWatched(ed);    // drop id/file/res for whole show (left Emby)
```

`setEpisode` is where the **trailing-drop / `0`-placeholder** compression logic
(§2) lives: it merges provided fields over the existing tuple, writes `0` for
false/null positions that have a later present field, then pops trailing absent
slots. `computeShowQuality(fileQuality)` is replaced by `computeQuality(ed)`
(same "most common resolution, ties → highest" logic, sourced from each tuple's
`res`).

## 5. The shared refresh function (core of instr-2)

`refreshEpisodeData(showName, rec, { force, sources })` — the **single
data-collection path** that keeps `episodeData` authoritative. It composes the
three existing sources into `rec.episodeData`:

1. **TVDB seriesMap** (`tvdb.getSeriesMap`) → `aired` for every TVDB episode
   (also refreshes `seasonPremiereDates`); adds tuple slots for aired-but-absent
   episodes. Skipped when aired data is fresh (staleness check) unless `force`.
2. **Emby seriesMap** (`emby.getSeriesMap`, only if `rec.inEmby && rec.id`) →
   `watched`, `id`, and the **file name** extracted from Emby's full `Path`.
3. **Disk scan** (`getShowDiskInfo`) → authoritative `file`/`res` for files
   physically present (reconciled against Emby below).

It then recomputes derived record fields in place: `quality = computeQuality(...)`,
`watchedCount = countWatched(...)`, `waitStr` (string logic, §7), and the gap
fields (§8, now computed locally from `episodeData`, no Emby).

**Reconciliation (disk vs Emby):**

- File **presence** is owned by the disk scan: if disk has the file, `file` is
  set even if Emby hasn't scanned yet; if disk lacks it, `file`/`res` are cleared
  even if Emby still lists a path.
- `id` is owned by Emby.
- For shows **not in Emby**, `stripToAiredWatched` drops `id`/`file`/`res`
  (instr-2: files are deleted when a show leaves Emby; stale on-disk files are
  ignored). `aired`/`watched` are kept so history survives a re-add.

**Where it is called** (replacing today's scattered collection logic):

- Background loop: replaces the Emby/TVDB seriesMap blocks in `tryLocalGetTvdb`
  and the disk-check block in `perShowCallback`.
- Immediately before `getSeriesMapFrom*` API responses are returned.
- Immediately before a tvdb record is pushed to the UI (`notifyCallback`).
- On `chokidar` disk-change events (`sources: ["disk"]`).
- During migration (§10).

A `episodeDataSaved` timestamp on the record drives the staleness check so the
refresh is cheap when already fresh.

### Writers this replaces / simplifies

| Location                                                    | Today                                  | After                                                |
| ----------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| `apps/srvr/index.js` `getShowDiskInfo`                      | returns `[date,size,filesOnDisk,fileQuality]` | returns file-name+res per episode for the refresh fn |
| `apps/srvr/index.js` perShow disk check (~L2502-2524)       | sets `filesOnDisk/fileQuality`         | `refreshEpisodeData(..., {sources:["disk"]})`         |
| `apps/srvr/index.js` `/api/populateFilesOnDisk` (~L3884)    | sets `filesOnDisk/fileQuality`         | `refreshEpisodeData(..., {sources:["disk"]})`         |
| `apps/srvr/index.js` chokidar handlers (~L7933, ~L8319, ~L8362) | sets disk + `watchedEpis`          | `refreshEpisodeData(..., {sources:["disk","emby"]})`  |
| `apps/srvr/src/tvdb.js` seriesMap blocks (~L2335-2400)      | sets `watchedEpis`/`episodeAiredDates` | folded into `refreshEpisodeData`                     |
| `apps/srvr/src/tvdb.js` record build (~L1983-1987)          | preserves four old props               | preserves single `episodeData`                       |

## 6. Path reconstruction nuance

Full path = `${tvDir}/${folder}/Season ${season}/${fileName}` with
`tvDir = "/mnt/media/tv"`.

- `<folder>` is **not always the record key / show name.** It is the last
  segment of `rec.path` (e.g. shows containing `/` like `Good Cop/Bad Cop`, or
  where the Emby folder differs from the display name). Reconstruction must use
  the show's folder exactly as `getShowDiskInfo` and the client's
  `getMapShowFolder` do today. `getFullPath(ed, folder, s, e)` takes the folder
  explicitly so callers pass the right value.
- The reconstructed path must byte-for-byte match what the player/clipboard
  expect today (currently Emby's `MediaSources[0].Path`). This holds when all
  media lives under `/mnt/media/tv/<folder>/Season <n>/`. A show on a different
  mount or season-folder convention would break — see §11.1.

## 7. `aired` stays a `YYYY-MM-DD` string (risk removed)

instr-2 keeps the human-readable `YYYY-MM-DD` string instead of a unix timestamp,
which **removes the highest-risk item** from revision 1. `calculateWaitStr` and
`checkAndDownloadOpnSrt` already do string / `new Date(str)` math, so they only
change their **lookup source** (`getAired(ed, s, e)` instead of
`episodeAiredDates[key]`), not their date logic. `isUnaired` uses the same
lexical `aired > today` comparison the code already relies on.

Other readers swap to helpers with no logic change: `calculateWatchedCount` →
`countWatched`; `emby.js` gap set → `episodeData`; `checkAndDownloadOpnSrt` →
`isWatched`/`getAired`; `getFirstFilesOnDiskSeasonGap` → `seasonsPresent`;
flexget → `isWatched`/`hasFile`; `needsIntro` → `seasonsPresent(...).length`;
L1048 → `isWatched` (see §11.6); `down/src/main.js` and the asr script →
`isWatched`. `computeShowQuality` → `computeQuality`.

## 8. `gapCheckOne` moves off Emby onto `episodeData`

Per `docs/epi-usage.md`, every field `emby.getShowState` reads maps onto
`episodeData`:

| Emby read                   | `episodeData` source          |
| --------------------------- | ----------------------------- |
| season list / structure     | `seasonsPresent` / iteration  |
| `UserData.Played`           | `isWatched`                   |
| `LocationType != "Virtual"` | `hasFile`                     |
| `IsUnaired=true`            | `isUnaired` (`aired > today`) |

`tvdbStatus` / `firstAired` (used by `skipMissingFileGap`) are already on the
record. So `getShowState`/`gapCheckOne` are rewritten as a **pure function over
`episodeData`** with **zero Emby calls** — the single biggest reduction in Emby
traffic (~`1 + 2·N_seasons` calls per show per pass eliminated). This relies on
`episodeData.watched` being fresh, which the refresh function (§5) guarantees
before the gap computation runs.

## 9. seriesMap boundary (server + client/Android)

Today the **client** (`apps/client/src/components/list.vue`) calls Emby directly
(`import * as emby from "../emby.js"`) to build the map, then overlays
`filesOnDisk`/`fileQuality`/`watchedEpis` from the tvdb record.

Target: build the seriesMap from `episodeData` via `toSeriesMap(ed, folder,
today)`, emitting the existing wire shape
`[[season, [[ep, { error, played, avail, noFile, unaired, path, id, quality }]], …]]`:

| seriesMap field   | from `episodeData`           |
| ----------------- | ---------------------------- |
| `played`          | `watched`                    |
| `noFile`          | `!hasFile`                   |
| `unaired`         | `aired > today`              |
| `avail`           | `hasFile && !unaired`        |
| `path`            | reconstructed full path (§6) |
| `id`              | `id`                         |
| `quality`         | `res`                        |
| `error`,`deleted` | `false`                      |

Two options for **where** this happens (decision — §11.3):

- **A. Server-side, wire format unchanged.** `/api/getSeriesMapFrom*` refreshes
  `episodeData` (§5) then returns `toSeriesMap(...)`. Client/Android untouched.
  Lowest risk; the only direct-Emby map path stays inside the server.
- **B. Client-side from `episodeData`.** Client builds the map from
  `allTvdb[show].episodeData` (it already has the records), eliminating the
  client→Emby call entirely. Bigger win, but **changes client + Android** and
  both UIs must stay in sync (repo rule); requires the server to have refreshed
  `episodeData` before the record reaches the client.

Recommendation: ship **A first** (server authoritative, no client change), then
optionally move to **B**. Either way the legacy `watchedEpis` array on the
`/api/getSeriesMapFromTvdb` request is derived from `episodeData` server-side.

## 10. Migration

The old four properties **cannot** fully populate the new format: old
`filesOnDisk` stored episode *numbers*, not file *names*, and `id`/`path` never
existed in the record. So migration is essentially a **bulk refresh**
(`scripts/migrate-to-episodeData.js`, following `scripts/migrate-*.js`):

1. Seed `episodeData` from old props: `aired` (string, as-is), `watched`, `res`.
   (`hasFile` cannot be carried — old data had no file names.)
2. Run `refreshEpisodeData(show, rec, { force: true })` per show to fill
   `file`/`id` (Emby + disk) and reconcile `hasFile`/`res`.
3. Delete `episodeAiredDates`, `watchedEpis`, `filesOnDisk`, `fileQuality`.
4. Assert `computeQuality`/`countWatched` match the previously stored
   `quality`/`watchedCount`; log diffs (sanity check).

**Cost:** one disk scan per show (~30 ms) + one Emby seriesMap per in-Emby show
(~9 local calls) + one TVDB call where aired is stale — the §5 refresh cost
(~under 1 s/show, mostly local). For ~260 shows this is a few minutes; acceptable
as a one-time job. Alternative (decision §11.4): seed steps 1+3 only and let the
background loop fill `file`/`id` lazily — faster migration but gap/quality are
degraded until each show is processed.

**Operational (repo rule):** stop `tv-srvr` first (avoid stale overwrite of
`tvdb.json`), back up `tvdb.json`, run migrate → deploy → restart together, then
check `pm2 logs` for restart/crash loops.

## 11. Ambiguities / contradictions / suggestions

1. **Season-folder reconstruction edge cases.** `Season <season>` assumes
   unpadded folders and that specials live in `Season 0`. Some libraries use
   `Specials` or zero-padded `Season 01`. If any show deviates, reconstructed
   paths won't resolve. Suggest: during migration, verify each reconstructed
   path exists on disk and log mismatches before trusting reconstruction for
   playback.

2. **`aired` may be missing.** A few episodes have no TVDB air date; slot `[0]`
   then needs a placeholder. Since `[0]` is the always-present anchor, suggest
   storing `0` for an unknown aired date (consistent with the "0 for null" rule)
   and treating `0` as "unknown / not unaired". Confirm.

3. **Server-built vs client-built seriesMap (§9).** Pick A or B. Recommendation:
   A first (no client/Android change), B later.

4. **Migration depth (§10).** Full bulk refresh (correct immediately) vs
   seed-then-lazy (faster migration, temporarily degraded gap/quality).
   Recommendation: full bulk refresh — only minutes, avoids a degraded window.

5. **`id` sentinel.** `0` means "no Emby id". Emby ids are large integers, so `0`
   is a safe sentinel. Noted, not a problem.

6. **Latent bug at `apps/srvr/index.js` ~L1048.** `tvdbRec.watchedEpis?.[key]?.watched`
   indexes the season-first array as if it were an `"SxxExx"` object — always
   false today. Porting to `isWatched(ed, s, e)` makes it actually skip watched
   episodes for subtitle download (a behavior change). Recommend porting it (the
   intent is clearly to skip watched), as an explicit, logged change.

7. **Direct-Emby calls remaining.** Even with option B, a live Emby call is still
   needed when (a) the user plays an episode whose stored `id`/`path` is stale
   (rare; fall back on playback failure), and (b) the periodic Emby full-sweep
   that discovers added/removed shows (`runEmbyFullSweep`) — show-level, not
   episode-level, and stays.

8. **No impossibilities.** Every old shape maps onto the new tuple. The only
   genuinely new dependencies are file-name capture (needs a disk/Emby scan, via
   the refresh function) and path-reconstruction correctness (§6, §11.1).

## 12. Suggested implementation order

1. `packages/share/src/episodeData.js`: helpers + `toSeriesMap` +
   `computeQuality`/`countWatched` (unit-test the trailing-drop encode).
2. `refreshEpisodeData` (§5) wrapping the existing TVDB/Emby/disk fetchers.
3. Rewrite `getShowState`/`gapCheckOne` as a pure `episodeData` function (§8).
4. Point readers at the helpers (§7), including the L1048 fix (§11.6).
5. Replace writers with `refreshEpisodeData` (§5 table).
6. seriesMap boundary option A (server builds from `episodeData`).
7. Migration (§10): stop srvr, back up, bulk-refresh, drop old props, deploy,
   restart, verify `pm2 logs`.
8. (Optional) seriesMap option B — client/Android build from `episodeData`.

```
