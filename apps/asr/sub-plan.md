# Sub-Plan: Subtitle Processing Simplification

## Architecture Overview

The new system replaces file-based queues (`pending.txt`, `emb-pending.txt`, `needsSrtChk.txt`, `forced-pending.txt`) with three in-memory arrays and timer-driven background loops.

**Critical architectural note:** `srvr/index.js` (pm2: `tv-srvr`) and `asr/asr.js` (pm2: `tv-asr-bkgnd`) are separate processes. The new in-memory queues cannot be shared between them. All queue logic—including `generateSrtWithAsr`—must live in a single process. The most natural home is `srvr/index.js` since it already has chokidar, tvdb hooks, OpenSubtitles (`subsSearch`/`applySubFiles`), and the HTTP/WS layer. The `asr.js` process can be retained for command-line single-file invocation, but the background ASR loop would move to `srvr`.

---

## New In-Memory State (in srvr/index.js)

```js
const subQueue = []; // { videoFilePath, fromUI }
const subQueueChkSrt = []; // { videoFilePath, fromUI }
const subQueueGenSrt = []; // { videoFilePath, fromUI }
let subQueueBusy = false;
let chkSubQueueDelay = 10_000;
let chkGenSrtDelay = 10_000;
let genSrtRunning = false;
```

---

## New Functions

### `fileNeedsSubChecked(videoFilePath, showName)`

- Located in `srvr/index.js`
- Derive `showName` from top folder of path if not supplied
- Check conditions in order, return false immediately on fail:
  1. Not already in `subQueue`, `subQueueChkSrt`, or `subQueueGenSrt`
  2. No sidecar with suffix `.enx.srt`, `.enx.srtstub`, or `.en<digit(s)>.srt`
  3. Episode is not watched and not unaired — look up via series map using `parseFileSeasonEpisode`
- Return true only when all pass

### `generateEmbSrts(videoFilePath, showname, season, episode, fromUI)`

- Located in `srvr/index.js`
- Derive `showname`, `season`, `episode` from path via `parseFileSeasonEpisode` if missing
- Run ffprobe to find embedded english text subtitle streams (same logic as existing chokidar check, but full streams not just `any subtitle`)
- For each qualifying stream extract to `base.en<idx>.srt` beside the video file (don't overwrite existing)
- Log each created file to `subtitle.log`
- If `fromUI`, also send event to emb pane WebSocket channel (same as existing emb pane logging)
- This replaces `extractTextSubtitles()` for the background path; `extractTextSubtitles` is retained for `processOneVideo` (command-line use)

### `applyOpenSubSrts(videoFilePath, showname, season, episode)`

- Located in `srvr/index.js`
- Derive `showname`, `season`, `episode` from path if missing
- Look up `imdb_id` from tvdb record by showname (**not in instructions — see questions**)
- Call `subsSearch({ imdb_id, season, episode, language: 'en' })` (existing function)
- Download each result and save as `base.#<id>.srt` beside video file (don't overwrite existing)
- Log each created file to `subtitle.log`
- This replaces `applySubFiles()`

### `generateSrtWithAsr(videoFilePath, fromUI)`

- Located in `srvr/index.js`
- Check if `base.enx.srt` already exists; if so log to `subtitle.log` and return
- Set `genSrtRunning = true`
- Log start to `subtitle.log`
- Call the Mistral ASR pipeline (currently in `processOneVideo` in `asr.js`) — this code must either be imported/moved or called via child_process
- If `fromUI`, send ASR progress events to asr pane WebSocket channel (same as existing)
- Clear `genSrtRunning` when done (in finally block)

### `doSubQueueNow()`

- Set `chkSubQueueDelay = 500`
- If `!subQueueBusy`: run `processSubQueueEntry()` immediately
- If `subQueueBusy`: start polling every 1 sec until `!subQueueBusy`, then run

### `doSubQueueGenSrtNow()`

- Set `chkGenSrtDelay = 500`
- Trigger immediate check of `subQueueGenSrt`

### `processSubQueueEntry()` (internal, called by background loop)

- Pop top of `subQueue`
- Set `subQueueBusy = true`
- `await generateEmbSrts(...)` then `await sleep(1000)`
- `await applyOpenSubSrts(...)` then `await sleep(1000)`
- Check if sidecar now exists (`.enx.srt`, `.enx.srtstub`, `.en<n>.srt`)
  - No sidecar → unshift to `subQueueGenSrt`, call `doSubQueueGenSrtNow()`
  - Has sidecar → push to `subQueueChkSrt`
- Set `subQueueBusy = false`, `chkSubQueueDelay = 500`

---

## Background Loops (both in srvr/index.js)

### subQueue loop

```
start chkSubQueueDelay = 10_000, subQueueBusy = false
loop:
  if subQueue is empty → chkSubQueueDelay = 10_000
  else → processSubQueueEntry()
  setTimeout(loop, chkSubQueueDelay)
```

### subQueueGenSrt loop

```
start chkGenSrtDelay = 10_000, genSrtRunning = false
loop:
  if !genSrtRunning and subQueueGenSrt not empty:
    if chkGenSrtDelay === 10_000 and cpu loadavg[0] > 2 → skip
    else → start generateSrtWithAsr(subQueueGenSrt.shift()) [don't await — runs async]
    chkGenSrtDelay = 500
  if subQueueGenSrt is empty → chkGenSrtDelay = 10_000
  setTimeout(loop, chkGenSrtDelay)
```

---

## Queue Sources

| Source                      | Queue            | Position      | fromUI |
| --------------------------- | ---------------- | ------------- | ------ |
| Subs button (local pane)    | `subQueue`       | top (unshift) | true   |
| ASR button (local pane)     | `subQueueGenSrt` | top (unshift) | true   |
| chokidar video add          | `subQueue`       | top (unshift) | false  |
| tvdb update background task | `subQueue`       | end (push)    | false  |

---

## Client Changes (srvr/index.js HTTP endpoints + client/local.vue)

### New HTTP endpoints in srvr/index.js

- `POST /api/asr/subs/enqueue` — receives `{ videoPaths[], fromUI }`, adds to top of `subQueue`, calls `doSubQueueNow()`
- `POST /api/asr/gensrt/enqueue` — receives `{ videoPaths[], fromUI }`, adds to top of `subQueueGenSrt`, calls `doSubQueueGenSrtNow()`
- `POST /api/asr/emb/generate` — receives `{ videoPaths[] }`, calls `generateEmbSrts` for each with `fromUI=true`
- `GET /api/asr/chksrt/list` — returns `subQueueChkSrt` length and top entry path (replaces current file-reading implementation)
- `POST /api/asr/chksrt/gensrt` — moves top of `subQueueChkSrt` to `subQueueGenSrt`, calls `doSubQueueGenSrtNow()`

### srvr WebSocket: push `chksrt-count` to clients

- Emit whenever `subQueueChkSrt` length changes (replace the current `notifyClients("chksrt-count", readNeedsSrtChk().length)` calls)

### local.vue button changes

- **Subs button**: `POST /api/asr/subs/enqueue` with selected files
- **ASR button**: `POST /api/asr/gensrt/enqueue` with selected files
- **Emb button**: `POST /api/asr/emb/generate` with selected files

### App.vue + video-player.vue chksrt pane changes

- `clickChksrt()`: fetch top entry from `subQueueChkSrt` via `GET /api/asr/chksrt/list`, show video
- Rename "Bad" button label to "GenSrt"
- "GenSrt" button: `POST /api/asr/chksrt/gensrt`

---

## chokidar Handler Change (srvr/index.js)

Replace current logic (ffprobe → `needsSrtChk.txt` or `pending.txt` append) with:

1. Derive `showName` from path
2. Look up tvdb record; if no record or `!tvdb.inEmby` → return
3. If `fileNeedsSubChecked(filePath, showName)` → `subQueue.unshift({ videoFilePath: filePath, fromUI: false })`, call `doSubQueueNow()`
4. `tvdb.enqueueShowProcess(showName)` (keep this)

---

## tvdb Update Hook Change (srvr/src/tvdb.js perShowCallback)

In the `perShowCallback` (called from `tryLocalGetTvdb`), before the existing disk/gap checks:

1. Only if `processRecord.inEmby`
2. Scan show folder for all video files
3. For each: if `fileNeedsSubChecked(filePath, showName)` → `subQueue.push({ videoFilePath: filePath, fromUI: false })` (push to end = low priority)

---

## Log Rotation (srvr/index.js)

At 5am daily rotate `subtitle.log`:

- Move `/root/dev/apps/tv/apps/asr/data/subtitle.log` to `/root/dev/apps/tv/apps/asr/data/subtitle-logs/subtitle-MM-DD.log`
- Create new empty `subtitle.log`
- Use `node-cron` or a `setTimeout`-based scheduler

---

## Code That Will Be Dead

### In `asr/asr.js`

- `PENDING_PATH`, `FORCED_PENDING_PATH`, `NEEDS_SRT_CHK_PATH`, `EMB_PENDING_PATH` constants
- `loadNeedsSrtChkSet()`
- `appendNeedsSrtChk()`
- `consumePending()`
- `consumeForcedPending()`
- `consumeQueueFile()` (used only by consumePending/consumeForcedPending/EMB)
- `processEmbQueue()`
- `findCandidateFile()`
- `pickNextFile()`
- `runBackgroundLoop()` — entire function (asr.js no longer runs as a background loop)
- The `--background` CLI switch and `runBackground` flag
- `hasAnyUnwatchedFile()` (used only in `runBackgroundLoop`)

### In `srvr/index.js`

- `ASR_PENDING_PATH`, `ASR_FORCED_PENDING_PATH`, `EMB_PENDING_PATH`, `ASR_NEEDS_SRT_CHK_PATH` constants
- `readNeedsSrtChk()`
- `writeNeedsSrtChk()`
- `asrPendingAppend()`
- `applySubFiles()` — large function, replaced by `applyOpenSubSrts()`
- `POST /api/asr/chksrt/bad`
- `POST /api/asr/chksrt/ok`
- `GET /api/asr/chksrt/list` (replaced by new version reading from `subQueueChkSrt`)
- `POST /api/asr/emb/apply` (replaced by `POST /api/asr/emb/generate`)
- The chokidar ffprobe/`needsSrtChk`/`asrPendingAppend` block (replaced by `fileNeedsSubChecked` call)

### Queue data files (no longer written or read)

- `data/pending.txt`
- `data/forced-pending.txt`
- `data/emb-pending.txt`
- `data/needsSrtChk.txt`

---

## Functionality in Existing Codebase Not In Plan

1. **Chksrt "Ok" button** — currently creates `.enx.srtstub` sidecar and removes file from `needsSrtChk.txt`. The plan renames "Bad" to "GenSrt" but says nothing about what "Ok" does. Presumably it still creates `.enx.srtstub` and removes the file from `subQueueChkSrt`. Not specified.

2. **`processOneVideo` srtExists guard** — `processOneVideo` in `asr.js` calls `srtExists()` at top and returns early if srt exists. `generateSrtWithAsr` also does this check. If ASR is moved to srvr, this guard needs to be preserved in the new location.

3. **`waitForLowCpu()` in asr.js** — the plan's `subQueueGenSrt` loop only skips when `chkGenSrtDelay === 10_000 && cpu > 2`. The existing code actively waits (polls until cpu drops) before running ASR. The new approach just skips the current check and retries in 10s, which means ASR could be delayed indefinitely under sustained load without ever waiting. This is a behavioral change.

4. **`BKGND_LOG_PATH` / bkgnd log** — the existing asr background loop writes to `tv.log` (separate from `subtitle.log`). This goes away with the loop.

5. **`extractTextSubtitles` in asr.js** — used by `processOneVideo` for command-line mode. The plan's `generateEmbSrts` is a parallel implementation in srvr. The asr.js version will still be needed for CLI use but becomes divergent.

6. **choksrt Notification** — `fetchChksrtCount` in App.vue fires a browser Notification when count goes from 0→positive. This still works if the `chksrt-count` WebSocket push is preserved.

7. **`startChksrtPolling` / 60-second polling** — App.vue polls every 60s as a fallback. This still works if the new `GET /api/asr/chksrt/list` endpoint returns an array or count.

8. **`tvdb.enqueueShowProcess(showName)` in chokidar handler** — the plan retains this call but doesn't explicitly say so. Worth confirming it stays.

---

## Opinions and Suggestions

### 1. Consolidating srvr and asr processes

Moving ASR generation into `srvr` means a single long-running CPU-intensive operation could block `srvr`'s event loop. Mistral API calls are network I/O (not blocking), but the ffmpeg audio extraction step is CPU-heavy and currently spawned as a child process. As long as `generateSrtWithAsr` uses `spawn`/`child_process` for ffmpeg (which it already does via `processOneVideo`), this is safe. **Suggestion: confirm the ASR pipeline only uses async/child_process and never blocks the event loop before merging into srvr.**

### 2. subQueueGenSrt loop design

The plan fires `generateSrtWithAsr` and moves on without awaiting it, relying on `genSrtRunning` flag. This means the loop could theoretically start the next check while genSrt is running. The design handles this with the `genSrtRunning` guard at the top of the loop. This is correct but subtle. **Suggestion: make sure `genSrtRunning` is always cleared in a `finally` block to avoid permanent lockout on errors.**

### 3. `doSubQueueNow()` polling

The instruction says: if `subQueueBusy`, poll every 1 sec until `!subQueueBusy`, then do next check. This poll is unbounded and creates a parallel polling loop running alongside the main timer loop. If `doSubQueueNow()` is called multiple times while busy, multiple polling loops will stack up. **Suggestion: use a single `pendingNow` flag instead of multiple pollers.**

### 4. `applyOpenSubSrts` needs imdb_id

The OpenSubtitles API requires an `imdb_id`. The existing `applySubFiles` gets it as a parameter from the client. The new `applyOpenSubSrts(videoFilePath, showname, ...)` has no `imdb_id` parameter. It must look it up from tvdb. Add a step: look up tvdb record by `showname`, get `tvdb.imdbId`. If no imdb_id, skip OpenSubtitles silently and log to `subtitle.log`.

### 5. Subtitle filename `base.#<id>.srt`

The `#` character in filenames is valid on Linux but can cause issues in shell scripts and some path parsing code. The existing emb sidecar pattern is `base.en<n>.srt`. Consider `base.os<id>.srt` (os = OpenSubtitles) as an alternative. This is just a suggestion — if `base.#<id>.srt` is intentional, the sidecar check in `fileNeedsSubChecked` and `processSubQueueEntry` must not accidentally match these as "already has srt."

### 6. subQueue priority convention

The instructions say chokidar adds at "top" (unshift) for priority, while tvdb update adds at "end" (push) for low priority. However, ui-initiated (fromUI=true) Subs button also adds at top. The plan is consistent about this. **One edge case:** if the tvdb background task adds 50 files and then a new video arrives via chokidar, the chokidar file correctly jumps the queue. Good design.

### 7. Log rotation implementation

Node's built-in `setTimeout` can drift over days. **Suggestion: use `node-cron` (already available or easy to add) for the 5am rotation instead of a recursive `setTimeout`.**

---

## Questions / Ambiguities

**Q1: Where does `generateSrtWithAsr` live?**  
The instructions say it "wraps `processOneVideo`." The Mistral ASR pipeline is in `asr.js`. Does it move to `srvr/index.js`, or does `srvr` call `asr.js` as a child process? This is the biggest architectural question and the plan can't proceed without an answer.

**Q2: "before step 3" in tvdb update task**  
The instruction says: _"check if subtitles are needed for show before step 3."_ `tryLocalGetTvdb` has several steps (preTick, TVDB refresh, seriesMap fetch, perShowCallback). Which one is step 3? Looking at the flow, the subtitle scan should logically run after seriesMap is available (so watched status is fresh) but before or during `perShowCallback`. Suggest placing it inside `perShowCallback` in srvr/index.js where it already has the updated record.

**Q3: Chksrt "Ok" button behavior**  
The plan only says to rename "Bad" to "GenSrt." What should "Ok" do in the new system? Options:

- Same as now: create `.enx.srtstub`, remove from `subQueueChkSrt`
- Remove from `subQueueChkSrt` without creating srtstub (file already has real srt from emb/opensubs)

**Q4: `applyOpenSubSrts` — where does `imdb_id` come from?**  
See suggestion 4 above. The existing `subsSearch` requires `imdb_id`. Should `applyOpenSubSrts` look it up from the tvdb record, or should it accept it as a parameter?

**Q5: `generateSrtWithAsr` and existing `srtExists` check**  
`processOneVideo` already calls `srtExists()` and returns early. The instructions say `generateSrtWithAsr` should also check. Should `generateSrtWithAsr` do its own check first and then call `processOneVideo` (which also checks), or should `processOneVideo` have its guard removed when called from `generateSrtWithAsr`?

**Q6: `subQueueChkSrt` — how does client learn queue length?**  
The current system uses `GET /api/asr/chksrt/list` (file-backed) plus a WebSocket `chksrt-count` push from chokidar. In the new system, `subQueueChkSrt` is in-memory. The server needs to push `chksrt-count` whenever `subQueueChkSrt` changes. App.vue also polls every 60s via `fetchChksrtCount → srvr.getChksrtList()`. The `GET /api/asr/chksrt/list` endpoint must be updated to read from `subQueueChkSrt` instead of a file.

**Q7: On restart, queue state is lost**  
In-memory queues don't survive `pm2 restart`. Files in `subQueueChkSrt` that were awaiting human review would be lost. Similarly any pending subs work in `subQueue`/`subQueueGenSrt` is lost. This may be intentional (the tvdb background task and chokidar will re-detect files on next scan), but files in `subQueueChkSrt` (waiting for human check) could be silently dropped. Consider persisting `subQueueChkSrt` to a file on writes if this is a concern.

**Q8: What happens to the `tv-asr-bkgnd` pm2 process?**  
If the background loop moves to `srvr`, the `tv-asr-bkgnd` pm2 process either:

- Is retired entirely (asr.js only used for CLI single-file invocation)
- Or still runs for CLI mode and is just not started with `--background`

Clarify whether `tv-asr-bkgnd` process stays in `ecosystem.config.cjs`.
