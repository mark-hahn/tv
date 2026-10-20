# Reply to better8.md

Your question under W9 still needed an answer, so this is a response rather
than the plan. There are no contradictions left. A few gaps came up while
fitting your answers together; each is filled with the obvious choice below,
so the plan can follow straight after this unless you object.

## Your question: a file for a show that is not in the library

What happens today when such a file is downloaded:

| The show | What happens when its file lands |
|---|---|
| Has a record in tv-srvr but is out of the library (any show you removed, or one you looked at that tv-srvr keeps a record for) | tv-down puts the file in a folder named after the show. tv-srvr's library sweep sees a folder holding a video, finds the record named like it, and puts the show in the library. Nothing else is needed. |
| Has no record (a show only previewed from a TVDB search) | The folder waits. tv-srvr logs "holds videos but no show record claims it; add the show from the web client", and the show appears only once you add it from the web client. |

Would making the second case automatic be hard? Not very. tv-down already
knows the show's TVDB id when it queues the file, and the web client's add
flow makes a record from a TVDB id. The library sweep could run that same
flow for a folder no record claims. The one care point: the record's name has
to come out equal to the folder's name, or the sweep would treat them as
different shows.

It has nothing to do with judging which file is better, so I'd make it a
separate change after this plan rather than part of it.

## Gaps filled

| Gap | Filled with |
|---|---|
| When the torrent pane asks "cancel or force" | When you press Send, before anything reaches qbt. Every reason found is listed in one dialog: the episode's video on disk is better, a download already running or queued for the episode is better, the episode is watched, the show is not in the library, the name is blocked. Cancel sends nothing; Force sends it forced. With no reason found there is no dialog. |
| What tv-down does with a pick sent without forcing | It judges it like any other file. That only matters when something better lands between your Send and the pick reaching tv-down; then tv-down skips the pick, the same way a later upgrade replaces a pick. tv-down needs no special handling for torrent-pane files. |
| Two picks for one episode with Force | Refused too. A notification says multiple picks for one episode are not allowed. To change a pick that hasn't landed yet, delete it in the qbt pane first. |
| Bad groups as warnings | The torrent pane already shows a bad group's name in bold red on each card. That stays. Bad group does not join the "no seeds" grouping; it stays 8th in the order. |
| Where bit depth goes | Just below HEVC. |

## The order this makes

| Rank | Factor | Better when |
|---|---|---|
| 1 | Resolution | Higher |
| 2 | PROPER or REPACK | Has one |
| 3 | Source | Remux, BluRay, WEB-DL, WEBRip, HDTV, DVD |
| 4 | HEVC | Not HEVC |
| 5 | Bit depth | 10 |
| 6 | Size | More than 20% larger |
| 7 | Seeds | More |
| 8 | Bad group | Not on the list |
| 9 | Tracker | TorrentLeech |

If all of this is fine, reply "plan" and the next file is better-plan.md.
