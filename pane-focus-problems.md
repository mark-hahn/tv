# pane focus instructions — problems found

No code was changed. Three things need a decision first; the rest of the spec
is implementable as written (details at the bottom).

---

## 1. A focused map cell being pink collides with the pink that already means
## "no file"

> unlike every other focusable item, a focused table cell has a pink background
> and no red border

The map grid already uses a pink background to mean the episode has no file:

- `MapView.java:36-37` — `CELL_AVAIL_BG = 0xFFFFFFFF` (white),
  `CELL_MISSING_BG = 0xFFFFCCCC` (pink)

So a focused available cell (white → pink) would look exactly like an unfocused
missing cell, and a focused missing cell would look like nothing happened at
all. There is no way to read the grid.

The web client does not have this collision — it paints a selected cell
**lightgreen** and a `noFile` cell `#faa` (`apps/client/src/components/map.vue:696-705`).

**What I need:** the colour for the focused cell. Options:

- lightgreen, matching the web client's selected cell — my recommendation, it
  is the same state and keeps the two uis reading alike
- some other colour distinct from both white and `#ffcccc`
- keep pink for focus and change the missing-file colour to something else

---

## 2. A focused actor card and the actor card that is driving the show-list
## filter would both be a red border

> when i say an item is focused it means the cursor is on the item and it has a
> red border

`ActorsView` already paints the *selected* actor — the one narrowing the show
list — with a red border, and it is the identical border:

- `ActorsView.java:37-38` — `SELECTED_BORDER = 0xFFFF0000`, `SELECTED_BORDER_DP = 3f`
- the cursor border everywhere else — `MainActivity.java:63`,
  `ShowListView.java:43`, `TrailersView.java:32` — is also `0xFFFF0000` at `3dp`

Once ok can click a card, the two states exist at the same time and on
different cards, and they are indistinguishable. That breaks this rule
specifically:

> the card that is responsible for the current filter is focused and that card
> is clicked again — then that means that clicking on a card toggles the filter

You cannot tell which card is responsible for the filter, so you cannot know
which card to press ok on to toggle it off.

Everywhere else in tvapp the two states are already distinguished — a show card
and a button use a blue background for *active* and a red border for *focused*
(`ShowListView.java:36`, `MainActivity.java:59`).

**What I need:** how to mark the filtering actor card. Options:

- blue background (`0xFF0A4A8A`) for the filtering card, red border for the
  cursor — my recommendation, it is the convention the rest of the app already
  uses for exactly this active-vs-focused pair
- some other marker for the filtering card (thicker border, a different border
  colour, a checkmark)
- note that this diverges from the web client's actor pane, which marks its
  selected actor with a red border and has no cursor to conflict with

---

## 3. The back key and the web client's Shows button are the same wire message

Lower severity — this may be a change you are fine with, but it is a real
behaviour change beyond tvapp, so I did not want to make it silently.

`b` (`CMD_BACK_TO_EMBY`) is one message with three senders, all currently
meaning "close tvapp and go to Emby":

- the phone remote's Back button in tvapprc mode
- the web client's Shows button — `/tv/toggletvapp` sends `b` to close tvapp
  when it is already open (`apps/tv/src/main.js:2600-2605`)
- the `/tv/tvapprc/back` HTTP fallback (`apps/tv/src/main.js:2619-2622`)

The spec gives back a new job: move the focus out of a pane and back to that
pane's tab button. Since it is all one message, the web client's Shows button
stops closing tvapp whenever the cursor happens to be inside a pane — it moves
the focus instead, and takes a second press to close.

There is precedent for this already: `handleBack` (`MainActivity.java:798-802`)
closes the trailer player or the episode subpane before it will close tvapp, so
the Shows button already has this behaviour in those two states. The spec makes
it the common case rather than the rare one.

**What I need:** confirm one of these.

- accept it — back is a one-level-up key and the Shows button inherits that
- keep `b` as an unconditional close and give the phone's Back button its own
  message, so only the phone remote gets the new behaviour

---

## Assumptions I would make on the rest, if you want to correct any

These are not blockers — I would implement them this way unless you say
otherwise.

- **Right arrow on a tab button whose pane is not the visible one** makes that
  tab active first, then moves the focus into it. This is what the trailer
  button already does (`MainActivity.java:588-599`).
- **Right arrow on a filter or sort button** keeps doing nothing.
- **Map grid edges** — left at the leftmost episode column, right at the last
  season, up at the top row, down at the last row all do nothing. The map's way
  out is the back key, per the spec.
- **Actors grid edges** — right/up/down clamp; only left, from the leftmost
  card of a row, exits to the Actors button, as specified.
- **Blank map cells** (a season that has no such episode number) are not
  episodes, so the cursor skips over them rather than landing on one.
- **The map's "first episode"** is the first non-blank cell, top-left.
- **Opening the map before its grid has loaded** — the grid is fetched
  asynchronously, so the focus lands on the first cell as soon as the fetch
  lands, the way a trailer-button press already waits on the trailer list.
- **Ok on a map cell always opens** the episode pane for that cell; it never
  closes it, since ok inside the episode pane is what closes it.
- **The emby key with a focused episode** sends that cell's Emby `id` as the
  `episodeId` query param to `/tv/viewshow`, which already accepts it — the
  same thing the phone remote's TV button does
  (`apps/android/App.js:2629-2643`). "No file" is the cell's `noFile`/`avail`
  flag, and in that case the `episodeId` is simply omitted.
