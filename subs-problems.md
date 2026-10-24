# Problems with the subtitle check instructions

The instructions can't be built as written. One rule contradicts another, and several cases have no rule. Each item ends with the question that would settle it. Nothing else was changed, and no plan was written.

Some numbers below come from read-only looks at the library on 10-23:

| What was measured | Result |
|---|---|
| Of 600 files now checked good, picked at random: a cue (3 or more words, after 1 s with no caption showing) starts in the video's first minute | 538 (90%) |
| The same 600: such a cue starts within a minute of the file's own first caption | 587 (98%) |
| Files now checked good that were fixed by a stretch of more than 500 ms between their two clips (more over the whole file) | 213 of 2,272 |

## 1. Shift or stretch

A fixable candidate needs its first and last time diffs within 500 ms of each other. That allows a shift, or a stretch of under half a second from end to end. Yet the same sentence says a candidate may be fixable "by a shift or a stretch". A file at another frame rate drifts steadily: 24 against 23.976 fps alone drifts about 2.6 s over a 43-minute episode, and 25 against 23.976 nearly two minutes. Under the rule as written, the 213 files above would not be candidates and would be deleted.

**Question:** is any file whose middle diff lies within 500 ms of the line through its first and last diffs a candidate, however far apart those two are? Or is only a shift a candidate?

## 2. A minute with no match

There is no rule for a first, middle or last minute with no matching cue. The minute may hold titles, music, credits or a quiet scene, or ASR may not hear it. As written, such a file is not a candidate, so it is deleted. By the first row above, about one good file in ten has no cue in the video's first minute at all, before any matching. The last minute of a video is often end credits.

"The first minute of a file" is also unclear. It could mean the video's first minute, or the first minute of that subtitle file's captions. Those differ for files of other cuts. The clips are cut from the video and heard once for all of its files, so they have to be placed in video time.

**Questions:**
- Do the first and last minutes mean the video's, or the captions' of some file? If the captions', which file places the clips?
- When a minute has no match, is the file left with no ✓ and kept, deleted, or does that clip move to the nearest minute with dialogue?
- Where in the minute does a clip of under 30 s sit?

## 3. What counts as a cue on the clip's side

**Questions:**
- Is the 1 s of silence measured in the subtitle file (no caption showing), in the audio (no word heard), or both?
- Must the clip's 3 words also follow 1 s with no word heard?
- Must the 3 words occur only once in the clip?
- How far apart in time may a subtitle cue and a clip cue be and still match? Uniqueness is only within 10 s, so a file off by more than 10 s could match the wrong occurrence of a common phrase.

## 4. One cue or several at each point

"The first match" is one cue. The first minute may hold several matching cues.

Measured before the 1-second-silence rule, a single correctly matched line was more than 0.5 s off its clip's median in about 8% of lines. The silence rule may tighten that. It has not been measured yet, and it can be measured from the clips already stored, at no cost.

**Questions:**
- Does each point use one cue (which one, the earliest?) or all its matching cues (combined how: the median?)
- Should the silence rule be measured before the 500 ms tolerance is fixed?

## 5. "Many clips"

**Questions:**
- How many clips, how long, and where?
- What counts as passing: every clip within 500 ms of the line through the first and last diffs, or within 500 ms of a line fitted to all the clips?
- What about a clip with no matching cue?
- Is a candidate that fails deleted, like a file that was never a candidate?

## 6. Applying the fix

Nothing says the shift or stretch is written into the file before it gets its ✓. Today a file whose captions come up to 0.25 s late or 0.5 s early is left as it is, and only a file outside that window is shifted.

**Question:** keep that window, or shift every candidate by its measured diff?

## 7. Clips already heard

897 videos have stored clips. These are two 2-minute clips at the busiest dialogue of the first and last thirds, and on some videos a middle clip. Few of them sit in the first, middle or last minute.

**Questions:**
- Are the stored clips dropped, so that every video hears the new short clips?
- Or are they used wherever one happens to cover one of the three minutes or serve as one of the many clips?
- Must new clips be under 30 s, or may they stay 2 minutes?

## 8. Phase 1 when nothing is good

Phase 1 deletes the bad files when some file is good. The per-file rule deletes every file that is not a candidate, whatever the others are. If no file is good, deleting them all at once leaves the video with no subtitle until a download or ASR arrives. ASR can be put off to the next day by the $20 daily cap.

**Questions:**
- With nothing good, are the bad files deleted at once, or kept until something good replaces them?
- Files that are unusable today (too little dialogue, not English) are deleted without clips. Does that stay?
- A deleted embedded track is never copied out again. Does that stay?

## 9. Phases 2 and 3

**Questions:**
- When the episode has fewer than 5 results that can be tried, does ASR start after the last one?
- Results marked unfit for the video and foreign-parts-only results are skipped today. Does that stay?
- Do downloads from earlier passes, or from play time, count toward the 5?
- Is a bad download marked unfit for the video, so it is never downloaded again, as today?
- When the day's 1,000 downloads are used up, does the video wait for the next day or go on to ASR?
- Does the new `.asr.srt` get a ✓ without a test? On a later pass, is it tested like any other file?

## 10. Things the instructions don't mention that exist today

**Question:** for each, keep it as it is, change it, or drop it?

| What | Today |
|---|---|
| Videos with no English audio track | No clips can be heard. Embedded tracks are presumed good, and the rest are checked by whole-file audio matching. |
| Retime | With an `.asr.srt` and nothing else good, one other file is shifted to fit the `.asr.srt`, so a file has a real subtitle's wording and the video's timing. |
| Downloads at play time | Before a play, and ahead of the next episode, up to 3 downloads, each judged as it lands. |
| Timing by hand | An offset applied from the remotes or the browser player rewrites the file, which is then judged again. |
| Sync | Measures the showing file's offset from the clips. |
| Files that land later | A file arriving in a video that already has a good file is judged against the clips already heard. |
| Which videos | New videos only, or also a pass over the library? Watched episodes too? Are files with a ✓ from the old checks judged again under the new rules? |
