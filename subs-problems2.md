# Problems with the updated subtitle check instructions

The responses settle most of the first list. Two rules would still delete good files across large parts of the library, the cover test has no rules yet, and a few gaps remain. Each item ends with the question that would settle it. Nothing was changed. The measurements below were read-only, from the stored clips, the checks and the files on disk.

## What the data shows

Your silence rule works. Under your exact cue rules, a single matched cue is far closer to its clip's true offset than the lines measured before:

| One matched cue, off its clip's median by more than | 0.25 s | 0.5 s | 1 s |
|---|---|---|---|
| Lines measured before (first 5 words, no silence rule) | 21.9% | 7.9% | 2.6% |
| Your cues (3 words after 1 s of silence, unique within 10 s, matched within 5 s) | 7.9% | 2.0% | 0.3% |

That is 5,138 matched cues in 718 files that are checked good and needed no fix. The large errors drop by about three quarters.

| Other measurements | Result |
|---|---|
| Good files with a cue in the video's first minute | 271 of 300 (90%) |
| Good files with a cue in the video's last minute | 191 of 300 (64%) |
| Complete ASR files (the audio itself) with a cue in the first minute | 188 of 200 (94%) |
| Complete ASR files with a cue in the last minute | 131 of 200 (66%) |
| Complete ASR files with a cue in both | 126 of 200 (63%) |
| Three-point test on 227 good files, one cue per point | 20 fail |
| The same, with each clip's median in place of one cue | 6 fail |
| Good files shifted by more than 5 s | 24 of 257 |
| Good files stretched by more than 5 s at a clip (more at the file's ends) | 40 of 393 |
| Videos with no English audio track, in the checks | none |

Two caveats:
- Stored clips keep only when each word starts. Silence in a clip was therefore taken as 1 s between word starts; 1.3 s gave the same numbers.
- The three-point test used the stored clips, which sit at the busiest dialogue, not in the first, middle and last minutes.

## 1. The last minute deletes every file of about a third of the videos

When a minute has no match, the file is deleted. In about a third of videos the audio has no cue in the last minute at all: end credits, music, or a silent last shot. In the sample these included Get Smart, Severance, Nobody Wants This, Perpetual Grace LTD and The Lincoln Lawyer. No file can match there. So every file and every download of such a video would be deleted, and the video would end up with only its `.asr.srt`. The first minute does the same to about one video in 16.

A suggestion: delete a file for a missing match only when the clip heard a cue there. When a minute's clip hears no cue, the window moves inward a minute at a time, to the nearest minute where the audio has one. A bad cold open is still caught, since a cold open has dialogue.

**Question:** use that, or keep deleting every file of such a video?

## 2. The 5-second window and stretched files

Response 1 treats a file at a measurable other rate like a shifted one. But a cue must match within 5 s of the file's own time.
- A file at 24 against 23.976 fps drifts about 2.6 s over a 43-minute episode, so it fits.
- A file at 25 against 23.976 drifts about 110 s, and can't match in the middle or last minute.
- A file shifted more than 5 s can't match anywhere.

64 files that are good today lie beyond 5 s: 24 shifted and at least 40 stretched. All of them would be deleted.

A suggestion: the first minute searches within 5 s of the file's time. The middle minute searches within 5 s of where the first diff puts the cue, and the last minute within 5 s of where the line through the first two puts it. The 10-second uniqueness rule still keeps out the wrong occurrence, and any rate the clips can follow gets measured. A file shifted more than 5 s at the very start would still be deleted.

**Question:** keep the plain 5-second window and delete those files, or follow the earlier matches?

## 3. The cover test has no rules yet

A candidate is good only once it passes the cover test, as in the old plans. The old cover test worked like this:
- one 2-minute clip in each 3-minute part not yet heard, the cold open and last scene included;
- each clip's offset is the median of all its paired lines, with at least 10 pairs;
- every clip must lie within 250 ms of one shift or one stretch line;
- a clip whose lines scatter more than ±400 ms fails the file.

The new rules use one cue per point and 500 ms. An estimate, if the cover test used the new rules: one cue per clip at 2% each, over about 14 clips, fails a good file about 1 time in 4 from noise alone. With a 500 ms tolerance, a part of the file that is 400 ms off would pass.

**Questions:**
- Does the cover test keep the old rules, or use the new cue rules?
- If the new rules, how many cues per clip, with what tolerance? What happens with a clip that has no match?
- Are the cover clips 70 s or 2 minutes?

## 4. Your question on timing by hand

Yes, in the sense you mean. A shift from a remote can't make a file from another cut fit, nor spoil one that fits.

Two things still need a rule:
- **Re-judging undoes the shift.** Every candidate is shifted by its measured diff. Re-judging a file timed by hand would measure the hand shift and shift the file straight back. Today such a file is judged again but never moved back.
- **The shift is evidence.** A person shifts a file only after seeing it off. The checks passed that file, yet it was off where the person was watching. The old plan left such files open for that reason.

**Questions:**
- After a hand shift, is the file judged again?
- If so, is the measured shift applied, undoing the hand shift, or is the hand shift kept?
- Does the file keep its ✓?

## 5. What the shift is measured from

"Shift every candidate by its measured diff." If that diff comes from the one cue at each point, about 1 cue in 12 is more than 250 ms off its clip's median, even with the silence rule. So about 1 file in 12 would be shifted more than a quarter second away from right. The cover test hears many cues, and the line fitted to them measures the shift far better.

**Question:** shift by the line fitted to the cover test's matches once it passes, or by the three-point diff?

## 6. Which cue at each point

Each point uses one cue, but a minute usually holds several matches. In the sample, using one cue in place of each clip's median deleted 14 more good files out of 227. That is the direction you accept, but the choice of cue still has to be made.

A suggestion that fits the names: the earliest match in the first minute, the latest in the last minute, and the one nearest the middle in the middle minute.

**Question:** that, or another choice?

## 7. Bad files kept until something good exists

Bad files stay until a good file or the `.asr.srt` exists. Today files from another cut are left out of the list a play offers, so a bad file that is kept but hidden changes nothing for the viewer. The original instructions also said a bad download is deleted at once.

**Questions:**
- Are kept bad files offered at play, and how are they marked?
- Do bad downloads stay too, or are they still deleted at once?
- An episode is now judged in the background with no timeout. What does a play show before its judging is done?
- When a file turns good mid-play, does tvapp still reopen the video with it, as it does today for subtitles that arrive late?

## 8. Files changed by the old checks

Downloads count toward the 5 only if they have not been modified since downloading. Nothing records a download as it first landed. The old checks' notes do record their own shifts, stretches and hand timings, and the glue fixer kept backups of what it rewrote. From now on the size and time of each download would be recorded as it lands.

**Questions:**
- A download changed by the old checks or by hand: is it skipped, deleted and downloaded fresh (counting toward the 5), or judged as it is?
- For the next-up videos re-judged under the new rules, are the embedded tracks copied out fresh, starting from scratch? Or are they taken as they are, with the tracks the old checks deleted staying gone?

## 9. Short confirmations

- **No English audio.** Does "not extracted" mean no copy-out, no downloads and no ASR at all, so such a video gets no subtitles? There are none in the library today.
- **"Re-judged at the usual time."** Does that mean when the episode is next-up (before a play, or ahead of the next episode), or also in the six-hourly sweep?
- **The `.asr.srt`.** Today it does not get a ✓ by itself. It is judged by the clips like any other file, and an unusable one is kept only so ASR is not run again. The automatic ✓ is therefore a change. It is fine as you stated it.
