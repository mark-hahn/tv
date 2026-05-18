# Skip Intro Feature — Implementation Plan

## Overview

Two independent sub-features:

1. **Intro measurement pane** — play a show's first video file in a dedicated video pane; record startMark/endMark to derive introDur per show.
2. **Skip intro on TV** — hold a button on the remote (web or Android) for 300ms while Emby is playing; seek forward by introDur.

---

## 1. Data Model — `introDur` in tvdb records

- Add `introDur` field (integer, milliseconds) directly to any show's tvdb record.
- Already supported: `POST /api/setTvdbFields` → `tvdb.setTvdbFields()` in `apps/srvr/src/tvdb.js` persists arbitrary fields.
- `introDur` should be absent (undefined) rather than `0` when not set, so the check is `show.introDur != null`. When saved, clamp: `Math.max(0, endMark - startMark)`.
- No schema migration needed — the field is optional and sparse.

---

## 2. New srvr API Endpoints

### `GET /api/introFirstFile?showName=...`

Returns the server filesystem path of the first available episode video file for the show:

1. Look up the show in allTvdb to get its Emby series ID.
2. Fetch the Emby series map (season/episode list with file paths).
3. Walk seasons in order (lowest first), episodes in order, return the first `path` that exists on disk.
4. Response: `{ ok: true, path: "/path/to/file.mkv" }` or `{ ok: false }` if no files.

Used by the info pane to: (a) check if Intro button should be enabled, and (b) open the intro video pane.

Use the `hasFiles` bool already in the tvdb record to determine if the Intro button should be enabled — avoids an Emby round-trip. Only call this endpoint when the button is clicked.

### `POST /api/skipIntro`

Skips forward by the playing show's introDur on the Living Room TV:

1. `GET /Sessions?api_key={key}` to find the Living Room TV session.
2. Read `NowPlayingItem.SeriesName` and `PlayState.PositionTicks` from the session.
3. Look up the show record: first try `allTvdb[seriesName]` by name; if not found, search by emby ID matching `NowPlayingItem.SeriesId || NowPlayingItem.Id` against `record.id`. If absent or 0, return `{ ok: false, reason: "noIntroDur" }`.
4. Compute `newTicks = positionTicks + introDur * 10000` (ticks = ms × 10000).
5. Seek: `POST /emby/Sessions/{sessionId}/Playing/seek?SeekPositionTicks={newTicks}&api_key={key}`.
6. Response: `{ ok: true }`.

Server-side is preferred over client-side because:

- Avoids passing introDur to tvpane (which has no props).
- Both web and Android can call the same endpoint without duplicating logic.
- The server already polls Emby sessions (in `apps/tv/src/main.js`) and has the API key.

---

## 3. Info Pane Changes — `apps/client/src/components/info.vue`

### Button changes

- Rename `Delete` button label to `Del`.
- Add `Intro` button between Refresh and Del.

### Intro button behavior

- **Disabled and grayed out** when the show has no files on disk: check `!show.hasFiles`. Keep this reactive so it updates live as show data changes.
- When clicked: call `GET /api/introFirstFile?showName=...`, then emit event (e.g. `open-intro`) with `{ show, path }` up to App.vue to open the intro video pane.

### Show passed to intro pane

Info.vue has `this.show` with `name`, `filesOnDisk`, and `introDur` (once set). App.vue needs to receive the `open-intro` event and set `videoPlayerMode = 'intro'` and `videoPlayerPath = path`.

---

## 4. App.vue Changes — `apps/client/src/components/App.vue`

- Handle new `open-intro` event emitted from info.vue:
  - Set `videoPlayerMode = 'intro'`
  - Set `videoPlayerPath = path` (from the event)
  - Set `videoPlayerIntroShow = show` (add this data property)
  - Set `videoPlayerIntroShows = <current filtered shows list>` (see §4.1)
- Handle new `@intro-next` event from VideoPlayer:
  - Receives `nextShow` object.
  - Select `nextShow` as the active show in the sidebar (same mechanism used by other show-selection triggers).
  - Fetch first file path for `nextShow` via `/api/introFirstFile`.
  - Update `videoPlayerPath` and `videoPlayerIntroShow` to keep the video pane open with the new show.
  - If no next show found, `handleIntroNoNext()` — set `videoPlayerPath = null` to close pane.

### 4.1 Filtered shows list

The list component emits `@filtered-shows` on every filter change. App.vue stores it in `filteredShows`. When opening the intro pane, pass `filteredShows` to VideoPlayer as `:introShows`.

Add props to VideoPlayer:

```js
introShow: { type: Object, default: null },
introShows: { type: Array, default: () => [] },
```

---

## 5. Video Player — `apps/client/src/components/video-player.vue`

Add mode `'intro'`. The top bar and controls differ from chksrt.

### Top bar layout

```
[ show name (left, flex:1) ]  [ Pre ][ mm:ss.t ][ mm:ss.t ][ dur box ][ Test ][ Next ][ ✕ ]
```

- **Show name** (left): from `introShow.name` prop. Plain white text, same style as chksrt filename.
- **Pre** button: seek video to `startMark - 3000ms` (clamped to 0). Lets user review where the intro starts.
- **Start button**: label = `startMark` formatted as `mm:ss.t`. When clicked: set `startMark = video.currentTime * 1000`, then recalculate introDur and save.
- **End button**: label = `endMark` formatted as `mm:ss.t`. Same width as Start button. When clicked: set `endMark = video.currentTime * 1000`, recalculate and save.
- **Duration box**: white background, black bold text, same font size as buttons. Displays `Math.max(0, endMark - startMark)` as `mm:ss.t`. Always reflects current mark values (not a button).
- **Test** button: jump the video forward by `endMark - startMark` milliseconds (`video.currentTime += Math.max(0, endMark - startMark) / 1000`). This previews the skip locally — does not call Emby.
- **Next** button: find next show in `introShows` after `introShow` where `show.introDur == null && show.inEmby !== false`. If found, emit `intro-next` with that show. If not found, emit `close`.
- **✕** button: emit `close`.

### State vars (component-level, persist until page reload)

```js
startMark: 3 * 60 * 1000,   // 3 min in ms, set on component mount
endMark:   4 * 60 * 1000,   // 4 min in ms
```

These are declared in `data()` so they survive show changes within the same intro session (pane stays open across "Next" navigation). They reset to defaults only when the page reloads. No localStorage needed.

### introDur display

The duration box always shows `Math.max(0, endMark - startMark)` — derived from the current mark values. No separate `localIntroDur` state is needed. After saving, the tvdb record updates in the background.

### Saving introDur

On every Start or End click:

```js
const introDur = Math.max(0, this.endMark - this.startMark);
```

Call `POST /api/setTvdbFields` with `{ name: introShow.name, introDur }`. Update `localIntroDur`.

Add `setTvdbFields(name, fields)` to `apps/client/src/srvr.js` if not already present.

### Time format `mm:ss.t`

```js
function fmtTime(ms) {
  const totalSec = ms / 1000;
  const mm = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(totalSec % 60)
    .toString()
    .padStart(2, "0");
  const t = Math.floor((totalSec % 1) * 10);
  return `${mm}:${ss}.${t}`;
}
```

### Start/End button width

Both buttons must have the same width. Calculate based on the widest possible label (`mm:ss.t` = 8 chars). Set a fixed `min-width` in CSS (e.g. `74px`) or use `width: max-content` with a shared style and measure once. Simplest: hard-code `width: 74px` on both buttons.

### Live introDur update

Use a `computed` or `watch` on `startMark`/`endMark` to update the displayed introDur in real time in the box. The box shows `Math.max(0, endMark - startMark)` formatted as `mm:ss.t`. Note: this is just display; the tvdb record is only updated when Start or End is clicked (each click saves).

### No subtitle tracks in intro mode

Subtitle track UI, offset slider, and all chksrt-specific controls are hidden when `mode === 'intro'`.

### Video file

The `path` prop is the first episode file path returned by `/api/introFirstFile`. The existing `streamUrl` computed property builds `/api/stream?path=...` automatically — no changes needed there.

---

## 6. Web TV Pane — `apps/client/src/components/tvpane.vue`

### Keyboard feature removal

Remove the entire keyboard feature from tvpane.vue:

- Remove keyboard pane HTML block (`v-if="showKeybd"` section).
- Remove `showKeybd`, `keybdInput`, `keybdHistory` from `data()`.
- Remove `keybdBtn()`, `keybdSend()`, `keybdRecall()` methods.
- Remove `evtBus.on/off("tvCloseKeybd", ...)` and `_onTvCloseKeybd()` method.
- Remove `showKeybd = false` from `_onPaneChanged()`.

### Skip intro integration

Replace `startAppsHold` / `stopAppsHold` with skip-intro-only hold at **300ms**:

```js
startAppsHold() {
  this._appsHoldActive = true;
  this._appsHoldFired = false;
  this._skipIntroTimer = setTimeout(async () => {
    this._appsHoldFired = true;
    fetch(`${config.tvSrvrUrl}/api/skipIntro`, { method: 'POST' }).catch(() => {});
  }, 300);
},
stopAppsHold() {
  clearTimeout(this._skipIntroTimer);
  if (this._appsHoldActive && !this._appsHoldFired) {
    if (this.mode === 'google' || this.mode === 'fire') {
      this.showStreamers = true;
    }
  }
  this._appsHoldActive = false;
  this._appsHoldFired = false;
},
```

- Release < 300ms → streamers (if mode is google/fire)
- Hold ≥ 300ms → skip intro fires, streamers suppressed

**Web client note**: tvpane.vue has only one layout (no mark/linda distinction). The Apps button is always present.

---

## 7. Android App — `apps/android/App.js`

The button at Row 3 Col 3 is layout-dependent:

- **mark mode**: "Shows" button — `onPressIn: () => setShowShows(true)` (no hold timer currently)
- **linda mode**: "Apps" button — `onPressIn: () => startAppsHold()` (1000ms hold → nothing, release → streamers)

### Keyboard feature removal

Remove the entire keyboard feature from the Android app:

- Remove `showKeybd` state and `setShowKeybd`.
- Remove `startBackHold` / `stopBackHold` (which opens keyboard on Back button 1000ms hold). Replace the Back button with a simple `onPressIn: () => tvKey("back")` (no hold logic).
- Remove the keyboard UI rendering block (`if (showKeybd) { ... }`).
- Remove `backHoldRef`, `backHoldFiredRef`.

### Mark mode — Shows button

Currently has no hold timer. Add one:

```js
const startShowsHold = () => {
  showsHoldFiredRef.current = false;
  showsHoldRef.current = setTimeout(async () => {
    showsHoldFiredRef.current = true;
    fetch(`${TV_SRVR_URL}/api/skipIntro`, { method: "POST" }).catch(() => {});
  }, 300);
};
const stopShowsHold = () => {
  clearTimeout(showsHoldRef.current);
  if (!showsHoldFiredRef.current) setShowShows(true);
  showsHoldFiredRef.current = false;
};
```

Add refs: `showsHoldRef = useRef(null)`, `showsHoldFiredRef = useRef(false)`.

Replace the Shows button entry: change `onPressIn: () => setShowShows(true)` to `onPressIn: () => startShowsHold()`, add `onPressOut: () => stopShowsHold()`.

### Linda mode — Apps button

Remove the existing 1000ms `appsHoldRef` timer (it did nothing). Replace with skip-intro-only 300ms hold:

```js
const startAppsHold = () => {
  appsHoldFiredRef.current = false;
  skipIntroTimerRef.current = setTimeout(async () => {
    appsHoldFiredRef.current = true;
    fetch(`${TV_SRVR_URL}/api/skipIntro`, { method: "POST" }).catch(() => {});
  }, 300);
};
const stopAppsHold = () => {
  clearTimeout(skipIntroTimerRef.current);
  if (!appsHoldFiredRef.current) {
    if (mode === "google" || mode === "fire") setShowStreamers(true);
  }
  appsHoldFiredRef.current = false;
};
```

Add ref: `skipIntroTimerRef = useRef(null)`. Remove the existing `appsHoldRef` timer from `startAppsHold`.

---

## 8. No Intro Filter — `apps/client/src/components/list.vue`

Add a new filter choice `"No Intro"` to the `fltrChoices` array.

### Filter logic

When `fltrChoice === "No Intro"`, filter the show list identically to `"All"` (apply search string and all active `conds`) with two additions:

- Force the `hasemby` cond to `+1` (inEmby shows only).
- Additionally filter out any show that already has `show.introDur != null` (i.e., keep only shows without an intro duration set).

This is a convenience filter only — the intro video pane does not require it to be active.

### Emit filtered-shows

Add `"filtered-shows"` to the component's `emits`. After every `this.shows = filteredShows` assignment, emit `this.$emit("filtered-shows", this.shows)`.

---

## 9. Implementation Order

1. **srvr**: Add `GET /api/introFirstFile` and `POST /api/skipIntro` endpoints in `apps/srvr/index.js`.
2. **srvr**: Deploy with `./srvr srvr`.
3. **client — srvr.js**: Add `introFirstFile(showName)` helper.
4. **client — info.vue**: Add Intro button (disabled when `!show.hasFiles`), rename Delete → Del, emit `open-intro`.
5. **client — App.vue**: Handle `open-intro`, handle `@filtered-shows` from List, pass `introShow` + `introShows` to VideoPlayer, handle `intro-next`.
6. **client — list.vue**: Add `"No Intro"` filter, emit `filtered-shows`.
7. **client — video-player.vue**: Add `'intro'` mode with top bar controls including Test button.
8. **client — tvpane.vue**: Remove keyboard feature; replace `startAppsHold` / `stopAppsHold` with 300ms skip intro.
9. **Android — App.js**: Remove keyboard feature; add skip intro hold to Shows (mark) and Apps (linda).
10. **Test intro measurement**: Open a show with files, click Intro, verify video plays, set marks, verify introDur saved to tvdb.
11. **Test skip intro**: Play a show on Living Room TV, hold Apps/Shows button 300ms, verify seek.

---

## 10. Ambiguities and Issues (resolved)

### 9.1 Hold timer conflict — RESOLVED

Resolved by removing the entire keyboard feature. The 1000ms keyboard timer no longer exists. `startAppsHold` only has the 300ms skip intro timer.

### 9.2 Android linda mode Apps long-hold currently does nothing — resolved

The 1000ms `appsHoldRef` timer is removed. Only the 300ms skip intro timer remains.

### 9.3 Skip intro when nothing is playing

`POST /api/skipIntro` will find no active session and return `{ ok: false }`. Client ignores the response — silent no-op.

### 9.4 Show name matching for skip intro — resolved

First try `allTvdb[seriesName]` by name. If not found, fall back to searching by Emby series ID (`NowPlayingItem.SeriesId || NowPlayingItem.Id` matched against `record.id`).

### 9.5 "Next show in filtered list" — resolved

List component emits `@filtered-shows` on every filter change. App.vue stores in `filteredShows` and passes to VideoPlayer as `:introShows`. Next skips shows where `show.inEmby === false`.

### 9.6 startMark/endMark persist across shows — confirmed

Declared in `data()`. Persist for the session; reset only on page reload.

### 9.7 Duration box always shows endMark - startMark — resolved

The box always displays `Math.max(0, endMark - startMark)`. No separate `localIntroDur` state needed. The marks always have values (defaulting to 3min/4min).

### 9.8 Intro button disabled uses hasFiles — resolved

Use `!show.hasFiles` to disable the Intro button. Reactive since `show` is reactive data in info.vue.

### 9.9 No seek clamp — resolved

Do not add clamping. Emby handles out-of-bounds seek positions.

### 9.10 Web client has no mark/linda mode — confirmed

tvpane.vue has one layout. The Apps button skip intro corresponds to linda mode behavior.

---

## Files to Change

| File                                          | Change                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/srvr/index.js`                          | Add `GET /api/introFirstFile` and `POST /api/skipIntro`                               |
| `apps/client/src/components/info.vue`         | Intro button (uses hasFiles), Del rename                                              |
| `apps/client/src/components/App.vue`          | open-intro handler, filtered-shows handler, introShow/introShows props to VideoPlayer |
| `apps/client/src/components/list.vue`         | No Intro filter, emit filtered-shows                                                  |
| `apps/client/src/components/video-player.vue` | Add 'intro' mode, Test button, new props, startMark/endMark state                     |
| `apps/client/src/srvr.js`                     | Add `introFirstFile()` client helper                                                  |
| `apps/client/src/components/tvpane.vue`       | Remove keyboard feature; 300ms skip intro in startAppsHold                            |
| `apps/android/App.js`                         | Remove keyboard feature; skip intro hold on Shows (mark) and Apps (linda)             |
