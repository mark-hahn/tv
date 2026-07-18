# down-coll-plan — duplicate racing download for one episode

Case study: `A Good Girl's Guide to Murder` S02E01 (2026-07-17). Verified from the
unilog DB and a live listing of the season folder on the remote.

## Verified timeline

| time (PST) | who | event |
| --- | --- | --- |
| — | disk | old 1080p `…S02E01…KRATOS.mkv` already on disk |
| 21:24:03 | tor | user sends **1080p EDITH** download |
| 21:24:34 | down | `FLEX SKIP (disk file same/better quality)` for `…S02E01.1080p.WEB.h264-EDITH.mkv` — KRATOS 1080p already on disk, same res → **skipped** (main.js:3156) |
| 21:32:49 | tor | user sends **2160p EDITH** download |
| 21:33:53 | down | `flex: renamed worse disk file to .old`: KRATOS `.mkv` → `.mkv.old`; **2160p EDITH** download starts (main.js:3174 → tvJson.js:74) |
| 21:33:53 | srvr | chokidar `video deleted`; gap check sets `fileGap` for the show |
| 21:38:59 | down | **1080p EDITH** download starts (tvJson.js:74) — no longer skipped |
| 21:42:49 | srvr | `video added` (1080p EDITH finished first); `fileNeedsSubChecked(…1080p…EDITH.mkv)=true` → **enqueued to chksrt** |
| 21:44:24 | srvr | `video added` (2160p EDITH finished); `fileNeedsSubChecked(…2160p…EDITH.mkv)=true` → **enqueued to chksrt** |
| 22:08:17 | srvr | 2160p mpfour transcode done |

Your analysis is correct up to the race. **Two corrections:**

1. The old 1080p was **renamed to `.old`, not deleted** (main.js:3168-3188, and again
   in worker.js:192-230 right before rsync). Effect on gapcheck is the same — no live
   file for the episode during the window — but nothing was deleted.
2. **The redundant 1080p EDITH file is still on disk and still live.** The 2160p did
   *not* overwrite it (different filenames). Current `Season 2` contents for S02E01:
   - `…S02E01.1080p.WEB.h264-EDITH.mkv` — 2.73 GB, **live** ← redundant duplicate
   - `…S02E01.HLG.2160p.WEB.h265-EDITH.mkv` — 6.74 GB, **live** ← intended keeper
   - `…2024.S02E01.1080p…KRATOS.mkv.old` — 2.73 GB, dead fallback
   - EDITH-1080p and EDITH-2160p each have `.mb2/.mb3/.opn*.srt` sidecars; neither has
     a `.mb.chosen`, so **both are still pending in chksrt**.

   So the end state is **not** correct: the episode has two active video files (an Emby
   duplicate) and two chksrt entries, and ~2.7 GB is wasted. The `.old` KRATOS is
   another ~2.7 GB of dead weight.

## Root causes

**A. Cross-cycle S/E dedup gap (the redundant re-download).**
The fromFlex acceptance checks decide "already have this episode?" two ways, both of
which went blind during the replacement window:
- the disk check (main.js:3112-3167) does `readdirSync` and matches `SxxExx` **live
  video files only** — the KRATOS was `.old` and the in-flight 2160p lives in
  `.rsync-tmp/` (worker.js uses `--partial-dir=.rsync-tmp`), so `diskFile` was `null`;
- the in-progress guards (main.js:2932, 2942) key on the **exact filename** — the 2160p
  in-flight entry has a different filename than the 1080p candidate, so no match.

With no live disk file and no filename match, the stale, same/worse-quality 1080p USB
candidate fell through and was queued — racing the 2160p that was already replacing it.
The gap/fileGap was a *symptom* of the empty window, not the trigger; the trigger was
just the next periodic USB scan.

Note: the data needed to catch this **already exists** — `tv-inProgress.json` /
`tv_entries` carried the in-flight 2160p during the 21:38 cycle. It is simply not
indexed by show+`SxxExx`, only by filename.

**B. Two live files survive a race.**
worker.js renames sibling `SxxExx` video files to `.old` **once, at rsync start**
(worker.js:192-230). The 2160p worker ran that step at 21:33:53 when the 1080p EDITH
did not yet exist. The 1080p EDITH landed at 21:42, mid-2160p-download, so nothing ever
demoted it. Result: the "one active video file per episode" invariant assumed elsewhere
(`apps/srvr/src/videoFiles.js`) is violated.

**C. chksrt gets both.**
srvr's chokidar `video added` handler enqueues each newly added video via
`fileNeedsSubChecked`, so both EDITH files entered chksrt independently. Even after the
duplicate is cleaned up, its chksrt entry (and any sidecars already written) is stale.

## Why no one-line fix

The defect is in the core acceptance hot path plus a cross-process invariant. A naive
guard (e.g. "skip if any `.old`/partial exists") would suppress legitimate quality
upgrades; fixing only the download side still leaves duplicate live files and orphaned
chksrt entries when timing differs. It needs an S/E-indexed in-progress view and a
single, quality-aware "one active file per episode" reconciler. That is a small but
real design change touching two processes — hence this plan rather than an in-place edit.

## Proposed fix

### 1. Skip download when a same-or-better copy of the S/E is already in progress (Bug A)
In `apps/down/src/main.js`, once per cycle build an in-progress index keyed by
`seriesName + "\x00" + SxxExx → best resolution`, derived from the same `inProgress`
map / `tvJson` entries already loaded (parse `SxxExx` + resolution from each non-finished
title). In the fromFlex branch, before queuing, if the candidate's S/E has an in-progress
entry whose resolution ≥ the candidate's, skip with a new `logHere({}, …)` site
(e.g. "skip: same/better quality already downloading for `<show> SxxExx>`"). Minimal,
additive, and safe — it only adds a skip for the exact race; genuine upgrades (higher res
than anything in progress) still pass.

Optionally also treat a `.old` sibling of the same S/E as "episode present, not empty"
so the disk check isn't fooled by the rename window — but the in-progress index is the
authoritative signal and should be enough on its own.

### 2. Enforce one active video file per episode after a download lands (Bugs B + C)
Do this in **srvr** (single writer; already owns chokidar `video added`, the chksrt
queue, and `videoFiles.js` helpers) rather than in the down worker, to avoid two writers
racing. On `video added` for an episode video:
- gather all active (non-`.old`, non-`.alt`) video files for that `SxxExx`;
- if more than one, keep the best by the existing quality rule (res, then bit depth,
  then codec/group) and rename the rest to `.old`;
- when a file is demoted, **remove its chksrt-queue entry** and any half-written sub
  sidecars for it so chksrt never resolves a subtitle set against a demoted duplicate.

This closes the window regardless of which download finishes first and keeps chksrt in
sync with the one surviving file.

## Immediate manual cleanup for the current stuck episode (decide before running)

Not performed here (this document is plan-only). For `…/A Good Girl's Guide to
Murder/Season 2/`:
- keep `…S02E01.HLG.2160p.WEB.h265-EDITH.mkv` (the intended keeper);
- remove (or `.old`) `…S02E01.1080p.WEB.h264-EDITH.mkv` **and** its
  `…1080p.WEB.h264-EDITH.mb2/.mb3/.opn*.srt` sidecars, and drop its chksrt entry;
- optionally prune the dead `…KRATOS.mkv.old` (~2.7 GB).

All writes to the season folder and the chksrt queue must go through tv-srvr (single
writer); do not hand-edit while it is running.
