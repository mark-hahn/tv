# Plan: delete `.old` / `.alt` files and stop making them

2026-10-03. Done 2026-10-04: 2,197 files (800.6 GB) deleted; the 11
only-copy episodes were restored, not deleted; code deployed (srvr, api,
down); the phase 1 dry run afterwards found nothing left.

## Goal

- Delete every `.old` and `.alt` file in the tv library, their leftover
  sidecars, and every `.mb.chosen` marker, right away.
- Keep the off-scheme `.srt` files that belong to a video that plays (797 of
  them, e.g. `<video>.en1.srt`). They are in the play list and are not touched.
- Remove all code that creates `.old` files. A replaced or losing video is
  deleted, with its sidecars, instead of being stepped aside. Nothing is kept
  for rollback; a bad replacement is downloaded again.
- Remove the code that only exists to read `.old` / `.alt` files.

## What is on disk now (`/mnt/media/tv`; `/mnt/media/movies` has none)

| Category | Count | Size |
| --- | --- | --- |
| Anything ending in `.old` (`.old.old` ...): 237 videos + their stepped-aside sidecars | 735 | 813 GB with the `.alt` row |
| `*.mkv.alt` videos (163 are 1080p beside a 2160p that plays) | 164 | (in the 813 GB) |
| Sidecars named after an `.alt` video, not after any active video | 285 | small |
| Sidecars named after an `.old` video, left under its old name, not after any active video | 250 | small |
| `*.mb.chosen` markers (0 bytes; chksrt is gone, nothing reads them) | 805 | 0 |

Two cases to know about:

- **11 `.old` videos are the only copy of their episode.** They are the
  victims of the tv-down bug fixed in phase 2: tv-down renames the disk file
  to `.old` when a better usb file shows up, and only afterwards checks
  whether the episode is watched and skips the download. Leanne S02E01–E10
  (all watched; the 2160p XEBEC/ETHEL copies are still on usb and skipped
  every cycle) and The Responder S01E06.
  **Decision needed:** restore them (strip one `.old` from the video and its
  sidecars, delete the `.mb.chosen.old`), or delete them as instructed.
  Recommended: restore. A restore must wait until phase 2 is deployed, or the
  current tv-down will rename them straight back to `.old`.
- **The Bear S05E01** is the one reverse `.alt`: the `.alt` is the 2160p, and
  the 1080p plays. Deleted as instructed.

## Phase 1 — delete now (one-off script on hahnca.com)

1. A throwaway python script in `/tmp` walks `/mnt/media/tv` and writes a
   manifest of every file in the categories above. It works per season dir:
   - a sidecar counts as an active video's when its name starts with that
     video's stem plus `.` or `-`; those are never in the manifest;
   - the 11 only-copy videos and their sidecars are left out (if restoring).
2. Print the counts and GB per category and compare with the table above.
   Stop if they are off by more than a handful (downloads land meanwhile).
3. Delete from the manifest. Append each path, with an `MM-DD HH:mm` PST
   stamp, to `/root/dev/apps/tv/apps/srvr/data/auto-deleted-files.log`
   (the log `oldFiles.js` writes), so there is a record.
4. No service needs stopping:
   - the tv-srvr watcher ignores `.old`, `.alt` and `.chosen` (not video
     extensions);
   - a deleted `.srt` only makes it re-run `syncDownloaded` for the episode.
5. Delete the script.

## Phase 2 — tv-down: delete the loser after the new file lands

The demote now happens before anything is downloaded, which is what stranded
Leanne. The new rule: tv-down never touches the disk file until the better
file has landed, then deletes it.

- `apps/down/src/main.js`, the two "USB is better — rename the disk file to
  `.old`" blocks (about lines 3591–3615 and 3664–3688, unilog 334/335/337/338):
  remove them. The candidate is just allowed through.
- `apps/down/src/worker.js:313-352`, the rename of every same-SxxExx video to
  `.old` at rsync start: remove it.
- `worker.js` `promoteFile()` (line ~423): every successful landing goes
  through it (three call sites: an already-whole partial, a non-zero exit
  that landed, a clean exit). After `fixMkvSeekIndex(dst)`, when the incoming
  file is a video, delete every other video of the same SxxExx in the season
  dir (never `dst`), with its sidecars, through the shared helper below.
  Log each delete with `logHere`.
- Same-name forced download: rsync (`-av`, no `--inplace`) writes to a temp
  file and renames over `dst`, so the old file stays until the new one is
  whole. Nothing to delete. Note: on an rsync error, `verifyLandedIntact`
  could take the old same-size file for a landed one; acceptable, since the
  file is identical in size.
- While a replacement is in flight, the old file is now still live. Check
  that the `inProgressSeIndex` guard (main.js ~3497) still skips the same usb
  file every cycle before the disk-quality compare can allow it through again.
- Update the comments that describe the `.old` rename (main.js ~2566, ~3366,
  ~3492).

## Phase 3 — tv-srvr and share: delete instead of demote

- `packages/share/src/videoFiles.js`: replace `vidDemoteToOld()` with
  `vidDeleteWithSidecars(videoPath)`. Same matching: every file that starts
  with the video's base name, except other videos sharing the prefix.
  Callers: worker.js (new), `apps/srvr/index.js` reconcile, `dupeFolders.js`.
- `apps/srvr/index.js:4017-4055` `reconcileDuplicateEpisodeVideos`: kept as
  the backstop for two same-episode files landing together; it deletes the
  lower-resolution loser instead of demoting it. The call site at ~3846 is
  unchanged (it skips a deleted file).
- `apps/srvr/src/dupeFolders.js`, folder merge:
  - `demotions` become deletions;
  - an arriving loser (`arriveAsOld`) is deleted with its sidecars instead of
    moved in as `.old`;
  - the header comment "no video file is ever deleted" changes to say the
    losing duplicate is deleted;
  - update the merge log text (`index.js:1222`) and the dry-run report.
- `apps/srvr/src/subsQueue.js`: remove `copyReplacedSubs()` (lines 448–488)
  and its call (line 680), and fix the comment at line 658.
  - Consequence: a replacement no longer inherits the old video's S and asr
    files, which were timed to the other release anyway (the Becker drift).
    It gets its own T/H, opn files at play, and ASR when it has nothing.
  - So ASR can run again, at a cost, for a replaced video with no embedded
    text and no usable OpenSubtitles result.

## Phase 4 — remove code that only existed for `.old` / `.alt`

- Local pane Swap ("Make this .old/.alt file the active one"):
  - `apps/client/src/components/local.vue`: both Swap buttons (~186 and
    ~501), `clickSwap`, `swapInfo`, `swapReady` and `OLD_SUFFIX_RE` (1249);
  - `apps/api/src/server.js`: the `/api/local/swap` route (~1279) and the
    `swapLocalOld` import (38);
  - `apps/api/src/local.js`: `swapLocalOld()` and `OLD_SUFFIX_RE`.
- `.alt` handling:
  - `vidHasAlt` / `vidStripAlt` in `packages/share/src/videoFiles.js`, and
    `vidIsVideoName` without the strip;
  - `resHasAlt` / `resStripAlt` in `apps/srvr/src/videoFiles.js`, and the
    `alt` field from `resFindEpisodeVideos`;
  - the `!v.alt` filters: `subs.js:172`, `index.js:3760`, `index.js:4026`,
    `dupeFolders.js:197`;
  - `vidStripAlt` in `subs.videoStem` (`subs.js:114`);
  - `resStripAlt` at `index.js:3842` and `dupeFolders.js:122`.
- `apps/srvr/src/oldFiles.js`: `stripChain()` (a sidecar's owner is the plain
  video name) and the `.bif.old` comment.
- `.mb.chosen`: the candidate in `localHistory.js:489-493` and the comment in
  `apps/api/src/server.js:1368`. The `chosen` entry in oldFiles'
  `SIDECAR_SUFFIXES` stays; it is harmless.

## Phase 5 — docs

- `all-sub.md`: the passages on `.alt` stems (line 17), the duplicate-episode
  demote (39), the dropped entry (43), the replaced-video takeover (49, now
  removed), "never makes tv-down demote" (59), `vidDemoteToOld` (145), and
  `.old`/`.alt` in the weekly cleanup (147).
- `CLAUDE.md` and its mirror `.github/copilot-instructions.md`, Subtitles
  section: drop "a replaced (`.old`) video's subtitles taken over". **Needs
  your OK** (CLAUDE.md is only changed when you say so).
- `down-coll-plan.md` is history and stays as it is.

## Phase 6 — deploy and check

1. `node unilog/check.js all`.
2. Deploy each server that changed: `./srvr down`, `./srvr srvr`,
   `./srvr api`. `packages/share` goes out with down and srvr. The client is
   vite's; no client deploy. Check pm2 logs after each restart for crash
   loops.
3. If restoring: restore the 11 only-copy episodes now.
4. Run the phase 1 manifest script again as a dry run. Expect 0 in every
   category, except anything that tv-down renamed between phase 1 and the
   deploy; delete those the same way.
5. On the next replacement download, confirm:
   - the old video and its sidecars are gone right after the new one lands;
   - no `.old` appears;
   - the new video goes through the sub queue.

## Not in this plan

The T/H backfill from the Becker investigation (drop the sweep's
sidecar-exists check, search OpenSubtitles only when it can change the ASR
decision) is a separate change.
