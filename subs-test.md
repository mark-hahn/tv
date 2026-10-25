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

- Vetting **version 2** has been deployed since 10-25 02:43 PDT
  (`apps/srvr/src/subJudge.js`, `VET_VERSION` 2; the change is staged in
  git with `apps/srvr/scripts/vet-validate-ref.py`). The spot rule fails
  two agreeing captions within a minute at more than 1200 ms early or 600 ms
  late (was 500 either way); the minute rule fails a 60 s window of 6 or more
  dense pairs with a median over 450 ms early or 300 ms late (was 8 pairs,
  500 either way). The JS judge matched the Python model on all 930 set
  files before the deploy (`vet-validate-ref.py` + `vet-validate.js`).
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
- The user restored, from the 07:39 restic snapshot, the only files I had
  changed on the server after it (three files in `observe/`). Nothing the
  app wrote was restored.

## Vetting version 3, deployed 10-25 14:07

The coverage fix (`subs-coverage.md`, "The fix"): the judge's incomplete
step (77% carried / runs over 15% of captions), cheap vetting's truncated
mark, `VET_VERSION` 3. Validated 930/930 against evaluate.py FINAL +
`incShare77+incRuns15`. It sits in the workspace (`subJudge.js`, `subVet.js`,
`subs.js`, `scripts/vet-validate-ref.py`). Before the deploy the Sirens (2014)
S02E07 download it rejects was copied to `coverage/kept/`, since the user
was observing it; the Stuart S01E06 download `opnMFKTY` was placed beside
its (watched) video for observing, and is deleted when the user says.
Old Christine S02E02's download `opnCA5YW` (v1 good, v3 bad: minute
-301 ms at 3.2 min) was downloaded again and put back (copy in
`/tmp/vv/opnCA5YW.srt` on hahnca.com); vetting deletes it again at the
show's next update, which selecting the show in the web client starts.
The server's analysis copies changed with it: `fresh100/evaluate.py`
(backup `.bak-1025b`), `plusfile/plus.py` (backup `.bak-1025`), new folder
`coverage/`.

## Test data

| Where | What | State |
|---|---|---|
| `fresh100/` | training set: 100 random watched-or-not library episodes from 69 shows, complete Speechmatics transcripts (`v/<id>/transcript.json.gz`), every embedded track and up to 8 OpenSubtitles downloads fresh (473 files), `picks.json`, `truth-cache.json.gz` | complete; README documents truths orig/credits/credits2/credits3/credits4 and the variants table |
| `test100/` | held-out test set, same layout (366–380 good files by truth), scored once per logic by `evaluate.frozen.py` or `evaluate.py --set test100` | complete |
| `planted/` | 165 base files with known-answer defects (`planted.py`), gap-fill tests (`fill.py`), silence-detect idea (`handcheck.py`, dropped) | complete, from 10-23 |
| `plusfile/` | old `+` (ASR-cue) files for both sets, for the cheap-vetting judge | complete |
| `observe/` | the observation page's data: `moments.json` (80 moments: 72 base places in 24 watched episodes, 8 real rejections), `clips/` (387 mp4s, 42 s each, 720p; many from earlier moment sets), `ratings.jsonl` (**162 answers**, session 1; snapshot `ratings-session1-1025-0011.jsonl`), `flips.json` + `step3-flips.txt` (02:45 replay: 41 kept files v2 rejects, 13 rejected tracks v2 passes, 102 deleted downloads unjudgeable, 0 flips in watched episodes), `coverage.txt/.tsv`, `eye-search.txt` / `eye-search-test100.txt`, `spot-replay.txt`, `work/` (31 re-read tracks) | current |
| `snapshots/`, `lists/`, `tests/`, `scripts/` | 10-22/23 clip-check era: a frozen `subs.db`, deleted-file lists, dry-run outputs, one-off analyses | historical |

Truth versions in `evaluate.py`: `credits3` (3-minute part medians within
250/500 ms, lyric and end exemptions) was the standard until 10-25;
`credits4` is **the eye**: a file is bad when any 60 s of captions with 6+
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
  `segE450`, `segL300` (minute rule pairs, early, late), `spotE1200`,
  `spotL600` (spot rule). Output in `variants/<truth>/<name>/` and
  `compare.txt`. `evaluate.py.bak-1025` is the pre-10-25 copy.
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

- Eye thresholds (162 answers): one caption ~950 ms early / ~450 late; a
  run of 3 ~425 / ~225; a step ~600 / ~350; drift ~375 / ~225; controls 8%
  "bad". Late is about twice as bad as early.
- Under credits4 the version 1 logic kept 24 bad files (fresh100) and 11
  (test100); the version 2 setting keeps 0 and 0, throwing away 15 and 29
  good files (version 1: 14 and 24) with more complete ASRs (23 and 11
  episodes against 22 and 6).
- The replay of the library under version 2 lists 41 kept files it would
  reject (nearly all 300–390 ms late in one minute, often every file of an
  episode at the same minute) and 13 rejected tracks it would pass; none is
  in a watched episode, so none has been watched.

## What to do next

User:
1. (Done 10-25: vetting re-judges old verdicts on a version change.)
2. Watch some episodes on `step3-flips.txt` in the normal way, then say
   which; or relax the spoiler rule for shows you don't mind.
3. (Done 10-25 14:07: vetting version 3 deployed.)
4. CLAUDE.md's subtitle section still says "vetted v1" and the 500 ms rules;
   you maintain that file.

Claude, when told:
1. After episodes on the flip list are watched: `node prep.mjs && node
   cut.mjs` in `observe/`, then the user rates at port 8750; summarize
   whether the flips agree with version 2.
2. (Done 10-25 12:11: the version-aware fix, see above.) Check the next days'
   `subVet.js` vetting lines for the 41 kept files being deleted and the
   tracks coming back.
3. If a rules change comes up again: edit constants in `subJudge.js`, bump
   `VET_VERSION`, update `FINAL` in `vet-validate-ref.py`, run the validation,
   score with `eye-search.py --variants`, then deploy.
4. Keep the rules of this work: only watched episodes on the page, no
   uncaptioned speech in a clip, "do step N" means the plan's step N only,
   and nothing in production without an explicit yes.
