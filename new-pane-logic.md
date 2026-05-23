# Matrix-Based Pane Switching

## The matrix shape

```
action (rows)           × situation (columns)
─────────────────────────────────────────────
tab-click(key)            current pane
show-selected             current pane + flags
preview-entered           current pane
preview-exited            savedPane
show-map                  noSwitch flag
```

Most cells are trivial — tab click goes to that tab. The interesting cells are a small minority.

## The situation dimension is not just current pane

That's the main complication. The "from situation" really has compound keys:

- `currentPane`
- `simpleMode`
- `previewMode`
- `actorSearchActive`
- `sameShowAlreadyLoaded` (for tor/actors)
- `restoringPreviewPane` (currently a timing hack)

You could encode these as named situations: `"on-map"`, `"actor-search-active"`, `"simple-mode"`, `"same-show-tor"`, `"same-show-actors"`, `"preview-active"`. That gives ~8 meaningful situations instead of all combinations.

## What the matrix buys you

- `restoringPreviewPane` 500ms flag disappears — replaced by making "preview-exited" an explicit action row with its own result column
- The `showSeriesPane` map-guard problem disappears — each action row just specifies its own behavior on the `"on-map"` column
- Dead code (`handleTorrentsClose`, `handleTvprocToInfo`, etc.) never gets written in the first place
- Adding a new pane = add one column, fill in a handful of non-default cells
- Behavior changes are local edits to one table rather than hunts through `mounted()`

## What it doesn't eliminate

Side effects still need to exist somewhere. Some transitions require:

- `clearMapShow` + `emit mapAction close`
- `emit showTorrents` (tor pane, new show)
- `emit showActors` (actors pane, new show)
- `emit paneChanged`

These could be a second parallel table (action × situation → side-effect list), or each cell returns `{ pane, effects: [] }`.

## Honest risk

The `setUpSeries` handler is the hardest to map — it's really "show-selected" with 6 guards and 4 different outcomes. It would map cleanly to one action row, but getting all 6 situation columns right on the first pass is where regressions would likely appear. Writing the spec first and testing against the current behavior before deleting anything is the right order.

## Verdict

Good idea. The matrix won't be perfectly 2D (compound situations), but it would cut the logic from ~120 lines of nested if/else to a table of ~20-30 meaningful cells plus a handful of side-effect functions. The spec-first approach — write the table, validate it matches current behavior, then swap implementations — is the right order.
