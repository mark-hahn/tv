> **⚠ WARNING:** This document was generated on **2026-05-24**. The code may have changed since then. Always verify against the source in `apps/android/App.js`.

# Android App — TV Remote (`apps/android`)

## Overview

A React Native / Expo Go app (single-file: `App.js`) that serves as a physical-style remote control for the living room TV system. It runs on Android phones and provides a 3×5 grid of buttons, overlapping modal panes for show browsing and subtitle/picture control, and real-time state sync via WebSocket.

The app is exclusively used within the home network but is accessed through the public-facing reverse proxy at `hahnca.com`.

---

## Architecture

- **Framework:** React Native via Expo (bare workflow for Android)
- **Single component:** `App.js` contains all state, logic, and UI
- **Build:** APK built via the `build-apk` script (Gradle on remote server, see workspace instructions)
- **Font scaling:** System font scale is neutralized using `PixelRatio.getFontScale()` so the UI is unaffected by device accessibility settings
- **Layout persistence:** `layoutOption` (mark/linda) is persisted to `AsyncStorage`

---

## Server Endpoints

The app communicates with two servers:

### `tv-tv` — TV control server (`https://hahnca.com/tv-tv`, port 3004)

This is the intermediary between the app and all physical devices.

**Navigation / control:**

- `GET /tv/key/:key` — send a navigation key (`up`, `down`, `left`, `right`, `ok`, `home`, `back`, `captions`); supports `?n=N` for Fire TV burst repeat
- `GET /tv/vol/up` / `GET /tv/vol/down` — single volume step via HA Bravia remote entity
- `GET /tv/mute` — toggle mute via HA Bravia `media_player.volume_mute`
- `GET /tv/mutestate` — poll current mute state, HA power state, and active device
- `GET /tv/emby` — launch Emby app on whichever device is active
- `GET /tv/googlebtn` — turn on/switch to Google TV (Bravia Smart TV input) and launch Emby
- `GET /tv/firebtn` — turn on/switch to Fire TV Stick and launch Emby
- `GET /tv/openapp?uri=...` — launch a streaming app by Android activity URI
- `GET /tv/off` — turn off the TV
- `GET /tv/on` — turn on the TV

**Emby scrubbing (server-side seek loop):**

- `POST /tv/emby/scrub/start` — body `{ intervalMs, distTicks }`: starts a server-side loop that repeatedly seeks Emby by `distTicks` every `intervalMs` milliseconds (used for left/right long-press)
- `POST /tv/emby/scrub/ping` — dead-man ping sent every 500ms while scrubbing; server stops the loop if pings stop
- `POST /tv/emby/scrub/stop` — terminates the scrub loop and resumes normal playback

**Subtitle control:**

- `GET /tv/emby/playing` — returns all active Emby sessions with subtitle tracks, chosen subtitle index, and device names
- `POST /tv/emby/subtitle` — body `{ sessionId, index }`: navigate to a subtitle track via the Bravia IRCC key sequence (navigates the TV's OSD directly)

**Picture settings:**

- `GET /tv/picture` — fetch all current picture quality settings from the Bravia TV via its Sony REST API
- `POST /tv/picture` — body `{ target, value }`: set a picture quality setting

### `tv-srvr` — Main application server (`https://hahnca.com/tv-srvr`)

Handles show data, episode metadata, and the WebSocket hub.

**HTTP API:**

- `GET /api/getAllTvdb?hasEmby=1` — returns all shows in the TVDB database, filtered to those present in Emby; used to populate the shows list
- `POST /api/getTmdb` — body `{ showName, year, season, episode }`: returns TMDB episode data including guest actors, overview, still image, and air date
- `POST /api/getSeriesMapFromEmby` — body `{ showName }`: returns the full season/episode availability grid from Emby (availability, watched, unaired status per cell)
- `POST /api/getSeriesMapFromTvdb` — body `{ tvdbId, watchedEpis }`: fallback for shows not in Emby
- `GET /api/episodeStats?show=...&s=...&e=...` — returns video file technical stats for an episode (codec, resolution, bit rate, HDR, audio channels, PTT metadata)
- `POST /api/getActorPage` — body `{ name, tvdbPersonId }`: resolves an actor's IMDb URL for external linking

### WebSocket (`wss://hahnca.com/tv-srvr`)

The app connects on startup and maintains a persistent connection with auto-reconnect (2s delay on close).

**Client → Server messages:**
| `fname` | Description |
|---|---|
| `register` | Sent on open to identify this client to the hub |
| `tvRemoteAction` | Broadcast notification: this client just pressed a button (param: `{ fromSubCtrl }`) |
| `tvRemoteCollision` | This client detected a collision (avoidance was active when a button was pressed); server responds by locking all clients |
| `tvRemoteUnlock` | This client held the Unlock button; server forwards unlock to all other clients |
| `skipIntro` | Trigger skip-intro seek; param: `{ pressedAt }` — timestamp used to compensate for network/processing delay |

**Server → Client push notifications:**
| `notification` | Description |
|---|---|
| `tvMuteState` | TV mute/power/mediaTitle state changed |
| `tvRemoteAction` | Another client pressed a button (triggers collision-avoidance lockout on this client) |
| `tvRemoteLock` | A collision was detected; all remotes are locked until unlocked |
| `tvRemoteUnlock` | A client released the lock; resume normal operation |
| `missingEpisodeWarning` | A show is being watched out of order; data includes show name, missing SE, current SE, and device |
| `subtitleMismatch` | The chosen subtitle file for the current episode is not the one currently selected in Emby |
| `nowPlaying` | Emby now-playing update: `{ showName, playing: [{ season, episode, positionTicks, runtimeTicks }] }` |

---

## Remote Control

### Button Grid (3 columns × 5 rows)

| Row | Left     | Center   | Right     |
| --- | -------- | -------- | --------- |
| 1   | Back (↩) | Up (▲)   | Home (⌂)  |
| 2   | Left (◀) | OK       | Right (▶) |
| 3   | Emby     | Down (▼) | Skip      |
| 4   | Vol−     | Vol+     | Mute      |
| 5   | Shows    | Apps     | Google    |

All buttons use `onPressIn` / `onPressOut` (not `onPress`) to enable hold and repeat detection.

### Debounce

A 250ms gate prevents sending commands faster than once per 250ms. Arrow keys bypass this for the initial press because they go through the repeat system instead.

A second debounce system (`dbStart`/`dbStop`, 70ms) is used for buttons where a short tap must be distinguished from a long-hold, allowing ghost touches to be ignored.

### Repeat and Scrubbing (Arrow Keys)

Arrow keys use a hold-aware repeat system:

1. **Tap** (press + release before 400ms): sends one key command on release
2. **Hold ≥ 400ms (non-LR)**: sends the first command immediately, then repeats: slow (500ms) for the first 4, then fast (100ms); Fire TV uses 0ms delay and burst (`n=18` right / `n=6` left when fast)
3. **Hold ≥ 400ms (Left/Right)**: instead of key repeat, starts the **scrub loop** on the tv-tv server if Emby is playing. The app sends `scrub/start` with `distTicks` (±10,000,000 ticks = ±1 second) and `intervalMs`. While scrubbing, a `scrub/ping` is sent every 500ms as a dead-man signal; the server stops automatically if pings stop. On release, `scrub/stop` is sent.
4. If `scrub/start` returns `ok: false` (Emby not playing), falls back to normal key repeat.

### Long-Press Actions

The `lpStart` helper implements a two-phase timer: 70ms debounce then 400ms long-press threshold.

| Button | Short press                   | Long press                 |
| ------ | ----------------------------- | -------------------------- |
| Emby   | Launch Emby app               | Open streaming apps pane   |
| Apps   | Open streaming apps pane      | Switch to Fire TV mode     |
| Vol−   | Step volume down 1            | Open picture settings pane |
| Vol+   | Step volume up 1              | Open subtitle control pane |
| Back   | Send Back key (70ms debounce) | —                          |
| Home   | Send Home key (70ms debounce) | —                          |
| Skip   | Send skipIntro WS message     | —                          |
| Shows  | Open shows pane               | —                          |
| Mute   | Toggle mute                   | —                          |
| OK     | Send OK key (70ms debounce)   | —                          |

**Vol step:** Both Vol− and Vol+ send 5 rapid HTTP calls (40ms apart) for a short press.

**Google button:** Short hold (400ms) calls `/tv/googlebtn` to switch to Google TV. If the TV is already in Google mode, pressing Google turns the TV off instead.

**Fire button:** Same pattern — switches to Fire TV, or turns off if already in Fire mode.

### Skip Intro System

The Skip button sends a `skipIntro` WebSocket message with `pressedAt` (the exact millisecond the button fired). The srvr uses this timestamp along with Emby's current playback position (fetched at processing time) to compute the precise seek target, compensating for the delay between button press and server processing. The show must have an `introDur` configured on the server.

### Collision Avoidance

Multiple remotes (phone + web client) can be active simultaneously. When one client sends `tvRemoteAction`, the server forwards it to all other clients. Each receiving client enters an **avoidance window** (1.5s normally, 5s if the action was from the subtitle controller) during which button presses are blocked.

If a button is pressed while avoidance is active, the client sends `tvRemoteCollision`, causing the server to lock all clients. The lock overlay is shown on screen. To unlock, the user must press-and-hold the **Unlock** button for 500ms.

---

## TV Modes

The app continuously tracks the TV's active mode via WebSocket (`tvMuteState` push) and the initial `pollMute` HTTP fetch. The mode is derived from `haState` (HA power state) and `mediaTitle` (the current Bravia media title from Home Assistant):

| `haState`                         | `mediaTitle`                | Mode     |
| --------------------------------- | --------------------------- | -------- |
| `off` / `unavailable` / `unknown` | —                           | `off`    |
| on                                | `Smart TV`                  | `google` |
| on                                | `TV`                        | `tv`     |
| on                                | `Fire TV Stick` or `HDMI 2` | `fire`   |
| on                                | anything else               | `other`  |

- **`off` / `other`**: all button commands are blocked (no-op)
- **`google` / `tv`**: Bravia IRCC keys via Home Assistant `remote.send_command`
- **`fire`**: Android `input keyevent` via ADB to the Fire TV Stick

The **streaming apps pane** is populated from `services.json` using the current mode as a key. In `google` mode, apps are Sony Bravia Android TV activity URIs launched via HA `media_player.play_media`. In `fire` mode, they are Fire TV package/activity names launched via ADB `am start`.

---

## Mark and Linda Mode

A persistent `layoutOption` setting (stored in `AsyncStorage`) toggles between two user profiles:

- **`mark`** (default): Subtitle mismatch warnings are displayed as overlay alerts. Subtitle control subpane is available from long-press Vol+.
- **`linda`**: Subtitle mismatch overlays are suppressed.

The setting is toggled by a dedicated `toggleLayoutOption` function (wired in the web client; the Android app stores and loads it but the toggle button is not currently visible in the Android UI grid — the grid shows fixed buttons).

---

## Panes and Subpanes

The app renders one of four full-screen views based on state flags:

### 1. Main Remote Grid (default)

The 3×5 button grid. Button colors flash orange momentarily on press. The Mute button is green when unmuted, red when muted. The Google/Fire buttons highlight blue when that mode is active.

### 2. Streaming Apps Pane (`showStreamers`)

A scrollable grid of streaming service logos and names. Netflix, Prime Video, and HBO Max appear in a pinned row at the top. Tapping any service opens that app on the TV via `GET /tv/openapp`. The available services depend on the current TV mode (Google vs. Fire).

### 3. Shows Pane (`showShows`)

A full-screen show browser with five tabs: **List**, **Info**, **Map**, **Actors**, **Stats**.

**Header:** Shows the currently selected show name and S/E code. Tapping toggles between "follow playing" (tracks whatever Emby is currently playing) and "selected" (the manually chosen show). When follow-playing is active, the shows pane auto-scrolls to and highlights the currently playing show and episode.

**List tab:** Alphabetically sorted list of all shows in Emby. Shows marked `notReady: false` display a `+` badge. Shows with a `waitStr` (download waiting status) display that string. A search bar filters the list. Selecting a show saves it to `AsyncStorage` and switches to the Info tab.

**Info tab:** Show poster (tap to expand full-width), plus metadata: first/last aired dates, status, country/language, network, genres, runtime, season/episode count, watched count. Tapping the metadata box opens the show's IMDb page if available.

**Map tab:** Season/episode grid. Columns = seasons, rows = episode numbers. Each cell shows availability (`+` = available, `-` = missing) and watched status (`W` = watched, `U` = unaired). Missing/unavailable cells are highlighted red. Selecting a cell sets `selectedSE`. Below the grid, a selected-episode info panel shows the title, air date, a playback progress bar (when follow-playing), a still image (tap to expand), and the episode overview. The map data comes from Emby (if the show is in Emby) or TVDB as fallback.

**Actors tab:** Cast grid with photos, actor names, and character names for the selected show (from TVDB). If an episode is selected, guest actors from TMDB are shown in a separate section below the regular cast. Crew members appear in a third section. Tapping any actor/crew opens their IMDb page via `/api/getActorPage`.

**Stats tab:** Technical file metadata for the selected season/episode, fetched from `/api/episodeStats`. Displayed as a two-column key/value list. Includes: file name, show/season/episode, air date, file size, duration, video bit depth, bit rate, frame rate, resolution, HDR type, audio channels, PTT-parsed metadata (source, codec, release group, language, audio format, proper/repack/extended flags).

### 4. Subtitle Control Pane (`showSubCtrl`)

Opens only when in `google` or `fire` mode. Polled every 3s (2s after a track change). Lists all active Emby sessions. The header shows the current player's show name, episode code, and device name (tapping cycles through active players).

Subtitle tracks are listed as tappable cards. Track type indicators:

- `*` = PGS (Blu-ray bitmap)
- `T` = Embedded text
- `+` = ASR (auto-generated speech recognition)
- `>` = MBS (MovieSubtitles)
- `V` = OpenSubtitles
- `S` = External SRT / other

Selecting a track sends `POST /tv/emby/subtitle`, which navigates the Bravia TV's OSD via IRCC key sequences to select the track. An optimistic UI update shows the selection immediately. A confirmation poll follows to detect when Emby confirms the change. Only the Living Room TV player supports subtitle navigation; other devices show a "not supported" message.

### 5. Picture Settings Pane (`showPicCtrl`)

Polled every 3s. Displays Bravia picture quality settings fetched from the Sony REST API (`GET /tv/picture`). Each setting has:

- `▼` / `▲` arrows to step through values
- For range settings: an inline text input for direct numeric entry (committed on blur or after 750ms idle)
- For enum settings: current value display

Settings include: Picture Mode, Brightness, Contrast, Sharpness, Color, Hue, Color Temperature, HDR Mode, Local Dimming, Light Sensor.

---

## Remote Resources

### Home Assistant (`hahnca.com:8123`)

The tv-tv server maintains a persistent WebSocket connection to HA. Key entity IDs:

- `media_player.bravia_k_65xr70` — Sony Bravia 65" XR70 (Living Room TV)
- `remote.bravia_k_65xr70` — Bravia remote (IRCC key injection)
- `media_player.fire_tv_192_168_1_47` — Fire TV Stick
- `remote.fire_tv_192_168_1_47` — Fire TV remote

HA is used for: TV power on/off, mute, volume, IRCC key injection for Google TV navigation, and CEC-based Fire TV wakeup.

### Bravia TV (Living Room TV, Sony Bravia 7 K-65XR70)

- **IP:** `192.168.1.85`
- **Navigation keys:** Sent via HA `remote.send_command` using IRCC command names (`Up`, `Down`, `Left`, `Right`, `Confirm`, `Return`, `Home`, `ClosedCaption`, `VolumeUp`, `VolumeDown`)
- **Text/keyevent input:** Via persistent ADB shell (`adb -s 192.168.1.85:5555 shell`)
- **Picture settings:** Direct Sony REST API (`POST /sony/video` with PSK auth)
- **Subtitle navigation:** IRCC key sequences (Down → Right → Confirm etc.) that navigate the TV's on-screen OSD
- **App launching (Google TV):** HA `media_player.play_media` with `media_content_type: "app"` and a Sony activity URI

### Fire TV Stick

- **IP:** `192.168.1.47`
- **Navigation keys:** Via persistent ADB shell (`adb -s 192.168.1.47:5555 shell`) using Android keycodes
- **App launching:** `adb shell am start -n <package>/<activity>`
- **Power:** HA `media_player.turn_on` (triggers CEC wakeup)
- If HDMI 2 is selected but reports no CEC signal, the server automatically wakes the Fire Stick

### Emby (`hahnca.com:8920`)

The tv-tv server connects to Emby's WebSocket (`ws://127.0.0.1:8096/embywebsocket`) to receive session updates. Emby's REST API is used for:

- Subtitle track selection (via `Sessions/{id}/Playing/Seek` and subtitle API)
- Fetching session state and playback position
- Episode media stream metadata

The srvr server uses Emby as the source of truth for now-playing state, watched status, and the series map grid.

### TMDB / TVDB (External)

- **TMDB:** Episode guest actors, overview, still images, air dates (via `/api/getTmdb`)
- **TVDB:** Primary show database; show posters, metadata, series maps for shows not in Emby; actor/crew lists with images and TVDB person IDs (resolved to IMDb URLs via `/api/getActorPage`)
- **IMDb:** Actor pages opened via `Linking.openURL` (external browser)
