# Torrent Subtitle Count Plan

## Scope

This plan describes how to implement `Chk Subs` in the tor pane without changing behavior outside that feature.

Primary anchors already present:

- Client tor pane UI and card layout: `/root/apps/tv/apps/client/src/components/tor.vue`
- Shared season/episode parsing: `/root/apps/tv/packages/share/src/index.js`
- Existing `.torrent` file listing route: `/root/apps/tv/apps/api/src/server.js` and `/root/apps/tv/apps/api/src/download.js`
- Existing OpenSubtitles search path: `/root/apps/tv/apps/srvr/index.js` and `/root/apps/tv/apps/client/src/srvr.js`

## Current facts from the code

1. The tor pane already has the visual slot where the new button belongs. In `/root/apps/tv/apps/client/src/components/tor.vue`, the buttons currently render `First`, then a button labeled `Bad Grp`, then `Force`.
2. The current `Bad Grp` button is wired to `torChkSubClick`, but that method actually toggles the selected release group in `badGroups.txt`. The method name is incorrect and should be renamed as part of this work.
3. Torrent file enumeration already exists. `filesClick()` posts the selected torrent object to `/api/tor/files`, and the API fetches the `.torrent` and returns decoded file paths and sizes.
4. `parseFileSeasonEpisode()` already exists in `/root/apps/tv/packages/share/src/index.js` and is the correct parser to use for matching subtitle sidecars to episode video files.
5. Existing OpenSubtitles search is split two ways:
   - `searchOpn(videoPaths)` in the client calls `/api/opn/search`, but that endpoint assumes real local media paths, not files listed inside an unfetched torrent.
   - Lower-level `subsSearch()` in the server can search by `imdb_id` or `query` plus `season` and `episode`, which is the reusable primitive for torrent-file-only counting.

## Proposed implementation

### 1. Client UI changes in tor pane

File: `/root/apps/tv/apps/client/src/components/tor.vue`

1. Insert a new `Chk Subs` button between the existing `First` and `Bad Grp` buttons.
2. Rename the incorrect bad-group click path so names match behavior. Current recommendation:
   - rename the existing bad-group implementation from `torChkSubClick()` to `torBadGrpClick()`
   - wire the `Bad Grp` button to `torBadGrpClick()`
   - reserve `torChkSubClick()` for the new subtitle-count action
3. Add per-torrent reactive state to hold the rendered subtitle-count message and a pane-level toggle flag, for example:
   - `torSubCountsVisible`
   - `torSubCountBusy`
   - `torSubCountByKey` or equivalent keyed by torrent identity
4. Render `Subs: <minEmbCount>, <minSrtCount>, <minOpnCount>` on the second line of each selected torrent card, positioned to the right of the existing info row.
5. Do not add any tooltip for `Chk Subs`.
6. On second click, clear only the subtitle-count display state and leave selection, torrent results, and bad-group state unchanged.

### 2. Reuse or extend torrent file inspection on the server

Files:

- `/root/apps/tv/apps/api/src/server.js`
- `/root/apps/tv/apps/api/src/download.js`

1. Reuse the existing `fetchTorrentFile(torrent)` and `extractTorrentFileDetails(torrentData)` path rather than inventing a second torrent-download flow.
2. Add a new API endpoint dedicated to subtitle counting for a selected torrent, instead of overloading `/api/tor/files`.
3. Endpoint input should be the selected torrent object plus enough show context to drive OpenSubtitles lookup if the torrent metadata is incomplete.
4. Endpoint output should be one aggregate record per torrent:
   - `minEmbCount`
   - `minSrtCount`
   - `minOpnCount`
   - `message` when there are no video files
   - optionally `perVideo` diagnostics while the feature is being debugged
5. The endpoint should perform all counting server-side so the client only toggles display and does not fan out many separate requests.

### 3. Video-file walk and min-count aggregation

Server-side algorithm for one selected torrent:

1. Initialize:
   - `minEmbCount = Number.MAX_SAFE_INTEGER`
   - `minSrtCount = Number.MAX_SAFE_INTEGER`
   - `minOpnCount = Number.MAX_SAFE_INTEGER`
2. Decode the torrent and collect all non-DVD file paths already exposed by `extractTorrentFileDetails()`.
3. Filter to video files only.
4. For each video file:
   - initialize `embCount = 0`, `srtCount = 0`, `opnCount = 0`
   - derive season/episode from the video path and basename
   - scan all non-video files in the torrent as candidate subtitle sidecars
   - update the three counters
   - reduce into mins with `Math.min(...)`
5. If the torrent has no video files, do not leave the mins at `Number.MAX_SAFE_INTEGER`; return a display message of exactly `No video files` instead of a count string.

### 4. External subtitle sidecar counting from torrent contents

Server-side rules:

1. Treat common sidecar subtitle extensions as candidates: `.srt`, `.ass`, `.ssa`, `.sub`, `.idx`, and any other extensions the repo already recognizes elsewhere.
2. For each candidate sidecar path:
   - parse season/episode from the sidecar file name using `parseFileSeasonEpisode()` from `/root/apps/tv/packages/share/src/index.js`
   - compare to the current video file's parsed season/episode
   - increment `srtCount` only when the parsed episode matches the current video file
3. Prefer matching against the subtitle basename, not just folder proximity, because a season pack may contain multiple episodes plus a shared `Subs/` directory.
4. If the subtitle file cannot be parsed to a specific episode, ignore it and do not add to `srtCount`.
5. If the subtitle file parses but does not match the current video file, ignore it and do not add to `srtCount`.

### 5. OpenSubtitles counting for torrent episodes

Best implementation path is server-side in `/root/apps/tv/apps/srvr/index.js`, reusing `subsSearch()` directly.

1. Do not use the current `/api/opn/search` route for this feature because it expects real local file paths under `/mnt/media/...`.
2. Add a new server helper that accepts logical episode search inputs instead of video paths:
   - `showName`
   - `imdbId` when available
   - `season`
   - `episode`
   - optional `year`
3. For each parsed video file in the torrent:
   - resolve the show context from the current tor-pane show if available
   - use `imdbId` when present, otherwise fall back to title/query search
   - call `subsSearch()` with `imdb_id` or `query`, plus `season` and `episode`
   - count returned entries without downloading them
4. Set `opnCount` to the number of candidate subtitle entries returned for that specific episode.
5. Reduce `minOpnCount` across all video files in the selected torrent.

### 6. Embedded subtitle counting

Embedded counting stays intentionally conservative.

Requested rule:

1. Look for embedded subtitle text tracks, probably `Text #1`, `Text #2`, etc. in `.nfo`
2. Add 1 to `embCount` for each track found

Practical implementation options:

1. Do not add new provider-specific scraping that requires reading web pages.
2. If the provider only gives the `.torrent` file, embedded subtitle count is not derivable before download because the `.torrent` contains file names and sizes, not the contents of included `.nfo` files and not the media container track table.
3. In that case, count embedded subtitles as `0`.

Recommendation:

Implement sidecar and OpenSubtitles counts first as phase 1, and keep embedded count at `0` unless there is already a non-web-page way to derive it.

### 7. Card rendering details

File: `/root/apps/tv/apps/client/src/components/tor.vue`

1. Keep the existing first metadata line unchanged.
2. Add a second compact line aligned to the right of the existing info list area.
3. Show the message only for torrents that were part of the last `Chk Subs` run and only while the subtitle-count toggle is on.
4. If the request processes multiple selected torrents, each selected card gets its own aggregate `Subs: emb, srt, opn` message.
5. Non-selected cards should not show stale counts after a rerun on a different selection.
6. If a torrent has no video files, render `No video files` in the same display area instead of `Subs: ...`.

### 8. Non-UI extras to keep from the suggestion list

1. Add optional debug payload per video file during initial rollout so mismatches in season/episode parsing and `Subs/` matching can be diagnosed quickly.
2. Cache subtitle-count results by torrent identity during the pane session so toggling the display back on does not repeat network-heavy OpenSubtitles searches unless the selection changed.
3. Ignore Android for this feature.

## Concrete implementation sequence

1. Rename the current bad-group click path in the tor pane so `torChkSubClick()` can become the subtitle-count action without breaking `Bad Grp`.
2. Add subtitle-count display state in the tor pane and wire the new `Chk Subs` button to a toggle handler.
3. Add a new API route in `apps/api` that fetches the `.torrent`, enumerates files, and computes sidecar subtitle counts per video file.
4. Add or expose a new `apps/srvr` helper that counts OpenSubtitles results by `show + season + episode` instead of by local video path.
5. Integrate the API route with the client so one click computes counts for all selected torrents and session-cache the results by torrent identity.
6. Keep embedded counts at `0` unless they can be derived without new web-page scraping.
7. Render either the aggregate counts or `No video files` on the card second line and make the button toggle them off cleanly.
8. Add optional debug payload as a rollout aid.
9. Validate with selected single-episode torrents, season packs, torrents containing `Subs/` folders, torrents with ambiguous sidecars, and torrents with no video files.

## Ambiguities, contradictions, and impossibilities

1. Embedded subtitle tracks cannot be derived from the `.torrent` file alone. The plan resolves this by counting them as `0` when they cannot be derived.
2. The request mentions `.nfo`, but the plan explicitly avoids adding new provider-specific scraping that reads web pages.
3. When a torrent has no video files, the plan resolves the undefined max-number case by displaying `No video files`.
4. Sidecar files that do not parse to a specific episode are ignored and do not add to the count.
5. Sidecar files that parse but do not match the current episode are also ignored and do not add to the count.
6. The current client method name `torChkSubClick()` already implements `Bad Grp`, so the plan includes a required rename to `torBadGrpClick()` or equivalent.
7. The existing `/api/opn/search` route is intentionally not used.
8. Android is out of scope for this feature.

## Suggestions

1. Treat `srt` and `opn` counts as phase 1 and keep `emb` at `0` unless there is already a non-web-page derivation path.
2. Add optional debug payload per video file during initial rollout so mismatches in season/episode parsing and `Subs/` matching can be diagnosed quickly.
3. Cache subtitle-count results by torrent identity during the pane session so toggling the display back on does not repeat network-heavy OpenSubtitles searches unless the selection changed.
4. Make the server return an explicit non-count state for `No video files` so the client does not infer that from sentinel values.
