# ASR pipeline — handoff (2026-08-29)

Context for continuing work on `apps/asr`. Written because the originating
conversation grew long and started losing track of which code produced which
output. **The negative results below are the expensive part — they cost several
hours and ~$3 of API calls to establish. Do not re-derive them.**

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
   every Gemini timestamp with a measured one
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

All deployed and checksum-verified as of 18:15 on 2026-08-29:
`apps/asr/asr.js`, `apps/asr/ctcalign.py`, `apps/srvr/src/subsQueue.js`,
`apps/srvr/index.js`, `apps/client/src/srvr.js`,
`apps/client/src/components/local.vue`.

**NOT DEPLOYED — in the working tree only:**

- **Speech-rate guard** (`MAX_CHARS_PER_SEC = 28`). A cue whose aligned
  duration implies impossible speech was mis-aligned. Catches the reported
  failure at 1:00 in Childrens Hospital S06E01, where 70 characters were
  squeezed into 1.09s (64 ch/s) and dragged the next cue 2.2s early. The
  existing guard missed it because the cue's *start* looked fine next to its
  neighbours — only the duration was impossible.
- **`wrapLines` fallback** — was emitting a single 79-char line when no split
  kept both halves under 42; now takes the most balanced split.

Both verified against the real failing data but **never run end-to-end**.
Deploy with `./srvr asr`.

Nothing is committed. `git status` shows `apps/asr/asr.js` modified and
`apps/asr/ctcalign.py` untracked, plus the srvr/client abort changes.

---

## 3. Key constants (all in asr.js)

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

---

## 4. How to evaluate a change — do this, not eyeballing

Compare against the **embedded CC track**, which is ground truth for the encode:

```
ffmpeg -i <video>.mp4 -map 0:s:0 -c:s srt -f srt /tmp/cc.srt
```

Not every episode has one (Madam Secretary does not; Childrens Hospital does).
Build a word stream from each side, align with Levenshtein, and report WER plus
per-word timing error (median / p90 / max / count over 1s).

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

- **The long path has never completed end-to-end.** No 45-minute episode has
  finished with current code. Two attempts died to ssh drops, one before the
  write. The split, three sequential calls and cue merging were observed
  working (267/200/171 cues on a 43-minute episode); the alignment pass at that
  length and the final write are unverified. A 43-minute alignment is ~4–5 min
  of CPU and much more memory than an 11-minute one.
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
  as `asr.js` does. That episode currently has no subtitle.
- Childrens Hospital S06E01's `.asr.srt` is generated output; the earlier
  variants (`.srt1`, `.srt2`, `.srtn`) were deleted during cleanup, including
  the Gemini response behind the best-rated run — so that run can no longer be
  reproduced or diffed against.
