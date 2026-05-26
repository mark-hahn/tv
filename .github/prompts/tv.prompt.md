---
description: tv server documentation and context
---

> **Timestamp: 2026-05-24** — Code changes frequently. Verify against `apps/tv/src/main.js`.

# TV Server (`apps/tv`)

## Key Facts
- Port **3004** HTTP. Entry: `apps/tv/src/main.js` (~1700 lines, single file). No build step.
- Bridges Home Assistant (HA), Emby, and ADB to provide TV hardware control.

## Physical Devices
| Constant | Value | Description |
|---|---|---|
| `BRAVIA_ENTITY_ID` | `media_player.bravia_k_65xr70` | Sony Bravia K 65XR70 in HA |
| `REMOTE_ENTITY_ID` | `remote.bravia_k_65xr70` | Bravia IR remote in HA |
| `FIRE_TV_ENTITY_ID` | `media_player.fire_tv_192_168_1_47` | Fire TV Stick in HA |
| `BRAVIA_TV_IP` | `192.168.1.85` | Bravia ADB IP |
| `FIRE_TV_IP` | `192.168.1.47` | Fire TV ADB IP |

## `tvMode` Values
`google` (Bravia on, Google TV input) · `fire` (Bravia on, HDMI 2) · `tv` (live TV) · `off` · `other`
Derived from HA `media_title`. Most control routes are gated on `tvMode`.

## Outbound Connections
- **HA WebSocket** `wss://hahnca.com:8123/api/websocket` — real-time state, service calls. Reconnects on close (5s delay).
- **Emby WebSocket** `ws://127.0.0.1:8096/embywebsocket` — session monitoring at 1500ms interval; now-playing, subtitle mismatch.
- **ADB persistent shells** — one to Bravia (`192.168.1.85:5555`), one to Fire TV (`192.168.1.47:5555`). Reconnect on exit (2s delay).

## Key Endpoint Groups (all under `/tv/`)
| Group | Paths | Notes |
|---|---|---|
| Power/input | `/tv/on`, `/tv/off`, `/tv/googlebtn`, `/tv/firebtn`, `/tv/emby`, `/tv/openapp` | Mode switches + app launch |
| Remote keys | `/tv/key/:key`, `/tv/keyevent/:code`, `/tv/text` | Navigation, ADB text input |
| Volume | `/tv/vol/:dir`, `/tv/mute`, `/tv/mutestate`, `/tv/status` | Vol up/down, mute toggle |
| Emby playback | `/tv/emby/playing`, `/tv/emby/seek`, `/tv/emby/seek2`, `/tv/emby/scrub/*`, `/tv/emby/subtitle`, `/tv/emby/subtitle-offset` | Seek, scrub loop, subtitle select |
| Picture | `GET/POST /tv/picture` | Bravia picture quality via Sony REST API (`http://192.168.1.85/sony/video`, PSK auth `qwerty`) |

## Key Behaviors
- `googlebtn`: if TV off → turn on + set `pendingGoogleHome` → on HA power-on event → send Home + launch Emby
- `scrub/start`: server-side seek loop; must receive `scrub/ping` every ~500ms (dead-man timer) or loop stops
- `subtitle`: navigates Bravia OSD via IRCC key sequence to select subtitle stream by index
