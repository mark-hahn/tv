
Note: these responses my cause some specs to change.

Note: initial processing of a file with 3 clips checked are not actually known good until they later pass a cover test with many new clips. so in the response below when a candidate is said to pass the 3 clip test and be known good you should actually only consider the file to be good after the cover test.  this should match old plans.

1. if the rate can be somewhat reliably measured and fixed then treat the file the same way as shifted files.

2. i meant the first and last minutes of the video -- if they were further from the ends they might miss a bad cold open.
When a minute has no match the file should be deleted.
make the clip from 0 to 70 secs and the end also 70 secs.

3. use the same rules for a cue within the clip as in the file.
the 3 words may occur multiple times in the clip but matching words must be at least 10 secs apart.
the subtitle cue and a clip cue must match within 5 secs. this guarantees a clip cue won't match the wrong occurance of the words and will still match with a stretch.

4. each point should only use one cue.
the silence rule must be the very first thing used since it is what finds any cue. it is only used to find usable cues.

5. for the candidate test three cues should be used and if it passes then the cover test should be done. 
a clip with no matching cue should be deleted but make sure the entire min is checked.
passing means the middle clip is within 500 ms of the line through the first and last diffs.
failed candidates should be deleted but be sure to record results. 

6. shift every candidate by its measured diff.

7. stored clips should be used if they happen to cover one of the three minutes.
change the 30sec clip rule to 70 secs needed for matching. new ones should be exactly 70 secs. the extra 10 secs at the end is for the asr to reliably catch words at the end of the minute.

8. keep the bad files until one good one or the .asr.srt exists.
Files that are unusable today should be deleted without clips.
A deleted embedded track is never copied out again. i can't think of any situation where that could be needed since it will either be judged as good or bad forever. the only time it should happen is in phase 1 in processing.  a second extraction should only happen in testing or if we change the logic and need to run everything over again from scratch.

9. ASR should start after no candidates are found and all downloads have failed.
Results marked unfit for the video or foreign-parts-only should be deleted.
downloads from any source can be used and counted in the 5 if they have not been modified since downloading.
When the day's 1,000 downloads are used up, the video should wait for the next day. they should only wait when we know for sure we have hit the limit. api results may be the authoritive indicator instead of counting to 1000 but i'm not sure.
an .asr.srt should get a ✓ without a test although i think later processing always assumes a ✓. .asr.srt should be authoritive.

10. Videos with no English audio track and no unknown tracks should not be extracted.
only known good files should be kept. the only retiming should be the normal shifting or stretching of known good files
Before a play, and ahead of the next episode, the next-up file should go through this complete judgement process with no timeout. It should be processed in the background.
isn't it true that An offset applied from a remote cannot change it's judgement since it is limited to a shift?
sync should not be changed.
A file arriving in a video that already has a good file can be judged against the clips already heard but only if the clips cover the required windows.
for now only unwatched next-up files should be backfilled.  we will do more later. new files should be processed asap after arriving. old checks can be played but they should be re-judged at the usual time.
- once again if these updated instructions are ambiguous, incomplete, contradictory, or you think there is a better way to do them then:
  - write the problems to subs-problems2.md and stop
  - make no changes other than writing to subs-problems2.md
- otherwise create a plan in subs-plan.md that implement these instructions.
  - only put prose and tables in the plan and no filenames or line numbers.
- don't do any backfilling yet.