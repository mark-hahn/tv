# Movies Plan

## Overview

Add a movie download mode to the tor and qbt panes. A `Movie` toggle button in the tor pane header switches both panes into movie mode, changing search behavior, card display, and download destination.

---

## Files to Change

| File                                 | Change                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/client/src/components/tor.vue` | Add Movie button, movie mode toggle, row 2 movie search input, hide/show elements, card rendering, visual indicator                  |
| `apps/client/src/components/qbt.vue` | Movie mode header text, hide/show buttons, savePath on download, clear cards on mode switch                                          |
| `apps/api/src/search.js`             | Accept `category` param, use movie provider categories, skip TV-only season filter in movie mode, bypass IPT/TL cache                |
| `apps/api/src/server.js`             | Pass `category` from `/api/search` to `searchTorrents()`; pass `savePath` from `/api/torrent-file` to `addQbtTorrent`/`addQbtMagnet` |
| `apps/api/src/usb.js`                | Add `savePath` param to `addQbtTorrent()` and `addQbtMagnet()`                                                                       |

---

## State Management

Add a `movieMode` boolean in the **parent component** (App.vue or equivalent) as a reactive prop/data field, passed down to both `tor.vue` and `qbt.vue`. When tor emits a `movieModeChange` event the parent flips the flag, which propagates to qbt.

---

## Tor Pane Changes (`tor.vue`)

### New data properties

```js
movieMode: false,
movieSrchText: '',
```

### Row 1 — Movie/Exit Movie button

**The button is always visible** (outside the `v-if="!showFilesPane"` block — it does not hide when the files pane opens). Place it to the right of the `Cookies` button.

```html
<button
  @click.stop="toggleMovieMode"
  :style="{ '--btn-bg': movieMode ? 'lightcoral' : 'whitesmoke' }"
>
  {{ movieMode ? 'Exit Movie' : 'Movie' }}
</button>
```

- In movie mode the button background is **light-red** (`lightcoral`). This is the visual indicator that movie mode is active.

`toggleMovieMode()`:

```js
toggleMovieMode() {
  this.movieMode = !this.movieMode;
  if (!this.movieMode) this.movieSrchText = '';
  this.$emit('movieModeChange', this.movieMode);
}
```

### Row 1 — Title

In movie mode the left label changes to the fixed string **`Tor Movie Search`** (the search text is NOT shown in the title).

In template, replace `Tor: {{ headerShowName }}` with a conditional:

```html
<div style="margin-left: 0">
  {{ movieMode ? 'Tor Movie Search' : 'Tor: ' + headerShowName }}
</div>
```

### Row 1 — Stream button hidden in movie mode

Add `v-if="!movieMode"` to the **Stream** button in row 1. Stream is not relevant for movie mode.

### Row 2 — Hide elements in movie mode

Add `v-if="!movieMode"` to each of these:

- Season input (`v-model="seasonFilter"`)
- `Search` button
- `More` button

### Row 2 — Movie search input

The input appears at the **far left** of row 2 in movie mode (i.e., it is the first element in the left-side flex container, before the Get/Tab buttons which are conditionally visible):

```html
<input
  v-if="movieMode"
  v-model="movieSrchText"
  @keydown.enter.stop="movieSearchEnter"
  @keydown.stop
  @click.stop
  placeholder="Search Movies"
  style="font-size: 13px; padding: 4px; border: 1px solid #bbb; border-radius: 7px;"
/>
```

Pressing Enter in the input calls `movieSearchEnter()`, which triggers the torrent search (same as clicking Search in normal mode) using `movieSrchText` as the query and `category=movie`.

### Card rendering

In movie mode the season/episode span is hidden. Add `v-if="!movieMode"` to:

```html
<span style="color: blue !important"
  >{{ getDisplaySeasonEpisode(torrent) }}</span
>
```

The resolution and metadata line remain unchanged.

### Search invocation

In `loadTorrents()` URL construction, add `&category=movie` when `movieMode` is true:

```js
if (this.movieMode) url += "&category=movie";
```

In movie mode, always force all 4 providers (IPT, TL, TPB, LIM — no EZTV) by setting `more=true` in the URL. The server-side cache is bypassed separately (see API section).

---

## qbt Pane Changes (`qbt.vue`)

### Prop

```js
props: {
  movieMode: { type: Boolean, default: false },
  ...
}
```

### Row 2 — Movies label (left side)

The row 2 flex container currently only has action buttons on the right. Change it to `justify-content: space-between` and add a left-side label:

```html
<span
  v-if="movieMode"
  style="margin-left: 20px; font-weight: bold; font-size: inherit;"
  >Movies</span
>
```

Style matches `<span>qBittorrent</span>` in row 1 — same font-weight, font-size, and margin-left.

### Row 2 — Hide Sel and From

Add `v-if="!movieMode"` to:

- `Sel` button
- `From` button

### savePath on download

When `movieMode` is true, include `&savePath=%2Fmnt%2Fmedia%2Fmovies` in the torrent-file URL call. When false the existing behavior (no savePath, qBittorrent uses its default `/mnt/media/tv`) remains unchanged.

### Clear cards and trigger immediate poll on mode switch

```js
watch: {
  movieMode() {
    this.torrents = [];
    this.pollOnce();  // trigger immediately, do not wait for next tick
  }
}
```

---

## API Changes

### `apps/api/src/server.js` — `/api/search` endpoint

Read `category` and forward it:

```js
const category = req.query.category || "tv"; // 'tv' | 'movie'
```

### `apps/api/src/search.js` — `searchTorrents()`

Add `category = 'tv'` to the params destructure.

**When `category === 'movie'`:**

1. **Providers**: IPT, TL, TPB, LIM — **EZTV is excluded** (TV-only, removed from movie searches).

2. **Provider categories** (all confirmed by live experiments):
   - **TPB**: use **`"Video"`** category — confirmed returning 10 results with movie category codes `207` (HD Movies) and `211` (Movies DVDR). `"All"` returns identical results so `"Video"` is preferred for precision. In `search.js`, after getting TPB results filter to movie category codes — define a `TPB_MOVIE_CATEGORIES` set analogous to the existing `TPB_TV_CATEGORIES = new Set(["202","205","207","208","212"])`. From the live test, movie codes seen are `207` and `211`. Use `TPB_MOVIE_CATEGORIES = new Set(["201","202","207","209","211"])` (standard TPB movie codes: 201=Movies, 202=Movies DVDR, 207=HD Movies, 209=3D, 211=Movies DVDR). Note `207` overlaps with TV set — this is a pre-existing quirk in the TV filter and is acceptable.
   - **Limetorrents**: use **`"Movies"`** category — confirmed returning 10 results. (`"All"` returns identical results; `"Movies"` is more precise.)
   - **IPTorrents**: use **`"TV"`** (not `"Movies"`). The custom config (`iptorrents-custom.json`) only defines a `"TV"` category mapping (`73;`). Searching with `"Movies"` returned **0 results**. Searching with `"TV"` returned **10 results** including actual movies (e.g., _Inception 2010_), so IPT's TV category is broad enough to cover movies. No config change needed.
   - **TorrentLeech**: use **`"Movies"`** — confirmed returning 10 results. (`"TV"` returned 0 for a movie title, so the `"Movies"` string is required.)

3. **Skip the TV-only season filter** — the filter that drops torrents without `parsed.season` must not run when `category === 'movie'`.

4. **Bypass the IPT/TL cache** — do not read from or write to `iptTlSearchCache` when `category === 'movie'`. Always perform a fresh search. Clear any existing TV cache entry for the search term so it is not reused after exiting movie mode.

5. **All providers searched in parallel** — no `more` flag distinction; always run all 4 providers simultaneously.

### `apps/api/src/server.js` — `/api/torrent-file` endpoint

Accept `savePath` and forward it:

```js
const savePath = req.query.savePath || null;
```

### `apps/api/src/usb.js` — `addQbtTorrent()` and `addQbtMagnet()`

The qBittorrent WebAPI (`/api/v2/torrents/add`) form field is **`savepath`** (all lowercase — confirmed from official API docs for API v2.11.2).

```js
if (input?.savePath) form.append("savepath", input.savePath);
```

---

## Resolved Questions (from movies-response.md)

| #   | Question                     | Answer                                                                                                                                       |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "All 4 providers"            | IPT, TL, TPB, LIM — **EZTV removed** from movie searches                                                                                     |
| 2   | Stream button hidden?        | **Yes** — hide Stream button in row 1 when in movie mode                                                                                     |
| 3   | Movie button always visible? | **Yes** — always visible, even when files pane is open                                                                                       |
| 4   | Placeholder typo             | Use **"Search Movies"**                                                                                                                      |
| 5   | Bypass cache in movie mode   | **Yes** — bypass IPT/TL cache; also **clear** the TV show cache entry                                                                        |
| 6   | EZTV for movies              | **Removed** — skip EZTV entirely in movie mode                                                                                               |
| 7   | IPT/TL movie categories      | **All 4 providers confirmed**: IPT→`"TV"`, TL→`"Movies"`, LIM→`"Movies"`, TPB→`"Video"` (cat codes 207/211). Add `TPB_MOVIE_CATEGORIES` set. |
| 8   | qbt savePath field name      | **Confirmed: `savepath`** (all lowercase) — verified against qBittorrent WebAPI v2.11.2 docs                                                 |
| 9   | Trigger poll immediately     | **Yes** — call `pollOnce()` immediately on mode switch, do not wait for next tick                                                            |
| 10  | Search input position        | **Far left** of row 2, before Get/Tab buttons                                                                                                |

## Movie Mode Visual Indicators

### Tor pane

- `Exit Movie` button background: **light-red** (`lightcoral`) via `--btn-bg` CSS variable
- Row 1 left title changes to: **`Tor Movie Search`** (static, no search text shown)

### qbt pane

- Row 2 left side shows: **`Movies`** label (matches `qBittorrent` style in row 1)
