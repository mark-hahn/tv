# Plan: one judgement of which file is better

Every place in the app that weighs two files or torrents for one episode
against each other calls one shared routine. Each place decides only which
facts it hands over and what to do with the answer. Along the way, the gaps
in today's download logic are closed, deleted files come back only with your
approval, and the blocked-name list becomes data.

## The routine

It lives in the shared package, so tv-srvr, tv-down and the web client all
use the same one.

- It takes two candidates. Each is a short record of factor values, nothing
  else: no name, path, show or purpose.
- It judges the factors in one fixed order and stops at the first that
  differs.
- A factor is judged only when both candidates have it. A factor blank on
  either side is skipped, so a caller leaves a factor out by not filling it
  in.
- It answers "first", "second" or "equal", and names the factor that decided.
  Log lines use that name, for example "disk better by resolution".
- It never breaks a tie. Each caller says what "equal" means for it.

| Rank | Factor | Better when |
|---|---|---|
| 1 | Resolution | Higher |
| 2 | PROPER or REPACK | Has one |
| 3 | Source | Remux, then BluRay, WEB-DL, WEBRip, HDTV, DVD |
| 4 | HEVC or AV1 | Neither |
| 5 | Bit depth | 10 |
| 6 | Size | More than 20% larger; within 20% the sizes count as equal |
| 7 | Seeds | More |
| 8 | Bad group | Not on the bad-groups list |
| 9 | Tracker | TorrentLeech |

## Reading the factors

One shared reader turns a release name into factor values, so every place
reads names the same way.

| Factor | Read from |
|---|---|
| Resolution | The name's tag, snapped to 2160, 1080, 720, 576, 540 or 480 (p or i). NTSC is 480, PAL is 576, and a name with no tag is 480. A video on disk uses its real height instead, the resolution tv-srvr has recorded from ffprobe. |
| PROPER or REPACK | Either word in the name |
| Source | Remux, BluRay, WEB-DL, WEBRip, HDTV or DVD in the name; blank when none is there |
| HEVC or AV1 | x265, h265, hevc or av1 in the name. Both are transcoded by the browser player, and at 1080p and below both are mostly shrunk re-encodes. |
| Bit depth | 10 when the name has 10bit, 10-bit or HDR, otherwise 8 |
| Bad group | The release group in the name, looked up in the bad-groups list |
| Size | File bytes for a file; the listed size for a torrent |
| Seeds, tracker | Torrents only |

"The episode's recorded video" below means the video tv-srvr's show record
names for the episode: the one that plays, with its real height.

## Two kinds of judgement

| Kind | When | Factors sent |
|---|---|---|
| Choice | Two or more candidates are on offer at once and one will be taken | Every factor the data has |
| Replacement | A new file would replace or join one already on disk, downloading, or sent for | Every factor except seeds and tracker |

## Where it is used

| Place | Kind | Compares | On equal |
|---|---|---|---|
| Flexget, one run | Choice | Candidates for one episode in the same run, grouped by the library show they match plus season and episode | The earlier candidate stays; the others are recorded but not sent |
| Flexget, earlier sends | Replacement | A candidate vs the best one already sent, when the episode is not on disk | Not sent |
| Flexget, disk | Replacement | A candidate vs the episode's recorded video | Not sent |
| tv-down, same cycle | Choice | A usb file vs another for the same library show and episode queued earlier this cycle | The queued file stays; when the new one wins, the queued one is removed even if it is downloading |
| tv-down, running download | Replacement | A usb file vs a download already running for the episode | The running download stays |
| tv-down, disk | Replacement | A usb file vs the episode's recorded video | The disk video stays |
| Duplicate folder merge | Choice | The two folders' videos for one episode, by real height | The video in the kept folder stays |
| Disk scan | Choice | Several videos for one episode in a show folder, by real height | The first one found stays |
| Torrent pane, sort | Choice | Torrents for the same episode, as an order | Title, alphabetical |
| Torrent pane, Send | Replacement | Your pick vs the episode's recorded video, and vs a download running or queued for it | No reason to ask |
| Restore | Replacement | A deleted file's usb copy vs the episode's recorded video | Not counted |

## tv-down

**Choosing among usb files.** The early pick among usb files for one
episode, made before any other check, is removed. Files go through every
check first, and those still wanted compete in the same-cycle choice, keyed
by the library show they match. A file that would be skipped anyway can no
longer hide a better one, and two spellings of one show's name compete as
one.

**One download per episode.** At most one download runs for an episode at a
time, so a download can never land worse than what is on disk. "Automatic"
means flexget downloads and torrent-pane picks sent without Force.

| Running for the episode | Arrives | Result |
|---|---|---|
| Automatic | Automatic, better | The running one is stopped and removed; the new one is queued |
| Automatic | Automatic, not better | The new one is skipped |
| Automatic | Forced | The running one is stopped and removed; the forced one is queued |
| Forced | Automatic | The new one waits; once the forced file has landed, it is judged against it |
| Forced | Forced | Both run; the last to land stays |

**The disk check** compares with the episode's recorded video, not the first
file a folder listing turns up. It no longer reads flexget's history: with a
video on disk the file is judged, and with none it is downloaded.

**Forcing** overrides every check, the blocked-name list included. The
unused exemption for torrent-pane files is removed; a pick sent without Force
is judged like any automatic file.

**Later upgrades** apply to every file, a torrent-pane pick included.

**Deleted files.** tv-down keeps a record of every file it downloaded for as
long as the file's folder stays on usb. A usb file whose landed copy has been
deleted is never downloaded again by itself. It is counted toward Restore
when all of these hold:

| Condition |
|---|
| tv-down's record says it was downloaded and finished |
| The file it landed as is no longer on disk |
| The episode is not watched, the show is in the library, and the name is not blocked |
| With the record forgotten, it would be downloaded now: the episode has no video, or the file wins a replacement judgement against the recorded video |

The last condition leaves out files the app itself replaced with better ones,
and files renamed or recoded in place. A different usb file that was never
downloaded still fills a missing episode on its own, like any other
candidate.

## The blocked-name list

It moves from the source code to a data file on the server, like the
bad-groups list. tv-api, tv-down and the torrent pane read it on each use, so
a change takes effect at once. Restore's Block button adds exact file names
to it.

## tv-api

- Torrents are no longer marked for 384p or 480p. "No seeds" is the only
  warning.
- Search results are no longer sorted; the torrent pane sorts them.

## Torrent pane

**Sort.** Torrents with no seeds go last, then season, kind (season range,
season pack, episode, other) and episode, as now. Within one episode the
routine orders them as a choice; title breaks a tie. Bad-group names stay
bold red on the cards.

**Send and Hold.**

| Situation | Result |
|---|---|
| The Send holds two torrents for one episode, or an earlier pick for that episode hasn't landed yet | Refused, with a notification that only one pick per episode is allowed. Force is refused the same way. To change a pick that hasn't landed, delete it in the qbt pane first. |
| The episode's recorded video is better; a download running or queued for the episode is better; the episode is watched; the show is not in the library; the name is blocked | One dialog lists every reason found. Cancel sends nothing; Force sends it forced. |
| None of these | Sent, no dialog |

The old check that refused a send when qbt already had a better torrent is
removed.

## Restore

A **Restore?** button sits in the web client's bottom tab row, after Plot and
before Intro. It has Intro's background colour and shows its count after the
label, like "Restore? 3", and it is hidden when the count is 0. tv-down works
out the list each cycle.

Clicking it opens a dialog that explains that the file was downloaded before,
its copy on disk was deleted, and it could be downloaded again. It shows the
show, the episode, the file name and when the file was downloaded.

| Button | Effect |
|---|---|
| Cancel | Closes the dialog |
| Block | Adds the file name to the blocked-name list, then shows the next file |
| Restore | tv-down forgets its record of the file, so the next cycle treats it as never downloaded and every normal check runs; then shows the next file |

The dialog closes when no file is left.

## Order of work

| Step | Work | Deploys |
|---|---|---|
| 1 | The routine and the name reader in the shared package, with one runnable self-check of example pairs: each rank deciding, the 20% size rule, a blank factor skipped | — |
| 2 | Move the blocked-name list to a data file; tv-srvr serves it alongside the bad-groups list | tv-srvr |
| 3 | tv-srvr: flexget's grouping, run choice and both send checks; duplicate folder merge; disk scan | tv-srvr |
| 4 | tv-down: drop the early pick; same-cycle choice with removal; one download per episode; disk check against the recorded video without the history read; forcing over the blocked list; drop the torrent-pane exemption; read the blocked list from the data file | tv-down |
| 5 | tv-down: work out the Restore list each cycle, serve it, and take Restore and Block | tv-down |
| 6 | tv-api: drop the low-resolution warnings and the sort; read the blocked list from the data file | tv-api |
| 7 | Web client: torrent pane sort, Send checks, dialog and refusal; the Restore button and dialog | vite |

Each deploy is followed by a look at pm2's logs for crashes and restarts.

## Checks after deploy

All on the server, from the logs, which name the deciding factor:

| Scenario | Expected |
|---|---|
| Flexget run with a 1080p x264 and a 1080p HEVC candidate for one episode | The x264 one is sent |
| Usb file 30% larger than the disk video, otherwise equal | Downloaded; the old video is deleted when it lands |
| Usb file 10% larger, otherwise equal | Skipped, "disk better" or "equal" |
| A better usb file arrives while a worse automatic download runs | The running one is stopped; only the better one lands |
| An episode's video deleted, its usb file still there | Not downloaded; Restore? counts it |
| Restore pressed | The next cycle downloads it |
| Block pressed | The name is in the blocked list, and the file is gone from the count |
| Torrent pane Send of a 720p when disk has 1080p | Dialog listing the reason; Force sends it |
| Two torrents for one episode in one Send | Refused with the notification |
| A forced file whose name is blocked | Downloaded |

## Not in this plan

Putting a show with no tv-srvr record into the library on its own when its
first file lands. Today that folder waits until the show is added from the
web client. It is a separate change.
