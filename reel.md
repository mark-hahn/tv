
## REELGOOD specs: END-TO-END FLOW (CLIENT → API → SERVER -> REELGOOD)

# reelgood.js source file to be edited

- the file /root/apps/tv/apps/api/src/reelgood.js is an api server that gets selected titles from reelgood.com and provides them to the client.  that code is in a messy state with a lot of uneeded logic and needs to be cleaned up to match the specs in this document.

# the client 

- the client is a vite vue app that runs in the browser. it is tested by running vite vue in the wsl project at local /root/apps/tv/apps/client. in production it is hosted at the remote /root/dev/apps/tv-series-client and runs in pm2.

- in the client The Reel pane is a UI that shows a list of “cards” representing show titles from reelgood.com via the api server.

## resultTitle string
- returned from api calls from the client

- each resultTitle string begins with a status prefix:
  - `ok|<title>`
  - `skipped|<title>`
  - `Have It|<title>`
  - `<genre>|<title>`   (rejections based on genres to avoid)
  - `msg|...` or `error|...`

- client shows them as a list of cards in the reel pane

## API endpoints used by the Reel client
- POST /api/startreel

  - it initializes/refreshes the html stored in server memory by calling getReelHtml() in apps/api/src/get-reel-html.js.

  - the html is parsed to get a list of candidate titles.

  - Post Body is { showTitles: ["title1", "title2", ...]}
    - showTitles is the list of shows already in an external library. If a candidate is in showTitles, the server emits resultTitle `Have It|<title>` (and moves on).

  - returns a JSON array of resultTitles rolling history cached in memory.

- GET /api/getreel
  - getreel scans the html list of titles and builds up a list of resultTitles until it adds an ok resultTitle (or it exhausts the html list). 
  - it returns that list as an array of resultTitles
  - it adds the list to the resultTitles rolling history

## Client-side Reel pane calls

- startreel
  - the reel pane ui calls POST /api/startreel when the pane loads or when a card is showing with the message "no more titles" and the next button is clicked.

  - when startreel is called by a "no more titles" next click, then after the startreel call finishes the reel pane calls GET /api/getreel.

  - startreel returns a rolling history list of resultTitles (from server persistence) so the pane can render previous results immediately (cards already shown).

- getreel
	- When the user clicks Next in the reel pane ui the client calls GET /api/getreel.

	- The client displays whatever resultTitles are returned by appending them to the pane list of cards.

  - if no resultTitles are returned then a card is added to list that just says No More Titles".

  - the next button has a gray background from the beginning of the call until it the call finishes.

## Server-side (apps/api)

- High-level state and persistence
  - In-memory:
    - homeHtml: cached HTML of https://reelgood.com/new/tv (loaded by startReel)

    - showTitles: list of titles the user already has (from client startReel call)

    - reelShows: cursor map of titles already sent (loaded from disk and flushed on every modification). never cleared except for possible pruning.

    - resultTitles: rolling history of emitted results (loaded from disk and flushed on every modification)

  - On remote disk:
    - /root/dev/apps/tv/data/api/reel-shows.json
      - Purpose: persistent cursor (titles already processed/seen).

      - nothing should clear this file except maybe pruning.

    - /root/dev/apps/tv/data/api/reelgood-titles.json
      - Purpose: rolling history of emitted results so UI can render on reload.

    - /root/dev/apps/tv/data/api/misc/calls.log
      - API call logging for debug.

    - /root/dev/apps/tv/api/reelgood.log
      - Reelgood-specific debug logging.

## Reload on-disk state
	- The server reloads reelShows (reel-shows.json) and resultTitles (reelgood-titles.json) on app load and on /api/startreel calls. 

## /api/startreel behavior
- /api/startreel tells the server to load show titles into its memory from the html in https://reelgood.com/new/tv.

- Build working sets
	- haveItSet: titles the client says it already has, comes from startreel call.
	- seenInResultTitles: titles already returned historically (so we don’t spam duplicates).

- Fetch Reelgood page when and only when /api/startreel is called
  - loads html that when parsed gives list of show titles
  - Parse homepage into candidate shows
    - homeHtml is parsed to extract candidate {title, slug} entries.
    - The output list is treated as the “queue” for this startReel snapshot.

- Return rolling history
	- startReel returns resultTitles to the client so the pane can immediately show previously emitted ok/skipped/rejected cards.

- there is unused legacy code to use Playwright to load https://reelgood.com/new/tv. that should be replaced with getReelHtml() call.

## api/getreel behavior
- Preconditions
	- homeHtml must exist (startReel must have run successfully).

- Scan candidates until an acceptable ok result is produced (or exhausted)
- For each candidate from the homepage:
  - conditions to ignore candidate
    - ignore if already in reelShows
    - ignore if already in resultTitles history (recently emitted).
  - If slug is missing → emit `skipped|<title>` 
	- If title is in haveItSet → emit `Have It|<title>` 
	- Otherwise fetch the show page:
		- URL: `https://reelgood.com/show/<slug>`
		- This fetch is intentionally “fast”
		- If it fails emit `Fetch Error|<title> <error msg>` 
	- If show page fetch succeeds, parse genres and reject avoidGenres:
		- If rejected: emit `<genre>|<title>` and continue.
		- If accepted: emit `ok|<title>` and return.
- always mark titles not ignored with reelShows[title]= true (and flush reelShows) after processing candidate title

5) Persistence rules
	- The server writes the updated cursor (reel-shows.json) on each modification to remember what it processed.
	- The server appends all emitted resultTitles to reelgood-titles.json so the pane can re-render
	  results on reload.
