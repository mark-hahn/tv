# Kill Emby — plan

Goal: the tvdb record (tv-srvr, `tvdb.db`) is the only store of show data,
the disk (`/mnt/media/tv`) is the only source of what files exist, and tvapp's
Media3 player is the only player. No Emby calls, no Emby mirror, no emulation.
Every phase leaves the app working.

**Emby itself stays (2026-09-25).** It remains a real app on the TV that is used
on its own, and it stays in the streaming apps list. Only our apps are
separated from it: nothing of ours calls, launches, controls or reads Emby.
Emby keeps its library current with its own scans.

## What Emby does today → what replaces it

| # | Emby provides today | Where | Replacement |
|---|---|---|---|
| 1 | Library membership: sweep finds new/removed series, sets `inEmby` | srvr `runEmbyFullSweep` (index.js ~3955-4330), `handlePickupChange` | Folder scan of `/mnt/media/tv` (chokidar already watches it). A folder → a record in the library. Rename `inEmby` → `inLibrary` (see Decisions) |
| 2 | Show id: `rec.id` is the Emby series id, `noemby-<rand>`, or null (524 records) | everywhere: client keys, tvapp `show.id`, `showId` API params | `id` = `tvdbId` (unique on all records but 3) |
| 3 | Episode id: `episodeData` slot 2 is the Emby item id | share `getEmbyId`, tvapp `ED_ID`, `focusedEpisodeId`, `p,<embyId>`, map.vue → `/tv/showintvapp`, `setEpisodeWatched`, `getPlayUrl?episodeId` | season+episode pair (`S01E02` or `season,episode` params). Drop the slot |
| 4 | Series metadata copied by the sweep: `path`, `genres`, `overview`, `dateCreated`, `premiereDate`, `played`, `playCount` | sweep step 2 | `path` = folder name; `genres`/`overview`/`firstAired` already from TVDB; `dateCreated` = stamped when the folder is first seen; `played`/`playCount` dropped (derive from episodeData) |
| 5 | Collections To Try / Continue / Mark / Linda | sweep reads them back; `setEmbyCollection` writes | `inToTry`/`inContinue`/`inMark`/`inLinda` on the record become the truth. Delete `COLLECTION_IDS` and both directions |
| 6 | Watched flag per episode (episodeData slot 1, pulled from Emby) | `refreshEpisodeData({sources:["emby"]})`, disk.js ~481-491, client direct `Items/{id}/UserData` | episodeData is the truth. `/api/setEpisodeWatched` writes only the record. tvapp player marks watched on end (and at ~90%) |
| 7 | Resume position (episodeData slot 6 `pos`) | Emby UserData | tvapp player reports position to srvr (every ~30 s, on pause, on close); srvr stores it in `pos`; player `seekTo(pos)` on start |
| 8 | `lastPlayedDate` / `lastPlayedEpisode` | Emby LastPlayedDate fetch | srvr stamps them when tvapp reports a play |
| 9 | Hide / wait-over date shifting (`setEmbyLastPlayed`, `toEmbyDate`, `hideShowInEmby`) | index.js ~4643-4825 | Only `fakeLastPlayed` on the record (already the fallback path for shows with nothing played). Check the Viewed sort key in all three places (showFilterSort.js, Shows.java, App.js) still reads `fakeLastPlayed \|\| lastPlayedDate` |
| 10 | Now playing (tv-tv Emby websocket → `POST /internal/nowPlaying`) | tv-tv `connectEmby`, `handleEmbySession`, `updateNowPlaying` | tvapp VideoPlayer posts the same `{showName, playing[]}` shape to srvr (via the bridge or straight to srvr). Keeps feeding intro trim, `checkMissingEpisodes`, played-date refresh, phone follow-playing + progress bar |
| 11 | Series map for the Map pane / next-up / play target | srvr `emby.getSeriesMap` (live Emby), `/api/getSeriesMapFromEmby`, index.js ~3109, ~3205, ~3712, `playTargetEpisode` | Build it from episodeData. Rename route to `/api/getSeriesMap` |
| 12 | Playback control: seek, pause, subtitle track, subtitle offset, skip intro | tv-tv `/tv/emby/*`, srvr `intro.js` (seeks Emby session), `/api/skipIntro` | tvapp player: keys forwarded over the bridge while the video is up; intro skip/trim from `seasonIntros` done in the player; subtitle = chksrt preferred srt URL returned by `getPlayUrl` |
| 13 | Subtitle mismatch detection | tv-tv `checkSubtitleMismatch`, `/internal/subtitle-mismatch` | Gone — tvapp loads the preferred sub itself |
| 14 | Images for library shows | tvapp `Backdrops.java` (Emby `Items/{id}/Images`), client posters | `/api/getBackdrop` (TMDB) / TVDB `image` for every show |
| 15 | Library refresh after file changes | `embyRefreshManager`, `/api/refreshEmbyItem`, `/api/requestEmbyLibraryRefresh`, `/api/embyTaskStatus`, compact-NNN fix (index.js ~533-620), down's refresh calls | `refreshEpisodeData({sources:["disk"]})` on chokidar events — nothing else to refresh |
| 16 | Duplicate-folder merge and stray episodes use Emby's series list | `fetchEmbySeriesUnfiltered`, `planDupeFolderGroups`, dupeFolders.js | Same planner fed by the folder list + record `path`/tvdbId |
| 17 | Emby app on the TV: power-on launch, Back-to-Emby, `closeEmbyShow`, viewshow resend machinery, `/tv/selectshow` walking Emby's home screen | tv-tv, tvapp `backToEmby*`, `openEmby`, `/tv/closeembyshow` | tvapp is the home app. Back at tvapp's top level → Android home (see Decisions). Power-on launches tvapp only |
| 18 | Remote play on other devices (chromecast, roku, lindaTab), device list | srvr `getDevices`, `/api/embyViewShow`, client `startStop` | Removed. Only tvapp plays |
| 19 | Played flags for shows that left Emby | `embyWatched.js`, `/api/backfillWatchedFromEmby` | Run once in the harvest (phase 2), then delete |
| 20 | "Emby" link in `remotes` | tvdb.js remotes builder | Dropped |

## Phases

### Phase 1 — tvapp player owns playback state (additive; Emby still runs)
- srvr: `getPlayUrl` picks the episode from episodeData (not `getSeriesMap`), takes season/episode, returns `{url, pos, subsUrl, intro}`.
- srvr: new `POST /api/playProgress {showName, season, episode, pos, dur, state}` → writes `pos`, sets watched at end/~90%, stamps `lastPlayedDate`/`lastPlayedEpisode`, and runs what `/internal/nowPlaying` runs today.
- tvapp VideoPlayer: `seekTo(pos)`, report progress, mark watched on `STATE_ENDED`, load `subsUrl`, intro skip from `seasonIntros`, pause/seek keys, error toast.
- tvapp: turn off `PLAY_TEST_VIDEO` (MainActivity.java:116) so the real `playVideo` path runs.
- Deploy `./srvr srvr`, `cd apps/tvapp && ./build-apk`. Check: play → close → play resumes, watched flips at end, Viewed sort moves the show.

### Phase 2 — one-time harvest from Emby (tv-srvr stopped, `tvdb.db` backed up)
**Done 2026-09-25 — nothing to copy.** The sweep already keeps watched, `pos`,
`lastPlayedDate`, collections and `dateCreated` on the records, and Phase 1
dual-writes. `/api/backfillWatchedFromEmby` (widened to every show) dry-ran at
46 flags in 12 shows, all for episode numbers TVDB doesn't have (Emby-only
numbering, specials) — the ghost prune would drop them, so it was not run for
real. The renames, id switch and slot drop below can't run yet: the live code
reads `inEmby` (disk.js strips files from every show without it) and the
client/tvapp use `id`/slot 2 as Emby ids. They move to a final cutover after
Phase 5, done with tv-srvr stopped and every app deployed together.

Originally planned as an offline script, run once, then deleted:
- For every show Emby has: copy per-episode watched flag + `pos` + LastPlayedDate into episodeData / record; copy collection membership into `inToTry`/`inContinue`/`inMark`/`inLinda`.
- For every show: `embyWatched` backfill (Emby user data survives removal).
- Set `id` = `tvdbId`; resolve the 3 records without a tvdbId (Landman, Spy, Zach Stone Is Gonna Be Famous) by hand.
- Set `inLibrary` = folder exists in `/mnt/media/tv`; stamp `dateCreated` for folders that lack it.
- Drop slot 2 (Emby item id) from episodeData, drop `remotes` "Emby" entries, `emby`, `played`, `playCount`, `leftEmby`.
- Check: counts per field before/after; spot-check a few shows in the map pane.

### Phase 3 — srvr stops talking to Emby
**Done and tested 2026-09-25.** tv-srvr makes no Emby calls at all. The watcher also takes a show out of the library when its folder is removed with no videos in it.
- **Library sweep** (`runLibrarySweep`, every 10th background tick and after every disk change) replaces the Emby sweep. The disk says what is in the library:
  - a library show whose folder is gone leaves it;
  - a folder holding videos joins under the record named like it;
  - a folder with videos and no record is logged, to be added from the web client.
  - Run against the live data before deploying: nothing joined, left or merged.
- **Web add:** `/api/createShowFolder` puts the record in the library itself (`inEmby`, `path`, `id` = tvdbId, `dateCreated` = now). No Emby scan to wait for.
- `refreshEpisodeData` reads TVDB and the disk only. Watched marks and `pos` are the record's own, and `pruneGhosts` never drops a watched mark.
- Collections, watched, play state, hide/unhide and wait-over write the record only. Hiding is `fakeLastPlayed` alone.
- The gap check moved to `gaps.js`. The duplicate-folder merge works from the disk folders. recode's "is it playing" check reads tvapp's now-playing, and the missing-episode warning reads episodeData.
- **Deleted:**
  - files: `emby.js`, `embyConfig.js`, `embyWatched.js`, `urls.js`, and intro.js's Emby session seeks;
  - code: `embyRefreshManager`, the compact-NNN fix, `COLLECTION_IDS`/`setEmbyCollection`, `setEmbyLastPlayed`/`toEmbyDate`, `fetchLatestPlayedInfo`;
  - routes: `getDevices`, `embyViewShow`, `triggerEmbySync`, `embySync`, `requestEmbyLibraryRefresh`, `embyLibraryRefreshStatus`, `embyTaskStatus`, `refreshEmbyItem`, `backfillWatchedFromEmby`, `skipIntro`, `trimIntro`, `/internal/nowPlaying`, `/internal/subtitle-mismatch`;
  - the Emby link in `remotes`; the sweep strips it from old records.
- **Web client:** Scan Lib, Open Lib, the library-refresh progress, and the map's Emby buttons are gone. Deleting files reprocesses the show through `triggerShowSelect`.
- **Kept on purpose** (not Emby calls): `createShowFolder` still writes `tvshow.nfo` and chowns to `emby`, since Emby the app scans the same folders; `oldFiles.js` still spares Emby's own metadata files.
- **Left for the final cutover** (names only): `inEmby` → `inLibrary`, `addNoEmby`/`delNoEmby`/`getNoEmbys`, `getSeriesMapFromEmby`, `searchActorsInNonEmby`, `hasEmby`, `leftEmby`, `played`/`playCount`, "Not In Emby" labels, the client's `emby.js`, `fromSubCtrl`.

Originally planned as:
- Replace `runEmbyFullSweep` with a disk library sweep (new folder → create/link record by folder name → TVDB search; folder gone → `inLibrary=false`).
- Delete: `emby.js` Emby parts (keep `getShowState`/gap check, move to `gaps.js`), `embyConfig.js`, `embyWatched.js`, `embyRefreshManager`, `setEmbyCollection`, `setEmbyLastPlayed`/`toEmbyDate`, compact-NNN Emby refresh, `fetchEmbySeriesUnfiltered`, routes `getDevices`, `embyViewShow`, `getSeriesMapFromEmby`, `triggerEmbySync`, `embySync`, `requestEmbyLibraryRefresh`, `embyLibraryRefreshStatus`, `embyTaskStatus`, `refreshEmbyItem`, `backfillWatchedFromEmby`, `/internal/nowPlaying`, `/internal/subtitle-mismatch`.
- `getAllTvdb({hasEmby})` → `getAllTvdb()` with an `inLibrary` filter param if still needed.
- `addNoEmby`/`delNoEmby`/`getNoEmbys` → `addShow`/`delShow`/`getNonLibrary` (ids are tvdbIds now; no `noemby-`).
- `searchActorsInNonEmby` → rename.
- Other srvr/src files (disk.js, intro.js, oldFiles.js, dupeFolders.js, recode.js, localHistory.js, subsQueue.js, showPaths.js, fileOps.js, strayEpisodes.js, srt.js, routes/media.js, flexget.js, batchQueue.js, urls.js): replace `inEmby` with `inLibrary`, `rec.emby?.path` with `rec.path`, remove Emby URLs.
- Deploy `./srvr srvr`, check pm2 logs, check unilog errors.

### Phase 4 — tv-tv, tvapp, phone, web client
**Done 2026-09-25 (awaiting testing).** No client, tvapp or tv-tv code talks to
Emby any more. Everything left goes through srvr routes, which Phase 3
replaces.
- **Web client:**
  - Collections and the watched toggle go through srvr `setTvdbFields` / `setEpisodeWatched`. srvr still mirrors them to Emby until Phase 3.
  - The series map and prune use srvr's map.
  - Delete only removes the folder. tv-srvr sees it go and has Emby rescan, and the sweep then clears `inEmby`; no Emby delete call.
  - Episode counts come from `episodeData`.
  - Dead next-up / watch-button code is removed.
  - `urls.js` is down to `embyPageUrl`, used by the map's Emby link.
- **Phone and tv pane:**
  - The Emby cell is Search in tvapprc mode and empty otherwise. The Skip cell is Hide in tvapprc mode and empty otherwise.
  - The subtitle panel and the `embyPlaying` / `subtitleMismatch` handling are gone. Holding Vol+ is now just Vol+.
  - Emby is out of the streamer lists.
  - The show pane's TV button uses `/tv/showintvapp`.
- **Episode identity:** season/episode everywhere. This covers map.vue, the phone show pane, `/tv/showintvapp`, `p,<season>,<episode>` and `getPlayUrl?season&episode`.
- **tvapp:**
  - Backdrops come from srvr `getBackdrop` (TMDB) for every show.
  - Back at the top level does nothing, the switch to Emby is gone, and so is `g`.
  - `b`/`e` are renamed `CMD_BACK`/`CMD_PLAY`.
  - A video is paused while the camera overlay is up.
- **tv-tv:**
  - Removed: the Emby websocket and now-playing, the viewshow machinery, `/tv/emby*`, `/tv/mode`, `/tv/selectshow`, `/tv/toggletvapp`, `/tv/tvapprc/{forceback,emby}` and `/tv/closeembyshow`.
  - `closeEmbyShow` and the Emby launch at power-on are gone. The camera no longer pauses Emby.
  - `emby-status` is deleted, and Emby is out of `bravia.js` and `services.json`.
- **Left for Phase 3:** done there, except the renames, which wait for the final cutover.

**Web client inventory (2026-09-25).** Line numbers are from that date.

Direct Emby REST calls in `apps/client/src/emby.js`, and what replaces each:

| Client call | Callers | Replacement |
| --- | --- | --- |
| `editEpisode` :882 | list.vue:2520 `episodeClick` | `/api/setEpisodeWatched` (index.js:2316); pass `watched` worked out from `cell.played` |
| `getSeriesMap` :1001 | tor.vue:2885 `calculateNeeded`, actors.vue:1667 and :1858 | `/api/getSeriesMapFromEmby` (index.js:1810); same wire shape, list.vue:2766 already uses it |
| `getSeriesMap(show, true)` (prune) | map.vue Prune → list.vue:2744 | **New route:** from `episodeData`, delete the watched files before the first unwatched episode with a file, as `/api/deletePaths` does |
| `saveToTry` / `saveContinue` / `saveMark` / `saveLinda` :1278-1370 | list.vue:476/522/543/561 | **New route**, or extend `setTvdbFields`: call index.js `setEmbyCollection`, then set the flag |
| `deleteShowFromEmby` :840 | list.vue:584 `deleteShow` | **Dropped:** its delete raced Emby's own rescan and failed; the rescan alone removes the show |
| `getEpisodeCounts` :935 | info.vue:1227 `setSeasonsTxt` | Count from `episodeData`, or the record's counts |
| `getTvdbIdFromEmbyItem` :1405 | info.vue:1486 `loadIntoEmby` | Fall through to the TVDB search at info.vue:1492 |
| `afterLastWatched` :1462 | info.vue:1348, map.vue:2602 | Result is never rendered → delete |
| `init` / `getToken` :50/:64 | list.vue:3399 | Delete once the rows above are done |

Already dead, so delete: `_oldLoadAllShows`, `syncCollections`, `startStop`, `refreshLib`, `taskStatus`, `createNoemby`/`deleteNoemby`. Also the unused `emby`/`urls` imports in App.vue:566/573 and util.js:1, and the `urls.js` Emby URLs and keys.

Emby-only UI and the srvr routes it calls. These go in Phase 3, or with it:
- hdrtop "Scan Lib" / "Open Lib" (list.vue:1015/1019)
- App.vue library-refresh progress (:1299-1388; `requestEmbyLibraryRefresh`, `embyLibraryRefreshStatus`, `triggerEmbySync`, WS `libraryRefresh`)
- info/map "Not In Emby" + Load, and `createShowFolderAndRefreshEmby` (list.vue:1613, map.vue:1730; also used by the web-add flow)
- tor.vue `ensureInEmby` and its modal (:3626, :1231)
- usb.vue "Show not in emby" (:1777)
- map "Emby" button (`embyPageUrl`, map.vue:2460)
- map "TV" button, which sends slot 2 to `/tv/showintvapp` (map.vue:2468)
- the tvdb-mismatch modal (App.vue:481)
- `refreshEmbyItem` (list.vue:2451/2624/2859/3811)
- `clearEpisodePositions` (map.vue:2369)
- `hideShow` → `hideShowInEmby` (info.vue:937)
- `getDevices` (actors.vue:1829)
- tvpane `/tv/emby/playing` and `/tv/emby/subtitle` (:1843/:1906)

The phone, tvapp and tv-tv inventories were stopped before they finished; they still need to be redone.

- tv-tv (`apps/tv/src/main.js`): delete the Emby websocket stack, `/tv/emby/*`, viewshow machinery, `/tv/viewshow`, `/tv/mode`, `/tv/selectshow`, `/tv/emby`, `closeEmbyShow`/`embyGoHome`, `/tv/closeembyshow`, `/tv/toggletvapp`, `/tv/tvapprc/forceback`, `/tv/tvapprc/emby`, `embyProcessAlive`, Emby launch in `googlePowerOnSequence`, videostream Emby branches (pause tvapp's video instead), `sendIrcc` if unused. Keep `lastRelevantShow`, `/tv/clientShow`, `/tv/showintvapp` (episode as season/episode), `/tv/opentvapp`, `/tv/tvapprc/back`, bridge. Delete `emby-status.mjs`, `emby-status`, Emby in `bravia.js`, `services.json`.
- tvapp: `Shows.java` (`id`, `inLibrary`, episodeData layout, URL), `ShowListView` (ED_ID gone, `focusedEpisode` = season/episode), `CtrlServer` (`p,<season>,<episode>`; `b`/`g`/`e` renamed), `MainActivity` (drop `openEmby`/`backToEmby*`/`CLOSE_EMBY_SHOW_URL`/`BACK_DEAF_ON_FRONT_MS`), `Backdrops.java` (TMDB for all), `MapCells`.
- phone `apps/android/App.js`: Emby cell → Search only (or remove outside tvapprc), drop Emby from pinned streamers, subtitle-control panel and `embyPlaying`, `subtitleMismatch`, `handleTvClick` viewshow, `getSeriesMapFromEmby` → `getSeriesMap`, `inEmby` → `inLibrary`. `keyLabels.js` in sync with client.
- web client: delete `emby.js` Emby REST (auth, sessions, `startStop`, direct UserData writes, images); list/map/info/tor/App/tvpane/actors/usb/shows/qbt/browse use srvr for everything; tvpane mirrors the phone (Emby button, subtitle control). `urls.js` Emby URLs gone.
- tvpane ↔ Android changes made together (rule). Build-apk for tvapp and phone.

### Phase 5 — down, api, scripts, docs, Emby itself
**Code done 2026-09-25 (awaiting testing).**
- down never called Emby. Its `embyMap` (really every tvdb.db record) is `tvdbMap` now, the other `emby*` names say library, and its skip logs say "not in the library".
- watchdog's stuck alert says "library sweep".
- Web client: "Not In Emby" is "Not In Library" in the info and map panes. The tor pane's modal says "Loading show into the library", the usb pane's alert says "Show not in the library", and the tvdb-mismatch modal no longer says Emby. The dead "Removing show from emby" modal is gone.
- Deleted: the scripts that read `tvdb.json` or Emby, `emby-skip-intro.user.js` with its `/api/introDur` route, `emby-data-sample.json`, and `sel` (its `/tv/selectshow` went in Phase 4).
- **Kept:** `apps/down/run`'s and `createShowFolder`'s `chown emby`, and `createShowFolder`'s `tvshow.nfo`, because Emby the app still scans and deletes in those folders. `scripts/kfchk.sh` is an ffprobe check of a file, kept as a tool. api `search.js`'s `noemby` mode string goes with the final cutover's `noemby` renames.
- `docs/` was emptied, and CLAUDE.md / copilot-instructions.md were updated with the final cutover.

Originally planned as:
- `apps/down/src/main.js` (89 refs), `apps/down/run`, `apps/api/src/search.js`, `qbt-stats.js`, `watchdog.js`: remove Emby refresh/lookups, `inEmby` → `inLibrary`.
- `packages/share`: `getEmbyId` gone, episodeData layout doc updated, `showFilterSort.js`.
- Delete obsolete Emby scripts (`scripts/migrate-deleted-to-inemby.js`, `populate-playback-positions.js`, `scan-playback-positions.js`, `emby-skip-intro.user.js`, `scripts/kfchk.sh` Emby parts, `flatten-tvdb-records.js` if obsolete).
- Docs: `docs/emby-epi-choice.md`, `tv-interface.md`, `tv-videostream-contract.md`, `tvapp-summary.md`, etc.
- `CLAUDE.md` / `copilot-instructions.md`: the `noemby-`/`show.inEmby` rule, Emby notes, architecture summary — needs your OK to edit.
- Emby stays installed and running as a standalone app; it is not stopped or uninstalled.
- Final check: `grep -ri emby` over the repo returns only the Emby entry in the streaming apps lists (`services.json`), `bravia.js`'s `emby` command, and history.

### Final cutover
**Done 2026-09-25.** tv-srvr and tv-down were stopped, `tvdb.db` and `custom-settings.json` backed up on hahnca.com as `*.pre-kill-emby-20260925-182343.bak`, a one-off script rewrote the data, then everything was deployed with `./srvr` and tvapp installed.
- **Data:** `inEmby` → `inLibrary`, `leftEmby` → `leftLibrary`, `played`/`playCount` dropped (also in `DEAD_TVDB_FIELDS`). `id` = `tvdbId` on every record; the three without one (Landman, Spy, Zach Stone Is Gonna Be Famous: empty stubs outside the library) use their name. The saved Custom settings' `hasemby` is `haslibrary`.
- **episodeData** is `[aired, watched, file, res, pos]`: the Emby id and the retired bif slot are gone, and `pos` is ms (5 positions converted). `getEmbyId` and the series map's `id` are gone; now-playing sends `positionMs`/`runtimeMs`.
- **Routes:** `getSeriesMapFromEmby` → `getSeriesMap`, `addNoEmby`/`delNoEmby` → `addShowRecord`/`delShowRecord`, `searchActorsInNonEmby` → `searchActorsOutsideLibrary`, `getAllTvdb?hasEmby` → `?hasLibrary`; `getNoEmbys` deleted. api's `noemby` mode is `notinlibrary`. `addGap`/`delGap` match `record.id` (they matched `emby.id`, which no record had).
- **Web client:** `emby.js` → `showData.js`; `noemby-preview-` ids → `preview-`; the `hasemby` filter is `haslibrary`; the map's position readout is ms.
- **Left on purpose:** mentions of Emby the app — the streaming list, `bravia.js`'s input, `chown emby` and `tvshow.nfo` on show folders, oldFiles.js sparing Emby's metadata files, comments about Emby transcodes and its player, `scripts/kfchk.sh`, and unilog's `reseed.js` file list (unilog's own plumbing).

## Hazards and details from the inventory (handle in the phase named)
- **Files get wiped (phase 2/3):** `disk.js:590` `if (!rec.inEmby) epd.stripToAiredWatched(ed)` strips file/res/pos from every non-Emby show, and ghost pruning (`disk.js:598`) depends on `embyOk`. These must switch to `inLibrary` in the same deploy as the migration, or every show loses its files.
- **Gap check (phase 3):** `getShowState`/`gapCheckOne`/`gapCheckBatch`/`currentGapSig`/`ignoreStrayKey` in `srvr/src/emby.js` are pure episodeData logic — move to `gaps.js`, don't delete. `skipMissingFileGap = !inEmby`; `gapCheckOne` and `updateTvdbWithGapData` (tvdb.js ~3755) need a truthy `rec.id`.
- **`setTvdbFields` (phase 3):** any key starting with `emby` goes into a `tvdb.emby` sub-object (tvdb.js ~3450). Remove it.
- **`pos` units:** slot 6 is Emby ticks (100 ns). Convert to ms in the migration and have the player report ms.
- **down (phase 5):** never calls Emby, but `inEmby` (read from tvdb.db, `loadEmbyMapFromDb`) is its download whitelist in 5 places and `rec.path` is the destination folder. Rename in the same deploy as the srvr rename. `apps/down/run:46` and `fileOps.js` `createShowFolder` run `chown emby`, and `createShowFolder` writes a `tvshow.nfo` → drop both.
- **Other srvr gates on `inEmby`:** `subsQueue.js` (srt download), `flexget.js` (history), `recode.js` `isPlayingNow` (Emby sessions → ask srvr's own now-playing from phase 1), `oldFiles.js` (`.bif` rule and Emby meta-file protection → delete), `localHistory.js` labels, `watchdog.js` sweep-stuck alert text.
- **intro.js** is all Emby session seeks (`doSkipIntro`/`doTrimIntro`); the intro data itself is already `rec.seasonIntros`. The player does it in phase 1; delete intro.js's Emby code in phase 3.
- **Web client, direct Emby calls from the browser (phase 4):** `emby.init` login, `deleteShowFromEmby`, `editEpisode` (watched toggle), `getEpisodeCounts`, `getSeriesMap`, `afterLastWatched` (runs on every show select), collection `saveToTry/Continue/Mark/Linda`, `getTvdbIdFromEmbyItem`, `startStop` (unreachable). Server-driven Emby UI: "Scan Lib" / "Open Lib" (hdrtop.vue), library refresh progress (App.vue), "Not In Emby" + "Load" (info.vue, map.vue), `createShowFolderAndRefreshEmby`, tor.vue `ensureInEmby` + "Loading show into Emby" modal, usb.vue "Show not in emby", map "Emby" button (`embyPageUrl`), tvdb-mismatch modal. The client uses no Emby images — only tvapp's `Backdrops.java` does. Dead code to drop outright: `_oldLoadAllShows`, `syncCollections`, `refreshLib`, `taskStatus`, `createNoemby`/`deleteNoemby`, unused srvr.js wrappers.
- **Web add flow (phase 3/4):** today "add show" = create folder → Emby scan → sweep links the record. New flow: `createShowFolder` sets `path` + `inLibrary=true` directly; no waiting.
- **Scripts (phase 5):** `migrate-deleted-to-inemby.js`, `flatten-tvdb-records.js`, `populate-playback-positions.js`, `migrate-introdur-to-trimskip.js`, `find-asr-only-for-processing.js`, `asr-only-histogram.js` all read the obsolete `tvdb.json` — delete.

## Decisions (my recommendation first)
1. `inEmby` → `inLibrary` (rename everywhere) — vs keeping the old name. Rename, done in the phase 2 migration.
2. `id` = `tvdbId` — vs keying by `name` (the DB key). tvdbId: stable across renames, already on 1609/1612 records.
3. Back at tvapp's top level → do nothing (tvapp is home) — vs Android launcher home.
4. Watched threshold: at end or at 90% of duration.
5. Remote play on other devices (chromecast/roku/lindaTab) is dropped — say if any of those still matters.
