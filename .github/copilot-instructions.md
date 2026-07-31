# Workspace Instructions (Read First)

## Response style

- When asked to do a simple one-off action (generate a file, run a command), just do it and report completion in 1-2 lines.
- Don't produce research/investigation reports, format/byte-level breakdowns, or step-by-step narration of what you checked unless something went wrong or the user asked to see it.
- Save deep technical detail for when the user explicitly asks to understand or explain something.

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
  - exception: the tvappctrl code in `apps/android` has no web client
    counterpart and is never mirrored — see the tvapp section
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

## tvapp — Android TV app (`apps/tvapp`)

Separate from `apps/android`, which is the phone remote. `tvapp` is a plain
native Java app (no React Native, no Expo, no `node_modules`) sideloaded onto
the Sony Bravia, package `com.hahnca.tvapp`. The left 40% of the screen is a
card per show (`ShowListView`, fed by `Shows`), the rest is the selected show's
pane under a row of tabs with `Emby` at its left end and `Exit` at its right, and
over all of it is a mouse cursor (`CursorView`) driven by tvappctrl over `CtrlServer`. BACK, `Exit`, and
an `x` from the phone all exit; `Exit` opens Emby on the way out, since leaving
otherwise lands on the launcher.

- The card list is the web client's show list in miniature: name and `waitStr`,
  one card always selected (the top one at startup), clicked to select. It is
  loaded once from tv-srvr's `getAllTvdb?hasEmby=1` — the same call and filter
  the phone remote's list uses, so the two agree — over public https, since a
  one-shot 2 MB load has no latency budget worth the relay's tricks.
- Every card is built up front instead of recycled. A few hundred shows that
  never change while the app is open do not need a `ListView`, and a plain
  `ScrollView` is what lets the cursor's edge scrolling just call `scrollBy`.
- Holding the cursor in the top or bottom quarter over the list column scrolls
  it — with only a pointer there is no other way to reach show 200. Speed ramps
  linearly from a standstill at the quarter line to full against the edge, so
  one gesture covers both a nudge of a row or two and a run to the end. The
  scroll runs off its own repeating post rather than off arriving motion,
  because "held" means no motion is arriving, and it carries the sub-pixel
  remainder so the slow end of the ramp still moves.
- The selected show is remembered in `SharedPreferences` and written through on
  every click, so the app reopens where it was left instead of at the top of a
  couple hundred cards. A remembered show that is gone falls back to the top.
- To the right of the list is the web client's info pane: the show name, the
  poster, the same one-per-line field list the phone remote's Info tab shows, in
  the same order, and the overview under them. It starts below the buttons,
  which share that half of the screen with it. Poster loads are sequenced so a
  quick run down the list cannot land an older image on a newer show.
- On the Info pane only the description scrolls; the title, poster and fields
  stay put. Panes scroll at one constant crawl in either direction, with none of
  the list's speed ramp — a description or a cast is not a list of two hundred —
  and clicking the description is a shortcut back to its top. Both halves reach
  `MainActivity`'s one scroll loop through `Scroller`, which is why the loop
  needs to know about neither view.
- The cursor is accelerated the way a desktop mouse is: slow motion passes
  through untouched so a card can be aimed at, fast motion is multiplied up to
  `ACCEL_MAX_GAIN` so the far corner of a 4K screen is one flick of a
  phone-sized surface away. Speed is measured over the gap between batches, and
  a gap long enough to be a new stroke is clamped so the stroke starts
  unaccelerated.
- Clicking the poster does the same as `Emby` — it is the pane's biggest target,
  and loading the show it shows is the only thing this screen does.
- The right half is tabbed, with the web client's simple-mode tabs in its order:
  **Info, Map, Actor, Review, Trailer** — singular, because a tv reads at a
  glance — each holding what that pane holds there. Only the tabs are weighted,
  so they spread across the pane while `Emby` at the left of the row and `Exit`
  at the right keep their own width. `Pane` is the whole contract:
  every pane is told the selected show whether or not it is showing, and loads
  on the next `onShown()`, because two of them fetch and running a fetch per
  card while someone scrolls the list would be for nothing.
  - **Map** is the season by episode grid, from `getSeriesMapFromEmby` with
    `stale: true` — the server's cached episodeData, no Emby or disk access, and
    this pane only reads. Same letters and same two cell colours as the client.
    Rows are weighted, not measured, so twenty seasons narrow the columns rather
    than run off a pane that cannot scroll sideways.
  - **Actors** is the cast grid out of the record's own `characters`. Nothing is
    clickable: the other uis open an IMDb page, and there is no browser worth
    opening on a tv.
  - **Reviews** is tv-api's `getImdbReviews`, which does the filtering and the
    star conversion. IMDb answers 403 often enough that the error is shown
    rather than an empty pane — the web client is getting the same 403 today.
  - **Trailer** is a card per trailer in the record, holding the video's own
    still and nothing else, clicked to play. The still is YouTube's
    `hqdefault.jpg`, which is
    4:3 with the picture letterboxed inside it — the 16:9 card crops that back
    off. It stands in for the embedded player the web client shows before you
    press play.
  - Playing happens **inside tvapp**, full screen, in `TrailerPlayer`'s WebView,
    not by handing the url to the YouTube app. Handing it over worked, but the
    tv app never says when a video ended and backing out of it lands on whatever
    task was underneath rather than here. The iframe api both plays the video and
    reports `ENDED`, which is what puts the pane back; a plain video file url gets
    a `<video>` element and its `ended` event instead. A click or BACK closes the
    player early.
    - The page is loaded with **our own domain as the base url**, not
      `youtube.com`: the iframe api checks the embedding origin, and youtube.com
      embedding itself is refused with *"This video is unavailable, error code
      152"* on a screen that otherwise looks like a broken app. `about:blank`
      fails the same way. Same string goes in the player's `origin` var.
- **A click that arrives while something else has the screen brings tvapp back**
  instead of being aimed at a cursor nobody can see, so whatever took the screen
  — Emby, the launcher — is one tap on the phone away from the app again, with
  no trip through the remote and back. The ctrl socket outlives being
  backgrounded, which is what makes this reachable at all.
  - It goes out as a GET to tv-tv's `/tv/opentvapp`, **not** `startActivity`.
    Android blocks an activity start from an app that is in the background and
    no permission a sideloaded app can grant itself lifts that — `appops set
    SYSTEM_ALERT_WINDOW allow` does not, the log line to look for is
    `Background activity launch blocked`. The endpoint calls the same
    `launchTvapp` opening tvappctrl on the phone already calls, and the set
    launching its own app is not a background start.
  - The wire protocol does not change: the phone still just sends `c`. tvapp
    tracks `onResume`/`onPause` and decides which of the two a click means.
  - Being brought back this way does not restart the activity, so the tab, the
    show and the scroll position are all where they were left.
- Whichever pane is showing is what the cursor scrolls, and its top zone starts
  at the pane's own top so that reaching up for a tab does not scroll the pane
  out from under the cursor on the way.
- Tab buttons carry their own `GradientDrawable` background rather than the
  platform's: tinting a platform `Button` blue for the active tab and then
  clearing the tint does not give the platform look back, it gives a white
  button with a white label.
- `Emby` is the web client info pane's TV button, verbatim: a GET to tv-tv's
  `/tv/viewshow`, which powers the set on, brings Emby to the front and hands it
  the selected show. tvapp finishes only once that request is away — finishing
  can take the process with it. `Exit` instead launches Emby locally by intent,
  which is enough when nothing has to be loaded into it.

```bash
cd apps/tvapp
./build-apk        # find TV, build on hahnca.com, install, launch
./connect-tv       # just connect; prints the adb serial
```

- Gradle builds run on hahnca.com (`/tmp/tvapp-build`), never locally. Release
  APKs are signed with the checked-in debug keystore.
- All adb runs on hahnca.com. **This WSL workspace cannot reach the TV at
  all** — `adb connect` to it fails from here and succeeds from hahnca.com,
  which shares the TV's LAN. So connect, install, grant, launch, and the
  mDNS lookup are all remote, and the build is too, to save a hop.
- The TV's IP **and** its wireless debugging port both change on every reboot,
  so neither is hard-wired. `connect-tv` resolves them over mDNS
  (`_adb-tls-connect._tcp`) and caches the result in `.device`; a stale cache
  self-corrects. Never hard-code the TV address.
- Android turns wireless debugging off at each boot. `BootReceiver` +
  `AdbWifi.java` turn it back on, which works because `build-apk` grants
  `WRITE_SECURE_SETTINGS` and launches the app on every install — an app that
  has never been opened gets no `BOOT_COMPLETED`. Keep both steps in `build-apk`.
- `fix.md` in that directory is the recovery procedure for factory reset,
  revoked pairings, and reboots that do not heal. Read it before touching
  anything connection-related.
- Do not reboot the TV or run `adb pair` without asking — pairing may need the
  user to read a code off the TV screen.
- unilog does not apply here; this is Java, use `android.util.Log`.
- A click command is applied by synthesizing a touch at the cursor hotspot and
  dispatching it into the view hierarchy, so any widget the ui grows is
  clickable with no extra plumbing. `CursorView` is therefore never clickable —
  the event has to fall through it — and it carries a large elevation, because
  being the last child is not enough to draw over a `Button`.
- The activity holds `FLAG_KEEP_SCREEN_ON`. The tv's screensaver otherwise takes
  the screen out from under a cursor mid-drag, and a dream deep enough to stop
  the activity would take the ctrl socket with it.
- The cursor is a white arrow with a fat black outline drawn under the fill. A
  thin outline is invisible the moment the arrow crosses anything white, and it
  starts centered, so that used to read as "there is no cursor".
- `res/drawable/banner.xml` is the launcher tile and the app icon: a vector whose
  viewport is the 320x180 banner size, holding a blue field and a white home
  glyph. Editing the path means checking the geometry — nothing renders it for you
  and the TV serves no icon for a sideloaded app, so rasterize the path data
  yourself rather than eyeballing the numbers.

### tvappctrl — the phone side

`apps/android/tvappctrl.js` exports two things, because they have different
lifetimes: `TvAppCtrl`, the screen `App.js` returns early instead of the remote,
and `useTvappLink`, the relay socket. Reached by pressing the remote's Shows
button, left again with its `Exit` button. It replaces the remote rather than
overlaying it, which is what keeps the two from interacting. Shows carries both
screens: the press opens tvappctrl and a hold opens the shows pane, the hold
going to the one with somewhere to go back to. Back has no long press at all —
it is pressed constantly and anything hidden behind a hold there gets hit by
accident. The web tv pane keeps Shows on a plain click, since tvappctrl has no
counterpart there to give the click to.

- **The socket lives in `App.js`, not in the screen**, and stays open for the life
  of the app. It has to: being told tvapp just opened on the TV is what opens the
  screen, so something must be listening while the remote is what is on display.
  Do not move it back into the component.
- **tvapp and tvappctrl are kept in step in all four directions**, and each
  direction is a different mechanism:

  | trigger | how |
  | --- | --- |
  | tvappctrl opens on phone | phone sends `o`; relay opens tvapp on the TV |
  | tvappctrl closes on phone | phone sends `x`; tvapp exits itself |
  | tvapp opens on TV | relay's redial starts succeeding → sends `u` |
  | tvapp closes on TV | relay's TV socket drops → sends `d` |

  The TV-initiated pair costs up to `TVAPP_DIAL_RETRY_MS` (2 s) to notice, because
  the relay learns about tvapp only by redialling it. Only a socket that had
  actually been open reports `d` — otherwise the steady drip of refused dials
  while tvapp is closed would keep slamming the phone's screen shut.
- Opening tvapp uses the TV's **own application list** over Sony's `appControl`
  (`setActiveApp` with `TVAPP_BRAVIA_URI`), not adb. Sideloaded apps still appear
  there, which matters because the TV's adb port moves on every reboot. Confirm a
  uri with `getApplicationList` against the same endpoint if it ever changes.

- It lives in **`apps/android`**, not in an app of its own: a second phone app
  for the same TV would mean a second icon, build, and Metro setup. Keep it out
  of `App.js` proper, which the TV-remote features already fill.
- It is **exempt from the android/web-client UI parity rule**. There is no tv
  pane counterpart and there is not meant to be one.
- It goes **phone → relay → TV, all on the LAN**. It cannot go direct: the TV is
  unreachable from any wireless host here, and the phone is on wifi (see the entry
  below for the measurements). `startTvappctrlRelay` in `apps/tv/src/main.js`
  bridges the gap, because that host is **wired**, which is the one thing that
  does reach the TV. The relay is byte-transparent and
  deliberately knows nothing about the protocol — understanding it would make it
  a third place to edit on every change.
- The relay is a **raw LAN port on tv-tv, not the public `https://hahnca.com`
  endpoint**. That distinction is the whole point: two lan hops of a few ms each,
  no tls, no nginx, no hairpin out to the public ip and back. A finger drag at
  60 Hz still must not round-trip through the internet, and does not.
- There is **no discovery**: every address is a hard-wired constant.
  `TVAPP_HOST` / `TVAPP_PORT` in `tvappctrl.js` point at the relay
  (192.168.1.103:8098); `TVAPPCTRL_RELAY_PORT` and `TVAPP_CTRL_URL` in
  `apps/tv/src/main.js` are the relay's own port and the TV it dials;
  `CTRL_PORT` in `CtrlServer.java` is the TV's. Ports are ours to pick, unlike
  the random one adb uses. RN JS cannot do mDNS in Expo Go, and this avoids
  needing it. **Both** ips want a DHCP reservation now — the TV's and
  hahnca.com's, which is currently a dynamic lease. If a reservation is lost the
  app just stops reaching the TV; fix the router, not the code.
- Motion that arrives at the relay before its TV leg has opened is **dropped,
  not queued** — relative deltas a few ms stale would land as a cursor jump.
  Costs the first frame or two after the screen opens, before a finger is down.
- The wire protocol is the only real dependency between `apps/android` and
  `apps/tvapp` — a protocol change means editing both in one session. tvapp is
  Java and cannot import `@tv/share`, so the constants get hand-mirrored; keep
  the protocol small for that reason. The relay in the middle does not count: it
  forwards frames without parsing them, which is exactly why it does not become a
  third place to edit. All of it, phone to TV:

  ```
  m,<dx>,<dy>   move the cursor by a relative amount, in tv pixels
  c             click whatever the cursor is over
  x             exit tvapp
  ```

  Only relative motion is sent — where on the phone the finger is has no
  bearing on where the cursor is — coalesced to one message per frame rather
  than one per touch event. A press that barely moves and is released quickly
  is a tap, and sends `c`. The relay's own three messages (`o`, `u`, `d`) are a
  separate set it does read, mirrored between `tvappctrl.js` and
  `apps/tv/src/main.js`; tvapp never sees them.
- A WebSocket because RN JS has no raw sockets and http per motion event at
  60 Hz is not viable. tvapp's server side is `org.java-websocket`.
- The release APK needs `android:usesCleartextTraffic="true"` on
  `<application>` in `apps/android/android/app/src/main/AndroidManifest.xml`:
  the TV has no tls, and without it the release build blocks `ws://` while Expo
  Go (whose own manifest allows cleartext) works fine. That `android/`
  directory is a gitignored prebuild output, so the edit is untracked — if it
  is ever regenerated, put the attribute back.
- Every js file has to be in `build-apk`'s checksum list, `tvappctrl.js`
  included, or changing it silently reinstalls the cached APK.
- Android 16 and up gate LAN addresses behind `ACCESS_LOCAL_NETWORK` — that
  name, not `LOCAL_NETWORK_ACCESS`, and not the "Nearby devices" permission
  (`NEARBY_WIFI_DEVICES`). It has to be declared in the manifest to be grantable
  and then requested at runtime; tvappctrl does both. Expo Go declares it and has
  it granted, so Expo Go is a fine way to test this.
- **The TV is unreachable from every wireless host on this LAN, and that is why
  the relay exists** — do not "simplify" it away by pointing the phone at the TV.
  Measured, all on 192.168.1.0/24:

  | from | to TV (.86) |
  | --- | --- |
  | phone .172, wifi | arp `FAILED`, `No route to host` |
  | this workspace .62, wifi | arp `FAILED`, `No route to host` |
  | hahnca.com .103, **wired** | works |

  It is not blanket ap client isolation — the phone and the workspace reach each
  other and hahnca.com fine over wifi. It is the TV specifically, so the thing to
  look at is **how the TV is attached**: its own SSID, band, or an extender that
  bridges to the wired segment but not to other wireless clients. Not
  port-specific or app-specific either: `ping` fails the same as 8099 and as
  adb's own port. The signature is a `FAILED` arp entry. Check it first when the
  socket will not open:
  `ping -c 3 192.168.1.86 && ip neigh show 192.168.1.86`. Only if the TV becomes
  reachable from wireless (or moves to Ethernet) does the relay become optional.
- **Orientation is handled by unlocking rotation for this screen alone** (via
  `expo-screen-orientation`, re-locked to portrait on unmount — the rest of the app
  stays portrait). Letting the layout turn with the device is what makes both
  requirements fall out for free: the `Exit` button lands in the corner that really
  is the upper right, and touch deltas arrive already in the rotated frame, so a
  drag towards the top of the phone as held is a drag towards the top of the TV
  with **no correction to apply**. Rotating the motion vector by hand instead would
  leave the button and the status-bar inset in the wrong corner. The status bar
  inset is only added in portrait: in landscape the camera cutout sits centred on a
  side edge, so that corner is already clear.
- **Both system bars are hidden on this screen** — the navigation bar via
  `expo-navigation-bar` (restored on unmount) and the status bar. In landscape the
  navigation bar moves to the right edge and, the window being edge to edge, lays
  itself straight over the `Exit` button. Hiding **either** has to be re-asserted on
  every rotation: a configuration change brings both back, and the declarative
  `<StatusBar hidden />` does not survive it. That pair of calls sits in its own
  effect keyed on the window dimensions, separate from the one that restores the
  navigation bar, or the restore would flash it into view on each rotation.
- The `Exit` button's inset is per-orientation (`EXIT_TOP`/`EXIT_RIGHT` and their
  `_LANDSCAPE` counterparts). Portrait clears the camera cutout row; landscape has
  no bars left to hide behind, so it needs an inset from both bezels of its own.
- The drag surface claims the touch with `onStartShouldSetResponder` only.
  Adding `onMoveShouldSetResponder` lets it steal a press that started on the
  `Remote` button the instant the finger twitches, and the symptom is a button
  that flashes and never fires.
- The screen shows **nothing but the `Remote` button** — no status, no error. A
  failed socket is silent and the only symptom is that dragging does nothing, so
  diagnose from the relay instead:
  `node unilog/query.js --group tvappctrl --last 20`. It logs each phone that
  starts relaying and the first dial failure of a run. Causes when the phone
  cannot connect: tv-tv is down, tvapp is not open on the TV, or the phone is not
  on the Wi-Fi at all (the usbipd + `adb reverse` dev setup gets Metro to the
  phone over USB and does **not** put it on the LAN). The relay drops a phone it
  cannot forward for, rather than sit there looking connected, so the phone's
  retry loop keeps redialing on its own.
- RN's WebSocket `error` event carries **no message** — `WebSocket.js` dispatches
  a bare `Event`. The reason shows up on the `close` event right behind it, as
  `reason` with code 1006. So report from `onclose`, and do not let an
  error-triggered retry guard swallow the close that follows it.

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
