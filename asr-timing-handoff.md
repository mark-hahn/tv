# ASR pipeline — apps/asr (2026-08-29)

Reference for working on `apps/asr`. The engine is **Speechmatics batch
transcription**; cue timings are the engine's measured word timings.

---

## 1. What the pipeline does

`apps/asr/asr.js`, invoked as `node asr.js <video>` by tv-srvr's queue
(`apps/srvr/src/subsQueue.js`), which also scrapes the stage lines it prints.

1. Extract audio → 16 kHz mono flac (`-map 0:a:0`), whole video, no splitting
2. One Speechmatics batch job (`enhanced` operating point), polled to
   completion; transient HTTP failures retry with backoff
3. The json-v2 transcript's measured word timings become cues directly
   (`wordsToSegments`: new cue on a >1s speech gap, cue overflow, or a
   sentence end past 28 chars)
4. `splitLongCues` cuts oversize cues at measured word boundaries,
   `normalizeCues` merges/spaces/durations for readable display
5. `writeSRT` → `<video>.asr.srt` (last step; a failure leaves any old file)

Runtime ~20s for an 11-min episode, ~2 min for a 46-min episode. tv-srvr
aborts a run with SIGTERM; asr.js kills its ffmpeg children itself.

The API key is at `apps/asr/secrets/speechmatics-key.txt` — server only, not
in git. If it is missing the run dies fast, as intended.

## 2. Key constants

| constant | value | why |
|---|---|---|
| `SM_OPERATING_POINT` | enhanced | accuracy tier used for all measurements below |
| `SM_POLL_MS` / `SM_POLL_MAX` | 5000 / 240 | 20 min ceiling allows a feature film |
| `SEG_GAP_SEC` | 1.0 | word gaps larger than this never share a cue |
| `MIN_CUE_SEC` | 0.9 | minimum readable display |
| `MAX_LINE_CHARS` / `MAX_CUE_CHARS` | 42 / 84 | two lines per cue |
| `SENTENCE_BREAK_MIN` | 28 | break at a sentence end once a cue is this full |
| `GUARD_MIN_DUR` / `GUARD_MAX_DUR` / `GUARD_CHARS_PER_SEC` | 0.35 / 12.0 / 16 | display-duration bounds (`displayCap`) |

Punctuation uses the API default sensitivity (0.5). A sweep against CC ground
truth measured sentence-boundary F1 at 85.7% (0.3), 85.2% (0.5), 83.9% (0.7),
77.0% (0.9) — the dial only trades run-ons against false splits, so there is
little to gain by moving it.

## 3. How to evaluate a change — do this, not eyeballing

Ground truth is an **embedded CC track**. **Never test with a file that has
no CC track** — without one, a run only proves it didn't crash.

```
ffmpeg -i <video> -map 0:s:0 -c:s srt -f srt /tmp/cc.srt
```

Most of the library is `.mkv` (~2450 files vs ~225 `.mp4`) and many mkvs
carry English subrip CC — search both extensions with
`ffprobe -select_streams s`. `dvd_subtitle` tracks are bitmaps and unusable.

Tools (in `apps/asr`, run with plain node):

- `eval-timing.js <reference.srt> <candidate.srt>` — word-aligns the two and
  reports WER plus per-word timing error (median / p90 / max / count >1s),
  with the worst offenders listed.
- `check-srt.js <srt>` — invariants; these must always be zero: cues shorter
  than `MIN_CUE_SEC`, overlapping cues, consecutive starts closer than 0.45s.

Reference points, current pipeline:

| episode | CC type | median | p90 | words >1s |
|---|---|---|---|---|
| Childrens Hospital S06E01 (11 min) | burned-in SDH | 0.49s | 1.02s | 145 |
| A Thousand Blows S02E01 (46 min mkv) | DSNP subrip | 0.11s | 0.40s | 34 |

Reading the numbers:

- A **burned-in broadcast CC** is itself ~0.5–0.8s off, so ~0.5s median is
  that track's floor, not the pipeline's error. A **streaming subrip** track
  (e.g. DSNP) is frame-accurate and resolves real accuracy.
- On an SDH-style CC (all-caps sound effects, condensed dialogue) the WER
  number is meaningless — only the matched-word timing stats count.
- Repeated dialogue (crowd shouting) makes the word matcher pair a line with
  a later repetition, producing fake 30s+ "errors". Check the worst-offender
  list against the gap log before believing a large max.
- `gap of Ns with no cues` lines in the run log usually mark montages/music;
  confirm against the CC (which will show the same gap) before treating one
  as lost dialogue.

## 4. Approaches evaluated and rejected — do not re-derive

- **Punctuation sensitivity tuning** — see §2; measured, default kept.
- **LLM re-punctuation pass** (text-only, words locked, timings untouched):
  sentence-boundary F1 85.2% → 87.5%, cost ~1¢/episode. Rejected — the gain
  is modest and it adds a second vendor. Audio-assisted re-punctuation is
  not viable at all: given audio, an LLM transcribes what it hears instead
  of preserving the given words.
- **Display rate above 28 ch/s** in dense dialogue is a display constraint
  (a cue can only stay up until the next one starts), not a timing bug —
  don't chase it.

## 5. Operational notes

- The queue silently skips files that already have `.asr.srt`
  (`subsQueue.js`, "asr skip exists"). A re-run appears to do nothing.
- **Never `rm` a media-folder file before a run** — `/mnt/media` is not in
  the restic system backup. Write to a temp path and move on success, as
  `asr.js` does.
- `unilog/check.js asr` validates log sites before deploy; the `./srvr asr`
  deploy runs reconciliation itself.
- The eval scripts print through their `out()` helper, not console.log — the
  deploy reconciler rewrites console.* calls into unilog DB rows, and these
  results must reach stdout.
