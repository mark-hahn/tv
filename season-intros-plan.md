# Plan: per-season intro data (`seasonIntros`)

Goal: store `trimPos`, `startMark`, `skipDur` per **season** instead of once per show,
in a new sparse `seasonIntros` map on the tvdb record, with a `getSeasonIntro(season)`
accessor that falls back to the nearest season when a season has no data.

This plan describes changes only — **no code was changed** (per instructions).

---

## 1. Current state (what exists today)

Intro values are **flat fields** on each tvdb record: `record.trimPos`, `record.startMark`,
`record.skipDur` (all in ms; `null` = unset, `0` = explicit zero). All logic lives in
`apps/srvr/index.js`.

**Readers** of the flat fields:
| Site | File / line | Uses |
|---|---|---|
| `doSkipIntro` | [index.js#L5662](apps/srvr/index.js#L5662) | `record.skipDur` (relative skip) |
| `doTrimIntro` | [index.js#L5719](apps/srvr/index.js#L5719) | `record.trimPos` (absolute seek) |
| `pushIntroState` | [index.js#L5796-L5798](apps/srvr/index.js#L5796) | all three (overlay labels) |
| `handleEmbyIntroPress` | [index.js#L5878](apps/srvr/index.js#L5878), [#L5900-L5905](apps/srvr/index.js#L5900) | reads for `pre`/`trimJump`/`skipTest`/`skipSet` |
| `/api/introDur` | [index.js#L5962-L5964](apps/srvr/index.js#L5962) | returns all three (skip-button display) |
| auto-trim on play | [index.js#L6221](apps/srvr/index.js#L6221) | `record.trimPos > 0` |
| `needsIntro` compute | [index.js#L2589-L2590](apps/srvr/index.js#L2589) | `trimPos == null && skipDur == null` |

**Writers** (per instruction, intro emby-web buttons are the _only_ legitimate writer):

- `handleEmbyIntroPress` `startMark`/`trimSet`/`skipSet`/`trimClr`/`skipClr`
  ([index.js#L5907-L5929](apps/srvr/index.js#L5907)) via `tvdb.setTvdbFields({ name, [field]: value })`.

**Season is already available** at every read/write site:

- `doSkipIntro`/`doTrimIntro`/`getEmbyIntroContext`: `session.NowPlayingItem.ParentIndexNumber`.
- `pushIntroState`: receives a `season` argument.
- auto-trim: `lrtv.season` from the now-playing item.
- `/api/introDur`: **not** currently passed a season (see §6 / Ambiguity A3).

Dead code note: `apps/client/src/components/video-player.vue` still has intro fields/labels
([L848-L850](apps/client/src/components/video-player.vue#L848), [L1012-L1014](apps/client/src/components/video-player.vue#L1012)),
but its `intro` mode is no longer invoked (intro now runs on the Emby web page). Out of scope.

---

## 2. Data model

Add `record.seasonIntros`:

```jsonc
"seasonIntros": {
  "1": { "trimPos": 0,    "startMark": 12000, "skipDur": 45000 },
  "3": { "trimPos": 8000, "startMark": null,  "skipDur": null }
}
```

Rules:

- Keys are season numbers (stored as JSON object string keys).
- Values are intro-data objects with exactly `trimPos`, `startMark`, `skipDur` (ms; `null` = unset).
- Sparse — only seasons that have been edited appear.
- The property is **`null` or absent** until the first season object is added; pruned back to
  `null` when the last season object is removed.

---

## 3. `getSeasonIntro` accessor (new)

Add to `apps/srvr/src/tvdb.js` and export it; signature `getSeasonIntro(record, season)`
(needs the record as well as the season — see Ambiguity A1).

Returns an intro-data object `{ trimPos, startMark, skipDur }`:

1. If `record.seasonIntros` is null/absent → return an **ephemeral** `{ trimPos: null, startMark: null, skipDur: null }` (not stored).
2. If `seasonIntros[season]` exists → return it.
3. Else fall back to the **nearest** season with data:
   - among existing keys `< season`, pick the **largest** (closest below) — i.e. scan `season-1, season-2, …`;
   - if none below, among keys `> season`, pick the **smallest** (closest above) — scan `season+1, season+2, …`.
4. If `seasonIntros` exists but is somehow empty → same ephemeral all-null object.

Return a shallow copy so callers can't accidentally mutate stored data.

**Update all readers** in §1 to call `getSeasonIntro(record, season)` and read `.trimPos` /
`.skipDur` / `.startMark` from the result instead of the flat fields:

- `doSkipIntro` → `getSeasonIntro(record, season).skipDur` (season = `NowPlayingItem.ParentIndexNumber`).
- `doTrimIntro` → `getSeasonIntro(record, season).trimPos` (read season from the session; currently it ignores season).
- `pushIntroState` → `getSeasonIntro(record, season)` for the three label values.
- `handleEmbyIntroPress` → use `getSeasonIntro(record, season)` for `startMark` baseline and for `pre`/`trimJump`/`skipTest` seek targets.
- auto-trim on play → `getSeasonIntro(record, lrtv.season).trimPos`.
- `/api/introDur` → `getSeasonIntro(record, season)` (requires a season query param; §6).

---

## 4. `saveSeasonIntro` helper (new)

Add a server-side helper (in `index.js` next to `handleEmbyIntroPress`, or in `tvdb.js`):
`saveSeasonIntro(record, season, field, value)` where `field ∈ {trimPos, startMark, skipDur}`.

Logic:

1. Clone `record.seasonIntros` (or `{}` if null).
2. If `seasonIntros[season]` missing → create `{ trimPos: null, startMark: null, skipDur: null }`.
3. Set `seasonIntros[season][field] = value`.
4. If all three of that season object are `null` → `delete seasonIntros[season]`.
5. If `seasonIntros` now has no keys → set the new value to `null`; else keep the object.
6. Persist: `await tvdb.setTvdbFields({ name: record.name, seasonIntros: <objectOrNull> })`.
   `setTvdbFields` already supports assigning a whole object/`null` to a top-level key
   ([tvdb.js#L3028](apps/srvr/src/tvdb.js#L3028)) and handles `saveTvdbSync` + client notify +
   the per-show reprocess that recomputes `needsIntro`.

**Rewire the button writers** in `handleEmbyIntroPress`:

- `startMark` → `saveSeasonIntro(record, season, "startMark", posMs)`.
- `trimSet` → `saveSeasonIntro(record, season, "trimPos", posMs)`.
- `skipSet` (when `posMs >= startMark`) → `saveSeasonIntro(record, season, "skipDur", posMs - startMark)`.
- `trimClr` → `saveSeasonIntro(record, season, "trimPos", current === 0 ? null : 0)` (preserve the existing `0 → null` toggle, read `current` via `getSeasonIntro`).
- `skipClr` → same toggle for `skipDur`.

`anticipating` stays a flat record field (not part of `seasonIntros`).

---

## 5. `needsIntro` recompute change

Current test ([index.js#L2589-L2590](apps/srvr/index.js#L2589)) uses the flat
`trimPos == null && skipDur == null`. Replace with a `seasonIntros`-aware test. Proposed:

> a show "needs intro" when it has **no** intro data at all, i.e. `record.seasonIntros == null`
> (plus the existing `inEmby`, `!inLinda`, unwatched-episodes, has-files conditions).

Rationale: `getSeasonIntro` already makes one marked season cover all seasons via fallback, so a
show with any `seasonIntros` entry is considered "done". (See Ambiguity A2 — alternative is
per-season needs-intro, which is a larger change and not requested.)

---

## 6. `/api/introDur` + `emby-skip-intro.user.js` (skip-button display)

The skip button shows `trimPos | skipDur` from `GET /api/introDur?showName=&showId=`
([emby-skip-intro.user.js#L264-L272](emby-skip-intro.user.js#L264)), which has no season →
it would always show season-agnostic (nearest/fallback) values, which may be wrong for the
current season.

Proposed: add an optional `season` query param to `/api/introDur`; have
`emby-skip-intro.user.js` read `session.NowPlayingItem.ParentIndexNumber` in
`getCurrentPlayingInfo` and pass it. The actual _skip action_ (`POST /api/skipIntro` →
`doSkipIntro`) already derives season from the live session, so only the **display** is affected.
(This touches the second userscript; flagged because userscripts deploy by manual copy/paste.)

---

## 7. Migration of existing flat values

`getSeasonIntro` returns all-null when `seasonIntros` is absent, so existing flat
`trimPos`/`startMark`/`skipDur` would be **ignored** after the switch. A one-time migration is
needed (consistent with the existing `scripts/migrate-*.js` pattern):

For each record with any non-null flat intro field:

- create `seasonIntros[S] = { trimPos, startMark, skipDur }` from the flat values, where `S` =
  the show's **lowest existing season** (so fallback covers all seasons), then delete the flat
  `trimPos`/`startMark`/`skipDur` fields.

Run with `tv-srvr` stopped (per repo rule about editing `tvdb.json` directly), then redeploy.
See Ambiguity A4 for the season-number choice.

---

## 8. Files to change (summary)

- `apps/srvr/src/tvdb.js` — add/export `getSeasonIntro(record, season)`; (optionally) `saveSeasonIntro`; update `needsIntro` if that logic lives here vs. index.js.
- `apps/srvr/index.js` — rewire all readers (§3), button writers (§4), `needsIntro` (§5), `/api/introDur` season param (§6).
- `emby-skip-intro.user.js` — pass season to `/api/introDur` (§6) — manual paste.
- `scripts/migrate-flat-intro-to-seasonIntros.js` — new one-time migration (§7).
- No client (`apps/client`) changes required; `video-player.vue` intro code is already dead.

---

## 9. Ambiguities / contradictions / impossibilities

- **A1 — `getSeasonIntro` signature.** The spec says "season number as param", but the function
  also needs the show/record to read `seasonIntros`. Plan: `getSeasonIntro(record, season)`.
- **A2 — `needsIntro` semantics.** The spec doesn't mention `needsIntro`. With per-season data a
  show could have some seasons marked and others not. Plan treats "any `seasonIntros` entry" as
  done (show-level), matching the fallback behavior. If per-season "needs intro" is wanted, the
  Intro queue/count logic would need a larger redesign.
- **A3 — Season-less display path.** `/api/introDur` (skip-button text) currently has no season.
  Without the §6 change the displayed `trimPos|skipDur` may not match the playing season (only
  cosmetic; the skip action is correct). Recommend doing §6.
- **A4 — Migration season number.** Existing flat values have no recorded season. Plan seeds them
  into the show's lowest existing season so the fallback applies them everywhere; an alternative
  is season `1`. Either is a judgment call — confirm before migrating, since it's hard to undo.
- **A5 — "scan smaller … if there are no seasons smaller then scan larger".** Interpreted as
  _no smaller season has data_ (not _no smaller season numbers exist_). The result is the nearest
  season with data, preferring the closest lower one. Confirm this is the intended tie-break.
- **A6 — Mutation safety.** `getSeasonIntro` returns a shallow copy so callers (which previously
  read immutable scalars) can't accidentally mutate stored season data.

## 10. Suggestions

- Centralize `getSeasonIntro`/`saveSeasonIntro` in `tvdb.js` so future readers can't bypass them
  and reintroduce flat-field reads.
- Add a debug log line in `saveSeasonIntro` (season, field, value, resulting key count, prune)
  to match the existing intro logging style.
- Keep `anticipating` exactly as-is (flat field) to limit blast radius.
- After migration, add an assertion/log if any record still has a flat `trimPos`/`skipDur`/`startMark`
  to catch stragglers.
