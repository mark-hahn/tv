# Credit Card Click Flow

## User action

In the credits list (after clicking "All Credits" on an actor), user clicks a credit card.

## actors.vue — handleCreditCardClick(credit)

1. Guards: if no credit or no `imdbId`, returns immediately.
2. Builds a `srchChoice` object: `{ name: credit.title, tvdbId: null, imdbId: credit.imdbId, overview: null, imageUrl: credit.imageUrl }`.
   - Note: `tvdbId` is always null here — only the IMDb ID is available from the scrape.
3. Emits `evtBus.emit("reelSearchAction", { srchChoice, action: "preview" })`.
4. Does NOT deselect the current actor — the actor stays highlighted.

## list.vue — searchAction(payload)

1. Receives the `reelSearchAction` event.
2. Sees `action === "preview"`, calls `previewSearchChoice({ name, tvdbId: null, imdbId, overview: null, imageUrl })`.

## list.vue — previewSearchChoice(...)

1. Checks if the show already exists in the show list (by name or tvdbId).
   - If found: selects it normally, no preview mode entered.
2. If not found: enters **preview mode** (`setPreviewMode(true)`).
3. Emits `previewPanesLoading` and `showSeriesPane` — switches UI to the Series pane.
4. Emits `previewSrchChoice` with `{ name, tvdbId: null, overview }` — Series pane shows an "Add Show" button for this preview.
5. Constructs a synthetic show object with `inEmby: false`, `id: "noemby-preview-..."`, and the credit's `imageUrl`.
6. Calls `saveVisShow(show, ...)` — populates all panes with the synthetic show data (Series, Map, Info, etc.).
7. Listens for `tvdbDataReady` — when Series resolves TVDB data for the show by name search, preloads the Actors pane for the previewed show.

## Result

The app enters preview mode showing the credit's show in all panes, as if the user had searched for it manually. The user can then click "Add Show" to add it to the library.
