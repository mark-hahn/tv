# Plan (revised): Intro editing via the Emby web tab + Tampermonkey overlay

Revised per [emby-page-response.md](emby-page-response.md).

**Narrowed scope:** Only **intro** moves to the Emby web page. **Play and chksrt keep the
existing `video-player.vue` pane unchanged** (this resolves the old I1/I2). The normal Emby
skip button stays for every Emby opening **except** when opened with the intro UI.

Browser only (not Android).

---

## 1. What changes vs. what stays

| Flow                    | Before                                | After                                                                                     |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Play**                | `video-player.vue` mode `null`        | unchanged — keeps the video pane                                                          |
| **Chksrt**              | `video-player.vue` mode `"chksrt"`    | unchanged — keeps the video pane                                                          |
| **Intro**               | `video-player.vue` mode `"intro"`     | opens the **Emby web tab** with `tvui=intro`; a new thin overlay drives it over WebSocket |
| **Normal Emby viewing** | `emby-skip-intro.user.js` skip button | unchanged — skip button kept (suppressed only when `tvui=intro`)                          |

Two Tampermonkey scripts coexist on `https://hahnca.com:8920/*`:

- **`emby-skip-intro.user.js`** (existing, kept): the `trimPos | skipDur` skip button for normal viewing. One small change: it must **not** render when the page URL has `tvui=intro` (so it doesn't sit on top of the intro overlay).
- **`emby-ui.user.js`** (new): builds the **intro overlay** and only activates when `tvui=intro`; otherwise it does nothing.

---

## 2. Intro overlay (`emby-ui.user.js`)

A new file at repo root, installed manually by copy/paste (not deployed by a script).

- `@match https://hahnca.com:8920/*` (+ `http://` variant for parity).
- On load:
  1. `uiId = new URLSearchParams(location.search).get("tvui")`. If `uiId !== "intro"`, return immediately (do nothing).
  2. `embyItemId` = the `id` param parsed from the hash (`#!/item?id=<id>&serverId=...`).
  3. `deviceName` from Emby storage exactly like the old script's `getDeviceName()` (local read, not server comm).
  4. Open `new WebSocket("wss://hahnca.com/tv-srvr")`; on open send hello:
     `{ fname:"embyHello", param:{ uiId:"intro", deviceName, embyItemId } }`.
  5. Reconnect + re-send hello on close (long-lived tab survives srvr restarts).
- Build a fixed top bar: `top:0; left:0; width:100vw; height:60px; z-index:99999; background:rgba(0,0,0,0.2)`. The whole intro UI lives in it.
- **Buttons** (port of the intro pane, [video-player.vue#L169-L430](apps/client/src/components/video-player.vue#L169)). Each handler does only:
  `ws.send(JSON.stringify({ fname:"embyPress", param:{ btnId, pressedAt: Date.now() } }))`.
  - `zero`, `back30`, `back10`, `fwd10`, `fwd30`, `pre`, `startMark`, `trimSet`, `trimJump`, `trimClr`, `skipSet`, `skipTest`, `skipClr`, `ant`.
- **Text slots** (server pushes `{ notification:"embyText", data:{ textId, text } }`; overlay blindly sets `textContent`):
  - `title` ( `(N) Show (sNNeNN)` ), `startMark`, `trim`, `skip`, `ant`.
- **Live current-time slot** (`curTime`): the **only** local exception (per A3) — a `requestAnimationFrame`/interval loop reads the Emby page's `<video>.currentTime` and updates this slot. Purely cosmetic; no decisions made client-side.
- No `fetch`, no Emby `/Sessions` polling, no seek logic in the script. All decisions are server-side.

---

## 3. Server changes (`apps/srvr/index.js`)

All Emby control and the WS server already live here. Add an intro UI handler alongside `doSkipIntro`/`doTrimIntro`.

1. **Per-connection state** on the socket: `ws._embyUi = { uiId, deviceName }` set on `embyHello`.
2. **Helpers** (near `doSkipIntro`):
   - `fmtPos(ms)` — replicate the client formatter (`m:ss.t` / `s.t` / `--` for 0 / `""` for null).
   - `embySeek(sessionId, ticks, runtimeTicks)` — clamp `<0`→0 and `>runtime`→`runtime` (**seek to end, no message**), then `POST /Sessions/{id}/Playing/seek?SeekPositionTicks=`.
   - `getEmbyIntroContext(deviceName)` — `GET /Sessions`, find the session with `NowPlayingItem` and matching `DeviceName`, resolve the tvdb record by `SeriesName` (fallback by `SeriesId`). Returns `{ session, record }` or `null` when nothing is playing.
   - `getEmbyItem(itemId)` — `GET /Users/{EMBY_USER_ID}/Items/{itemId}` for initial label seeding from `embyItemId` on hello.
   - `pushEmbyText(ws, textId, text)` and `pushIntroState(ws, record, seasonEp)` — send the `{id:0,notification:"embyText",data}` envelope.
3. **WS router additions** ([index.js#L6122](apps/srvr/index.js#L6122)):
   - `embyHello` → store `ws._embyUi`; if `uiId==="intro"`, seed labels from `getEmbyItem(embyItemId)` + its record and push `title/startMark/trim/skip/ant`.
   - `embyPress` → `handleEmbyIntroPress(ws, btnId, pressedAt)`.
4. **`handleEmbyIntroPress`** — fetch `getEmbyIntroContext(deviceName)`; if not playing, no-op. Read `PositionTicks` (latency-compensated with `pressedAt`, like `doSkipIntro`) and `RunTimeTicks`. Dispatch `btnId`:
   - `zero/back30/back10/fwd10/fwd30` → `embySeek` relative/absolute from current position.
   - `pre` → seek to `startMark-3000ms`.
   - `trimJump` → seek to `trimPos`; `skipTest` → seek to `current + skipDur`.
   - `startMark/trimSet` → set field = current position ms; `skipSet` → `current - startMark` (only if `>= startMark`).
   - `trimClr/skipClr` → cycle `>0 → 0 → null` (matches pane).
   - `ant` → toggle `anticipating`.
   - Persist every field change via `tvdb.setTvdbFields({ name, [field]: value })` (handles save + client notify + needsIntro refresh).
   - After the action, push refreshed labels for that socket only.
5. **Label refresh on play-start.** In `/internal/nowPlaying` ([index.js#L5977](apps/srvr/index.js#L5977)), after `notifyClients`, for each connected ws with `_embyUi.uiId==="intro"` whose `deviceName` matches a `playing[].device`, push `title/startMark/trim/skip/ant` from that item + record. (The now-playing pipeline already reports the **browser** session and suppresses position-only churn, so this fires exactly when playback starts/changes — [apps/tv/src/main.js#L239](apps/tv/src/main.js#L239).)
6. **Keep** the existing `/api/introDur`, `/api/skipIntro`, `/api/trimIntro` HTTP endpoints and the `skipIntro` WS handler (used by the kept skip-button script). Server-side auto-trim on play start stays as-is.

Position precision: each press fetches `/Sessions` fresh (same pattern as `doSkipIntro`); the user positions with the overlay nav buttons, so the reported position is current by the time a `set` is pressed. No client-supplied position is used (honors "decisions stay server-side").

---

## 4. Client changes (`apps/client`)

1. **`urls.js`** — extend [`embyPageUrl`](apps/client/src/urls.js#L63) to `embyPageUrl(id, uiId)` adding `?tvui=<uiId>` before the `#`. Existing single-arg callers (map "Emby", tvdb remotes) keep working (no `tvui`).
2. **Repoint intro launchers** to open the Emby tab instead of the video pane:
   - [App.vue `handleOpenIntro`](apps/client/src/components/App.vue#L1138) — replace the `videoPlayer*` assignments with `util.openExternalPage(urls.embyPageUrl(embyId, "intro"))`.
   - Feed the **Emby item id** through to it:
     - [info.vue `introClick`](apps/client/src/components/info.vue#L688) → emit `open-intro` with `embyId` from `introFirstFile`.
     - [App.vue `clickIntro`](apps/client/src/components/App.vue#L1119) → pass `embyId` from `introFirstFile`.
     - [map.vue `handleMapIntroClick`](apps/client/src/components/map.vue#L1900) → take `id` from `seriesMap[season][episode].id` and emit it.
3. **Server `introFirstFile`/`introNextFile`** ([index.js#L5506](apps/srvr/index.js#L5506), [#L5569](apps/srvr/index.js#L5569)) — also return `id: ep.id` (the Emby item id from `getSeriesMap`) so the client can build the Emby URL.
4. **Video pane stays mounted** for play/chksrt. The intro branch in `video-player.vue` becomes unreachable (never invoked) — left in place to avoid destabilizing play/chksrt; can be pruned later.

---

## 5. Message contracts

```
client → tab : https://hahnca.com:8920/web/index.html?tvui=intro&_t=<ts>#!/item?id=<embyId>&serverId=...
tab    → srvr : { fname:"embyHello", param:{ uiId:"intro", deviceName, embyItemId } }
tab    → srvr : { fname:"embyPress", param:{ btnId, pressedAt } }
srvr   → tab  : { id:0, notification:"embyText", data:{ textId, text } }
```

---

## 6. Deployment order

1. Add server handlers + `introFirstFile/NextFile` id; `./srvr srvr`; watch `pm2 logs` for restart loops.
2. Install `emby-ui.user.js`; add the `tvui=intro` guard to `emby-skip-intro.user.js`.
3. Client `urls.js` + repoint intro launchers (Vite reloads).
4. Verify intro end-to-end against a live Emby tab (open intro → play → set marks → confirm TVDB persistence + Intro count update).

---

## 7. Resolutions (from emby-page-response.md)

- **Scope** → intro only; play & chksrt keep the pane (fixes old I1/I2).
- **Skip button** → keep `emby-skip-intro.user.js` for all openings except `tvui=intro`.
- **A1** → ignored (no info-pane Emby button needed).
- **A2** → inject `tvui` before the `#`, full reload via `openExternalPage`, userscript no-ops if param absent.
- **A3** → small exception accepted: the overlay reads the page `<video>.currentTime` purely for the live time slot; all decisions stay server-side.
- **A4** → n/a (play UI removed).
- **C1, C2** → accepted (localStorage read is local; userscript never talks to Emby directly; server uses `EMBY_*` constants).
- **S1** → keep old script + HTTP endpoints until intro parity is proven.
- **S2** → per-connection state and targeted (non-broadcast) text pushes.

No remaining major (hard-to-fix-later) ambiguities or impossibilities. Minor note: until the user presses Play in the Emby tab there is no session, so presses are no-ops and labels seed from `embyItemId` on hello; labels then refresh on play-start and after each press.
