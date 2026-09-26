# tv-down: from the usb file list to the history records

This describes what tv-down does on every pass, in the order it does it, and
every test that can stop a file from going further. It ends with a list of
everything that gets written, so the history can be judged against what
actually happened. Movies have their own separate cycle and are not covered.

## 1. When a cycle runs

A cycle starts five minutes after the previous one ended. It also starts at
once when something asks for it: the usb pane's Download button (a forced
cycle), a Retry on a down card, an Unhold, a prune check, or a plain "start"
request. If a cycle is already running, the request is remembered and a new
cycle starts as soon as the current one finishes; a forced request also
empties the current cycle's remaining file list so the forced files are
reached right away.

Before anything else, the cycle checks that the tv library mount is present
and non-empty. If it is not (typically right after a reboot), the cycle is
skipped and rescheduled, because with the library invisible every "already on
disk" test would fail and hundreds of finished episodes would be re-queued.

At the start of each cycle it rereads the series-name mapping file (old name →
name to use), the blocked-substring list, and empties the reject log so that
log reflects only the current cycle.

## 2. Usb prune (once a day)

Once every 24 hours the cycle measures the usb host's quota. If less than 20%
is free, it deletes every top-level entry in the usb files folder dated within
10 days of the oldest entry, never anything younger than 10 days. Any held
torrent that got pruned is dropped from the held list. Then it lists the
directories that still exist on usb and deletes from the database every
finished, non-error row whose usb source directory is gone (DVD rows are
exempt). This runs in the background; the cycle does not wait for it.

## 3. Getting the file list

A normal cycle lists every file under the usb files folder with its date,
relative path and size. A forced cycle uses the list of paths the usb pane
sent instead and does not scan usb at all.

The list is split. Video-disc files (VOB, IFO, BUP) go to the DVD pass. The
rest is filtered by the scan rules, then sorted by parsed show title, season,
episode and name so a show's files are handled together.

Tests at the list level, any of which removes a line:

- Empty line or empty path.
- A `.rar` or `.rNN` archive part, or a `screenNN.png` capture.
- An extension on the disc/sidecar exclusion list (srr, sfv, nfo, nzb, jpg,
  jpeg, png, txt, sub, idx, srt, bup, ifo, vob). A forced cycle skips this
  test.
- The file sits under a held torrent (held from the tor pane so it can be
  previewed on usb first). Forced cycles ignore holds.
- The file sits under a folder that has an unrar lock file, meaning the usb
  host is still extracting there.
- The file belongs to a torrent folder the DVD pass claimed.

After the list is fixed the cycle loads, once per cycle: the in-progress
marker file, a map of every title already in the database (with its status
and error flag), an index of active downloads by season folder and SxxExx
with the best resolution in flight, and a read-only snapshot of every show
record from tv-srvr's show database. The per-cycle TVDB lookup cache is
cleared so library changes take effect.

## 4. DVD pass

Disc files inside a VIDEO_TS directory are grouped by disc. The torrent
folder's name is parsed for a show title and matched against the library.

Blocking tests: the folder is under an unrar lock; the folder name yields no
title; the show snapshot failed to load; the show is not in the library; the
disc already has a finished "makemkv" card.

For a disc with files not yet staged locally, each missing file gets a
"waiting" database row (title is the full usb-relative path, destination is
the staging folder) and downloads through the normal workers. A file already
in the database without an error flag is not queued again. When every file of
a disc is staged, makemkv runs with a progress card, the resulting MKVs are
filtered (oversize compilation titles and same-size duplicates dropped),
renamed to the next free SxxExx slots in the season folder, moved there, and
the show's last-downloaded time is posted to tv-srvr. Staging is deleted, the
per-file rows are deleted, and the card is marked finished. A torrent folder
whose every disc is finished is deleted from usb.

## 5. Per-file tests before any network call

Each remaining file is taken in turn. The title, season and episode are parsed
from the file name, falling back to the torrent folder name. In this order, a
file is dropped and the cycle moves on if:

1. Its path is under an unrar-locked folder.
2. Its extension is not one of: mkv, mp4, avi, ts, m2ts, wmv, srt, ass, ssa,
   asa, srr, nfo, jpg, png.
3. Its exact file name already has a database row flagged as an error (not
   in a forced cycle).
4. Its exact file name already has a database row of any status (not in a
   forced cycle). This is what makes finished and queued titles invisible on
   later cycles.
5. Its exact file name is in the in-progress marker file.
6. Its file name contains any blocked substring (sample, sfv, Flemish,
   Deleted Scenes, Commentary, Featurettes, and a few show names).

A file that passes all six is given the next sequence number in the cycle.

Then the parse is judged. If no title, or no integer season, or no integer
episode came out:

- If the show snapshot is loaded and the parsed title (or the folder title)
  matches no library show, the file is dropped silently as "not a TV show".
  Music videos and movies land here.
- Otherwise the file is recorded as a bad file (see section 9) with a reason
  describing what was missing.

A parse that says the file is not an episode (a movie, say) is recorded as a
bad file with reason "non-episode". A missing season is defaulted to 1. If the
file name uses compact numbering (101, 1x01) rather than SxxExx, a destination
name in SxxExx form is prepared so the file lands with a matching name.

## 6. Resolving the show on TVDB

The title is looked up in the per-cycle cache first. A cached "unresolvable"
title drops the file; a cached series name skips the network call. The folder
title's cache entry is used the same way. If the file title matches no
library show but the folder title does, the folder title is used instead.

Otherwise TVDB is searched for the title (and for an "&" variant when the
title contains "and"). A network error is retried up to 15 times, then the
file is dropped for this cycle. With no results, the file is dropped silently
when the title matches no library show (after one retry with the folder
title), and recorded as a bad file with reason "no series match" when it
does. With results, the best-matching series name is chosen; if it is in the
mapping file it is renamed. No acceptable match drops the file (after the
folder-title retry) and caches the title as unresolvable for the rest of the
cycle.

## 7. Deciding whether to download

The series name is matched to a library record to find the show folder, and
the destination becomes `<tv root>/<show folder>/Season <n>/<file name or
destination name>`. An existing folder differing only by letter case is
reused.

Then, in this order, the file is dropped if:

1. **The destination file already exists on disk.** Not applied in a forced
   cycle. Nothing is written: no database row, no in-progress marker. The
   file is re-examined every cycle while it stays on usb, and the skip is
   logged once per file per tv-down process. (Until 2026-09-26 this test
   wrote a "finished" row with the disk file's modification time as start
   and end, which made the history show downloads that never happened.)
2. **The episode is marked watched** in the show record. Not in a forced
   cycle.
3. **The file name is in the in-progress marker file.** Not in a forced cycle.
4. **The file name already has a database row** (logged as "already
   downloaded" or "already queued"). Not in a forced cycle.
5. **The show snapshot failed to load** (fail closed, nothing downloads).
6. **The show is not in the library.** Not in a forced cycle.

The next group applies only to automatic ("flex") files. Forced files skip
it. Files registered as coming from the tor pane would also skip it, but
nothing currently registers any, so every non-forced file is treated as flex.

7. **A same-or-better-resolution download for this season and episode is
   already in flight** (by SxxExx in the active-downloads index), even
   though no live file is on disk yet.
8. **Flexget history has a "sent" record for this show, season and episode,
   and a video for that SxxExx is already in the season folder**, unless the
   usb file is better (higher resolution, then higher bit depth, then not
   HEVC where the disk file is, then not a bad release group where the disk
   file is). When the usb file is better, the disk file and its sidecars are
   renamed with a `.old` suffix and the download proceeds. If history says
   the episode was sent but nothing landed on disk, the download proceeds
   regardless of quality.
9. **No flexget history, but a video for that SxxExx is already in the
   season folder**, same quality comparison and same `.old` rename when the
   usb file wins.
10. **The episode is marked watched** (checked again here).

Then the season folder is created if missing, and one more test for flex
files:

11. **Another file for the same show, season and episode was queued earlier
    in this same cycle.** If the earlier one is from a bad release group and
    this one is not, the earlier queued row is deleted and this one goes
    ahead; otherwise this one is dropped.

A file that survives gets a database row with status "waiting", its usb
folder, destination folder, optional destination name, series name, TVDB id,
sequence number, size, season and episode, and the flex flag. The row's
"added" time is now. The title is also put in the in-progress marker file and
in the cycle's title map so a duplicate later in the same list is skipped.

## 8. Downloading

Up to eight workers run at once. Whenever a row is added and a worker slot is
free, a worker starts on it; when a worker finishes, the oldest waiting row
starts next. On restart, every row left "downloading" is reset to "waiting",
the in-progress marker file is emptied, orphaned rsync processes from the old
instance are killed, and workers start again on the oldest waiting rows.

When a worker starts: the row's start time is set to now, its status becomes
"downloading", and the title is written to the in-progress marker file. Right
before copying, any video in the destination folder with the same SxxExx is
renamed with a `.old` suffix (this is the only place that rename is done for a
normal replacement).

The copy is an rsync from the usb host into a per-download partial folder
inside the destination folder, so an incomplete file is never visible to the
library scanner. Progress, speed and ETA are written to the row about once a
second. A restart resumes from the partial file rather than starting over; a
partial that is already complete is just moved into place.

On success the file is moved to its final name, the row becomes "finished"
with progress 100 and an end time of now, the title is removed from the
in-progress marker file, and the show's last-downloaded time is posted to
tv-srvr (if tv-srvr can't be reached the update is kept in a pending file and
retried every minute). On failure the row keeps a status text describing the
failure, its error flag is set, the end time is set, and the title is removed
from the in-progress file. A "remote folder not found" failure is retried
once after searching usb for the file by name. If rsync reports failure but
the local file turns out complete and the same size as the remote, it is
treated as a success. A partial folder is deleted when its download fails for
good or is aborted.

## 9. Bad files

A file the parser or TVDB could not place is written to the reject log for
this cycle. If its reason is one that may still be worth having (parse
failure, non-episode, no series match), it is queued as a normal download
into a separate tv-errors folder outside the library; when that finishes the
row's status becomes "error-downloaded". Any other reason produces a database
row with the reason as its status and the error flag set, and no download.

## 10. Everything that gets written

Flat files, all under the down app's data folder unless noted:

- **In-progress marker file** (`tv-inProgress.json`): title → time. Added
  when a row is queued, when a worker starts, and when an existing disk file
  is recorded as finished; removed when a download finishes or fails, on
  retry, abort, delete, and usb prune; emptied on restart.
- **Held torrents** (`heldTorrents.json`): names held from the tor pane;
  changed by hold, unhold and usb prune.
- **Reject log** (`reject.log`): one line per bad file; emptied at the start
  of every cycle.
- **Pending tvdb fields** (`pending-tvdb-fields.json`): last-downloaded
  updates that tv-srvr has not accepted yet.
- **Database backup** (`tv.sqlite.backup`): a copy of the database at 05:30,
  11:30, 17:30 and 23:30.
- Read only, never written: the series-name mapping file, tv-srvr's show
  database, tv-srvr's flexget history, the bad release-group list.

The database (`tv.sqlite`, one row per title) is written by:

- **Queueing a download**: new row, status "waiting", added time now.
- **Worker start**: status "downloading", start time now.
- **Worker progress**: progress, speed, ETA.
- **Worker finish**: status "finished", progress 100, end time now.
- **Worker failure**: status set to the failure text, error flag, end time.
- **Error download finish**: status "error-downloaded".
- **Bad file**: row with the reason as status and the error flag set.
- **Cycle dedup**: the losing queued row is deleted.
- **DVD cards**: "encoding", then "finished" or a failure text; per-file
  staging rows deleted after a disc finishes.
- **Restart**: "downloading" rows reset to "waiting"; DVD rows that were mid
  download deleted; rows without an id given one.
- **User actions**: Retry deletes the row so the next cycle re-parses the
  file; Abort deletes the partial file and replaces the row with status
  "user-blocked" so no later cycle picks the title up; Delete (from the down
  pane, or from the tor pane's "already downloaded" dialog) removes the local
  file and the row; Delete Errors removes every error-flagged row.
- **Daily usb prune**: deletes finished, non-error rows whose usb source
  directory no longer exists.

## 11. Who reads the database

- The down pane shows the newest 200 rows.
- Before sending a torrent to qBittorrent, the api asks tv-down which of the
  torrent's file names have a finished, non-error row; if any do, the torrent
  is not sent and the client offers to delete those rows and files.
- The next cycle's tests 3–4 in section 5 and 3–4 in section 7 use the rows to
  skip titles already known.

## 12. Where the history can diverge from what happened

- Every "finished" row now has a transfer behind it. Rows written by the old
  section 7, test 1 before 2026-09-26 are still in the database; they can be
  told apart by a start and end time earlier than the added time, a speed of
  zero, and the flex flag unset.
- Because a finished row makes the title invisible to later cycles (section
  5, test 4), deleting a row is what allows a title to be downloaded again.
  The daily usb prune deletes rows only once the usb folder is gone, so a
  torrent still on usb keeps its rows.
- A row's added time is set once when the row is created and never changed,
  so for a re-queued title (after Retry, which deletes the row) the added
  time is the re-queue, not the first attempt.
