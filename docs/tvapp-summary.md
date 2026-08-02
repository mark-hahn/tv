# tvapp and tvapprc — Architecture Summary

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
