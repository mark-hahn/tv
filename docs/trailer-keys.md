# Trailer button and trailer card — desired key behavior

Spec for the tvapp (`apps/tvapp`) Trailer tab. This is the target behavior; the
current implementation does not fully match it.

---

## Background the grid assumes

**The button is named `Trailer`** (singular), index 3 of `TAB_LABELS`, the last
of the four tab buttons (Info, Map, Actors, Trailer).

**Two kinds of "selected".** A tab button can be *active* (it is the tab whose
pane is showing — blue background) and separately *focused* (the remote's cursor
is on it — red border). They are independent: the cursor can sit on the Trailer
button while Info is the active tab.

**Trailer cards are never active.** A trailer card has only one state: focused
(red border) or not. There is no active card. a card always has a light gray background. the border is the entire visual state.

**Where the cursor can be.** Exactly one of:

| cursor state | meaning |
|---|---|
| `SHOW` | on a show card in the left list |
| `BUTTON` | on a button in the middle column |
| `TRAILER_CARD` | on a trailer card in the Trailer pane |

**Activation and the dwell timer.** Moving the cursor onto a button starts a
600 ms timer (`ShowListView.DWELL_SELECT_MS`). If the cursor is still on that
button when it fires, the button *activates* — same effect as pressing OK on it.
This is what "the cursor moves to the button and stops" means. Arrowing past a
button faster than 600 ms never activates it.

**Key routing.** Arrow/OK/Back come from the phone remote over the LAN into
`CtrlServer` → `MainActivity.onRemoteKey` / `onBackToEmby`. They do **not** go
through Android focus traversal. The TV's own remote only delivers Back
(`onKeyDown`); its arrows are not part of this spec.

---

## The grid

Rows are what is focused. Columns are the key pressed.

| focused item | **OK** | **Left** | **Right** | **Up** | **Down** |
|---|---|---|---|---|---|
| **Trailer button** — selected show has **0 trailers** | Activate the Trailer tab (pane shows "No trailers found."). **Do not play anything.** Cursor stays on the button. | Move cursor to the show list (`SHOW`), focused on the active show. | **Nothing** — there is no card to move to. Cursor stays on the button. | Move cursor to Actors button, arming the dwell timer. | Move cursor to the first Filters button (Ready), arming the dwell timer. |
| **Trailer button** — selected show has **exactly 1 trailer** | Activate the Trailer tab and **start playing that trailer, from the beginning**. | Move cursor to the show list (`SHOW`), focused on the active show. | Move cursor to the single trailer card (`TRAILER_CARD`); the card gets the red border, the button loses it. **Do not play.** | Move cursor to Actors button, arming the dwell timer. | Move cursor to Ready button, arming the dwell timer. |
| **Trailer button** — selected show has **2+ trailers** | Activate the Trailer tab (pane shows the cards). **Do not play anything.** Cursor stays on the button. | Move cursor to the show list (`SHOW`), focused on the active show. | Move cursor to the **top** trailer card (`TRAILER_CARD`); the card gets the red border, the button loses it. **Do not play.** | Move cursor to Actors button, arming the dwell timer. | Move cursor to Ready button, arming the dwell timer. |
| **Trailer card** — the only card (1 trailer) | Play this trailer, **from the beginning**. | Move cursor back to the Trailer button; the card loses its border. **Do not re-activate the button** (see "no replay" below). | **Nothing** — the grid is one column wide. | **Nothing** — no card above. Cursor stays put. | **Nothing** — no card below. Cursor stays put. |
| **Trailer card** — **first** of 2+ | Play this trailer, from the beginning. | Move cursor back to the Trailer button; card loses border; no re-activation. | **Nothing.** | **Nothing** — no card above. Cursor stays put. | Move focus to the next card down; scroll it into view if needed. |
| **Trailer card** — **middle** of 3+ | Play this trailer, from the beginning. | Move cursor back to the Trailer button; card loses border; no re-activation. | **Nothing.** | Move focus to the card above; scroll into view if needed. | Move focus to the card below; scroll into view if needed. |
| **Trailer card** — **last** of 2+ | Play this trailer, from the beginning. | Move cursor back to the Trailer button; card loses border; no re-activation. | **Nothing.** | Move focus to the card above; scroll into view if needed. | **Nothing** — no card below. Cursor stays put. |
| **Trailer video playing** (full-screen overlay) | Close the player, reveal the tvapp screen underneath. Cursor is wherever it was before playing. | do nothing -- swallow the key | do nothing -- swallow the key | do nothing -- swallow the key | do nothing -- swallow the key |

**Back key** is not one of the five columns but matters to the same states: while
a trailer video is playing, Back closes the player and reveals the tvapp screen —
it must **not** go to Emby. Back only goes to Emby when no video is playing and
no map episode is open.

---

## Rules the grid depends on

### Playing always starts at the beginning
Whenever a trailer video is shown — after being hidden, after another pane was
displayed, after Back closed it, every time — playback starts from the beginning.
There is no resume.

### "Do not play" for 0 or 2+ trailers
Activating the Trailer button plays a video **only** when the show has exactly
one trailer. With none there is nothing to play; with several the user has to
choose, so the cards are shown and nothing plays.

### No replay when the tab is already active (this is the trap)
The dwell timer re-activates whatever button the cursor lands on. If activation
unconditionally plays the sole trailer, then for a 1-trailer show the cursor can
never rest on the Trailer button without a video starting — and while the player
is up it covers the screen, so the arrow keys appear to do nothing. The button
becomes inescapable.

Therefore:

- **Dwell activation** plays the sole trailer only when the dwell is what made
  the Trailer tab active — i.e. it was not the active tab a moment ago. Resting
  on an already-active Trailer button plays nothing.
- **An explicit OK press** always plays the sole trailer, even if the tab is
  already active. OK is a deliberate request to play.
- Returning from a trailer card to the button (Left) must park the cursor
  **without** arming the dwell timer, for the same reason.

### Showing the pane is not activating it
Right-arrow from the Trailer button has to make the Trailer pane visible so its
cards exist and can be focused. Making the pane visible must not, by itself,
start a video. Playing belongs to activation (OK / first dwell), not to the pane
being shown.

### The cursor must never be stranded
Any state where a key does nothing visible reads as a wedged app. Two known ways
this happens, both of which the fix must prevent:

1. **Contradictory cursor state.** If "on a button" and "on a trailer card" are
   tracked as two separate booleans, a path that sets one and not the other
   leaves the cursor drawn on the Trailer button while the code treats it as
   being on a card. Up/Down then run card movement (which does nothing at the
   ends of a 1-card list) and Right is unhandled — three dead arrows. Use a
   single cursor field with one value at a time.
2. **A stale card list.** The show can change while the cursor is on a trailer
   card (`s,<name>` from tv-tv), rebuilding the cards underneath it. If no card
   is actually focused, the cursor must fall back to the Trailer button before
   the key is interpreted.

### Card focus is cleared on the way out
Leaving `TRAILER_CARD` for any reason — Left to the button, a tab change, a show
change — clears the red border from the card. A border must never be left behind
on a card the cursor is no longer on.

---

## File map for this behavior

| file | what lives there |
|---|---|
| `app/src/main/java/com/hahnca/tvapp/MainActivity.java` | cursor state, `moveSelection`, `activateSelectedItem`, `activateButton`, `selectTab`, dwell timer, `onRemoteKey` |
| `app/src/main/java/com/hahnca/tvapp/TrailersView.java` | the card list, card focus and its red border, `fill()` |
| `app/src/main/java/com/hahnca/tvapp/TrailerPlayer.java` | the full-screen WebView player, `play()` / `close()` / `isPlaying()` |
| `app/src/main/java/com/hahnca/tvapp/CtrlServer.java` | WebSocket on port 8099 that delivers the remote's keys |
