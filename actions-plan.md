# actions-instr.md — Implementation Plan

Plan only. No code changes will be made until this plan is approved.

Target file for all UI work: [apps/client/src/components/log.vue](apps/client/src/components/log.vue)
(Tabulator 6.3.1 table, remote data via `srvr.getUnilogEvents` → `/api/unilog/events`).

Site source-editing work touches the unilog toolchain
([unilog/parse.js](unilog/parse.js), [unilog/reconcile.js](unilog/reconcile.js))
plus a **new local dev endpoint** (see "Big architectural issue" below).

---

## 1. Cell click behavior (log.vue → `onCellClick` / row selection)

Current [onCellClick](apps/client/src/components/log.vue#L446):

- `alt`+click → copy cell value to clipboard (pink flash)
- plain click → set that column's header filter to the cell value

Required end state:

| gesture            | action                                                       |
| ------------------ | ------------------------------------------------------------ |
| plain click        | select this row, deselect all others                         |
| `ctrl`+click       | toggle this row's selection                                  |
| `shift`+click      | extend selection from anchor row to this row                 |
| `ctrl`+`alt`+click | load cell value into that column's header filter (old plain) |
| `alt`+click        | copy cell value to clipboard (unchanged — see ambiguity A1)  |

Approach:

- Keep a single `cellClick` handler (we need the column for the filter case; a
  `rowClick` handler doesn't know which cell/column was hit).
- Branch order (most specific modifiers first):
  1. `e.ctrlKey && e.altKey` → existing "set header filter value" logic.
  2. `e.altKey` (alone) → existing clipboard-copy logic.
  3. `e.shiftKey` → range-extend selection (see §2).
  4. `e.ctrlKey` (alone) → toggle row selection.
  5. plain → clear selection, select this row.
- Do **not** enable Tabulator's built-in `selectableRows` click handling; it
  would fight our custom logic and re-introduce default highlighting. We drive
  selection ourselves via `row.select()` / `row.deselect()` / `getSelectedRows()`
  but keep `selectableRows: true` (mode `false` for auto) so the API is available.
  Concretely: set `selectableRows: true`, `selectableRowsRangeMode: "click"` is
  _not_ used; instead we call the selection API from our handler. (Confirm during
  implementation whether `selectableRows: true` alone still auto-selects on
  bare click — if so, use `selectableRows: "highlight"` or a manual class and
  `getSelectedRows` equivalent. See ambiguity A2.)

## 2. Row selection state + highlight (§ "selecting rows")

- Track a selection anchor (`this.selAnchorId`) for shift-range support.
- shift-click: select the contiguous range of currently-displayed (post-filter,
  in visual order) rows between the anchor row and the clicked row; deselect the
  rest (standard file-manager behavior). Use `table.getRows("active")` to get the
  displayed order and slice between anchor and target indices.
- Selected rows get a visible highlight. Because `rowFormatter` already sets
  `backgroundColor` per level (error `#ffe5e5`, warn `#fff6d9`), selection must
  win. Plan: add a `.logRowSelected` CSS class (scoped `:deep`) with a distinct
  background (proposal: `#cfe8ff` light blue) and `!important`, toggled in the
  `cellClick`/selection handlers and re-applied inside `rowFormatter` (Tabulator
  reformats rows on data changes, so `rowFormatter` must check
  `row.isSelected?.()`/our own `selectedIds` set and re-add the class/color).
- Maintain `this.selectedIds` (a `Set` of row `id`s) as the source of truth so
  selection survives virtual-scroll re-render, `addData`, and `loadOlder`
  prepends. `rowFormatter` reads this set.

## 3. Fix unwanted highlight at load (§ "selecting rows", first bullets)

- Symptom described: one+ rows highlighted yellow on load, unchangeable, persists
  on scroll.
- Most likely cause: Tabulator `TabulatorFull` ships the range-selection module,
  and/or a default row-selection artifact; the persistent yellow is a leftover
  "selected"/range state at first render. (Needs confirmation in the running app —
  see ambiguity A3.)
- Fix plan: on table build / after `loadLogs`, explicitly clear any selection
  and range (`table.deselectRow()`, and if range module active, clear ranges),
  and set the table options so nothing is auto-selected/auto-ranged at load
  (`selectableRange: false` unless we deliberately want it). Verify visually that
  the yellow is gone before wiring up the new (blue) selection highlight.

## 4. Toolbar: bottom button + Actions selector (§ "actions selector")

Current toolbar has a `↓ Bottom` button ([here](apps/client/src/components/log.vue#L108)).

- Change that button's label from `↓ Bottom` to `⇊` (two down arrows, no text).
  (Proposal: use the single glyph `⇊` U+21CA, or two `↓↓`. Will use `⇊`.)
- Add a `<select>` immediately to its right, styled with existing `.logSel`.
  Collapsed label (first/placeholder option) = `Actions`. On change, run the
  chosen action then reset the selector back to `Actions` (so it acts like a
  menu, not a persistent value).
- Options and behaviors:
  - **Go To Selection** — scroll so the first selected row (lowest visual index
    among `selectedIds`) is at the top of the viewport via
    `table.scrollToRow(row, "top", false)` and set `atBottom = false`.

  - **Select Sites** — compute the set of `log_id`s among selected rows, then
    select every currently-loaded row whose `log_id` is in that set (update
    `selectedIds` + re-render). (Note: only affects rows currently loaded in the
    table, up to the 5000-row cap — see ambiguity A4.)

  - **Clear Selections** — empty `selectedIds`, deselect all, re-render.

  - **Hide Sites** — see §5.

  - **Unhide Sites** — see §5.

## 5. Hide / Unhide Sites (source-code editing)

Definition of a "site": a `unilog(<id>, ...)` call in source. The selected rows
carry `log_id`, `src_file`, `src_line`. The unique set of `log_id`s from the
selected rows = the sites to hide/unhide.

### Hide

- Confirmation dialog first: "Hide N sites? This comments out N `unilog()`
  call(s) in source." where N = count of unique site ids. Proceed only on OK.
- For each unique site id, in its `src_file`, find the source line whose active
  `unilog(<id>,` call starts it and prepend `// deleted ` so the line becomes
  `// deleted unilog(<id>, ...)`.
- Skip any line already ending in `// no-unilog` (must not be commented).
- Skip lines already prefixed with `// deleted ` (idempotent).
- Because a `// deleted unilog(...)` line is now a comment, the AST-based
  reconciler ([unilog/parse.js](unilog/parse.js) `findLogCalls`) will not see it
  as an active call, so the deploy conversion **already** ignores hidden sites —
  no reconciler change needed for the "ignore hidden sites" requirement. (Verify;
  see risk R1 for multi-line calls.)
- No deploy, no reconcile, no DB change is triggered — source edit only.

### Unhide

- No confirmation dialog.
- For each unique selected site id, in its `src_file`, find the line matching
  `^(\s*)// deleted (unilog\(<id>,)` and strip the `// deleted ` prefix, leaving
  `unilog(<id>, ...)`.
- Source edit only; no other action.

### How the browser edits LOCAL source (the mechanism)

The log viewer runs in the browser against the **remote** srvr, but the source
files are the **local** workspace (source of truth; reconcile runs locally at
`./srvr` deploy). A remote endpoint cannot edit local source.

Proposed mechanism: add a **Vite dev-server middleware** (mirroring the existing
`/__terminal` middleware in [apps/client/vite.config.js](apps/client/vite.config.js#L26))
— e.g. `POST /__unilog/hide` and `POST /__unilog/unhide` — that:

- accepts `{ sites: [{ id, srcFile }] }`,
- resolves `srcFile` against the workspace root (reject paths outside it —
  path-traversal guard),
- performs the comment/uncomment edit described above,
- returns `{ hidden: n }` / `{ unhidden: n }`.

The client calls these via `fetch` (same-origin under Vite). This makes
Hide/Unhide a **dev-only** feature (only functional while the client is served
by Vite locally), which matches how source editing works everywhere else in this
repo. See impossibility I1 for the production case.

Shared edit logic (find/comment/uncomment a `unilog(<id>,` line safely) should
live in a small module under [unilog/](unilog/) so it can be unit-tested and
reused, and imported by the vite middleware.

---

## Ambiguities

- **A1 — alt-click copy:** The instructions add `ctrl`+`alt`+click for
  filter-loading but never mention the existing plain `alt`-click clipboard copy.
  Plan keeps it. Confirm you want copy retained on bare `alt`-click.
- **A2 — Tabulator selection API vs. custom:** Whether to lean on Tabulator's
  built-in `selectableRows` (with range mode) or fully hand-roll selection with a
  `selectedIds` set. Plan hand-rolls for full control over the 4 gestures and to
  keep level-coloring vs. selection-highlight interaction predictable. Open to
  using the built-in module if you prefer.
- **A3 — the "yellow at load" cause:** Not yet reproduced/confirmed in the
  running app; the fix is straightforward once the exact source (range module vs.
  row selection vs. something else) is confirmed live.
- **A4 — "Select Sites"/"Hide"/"Unhide" scope:** These operate only on rows
  currently loaded in the table (newest ≤5000, minus older not yet paged in).
  "Select Sites" therefore can't select matching rows that aren't loaded. Hide/
  Unhide are unaffected because they edit source by site id, not by row. Confirm
  this is acceptable.
- **A5 — Actions selector reset:** Plan resets the dropdown back to `Actions`
  after each action (menu-style). Confirm vs. leaving the last choice shown.

## Contradictions / risks

- **R1 — multi-line `unilog()` calls:** "prepend `// deleted ` to the line"
  comments only the **first** line. If a site's `unilog(...)` spans multiple
  lines, only line 1 becomes a comment and the continuation lines become invalid
  code (syntax error → reconciler/deploy `parse` bails and leaves the file
  untouched, or the app fails to build). Need a rule: either (a) only hide
  single-line sites and warn/skip multi-line ones, or (b) comment out **all**
  lines of the call. Recommend (b): use the AST (`findLogCalls`) to get the
  call's start/end lines and prefix `// deleted ` to each line of the span (and
  strip them all on unhide). Please confirm.
- **R2 — line-number drift:** DB `src_line` can be stale relative to local
  source (reconcile refreshes it only at deploy). Editing by `src_line` is
  fragile. Recommend locating the site by matching `unilog(<id>,` text within
  `src_file` rather than trusting `src_line`. (Assumes ids are unique per file,
  which the reconciler enforces.)
- **R3 — `.vue` files:** unilog sites in `.vue` files live inside `<script>`;
  the same textual `unilog(<id>,` match works, but confirm the comment prefix is
  valid JS context (it is, inside `<script>`).

## Impossibilities / architectural issue

- **I1 — remote client can't edit local source:** In production the built client
  is served from the remote server via nginx; there is no local Vite middleware,
  so Hide/Unhide would be non-functional there. Since local source is the source
  of truth and reconcile runs locally, Hide/Unhide is inherently a **local dev
  tool**. Plan makes it a Vite-only endpoint and (suggestion) hides/disables the
  Hide/Unhide options when not running under Vite dev. Please confirm this is the
  intended usage.

## Suggestions

- Add a small selected-count indicator to the toolbar (e.g. `sel N`) next to the
  existing `displayed/row/dbTotal` counter for feedback.
- After a successful Hide/Unhide, briefly toast/flash how many sites changed and
  optionally auto-run "Clear Selections".
- Put the comment/uncomment edit logic in a testable module (e.g.
  `unilog/hide.js`) with unit tests under [unilog/test/](unilog/test/), matching
  the existing reconcile test style, so multi-line handling (R1) is verified.
- Consider having Unhide also select/scroll to nothing (pure source edit) but
  surface a confirmation-free success flash for parity with Hide.
