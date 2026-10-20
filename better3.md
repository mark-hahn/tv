# Plan: one routine judges which file is better

This answers better2.md. Every decision is made and numbered, so better4.md
can point at it by number. Case numbers (#1 to #11) are the ones in better.md.

## The routine

| # | Decision |
|---|---|
| D1 | The routine takes two candidates. Each is a small record of factor values only: no name, path, show or purpose. |
| D2 | It always judges the factors in one fixed order (next table), and stops at the first factor that differs. |
| D3 | A factor is judged only when both candidates have it. A factor blank on either side is skipped. A case leaves out a factor simply by not filling it in. |
| D4 | It answers "first", "second" or "equal", and names the factor that decided, so log lines can say why ("resolution 720 over 480"). |
| D5 | What "equal" means is the caller's business: keep what we have, keep the earlier one, or keep the original order. The routine never breaks a tie itself. |
| D6 | It lives in the shared package, so tv-srvr, tv-down, tv-api and the web client all call the same one. |

## The fixed order

| Rank | Factor | Better when | Why here |
|---|---|---|---|
| 1 | Resolution | Higher | The app's long-standing first rule. |
| 2 | Bad group | Not on the bad-groups list | Groups you marked as poor releases. Today this mostly comes last; at the same resolution, a bad-group release should lose before any finer point is weighed. |
| 3 | HEVC | Not HEVC | At 1080p and below, HEVC releases are nearly all small re-encodes, and the plain x264 release is the better picture. Moved above bit depth: today a 10-bit HEVC re-encode beats an 8-bit WEB-DL. At 2160p nearly everything is HEVC, so it rarely decides there. |
| 4 | Bit depth | 10 (10bit, 10-bit or HDR in the name) | Among releases with the same codec this is mostly real HDR. |
| 5 | Size | Larger | With everything above equal, more bytes is more bitrate. |
| 6 | Seeds | More | Says how fast it downloads, not how it looks, so it only breaks ties. |
| 7 | Tracker | TorrentLeech | Kept from the API's sort, last. |

## Reading the factors

| # | Decision |
|---|---|
| D7 | One shared reader turns a release name into factor values, so every case reads names the same way. Today the cases disagree on what an unknown resolution is (0, 480, or "not 1080"), and that disagreement goes away. |
| D8 | Resolution from a name is its tag snapped to 2160, 1080, 720, 576, 540 or 480. NTSC is 480 and PAL is 576. A name with no tag is 480, as most of the app treats it today. |
| D9 | A video on disk uses its real height (the recorded resolution, from ffprobe), not its name. A file named with no tag but really 1080p no longer looks like 480p, or like 0. |
| D10 | Bad group, HEVC and bit depth are read from the name. Size is file bytes for a file, the listed size for a torrent. Seeds and tracker exist only for torrents. |
| D11 | tv-api marks each search result as bad group or not, so the torrent pane has the factor without loading the list itself. |

## Which factors each case sends

The rule behind the choices: when both are on offer and one will be taken (a
choice), every factor the data has is sent, because the loser costs nothing.
When the new one would replace or add to a file we already have, or have
already sent for (a replacement), only the picture factors are sent:
resolution, bad group, HEVC and bit depth. A replacement costs a download and
a delete, and a bit more size or more seeds is not worth that.

| Case | Kind | Factors sent | On equal | Change from today |
|---|---|---|---|---|
| #1 Flexget, one run | Choice | All seven | The earlier candidate stays | Adds size and tracker; new order |
| #2 Flexget vs earlier sends | Replacement | Resolution, bad group, HEVC, bit depth | Not sent | Adds HEVC and bit depth |
| #3 Flexget vs disk | Replacement | Resolution, bad group, HEVC, bit depth; disk resolution is the real height | Not sent | Adds HEVC and bit depth; disk file with no tag is no longer 0 |
| #4 tv-down, usb list | Choice | Resolution, bad group, HEVC, bit depth, size | The alphabetically first name stays | New order only |
| #5 tv-down vs a running download | Replacement | Resolution, bad group, HEVC, bit depth | The running download stays | Adds bad group, HEVC and bit depth |
| #6 tv-down vs disk | Replacement | Resolution, bad group, HEVC, bit depth; disk resolution is the real height | The disk file stays | Disk resolution real; new order |
| #7 tv-down, queued this cycle | Choice | Resolution, bad group, HEVC, bit depth, size | The queued file stays | Adds everything but bad group |
| #8 Duplicate folder merge | Choice | Resolution (real height of both), bad group, HEVC, bit depth, size | The file in the kept folder stays | Real heights and size; new order |
| #9 Disk scan | Choice | Resolution (real height), bad group, HEVC, bit depth, size | The first file found stays | Adds everything but resolution |
| #10 API torrent search | Choice (an order) | All seven, after its season, kind and episode grouping | Original order | Real resolution instead of "1080 or not"; adds bad group and HEVC |
| #11 Torrent pane | Choice (an order) | All seven, after its warning, season, kind and episode grouping | Title, alphabetical | Adds bad group, bit depth, size and tracker |

With #10 and #11 sending the same factors, the pane's order within an episode
is the same as the API's. The pane still sorts again because of its warning
grouping, which stays as it is.

## Other decisions that come with it

| # | Decision |
|---|---|
| D12 | #3 and #6 compare against the episode's recorded video, not the first matching file in the season folder. Both processes already have the show records. |
| D13 | tv-down's disk check stops looking at flexget's history. A video on disk is always compared (#6); with none on disk the file is downloaded. That is what happens today in every case but one: an episode in the history with nothing sent, which today skips the disk check entirely. That hole closes. |
| D14 | The checks before a comparison stay as they are and stay outside the routine: url already seen, show not in the library, episode watched, season past the next one, the same file from another tracker, and forced and torrent-pane downloads skipping every comparison. |
| D15 | Flexget's run still groups candidates by the parsed show name, season and episode. |
| D16 | #7 stays, now with the same factors as #4. It only matters when two names parse to different show names but match the same show. |

## Decisions most likely to need your call

Each one is already decided above; these are the ones I'm least sure of.

| # | Decided | Alternative |
|---|---|---|
| Q1 | HEVC stays a penalty, for the re-encode reason. The old reason (it needs transcoding) dates from before tvapp played video itself. | Drop HEVC as a factor if re-encodes aren't a worry. |
| Q2 | A bad group loses only at the same resolution; a bad-group 1080p still beats a clean 720p. | Put bad group first, so a bad group loses to anything. |
| Q3 | PROPER and REPACK are not a factor; nothing looks at them today. | Add one after bad group: a PROPER or REPACK fixes a broken release. |
| Q4 | Source (WEB-DL, WEBRip, HDTV, BluRay) is not a factor. | Add one after HEVC. |
| Q5 | TorrentLeech is still preferred, last. | Drop the tracker factor. |
| Q6 | Replacements send only the picture factors, so a same-quality release that is much larger never replaces what we have. | Let size count in replacements above some margin (say 50% larger). |
