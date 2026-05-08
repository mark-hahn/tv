# Movies Plan

## Changes in This Version (v3 — movies-response2.md)

> **Differences from previous version** (v2):
>
> 1. **qbt savePath corrected**: was `/mnt/media/movies` (wrong — that's the final destination on the local server). Now `/home/xobtlu/movies` (the USB qBittorrent staging folder, confirmed to exist).
> 2. **Added movie download flow**: after qbt finishes a file on USB, the `apps/down` server rsyncs it to `/mnt/media/movies` on `hahnca.com` (one per file, up to 8 simultaneous). Client shows live rsync progress.
> 3. **Added `down.vue` changes**: movie mode changes row 1 label/buttons, hides row 2, switches to a new `movieDownPane` subpane.
> 4. **Single-file-only constraint**: tor/qbt must not download folders — only individual movie files.
> 5. **New files to change**: `apps/client/src/components/down.vue` + server-side rsync logic in `apps/down/src/`.

---

## Overview

Add a movie download mode to the tor, qbt, and down panes. A `Movie` toggle button in the tor pane header switches all three panes into movie mode, changing search behavior, card display, download destination, and the download progress view.

---

## Files to Change

| File                                  | Change                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/client/src/components/tor.vue`  | Add Movie button, movie mode toggle, row 2 movie search input, hide/show elements, card rendering, visual indicator                  |
| `apps/client/src/components/qbt.vue`  | Movie mode header text, hide/show buttons, savePath on download, clear cards on mode switch                                          |
| `apps/client/src/components/down.vue` | Movie mode row 1 (label + buttons), hide row 2, switch subpane to movieDownPane (v-show); receive movieMode prop                     |
| `apps/api/src/search.js`              | Accept `category` param, use movie provider categories, skip TV-only season filter in movie mode, bypass IPT/TL cache                |
| `apps/api/src/server.js`              | Pass `category` from `/api/search` to `searchTorrents()`; pass `savePath` from `/api/torrent-file` to `addQbtTorrent`/`addQbtMagnet` |
| `apps/api/src/usb.js`                 | Add `savePath` param to `addQbtTorrent()` and `addQbtMagnet()`                                                                       |
| `apps/down/src/movie-rsync.js` (new)  | Start/track rsync jobs (USB → local), capture live progress, expose via polling endpoint                                             |
| `apps/down/src/server.js` (or index)  | Add `/movieDownloads` polling endpoint; wire movie-rsync module                                                                      |

---

## State Management

Add a `movieMode` boolean in the **parent component** (App.vue or equivalent) as a reactive prop/data field, passed down to `tor.vue`, `qbt.vue`, and `down.vue`. When tor emits a `movieModeChange` event the parent flips the flag, which propagates to all three panes.

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

**⚠️ Changed from v2**: qBittorrent (which runs on the USB server `oracle.usbx.me`) must save movie files to its local `~/movies` staging folder (`/home/xobtlu/movies`), **not** to the final destination `/mnt/media/movies`. The `apps/down` server then rsyncs files from USB to `/mnt/media/movies`.

When `movieMode` is true, include `&savePath=%2Fhome%2Fxobtlu%2Fmovies` in the torrent-file URL call. When false the existing behavior (no savePath, qBittorrent uses its default) remains unchanged.

### Single-file constraint

In movie mode, tor and qbt handle **single-file downloads only** — no folders. This constraint is enforced by the user selecting individual movie file torrents, not torrent packs containing multiple files or folder structures.

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

## Down Pane Changes (`down.vue`)

### Prop

```js
props: {
  movieMode: { type: Boolean, default: false },
  // ...existing props
}
```

### Row 1 — Title and buttons in movie mode

In movie mode:

- Left span changes from `Downloads` to **`Movie Downloads`** (conditional)
- The speed stats (`totalDownloadingSpeedText`, `avgDownloadingSpeedText`) remain visible — they now reflect combined rsync throughput rather than TV downloads
- Remove (add `v-if="!movieMode"` to): **Cycle**, **Errs**, **Clr**, **Active** buttons
- Other buttons (Bot, Stop) remain

```html
<span>{{ movieMode ? 'Movie Downloads' : 'Downloads' }}</span>
```

### Row 2 — Hidden in movie mode

The entire row 2 (`<div style="display: flex; justify-content: space-between ..."`) is wrapped with `v-if="!movieMode"`. This hides the search input, Sel, From, All, First, etc. buttons.

### Subpane switching — v-show

Use `v-show` (not `v-if`) to switch between the normal down card list and `movieDownPane`. Both components stay mounted so the normal down pane continues polling while hidden.

```html
<!-- Normal down subpane -->
<div id="scroller" v-show="!movieMode" ...>
  <!-- existing card list -->
</div>

<!-- Movie download subpane -->
<div id="movie-down-pane" v-show="movieMode" ...>
  <div v-for="job in movieDownJobs" :key="job.filename" ...>
    <div>{{ job.filename }}</div>
    <div>{{ job.progressLine }}</div>
  </div>
</div>
```

### `movieDownJobs` data

New data property:

```js
movieDownJobs: []; // Array of { filename, progressLine }. Never removed. Not persistent across page loads.
```

When a new job arrives from the server (via polling `/movieDownloads`), append to `movieDownJobs` if not already present; update `progressLine` in place if already present.

### Movie download polling

When `movieMode` is true, start a separate poll to a new endpoint (e.g., `${config.tvDownUrl}/movieDownloads`) every ~2 seconds. Stop polling when `movieMode` is false. The endpoint returns an array of `{ filename, progressLine }` objects.

### progressLine format

Rsync `--progress` output line: `238,551,040   1%   10.49MB/s    0:26:59`

Parsed fields:

- `bytes_done` = `238551040` (remove commas)
- `pct` = `1`
- `total_bytes` = `bytes_done / (pct / 100)` — compute total from bytes + percentage
- `rate_mbps` = rate in MB/s × 8 → format like existing speed display (e.g., `83.9 Mbps`)
- `time_remaining` = `0:26:59`
- `eta` = `now + time_remaining`, formatted as `HH:mm PST`
- `status` = `Downloading` (while running) or `Finished`

Row 2 display: `<total_size> | <bytes_done_formatted> | <rate_mbps> | Rem: <time_remaining> | Eta: <HH:mm> | <status>`

Size formatting uses the same helper as existing down cards (e.g., `4.25 GB`).

---

## Movie Download Flow (Server Side)

### Overview

1. User selects a single-file movie torrent in `tor.vue` and downloads it → qBittorrent on USB server saves to `/home/xobtlu/movies/`.
2. `apps/down` server polls for completed movie torrents (qBittorrent save_path = `/home/xobtlu/movies`, state = completed).
3. For each completed file (up to 8 simultaneously), start an rsync job: `rsync --progress xobtlu@oracle.usbx.me:/home/xobtlu/movies/<filename> /mnt/media/movies/<filename>`.
4. Capture rsync `--progress` stdout line-by-line; update in-memory job state.
5. Client polls `/movieDownloads` → server returns current job states → client updates `movieDownPane`.

### `apps/down/src/movie-rsync.js` (new file)

```js
const USB_MOVIES_PATH = "/home/xobtlu/movies";
const LOCAL_MOVIES_PATH = "/mnt/media/movies";
const MAX_SIMULTANEOUS = 8;
const USB_USER = "xobtlu";
const USB_HOST = "oracle.usbx.me";
```

- `getActiveJobs()` → returns array of `{ filename, progressLine, status }`
- `startRsync(filename)` → spawns `rsync --progress` process; captures stdout; updates job state; marks `status = 'Finished'` on exit code 0
- `pollQbtMovies()` → polls qBittorrent API for completed torrents with `save_path` matching `/home/xobtlu/movies`; starts rsync for any not already tracked

### `/movieDownloads` endpoint (in `apps/down` server)

```
GET /movieDownloads
Response: [{ filename: string, progressLine: string }]
```

Returns the current job array from `movie-rsync.js`. Called by the client every ~2 seconds when in movie mode.

### ⚠️ Resolved decisions

1. **qbt polling for completion**: Detect completed movie torrents by `save_path = /home/xobtlu/movies` in the qBittorrent torrent info. No tagging needed. Filter qbt torrents where `save_path` matches and `state` is one of the finished states (`uploading`, `stalledUP`, `stoppedUP`, `forcedUP`).
2. **tvDownUrl config**: Confirmed — `/movieDownloads` is served from `config.tvDownUrl` (existing `apps/down` server).
3. **Speed stats in row 1**: `totalDownloadingSpeedText` and `avgDownloadingSpeedText` are replaced in movie mode by aggregate rsync stats computed from `movieDownJobs`. A `movieDownloadStats` computed property reads active (non-Finished) jobs, sums their parsed rates for total throughput, and averages them for avg throughput. These are shown in the same position as the existing speed spans but only reflect rsync jobs. The existing TV speed spans get `v-if="!movieMode"`.

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

The qBittorrent WebAPI (`/api/v2/torrents/add`) form field is **`savepath`** (all lowercase — confirmed from official API docs for API v2.11.2). The value passed in movie mode is `/home/xobtlu/movies` (USB staging folder).

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
| 11  | qbt savePath value           | **`/home/xobtlu/movies`** (USB staging folder, confirmed exists) — rsync moves to `/mnt/media/movies` after qbt finishes                     |
| 12  | Single-file constraint       | **Yes** — tor/qbt for movies handle individual files only, not folder torrents                                                               |
| 13  | down.vue movie mode          | Row 1: `Movie Downloads` label, hide Cycle/Errs/Clr/Active; Row 2: hidden; subpane: `movieDownPane` (v-show)                                 |
| 14  | movieDownPane cards          | Accumulate per rsync job; never removed during session; not persisted across page loads; no card selection                                   |

## Movie Mode Visual Indicators

### Tor pane

- `Exit Movie` button background: **light-red** (`lightcoral`) via `--btn-bg` CSS variable
- Row 1 left title changes to: **`Tor Movie Search`** (static, no search text shown)

### qbt pane

- Row 2 left side shows: **`Movies`** label (matches `qBittorrent` style in row 1)

### Down pane

- Row 1 left label changes to: **`Movie Downloads`**
- Cycle, Errs, Clr, Active buttons hidden
- Subpane shows `movieDownPane` with live rsync progress cards
