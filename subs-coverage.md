# Subtitle files that pass vetting but don't carry the speech

Found 10-24 while building the subtitle observation page (`subs-observe.md`).
Nothing in production has been changed for it. This note is the record for
fixing it later; the measurements and the measure live on hahnca.com in
`apps/srvr/data/sub-analysis/observe/` (`coverage.mjs`, `coverage.txt`,
`coverage.tsv`, `lib/speech.mjs`).

## The problem

Subtitle vetting (`apps/srvr/src/subJudge.js`, `subVet.js`) judges timing
only: the first words of each caption against the heard words, and stretches
of 2 minutes with no caption at all. A file whose captions are on time but
carry only part of what is said passes it, gets a ✓, and is what a play
offers. The test sets' truth (`evaluate.py`, credits3) has the same blind
spot, so the sets score such files as good too.

## The case that showed it

Kid Sister S02E01 (`/mnt/media/tv/Kid Sister/Season 2/Kid Sister S02E01.mp4`,
test100 episode 006, a watched episode). Its embedded track T2 (mov_text,
stream 2) holds the first line of every caption and nothing else:

- The sample at 10:32.96 is 48 bytes: length 0x18, the 24 characters "even if
  she looks really", a style box. The words "ugly on her wedding day", spoken
  10:33.7–10:34.9, are in no sample. The next sample, at 10:35.64, is "It was
  a good guess, Ollie."
- All 473 captions are one line; 26% end mid-sentence with the next starting
  a capital ("This lolly would turn", "Make sure you have"). Each caption's
  time span covers the whole two-line sentence.
- Most likely whoever made the mp4 converted an SRT to tx3g with a tool whose
  SRT reader takes only the first text line of each block.

The judge calls the track good, and the truth labels it good.

## How widespread (coverage.mjs, 10-24)

The measure: the share of the heard words (fillers like "um" aside) that a
caption within 3 s carries; and runs, the number of 2-word stretches no
caption carries. Files judged good by the live judge, fixed by their line;
the library's are files full vetting kept with a ✓ whose video has a stored
transcript.

| Share of the speech carried | fresh100 (324 files) | test100 (362) | library ✓ files (269) |
|---|---|---|---|
| under 70% | 0 | 2 | 2 |
| 70–80% | 8 | 2 | 1 |
| 80–85% | 4 | 7 | 9 |
| 85–90% | 21 | 24 | 50 |
| 90–95% | 210 | 233 | 171 |
| 95–100% | 81 | 94 | 36 |

Normal files carry 90–95%: subtitlers drop fillers, repeats and short lines.
The files under 85% were looked at (30 s against the transcript each) and
are not one kind of damage:

| Kind | Files | What it looks like |
|---|---|---|
| Truncated captions | Kid Sister S02E01 T2 (62%, runs 45% of its captions) | above |
| Wording from another script | library Poldark S01E05 opnGQ65Q (51%), library Lupin S01E01 T4 (61%), test100 The Lazarus Project S02E07 opn-8496000 (64%) | on time, but not what is said: "Have I become such a fine lady that I've forgotten what my life could have been like?" for "Am I now such a great lady as to forget where I'd be if we'd never met". Lupin's T4 is the subtitle of the French original shown against the English dub; Poldark's reads like a translation back into English |
| OCR damage | library Spirited S01E02 opnKDRSH (78%), S01E01 opnKNQO4 (85%) | l read as I: "taIking Iike OIiver Twist", "probIem", "caIIing" |
| Foreign dialogue | fresh100 Shōgun S01E08, every file (51–75%) | ASR hears Japanese as English words no caption has; not a file defect |
| Songs over credits | test100 Severance S02E10, every file (80%) | known from credits3 |
| Not looked at | library Cold Feet S01E01 H2 and opnCIRAG (82%), The Sopranos S01E01 opnEP4JY (82%), Inside Amy Schumer S04E08 T0 and en1 (84%); fresh100 Angel S02E16 and S03E04 downloads (80–82%), The Westies S01E08 downloads (84%) | |

Library files kept with a ✓ under 85%: 9 of 269 with a transcript. The
library has far more ✓ files without a transcript (the old clip checks), and
embedded tracks copied out before vetting; none of those is measured.

## What a fix needs

1. **A coverage verdict in full vetting.** With the transcript there, measure
   the share carried and the runs. Below a threshold (85% separated every
   case above from normal files; runs over 25% of the captions is the
   truncation signature) the file is not good. What to do with it is a
   decision: delete it like a bad file (a T/H track's check kept as the
   memory, a download marked unfit), or keep it without a ✓. Gap filling
   fills only 2-minute stretches; a per-phrase fill from the transcript could
   repair a truncated track (Kid Sister's second lines are all in the
   transcript), but a paraphrased file can't be repaired that way.
2. **Foreign dialogue must not count.** Shōgun shows the measure needs an
   exemption for speech that is not English. The transcript stores no
   confidence; one way is the lyrics logic's: words that no file of the
   episode carries, in a stretch where every file agrees, are not English
   speech.
3. **A truncation signature without a transcript**, for cheap vetting and
   the copy-out: the share of captions ending mid-sentence (a letter at the
   end, the next caption starting a capital) was 26% for Kid Sister and 0–3%
   for every other file in the survey; a track of hundreds of captions with
   none of two lines is the other sign (read the raw track; `cleanSrt()`
   re-wraps lines).
4. **OCR repair in `cleanSrt()`**: a capital I between lower-case letters, or
   starting a word before a lower-case consonant cluster, is an l. Needs
   care ("I'll", "Ill").
5. **The truth in `evaluate.py`** should carry the measure, so the test sets
   score incompleteness; today every file above is "good" there.
6. **A library scan** for the truncation signature over every T/H sidecar
   (no transcript needed) and a list of the episodes and their releases; the
   other Kid Sister mp4s are the first suspects.

## In the observation test

The page never shows such a file: a base or rejected file must carry 85% of
the speech with runs under 25% of its captions (`MIN_FILE_COVERAGE`,
`MAX_RUN_SHARE` in `prep.mjs`), and a clip with any uncaptioned phrase or
2-word run is left out. Verified 10-24 over every kept moment, independently
of prep: 0 of 83 had uncaptioned speech or a file under 85%.
