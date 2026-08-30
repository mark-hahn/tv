# ASR pipeline — handoff (2026-08-29)

Context for continuing work on `apps/asr`. Written because the originating
conversation grew long and started losing track of which code produced which
output. **The negative results below are the expensive part — they cost several
hours and ~$3 of API calls to establish. Do not re-derive them.**

Updated later on 2026-08-29 (second session): the long path is now verified
end-to-end, the alignment is windowed, RECITATION aborts retry, and two guard
bugs found by CC-scored validation are fixed. See §2 and §6.

---

## 1. What the pipeline does now

`apps/asr/asr.js`, invoked as `node asr.js <video>` by tv-srvr's queue.

1. Extract audio → `-ac 1 -ar 48000 -b:a 256k` wav
2. Preprocess → `highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11`
3. If duration > `MAX_PART_SEC` (1140s), split into equal parts snapped to
   silence; otherwise one part
4. Each part → flac → Files API → Gemini `gemini-3.6-flash`
5. Merge cues onto one timeline
6. **Forced alignment** (`apps/asr/ctcalign.py`, torchaudio MMS_FA) replaces
   every Gemini timestamp with a measured one. Alignment runs in windows of
   ≤300s of consecutive cues (placed by Gemini's rough times, ±20s margin) —
   one whole-episode trellis is frames × tokens and dies on a 43-min episode
7. `guardAlignment` rejects bad alignments, `splitLongCues` splits on sentence
   boundaries, `normalizeCues` merges/spaces/durations
8. `writeSRT` → `<video>.asr.srt` (last step; a failure leaves the old file)

Runtime ~2.5 min and ~$0.06 for an 11-minute episode.

### Hard dependency

`/root/dev/aligner-venv` (952 MB: torch 2.13 CPU + torchaudio 2.11) plus the
cached MMS_FA model (~1.2 GB in `/root/.cache/torch`). **If this venv is lost,
ASR fails hard** — deliberately, per the die-fast convention. It is not in git.
Recreate with:

```
python3 -m venv /root/dev/aligner-venv
/root/dev/aligner-venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch torchaudio
```

---

## 2. Deployed vs pending

**Everything is deployed and checksum-verified as of the evening of
2026-08-29**, including all of the below. Deploy with `./srvr asr`.

Landed in the second session (all verified end-to-end, see §6):

- **Speech-rate guard** (`MAX_CHARS_PER_SEC = 28`). A cue whose aligned
  duration implies impossible speech was mis-aligned. Catches the reported
  failure at 1:00 in Childrens Hospital S06E01 (70 chars in 1.09s).
- **`wrapLines` fallback** — when no split keeps both lines under 42 chars,
  takes the most balanced split instead of one over-long line. A >42-char
  line in output is this fallback working, not a bug (e.g. an 80-char cue
  with no word boundary in the 37–42 range).
- **RECITATION retry** — Gemini sometimes aborts a part with finishReason
  RECITATION (it recognizes the episode's dialogue). It is transient: retries
  with a bumped seed (`GEMINI_SEED + attempt - 1`) recover. Madam Secretary
  S06E09 part 3 needed 1 retry on one run and 2 on another.
- **Windowed alignment** — `ctcalign.py` aligns cues in windows of ≤300s
  (`WINDOW_SEC`, `MARGIN_SEC = 20` in ctcalign.py) instead of one call over
  the whole episode; the single-call trellis killed the aligner (signal, empty
  stderr) on a 43-min episode. asr.js now passes `{text, start, end}` per cue
  so the aligner can place windows. CC-scored validation on an 11-min episode:
  median 0.55s — identical to the pre-window reference.
- **Guard duration fixes** — a rate-rejected cue kept the rejected alignment's
  impossible duration (80 chars shown for 0.9s); it now falls back to Gemini's
  duration, and the duration clamp also fires on >28 ch/s.

`asr.js` (modified) and `ctcalign.py` (untracked) are uncommitted in the
working tree; `check-srt.js` / `eval-timing.js` (§4) are new and untracked.

---

## 3. Key constants (asr.js unless noted)

| constant | value | why |
|---|---|---|
| `MAX_PART_SEC` | 1140 | 65,536 output-token cap ÷ 28.7 tok/s × 0.5 safety |
| `GEMINI_TEMPERATURE` | 0 | greedy; default was 1 (sampling) |
| `GEMINI_SEED` | 42 | helps short requests only — see §5 |
| `GEMINI_THINKING_LEVEL` | LOW | better WER, −28% cost, −31% time |
| `GUARD_MAX_DEVIATION` | 2.5 | tuned: 3.0 missed a real failure, 2.0 caused a false rejection |
| `MAX_CHARS_PER_SEC` | 28 | pending; CC's fastest real line is 24.1, so only ~15% headroom |
| `MIN_CUE_SEC` | 0.9 | minimum readable display |
| `MAX_LINE_CHARS` / `MAX_CUE_CHARS` | 42 / 84 | two lines per cue |
| `WINDOW_SEC` / `MARGIN_SEC` (ctcalign.py) | 300 / 20 | alignment window size; margin absorbs gemini drift (p90 ~2.5s) |

---

## 4. How to evaluate a change — do this, not eyeballing

Compare against the **embedded CC track**, which is ground truth for the encode:

```
ffmpeg -i <video>.mp4 -map 0:s:0 -c:s srt -f srt /tmp/cc.srt
```

Not every episode has one (Madam Secretary does not; Childrens Hospital and
Kid Sister do). **Never test with a file that has no CC track** — without
ground truth a run only proves it didn't crash. Long CC-bearing files are
plentiful: the library is mostly `.mkv` (~2450 files vs ~225 `.mp4`) and many
mkvs carry English subrip tracks — e.g. A Thousand Blows S02E01 (2784s).
Don't scan only `*.mp4` when looking for test files.

Build a word stream from each side, align with Levenshtein, and report WER
plus per-word timing error (median / p90 / max / count over 1s) — this is
`apps/asr/eval-timing.js <reference.srt> <candidate.srt>`. The invariant
checks below are `apps/asr/check-srt.js <srt>`. On an SDH-style CC track
(all-caps sound effects, condensed dialogue) the WER number is meaningless —
only the matched-word timing stats count. Two more caveats:

- The ~0.75s floor belongs to *burned-in broadcast* CC tracks. A professional
  streaming subrip track (e.g. DSNP mkvs) is frame-accurate: A Thousand Blows
  S02E01 scored **median 0.18s / p90 1.03s**, so on such files the eval can
  resolve far finer errors.
- Repeated dialogue (crowd shouting) makes the word matcher pair a CC line
  with a later repetition, producing fake 60s+ "errors". Check the worst-5
  list against the gap log before believing a large max.
- These two scripts must print with `out()` (process.stdout.write), never
  console.log — the deploy reconciler rewrites console.* in apps/asr into
  unilog DB calls, which silenced all their output once already.

**Reference points measured on Childrens Hospital S06E01:**

| | median | p90 | words >1s |
|---|---|---|---|
| Gemini timings raw | 0.79s | 2.51s | 508 |
| after CTC + guard | 0.55s | 1.06s | 166 |
| two professional subs vs each other | 0.74s | 1.14s | 44 |

That last row is the **measurement floor** — the CC track is itself ~0.78s
ahead of both Gemini and a second professional sub, so a median near 0.75s is
as good as this method can resolve. Only the tail (p90) is a meaningful target.

Cheap invariant check on any output — all three must be zero:

- cues shorter than `MIN_CUE_SEC`
- cues overlapping the previous cue
- consecutive starts closer than 0.45s

---

## 5. Negative results — do not repeat these

- **No setting makes full episodes reproducible.** `temperature: 0` + `seed: 42`
  gives byte-identical output on a 60s clip but *not* on a full episode (180 vs
  226 cues on identical input). The divergence is server-side. Consequence:
  "this run looks worse than the last one" cannot be judged by eye — part of any
  difference is the model returning different words on identical audio.
- **Silence-based timing correction does not work.** Three variants tried —
  snap-to-nearest-edge, region bucketing with proportional rebase, and ordinal /
  DTW assignment ignoring Gemini's times. All were *worse than doing nothing* at
  every threshold. Energy VAD finds where sound is, not where an utterance
  begins; region boundaries do not correspond to cue boundaries even when the
  counts nearly match (220 regions vs 222 cues was a coincidence — ordinal
  assignment on it produced 29s median error).
- **Re-running a bad section does not fix it.** A 90-second clip covering a
  known-bad stretch, transcribed alone with a known offset, reproduced the same
  ~3s error within 0.4s. The error is a reproducible property of that audio, not
  accumulated drift.
- **Shorter segments do not improve accuracy.** 1 / 2 / 4 / 8 parts scored
  13.9% / 15.3% / 14.8% / 14.1% WER — entirely inside the noise band (three runs
  at identical settings gave 13.7 / 14.3 / 14.1%). Splitting is *only* a
  token-cap workaround; do not split short episodes.
- **aeneas cannot be installed.** Needs `numpy.distutils`, gone in Python 3.12.
  Would require a separate 3.11 interpreter. The CTC aligner supersedes it.
- **The "100ms accuracy" prompt line is harmful.** Adding
  `- the times must be accurate to 100ms.` made the model stop chaining cue ends
  to the next start, and error went from 0.81s to 4.75s median. Do not re-add.
- **Mistral/voxtral timing transfer works but was not adopted.** Aligning
  Gemini's text to a Mistral transcript and carrying Mistral's timings scored
  0.30–0.50s median — statistically tied with CTC (0.29–0.51s). Rejected to
  avoid a second vendor and Mistral's coverage gaps (it dropped a 108-word
  passage on one episode). Worth revisiting only if CTC proves unreliable.

Engine comparison, three episodes, WER vs CC: Gemini 12.4 / 4.4 / 7.1%,
Mistral 17.3 / 8.7 / 9.2%. Mistral makes fewer substitutions but far more
deletions.

---

## 6. Known gaps and risks

- **The long path is verified end-to-end (2026-08-29).** Madam Secretary
  S06E09 (43.4 min, 3 parts, 968 cues) completed in ~13 min for $0.25:
  RECITATION on part 3 recovered by retry, 968/968 cues aligned by the
  windowed aligner, all §4 invariants zero, `.asr.srt` written. Before the
  windowing fix the aligner died at this length (killed by a signal, empty
  stderr — the whole-episode trellis needs tens of GB).
- **The split path is CC-verified (2026-08-29).** Kid Sister S02E03 (24.3 min,
  2 parts, 492 cues, $0.13): invariants zero, timing vs its SDH CC track
  median 0.67s / p90 1.79s / 514 words >1s — statistically identical to the
  July 18 `.asr.srt` it replaced (0.66 / 1.73 / 517), both at the measurement
  floor.
- **Full length is CC-verified too (2026-08-29).** A Thousand Blows S02E01
  (46.4 min mkv, 3 parts, 517 cues, $0.16, ~9 min runtime): invariants zero,
  and against its frame-accurate DSNP subrip track **median 0.18s /
  p90 1.03s** over 2372 matched words — the strongest accuracy evidence so
  far. Its worst "errors" (~72s) were eval mispairings of repeated crowd
  shouting across a montage gap that the CC also leaves empty, not pipeline
  errors.
- **Part boundaries are a timing weak spot.** In that run the only bad cluster
  (~10 words, ~9s early) sat right at the 702s part boundary: Gemini garbled
  the dialogue crossing the boundary and compressed the surrounding cue times,
  and the aligner can't rescue cues whose text doesn't match the audio. One
  cluster per boundary at worst; revisit only if it shows up user-visibly
  (a fix would be overlapping the parts slightly and deduping cues).
- **Final display rate can still exceed 28 ch/s** in dense dialogue — the cue
  can only stay up until the next cue starts, so this is a display constraint,
  not a timing bug. After the guard fixes the worst observed is ~37 ch/s
  (was 88).
- **`MAX_CHARS_PER_SEC = 28` is barely above observed real speech (24.1).** If
  legitimate fast lines start falling back to Gemini timings, raise it.
- **The queue silently skips files that already have `.asr.srt`**
  (`subsQueue.js`, "asr skip exists"). A re-run appears to do nothing. The pane
  does print `=== Skipped: … ===`, but the buffer is cleared first, so a
  reloaded pane shows only that line.
- **Long jobs are fragile over ssh.** Several were killed by connection drops.
  Run them via the queue, or with nohup, not a foreground ssh.

---

## 7. Incidents worth knowing

- **Deleted subtitle, unrecoverable.** `Madam Secretary S06E09`'s April Mistral
  `.asr.srt` was destroyed by an `rm -f` in a test harness whose run then failed
  to start. `/mnt/media` is not in the restic system backup. **Never `rm` a
  media-folder file before a run** — write to a temp path and move on success,
  as `asr.js` does. Regenerated 2026-08-29 by the long-path verification run,
  so the episode has a subtitle again.
- Childrens Hospital S06E01's `.asr.srt` is generated output; the earlier
  variants (`.srt1`, `.srt2`, `.srtn`) were deleted during cleanup, including
  the Gemini response behind the best-rated run — so that run can no longer be
  reproduced or diffed against.
