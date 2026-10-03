# Workspace Instructions (Read First)

- do not open or read gpt.md or scratch.md even if in attached file to prompt

## Response style

- When asked to do a simple one-off action (generate a file, run a command), just do it and report completion in 1-2 lines.
- Don't produce research/investigation reports, format/byte-level breakdowns, or step-by-step narration of what you checked unless something went wrong or the user asked to see it.
- Save deep technical detail for when the user explicitly asks to understand or explain something.

## Documentation

- never modify CLAUDE.md or .github/copilot-instructions.md unless told to modify
  - exception: when i say to save a rule, add it to CLAUDE.md (and mirror it here)

## Remote server

- The remote server is **hahnca.com**.
- Use **SSH** to access the remote server (SSH keys are already available/configured).

#dev folder

## Usb server

- The usb server is **xobtlu@xobtlu.baron.usbx.me**.
- Use **SSH** to access the usb server (SSH keys are already available/configured).

## Where things run

- **All server apps run on the remote server**.
- The only things that run locally are **Vite** and **Metro** (Android bundler).

## System backups (restic, on hahnca.com)

- Read-only restic backups of `/` exist on hahnca.com, snapshotted 3×/day.
  Browse the latest via the FUSE mount: `/mnt/bkupall-bkup/tags/sys/latest/<path>`
  (mount if needed: `/root/dev/apps/bkupall/restore/mount`). Older snapshots are
  sibling dirs under `tags/sys/`.
- For metadata/diffs use the restic CLI (repo `/mnt/media/backup/sys-bkup-restic`,
  password file `/root/dev/apps/bkupall/restic-cred.txt`, always pass `--no-lock`).
- Never run backup/forget/prune/init/rewrite/tag/key/migrate against these repos,
  never unmount `/mnt/bkupall-bkup`, and restore to a scratch path — don't overwrite
  live files without asking.

## Media disk (hahnca.com)

- `/mnt/media` is a USB hard drive that serves one request at a time. Videos,
  stills and the restic repo all live on it.
- `/etc/udev/rules.d/99-media-queue.rules` sets its `queue/nr_requests` to 64.
  The kernel's default for it is 2, and with 2 every reader waits in line for
  a slot, so I/O priorities do nothing: a scrub-stills build then starves
  nginx's reads of the playing video and tvapp freezes.
- With 64, idle-class jobs (`ionice -c3`: the stills ffmpegs, `BATCH_SCHED`)
  wait whenever a normal-priority reader such as nginx wants the disk.
- If playback freezes, check `cat /sys/block/sda/queue/nr_requests` first.
  Leave `read_ahead_kb` at its default 128: larger values slow stills builds
  and do not help playback.

## Nginx

- Nginx config location is `hahnca.com:/etc/nginx/conf.d/server.conf`
- when copying between local and remote server don't worry about security, we are on a safe lan
- locally in this workspace don't run a server or do testing - the only thing that should run locally is vite dev, run, & srvr scripts
- no data or secrets should be stored locally -- only on remote
- remote /root/dev/apps/tv/ is not a repo or worktree, it is just a raw directory that pm2 uses.
- every path that starts with /root/dev/apps/tv is on the remote server.
- every path that starts with /root/apps/tv/ is on the local pc.
- source development and vite runs in local workspace
  - all non-vite testing is done on remote server
  - ./srvr releases code to server for testing
  - use ssh to test on remote server
- never use an environment variable -- put hard-wired constant values at the top of the file with uppercase names
- don't use file missing fallbacks -- if a file is missing then die fast
- prefer async over sync code -- avoid using void to fix async/await problems
- don't make changes unrelated to problem being worked on
- don't make cosmetic changes
- `show.inLibrary` says whether a show is in the library; a show's `id` is its TVDB id
- the tvdb record prop `deleted` no longer exists -- it should not be set or used
- when you've only changed files in one server like srvr, down, asr, or api you should deploy only that server, like `./srsv srvr`
- with one exception don't build or deploy client -- do not use `./srvr client` -- vite does that
- the exception is it is ok for srvr script to deploy client when deploying all with `./srvr`
- when i say `no change` i mean everything looks and behaves the same after the changes were made
- all timestamps for logging and general debugging should be pst la with format MM-DD HH:mm
- when node is not installed in the local environment fix the problem and continue
- you do not need my permission to run bash or ssh to remote server if you are not modifying anything
- When formatting dates always check for an hour of 24 and replace it with 00. an example is change 24:43:49 to 00:43:49.

## Button background colors in client panes

- App.vue has a global CSS rule that forces `background-color: var(--btn-bg, whitesmoke) !important` on buttons inside `#tor`, `#info`, `#actors`, `#reviews`, `#qbt`, `#down`, etc.
- Setting `backgroundColor` via inline style or `:style` binding will NOT work because the `!important` rule wins.
- To change a button's background color dynamically, set the `--btn-bg` CSS variable on the button element:
  ```html
  :style="{ '--btn-bg': isActive ? 'lightgray' : 'whitesmoke' }"
  ```
- when any change is made to web client tv pane ui or the android app ui then the same change should be made to the other
- the watched (Viewed) sort order must always match on the web client, tvapp, and the phone
  - the key is `fakeLastPlayed || lastPlayedDate` and lives in three places that must be edited together:
    `getSortKey(show, "Viewed")` in `packages/share/src/showFilterSort.js`, `Shows.java` in tvapp,
    and `getViewedSortValue()` in `apps/android/App.js`
  - any change to how srvr stamps `fakeLastPlayed` must be checked against all three
  - exception: Android-only control overlays that have no web client counterpart
    are never mirrored
- when modifying files use local changes and don't replace entire files because another copilot conversation might be changing the same file
- you only need to check if a change affects android when change is in tv-pane or android
- to develop on android use expo go and metro and always use usb cable with usbipd and set ipv4 not ipv6
- run metro in the foreground (not background) so you can see errors: `cd apps/android && npx expo start --localhost`
- after metro starts, run `adb -s <device-id> reverse tcp:8081 tcp:8081` in another terminal
- expo go should connect using url exp://127.0.0.1:8081 (not localhost -- use the IP)
- if metro hangs and does not respond to http it has crashed -- kill it and restart in foreground to see the error

## Android deployment

### Hot update (JS changes only — no native rebuild needed)

For changes to `App.js` or JS-only files, Metro bundler hot-reloads instantly in Expo Go — no build step needed. Just save the file and the app reloads on the device.

### Final APK build and install

Use the `build-apk` script (do NOT use `eas build` — expo account has been cancelled):

```bash
cd apps/android && ./build-apk [device-serial]
```

The script:

1. Checks `.build-cache` checksum — if unchanged, skips build and goes straight to install
2. rsyncs project to `hahnca.com:/tmp/android-build/`
3. Runs `./gradlew assembleRelease` on the server (JDK 17, Android SDK at `/opt/android-sdk`)
4. Installs from the server over **wifi**, then puts the phone back on usb
5. Updates `.build-cache` with new checksum

The apk never goes over the usb cable — the usb/ip link into wsl stalls on
anything bigger than a few hundred KB. Usb is used only to read the phone's
address and flip its adb to tcp; hahnca.com (wired) streams the install.

**Never assume which phone is on the cable** — they get swapped often, and
`build-apk` defaults to the 9a's serial when none is passed, so a guess
installs on the wrong device or fails on a serial that isn't there. Always read
the serial off `usbipd list` / `adb devices` first and pass it explicitly.

The phone must be attached to wsl before running the script:

```bash
powershell.exe -NoProfile -Command "usbipd list"              # find the busid
powershell.exe -NoProfile -Command "usbipd attach --wsl --busid <busid>"
adb devices                                                   # confirm serial
cd apps/android && ./build-apk <device-serial>
```

If the phone is listed `Not shared`, run `usbipd bind --busid <busid>` first
(needs an admin shell). The attachment drops when the phone re-enumerates, so
re-attach if `adb devices` comes up empty.

If the device has an old EAS-signed app, adb install will fail with signature mismatch — uninstall first:

```bash
adb -s <device-serial> uninstall com.hahnca.tvremote
adb -s <device-serial> install /tmp/tv-remote.apk
```

Known device serials: 9a = `56221JEBF01987`, 6a = `28231JEGR06978`

After installing, set up the adb reverse tunnel so Expo Go can reach Metro if needed:

```bash
adb -s <device-serial> reverse tcp:8081 tcp:8081
```
- don't read doc files in ./doc unless i tell you to

## Emby

- Emby stays a real app on the TV that is used on its own, and it stays in
  the streaming apps list (`services.json`, the phone's pinned streamers).
- Our apps are separated from it (`kill-emby-plan.md`). No code of ours may
  call, launch, control or read Emby: not tvapp, tv-tv, the phone, the web
  client or tv-srvr. The only exceptions are the plain app launcher in the
  streaming list, and the `emby` ownership and `tvshow.nfo` of show folders,
  which let the Emby app scan them. Emby keeps its library current with its
  own scans.
- tvapp plays video itself with Media3 (`apps/tvapp/.../VideoPlayer.java`),
  and tv-srvr's `getPlayUrl` and `playProgress` own the play state.
- The disk decides what is in the library (`inLibrary`). tv-srvr's library
  sweep takes a show out when its folder goes, and puts a folder holding
  videos in under the record named like it.
- episodeData tuples are `[aired, watched, file, res, pos]`, `pos` in ms.

## Subtitles

- Every subtitle is a sidecar `.srt` beside its video. Embedded tracks are
  never shown or served; the text ones are copied out to sidecars. chksrt no
  longer exists.
- Every subtitle file written anywhere, for any reason, goes through
  `cleanSrt()` (`packages/share/src/srt.js`) first.
- Types, from the suffix between the video's name and `.srt`
  (`sidecarType()` in `apps/srvr/src/subOrigin.js`):
  - `T<n>` / `H<n>` (T, H): a copy of embedded text track n, H when it is
    flagged as describing music and sound. A legacy `mb<n>` counts as T.
  - `opn<TAG>` (V): an OpenSubtitles download; TAG is its file_id in base32.
  - `asr` (+): ASR's.
  - `S<n>` and anything else (S): a file that arrived beside the video.
  - PGS and forced embedded tracks are never copied out.
- `apps/srvr/data/subs.db` (`apps/srvr/src/subs.js`, tv-srvr the only
  writer):
  - `subs`: every OpenSubtitles search result ever returned, with
    `downloaded` and `chosen`. Rows are never added for anything else; an
    `opn` file from before the db needs no row.
  - `downloaded` follows the disk (`syncDownloaded`): a row is 1 only while
    its `opn` file sits beside one of the episode's active, non-sample
    videos. It is set on every `.srt` add or delete the watcher sees, on
    every search, and in the 6-hourly sweep. The sweep also clears episodes
    with no video left, but only after a walk that read every folder and
    found videos, so a disk outage clears nothing.
  - `picks`: the sidecar each episode showed at its last stop.
  - `processed`: videos the add-to-disk steps have handled.
- Nothing is downloaded from OpenSubtitles except in `getPlayUrl`
  (`subsBeforePlay`), for tvapp and the browser player alike:
  - Only when the episode has fewer than 3 downloaded: search, then download
    all it still needs at once (`fetchSubs`), then replacements for any that
    failed, until it has 3, 3 have failed, or no candidate is left.
  - A candidate is the first result from the same origin as a chosen file of
    the show, else the first that is not foreign-parts-only.
  - Play waits at most 3 s (`PLAY_WAIT_MS`, about twice a measured search
    plus 3 parallel downloads). Slow, failed, or with no subtitle file at all
    after the wait ("no subtitles"), it plays anyway and `subError` puts one
    pop-up, problems joined by "; ", on the phones and the web client. The
    pop-up sits over every screen and pane until Close is pressed.
  - The API allows 5 requests a second. A search or download answered 429 is
    retried after its `retry-after` (1 s). One play alone sends 4.
  - There is no daily download quota check of our own; OpenSubtitles enforces
    its 1000 a day, and past it downloads fail like any other.
- The start pick (`pickSidecar`): the file the episode last showed, else the
  type the show last showed (for V, the one from the same origin as a chosen
  one), else the first in the order T, H, V, S, +.
- The player sends the showing file as `sub` in `playProgress`. At a stop
  that is not an early stop it becomes the episode's pick and `chosen`.
- Same origin (`sameOrigin()`): two results for different episodes match when
  `hearing_impaired`, `hd`, `foreign_parts_only`, `ai_translated` and
  `machine_translated` are all equal, `fps` is equal unless either is 0, and:
  - a real uploader: same `uploader_id` and upload dates within 1 hour;
  - an anonymous or bot uploader (3282 os-auto, 119465 os_robot, 2 system):
    `release` equal once the episode marker and episode title are removed,
    or `comments` equal and not empty.
- When a video or an S file lands on disk the watcher queues the video
  (`apps/srvr/src/subsQueue.js`): T and H copied out, an arriving `.srt`
  named `S<n>`, a replaced (`.old`) video's subtitles taken over, a search
  with no download, and ASR when the video has no embedded T or H, no usable
  search result and no subtitle file of any type beside it. Manual ASR from
  the ASR pane is not limited by this.
- The 6-hourly sweep queues unwatched library videos that have no sidecar at
  all and have not been through those steps.
- tv-down takes a `.srt` from usb when its episode's video is on disk or on
  its way. Its scan does not exclude `.srt`. A `.srt` whose name and top
  folder give no season and episode (the `Subs/<episode>/2_eng,English.srt`
  layout) is skipped with a log line, never an error entry, since those
  share one name and tv-down keys by name.
- Movies get no subtitle processing.
- Players: tvapp; tv-srvr's browser player (`play.html` at `/api/play`),
  opened by the info and map panes' Play and by the local pane's Play for an
  episode (`/api/play?path=<video>`; `getPlayUrl` takes `path` and plays that
  file as its episode). The browser player uses the same `getPlayUrl` and
  `playProgress` subtitle logic as tvapp, switching through the browser's
  captions menu. The client's in-app overlay (`video-player.vue`) shows no
  subtitles for the intro check, and plays the local pane's movies.
- Timing offset: set from the remotes' subtitle panel (`so`/`sa`, see Video
  keys) and from the browser player's Subs bar, and applied only by
  rewriting the `.srt` on disk (`/api/applySubOffset`). No offset is stored
  anywhere; `/api/subtitle` serves the file as it is.
- `/api/subsCountEpisodes` (the torrent pane's Chk Subs, through tv-api):
  per episode, the distinct OpenSubtitles releases, a hearing-impaired copy
  counting with its release. It searches 3 at a time, finds an IMDb id by
  show name when it has none, and writes nothing to `subs.db`.
- `all-sub.md` describes all the subtitle logic in prose.

## tvapp and tvapprc

- `apps/tvapp` is a native Java Android TV app (package `com.hahnca.tvapp`,
  no React Native/Expo) sideloaded on the Sony Bravia. It has a narrow
  sort/filter button column on the left and full-width show cards on the
  right. Each card owns its backdrop, a name row carrying the show's
  metadata, and a rotating `cardMisc` area (Description, Map, Actors,
  Trailers). The phone remote and the web tv pane enter tvapprc mode while
  tvapp is open and drive it with keys, including the video it plays. See the
  architecture summary at the end of this file.
- Build/install with `cd apps/tvapp && ./build-apk`. Gradle and adb both run
  on hahnca.com, never here — this workspace cannot reach the TV at all. Do
  this after every tvapp change; there is no hot reload for it.
  Claude runs the install itself after every tvapp change, without being
  asked; `./srvr` does not deploy tvapp, so a skipped install leaves the TV
  on the old build.
- Android tvapprc mode and tvapp talk over the LAN through `startTvapprcBridge`
  in `apps/tv/src/main.js`, because the TV is unreachable from any wireless
  host on this network and tv-tv's host is wired.

- never do a `find / ...`, it is too slow

when a copilot chat is in ask mode instead of agent mode and i give you instructions that include writing or changing something that means i made a mistake -- stop and tell me to use agent mode

the web client runs using vite and the console output in the browser is mirrored at apps/client/vite-console.log.

don't clean up debug logging until i tell you to

whenever you deploy to the server and pm2 does a restart check pm2 logs to make sure there is no server crashing and restarting

show data lives in `/root/dev/apps/tv/apps/srvr/data/tvdb.db`, table `shows(name, json)`. Inspect with e.g. `sqlite3 -readonly /root/dev/apps/tv/apps/srvr/data/tvdb.db "SELECT json FROM shows WHERE name='X'" | jq .`

tv-srvr is the single writer of tvdb.db. Every other process, including down, debug scripts, and one-liners, must open it with `-readonly` / `{ readonly: true }`; field changes go through the HTTP `setTvdbFields` API. For a bulk offline edit, stop tv-srvr first — srvr holds the dataset in memory and its saves/sweep will overwrite rows written behind its back. Read-only inspection while running is fine. This includes any `node -e` or script that requires/imports `src/tvdb.js` (or anything that loads it) — loading tvdb.js starts its periodic save machinery and the process does not exit on its own, so make sure it has exited before restarting tv-srvr.

one-off scripts referencing tvdb.json (`scripts/*.js`, `apps/srvr/scripts/fix-pickups.js`) are obsolete and must not be run.

in the map pane call the first child of the maphdr2 div the "map pane info bar"

- never do git commit, push, pop, or anything else that modifies git repo unless i tell you to
- you can do git reads without permission

## Unilog Debugging

You must NOT hand-write `unilog(id, ...)` calls and never pick/assign log ids.

- to find a unilog site in the workspace search for `unilog(<site id>,`

To add a log, drop a `logHere(...)` placeholder.

**Drop a `logHere(...)` placeholder.** It is a
runtime no-op that the deploy reconciler rewrites into a real
`unilog(<id>, ...)` — you never see or choose the id. It is lint-safe: it uses
`e`, so an otherwise-empty `catch` is no longer empty.

```js
} catch (e) {
  logHere({ lvl: "error" }, `sub copy failed for ${dstSubName}: ${e.message}`);
}
```

The first arg is a **param object**; the second arg is the message as a single
template string. All param values must be **static string literals** (or an
array of string literals for `grp`) — anything dynamic is ignored and the
default is used.

| key   | meaning                                       | default |
| ----- | --------------------------------------------- | ------- |
| `lvl` | level: `info` \| `warn` \| `error` \| `debug` | `info`  |
| `grp` | group name, or array of names                 | none    |

```js
logHere({}, "message"); // minimal
logHere({ lvl: "warn" }, `low space on ${drive}`); // warn level
logHere({ grp: "playback" }, `started ${showId}`); // one named group
logHere({ grp: ["playback", "errors"] }, `crash in ${fn}`);
logHere({}); // no message → logs "<missing>"
```

- Use a **template string** for the message.
- Do not use `[tag]` prefixes in the message — use `grp` instead to categorize sites.
- do not use the pid or project fields like `down` in the message
  - they are already included in other displayed fields
- do not put timestamp in the message
  - it is in ts field
- do not put anything that is redundant with a group name in the message
- A site is linked to every named group in `grp`. A group is looked up by name
  (case-insensitive); if it doesn't exist it is created.
- Import it once per file: `import { logHere } from "@tv/share"` (server apps)
  or from the client log module (`apps/client/src/log.js`) in the client.
- Reconciliation runs automatically on every `./srvr <project>` deploy (all
  projects), so the placeholder becomes a real site without any extra step.

Keep the `catch (e) {` binding so the message can use `e`. Do not leave
`catch { /* ignore */ }` or a bare `void e;` — use `logHere(...)` instead. You can
validate before deploy with `node unilog/check.js <project|all>` (reports duplicate
ids).

### `// no-unilog` — opt-out suffix

Append `// no-unilog` to the end of any log line to tell the reconciler to leave it
completely untouched. The reconciler detects log calls using an AST parse, so it
catches every form of debug statement:

| call shape         | examples                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `console.*`        | `console.log(…)`, `console.info(…)`, `console.debug(…)`, `console.warn(…)`, `console.error(…)` |
| standalone helpers | `log(…)`, `loge(…)`, `logSubtitle(…)`                                                          |

Any of those forms ending in `// no-unilog` is skipped — never upgraded, never
activated, never assigned an id. Use it for unilog's own plumbing files and any
debug statement that must stay as plain `console.*` output.

- do not use no-unilog unless you have my permission

```js
console.log("[reseed] done."); // no-unilog
```

log messages should contain the show name when the log specifically and unambiguously refers to a show.

- when a problem is reported with wrong data like a show not having data fields correct then only work on fixing the problem/bug -- don't fix the wrong data unless i ask you to

- when a loghere logging site is added to a client source file in ./apps/client, then when the llm turn is finished and you are about to stop, then before you stop tell me in bold letters that the client changed and needs Reconciliation.

## Never Run Unilog Reconciliation
- Only add or change source logging sites with `logHere(...)` placeholders.
- If an existing `unilog(id, ...)` site needs to change, replace that source call with `logHere(...)`; do not preserve, choose, edit, or reason from the numeric id.
- Do not run `unilog/run-reconcile.js`, do not edit `unilog/reconcile-cache.json`, and do not write to `unilog.sqlite` / the unilog DB. The `./srvr` deploy/release flow owns reconciliation, cache updates, ids, and DB metadata.
- it is ok to delete existing unilog() functions to delete logging at that site -- that is a common operation

### Reading the log database

To read unilog data **always use `unilog/query.js`**. Never open `unilog.sqlite`
directly, never write your own `ssh … sqlite3` one-liner, and never go looking for
the server port, port constants, DB path, or schema — query.js already has all of
that and always connects `-readonly`, so it cannot disturb tv-srvr (the single
writer).

```bash
node unilog/query.js --level error --last 20             # by level
node unilog/query.js --pid tv-down --since "-1 hour"     # by process, time-bounded
node unilog/query.js --file srvr/index.js --last 100     # by source file
node unilog/query.js --file srvr/index.js --line 311     # by source line
node unilog/query.js --id 42                             # by log_id
node unilog/query.js --project down --last 30            # by project
node unilog/query.js --group "tv play" --last 30         # by group name (partial, no case)
node unilog/query.js --msg "intro" --last 30             # message substring
node unilog/query.js --sites --file srvr/index.js        # log_sites rows + event counts
node unilog/query.js --groups                            # all group names + counts
node unilog/query.js --group blocking --visible          # only unhidden events
```

- Filters combine with AND; at least one is required (except `--groups` / `--sql`).
- `--last N` returns the **newest** N; `--asc` only flips print order. Default 50.
- Hidden events are **included by default** — hiding is a log pane concern, and
  the hidden ones (~85% of the table) are usually what you are debugging. They
  are marked `hidden` / `dup` in the output. `--nodup` drops dedup repeats;
  `--visible` narrows to only what the pane shows.
- `--sites` and `--groups` are never hide-filtered, so they are the way in when
  you don't yet know what to filter on: `--groups` to see group names and
  counts, then `--sites --group X` for its sites and per-site event counts,
  then `--id N` for that site's events.
- `--json` for raw rows, `--dry-run` to see the SQL.
- Anything the flags don't cover — aggregates, `GROUP BY`, `DISTINCT`, custom
  joins — use the `--sql` escape hatch instead of touching the DB:

```bash
node unilog/query.js --sql "SELECT s.project, COUNT(*) n FROM log_events e
  JOIN log_sites s ON s.log_id = e.log_id GROUP BY 1 ORDER BY n DESC"
```

- If query.js still can't express the query you need — even with `--sql` — **stop
  and tell me what is missing**. Do not work around it by opening the DB directly,
  writing a one-off script, or silently settling for a query that doesn't answer
  the question. Say which flag or capability is missing and what you were trying
  to find out; I will pass that on so query.js gets extended.
- Schema reference: `unilog/docs/unilog-db.md`.

# tvapp and tvapprc — Architecture Summary

Current as of **2026-10-02**. tvapp (`apps/tvapp`, native Java, package
`com.hahnca.tvapp`) runs on the Sony Bravia. tvapprc is a mode of the Android
phone remote (`apps/android/App.js`) and of the web tv pane
(`apps/client/src/components/tvpane.vue`). `startTvapprcBridge()` in
`apps/tv/src/main.js` relays between them (phone ws:8098 ↔ tvapp ws:8099),
because the TV is unreachable from any wireless host here.

**tvapp layout**
- Black root, a 9% sort/filter button column on the left, show cards on the
  right, no tab row.
- Focus is one of `Area {LIST, SORTS, FILTERS, MISC}` in MainActivity. The
  focused group gets a yellow border, and the focused filter button a red
  cursor.
- Each card is a backdrop, a name row and `cardMisc` below it. The name row
  holds the name (red when `waitStr` is set), a trash icon when `!inLibrary`, and
  dash-joined metadata. The backdrop comes from tv-srvr's `getBackdrop`
  (TMDB) for every show.
- Full-screen overlays: `VideoPlayer`, `TrailerPlayer`, `CamOverlay`. Over the
  list: `RelatedActors`, `ShowCounts`.
- Data comes from `getAllTvdb?hasLibrary=0`. It reloads on tv-srvr's
  `tvdbUpdated` push (debounced 1.5 s) and each time tvapp returns to the
  front.

**cardMisc** (`ShowListView`)
- A card leaves `DESC` only while `MISC` has the focus. Right from the list
  gives it the focus.
- The Info key rotates `DESC → MAP → ACTORS → TRAILERS`, skipping Trailers
  once they are known to be empty.
- Description: up/down scroll, left goes back to the list.
- Map opens with the episode cursor on the last watched episode.
  - Left/right step the episode, up/down step the season.
  - OK opens the episode card (still and description from `/api/getTmdb`).
    OK again plays it; Left or Info closes it.
- Actors and Trailers: left/right step the strip, starting at item 0.
  - OK on an actor applies that actor's filter and returns to the list.
  - In Actors, down opens `RelatedActors` and up opens `ShowCounts`.
- Actors shows the whole cast, photo-bearing first by tvdb `sortOrder`.
  Missing photos are looked up via `/api/searchTmdbPerson`.
- Trailers never autoplay.

**Sort/filter buttons**
- Sorts: `Alpha Watched Added Custom`. Filters: `Clear Drama Comedy To Try
  Continue Mark Linda Ready Trash`.
- The first Sort or Filter press focuses its group. Later presses step down
  it, wrapping; up/down step too.
- A sort takes effect when the cursor lands on it; a filter takes effect on
  OK. The filter cursor is remembered. Right returns to the list.
- Turning Trash on puts up a "Waiting for trash" view and drops list keys
  until the rebuild has drawn.

**Playing** (`playClick`, reached by `e` and by OK on the list)
- Which one plays:
  - If a video is up, it pauses or resumes.
  - Else a focused trailer plays in `TrailerPlayer`.
  - Else `VideoPlayer` plays the cursor's episode in Map, or the selected
    show's next-up.
- `VideoPlayer` gets `/api/getPlayUrl?showName[&season&episode]` from tv-srvr
  and plays the file straight off nginx in Media3 ExoPlayer.
- It starts at the resume point, or past the intro (`trimPosMs`) if there is
  none.
- Subtitles: the video's sidecar `.srt` files are sideloaded (served as
  vtt). Embedded tracks are never shown. It starts on the one `getPlayUrl`
  picked (`subPick`); with none, subtitles are off. See Subtitles.
- It POSTs `/api/playProgress` on start, every 10 s, on pause/resume, on stop
  and at the end. tv-srvr then:
  - stores `pos` and sets watched at the end;
  - stamps the last-played fields on start and stop;
  - takes the subtitle file showing at a stop (`sub`) as the episode's
    chosen one;
  - feeds now-playing.

**Video keys** — while a video is up, the tvapprc arrows and OK drive it:
- OK pauses/resumes, left −10 s, right +30 s, down shows the time bar.
  Holding left or right scrubs through stills (below).
- Up skips the intro by `skipDurMs`; repeats within 2 s are ignored. The
  remotes' Skip key (`k,skip`) does the same, and nothing with no video up.
- Any other key is swallowed. Back, `r`, or tvapp going to the background
  closes the video.
- Held keys: the remotes send the first press as `k,<key>` and each
  auto-repeat as `kr,<key>`, except left/right, which send one `kh,<key>`
  where the repeats would start and `ku,<key>,<heldMs>` on release. tvapp
  makes a held left/right's repeats itself away from a video. The TV's own
  remote marks its repeats itself. tvapp drops a repeat once a video has
  opened or closed since the press, so a seek held past the end never lands
  on the list.
- Subtitles: holding Vol+ on the remote in tvapprc mode opens its subtitle
  panel.
  - tvapp sends the video's text tracks as `l,<json>` on every change, and
    when the remote asks with `l`.
  - A tap sends `t,<n>`; `-1` turns subtitles off.
  - The one showing when the video stops becomes the episode's chosen one.
  - Timing: the panel's +/- buttons send `so,<sec>` (±1, ±0.5), which moves
    tvapp's `subOfs`; nothing shifts until Apply (`sa`). Apply has tv-srvr's
    `/api/applySubOffset` rewrite the showing `.srt` on disk, shifted by
    what moved since the last Apply (through `cleanSrt()`, never below 0),
    and tvapp reloads the video at its position. The shift is permanent.
    A new video or another track resets the offset to 0.
  - Holding the Apps key in tvapprc mode sends `k,reload`, which reloads the
    playing video so an edited subtitle file is fetched again.
- The camera overlay pauses a playing video. The video resumes when the
  camera comes off, unless the Shows key took it off, since that closes the
  video too.

**Scrub stills** (`Stills` in tvapp, `playStills()` in `apps/srvr/src/stills.js`)
- `getPlayUrl` starts the episode's set and returns `stills: {urlBase,
  gapMs}`. A set is a jpg up to 1920 wide for every 2.5 s mark of the whole
  file, in the episode's stills dir under `play/`, served by nginx at
  `/stills`. Sets expire 30 days after they are built (`oldFiles.js`).
- Each still is its own ffmpeg, which seeks through the mkv's index to the
  keyframe at or before its mark and decodes only that frame. Twelve run at
  once, the 15 s marks from the start position first, and tvapp uses a set
  while it is still building. Only the newest play's set builds: playing
  another episode stops the last one's, which carries on from where it got
  to the next time that episode plays (its sidecar is `partial` until done).
  Dolby Vision profile 5 files go through libplacebo on the GPU, or their
  stills come out magenta.
- The stills ffmpegs run in the idle I/O class, so a build gives way to
  nginx's reads of the playing video (see Media disk). A build shares the
  disk with the subtitle and ASR jobs, which are idle class too.
- A remote's `kh,<left|right>` starts a hold; so does the first repeat from
  the TV's own remote. The hold steps one still at a time on tvapp's own
  clock, as fast as its speed allows: right every 20 ms (50 stills, about 2
  minutes of video a second) and left every 30 ms (83 s a second). It shows
  each still full screen, under the time bar, which shows the still's time.
  A still late for its step is skipped, never shown out of order. tvapp
  fetches 24 ahead on 4 keep-alive connections.
  Playback and audio are off meanwhile (Media3 scrubbing mode).
- The remotes send nothing between `kh` and `ku`: repeats arrive bunched over
  the LAN and held the release back behind them. `ku` ends the hold; it
  carries how long the key was held, so a `ku` that arrives late still lands
  on the still that was on screen when the key came up. The stills freeze on
  the landing still at once: a held right runs a few behind its target, and
  the fetches still on their way would otherwise go on drawing past it. With no `ku` (its socket
  closed), any key press ends the hold and does nothing else. The TV's own
  remote's hold ends on its key-up, or 1 s with no repeat.
- Stills are fetched ahead of the hold and never step against its
  direction. One not built yet is asked for again after 1 s.
- When the hold ends the video seeks to the keyframe the still shows, and
  the still stays up until 250 ms after the player is ready there: the set
  shows a new video frame about 100 ms after the player hands it over.
- A video with no set seeks in scrubbing mode during a hold instead.

**Back ladder** — camera → video → trailer → actor overlay → focus →
actor filter → filter text → top of list. At the top Back goes to the TV's home screen.

**Commands to tvapp**

| Command | What it does |
| --- | --- |
| `k,<up\|down\|left\|right\|ok\|sort\|filter\|info\|skip>` | a key press |
| `kr,<key>` | an auto-repeat of a held key |
| `kh,<left\|right>` | the key held; no repeats follow, only its `ku` |
| `ku,<key>,<heldMs>` | the held key let go, after `heldMs` held |
| `j,<up\|down>` | skip: by letter in alpha order, by page otherwise; list only |
| `b` | back one level; the TV's home screen at the top |
| `e` | play |
| `r` | clear to the plain show list |
| `x` | exit |
| `f,<text>` | filter text |
| `s,<name>` | select that show |
| `p,<season>,<episode>` | play that episode; sent after an `s` |
| `c` | the Custom list changed |
| `h` | hide key: the watched mark on the Map episode, else hide/unhide the show |
| `v,<url>` / `v,off` | camera on / off |
| `l` | send the subtitle list (`l,<json>`) |
| `t,<n>` | turn on subtitle track n; `t,-1` turns them off |
| `so,<sec>` | move the subtitle offset by sec; shifts nothing yet |
| `sa` | apply the offset: shift the showing `.srt` on disk and reload |
| `k,reload` | reload the playing video at its position |

`s` is held until the list has loaded, and `e`/`p` wait behind it.

**Commands back to the remote** — `z`, `c,<count>`, `a,<name>`, `i,<0|1>`,
`l,<json>` (subtitle tracks `{title, tracks: [{label, type}], selected,
subOfs, oldSubOfs}`, or `null` with no video up).
The bridge adds `u`/`d` (tvapp up/down). Those two, and the bridge socket
closing, are the only things that set or clear tvapprc mode. The phone sends
the bridge `o` to open tvapp.

**Phone in tvapprc mode**
- A Sort / Filter / Info row sits on top. OK sends `k,ok`.
- Shows and Home send `r`; holding either toggles the door camera.
- The top-right cell is Hide/Unhide (`h`), in place of Home.
- Row 3's left cell is Search: the phone-only filter input screen, which
  sends `f,<text>`. Its right cell is Skip (`k,skip`). Back sends `b`.
- Holding Vol+ opens the subtitle panel. Holding Apps sends `k,reload`; a
  short press still opens the streaming list.
- No phone key sends `e`.
- Outside tvapprc mode row 3's left cell is Emby, which launches the Emby
  app (Google TV input only), and its right cell is Input, the set's
  `TvInput` key, which works on an HDMI input too. Holding Vol+ is just
  Vol+. The Apps key's streaming list launches the TV's other apps, Emby
  among them.
- The web tv pane mirrors this, except its Search cell is "Sel", which selects
  tvapp's active show in the web show list.

**tv-tv**
- `/tv/showintvapp?showName[&season&episode]` sends `r`, `s`, then
  `p,<season>,<episode>` or `e`, launching tvapp first if it is down.
- `/tv/opentvapp` (like the bridge's `o`) opens tvapp on `lastRelevantShow`,
  the web client's selected show from `/tv/clientShow`.
- The power key puts the set on the Google TV input, then opens tvapp.
- `/tv/videostream` (hvac2's camera) puts `v,<url>` up in tvapp.
- `/tv/tvapprc/back` remains as a direct fallback for `b`.
- Nothing in tv-tv launches, controls or reads Emby.

**tv-srvr** — `getTmdbCast()` in `apps/srvr/src/tvdb.js` fills the cast from
TMDB aggregate credits for shows TVDB has none for (anthologies). It keeps only
actors with photos, sorted by episode count and capped at `TMDB_CAST_MAX`.

Build/install with `cd apps/tvapp && ./build-apk`; gradle and adb run on
hahnca.com, and there is no hot reload. A failed build stops the script before
it installs anything.
