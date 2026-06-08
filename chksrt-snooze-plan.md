# Plan: Chksrt Snooze for Delayed OpenSubtitles Availability

## Goal

When a newly downloaded Flex episode reaches the chksrt video pane before OpenSubtitles has published usable `.opn*.srt` files, let the user defer that file without saving a subtitle choice. Later, during the normal background TVDB refresh for that show, re-check the snoozed files for OpenSubtitles sidecars and then move them back into the chksrt queue.

## Current Behavior

### Normal queue flow today

1. Server-side subtitle scan in `apps/srvr/index.js` runs from `perShowCallback` during the TVDB refresh cycle.
2. Eligible video files are added to `subQueueChkSrt` through `enqueueSubQueueChkSrt(...)`.
3. The client opens the first queued file with `GET /api/asr/chksrt/list`, which returns only the head item.
4. In the chksrt video pane, the user can currently:
   - `OK` via `POST /api/asr/chksrt/ok`
   - `GenSrt` via `POST /api/asr/chksrt/gensrt`
   - `Save` via `clickChksrtNext()` which calls `_submitChksrtSelection()` and then advances to the next queued file
5. `Save` either:
   - persists the selected `.srt` choice with `POST /api/asr/chksrt/select`, or
   - falls back to `chksrtOk(...)` if there is no active subtitle selection.

### Relevant existing OpenSubtitles background path

- `perShowCallback` already ends with `await checkAndDownloadOpnSrt(showName, tvdbRecord)`.
- That background path already knows how to search OpenSubtitles and write `.opnXXXXX.srt` sidecars.
- Today it chooses from general eligible episodes for the show; it is not driven by a user-managed snooze list.

## Proposed Behavior

### UI behavior

Add a `Snooze` button in the chksrt video pane to the left of `Save`.

When `Snooze` is clicked:

1. Do not save any chksrt result.
2. Do not write chksrt history for this file.
3. Remove the current file from the active chksrt queue.
4. Add the file to `chksrt-snoozed.json` under the current show name, unless it is already present there.
5. Immediately load the next file in the chksrt queue, using the same current `handleChksrtNext()` flow.

### Background behavior

During the per-show TVDB refresh callback:

1. Look up `chksrt-snoozed.json[showName]`.
2. If no array exists or it is empty, do nothing.
3. For each snoozed file in that show’s array:
   - verify the file still exists
   - check OpenSubtitles for that specific file’s episode
   - download and write `.opnXXXXX.srt` sidecars when available
4. After checking that file, remove it from `chksrt-snoozed.json` and enqueue it back into the chksrt queue.
5. Re-queue it even if no OpenSubtitles subtitle was downloaded, per the requirement.

## Data Model

### New file

`chksrt-snoozed.json`

### Shape

```json
{
  "Show Name": [
    "/mnt/media/tv/Show Name/Season 01/Show Name S01E01.mkv"
  ],
  "Good Cop/Bad Cop": [
    "/mnt/media/tv/Good Cop/Bad Cop/Season 01/Good Cop Bad Cop S01E02.mkv"
  ]
}
```

### Key choice

Use the canonical show key derived from `showNameFromFilePath(videoPath)`, not a raw folder-name slice. That matches the existing server logic and supports shows whose TVDB key contains `/`.

## Server Change Plan

### `apps/srvr/index.js`

Add a new persistence path and in-memory store near the existing queue/history state:

- `CHKSRT_SNOOZED_PATH`
- `let chksrtSnoozed = {}`
- `loadChksrtSnoozed()`
- `persistChksrtSnoozed()`

Use the same defensive pattern already used for `loadChksrtHistory()` and `loadOpnCheckHistory()`:

- if file missing or invalid, default to `{}`
- require object-at-top-level, not array

### New helper functions

Add small helpers to keep behavior consistent and deduplicated:

- `addToChksrtSnoozed(showName, videoFilePath)`
- `removeFromChksrtSnoozed(showName, videoFilePath)`
- `getChksrtSnoozedForShow(showName)`
- optionally `pruneMissingChksrtSnoozedFiles(showName)`

Rules:

- no duplicate file path within a show array
- delete the show key when its array becomes empty
- if a snoozed file is re-queued, remove it from snoozed before or at the same time as queue insertion

### New API endpoint

Add a dedicated chksrt snooze endpoint rather than overloading `select` or `ok`:

- `POST /api/asr/chksrt/snooze`

Input:

```json
{ "videoPath": "/mnt/media/tv/.../Episode.mkv" }
```

Endpoint behavior:

1. Validate `videoPath`.
2. Derive `showName` with `showNameFromFilePath(videoPath)`.
3. Remove that file from `subQueueChkSrt` if present.
4. Add the file to `chksrtSnoozed[showName]` if not already present.
5. Persist both queue and snoozed state.
6. Notify clients with updated `chksrt-count`.
7. Return `{ ok: true }`.

A dedicated endpoint is cleaner because snooze is neither:

- accepting the current subtitle state, nor
- generating ASR, nor
- making a terminal selection decision.

### Queue interactions

Keep the current client-side “advance to next head item” behavior unchanged.

The snooze endpoint should not try to return the next item itself. The client can continue to call `getChksrtList()` after success, just as it already does after `OK`, `GenSrt`, and `Save`.

### Background refresh integration

Extend the existing per-show background OpenSubtitles pass instead of adding a separate scheduler.

Preferred approach:

1. After `checkAndDownloadOpnSrt(showName, tvdbRecord)` or within a nearby adjacent helper, process snoozed files for that same `showName`.
2. For each snoozed file:
   - parse season/episode from the file path
   - verify the file is still on disk
   - run the OpenSubtitles search/download flow targeted to that file
   - re-enqueue into `subQueueChkSrt`
   - remove from snoozed
3. Persist queue and snoozed state once after the batch, not on every item, when practical.

## OpenSubtitles Check Strategy for Snoozed Files

The requirement is file-based, not general-show-based. The snoozed pass should therefore prioritize exact snoozed files over the existing “oldest eligible unwatched episode” selection logic.

Recommended implementation shape:

- factor the existing OpenSubtitles background logic into a reusable helper that can operate on a specific `videoFilePath`
- reuse the current OpenSubtitles helpers already present in `apps/srvr/index.js`:
  - `subsSearch(...)`
  - `openSubtitlesDownloadWithRetry(...)`
  - `encodeFileIdBase32(...)`
  - `stripSrtFormatting(...)`
  - `logSubtitle(...)`

This avoids creating two nearly identical OpenSubtitles download paths.

## Client Change Plan

### `apps/client/src/components/video-player.vue`

Add a `Snooze` button to the left of `Save` in chksrt mode.

Add client method:

- `clickChksrtSnooze()`

Behavior:

1. Call new client API wrapper for `/api/asr/chksrt/snooze`.
2. Do not call `_submitChksrtSelection()`.
3. Do not call `_saveChksrtHistory(...)`.
4. Emit `chksrt-next` so the parent loads the next queued file.

### `apps/client/src/srvr.js`

Add wrapper:

```js
export function chksrtSnooze(videoPath) {
  return httpCall("/api/asr/chksrt/snooze", { videoPath }, "POST");
}
```

### `apps/client/src/components/App.vue`

No architectural change should be needed if the video player emits the existing `chksrt-next` event after snoozing.

## Exact Control Flow After Snooze

1. User clicks `Snooze` in chksrt video pane.
2. Client calls `POST /api/asr/chksrt/snooze`.
3. Server removes file from `subQueueChkSrt`, adds it to `chksrtSnoozed[showName]`, persists, and updates chksrt count.
4. Client emits `chksrt-next`.
5. Parent calls `GET /api/asr/chksrt/list` and opens the next queued file.
6. Later, the TVDB background refresh for that show runs.
7. Server checks snoozed files for that show against OpenSubtitles.
8. Server writes `.opnXXXXX.srt` sidecar if found.
9. Server removes the file from `chksrt-snoozed.json` and re-adds it to `subQueueChkSrt`.
10. Client eventually sees the file again in the chksrt queue with any new OpenSubtitles choices available.

## Edge Cases

### Missing file on disk

If a snoozed file no longer exists when the background check runs:

- remove it from `chksrt-snoozed.json`
- do not enqueue it back into chksrt

Otherwise stale deleted files will loop forever.

### Duplicate queue entry

If the file is already back in `subQueueChkSrt` when processing snoozed entries:

- remove it from snoozed
- do not enqueue a duplicate

### Duplicate snooze click

If the file is already snoozed:

- keep a single entry
- still remove it from the live queue if it is somehow still present

### OpenSubtitles returns no results

Still remove from snoozed and add back to chksrt queue, per the requirement.

### OpenSubtitles/API failure

This is ambiguous. Recommended behavior:

- if the failure is a normal “no results” case, move back to chksrt
- if the failure is a transient transport/auth/rate-limit/server error, keep the file snoozed and log the error

Reason: the requirement says move it even if no subtitles downloaded, but a hard API error is different from a successful no-result search. Re-queueing immediately on API failure would often just send the user back the same bad state without having completed the intended check.

### Multiple snoozed files for one show

Process them all during that show refresh, not just one.

Reason: the snoozed list is explicitly user-selected backlog, and limiting to one per refresh may drag the feature out for no user benefit.

## Ambiguities, Contradictions, Impossibilities

### Ambiguity: what counts as “check each file for subtitles from OpenSubtitles.com”

The current background implementation appears show/episode-oriented, not file-hash-oriented. If there are multiple encodes for the same episode, OpenSubtitles search results may not be equally good for every file.

Suggestion:

- keep using the current season/episode/imdb-driven search first
- if the existing code already has filename or hash-sensitive matching nearby, prefer that helper for snoozed files

### Ambiguity: should snoozed files move back to chksrt on API errors

The requirement says move back even if no subtitles downloaded, but it does not distinguish between:

- a valid zero-result search, and
- a failed search due to auth, quota, or network problems

Recommended policy:

- move back on zero-result
- keep snoozed on transport/auth/rate-limit failure
- log enough detail to inspect the failure

### Ambiguity: should background processing preserve snooze until a real `.opn*.srt` appears

Your requested behavior says to move the file back even if no subtitles downloaded. That means a single snooze gives the file only one delayed retry window. If OpenSubtitles still does not have subtitles at the next show refresh, the file returns to normal chksrt immediately.

Suggestion:

- consider whether you instead want “Snooze until first retry completes” or “Snooze until an `.opn*.srt` appears”
- your current requirement clearly specifies the first interpretation

### Contradiction risk: show key vs folder key

The new snoozed object is keyed by show name, but not all folder names are guaranteed to equal the TVDB show key. This repo already handles slash-containing names and collisions via `showNameFromFilePath(...)` and sometimes `tvdbRecord.path`.

Resolution:

- key `chksrt-snoozed.json` by canonical show name from `showNameFromFilePath(...)`

### Contradiction risk: “no changes other than writing plan” vs implementation details

No code changes are being made now. This document only maps the implementation.

### Impossibility: exact `.opnABCDE.srt` naming in the requirement

The repo currently writes `.opnXXXXX.srt` names derived from OpenSubtitles file ids using existing helper logic. The exact letter count is implementation-specific and should continue to use the existing naming helper rather than hard-coding `ABCDE`.

## Suggestions

1. Reuse the current `handleChksrtNext()` client behavior unchanged so the new feature stays additive and low-risk.
2. Keep snoozed-file processing adjacent to `perShowCallback` rather than creating a second timer or queue; that matches the current architecture.
3. Separate “no result” from “request failed” in logging and behavior, otherwise this feature will be hard to debug.
4. Add a small subtitle log prefix such as `opn-snooze:` so snoozed retries can be distinguished from the general background OpenSubtitles pass.
5. Consider exposing snoozed count later in the UI only if needed; it is not necessary for the first implementation.

## Minimal Implementation Order

1. Add `chksrt-snoozed.json` persistence and helpers in `apps/srvr/index.js`.
2. Add `POST /api/asr/chksrt/snooze`.
3. Add `chksrtSnooze(...)` in `apps/client/src/srvr.js`.
4. Add `Snooze` button and `clickChksrtSnooze()` in `apps/client/src/components/video-player.vue`.
5. Extend the per-show background OpenSubtitles pass to process snoozed files for the current show.
6. Validate with a manually snoozed file from a recent Flex download.
