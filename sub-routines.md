# The code that processes subtitles

This describes, section by section, the code that handles subtitles: where
each piece lives, what calls it, and what it does. `all-sub.md` and
`srt-fix.md` explain the rules themselves; this is a map of the code that
carries them out. Line numbers are left out because they move; search for the
function names.

Almost all of the work happens in tv-srvr (`apps/srvr`). The players, the
remotes and the web client only show subtitles, pick between them and ask
tv-srvr to move or measure them. tv-down brings `.srt` files in from usb, and
tv-api passes the torrent pane's subtitle counts through to tv-srvr.

## Where the code lives

| File | Process | What it holds |
| --- | --- | --- |
| `packages/share/src/srt.js` | all | Pure `.srt` text helpers, `cleanSrt()` among them |
| `packages/share/src/videoFiles.js` | all | `vidDeleteWithSidecars()`, which deletes a video with its subtitle files |
| `apps/srvr/src/subOrigin.js` | tv-srvr | A sidecar's type and label from its name, and `sameOrigin()` |
| `apps/srvr/src/subs.js` | tv-srvr | `subs.db`, the sidecar list, what a play offers and starts on, every OpenSubtitles search and download |
| `apps/srvr/src/opensubtitles.js` | tv-srvr | The OpenSubtitles REST client, and the Chk Subs counts |
| `apps/srvr/src/subsQueue.js` | tv-srvr | The sub queue and the ASR queue, embedded track copy-out, `S` file naming |
| `apps/srvr/src/subPrepare.js` | tv-srvr | Checking each sidecar and acting on its verdict, the retime pass, the watcher's later checks, Sync and measure |
| `apps/srvr/src/subSpotCheck.js` | tv-srvr | The ASR clips: cutting, transcribing, pairing cues with words, verdicts, fixing a file's timing |
| `apps/srvr/src/subSync.js` | tv-srvr | Fitting a file to the `.asr.srt` (`asrOffset`), and whole-file audio matching with ffsubsync |
| `apps/srvr/src/audioSyncCheck.py` | tv-srvr | The first-third and last-third check behind the audio matching |
| `apps/srvr/src/asrCost.js` | tv-srvr | Speechmatics audio hours per day, for the ASR pane's cost chart |
| `apps/srvr/src/batchQueue.js` | tv-srvr | The idle CPU and I/O prefix every subtitle ffmpeg runs under, and the shared extraction queue |
| `apps/srvr/index.js` | tv-srvr | The file watcher's subtitle handling, the 6-hourly sweep, `getPlayUrl`, `playProgress`, and the subtitle HTTP routes |
| `apps/srvr/src/routes/media.js` | tv-srvr | `/api/subtitle` (a sidecar served as vtt) and `/api/subtitle-list` |
| `apps/srvr/src/play.html` | browser | The browser player's subtitle handling |
| `apps/asr/asr.js` | child of tv-srvr | A complete ASR of one video into its `.asr.srt` |
| `apps/tvapp/.../VideoPlayer.java`, `MainActivity.java`, `CtrlServer.java`, `Updates.java` | tvapp | Sideloading the sidecars, the subtitle panel's commands, offset, Apply, Sync, `subsLate` |
| `apps/android/App.js` | phone | The subtitle panel and the `subError` pop-up |
| `apps/client/src/components/tvpane.vue`, `App.vue`, `local.vue`, `queues.vue`, `video-player.vue`, `srvr.js` | web client | The web subtitle panel, the `subError` pop-up, the local pane's Subs, Sync and ASR, the Queues pane, the in-app player |
| `apps/down/src/main.js`, `worker.js` | tv-down | Taking `.srt` files from usb and landing them clean |
| `apps/api/src/server.js`, `torrentSubtitles.js` | tv-api | Chk Subs, and the sub and srt counts of the usb and local panes |
| `apps/srvr/scripts/*.js` | one-off | The retime backfill and a few check and cleanup scripts |

## Shared text helpers

`packages/share/src/srt.js` has no I/O and no state. `srtTimeToMs()` and
`msToSrtTime()` convert between an `.srt` time and milliseconds, and every
piece of code that moves cues uses them. `parseSrt()` turns the text into cues
with start and end times, and `serializeSrt()` writes cues back out.
`stripSrtFormatting()` takes out formatting tags and ASS codes. `derollSrt()`
merges back-to-back cues that repeat the same line, which made a visible blink.
`sanitizeSrt()` strips, sorts the cues by start time, merges cues with the same
times and derolls, returning null when nothing changed. `cleanSrt()` is
`sanitizeSrt()` or the text as it came, and it is the one function every
subtitle file goes through before it is written, whoever writes it.

`vidDeleteWithSidecars()` in `packages/share/src/videoFiles.js` deletes a video
and every file named after it, its `.srt` files included, but leaves the
sidecars of another video whose name merely starts the same. tv-srvr's
duplicate-episode cleanup (`reconcileDuplicateEpisodeVideos()` in `index.js`),
`dupeFolders.js` and tv-down use it, so a losing or replaced video never leaves
its subtitles behind.

## Sidecar names and types

`apps/srvr/src/subOrigin.js` holds the pure facts about a sidecar.
`sidecarType()` reads the suffix between the video's name and `.srt`, and
`sidecarLabel()` turns it into the subtitle panel's label.

| Suffix | Type | Label | Where it comes from |
| --- | --- | --- | --- |
| `T<n>`, legacy `mb<n>` | T | `T 3` | An embedded text track copied out (`extractEmbSrts`) |
| `H<n>` | H | `H 3` | An embedded track flagged as describing music and sound |
| `opn<TAG>` | V | `V CYR4Q` | An OpenSubtitles download; the tag is the file id in base32 |
| `asr` | + | `+` | A complete ASR (`apps/asr/asr.js`) |
| `S<n>` and anything else | S | `S 1` | A file that arrived beside the video |

`NAMED_SIDECAR_RE` in `subsQueue.js` matches the names tv-srvr gives files
itself, so the watcher can tell those from arrivals. `sameOrigin()` decides
whether two OpenSubtitles results for different episodes come from the same
uploader and release set, from their flags, fps, uploader and upload date,
or, for the shared bot uploaders, from the release name with the episode
marker and title taken out (`releaseKey()`) or from equal comments.
`subs.js` uses it to pick a download and a start file like the one the show
used before.

## What is stored: subs.db

`apps/srvr/src/subs.js` opens `apps/srvr/data/subs.db` and is the only writer.

| Table | One row per | Written by | Read by |
| --- | --- | --- | --- |
| `subs` | OpenSubtitles search result, with its flags, uploader, release, `downloaded`, `chosen`, `unfitFor`, `hashFor` | `searchEpisode()`, `downloadSub()`, `syncDownloaded()`, `subStopped()`, `markUnfit()` | `nextCandidate()`, `pickSidecar()` |
| `picks` | Episode: the sidecar it showed at its last stop | `subStopped()` | `pickSidecar()` |
| `processed` | Video that has been through the add-to-disk steps | `markProcessed()`, `unmarkProcessed()` | `sweepWantsVideo()` |
| `clips` | Checked video: the words heard in its ASR clips and its English audio track, -1 for none | `saveClips()` in `subPrepare.js` | `storedSet()`, `needsCheck()` |
| `checks` | Sidecar: its verdict, offset, method and detail, valid while the file keeps its size and mtime | `saveCheck()` | `freshCheck()`, `playList()`, `needsCheck()`, `hasGoodSub()` |
| `retimes` | Video: when its retime pass ran and the file it fitted | `saveRetime()` | `retimePass()`, the sub queue |
| `asrSpend` | PST day: what automatic complete ASR was charged | `addAsrSpend()` | `processSubQueueEntry()` |

`freshCheck()` is the gate every reader of a verdict goes through: a file
whose size or mtime has changed since its check has no verdict. `forgetCheck()`
drops one verdict, `forgetCheckUnlessMisfit()` drops it unless it says
unusable or wrong cut, which stays as the memory of why a file was deleted, and
`misfitRemembered()` reads that memory. `forgetVideo()` drops a video's checks,
clips and retime row together.

`listSidecars()` is the one place that lists a video's subtitle files: every
`<stem>.srt` and `<stem>.*.srt` beside it, sorted T, H, V, S, + and then by
name. `syncDownloaded()` sets an episode's `downloaded` marks from the `opn`
files actually beside its non-sample videos, and `clearDownloadedWithout()`
clears the marks of episodes that have no video left.

## Arrival: the file watcher

The chokidar watcher at the bottom of `apps/srvr/index.js` sees every file
under `/mnt/media/tv` and hands subtitle work to the queue and to
`subPrepare.js`.

| Event | File | Code | What happens |
| --- | --- | --- | --- |
| add | `.SRT` in any case but lower | `lowerSrtExt()` | Renamed to `.srt` unless that name is taken; it then arrives again |
| add | `.srt` | `subFileChanged()` | The episode's `downloaded` marks follow the disk |
| add | `.srt` not named by tv-srvr | `subFileAdded()` | Its episode's video is queued with `renameS`, so the file becomes an `S` file |
| add | `.srt` | `subPrepare.subFileEvent(file, "add")` | Judged from the video's stored clips (see Later checks) |
| add | `.asr.srt` | `asrLanded()` | The video is queued with the `retime` mark |
| add | video | debounced per show | Duplicate episodes resolved by `reconcileDuplicateEpisodeVideos()`, a file the TV stalls on sent to the recode, the rest queued with `renameS` |
| change | `.srt` | `subPrepare.subFileEvent(file, "change")` | Judged as timed by hand (`judgeHandTimed()`) |
| change | video | `videoReplaced()` | Queued with `replaced` and `renameS`, unless the recode takes it |
| unlink | `.srt` | `subFileChanged()`, `subFileEvent(file, "unlink")` | `downloaded` marks follow the disk; the check goes unless it is a misfit's |
| unlink | video | `subPrepare.forgetVideo()` | Its checks, clips and retime row go |

Only shows that are `inLibrary` have their videos queued. `subsEpisodeOf()`
finds the show and episode a file belongs to for the `downloaded` marks.

## The sub queue

`apps/srvr/src/subsQueue.js` owns the sub queue, persisted in
`apps/asr/data/subQueue.json`, and runs one entry at a time
(`startSubQueueLoop()`, `processSubQueueEntry()`; `doSubQueueNow()` starts one
at once). `enqueueSubQueue()` merges a second request for a video already
queued, and a request for the video being processed is held in
`subsState.subAgain` and queued again when its run ends.

An entry is a video path with these marks:

| Mark | Set by | Effect |
| --- | --- | --- |
| `renameS` | the watcher's video and `.srt` arrivals | Arriving subtitle files of the episode become `S<n>` files |
| `replaced` | `videoReplaced()` | Old checks, clips, retime row and `processed` mark dropped; T and H files deleted to be copied out again |
| `retime` | `asrLanded()`, `/api/asr/subs/enqueue` with `retime` | Only the retime pass runs, with downloads |
| `lowPriority` | the sweep, the backfill | Waits while a stills build, a recode or ASR runs or is queued |
| `fromUI` | the local pane's Subs button | Progress goes to the pane, and the daily ASR limit does not apply |

`processSubQueueEntry()` skips a video that is gone and every movie. For the
rest it runs these steps in order; a step that throws leaves the video
unmarked, so the sweep brings it back.

| Step | Code | What it does |
| --- | --- | --- |
| 1 | `extractEmbSrts()` | ffprobe the streams; copy each English or untagged text track that is not forced out to `T<n>` or `H<n>` through `cleanSrt()`, skipping one already there and one remembered as a misfit |
| 2 | `renameSFiles()`, `addSFile()` | Each `.srt` in the folder for this episode that tv-srvr did not name becomes the next `S<n>`, cleaned, unless an `S` file already has the same text; the original is deleted |
| 3 | `prepareVideoSubs()` | Every sidecar checked and acted on, downloads when nothing fits (see Subtitle checks) |
| 4 | `retimePass()` | When the video's only good file is its `.asr.srt` and it has had no pass |
| 5 | `addToAsrQueue()` | When step 3 says `needsAsr`, within `AUTO_ASR_DAILY_USD` a day unless `fromUI`; over it, the video is left unmarked for another day |
| 6 | `subs.markProcessed()` | The video has been through the steps |

The Queues pane reads `getSubQueueStatus()` and `getAsrQueueStatus()` through
`/api/queues`, with the stage each step sets through `setSubStage()`, and can
empty either queue (`clearSubQueue()`, `clearAsrQueue()`).

## The 6-hourly sweep

`runSubBackstopSweep()` in `index.js` starts 10 minutes after tv-srvr does and
then runs every 6 hours. It walks every show and season folder, brings every
episode's `downloaded` marks into line with the disk (`syncDownloaded()`), and
queues, at low priority, each library video that `sweepWantsVideo()` says has
not been through the steps. With `SUB_CHECK_BACKFILL` on (it is off) it also
queues videos `needsCheck()` says were never checked. Only a walk that read
every folder and found videos clears the marks of episodes with no video
(`clearDownloadedWithout()`), so a disk outage clears nothing.

## Subtitle checks

`prepareVideoSubs()` in `apps/srvr/src/subPrepare.js` is the entry point. It
reads the video's duration and audio languages (`videoInfo()`), finds the
English track (`englishTrack()`), and goes one of two ways.

With an English track, `prepareByAsr()` reads the sidecars
(`readSidecars()`), hears two clips unless the video's stored clips will do
(`hearClips()`), judges every usable file against them (`judgeFile()`), hears
a middle clip when a file's two clips disagree (`hearMiddle()`), and hands
each file and its verdict to `act()`. With no file found good and an episode
of a show with an IMDb id, it downloads OpenSubtitles candidates one at a time
through `subs.downloadUntilFit()`, judging each the same way; the first
download places the clips when there was no sidecar to place them by.

With no English track, `prepareByAudio()` stores clips with track -1 and hands
each file to `actByAudio()`: T and H files are presumed good, and the others
are checked with whole-file audio matching (`syncSubToAudio()`), which shifts
a file it passes. Downloads work the same way. Such a video never goes to ASR.

`act()`, `actByAudio()` and `dropOrHide()` carry out a verdict:

| Verdict | What `act()` does |
| --- | --- |
| good | Kept; the check is saved with its offset |
| fixable | Shifted, or stretched when a middle clip shows another rate (`fixedText()`), written, and judged again; a file still not good is retimed to the `.asr.srt` if it can be |
| wrong cut | Retimed to the `.asr.srt` if it can be; else deleted by `dropOrHide()`, an opn file marked unfit for the video |
| can't tell | Retimed to the `.asr.srt` if it can be; else kept with the verdict |
| unusable | Deleted by `dropOrHide()`, except an `.asr.srt`, which stays so ASR does not run again |

A `busy` set keeps two of these from working on one video at once; the
watcher's checks wait for it (`notBusy()`), and the other entry points throw.

`subSpotCheck.js` holds the pieces, all of them used above:

| Function | What it does |
| --- | --- |
| `videoInfo()`, `englishTrack()` | ffprobe for the duration and audio tags; the English track, an untagged first track counting |
| `readSidecars()`, `cuesOf()`, `unusableWhy()` | Each sidecar's cues with their bare words, its type, how far it runs past the end, and why it is unusable: under 3 dialogue cues a minute, or too few common English words |
| `hearClips()`, `windowsByCount()` | The two 2-minute clips at the busiest dialogue of the first and last third of the first usable file's cues, each tried once more elsewhere when no file pairs with it |
| `hear()`, `transcribe()`, `smFetch()` | Cut the clips with ffmpeg under `BATCH_SCHED` and send them to Speechmatics, retrying a dropped connection once |
| `clipOffset()` | Pair cues with the clip's words by their first 5 words, each found once; the median difference is the clip's offset |
| `judge()`, `judgeFile()` | The verdict from the clip offsets; a file that can't be told and runs over 5 s past the end is a wrong cut |
| `hearMiddle()` | A third clip in the middle third, to tell a file at another rate from one of another cut |
| `fixedText()` | Every cue moved by one offset, or by the line through two offsets, never below 0, through `cleanSrt()` |
| `clipsToJson()`, `clipsFromJson()` | The clips as stored in `subs.db` |
| `spotCheckSubs()` | A dry check of one video that writes nothing |

## The retime pass

A video whose only good file is its `.asr.srt` gets one other file fitted to
it, so one file has a real subtitle's words and the video's timing.
`needsRetime()` says when that is so, and `retimePass()` in `subPrepare.js`
does it: it tries the sidecars that are not already good in order T, H, V, S
with `retimeFile()`, then, with `canDownload`, OpenSubtitles candidates through
`downloadUntilFit()`, up to 5. `retimeFile()` uses `asrOffset()` from
`subSync.js`, which pairs phrases of 1 to 4 words found once in each file and
takes the median start-time difference, needing 10 matches and 80% of them
within 250 ms; then `shiftedSrt()` moves every cue and the check is saved as
good, method `retime`. The pass's outcome goes to the `retimes` table, and
the queue does not run it again for that video on its own.

The whole pass runs from the queue's step 4, and alone from an entry with the
`retime` mark. `retimeFile()` on its own fits one file: in `act()`, for a file
beside an `.asr.srt` that the clips do not find good; in `subFileEvent()`, for
a file that arrives beside a video that was never checked but needs a retime;
and in `syncSidecar()`, the local pane's Sync, when the video has no stored
clips.

## Whole-file audio matching

`syncSubToAudio()` in `apps/srvr/src/subSync.js` is for videos with no English
audio. It decodes the first audio track to a wav, runs ffsubsync on it to find
the whole file's offset and keep the speech it heard, and runs
`audioSyncCheck.py` to find the best offsets of the first and last third of
the cues against that speech. All three must agree within 250 ms, else it
throws and the file is left as it was. Otherwise the file is shifted by
`shiftedSrt()`, unless it is a dry run. It reads the whole video, so it only
runs in the background: from `actByAudio()`, `measureByAudio()` and
`spotCheckSubs()`. `sidecarVideo()` in the same file finds the video a
sidecar belongs to, and many callers use it.

## Later checks

A sidecar that arrives or changes after its video was checked is handled by
`subFileEvent()` in `subPrepare.js`, from the watcher. An added file waits for
any check of its video to finish, is skipped if it already has a fresh
verdict, and is then judged from the stored clips, hearing a middle clip if it
needs one, and acted on like the video's others; in a video checked by audio
it goes to `actByAudio()`; in a video never checked it is only retimed, when
the video needs that. A changed file goes to `judgeHandTimed()`, which
forgets its verdict unless the change was the checks' own write, and saves
good only when the file fits as it is; nothing shifts it. A deleted file's
verdict goes unless it is a misfit's.

`needsCheck()` says a video still needs checking: it has no stored clips, or
one of its sidecars has no fresh verdict or is still fixable. It is what
`getPlayUrl` returns as `subsChecked` and what the sweep's backfill uses.

## OpenSubtitles

`apps/srvr/src/opensubtitles.js` is the REST client: login and the JWT kept in
`secrets/subs-token.txt` (`openSubtitlesLogin()`, `getSubsToken()`), search
(`openSubtitlesSubtitles()`, `subsSearch()`, retried after a 429 by
`searchRetrying429()`) and download links
(`openSubtitlesDownloadWithRetry()`). `subsCountEpisodes()` is the torrent
pane's Chk Subs: for each episode it searches, finding an IMDb id by name
when it has none, and counts the distinct releases, a hearing-impaired copy
counting with its release; it writes nothing to `subs.db`.

The rest is in `subs.js`:

| Function | What it does |
| --- | --- |
| `searchEpisode()` | Searches by IMDb id, season, episode and the video's hash (`videoHash()`), keeps every result in `subs`, and marks those made for the video's hash (`hashFor`) |
| `nextCandidate()` | The next result to download, never one downloaded, failed or unfit for the video: by hash, then release group, then same origin as a chosen file of the show, then the first not foreign-parts-only |
| `downloadSub()` | Gets the link, fetches the file, writes it as `<stem>.opn<TAG>.srt` through `cleanSrt()`, marks it downloaded, and notes the day's remaining quota (`downloadsRemaining()`) |
| `fetchSubs()`, `fetchJob()` | Search, then download all the episode still needs up to 3 at once, then replacements for failures; one job per episode at a time |
| `subsBeforePlay()`, `downloadBeforePlay()` | At play: run `fetchJob()` unless the episode has 3 or a good file, wait up to 5 s, and send `subError` to the remotes and web client on a slow or failed download or no subtitle at all; returns the job still running as `late` |
| `prefetchSubs()` | The same job with nothing waiting on it, for the episode that plays next |
| `downloadUntilFit()` | The checks' downloads: one candidate at a time, each judged by the caller, until one is good or 5 have been tried; a used-up quota throws so the video is tried another day |

## Complete ASR

When the checks leave nothing that fits, `processSubQueueEntry()` puts the
video on the ASR queue (`addToAsrQueue()`, persisted in
`apps/asr/data/asrQueue.json`). `startAsrQueueLoop()` runs one entry at a
time through `generateSrtWithAsr()`, which skips a video that is gone or
already has an `.asr.srt`, and spawns `apps/asr/asr.js` under `BATCH_SCHED`
with the show's character names as extra vocabulary (`asrVocabForShow()`).
Its output lines feed the ASR pane's log (`appendAsrLog()`, `subtitle.log`,
rotated daily) and its stage (`trackAsrProgress()`). `abortAsr()` kills it
with SIGTERM, which takes its ffmpeg down too.

`apps/asr/asr.js` is a standalone script, run as `node asr.js <video>
[vocab]`. `processOneVideo()` cuts the video's first audio track to a 16 kHz
mono flac (`extractAudio()`), sends it to Speechmatics as one batch job with
the vocabulary (`transcribeAudio()`), turns the timed words into cues
(`wordsToSegments()`, `groupWords()`, `normalizeCues()`, `wrapLines()`,
`splitLongCues()`), and writes them through `cleanSrt()` to `<stem>.asr.srt`
beside the video (`writeSRT()`). Its progress goes to stdout for the pane.
`apps/asr/eval-timing.js` is an offline tool that compares two `.srt` files
word by word and reports the word error rate and timing error; it writes
nothing.
The `.asr.srt` it writes lands through the watcher like any other sidecar, and
`asrLanded()` then queues the retime pass. The ASR pane can also queue videos
directly (`/api/asr/gensrt/enqueue`, `/api/asr/queue/add`), outside the daily
limit.

`apps/srvr/src/asrCost.js` keeps every Speechmatics job in `asrjobs.db`,
synced every 6 hours, so `monthHrs()` can give the ASR pane audio hours per
Los Angeles day.

## Playing

`getPlayUrl()` in `index.js` finds the episode's file, starts its stills,
waits on `subs.subsBeforePlay()`, and returns the file's subtitles through
`subsForFile()`, which calls `subs.playList()`. `playList()` drops wrong-cut
and unusable files and orders the rest in three groups: checked good with a
✓ on the label, then T and H files that could not be judged, then unchecked
files. `pickSidecar()` chooses the start within the first group that has any:
the episode's last pick, else the show's last type (for V, a file of the same
origin as a chosen one), else the first; a good `.asr.srt` is passed over
when another type is good. Each subtitle is a url to `/api/subtitle`, which in
`routes/media.js` serves the `.srt` as vtt.

After the play's own downloads, `prefetchNextSubs()` starts the next
episode's. If downloads were still running when the play started, their
landing sends `subsLate` with the episode's new subtitle list, and a player
that opened with no `.srt` takes it up. The tvdb refresh also calls
`prefetchNextSubs()` for a library show played in the last 30 days.

`playProgress()` receives the showing file as `sub`. At a stop that is not an
early stop it calls `subs.subStopped()`, which stores the episode's pick and
sets `chosen` on the matching OpenSubtitles row.

## Moving and measuring a file

| Route | Code | Used by | What it does |
| --- | --- | --- | --- |
| `/api/applySubOffset` | `index.js` | tvapp for the remotes' Apply, the browser player's Subs bar | Rewrites the `.srt` shifted by the offset, never below 0, through `cleanSrt()`, then `judgeHandTimed()`; returns the new label and `subsChecked` |
| `/api/measureSub` | `measureSidecar()` | tvapp for the remotes' Sync | How far the showing file is off, by the stored clips (heard now when there are none) or by audio matching; nothing shifts, a file that fits as it is gets its ✓ |
| `/api/syncSubToAsr` | `syncSidecar()` | the local pane's Sync | Shifts the file to fit its stored clips, else retimes it to its `.asr.srt` |
| `/api/subPrepare` | `prepareVideoSubs()`, `retimePass()` | by hand | A dry run by default: what the checks and retime would do, and what a play would then offer |
| `/api/asr/subs/enqueue` | `enqueueSubQueue()` | the local pane's Subs, the retime backfill | Queues videos, optionally low priority or retime only |
| `/api/asr/emb/generate` | `extractEmbSrts()` | the local pane's embedded-track button (`applyEmb`) | Copies a video's text tracks out now |
| `/api/subsQuota` | `downloadsRemaining()` | the backfill | OpenSubtitles downloads left today |
| `/api/subsCountEpisodes` | `subsCountEpisodes()` | tv-api's Chk Subs | Release counts per episode |
| `/api/subtitle`, `/api/subtitle-list` | `routes/media.js` | the players | One sidecar as vtt; a video's sidecars with labels, for the in-app player |

## tvapp

tvapp plays the video itself and shows only the sidecars tv-srvr offers; it
never shows an embedded track. The subtitle code is in `VideoPlayer.java`,
with `MainActivity.java`, `CtrlServer.java` and `Updates.java` passing
commands and pushes to it.

| Method | What it does |
| --- | --- |
| `play()` | Takes `getPlayUrl`'s `subs` and `subPick`, and sets the offset `subOfs` to 0 |
| `mediaItem()` | Sideloads each subtitle url as a vtt text track with tv-srvr's label |
| the `onTracksChanged` listener | Picks the start track once (`pickSubs()`), brings back the track a reload had on, loads the showing track's cues and sends the remote the list |
| `pickSubs()` | Turns on the track at `subPick`; with none, text tracks are off |
| `addSubs()` | The `subsLate` push (`Updates.java`): a video of that episode that opened with no subtitles takes the new list and reopens at its position |
| `selectSubtitle()`, `selectedSub()` | The remote's `t,<n>`; -1 turns subtitles off; a new track sets `subOfs` to 0 |
| `subOffset()` | The remote's `so,<sec>`: moves `subOfs`; nothing on disk changes |
| `applySubOfs()` | The remote's `sa`: posts the offset to `/api/applySubOffset`, takes the new label and `subsChecked`, and reloads the video at its position |
| `syncSubs()` | The remote's `sy`: posts the showing file to `/api/measureSub` and sets `subOfs` to the answer; failures show a toast |
| `reload()` | The remote's held Apps (`k,reload`): reopens the video at its position, keeping the track, so an edited file is fetched again |
| `subtitleList()` | The `l,<json>` sent to the remote: title, tracks, selected, `subOfs`, `canSync` and the caption line `cap` |
| `loadCues()`, `showCap()`, `capNow()` | Fetch and parse the showing vtt so the panel's caption line can show where the offset puts the captions |
| `report()` | Sends the showing file as `sub` in every `playProgress` |

`CtrlServer.java` parses the remote's `l`, `t`, `so`, `sa` and `sy`, and
`MainActivity.java` passes each to the player and sends the list back to the
phone as `l,<json>`.

## The browser player

`apps/srvr/src/play.html`, opened at `/api/play`, does its work in `play()`.
It adds one `<track>` per offered subtitle, with the start pick showing, so
the browser's own captions menu switches between them. `report()` sends the
showing file as `sub` in `playProgress`, as device `browser`. When the video
has subtitles, a Subs button opens a bar of −1, −0.5, +0.5 and +1 buttons that
move the showing track's cues in the page (`shiftCues()`, `move()`), and an
Apply that posts the offset still unapplied to `/api/applySubOffset` and takes
the new label. Picking another track undoes an unapplied shift. It has no
Sync.

## The in-app player

`apps/client/src/components/video-player.vue` is the web client's overlay,
used for the local pane's movies and the intro check. `_fetchSubtitleList()`
reads `/api/subtitle-list` and starts on the first file, `activeTrackUrl`
points one `<track>` at `/api/subtitle`, and `selectTrack()` switches files or
turns them off. In intro mode it shows no subtitles.

## The remotes' subtitle panel

The phone (`apps/android/App.js`) and the web tv pane
(`apps/client/src/components/tvpane.vue`) have the same panel and send the
same commands to tvapp through the bridge. Neither does any subtitle work of
its own.

| Action | Phone | Web tv pane | Command |
| --- | --- | --- | --- |
| Hold Vol+ to open the panel | `startVolUpHold()`, `openSubCtrl()` | `startVolUpHold()`, `openSubCtrl()` | `l` |
| Tap a track | `subSelectTrack()` | `subSelectTrack()` | `t,<n>` |
| ±0.5, ±0.1 | the panel's buttons | `subOffset()` | `so,<sec>` |
| Apply | the panel's button | `subApply()` | `sa` |
| Sync, while `canSync` | the panel's button | `subSync()` | `sy` |
| Hold Apps | `startAppsHold()` | `startAppsHold()` | `k,reload` |

Each keeps the last `l,<json>` from tvapp as `subList` and draws the tracks,
the caption line and the offset from it.

The `subError` pop-up that `subsBeforePlay()` sends is shown by `App` in
`App.js` (set in `connectWs()`) and by `App.vue` (`_onSubError()`, reached
through `evtBus`). It sits over every screen and pane until Close.

## The web client's panes

The local pane (`local.vue`) is where subtitle work is started by hand.
`clickSubs()` sends the selected videos to `/api/asr/subs/enqueue` as
`fromUI`, and listens on the `subsProgress` channel until each is done.
`clickSync()` sends a selected `.srt` to `/api/syncSubToAsr`; its button only
shows when the file has an `.asr.srt` beside it (`syncAsrPath`). `applyEmb()`
copies a video's text tracks out through `/api/asr/emb/generate`. The ASR
part of the pane (`clickAsr()`, `startAsr()`, `abortAsrRun()`) queues and
stops complete ASR runs and shows their log and cost. `clickPlay()` opens an
episode in the browser player. `fetchFiles()` lists a season's `.srt` files
under its videos, and `loadInfo()` shows the counts of embedded text tracks
and `.srt` files from tv-api's `/api/local/mediainfo`.

The Queues pane (`queues.vue`) shows the sub and ASR queues from
`/api/queues` and clears them. `srvr.js` holds the calls all of these make.

## tv-down

tv-down brings `.srt` files in from usb along with the videos. In
`apps/down/src/main.js`, the usb scan does not exclude `.srt`, and
`checkFile()` lets it through. A file in a release's
`Subs/<episode>/<n>_<lang>.srt` layout whose name says English
(`SUBS_LAYOUT_ENGLISH_RE`) is known as `<episode>/<name>` and lands as
`<episode>.<name>`; an `.srt` whose name and folder give no season and
episode is skipped with one log line, never an error entry.
`checkFileExists()` lands `.SRT` as `.srt`, and takes an `.srt` only when its
episode's video is already in the season folder or on its way. Subtitle files
skip the quality gates and never count as an episode's download.

In `apps/down/src/worker.js`, `locateUsbPathByTitle()` finds a layout file on
usb by the end of its path, `promoteFile()` calls `cleanLandedSrt()`, which
rewrites a landed `.srt` through `cleanSrt()`, and `deleteReplaced()` deletes
the videos a download replaces with `vidDeleteWithSidecars()`. Once landed,
the file goes through tv-srvr's watcher like any arrival and becomes an `S`
file.

## tv-api

`apps/api/src/server.js` serves the torrent pane's Chk Subs
(`/api/tor/chk-subs`): for each torrent it asks whether the release carries
subtitles (`detectTorrentSubtitlesForTorrent()` in `torrentSubtitles.js`, from
its file list, the provider's page or its `.torrent`), and how many
OpenSubtitles releases its episodes have (`fetchEpisodeSubtitleCounts()`,
which calls tv-srvr's `/api/subsCountEpisodes`), and publishes each result on
the `chkSubsResult` channel. `/api/usb/mediainfo` and `/api/local/mediainfo`
count a file's English or untagged text tracks and the `.srt` files beside
it, for the usb and local panes.

## Scripts

| Script | What it does |
| --- | --- |
| `apps/srvr/scripts/retime-backfill.js` | Sends every unwatched library video with an `.asr.srt` through the sub queue with the `retime` mark, pausing when `/api/subsQuota` runs low and stopping on too many failures |
| `apps/srvr/scripts/delete-misfit-subs.js` | Deletes sidecars whose check says unusable or wrong cut while the file is unchanged, never an `.asr.srt`; reads `subs.db` read-only; has `--dry` |
| `apps/srvr/scripts/check-sub-origin.js` | A self-check of `subOrigin.js` against real OpenSubtitles results |
| `apps/srvr/scripts/test-audio-sync.js` | A dry run of `syncSubToAudio()` on random episodes, printing results and timing |
| `apps/srvr/scripts/test-spot-check.js` | Runs `spotCheckSubs()` on listed episodes and prints each sidecar's verdict |
