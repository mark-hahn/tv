# Plan: replace introDur with trimPos + skipDur (trimming & skipping)

This plan implements the changes described in `trim-skip-instr.md`. No code is
changed yet — this document is the plan only.

## Terminology recap

- **trimming** = auto-jump to an absolute video position (`trimPos`) when the
  video first starts playing. (old behavior: `introDur < 0`)
- **skipping** = jump ahead by a relative duration (`skipDur`) when the skip
  button is pressed. (old behavior: `introDur > 0`)

## New time-format helper

The spec defines a single display format `mmm:ss.t` that differs from the
existing `fmtTime`:

- seconds with tenths always shown (`t`)
- minutes (`mmm:`, no hours) only shown when value ≥ 60s
- leading zero of seconds suppressed when value < 10s
- value `0` → `--`
- value `null`/missing → blank (empty string)

Current `fmtTime` in [apps/client/src/components/video-player.vue](apps/client/src/components/video-player.vue#L813)
always prints `mm:ss.t` and pads — it does NOT match. Plan:

1. Add a new shared formatter (e.g. `fmtPos(ms)`) implementing the rules above.
   Put it where it can be reused by `video-player.vue` and `map.vue`
   (candidate: `packages/share/src` or a small local helper duplicated, since
   `map.vue` and `video-player.vue` are separate components). Decision below in
   "Open questions".
2. Keep the existing `fmtTime` for the live current-time readout (the spec says
   "the time of the current video position same as before"), OR switch it to the
   new format. Spec item (1) says "same as before", so leave the live readout on
   the old `fmtTime`. The new `fmtPos` is used only for the var buttons/labels.

## Data model (tvdb records)

Files: [apps/srvr/src/tvdb.js](apps/srvr/src/tvdb.js), [apps/srvr/index.js](apps/srvr/index.js)

- Add two new persisted fields: `trimPos` and `skipDur` (ms, `null` | `0` | `>0`).
- Keep `startMark` unchanged (used only by the intro pane UI).
- Keep `introDur` in records untouched for backwards compatibility (do not write
  to it from the new UI; do not delete it).
- `endMark` is no longer a var. It is currently only a local UI value in
  `video-player.vue` (never stored in tvdb), so nothing to remove from tvdb.
- `setTvdbFields` already accepts arbitrary fields, so `trimPos`/`skipDur` will
  persist via the existing `/api/setTvdbFields` path
  ([apps/srvr/index.js](apps/srvr/index.js#L4109)). Verify the field-whitelist /
  flatGapFields logic in `tvdb.js` doesn't strip them.

### needsIntro / intro-queue gating

- Server `needsIntro` computation
  ([apps/srvr/index.js](apps/srvr/index.js#L2593)) currently keys off
  `introDur == null`. Change to: needs intro when **both** `trimPos == null` and
  `skipDur == null` (i.e. the show has not been configured).
- Client intro-queue advance filter
  ([apps/client/src/components/App.vue](apps/client/src/components/App.vue#L1174))
  currently skips shows where `s.introDur != null`. Change to skip when
  `trimPos`/`skipDur` are set (not both null).
- `map.vue` `selectNextEpisodeWithFile` guard
  ([apps/client/src/components/map.vue](apps/client/src/components/map.vue#L1925))
  uses `introDur != null` — update to the trimPos/skipDur "configured" test.
- `list.vue` record sync
  ([apps/client/src/components/list.vue](apps/client/src/components/list.vue#L3643))
  copies `introDur` and `startMark` onto the in-memory show — add `trimPos` and
  `skipDur` to the copied fields.

## Intro video pane header (video-player.vue, `mode === 'intro'`)

File: [apps/client/src/components/video-player.vue](apps/client/src/components/video-player.vue)
(template ~L91–L468, script methods ~L1529–L1690, watch ~L1040–L1118).

Rebuild the right-side button row to this exact order:

1. show name (far left, flex:1) — unchanged.
2. current video position readout — unchanged (old `fmtTime`).
3. position controls `<<` `<` `>` `>>` — unchanged
   (`clickNavBack30/clickNavBack10/clickNavFwd10/clickNavFwd30`).
4. **trimPos button** — label = `fmtPos(trimPos)`; click sets `trimPos =`
   current video position (ms) and persists immediately.
5. **Trim button** (label `Trim`) — click seeks video to `trimPos`.
6. **Clr** (clear-trim) — toggle: `>0 → 0`, `null → 0`, `0 → null`; persist.
7. **Pre button** (label `Pre`) — unchanged; seeks to `startMark - 3s`.
8. **startMark button** — label = `fmtPos(startMark)`; click sets `startMark =`
   current position; persist.
9. **skipDur button** — label = `fmtPos(skipDur)`; click sets
   `skipDur = currentPos - startMark`; ignore click if `startMark` is null/missing
   or `currentPos < startMark`; persist.
10. **Skip button** (label `Skip`, was `Test`) — click seeks to `startMark - 3s`.
11. **Clr** (clear-skip) — toggle on `skipDur`: `>0 → 0`, `null → 0`, `0 → null`;
    persist.
12. **Ant button** — unchanged (`clickIntroAnt`).
13. **X** close — unchanged.

Remove from the pane:

- the old `Clear` button (`clickIntroClear`) — item (11) in instr.
- the old `None` button (`clickIntroNone`) + `isIntroNone` styling — item (12).
- the old End mark button (`clickIntroEnd` / `introEndLabel`) — replaced by the
  skipDur concept.
- the old `introDurLabel` white box.
- the old `Epi` button (`clickIntroEpi` / `epiNext`) — item (14).
- the old `Next` button (`clickIntroNext`) — item (15).

Note: the existing `0` button (`clickIntroZero`, seeks to 0) is **not mentioned**
in the instruction list — see Open questions.

### Persisting immediately

All var changes (`trimPos`, `skipDur`, `startMark`) write to tvdb immediately via
`setTvdbFields({ name, trimPos })` etc. (analogous to current `_setIntroDur` /
`_saveStartMark`). No deferred save on Next (Next is removed).

### Removing local mark state

Spec: "there is no state used other than trimPos, skipDur, and startMark var
values." Plan to delete/replace the local-only state and its logic:

- `endMark`, `introSavedMarks`, `introLocalNone`, `introMarkDirty`,
  `_introPlayTargetSec`, `_restoreIntroMarksFromSaved`.
- Rewrite the `introShow` watcher (the 4-case introDur/startMark mapping at
  [video-player.vue](apps/client/src/components/video-player.vue#L1040)) to simply
  read `trimPos`, `skipDur`, `startMark` from the record into reactive data used
  for the button labels.
- Button labels become computed from `trimPos`/`skipDur`/`startMark` directly.

## Playback actions (regular video pane + emby) — NOT the intro pane

- **Trimming**: when `trimPos > 0` and a video first starts playing, seek to
  `trimPos`. When `0`/`null`, do nothing.
  - Regular video pane: today there is no auto-jump for normal playback (only the
    intro pane seeks). Add a one-time seek-on-first-play to `trimPos` for the
    non-intro player.
  - Emby: today auto-skip fires when `introDur < 0`
    ([apps/client/src/emby.js](apps/client/src/emby.js#L1430) `startStop`, and the
    tampermonkey auto-skip). Change to: when `trimPos > 0`, seek to absolute
    `trimPos` at playback start.
- **Skipping**: when `skipDur > 0` and the skip button is clicked, seek to
  `currentPos + skipDur`. When `0`/`null`, the skip button does nothing.
  - Emby manual skip button paths:
    - tampermonkey `emby-skip-intro.user.js` skip button
    - tvpane `startSkipHold` ([apps/client/src/components/tvpane.vue](apps/client/src/components/tvpane.vue#L1190))
    - both call `POST /api/skipIntro`.
  - Server `doSkipIntro` ([apps/srvr/index.js](apps/srvr/index.js#L5585)) must be
    reworked: compute `newTicks = positionTicks + skipDur*10000` (relative add),
    using `skipDur` instead of the old signed-`introDur` math. Return
    `reason: "noSkip"` (or similar) when `skipDur` is `0`/`null`.

### Server endpoints

- `/api/introDur` ([apps/srvr/index.js](apps/srvr/index.js#L5660)) returns
  `{ introDur, startMark }`. Add `trimPos` and `skipDur` to the response (keep it
  backward compatible; optionally rename, but tampermonkey reads `introDur`).
  Tampermonkey + clients will read the new fields.
- `doSkipIntro` uses `skipDur` for the relative jump (see above).
- Auto-trim on emby: the negative-introDur auto-skip in `emby.js startStop` and
  in the tampermonkey auto-skip block becomes a seek-to-`trimPos` when
  `trimPos > 0`. This likely needs a new server helper (e.g. seek to absolute
  position) since `doSkipIntro` is relative; OR add a `trimPos` branch.

## Var display outside the intro pane

- **Map info bar** (`maphdr2` first child) — `hdr2Parts` at
  [apps/client/src/components/map.vue](apps/client/src/components/map.vue#L1066):
  replace the single `introDurStr` with `fmtPos(trimPos) | fmtPos(skipDur)`
  (pipe-separated). Result example: `42 mins | 12.0 | 3.5`. Use `--` for 0 and
  blank for null per the format rules.
- **Tampermonkey button** (`emby-skip-intro.user.js` `updateButtonText`): label
  becomes `fmtPos(trimPos) | fmtPos(skipDur)` only (drop the `Intro:` prefix).
  The script must fetch and track `trimPos`/`skipDur` from `/api/introDur`
  (currently tracks `currentIntroDur`/`currentStartMark`).

## Android parity

Per workspace rules, tv-pane / UI changes must be mirrored in the Android app
(`apps/android/App.js`). The tvpane skip button behavior is unchanged in shape
(still posts `/api/skipIntro`), so the main Android impact is if the Android app
shows an introDur-derived label. Audit `apps/android/App.js` for any introDur /
skip label and update to `trimPos | skipDur`. The intro-config pane and map info
bar are web-only, so no Android change for those.

## Deployment

- Client changes: served by Vite (no manual deploy).
- Server changes (`srvr`): `./srvr srvr`, then check `pm2 logs` for restart loops.
- Tampermonkey script: user-installed; update the `.user.js` file in repo.
- Android: hot-reload via Metro for JS-only; `build-apk` for a final APK.
- tvdb edits on disk: stop `tv-srvr` first if editing `tvdb.json` directly.

---

## Ambiguities / contradictions / impossibilities

1. **"Skip" button vs old "Test" button (item 9 in instr).** The spec says the
   Skip button should "jump to (startMark - 3 secs)" AND that it "has identical
   functionality to old test button". These conflict: the old Test button
   (`clickIntroTest`) seeks _past_ the intro (to `startMark + introDur`), not to
   `startMark - 3s`. It is also then identical to the **Pre** button (item 6),
   which also jumps to `startMark - 3s`. Recommend clarifying: most likely the
   Skip button should _demonstrate skipping_ by jumping `startMark + skipDur`
   (i.e. land just past the intro), making it a true test of `skipDur`. Plan
   currently follows the literal text (`startMark - 3s`) but flags this.

2. **Two buttons both labeled `Clr`.** Items 5 and 10 are both `Clr`
   (clear-trim and clear-skip). The spec acknowledges they can be confused and
   relies on row position to differentiate. Suggest a small visual cue (e.g.
   different tint/title attr) — otherwise kept identical per instructions.

3. **The existing `0` (seek-to-zero) button is unlisted.** The instruction's
   numbered list does not mention the current `0` button. Unclear whether to keep
   or remove it. Plan: keep it unless told otherwise (it is a useful nav aid and
   not contradicted), but flagging for confirmation.

4. **Migration of existing `introDur` shows.** Spec keeps `introDur` "for
   backwards compatibility" and says trimPos/skipDur are new and both-null means
   "needs to be set." With no migration, every already-configured show
   (introDur set) will reappear as "needs intro" until reconfigured. Confirm this
   is intended, or specify a one-time migration (e.g. old `introDur < 0` →
   `trimPos = abs(introDur)`, old `introDur > 0` → `skipDur = introDur`).

5. **Pre and Skip redundancy.** As noted in (1), with the literal reading Pre and
   Skip perform the same jump. If Skip is meant to test `skipDur`, they differ.

6. **`fmtPos` location / duplication.** `map.vue` and `video-player.vue` don't
   share a util import today. Either add `fmtPos` to `packages/share` and import
   in both, or duplicate a small helper. Recommend `packages/share`.

7. **Auto-trim mechanism on emby.** `doSkipIntro` is a _relative_ seek; trimming
   needs an _absolute_ seek to `trimPos`. This requires either a new server
   endpoint/branch or extending `doSkipIntro`. Not impossible, just additional
   surface to confirm.

8. **Tampermonkey API field naming.** Renaming the endpoint/response fields would
   break the deployed userscript until users reinstall. Recommend _adding_
   `trimPos`/`skipDur` to `/api/introDur` rather than renaming, and updating the
   userscript in the same change.

## Suggestions

- Tint the two `Clr` buttons differently (trim = orange, skip = blue) and add
  `title` tooltips ("clear trim" / "clear skip") to reduce confusion (#2).
- Add an optional one-time server migration of legacy `introDur` → `trimPos`/
  `skipDur` so existing configured shows don't flood the intro queue (#4).
- Make the Skip button actually test `skipDur` (`startMark + skipDur`) so the
  intro pane can verify the skip value before use (#1/#5).
