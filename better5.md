# Reply to better4.md

Answers in the order of better4.md, then the plan as it now stands. New
decisions continue from D17. Case numbers are better.md's, plus two new ones
found while answering: #12 and #13.

## Forcing

Yes. A forced file never reaches any of the cases, so the routine is never
called for it. The routine knows nothing about forcing (D1).

Forcing comes from two places: the usb pane's Force, and the torrent pane's
Force, which asks "Send N selected torrents to qbt even if already
downloaded?" first. A torrent forced in the torrent pane is handed to tv-down
as forced once qbt has finished it.

| Check | Overridden by forcing? |
|---|---|
| Torrent pane: qbt already has a better torrent for the episode (#12) | Yes |
| Torrent pane: the torrent is already in qbt | Yes: the old one is deleted, files too, and it is added again |
| tv-api: name on the blocked-name list | Yes |
| tv-down: choosing among usb files for one episode (#4) | Yes: forced files are never dropped |
| tv-down: a running download as good (#5), a disk file as good (#6), a file queued this cycle (#7) | Yes |
| tv-down: the earlier download of this file failed | Yes |
| tv-down: this file was already downloaded or queued | Yes |
| tv-down: a file of the same name is already on disk | Yes: it is fetched again over it |
| tv-down: episode watched | Yes |
| tv-down: show not in the library, or no TVDB match | Yes |
| tv-down: torrent held for preview | Yes |
| tv-down: a subtitle file whose video is not on disk or on its way | Yes |
| tv-down: name on the blocked-name list | **No** |
| tv-down: this file is downloading right now | No |
| tv-down: file type not allowed, or no season and episode in the name | No |

Two things turned up while checking this:

| # | Finding | Decision |
|---|---|---|
| D17 | When the torrent pane says a torrent is blocked and asks "Send anyway?", yes sends it forced: tv-api skips its blocked check and qbt downloads it. tv-down still checks the blocked-name list for forced files, so the file reaches usb and goes no further. | Forcing overrides the blocked-name list in tv-down too. |
| D18 | better.md said files picked in the torrent pane take no part in #4 to #7. tv-down has that exemption, but nothing tells tv-down which files came from the torrent pane any more, so a plain Send from the pane is judged exactly like a flexget download. | Remove the unused exemption. A plain Send means "judge it"; Force means "take it". |

## #4: choosing among usb files for one episode

What #4 does: when the usb list holds two or more files for one episode, it
picks the best and drops the others from this cycle before any file is
checked. Without it, both would download, one after the other.

Your concern is real, and #4 is what causes it. #4 picks before the per-file
checks run. When the best file is then skipped by one of them, the others
have already been dropped, so nothing fills the episode. The usual case is
the one you describe: an episode's video is deleted, and the file it came
from is still on usb. tv-down remembers that file as already downloaded for
as long as it stays on usb, so it is skipped, and the next-best file was
dropped by #4.

| Step | Today | With D19 and D20 |
|---|---|---|
| Disk video deleted; usb holds the file it came from (best) and a lesser one | #4 picks the best | The best is eligible again, since the episode has no video (D20) |
| Per-file checks | The best is skipped as already downloaded | The best passes |
| Result | The lesser one was dropped, so the episode stays empty | The best is downloaded and fills the episode |

| # | Decision |
|---|---|
| D19 | #4 chooses only among the files tv-down would download now. Files already downloaded, queued, downloading, failed or blocked take no part, so a skipped best no longer hides the others. |
| D20 | When an episode has no video on disk, a usb file downloaded for it before is eligible again. Then the best candidate on usb always fills a missing episode. The cost: a file you deleted because it was bad comes back, unless the episode is watched or the name is blocked. |

## #7: a file queued earlier this cycle

Agreed: it is a choice, the same situation as flexget's one run (#1). Usb
files have no seeds or tracker, so it ends up judging the same factors as #4.

One more flaw turned up. When the new file wins, today's code removes the
queued entry only once it has started downloading, and stops it partway. An
entry still waiting is left, so both download.

| # | Decision |
|---|---|
| D21 | When the new file wins, the queued one is removed whether it is waiting or already downloading. |

## #10 and #11: sorting twice

There is no reason. tv-api sorts the results, and the torrent pane, the only
place that shows them, sorts them again from scratch. The pane's sort decides
every position, so tv-api's sort changes nothing. tv-api's result limit
applies per tracker before its sort, so the sort does not decide which
results arrive either.

The warning grouping: tv-api marks a torrent with a warning when it is 384p
or 480p, or has no seeds. The pane puts every torrent with a warning after
every torrent without one, even before ordering by season. So a 480p torrent
for season 1 comes after all clean torrents of every season, and the pane
shows the warning on its card.

| # | Decision |
|---|---|
| D22 | tv-api stops sorting. The pane sorts once: warning grouping, season, kind and episode as now, then the routine within an episode. #10 goes away. |

## D12: the recorded video vs the first matching file

Both are on disk. The difference is which file is picked and where its
resolution comes from.

| | The episode's recorded video | The first matching file in the season folder |
|---|---|---|
| What it is | The file the show record names for the episode, chosen by the disk scan (#9) and kept with the show | Whatever file a listing of the season folder turns up first whose name holds the episode tag |
| With two videos for the episode | The one with the higher real resolution | Whichever the directory listing returns first |
| Resolution | The real height, from ffprobe | Read from the name; a name with no tag is guessed |
| Where it looks | Anywhere under the show folder | Only the folder named "Season N" |
| Used by | tvapp, the browser player, the map | Flexget's and tv-down's upgrade checks today (#3, #6) |

D12 stands: the upgrade checks compare against the recorded video, the one
that actually plays.

## D13: the history check

Yes, the new plan removes it completely. Today tv-down reads flexget's
history before comparing with disk, only to choose between two paths that
both compare with disk. One combination, history holding the episode with
nothing sent, takes neither path, so no disk comparison runs. With D13 the
only test is the usb file against the episode's video on disk; with no video
on disk the file is downloaded.

## D15: grouping in flexget's run

A flexget run returns one list of accepted torrents, for many shows and
episodes. Grouping puts the ones for the same episode together so #1 can
pick one. Today the group key is the show name read from the torrent's title
text, before that text is matched to a library show, plus season and episode.

It matters when two torrents for one episode spell the show differently, for
example "Law and Order SVU" and "Law and Order Special Victims Unit". They land
in different groups, so #1 never compares them. Each is processed on its own:
the first is sent, and the second is judged only against it as a replacement
(#2) and sent too if better. That is two downloads where #1 would have made
one.

| # | Decision |
|---|---|
| D15 (changed) | Group by the library show each torrent matches, plus season and episode. Flexget already does that lookup for every candidate; it moves ahead of the grouping. |

## D16: two names, one show

Parsing a file name gives a show name as text, nothing more. Which library
show that text means is decided later, for each file, by a looser match
(punctuation, "and" vs "&", years, abbreviations, and a TVDB search when
needed). "Law.and.Order.SVU.S25E01" and
"Law.and.Order.Special.Victims.Unit.S25E01" parse to different text, so #4,
which groups by the text, treats them as different episodes. Both then match
the same library show. #7 keys by the matched show, so it catches them.

tv-down cannot group by the matched show the way flexget can (D15), because
its match can need a TVDB search for each file. So #7 stays as the backstop,
judged like #4 (D16 stands).

## Q1: re-encoding

The app itself re-encodes only one kind of file: old DivX 5 files, which the
Emby player on the Bravia stalled on. It never re-encodes HEVC. The
"needs transcoding" note on the HEVC penalty dates from Emby; tvapp plays
HEVC itself.

The re-encoding I meant is done by release groups. They take an official
WEB-DL or Blu-ray and compress it again, usually to HEVC, to make the file
smaller; MeGusta, on your bad-groups list, is one. Each re-encode loses
detail, so at 1080p and below an HEVC file is usually a smaller, worse copy
of an x264 release of the same episode. That is the reason the HEVC penalty
stays.

## Q4: source

Yes, it tells something size does not. For the same episode, size is
bitrate, but it cannot show what was encoded or how many times. A 2 GB WEBRip
re-encoded from a 1 GB WEB-DL is larger and worse. An HDTV capture carries
the broadcaster's logos and compression. A Blu-ray encode starts from a better
master than any stream.

Suggested tiers, best first: Remux, BluRay, WEB-DL, WEBRip, HDTV, DVD. A name
with no source tag leaves the factor blank (D3).

Suggested place: after PROPER/REPACK, before HEVC. Source says what the file
was made from; HEVC, bit depth and size then judge the encode among files
from the same kind of source.

## Q6: size

| # | Decision |
|---|---|
| D23 | Size counts only when one file is more than 20% larger. Within 20% the sizes are equal and the next factor decides. This is the routine's rule everywhere, not just for replacements, so it stays independent of the use (D1). |
| D24 | Size goes after bit depth. HEVC, source and bit depth come first because sizes compare fairly only between files encoded the same way: an HEVC file is smaller than an x264 file of the same picture. |
| D25 | Replacements now send size too. A replacement still never sends seeds or tracker. |

## Your question: the torrent pane

Yes, several torrents for one episode can reach qbt from the pane, and
nothing stops that when they are sent in the right order.

| Step | What happens |
|---|---|
| You select torrents and press Send | Each goes through the pane's send check, one at a time, in the order selected |
| The send check (#12) | Compares the torrent with every torrent in qbt for the same show and episode: resolution, then bit depth, then not HEVC, then not a bad group. A finished torrent whose files are gone from usb is ignored. If qbt has a better one, the send fails with an error. It does not look at the disk. |
| 720p sent before 1080p | Both reach qbt: the 1080p is better than what qbt has |
| 1080p sent before 720p | The 720p fails with the error |
| Both reach qbt | qbt downloads both to usb. tv-down then judges them like any other usb files (#4, #6), so your pick is not final |
| A torrent worse than the disk file | qbt downloads it; tv-down then skips it, and nothing tells you |

I agree that your pick matters. A confirmation is worth asking exactly when
the app disagrees with your pick, and not otherwise.

| # | Decision |
|---|---|
| D26 | The send check (#12) judges the torrent as a replacement against the best of what qbt holds for the episode and the episode's video on disk. |
| D27 | When the routine says your pick is worse than one of those, or worse than another torrent for the same episode in the same Send, the pane asks: "Already have a better one: <name>. Send anyway?" Yes sends it forced, so tv-down takes it as it is. No skips it. With no conflict there is no question. |

## #13: when a download lands

When tv-down finishes a download, it deletes every other video of that
episode. There is no comparison, so whichever file lands last wins, even when
the other is better. That is how a forced or raced worse file replaces a
better one.

| # | Decision |
|---|---|
| D28 | When a file that was not forced lands next to another video of the episode, the routine judges them as a replacement and the loser is deleted, which can be the new file. On equal, the video already there stays. A forced file always stays and the others go. |

## The fixed order now

| Rank | Factor | Better when | Note |
|---|---|---|---|
| 1 | Resolution | Higher | Unchanged |
| 2 | Bad group | Not on the list | Q2: as decided |
| 3 | PROPER or REPACK | Has one | Q3: new |
| 4 | Source | Remux, BluRay, WEB-DL, WEBRip, HDTV, DVD | Q4: suggested, new |
| 5 | HEVC | Not HEVC | Q1: kept |
| 6 | Bit depth | 10 | |
| 7 | Size | More than 20% larger | Q6 |
| 8 | Seeds | More | |
| 9 | Tracker | TorrentLeech | Q5: as decided |

## Which factors each case sends now

A choice sends every factor the data has. A replacement sends every factor
but seeds and tracker. Usb and disk files have no seeds or tracker, so the
two kinds now differ only where torrents are compared with torrents (#1, #2,
#11, #12).

| Case | Kind | On equal |
|---|---|---|
| #1 Flexget, one run (grouped by library show, D15) | Choice | The earlier candidate stays |
| #2 Flexget vs earlier sends | Replacement | Not sent |
| #3 Flexget vs disk (the recorded video, D12) | Replacement | Not sent |
| #4 tv-down, usb list (only downloadable files, D19, D20) | Choice | The alphabetically first name stays |
| #5 tv-down vs a running download | Replacement | The running download stays |
| #6 tv-down vs disk (the recorded video, D12; no history check, D13) | Replacement | The disk file stays |
| #7 tv-down, queued this cycle (D21) | Choice | The queued file stays |
| #8 Duplicate folder merge | Choice | The file in the kept folder stays |
| #9 Disk scan | Choice | The first file found stays |
| #10 tv-api sort | Removed (D22) | — |
| #11 Torrent pane sort | Choice (an order) | Title, alphabetical |
| #12 Torrent pane send (D26, D27) | Replacement | Not sent, you are asked |
| #13 A download lands (D28) | Replacement | The video already there stays |
