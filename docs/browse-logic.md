# TVMaze to Browse Pane Flow

This is the path for a brand-new, unbrowsed TVMaze show to become the selected card in the Browse pane and then become the loaded show/preview in the app.

## 1. TVMaze sync creates an unbrowsed row

The TVMaze database is owned by the API server, not `tv-srvr`.

On API-server startup, `apps/api/src/server.js` calls `startTvmaze()` from `apps/api/src/tvmaze.js`. That opens `apps/api/data/tvmaze.sqlite`, starts an immediate sync, and schedules the daily sync.

The sync fetches TVMaze directly:

- `GET https://api.tvmaze.com/shows?page=N`
- later, `GET https://api.tvmaze.com/updates/shows?since=day`
- for updated IDs, it fetches the individual TVMaze show record as needed

Rows are stored in the `shows` table keyed by `tvmaze_id`. Important browse columns are:

- `tvmaze_id`
- `tvdb_id`
- `imdb_id`
- `premiered`
- `status`
- `type`
- `language`
- `name`
- `browsed`
- `data_json`
- `tvdb_overview`

When a show is inserted from TVMaze, it is inserted with `browsed = 0`. Existing rows are updated for metadata/data changes, but the update path does not reset `browsed`, so a show that was already browsed stays browsed.

If TVMaze has no premiered date, the sync tries to fill it from TheTVDB by logging into TheTVDB and calling:

- `GET https://api4.thetvdb.com/v4/search?query=...&type=series&limit=5`

That `premiered` value matters because browse candidates are sorted newest first.

## 2. Candidate selection starts from unbrowsed TVMaze rows

The browse logic lives in `apps/api/src/browse.js` and pulls candidates through `getCandidateShows()` in `apps/api/src/tvmaze.js`.

The candidate SQL is:

```sql
SELECT tvmaze_id, data_json
FROM shows
WHERE (browsed IS NULL OR browsed = 0)
ORDER BY premiered DESC
LIMIT ?
```

The JSON in `data_json` is parsed back into a TVMaze show object, and `tvmaze_id` is injected onto that object before filtering. The browse API normally asks for the newest 100 unbrowsed candidates.

## 3. Browse availability checks

The client checks whether browse has anything available in two ways.

The Browse pane itself calls:

- `GET https://hahnca.com/tv-api/api/hasBrowseShow`

`App.vue` also subscribes to the shared `browseHasMore` channel through the `srvr.openChannel("browseHasMore")` client helper. The API server owns that channel through `ChannelPeer`; `tv-srvr` acts as the WebSocket hub. The channel payload is:

```js
{ available: hasBrowseShow() }
```

`hasBrowseShow()` uses the same unbrowsed candidate query, but it only applies the cheap synchronous filters. It does not run the asynchronous TheTVDB overview language check, so it is an availability hint rather than a full guarantee that `getBrowseShow()` will accept a card.

## 4. Starting the Browse pane loads existing card history

When `browse.vue` starts, it does not immediately find a new TVMaze show. It first loads cached browse-card history:

- `GET https://hahnca.com/tv-api/api/getAllBrowse`

The API returns the in-memory `resultTitles` list, which was initialized from:

- `apps/api/data/browse-cards.json`

The client appends those returned entries to `titleStrings`, deduping by parsed title. If entries exist, the title-list watcher selects the last non-message card. That selection sets `curTitle` and `srchStr`, which starts the reel-gallery lookup described below.

On mount, Browse also loads supporting data:

- `GET https://hahnca.com/tv-srvr/api/getAllTvdb?hasEmby=0`, through `getAllTvdb()`
- `GET https://hahnca.com/tv-srvr/api/snooze-list`

Those calls are used for existing-show checks, genres, snooze state, and remote-button context; they do not choose the next TVMaze browse candidate.

## 5. Pressing Next asks the API for the next browse show

The `Next` button in `browse.vue` runs `handleNext()`.

The client first ensures browse has started, clears old remote-button state, and then calls:

- `GET https://hahnca.com/tv-api/api/getBrowseShow`

The API route calls `getBrowseShow()` in `apps/api/src/browse.js` and returns:

```js
{
	titles,
	pendingBrowsedId
}
```

`titles` is the whole `resultTitles` card list after adding the newest accepted/rejected card. `pendingBrowsedId` is the TVMaze ID of the accepted show, if one was found.

## 6. Filtering inside getBrowseShow()

`getBrowseShow()` loops over the newest 100 unbrowsed candidates and builds a display title with `buildShowTitle(show)`. The title is the TVMaze name plus a year suffix when `show.premiered` exists, for example:

```txt
Example Show (2026)
```

For each candidate, the synchronous rejection filters run first:

- reject if there is no `show.image.medium` or `show.image.original`: `no-image`
- reject if a card with the same parsed title already exists in `browse-cards.json`: `already-seen`
- reject ignored TVMaze types: `Award Show`, `Documentary`, `Game Show`, `News`, `Panel Show`, `Reality`, `Sports`, `Talk Show`, `Variety`
- reject if `show.language` exists and is not `English`: `language`
- reject if `show.webChannel.country.name` is in the ignored country list: `country`
- reject if `show.network.country.name` is in the ignored country list: `country`
- reject if any TVMaze genre is in the avoid list: `anime`, `children`, `documentary`, `family`, `food`, `game Show`, `game-show`, `home & garden`, `musical`, `reality`, `music`, `talk`, `stand-up`, `travel`, `war`, `diy`, `nature`, `supernatural`
- reject if the TVMaze `summary` is long enough to identify and `franc-min` says it is not English, undetermined, or Scots: `desc-language`

If the show survives those filters, the API then runs the async TVDB-overview language check. This is because the Browse pane displays TVDB text when available, not just the TVMaze summary.

That helper uses a cached `shows.tvdb_overview` column. If no cached value exists, it logs into TheTVDB and calls one of:

- `GET https://api4.thetvdb.com/v4/series/{tvdbId}` when the TVMaze record has `externals.thetvdb`
- `GET https://api4.thetvdb.com/v4/search?query={name}&type=series&limit=5` when no TVDB ID is available

The fetched overview is cached in `tvmaze.sqlite`. If that overview is non-English by the same `franc-min` rule, the show is rejected as `desc-language`.

## 7. What happens to rejected candidates

When a candidate is rejected, `getBrowseShow()` immediately marks it browsed:

```sql
UPDATE shows SET browsed = 1 WHERE tvmaze_id = ?
```

Most rejection reasons are silent: the show is removed from future browse consideration but no visible card is appended.

Genre rejections are special. If the rejection reason is in the avoid-genre list and is not `reality`, the API appends a visible rejected card to `browse-cards.json` with this JSON shape:

```js
{
	status: rejection,
	title,
	imdbid: show.externals?.imdb,
	tvdbid: show.externals?.thetvdb,
	data: show
}
```

Those rejected cards show in the Browse pane title list with a red status label. `reality` is filtered silently.

## 8. What happens to the accepted candidate

The first candidate that passes all filters is appended to `resultTitles` and persisted to `browse-cards.json` as:

```js
{
	status: "ok",
	title,
	imdbid: show.externals?.imdb,
	tvdbid: show.externals?.thetvdb,
	data: show
}
```

`appendResultTitle()` dedupes by parsed title, appends the new card, trims history to the newest 200 entries, and writes the JSON file atomically.

Important detail: the accepted show is not marked `browsed = 1` immediately. Instead, `getBrowseShow()` returns its TVMaze ID as `pendingBrowsedId`. The client acknowledges after it has appended/displayed the card:

- `POST https://hahnca.com/tv-api/api/ackBrowsed`
- body: `{ "tvmazeId": pendingBrowsedId }`

The ack calls `markShowBrowsed(tvmazeId)` and publishes a `browseHasMore` channel update. This prevents losing the accepted candidate before the client has actually received it.

## 9. The returned card becomes selected in the Browse title list

Back in `handleNext()`, the client parses the returned `titles` with `toTitleArray()`, removes the `-- no more titles --` sentinel if present, dedupes by parsed title, and appends the returned entries to `titleStrings`.

Then the `watch(titleStrings, ...)` handler runs. It scrolls the title list to the bottom and selects the last card, except that if the last card is the no-more message it selects the previous card.

Selecting a title runs `selectTitle(idx)`:

- ignores message cards
- sets `selectedTitleIdx`
- sets `curTitle` to the parsed title
- sets `srchStr` to that same title

The selected title card is highlighted in light yellow. Accepted cards have a light-green background when they are not selected.

## 10. The reel gallery searches TheTVDB and auto-selects a card

The Browse template passes these values into `reel-gallery.vue`:

```vue
<reel-gallery
	:srchStr="srchStr"
	:imdbid="curImdbId"
	:tvdbid="curTvdbId"
	:fallbackImage="manualSearchQuery ? null : curFallbackImage"
	@select="handleGallerySelect"
	@preview="handleGalleryPreview"
	@search-complete="handleSearchComplete"
></reel-gallery>
```

`curImdbId`, `curTvdbId`, and `curFallbackImage` come from the selected browse-card JSON:

- `imdbid` is from `show.externals.imdb`
- `tvdbid` is from `show.externals.thetvdb`
- fallback image is `show.image.original` from the TVMaze record when available

When `srchStr` changes, `reel-gallery.vue` calls `srchTvdbData(srchStr)` in `apps/client/src/tvdb.js`. That strips a trailing `(YYYY)` from the title and sends the year separately, then calls TheTVDB through `tv-srvr`:

- client `POST https://hahnca.com/tv-srvr/api/accessTvdb`
- `tv-srvr` `GET https://api4.thetvdb.com/v4/search?type=series&query={title}&year={year}`

`tv-srvr` attaches the TheTVDB bearer token, refreshes it on 401, and returns the upstream JSON to the browser.

The reel gallery receives `data`, sorts it, and if the browse card supplied a TVDB ID or IMDb ID, it moves the matching result to the front. Then it:

- sets `tvdbList` to the sorted results
- scrolls the gallery to the top
- sets `selectedIdx = 0`
- emits `select` with the first TVDB result
- emits `search-complete` with the same result

That is the moment the card is selected in the reel gallery. The selected gallery card is highlighted with the gallery's selected-card background.

## 11. The selected gallery result loads into the Browse pane

The Browse pane receives the gallery `select` event in `handleGallerySelect(tvdb)`.

For the normal browse flow, it sets:

```js
curTvdb.value = tvdb
```

That single assignment drives most of the right-side Browse pane:

- `galleryTitleLine` shows the selected TVDB result name
- `infoLine` shows country, language, network, TVMaze ID, first-aired date, and genres when present
- the description area uses TVDB overview fields when present and can also show TVMaze metadata from the selected card (`curTvmazeMeta`)
- action buttons become tied to the selected result

If the selected TVDB result has no genres, Browse tries to attach them:

1. look in the already-loaded `allTvdbData` cache by TVDB ID or name
2. if still missing and a TVDB ID exists, call TheTVDB extended series data through the same `accessTvdb` proxy:
	 - client `POST https://hahnca.com/tv-srvr/api/accessTvdb`
	 - `tv-srvr` `GET https://api4.thetvdb.com/v4/series/{tvdbId}/extended`

`curTvdb` is also watched. Whenever it changes, Browse loads remote buttons with `loadRemotesForTvdb()`:

- checks cached remotes in `allTvdbData`
- otherwise calls `POST https://hahnca.com/tv-srvr/api/getRemotes`
- `tv-srvr` returns remote links/buttons such as Google, IMDb, Rotten Tomatoes, Wikipedia, official site, and Emby when applicable

At this point the show is loaded in the Browse pane, but it is not yet necessarily the app's global `currentShow`. It is the selected Browse/TVDB candidate.

## 12. Preview/Get loads the selected Browse candidate as the app show

From the selected `curTvdb`, Browse builds a `srchChoice` in `handleLoad()`:

```js
{
	name,
	tvdbId,
	overview,
	image,
	year,
	originalCountry,
	searchDtlTxt
}
```

Before emitting anything, `handleLoad()` checks `props.allShows` by TVDB ID and then by normalized name. If the show already exists, Browse shows a toast and does not create a new load action.

The buttons then emit:

- Preview: `evtBus.emit("reelSearchAction", { srchChoice, action: "preview" })`
- Get: `evtBus.emit("reelSearchAction", { srchChoice, action: "add" })`

`list.vue` listens for `reelSearchAction` and calls `searchAction()`.

For `action: "preview"`:

- if an existing show matches by TVDB ID or name, it selects that show
- otherwise it enters preview mode
- emits `showSeriesPane`
- emits `previewSrchChoice`
- builds a temporary no-Emby preview show like `id: noemby-preview-...`, `inEmby: false`, `name`, `tvdbId`, `overview`, `imageUrl`
- calls `saveVisShow(show, ..., forceSetUpSeries: true)`
- `saveVisShow()` emits `setUpSeries`
- `App.vue` receives `setUpSeries`, sets `currentShow`, and normally switches to the Series pane

For `action: "add"`:

- if an existing non-preview Emby show matches, it selects it
- otherwise it calls `POST https://hahnca.com/tv-srvr/api/getNewTvdb` to get full TVDB data
- it calls TheTVDB series-map helpers to determine seasons
- it creates the show folder and refreshes Emby through the Emby helper path
- it reloads shows, finds the new show by TVDB ID/name, updates caches, and calls `saveVisShow(show, ..., forceSetUpSeries: true)`
- `saveVisShow()` emits `setUpSeries`, and `App.vue` sets `currentShow`

So the normal end-to-end path is:

1. TVMaze sync inserts show with `browsed = 0`.
2. Browse availability sees at least one cheap-filter candidate.
3. Browse starts by loading existing `browse-cards.json` with `getAllBrowse()`.
4. User presses `Next`.
5. Client calls `getBrowseShow()`.
6. API pulls newest unbrowsed TVMaze rows, filters them, appends the first accepted card, and returns it with `pendingBrowsedId`.
7. Client appends the card, posts `ackBrowsed`, and the title-list watcher selects the new title card.
8. Title selection sets `srchStr`.
9. Reel gallery searches TheTVDB through `tv-srvr` `accessTvdb`, prioritizes the supplied TVDB/IMDb ID match, selects the first gallery card, and emits it.
10. Browse receives the selected TVDB result as `curTvdb`, loads genres/remotes as needed, and displays the show in the Browse pane.
11. Preview/Get can then promote that selected Browse candidate into the app-wide loaded show via `reelSearchAction` -> `list.vue` -> `saveVisShow()` -> `setUpSeries` -> `App.vue currentShow`.

