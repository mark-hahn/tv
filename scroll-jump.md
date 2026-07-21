# Log pane scroll jump — problem summary and replacement plan

Handoff document. The bug is **not fixed**, but the working tree is **clean**:
`log.vue` has been reverted to `HEAD` (`d75addef`), so there is nothing to undo
before starting. This records the symptom, everything measured, four failed fixes
(do not repeat them), the misleading metric that made one of them look like a
success, and a design for replacing Tabulator's scroller.

---

## 1. Symptom

In the log pane (`apps/client/src/components/log.vue`), scrolling the event list
**upwards** is slow and jerky: the pane scrolls up, then jumps back down by a
smaller amount, so each gesture nets only partial progress.

User's own description, which turned out to be the most important clue:

> this only happens when new events never seen before appear at the top — when
> they appear is when it jumps

and, when asked where in the list it happens:

> **Near the bottom** — scrolled up a little from the newest events.

"New events never seen before appear at the top" is best read as *rows that were
in the data but had not yet been rendered into the virtual DOM being rendered in
at the top edge as you scroll up* — i.e. Tabulator's `_addTopRow` path. It is
**not** necessarily `loadOlder()` paging (see §5.4).

---

## 2. Where things are

| What | Where |
| --- | --- |
| Log pane component | `apps/client/src/components/log.vue` |
| Tabulator version | 6.5.2 (`package.json` asks `^6.3.1`) |
| Virtual renderer | `apps/client/node_modules/tabulator-tables/src/js/core/rendering/renderers/VirtualDomVertical.js` |
| Row/data manager | `apps/client/node_modules/tabulator-tables/src/js/core/RowManager.js` |
| Events API | `GET /api/unilog/events` → `apps/srvr/src/routes/unilog.js`, query in `apps/srvr/src/unilogDb.js:queryEvents` |
| Live push | WS notification `unilog-event` (`broadcastUnilog`, `apps/srvr/src/routes/unilog.js:62`) |

Client runs under Vite only — no deploy needed for client changes. Instrumented
log sites are activated with `node unilog/run-reconcile.js client` **run from the
repo root** `/root/apps/tv` (it rewrites `logHere(...)` into `unilog(<id>, ...)`
in local source; Vite hot-reloads).

Relevant constants in `log.vue`: `MAX_ROWS = 5000`, `PAGE = 500`,
`TRIM_MARGIN = 250`.

---

## 3. What was actually measured

Instrumentation logs to the unilog DB regardless of what the pane displays, so
read it directly — **do not filter the pane to view results** (see §6.3):

```bash
ssh hahnca.com "sqlite3 -readonly /root/dev/apps/tv/unilog/unilog.sqlite '.mode list' \
  \"SELECT id, log_id, substr(ts,12), message FROM log_events \
     WHERE log_id IN (SELECT log_id FROM site_groups WHERE group_id=85) \
     AND id > <LAST_ID> ORDER BY id ASC\""
```

Group `85` = `scrolljump`.

### 3.1 Clean capture — live event appended while scrolled up

Nine consecutive appends, user parked at `scrollTop` 11898, viewport 508px tall,
~500 rows loaded, no filter (`disp 500/500`):

```
append 1 row:  pad 11400 → 11398   scrollTop 11898 → 11896
append 1 row:  pad 11398 → 11400   scrollTop 11898 → 11900
append 1 row:  pad 11400 → 11398   scrollTop 11898 → 11896
... alternating indefinitely
```

**Row height is a uniform 25px.** `vDomRowHeight` = 25, and the apparent
23/27px `scrollHeight` deltas are just the ±2px pad oscillation superimposed on
a clean 25px row.

### 3.2 The critical finding

`vDomTopPad` and `scrollTop` move **in lockstep, same direction, same
magnitude**:

| | Δ pad | Δ scrollTop |
| --- | --- | --- |
| append A | −2 | −2 |
| append B | +2 | +2 |

A row's on-screen position is `rowOffsetTop − scrollTop`, and `rowOffsetTop`
includes `vDomTopPad`. So:

```
visible shift = Δpad − ΔscrollTop = 0
```

**Tabulator's ±2px `scrollTop` drift on live append is correct compensation for
its own ±2px padding oscillation. Content is visually stationary. The live-append
path is NOT the bug.** This invalidates the conclusion reached earlier in the
session.

---

## 4. Working tree state — already reverted, start from a clean baseline

**`log.vue` has been restored to `HEAD` (`d75addef`). `git status` is clean apart
from this file.** Nothing from the failed investigation remains in the source —
no partial fixes, no instrumentation. Start from a pristine baseline.

The revert was a plain `git restore apps/client/src/components/log.vue`, verified
against the diff beforehand: the only working-tree changes were (a) the harmful
pin described below and (b) the instrumentation in §6.2. All four failed fixes in
§5 had already been backed out during the session, so nothing else was lost.

### 4.1 What the pin was, and why it was wrong — keep this lesson

`appendRows()` had been changed to hold `scrollTop` constant across a live
append:

```js
const savedScrollTop = stick ? 0 : this.holder?.scrollTop ?? 0;
...
const driftedTop = this.holder?.scrollTop ?? 0;
if (!stick && this.holder && driftedTop !== savedScrollTop) {
  this.holder.scrollTop = savedScrollTop;      // actively harmful
}
```

Given §3.2 this is **backwards**. Holding `scrollTop` constant while
`vDomTopPad` still oscillates ±2px forces a real ±2px *content* jump on every
live event — the opposite of the intent. The DB confirms it did exactly what it
claimed (`saved 11898 drifted 11896 pinned 11898`, repeating), and that is
precisely the problem.

**The general trap:** `scrollTop` staying constant does not mean the content
stayed still. What the user sees is `rowOffsetTop − scrollTop`, and
`rowOffsetTop` moves with `vDomTopPad`. Any future fix must be judged on
`Δpad − ΔscrollTop`, never on `scrollTop` alone. A metric that only logs
`scrollTop` will confidently report success while the view jumps.

---

## 5. Failed fixes — do not repeat

All four produced "no change" from the user.

### 5.1 Correct `scrollTop` by the `scrollHeight` delta after prepend
No-op. Tabulator derives `vDomBottomPad` from a cached `vDomScrollHeight` that is
only recomputed on a full render at position 0 (`_virtualRenderFill`, the
`if(!position)` branch). Prepending 500 rows barely changes the element's
`scrollHeight`, so the computed delta was ~0.

### 5.2 Re-anchor with `scrollToRow(anchorRow, "top", true)` after prepend
No change. Any correction applied *after* `addData` is competing with
Tabulator's own cached `vDomScrollPosTop/Bottom`; desyncing those makes its next
scroll handler treat the difference as a user scroll.

### 5.3 Pre-adjust `vDomTop` / `vDomBottom` by `older.length` before `addData`
No change. The reasoning was sound — `addRows()` unshifts rows into the display
array *before* `rerenderRows()` runs, while `vDomTop`/`vDomBottom` still hold
pre-insert values (`VirtualDomVertical.js:78-90`) — but correcting it did not
alter the symptom, which is evidence the prepend path is not what the user is
hitting.

### 5.4 Pin `scrollTop` across live append
See §4.1. Harmful — it was reported as "confirmed fixed" on the strength of a
metric that only watched `scrollTop`. Already reverted.

### 5.5 Also ruled out
- **Stale holder reference** — instrumentation flags `!HOLDER` if
  `this.holder !== $refs.tableEl.querySelector(".tabulator-tableholder")` or it
  is detached. Never fired.
- **`loadOlder()` prepend** — in every *clean* (unfiltered) capture,
  `loadOlder` never fired at all. The user reproduces the jerk near the bottom,
  nowhere near the top of the loaded range. The only prepend traces captured were
  polluted (§6.3).

---

## 6. Remaining prime suspect

Not yet captured, because the probes were only armed around prepends and
prepends never fire in the clean repro.

**Tabulator's incremental scroll-render path**, `VirtualDomVertical.js`:

- `scrollRows(top, dir)` (line 114). On upward scroll it calls `_addTopRow`.
- `_addTopRow` (line 395) prepends rows to the DOM and reduces `vDomTopPad` by
  their measured height — but contains an estimate-reset:

  ```js
  this.vDomTopPad -= paddingAdjust;
  if(this.vDomTopPad < 0){
    this.vDomTopPad = index * this.vDomRowHeight;   // discontinuous jump
  }
  ```

  Replacing an accumulated pad with `index * averageRowHeight` is a
  discontinuity — a jump — whenever accumulated drift pushes the pad negative.

- The **big-scroll redraw** branch (line 122): when the scroll delta exceeds
  `margin = vDomWindowBuffer * 2` (here 2 × 508 = 1016px — easily exceeded by a
  fast wheel flick), it re-renders from a *proportional estimate*:

  ```js
  this._virtualRenderFill(Math.floor((scrollTop / scrollHeight) * rows.length));
  ```

  A proportional guess landing anywhere near, but not exactly on, the previous
  position is precisely a "scrolls up then snaps back down" artifact.

### 6.1 If you want to confirm before rewriting

Log **every** scroll event during one upward gesture (not just around prepends):
`scrollTop`, `vDomTop`, `vDomBottom`, `vDomTopPad`, `vDomScrollPosTop`. Watch for
a frame where `Δpad ≠ ΔscrollTop` — that is the visible jump, by the §3.2
identity. Keep it bounded (a counter armed on first scroll, ~40 events) or it
self-feeds: these logs are themselves log events streaming back into this table.

### 6.2 Instrumentation — removed from source, still registered in the DB

The instrumentation was reverted along with everything else (§4), so **none of it
is in `log.vue` any more**. It was:

| id | site | fired on |
| --- | --- | --- |
| 1626 | `onScroll` | next N scroll events after a prepend (`scrollProbe` counter) |
| 1627/1628/1629 | `loadOlder` | before / sync-after / rAF-settled around a prepend |
| 1630 | `appendRows` | every live append while scrolled up |

plus a `scrollMetrics()` helper and a `scrollProbe` data field.

Two consequences to be aware of:

- **Log sites 1626–1630 are now orphaned** in `unilog.sqlite` — registered in
  `log_sites` and linked to group `scrolljump` (85), with no source line behind
  them. Harmless. Running `node unilog/run-reconcile.js client` from the repo
  root reconciles the registry (this also happens automatically on any
  `./srvr` deploy). The group itself can be deleted from the Groups pane.
- **The captured events are still in the DB** and remain readable with the query
  in §3 — the evidence in §3.1/§3.2 is reproducible without re-instrumenting.

If you re-instrument (§6.1), `logHere({ grp: "scrolljump" }, \`…\`)` will re-link
to the existing group; run the reconciler from `/root/apps/tv` to activate the
placeholders. **Log `vDomTopPad` alongside `scrollTop`** — per §4.1 a
`scrollTop`-only metric is actively misleading.

### 6.3 Measurement trap — do not filter the pane to read results

Filtering the pane by `scrolljump` **changes the behavior being measured**. With
only ~2 rows displayed the holder is not scrollable (`scrollH 508 == clientH 508`,
`vDom 0-1`, `pad 0/0`, `vScrollH -458`), so `scrollTop` is stuck at 0 and
`onScroll`'s `scrollTop < 80` guard fires `loadOlder()` on *every* scroll event —
a runaway that prepends 500 rows repeatedly (500 → 1000 → …). That is an artifact
of observing, not the user's bug. Read the DB directly instead.

That runaway is also a real latent bug worth fixing on its own: **`loadOlder`
must not trigger when the table cannot scroll.**

---

## 7. Why roll our own

The decisive fact: **rows are a uniform, fixed 25px.** Messages are single-line
(`white-space: nowrap; overflow: hidden; text-overflow: ellipsis` — `log.vue`
style block), so no row is ever taller than another.

Tabulator's entire vertical virtual DOM exists to handle *variable* row heights:
it measures rendered rows, maintains `vDomRowHeight` as a floored average,
accumulates `vDomTopPad`/`vDomBottomPad` incrementally, caches
`vDomScrollHeight`, and re-derives scroll position on every mutation. Every
failure in §3–§6 is that machinery drifting or estimating.

With fixed row height, virtualization is **pure arithmetic with no measurement
and no drift**:

```
contentHeight = rowCount * ROW_H
firstVisible  = floor(scrollTop / ROW_H)
```

Scroll position stops being something a library restores and becomes something
that *cannot* be wrong. A prepend of N rows is exactly `scrollTop += N * ROW_H` —
provably stationary, no anchor row, no re-measure, no compensation.

This also deletes accumulated workaround code in `log.vue`: `TRIM_MARGIN`
batching, the `appending` guard, the `scrollToBottom` "top"-not-"bottom" hack,
the `addData`-instead-of-`replaceData` flash avoidance, and §4.

Alternative: `@tanstack/vue-virtual` supplies just the windowing math and you own
the markup. Fine choice, but for fixed-height rows the math below is ~40 lines,
so a dependency buys little.

---

## 8. Design for the custom scroller

### 8.1 DOM structure

```
<div class="logScroll">            <!-- overflow: auto; the ONLY scroller -->
  <div class="logHeader">…</div>   <!-- position: sticky; top: 0 -->
  <div class="logSpacer">          <!-- height: total * ROW_H; position: relative -->
    <div class="logWindow">        <!-- position:absolute; transform: translateY(start*ROW_H) -->
      <div class="logRow" v-for="row in windowRows" :key="row.id"> … </div>
    </div>
  </div>
</div>
```

The spacer establishes the true scrollable height up front, so the scrollbar is
correct and stable from the first frame — no `vDomScrollHeight` cache, no
bottom-pad estimate.

Use `transform: translateY(...)` rather than `padding-top` for the window
offset: it does not trigger layout, and it keeps the offset independent of the
spacer height so the two can never disagree.

### 8.2 Core state and render

```js
const ROW_H = 25;         // must match CSS exactly; assert in dev
const OVERSCAN = 10;      // rows rendered above/below the viewport

// rows: full loaded set, ascending by id (oldest first) — same order as today
// visible: rows after filtering (see 8.6)

computed: {
  totalHeight() { return this.visible.length * ROW_H; },
  startIdx() {
    return Math.max(0, Math.floor(this.scrollTop / ROW_H) - OVERSCAN);
  },
  endIdx() {
    const n = Math.ceil(this.viewportH / ROW_H) + OVERSCAN * 2;
    return Math.min(this.visible.length, this.startIdx + n);
  },
  windowRows() { return this.visible.slice(this.startIdx, this.endIdx); },
  offsetY() { return this.startIdx * ROW_H; },
}
```

`scrollTop` is a reactive data field updated from the scroll handler; everything
else derives from it. Rendering is a pure function of `(scrollTop, visible)`.

Throttle the scroll handler with `requestAnimationFrame` (coalesce to one update
per frame); do **not** debounce, or the window lags the scrollbar.

### 8.3 The mutations — this is the whole point

Each is exact, with no measurement:

```js
// Prepend N older rows (loadOlder). Content stays visually stationary.
prepend(older) {
  this.rows.unshift(...older);
  this.scrollTop = this.el.scrollTop += older.length * ROW_H;
}

// Append live rows at the bottom. Nothing above moves — no correction at all.
append(newRows) {
  this.rows.push(...newRows);
  if (this.atBottom) this.scrollToBottom();
}

// Trim M rows off the front (MAX_ROWS cap).
trimFront(m) {
  this.rows.splice(0, m);
  if (!this.atBottom) this.scrollTop = this.el.scrollTop -= m * ROW_H;
}

scrollToBottom() {
  this.el.scrollTop = this.totalHeight - this.viewportH;   // exact, one step
}
```

Note `scrollToBottom` becomes a single exact assignment. The current
`scrollToRow(lastRow, "top", true)` workaround — and the long comment explaining
why "bottom" strands you a screen short — disappears entirely.

Order matters for `prepend`: adjust `scrollTop` in the **same synchronous task**
as the data change, before the browser paints, so no intermediate frame is shown.

### 8.4 Stick-to-bottom

Keep the existing hysteresis, it is sound:

```js
const gap = totalHeight - scrollTop - viewportH;
if (gap > 60) atBottom = false;
else if (gap < 24) atBottom = true;
```

### 8.5 Paging in older rows

Trigger on **row index**, not pixels, and never when the content is too short to
scroll (fixes §6.3):

```js
const canScroll = this.totalHeight > this.viewportH;
if (canScroll && this.startIdx < 50 && !this.loading && !this.exhausted) {
  this.loadOlder();
}
```

### 8.6 Filtering

Filtering becomes a plain computed array, and — unlike today — the virtualization
math automatically follows it, because everything derives from `visible.length`:

```js
visible() {
  return this.rows.filter(r =>
    matchText(r.message, f.message) &&
    matchList(r.level,   f.level)   &&
    matchList(r.pid,     f.pid)     &&
    matchText(r.groups,  f.groups)  &&
    matchText(r.src_file, f.file)   &&
    matchExact(r.src_line, f.line)  &&
    matchExact(r.id,      f.id)     &&
    matchExact(r.log_id,  f.logId)  &&
    (!groupFilterOn || groupFilterIds.has(r.log_id))
  );
}
```

Preserve today's two special semantics (`log.vue:591-600`):
- a lone `-` in a text filter matches only **blank** values;
- empty filter matches everything;
- Id / Log Id / Line are **exact** match, not substring.

For 5000 rows this is sub-millisecond; recompute eagerly. If it ever matters,
cache by filter-signature.

### 8.7 Columns

Fixed pixel widths, already known — reuse them verbatim from `columns()`
(`log.vue:601-690`):

| field | width | align | note |
| --- | --- | --- | --- |
| `ts` | 105 | center | strip leading `YYYY/`; live "oldest ts" clock in header |
| `message` | 400 | | text filter |
| `level` | 50 | center | list filter; row tint by level |
| `pid` | 71 | center | strip leading `tv-`; list filter |
| `groups` | 139 | | text filter |
| `src_file` | 300 | | display as `/root/apps/tv/<value>` |
| `src_line` | 45 | right | exact filter |
| `id` | 55 | right | exact filter |
| `log_id` | 55 | right | exact filter; 20px right padding |

Use one CSS grid template shared by the header and every row, so columns cannot
drift apart:

```css
.logHeader, .logRow {
  display: grid;
  grid-template-columns: 105px 400px 50px 71px 139px 300px 45px 55px 55px;
  height: 25px;          /* ROW_H — single source of truth */
}
```

Horizontal scrolling comes free from the single outer scroller; the existing
`scrollLeft`/`scrollRight` buttons keep working (`el.scrollLeft = 0` /
`el.scrollWidth`). Header stays put with `position: sticky; top: 0`.

### 8.8 Behaviour that must be preserved

From the existing pane — all of it already lives in `log.vue` and is independent
of Tabulator except where noted:

- **Selection**: plain click (select only / deselect if sole), ctrl-click toggle,
  shift-click range over *displayed* rows, anchor tracking, selection history with
  Prv/Nxt. Already custom (`selectedIds` Set) — only row-painting needs rewiring.
- **Row painting**: selected rows `#b3d4fc`; `error` level cell `#ffe5e5`,
  `warn` `#fff6d9`. Becomes a plain `:class`/`:style` binding — the `rowFormatter`
  + `reformat()` dance goes away.
- **Cell gestures**: alt-click copies cell value (pink flash, `src_file` copies
  with the `/root/apps/tv/` prefix); ctrl+alt-click loads the value into that
  column's header filter.
- **Header filter gestures**: ctrl-click clears a column's filter; second click
  on an open list dropdown closes it. Currently needs capture-phase mousedown/click
  interception to fight Tabulator's editor (`onHeaderMouseDown`/`onHeaderClick`) —
  with our own header these become ordinary handlers and the whole
  `suppressHeaderClick` mechanism disappears.
- **Native tooltips**: `title` attribute per cell (cells are cropped to one line).
- **Time clock**: oldest-ts label injected at the bottom of the Time header.
- **Counts**: `selected / displayed / loaded / dbTotal`.
- **Flush batching**: 500ms buffer for incoming events; today it must also avoid
  flushing while a header-filter dropdown is open, because a Tabulator redraw
  closes it. **That constraint disappears** — our render never destroys the
  header.

### 8.9 Invariants worth asserting in dev

- Measured `.logRow` `offsetHeight === ROW_H`. If CSS and `ROW_H` ever diverge,
  every calculation silently skews. Assert once after first render.
- `el.scrollHeight === totalHeight + headerH` (± 1px).

---

## 9. Migration plan

1. ~~Revert the `appendRows` pin.~~ **Done** — `log.vue` is back at `HEAD`
   (§4). Nothing to undo before starting.
2. Build the scroller as a **new component** (e.g. `logTable.vue`) taking
   `rows`, `filters`, `selectedIds` as props and emitting scroll/selection
   events. Do not modify `log.vue` in place — keep the data plumbing
   (`loadLogs`/`loadOlder`/`loadMissed`/WS subscribe/groups pane/actions) exactly
   as is; only the table rendering is being replaced.
3. Render it behind a flag next to the Tabulator table, feeding both from the
   same data, and compare scroll behaviour side by side.
4. Port selection, painting, cell gestures, header filters.
5. Delete the Tabulator table and the workaround comments/constants that existed
   only to fight it (§7). Also clear out any instrumentation added along the way,
   and reconcile so its log sites are not left orphaned (§6.2).
6. Drop the `tabulator-tables` dependency **only after** checking nothing else
   imports it: `grep -rn "tabulator" apps/client/src`.

Keep the android tv-pane parity rule in mind (project rule: a change to the web
client tv pane should be mirrored in the android app) — the log pane is
web-client-only today, so this should not apply, but verify before finishing.

---

## 10. Open questions for the next session

1. **Confirm §6 before rewriting?** The rewrite is justified on its own merits
   (§7), but capturing one clean upward-gesture trace (§6.1) would prove the jump
   is Tabulator's incremental render and not something in our own code that would
   survive the rewrite. Cheap; recommended.
2. The `loadOlder`-when-unscrollable runaway (§6.3) is a real bug regardless of
   the rewrite — fix it either way (§8.5).
3. `MAX_ROWS = 5000` at 25px = 125,000px of spacer. Well within browser limits
   (Chrome ~33M px), so a single spacer div is fine; no tiling needed.
