---
description: tv server documentation and context
---

# tv — Server Documentation

> **Timestamp: 2026-05-24**
> ⚠️ Code changes frequently. This document describes the server as of the timestamp above. Details may be out of date.

---

## Overview

`apps/tv` is a Node.js Express server running on `hahnca.com` under pm2. Its sole purpose is **TV hardware control**: turning the TV on/off, switching inputs, sending remote-control keypresses, adjusting volume/mute, changing Emby playback (seek, subtitle selection), and reporting TV state to the `srvr` server.

It bridges three external systems:

- **Home Assistant (HA)** — via WebSocket for real-time state tracking and service calls (IR remote, Sony Bravia media_player)
- **Emby** — via WebSocket (session monitoring) and REST API (playback control)
- **ADB** — persistent shell connections to the Bravia TV and Fire TV Stick for keyevents and text input

Entry point: `apps/tv/src/main.js` (single file, ~1700 lines). No build step.

---

## Port

| Port | Protocol | Bound to       | Purpose                         |
| ---- | -------- | -------------- | ------------------------------- |
| 3004 | HTTP     | all interfaces | REST API consumed by the client |

---

## Physical Devices

| Constant            | Value                               | Description                   |
| ------------------- | ----------------------------------- | ----------------------------- |
| `BRAVIA_ENTITY_ID`  | `media_player.bravia_k_65xr70`      | Sony Bravia K 65XR70 in HA    |
| `REMOTE_ENTITY_ID`  | `remote.bravia_k_65xr70`            | Bravia IR remote entity in HA |
| `FIRE_TV_ENTITY_ID` | `media_player.fire_tv_192_168_1_47` | Fire TV Stick in HA           |
| `FIRE_TV_REMOTE_ID` | `remote.fire_tv_192_168_1_47`       | Fire TV remote entity in HA   |
| `FIRE_TV_IP`        | `192.168.1.47`                      | Fire TV Stick LAN IP (ADB)    |
| `BRAVIA_TV_IP`      | `192.168.1.85`                      | Sony Bravia LAN IP (ADB)      |

---

## TV Mode

`tvMode` is the central piece of in-memory state that most routes gate on:

| Value      | Meaning                                      |
| ---------- | -------------------------------------------- |
| `"google"` | Bravia is on, input = Google TV (Smart TV)   |
| `"fire"`   | Bravia is on, input = Fire TV Stick (HDMI 2) |
| `"tv"`     | Bravia is on, input = live TV                |
| `"off"`    | Bravia is off/unavailable/unknown            |
| `"other"`  | Bravia is on, input is something else        |

`tvMode` is derived from the Bravia HA `media_title` attribute and updated automatically from HA WebSocket events. Routes that control Google TV devices (`keyevent`, `text`, `key`, `vol`, `mute`) silently reject requests when `tvMode` is wrong.

---

## WebSocket Connections (outbound only)

This server is a **WebSocket client only** — it does not host a WebSocket server.

### Home Assistant WebSocket (`wss://hahnca.com:8123/api/websocket`)

Used to receive real-time TV state changes and issue service calls. On connect:

1. Authenticates with a long-lived HA access token
2. Issues `get_states` to initialize `braviaHaPower`, `braviaHaMuted`, `tvMode`
3. Subscribes to `state_changed` events

Watched HA entities: `BRAVIA_ENTITY_ID`, `REMOTE_ENTITY_ID`, `FIRE_TV_ENTITY_ID`, `FIRE_TV_REMOTE_ID`.

On Bravia state change the server:

- Updates `braviaHaPower`, `braviaHaMuted`, `tvMode`
- Handles the `pendingGoogleHome` flag — if the TV just turned on because of a `googlebtn` request, automatically sends a Home key and then launches Emby
- Auto-wakes the Fire Stick when HDMI 2 is selected but no CEC signal is present
- Calls `pushTvState()` to report the new state to srvr

Reconnects automatically with a 5-second delay on close.

### Emby WebSocket (`ws://127.0.0.1:8096/embywebsocket`)

On connect, subscribes to session updates with a 1500 ms push interval (`SessionsStart`). On each `Sessions` message:

- Calls `handleEmbySession()` per session to track `activeDevice` (the device currently playing)
- Calls `updateNowPlaying()` to send now-playing show info to srvr (deduped by show/device/episode/pause state, excluding position ticks from dedup key)
- Calls `checkSubtitleMismatch()` to detect when the wrong subtitle track is selected

Reconnects automatically with a 5-second delay on close.

---

## ADB Connections

Two persistent ADB shell processes are maintained to avoid the per-command `adb connect` latency.

| Target              | Used for                                                   |
| ------------------- | ---------------------------------------------------------- |
| `BRAVIA_TV_IP:5555` | `input keyevent <code>` and `input text '<text>'` commands |
| `FIRE_TV_IP:5555`   | `input keyevent <keycode>` commands for Fire TV navigation |

Each shell reconnects automatically (2-second delay) if the process exits. ADB device connection is re-established with `adb connect` on each reconnect.

The Fire TV shell is also used by the scrubbing loop and bulk keyevent sequences. Individual `adb exec` calls fall back to spawning a new `adb -s ...` process if the persistent shell is not ready.

---

## HTTP Endpoints Provided (port 3004)

All routes are under the `/tv/` prefix. Responses are JSON `{ ok: true|false, ... }`.

### Power & Input

| Method | Path             | Description                                                                                                                                                            |
| ------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/tv/on`         | Turn on the Bravia (HA `media_player.turn_on`)                                                                                                                         |
| GET    | `/tv/off`        | Turn off Bravia and remote; notifies srvr of power-off state                                                                                                           |
| GET    | `/tv/googlebtn`  | Turn on Bravia + send Home key + launch Emby on Google TV. If TV is already on, acts immediately; if off, sets `pendingGoogleHome` and waits for the HA power-on event |
| GET    | `/tv/firebtn`    | Turn on Fire TV via HA, then send Home keyevent and launch Emby (5-second delay)                                                                                       |
| GET    | `/tv/mode/:mode` | Legacy route — same logic as `googlebtn`/`firebtn` but selects mode `google` or `fire` explicitly; notifies srvr                                                       |
| GET    | `/tv/emby`       | Launch Emby on whichever device is active (`tvMode`)                                                                                                                   |
| GET    | `/tv/openapp`    | `?uri=<appUri>` — launch any app by URI. Google TV: HA `play_media`; Fire TV: ADB `am start`                                                                           |

### Remote Control

| Method | Path                 | Description                                                                                                                                                                                                                                                                                                       |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/tv/key/:key`       | Send a logical key: `ok`, `up`, `down`, `left`, `right`, `home`, `back`, `captions`. Dispatches via HA IRCC for Google TV, or ADB keyevent for Fire TV. Arrow keys bypass the `sendCmd` queue and go directly on the WebSocket for lower latency. Fire TV supports `?n=<count>` to repeat the key up to 20 times. |
| GET    | `/tv/keyevent/:code` | Send a raw Android keyevent code (uppercase alphanumeric + underscore) to the Bravia via ADB. Only allowed when `tvMode` is `google` or `tv`.                                                                                                                                                                     |
| GET    | `/tv/text`           | `?t=<text>` — send text input to the Bravia via ADB `input text`. Only allowed when `tvMode` is `google` or `tv`. Shell-escapes single quotes.                                                                                                                                                                    |

### Volume & Mute

| Method | Path            | Description                                                                                                |
| ------ | --------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/tv/vol/:dir`  | `dir` = `up` or `down` — sends `VolumeUp`/`VolumeDown` IRCC via HA remote                                  |
| GET    | `/tv/mute`      | Toggle mute via HA `media_player.volume_mute` (uses current `braviaHaMuted`)                               |
| GET    | `/tv/mutestate` | Returns `{ muted, power, activeDevice }` from in-memory state                                              |
| GET    | `/tv/status`    | Returns full in-memory state: `{ entity, state, mode, muted, mediaContentType, mediaTitle, activeDevice }` |

### Emby Playback Control

| Method | Path                       | Description                                                                                                                                                                                                                    |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/tv/emby/playing`         | Returns sessions that have something playing, with subtitle stream list (English/external only) and `chosenSubIndex` from srvr's preferred-subtitle lookup                                                                     |
| GET    | `/tv/emby/position`        | Returns playback position in Emby ticks for the Living Room TV session                                                                                                                                                         |
| POST   | `/tv/emby/seek`            | `{ ticks }` — direct seek on the Living Room TV Emby session                                                                                                                                                                   |
| POST   | `/tv/emby/seek2`           | `{ ticks, d3ms }` — pause → seek → pause → wait `d3ms` ms; designed to reduce stutter                                                                                                                                          |
| POST   | `/tv/emby/scrub/start`     | `{ intervalMs, distTicks }` — start a server-side seek loop that repeatedly seeks by `distTicks` every `intervalMs` ms (used for timeline scrubbing). Has a 1-second dead-man timer — must receive `/scrub/ping` to keep alive |
| POST   | `/tv/emby/scrub/ping`      | Reset the dead-man timer for an active scrub loop                                                                                                                                                                              |
| POST   | `/tv/emby/scrub/stop`      | Stop the scrub loop                                                                                                                                                                                                            |
| POST   | `/tv/emby/subtitle`        | `{ sessionId, index }` — navigate the Bravia on-screen OSD via IRCC key sequence to select subtitle stream `index` (-1 = None). Responds immediately with `{ waitMs, navMs }` then runs the key sequence asynchronously        |
| POST   | `/tv/emby/subtitle-offset` | `{ sessionId, offsetMs }` — set subtitle delay via Emby `SetSubtitleDelay` command                                                                                                                                             |

### Bravia Picture Quality

| Method | Path          | Description                                                                                                                                                                                                                                                                         |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/tv/picture` | Returns all tracked picture quality settings from the Bravia REST API (brightness, contrast, sharpness, color, hue, colorTemperature, pictureMode, autoLocalDimming, lightSensor, hdrMode). Each setting includes type (`range` or `enum`), current value, and valid range/options. |
| POST   | `/tv/picture` | `{ target, value }` — update a single picture quality setting via the Bravia REST API                                                                                                                                                                                               |

---

## Endpoints Consumed (outbound calls)

### Home Assistant Services (via HA WebSocket)

`callService(domain, service, entityId, serviceData)` sends HA service calls on the WebSocket connection.

| Domain         | Service        | Entity           | When used                                      |
| -------------- | -------------- | ---------------- | ---------------------------------------------- |
| `media_player` | `turn_on`      | Bravia / Fire TV | Power on                                       |
| `media_player` | `turn_off`     | Bravia           | Power off                                      |
| `media_player` | `play_media`   | Bravia           | Launch app by URI on Google TV                 |
| `media_player` | `volume_mute`  | Bravia           | Mute toggle                                    |
| `remote`       | `send_command` | Bravia remote    | IRCC keypresses (navigation, volume, captions) |
| `remote`       | `turn_off`     | Bravia remote    | Power off                                      |

### Emby REST API (`http://127.0.0.1:8096/emby`)

| Method | Path                                                  | Purpose                                          |
| ------ | ----------------------------------------------------- | ------------------------------------------------ |
| GET    | `/emby/Sessions`                                      | List active sessions                             |
| GET    | `/emby/Users/{userId}/Items/{id}?Fields=MediaSources` | Fetch media stream list for subtitle selection   |
| POST   | `/emby/Sessions/{id}/Playing/seek`                    | Seek to position                                 |
| POST   | `/emby/Sessions/{id}/Playing/Pause`                   | Pause / unpause                                  |
| POST   | `/emby/Sessions/{id}/Command`                         | Send general commands (e.g., `SetSubtitleDelay`) |

### Bravia Picture API (`http://192.168.1.85/sony/video`)

Direct HTTP POST with PSK auth header (`X-Auth-PSK: qwerty`). JSON-RPC style.

| Method called               | Purpose                       |
| --------------------------- | ----------------------------- |
| `getPictureQualitySettings` | Read current picture settings |
| `setPictureQualitySettings` | Write one picture setting     |

### srvr Internal API (`http://127.0.0.1:8739`)

| Method | Path                           | When sent                                                                           |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------- |
| POST   | `/internal/nowPlaying`         | Every Emby session update when now-playing info changes                             |
| POST   | `/internal/tv-state`           | On every Bravia HA state change, and every 2 seconds via interval                   |
| GET    | `/internal/chksrt/preferred`   | During `/tv/emby/playing` and `checkSubtitleMismatch` to look up preferred subtitle |
| POST   | `/internal/subtitle-mismatch`  | When subtitle mismatch is detected                                                  |
| POST   | `/internal/chksrt/mark-warned` | After subtitle mismatch notification is sent (prevents repeat)                      |

---

## Background Tasks

| Task                    | Interval                       | Description                                                     |
| ----------------------- | ------------------------------ | --------------------------------------------------------------- |
| `pushTvState`           | 2 s                            | Push current TV power/mode/mute/state to srvr internal endpoint |
| `checkSubtitleMismatch` | per Emby session push (~1.5 s) | Detect and report wrong subtitle track for the Living Room TV   |

---

## Subtitle OSD Navigation

`POST /tv/emby/subtitle` implements a fully automated subtitle-selection flow by replaying a hardcoded IRCC key sequence that navigates the Bravia's playback overlay:

1. **Pre-sequence** — 2× Down + Return to dismiss any open overlay
2. **Open OSD** — Down to open the playback info bar
3. **Navigate to subtitle menu** — 2 or 3 Right arrows (3 when multiple audio tracks exist)
4. **Open subtitle list** — Confirm
5. **Select entry** — N× Down arrows (0 = "None", 1 = first subtitle stream, etc.)
6. **Confirm + dismiss** — Confirm + Return

All delays are tunable via constants at the top of `main.js`. The endpoint responds with `{ waitMs, navMs }` before running the sequence so the client can show a progress indicator.

---

## Data Files

| File            | Location                | Description                                                                                                                                                                                                                       |
| --------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services.json` | `apps/tv/services.json` | Static list of streaming apps available on Google TV. Each entry has `name`, `uri` (Android activity URI for `am start` / HA `play_media`), `color` (hex), and `logo` (filename). Used by client to render the app-launcher pane. |

No writable data files — all runtime state is in-memory.

---

## Dependencies

| Package          | Purpose                                     |
| ---------------- | ------------------------------------------- |
| `express`        | HTTP server framework                       |
| `cors`           | CORS middleware (all origins allowed)       |
| `ws`             | WebSocket client (HA and Emby connections)  |
| `node-broadlink` | Listed in package.json; not used in main.js |

Node built-ins used: `child_process` (`exec`, `spawn`) for ADB.

---

## Logging

All log lines go to **stdout** only (no log files). pm2 captures stdout/stderr.

Format: `[TV MM-DD HH:mm] <message>` (PST/Los Angeles timezone)

Prefix `[TV MM-DD HH:mm] ERROR` is used for error lines. Device-specific prefixes `[fire]` and `[bravia]` appear within the message body.

Logged events include: WebSocket connect/disconnect, HA state changes, service calls, ADB command results, subtitle navigation steps, Emby seek operations, and client identity (web browser vs Android phone by User-Agent).
