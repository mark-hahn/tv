
# REEL PANE specs: END-TO-END FLOW (CLIENT → API → REELGOOD)

# client and server environments

- the client is a vite vue app that runs in the browser. it is tested by running vite vue in the wsl project at local /root/apps/tv/apps/client. it is hosted at the remote server from /root/dev/apps/tv-series-client.

- the remote server has three directories that have servers running in pm2 that host apis. they are /root/dev/apps/tv/api, /root/dev/apps/tv/down, and /root/dev/apps/tv/srvr. the server dirs contain copies of the projects in local /root/apps/tv/apps.

## Reel Overview

- The Reel pane is a UI that shows a stream of “cards” representing show titles from reelgood.com.

- The client gets show titles from the tv API. the remote /root/dev/apps/tv/api server hosts the api that the reel client calls.

- The tv API fetches show titles from reelgood.com.

## resultTitle strings
- returned by api
- each string begins with a status prefix:
  - `ok|<title>`
  - `skipped|<title>`
  - `Have It|<title>`
  - `<genre>|<title>`   (rejections based on genres to avoid)
  - `msg|...` or `error|...`
- client shows them as a list of cards in the reel pane

## Key API endpoints used by the Reel client
- POST /api/startreel
  - it initializes/refreshes the Reelgood.com/new/tv html snapshot in server memory.
  - Body: { showTitles: ["title1", "title2", ...]}
    - showTitles is the list of shows you already have (your library). If a candidate Reelgood title is in showTitles, the server emits resultTitle `Have It|<title>` (and moves on). It’s meant to prevent the Reel pane from suggesting shows you already own/have locally.
  - returns a JSON array of resultTitles

- GET /api/getreel
  - getreel scans the html list of titles and builds up a batch of resultTitles until it adds an ok resultTitle (or it exhausts the html list). 
  - it returns that batch

## Client-side (Reel pane UI)
- startreel
	- the reel pane ui calls POST /api/startreel when the pane loads or when a card is showing with the message "no more titles" and the next button is clicked.
  - when startreel is called by a "no more titles" next click, then after startreel finishes the reel pane ui calls GET /api/getreel.
	- startreel returns a rolling history list of resultTitles (from server persistence) so the pane can render previous results immediately (cards you already saw).

- getreel
	- When the user clicks Next in the reel pane ui, the client calls GET /api/getreel.
	- The client displays whatever card(s) are returned by appending to the pane list of cards.
  - if no resultTitles are returned then a card is added to list that just says "no more titles"
  - the next button has a gray background from the beginning of the call until it returns

## Server-side (apps/api)

- High-level state and persistence
  - In-memory:
    - homeHtml: cached HTML of https://reelgood.com/new/tv (loaded by startReel)
    - showTitles: list of titles the user already has (sent by client)
    - oldShows: cursor map of titles already “processed” (loaded from disk)
    - resultTitles: rolling history of emitted results (loaded from disk)

  - On disk (TV_DATA_DIR/api/*):
    - reel-shows.json
      - Purpose: persistent cursor (titles already processed/seen).
      - Important rule: nothing should clear this file except maybe pruning.
    - reelgood-titles.json
      - Purpose: rolling history of emitted results so UI can render on reload.
    - misc/calls.log
      - API request logging for debug.
    - reelgood.log
      - Reelgood-specific debug logging.

## Reload on-disk state
	- The server reloads oldShows (reel-shows.json) and resultTitles (reelgood-titles.json) on app load and on /api/startreel calls. 

## /api/startreel behavior
- /api/startreel tells the server to load show titles into its memory from the html in https://reelgood.com/new/tv.
- use the curl format /root/dev/apps/tv/api/req-reelgood.txt file as template for request

- Fetch Reelgood page when and only when /api/startreel is called
  - loads html that when parsed gives list of show titles
	- Target: https://reelgood.com/new/tv

- Return rolling history
	- startReel returns resultTitles to the client so the pane can immediately show previously emitted ok/skipped/rejected cards.

How the server fetches Reelgood HTML (access layer)
- /root/dev/apps/tv/api/req-reelgood.txt is a captured browser request template in curl format. it is to be used for accessing reelgood.com pages.

- the server copies a fresh cf_clearance cookie from the "reelgood" prop in /root/dev/apps/tv/api/cookies/cf-clearance.local.json into /root/dev/apps/tv/api/req-reelgood.txt replacing the stale cf_clearance inside.

- curl uses a captured browser request template in curl format (/root/dev/apps/tv/api/req-reelgood.txt) to fetch the html at https://reelgood.com/new/tv

2) Cloudflare
	- Their is legacy code to use Playwright to load https://reelgood.com/new/tv instead of using curl. keep the unused legacy code for now.


getReel() behavior (called by /api/getreel)
1) Preconditions
	- homeHtml must exist (startReel must have run successfully).

2) Build working sets
	- haveItSet: titles the client says it already has.
	- seenInResultTitles: titles already returned historically (so we don’t spam duplicates).

3) Parse homepage into candidate shows
	- homeHtml is parsed to extract candidate {title, slug} entries.
	- The output list is treated as the “queue” for this startReel snapshot.

4) Scan candidates until an acceptable result is produced (or exhausted)
	For each candidate show from the homepage:
	a) Skip if already in oldShows (cursor).
	b) Skip if already in resultTitles history (already emitted).
	c) If slug is missing → emit `skipped|<title>` and mark oldShows[title]=true.
	d) If title is in haveItSet → emit `Have It|<title>` and mark oldShows[title]=true.
	e) Otherwise fetch the show page:
		- URL: `https://reelgood.com/show/<slug>`
		- This fetch is intentionally “fast” and typically disallows expensive Playwright work.
		- If it fails (often Cloudflare), emit `skipped|<title>` and continue scanning.
	f) If show page fetch succeeds, parse genres and reject avoidGenres:
		- If rejected: emit `<genre>|<title>` and continue.
		- If accepted: emit `ok|<title>` and return.

5) Persistence rules
	- The server writes the updated cursor (reel-shows.json) to remember what it processed.
	- The server appends non-error results to reelgood-titles.json so the pane can re-render
	  results on reload.

What the Reel pane displays
- Each returned string is rendered as a card.
- `ok|...` means accepted title.
- `skipped|...` means the server intentionally skipped (missing slug, show page fetch failed, etc.).
- `Have It|...` means rejected because it’s already in the user’s library.
- `<genre>|...` means rejected due to an avoidGenre match.
- `msg|...` / `error|...` are status messages.

Where this runs (important)
- The server apps run on the remote server (hahnca.com) under pm2.
- TV_DATA_DIR on remote determines where reel-shows.json and cookie files live.

