# tvapp ui change — problems found

Written instead of making changes, per the instructions. Everything below is a
question about the new spec; nothing in the workspace has been changed.

Numbering is only so you can answer by number.

---

## 1. cardMisc: up/down vs left/right contradict each other

The spec says:

> the up/down keys scrolls the contents of cardMisc depending on cardMisc mode

and then two of the four sub-bullets use the other axis:

| mode      | spec says                                          |
| --------- | -------------------------------------------------- |
| info/desc | up/down scroll the description                     |
| map       | up/down change the season                          |
| actors    | **left/right** move the focus between actors       |
| trailers  | **left/right** move the focus between trailers     |

So either the parent bullet is loose wording and the strips really are
left/right, or the strips are meant to be up/down like the other two modes.

If left/right is right for the strips, then **up/down are unassigned in actors
and trailers mode** — should they do nothing, or move the actor/trailer cursor
as well?

Same question the other way: **left/right are unassigned in description mode**
(nothing to move sideways) — do nothing?

## 2. Map mode: no key moves the episode cursor

The spec gives map mode up/down = change season, and says an item is always
focused, and that ok opens the focused map cell into the episode card. But no
key is assigned to move the focus from one episode cell to another inside the
season row, so only one episode per season could ever be opened.

Today left/right step the episode (`stepEpisode` in `ShowListView.java`) and
up/down have no map role at all. Assuming left/right takes the episode cursor
is the obvious fill, but it isn't stated. Confirm:

- left/right = previous/next episode cell in the shown season?
- the season row wraps onto several lines — does the cursor just run through
  the cells in order across the wrap (what left/right does now), or should
  up/down move between the wrapped lines and something else change season?

## 3. Shows key: "function doesn't change" vs "clears the state"

> change the Play key label to `Shows`
>
> - the key label doesn't change between normal mode and tvapp mode
> - it's function doesn't change either
>   - it clears the state of the tvapp screen

Today that key in tvapp mode **plays** — it sends `e`, which is what makes Emby
load the show/episode/trailer the cursor is on (`embyClick()` in
`MainActivity.java`). The new spec moves playing to the ok key
("the ok key loads emby and the selected show plays"), so the Shows key's
function in tvapp mode *does* change: it becomes clear-the-state.

I read "it's function doesn't change either" as *between the two modes* — in
normal mode it opens tvapp on a clean show list, in tvapp mode it puts tvapp
back to a clean show list — rather than "unchanged from today". Confirm that
reading, and confirm that in tvapp mode the Shows key no longer plays anything.

Two knock-on points if that reading is right:

- **A new bridge command is needed.** `e` has to keep meaning *play*, because
  tv-tv's `/tv/toggletvapp` and `/tv/tvapprc/emby` send it themselves (see
  `apps/tv/src/main.js`). So "clear the tvapp screen state" needs its own
  command letter rather than reusing `e`.
- **What does the Shows key's long press do in tvapp mode?** Today the hold
  opens the phone's own show pane on tvapp's active show
  (`openShowsPaneForTvapp`) and the short press plays. If the short press
  becomes clear-state, does the hold stay as it is?

## 4. How much does "clears the state" clear?

"a show card is focused and nothing else is focused" pins down the focus, but
not the rest of the screen state. Which of these does the Shows key also undo?

- cardMisc back to description mode (or does the card keep showing map/actors/
  trailers with nothing focused)?
- the episode card closed, if it is open?
- a playing trailer closed?
- the actor filter, typed filter text, and the active filter buttons — left
  alone, or cleared too (that would make it a second Clear button)?

I would assume: mode back to description, episode card closed, trailer closed,
filters untouched. Confirm.

## 5. The web tv pane can't mirror this key-for-key

`apps/client/src/components/tvpane.vue` has to get the same change, but its
tvapprc buttons are not laid out like the phone's:

| button | phone in tvapprc today   | web tv pane in tvapprc today       |
| ------ | ------------------------ | ---------------------------------- |
| Skip   | `Filter` → `k,filter`    | `Filter` → `k,filter`              |
| Home   | `Sort` → `k,sort`        | `Sort` → `k,sort`                  |
| Emby   | `Search` (filter screen) | plays — sends `e`                  |
| Shows  | `Play` — sends `e`       | `Shows` — tv-tv `/tv/toggletvapp`  |
| OK     | click `k,ok`, hold `k,oklong` | click `k,ok` only             |

So on the web pane:

- The Skip button becoming `Info` is clear enough.
- Its **Emby** button currently plays. With play moving to ok, does that button
  go back to being a plain Emby button in tvapp mode, or become something else?
- Its **Shows** button goes through tv-tv's `/tv/toggletvapp`, which sends `e`
  (play) when tvapp is already up. If the Shows key is now clear-state, does
  `/tv/toggletvapp` change to send the new clear command when tvapp is up, or
  does the web pane stop using that endpoint while in tvapprc mode?

## 6. `oklong` has no job left

With ok activating and Info stepping into cardMisc, nothing in the new spec
needs the held-ok command. Should I delete it — the phone's long-press
(`tvapprcKey("oklong", "ok")` in `App.js`), the `k,oklong` protocol case, and
`okLongPress()` in `ShowListView.java` — or leave it in place doing nothing?

## 7. The Back key is not mentioned

Today Back closes a playing trailer, else closes the episode card, else leaves
tvapp for Emby. The new spec gives the episode card's close to the Info key and
the focus reset to the Shows key, and says nothing about Back. Assume Back is
unchanged (still the way out to Emby, still closes a trailer/episode card)?

## 8. Modes with nothing to focus

"in all modes except description mode one of the items is always focused". A
show can have no cast, no trailers, or no episode data at all — those cards
draw "No cast." / "No trailers found." / "No episodes." today. Assume those
stay as they are with nothing focused, and that trailers keeps being skipped in
the rotation when a show has none?

## 9. Smaller confirmations

- **Yellow cardMisc border geometry.** "same width and position as the blue
  show card border except the left side" means the yellow border also hangs
  ~6dp past the top, right and bottom of the card and over its neighbours, so
  it surrounds the show's name row too (the name row is above cardMisc but
  right of the poster). Is that what you want, or should the top of the yellow
  border sit at the top of the cardMisc area?
- **Filter group exit.** Only the Shows key is listed. So while the filter
  group is focused, left/right and Info do nothing? (Right going back to the
  show list would be the natural other way out.)
- **Actor card opened → where does the focus go?** After ok filters the list to
  that actor's shows, does the focus stay in cardMisc/actors, or fall back to
  the show list?
- **Sort buttons.** They stay outside the new focus model — still cycled only
  by the Sort key, never focused, no red cursor. Right?
