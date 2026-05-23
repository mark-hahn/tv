# Tab Pane Switching Logic

## State variables (App.vue)

- `currentPane` — string key of the visible pane. Initial value: `"info"`.
- `savedPane` — holds `currentPane` when preview mode is entered, so it can be restored on exit.
- `restoringPreviewPane` — boolean flag set for 500 ms after preview mode exits; blocks `setUpSeries` from resetting the pane to `"info"` during the restore window.
- `_torrentsInitialized` / `_torrentsShowKey` — prevents restarting a torrent search when switching to `tor` for the same show.
- `_actorsInitialized` / `_actorsShowKey` — prevents reloading actors when switching to `actors` for the same show.
- `_actorSearchParams` — non-null while a cross-show actor search is active; keeps the `actors` pane sticky across show selections.

---

## What causes a pane switch

### 1. User clicks a tab button (top or bottom row)

Calls `selectTab(key)` in App.vue.

Per-key behavior:

| Key       | Action                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `info`    | Calls `handleActorsClose()` → sets `currentPane = "info"`, clears `mapShow`, emits `mapAction close` |
| `map`     | Sets `currentPane = "map"`, emits `mapAction open` for current show if one is selected               |
| `actors`  | Calls `handleShowActors(false)` — see §3 below                                                       |
| `reviews` | Sets `currentPane = "reviews"`                                                                       |
| `trailer` | Sets `currentPane = "trailer"`                                                                       |
| `tv`      | Sets `currentPane = "tv"`, emits `tvCloseKeybd`                                                      |
| `browse`  | Sets `currentPane = "browse"`, emits `browseTabClicked`                                              |
| `tor`     | Calls `handleShowTor(currentShow)` if a show is selected; otherwise just sets `currentPane = "tor"`  |
| `flex`    | Sets `currentPane = "flex"`                                                                          |
| `qbt`     | Calls `handleShowQbt()` → sets `currentPane = "qbt"`                                                 |
| `usb`     | Sets `currentPane = "usb"`                                                                           |
| `local`   | Sets `currentPane = "local"`                                                                         |
| `down`    | Calls `handleShowTvproc()` → sets `currentPane = "down"`                                             |

### 2. Show selected in the list (`setUpSeries` event, emitted from list.vue)

`saveVisShow` in list.vue emits `setUpSeries` (debounced via `_pendingSetUpSeriesToken`) after the show selection changes.

App.vue `setUpSeries` handler logic:

1. Updates `currentShow`.
2. **If on `map` pane — does not switch; returns early.**
3. Resets `_actorsInitialized` and `_torrentsInitialized` (unless actor search is active).
4. **If on `tor` pane** — stays on `tor`, emits `showTorrents` for new show.
5. **If on any "sticky" pane** (`local`, `usb`, `qbt`, `down`, `reviews`, `trailer`, `actors`) — stays on that pane.
6. **If actor search is active** — switches to `actors` pane.
7. **If `restoringPreviewPane` is true** — does not switch (preview exit is in progress).
8. **Otherwise** — switches to `currentPane = "info"`.

### 3. `handleShowActors(fromMap)` called

- `fromMap = true` (called from Map's "show actors" button): switches to `"info"` and closes map.
- `fromMap = false` (all other callers):
  - If the same show is already loaded in the actors pane (`_actorsShowKey` matches), just switches to `"actors"` without reloading.
  - Otherwise switches to `"actors"` and emits `showActors` to reload.

**Callers:**

- Tab click → `selectTab("actors")`
- Map component `@show-actors` event
- evtBus `showActorsPane` (emitted by `list.vue:startActorsListMode` and `info.vue`)
- evtBus `showActorsPaneWithEpisode` (emitted from episode detail UI)

### 4. `handleShowTor(show)` called

- If `simpleMode` — returns (tor not available in simple mode).
- If same show is already loaded (`_torrentsShowKey` matches), just switches to `"tor"`.
- Otherwise resets initialized state, switches to `"tor"`, emits `showTorrents`.

**Callers:**

- Tab click → `selectTab("tor")`
- `setUpSeries` handler when current pane is already `tor`
- evtBus `showTorrentsPane` (emitted by `info.vue`)
- `handleTvprocToTor()` (defined in App.vue; appears unused)

### 5. `handleShowMap` (emitted by list.vue as `show-map`)

list.vue builds map data and emits `show-map`. App.vue `handleShowMap`:

- Stores map data (`mapShow`, `seriesMapSeasons`, etc.).
- **If `noSwitch` is true** (background refresh) — does not change `currentPane`.
- **Otherwise** — switches to `"map"` if `mapShow !== null`, else to `"info"`.

`noSwitch: true` is set by list.vue on refresh calls (not initial open).

### 6. `handleHideMap` (emitted by list.vue as `hide-map`)

Sets `currentPane = "info"`, clears `mapShow`.

Called when `seriesMapAction("close")` runs in list.vue (e.g., map close button).

### 7. evtBus `showSeriesPane` event

Sets `currentPane = "info"`, clears `mapShow`, emits `mapAction close`.  
**If current pane is already `map`** — does nothing (guard in the handler).

**Emitters:**

- list.vue `onSelectShow` — when a show is clicked (unless sticky pane rules apply)
- list.vue `previewSearchChoice` — when entering preview mode
- list.vue after add-show-from-preview completes
- list.vue `watchClick` — when "watching" indicator is clicked
- list.vue `saveVisShow` logic path when coming back from preview

### 8. evtBus `showBrowsePane` event

Sets `currentPane = "browse"`. Blocked in `simpleMode`.  
Emitted by `actors.vue` (e.g., Browse button in actors pane).

### 9. evtBus `showLocalPane` event

Sets `currentPane = "local"`. Blocked in `simpleMode`.  
Emitted by `local.vue` internally.

### 10. evtBus `showStreamPane` event

Sets `currentPane = "tor"`, then emits `openStream`.  
Emitted by `browse.vue`.

### 11. Preview mode entry/exit (evtBus `previewMode`)

**Entry (`active = true`):**

- Saves `currentPane` into `savedPane`.
- If current pane is one of the disabled set (`flex`, `qbt`, `usb`, `down`, `local`) — snaps to `"info"`.
- Allowed panes in preview: `info`, `actors`, `reviews`, `trailer`, `browse`, `tor`, `map`.

**Exit (`active = false`):**

- Restores `currentPane` from `savedPane`, clears `savedPane`.
- Sets `restoringPreviewPane = true` for 500 ms to block `setUpSeries` from overriding the restore.

---

## What blocks a pane switch

| Condition                                                                                     | Effect                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simpleMode`                                                                                  | Only `info`, `map`, `actors`, `reviews`, `trailer`, `tv` are allowed. `selectTab` returns early for any other key. `handleShowTor`, `handleShowQbt`, `handleShowTvproc` all return early. |
| `previewMode`                                                                                 | `selectTab` blocks `flex`, `qbt`, `usb`, `down`, `local`.                                                                                                                                 |
| Same show already loaded in `tor`                                                             | `handleShowTor` switches pane but does not restart search.                                                                                                                                |
| Same show already loaded in `actors`                                                          | `handleShowActors(false)` switches pane but does not reload.                                                                                                                              |
| `restoringPreviewPane = true`                                                                 | `setUpSeries` handler returns early without switching to `"info"`.                                                                                                                        |
| Current pane is `map`                                                                         | `setUpSeries` returns early — show selection does not switch away from map.                                                                                                               |
| Current pane is a sticky pane (`local`, `usb`, `qbt`, `down`, `reviews`, `trailer`, `actors`) | `setUpSeries` does not switch panes when show selection changes.                                                                                                                          |
| Actor search active (`_actorSearchParams` non-null)                                           | `setUpSeries` keeps `actors` pane instead of going to `"info"`.                                                                                                                           |
| `noSwitch: true` on `show-map` payload                                                        | `handleShowMap` does not change `currentPane`.                                                                                                                                            |
| `onSelectShow` with same show                                                                 | still emits `showSeriesPane` unless on a keepPane (`map`, `actors`, `subs`, `files`, `reviews`, `trailer`, `ai`).                                                                         |
| Map already showing same show                                                                 | `seriesMapAction("open")` in list.vue returns early — no re-fetch, no pane switch.                                                                                                        |

---

## Summary of all pane-switch entry points

```
selectTab(key)                     ← tab button click
  setUpSeries event                ← show selected in list
  showSeriesPane event             ← emitted by list.vue, info.vue
  showActorsPane event             ← emitted by list.vue, info.vue
  showActorsPaneWithEpisode event  ← emitted by episode detail UI
  showTorrentsPane event           ← emitted by info.vue
  showBrowsePane event             ← emitted by actors.vue
  showLocalPane event              ← emitted by local.vue
  showStreamPane event             ← emitted by browse.vue
  show-map prop event              ← emitted by list.vue
  hide-map prop event              ← emitted by list.vue
  previewMode event                ← emitted by list.vue (setPreviewMode)
```
