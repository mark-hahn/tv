# Cover clips only where they are needed

> **How to read this.** Below is the plan word for word as you approved it on 10-23. Approved text that no longer holds is ~~struck through~~. Every place where what I built or ran differs from it, or adds something it did not say, has a note starting **CHANGED** or **ADDED**. What happened after approval is at the end, under *After approval*. Everything was stopped on 10-23 at about 01:05.

Plan as of 10-22. All numbers come from the subtitle database on hahnca.com that day: 892 videos that have stored clip transcripts and checks.

## Goal

Each video needs only one subtitle file we know is good. Known-bad files are deleted. The expensive check, cover clips heard every three minutes through the whole video, is spent only on a video that still has no known-good file after the cheap checks and every free OpenSubtitles download have been tried.

The deployed code hears cover clips for nearly every video it checks, because it does so whenever both main clips pair well. That costs about 8 cents more per video and catches almost nothing in files that needed no fix. This plan replaces it.

## What the tests showed

| Group tested | Files | Caught by cover clips |
|---|---|---|
| OpenSubtitles downloads that passed two clips with no fix, most from 20 videos of 20 shows | 37 | none |
| Embedded tracks, ASR files and files that arrived with the video, passed two clips with no fix | 70 | none |
| Shifted by the two-clip check | 2 | none |
| Stretched by the old three-clip check | 14 | 11 wrong cut, 1 needing another stretch |
| Timed by hand after a stretch | 1 | wrong cut |
| Can't tell | 2 | 1 wrong cut |

Every file the cover clips caught had been stretched, timed by hand, or left as can't tell. A middle clip settles most shifted files without cover clips. Of 47 shifted files whose video already had a stored middle clip, 35 agreed with their shift, 10 were wrong cut (7 with the middle clip 0.4 to 1.7 seconds off the shift, 3 scattering in a main clip), and 2 lay on a sloped line like a file at another rate.

## Verdicts

A file is known good when any of these holds:
- its two main clips agree on an offset inside the good window, so it needs no fix;
- ~~its two main clips agree on a shift outside that window, and the middle clip agrees with the same shift;~~

  > **CHANGED:** an agreeing middle clip does not confirm a shift. A shifted file needs every cover clip to fit, as a stretched one does. The dry test the plan called for found 10 of 35 such files from another cut (see *After approval*). The plan's fallback was to add a cold-open clip, which would have caught 3 of the 10. I made this change myself, without asking you first.

- it was retimed to fit the video's ASR file, which matched over the whole file;
- it fit every cover clip with one shift or one stretch line;
- it matches a known-good file of the same video in every part of its length (see the next section).

A file is known bad when any of these holds:
- its text is unusable: too few dialogue cues a minute, or not English;
- the clips can't tell, and its lines run more than 5 seconds past the end of the video;
- the lines of any heard clip scatter more than ±400 ms;
- two main clips that agree on a shift, with the middle clip off that shift;

  > **ADDED:** when the three clips lie on one sloped line, the file is taken for one at another rate instead: a stretch candidate, open until the cover clips settle it. The plan's own count had 2 such files.

- two main clips that disagree, with the middle clip off the line through them;
- after cover clips, no one shift or stretch line fits every clip;
- retime found no shift that fits the ASR file.

A file is open when it is a stretch candidate whose middle clip lies on the line, a shift candidate whose middle clip did not pair well, or a file timed by hand. A file a person timed by hand stays open because our checks had passed it and a person still found it off.

> **CHANGED:** with the change above, every shifted file is open until its cover clips are heard, and so is a file whose two main clips disagree before a middle clip is heard.
>
> **ADDED:**
> - A file timed by hand that does not fit its clips at all is stored as "fixable", with no ✓, as such a file was left unchecked before. A later pass may shift it.
> - An open file still has its shift or stretch written to the file.
> - When the video has an ASR file, an open file is first tried against it (retime), and one that fits is good.

Can't tell stays as it is.

## Stages per video

| Stage | When it runs | What is heard | Cost |
|---|---|---|---|
| 1. Main clips | every video with English audio and at least one usable subtitle file | the two busiest clips of the first and last thirds | 2.5 cents |
| 2. Middle clip | no file is known good after stage 1, and some file wants a shift or a stretch | one clip in the middle third | 1.3 cents |
| 3. Downloads | no file is known good after stage 2 | nothing new; every OpenSubtitles result for the episode not yet tried is downloaded one at a time and judged with the clips already heard | free, but counts against OpenSubtitles' 1,000 downloads a day |
| 4. Cover clips | no file is known good after stage 3, and an open file is left, one already there or a download that wants a stretch | one clip in each three-minute part not yet heard, the cold open and last scene included | about 8 cents |
| 5. Complete ASR | no file is known good after stage 4 | the whole video, under the $20 daily cap | about 14 cents a half hour |

> **CHANGED:**
> - Stage 2 runs when a file wants a shift, or when a file's two main clips disagree. A file stretched in an earlier check goes straight to stage 4, since its middle clip would only sit on its line.
> - Stage 4 also takes shifted files, after the change above.

Downloads come before cover clips because they cost nothing and ASR does. Each download is judged as it lands, in the existing candidate order, and the stage stops at the first one that is known good. ~~A download that wants a shift is settled by the middle clip, which is heard then if the video skipped stage 2.~~ **CHANGED:** for a download that wants a shift, the middle clip is still heard if the video has none. One it does not agree with is bad; one it agrees with stays open for stage 4. One that wants a stretch is kept as an open file for stage 4. One that is bad is deleted and marked unfit. Results already marked unfit and foreign-parts-only ones are skipped. The 1,061 episodes searched so far average 4.7 results each, 116 have ten or more, and the most is 29. A download refused because the day's quota is used up puts the video off until the next day; it does not send the video on to cover clips.

> **ADDED:** the retime pass's own downloads stay capped at five, as before.

Clips are cut from the video's audio and heard once per video, not once per file. Judging a file against clips already heard is only a comparison of text, which costs nothing and takes milliseconds. So every file of the video is judged at each stage, and that finds the known-bad files to delete and the open ones to demote. The video stops at the first stage that leaves it with a known-good file. Known-bad files are deleted at whatever stage finds them, and an OpenSubtitles download is also marked unfit for the video. The middle clip counts as one of the cover clips, so no clip is heard twice.

> **ADDED:** a video too short for any cover clip to be placed hears none, and its shifted and stretched files are judged on the clips already heard.

## Rules around the stages

**Fix history.** Each file keeps a record of the strongest fix ever applied to it, whether by our checks or by a person: none, shift, stretch, or hand timing. The record survives re-judging. A stretched file rewritten on disk passes two clips with no fix, and without this record it would count as known good; that is how the bad Becker S02E02 download would slip through. A one-time migration seeds the record from what the checks already note about each file.

> **ADDED:**
> - A Sync from the local pane counts in the record as a shift or a stretch, and so does the shift the comparison below makes.
> - Every fix logged since the checks began was still in the checks' notes, so the seed missed nothing.

**As many ✓ as possible, for free.** No download and no new clip is ever spent just to confirm a file, but everything already at hand is used to confirm as many files as it can:
- Every file is judged against every clip its video has heard, at any stage and for whichever file it was heard. A video that heard cover clips for one file gets all its files judged against them, and each one they confirm gets a ✓. A stored middle clip that shows a no-fix file to be off makes that file bad.
- A file the clips leave open is then compared with the video's known-good file over its whole length:
  - Cues are paired by their first five words where those occur once in each file, and the pairs are grouped into parts of about three minutes, as the cover clips are.
  - When every part shows the same difference within 250 ms, nothing scatters, the first and last parts are covered, and at least 80% of the parts have five pairs or more, the file gets a ✓. ~~If the difference is not zero, a shift lines it up.~~ **CHANGED:** the file is shifted only when, as it is, it would fall outside the good window, −250 to +500 ms. A smaller difference is left alone.
  - When some part differs, or too few cues pair, the file gets no ✓. It is not deleted either, since in a part where two files differ either one could be the file that is off.
- This comparison runs again whenever a video gains a known-good file, for instance from a download or after cover clips.

  > **ADDED:** files that can't be told are compared as well as open ones; the table below already counted them. The comparison is made only against files confirmed by their clips or a retime, never against one confirmed by another comparison.

- A file still without a ✓ is listed after the files with one and is never the start pick unless a person chooses it.

  > **ADDED:**
  > - Such a T or H file is listed with the T and H files that can't be told, ahead of the rest.
  > - "A person chooses it" means picking it from the subtitle menu while playing. A pick saved from an earlier play does not bring it back to the start while a file with a ✓ exists.

In the library today 459 files sit beside a known-good file with nothing to confirm them from their clips:

| Result of the comparison | Files |
|---|---|
| Same timing as the known-good file in every part: ✓ | 178 |
| Differs in some part: no ✓ | 253 |
| Too few cues pair: no ✓ | 28 |

Of the 178 that match, 90 had been stretched, 79 shifted, 5 timed by hand and 3 were can't tell. Of the 253 that differ, 231 had been stretched, which fits what the cover clips found about stretches.

The comparison was checked against the 12 files that have both a verdict from cover clips heard from the audio and a known-good file beside them. It agreed on 11, wrongly confirmed none, and left one good file unconfirmed for too few pairs: Severance S02E06's download, whose first and last parts are not covered.

**Sync from the remotes.** Sync never hears cover clips. ~~It hears at most the middle clip, so it stays well inside the TV's three-minute wait.~~ **CHANGED:** it hears only the two main clips, and only when the video has none.

**Files that arrive later.** In a video that already has a known-good file, a new file is judged against the clips already heard and compared with the known-good file, and it never causes a new clip. If neither confirms it, it gets no ✓. In a video without one, the new file goes through the stages.

> **ADDED:** the watcher itself hears no clip. It queues the video for a whole pass at the back of the queue, and that pass runs the stages. A timing by hand that fits but is not yet confirmed does the same.

## Backfill of the library

> **CHANGED:** the backfill did not run stage by stage over these 892 videos. Each video got one whole pass with all its stages, one video at a time through tv-srvr's queue. The judging against stored clips (step 1) is that pass's first step. The scope also changed, at your word: see *After approval*.

**Step 1, free pass, no ASR.** Every checked file is judged again against the clips already stored, with its fix history:

| Result | Files |
|---|---|
| Known good | 1,321 |
| Newly known bad | 141 |
| Shift candidates still waiting for a middle clip | 229 |
| Open: stretched, timed by hand, or a stretch shown by a stored middle clip | 402 |
| Can't tell | 40 |
| Already bad before | 156 |

The 141 newly bad files break down as follows:
- 107 were can't tell and now fail the scatter rule. 97 of them are OpenSubtitles downloads whose video has a known-good file, 5 are embedded tracks, 1 is an ASR file and 1 arrived beside the video. Only 4 are in videos with no known-good file.
- 25 were shifted, stretched or timed by hand, and now scatter or have a stored middle clip off their shift.
- 3 had needed no fix:
  - Children's Hospital S05E07's embedded track and the file that arrived beside it scatter ±434 ms in one clip.
  - Two and a Half Men S11E16's embedded track has a stored middle clip 0.5 seconds off. This is the first no-fix file seen to fail three clips, and it has not been confirmed by listening.

The comparison with the known-good file then gives a ✓ to 178 more files, as the table in the rules above shows. It changes no video's stage, because every file it confirms is in a video that already has a known-good file.

After the free pass the videos sort like this:

| Videos | State after the free pass | Next |
|---|---|---|
| 725 | have a known-good file | nothing heard |
| 114 | their only open files are shift candidates | stage 2 |
| 43 | have stretched or hand-timed files and nothing known good | stage 3, then stage 4 if no download is good |
| 10 | have nothing left to test | stage 3 |

**Step 2, middle clips.** These go to the 114 videos. ~~At the rates seen in the 47 already judged, about 84 end with a known-good file, about 24 lose their shifted file as wrong cut, and about 5 become stretch candidates. The last two groups go on to downloads.~~

> **CHANGED:** with shifts needing cover clips, a middle clip that agrees no longer ends a video's checks. It goes on to downloads and then cover clips, which costs about $9 more over these videos.

**Step 3, downloads.** About 82 videos reach this step, with about 3 untried results each on average, so at most about 250 downloads, well inside one day's quota. Of the downloads judged so far, about 20% passed with no fix and about 11% wanted a shift, which the middle clip confirms about three times in four. That makes roughly 28% of downloads known good. Downloads of one episode tend to share a source and fail together, so a guess is that 40 to 60% of these videos find one.

**Step 4, cover clips.** These go to the videos still without a known-good file that have an open file, about 35.

**Step 5, complete ASR.** This goes to the videos where nothing passed, about 30.

| Item | Videos | Cost |
|---|---|---|
| Middle clips | 114, plus a few for shifted downloads | about $1.50 |
| Downloads | about 82, at most about 250 downloads | nothing |
| Cover clips | about 35 | about $3 |
| Complete ASR | about 30 | about $7, under half a day's $20 cap |
| **Total** | | **about $4.50 of clips, plus about $7 of complete ASR** |

> **CHANGED:** about $13 to $15 of clips after the shift change, for the same videos.

The deployed approach would spend about $75 on cover clips for the same library before any complete ASR.

The run is driven from a script outside tv-srvr, so a deploy cannot stop it. **ADDED:** it waited while OpenSubtitles had fewer than 20 downloads left for the day, and while automatic ASR was within a dollar of its daily cap. Its entries queue behind all other batch work, as the six-hourly sweep's entries do. Middle clips take about 35 minutes in all, downloads a few minutes at OpenSubtitles' rate limit, and cover clips about 35 minutes. Complete ASR runs out within a day.

## New videos from now on

If new videos look like the library, about 81% end at stage 1 and 13% at stage 2. About 6% reach downloads, and only those for which no download is good go on to cover clips. That averages under 3 cents of clips a video, against about 10.5 cents with the deployed code.

> **CHANGED:** about 4 cents a video once shifted files need cover clips.

## Risks

| Risk | Size | What covers it |
|---|---|---|
| A shifted file that passes three clips but is off in the cold open or the ending, where none of the three clips sits | Unmeasured. Both shifted files ever tested with cover clips were fine. Another release with a different-length title sequence after the cold open would look exactly like this. | A dry cover-clip run on the 35 shifted files that passed three clips, before the backfill, about $3. ~~If any fail, stage 2 also hears a clip at the cold open.~~ **CHANGED:** it ran, 10 failed, and shifted files now need cover clips. |
| A no-fix file that is off outside its two clips | None found in 107 tested. One embedded track fails a stored middle clip, unconfirmed. | Accepted. Stored middle clips are used whenever they exist. |
| Fix history lost when a file is re-judged | Would let a stretched file pass as no-fix | The durable fix record, seeded from today's notes |
| The scatter rule deleting borderline files | Old Christine's embedded tracks at ±414 ms, Children's Hospital's at ±434 ms. A deleted embedded track is never copied out again. | A decision below. **Decided:** kept at ±400 ms. |
| A file without a ✓ beside a known-good file being bad | 281 files after the comparison | No ✓, listed after the others, never the start pick |
| The comparison confirming a bad file because its known-good file is off in the same place | None seen in the 12 checked against the audio. Two files from the same source can share a fault. | Accepted. The known-good file was itself confirmed by the clips. |

## Order of work

1. Run the dry cover-clip test on the 35 shifted files that passed three clips, and settle the stage 2 placement from it. **Done; it led to the shift change above.**
2. Change the checks to the stages above. That includes the fix history and its migration, the comparison with the known-good file, the demotion of files without a ✓, Sync limited to the middle clip, and the rules for files arriving later. **Done, with the changes marked above. It is deployed and still live for videos that land; nothing is committed.**
3. Deploy, check the server logs, and run the dry check on a handful of videos from each stage to see each one stop where it should. **Done, on three videos.**
4. Run the free pass, with the comparison.
5. Run the middle clips, then the downloads, then the cover clips, then let the complete ASR run out.

   **CHANGED:** steps 4 and 5 ran as one pass per video, over 88 videos, and are stopped. See *After approval*.
6. Update the Subtitles section of the project instructions, once you say so.

## Decisions needed

1. The 281 files left without a ✓ beside a known-good file: demote them (recommended), delete them, or leave them as they are. **You chose: demote.**
2. Run the $3 dry test on the 35 shifted files before building, as step 1 says (recommended). **You chose: run it.**
3. Files timed by hand: open, needing cover clips when nothing else is known good (recommended), or treated like a shift. **You chose: open.**
4. The scatter rule: keep ±400 ms for every file, or allow embedded tracks more room, since a deleted embedded track never comes back. **You chose: keep ±400 ms.**
5. Whether the backfill's free pass may delete the 141 newly bad files without a list being reviewed first. **You chose: delete without review.**

> **ADDED:** 6. A shift needs cover clips, as a stretch does. This one was taken by me, not you, from the dry test.


## After approval

### The dry test of the shifted files

Cover clips were heard for the 35 shifted files whose middle clip agreed:

| Result | Files |
|---|---|
| Good | 20 |
| Needed a stretch | 5 |
| From another cut | 10 |

Where the 10 were off, and what each rule would have caught:

| Where the file was off | Files |
|---|---|
| At the very start | 3 |
| Between the cold open and the first main clip | 2 |
| In the last scene | 3 |
| In several places | 2 |

| Rule for a shifted file | Of the 10, caught | Clips per shifted video |
|---|---|---|
| Middle clip agrees (the plan) | 0 | 1, 1.3 cents |
| Middle and a cold-open clip (the plan's fallback) | 3 | 2, 2.5 cents |
| Middle, cold open and last scene | 8 | 3, 4 cents |
| Cover clips (what was built) | 10 | about 6.5, 8 cents |

### The runs

You asked for every unwatched episode, 2,077 videos. 1,235 of them had never been checked, because they were processed before the checks existed.

| Unwatched episodes on 10-23 | Videos |
|---|---|
| Checked before, with a known-good file | 654 |
| Checked before, with nothing known good | 156 |
| Never checked | 1,235 |
| No subtitle file at all | 32 |

The first run, in alphabetical order, did 73 videos, from 3rd Rock from the Sun to Becker season 2. Then, at your word, it was restarted on the 20 most recently viewed shows with unwatched episodes, and did 15 more, in Slow Horses, Smoggie Queens and Becker season 2. You then asked for everything to be stopped.

| Over the 88 videos | |
|---|---|
| Files confirmed good | 134, 8 of them by the comparison |
| Files deleted as bad | 75, nearly all downloads from other cuts |
| Files left open | 2 |
| Files that can't be told | 10 |
| Clips heard | 86, about $1.09 |
| Videos sent to complete ASR | 13 |
| Automatic ASR spent on 10-23 | $1.90 |

### Problems found and fixed during the run

- **Fixed files missing their ✓.** A stretched file confirmed by its cover clips was judged once more after the stretch. It read as needing one more small stretch, which kept it from its ✓ and queued its video for complete ASR. Fixed within minutes; the one video it touched, 3rd Rock from the Sun S03E19, was run again and both its files have their ✓.
- **Rewrites taken for hand timings.** The watcher could take a file these checks had just rewritten for a timing by hand, which would mark it as needing cover clips for good. It had not happened, and it can't now.
- **Complete ASR jobs cut off.** My redeploys of tv-srvr cut off two complete ASR jobs:
  - 3rd Rock from the Sun S03E19's was not needed after the fix.
  - Accidentally on Purpose S01E17's was queued again and finished.

### Where things stand

- **Stopped:** the driver, the subtitle queue and the ASR queue, the last ASR job aborted.
- **One video with no subtitle file:** Becker S02E21. Its 3 files were deleted as from another cut, and its complete ASR was the job aborted.
- **Still live:** the staged checks are deployed, so videos that land are checked by them.
- **Not done:** nothing is committed, and the project instructions still describe the old checks.
