# Subtitle test data and scripts: handoff (10-25)

Where the subtitle timing work stands, what data and scripts exist, and what
to do next. Everything lives on hahnca.com under
`/root/dev/apps/tv/apps/srvr/data/sub-analysis/` unless marked local. All of
it reads tv-srvr's data read-only (`subs.db`, `tvdb.db`, transcripts, the
library) and writes only inside its own folders. Plans and findings are in
the workspace: `subs-observe.md` (the observation plan, results, steps 1–3),
`subs-coverage.md` (a production bug: files that don't carry the speech pass
vetting), `subs-final-plan.md` (the vetting design), `sub-data.md` (older
timing data). Memory notes mirror the state.

## What is live in production

- Vetting **version 4** since 10-25 15:25 (`apps/srvr/src/subJudge.js`,
  `VET_VERSION` 4). Its rules are in CLAUDE.md's Subtitles section: spot
  rule 1200 ms early / 600 ms late, minute rule 900 / 600 over 6 pairs, the
  incomplete step (under 77% of the speech carried and runs over 15% of the
  captions), the missing check, and cheap vetting's truncated mark. The JS
  judge matches the Python `FINAL`
  (`whole+refit+mend+mlyr+mslide+segMin6+segE900+segL600+spotE1200+spotL600+incShare77+incRuns15`)
  on all 930 set files.
- The versions: 1 (10-24); 2 (10-25 02:43): the minute rule 450 / 300 and
  the spot rule 1200 / 600 from the clip ratings (`subs-observe.md`); 3
  (14:07): the coverage fix (`subs-coverage.md`); 4 (15:25): the minute
  rule halved. Watching whole episodes, the user found files just past
  version 2's limits fine (Old Christine S02E02 `opnCA5YW`, 301 ms late over
  a minute) and judged the clip ratings too strict: they measured what can
  be noticed in a 30 s clip, not what bothers over an episode.
- Version-aware vetting, deployed 10-25 12:11 at the user's word. Before it,
  a `VET_VERSION` change re-vetted episodes but judged only files with no
  verdict yet. Now:
  - `checks.version` stamps each judge's check (`vet`, `vet-cheap`; not
    `vet-audio`, whose verdicts don't depend on the judge's rules), and
    `subs.unfitVer` each unfit mark full vetting makes. Old rows were dated
    by tv-srvr's v2 start (02:42:26, `VET_V2_SINCE_MS`): checks 560 + 940 v1,
    309 + 700 v2; unfit marks 76 v1, 56 v2, 1037 null (the older checks' and
    audio matching's, which hold under every version).
  - `subs.isCurrentVet()`. `keptByFull`, `isJudged` (both levels) and
    `misfitRemembered` count only current verdicts. `nextCandidate` ignores
    an unfit mark from another version. `isVetGood` (the ✓) is unchanged: an
    old ✓ stays until its file is judged again.
  - `episodesToVet` vets again: a current full episode with a file judged
    under an older version, or with a copy of an embedded track deleted
    under one (the full entry copies it out again); an episode fully vetted
    under an older version, in full even when it is no longer in the next
    two (before, it went to cheap); and a current cheap episode with a file
    judged under an older version, when it has a `+` file.
  - `vetFull`'s `filledBefore` leaves out a file in `held`: a file filled
    under v1 and judged missing again would otherwise have been deleted.
  - At deploy, the dry run counted 169 v1-full and 1044 v1-cheap episodes,
    which are vetted again anyway, plus 31 v2-full and 32 v2-cheap episodes
    that the new rules send back.
  - OpenSubtitles: v1-unfit downloads are candidates again, and full
    vetting's `downloadUntilFit` has no daily reserve, so expect some extra
    downloads in the next days.
- Files placed for the user to watch; delete them when the user says:
  - Stuart Fails to Save the Universe S01E06 `opnMFKTY` (watched; a
    paraphrased download, rejected as incomplete in test100).
  - Old Christine S02E02 `opnCA5YW` (unwatched; downloaded again at 14:48,
    copy in `/tmp/vv/opnCA5YW.srt`). Version 4 passes it, so its next
    vetting keeps it with a ✓.
  - Nobody Wants This S02E01 `.S400.srt` and S02E05 `.S500.srt` (watched):
    well-timed files moved later for the whole episode (median 419 and
    518 ms), made by `/tmp/vv/make-late.mjs`, for deciding the late limit.
  - Sirens (2014) S02E07's download `opnD2Z67`, which version 3 rejects (it
    runs 6.6 s early after 15 min, which the timing rules miss), was copied
    to `coverage/kept/` before the deploy.
- Analysis copies changed on the server: `fresh100/evaluate.py` (backups
  `.bak-1025`, `.bak-1025b`, `.bak-1025c`; variant parts `incShareN`,
  `incRunsN`; truth `credits5`), `plusfile/plus.py` (backup `.bak-1025`),
  new folder `coverage/` (its README).

- 10-25: l/I OCR repair (`subOcr.js`) added to the sidecar repair step
  (`subPrepare.glueSidecars`, before the glue split); deployed with
  `./srvr srvr`. The library pass ran 16:59: 50 files, 4,439 words,
  originals in `data/ocr-backup/`; `scripts/fix-glued-subs.js` carries it
  from now on. Episode-0 files (Cold Feet S01E00) are out of the API's
  reach.

## Test data

| Where | What | State |
|---|---|---|
| `fresh100/` | training set: 100 random watched-or-not library episodes from 69 shows, complete Speechmatics transcripts (`v/<id>/transcript.json.gz`), every embedded track and up to 8 OpenSubtitles downloads fresh (473 files), `picks.json`, `truth-cache.json.gz` | complete; README documents truths orig/credits/credits2/credits3/credits4 and the variants table |
| `test100/` | held-out test set, same layout (366–380 good files by truth), scored once per logic by `evaluate.frozen.py` or `evaluate.py --set test100` | complete |
| `planted/` | 165 base files with known-answer defects (`planted.py`), gap-fill tests (`fill.py`), silence-detect idea (`handcheck.py`, dropped) | complete, from 10-23 |
| `plusfile/` | old `+` (ASR-cue) files for both sets, for the cheap-vetting judge | complete |
| `coverage/` | the coverage fix's measures (`measure.py`, `library.py`, `signs.mjs`), eyeball scripts (`look.mjs`, `look-lib.mjs`), `labels.tsv`, `kept/` | current, README there |
| `observe/` | the observation page's data: `moments.json` (80 moments: 72 base places in 24 watched episodes, 8 real rejections), `clips/` (387 mp4s, 42 s each, 720p; many from earlier moment sets), `ratings.jsonl` (**162 answers**, session 1; snapshot `ratings-session1-1025-0011.jsonl`), `flips.json` + `step3-flips.txt` (02:45 replay: 41 kept files v2 rejects, 13 rejected tracks v2 passes, 102 deleted downloads unjudgeable, 0 flips in watched episodes), `coverage.txt/.tsv`, `eye-search.txt` / `eye-search-test100.txt`, `spot-replay.txt`, `work/` (31 re-read tracks) | current |
| `snapshots/`, `lists/`, `tests/`, `scripts/` | 10-22/23 clip-check era: a frozen `subs.db`, deleted-file lists, dry-run outputs, one-off analyses | historical |

Truth versions in `evaluate.py`: `credits3` (3-minute part medians within
250/500 ms, lyric and end exemptions) was the standard until 10-25;
`credits5` (10-25) is credits4 with the eye's limits doubled (1000 ms early,
700 ms late), the standard since version 4. `credits4` is **the eye**: a file is bad when any 60 s of captions with 6+
pairs has a median over 500 ms early or 350 ms late, a 3-minute part is over
2 s off, or speech is missing; pairs over 30 s off are repeated-text
mismatches and ignored; labels good/bad/nofit. It can't score single-caption
errors: the pairs' natural spread is σ ≈ 140 ms with 1% beyond −500/+650 ms
in files the eye finds fine, and that is real caption placement, not
matching error.

## Scripts

Set scoring (`fresh100/`):
- `evaluate.py --variants a,b --truth credits4 [--set test100]`: scores
  logic variants in about a minute; variant parts include the deployed
  judge's `whole+refit+mend+mlyr+mslide` plus parameterized `segMin6`,
  `segE900`, `segL600` (minute rule pairs, early, late), `spotE1200`,
  `spotL600` (spot rule), `incShare77`, `incRuns15` (incomplete step).
  Output in `variants/<truth>/<name>/` and `compare.txt`.
  `evaluate.py.bak-1025` is the pre-10-25 copy.
- `../../scripts/vet-validate-ref.py /tmp/ref.json` then
  `node scripts/vet-validate.js /tmp/ref.json` (in `apps/srvr`): the JS
  judge against the Python `FINAL` variant, 930 files.

Observation page (`observe/`, README there has the keys and rules):
- `prep.mjs`: builds `moments.json` from watched episodes only (tvdb
  `watched`), good files fixed by their line, no uncaptioned speech in a
  clip (`lib/speech.mjs`), files carrying 85%+ of the speech; also turns
  `flips.json` into real moments of watched episodes. `cut.mjs` cuts
  missing clips (two at a time, idle I/O). `server.mjs` + `page.html`: port
  8750, keys 1/2/3, r, u (undo), a/b; staircases per planted kind; answers
  at any time, an early non-bad answer counts for nothing; A/B alternates
  until answered; flips served worst first. The server is running
  (`setsid nohup node server.mjs`); restart it by pid, never with a
  `pkill -f` that matches the ssh command itself.
- `eye-noise.py`, `eye-rules.py`: the truth pairs' spread and candidate eye
  rules against the labels and the rated files. `eye-kept.py`: files the
  logic keeps that credits4 calls bad. `eye-search.py [--set test100
  --variants <name>]`: the constant grid (73 settings), ranked.
- `step3-replay.mjs`: every file full vetting checked, judged again with the
  live judge from its stored transcript; writes `flips.json`,
  `step3-flips.txt`. `coverage.mjs`: how much of the speech each good file
  carries (for `subs-coverage.md`). `spot-replay.mjs`: what the spot rule
  alone rejects.
- `lib/judge.mjs` loads the live `subJudge.js` with its internals exported
  (and constant overrides); `lib/speech.mjs` the uncaptioned/coverage
  measures; `lib/asrCues.mjs` the `+` file builder copied from `asr.js`;
  `lib/common.mjs` paths, probes, the watched map.

## Results so far

- Eye thresholds from the clip ratings (162 answers): one caption ~950 ms
  early / ~450 late; a run of 3 ~425 / ~225; a step ~600 / ~350; drift
  ~375 / ~225; controls 8% "bad". Late is about twice as bad as early. The
  user later judged these too strict for whole episodes (version 4).
- Version 4 against version 3 (bad kept / good thrown away / ASR
  episodes): under credits5 (the eye's limits doubled) fresh100 0/82/23 ->
  0/27/15, test100 0/68/11 -> 0/26/4; under credits4 fresh100 0/15/23 ->
  46/6/15, test100 0/31/11 -> 27/16/4. Version 4 accepts 3 files per set
  whose worst 3-minute part is over 500 ms off after the fix.
- Coverage (version 3): the incomplete step rejects 2 test-set files and 4
  library files (Lupin S01E01 T4, Poldark S01E05 opnGQ65Q, Madam S01E01 T2,
  Sirens (2014) S02E07 opnD2Z67); the truncated mark holds for Kid Sister
  S02E01-05 T2 (watched) and Madam S01E01 T2.
- Cheap vetting judges timing against old `+` files; 620 unwatched episodes
  have Mistral's (coarse, wandering ±0.5 s) and 113 Speechmatics' without a
  transcript. Even ideal `+` files reject 40 of 643 transcript-good set files
  (Due South S04E05 `opnJRZ2G`, rejected at 304 ms late, looked right).

## What to do next

User:
1. Watch the whole-episode tests (Nobody Wants This S02E01 "s400", S02E05
   "s500") and say whether the minute rule's 600 ms late limit should move.
2. Decide on cheap vetting against old `+` files: stop judging timing
   against Mistral's, or never take a ✓ away there.
3. Say when the placed observation files can be deleted.
4. Kid Sister S02E01-05 T2 are truncated, but watched, so vetting never
   touches them; replace them by hand if wanted.

Claude, when told:
1. A rules change: edit the constants in `subJudge.js`, raise
   `VET_VERSION`, update `FINAL` in `scripts/vet-validate-ref.py`, run the
   validation (930/930), score both sets under credits4 and credits5, check
   no ASR job is running, then `./srvr srvr` and the pm2 logs.
2. Keep the rules of this work: only watched episodes on the observation
   page, no uncaptioned speech in a clip, "do step N" means the plan's step
   N only, and nothing in production without an explicit yes.
