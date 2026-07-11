# TV / Emby control & status interfaces

Your memory is right — there are **four** distinct interfaces the app uses to
control and read status from the Bravia 7 TV and the Google-Android-TV built
into it (plus a Fire TV stick as an alternate device).

Important framing: **the app itself (web client + Android app) does not talk to
the TV or HA directly.** It talks to a small Node/Express **TV server**
(`apps/tv/src/main.js`, listening on port **3004**, running on hahnca.com) via
`/tv/*` HTTP endpoints. That TV server is what owns three of the four
interfaces below. The one exception is Emby _show/playback_ control, which the
web client also does directly from `apps/client/src/emby.js`.

```
                        ┌────────────────────────────────────────┐
  web client  ─┐        │  TV server  apps/tv/src/main.js :3004   │
  android app ─┼─/tv/*─►│                                         │
               │        │  (1) Emby WS + REST   ws :8096 / :8920  │──► Emby
  web client ──┼─direct─┼─────────────────────────────────────────┼──► Emby (play/stop, watched)
   (emby.js)   │        │  (2) Home Assistant WebSocket  wss:8123 │──► HA ──► TV
               │        │  (3) Remote keys (HA remote / adb)      │──► TV / Fire TV
               │        │  (4) Bravia picture-settings REST       │──► TV (192.168.1.86)
               │        └────────────────────────────────────────┘
```

---

## 1. Emby — REST API + WebSocket (controls & status)

Two consumers, two connections:

### a) TV server → Emby (server-local)

`apps/tv/src/main.js`

- **WebSocket:** `ws://127.0.0.1:8096/embywebsocket?api_key=<key>&deviceId=tv-server`
  (loopback because the TV server runs on the same host as Emby).
  On open it sends `{ MessageType: "SessionsStart", Data: "0,1500" }` and then
  receives periodic **`Sessions`** messages. From those it reads _status_:
  - what's now playing (`NowPlayingItem` — series, season/episode, item id)
  - play state (`IsPaused`, `PositionTicks`, `RunTimeTicks`)
  - current subtitle stream index, remote-control capability, active device
  - It relays now-playing + subtitle-mismatch info back to the `srvr` app on
    `127.0.0.1:8739`.
- **REST** (`http://127.0.0.1:8096/emby`, `api_key` = `1c399bd0…`):
  playback _control_ used by the `/tv/emby/*` endpoints —
  `Sessions/{id}/Playing/seek`, `.../Pause`, subtitle selection, plus reading
  `Sessions` and item `MediaSources`.

### b) Web client → Emby (direct, over the internet)

`apps/client/src/emby.js`, `apps/client/src/urls.js`

- Base host `https://hahnca.com:8920/emby`.
- **Auth:** `POST /Users/AuthenticateByName` with username/pwd + api_key →
  `AccessToken`, then all calls carry `X-Emby-Token`.
- This connection is mostly _show data_ (you said you're not interested in that
  part), **but** it also does real control/status:
  - `startStop()` — plays/stops an episode on a device via
    `Sessions/{sessionId}/Playing?PlayCommand=PlayNow` and `.../Playing/stop`.
  - toggles watched (`Items/{id}/UserData`), reads sessions/devices.

**Summary:** Emby is used both as status (what's playing, position, paused,
subtitle track) and as control (play, stop, seek, pause, watched, subtitle
index). The server side prefers the loopback WebSocket for live status; the
client uses the public HTTPS REST endpoint.

---

## 2. Home Assistant — WebSocket (`wss://hahnca.com:8123/api/websocket`)

`apps/tv/src/main.js` (`connectHa`), also standalone helpers `apps/tv/bravia.js`
and `apps/tv/bravia2.js`.

- **Connect / auth:** open the WebSocket, HA sends `auth_required`, server
  replies `{ type:"auth", access_token:<long-lived JWT> }`, HA replies
  `auth_ok`. The token is a hard-coded long-lived access token (expires 2036).
- **Status:** after auth it sends `get_states` once and
  `subscribe_events` for `state_changed`. It tracks the Bravia
  `media_player.bravia_k_65xr70` entity and keeps live copies of:
  - `state` → power on/off (`braviaHaPower`)
  - `is_volume_muted` (`braviaHaMuted`)
  - `media_content_type` and `media_title` — used to infer the current "mode":
    `media_title` of `"Smart TV"` → google, `"TV"` → tv,
    `"Fire TV Stick"`/`"HDMI 2"` → fire.
    It also watches the Fire TV entities.
- **Control** (via `callService` / `sendCmd` → `call_service` messages):
  - **Power:** `media_player.turn_on` / `turn_off` on the Bravia entity.
  - **Volume / mute:** `remote.send_command` with `VolumeUp` / `VolumeDown` /
    `Mute` on `remote.bravia_k_65xr70` (the older `bravia.js` CLI uses
    `media_player.volume_up/down/mute` instead).
  - **Source / app launch:** `media_player.select_source` (e.g. Emby) and
    `media_player.play_media` with `media_content_type:"app"` to open an app.
  - **Remote keys** — see interface #3.

### Is there also a REST API to HA?

Yes — Home Assistant does expose a REST API (`https://<host>:8123/api/...` with
the same bearer token), **but this codebase does not use it.** Every HA
interaction here goes over the WebSocket API. So functionally, for this app,
HA = WebSocket only.

### What HA controls on the TV

Power on/off, volume/mute, input-source selection, launching apps, and it is the
transport for the arrow/OK/Home/Back remote keys on the **Bravia** (Google) side.
It's also the primary **status** source for TV power, mute, and which
input/app is showing.

---

## 3. Remote-control keys sent to the TV

`apps/tv/src/main.js` — `GET /tv/key/:key`, `/tv/vol/:dir`, `/tv/mute`,
scrub endpoints, and the subtitle-nav IRCC sequences.

There are **two delivery paths**, chosen by `tvMode`:

### Bravia / Google TV mode → HA `remote.send_command`

Named commands sent to `remote.bravia_k_65xr70` over the HA WebSocket:

| app key            | HA command                 |
| ------------------ | -------------------------- |
| ok                 | `Confirm`                  |
| up/down/left/right | `Up`/`Down`/`Left`/`Right` |
| home               | `Home`                     |
| back               | `Return`                   |
| captions           | `ClosedCaption`            |
| vol up/dn          | `VolumeUp` / `VolumeDown`  |
| mute               | `Mute`                     |

- Arrow keys are sent **directly** on the WebSocket (`ws.send`) for lower
  latency; other keys go through `sendCmd` (which adds a ~100 ms delay + id).
- Sony **IRCC** key _sequences_ are used for the on-screen subtitle-menu
  navigation (a scripted series of Down/Right/Confirm/Return with tuned delays,
  the `SUB_NAV_*` constants).

### Fire TV mode → adb `input keyevent`

When `tvMode === "fire"`, keys go straight to the Fire TV stick
(`192.168.1.47`) over **adb** using numeric Android keycodes:

| app key            | KEYCODE           |
| ------------------ | ----------------- |
| ok                 | 23 (DPAD_CENTER)  |
| up/down/left/right | 19 / 20 / 21 / 22 |
| home               | 3                 |
| back               | 4                 |

Sent either through a persistent adb shell (`fireKeyevent`) or a one-shot
`adb … shell input keyevent …`. App launching in fire mode uses
`adb shell am start -n <uri>`.

> Note: the older direct-adb-to-Bravia path (`/tv/keyevent`, `/tv/text`,
> `spawnBraviaShell`) is commented out/disabled — Bravia keys now go via HA.

---

## 4. TV picture/settings interface — Bravia REST (JSON-RPC over HTTP)

`apps/tv/src/main.js` — `getBraviaSetting` / `setBraviaSetting`,
`GET/POST /tv/picture`.

This is Sony's **IP-control REST API**, hit **directly on the TV's LAN IP**,
completely separate from HA:

- **Endpoint:** `http://192.168.1.86/sony/video`
- **Auth:** header `X-Auth-PSK: qwerty` (pre-shared key set on the TV).
- **Protocol:** JSON-RPC-style body —
  `{ method, params, id, version }`.
  - **Read:** `getPictureQualitySettings` with `params:[{target}]` →
    returns `currentValue` plus candidate range (`min`/`max`/`step`) or enum
    options.
  - **Write:** `setPictureQualitySettings` with
    `params:[{ settings:[{ target, value }] }]`.
- **Settings exposed** (`PIC_TARGETS` / `PIC_LABELS`):
  Picture Mode, Brightness, Contrast, Sharpness, Color, Hue, Color Temp,
  HDR Mode, Local Dimming (autoLocalDimming), Light Sensor.

The `GET /tv/picture` endpoint returns all of these (with their ranges/options)
so the app can render sliders/dropdowns; `POST /tv/picture {target,value}`
writes one back.

---

## Quick reference — connection facts

| #   | Interface                | Endpoint                                                                  | Auth                     | Direction                               |
| --- | ------------------------ | ------------------------------------------------------------------------- | ------------------------ | --------------------------------------- |
| 1a  | Emby WebSocket (status)  | `ws://127.0.0.1:8096/embywebsocket`                                       | `api_key`                | read now-playing/position/subtitle      |
| 1b  | Emby REST (control)      | `http://127.0.0.1:8096/emby` and client `https://hahnca.com:8920/emby`    | api_key / `X-Emby-Token` | play/stop/seek/pause/watched            |
| 2   | Home Assistant WebSocket | `wss://hahnca.com:8123/api/websocket`                                     | long-lived JWT           | power/vol/mute/source/app/keys + status |
| 3   | Remote keys              | HA `remote.send_command` **or** adb `input keyevent` (Fire @192.168.1.47) | via #2 / adb             | control only                            |
| 4   | Bravia picture settings  | `http://192.168.1.86/sony/video`                                          | `X-Auth-PSK: qwerty`     | read/write picture params               |

All three "TV" interfaces (#2–#4) and the server-side half of #1 live in
`apps/tv/src/main.js`; the app reaches them through the TV server's `/tv/*`
endpoints on port 3004. The web client also talks to Emby directly via
`apps/client/src/emby.js`.
