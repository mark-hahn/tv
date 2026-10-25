# Subtitle files that pass vetting but don't carry the speech

Found 10-24 while building the subtitle observation page (`subs-observe.md`).
The fix was built 10-25 as vetting version 3 (see "The fix" at the end),
validated, and deployed 10-25 14:07. Vetting version 4 (15:25) changed
only the minute rule; the incomplete step and the truncated mark are
unchanged. The first
measurements live on hahnca.com in `apps/srvr/data/sub-analysis/observe/`
(`coverage.mjs`, `coverage.txt`, `coverage.tsv`, `lib/speech.mjs`), the
fix's in `sub-analysis/coverage/` (its README).

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

## The fix (10-25, vetting version 3, deployed 14:07)

What each item above became:

1. **Done: an incomplete step in the judge** (`subJudge.js` step 6, between
   the minute rule and the missing check; evaluate.py `incShare77+incRuns15`).
   With the file fixed by its line, the heard words the missing check counts
   (end material and other files' ♪ lyrics exempt, fillers aside) are
   measured: a word is carried when a caption within 3 s has it, and a run
   is 2 or more in a row that none has. Under 77% carried **and** runs over
   15% of the captions is bad, kind `incomplete`: full vetting deletes it
   like any bad file (a T/H track's check kept as the memory, a download
   marked unfit), then downloads and judges candidates, then fills, then
   falls back to the `+` file. Not checked against an old `+` file (no word
   times). The remotes' Sync answers "it leaves out much of what is said".
   Kept, not filled: no per-phrase fill was built.
2. **Done, by the runs part, not by a word exemption.** Foreign dialogue the
   ASR hears as English comes in few long stretches (Shōgun S01E08: 72%
   carried, runs 7–10% of captions); truncation, another script's wording
   and condensing leave a short gap in caption after caption (33–111%). Only
   Shōgun S01E08 could test this: no library Shōgun episode has a
   transcript. The exemptions alone lifted Severance S02E10 from 80% to 93%.
3. **Done, for cheap vetting** (`subVet.js` `truncatedWhy`, `markTruncated`).
   On text as `cleanSrt()` leaves it (it joins every caption's lines when
   they fit 60 chars, so "no two-line caption" can't be read on disk): mixed
   case, 100+ captions, 8%+ ending mid-sentence, at most 2% longer than 42
   chars. Such a file gets a `vet-cheap` check `truncated`: no ✓, offered
   last in a play's list (`playList`'s fourth group), not judged against a
   `+` file, not counted as the video's own copy or download, so cheap
   vetting downloads one. Nothing is deleted. The copy-out is unchanged.
   All-capitals broadcast captions (Childrens Hospital S04–S05, The Naked
   Truth) split one line per caption and needed the mixed-case part.
4. **Not done: OCR repair.** It is damage to the words, not missing
   captions, and `cleanSrt()` writes every subtitle file. Spirited's files
   are no longer vet-good files with a transcript, so they weren't measured
   again.
5. **Partly: a hand-labelled list instead of a truth.** A truth that is the
   rule itself proves nothing. `coverage/labels.tsv` holds the 11 files or
   groups looked at by eye with what they are; the step and the mark agree
   with each one they reach (Kid Sister S02E01 T2 is already bad by timing).
   Sirens S02E07 opnD2Z67 is rejected as incomplete for what is really a
   timing fault (3–4 s early in places) that the minute rule misses: the
   right outcome for another reason. Under credits4 the step changes nothing
   in fresh100, and in test100 it throws away 2 files credits4 calls good
   (Lazarus S02E07 opn-8496000, Stuart S01E06 opn-12757624). Both are
   paraphrases with complete siblings, and no episode goes to ASR for them.
6. **Done: library scans, read-only.**
   - Videos with a stored transcript (321, the fully vetted ones): the rule
     rejects 4 of 593 measured files. Lupin S01E01 T4 (two complete tracks
     stay), Poldark S01E05 opnGQ65Q, Madam S01E01 T2 (truncated: "Oh, we'll
     be so sad to say" for "... goodbye to Toby after he graduates") and
     Sirens (2014) S02E07 opnD2Z67 (3–4 s early around 10 min, which the
     timing rules miss). The last three are their episodes' only file, so
     those episodes get downloads tried, else their `+` file. All four are
     unwatched.
   - Every sidecar (6578 files with the sets): the truncation mark holds for
     Kid Sister S02E01–05 T2, Madam S01E01 T2 and the test copy of Kid
     Sister S02E01, and no other. Kid Sister S02E01–05 are all watched, so
     vetting never touches them; the user may want to replace those files
     by hand.

Where the line sits, and the files near it (77% / 15%):

| File | Carried | Runs/captions | By eye | v3 |
|---|---|---|---|---|
| Stuart S01E06 opn-12757624 | 74.8% | 0.33 | another script | incomplete |
| Sirens S02E07 opnD2Z67 | 72% | 0.21 | 3–4 s early in places | incomplete |
| Shōgun S01E08 (5 files) | 72–75% | 0.07–0.10 | foreign dialogue | good |
| Angel S02E16 (3 downloads) | 79.8% | 0.36–0.38 | condensed, faithful | good |
| Angel S03E04 opn-1832834 | 81.4% | 0.36 | condensed | good |
| Andy Barker S01E01 (3 files) | 85% | 0.23–0.24 | not looked at | good |

The margins are about 2–3 points on either side of 77%. Raising the line
would start deleting condensed files like Angel's, whose episodes have no
other file and would fall back to their `+` file.

What a deploy does: `VET_VERSION` 3 makes every unwatched episode unvetted,
and with the version-aware vetting (10-25) every file is judged again at
its show's next update: in full (from the stored transcript, no ASR) for
the next two and every episode fully vetted before, cheap for the rest.
