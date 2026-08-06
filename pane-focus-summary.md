# tvapp UI Overhaul — Conversation Summary

This document describes all changes made to the tvapp Android TV native app
(`apps/tvapp`) during this conversation. It is intended to orient a fresh
Copilot session to the current state of the code.

---

## What was done at a high level

The entire right-side pane column (Info / Map / Actors / Trailer tabs) was
removed from the tvapp layout. Show cards now span the full screen width.
Each card grows a new left-side backdrop image and two right-side sections:
a narrow **cardInfo** strip and a wide **cardMisc** area that rotates between
four display modes (Description, Map preview, Actors, Trailers). Remote control
was updated accordingly.

---

## Files changed

### New file: `apps/tvapp/app/src/main/java/com/hahnca/tvapp/MapCells.java`

Shared cell text and background color logic used by both the full Map tab and
the new card map-preview rows. Matches the web client's map exactly, including
the `p` (playback position) marker.

```java
static String text(boolean played, boolean avail, boolean noFile, boolean unaired,
                   int quality, long pos, boolean inEmby)
```

Backgrounds: `BG_NORMAL = 0xFFFFFFFF`, `BG_NO_FILE = 0xFFFFAAAA`, `BG_ERROR = 0xFFFFFF00`.

---

### `apps/tvapp/app/src/main/java/com/hahnca/tvapp/Shows.java`

**Added two new fields to `Show`:**

```java
final String originalCountry;  // raw, before joining with language
final JSONArray episodeData;   // the full [season][episode] tuple array
```

`originalCountry` is parsed from `"originalCountry"` before being joined with
`"originalLanguage"` into the existing `countryLang` field. `episodeData` is
stored so `ShowListView` can build the in-card map-preview rows from local data
without an extra network call.

`hasFile` is now derived from the stored `episodeData` reference instead of a
temporary `optJSONArray` call:

```java
episodeData = rec.optJSONArray("episodeData");
hasFile = anyFile(episodeData);
```

---

### `apps/tvapp/app/src/main/java/com/hahnca/tvapp/MapView.java`

Updated to use `MapCells` for both cell text and cell background colors, and
extended the `Cell` inner class with two new fields:

```java
final boolean error;
final long pos;
```

The old local `cellText()` / `qualityChar()` methods and `CELL_AVAIL_BG` /
`CELL_MISSING_BG` constants were replaced with calls to `MapCells.text()` and
`MapCells.background()`.

---

### `apps/tvapp/app/src/main/java/com/hahnca/tvapp/TrailerPlayer.java`

Added an `EndListener` interface and `setEndListener()` method so
`MainActivity` can be notified when a trailer ends naturally:

```java
interface EndListener { void onTrailerEnded(); }
void setEndListener(EndListener listener)
```

The JavaScript `onEnded` bridge now fires `endListener.onTrailerEnded()` before
closing the player.

---

### `apps/tvapp/app/src/main/java/com/hahnca/tvapp/MainActivity.java`

**Removed entirely:**
- Right pane column (`PANE_WIDTH_FRACTION`, `InfoView`, `MapPane`, `ActorsView`,
  `TrailersView`, `activePane`, `paneAreaBg`)
- All tab-button construction (`TAB_LABELS`, `MAP_TAB_INDEX`, etc., `buildTabRow`,
  `buildPaneColumn`, `buildPanes`, `selectTab`, `clearPaneFocus`)
- `Area.PANE` — the enum now has only `SHOWS` and `FILTERS`
- All `movePaneFocus`, `activatePaneItem`, `cycleTab` methods
- Map-focused-episode logic from `embyClick()`

**Added:**
- `player.setEndListener(() -> showList.highlightNextTrailerAfterPlayed())` in
  `buildUi()`
- `playCardTrailer()` — called when the remote `right` key is pressed while in
  `Area.SHOWS`; calls `showList.playActiveTrailer()` and plays via `TrailerPlayer`
- `onShowSelected` now calls `TrailerList.settle(show, () -> showList.onTrailersReady(show))`
  instead of updating the removed pane objects

**Key layout constants after changes:**

```java
private static final float BUTTONS_WIDTH_FRACTION = 0.09f;
private static final float LIST_WIDTH_FRACTION = 1f - BUTTONS_WIDTH_FRACTION; // fills rest
```

**Key control flow:**
- `OK` while `Area.SHOWS` → `showList.rotateCardMisc()`
- `right` while `Area.SHOWS` → `playCardTrailer()` (plays trailer only when
  cardMisc is in TRAILERS mode)
- `emby` remote command (`onEmbySelected`) → `embyClick()`, which loads the
  selected show in Emby (no focused-episode logic any more)
- `back` while `Area.FILTERS` → back to `Area.SHOWS`; from `Area.SHOWS` → back
  to Emby
- `sort` key → `cycleSort()` unchanged
- `info` key was previously `cycleTab()`; that method now just calls
  `showList.rotateCardMisc()` — effectively the same as OK

---

### `apps/tvapp/app/src/main/java/com/hahnca/tvapp/ShowListView.java`

This file received the most changes. Key sections:

#### Card visual design

Old style: selected = solid blue `0xFF0A4A8A`; not-in-Emby = black with square
corners; in-Emby = black with rounded corners.

New style: all cards use dark gray `0xFF2B2B2B`. Selected card shows a blue
border `0xFF0A4A8A` equal to `CARD_GAP_DP` (3dp) in width. Not-in-Emby cards
show a trash-can icon in the top-right of the name row instead of using square
corners.

#### Card height

Computed the same way as before this conversation:

```java
TextView probe = new TextView(context);
probe.setTextSize(TypedValue.COMPLEX_UNIT_SP, NAME_TEXT_SIZE_SP);
int rowHeight = probe.getLineHeight() + 2 * (int) dp(CARD_HEIGHT_PAD_V_DP); // 2dp
int textHeight = CARD_ROWS * rowHeight + (CARD_ROWS - 1) * (int) dp(CARD_HEIGHT_GAP_DP); // 1dp
cardHeightPx = Math.round(textHeight * CARD_HEIGHT_FACTOR); // 1.44
```

`CARD_ROWS = 3` (unchanged).

#### Left backdrop image

A 16:9 landscape backdrop image fills the left edge of every card, same as
before this conversation. Width = `cardHeightPx / (9/16)` so it matches the
card height exactly.

Image source is `Backdrops.get()` with a 1920px source width for 1080p-quality
images, falling back to `show.image` (portrait poster) if no backdrop is found.
Images are lazily loaded in `loadVisibleMedia()` via a separate `posters` map
and `requestedPosters` set that persists across `rotateCardMisc()` calls.

```java
private static final int BACKDROP_SOURCE_WIDTH_PX = 1920;
private static final float CARD_IMAGE_ASPECT = 9f / 16f; // height / width
```

#### Card layout structure

```
card (FrameLayout, border padding = CARD_GAP_DP = 3dp all sides)
  outerRow (LinearLayout horizontal)
    poster (ImageView, posterWidthPx × MATCH_PARENT)  ← 16:9 backdrop
    content (LinearLayout vertical, CARD_PAD_H_DP = 14dp padding)
      nameRow (show name + optional trash icon)
      body (LinearLayout horizontal, weight-based)
        cardInfo (weight 1) ← metadata fields
        misc (FrameLayout, weight 3) ← rotating content
```

#### cardInfo fields (left text strip)

Four fields separated by dashes:

1. `firstAired - status`
2. Watched count: `"Watched X of Y"` / `"Watched all N episodes"`
3. `COUNTRY - N Mins` (uses `show.originalCountry`, not the combined country/lang)
4. `show.genres`

#### cardMisc rotation (`MiscMode` enum)

```java
private enum MiscMode { DESC, MAP, ACTORS, TRAILERS }
private MiscMode miscMode = MiscMode.DESC; // starts on description
```

`rotateCardMisc()` is called by OK. It cycles DESC → MAP → ACTORS → TRAILERS → DESC.
When landing on TRAILERS and the active show has `trailersReady && trailers.isEmpty()`,
it skips one more step (so TRAILERS is skipped for shows with no trailers).

`renderAllMisc()` rebuilds all cards' misc areas when the mode rotates. Each
call to `renderMisc(show)` dispatches to one of four render methods.

**DESC mode (`renderDescMisc`):** Shows `show.overview` in a multi-line TextView,
up to 6 lines, ellipsized. Shown first by default.

**MAP mode (`renderMapMisc`):** Shows at most 2 season rows from the show's local
`episodeData`. Season selection priority:
1. Season with a watched→unwatched transition
2. Last season containing a watched episode
3. First season with a file on disk
4. First season present

Each row has a season-number label on the left and episode cells flowing and
wrapping to the right (via a custom `FlowLayout` inner class). Cell content and
colors match `MapCells.text()` / `MapCells.background()` — same as the full Map
tab and the web client.

No episode numbers are shown in the row cells. Episode data is read from
`show.episodeData` (the raw `JSONArray`), indexed as:
```
ED_AIRED  = 0
ED_WATCHED = 1
ED_FILE   = 3
ED_RES    = 4
ED_POS    = 6
```

**ACTORS mode (`renderActorsMisc`):** Horizontal strip of actor photo cards
(height = 80% of card height, aspect ratio 0.62). Caption is actor name only
(not character name). Maximum number of cards that fit are shown.

**TRAILERS mode (`renderTrailersMisc`):** Horizontal strip of trailer still
images (16:9 aspect, height = 80% of card height). No captions.

- When the show selection changes, no card is highlighted (no auto-selection).
- Pressing `right` while in TRAILERS mode plays the currently highlighted
  trailer (or the first one if none is highlighted) by calling `playActiveTrailer()`.
- When a trailer finishes, `highlightNextTrailerAfterPlayed()` highlights the
  next card (wrapping), but does **not** auto-play it. The red-border highlight
  is cleared when the active show changes.

#### Lazy media loading

Backdrop images (posters) use a separate lazy-load path:
```java
private final Map<Shows.Show, ImageView> posters = new HashMap<>();
private final Set<Shows.Show> requestedPosters = new HashSet<>();
```
`requestedPosters` is cleared in `setShows()` but **not** in `renderAllMisc()`,
so backdrops survive cardMisc rotations without re-fetching.

cardMisc actor photos and trailer stills use `mediaRequests` (per-show list of
`MediaRequest` objects) and `requestedMedia` (dedup set). Both are cleared on
`renderAllMisc()`.

---

## Remote control summary (current behavior)

| Key / command | Area = SHOWS | Area = FILTERS |
|---|---|---|
| up / down | move selected show | move filter focus |
| left | enter FILTERS | (at leftmost column, no-op) |
| right | `playCardTrailer()` if TRAILERS mode | back to SHOWS |
| OK | rotate cardMisc | activate focused filter button |
| sort | cycle sort buttons | cycle sort buttons |
| back | (from SHOWS) → back to Emby | back to SHOWS |
| `e` from phone | load selected show in Emby | same |
| `b` from phone | one level back (same as Back key) | same |

OK in SHOWS no longer opens Emby. The Emby button / `e` remote command is what
loads a show in Emby.

---

## Unchanged files (not touched by this conversation)

- `CtrlServer.java` — remote command protocol unchanged
- `Backdrops.java` — backdrop URL logic unchanged
- `Images.java` — image loading unchanged
- `TrailerList.java` — trailer resolution unchanged
- `EpisodeSubpane.java`, `ScrollPane.java`, `EdgeFade.java`, etc. — untouched

`InfoView.java`, `MapPane.java`, `ActorsView.java`, `TrailersView.java` still
exist in the source tree but are no longer instantiated or referenced anywhere.
They are dead code and can be deleted in a future cleanup.
