---
description: Web client (Vue 3) documentation and context
---

> **Generated: 2026-05-24 16:53 PST**
> **Warning: Code has changed since this was written. Verify details against source before relying on them.**

# Web Client (`apps/client`)

## Overview

The web client is a Vue 3 single-page application built with Vite. It is the primary management UI for a personal TV-show collection system. Its responsibilities span the full lifecycle of a TV show: discovering new shows, tracking them in the library (Emby), finding and downloading episode video files, managing subtitle extraction, and controlling the living room TV as a remote control. The app is used on desktop browsers and tablets (portrait and landscape), and it has a companion Android app (`apps/android`) that mirrors the TV-pane remote-control UI.

The entry point is `src/main.js`, the root component is `src/components/App.vue`, and all server communication is centralized in `src/srvr.js` and `src/emby.js`.

---

## Layout and Modes

### Two-Pane Layout

The UI is divided into two resizable panes separated by a draggable divider:

- **List pane** – a scrollable, filterable, sortable list of TV shows.
- **Tab area** – a set of tabbed panes that show detail or take action on the currently selected show (or operate globally in some panes).

In landscape orientation the panes sit side by side (list on the left, tabs on the right). In portrait they stack vertically (tabs on top, list below). The split position is persisted per orientation and is user-draggable.

### Simple Mode vs Non-Simple Mode

The URL query parameter `?simple` activates **simple mode**. This is used on smaller or touch devices (tablets, phones).

| Feature                                                           | Simple mode                           | Non-simple mode                 |
| ----------------------------------------------------------------- | ------------------------------------- | ------------------------------- |
| Management/action tabs (Tor, Browse, Flex, Qbt, Down, Usb, Local) | Hidden                                | Visible in a second tab bar row |
| Condition flag column in show rows                                | Hidden                                | Visible                         |
| Sort / filter toolbar (HdrBot)                                    | Hidden                                | Visible                         |
| Side buttons panel                                                | Shown (portrait only)                 | Not shown                       |
| Buttons panel inside list                                         | Shown                                 | Not shown                       |
| Show row height                                                   | 40 px                                 | 30 px                           |
| Default pane split                                                | 50 % landscape, 35 % portrait (fixed) | User-draggable                  |

In simple mode a collapsible `Buttons` panel provides filter shortcuts (Ready To Watch, Drama, Comedy, To Try, Continue, Mark, Linda, Trash, Custom) and sort-order shortcuts.

### Movie Mode

A **Movie** toggle button (non-simple mode only) switches certain panes to a movie-focused view. When active, the Tor, Qbt, Down, Usb, and Local panes adjust their headers and behavior to operate on movies rather than TV series.

---

## Show List (`list.vue`, `shows.vue`)

### Data Sources

On startup, `list.vue` fetches all shows from the server via `srvr.getShowsFromDisk()` and merges them with the local Emby library obtained through `emby.js`. The merged data is stored in the module-level `allShows` array. A separately fetched `allTvdb` map (keyed by show name) holds TVDB metadata such as ratings, genre, air status, and user-defined flags.

A **lastViewed cache** is polled every 10 seconds via `GET /api/getLastViewed`. This tracks which show is currently playing on Emby devices and highlights it in the list with a "Watching" indicator in the header.

### Show Row

Each row in the virtualized list (`vue-virtual-scroller`) shows:

- **Sort column** – a small value column displaying the currently active sort key (e.g. last-viewed date, ratings, file size, creator name). Width adjusts to zero when the sort value is irrelevant.
- **Show name** – the primary identifier. Clicking selects the show and loads its data into the tab panes.
- **Condition flags** (non-simple mode) – a row of colored icon badges that reflect the state of the show. Clicking some flags toggles them.

### Condition Flags

Each flag has a color, an icon, and a `cond(show)` predicate. The flags are:

| Name       | Color     | Icon          | Meaning                                                      |
| ---------- | --------- | ------------- | ------------------------------------------------------------ |
| unplayed   | cyan      | plus          | `notReady === false` — has unwatched episodes ready to watch |
| waiting    | lime      | clock         | has a `waitStr` (waiting for more episodes)                  |
| needsIntro | cyan      | film          | needs intro-scene processing                                 |
| gap        | red/light | minus         | file gap or watch gap detected                               |
| ended      | orange    | traffic-light | series has ended                                             |
| drama      | blue      | sad-cry       | not a comedy (no Comedy genre)                               |
| foreign    | blue      | globe         | original country is not USA                                  |
| totry      | lime      | question      | `inToTry` flag — on the "to try" list                        |
| continue   | lime      | arrow-right   | `inContinue` flag                                            |
| mark       | lime      | mars          | `inMark` flag                                                |
| linda      | lime      | venus         | `inLinda` flag                                               |
| ban        | red       | ban           | `reject` — rejected/hidden show                              |
| hasemby    | brown     | tv            | `inEmby !== false` — present in the Emby library             |

Clicking the `totry`, `continue`, `mark`, `linda`, `ban`, and `hasemby` flags triggers async toggles that save state to both Emby (via the Emby REST API) and the server's TVDB record store.

### Filtering and Sorting

**Non-simple mode** uses the `HdrBot` toolbar with:

- **Sort** choices: Alpha, Viewed, Added, Ratings, Notes, Size, Safe start, Ended, Length, Creator.
- **Filter** choices: Try Drama, Watching, Finished, Playing.
- **All** button — resets to the full list.
- **Condition filter (condfltr)** — each condition flag can be set to `+1` (must have), `0` (ignore), or `-1` (must not have), enabling combinatorial show filtering. Multiple flags can be combined simultaneously.

A **text filter** (in `HdrTop`) does a substring match against show names. The filter string is also used in actors-list mode to search actor names.

**Shared filters** — a filter configuration can be sent to or received from the server (`POST /api/setSharedFilters`, `GET /api/getSharedFilters`). This allows the same filter to be applied across different devices/browsers.

**Actors list mode** — an "Actors" button in `HdrTop` (non-simple mode) loads all actor–show associations from the Emby library and shows a sorted list of actors with their show counts. Clicking an actor pre-filters the show list to shows that actor appears in and jumps to the actors tab.

---

## Show Tab Panes (top tab bar)

These panes display data for the currently selected show. They appear in both simple and non-simple modes. The tab bar shows: **Info, Map, Actors, Reviews, Trailer, TV**.

### Info Pane (`info.vue`)

The primary show detail pane. Displays:

- Show name in the header.
- Poster image fetched from Emby.
- An info box with metadata: year, status (continuing/ended), rating, genres, original country, episode counts, file sizes, creation date.
- A description (overview) from TVDB/Emby.
- **Watch buttons** — quick links to open the show in Emby on configured devices.
- **Remote buttons** — shortcuts to play the most recently watched episode, open the next unwatched episode, etc.
- **Notes** — free-text per-show notes saved server-side via `POST /api/saveNote`.
- **Stream providers** — a streaming service lookup panel (TMDB `watch/providers`) showing where the show can be streamed.
- A **Refresh** button that re-fetches data from TVDB and Emby.
- In preview mode (see Browse pane): an "Add show to Emby" button and an "Exit Preview" button appear in the top bar.

### Map Pane (`map.vue`)

Displays the full season/episode grid for the selected show using data from the local TVDB cache (`GET /api/getSeriesMapFromTvdb`). Each episode cell shows its air date, a has-file indicator, and a watched indicator. Actions available:

- Click an episode to see details or play it (launches the in-browser video player).
- **Prune** — remove episodes before a cutoff date.
- **Set date** — change the show's start date.
- **Season watched** / **Season delete** — mark all episodes in a season as watched or delete the season's files.
- **Delete episodes** — delete individual episode files.
- In non-simple mode, additional management buttons appear in the map header.

### Actors Pane (`actors.vue`)

Shows the cast list for the selected show as returned by Emby's People API. Clicking an actor name fetches that actor's full filmography and other shows in the library they appear in. Provides a search box to look up actors by name across external sources (TMDB person search). Allows toggling VIP actor status which affects how actors appear in the actors-list mode of the show list.

### Reviews Pane (`reviews.vue`)

Aggregates reviews and ratings for the selected show from multiple sources (IMDB, Rotten Tomatoes) fetched via the `GET /api/getReviews` proxy on the server. Displays scores, review counts, and links.

### Trailer Pane (`trailer.vue`)

Fetches and embeds trailers for the selected show. Trailers are sourced from YouTube (embedded via the YouTube IFrame API) and from IMDB video URLs. Falls back gracefully when no trailers are available.

### TV Pane (`tvpane.vue`)

An on-screen remote control for the living room TV. This pane is not show-specific. See [Remote Control](#remote-control) below.

---

## Management/Action Tab Panes (bottom tab bar, non-simple mode only)

These panes appear only in non-simple mode in a second row of the tab bar. Most operate independently of the selected show, with Tor being the exception.

### Tor Pane (`tor.vue`)

The torrent search pane. When a show is selected it pre-populates the search with the show name and relevant episode information. Searches are executed through the server's torrent-search proxy (`POST /api/searchTorrents` or equivalent). Results are displayed as cards with title, size, seeders, and a download button that sends the torrent to qBittorrent. Also contains a **Stream** sub-panel for looking up streaming providers for the selected show.

### Browse Pane (`browse.vue`)

Used to discover new shows to add to the library. Contains:

- **Reel gallery** (`reel-gallery.vue`) — a scrollable vertical list of show poster thumbnails. The gallery can show TVDB search results, actor credits, or a user-defined snooze list.
- Show detail panel on the right showing info about the highlighted show.
- **Preview mode** — selecting a show in the gallery that is not yet in the library enters "preview mode". The top tabs switch to show that candidate show's Info and Map data (fetched live from TVDB). An "Add show to Emby" button creates the Emby library entry and exits preview.
- Search box for searching TVDB for shows by name or IMDB ID.
- Snooze list management — shows can be snoozed to revisit later.

### Flex Pane (`flex.vue`)

Manages Flexget, an automated torrent download scheduler running on the server. Allows:

- Running Flexget manually ("Force run").
- Viewing Flexget history log entries.
- Selecting specific shows to include in the next Flexget pass.
- Checking and adjusting Flexget config entries for the selected show.

The server runs Flexget via child process (`/root/.local/bin/flexget`) with the config at `apps/srvr/config/config.yml`.

### Qbt Pane (`qbt.vue`)

A dashboard for the qBittorrent client running on the server. Shows all active/paused/completed torrents with progress, speed, and file sizes. Provides:

- Resume/pause/delete torrent controls.
- Open qBittorrent Web UI button.
- Per-torrent association with show names (polled and highlighted in the show list when a download is active for a show).
- The parent `App.vue` polls qBittorrent status on a timer and emits `downActivePart` events that update the show list highlighting.

### Down Pane (`down.vue`)

Manages the `tv-down` server process, which is a download orchestration service that moves completed torrent files into the correct show folder structure, renames them, and triggers Emby library refreshes. The pane shows:

- Active and completed download tasks with their status.
- Speed metrics (total and average download speed).
- In movie mode, a dedicated movie download cycle flow.

The Down pane calls `TV_DOWN_URL` (`https://hahnca.com/tv-down`) — served by the `tv-down` pm2 process.

### Usb Pane (`usb.vue`)

Manages files on a remote USB server (`xobtlu@oracle.usbx.me`). Shows a file tree of available video files on the USB server. Actions:

- **Force Down** — copy selected files from the USB server to the local media storage.
- **Prune** — remove already-copied files from the USB server.
- Refresh file tree.
- In movie mode, shows movie files specifically.

### Local Pane (`local.vue`)

Manages video files that are already in the local media storage for the selected show. Shows a file tree of `mkv`/`mp4` files on disk. Provides:

- **Subs** — search OpenSubtitles (`POST /api/subsSearch`), apply subtitle files, offset subtitle timing.
- **Asr** — run automatic speech recognition (Whisper-based) to generate `.srt` subtitle files. Streams progress logs back via WebSocket push events (`asr-log`).
- **Emb** — generate embedding vectors from subtitle/audio files for intro detection. Streams logs via `emb-log` push events.
- **Fix** — run fix/re-encode jobs on video files. Streams logs via `fix-log` push events.
- **Ref** — trigger an Emby library refresh for the show.
- **Chksrt** — a queue of subtitle files to review. A counter badge on the top bar (`Chksrt N`) indicates pending reviews. Clicking opens the in-browser video player in chksrt mode.
- The in-browser video player (`video-player.vue`) is launched from this pane to play local files directly in the browser for subtitle QA.

---

## Remote Control

The **TV pane** (`tvpane.vue`) is a 3×5 grid of large touch-friendly buttons that control the living room TV via the `tv-tv` server. The grid layout:

| Row | Left                     | Center      | Right                    |
| --- | ------------------------ | ----------- | ------------------------ |
| 1   | Back (hold = long-press) | ▲ Up        | Home (hold = long-press) |
| 2   | ◀ Left                   | OK (hold)   | ▶ Right                  |
| 3   | Emby (hold)              | ▼ Down      | Skip (hold)              |
| 4   | Vol− (hold)              | Vol+ (hold) | Mute                     |
| 5   | Subs                     | Apps        | Google                   |

- **Left/Right with hold** — scrubs Emby playback forward/backward (Emby scrub API), falling back to key-repeat navigation.
- **Mute** — toggles mute; state is polled from the server and reflected in button color.
- **Subs** — opens a subtitle track selector panel showing all subtitle tracks for the currently playing Emby session on the Living Room TV.
- **Apps** — opens a streaming service launcher grid with Netflix, Prime Video, HBO Max pinned at the top plus all configured services.
- **Google** — a hold-activated button that switches the TV input to the Google TV input.
- **Collision detection** — if two clients send remote commands simultaneously, the pane detects the collision via WebSocket `tvRemoteAction` notifications and enters a brief avoidance window. A `tvRemoteCollision` event can lock the pane, showing a "Remote Collision" overlay requiring a long-press unlock.
- **Picture settings** — accessible from the TV pane header, allows numeric adjustment of TV picture parameters (brightness, contrast, etc.) via the HA API.

The TV pane communicates with the `tv-tv` server at `https://hahnca.com/tv-tv` using direct `fetch` calls for key presses (`GET /tv/key/{key}`) and scrub commands (`POST /tv/emby/scrub/start`). It also uses WebSocket (`wsSend`) for collision-coordination messages.

The TV pane reflects the current TV input mode (`off`, `google`, `tv`, `fire`, `other`) by polling Home Assistant state via the `tv-tv` server. The streaming services list (`apps/tv/services.json`) is different per mode.

---

## Server Communication

### Four Backend Services (pm2)

All backend processes run on `hahnca.com` and are managed by pm2 (`ecosystem.config.cjs`):

| pm2 name  | nginx path | Purpose                                                                                                                     |
| --------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tv-api`  | `/tv-api`  | Torrent search, TVDB proxy, Emby sync, TMDB, subtitle operations, ASR/embedding queue, file management, reviews, actor data |
| `tv-srvr` | `/tv-srvr` | Main WebSocket server; show data, TVDB records, gaps, last-viewed, notes, Flexget, fix/emb/asr streaming, shared filters    |
| `tv-down` | `/tv-down` | Download orchestration; moves completed torrent files into show folders, renames, triggers Emby refresh                     |
| `tv-tv`   | `/tv-tv`   | TV remote control bridge; sends key commands to the living room TV via Home Assistant and Bravia APIs                       |

### Client Configuration (`src/config.js`)

```js
const TV_API_URL = "https://hahnca.com/tv-api";
const TV_SRVR_URL = "https://hahnca.com/tv-srvr";
const TV_DOWN_URL = "https://hahnca.com/tv-down";
const TV_TV_URL = "https://hahnca.com/tv-tv";
```

### WebSocket (`tv-srvr`)

`srvr.js` opens a persistent WebSocket to `tv-srvr` with:

- Auto-reconnect on close (10-second delay).
- 5-second startup delay before first connect.
- Request/response multiplexing using numeric `id` fields.

Two types of messages flow over the WebSocket:

**Client → server calls** (`fCall`): Only used for streaming operations:

- `handleAsr` — start/control ASR subtitle generation.
- `handleEmb` — start/control embedding generation.
- `handleFix` — start/control video fix/re-encode.

**Server → client pushes** (notifications with `id === 0`):

- `asr-log` — ASR progress log lines.
- `fix-log` — fix job log lines.
- `emb-log` — embedding log lines.
- `tvdbUpdated` — a TVDB record was changed server-side; client applies to cache.
- `tvRemoteAction` — another remote client sent a TV command (collision detection).
- `tvRemoteCollision` / `tvRemoteLock` / `tvRemoteUnlock` — remote lock protocol.
- `missingEpisodeWarning` — Emby started playing an episode but an earlier unwatched episode exists.
- `lastViewedChanged` — a device started or stopped playing something.
- Generic notification events consumed by individual components via `evtBus`.

### HTTP Calls (`tv-srvr`)

All other `tv-srvr` calls are HTTP via `httpCall()` (GET or POST with JSON body, 30-second default timeout). Key endpoints include:

| Endpoint                                                   | Method   | Purpose                                 |
| ---------------------------------------------------------- | -------- | --------------------------------------- |
| `/api/getShowsFromDisk`                                    | GET      | All show folders on disk                |
| `/api/getLastViewed`                                       | GET      | Currently-playing show per device       |
| `/api/getAllTvdb`                                          | GET      | Full TVDB metadata cache                |
| `/api/setTvdbFields`                                       | POST     | Update/delete a TVDB record             |
| `/api/accessTvdb`                                          | POST     | Proxy a TVDB API request                |
| `/api/getSeriesMapFromTvdb`                                | POST     | Season/episode map for a show           |
| `/api/saveNote`                                            | POST     | Save per-show note text                 |
| `/api/getSharedFilters` / `setSharedFilters`               | GET/POST | Cross-device filter sharing             |
| `/api/deletePath`                                          | POST     | Delete a folder on disk                 |
| `/api/delSeasonFiles`                                      | POST     | Delete files for one season             |
| `/api/embySync` / `triggerEmbySync`                        | POST     | Trigger Emby library scan               |
| `/api/refreshEmbyItem`                                     | POST     | Refresh a single Emby item              |
| `/api/getGroupCounts` / `incrementGroupCount`              | GET/POST | Genre group click tracking              |
| `/api/getVipActors` / `setVipActors`                       | GET/POST | VIP actor list                          |
| `/api/subsSearch`                                          | POST     | OpenSubtitles search proxy              |
| `/api/applySubFiles` / `deleteSubFiles` / `offsetSubFiles` | POST     | Subtitle file management                |
| `/api/asr/log` / `queue` / `kill`                          | GET/POST | ASR queue management                    |
| `/api/asr/chksrt/list` / `ok` / `gensrt` / `select`        | GET/POST | Subtitle review queue                   |
| `/api/introFirstFile`                                      | GET      | First playable file for intro detection |
| `/api/getRemotes`                                          | POST     | Remote control configuration            |

### HTTP Calls (`tv-api`)

Fewer direct HTTP calls go to `tv-api`; these are mainly actor-related:

| Endpoint                     | Method | Purpose                          |
| ---------------------------- | ------ | -------------------------------- |
| `/api/getActorPage`          | POST   | Fetch actor Wikipedia/bio page   |
| `/api/getActorCredits`       | POST   | Fetch actor filmography          |
| `/api/searchActorsInNonEmby` | POST   | Find actors in shows not in Emby |
| `/api/getTmdb`               | POST   | TMDB show data                   |
| `/api/searchTmdbPerson`      | POST   | TMDB person search               |
| `/api/getStreamProviders`    | POST   | TMDB watch provider data         |
| `/api/getReviews`            | GET    | Aggregated reviews scrape        |

---

## External / Remote Resources

### Emby (`emby.js`, `urls.js`)

Emby runs at `https://hahnca.com:8920` (HTTPS on port 8920). The client communicates directly with the Emby REST API using axios. Authentication uses a hardwired API key and user credentials. Key operations:

- **Show list** — `GET /emby/Users/{userId}/Items` with `IncludeItemTypes=Series`.
- **User data** (played state, to-try, etc.) — `POST /emby/Users/{userId}/Items/{id}/UserData`.
- **Collections** — four named Emby collections (To Try, Continue, Mark, Linda) are synced as boolean flags on show objects.
- **Delete show** — `DELETE /emby/Items/{id}`.
- **Library scan trigger** — `POST /emby/ScheduledTasks/{taskId}/TriggersNow`.
- The `emby.js` module maintains an `allShows` cache and merges TVDB flags into each show object at load time.

### TVDB

TVDB API calls are proxied through the server (`POST /api/accessTvdb`) to avoid CORS issues with the `Authorization` header. The client-side `tvdb.js` wraps this proxy in a `tvdbFetch()` function that mimics the native `fetch` Response interface. The TVDB cache (`allTvdb`) is loaded on startup and patched in-place via server-push `tvdbUpdated` WebSocket events.

### Living Room TV — Bravia 7

The living room TV is a Sony Bravia 7. Remote control is via the `tv-tv` backend server which bridges to:

- **Home Assistant** — for power state, input switching, mute, and volume via the `media_player` entity.
- **Sony Bravia REST API** — for direct key-code injection (`ircc` commands) for navigation, OK, back, skip, etc.
- **Emby API** — for playback scrubbing (seek forward/back) via Emby's active-sessions API.

The TV pane detects the current TV mode from the HA `media_player.living_room_tv` state and `mediaTitle`:

- `off` — TV is off or unavailable.
- `google` — Google TV launcher is active (`mediaTitle === "Smart TV"`).
- `tv` — regular TV input (`mediaTitle === "TV"`).
- `fire` — Fire TV Stick on HDMI 2 (`mediaTitle === "Fire TV Stick"` or `"HDMI 2"`).
- `other` — any other source.

**Picture settings** — the TV pane includes an adjustable picture-settings panel (brightness, contrast, color, etc.) that sends commands to the Bravia via the `tv-tv` server.

### Fire TV

When the TV is on the Fire TV input (HDMI 2), the TV pane adapts key-repeat behavior: left-arrow repeats send multiple rapid key presses tuned for Fire TV's faster-responding navigation. The streaming services grid changes to Fire TV–appropriate apps.

---

## In-Browser Video Player (`video-player.vue`)

A full-screen overlay video player launched from the Local pane, Map pane, or Info pane. Operates in three modes:

- **Normal** — plays an arbitrary local file path.
- **Intro** — plays the first file of a show for intro-scene trimming. Has a "Next" button to advance to the next show needing an intro. Emits `introNext` when advancing.
- **Chksrt** — plays files from the subtitle review queue. Shows the filename and whether a subtitle match was found. Has OK / Generate SRT / Select SRT controls. Chksrt count is polled every 60 seconds and shown as a badge in the bottom tab bar.

The video element uses a `/stream` endpoint (served by `tv-srvr`) to stream files. Subtitle tracks (`.srt` files alongside the video) are loaded as WebVTT tracks. Track cycling is supported.

---

## Event Bus (`evtBus.js`)

A simple publish/subscribe singleton used for cross-component communication without Vue prop drilling. Key events:

- `selectShow` / `selectShowFromCardTitle` — programmatically select a show in the list.
- `downActivePart` — qBt/Down is actively downloading; update show list highlighting.
- `asr-log` / `fix-log` / `emb-log` — streaming log lines from server pushed to Local pane.
- `tvMuteState` — TV mute state changed.
- `tvRemoteAction` / `tvRemoteLock` / `tvRemoteUnlock` / `tvRemoteCollision` — remote collision protocol.
- `missingEpisodeWarning` — App.vue shows a modal warning.
- `tvdbUpdated` — a TVDB record was updated server-side.
- `paneChanged` — active tab changed (used by TvPane to stop polling when hidden).
- `introPaneClosed` — video player closed after intro mode.
- `openChksrt` / `chksrt-count` — chksrt queue events.
- `previewSrchChoice` / `addPreviewShowDone` / `previewPanesLoading` — browse preview mode events.

---

## Component Summary

| File                | Role                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `App.vue`           | Root; layout, tab routing, pane resize, global modals (help, missing-ep warning, TVDB mismatch) |
| `list.vue`          | Show list controller; data loading, filtering, sorting, show selection                          |
| `shows.vue`         | Virtualized show rows with condition flags                                                      |
| `hdrtop.vue`        | List header: count, filter input, "Watching" indicator, library buttons                         |
| `hdrbot.vue`        | List subheader (non-simple): sort/filter dropdowns, condition flag toggles                      |
| `buttons.vue`       | Simple-mode sidebar: filter/genre/collection/sort shortcuts                                     |
| `info.vue`          | Show detail: poster, metadata, notes, watch/remote buttons, stream providers                    |
| `map.vue`           | Season/episode grid with file and watched indicators                                            |
| `actors.vue`        | Cast list, actor credits, VIP actor management                                                  |
| `reviews.vue`       | Aggregated show ratings and reviews                                                             |
| `trailer.vue`       | YouTube and video trailer embeds                                                                |
| `tvpane.vue`        | Living room TV remote control                                                                   |
| `tor.vue`           | Torrent search and download (show-specific)                                                     |
| `browse.vue`        | New show discovery via TVDB search and reel gallery                                             |
| `flex.vue`          | Flexget scheduler management                                                                    |
| `qbt.vue`           | qBittorrent torrent client dashboard                                                            |
| `down.vue`          | Download orchestration (tv-down server)                                                         |
| `usb.vue`           | USB server file browser and copy                                                                |
| `local.vue`         | Local file manager: subtitles, ASR, embedding, fix                                              |
| `video-player.vue`  | In-browser full-screen video player (normal, intro, chksrt modes)                               |
| `stream.vue`        | Streaming provider lookup popup                                                                 |
| `reel-gallery.vue`  | Scrollable poster gallery for show browsing                                                     |
| `tree-node.vue`     | Recursive file tree node for USB/Local panes                                                    |
| `meta.vue`          | Show metadata display sub-component                                                             |
| `actor.vue`         | Single actor display sub-component                                                              |
| `keyboard-pane.vue` | On-screen keyboard for Android/TV text input                                                    |
