# Subtitle check backfill: progress log

The subtitle checks of `srt-fix.md` run on episodes that were on disk before the
checks existed. This backfill covers only:

- library shows with an episode played in the 10 days before 10-08 16:30
  (`lastPlayedDate` on or after 09-28 16:30);
- their unwatched episodes that have a video on disk;
- videos whose subtitle files have not all been checked (no stored clips, or a
  sidecar with no verdict).

That came to 555 videos in 27 shows. Three other shows played in that time
(The Lovers (2023), Kid Sister, Stuart Fails to Save the Universe) had no
unwatched episodes on disk.

## Live status

<!-- live:start -->
Updated 10-08 18:44.

- Finished at 10-08 18:44, 2 h 13 min after it was queued.
- Done: 555 of 555 (100%), 0 still queued.
- Subtitle files: 484 fixed; verdicts good 1317, can't tell 133, unusable 52, wrong cut 13.
- Complete ASR queued for backfill videos: 0. Automatic ASR spent today: $0.42 of $20.
- Finished with no clips (no subtitle file and none downloaded): 4.
<!-- live:end -->

## How it runs

- The 555 videos were put on tv-srvr's sub queue at low priority at 10-08 16:32
  (`/api/asr/subs/enqueue` with `lowPriority`). Low-priority entries run one at
  a time, and only while no stills build, recode or ASR is running or queued.
- Each entry goes through the normal add-to-disk steps. Already-copied text
  tracks are skipped. Then `prepareVideoSubs` checks every sidecar against two
  ASR clips: it shifts or stretches files that are off, and deletes downloads
  from another cut. When nothing fits, it downloads from OpenSubtitles, and
  failing that it queues a complete ASR.
- Complete ASR started this way stops for the day at $20 (`AUTO_ASR_DAILY_USD`).
  A video put off is not marked processed and is not retried until the
  backfill or the sweep queues it again.
- Estimate: about 2.5 cents of clip ASR per video (about $14 in all, not
  capped), plus complete ASR for the roughly 1 in 20 that nothing fits (about
  $5 to $8). About 10 seconds a video when nothing else is running, so about
  2 hours.

## Checking on it

- Status, read-only, on hahnca.com: `node /tmp/bkfill/status.mjs`. It reads the
  list in `/tmp/bkfill/videos.json` and `subs.db` and gives done, queued, files
  fixed, verdict counts, today's ASR spend and per-show progress.
- What was done to each video, from this machine:
  `node unilog/query.js --id 2791 --since "2026-10-08 16:30"`.
- ASR put off by the daily cap: `node unilog/query.js --id 2796`.
- The Queues pane shows the sub queue and the entry running.

## Videos per show

<!-- shows:start -->
| Show | Last played | Videos | Done |
| --- | --- | ---: | ---: |
| Becker | 10-08 15:57 | 13 | 13 |
| Two Guys and a Girl | 10-08 15:24 | 22 | 22 |
| Comedians in Cars Getting Coffee | 10-08 15:22 | 43 | 43 |
| Last Seen | 10-08 15:20 | 4 | 4 |
| Anger Management | 10-08 11:21 | 5 | 5 |
| Not Going Out | 10-07 19:05 | 4 | 4 |
| Two and a Half Men | 10-07 18:38 | 226 | 224 |
| High Country | 10-07 18:08 | 12 | 12 |
| Childrens Hospital | 10-07 17:24 | 51 | 51 |
| Alma's Not Normal | 10-06 19:35 | 7 | 7 |
| South Park | 10-05 21:43 | 9 | 9 |
| Blue Lights | 10-05 21:07 | 6 | 6 |
| The Responder | 10-05 14:25 | 5 | 5 |
| Get Smart | 10-05 14:06 | 51 | 51 |
| The Madame Blanc Mysteries | 10-04 18:15 | 3 | 3 |
| Dying for Sex | 10-04 18:12 | 8 | 8 |
| Dark Winds | 10-04 18:10 | 8 | 8 |
| Darby and Joan | 10-04 18:08 | 1 | 1 |
| Rebus | 10-04 18:04 | 16 | 16 |
| Ballard | 10-04 17:58 | 1 | 1 |
| Kill Jackie | 10-04 16:52 | 8 | 7 |
| The Power of Parker | 10-02 17:59 | 6 | 6 |
| At Home with the Braithwaites | 10-02 17:42 | 20 | 19 |
| A Woman of Substance (2026) | 10-02 15:13 | 8 | 8 |
| Severance | 10-01 22:57 | 6 | 6 |
| Scrubs (2026) | 09-30 18:53 | 8 | 8 |
| The New Adventures of Old Christine | 09-29 17:05 | 4 | 4 |
<!-- shows:end -->

## Progress

| Time | Done | Queued | Files fixed | Verdicts | ASR spent today |
| --- | ---: | ---: | ---: | --- | ---: |
| 10-08 16:32 | 0 | 555 | 0 | | $0.00 |
| 10-08 16:33 | 3 | 552 | 0 | good 9, can't tell 1 | $0.00 |
| 10-08 16:36 | 29 | 526 | 33 | good 100, can't tell 6, unusable 21, wrong cut 3 | $0.00 |
| 10-08 16:47 | 97 | 458 | 58 | good 242, can't tell 7, unusable 50, wrong cut 5 | $0.00 |
| 10-08 16:57 | 151 | 404 | 85 | good 409, can't tell 16, unusable 52, wrong cut 5 | $0.00 |
| 10-08 17:07 | 207 | 348 | 95 | good 497, can't tell 27, unusable 52, wrong cut 6 | $0.00 |
| 10-08 17:17 | 239 | 316 | 107 | good 569, can't tell 30, unusable 52, wrong cut 9 | $0.00 |
| 10-08 17:27 | 287 | 268 | 127 | good 685, can't tell 31, unusable 52, wrong cut 10 | $0.00 |
| 10-08 17:37 | 331 | 224 | 148 | good 754, can't tell 37, unusable 52, wrong cut 10 | $0.00 |
| 10-08 17:47 | 362 | 193 | 212 | good 852, can't tell 46, unusable 52, wrong cut 10 | $0.00 |
| 10-08 17:58 | 394 | 161 | 280 | good 954, can't tell 62, unusable 52, wrong cut 10 | $0.00 |
| 10-08 18:08 | 426 | 129 | 322 | good 1028, can't tell 99, unusable 52, wrong cut 10 | $0.00 |
| 10-08 18:18 | 463 | 92 | 390 | good 1132, can't tell 107, unusable 52, wrong cut 10 | $0.00 |
| 10-08 18:28 | 504 | 51 | 428 | good 1210, can't tell 118, unusable 52, wrong cut 10 | $0.00 |
| 10-08 18:38 | 529 | 26 | 470 | good 1263, can't tell 133, unusable 52, wrong cut 13 | $0.42 |
| 10-08 18:44 | 555 | 0 | 484 | good 1317, can't tell 133, unusable 52, wrong cut 13 | $0.42 |
<!-- rows:end -->

Notes:

- 10-08 16:32: queued. The first entries started within a minute (Alma's Not
  Normal).
