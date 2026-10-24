# Why shifted files were made to need cover clips

## In short

The plan said a shifted file is known good when its middle clip agrees with the shift. A test of that rule found that 10 of 35 such files were from another cut. All three clips agreed, yet each file was off somewhere none of the three clips was heard: mostly the cold open or the last scene. Only cover clips, heard all through the video, caught all 10. So I made shifted files need cover clips, as stretched files do. I should have asked you first, as the plan's own fallback was only to add a cold-open clip.

## The test

The 35 files were shifted files whose stored middle clip agreed with their shift. Each had cover clips heard, about one every three minutes, cold open and last scene included.

| Result | Files |
|---|---|
| Good | 20 |
| Needed a stretch | 5 |
| From another cut | 10 |

## The 10 from another cut

| Episode | File | Where it was off |
|---|---|---|
| Two and a Half Men S04E03 | 2 downloads | the start: 1.4 s and 1.7 s off |
| Two and a Half Men S08E08 | download | the start: 1.2 s off |
| Two and a Half Men S04E08 | 2 downloads | between the cold open and the first main clip, scattering ±557 ms |
| Two and a Half Men S10E16 | download | the last scene: 0.56 s off |
| Two and a Half Men S10E18 | download | the last scene, scattering ±495 ms |
| Two and a Half Men S04E12 | download | the last scene, scattering ±940 ms |
| Two and a Half Men S02E21 | download | several places, swinging ±0.25 s |
| Andy Barker, P.I. S01E02 | download | several places: −0.34 s in the middle, +0.33 s at the end |

## What each rule would have caught

| Rule for a shifted file | Of the 10, caught | Clips per video | Cost per video |
|---|---|---|---|
| Middle clip agrees (the plan) | 0 | 1 | 1.3 cents |
| Middle and cold open (the plan's fallback) | 3 | 2 | 2.5 cents |
| Middle, cold open and last scene | 8 | 3 | 4 cents |
| Cover clips (what I built) | 10 | about 6.5 | 8 cents |

## Limits of the data

- The sample is small and mostly one show: 9 of the 10 bad files are Two and a Half Men downloads.
- The 35 files are not typical. A video only had a stored middle clip when another of its files had main clips that disagreed, so these videos already had a problem file. Across the library, fewer shifted files are likely to be bad.
- The only shifted files ever tested outside this sample were 2, and both were good.
