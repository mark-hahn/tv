# intro-condfltr plan

## Files to change

- `apps/srvr/index.js`
- `apps/client/src/components/list.vue`
- `apps/client/src/util.js`

---

## 1. Compute `needsIntro` server-side in `perShowCallback` (`srvr/index.js`)

In the same location where `tvdbRecord.full` is computed (after the gap check block),
add:

```js
const newNeedsIntro = !!(
  tvdbRecord.inEmby &&
  !tvdbRecord.inLinda &&
  tvdbRecord.introDur == null &&
  Number(tvdbRecord.episodeCount ?? 0) > Number(tvdbRecord.watchedCount ?? 0) &&
  Array.isArray(tvdbRecord.filesOnDisk) &&
  tvdbRecord.filesOnDisk.some((row) => Array.isArray(row) && row.length > 1)
);
if (!!tvdbRecord.needsIntro !== newNeedsIntro) {
  gapChanges.push(`needsIntro:${tvdbRecord.needsIntro}->${newNeedsIntro}`);
  tvdbRecord.needsIntro = newNeedsIntro;
}
```

`filesOnDisk` is freshly set earlier in the same perShowCallback run (disk check).
`watchedCount` and `episodeCount` come from the last Emby sync, persisted in tvdb.json.
Also add `"needsIntro"` to the `flatGapFields` array in `srvr/src/tvdb.js` so it is
preserved across tvdb record merges.

---

## 2. Replace `full` cond with `needsIntro` in `conds` array (`list.vue` ~line 683)

Replace the `full` cond object (icon `arrow-up`, `cond: show.full`) with:

```js
{
  color: "#0cf",
  filter: 0,
  icon: ["fas", "film"],
  cond(show) { return !!show.needsIntro; },
  click() {},
  name: "needsIntro",
},
```

Same pattern as `full` — a simple boolean on the show object.

---

## 3. Replace `show.full` assignments with `show.needsIntro` (`list.vue` lines ~3420 and ~3574)

- Replace `show.full = tvdbRecord.full ?? false;` with `show.needsIntro = tvdbRecord.needsIntro ?? false;`
- Replace `show.full = record.full ?? false;` with `show.needsIntro = record.needsIntro ?? false;`

---

## 4. Update `allTvdb` loading condition (`list.vue` ~line 2893)

Remove `"Needs Intro"` from the condition. Replace:

```js
if (this.fltrChoice === "Finished" || this.fltrChoice === "Needs Intro") {
```

With:

```js
if (this.fltrChoice === "Finished") {
```

---

## 5. Remove "Needs Intro" special-casing in filter loop (`list.vue` ~lines 2956–2987)

**5a.** Remove the `hasemby` forced-to-`+1` hack (~line 2956). Replace:

```js
const effectiveFilter =
  this.fltrChoice === "Needs Intro" && cond.name === "hasemby"
    ? +1
    : cond.filter;
```

With:

```js
const effectiveFilter = cond.filter;
```

(The `needsIntro` cond already checks `show.inEmby !== false` directly.)

**5b.** Remove the entire `if (this.fltrChoice === "Needs Intro") { ... continue; }` block
(~lines 2964–2987). The `needsIntro` condfltr replaces this logic.

---

## 6. Update `introPaneClosed` handler (`list.vue` ~line 3793)

Replace:

```js
if (this.fltrChoice !== "Needs Intro") return;
```

With:

```js
if (this.conds.find((c) => c.name === "needsIntro")?.filter !== 1) return;
```

---

## 7. Remove "Needs Files" and "Needs Intro" from `fltrChoices` (`list.vue` ~lines 657, 660)

Delete both string entries from the `fltrChoices` array.

---

## 8. Update `setCondFltr` in `util.js`

- Delete the entire `case "Needs Files":` block.
- In all remaining cases (All, Try Drama, Watching, Finished): replace `tmp.full = ...`
  with `tmp.needsIntro = 0`.

---

## Ambiguities / Notes

1. **Server deploy required** — `srvr/index.js` and `srvr/src/tvdb.js` are changed.
   Deploy with `./srvr srvr`.

2. **`full` field in tvdb.json** — `tvdbRecord.full` is still computed and stored by the
   server (no change to that logic). It stays in `tvdb.json` as an unused field.

3. **Color collision** — Both `needsIntro` (film icon) and `unplayed` (plus icon) use `#0cf`.
   Per spec this is intentional. They will look identical when active in hdrbot and show row.
   Consider using a slightly different shade if this causes visual confusion — but leaving
   as-is per spec.

4. **`needsIntro` staleness** — `watchedCount` updates on Emby sync; `filesOnDisk`,
   `inLinda`, `introDur` update in perShowCallback. `needsIntro` will be current after
   the next perShowCallback run for the show, same as all other derived fields.

5. **`needsIntro` not added to any preset filter as +1** — The "Needs Intro" dropdown filter
   previously auto-selected all its conditions as a bundle. With the condfltr approach the
   user just clicks the film icon directly. No preset activates it as +1, which is correct.
