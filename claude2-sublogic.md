# New subtitle logic: problems found before implementing

Nothing was changed. Each item has a proposed answer; reply "use your
proposals" to accept them all, or correct the ones you want different.

## Blocking: the spec cannot be built without these

1. **The subtitle a video starts on is not defined.**
   - Today chksrt's history picks it (`subsForFile` in `apps/srvr/index.js`,
     `pickSubs` in tvapp's `VideoPlayer.java`). With chksrt gone nothing does.
   - It matters twice, because whatever is showing at stop becomes `chosen`.
   - `chosen` only exists on downloaded (V) entries, so picking an embedded T
     or H track on one episode cannot carry to the next.
   - Proposal: also remember the chosen *type* per show. Start on the same
     type as the show's last chosen; for V, the downloaded file that is
     same-origin with a chosen one. With nothing chosen yet: T, H, V, S, +.

2. **`file_id` is missing from subSearchInfo.**
   - `/download` takes `attributes.files[0].file_id`, and the 5-char tag in
     `.opn<TAG>.srt` is that id in base32. `subtitle_id` can do neither.
   - Proposal: add `file_id`.

3. **subSearchInfo has `episode` but no show or season.**
   - Proposal: store the show's TVDB id, season and episode.
   - Movies (`/mnt/media/movies`) are searched by title today and the spec
     does not mention them. Proposal: no subtitle processing for movies.

4. **`subsChosen` is used but never defined.**
   - Proposal: the `subsDownloaded` entries of the same show with `chosen`
     true.

5. **Where the lists live is not stated.**
   - Proposal: a new sqlite file `apps/srvr/data/subs.db`, written only by
     tv-srvr. About 15 results per episode over 2,529 videos is too much to
     rewrite as one JSON file on every change.
   - Better way: one list with `downloaded` and `chosen` flags, not two
     lists. Two copies of the same record can disagree.

6. **Episodes already on disk are never searched.**
   - The search only runs when a file is added. The 2,529 videos already in
     the library have no search results, so nothing would ever download for
     them at play.
   - A new episode added hours after it airs usually has no results yet. It
     would go to ASR and never be searched again.
   - Proposal: also search at play time whenever the episode has fewer than
     3 downloaded. Searching uses no quota.

7. **The 2,433 `.opn` files already on disk are not in `subsDownloaded`.**
   - The first play of an episode holding legacy `.opn` files would download
     up to 3 more, possibly the same files.
   - Proposal: when an episode is searched, mark results whose tag is already
     on disk as downloaded, `chosen` false.

8. **Sidecars belong to a video file; `subsDownloaded` counts per episode.**
   - When a better rip or a recode replaces the video, the new file has a new
     name and the old sidecars go with the old file. The episode still counts
     3 downloaded, so the new file gets none.
   - Proposal: count downloads per video file. A replacement downloads again
     (uses quota), since another rip's timing often differs.

## Needs a decision

9. **Does play wait for the downloads?**
   - Up to 3 downloads is a few seconds before the video starts, and longer
     when OpenSubtitles is slow or down.
   - Proposal: wait at most 8 s, then play with what has arrived; the rest
     finish in the background for the next play.
   - A failed download: skip to the next candidate, not recorded as
     downloaded.
   - The browser player (`/api/play`) uses the same `getPlayUrl`. Proposal:
     it downloads and sets `chosen` the same way as tvapp.

10. **`chosen` details.**
    - It is never cleared. A bad file that was showing at one stop stays
      chosen after you switch away from it. Proposal: at stop, set the
      showing entry true and the episode's other entries false.
    - "Stops for any reason" includes a stop in the first seconds, which
      `playProgress` treats as never played. Proposal: those do not set
      `chosen`.
    - Showing an embedded, S or ASR track, or none: no entry is set (but see
      item 1).
    - tvapp has to report the showing track in `playProgress`, so this needs
      a tvapp build.

11. **"S subtitle file added to disk".**
    - The watcher only reacts to video files today. Which video does a new
      `.srt` belong to? Proposal: the video in the same folder with the same
      SxxExx; an `.srt` with no such video is left alone.
    - The 867 legacy "other" `.srt` files: proposal is to leave their names
      and show them as S. The 497 legacy `.mb<N>.srt` (old extractions) also
      fall under "any other .srt"; proposal: show those as T.
    - "N should be index in file": proposal is ffprobe's stream index, as
      `.mb<N>` uses today.
    - A `.T<N>.srt` sidecar and its embedded track are the same subtitle, so
      tvapp would list it twice. Proposal: tvapp lists the sidecar only, so
      the panel's timing Apply works on it (it cannot shift an embedded
      track).
    - Only English or untagged tracks are extracted, as today.

12. **ASR rule.**
    - As written, a video with an S file but no T/H and no usable search
      result still goes to ASR. Proposal: keep as written, but skip when
      `.asr.srt` already exists.
    - A PGS-only video now goes to ASR; today it does not.

13. **The watcher is the only trigger.**
    - It misses files added while tv-srvr is down (`ignoreInitial`), and the
      current 6-hourly backstop sweep exists because the watcher silently
      missed files for months.
    - Proposal: keep the sweep, changed to pick up videos never processed by
      the new logic. This would also work through the existing library
      (item 6).

## Removal scope: confirm

14. **Removed under "all chksrt code" and "all opensubtitles file
    processing":**
    - Web client: the Chksrt button and count (`App.vue`), chksrt mode in
      `video-player.vue` (the player stays for intro and plain play), the
      Subs button in `info.vue`, the ChkSrt tab in `queues.vue`, the chksrt
      enqueue in `map.vue`, and the unused calls in `srvr.js`.
    - Server: `/api/asr/chksrt/*`, `/internal/chksrt/*`, the chksrt queue,
      snooze and history, `/api/opn/search`, `/api/subsSearch`,
      `/api/subsCountEpisodes`, `deleteSubFiles`, `offsetSubFiles`,
      `getSubFileIds`, the subtitle scan and opn check in the tvdb update,
      and chksrt events in `localHistory.js`.
    - Intro stills are prebuilt for shows in the chksrt queue; that falls
      back to `needsIntro` shows only.
    - Left on disk untouched: 809 `.mb.chosen` markers, `chksrt-history.json`
      (the 100 current picks, no longer read), `chksrt-snoozed.json`,
      `opn-check-history.json`.

15. **Not sure whether these go:**
    - The Subs button in the local pane (`enqueueSubs`, next to the ASR
      button). Proposal: keep it, running the new add-to-disk processing on
      the selected files.
    - `apps/api` has its own OpenSubtitles search (`server.js:598`,
      `torrentSubtitles.js`). Proposal: leave it; it is not file processing.
    - `scripts/download-opensubs-batch.js`. Proposal: delete.
    - The timing shift the tvapprc subtitle panel's Apply uses was built for
      the chksrt pane. Proposal: keep it, since the panel stays.
