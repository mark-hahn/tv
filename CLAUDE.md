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

## tvapp and tvapprc

- `apps/tvapp` is a native Java Android TV app (package `com.hahnca.tvapp`,
  no React Native/Expo) sideloaded on the Sony Bravia. It is modeled on the
  web client's tv pane — a show list on the left, a state-button column in the
  middle, and Info/Map/Actors/Trailers panes on the right. The existing Android
  phone remote enters tvapprc mode while this app is open; arrows move the
  selected item, OK activates it, Back returns to Emby, and Filter opens the
  Android-only text input overlay for the tvapp show-list filter.
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

- the documentation that follows for tvapp and tvapprc is not up-to-date
  - it is accurate on 2026/8/1
  - there are probably new ui elements 
  - dimensions are probably out-of-date

## Overview

Two cooperating components let the Sony Bravia Android TV show the same media library the web client and phone remote work with, and let the phone remote control that TV-side app without a keyboard or pointer.

- **tvapp** — native Java app sideloaded on the TV (`apps/tvapp`)
- **tvapprc** — a mode of the existing Android phone remote (`apps/android/App.js`)
- **tvapprc bridge** — a relay inside tv-tv that connects them (`apps/tv/src/main.js`)

The web client (`apps/client`) is **not involved** in tvapp/tvapprc at runtime. It only launches or closes tvapp via the web remote's Shows button.

---

## tvapp (native TV app)

### Package and build
- Java, package `com.hahnca.tvapp`, sideloaded on Sony Bravia at `192.168.1.86`
- Built with `cd apps/tvapp && ./build-apk` (runs Gradle on hahnca.com, installs via adb)
- No hot reload — a full APK build is required after every change

### Layout (portrait, three columns side by side)
- these dimensions vary
```
┌─────────────────┬──────────┬──────────────────────┐
│   Show cards    │ Buttons  │   Tab pane           │
│   (36% width)   │ (18%)    │   (46%)              │
│                 │          │                      │
│  scrollable     │ Tabs     │  Info / Map /        │
│  list of shows  │ ──────── │  Actors /            │
│  with waitStr   │ Filters  │  Trailers            │
│                 │ ──────── │                      │
│                 │ Sorting  │                      │
└─────────────────┴──────────┴──────────────────────┘
```
Top and bottom of the screen have a vertical margin to avoid the TV's on-screen chrome.

### Show cards (left column)
- One card per show, showing name + `waitStr`
- Two visual states per card:
  - **Active** (blue background) — the selected show; its data fills the tab panes
  - **Focused** (light-red border) — the item highlighted by the remote's arrow keys
- Active and focused can be different cards simultaneously
- Filter, sort, and actor-filter change which cards are visible

### Buttons column (middle)
Buttons are **state indicators only** — there is no click/touch. Their state is toggled by the remote's OK key while that button has focus.

Three groups (top to bottom):

| Group | Buttons | Behavior |
|-------|---------|----------|
| **Tabs** | Info, Map, Actors, Trailers | Radio — exactly one active; controls which pane is visible |
| **Filters** | Ready, Drama, Comedy, To Try, Continue, Mark, Linda | Toggle — any combination active; filters the show card list |
| **Sorting** | Watched, Added, Custom | Sort order; Custom only visible when shared filter settings exist |

- Active buttons: blue background, white text
- Inactive buttons: white background, black text
- Focused button (remote selection): light-red border

### Tab panes (right column)
Same content as the web client's simple-mode tabs. Only one pane is visible at a time, determined by the active Tabs button.

- **Info** — poster, overview, metadata (same as web client Info pane)
- **Map** — season/episode grid with episode subpane on click
- **Actors** — cast grid; clicking a card narrows the show list to that actor's shows
- **Trailers** — trailer still images; clicking plays inline via `TrailerPlayer`

### Item selection / navigation graph
One item is "focused" at a time — a show card or a button.

- `up`/`down` arrows: move focus within the current column
- `right` arrow from a card: move focus to the button whose vertical center is closest to the card's center on screen
- `left` arrow from a button: move focus to the card whose vertical center is closest to the button's center on screen
- `ok`: activate the focused item
  - on a card → makes it Active (loads its data into panes, clears filter)
  - on a Tabs button → selects that tab (radio behavior)
  - on a Filters button → toggles that filter on/off
  - on a Sorting button → changes sort order (clicking an already-active sort removes it)
- `back` (Android back key or tvapprc back command) → opens Emby and closes tvapp

### CtrlServer (command socket)
tvapp listens on a WebSocket at port **8099** (on the TV's LAN IP `192.168.1.86`).  
The tv-tv bridge (not the phone) dials this port.

**Commands received from bridge:**
| Message | Meaning |
|---------|---------|
| `k,<key>` | Remote key: `up`, `down`, `left`, `right`, or `ok` |
| `b` | Close tvapp and bring Emby to front |
| `e` | Load the currently active show into Emby (same as web client TV button) |
| `x` | Exit tvapp |
| `f,<text>` | Set show-list filter text |
| `s,<name>` | Select a show by exact name (sent by tv-tv, not the phone) |

**Messages sent back to bridge (forwarded to phone):**
| Message | Meaning |
|---------|---------|
| `z` | Show was activated — clear the phone's filter input box |

### Linking to Emby (`e` command / Emby button)
Calls `https://hahnca.com/tv-tv/tv/viewshow?showId=...&showName=...` then calls `finishAndRemoveTask()` so tvapp closes and Emby takes the screen.

### SharedFilters (Custom sort availability)
Polls tv-srvr for shared filter settings (set from the web client's Send button). When settings exist, the Custom button becomes visible. Activating it fetches a pre-filtered ordered show list from tv-srvr.

### Show data
Loaded once at startup from `https://hahnca.com/tv-srvr/api/getAllTvdb?hasEmby=1` (same endpoint the phone remote uses). Fields used: `name`, `id`, `waitStr`, `image`, `firstAired`, `lastAired`, `status`, `genres`, `notReady`, `inToTry`, `inContinue`, `inMark`, `inLinda`, `lastPlayedDate`, `dateCreated`, `characters`, `trailers`.

Filter predicates in `Shows.Show`:
- **Ready**: `!notReady`
- **Drama**: `!isComedy()` (no Comedy genre)
- **Comedy**: `isComedy()` (has Comedy genre)
- **To Try / Continue / Mark / Linda**: corresponding boolean fields

Sorting by `Shows.Sort`:
- `ALPHA` — alphabetical, leading "the" ignored
- `WATCHING` — `lastPlayedDate` descending
- `ADDED` — `dateCreated` descending

---

## tvapprc (Android phone remote mode)

### What it is
A **mode** of the existing phone remote, not a separate screen. When tvapp is open on the TV, the Android remote switches into tvapprc mode. The same 5×3 button grid is still visible; only its behavior changes.

### When tvapprc mode is active
- `mode` is set to `"tvapprc"` which keeps `isOff = false` so all buttons remain usable
- The Shows button glows light blue
- The Skip button is relabelled **Filter**
- Arrow and OK keys route to tvapp instead of the TV/Emby
- Back closes tvapp and returns to Emby
- Emby loads the active show into Emby

### Button behavior in tvapprc mode vs. normal mode

| Button | Normal | tvapprc mode |
|--------|--------|-------------|
| Shows | Short press: open tvapp; hold: open shows pane | Press: close tvapp (back to Emby) |
| ↩ Back | Send back key to TV | Close tvapp and open Emby |
| ▲▼◀▶ Arrows | TV navigation | tvapp item navigation (repeats on hold) |
| OK | Send OK to TV | Activate focused item in tvapp |
| Emby | Short: switch to Emby input; hold: streaming apps | Load active show into Emby, close tvapp |
| Skip → **Filter** | Skip intro / toggle resolution | Open tvapprc filter input overlay |
| Vol-, Vol+, Mute | TV volume | TV volume (unchanged) |

### Filter input overlay (Android only)
When Filter is pressed, a full-screen overlay appears over the tvapprc remote:
- Black background (identical look to old tvappctrl screen)
- `TextInput` at top auto-focused
- `Clear` button clears the text field and sends empty filter to tvapp
- `Exit` button or keyboard Accept dismisses the overlay (remote reappears)
- Tapping the empty area dismisses the overlay
- Typing sends the complete current string to tvapp via `f,<text>` on every keystroke

The overlay is `Android-only` — there is no web client counterpart.

### tvapprc mode detection / persistence
The phone's tvapprc WebSocket (port **8098** on hahnca.com LAN) receives `u` (tvapp up) and `d` (tvapp down) messages from tv-tv. These drive `tvapprcMode` state in `App.js`. The WebSocket reconnects automatically; the filter text and input overlay close when tvapp closes.

---

## tvapprc bridge (inside tv-tt)

### What it does
`startTvapprcBridge()` in `apps/tv/src/main.js`:
1. Opens a WebSocket server on port **8098** (LAN only, hahnca.com wired host)
2. For each connected phone, dials tvapp's CtrlServer at `ws://192.168.1.86:8099`
3. When tvapp's socket opens → sends `u` (tvapp up) to the phone
4. When tvapp's socket closes → sends `d` (tvapp down) to the phone
5. Phone messages are forwarded to tvapp's socket transparently
6. tvapp messages are forwarded to the phone transparently
7. If the phone sends `o` (open tvapp) → calls `launchTvapp()` to open it via Bravia app control API

### Why a bridge is needed
The TV is on wifi; the phone is on wifi. Wifi clients are AP-isolated — they cannot reach each other. hahnca.com is wired and can reach both, so it relays.

### Control messages (bridge ↔ phone)
| Message | Direction | Meaning |
|---------|-----------|---------|
| `o` | Phone → bridge | Open tvapp on the TV |
| `u` | Bridge → phone | tvapp is now open |
| `d` | Bridge → phone | tvapp has closed |

All other messages pass through to tvapp without interpretation.

### HTTP fallback endpoints
If the bridge WebSocket leg to tvapp is reconnecting, Back/Emby commands fall back to:
- `POST /tv/tvapprc/back` — sends `b` (back to Emby) directly to tvapp
- `POST /tv/tvapprc/emby` — sends `e` (load selected show into Emby) directly to tvapp

### Launching tvapp
`launchTvapp()` calls the Bravia app control API (`http://192.168.1.86/sony/appControl`) with the tvapp URI `com.sony.dtv.com.hahnca.tvapp.com.hahnca.tvapp.MainActivity`. No adb required.

### Toggling tvapp (web remote / Shows button)
`POST /tv/toggletvapp` (from web client's Shows button):
- If tvapp is reachable (probes port 8099): sends `b` to close it
- Otherwise: calls `launchTvapp()` then dials until the socket comes up, optionally sending `s,<name>` to pre-select a show

### opentvapp endpoint
`GET /tv/opentvapp` — called by tvapp itself when it has been backgrounded by another app and needs the TV to bring it front (Android blocks background activity starts; having the TV launch its own app is not a background start).

---

## File map

| Path | What it is |
|------|-----------|
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/MainActivity.java` | TV app entry point — UI layout, key routing, item selection, button state |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/CtrlServer.java` | WebSocket server (port 8099) — receives remote commands |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/ShowListView.java` | Show card list — active/focused state, filter, sort |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/Shows.java` | Data model — loads and parses show records from tv-srvr |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/InfoView.java` | Info pane |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/MapView.java` / `MapPane.java` | Map pane (season/episode grid) |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/ActorsView.java` | Actors pane |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/TrailersView.java` | Trailers pane |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/TrailerPlayer.java` | Inline YouTube player |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/SharedFilters.java` | Polls tv-srvr for shared filter settings |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/ScrollPane.java` | Base class for scrollable panes |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/Scroller.java` | Interface |
| `apps/tvapp/app/src/main/java/com/hahnca/tvapp/Pane.java` | Interface |
| `apps/tvapp/build-apk` | Build + install script |
| `apps/android/App.js` | Phone remote — tvapprc mode state, bridge WebSocket, filter overlay, button routing |
| `apps/tv/src/main.js` | tv-tv server — `startTvapprcBridge()`, `/tv/toggletvapp`, `/tv/opentvapp`, `/tv/tvapprc/back`, `/tv/tvapprc/emby` |

---

## Data flow diagram

```
Phone (apps/android)              hahnca.com (apps/tv)          TV (apps/tvapp)
──────────────────                ────────────────────          ───────────────
tvapprcWsRef                      
  WebSocket ──────── ws:8098 ──→  startTvapprcBridge()
                                    │  dials when phone connects
                                    ↓
                                    ws:8099 ──────────────────→ CtrlServer
                                    ↑                             │
                    ← k,up/down/…   │ forwards                    │ key events
                    ← f,<text>      │ both ways                   │ filter text
                    ← b / e / x     │                             │
                    → u (tvapp up)  ←──────────────────────────── │ socket opened
                    → d (down)      ←──────────────────────────── │ socket closed
                    → z (clr filter)←──────────────────────────── │ show activated
```

---

## Key constants

| Constant | Value | Location | Meaning |
|----------|-------|----------|---------|
| `TVAPPRC_HOST` | `192.168.1.103` | `apps/android/App.js` | hahnca.com LAN IP |
| `TVAPPRC_PORT` | `8098` | `apps/android/App.js` | Bridge port (phone → tv-tv) |
| `TVAPP_CTRL_URL` | `ws://192.168.1.86:8099` | `apps/tv/src/main.js` | tvapp CtrlServer |
| `BRAVIA_APP_CONTROL_URL` | `http://192.168.1.86/sony/appControl` | `apps/tv/src/main.js` | Sony Bravia app launch API |
| `TVAPP_BRAVIA_URI` | `com.sony.dtv.com.hahnca.tvapp…` | `apps/tv/src/main.js` | tvapp's Bravia URI |
| `VIEWSHOW_URL` | `https://hahnca.com/tv-tv/tv/viewshow` | `apps/tvapp/…/MainActivity.java` | Load show into Emby |

---

## Things that are intentionally not here

- **No web client changes** — the web client does not know about tvapprc mode; it only calls `/tv/toggletvapp`
- **No pointer/cursor** — the old cursor overlay (`CursorView`) and scroll buttons (`ListHeader`) are gone; all navigation is by remote key
- **No blocked-phone arbitration** — the old relay chose one phone as "controller"; the bridge now forwards all phones' commands to tvapp; the last key pressed wins (fine for one-user setup)
- **No Android parity rule** — the filter input overlay is Android-only; the web client tvpane has no counterpart and is not expected to have one
