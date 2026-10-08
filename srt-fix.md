# Subtitle preparation for playing

## The goal

Before an episode is played it should have at least one subtitle file whose timing has been checked against that episode's own video, and the player should never offer a file that is known not to fit. Everything that takes longer than a moment happens in the background, when a video lands on disk or in the six-hourly sweep. At play time getPlayUrl only reads what the background work already decided; the three seconds that play waits are not enough for any of the checks described here, since the quickest of them takes about eight seconds.

The reference for timing is the words spoken in the video's own audio. A transcript of the audio says when each word was spoken, so a subtitle cue can be paired with the words it shows and the difference between the two is the file's offset at that point. Everything else in this plan is about getting those words cheaply, deciding what a measured offset means, and choosing what to do about it.

## What the testing showed

An ASR transcript made from the same video is always in time with it. Every episode whose own `.asr.srt` was checked came out within about sixty milliseconds of the spoken words. The extraction that ASR uses was confirmed to give exactly the same audio as reading the video at a timestamp. The ASR files that were wrong had not been made for their video at all. The subtitle migration of October 1 and 2 copied the sidecars of replaced releases onto the videos that replaced them, and 174 of those copies are still on disk, 68 of them `.asr.srt` files. The Last of Us S02E02 carries an ASR made for a 720p release that runs 1.7 seconds apart from its REMUX, and Perpetual Grace S01E05 carries one that is 8.1 seconds off.

Audio matching with ffsubsync, which lines cue spans up with the speech a voice detector hears, is right most of the time when it is given the whole video, but it was wrong on two of the ten episodes that had an ASR to check against, by 1.4 seconds on Cheers S05E09 and by 0.8 seconds on Pushing Daisies S01E07. It reads about 150 milliseconds earlier than the spoken words on average. Run on shorter windows it was unreliable at every length tried, from one minute up to half an episode, because music and laugh tracks fool its voice detector. Its first-third and last-third consistency check catches its wrong answers but also rejects good files, such as Archer and Bob's Burgers. It has to read the whole video, which is a few seconds for a small episode and several minutes for a 38 GB REMUX on the USB disk.

The spot check, which runs ASR on two two-minute clips and matches the clip words against every sidecar of the episode, was tested on twenty random episodes and fifty-four sidecars. It took about eight seconds an episode, fourteen at most, and costs roughly three cents an episode at Speechmatics' price. It agreed with every episode's own ASR file, caught all the files from other cuts and the inherited copies, and found real errors such as The Night Manager's 5.7 seconds. Matching a cue by its first five words gives twenty to sixty pairs a clip. Its failures were all explainable: a signs-only track with no dialogue, a scene in another language in one clip, a show whose first audio track is Portuguese, and a DVD subtitle file whose cues scatter half a second either side of the words.

Embedded text tracks, copied out as T and H files, were made for the release they came in and are usually right, but not always: 3rd Rock S03E19's T2 does not fit its own video, and Pushing Daisies' T2 and H3 run about 0.6 seconds early. OpenSubtitles downloads often do not fit at all. Nine of the sixteen opn files in the test are from other cuts or run at other rates, and only five were good as they were.

## When the work happens

A video is checked once, when the add-to-disk steps in the subtitle queue have finished with it, after its text tracks are copied out and any arriving files are named. The six-hourly sweep checks library videos that have not been checked yet, after all other batch work, the same way it handles the add-to-disk steps today. A sidecar that appears or changes later, whether a new download, an arriving file or a file rewritten by the remote's Apply, is checked again at once from what was stored for its video, without new ASR. When a video is replaced or deleted, everything stored about it goes with it, since a replacement inherits nothing.

## Screening the files before any ASR

Each sidecar is parsed and its dialogue cues are counted, leaving out cues that are only sound tags such as music notes or bracketed noises. A file with fewer than three dialogue cues a minute of video is a signs or forced track and is not a candidate. A file whose cues run more than a few seconds past the end of the video is from another cut. Neither costs anything to find. A test not yet tried is whether the file is in English at all, by the share of its words that are common English words, so that a foreign-language sidecar is not mistaken for a broken English one.

## Choosing the audio

The clips are cut from the English audio track, the first one tagged English, or the first track when it carries no language tag. Turn of the Tide showed why: its first track is Portuguese, and its English dub track gave a clean result where the first track gave nothing. When the video has no English track at all, the words cannot be matched and the episode takes the non-English path described further on.

## The clip transcripts

Two two-minute clips are taken, one in the first third of the episode and one in the last, each at the stretch where the most dialogue cues start in the first usable sidecar, by type. They are cut one after the other at idle priority, so the disk is never split between them, and both are sent to Speechmatics at once. If a clip gives no sidecar at least ten pairs, because it fell on music or on a scene in another language, it is cut and transcribed once more at the next busiest stretch of its third that does not overlap the first try.

The transcripts are stored, which has not been built yet. The words of two clips with their times, the clip positions and the audio track used come to a few kilobytes per video, and keeping them in subs.db means every later check of any sidecar of that video is a text comparison that takes well under a second and costs nothing.

## The verdict for each file

For each clip, a cue near it pairs with the transcript when its first five words appear exactly once among the cues near the clip and exactly once, in order, in the clip's words. The difference between the first word's start and the cue's start is that pair's offset, and the median of all the pairs is the clip's offset. A positive offset means the captions come before the words. A clip counts as solid when it has at least ten pairs and its median is pinned down to within eighty milliseconds, measured as the median distance of the pairs from it divided by the square root of their number. This allows for subtitles written by people, whose individual cues land anywhere from a tenth to half a second either side of the words, while machine-made files land within a few hundredths.

When both clips are solid and agree within a quarter of a second, the file has one offset, their mean. It is good when the captions come no more than half a second before the words or a quarter of a second after them, since appearing a little early is normal practice, and fixable otherwise. When both clips are solid but disagree, the file is from another cut or runs at another rate, and no single shift fits it. When a clip is not solid, the file cannot be judged. Each verdict is stored with the file's size and modification time, so that a changed file is judged again.

## What is done with each verdict

A fixable file is shifted by the offset the spot check measured, through cleanSrt like every subtitle write, and is then checked again against the stored transcripts, which should now find it good. The whole-file audio matching is not used for this, since the spot check's own offset is the more accurate of the two and is already known.

A file from another cut is never offered to the player. An opn file of that kind is deleted and its search result is marked as unfit in subs.db, which is a new mark, so that the download logic does not fetch it again. An inherited `.asr.srt` that is off is shifted when it is fixable and deleted when it is not, because ASR generation skips any video that already has an `.asr.srt`, and a wrong one would otherwise block a correct one forever. T, H and S files that do not fit are kept on disk but hidden.

A file that cannot be judged is kept. A T or H file in that state is offered as presumed good, since it came out of this video. Any other file in that state is offered only after the files that were verified.

A file whose clips disagree in a way that grows steadily through the episode may be running at another rate rather than missing a scene, as 3rd Rock's T2 and Pushing Daisies' opn file both looked. A third clip from the middle of the episode, which has not been tried yet, would tell the two apart: if its offset falls on the line between the other two, the file can be fixed by stretching every cue time by one factor and shifting it, and then checked again. If it does not, the file is from another cut. A cut with a few scenes removed could in principle be fixed piece by piece with more clips, but that is not worth the work.

## When no file fits

When no sidecar is good or fixable, OpenSubtitles is tried in the background rather than at play. Candidates are ordered by how likely they are to fit this exact video. First come results flagged as made for this file by its OpenSubtitles hash, which is computed from the file's size and its first and last 64 KB and which the search does not send today. Next come results with the same release name or group as the video, then the existing rule of a result from the same origin as a file chosen for another episode of the show, and then the rest, leaving out files that only cover foreign-language parts. They are downloaded one at a time and each is checked at once against the stored transcripts. A fixable one is shifted, one from another cut is deleted and marked, and the search stops at the first good file or after a small number of downloads per episode, so that the daily allowance of a thousand downloads and the limit of five requests a second are respected across the whole library. When an episode has no sidecar at all there is nothing to place the clips by, so the first downloaded file places them.

When downloads are exhausted without a fit, a complete ASR is generated, which fits the video by construction. It takes one to two and a half minutes and costs about thirty-eight cents an hour of audio. It is checked against the stored transcripts as a final sanity test. A daily spending limit on these complete transcriptions, not built yet, would keep a large backlog from running up a bill in one day.

The download at play in subsBeforePlay stays as a safety net for an episode the background has not reached yet. Any file it fetches is checked against stored transcripts when the video has them.

## Videos with no English audio

When a video has no English audio track the clip words cannot be matched against English subtitles, and a complete English transcription would be useless. T and H files are presumed good, as they came out of the video. Other sidecars are checked by whole-file audio matching, the one place it is used, since its voice detector does not care about language. A file it passes is shifted by the offset it found, a file it rejects is offered as unverified, and the episode is never sent for ASR. This path has been built into the spot check but has not been tested, because none of the twenty episodes lacked an English track.

## At play time

getPlayUrl offers the files the background verified, good ones and fixed ones alike, and pickSidecar chooses among them by its existing preferences: the file the episode showed last, then the type the show showed last, then the order T, H, V, S and ASR. Timing decides which files are allowed, and the viewer's preferences decide which of those is shown. After the verified files come presumed-good T and H files and then unverified files, and files from other cuts and signs-only tracks never appear. The subtitle panel could mark verified files in its labels, which has not been tried.

The panel's Sync button and the local pane's Sync both currently need a complete `.asr.srt`. With stored clip transcripts they could instead shift the showing file by its spot-check offset, which would work for any file of any checked episode, and would never trust an inherited ASR file that was itself off. A manual Apply from the panel changes the file, so the file is judged again afterwards.

## The backlog and its cost

About 2,600 episodes in the library have sidecars. Checking all of them at roughly 2.5 cents of audio each comes to about sixty-five dollars, plus retried clips, and about six hours of work if done one at a time. Speechmatics may charge a minimum per job that would raise this, which has not been checked. Since the work is mostly waiting on the network, two or three episodes could be checked at once, and the backlog could be spread over several sweeps rather than done in one. Newly landed videos are always checked first. The 174 inherited sidecars from the October migration are found and dealt with as part of the backlog, with no separate cleanup needed.
