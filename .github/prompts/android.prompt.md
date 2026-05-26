---
description: Android TV remote app documentation and context
---

> **Warning:** Generated **2026-05-24**. Verify against `apps/android/App.js`.

# Android App (`apps/android`)

## Key Facts
- React Native / Expo single-file app: `App.js`. All state, logic, and UI in one file.
- APK built via `./build-apk` script (Gradle on remote server). **Do not use `eas build`.**
- Persists `layoutOption` (mark/linda) to `AsyncStorage`.

## Server Communication
- **tv-tv** `https://hahnca.com/tv-tv` (port 3004) — TV hardware control (keys, volume, mute, Emby seek/scrub/subtitles, picture)
- **tv-srvr** `https://hahnca.com/tv-srvr` — show data (getAllTvdb, getSeriesMapFromEmby/Tvdb, episodeStats)
- **WebSocket** `wss://hahnca.com/tv-srvr` — persistent, auto-reconnect (2s). Push: `tvMuteState`, `tvRemoteAction`, `tvRemoteLock`, `tvRemoteUnlock`, `missingEpisodeWarning`, `subtitleMismatch`, `nowPlaying`

## Button Grid (3 × 5)
| Left | Center | Right |
|---|---|---|
| Back | Up | Home |
| Left | OK | Right |
| Emby | Down | Skip |
| Vol− | Vol+ | Mute |
| Shows | Apps | Google |

All buttons use `onPressIn`/`onPressOut`. 250ms send gate; 70ms debounce for tap-vs-hold.

## Key Behaviors
- **Vol buttons**: send 5 rapid HTTP calls 40ms apart
- **Arrow keys hold (≥400ms) Left/Right**: starts **scrub loop** on tv-tv server (`scrub/start`, `scrub/ping` every 500ms, `scrub/stop` on release)
- **Google/Fire hold (400ms)**: switch mode; if already in that mode → turn TV off
- **Skip**: sends `skipIntro` WS message with `pressedAt` timestamp for server-side compensation
- **Collision avoidance**: `tvRemoteAction` → 1.5s avoidance window on receiving clients; collision → server locks all; hold Unlock 500ms to release

## TV Mode (tracked via WS `tvMuteState`)
`google` (Smart TV) · `fire` (Fire TV Stick/HDMI 2) · `tv` (live TV) · `off` · `other`
`off`/`other`: buttons no-op. `google`/`tv`: Bravia IRCC via HA. `fire`: ADB keyevent.

## Mark / Linda Mode
`mark`: subtitle mismatch overlay shown, subtitle subpane available via long-press Vol+
`linda`: subtitle mismatch overlays suppressed
