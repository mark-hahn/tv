# Buttons Plan

## Overview

Six panes get new action buttons that consolidate modifier-click behaviors.
The new buttons appear together **at the far right of the last header row** in each pane.
List items in tor, flex, qbt, and down gain multi-select (ctrl-click toggle, shift-click range).
USB and local keep their existing selection behavior unchanged.

---

## Global changes across all six panes

### Multi-select for tor, qbt, down panes

These panes currently have single-item selection. Adding multi-select:

- New reactive data: `selectedItems: new Set()` and `lastSelectedIndex: null`
- **Plain click**: single-select (clear others, select clicked)
- **Ctrl-click**: toggle clicked item in/out of selection
- **Shift-click**: range-select from `lastSelectedIndex` to clicked item
- **Alt-click**: copy title/path to clipboard (already in tor.vue and tree-node.vue; needs adding to qbt, down)
- `lastSelectedIndex` updates on plain click and ctrl-click but NOT on shift-click

Note: `selectedTorrent` (tor) and `matchedTitle` (qbt, down) are existing single-selection fields used for styling. They will be replaced or augmented by the multi-select set.

### **[CHANGED]** flex pane — single selection only via mouse

Per clarification, flex only allows a single non-header row to be selected via mouse. Plain click, ctrl-click, and shift-click all do the same: toggle the clicked item as the single selection (clicking an already-selected item deselects it, clicking another replaces the selection). No range-select in flex. The `From` button is the only way to produce multiple selections.

### **[NEW]** First button — all panes

Every pane gets a **First** button placed immediately after the **All** button in the new far-right group. It scrolls the list to the first selected item. It is grayed out (disabled) when no items are selected.

### Alt-click already implemented in:

- tor.vue: copies `torrent.raw.title` ✓
- local.vue + usb.vue: via tree-node.vue copies full path ✓

### Alt-click needs adding to:

- flex.vue: copy the show name + season/episode key for the clicked row **[CHANGED — no longer needs multi-select infrastructure]**
- qbt.vue: copy `t.name` to clipboard
- down.vue: copy `it.title` to clipboard

---

## tor pane

### Current header (one row, right side)

`Get | Tab | [Season input] | Search | More | Tabs | Stream | Close/Cookies`

### New header layout **[CHANGED — confirmed second row]**

Add a **second header row** right-aligned:
`Sel | From | All | First | Show | Send | Force`

### Button specs

| Button              | Action                                                                                                                                   | Notes                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Sel**             | Emit `selectShowFromCardTitle` with show name from first selected torrent                                                                | **[CHANGED]** Use `parse-torrent-title` on `torrent.raw.title`, then `smartTitleMatch` against shows |
| **From**            | Clear `selectedItems`; select all items whose show matches the currently-selected show in the shows list; scroll to first newly selected | Uses `parse-torrent-title` + `smartTitleMatch` to match torrents to show                             |
| **All**             | Clear `selectedItems`; select all items whose show matches the show of the first item in `selectedItems`; scroll to first newly selected | Uses first item of current selection as pivot                                                        |
| **First** **[NEW]** | Scroll list to first selected item                                                                                                       | Disabled when `selectedItems` is empty                                                               |
| **Show**            | Open `torrent.detailUrl` in new tab for first selected torrent                                                                           | Was: plain click (first time only). Use `util.openExternalPage()`                                    |
| **Send**            | Call `enqueueDownload(torrent, { forceDownload: false })` for each selected torrent                                                      | Was: ctrl-click. Skip if file already on disk (existing check inside `enqueueDownload`)              |
| **Force**           | Confirm dialog → call `enqueueDownload(torrent, { forceDownload: true })` for each selected                                              | Dialog: "Send N selected torrents to qbt even if already downloaded?" Enter=ok, Escape=cancel        |

### Click behavior changes

- **Plain click**: single-select only (no longer auto-opens detail tab)
- **Ctrl-click**: multi-select toggle (no longer triggers download)
- **Shift-click**: range-select
- **Alt-click**: copy title (unchanged)
- The existing `Get` button behavior is unchanged (downloads currently-selected via `continueDownload()`)

### Existing buttons unchanged

Get, Tab, Search, More, Tabs, Stream, Close, Cookies — stay as-is.

---

## flex pane

### Current header (one row)

`From show | Bottom | Force`

### New header layout **[CHANGED — Force renamed to Run]**

Move `From show` to far right; rename `Force` to `Run`:
`Bottom | Run | Sel | From | All | First | Info`

### Button specs

| Button              | Action                                                                                                       | Notes                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Sel**             | Emit show-selection event using selected flex row's show name                                                |                                                                                 |
| **From**            | Clear `selectedItems`; select rows whose show matches current show in shows list; scroll to first            | Replaces "From show" button. This is the only way to get multiple rows selected |
| **All**             | Clear `selectedItems`; select all rows whose show matches the currently selected row's show; scroll to first |                                                                                 |
| **First** **[NEW]** | Scroll list to first selected row                                                                            | Disabled when `selectedItems` is empty                                          |
| **Info**            | Open detail dialog for the selected row                                                                      | Was: plain click. Calls `dialogRow = selectedRow`                               |

### Click behavior changes **[CHANGED]**

- **Plain click**: select clicked row (deselects if already selected); replaces any previous selection
- **Ctrl-click**: same as plain click
- **Shift-click**: same as plain click
- **Alt-click**: copy row text (show name + season/episode) to clipboard — new
- Only one row can be selected at a time via mouse; `From` button is the only source of multi-selection

### Existing buttons

- `Bottom` stays
- `Force` **[CHANGED]** renamed to `Run` — same behavior (triggers immediate Flexget run)
- `From show` removed from its old position (moved as `From` into new group)

---

## qbt pane

### Current header (one row)

`Open UI | From show | Active | Clean | Bottom`

### New header layout

Move `From show` out; new buttons at far right:
`Open UI | Active | Clean | Bottom | Sel | From | All | First | Force | Del`

### Button specs

| Button                   | Action                                                                                             | Notes                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Sel**                  | Emit `selectShowFromCardTitle` with name from first selected item                                  | Was: plain click                                                                                               |
| **From**                 | Clear `selectedItems`; select items whose show matches current show in shows list; scroll to first | Replaces "From show"                                                                                           |
| **All**                  | Clear `selectedItems`; select all items whose show matches first selected item; scroll to first    |                                                                                                                |
| **First** **[NEW]**      | Scroll list to first selected item                                                                 | Disabled when `selectedItems` is empty                                                                         |
| **Force** **[RESOLVED]** | Confirm dialog → delete each selected torrent from qbt then immediately re-add it                  | Restart download. Dialog: "Restart download for N torrent(s)?" Enter=ok, Escape=cancel. See new issue #9 below |
| **Del**                  | Confirm dialog → call `deleteTorrentAndFiles(t)` for each selected                                 | Was: ctrl-click. Dialog: "Delete N torrent(s) from qbt and their files from USB disk?" Enter=ok, Escape=cancel |

### Click behavior changes

- **Plain click**: single-select (no longer emits `selectShowFromCardTitle`)
- **Ctrl-click**: multi-select toggle (no longer deletes)
- **Shift-click**: range-select
- **Alt-click**: copy `t.name` to clipboard — new

### Existing buttons

- `Open UI`, `Active`, `Clean`, `Bottom` stay
- `From show` removed from old position (moved as `From` into new group)

---

## down pane

### Current header (one row)

`[Search input] | From | Cycle | Errs | Clr | Bot | Active | Resume/Stop`

### New header layout

Move `From` out of current position; new buttons at far right:
`[Search input] | Cycle | Errs | Clr | Bot | Active | Resume/Stop | Sel | From | All | First | Del`

### Button specs

| Button                 | Action                                                                                                                                                        | Notes                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Sel**                | Emit `selectShowFromCardTitle` with title from first selected item                                                                                            | Was: plain click                                                                                            |
| **From**               | Clear `selectedItems`; select items whose show matches current show in shows list; scroll to first                                                            | Replaces old `From` button                                                                                  |
| **All**                | Clear `selectedItems`; select all items whose show matches first selected item; scroll to first                                                               |                                                                                                             |
| **First** **[NEW]**    | Scroll list to first selected item                                                                                                                            | Disabled when `selectedItems` is empty                                                                      |
| **Del** **[RESOLVED]** | Confirm dialog → for each selected item: remove its DB record, remove from in-progress list and all other state, then delete the actual file from server disk | Dialog: "Delete N file(s)?" Enter=ok, Escape=cancel. Requires new server endpoint — see new issue #10 below |

### Click behavior changes

- **Plain click**: single-select (no longer emits `selectShowFromCardTitle`)
- **Ctrl-click**: multi-select toggle
- **Shift-click**: range-select
- **Alt-click**: copy `it.title` to clipboard — new

### Existing buttons

- `Cycle`, `Errs`, `Clr`, `Bot`, `Active`, `Resume/Stop` stay
- `From` removed from old position (moved as `From` into new group)

---

## usb pane

### Current header (one row)

`[Search input] | [Rename input] | From show | Force Down | Prune | Refresh`

### New header layout **[CHANGED — All added]**

Move `From show` and `Force Down` out; new buttons at far right:
`[Search input] | [Rename input] | Prune | Refresh | Sel | From | All | First | Force | Del`

### Button specs

| Button              | Action                                                                                                                                                                       | Notes                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Sel**             | Emit show-selection event using show name inferred from selected file(s)                                                                                                     | **[CHANGED]** If a top-level folder is selected use its name; if only files selected, use `parse-torrent-title` on the file name |
| **From**            | Clear file selections (`selectedFiles.clear()`, `selectedName = null`); select (highlight/expand) the top-level folder matching the current show in shows list; scroll to it | Was: `highlightShow()`. Now also clears selections first                                                                         |
| **All** **[NEW]**   | Clear `selectedFiles`; select all files within the same top-level folder as the first selected file                                                                          | Uses same-folder constraint as existing multi-select                                                                             |
| **First** **[NEW]** | Scroll list to first selected item                                                                                                                                           | Disabled when `selectedFiles` is empty and `selectedName` is null                                                                |
| **Force**           | Call `forceDown()` for selected files                                                                                                                                        | Was: `Force Down` button. Same logic, new label + position                                                                       |
| **Del**             | Confirm dialog → delete selected files from USB disk                                                                                                                         | New. Requires server endpoint. Dialog: "Delete N file(s) from USB disk?" Enter=ok, Escape=cancel                                 |

### Selection behavior (unchanged)

- ctrl-click toggles files (same-folder constraint)
- shift-click range-selects siblings
- plain click single-selects
- alt-click copies path (via tree-node.vue) ✓

### Existing buttons

- `Prune`, `Refresh` stay
- `From show` removed (moved as `From`)
- `Force Down` removed (moved as `Force`)

---

## local pane

### Current header

- **Row 1**: `Local files | [loading] | [Search input] | [Rename input] | To | From`
- **Row 2**: `Subs | Asr | Emb | Fix | Errs | Info | Move | Del | Ref`

### New header layout **[CHANGED — Errs stays, Err button removed]**

- **Row 1**: `Local files | [loading] | [Search input] | [Rename input]`
  - Remove `To` and `From` from Row 1
- **Row 2**: `Subs | Asr | Emb | Fix | Errs | Move | Ref | Sel | From | First | Info | Del`
  - `Errs` **[CHANGED]** stays in its current position, behavior unchanged
  - `Info` moved to far-right group
  - `Del` moved to far-right group
  - New far-right group: `Sel | From | First | Info | Del`

### Button specs

| Button                 | Action                                                            | Notes                                                                                                           |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Sel**                | Call `toShow()` — select show matching selected top-level folder  | Was: `To` button in Row 1                                                                                       |
| **From** **[CHANGED]** | Find folder matching current show; expand it; scroll to it        | Was: `From` button in Row 1. **Just moves it** — same `selectTopLevel()` behavior, no file-selection step added |
| **First** **[NEW]**    | Scroll list to first selected file or folder                      | Disabled when `selectedFiles` is empty and `selectedName` is null. See new issue #11 below                      |
| **Info**               | Call `clickInfo()` — open info sub-pane                           | Was: `Info` in Row 2 middle. Same function, new position                                                        |
| **Del**                | Call `deleteSelected()` — delete selected files with confirmation | Was: `Del` in Row 2 middle. Same function, new position                                                         |

### Selection behavior (unchanged)

- ctrl-click, shift-click, plain click behavior stays the same
- alt-click copies path (via tree-node.vue) ✓

### Existing buttons

- `Subs`, `Asr`, `Emb`, `Fix`, `Errs`, `Move`, `Ref` stay in Row 2 unchanged
- `To` removed from Row 1 (functionality moves to `Sel` in Row 2 far-right)
- `From` removed from Row 1 (moved to Row 2 far-right, same behavior)
- `Info` removed from Row 2 middle (moved to far-right group)
- `Del` removed from Row 2 middle (moved to far-right group)

---

## Implementation steps

1. **shared utility**: Add a `scrollToFirst(scroller, itemEl)` helper if not already present, or reuse the existing `scrollIntoView` pattern from `showFirstDownloading`.

2. **tor.vue**
   - Replace `selectedTorrent` single-select with `selectedItems: new Set()` + `lastSelectedIndex`
   - Update `handleTorrentClick` for multi-select (plain/ctrl/shift/alt)
   - Update `getCardStyle` to highlight all items in `selectedItems`
   - Add second header row with: Sel, From, All, First, Show, Send, Force buttons
   - Import `parseTorrentTitle` (already in qbt.vue, add to tor.vue) for show name extraction
   - Implement `selClick`, `fromClick`, `allClick`, `firstClick`, `showClick`, `sendClick`, `sendForceClick` methods (rename to avoid conflict with existing `forceClick`)

3. **flex.vue**
   - Add `selectedRow: null` (single item, not a Set)
   - Update `handleRowClick` for single-select-toggle behavior (all click types do the same)
   - Rename `Force` button to `Run`; move `From show` button to new group; add Sel, All, First, Info
   - Implement `selClick`, `fromClick`, `allClick`, `firstClick`, `infoClick`

4. **qbt.vue**
   - Add `selectedItems: new Set()`, `lastSelectedIndex`
   - Update `handleCardClick` for multi-select
   - Move `From show` to new group; add Sel, All, First, Force, Del
   - Implement `selClick`, `fromClick`, `allClick`, `firstClick`, `qbtForceClick`, `delClick`

5. **down.vue**
   - Add `selectedItems: new Set()`, `lastSelectedIndex`
   - Update `handleCardClick` for multi-select
   - Move `From` to new group; add Sel, All, First, Del
   - Implement `selClick`, `fromClick`, `allClick`, `firstClick`, `delClick`
   - New server endpoint needed for Del

6. **usb.vue**
   - Move `From show` → `From`; move `Force Down` → `Force`; add Sel, All, First, Del
   - Update `From` / `highlightShow` to also clear selections first
   - Implement `selClick`, `allClick`, `firstClick`, `delClick`
   - New server endpoint needed for Del

7. **local.vue**
   - Remove `To` and `From` from Row 1
   - Move `Info` and `Del` from their Row 2 positions to far-right group
   - `Errs` stays in place unchanged
   - Add far-right group to Row 2: Sel, From, First, Info, Del
   - `selClick` = `toShow()`, `fromClick` = existing `selectTopLevel()`, `firstClick` = scroll to first selected
   - `Info` and `Del` buttons just call existing `clickInfo()` and `deleteSelected()`

---

## Issues / Ambiguities / Contradictions

### 1. ~~qbt "Force" button~~ **[RESOLVED]**

Force = delete from qbt and immediately re-add (restart download). See new issue #9 for implementation detail.

### 2. ~~down "Del"~~ **[RESOLVED]**

Del = remove DB record + in-progress list + all state + delete actual file from server disk. Requires new server endpoint.

### 3. ~~local "Err" button~~ **[RESOLVED]**

Errs toggle button stays in its current position with unchanged behavior. No Err button is added to the far-right group.

### 4. ~~local "From" file selection~~ **[RESOLVED]**

From button just moves from Row 1 to far-right group. Same `selectTopLevel()` behavior. No file-selection step added.

### 5. ~~tor show matching~~ **[RESOLVED]**

Use `parse-torrent-title` to extract the clean show name from `torrent.raw.title`, then feed into `smartTitleMatch()` against the shows list.

### 6. ~~flex multi-select row skipping~~ **[RESOLVED]**

Flex uses single-selection only via mouse. No range-select needed. Header rows remain non-selectable and are simply skipped on click.

### 7. ~~Confirmation dialog wording~~ **[RESOLVED]**

- tor Force: "Send N selected torrent(s) to qbt even if already downloaded?"
- qbt Force: "Restart download for N torrent(s)?"
- qbt Del: "Delete N torrent(s) from qbt and their files from USB disk?"
- usb Del: "Delete N file(s) from USB disk?"
- down Del: "Delete N file(s)?"
- All dialogs: Enter = ok, Escape = cancel.

### 8. ~~usb Sel show inference~~ **[RESOLVED]**

If a top-level folder is selected use its name. If only files are selected (no top-level folder active), use `parse-torrent-title` on the selected file name.

### 9. **[NEW]** qbt Force — re-add without file deletion

The existing `deleteTorrentAndFiles()` removes the torrent from qbt AND deletes the file from disk. For Force (restart), we need to delete from qbt only (not the file), then re-add the torrent. This likely requires a different API call than `deleteTorrentAndFiles`. Need to check whether the qbt API / srvr has a "delete torrent but keep file" endpoint, or whether a new one needs to be added.

### 10. **[NEW]** down Del — new server endpoint required

The down pane currently has no delete-from-DB functionality. A new endpoint in `apps/down` (or `apps/srvr`) is needed that accepts a list of item IDs/titles and: removes the DB record, clears in-progress state, and deletes the file. Confirm which server owns this endpoint.

### 11. **[NEW]** local First button — no All button in local

The instruction says "add a First button after the All button". Local pane has no All button (Err/Errs was kept unchanged, From just navigates). First is placed after From in the local group. Confirm this is acceptable, or should local also get an All button?

### 12. **[NEW]** usb All button — scope

For the new usb All button: "select all files within the same top-level folder as the first selected file". If the first selection is a top-level folder (not a file), does All select all files inside that folder, or is it a no-op? Proposed: if `selectedName` is set but `selectedFiles` is empty, All selects all direct-child files of `selectedName`.

---

## Suggestions

- **Button disable states**: Sel/All/First/Show/Send/Force/Del buttons disabled when nothing selected. From enabled whenever a show is selected in the shows list. **[CONFIRMED]**
- **"All" with empty selection**: All button grayed out when nothing selected. **[CONFIRMED]**
- **tor second header row**: Confirmed. **[CONFIRMED]**
- **Confirmation dialogs**: Enter = ok, Escape = cancel. **[CONFIRMED]**
