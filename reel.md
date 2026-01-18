
# REELGOOD specs: END-TO-END FLOW (CLIENT → API → REELGOOD)

# client and server environments

- the client is a vite vue app that runs in the browser. it is tested by running vite vue in the wsl project at local /root/apps/tv/apps/client. it is hosted at the remote server in /root/dev/apps/tv-series-client.

- the remote server has three directories that have api servers running in pm2. they are /root/dev/apps/tv/api, /root/dev/apps/tv/down, and /root/dev/apps/tv/srvr. the server dirs contain copies of the projects in local /root/apps/tv/apps.

## Reel Overview

- The Reel pane is a UI that shows a stream of “cards” representing show titles from reelgood.com.

- The client gets show titles from the /root/dev/apps/tv/api API server. 

- The /root/dev/apps/tv/api API fetches show titles from reelgood.com.

## resultTitle strings
- returned by api

- each resultTitle string begins with a status prefix:
  - `ok|<title>`
  - `skipped|<title>`
  - `Have It|<title>`
  - `<genre>|<title>`   (rejections based on genres to avoid)
  - `msg|...` or `error|...`

- client shows them as a list of cards in the reel pane

## API endpoints used by the Reel client
- POST /api/startreel
  - it initializes/refreshes the Reelgood.com/new/tv html snapshot in server memory.
  - Post Body is { showTitles: ["title1", "title2", ...]}
    - showTitles is the list of shows you already have (your library). If a candidate Reelgood title is in showTitles, the server emits resultTitle `Have It|<title>` (and moves on). It’s meant to prevent the Reel pane from suggesting shows you already own/have.
  - returns a JSON array rolling history list of resultTitles

- GET /api/getreel
  - getreel scans the html list of titles and builds up a list of resultTitles until it adds an ok resultTitle (or it exhausts the html list). 
  - it returns that list as an array of resultTitles

## Client-side Reel pane calls
- startreel
  - the reel pane ui calls POST /api/startreel when the pane loads or when a card is showing with the message "no more titles" and the next button is clicked.
  - when startreel is called by a "no more titles" next click, then after startreel call finishes the reel pane ui calls GET /api/getreel.
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
    - showTitles: list of titles the user already has (from client startReel call)
    - oldShows: cursor map of titles already sent (loaded from disk)
    - resultTitles: rolling history of emitted results (loaded from disk)

  - On remote disk:
    - /root/dev/apps/tv/data/api/reel-shows.json
      - Purpose: persistent cursor (titles already processed/seen).
      - Important rule: nothing should clear this file except maybe pruning.
    - /root/dev/apps/tv/data/api/reelgood-titles.json
      - Purpose: rolling history of emitted results so UI can render on reload.
    - /root/dev/apps/tv/data/api/misc/calls.log
      - API call logging for debug.
    - /root/dev/apps/tv/api/reelgood.log
      - Reelgood-specific debug logging.

## Reload on-disk state
	- The server reloads oldShows (reel-shows.json) and resultTitles (reelgood-titles.json) on app load and on /api/startreel calls. 

## /api/startreel behavior
- /api/startreel tells the server to load show titles into its memory from the html in https://reelgood.com/new/tv.

- Build working sets
	- haveItSet: titles the client says it already has.
	- seenInResultTitles: titles already returned historically (so we don’t spam duplicates).

- Fetch Reelgood page when and only when /api/startreel is called
  - loads html that when parsed gives list of show titles
	- Target: https://reelgood.com/new/tv
  - use the curl format /root/dev/apps/tv/api/req-reelgood.txt file as template for request
  - Parse homepage into candidate shows
    - homeHtml is parsed to extract candidate {title, slug} entries.
    - The output list is treated as the “queue” for this startReel snapshot.

- Return rolling history
	- startReel returns resultTitles to the client so the pane can immediately show previously emitted ok/skipped/rejected cards.

- there is unused legacy code to use Playwright to load https://reelgood.com/new/tv instead of using curl. keep the unused legacy code for now.

## api/getreel behavior
- Preconditions
	- homeHtml must exist (startReel must have run successfully).

- Scan candidates until an acceptable result is produced (or exhausted)
- For each candidate show from the homepage:
  - conditions to ignore candidate
    - ignore if already in oldShows (cursor).
    - ignore if already in resultTitles history (already emitted).
  - If slug is missing → emit `skipped|<title>` 
	- If title is in haveItSet → emit `Have It|<title>` 
	- Otherwise fetch the show page:
		- URL: `https://reelgood.com/show/<slug>`
		- This fetch is intentionally “fast”
		- If it fails emit `Fetch Error|<title> <error msg>` 
	- If show page fetch succeeds, parse genres and reject avoidGenres:
		- If rejected: emit `<genre>|<title>` and continue.
		- If accepted: emit `ok|<title>` and return.
- always mark titles not ignored with oldShows[title]=true after processing candidate title

5) Persistence rules
	- The server writes the updated cursor (reel-shows.json) on each modification to remember what it processed.
	- The server appends all emitted resultTitles to reelgood-titles.json so the pane can re-render
	  results on reload.

What the Reel pane displays
- Each returned string is rendered as a card.
- `ok|...` means accepted title.
- `skipped|...` means the server intentionally skipped (missing slug, show page fetch failed, etc.).
- `Have It|...` means rejected because it’s already in the user’s library.
- `<genre>|...` means rejected due to an avoidGenre match.
- `msg|...` / `error|...` are status messages.
