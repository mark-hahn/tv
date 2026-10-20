# Reply to better6.md

New decisions continue from D29. Case numbers are better.md's, plus #12 and
#13 from better5.md. You asked to be warned about contradictions and about
things neither of us has decided, so those come first. Each one has a
decision so the plan stays complete; change any you disagree with.

## Warnings

| # | Kind | Issue | Decided for now |
|---|---|---|---|
| W1 | Contradiction | You agreed to D18: a plain Send from the torrent pane is judged by tv-down like a flexget download. better6 says your pick is authoritative. Under D18, tv-down can skip your pick when the disk file is better. | D18 is reversed (D35): tv-down skips the quality comparisons for torrent-pane picks. |
| W2 | Likely contradiction | Your order puts bit depth above source and HEVC. That brings back the case from better3: at 1080p, a 10-bit HEVC re-encode beats an 8-bit WEB-DL, which seems to clash with "i want highest quality of encoding" (better4, Q4). | Your order is used as written. Say if bit depth should drop below HEVC. |
| W3 | Change to note | Bad group moves from 2nd (Q2, "use your decision") to 8th. Since it now comes after size, a bad-group release more than 20% larger beats a clean one, and the bad-groups list rarely decides anything. | Your order is used as written. |
| W4 | Gap | Block adds the file to the blocked list, but that list is written in the source code; nothing can add to it while the app runs. | The list moves to a data file on the server (D32). |
| W5 | Gap | The Intro button already sits right of Plot. | The order becomes Plot, Restore?, Intro. Restore? is hidden when its count is 0, like Intro. |
| W6 | Undecided | May flexget or tv-down later replace a file you picked in the torrent pane with a better one? | Yes. Your pick is taken as it is when sent; later upgrades still apply. Force again to undo one. |
| W7 | Undecided | When you delete an episode's video, may a different usb file, never downloaded before, fill the episode without asking? | Yes. better4 says any candidate should fill a missing episode; only the deleted file itself needs your approval. If you deleted the video because you don't want the episode, mark it watched. |
| W8 | Undecided | Two torrent-pane picks for one episode, sent after the warning: which stays? | The one that lands last. |
| W9 | Undecided | Does a torrent-pane pick skip the other checks too (episode watched, show not in the library)? | No. Only the quality comparisons are skipped. Force skips everything. |
| W10 | Undecided | After Block or Restore in the dialog: close, or show the next file? | Show the next file; close when none is left. |

## Forcing and the blocked-name list

Agreed, and already decided as D17: forcing overrides the blocked-name list in
tv-down too.

## #4: your three questions

**Can the best file in #4 be blocked later while a lesser one passes?** Yes,
even with D19.

| Why the best fails later | Why a lesser one can pass |
|---|---|
| Its name doesn't match the library show (show names are read from each file's own name) | The lesser file's name matches |
| Size counts only above 20%, and the routine stops at the first factor that differs, so being "better" doesn't carry from one comparison to the next | Example: disk 1.0 GB, usb A 1.15 GB, usb B 1.3 GB, otherwise equal. A and B are within 20%, so #4 can pick A (alphabetical). A vs disk: within 20%, not taken. B vs disk: 30% larger, taken. #4 dropped B. |
| A factor blank on one side is skipped (D3) | The same skip can favour a different file in each comparison |

**Is there a reason to have #4?** Only to stop two files for one episode from
both downloading, and #7 already does that job.

**What changes if #4 is removed:**

| | With #4 | Without #4 |
|---|---|---|
| Who chooses among one cycle's files for an episode | #4, before any per-file check | #7, after all of them |
| Files that would be skipped anyway | Can win and hide the others | Never take part |
| Two spellings of one show | Treated as different episodes | Caught: #7 keys by the matched library show |
| Cost | — | The first file may start downloading before the second is checked, and is then stopped (D21). A few wasted seconds of transfer. |

| # | Decision |
|---|---|
| D29 | Remove #4. #7 is tv-down's one choice point among files for one episode. D19 is withdrawn. |

## Deleted files and Restore (replaces D20)

I agree with your idea. A deleted file is never restored without your
approval.

**Will tv-down's db know?** Yes. tv-down's db keeps a record of every file it
downloaded: where it came from on usb, where it landed, and that it finished.
It keeps that record for as long as the file's folder stays on usb. It used
to forget files whose landed copy was gone, and that was removed for exactly
your reason: it re-downloaded episodes you had deleted on purpose. So "deleted"
is: tv-down's record says finished, and the landed file is no longer there.

What the db does not know is who deleted the file: you, or the app replacing
it with a better one. The last condition below sorts that out, because a file
the app replaced loses to its replacement.

A usb file counts toward Restore? when all of these hold:

| Condition | Why |
|---|---|
| tv-down's record says it was downloaded and finished | It existed on disk before |
| The file it landed as is no longer on disk | It was deleted |
| The episode is not watched, the show is in the library, the name is not blocked | It would be wanted |
| With the record forgotten, tv-down would download it now: the episode has no video, or the file beats the one there (#6) | A file the app replaced with a better one, or one renamed or recoded in place, does not count |

| # | Decision |
|---|---|
| D30 | A usb file that meets those conditions is never downloaded by itself. It is counted toward Restore?. |
| D31 | Restore? sits between Plot and Intro (W5), with the Intro button's background colour and the count after the label, like "Intro 3". It is hidden at 0. Clicking it opens a dialog that explains: this file was downloaded before, its copy was deleted, and it could be downloaded again. It shows the show, the episode, the file name and when it was downloaded. Buttons: Cancel closes the dialog. Block adds the file name to the blocked list. Restore makes tv-down forget its record, so the next cycle treats the file as never downloaded and the normal checks run. After Block or Restore the next file shows (W10). |
| D32 | The blocked-name list moves from the source code to a data file on the server, like the bad-groups list. tv-api and tv-down read it on each use, so an addition takes effect at once. Block adds the exact file name. |
| D33 | Restored files go through every normal check. A restore does not force anything. |

## Low-resolution warnings

| # | Decision |
|---|---|
| D34 | tv-api no longer marks 384p or 480p torrents (p or i). They sort by resolution like any other. "No seeds" is the only warning left, so the warning grouping now puts only torrents with no seeds last. |

## Torrent pane sends (replaces D26 and D27)

| # | Decision |
|---|---|
| D35 | Your pick is authoritative (W1). When a torrent you sent from the pane finishes, tv-api tells tv-down which files it holds, as it already does for forced ones. tv-down skips the quality comparisons (#5, #6, #7) for those files, but not the other checks (W9). This replaces D18. |
| D36 | The pane's send check (#12) stops judging quality: no more "qBittorrent already has a higher quality version". It warns only when one Send holds two torrents for the same episode, or when a torrent you sent earlier for that episode is still in qbt and tv-down hasn't downloaded it yet. The warning names them and asks "Send anyway?". Yes sends, No skips. #12 is no longer a comparison. |

## D28: how a download can land worse than the file on disk

The earlier checks compare against what is on disk when the file is checked,
not when it lands. Two downloads for one episode can run at once, each
checked against the same disk file before the other landed. Today the one
that lands last deletes the other, whatever their quality. Example: a worse
file starts first and is large; a better, smaller one starts in a later cycle
and lands first. Then the worse one lands and deletes it. The running-download
check (#5) is meant to stop the second one starting, but it judges resolution
only.

So it can happen. Rather than check at landing (D28), it is cheaper to never
have two downloads running for one episode:

| # | Decision |
|---|---|
| D37 | One download per episode at a time. D28 is withdrawn. |

| Running for the episode | A new file arrives | Result |
|---|---|---|
| An automatic download | An automatic file that is better (#5) | The running one is stopped and removed; the new one is queued |
| An automatic download | An automatic file that is not better | The new one is skipped |
| An automatic download | A torrent-pane pick or a forced file | The running one is stopped and removed; the pick is queued |
| A torrent-pane pick or a forced file | An automatic file | The new one waits; once the pick has landed it is judged against it (#6), as W6 allows |
| A torrent-pane pick or a forced file | Another pick or forced file | Both run; the last to land stays (W8; the pane warned first) |

With that, an automatic file can't land worse than what is on disk, and
nothing needs checking at landing.

## The fixed order now

Your order, as written (W2, W3).

| Rank | Factor | Better when | Sent in replacements |
|---|---|---|---|
| 1 | Resolution | Higher | Yes |
| 2 | Bit depth | 10 | Yes |
| 3 | PROPER or REPACK | Has one | Yes |
| 4 | Source | Remux, BluRay, WEB-DL, WEBRip, HDTV, DVD | Yes |
| 5 | HEVC | Not HEVC | Yes |
| 6 | Size | More than 20% larger | Yes |
| 7 | Seeds | More | No |
| 8 | Bad group | Not on the list | Yes |
| 9 | Tracker | TorrentLeech | No |

## The cases now

| Case | Kind | On equal | Decisions |
|---|---|---|---|
| #1 Flexget, one run | Choice | The earlier candidate stays | Grouped by library show (D15) |
| #2 Flexget vs earlier sends | Replacement | Not sent | |
| #3 Flexget vs disk | Replacement | Not sent | Against the recorded video (D12) |
| #4 tv-down, usb list | Removed | — | D29 |
| #5 tv-down vs a running download | Replacement | The running download stays | One download per episode (D37); skipped for pane picks (D35) |
| #6 tv-down vs disk | Replacement | The disk file stays | Against the recorded video (D12); no history check (D13); skipped for pane picks (D35) |
| #7 tv-down, queued this cycle | Choice | The queued file stays | The only choice point in tv-down (D29); the loser is removed even if downloading (D21); skipped for pane picks (D35) |
| #8 Duplicate folder merge | Choice | The file in the kept folder stays | |
| #9 Disk scan | Choice | The first file found stays | |
| #10 tv-api sort | Removed | — | D22 |
| #11 Torrent pane sort | Choice (an order) | Title, alphabetical | Only "no seeds" groups last (D34) |
| #12 Torrent pane send | Not a comparison | — | Same-episode warning only (D36) |
| #13 A download lands | Removed | — | Not needed with D37 |
| Restore? | Uses #6 | — | D30 to D33 |
