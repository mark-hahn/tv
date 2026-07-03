# Plan: unilog Groups Management Pane

## Summary

Add a "Groups" overlay pane to the unilog log viewer that lets the user
create, assign, remove, delete, and filter-by unilog groups. Groups live in
the `log_groups` table; site→group links live in `site_groups`. The pane is a
new UI region inside `log.vue`, backed by new DB helpers in `unilogDb.js` and
new REST endpoints in the `tv-srvr` `index.js`.

## Relevant existing code (verified)

- **Log pane UI**: [apps/client/src/components/log.vue](apps/client/src/components/log.vue)
  - Toolbar with the Actions `<select v-model="actionSel">` (around
    [log.vue](apps/client/src/components/log.vue#L115)). The `Groups` button goes
    immediately to the right of this selector.
  - `Groups` column already exists in `columns()`
    ([log.vue](apps/client/src/components/log.vue#L323)) with a plain `input`
    header filter — that string filter is **kept unchanged**.
  - Selection model: `selectedIds` (event-row ids), `selectedSites()` returns
    distinct `{ id: log_id, srcFile }` across selected rows
    ([log.vue](apps/client/src/components/log.vue#L588)). This is exactly the
    "selected sites in the event rows" the instructions reference.
  - `active` prop drives `activate()` / `deactivate()` (watcher at
    [log.vue](apps/client/src/components/log.vue#L221)) — the hook for
    "hide groups pane when log pane is opened or closed".
- **Client API layer**: [apps/client/src/srvr.js](apps/client/src/srvr.js#L310)
  (`getUnilogEvents`, `setUnilogSiteLevel`, `httpCall`). New group calls added here.
- **DB owner (single writer = tv-srvr)**: [apps/srvr/src/unilogDb.js](apps/srvr/src/unilogDb.js)
  - Schema: `log_groups(group_id, group_type, ts, description)` and
    `site_groups(log_id, group_id)` ([unilogDb.js](apps/srvr/src/unilogDb.js#L44)).
  - Existing helpers: `createGroup`, `groupsForSite`, `nowPst`, exported `db`.
- **REST endpoints**: [apps/srvr/index.js](apps/srvr/index.js#L4228) already has a
  cluster of `/api/unilog/*` routes — new routes slot in here.
- **Layout**: In [App.vue](apps/client/src/components/App.vue#L334) the `<Log>`
  pane lives inside `#tabBody` (the pane area); `<List>` (`#list`) is a sibling
  on the other side of `#paneDivider`
  ([App.vue](apps/client/src/components/App.vue#L372)). The groups pane must
  overlay the `#list` region **without editing `list.vue`**.

## Backend changes — `apps/srvr/src/unilogDb.js`

Add and export:

1. `listGroups()` → `SELECT group_id, description FROM log_groups WHERE
description IS NOT NULL ORDER BY description COLLATE NOCASE`. (Rows whose
   `description` is NULL are treated as un-named and excluded, matching the
   existing `groupsForSite` behavior which already filters `description IS NOT
NULL`.)
2. `groupExistsByName(description)` → boolean via
   `SELECT 1 FROM log_groups WHERE description = ? COLLATE NOCASE`.
3. `createGroupWithSites({ description, logIds })` (transaction):
   - If a group with that description already exists → return
     `{ created: false }` and do nothing.
   - Else allocate `group_id` (same `MAX+1` pattern as `createGroup`), insert
     into `log_groups` with `group_type = 'manual'`, `ts = nowPst()`, then
     `INSERT OR IGNORE INTO site_groups` for each `logId`.
   - Return `{ created: true, groupId, linked: <count> }`.
4. `assignGroupsToSites({ groupIds, logIds })` (transaction): for every
   (groupId × logId) pair `INSERT OR IGNORE INTO site_groups`. Return
   `{ added: <rows changed> }`.
5. `removeGroupsFromSites({ groupIds, logIds })` (transaction): for every
   (groupId × logId) pair `DELETE FROM site_groups WHERE log_id=? AND
group_id=?`. Return `{ removed: <rows changed> }`.
6. `groupDeletionStats(groupIds)` → `{ groups: groupIds.length, sites:
COUNT(DISTINCT log_id) in site_groups for those groupIds }`. Used to build
   the confirmation text before deletion.
7. `deleteGroups(groupIds)` (transaction): `DELETE FROM site_groups WHERE
group_id IN (...)` then `DELETE FROM log_groups WHERE group_id IN (...)`.
   Return `{ groups, sites }` (the pre-delete stats).
8. `siteIdsForGroups(groupIds)` → `SELECT DISTINCT log_id FROM site_groups
WHERE group_id IN (...)`. Returns an array of `log_id`s used by the client
   to apply the "Filter" checkbox.

All use parameterized statements (no string interpolation of user input) to
stay clear of SQL injection.

## Backend changes — `apps/srvr/index.js`

Add routes next to the existing `/api/unilog/*` block
([index.js](apps/srvr/index.js#L4228)), each wrapped in try/catch with
`console.error(... )// no-unilog` like the neighbors:

- `GET  /api/unilog/groups` → `{ groups: listGroups() }`
- `POST /api/unilog/groups/create` → body `{ description, logIds }` →
  `createGroupWithSites(...)`
- `POST /api/unilog/groups/assign` → body `{ groupIds, logIds }` →
  `assignGroupsToSites(...)`
- `POST /api/unilog/groups/remove` → body `{ groupIds, logIds }` →
  `removeGroupsFromSites(...)`
- `POST /api/unilog/groups/delete` → body `{ groupIds }` → `deleteGroups(...)`
- `POST /api/unilog/groups/site-ids` → body `{ groupIds }` →
  `{ logIds: siteIdsForGroups(...) }`

(Delete stats are returned by the delete call itself; the confirmation dialog
is built on the client from the selected group count and a separate site-ids
lookup — see below — so no extra stats endpoint is strictly required. A
`groupDeletionStats` helper is still added so the confirm text is accurate
without a redundant round trip.)

## Client API — `apps/client/src/srvr.js`

Add thin wrappers mirroring `getUnilogEvents` / `setUnilogSiteLevel`:

```js
export function getUnilogGroups() {
  return httpCall("/api/unilog/groups", {}, "GET");
}
export function createUnilogGroup(description, logIds) {
  return httpCall("/api/unilog/groups/create", { description, logIds }, "POST");
}
export function assignUnilogGroups(groupIds, logIds) {
  return httpCall("/api/unilog/groups/assign", { groupIds, logIds }, "POST");
}
export function removeUnilogGroups(groupIds, logIds) {
  return httpCall("/api/unilog/groups/remove", { groupIds, logIds }, "POST");
}
export function deleteUnilogGroups(groupIds) {
  return httpCall("/api/unilog/groups/delete", { groupIds }, "POST");
}
export function getUnilogGroupSiteIds(groupIds) {
  return httpCall("/api/unilog/groups/site-ids", { groupIds }, "POST");
}
```

## Client UI — `apps/client/src/components/log.vue`

### Toolbar button

Add a `Groups` `<button class="logBtn">` right after the Actions `<select>`.
Click → `toggleGroupsPane()`. Shown only while the log pane is active (the whole
toolbar already only renders when `active`).

### New reactive state (in `data()`)

- `showGroupsPane: false`
- `groups: []` — `[{ group_id, description }]`, alphabetical
- `selectedGroupIds: []` — bound to the multi-select
- `newGroupName: ""`
- `filterByGroups: false`
- `groupFilterIds: new Set()` — `log_id`s currently allowed by the group filter
- `groupPaneStyle: {}` — computed fixed-position style aligned to `#list`

### Pane markup (v-show, overlay)

```
<div v-show="showGroupsPane" class="groupsPane" :style="groupPaneStyle"> ... </div>
```

- `position: fixed`, sized "only as large as needed" (fixed max-width, e.g.
  ~360px; height auto up to a max). Positioned so its **right edge aligns to the
  right edge of `#list`** and it is **vertically centered in the window**.
  Geometry is read from `document.getElementById('list').getBoundingClientRect()`
  when the pane is shown and on `window` resize (a `resize` listener added in
  `activate`, removed in `deactivate`). `list.vue` itself is not touched.
- `z-index` above the list; light border + shadow; `box-sizing: border-box`.

Layout inside the pane (two columns):

- **Left**: title `Groups` then a native `<select multiple>` filling the
  remaining pane height, one `<option :value="g.group_id">{{ g.description }}`
  per group, `v-model="selectedGroupIds"`.
- **Right (controls column)**, top to bottom:
  - `Filter` checkbox — `v-model="filterByGroups"`,
    `:disabled="selectedGroupIds.length === 0"`, visually grayed when disabled.
  - New-group `<input v-model="newGroupName">` + `Add Group` button
    (`:disabled="!newGroupName.trim()"`).
  - `Delete Selected` button (`:disabled="selectedGroupIds.length === 0"`).
  - `Assign` button and `Remove` button.

### New methods

- `toggleGroupsPane()` — flip `showGroupsPane`; when turning on, recompute
  `groupPaneStyle` and `loadGroups()`.
- `positionGroupsPane()` — read `#list` rect, set `groupPaneStyle`.
- `loadGroups()` — call `srvr.getUnilogGroups()`, store sorted list.
- `addGroup()` — trimmed name; call `createUnilogGroup(name, selectedSiteIds)`
  where `selectedSiteIds = selectedSites().map(s => s.id)`. On `created:false`
  flash "group exists". On success: clear input, `loadGroups()`, refresh the
  `groups` column of affected loaded rows, and re-apply the group filter if on.
- `assignGroups()` — `assignUnilogGroups(selectedGroupIds, selectedSiteIds)`,
  then refresh affected rows' `groups` strings + filter.
- `removeGroups()` — `removeUnilogGroups(selectedGroupIds, selectedSiteIds)`,
  then refresh.
- `deleteGroups()` — build confirm text
  `Is it ok to remove X groups from Y sites?` where X =
  `selectedGroupIds.length` and Y = distinct sites (from a
  `getUnilogGroupSiteIds(selectedGroupIds)` lookup). On confirm call
  `deleteUnilogGroups(...)`, then `loadGroups()`, clear `selectedGroupIds`,
  refresh rows + filter.
- `applyGroupFilter()` — when `filterByGroups` and there are selected groups,
  fetch `getUnilogGroupSiteIds(selectedGroupIds)` into `groupFilterIds` and add
  a Tabulator custom filter `row => groupFilterIds.has(row.log_id)`; otherwise
  remove that filter. Runs on: filter toggle, selection change (watcher on
  `selectedGroupIds`), and after any assign/remove/delete/add. This is layered
  **in addition to** the existing header/string filters (Tabulator ANDs
  multiple `addFilter` predicates), satisfying "in addition to all other
  filtering".
- Refresh helper `refreshRowGroups(logIds)` — re-fetch group strings for the
  affected sites (either via a small endpoint or by re-reading from the next
  event; simplest: call `getUnilogGroupSiteIds`-style data). **See ambiguity
  #6.**

### Visibility rules

- In `activate()` and `deactivate()` set `showGroupsPane = false` (hidden
  whenever the log pane is opened or closed), but do **not** reset the other
  group state — `v-show` keeps `groups`, `selectedGroupIds`, `newGroupName`,
  etc. alive "until reload", per spec.
- Add/remove the `window` `resize` listener in `activate`/`deactivate`.

## Ambiguities, contradictions, and notes

1. **Overlay ownership.** The pane is logically part of the log feature and its
   state must live in `log.vue`, but it must visually overlay `#list`, which is
   a sibling of `#tabBody`. Because we may not edit `list.vue`, the plan uses a
   `position: fixed` pane in `log.vue` whose geometry is derived from
   `#list`'s bounding rect. This works but couples to the `#list` element id
   (stable today). Alternative: render the pane via a Vue `<Teleport to="body">`
   — functionally identical; noting the choice.

2. **"Selected sites in the event rows".** Interpreted as the distinct
   `log_id`s among currently selected event rows (existing `selectedSites()`).
   `Add Group`, `Assign`, and `Remove` all act on this set. If no rows are
   selected, `Add Group` still creates the (empty) group; `Assign`/`Remove`
   become no-ops. Spec doesn't say to disable Assign/Remove when no sites are
   selected — **suggestion:** also gray/disable `Assign` and `Remove` when
   either no groups **or** no sites are selected (not required by spec).

3. **Add Group when the name already exists → "do nothing".** Taken literally:
   the group is not created **and** the selected sites are **not** linked to the
   existing same-named group. Flagging this because a user might expect the
   selected sites to be added to the existing group; the plan follows the
   literal instruction (do nothing) and just flashes a notice.

4. **`group_type` for user-created groups.** The schema has a `group_type`
   column (existing values: `history`, `task`). The spec doesn't specify one;
   the plan uses `'manual'`. Easy to change.

5. **Alphabetical order / identity by description.** Sorting and the
   "already exists" check are case-insensitive (`COLLATE NOCASE`). Groups with
   NULL descriptions are excluded from the list (consistent with the existing
   `groupsForSite`). If duplicate descriptions already exist in the DB, they
   will appear as separate options; the "exists" check will still block adding a
   new duplicate. Noting this pre-existing-data edge case.

6. **Stale `groups` column after edits.** Assign/Remove/Add/Delete change
   `site_groups`, so the `groups` string already shown on loaded event rows goes
   stale. The spec doesn't mention refreshing it, but **suggestion:** after each
   mutation, update the affected rows' `groups` cell so the UI stays truthful.
   This needs the per-site group string. Cleanest is a tiny endpoint
   `POST /api/unilog/groups/for-sites { logIds } -> { <logId>: "a, b, c" }`
   (wrapping the existing `groupsForSite`). If we decide not to auto-refresh,
   the column simply updates the next time those events reload — calling this
   out as a decision point (plan assumes we add the small refresh endpoint).

7. **Filter interaction with live tail + paging.** New event rows streamed in
   while the filter is active won't be in `groupFilterIds` if their site was
   just linked; and older pages load lazily. The Tabulator custom-filter
   predicate handles whatever rows are present, and `applyGroupFilter()`
   re-fetches the id set after mutations, so it stays correct for loaded rows.
   Live rows for already-selected groups appear once `groupFilterIds` includes
   their `log_id` (refreshed on selection/mutation). Acceptable; noted.

8. **Dev-only vs. prod.** Unlike `Hide/Unhide` (vite-dev-only, they edit source
   files), all group operations are pure DB writes through `tv-srvr`, so the
   Groups pane works in both dev and production. No dev guard needed.

## Suggestions

- Disable/gray `Assign` and `Remove` when either no groups or no sites are
  selected (see #2) for clearer UX.
- Add the small `groups/for-sites` refresh endpoint (see #6) so the `Groups`
  column updates immediately after edits.
- Reuse the existing `flash(msg)` helper for all success/error feedback
  (e.g. "added 3 links", "group exists", "deleted 2 groups from 5 sites").
- Keep the pane width fixed and let the `<select multiple>` scroll, so the
  overlay stays "only as large as needed" regardless of group count.

## Deploy

Server changes (`unilogDb.js`, `index.js`) deploy with `./srvr srvr`; client
changes are picked up by vite. Per repo convention, do **not** deploy the client
separately. After deploying srvr, check `pm2 logs` for restart-crash loops.
