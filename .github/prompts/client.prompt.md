---
description: Web client (Vue 3) documentation and context
---

> **Generated: 2026-05-24** — Verify details against source in `apps/client/src/` before relying on them.

# Web Client (`apps/client`)

## Key Facts
- Vue 3 + Vite SPA. Entry: `src/main.js`. Root component: `src/components/App.vue`.
- Server comms centralized in `src/srvr.js` (srvr server) and `src/emby.js` (Emby REST API).
- `?simple` URL param enables **simple mode** (tablet/phone: hides management tabs, shows button panel).

## Layout
Two resizable panes separated by a draggable divider:
- **List pane** (`list.vue`, `shows.vue`) — virtualized, filterable, sortable show list
- **Tab area** — tabbed panes for the selected show (or global actions)

## Top Tab Bar (always visible)
`Info` · `Map` · `Actors` · `Reviews` · `Trailer` · `TV`

## Bottom Tab Bar (non-simple mode only)
`Tor` · `Browse` · `Flex` · `Qbt` · `Down` · `Usb` · `Local`

## Key Pane Files
| Pane | File | Purpose |
|---|---|---|
| Info | `src/components/info.vue` | Show metadata, poster, notes, watch buttons |
| Map | `src/components/map.vue` | Season/episode grid; file + watched indicators |
| Actors | `src/components/actors.vue` | Cast list, filmography lookup |
| Reviews | `src/components/reviews.vue` | RT + IMDb scores |
| TV | `src/components/tvpane.vue` | On-screen TV remote |
| Tor | `src/components/tor.vue` | Torrent search + download |
| Browse | `src/components/browse.vue` | New show discovery (TVmaze + reel gallery) |
| Flex | `src/components/flex.vue` | FlexGet management |
| Qbt | `src/components/qbt.vue` | qBittorrent dashboard |
| Down | `src/components/down.vue` | Download orchestration status |

## Show List Condition Flags
`unplayed` (cyan) · `waiting` (lime) · `needsIntro` · `gap` (red) · `ended` (orange) · `drama` (blue) · `foreign` (blue) · `totry` · `continue` · `mark` · `linda` · `ban` · `hasemby`
Clicking `totry`, `continue`, `mark`, `linda`, `ban`, `hasemby` toggles state async (saves to Emby + srvr TVDB record).

## Sorting / Filtering (non-simple)
`HdrBot` toolbar: sort by Alpha/Viewed/Added/Ratings/Notes/Size/Ended/Length/Creator; filter by Try Drama/Watching/Finished/Playing; condition-flag combinator (+1/0/−1 per flag).

## Movie Mode
`?movie` toggle switches Tor/Qbt/Down/Usb/Local panes to movie-focused view.

## Button Background Colors
Use CSS variable `--btn-bg` on the button element — **do not use inline `backgroundColor`** (global `!important` rule wins):
```html
:style="{ '--btn-bg': isActive ? 'lightgray' : 'whitesmoke' }"
```
