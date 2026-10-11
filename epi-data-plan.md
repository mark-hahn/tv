# Episode data cleanup plan

## Goal

Each show's episode data becomes the one authoritative home for everything
known about its episodes. Show-level values that can be worked out from the
episodes stop being stored. tv-srvr computes them in one place and sends them
with the show, so no two parts of the system can disagree about them. Along
the way every bug found in the episode data analysis gets fixed.

Season 0 episodes are episodes like any other. They count toward every
calculation except the intro and skip logic, they appear on the maps, and
each one shows where in the story it belongs.

The work is split into nine phases. Each one can be deployed and checked on
its own, and only the phases that say so are meant to change anything you can
see.

## Target design

### The episode record

Each episode becomes a small record with named fields instead of a list where
meaning depends on position. A field that is empty, false or zero is simply
left out. The outer layout, seasons holding their episodes in order, stays as
it is.

| Field | Meaning | Comes from | Kept when the show leaves the library |
| --- | --- | --- | --- |
| aired | air date, absent when TVDB has none | TVDB | yes |
| watched | the episode has been watched | the players, the user | yes |
| file | video file name, with its folder when that differs from the show's | the disk | no |
| res | video resolution | the disk | no |
| pos | resume position in milliseconds | the players | no |
| tvdbId | TVDB's id for the episode | TVDB | yes |
| title | episode title | TVDB | yes |
| lastPlayed | when the episode was last started or stopped | the players | yes |
| playCount | how many times it has been played to the end | the players | yes |
| airsBeforeSeason, airsBeforeEpisode, airsAfterSeason | for a season 0 episode, where TVDB's editors say it belongs | TVDB | yes |

The last five rows are new. Overviews, still images, guest cast and file facts like
duration and audio language are still fetched live when needed. They are too
large to send with every show list, or they change with the file.

Every episode TVDB lists gets a record, including those with no air date yet
and the specials in season 0. A video on disk for an episode TVDB doesn't list
still gets a record holding only its file facts, and still counts as a stray.

### Decisions on open questions

| Question | Decision | Reason |
| --- | --- | --- |
| Does season 0 count? | Yes, everywhere any other episode counts: the watched and episode counts, Finished, the gap checks, the wait date and next-up. A show with an unwatched season 0 episode is not Finished. The one exception is the intro and skip logic (below). | Your rule. The server's watched count already includes season 0, so it is the info pane's count and the TVDB episode count that change to match. |
| Are season 0 episodes shown on the map? | Every season 0 episode TVDB lists: in a season 0 column on the web map and a season 0 row on tvapp. Selecting one shows where it belongs. | They count toward Finished and the gaps, so they must be visible to be watched, marked or ignored. |
| In what order are episodes walked? | Story order: regular episodes by season and number, with each placed season 0 episode inserted where it belongs. Several placed at one spot go in air date order. Season 0 episodes with no position come after everything else, by number. The gap checks and next-up walk this order. Where a season grouping is needed, as for the wait date, a placed season 0 episode belongs to the season it is placed in. | Season 0's numbers say nothing about where an episode comes in the story. |
| Where does a season 0 episode belong? | After the last regular episode that aired on or before its air date, or before the first episode if it aired earlier. With no air date, where TVDB's placement says, if that names an episode or season that exists. With neither, nowhere. When TVDB's placement disagrees with the air date, the air date wins and the disagreement is shown. | Air dates placed all of Outnumbered's specials correctly. TVDB's hand-entered placement got one wrong, naming a season that doesn't exist. |
| Does season 0 count as a season? | No: seasonCount counts regular seasons only. | Season 0 episodes are placed into the regular seasons, and "4 Seasons" for a three-season show would be wrong. |
| Next-up | The first unwatched episode with a file, in story order. tv-srvr computes it once and sends it with the show, and tvapp, the web client and play all use that. | Today tv-srvr and tvapp each work it out separately, and both skip season 0. |
| How are episodes with no air date treated? | As not aired yet, unless a file is on disk. | Gap checks, the wait date and next-up then behave as they do now, while the episode can be marked watched or resumed. |
| Key names | Full words, as in the table above. | Short keys would save only about a quarter of a megabyte, and the point of the change is readability. |
| Last played and last played episode | Worked out from the episodes' lastPlayed. fakeLastPlayed stays stored, since it is a deliberate override. | It removes per-episode data that today sits on the show. The Viewed sort keeps the same key and the same values. |
| First, last and next aired | Worked out from the air dates of all episodes, season 0 included. | They then always agree with the map, and a show's latest special is when it last aired. Any show where the result differs from TVDB's stored value is listed and reviewed before the switch. |
| Fields nothing reads | full, seasonPremiereDates and premiereDate are removed rather than computed. | Nothing displays or decides anything from them. |
| needsIntro | One rule, on the server: in the library, not one of Linda's shows, has a file in a regular season, has unwatched episodes in regular seasons, and has no intro marked for its seasons. The old top-level intro fields are ignored. | The web client's intro count already leaves Linda's shows out, and that count is what you see. The old intro fields were replaced by per-season intros. |
| Intros and skip for season 0 | Season 0 episodes take no part. They don't count toward needsIntro, the intro check never offers one, and no intro marks are kept for season 0. A season 0 episode plays from its start or its resume point, with no trim and no skip. | A special's opening may not match the show's regular intro. Today a season 0 episode would borrow the nearest season's marks. |
| How old records are converted | Once, with tv-srvr stopped, after every reader can handle both shapes. | tv-srvr is the only writer and holds every show in memory, so a conversion behind its back would be overwritten. |
| Per-episode data held elsewhere | The subtitle database, stills, download history and flexget history stay where they are. | Each belongs to its own subsystem, is keyed by show and episode or by file, and would make the show list much larger. |

### What happens to each show-level field

| Field | Becomes | Notes |
| --- | --- | --- |
| watchedCount | computed | watched episodes, season 0 included |
| episodeCount | computed | TVDB-listed episodes, season 0 included, dated or not |
| seasonCount | computed | regular seasons only |
| quality | computed | most common resolution |
| anyWatched | computed | any episode watched |
| notReady | computed | from the episodes, today and whether the show is in the library |
| waitStr | computed | from the episodes, today and last played |
| needsIntro | computed | the single rule above |
| the gap flags and the season and episode they point at, strayCount, strayFiles | computed | from the episodes, today, whether the show is in the library, and the ignored-gap list |
| firstAired, lastAired, nextAired | computed | from air dates, season 0 included |
| lastPlayedDate, lastPlayedEpisode | computed | from the episodes' lastPlayed |
| the next-up episode | computed, new | see the decisions above |
| where each season 0 episode belongs | computed, new | sent with the map; see the decisions above |
| full, seasonPremiereDates, premiereDate | removed | nothing uses them |
| ignoreStrays, strayOk | removed | folded into the ignored-gap list |
| the nested gap object and the old per-episode lists (watched list, files on disk, file quality, aired dates) | removed | leftovers of earlier designs |
| gapSig, ignoreGaps, strayNote | stored | user decisions, and file stats from the disk |
| noFiles, size, date | stored | facts about the show folder |
| the wait value the hide/unhide loop last acted on | stored, new | today the loop uses the stored waitStr for this |
| seasonIntros, fakeLastPlayed, waitSeen, inToTry, inContinue, inMark, inLinda, anticipating, last-downloaded, averageRuntime, status and the other TVDB facts | stored | not about episodes, or not derivable |

### How computed values work

One shared function works out every computed value from a show's episodes and
the few other inputs listed above. tv-srvr keeps the results in memory for
each show. It recomputes a show's values whenever that show's episodes or one
of those inputs change, and recomputes every show just after midnight Pacific,
which takes about 11 ms in total. Every path that sends a show out (the full
show list, the push after a change, the replies to show lookups and field
updates) carries the computed values. None of them are ever saved to the show
database.

Between its full loads, tvapp knows only what tv-srvr pushes. It loads the
whole list at startup, when it comes back to the front and when its update
socket reconnects, and otherwise applies each pushed show in place. So
tv-srvr pushes a show whenever its computed values change, not only when its
stored record does. That includes the midnight recompute, which pushes every
show whose wait date, readiness or gap flags changed with the day. Once the
info pane's quiet saves are gone, the only record changes that don't push are
the player's progress saves between a play's start and stop.

The request that sets show fields ignores computed field names and logs the
attempt, so an old client can't write a stale value back. The web client,
tvapp and the phone only read these values. They no longer compute and save
their own versions. tvapp may still adjust its displayed count right after you
toggle a watched mark, until the push brings the real value.

The hide/unhide loop needs to know which wait it last acted on, to catch the
moment a wait ends. It gets its own stored field for that. It no longer reads
the stored waitStr, and the workaround that puts an old waitStr back after a
disk change goes away.

### Maps

Every show's map comes from tv-srvr, built from the show's episodes, whether
the show is in the library or not. Only a preview of a show with no record is
built live from TVDB, with nothing watched. Map requests name the show, or
the TVDB id for a preview, and never carry a list of watched episodes. The web
client's own TVDB map builder, used by the actors pane and the add-show steps,
is removed in favour of the server's map.

The season watched toggle sends the episodes to change, instead of the whole
watched list. That retires the old watched-list format entirely. The shape of
the map sent to the web client stays as it is, except that each season 0 cell
also carries where its episode belongs.

Every season 0 episode TVDB lists appears in the season 0 column of the web
map and the season 0 row of tvapp's map. That is where it is played, marked
watched, deleted or has its gap ignored, always under its real S00 number.

When a season 0 episode is selected, the web map's episode pane adds a line
saying where it belongs, such as "Belongs after S2E6". The line also says
where that came from:

| Source | Shown as |
| --- | --- |
| air date, TVDB has no placement | air date |
| air date, TVDB agrees | air date; TVDB agrees |
| air date, TVDB disagrees | air date; TVDB says after S6 |
| no air date, TVDB placement used | TVDB placement |
| neither | no air date or TVDB placement |

tvapp's episode card shows the same line, so the TV and the web client agree.

### Code that treats season 0 differently today

| Where | What it does today | What it becomes |
| --- | --- | --- |
| tv-srvr's TVDB episode map | drops season 0, so specials never get air dates | keeps season 0 (phase 6) |
| the web client's own TVDB map | drops season 0 | removed (phase 7) |
| the TVDB episode count | counts seasons 1 and up only | removed; counts are computed (phase 5) |
| the info pane's counts | skip season 0 | removed; the pane shows the computed counts (phase 5) |
| tv-srvr's next-up | skips season 0 | replaced by the computed next-up (phase 5) |
| tvapp's next-up | starts at season 1 | replaced by the computed next-up (phase 5) |
| the gap check | walks seasons by number, season 0 first | walks story order (phase 6) |
| the wait date | treats season 0 as a season of its own | puts each placed season 0 episode in its season (phase 6) |
| needsIntro's unwatched test | compares a count that includes season 0 with one that doesn't | counts regular seasons only, on both sides (phase 5) |
| play's intro lookup | gives a season 0 episode the nearest season's trim and skip | no trim or skip for season 0 (phase 6) |
| the intro check | can mark an intro on any season, season 0 included | never offers a season 0 episode (phase 6) |

## Bugs fixed

| Bug | Fix | Phase |
| --- | --- | --- |
| The map of a show out of the library showed nothing watched when the caller sent no watched list, and a sent list overrode the show's own marks | maps always use the show's own episodes | 1, completed in 7 |
| The "upcoming show" exception in the gap check never applies, because it reads a status field records don't have | read the status records actually store | 1 |
| Five shows out of the library still say they have files | leaving the library also clears the folder facts | 1 |
| The server and the info pane count watched episodes differently, one with season 0 and one without, and overwrite each other | one computed count, season 0 included, nothing written back | 5 |
| Episode and season counts fight between TVDB and the info pane; about 25 shows hold impossible values like 272 episodes | counted from the episodes, season 0 included; the old TVDB count path is removed | 5 |
| Next-up skips season 0, and tv-srvr and tvapp each work it out separately | one next-up computed by tv-srvr, walking story order once season 0 episodes are placed | 5 and 6 |
| tv-srvr's TVDB episode map drops season 0 | season 0 episodes get records from TVDB, with TVDB's placement | 6 |
| The gap check walks season 0 before season 1, wherever its episodes belong | it walks story order | 6 |
| A season 0 episode would play with the nearest season's intro trim and skip | season 0 plays with no trim or skip | 6 |
| needsIntro has a server rule and a different client rule, and opening the intro player forces it on | one server rule; the intro player keeps its show listed while open without writing anything | 5 |
| anyWatched is missing on 389 shows out of the library | computed for every show | 5 |
| waitStr goes stale at midnight until the next sweep | recomputed just after midnight | 5 |
| The two gap-check paths copy different sets of fields, and strayFiles is updated only when another field changes | one computation feeds everything | 5 |
| The info pane saves counts taken from whatever map it was shown | removed | 5 |
| The info pane's count saves don't push, so tvapp sees them only at its next full load | the saves are removed, and computed values push whenever they change | 5 |
| Episodes with no air date can't be marked watched, resumed or played through progress reports | every TVDB episode has a record | 4 |
| Special files are flagged as strays because specials never get TVDB air dates | TVDB specials get records with their dates | 6 |
| seasonPremiereDates is written once and never updated | removed | 5 |
| Comments describe the old tuple, including a slot removed in September | updated | 8 |
| Dead code: the watched-count migration, quality from the old file list, the deletes of old per-episode lists, the disk scan still building those lists | removed | 8 |

## Phases

| Phase | What | Deploys | Meant to change what you see |
| --- | --- | --- | --- |
| 0 | Take a baseline | nothing | no |
| 1 | Bugs that need no data change | tv-srvr; web client through Vite | yes, those bugs |
| 2 | Readers accept both episode shapes | tv-srvr, tvapp, tv-down | no |
| 3 | Convert the stored episodes | one offline conversion | no |
| 4 | Complete the episodes | tv-srvr | yes, undated episodes |
| 5 | Computed values | tv-srvr, web client, tvapp | yes, the corrected counts |
| 6 | Season 0 | tv-srvr, web client, tvapp | yes, season 0 on the maps, in the counts and in the gaps |
| 7 | One map source, no watched lists | tv-srvr, web client | no |
| 8 | Remove leftovers | tv-srvr, tvapp, tv-down | no |

Every tv-srvr deploy restarts all the tv processes, so after each one the pm2
logs are checked for crashes and restart loops. tvapp is rebuilt and
installed after every phase that touches it.

### Phase 0: baseline

Record, for every show, the current value of each field that will become
computed, its Viewed sort key, and which filters it falls in. Copy the
show database aside, in addition to the regular restic backups. Every later
phase is checked against this baseline.

### Phase 1: bugs that need no data change

The map request always uses the show's own watched marks, and clients stop
sending a watched list. The gap check reads the status field records actually
have. When a show leaves the library, its folder facts are cleared along with
its files.

Check: the map and info pane of The Lovers (2023) and Upper Middle Bogan show
every episode watched. Shows TVDB calls upcoming lose their missing-file gap.
The five shows out of the library are marked as having no files.

### Phase 2: readers accept both shapes

The shared episode helpers, tvapp and tv-down learn to read an episode in
either the old list shape or the new named shape. Everything still writes the
old shape.

Check: nothing looks or behaves differently on the web client, tvapp or the
phone.

### Phase 3: convert the stored episodes

With tv-srvr stopped, every stored episode is converted to the named shape.
The episode named by each show's last played episode is given that show's last
played date as its lastPlayed. Where no episode is named, the date goes on the
highest watched episode. The old stray-ignore lists are folded into the
ignored-gap list. tv-srvr then starts again and writes only the new shape.

Check: converting every show back to the old shape gives exactly what was
stored before. The Viewed sort key of every show is unchanged. tvapp's
update socket drops while tv-srvr is stopped, and the full load it does on
reconnecting brings in the converted records. Nothing looks or behaves
differently.

### Phase 4: complete the episodes

The refresh that reads TVDB writes a record for every episode TVDB lists in
seasons 1 and up, including undated ones, with its TVDB id and title. Season
0 waits for phase 6. Play progress
stamps lastPlayed on the episode at start and stop, and adds to playCount
when it runs to the end. A show leaving the library loses only the file facts
of its episodes. The background loop fills in all shows over time, and a
paced one-time pass finishes the rest without crowding TVDB.

Check: announced episodes with no air date appear as unaired cells on the
maps, the same on the web client and tvapp, and can be marked watched. Gap
results are otherwise unchanged from the baseline.

### Phase 5: computed values

The shared function, the in-memory values, the midnight recompute, and the
computed values on every outgoing show go in. Every old writer of these fields
is removed: the server's own stamping, both gap-check copy paths, the info
pane's saves, the intro player's write, the delete step's write, and the TVDB
count path. The request that sets show fields starts ignoring computed names.
The hide/unhide loop gets its own stored field. Computed and removed fields
are stripped from stored records as they load. A show is pushed whenever its
computed values change, including after the midnight recompute.

The rules count season 0 from the start. Until phase 6, only six shows out of
the library have any season 0 episodes, and the server already counts them, so
nothing visible changes from that. Next-up becomes a computed value too,
replacing tv-srvr's and tvapp's own versions. Until phase 6 places them, the
few season 0 episodes sort after everything else.

Check: compare every computed value with the baseline. Every difference must
fall under one of the expected changes listed below. The Viewed order is
identical on the web client, tvapp and the phone. Next-up is the same as the
baseline on the web client, tvapp and play. A show with a wait still hides and
unhides as before. A change made on the web client reaches tvapp within about
two seconds without a full load. Just after midnight, tvapp's wait dates
change without one.

### Phase 6: season 0

The TVDB refresh writes a record for every season 0 episode TVDB lists, with
its TVDB id, title and TVDB placement. tv-srvr works out where each one
belongs, and the computed values walk story order: the gap checks, next-up
and the wait date. Each season 0 cell on the map carries its placement. The
web map's episode pane and tvapp's episode card show where a selected season
0 episode belongs. Season 0 is kept out of the intro logic: its episodes play
with no trim or skip, and the intro check never offers one. The background
loop fills in season 0 over time, and a paced pass finishes the rest.

Check:
- Outnumbered, Toast of London and Ghosts (2019) show every TVDB special in
  season 0, placed where the air dates say.
- Outnumbered's Christmas Special 2024 reads "Belongs after S5", with "air
  date; TVDB says after S6".
- Special files TVDB lists are no longer strays.
- A special plays from its start, and Skip does nothing on it.
- Every show that stops being Finished or gains a gap has an unwatched or
  missing season 0 episode to account for it.

### Phase 7: one map source, no watched lists

The map requests merge into one, served from the show's episodes. The web
client's own TVDB map builder is removed, and the actors pane and the add-show
steps use the server's map. The season watched toggle sends the episodes to
change, and the old watched-list request is removed.

Check: the map pane for a library show, a show out of the library and a
preview show; the actors pane's map; adding a show; toggling a season's
watched marks.

### Phase 8: remove leftovers

The helpers, tvapp and tv-down stop accepting the old shape. The dead code
listed under bugs goes, and the comments that describe the old tuple are
updated. The project instructions also describe the old tuple, and updating
them needs your go-ahead.

Check: nothing looks or behaves differently.

## Expected visible changes

Anything not in this table must look and behave as before. In particular, the
Viewed order must not change anywhere.

| Change | About how many shows | Why |
| --- | --- | --- |
| Episode and season counts change | about 104 today, including about 25 with impossible values, plus every show with season 0 episodes | counted from the episodes; episode counts include season 0 |
| Maps gain a season 0 column on the web and a season 0 row on tvapp | 66 library shows with 616 season 0 episodes, plus shows out of the library | every TVDB season 0 episode is shown |
| Shows stop being Finished | most of those 66, until their season 0 episodes are watched or marked | an unwatched season 0 episode means not finished |
| Missing-file gaps appear | most of those 66; none of their 616 season 0 episodes has a file | an aired season 0 episode with no file, placed before an episode that has one, is a gap like any other |
| Watch gaps appear | shows with a season 0 episode placed between watched episodes | the same rule as any other episode |
| Next-up offers a special | shows with a special that has a file | next-up walks story order |
| A season 0 episode plays from its start, and Skip does nothing on it | any special played | its opening may not match the show's intro |
| Maps show announced episodes that have no air date | shows with such episodes | they now have records |
| Special files stop being flagged as strays | shows with special files that TVDB lists | specials get TVDB dates |
| Upcoming shows lose their missing-file gap | shows with that TVDB status | the status bug is fixed |
| The wait date is right just after midnight | shows with a wait | recomputed at midnight |
| Shows out of the library say they have no files | 5 | the folder facts are cleared |
| Finished and other filters gain or lose shows | shows whose counts change | they read the corrected counts |
| First, last or next aired dates change | listed in phase 0, and again in phase 6 | worked out from all episodes, season 0 included |

## Risks

| Risk | Guard |
| --- | --- |
| tvapp meets the new shape before it can read it, and shows blank maps | phase 2 ships readers for both shapes before anything is converted |
| The conversion is overwritten by the running server | it runs only with tv-srvr stopped, with a copy of the database and the restic backups |
| The Viewed order changes | sort keys are compared against the baseline in phases 3 and 5, on all three readers |
| tvapp keeps a stale value because a change didn't push | record changes push, computed values push when they change, midnight included, and tvapp still does a full load when it comes back to the front and when it reconnects |
| An old client writes a computed value back | the server ignores computed names and logs the attempt |
| Hide/unhide misses the end of a wait | the loop gets its own stored field, tested on a waiting show |
| Undated episodes become missing-file gaps | undated episodes without a file count as not aired |
| Season 0 gives many shows gaps and takes them out of Finished | expected and accounted for in phase 6's check; each gap can be ignored, or its episode marked watched |
| A wrong placement puts a season 0 episode in the wrong spot | the air date decides, any TVDB disagreement shows in the episode pane, and a wrong placement only changes the order, never the S00 number |
| An extra such as an outtake reel turns up in next-up | only one with a file can, and it can be marked watched |

## Left as is

| Item | Why |
| --- | --- |
| The subtitle database, stills, download history, flexget history | their own subsystems, keyed by show and episode or by file |
| Overviews, still images, guest cast, file facts | too large for the show list, or change with the file; fetched live |
| Files the disk scan skips: no episode number, a title that doesn't match, extra copies | not episode data; extra copies are removed by design |
| The shape of the map sent to the web client | not part of the stored data; changing it would touch the map pane throughout |
| Intro marks per episode | intros are per season by design |

## Implementation notes

All eight phases are done. Where the work differed from the plan above, or
settled something the plan left open:

| Item | As built | Why |
| --- | --- | --- |
| Where a season 0 episode belongs | Worked out for the whole show as one computed field, placements, naming each special's place and how it was decided. The web map's episode pane and tvapp's episode card read it from the show, rather than from each season 0 map cell. | One computed value serves the web map and tvapp alike, and tvapp has no map cells. |
| Episode titles | TVDB's English titles, not its default list. | The default list gives each episode's title in the show's original language. |
| An unknown wait | waitStr is empty when the show is ready, and absent when the wait can't be known yet, such as before the episodes have come from TVDB. The hide/unhide loop acts only on a known wait. | A show briefly missing its episodes would otherwise read as ready and have its wait marked as over. |
| The hide/unhide loop's memory | The stored waitSeen field it already used. No new field. | It already held what the loop needs. |
| The project instructions | Updated, now that the plan has been carried out: the tuple line is replaced by the record's fields, the computed fields, and how season 0 is treated. | The old line described a shape no show has any more. |
| The phase 0 baseline and the phase 3 backup | Still in the server's misc data folder: the baseline, its copy of the show database, and the copy taken just before the conversion. Their scripts are gone. | Nothing reads them now; they can be deleted at any time. |
| The built web client on the server | Still the old build until the next full deploy. Vite's client is current. | Client builds are only made by a full deploy. The old build calls endpoints that no longer exist. |
