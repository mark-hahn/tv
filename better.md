# Comparing files for the same episode

Every place in the app that weighs two files, or two torrents, for one episode
against each other, with every factor each one uses, in priority order.
Current as of 2026-10-19.

## The places

| # | Place | What is compared | What the result decides |
|---|---|---|---|
| 1 | Flexget, one run | Candidates for one episode in the same flexget run | Only the best goes on to be sent; the rest are stored in flexget's history, never sent |
| 2 | Flexget vs earlier sends | A new candidate vs the best one ever sent, when the episode is not on disk | Sent to qbt only if better |
| 3 | Flexget vs disk | A new candidate vs the episode's video on disk | Sent as an upgrade only if better |
| 4 | tv-down, usb list | Two usb files for one episode in one scan | Only the best goes on to be checked for download |
| 5 | tv-down vs a running download | A usb file vs a download of the episode already running | The usb file is skipped if the running one is as good |
| 6 | tv-down vs disk | A usb file vs the episode's video on disk | Downloaded only if better; the old video is deleted once the new one lands |
| 7 | tv-down, queued this cycle | A usb file vs one already queued this cycle for the episode | The new file replaces the queued one, or is skipped |
| 8 | Duplicate folder merge | One episode with a video in both folders being merged | The losing video is deleted with its sidecars |
| 9 | Disk scan | Several videos for one episode in a show folder | Which one is the episode's recorded video: the one tvapp and the browser player play and the map shows |
| 10 | API torrent search | Torrent results for the same episode | Sort order sent to the client |
| 11 | Torrent pane | The same results, sorted again in the client | The order you see |

## All factors and their priority

A number is that factor's rank in the place's comparison (1 decides first). A
dash means the place does not look at it. Only factors that can differ between
two files of the same episode are ranked; the per-place sections below also
list the checks that run before the comparison.

| Factor | #1 | #2 | #3 | #4 | #5 | #6 | #7 | #8 | #9 | #10 | #11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| No warning (384p, 480p, no seeds) | — | — | — | — | — | — | — | — | — | — | 1 |
| Resolution, higher wins | 1 | 1 | 1 | 1 | 1 | 1 | — | 1 | 1 | 1 (1080 or not) | 2 |
| Bit depth, 10 wins | 2 | — | — | 2 | — | 2 | — | 2 | — | 2 | — |
| Not HEVC wins | 3 | — | — | 3 | — | 3 | — | 3 | — | — | 3 |
| More seeds wins | 4 | — | — | — | — | — | — | 4 (always a tie) | — | 3 | 4 |
| Not a bad group wins | 5 | 2 | 2 | 4 | — | 4 | 1 | 5 | — | — | — |
| Torrent has a size wins | — | — | — | — | — | — | — | — | — | 4 | — |
| Larger size wins | — | — | — | 5 (file bytes) | — | — | — | — | — | 5 (torrent size) | — |
| TorrentLeech over IPTorrents | — | — | — | — | — | — | — | — | — | 6 | — |
| Title, alphabetical | — | — | — | — | — | — | — | — | — | — | 5 |
| Final tie goes to | earlier in run | earlier send (new one not sent) | disk file | alphabetically first file name | running download | disk file | queued file | file in the folder being kept | first file the walk finds | original order | — |

## How each factor is read

| Factor | How it is read |
|---|---|
| Resolution (#1, 2, 4, 5, 6, 8) | From the name: a resolution tag such as 720p or 1080i when it is 2160, 1080, 720, 576, 540 or 480; NTSC is 480 and PAL is 576; any other number is snapped to the nearest of those; unknown counts as 480. Flexget reads the quality line of its output first (e.g. "720p webdl h264"), then the title. |
| Resolution (#3) | Strict: only a 2160p, 1080p, 720p, 576p, 480p or 384p tag in the name counts. Unknown is 0, not 480. |
| Resolution (#9) | The resolution already recorded when the file is the episode's recorded video; otherwise the tag in the name, and when the name has none, the real video height from ffprobe snapped to the same steps. The only place that looks at the real video. |
| Resolution (#10) | Only whether the parsed resolution contains "1080". 2160p ranks with 720p. |
| Resolution (#11) | The first number in the parsed resolution; unknown is 0. |
| Bit depth | 10 when the name contains "10bit", "10-bit" or "HDR", else 8 (#1, 4, 6, 8). The API (#10) uses the bit depth the title parser reports. |
| HEVC | x265, h265 or hevc in the name. HEVC loses, because it needs transcoding. |
| Bad group | The release group the title parser finds in the name, looked up in the bad-groups list. tv-srvr and tv-down each load their own copy of the list. A name with no group is never bad. |
| Seeds | The torrent's seed count from flexget's output or the search result. Files on disk have none and count as 0. |
| Size | #4: bytes of the usb file from the usb listing. #10: the torrent's listed size, converted to bytes. |
| Warnings (#11) | Set by the API: 384p and 480p from the parsed resolution or the title, and no seeds for 0 seeds. 576p and 540p get no warning. |

## 1. Flexget, one run

The candidates of one flexget run are grouped by the show name, season and
episode the title parser reads from the title (not yet matched to a library
show); a candidate with no season and episode stands alone. Within a group the
first candidate is the best so far, and each later one replaces it only when
it is better.

| Step | Factor | Result |
|---|---|---|
| 1 | Higher resolution (quality line, else title; unknown 480) | Better |
| 2 | 10-bit or HDR in the title | Better |
| 3 | Not HEVC | Better |
| 4 | More seeds | Better |
| 5 | Not a bad group | Better |
| — | All equal | The earlier candidate stays best |

The losers are still recorded in flexget's history but never sent. Every
candidate, best or not, then goes through the checks in sections 2 and 3.

## 2 and 3. Flexget, one candidate

| Step | Check | Result |
|---|---|---|
| 1 | Empty title | Dropped |
| 2 | Its url is already in the history | Dropped |
| 3 | No show, season or episode parsed, or episode 0 (a season pack) | Dropped |
| 4 | Show not found, or not in the library | Dropped |
| 5 | Episode watched, or its season is past the next season (the one after the last season with a file or a watched episode) | Stored as rejected, not sent |
| 6 | Same title and quality, ignoring case, spaces and punctuation, as one already in the history (the same file from another tracker) | Not sent again; the stored entry takes the new seeds, url and tracker if it has more seeds |
| 7 | Added to the history | — |
| 8 | A loser in its run (section 1) | Not sent |
| 9 | The episode has a video on disk | The comparison vs disk below |
| 10 | Not on disk, nothing sent before | Sent ("first") |
| 11 | Not on disk, something sent before | The comparison vs the best sent below |

**Vs disk (#3).** The disk video is the first one in the season folder whose
name holds the episode tag (such as S01E05) and has a resolution tag; the
group is from the first video holding the episode tag.

| Step | Factor | Result |
|---|---|---|
| 1 | The candidate's name has no resolution tag | Not sent |
| 2 | Disk resolution higher | Not sent |
| 3 | Candidate resolution higher (a disk file with no resolution tag counts as 0) | Sent as an upgrade |
| 4 | Same resolution: disk file is from a bad group and the candidate is not | Sent as an upgrade |
| — | Anything else | Not sent |

**Vs the best sent (#2).** The best sent is picked from the history's sent
entries with the same comparison, the earlier one staying on a tie.

| Step | Factor | Result |
|---|---|---|
| 1 | Higher resolution (quality line, else title; unknown 480) | Better |
| 2 | Not a bad group | Better |
| — | All equal | Not sent |

## 4. tv-down, two usb files for one episode

Files are grouped by the parsed show name, season and episode. Forced files,
files picked in the torrent pane, non-video files, season or episode 0, and
files whose earlier download failed take no part. The list is sorted by show,
season, episode and lowercased file name first, and each file replaces the
best so far only when it wins.

| Step | Factor | Result |
|---|---|---|
| 1 | Higher resolution (unknown 480) | Better |
| 2 | 10-bit or HDR in the name | Better |
| 3 | Not HEVC | Better |
| 4 | Not a bad group | Better |
| 5 | Larger file in bytes | Better |
| — | All equal | The alphabetically first file name stays |

## 5, 6 and 7. tv-down, one automatic usb file

These run only for automatic files: not forced, not picked in the torrent
pane, not a subtitle file, season and episode above 0.

| Step | Check | Result |
|---|---|---|
| 1 | A running download of the same episode (same season folder and episode tag, video only, not failed or finished) has the same or higher resolution (unknown 480) (#5) | Skipped |
| 2 | Flexget's history has the episode and something was sent, and no video for it is on disk | Downloaded, no comparison |
| 3 | Flexget's history has the episode and something was sent, and a video is on disk | The comparison vs disk below |
| 4 | Flexget's history has the episode but nothing was sent | No comparison at all; goes on to step 6 |
| 5 | Flexget's history does not have the episode, and a video is on disk | The comparison vs disk below |
| 6 | Episode watched | Skipped |
| 7 | Another file for the same show and episode was queued earlier this cycle (#7) | The cycle comparison below |
| 8 | — | Queued |

**Vs disk (#6)**, the same in steps 3 and 5. The disk video is the first file
in the season folder whose name holds the episode tag and is a video.

| Step | Factor | Result |
|---|---|---|
| 1 | Higher resolution (unknown 480) | Downloaded |
| 2 | Same resolution, 10-bit or HDR where the disk file is not | Downloaded |
| 3 | Same resolution and bit depth, disk file HEVC and usb file not | Downloaded |
| 4 | Same resolution, bit depth and HEVC, disk file from a bad group and the usb file not | Downloaded |
| — | Anything else | Skipped; the disk file stays |

**This cycle (#7).**

| Step | Factor | Result |
|---|---|---|
| 1 | The queued file is from a bad group and the new one is not | The queued entry is deleted and the new file is queued |
| — | Anything else | The new file is skipped |

Section 4 already keeps one file per parsed show and episode, so this catches
two names that parse to different show names but match the same show.

## 8. Duplicate folder merge

For each video moving out of the losing folder, the videos of the same
episode already in the folder being kept (samples left out) are first reduced
to their best with the same comparison, the first in directory order staying
on a tie. The moving file is then compared with that best. Which folder is
kept is decided by the folders, not by quality.

| Step | Factor | Result |
|---|---|---|
| 1 | Higher resolution (file name; unknown 480) | Better |
| 2 | 10-bit or HDR in the name | Better |
| 3 | Not HEVC | Better |
| 4 | More seeds (both 0: always a tie) | — |
| 5 | Not a bad group | Better |
| — | All equal | The file in the kept folder stays; the moving one is deleted |

When the moving file wins, every video of that episode in the kept folder is
deleted.

## 9. Disk scan

The walk of a show folder takes every video whose name gives a season and
episode, and whose parsed show name matches the folder (or has none).

| Step | Factor | Result |
|---|---|---|
| 1 | Higher resolution (recorded resolution, else name, else ffprobe height) | Becomes the episode's recorded video |
| — | Same resolution, or the later file's resolution unknown | The first file the walk found stays |

## 10. API torrent search

Titles containing "nordic" or "mobile" are removed before sorting. Warnings
are attached but play no part in this sort.

| Step | Factor | Order |
|---|---|---|
| 1 | Complete series | First |
| 2 | Season (a range by its first season) | Ascending |
| 3 | Kind: season pack, then season range, then episode | In that order |
| 4 | Range: last season / episode: episode number | Ascending |
| 5 | Resolution contains "1080" | First |
| 6 | Parsed bit depth is 10 | First |
| 7 | Seeds | More first |
| 8 | Has a size | First |
| 9 | Size in bytes | Larger first |
| 10 | Tracker is TorrentLeech | First |
| — | All equal | Original order |

Steps 5 onward are the ones that order torrents for the same episode.

## 11. Torrent pane

| Step | Factor | Order |
|---|---|---|
| 1 | Has a warning (384p, 480p, no seeds) | Last |
| 2 | Season (a range by its first season; none last) | Ascending |
| 3 | Kind: season range, season pack, episode, other | In that order |
| 4 | Range: last season descending / episode: episode number ascending | — |
| 5 | Resolution number | Higher first |
| 6 | HEVC | Last |
| 7 | Seeds | More first |
| 8 | Title | Alphabetical |

The warning outranks the season, so a warned torrent sorts after every
unwarned torrent of every season.

## Inconsistencies

**Flexget and tv-down judge an upgrade differently.** Flexget's checks (#2,
#3) use only resolution and bad group. tv-down's (#6) also uses bit depth and
HEVC. Flexget never sends a same-resolution 10-bit or x264 release as an
upgrade, though tv-down would take one that arrived on usb.

**Unknown resolution means different things.** Flexget vs disk (#3) counts a
disk file with no resolution tag in its name as 0, so any candidate with a
resolution is sent as an upgrade. tv-down (#6) counts the same file as 480, so
a 720p candidate then replaces it, even when the file is really 1080p. Only
the disk scan (#9) checks the real height.

**The running-download check (#5) uses resolution only.** A same-resolution
10-bit or x264 file is skipped while a worse one is downloading, though #6
would take it.

**A history entry with nothing sent skips the disk check (#6, step 4).** When
flexget has recorded candidates for an episode but never sent one, tv-down
does not compare the usb file with the disk video at all.

**HEVC ranks below bit depth where both are used**, so a 10-bit HEVC file
beats an 8-bit x264 file at the same resolution. The torrent pane has no
bit-depth step, so there HEVC always loses at the same resolution. The API
ignores HEVC.

**The API only tells 1080 from the rest**, and ignores bad groups. The
torrent pane re-sorts by real resolution but also ignores bad groups.

**Forced and torrent-pane downloads skip every comparison.** When any
download lands, tv-down deletes all the episode's other videos, so a worse
forced or torrent-pane download replaces a better file.

**Only one disk file is compared.** #3 and #6 compare against the first
matching video in the season folder, even when the episode has several.

## Not comparisons

The gap check's resolution drop compares across episodes, not within one. The
flex and qbt panes only list and sort by time or state.
