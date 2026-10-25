# Subtitle vetting from a complete ASR: implementation plan

Written 10-24. This replaces the clip-based subtitle checks. Episodes move to it slowly, at two levels:
- **Full vetting:** a complete word-timed ASR, then every subtitle file judged against the transcript by the rules below and either kept or deleted. Every kept file is retimed by its fix line; a file whose only fault is missing stretches is retimed and then has those stretches filled from the transcript.
- **Cheap vetting:** no ASR. The episode gets its subtitle files, cleaned but not judged.

## Vetting

**Subtitle vetting** is the name of this whole process for one episode: the complete ASR, judging every subtitle file, and keeping, filling or deleting them. An episode that has been through it has its **subtitles vetted**. Inside subtitle contexts (this plan, the subtitle code, the subtitle panels) the short forms "vetting" and "vetted" are fine. Anywhere else, say "subtitle vetting" or "subs vetted", since "vetted" alone doesn't say what was vetted.

The rules and constants in this plan are **vetting version 1**, so an episode vetted by them is **vetted v1** (outside subtitle contexts: **subs vetted v1**). Any later change to a rule or constant raises the version. An episode vetted under an older version counts as not vetted, and is vetted again the next time it would be (see When vetting runs).

Use the name throughout:
- functions that vet an episode's or a file's subtitles;
- a log group "subs vet", since logs mix every subsystem;
- "vetted" or "not vetted" in subtitle panels and pop-ups, and "subs vetted" anywhere else.

## Vetting levels

| Level | What it does | ASR |
|---|---|---|
| **full** | The full vetting flow below: every file judged, then kept and retimed, filled, or deleted. | one complete ASR |
| **cheap** | Nothing is judged. Embedded text tracks are copied out, every subtitle file is cleaned and has glued words split, and old subtitle files are kept as they are. When the video has no embedded text track and no OpenSubtitles download yet, the first candidate in the existing candidate order is downloaded: one, never more. | none |
| **cheap, with an old `+` file** | Cheap, and also every file judged against the old `+` file (see Judging against an old `+` file). Good files are retimed and get a ✓. Bad files are kept, without a ✓. A file whose only fault is missing stretches is retimed and filled from the `+` file. It is recorded as cheap and handled wherever cheap episodes are. | none |

- **Timing:** the files of a cheap episode play like any others, but without a ✓ (apart from those an old `+` file judged good), and their timing may be off.
- **Download limit:** cheap downloads stop for the day while OpenSubtitles reports fewer than 200 downloads left, so plays keep theirs.
- **Nothing to show:** a cheap episode left with no subtitle file at all is cheaply vetted again at its show's next update.

## When vetting runs

| When | What is vetted |
|---|---|
| tv-srvr's tvdb update task reaches a library show (its per-show step) | The show's **next two** episodes are fully vetted, unless already fully vetted v1 for their current video. Every other episode of the show with a video, not vetted v1 at either level for its current video, is cheaply vetted. |
| An episode is watched to the end | The show's next two episodes are fully vetted, unless already fully vetted v1 for their current video. |
| A video or subtitle file lands, a play starts (of next-up or any other episode), the library sweep | Nothing. The existing add-to-disk steps (copy-out, naming, glued words) still run when a video lands, but nothing is judged and no ASR is made. |

- **The next two:** the show's next-up (its first unwatched episode with a video, in story order, specials included) and the first unwatched episode with a video after it.
- **No backfill.** The sweep vets nothing, and full vetting happens only for each show's next two episodes.
- **Upgrades:** a cheap episode is fully vetted once it becomes one of its show's next two. A fully vetted episode is never vetted cheaply again while its video stays the same.
- **Later files:** subtitle files that arrive later for a fully vetted episode (play-time downloads, prefetches, a manual copy) are judged against its stored transcript at no ASR cost, the next time its show is updated.

## What counts as a good file (user's rulings)

| Situation | Verdict |
|---|---|
| After one shift-and-stretch fix, every stretch is within about 0.5 s of the speech | good |
| A minute about 0.5 s off | good; it must not fail a file |
| A song over the end credits, or a "next time" preview, left uncaptioned | good |
| A song left uncaptioned that another file of the episode captions with ♪ | good |
| A "previously on" recap left uncaptioned | **missing**: recaps matter |
| Any 2 minutes of dialogue left uncaptioned | missing |
| A file whose only fault is missing stretches | **filled**: retimed like a good file, then each missing stretch captioned from the transcript; used only when the episode has no complete good file |
| A stretch shifted against the rest (another cut), another episode's file, not English | bad |

## Full vetting flow per episode

| Step | What happens |
|---|---|
| 1 | As now: embedded text tracks are copied out, arriving files named, glued words split. |
| 2 | A complete ASR of the English audio is made, unless the video already has one. The word-timed transcript is stored, and the `+` file is made from it as now. |
| 3 | Every embedded copy (T, H) and every file that arrived with the video (S) is judged. All good ones are kept and fixed; bad ones are deleted. |
| 4 | If none is good: OpenSubtitles candidates, in the existing candidate order, are downloaded and judged one at a time, up to 5. The first good one is kept and fixed. Bad ones are deleted and marked unfit for the video. |
| 5 | If still none is good, but some file judged in steps 3–4 has only missing stretches: the first such file (embedded and arrived files before downloads, downloads in order) is filled and kept. Every other file with missing stretches is deleted. |
| 6 | If none is good or fillable: the `+` file is the episode's subtitle. |

Files with missing stretches wait until steps 3–4 finish. When a complete good file is found, they are deleted like bad files.

- **Queued, never waited on:** the complete ASR is queued under the automatic ASR cap, and play never waits for it.
- **Unchanged:** videos with no English audio keep today's path (T and H presumed good, the rest by whole-file audio matching), movies get no processing, and the `+` file itself is never judged.

## The judge

The judge works on one file. Its inputs are:
- the file's captions;
- the video's transcript;
- the ♪ stretches of the video's other files that have been judged, each placed in video time when that file was judged. These are stored with each check, so they survive the file's deletion.

It returns:
- the verdict: good, missing or bad, and for a bad file the reason;
- for a good or missing file, the fix line: video time = a + b × file time;
- for a missing file, the windows the missing check failed;
- this file's own placed ♪ stretches, to store with its check.

**Text.** Caption and transcript text are lowercased. Tags in angle brackets and braces, text in square brackets and parentheses, ♪, and all characters other than letters, digits and spaces are removed, and the result is split on spaces. Captions left with no words are dropped. Transcript entries that are words (not punctuation) keep their start and end times.

**Steps.** The first step that fails decides the verdict.

| # | Step | Rule |
|---|---|---|
| 1 | Unusable | Fewer than 3 captions per minute of video, or common English words under 18% of the file's words, is bad. |
| 2 | Find the line | Pair the clean cues of the file and the transcript (below). Fewer than 10 pairs is bad. Otherwise fit the line through them (below). |
| 3 | Spot rule | With each pair's residual (heard time minus where the line puts the caption): two pairs within 60 s of heard time, both more than 500 ms off and within 300 ms of each other, is bad. |
| 4 | Refit | Make dense pairs with the step-2 line (below) and fit the line again through them. This is the fix line; if the fit fails, keep the step-2 line. Remake the dense pairs with the fix line. |
| 5 | Minute check | For each dense pair in heard-time order, take it and the pairs in the next 60 s. 8 or more pairs whose median residual is more than 500 ms off is bad. |
| 6 | Missing check | Place every caption start with the fix line. Any 120 s window, stepping 10 s from the start of the video, with 40 or more counted heard words and no caption start makes the file missing, with those windows. |
| 7 | Good | The file is rewritten with every start and end moved by the fix line, through the subtitle cleaner, never below 0. |

**Clean cues (step 2):**
- A file cue is the first 3 words of a caption that has at least 3 words and starts 1 s or more after the previous caption ends, provided those 3 words don't occur in any caption starting within 10 s.
- A heard cue is 3 consecutive transcript words whose first starts 1 s or more after the previous word ends, provided the same 3 words don't start again within 10 s.
- A pair joins a file cue and a heard cue with the same 3 words when those words occur exactly once among all 3-word runs of the whole file and exactly once in the whole transcript. There is no time window.

**Dense pairs (step 4):**
- Every caption with at least 3 words whose first 3 words occur in no other caption starting within 10 s.
- It pairs with the transcript's 3-word run that has the same words and starts within 2 s of where the line puts the caption, if there is exactly one.
- On good files this gives about 10 pairs a minute, against 2–3 for clean cues.

**Line fitting (steps 2 and 4).** RANSAC with a fixed seed, so verdicts repeat:
1. 400 times, take two random pairs at least min(120 s, a quarter of the pairs' span) apart.
2. Skip the draw unless the stretch between them is between 0.9 and 1.1.
3. Count the pairs within 500 ms of that line, and keep the line with the most.
4. If no draw qualifies, start from stretch 1 and the median offset.
5. Twice, refit by least squares through the pairs within 500 ms of the current line. With fewer than 2 such pairs, the fit fails.

**Counted heard words (step 6).** Every transcript word counts, except:
- words after the file's last caption start (placed by the fix line) that fall in the video's last 6 minutes: end material;
- words inside any other file's placed ♪ stretch, padded 1 s each side: lyrics another file marks as song. A file contributes ♪ stretches only if its own step-2 line was found.

There is no start exemption, because recaps matter.

## Gap filling

This applies to a file the judge calls missing: it passed steps 1–5 and failed only the missing check.

1. Place every caption with the fix line.
2. Each failing window lies between two neighbouring caption starts. Its stretch runs from the end of the caption before it (or the start of the video) to the start of the caption after it (or the end of the video).
3. The fill takes the stretch's counted heard words, with the same exemptions as step 6, leaving out words within 200 ms of either bounding caption.
4. The words are grouped into captions in order. A new caption starts at a pause of 700 ms or more, when the caption would pass 6 s, or after 12 words.
5. Each caption ends 300 ms after its last word, but at least 50 ms before the next fill caption starts.
6. The text is the transcript's words as the `+` file shows them, with no marking.
7. The fill captions are merged with the file's fixed captions, and the file is rewritten through the subtitle cleaner. Its check records it as filled, with the filled stretches, and it is offered with a ✓ like any good file.

A filled file passes the missing check by construction; all 11 filled in the measurements did. The thresholds stay those of the missing check. A lower one (1 minute, 20 words) also filled some 1-minute cuts, but it put theme songs, humming and foreign-language dialogue into files that were fine.

## Judging against an old `+` file

Some videos already have a `+` file from an earlier complete ASR, but not its word-by-word times. A cheap vetting of such an episode runs the judge with the `+` file in place of the transcript, using only its caption start times. No word time is ever estimated.

| Judge part | With an old `+` file |
|---|---|
| Heard cues (step 2) | The first 3 words of each `+` caption that starts 1 s or more after the previous one ends, if those 3 words occur in no `+` caption starting within 10 s. Uniqueness for pairing is over the whole `+` text. |
| Dense pairs (step 4) | A subtitle caption's first 3 words against the first 3 words of the one `+` caption starting within 2 s of where the line puts it. |
| Missing check (step 6) | Each `+` caption's words count at the caption's start. |
| Gap filling | The `+` captions inside the stretch are copied in, as they are. |

This judge is weaker than full vetting. Only about half the subtitle captions find a `+` caption start to pair with, so it misses more short stretches that are off. That is why files it judges bad are kept, without a ✓.

**Common English words (step 1):** the you i to a and it is that of what me in this we my your dont on have be no not know just for he was with are do so all can get its im like okay yeah oh well right here there they she him her but go up out now how why who will if at about one want think got come.

## Constants

| Constant | Value |
|---|---|
| Unusable: captions per minute; common-English share | 3; 18% |
| Pause before a cue; repeat window for uniqueness | 1 s; 10 s |
| Minimum clean pairs | 10 |
| RANSAC: tolerance; draws; stretch range; draw spacing | 500 ms; 400; 0.9–1.1; min(120 s, span ÷ 4) |
| Spot rule: neighbour window; off by more than; agreeing within | 60 s; 500 ms; 300 ms |
| Dense pairing window | 2 s |
| Minute check: window; minimum pairs; fails above | 60 s; 8; 500 ms |
| Missing check: window; step; minimum counted words | 120 s; 10 s; 40 |
| End exemption; lyric padding | last 6 min, after the last caption; 1 s |
| Gap filling: margin from bounding captions; new caption at a pause of; longest caption; most words; caption end after last word; gap before next | 200 ms; 700 ms; 6 s; 12; 300 ms; 50 ms |
| ASR | Speechmatics, enhanced, English, word times; about $0.38 an hour of audio |

## Episode subtitle-vetting fields in the show records

These fields record each episode's subtitle vetting in the show records, alongside the other episode fields (aired, watched, file, lastPlayed and so on). Like those, they are flat, named fields, left out when empty. They carry the `subs` prefix because a show record holds much more than subtitles.

| Field | Value | Meaning |
|---|---|---|
| `subsVetted` | integer | The vetting version the episode was vetted under, at either level: 1 for vetted v1. Left out when the episode has not been vetted. |
| `subsVetLevel` | `cheap` or `full` | The level it was vetted at. An episode vetted with an old `+` file is `cheap`. |
| `subsVettedAt` | PST "YYYY/MM/DD HH:mm:ss.mmm", as `lastPlayed` | When it was vetted. |
| `subsVettedFile` | the video's file name, in the same form as `file` | The video it was vetted for. When it no longer matches `file` (the video was replaced or renamed), the episode counts as not vetted. |
| `subsVettedResult` | `own`, `download`, `filled`, `asr` or `none` | What the episode was left with. `own`: a file that came with the video (an embedded copy or a file that arrived beside it). `download`: an OpenSubtitles download. `filled`: a file with its missing stretches filled. `asr`: only the `+` file. `none`: no subtitle file at all (cheap only). For a cheap episode it names the best file it has, judged or not. |

- tv-srvr writes these when it vets an episode. They are stored fields, not computed ones.
- An episode counts as vetted v1 when `subsVetted` is 1 and `subsVettedFile` matches `file`. It counts as fully vetted v1 when `subsVetLevel` is also `full`.
- **Stored in the show records:** each vetting writes these five fields to the episode's record, through tv-srvr's normal episode-data saves.
- **Which episodes get them:** only the episodes vetted as set out in When vetting runs. There is no backfill.

## What changes in the app

| Area | Now | After |
|---|---|---|
| ASR | two 2-minute clips per video, a middle clip when needed, a complete ASR only when nothing fits | one complete ASR per fully vetted episode (for now only each show's next two), stored word by word; no clips |
| When a video lands | add-to-disk steps, then the clip checks, then ASR when nothing fits | add-to-disk steps only (copy-out, naming, glued words); no judging, no ASR |
| Vetting triggers | none | the tvdb update task's per-show step, and the end of a watch |
| Verdicts | good, fixable, wrong cut, can't tell, unusable | good (fixed by its line); missing (filled, if it is the episode's best); or bad with a reason: unusable, too few pairs, spot, minute. Cheap episodes' files are unjudged, apart from an old `+` file's verdicts. |
| Retime pass | shifts one file to fit the `+` file | retired: every good file is fixed by its own line |
| Later arrivals | judged from the stored clips, sometimes hearing a middle clip | judged from the transcript, free, at the show's next update (fully vetted episodes); left unjudged on cheap ones |
| Remotes' Sync, local pane Sync | measured from clips, or by the `+` file | measured from the transcript with the same line and dense pairs where the episode has one; elsewhere as now |
| What a play offers | ✓ files first, then unjudged T and H, then unchecked files | the same order. ✓ means judged good by these rules (full vetting or an old `+` file). The old clip checks' ✓s are dropped, so those files count as unchecked. |
| Library sweep | queues unprocessed videos | queues them for the add-to-disk steps only; it never vets |
| Stored clip transcripts, clip verdicts, retime records | kept | no longer made or used; left in place |

- **Deletions:** full vetting deletes the files it judges bad, and logs each deletion with the show name and the reason.
- **Cheap episodes** (including those with an old `+` file) delete nothing.

## Expected results

These were measured on two random sets of 100 library episodes: a training set, and a test set from 64 shows not in training. The truth is an independent whole-line match against the complete transcript, with your rulings applied. The three logics compared:
- **Earlier clip proposal:** the clip-based design proposed before this work (three-point clip test plus cover clips), not the live checks.
- **Best clip variant:** the best clip-based logic found here, which adds a fitted shift-and-stretch line, cover clips heard at once, and the part check.
- **This plan:** the complete-ASR logic above.

| | Bad kept, training | Good thrown away, training (of 322) | Bad kept, test | Good thrown away, test (of 371) | Test episodes left with only the `+` file | ASR cost against a complete ASR of every episode |
|---|---|---|---|---|---|---|
| Earlier clip proposal | 3 | 120 | 0 | 92 | 20 | 83% |
| Best clip variant | 1 | 33 | 5 | 47 | 11 | 75% |
| **This plan, before gap filling** | **0** | **16** | **0** | **18** | **6** | 100% |

Ten files leave out a recap: one in training and nine in test. They count as bad above, and this plan rejects all ten before filling.

**With gap filling:**

| | Training | Test |
|---|---|---|
| Files filled | 2 | 9 |
| Missing recaps filled | 1 | 9 |
| Files with a mid-episode song filled with its lyrics as heard | 2 | 0 |
| Good files thrown away | 15 | 18 |
| Episodes left with only the `+` file | 21 (was 22) | 5 (was 6) |

The recaps of The Night Of S01E05 (all 8 downloads) and The Tourist S02E04 were filled with their dialogue. Both Due South S01E08 downloads were filled: one with its recap, and both with "Que Sera, Sera", which no file of that episode captions.

After the fix, files this plan accepts are off in their worst 3-minute part by:

| | 250 ms or less | 250–500 ms | Over 500 ms |
|---|---|---|---|
| Training | 304 | 20 | 0 |
| Test | 353 | 9 | 0 |

**Planted defects.** 165 good files, about 30 defects each, with known answers:

| Planted defect | Caught |
|---|---|
| 1-minute stretch shifted 0.6 / 1 / 2 s | 84% / 92% / 82% |
| 2-minute stretch shifted 0.6 / 1 / 2 s | 93% / 99% / 95% |
| 5-minute stretch shifted 0.6 / 1 / 2 s | 90% / 99% / 99% |
| Everything after a point shifted 1 / 3 s (another cut) | 92% / 98% |
| Scene removed: 1 / 2 / 4 / 8 minutes | 1% / 45% / 100% / 100% |
| Another episode's or show's file | 100% |
| Controls: whole file shifted, or stretched by a frame-rate ratio | 100% accepted; fix within 14 ms |

**Gap filling on the planted removed scenes:**

| Scene removed | Filled | Removed captions covered by the fill (median; lowest) | Their words found in the fill (median) | Fill added outside the removed scene (median; most) |
|---|---|---|---|---|
| 2 minutes | 41% | 100%; 87% | 93% | 0 s; 2 s |
| 4 minutes | 99% | 100%; 92% | 94% | 0 s; 7 s |
| 8 minutes | 96% | 99%; 88% | 94% | 0 s; 1 s |

The rest were not caught, or were rejected by another rule (at most 4%). The words found are those of the removed captions; 6–7% are lost because subtitles shorten speech and the ASR mishears.

**Judging against an old `+` file**, with the same rules on the same sets. The `+` files were built by the ASR app's own code, and only their caption starts were used:

| | Full transcript | Old `+` file |
|---|---|---|
| Bad kept as good, training / test | 0 / 0 | 2 / 0 |
| Good thrown away, training (of 322) / test (of 371) | 16 / 18 | 21 / 20 |
| Dense pairs a minute | 10.4 | 4.9 |
| Planted 1-minute shifts caught | 82–92% | 52–67% |
| Planted 2-minute shifts caught | 93–99% | 74–87% |
| Removed scenes, another episode's file, controls | as above | the same |
| Fix, against the full-transcript fix | | median 25 ms apart, worst 274 ms |

## Known limits

- **Cheap episodes:** their files are unjudged and may be badly timed. For now, only each show's next two episodes are fully vetted. Watched episodes, and episodes of shows the update task doesn't reach, stay cheap.
- **New episodes:** a new video is vetted only when its show is next updated or an episode of it is watched. Until then it has what the add-to-disk steps and play-time downloads give it.
- **Old `+` files:** judging against an old `+` file misses more short off stretches than full vetting, which is why its bad files are kept unmarked.
- **Short removed scenes:** a removed scene under 2 minutes is rarely caught, so it is neither rejected nor filled.
- **Shifts near 0.5 s:** a 0.6 s shift of a short stretch is missed about 1 time in 6. Allowing 0.5 s, as ruled, makes that unavoidable.
- **Uncaptioned mid-episode songs:** a song in mid-episode that no file captions and no file marks with ♪ counts as a missing stretch. The file is used only if nothing complete exists, and then the lyrics are captioned as the ASR heard them, mishearings included. That happened once in 200 episodes.
- **Fill text:** fill captions read like the `+` file: no speaker dashes, and names may be misspelled.
- **ASR timing:** a stretch where the ASR's word times run late can still reject a good file.

## Implementation order

1. **Transcripts:** store a complete word-timed transcript per fully vetted video, made by the existing complete ASR under the automatic ASR cap.
2. **The judge:** write it as a pure function, with the constants above and the vetting version (1) at the top of its module. Give it a mode that judges against an old `+` file's caption starts.
3. **Full vetting:** the flow above, including gap filling.
4. **Cheap vetting:** the steps above, the one-download rule with its daily reserve, and the old-`+` variant.
5. **Triggers:** add vetting to the tvdb update task's per-show step (the next two in full, the rest cheap) and to the end of a watch (the next two in full). Remove the clip checks and ASR from the add-to-disk steps, the watcher and the sweep. Build no backfill.
6. **Episode fields:** write the five episode subtitle-vetting fields whenever an episode is vetted.
7. **Play list:** ✓ comes from the new judge only. The order of the play list and the start pick are unchanged.
8. **Sync:** switch the remotes' Sync and the local pane's Sync to the transcript where the episode has one.
9. **Old checks:** stop running the clip checks and the retime pass, and leave their stored data in place.
10. **Validate:** on the two 100-episode analysis sets on hahnca.com, the implementation's full-vetting verdicts should match the analysis's verdicts for this logic file for file.
