# Subtitle observation plan

Tune the subtitle judge's constants (`apps/srvr/src/subJudge.js`) to what a
viewer actually sees as a problem, from quick good/bad ratings of short clips.

Why: Accidentally on Purpose S01E09 T2 was deleted by the spot rule (two
captions about 0.6 s and 1.1 s early at 11.1 min, measured from the fit line),
yet fixed by its line it was perfectly good to watch (10-24).

## Rulings (user, 10-24)

- Irritation is noticed at once, from one or two captions. Watching a
  problem longer never changes the judgement, so there is no duration rule
  and no long clips: a file is bad when it has a moment rated bad.
- No judging while watching in the app, and no checks in tvapp.
- Only episodes already watched are shown, so a clip spoils nothing.

## Setup

- Standalone, outside the app code, on hahnca.com in
  `apps/srvr/data/sub-analysis/observe/`: a small server and one page, run
  with nohup (not pm2, so deploys don't kill it).
- It reads transcripts read-only and writes only its own folder, never
  tvdb.db, subs.db or an episode folder.
- The page: a video and its captions, with no buttons over it. The page
  draws the captions from the video's clock on every frame, since a
  browser's text track times cues more coarsely. Answers are keys: 1 fine,
  2 noticed but ok, 3 bad, r to replay and u to undo the last answer (A/B
  trials below), taken at any time. One given before the problem has been on screen 1.5 s counts only
  when it is bad; otherwise it is recorded and the moment comes up again. A
  key starts the next trial. Every answer goes to `ratings.jsonl` with the
  trial's parameters and captions.
- Clips are cut once, about 42 s around each moment, to small H.264 mp4s on
  the SSD, with `ionice -c3` (see Media disk); a trial plays 20–33 s of one.
  Dolby Vision profile 5 sources are skipped.
- The captions of a trial are made as it is shown, so the same clip can be
  shown again at once with other captions. They are sanitized through
  cleanSrt() after any planted shift.

## Trials

- Planted defects on good files fixed by their line, so the base keeps its
  real noise: one caption off, a run of N captions shifted, a stretch
  shifted, drift. Each is early or late, at several offsets.
- Real rejections: files the judge rejected for their timing, at the time it
  reports, from fresh100 and test100 and from the library's embedded tracks
  (deleted downloads can't be read again). The library's are all of
  unwatched episodes so far, since vetting skips watched ones.
- Controls with no defect, about 1 in 4.
- No file that leaves speech out is shown: a file must carry 85% of the
  heard words, and a clip with any uncaptioned phrase or two words in a row
  no caption carries is left out, so a missing line never distracts from the
  timing. Found this way: Kid Sister S02E01's embedded track holds only the
  first line of every caption, and vetting keeps such files, since it judges
  timing alone. Written up for a production fix in `subs-coverage.md`.
- A/B: the same moment with the file fixed by its line and with what a
  play would offer instead (usually the `+` file), answered "which is
  better":
  - The clip plays labelled "A" in a corner (a label, not a button), then
    at once again with the other captions, labelled "B", and A and B go on
    alternating until an answer. Which one is A is random.
  - Keys: 1 A better, 2 the same, 3 B better, taken at any time during A
    or B; r starts again from A, a or b jumps to that one.
- A clip starts 8–25 s before its problem, at random. The order is shuffled,
  with no scene twice in a row, and a staircase per defect kind keeps most
  trials near the threshold.

## Results, session 1 (10-24, 162 answers)

Thresholds from the staircases (about where "bad" starts; the mean of the
last reversals, ±50 ms):

| Problem planted | Captions early | Captions late |
|---|---|---|
| One caption | ~950 ms | ~450 ms |
| A run of 3 | ~425 ms | ~225 ms |
| Every caption from a point on | ~600 ms | ~350 ms |
| Drift over the whole clip | ~375 ms | ~225 ms |

- Late is about twice as bad as early, at every kind.
- A sustained shift (run, step, drift) bothers from about 225 ms late or
  400 ms early; a single off caption is tolerated up to twice that.
- Controls (good files as they are, within 150 ms of their speech): 48
  shown, 33 fine, 11 noticed but ok, 4 bad. Clean files draw "bad" about
  8% of the time; every threshold above carries that noise.
- Real rejections, fixed by their line and shown alone: 8 of 11 bad, 2 fine
  (Rivals (2024) S02E03 H2, truly good; Buffy S01E04 opn-11911517), 1
  noticed but ok (Two Guys and a Girl S01E13's minute rule, −523 ms).
- A/B against what a play would offer instead: the fallback was better in
  8, the same in 2 (Rivals, Will Trent S03E10), and the rejected file better
  in 1 (Buffy, where it was also fine alone).
- Against the judge today: its minute rule fails only a median over 500 ms,
  while a sustained late shift bothers from ~225 ms; its spot rule fails two
  captions over 500 ms either way, while a single early caption is fine to
  ~950 ms. The rules are symmetric and the eye is not.
- 4 answers were given before the problem had shown and were not bad; they
  are in `ratings.jsonl` marked `beforeGate` and moved nothing.

Next: step 1 of "Use of the ratings", the truth credits4 from these
thresholds, direction-aware.

## Use of the ratings

1. **Done 10-25: the truth credits4 in `evaluate.py`** (`eye_truth`,
   `--truth credits4`). A file is bad when any 60 s of caption time with 6
   or more agreeing pairs has a median more than 500 ms early or 350 ms late
   from the file's fitted line, when a 3-minute part's median is beyond 2 s
   (captions of another place), or when it leaves speech out (credits3's
   missing parts, with its lyric and end exemptions). A pair more than 30 s
   off is a line matched to a repeat of its text elsewhere (Interview with
   the Vampire S01E06 replays a scene) and is left out. Labels good, bad and
   nofit; no border.
   - Why medians and not captions: the truth's pairs in files you find fine
     have a natural spread of σ ≈ 140 ms with 1% beyond −500 and +650 ms,
     and confirming each pair by a second, independent match (judge-style
     3-gram) removes none of it (331 of 370 pairs agree within 150 ms). The
     spread is real caption placement, not matching error, and it is as
     wide as your one-caption thresholds, so no rule over 1–4 captions can
     be told from it: every such rule fired on a quarter to half of the
     credits3-good files. Only the sustained kinds (step, drift) can be
     scored; the one-caption and run thresholds stay as findings.
   - The thresholds: 350 ms late is the step staircase's value and sits
     between drift's 225 and the one place you rated a natural −344/−365 ms
     stretch "noticed but ok" (Two Guys and a Girl S01E13); 500 ms early is
     between drift's 375 and step's 600. The rule catches all 8 files you
     called bad alone, keeps Rivals (2024) S02E03 H2 good, and fires on 7%
     (fresh100) and 3% (test100) of credits3-good files: real 60 s stretches
     credits3's 3-minute medians hid.
   - The live logic (`whole+refit+seg8+tol500+mend+mlyr+mslide`, the
     deployed judge) against each truth:

     | Set | Truth | bad kept as good | good thrown away | episodes with a bad file kept |
     |---|---|---|---|---|
     | fresh100 | credits3 | 0 | 17 (+18 border kept) | 0 |
     | fresh100 | credits4 | 24 | 14 | 4 |
     | test100 | credits3 | 0 | 27 (+9 border kept) | 0 |
     | test100 | credits4 | 11 | 24 | 5 |

     Its minute rule fails only a median over 500 ms either way; the eye
     fails 350 late. That gap is what step 2 has to close.
   - The logics it replaced, under the same truths (bad kept / good thrown
     away):

     | Logic | fresh100 credits3 | fresh100 credits4 | test100 credits3 | test100 credits4 | audio heard |
     |---|---|---|---|---|---|
     | base (the first clip proposal) | 3 / 121 | 19 / 107 | 0 / 101 | 9 / 98 | 63% |
     | prior+nostep+refit (the best clip logic, 10-23) | 0 / 33 | 8 / 21 | 0 / 51 | 2 / 44 | 65% |
     | whole+refit (complete ASR, no part check) | 0 / 39 | 9 / 31 | 0 / 47 | 3 / 41 | 96–100% |
     | deployed (whole+refit+seg8+tol500+mend+mlyr+mslide) | 0 / 17 | 24 / 14 | 0 / 27 | 11 / 24 | 96–100% |

     Under credits3 the deployed logic was the best on every count. Under
     the eye it keeps the most bad files and throws away the fewest good
     ones: it was loosened on 10-24 by the ruling that a minute about 0.5 s
     off must not fail a file (seg8+tol500), and the eye now puts a
     sustained late shift at 350 ms. The clip logic's tighter cover test
     happened to catch those stretches. Most of the deployed logic's kept
     bad files sit at 350–400 ms late, right at the threshold, so step 2's
     direction-aware minute rule is the fix, not a return to clips. The kept-bad
     files are 60 s stretches 350–400 ms late or 510–610 ms early, and in
     most episodes every file shares the same stretch at the same minute
     (Angel S02E16's five files ~515 ms early at 2.1 min, Archer S11E08's
     five ~375 ms late at 10.1 min): the source timing, or the ASR's word
     onsets there. Step 3's watching tells which.
   - Measuring scripts, in `observe/`: `eye-noise.py` (the pairs' spread),
     `eye-rules.py` (rule shapes against the labels and your rated files),
     `eye-kept.py` (the files the logic keeps that the eye calls bad).
2. **Done 10-25: the constant search.** The user withdrew the 10-24 ruling
   that a minute about 0.5 s off is fine. `evaluate.py`'s minute rule
   (`part_check`) and spot rule (`cover_test`) got separate early and late
   limits, as variant parts `segE`/`segL`, `spotE`/`spotL` and `segMin`
   (defaults unchanged: the deployed variant still scores 24 / 14).
   `observe/eye-search.py` ran 73 settings on fresh100 against credits4
   (`eye-search.txt`): minute rule late 300/350/400 × early 450/500/600 ×
   6 or 8 pairs, spot rule at 500/500, 950/450, 1200/600 and off, ranked by
   bad kept, then good thrown away, then episodes to ASR. The winner, scored
   once on test100 (`eye-search-test100.txt`):

   | Logic | fresh100 bad kept / good thrown / episodes to ASR | test100 |
   |---|---|---|
   | deployed (`seg8+tol500`, spot 500/500) | 24 / 14 / 22 | 11 / 24 / 6 |
   | **winner: minute 6 pairs, 450 early / 300 late; spot 1200 early / 600 late** | **0 / 15 / 23** | **0 / 29 / 11** |

   - The minute rule carries the fix; its limits land a little under the
     eye truth's 500/350 because the judge's 3-gram pairs give slightly
     smaller medians than the truth's whole-line pairs. 6 pairs beat 8: with
     8, 5–6 bad files slip through at the same limits.
   - The spot rule survives, loosened to 1200 early / 600 late. Turned off,
     9 bad files come back and 8 accepted files end up with a part over
     500 ms off after the fix: it also guards the fit line. At 950/450 or
     500/500 it only throws more good files away (21–23 against 15).
   - The costs: one more good file thrown away in fresh100 and 5 more in
     test100, and more complete ASRs (23 against 22, 11 against 6 episodes).
   - For `subJudge.js` this means `MINUTE_MIN_PAIRS` 8 → 6,
     `MINUTE_OFF_MS` 500 → `MINUTE_EARLY_MS` 450 and `MINUTE_LATE_MS` 300,
     `SPOT_OFF_MS` 500 → `SPOT_EARLY_MS` 1200 and `SPOT_LATE_MS` 600 (a
     residual above 0 is a caption before its words), windows and agreement
     unchanged, and `VET_VERSION` 2 so vetted-v1 episodes can be told apart.
     Not applied: the user decides, and it decides what step 3 replays.
3. **In progress 10-25.** The winner's constants are in `subJudge.js` as
   vetting version 2 (deployed 02:43 PST; `VET_VERSION` 2, so every episode
   is vetted again at its show's next update, the full ones from their
   stored transcripts at no ASR cost). The JS judge matched the Python
   winner on all 930 set files before the deploy (`vet-validate`).
   `observe/step3-replay.mjs` judges every file full vetting checked again
   with the new rules from its stored transcript and lists the flips in
   `step3-flips.txt`: kept files the new rules reject, and rejected embedded
   tracks (read again from the video) they pass; deleted downloads can't
   be judged again. `prep.mjs` turns the flips of watched episodes into
   real moments (`flips.json`), a kept file at the new rule's time and a
   passed track at the old rule's time, and the page serves them worst
   first. Watching stops when a few in a row agree with the new verdict.
   - The replay (02:45): 556 files of 186 videos with a transcript. 400
     keep their verdict; **41 kept files are rejected** by the new minute
     rule, nearly all 300–390 ms late in one minute (The Night Manager
     S02E01 573 ms early at 55.8 min is the worst), and in several
     episodes every file at the same minute (Dark Winds S04E01's 8 files at
     0.5 min, American Hostage S01E02's 4 at 39.5 min); **13 rejected
     embedded tracks now pass** (all spot-rule rejections of 521–985 ms,
     Corner Gas Animated, Get Smart, Old Christine, Chelsea Detective, Cold
     Feet, Black Mirror, Playing Nice, Palm Royale); 102 deleted downloads
     can't be judged again. **None of the flips is in a watched episode**,
     so nothing can be watched yet; `prep.mjs` adds them as episodes get
     watched (rerun it).
   - What the deploy does with them: as deployed at 02:42 it did neither,
     since vetting judged only files with no verdict yet. Since the
     version-aware fix (10-25 12:11, `subs-test.md`), the 41 kept files are
     judged again and deleted when their shows are next updated, and the
     13 tracks are copied out again and judged.

## First step

A dry replay counting the rejections the spot rule causes alone, on
fresh100, test100 and the library's vetted files.

## Cost

About 60–100 ratings at about 2 a minute: under an hour of watching, in
short sessions. The build uses evaluate.py's truth and the live judge.
