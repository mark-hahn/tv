# Layered Pane-Switch Spec

Three layers in order: **guard → resolve → emit**.
Guard blocks the action entirely. Resolve picks the next pane. Emit fires side effects.

---

## Layer 1: Guard table — when is the action blocked?

| Action            | Blocked when                                                         |
| ----------------- | -------------------------------------------------------------------- |
| `tab-click(key)`  | `previewMode` and `key` ∈ `{flex, qbt, usb, down, local}`            |
| `tab-click(key)`  | `simpleMode` and `key` ∉ `{info, map, actors, reviews, trailer, tv}` |
| `show-selected`   | never blocked                                                        |
| `show-map`        | never blocked (noSwitch is a resolve concern, not a guard)           |
| `preview-entered` | never blocked                                                        |
| `preview-exited`  | never blocked                                                        |

---

## Layer 2: Resolve table — what is the next pane?

### tab-click(key)

| key       | next pane | notes                                    |
| --------- | --------- | ---------------------------------------- |
| `info`    | `info`    | clears `mapShow`                         |
| `map`     | `map`     |                                          |
| `actors`  | `actors`  | reuses state if same show already loaded |
| `reviews` | `reviews` |                                          |
| `trailer` | `trailer` |                                          |
| `tv`      | `tv`      |                                          |
| `browse`  | `browse`  |                                          |
| `tor`     | `tor`     |                                          |
| `flex`    | `flex`    |                                          |
| `qbt`     | `qbt`     |                                          |
| `usb`     | `usb`     |                                          |
| `local`   | `local`   |                                          |
| `down`    | `down`    |                                          |

### show-selected (new show clicked in list)

Priority order (first match wins):

| priority | condition                    | next pane                        |
| -------- | ---------------------------- | -------------------------------- |
| 1        | `currentPane === "map"`      | `map` (stay, update map content) |
| 2        | `currentPane` ∈ keepPane set | stay on current pane             |
| 3        | `actorSearchActive`          | `actors`                         |
| 4        | `wasAlreadySelected`         | `info`                           |
| 5        | (default)                    | `info`                           |

keepPane set: `{actors, reviews, trailer, tor, local, usb, qbt, down}`

Note: `actorSearchActive` only fires when NOT already in the keepPane set (e.g. currently on `browse`, `flex`, `info`). If already on `actors`, priority 2 fires first.

### show-map (map data arrives from list)

| noSwitch | mapShow  | next pane                    |
| -------- | -------- | ---------------------------- |
| true     | any      | no change (data update only) |
| false    | non-null | `map`                        |
| false    | null     | `info`                       |

### preview-entered

| current pane                                      | next pane |
| ------------------------------------------------- | --------- |
| ∈ `{info, actors, reviews, trailer, browse, tor}` | no change |
| anything else                                     | `info`    |

Also saves current pane to `savedPane`.

### preview-exited

| savedPane | next pane           |
| --------- | ------------------- |
| any       | restore `savedPane` |

---

## Layer 3: Emit table — side effects per action+key

| Action                                 | Side effects                                                         |
| -------------------------------------- | -------------------------------------------------------------------- |
| `tab-click("info")`                    | `paneChanged`, clear `mapShow`                                       |
| `tab-click("map")`                     | `paneChanged`, `mapAction {open, currentShow}` if show loaded        |
| `tab-click("actors")`                  | `paneChanged`, `showActors` if new show or not yet initialized       |
| `tab-click("tv")`                      | `paneChanged`, `tvCloseKeybd`                                        |
| `tab-click("browse")`                  | `paneChanged`, `browseTabClicked`                                    |
| `tab-click("tor")`                     | `paneChanged`, `showTorrents` if show loaded and not yet initialized |
| `tab-click("down")`                    | `paneChanged`, `requestNotificationsOnce`                            |
| `tab-click(other)`                     | `paneChanged`                                                        |
| `show-selected → map`                  | `paneChanged` (none — list updates map content via show-map)         |
| `show-selected → tor`                  | `paneChanged`, `showTorrents`                                        |
| `show-selected → actors` (actorSearch) | `paneChanged`, `showActors` with search params                       |
| `show-selected → info`                 | `paneChanged`, `resetActorsPane`, clear `_actorsInitialized`         |
| `show-map (switch)`                    | `paneChanged`, `seriesMapUpdated`                                    |
| `show-map (noSwitch)`                  | `seriesMapUpdated` only                                              |
| `preview-entered (snap to info)`       | `paneChanged`                                                        |
| `preview-exited`                       | `paneChanged`                                                        |

---

## Resolved questions

- **`actorSearchActive` priority**: fires only when not already in keepPane set. Priority 2 (keepPane) beats priority 3 (actorSearch). See resolve table above.
- **`handleShowQbt`**: just `simpleMode` guard + set pane + `paneChanged`. Covered by existing `qbt` row — no extra row needed.
- **`restoringPreviewPane` 500ms flag**: kept intact through steps 1–3. Deleted in step 4 when `show-selected` is layered — preview-exited becomes an explicit action row that cannot be overridden by show-selected.
- **`wasAlreadySelected` re-click → info**: currently in list.vue (`onSelectShow`). Becomes priority 4 in the show-selected resolve table.

---

## Implementation order (safest first)

1. `tab-click` — pure, synchronous, no async. Replace `selectTab` with guard+resolve+emit.
2. `show-map` — simple two-branch resolve (noSwitch or not).
3. `preview-entered` / `preview-exited` — self-contained, no show dependency.
4. `show-selected` — last, most complex, most guards.
