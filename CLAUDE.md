# Workspace Instructions (Read First)

## Response style

- When asked to do a simple one-off action (generate a file, run a command), just do it and report completion in 1-2 lines.
- Don't produce research/investigation reports, format/byte-level breakdowns, or step-by-step narration of what you checked unless something went wrong or the user asked to see it.
- Save deep technical detail for when the user explicitly asks to understand or explain something.

## Documentation

- never modify CLAUDE.md or .github/copilot-instructions.md unless told to modify

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
- never test whether show id has `noemby-` prefix -- check show.inEmby instead
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
4. Downloads APK to `/tmp/tv-remote.apk` and installs via adb
5. Updates `.build-cache` with new checksum

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

## tvapp and tvapprc

- `apps/tvapp` is a native Java Android TV app (package `com.hahnca.tvapp`,
  no React Native/Expo) sideloaded on the Sony Bravia. It is now a two-area UI:
  a narrow filter/sort button column on the left, and full-width show cards on
  the right. There is no right-side Info/Map/Actors/Trailers pane at runtime.
  Each show card owns its own backdrop image, `cardInfo` metadata strip, and
  rotating `cardMisc` area (Description, Map preview, Actors, Trailers). The
  existing Android phone remote enters tvapprc mode while this app is open;
  arrows move the selected show or filter focus, OK rotates the selected card's
  `cardMisc`, Right plays a trailer only while `cardMisc` is on Trailers, Back
  returns to Emby, and the Android-only filter overlay sends show-list text to
  tvapp.
- Build/install with `cd apps/tvapp && ./build-apk`. Gradle and adb both run
  on hahnca.com, never here — this workspace cannot reach the TV at all. Do
  this after every tvapp change; there is no hot reload for it.
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

This section is current as of **2026-08-05** after the tvapp card UI rewrite.
The older three-column design with a right-side Info/Map/Actors/Trailers pane is
gone at runtime. The old pane classes still exist in the source tree, but
`MainActivity` no longer instantiates or references them.

## Overview

Two cooperating components let the Sony Bravia Android TV show the media library
and let the Android phone remote control it without a keyboard, pointer, or TV
remote cursor.

- **tvapp** — native Java Android TV app sideloaded on the Sony Bravia
  (`apps/tvapp`, package `com.hahnca.tvapp`)
- **tvapprc** — a mode of the existing Android phone remote
  (`apps/android/App.js`)
- **tvapprc bridge** — a relay inside tv-tv (`apps/tv/src/main.js`)

The web client is not part of tvapp/tvapprc runtime. It can open/close tvapp via
`POST /tv/toggletvapp` and can influence the selected show through tv-tv's
`lastRelevantShow`, but tvapp itself renders from tv-srvr data and is controlled
by the phone remote through the bridge.

---

## tvapp (native TV app)

### Package and build

- Java native Android app, package `com.hahnca.tvapp`
- TV IP for sideload target: `192.168.1.86`
- Build/install with `cd apps/tvapp && ./build-apk`
- Gradle and adb both run on hahnca.com; this local workspace cannot reach the
  TV directly
- There is no hot reload for tvapp. Build/install after every tvapp source
  change.

### Runtime layout

Current tvapp has two screen areas inside a black root with top/bottom TV chrome
padding:

```text
┌──────────────┬──────────────────────────────────────────────────────┐
│ Buttons      │ Scrollable show cards                                │
│ 9% width     │ 91% width                                             │
│              │                                                      │
│ Sort buttons │ [backdrop][show name + trash icon]                   │
│ Filter group │           [cardInfo][cardMisc: Desc/Map/Actors/...]  │
│              │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

Constants in `MainActivity`:

```java
BUTTONS_WIDTH_FRACTION = 0.09f;
LIST_WIDTH_FRACTION = 1f - BUTTONS_WIDTH_FRACTION;
COLUMN_GAP_DP = 3f;
SCREEN_V_MARGIN_DP = 24f;
```

There is no right-side pane column, no tab row, and no runtime Info/Map/Actors/
Trailers pane. `Area` only has `SHOWS` and `FILTERS`.

### Button column

The left button column is still navigated by remote focus. It contains two
groups.

Sort buttons, top to bottom:

- `Watched`
- `Added`
- `Custom`

Filter group, top to bottom:

- `Clear`
- `Text`
- `Ready`
- `Drama`
- `Comedy`
- `To Try`
- `Continue`
- `Mark`
- `Linda`
- `Trash`

Button colors:

- Active buttons: blue background, white text
- Inactive buttons: gray background, black text
- Focused filter button: red border
- Focused filter group: red border around the group

The sort buttons are never focused by left/right navigation. They are changed by
the phone remote's Sort button (`k,sort`). The filter buttons are focused by
entering `Area.FILTERS` with Left from the show list.

### Show card layout

Every loaded show has a card built up front and then reordered/filtered in the
scroll column. Cards are not recycled.

Card structure in `ShowListView`:

```text
card (FrameLayout)
  outerRow (horizontal)
    backdrop ImageView, full card height, 16:9 width
    content (vertical)
      nameRow
        show name
        trash can icon if show.inEmby == false
      body (horizontal)
        cardInfo (weight 1)
        cardMisc (weight 3)
```

Visual state:

- Every card background is dark gray: `CARD_BG = 0xFF2B2B2B`
- Selected card has a blue border: `CARD_SELECTED_BORDER = 0xFF0A4A8A`
- Selected border width equals the vertical card gap: `CARD_GAP_DP = 3f`
- Cards are vertically separated by `CARD_GAP_DP`
- Not-in-Emby cards no longer get square corners; they show a drawn trash-can
  icon on the far right of the name row

Card height is intentionally restored to the old show-list-card height formula,
not the temporarily larger fixed height used during the rewrite:

```java
CARD_ROWS = 3;
CARD_HEIGHT_PAD_V_DP = 2f;
CARD_HEIGHT_GAP_DP = 1f;
CARD_HEIGHT_FACTOR = 1.44f;
cardHeightPx = Math.round(textHeight * CARD_HEIGHT_FACTOR);
```

### Left backdrop image

The left image is a landscape backdrop, not the portrait poster. It is intended
to be the same source chain as the pre-rewrite show-list card image.

Current image behavior in `ShowListView`:

- ImageView uses `CENTER_CROP`
- Image fills the card height (`MATCH_PARENT` height)
- Display width is derived from 16:9 height/width ratio:
  `posterWidthPx = Math.round(cardHeightPx / (9f / 16f))`
- Source URL candidates come from `Backdrops.get(show, 1920, ...)`
- `BACKDROP_SOURCE_WIDTH_PX = 1920` so Emby serves maxWidth 1920, giving a
  1920x1080-equivalent source
- Candidate order is Emby Thumb, Emby Backdrop/0, TMDB/tv-srvr backdrop for
  non-Emby shows, then `show.image` as last fallback
- The loader uses `Images.intoThumb(...)`
- `requestedPosters` is separate from `requestedMedia`, so backdrop images do
  not reload when cardMisc rotates

`Backdrops.java` itself was not changed by the rewrite. For in-Emby shows it
uses Emby's image endpoint:

```text
https://hahnca.com:8920/emby/Items/<id>/Images/Thumb?maxWidth=<width>
https://hahnca.com:8920/emby/Items/<id>/Images/Backdrop/0?maxWidth=<width>
```

For non-Emby shows it calls tv-srvr `GET /api/getBackdrop` with either `tmdbId`
or `showName`.

### cardInfo section

`cardInfo` is the narrow metadata strip on the left side of the text area under
the show name. It has weight 1 while `cardMisc` has weight 3.

Fields shown, skipping empty values:

1. `firstAired - status`
2. Watched count using the old infobox logic:
   - `Watched X of Y`
   - `Watched all N episodes`
3. `ORIGINAL_COUNTRY - N Mins`
4. `genres`

`Shows.Show` now stores raw `originalCountry` because this field should not use
the combined `countryLang` value.

### cardMisc section

`cardMisc` is the wide right side of each card. It rotates globally for all
cards. It is controlled by `ShowListView.MiscMode`:

```java
private enum MiscMode {
  DESC,
  MAP,
  ACTORS,
  TRAILERS
}
```

Initial mode is `DESC`. Pressing OK while focus is in the show list calls
`showList.rotateCardMisc()` and cycles:

```text
DESC -> MAP -> ACTORS -> TRAILERS -> DESC
```

If the next mode would be `TRAILERS` and the active show has
`trailersReady == true` and `trailers.isEmpty()`, rotation skips Trailers and
continues to the next mode.

`renderAllMisc()` rebuilds every card's cardMisc view when the mode changes.
Actor/trailer images are requested lazily via `mediaRequests`; backdrop images
are not part of that request list.

#### DESC mode

`renderDescMisc()` shows `show.overview`, or `No description.` if empty.

- Text color: `FIELD_COLOR`
- Text size: `FIELD_TEXT_SIZE_SP`
- Maximum lines: 6
- Ellipsize: END
- This is the first/default cardMisc mode

#### MAP mode

`renderMapMisc()` renders up to two horizontal season rows using the show's
local `episodeData` JSON array. It does not call tv-srvr for a series map.

Season row selection priority:

1. First season with a watched-to-unwatched transition
2. Last season that contains any watched episode
3. First season with any file on disk
4. First season present in `episodeData`

The second row, when present, is the next season after the first selected row.

Each row:

- Shows the season number at the left
- Shows episode cells to the right
- Has no episode numbers in the cells
- Wraps cells when too wide through `ShowListView.FlowLayout`

The local episode tuple slots used by card map rows:

```java
ED_AIRED = 0;
ED_WATCHED = 1;
ED_FILE = 3;
ED_RES = 4;
ED_POS = 6;
```

Cell text and colors go through `MapCells`, matching the web map and the
current `MapView` implementation:

- `p` when playback position ticks exist
- `w` when watched
- quality char when available, aired, and the show is in Emby
- `-` when no file and not unaired
- `u` when unaired, unwatched, and no file

#### ACTORS mode

`renderActorsMisc()` renders a horizontal strip of actor cards.

- Card height is 80% of show-card height
- Width is `height * 0.62`
- Uses actor photo image
- Caption is actor name only, not character name
- It renders the maximum number of actor cards that fit the estimated cardMisc
  width
- There is currently no click/OK behavior on actor cards and no visible actor
  card focus state inside cardMisc

The old actor-filter code (`actorClick`, `applyActorFilter`,
`ShowListView.setActorFilter`) still exists, mostly so filters can clear it,
but no current cardMisc actor UI sets it.

#### TRAILERS mode

`renderTrailersMisc()` renders a horizontal strip of trailer still cards.

- Card height is 80% of show-card height
- Width is 16:9 from that height
- No caption/title
- Still image uses YouTube thumbnail when available, otherwise first video frame
  through `Images.frameInto`
- `TrailerList.settle(show, () -> showList.onTrailersReady(show))` runs whenever
  a show is selected, so trailer data is settled for cardMisc

Trailer interaction:

- Changing the selected show clears the trailer highlight
- Pressing Right while cardMisc is in `TRAILERS` mode calls
  `showList.playActiveTrailer()`
- If no trailer card is highlighted, Right immediately plays the first trailer
  without first highlighting it
- If a trailer card is highlighted, Right plays that highlighted trailer
- When the video ends naturally, `TrailerPlayer.EndListener` calls
  `showList.highlightNextTrailerAfterPlayed()`
- End behavior highlights the next trailer with a red border and wraps after the
  last card; it does not auto-play the next trailer

### MapCells shared formatter

`apps/tvapp/app/src/main/java/com/hahnca/tvapp/MapCells.java` is the shared
definition for tvapp map-cell text and colors.

```java
static String text(
    boolean played,
    boolean avail,
    boolean noFile,
    boolean unaired,
    int quality,
    long pos,
    boolean inEmby)
```

It exists so card map preview rows and `MapView` use the same marker rules. It
is intentionally aligned with the web client's map cell content, including the
`p` marker for stored playback position.

### Show data

tvapp loads show records once at startup, and refreshes when returning to the
foreground if the data is older than `SHOWS_REFRESH_AFTER_MS = 10 * 60_000`.

Current endpoint in `Shows.java`:

```text
https://hahnca.com/tv-srvr/api/getAllTvdb?hasEmby=0
```

This includes non-Emby records so the `Trash` filter can reveal them.

Important fields parsed in `Shows.Show` include:

- `name`, `id`, `waitStr`, `image`
- `firstAired`, `lastAired`, `status`
- `originalCountry`, `countryLang`, `network`
- `genres`, `notReady`, `hasFile`
- `averageRuntime`, `seasonCount`, `episodeCount`, `watchedCount`
- `overview`, `imdbId`, `tmdbId`
- `lastPlayedDate`, `dateCreated`
- `inToTry`, `inContinue`, `inMark`, `inLinda`, `inEmby`
- `characters`, `trailers`, `remoteIds`, `episodeData`

Filter predicates in `ShowListView.matchesActiveFilters`:

- Non-Emby shows are hidden unless `Trash` filter is active
- `Ready`: show is not ready or has a `waitStr` => excluded
- `Drama`: excludes comedies
- `Comedy`: requires Comedy genre
- `To Try`, `Continue`, `Mark`, `Linda`: require the corresponding boolean

Sorting by `Shows.Sort`:

- `ALPHA`: alphabetical, leading `the` ignored
- `WATCHING`: newest `lastPlayedDate` first
- `ADDED`: newest `dateCreated` first

Custom sort:

- The `Custom` sort button is present in the sort button column
- Activating Custom calls `https://hahnca.com/tv-srvr/api/getSharedFilterShows`
- tv-srvr can push a custom-settings change to tvapp with command `c`; tvapp
  re-fetches only if `customOn` is true

### Remote navigation inside tvapp

There are two focus areas:

- `Area.SHOWS`
- `Area.FILTERS`

There is no card-level cursor and no pane-level focus. In `Area.SHOWS`, up/down
move the selected show itself.

| Key or command | `Area.SHOWS` | `Area.FILTERS` |
|---|---|---|
| Up / Down | Move selected show | Move focused filter button |
| Left | Enter filter group | No-op |
| Right | Play card trailer if cardMisc is on Trailers | Return to show list |
| OK | Rotate cardMisc | Activate focused filter button |
| Sort (`k,sort`) | Cycle sort | Cycle sort |
| Info (`k,info`) | Currently no-op in tvapp | Currently no-op in tvapp |
| Back (`b` or Android Back) | Back to Emby | Return to show list |
| Force back (`g`) | Back to Emby immediately | Back to Emby immediately |
| Emby (`e`) | Load selected show into Emby | Load selected show into Emby |

Letter-skip:

- Repeated held up/down can be sent as `j,up` / `j,down`
- Letter-skip only applies in `Area.SHOWS`
- Everywhere else it falls back to normal movement

### Loading selected show into Emby

The Emby command (`e`) and the phone remote's Emby button call `embyClick()`.

`embyClick()`:

1. Gets `showList.getSelected()`
2. If no show is selected, opens Emby
3. If the show has no file, shows `No file.` toast
4. If the show is not ready, shows `Show not ready to watch. Use map to play an episode.` toast
5. Otherwise calls:

```text
https://hahnca.com/tv-tv/tv/viewshow?showId=...&showName=...&play=1
```

After the call it moves tvapp to the background. It no longer sends a focused
episode id because the runtime map pane/focused cell is gone.

---

## CtrlServer (tvapp command socket)

tvapp listens on WebSocket port **8099** on the TV. The phone does not dial this
directly; tv-tv on hahnca.com bridges it.

Commands received by `CtrlServer`:

| Message | Meaning |
|---|---|
| `k,<key>` | Remote key: `up`, `down`, `left`, `right`, `ok`, `info`, `sort` |
| `j,<key>` | Letter-skip variant of held up/down |
| `b` | Back one level: close player, leave filters, or return to Emby |
| `g` | Force close to Emby immediately, ignoring focus |
| `e` | Load currently selected show into Emby |
| `x` | Finish/remove tvapp task |
| `f,<text>` | Set show-list filter text |
| `s,<name>` | Select show by exact name; sent by tv-tv, not normal phone key path |
| `c` | Shared filter settings changed; re-fetch Custom list if active |

Messages tvapp sends back to Android through the bridge:

| Message | Meaning |
|---|---|
| `i` | Open Android filter input overlay |
| `z` | Clear Android filter box |
| `c,<count>` | Visible show count |
| `a,<name>` | Active show name for phone-side shows pane |

---

## tvapprc (Android phone remote mode)

### What it is

tvapprc is a mode of the existing Android phone remote, not a separate app.
When tvapp is open, `App.js` sets `tvapprcMode` true and the normal 5x3 remote
grid remains visible with some relabeled buttons and different routing.

Mode detection:

- Phone opens a WebSocket to `ws://192.168.1.103:8098`
- Bridge sends `u` when tvapp ctrl socket opens
- Bridge sends `d` when tvapp ctrl socket closes
- `d` clears tvapprc mode, closes filter input overlay, clears filter text,
  resets list count, and clears active-show ref

Phone-side messages understood from tvapp:

- `i`: open filter input overlay
- `z`: clear filter text
- `c,<count>`: update visible count
- `a,<name>`: remember active show for phone-side shows pane

### Phone button behavior in tvapprc mode

| Phone button | tvapprc behavior |
|---|---|
| Shows | Short press force-closes tvapp to Emby (`g`); hold opens phone shows pane for current tvapp show |
| Back | Sends `b`; tvapp closes player/leaves filters/returns to Emby depending on focus |
| Up / Down | Repeating `k,up/down`, later `j,up/down` for letter-skip |
| Left / Right | Repeating `k,left/right`; Right can play selected card's trailer while cardMisc is Trailers |
| OK | Sends `k,ok`; in show list this rotates cardMisc |
| Emby | Sends `e`; loads selected show in Emby and closes tvapprc mode locally |
| Info | Sends `k,info`; currently no-op in tvapp after pane removal |
| Sort | Sends `k,sort`; cycles tvapp sort |
| Vol-, Vol+, Mute | TV volume, unchanged |

The old Skip button becomes Sort in tvapprc mode. The filter input screen is no
longer a dedicated Skip-label button; it opens when tvapp sends message `i`,
which happens when the focused `Text` button in tvapp's filter group is
activated.

### Android filter input overlay

The filter input overlay is Android-only and has no web-client counterpart.

- Full-screen black overlay over the remote
- `TextInput` at top, auto-focused
- `Clear` button sends empty filter text
- `Exit`, keyboard accept, or tapping outside dismisses overlay
- Typing sends the complete current trimmed string to tvapp as `f,<text>` on
  every change

---

## tvapprc bridge in tv-tv

`startTvapprcBridge()` in `apps/tv/src/main.js` opens a WebSocket server on
port **8098** on hahnca.com. hahnca.com is wired and can reach both the phone and
the TV, so it bridges around wifi client isolation.

For each connected phone:

1. Dial tvapp's ctrl socket at `ws://192.168.1.86:8099`
2. Send phone `u` when tvapp opens
3. Send phone `d` when tvapp closes
4. Forward phone messages to tvapp when the tvapp socket is open
5. Forward tvapp messages to phone
6. If phone sends open-tvapp message `o`, call `openTvappSelectingShow()`
7. If tvapp socket is not open and the phone sends `b`, `g`, or `e`, attempt a
   one-shot direct `sendTvappCommand(...)` fallback

Launch/open behavior:

- `launchTvapp()` calls Sony Bravia app control at
  `http://192.168.1.86/sony/appControl`
- URI is `TVAPP_BRAVIA_URI` in `apps/tv/src/main.js`
- `openTvappSelectingShow()` launches tvapp, dials until ctrl socket opens, then
  sends `s,<lastRelevantShow>` when available

HTTP endpoints:

| Endpoint | Meaning |
|---|---|
| `POST /tv/toggletvapp` | Web remote Shows button; closes tvapp if open, otherwise opens and selects `lastRelevantShow` |
| `POST /tv/tvapprc/back` | Sends `b` direct fallback |
| `POST /tv/tvapprc/forceback` | Sends `g` direct fallback |
| `POST /tv/tvapprc/emby` | Sends `e` direct fallback |
| `POST /tv/clientShow` | Web client tells tv-tv latest selected show for future tvapp launch |
| `GET /tv/opentvapp` | tvapp can ask TV to bring it front when backgrounded |

---

## Data flow diagram

```text
Phone remote (apps/android)        hahnca.com (apps/tv)             TV (apps/tvapp)
──────────────────────────        ────────────────────             ───────────────
tvapprcWsRef
  WebSocket ───── ws:8098 ──────>  startTvapprcBridge()
                                      │ dials per phone connection
                                      ↓
                                   ws:8099 ──────────────────────> CtrlServer
                                      ↑                              │
         k/up/down/ok/sort/info ─────┤ forwards                     │ handleRemoteKey
         j/up/down letter skip ──────┤                              │ handleRemoteKeyLetter
         f,<text> filter ────────────┤                              │ setFilter
         b / g / e / x ──────────────┤                              │ back/force/emby/exit
         s,<show> from tv-tv ────────┤                              │ selectByName
         c custom changed ───────────┤                              │ customChanged

         <──────────────────────── u ─┤ tvapp socket opened
         <──────────────────────── d ─┤ tvapp socket closed
         <──────────────────────── i ─┤ open filter overlay
         <──────────────────────── z ─┤ clear filter box
         <──────────────────── c,N ───┤ visible count
         <──────────────── a,<name> ──┤ active show
```

---

## File map

| Path | Current role |
|---|---|
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/MainActivity.java` | tvapp entry point, two-area layout, button column, remote routing, Emby handoff |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/CtrlServer.java` | WebSocket server on port 8099 for tvapprc commands |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/ShowListView.java` | Show list, card layout, filtering/sorting, cardMisc rotation, map/actor/trailer previews |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/Shows.java` | Loads/parses tvdb show records from tv-srvr |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/MapCells.java` | Shared map-cell text/color formatter used by card map preview and MapView |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/Backdrops.java` | Resolves 16:9 backdrop image candidates for show cards |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/Images.java` | Image/video-frame loading helpers |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/TrailerList.java` | Settles trailer list for a show before trailer cards are final |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/TrailerPlayer.java` | Full-screen inline trailer player with ended callback |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/MapView.java` | Old full Map pane grid; no longer instantiated by MainActivity, but updated to MapCells |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/MapPane.java` | Old Map pane wrapper; currently dead runtime code |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/InfoView.java` | Old Info pane; currently dead runtime code |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/ActorsView.java` | Old Actors pane; currently dead runtime code |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/TrailersView.java` | Old Trailers pane; currently dead runtime code |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/ScrollPane.java`, `Pane.java`, `Scroller.java` | Old pane support interfaces/base classes plus Scroller API; mostly retained by dead pane code |
| `apps/tvapp/build-apk` | Builds on hahnca.com and installs on TV |
| `apps/android/App.js` | Phone remote, tvapprc mode, filter overlay, key forwarding |
| `apps/tv/src/main.js` | tv-tv bridge, app launch/toggle endpoints, direct fallback endpoints |

---

## Key constants

| Constant | Value | Location | Meaning |
|---|---:|---|---|
| `TVAPPRC_HOST` | `192.168.1.103` | `apps/android/App.js` | hahnca.com LAN IP for phone bridge |
| `TVAPPRC_PORT` | `8098` | `apps/android/App.js` / `apps/tv/src/main.js` | Phone-to-tv-tv bridge port |
| `TVAPP_CTRL_URL` | `ws://192.168.1.86:8099` | `apps/tv/src/main.js` | tvapp CtrlServer socket |
| `CTRL_PORT` | `8099` | `CtrlServer.java` | tvapp WebSocket server port |
| `BRAVIA_APP_CONTROL_URL` | `http://192.168.1.86/sony/appControl` | `apps/tv/src/main.js` | Sony Bravia app launch API |
| `TVAPP_BRAVIA_URI` | `com.sony.dtv.com.hahnca.tvapp...` | `apps/tv/src/main.js` | tvapp app URI for Bravia launcher |
| `VIEWSHOW_URL` | `https://hahnca.com/tv-tv/tv/viewshow` | `MainActivity.java` | Load selected show into Emby |
| `SHOWS_URL` | `https://hahnca.com/tv-srvr/api/getAllTvdb?hasEmby=0` | `Shows.java` | tvapp show dataset |
| `BACKDROP_SOURCE_WIDTH_PX` | `1920` | `ShowListView.java` | Source width for card backdrop images |

---

## Current known leftovers / future cleanup

- `InfoView`, `MapPane`, `MapView`, `ActorsView`, `TrailersView`, `ScrollPane`,
  and `Pane` are no longer used by the runtime tvapp layout. They were left in
  place to avoid broad cleanup during the card rewrite. Delete only when ready
  to remove the old pane architecture entirely.
- `MapView` was updated to use `MapCells`, but because the pane is dead at
  runtime, this mostly preserves consistency if it is temporarily reconnected.
- Android still labels the Home button as `Info` in tvapprc mode and sends
  `k,info`, but current tvapp ignores `info` because there are no tabs/panes.
- `actorClick` / actor-filter plumbing still exists in `MainActivity` and
  `ShowListView`, but current cardMisc actor cards do not set actor filters.
- `pane-focus-summary.md` is a one-off conversation handoff note; `CLAUDE.md`
  is the durable source of truth after this update.

---

## Things intentionally not present

- No pointer/cursor overlay in tvapp
- No right-side tab pane at runtime
- No web-client parity requirement for the Android-only filter overlay
- No phone-controller arbitration; the bridge forwards all connected phones and
  the last key wins
- No hot reload for native tvapp
