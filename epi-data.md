# episodeData: duplicates and gaps

As of 2026-10-09. The tuple today is `episodeData[season][episode-1] =
[aired, watched, file, res, pos]` (`packages/share/src/episodeData.js`),
refreshed by `refreshEpisodeData()` in `apps/srvr/src/disk.js`. Shows out of
the library keep only `[aired, watched]`.

Counts below come from a read-only pass over all 1618 records in tvdb.db.

## 1. Fields that duplicate episodeData

### Computed from episodeData alone

These could be dropped from the record and computed when read.

| Field | Computed as | Notes |
| --- | --- | --- |
| `watchedCount` | `countWatched(ed)` | Two writers use two definitions. The server (`disk.js:521`, `index.js:2114`, `2140`, `3124`) counts season 0. The client's info pane (`info.vue:1180-1203`) skips season 0 and saves its count back through `setTvdbFields`. 6 shows out of the library have watched specials, so their count includes episodes that `episodeCount` doesn't. Today's bug, where The Lovers showed 0, was the info pane saving a count taken from a map with every episode unwatched. |
| `quality` | `computeQuality(ed)` | `disk.js:520`, `index.js:1852`. Matches on every record. |
| `anyWatched` | `countWatched(ed) > 0` | Set by the gap check, for library shows only. The only reader is `applyAutoCollections` (`index.js:3707`). 389 shows out of the library have it missing or false although they have watched episodes. |
| `full` | `inLibrary` and every aired episode is watched or has a file | `index.js:538-541`. Nothing reads it. |
| `seasonPremiereDates` | each season's first-episode aired month | `disk.js:524-533`. It is written only when missing, so seasons added later never appear. `list.vue:2735` attaches it to `mapShow`, but nothing displays it. |

### Computed from episodeData plus a few other inputs

| Field | Inputs besides episodeData | Notes |
| --- | --- | --- |
| Gap flags: `watchGap*`, `fileGap*`, `resDrop*`, `fileEndError*`, `seasonWatchedThenNofile*`, `stray`, `strayCount`, `strayFiles`, `straySeason`, `strayEpisode` | today, `inLibrary`, `firstAired`, filtered by `ignoreGaps` | `getShowState()` in `gaps.js`. Two paths copy the results onto the record: `index.js:522` copies everything, and `updateTvdbWithGapData` (`tvdb.js:3625-3656`) copies only the flags. The `*Season`/`*Episode` fields point at single episodes. |
| `notReady` | today, `inLibrary` | Set by the gap check. It is also set directly when a show is deleted or leaves the library (`index.js:581`, `3432`, `3478`; `list.vue:553-558`). |
| `waitStr` | `lastPlayedDate`, today | `disk.js:538`. It goes stale as days pass. `index.js:3829` deliberately keeps the old value for the hide/unhide loop. |
| `needsIntro` | `seasonIntros`, `inLibrary`, `episodeCount` | `index.js:551-562` tests `episodeCount > watchedCount`, which compares TVDB's count (no season 0) with a count that includes season 0. The client (`App.vue:1059`) uses a different rule: it also excludes `inLinda` and checks old top-level `trimPos`/`skipDur`. `App.vue:1132` forces it to true. |
| `noFiles` | the disk | It means "the show folder is missing", which is close to "no episode has a file" but not the same. 21 library shows have a folder but no episode files. |
| `lastPlayedEpisode` | play events | Names one episode (`index.js:3139`). It duplicates nothing, but it is per-episode data kept at show level (see part 2). |

### Overlapping with TVDB values

| Field | Notes |
| --- | --- |
| `episodeCount` / `seasonCount` | The server keeps the larger of the stored and TVDB counts (`tvdb.js:2143-2144`), and never lowers it. TVDB's count includes undated episodes, which have no slot in episodeData. The client writes episodeData's count for seasons 1 and up (`info.vue:1199`), and the map's count for shows out of the library (`info.vue:1794`). The two counts don't match on 104 shows, and about 25 of those have impossible stored values (e.g. 272 episodes in 4 seasons for a 10-episode show). |
| `firstAired` / `lastAired` / `nextAired` | Come from TVDB series data (`tvdb.js:2148-2150`). They could be the earliest aired date, the latest past aired date and the next future aired date in episodeData, except where TVDB treats season 0, season types or undated episodes differently. |

### Not duplicates

`size`, `date` (disk totals), `averageRuntime` (TVDB), `seasonIntros`,
`lastPlayedDate`, `fakeLastPlayed`, `gapSig` (includes stray file stats),
`ignoreGaps`, `inToTry`, `inContinue`, `anticipating`, `waitSeen`,
`last-downloaded`. `premiereDate` is legacy data: nothing writes it any more.

### Leftover code for old per-episode props

- `disk.js:541-544` deletes `watchedEpis`, `filesOnDisk`, `fileQuality` and
  `episodeAiredDates` on every refresh, but nothing writes them any more.
- `getShowDiskInfo` still builds `filesOnDisk`/`fileQuality` for the disk
  cache (`disk.js:386-394`).
- `migrateWatchedCount` (`tvdb.js:3675`) reads `watchedEpis`, which never
  exists now, so it can't do anything.
- `computeShowQuality(fileQuality)` in `packages/share/src/index.js` is never
  called.
- `watchedEpis` survives only as a request format for `/api/setWatchedEpis`
  and `/api/getSeriesMapFromTvdb` (see below).

### Watched marks sent to `/api/getSeriesMapFromTvdb`

The client sends this endpoint a copy of episodeData's watched marks as
`watchedEpis`. Nothing is saved: the list only sets `played` on the map the
endpoint returns.

- **Why it was built that way:** the endpoint arrived on 2026-02-19 (commit
  4e21e069, "add map to preview mode"). It wraps `tvdb.getSeriesMap(tvdbId,
  watchedEpis)`, a plain TVDB episode fetcher that gets only a tvdbId, not a
  show name or record, so it has nothing to look watched episodes up in. Back
  then watched state was in Emby or in a top-level `watchedEpis` on the
  record, which the client already had, so the caller passed it in.
- **Why it's wrong now:** episodeData on the server is the authoritative
  store of watched marks.
  - **A caller that leaves the list out gets wrong data.** `list.vue` sent
    only the tvdbId for shows out of the library. It got every episode
    unwatched, and the info pane then saved `watchedCount: 0` (The Lovers,
    2026-10-09).
  - **A caller that sends it can override the server.** The client's cached
    copy can be stale. On 2026-10-09 the endpoint (`index.js:1217`) was
    changed to use the record's episodeData when no list is sent, but a sent
    list still wins.
  - **It keeps the dead `watchedEpis` format alive**, only for this request.
- **The clean version:** take only the tvdbId and always use the record's
  episodeData. That means dropping the `watchedEpis` parameter from the
  endpoint and from `tvdb.getSeriesMap`, and dropping the code in
  `showData.js:60` that builds the list to send.

## 2. Episode data that is not in episodeData

### Episodes with no slot

- **TVDB episodes with no aired date** get no slot (`disk.js:429-433`).
  `playProgress`, `setEpisodeWatched` and `clearEpisodePositions` reject an
  episode with no slot (`index.js:3099`, `2131`, `1683`). So such an episode
  can't be marked watched or resumed until it gets a date or a file. This is
  also most of the `episodeCount` mismatch.
- **Season 0 specials** are skipped by the server's TVDB map (`tvdb.js:466`).
  A special gets a slot only when its file is on disk, and then the gap check
  flags it as a stray because it has no aired date.
- **Files the disk scan skips** (`disk.js:333-370`): names with no parseable
  SxxEyy, titles that don't match the show folder, and extra copies of an
  episode (only the highest resolution is kept).

### Per-episode data kept on the show record

- `lastPlayedEpisode` and `lastPlayedDate`: only the most recent play, for the
  whole show.
- The gap pointers: `watchGap`, `fileGap`, `resDrop`, `fileEndError` and
  `seasonWatchedThenNofile`, each with a `*Season`/`*Episode` pair.
- `strayFiles` (file names) and `strayNote` (text naming an episode).
- `ignoreGaps`: a list of `S{s}E{e}` keys, valid only while `gapSig` matches.
- `seasonIntros`: intro trim/skip for each season, marked on one episode.

### Per-episode data in other stores

| Store | Key | Per-episode content |
| --- | --- | --- |
| subs.db `subs` | show id, season, episode, file id | every OpenSubtitles result, with downloaded/chosen/unfit/hash fields |
| subs.db `picks` | show id, season, episode | the subtitle showing at the last stop |
| subs.db `processed` | video path | the video has been through the add-to-disk steps |
| subs.db `clips` | video path | English audio track, ASR clip transcripts |
| subs.db `checks` | sidecar path | the subtitle check's verdict and offset |
| sidecar `.srt` files | beside the video | the subtitles themselves |
| `apps/asr/data/subQueue.json`, `asrQueue.json` | video path | queued subtitle/ASR work |
| stills dirs + `src.json` | video path | stills, duration, keyframes, `partial` |
| `.recode.json` | beside the original | recode history |
| `flexget-history.json` | show + SxxEyy | download candidates (quality, group, seeds, sent) |
| tv-down `tv.sqlite` `tv_entries` | download title | season, episode, paths, size, status and dates of each download |

In memory only: `tvappNowPlaying` (`index.js:2858`), the runtime cache in
`strayEpisodes.js`, the episode image cache in `images.js`, and tvapp's
`Episodes.CACHE` (image, overview, aired).

### Data no store holds

- **Episode title, overview, still image, TVDB episode id, runtime, guest
  cast.** They are fetched from TVDB/TMDB on every view. The server's TVDB map
  reads them and throws them away, keeping only `aired`
  (`tvdb.js:516-527`). The client's `getEpisode` makes two TVDB calls just to
  find the episode id.
- **When each episode was watched, and how many times.** Only the show-level
  `lastPlayedDate` exists. `played`, `playCount` and `introDur` are listed as
  dead fields (`DEAD_TVDB_FIELDS`, `tvdb.js:223`).
- **File facts other than resolution:** duration, size, mtime, codec, audio
  language, HDR. They come from ffprobe each time. `/api/episodeStats` finds
  the file by reading the folder, not from episodeData.
- **Intro marks for each episode.** They exist only per season.

## 3. Bugs found along the way

- The server and client write different values for `watchedCount`,
  `episodeCount`, `seasonCount` and `needsIntro`, and each refresh overwrites
  the other's.
- `gaps.js:446` reads `showMeta.tvdbStatus`, which no record has (records
  store `status`), so the "upcoming show" skip never runs.
- `seasonPremiereDates` is written once and never updated.
- `/api/getSeriesMapFromTvdb` lets a client-sent `watchedEpis` override the
  record's own watched marks (see part 1).

## 4. Named fields instead of positional tuples

Recommended: store each episode as an object with named fields instead of
the positional `[aired, watched, file, res, pos]` list. The cost is small,
and the positional format has already been painful.

### Reasons to switch

- **The tuple has changed four times in three months.** An Emby id slot,
  then a bif flag, then the bif slot retired and `pos` added in Emby ticks,
  then on 2026-09-25 the id dropped and `pos` moved to ms. Each change shifted
  positions and needed a migration of every record. A mistake doesn't fail
  loudly; it just reads the wrong field.
- **Adding the missing data gets easy.** Episode title, TVDB episode id,
  watched date and play count (part 2) would just be new keys. Old readers
  ignore keys they don't know, so nothing shifts.
- **Positions force placeholder zeros.** Setting `pos` needs a value in every
  slot before it, so an empty file slot is stored as `0`. tvapp has to check
  `"0".equals(file)` for that (`ShowListView.java:1940`), and `aired` is also
  `0` when unknown. Named fields can simply be left out.
- **The record would read like the rest of the show record.** Every other
  field is named. Right now you need the comment in `episodeData.js` to read a
  tuple in sqlite or jq.

### Costs, all small

- **Size:** episodeData is 1.05 MB of the 10.3 MB of show JSON (47,538
  episodes). With full key names it becomes 1.57 MB, about 5% more for the
  whole db and the `getAllTvdb` payload. Short keys (`a`, `w`, ...) would only
  save another 0.27 MB, which isn't worth losing readability. gzip removes
  most of the repeated keys on the wire anyway.
- **JS code:** contained. All JS access goes through the helpers in
  `packages/share/src/episodeData.js`, with no raw `[1]`/`[2]` indexing
  outside it. Changing `getEp`/`setEpisode`/`encodeTuple` and the few loops
  there covers the server and web client, with the helper signatures
  unchanged.
- **tvapp:** reads positions directly through its own constants in
  `Shows.java` (`anyFile`) and in `ShowListView.java` (`nextUp`, `mapCell`,
  and the in-memory watched toggle). Those need changing, and the rebuild has
  to go out with the server change. Otherwise the TV shows blank maps until
  it's reinstalled, unless tvapp accepts both shapes for a while.
- **Migration:** a one-time conversion of 1618 rows, done with tv-srvr
  stopped since it's the single writer. Alternatively, the loader could
  convert old tuples on read and save them in the new shape.

### Suggestions

- Leave the outer `[season][episode-1]` arrays alone. Only the per-episode
  tuple is the problem.
- Use the full names already in use (`aired`, `watched`, `file`, `res`,
  `pos`), and leave out any field that's empty, false or 0.
- Do it in the same pass as adding the missing per-episode fields from
  part 2. Both touch the same helpers, the same tvapp code and the same
  migration, so you'd migrate once instead of twice.

## 5. Where derived values should be computed

Not on every access. But processing isn't the real issue either: it's
cheap. Timed on hahnca.com over all 1618 shows (2026-10-09):

| Computation | Time for all shows |
| --- | --- |
| `watchedCount` + `quality` | 1.5 ms |
| `waitStr` | 10.8 ms (1.3 ms for the 214 library shows) |

The gap check is the same kind of loop over episodes, so the episodeData part
should cost about the same. Its one costly piece is stat-ing stray files on
the media disk for `gapSig`, and that should stay a scheduled job.

The real question is where these values get computed and who owns them.
Split them three ways:

1. **Pure and stable** (`watchedCount`, `quality`, `anyWatched`, `full`,
   `seasonPremiereDates`): don't store them. Compute them in one shared
   function in `packages/share`, at the moment episodeData changes. The gain
   isn't saving storage; it's one definition and one writer. The
   2026-10-09 bug came from the server and the info pane computing
   `watchedCount` two different ways and each saving its own.
2. **Depend on today's date** (`waitStr`, `notReady`, the gap flags that test
   whether an episode has aired): storing these is what makes them wrong. A
   stored `waitStr` is stale from midnight until the next sweep. They should
   be recomputed when episodeData changes and when the day rolls over.
   - Exception: the hide/unhide loop deliberately keeps the old `waitStr`
     (`index.js:3829`) and records what it acted on in `waitSeen`. That's real
     state, and it should stay stored under its own name.
3. **Need the disk or a user decision** (`gapSig`, `ignoreGaps`,
   `strayNote`, `noFiles`, `size`): these have to stay stored.

For groups 1 and 2, tv-srvr should do the computing, not every reader.
tvapp (Java on the TV's slower CPU) and the web client both read `waitStr`,
`notReady` and `watchedCount`. Making each compute them means porting the
logic to Java and keeping copies in sync, which is worse than duplicated
data. Instead:

- tv-srvr keeps the derived values in memory per show. It recomputes them
  when that show's episodeData changes, and for every show once a day (about
  11 ms in total).
- It adds them to the records it sends (`getAllTvdb`, the `tvdbUpdated`
  push), but never writes them to tvdb.db.
- Clients only read them and never send them back through `setTvdbFields`.

Readers get the same precomputed fields they get today, the database holds
only real data, and there's nothing left to fall out of step.
- The comment at `disk.js:498` says shows out of the library drop
  "id/file/res". The tuple has had no id slot since 2026-09-25, and
  `stripToAiredWatched` also drops `pos`.
