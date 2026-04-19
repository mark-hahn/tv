# Sub-Plan: Subtitle Processing Simplification

## Architecture Overview

The new system replaces file-based queues (`pending.txt`, `emb-pending.txt`, `needsSrtChk.txt`, `forced-pending.txt`) with three in-memory arrays (also persisted to JSON files) and timer-driven background loops, all running inside `srvr/index.js`.

**Process architecture:**

- All queue logic and background loops live in `srvr/index.js` (pm2: `tv-srvr`)
- `generateSrtWithAsr` in `srvr/index.js` spawns `asr.js` as a child process (`node asr.js <videoFilePath>`) to do the Mistral ASR work
- `asr.js` is stripped of its full CLI (all flags, directory mode, background loop) and becomes a minimal single-file processor: accept one video path argument, call `processOneVideo`, exit
- The `srtExists` guard is removed from `processOneVideo`; the guard lives only in `generateSrtWithAsr`
- The `tv-asr-bkgnd` pm2 process is retired
- All processing is sequential — one ASR job at a time, guarded by `genSrtRunning`

---

## New In-Memory State (in srvr/index.js)

```js
const subQueue = []; // { videoFilePath, fromUI, lowPriority }
const subQueueChkSrt = []; // { videoFilePath, fromUI }
const subQueueGenSrt = []; // { videoFilePath, fromUI, lowPriority }
let subQueueBusy = false;
let chkSubQueueDelay = 10_000;
let chkGenSrtDelay = 10_000;
let genSrtRunning = false;
// set when doSubQueueNow() called while busy; prevents stacking multiple polling loops
let subQueuePendingNow = false;
```

All three queues are persisted to JSON files and loaded on startup. Whenever a queue is modified, the corresponding file is written synchronously. File locations:

- `/root/dev/apps/tv/apps/asr/data/subQueue.json`
- `/root/dev/apps/tv/apps/asr/data/subQueueChkSrt.json`
- `/root/dev/apps/tv/apps/asr/data/subQueueGenSrt.json`

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
- Run ffprobe to find all embedded subtitle streams
- For each stream that is english and text-based: extract to `base.en<idx>.srt` beside the video file with formatting info removed (same as current `extractTextSubtitles`); don't overwrite existing files; log each created file to `subtitle.log`
- At end: if any embedded subtitle streams were NOT extracted (e.g. bitmapped/PGS), create `base.enx.srtstub` sidecar
- If `fromUI`, also log to emb pane WebSocket channel (same as existing emb pane logging)

### `applyOpenSubSrts(videoFilePath, showname, season, episode)`

- Located in `srvr/index.js`
- Derive `showname`, `season`, `episode` from path if missing
- Look up `imdb_id` from tvdb record by `showname`; if none found, log to `subtitle.log` and return
- Call `subsSearch({ imdb_id, season, episode, language: 'en' })` (existing function)
- For each result: download and save as `base.en<id>.srt` beside video file where `en<id>` is exactly 7 characters (e.g. `en12345` for a 5-digit OpenSubtitles ID, zero-padded if needed); don't overwrite existing; log each created file to `subtitle.log`
- Note: this naming differentiates from embedded sidecar filenames (`base.en0.srt`, `base.en10.srt`) where `en<idx>` is 3–4 characters
- This replaces `applySubFiles()`

### `generateSrtWithAsr(videoFilePath, fromUI)`

- Located in `srvr/index.js`
- Check if `base.enx.srt` already exists; if so log to `subtitle.log` and return
- Set `genSrtRunning = true`; log start to `subtitle.log`
- Spawn `node /path/to/asr.js <videoFilePath>` as a child process
- Stream child process stdout to `subtitle.log`; if `fromUI`, also pipe to asr pane WebSocket channel (same as existing asr logging)
- In a `finally` block: clear `genSrtRunning = false`

### `doSubQueueNow()`

- Set `chkSubQueueDelay = 500`
- If `!subQueueBusy`: run `processSubQueueEntry()` immediately
- If `subQueueBusy` and `!subQueuePendingNow`: set `subQueuePendingNow = true`, poll every 1 sec until `!subQueueBusy`, then clear `subQueuePendingNow` and run `processSubQueueEntry()`
- If `subQueueBusy` and `subQueuePendingNow` already set: do nothing (a poll is already pending)

### `doSubQueueGenSrtNow()`

- Set `chkGenSrtDelay = 500`
- Trigger immediate check of `subQueueGenSrt`

### `processSubQueueEntry()` (internal, called by background loop)

- Shift top of `subQueue`; persist `subQueue`
- Set `subQueueBusy = true`
- `await generateEmbSrts(...)` then `await sleep(1000)`
- `await applyOpenSubSrts(...)` then `await sleep(1000)`
- Check if sidecar now exists (`.enx.srt`, `.enx.srtstub`, or `.en<n>.srt`)
  - No sidecar → unshift entry to `subQueueGenSrt` with `lowPriority` carried from the `subQueue` entry; persist; call `doSubQueueGenSrtNow()`
  - Has sidecar → push entry to `subQueueChkSrt`; persist; push `chksrt-count` WebSocket event
- Set `subQueueBusy = false`, `chkSubQueueDelay = 500`

---

## Background Loops (both in srvr/index.js)

### subQueue loop

```
start: chkSubQueueDelay = 10_000, subQueueBusy = false
loop:
  if subQueue is empty → chkSubQueueDelay = 10_000
  else → await processSubQueueEntry()
  setTimeout(loop, chkSubQueueDelay)
```

### subQueueGenSrt loop

```
start: chkGenSrtDelay = 10_000, genSrtRunning = false
loop:
  if !genSrtRunning and subQueueGenSrt not empty:
    entry = subQueueGenSrt[0]  // peek, don't shift yet
    if entry.lowPriority and cpu loadavg[0] > 2:
      chkGenSrtDelay = 10_000  // skip and defer this low-priority entry
    else:
      subQueueGenSrt.shift(); persist subQueueGenSrt
      generateSrtWithAsr(entry.videoFilePath, entry.fromUI)  // don't await; genSrtRunning guards re-entry
      chkGenSrtDelay = 500
  if subQueueGenSrt is empty → chkGenSrtDelay = 10_000
  setTimeout(loop, chkGenSrtDelay)
```

High-priority entries (`lowPriority = false`) always process when `genSrtRunning = false`, regardless of CPU load. Low-priority entries defer when CPU load average > 2. `doSubQueueGenSrtNow()` can interrupt any delay for either priority.

---

## Queue Sources

| Source                      | Queue            | Position      | fromUI | lowPriority |
| --------------------------- | ---------------- | ------------- | ------ | ----------- |
| Subs button (local pane)    | `subQueue`       | top (unshift) | true   | false       |
| ASR button (local pane)     | `subQueueGenSrt` | top (unshift) | true   | false       |
| chokidar video add          | `subQueue`       | top (unshift) | false  | false       |
| tvdb update background task | `subQueue`       | end (push)    | false  | true        |
| chksrt GenSrt button        | `subQueueGenSrt` | top (unshift) | false  | false       |

When `processSubQueueEntry` moves a file from `subQueue` to `subQueueGenSrt`, the `lowPriority` value is carried from the originating `subQueue` entry.

---

## Client Changes (srvr/index.js HTTP endpoints + client/local.vue)

### New HTTP endpoints in srvr/index.js

- `POST /api/asr/subs/enqueue` — receives `{ videoPaths[], fromUI }`, unshifts to top of `subQueue` with `lowPriority:false`; persists; calls `doSubQueueNow()`
- `POST /api/asr/gensrt/enqueue` — receives `{ videoPaths[], fromUI }`, unshifts to top of `subQueueGenSrt` with `lowPriority:false`; persists; calls `doSubQueueGenSrtNow()`
- `POST /api/asr/emb/generate` — receives `{ videoPaths[] }`, calls `generateEmbSrts` for each with `fromUI=true`
- `GET /api/asr/chksrt/list` — returns `{ count: subQueueChkSrt.length, path: subQueueChkSrt[0]?.videoFilePath }` from in-memory queue
- `POST /api/asr/chksrt/ok` — shift top of `subQueueChkSrt`; persist; push `chksrt-count` WebSocket event; done (no srtstub created)
- `POST /api/asr/chksrt/gensrt` — shift top of `subQueueChkSrt`; unshift to `subQueueGenSrt` with `lowPriority:false`; persist both; push `chksrt-count`; call `doSubQueueGenSrtNow()`
- `POST /api/asr/chksrt/select` — receives `{ videoPath, selectedSrtPath }`; delete all sidecar files for `videoPath` except `selectedSrtPath`; remove `videoPath` from `subQueueChkSrt`; persist; push `chksrt-count`

### srvr WebSocket: push `chksrt-count` to clients

- Emit `notifyClients("chksrt-count", subQueueChkSrt.length)` whenever `subQueueChkSrt` changes (replaces current `readNeedsSrtChk().length` calls)
- `startChksrtPolling()` in App.vue (60-second poll) is kept as-is

### local.vue button changes

- **Subs button**: `POST /api/asr/subs/enqueue` with selected files
- **ASR button**: `POST /api/asr/gensrt/enqueue` with selected files
- **Emb button**: `POST /api/asr/emb/generate` with selected files

### App.vue + video-player.vue chksrt pane changes

- `fetchChksrtCount()`: calls `GET /api/asr/chksrt/list` (returns `{ count, path }`), sets `chksrtCount`; remove the browser `Notification` call
- `clickChksrt()`: fetches top entry path from `GET /api/asr/chksrt/list`, opens video
- Rename "Bad" button label to "GenSrt"
- "GenSrt" button: `POST /api/asr/chksrt/gensrt`
- "Ok" button: `POST /api/asr/chksrt/ok`
- Ctrl-click on a subtitle choice button: `POST /api/asr/chksrt/select` with `{ videoPath, selectedSrtPath }`; then advance to next chksrt entry

---

## chokidar Handler Change (srvr/index.js)

Replace current logic (ffprobe → `needsSrtChk.txt` or `pending.txt` append) with:

1. Derive `showName` from path
2. Look up tvdb record; if no record or `!tvdb.inEmby` → return
3. If `fileNeedsSubChecked(filePath, showName)` → unshift `{ videoFilePath: filePath, fromUI: false, lowPriority: false }` to top of `subQueue`; persist; call `doSubQueueNow()`
4. `tvdb.enqueueShowProcess(showName)` — kept; this is separate from subtitle queue work

---

## tvdb Update Hook Change (srvr/index.js perShowCallback)

Inside `perShowCallback` in `srvr/index.js` (called from `tryLocalGetTvdb` after seriesMap is fresh), before the existing disk/gap checks:

1. Only if `processRecord.inEmby`
2. Scan show folder for all video files
3. For each: if `fileNeedsSubChecked(filePath, showName)` → push `{ videoFilePath: filePath, fromUI: false, lowPriority: true }` to end of `subQueue`; persist

No `doSubQueueNow()` call — these are low priority and the background loop will pick them up.

---

## Log Rotation (srvr/index.js)

At 5am daily rotate `subtitle.log`:

- Move `/root/dev/apps/tv/apps/asr/data/subtitle.log` to `/root/dev/apps/tv/apps/asr/data/subtitle-logs/subtitle-MM-DD.log`
- Create new empty `subtitle.log`
- Use `node-cron` for reliable 5am scheduling instead of `setTimeout`

---

## Changes to asr.js

- Remove `srtExists` guard from `processOneVideo` — the guard now lives only in `generateSrtWithAsr`
- Remove entire `runBackgroundLoop()` function
- Remove `main()` function and all its complex CLI logic (directory mode, test-mins, audio-quality, dump-raw, prompt, etc.)
- Remove all CLI argument parsing (`rawArgs`, `flagsKVP`, `switches`, `positional`, `getNum`, `runBackground` flag)
- Remove all logging to `asr-bkgnd.log`
- Keep a minimal entry point: if `process.argv[2]` is a file path, call `processOneVideo(process.argv[2])` and exit — this is what `srvr` spawns as a child process
- Remove `PENDING_PATH`, `FORCED_PENDING_PATH`, `NEEDS_SRT_CHK_PATH`, `EMB_PENDING_PATH` constants
- Remove `loadNeedsSrtChkSet()`, `appendNeedsSrtChk()`, `consumePending()`, `consumeForcedPending()`, `consumeQueueFile()`, `processEmbQueue()`, `findCandidateFile()`, `pickNextFile()`, `hasAnyUnwatchedFile()`, `waitForLowCpu()`, `deleteLastLogLine()`, `loadTvdb()`, `bkgndLogStatus()`, `appendBkgndLog()`
- `extractTextSubtitles()` stays — still used by `processOneVideo` internally for command-line emb extraction
- Core pipeline functions stay: `processOneVideo`, `extractAudio`, `preprocessAudio`, `vadChunks`, `callApi`, `writeSRT`, `getFlac`, `processSegments`, `extractChunkWav`, etc.

---

## Code That Will Be Dead

### In `asr/asr.js` (removed as part of asr.js cleanup above)

See "Changes to asr.js" section — all background loop and CLI code goes away.

### In `srvr/index.js`

- `ASR_PENDING_PATH`, `ASR_FORCED_PENDING_PATH`, `EMB_PENDING_PATH`, `ASR_NEEDS_SRT_CHK_PATH` constants
- `readNeedsSrtChk()`
- `writeNeedsSrtChk()`
- `asrPendingAppend()`
- `applySubFiles()` — large function, replaced by `applyOpenSubSrts()`
- `POST /api/asr/chksrt/bad` (replaced by `POST /api/asr/chksrt/gensrt`)
- `POST /api/asr/chksrt/ok` (replaced by new ok endpoint with different behavior)
- Old `GET /api/asr/chksrt/list` (replaced by new version reading from `subQueueChkSrt`)
- `POST /api/asr/emb/apply` (replaced by `POST /api/asr/emb/generate`)
- The chokidar ffprobe/`needsSrtChk`/`asrPendingAppend` block (replaced by `fileNeedsSubChecked` call)
- All logging to `tv.log` and `asr-bkgnd.log`

### Queue data files (no longer written or read)

- `data/pending.txt`
- `data/forced-pending.txt`
- `data/emb-pending.txt`
- `data/needsSrtChk.txt`

### pm2

- `tv-asr-bkgnd` process retired from `ecosystem.config.cjs`

---

## Resolved Items

The following items from earlier plan sections are now resolved:

1. **Chksrt "Ok" button**: shifts top of `subQueueChkSrt`, persists, done — no srtstub created
2. **`processOneVideo` srtExists guard**: guard removed from `processOneVideo`; check lives only in `generateSrtWithAsr`
3. **ASR low-CPU gate**: applies only to `lowPriority=true` entries in `subQueueGenSrt`; high-priority entries always run; `doSubQueueGenSrtNow()` can interrupt any delay
4. **`tv.log` and `asr-bkgnd.log` logging**: removed entirely
5. **CLI script**: removed from `asr.js`; replaced with minimal single-file entry point
6. **Browser Notification**: removed from `fetchChksrtCount` in App.vue
7. **60-second `startChksrtPolling`**: kept as-is
8. **`tvdb.enqueueShowProcess`**: kept in chokidar handler; separate from subtitle queue work
9. **Subtitle filename `#` convention**: replaced with `base.en<id>.srt` where `en<id>` is exactly 7 characters, differentiating from embedded `base.en0.srt` / `base.en10.srt` (3–4 char `en<idx>` part)
10. **`generateSrtWithAsr` architecture**: `srvr` calls `asr.js` as a child process; `tv-asr-bkgnd` pm2 process retired
11. **tvdb subtitle scan placement**: inside `perShowCallback` in `srvr/index.js`, after seriesMap is fresh
12. **Queue persistence**: all three queues persisted to JSON files; loaded on startup
13. **`doSubQueueNow()` stacking**: prevented by `subQueuePendingNow` flag
14. **`genSrtRunning` lockout on error**: cleared in `finally` block in `generateSrtWithAsr`
15. **Log rotation**: use `node-cron`
16. **`applyOpenSubSrts` imdb_id**: looked up from tvdb record by showname; skips silently if not found
17. **generateEmbSrts bitmapped subtitles**: adds `base.enx.srtstub` if any non-extracted embedded streams exist
18. **Ctrl-click in chksrt**: deletes all sidecar files except selected, removes from `subQueueChkSrt`, advances to next
