# Actions That Select the Info Pane Without Going Through `showSeriesPane`

All paths below directly assign `currentPane = "info"` in App.vue rather than emitting/handling the `showSeriesPane` evtBus event.

---

## 1. User clicks the "Info" tab button

`selectTab("info")` calls `handleActorsClose()` directly.  
`handleActorsClose()` sets `currentPane = "info"`, clears `mapShow`, emits `mapAction close`.  
This does NOT emit `showSeriesPane`.

---

## 2. Map closed via Map component or map close button

`handleHideMap()` sets `currentPane = "info"`, clears `mapShow`.

Triggered by:

- Map component emits `@close` → `handleMapAction("close")` → `handleHideMap()`
- list.vue `seriesMapAction("close")` emits `hide-map` prop event → `handleHideMap()`

---

## 3. "Show actors" clicked from inside the Map pane

`handleShowActors(fromMap = true)` sets `currentPane = "info"`, clears `mapShow`.  
Triggered by Map component's `@show-actors` event (passes `fromMap = true`).

---

## 4. `setUpSeries` event fallthrough (show selection)

The `setUpSeries` handler in `mounted()` sets `currentPane = "info"` at the bottom of its logic after all early-return guards fail. This fires on every new show selection when no sticky-pane rule applies. It does not go through `showSeriesPane`.

---

## 5. Preview mode entry snaps a disallowed pane to info

When the `previewMode` event fires with `active = true`, if `currentPane` is one of `flex`, `qbt`, `usb`, `down`, or `local`, the handler directly sets `currentPane = "info"`.

---

## 6. `handleShowMap` with null mapShow (no-switch path)

`handleShowMap` (receives list.vue's `show-map` event) sets `currentPane = "info"` when `data.mapShow === null` and `data.noSwitch` is false. In practice list.vue always sends a non-null `mapShow` in `show-map` (close goes through `hide-map` instead), so this path is not reachable in normal use.

---

## Dead code (defined but never called)

- `handleTvprocToInfo()` — sets `currentPane = "info"`. No callers.
- `handleTorrentsClose()` — sets `currentPane = "info"`. No callers.
