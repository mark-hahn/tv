# Season 0 plan

## The problem

The episode data cleanup gave every show a record for every episode TVDB lists, season 0 included, and counted each season 0 entry as a special. But TVDB uses season 0 for anything a show's makers officially released, and for most shows that is extras, not episodes. Once the season 0 backfill wrote them in, these extras turned into gaps, made shows "not ready" so they dropped out of tvapp's default list, and showed on the maps as unwatched episodes with no file.

| Show | What TVDB lists in season 0 |
| --- | --- |
| The Last of Us | 55 extras, no specials: 16 "Inside the Episode" featurettes, 16 episodes of the companion podcast, 23 making-ofs, cast interviews, set tours and promos |
| Severance | sneak peeks, season recaps, Lumon promos, "Inside the Episode" featurettes |
| Only Murders in the Building | a question-and-answer web series |
| Comedians in Cars Getting Coffee | 55 short clips |
| Childrens Hospital | 8 undated Adult Swim wraparounds and promos, and the 10 five-minute episodes of the 2008 web series the show grew out of |
| Outnumbered | short charity sketches, and the Christmas Special 2024, a real episode |

Before the cleanup, season 0 only ever came from files on disk and watched marks, so none of this showed.

The unaired specials of Childrens Hospital come from the same cause. Its 8 undated entries are extras with no air date, and an episode with no air date and no file counts as unaired. Treating undated episodes of ended shows as aired was tried and then removed: it hid the cause instead of fixing it, and it was wrong for the never-aired episodes of cancelled shows. Undated keeps meaning unaired.

## What TVDB can tell us

TVDB episodes carry tags that sort season 0 entries, filled in by its contributors.

| Tag | Values |
| --- | --- |
| Special Category | Episodic Special (a full-length episode not aired in the normal season, such as a holiday special), Movies, Pilots, OVAs, Webisodes and Shorts, Behind the Scenes / Makings Of, Cast Interviews, Season Recaps, Bloopers, Deleted Scenes, Extended Scenes |
| Special is Critical to Show's Story | Yes, No |

Outnumbered's Christmas Special 2024 is tagged Episodic Special and critical to the story. Every season 0 entry of The Last of Us is tagged Behind the Scenes and not critical.

The tags are far from complete. In a sample of 126 season 0 entries from 40 library shows:

| Category | Entries |
| --- | --- |
| untagged | 81 |
| Behind the Scenes / Makings Of | 17 |
| Cast Interviews | 13 |
| Episodic Special | 6 |
| Webisodes and Shorts | 4 |
| Season Recaps | 2 |
| Pilots | 2 |
| Movies | 1 |

Most untagged entries are extras too, but a few are real: Archer's three-part "Heart of Archness", the Cheers anniversary specials, and Childrens Hospital's web series episodes.

The tags do not come with a show's episode list. Reading them takes one more TVDB request per season 0 entry.

## Two kinds of season 0 entry

Every TVDB season 0 entry ends up as one of two kinds. Nothing TVDB lists is lost, and every TVDB record of a show can be seen somewhere in the map pane.

| Kind | Which entries | Where it lives | What it takes part in |
| --- | --- | --- | --- |
| Counted special | one with a file on disk, one marked watched, or one TVDB tags Episodic Special, Movies, Pilots, or critical to the story | the show's episodes, as today | everything an episode takes part in: the map grid, the watched and episode counts, Finished, gaps, ready, next-up, the wait date, story order and placement |
| Listed extra | every other TVDB season 0 entry | a separate list on the show, outside its episodes | display in the map pane only |

The separate list is what makes this safe. The counts, the gap check, ready, next-up and every other reader of the episodes never see an extra, so none of them needs to remember to skip one. Putting extras in with the episodes behind a marker would mean every one of those readers checking the marker, which is the kind of mess the cleanup removed.

## The counting rule

A season 0 entry is a counted special when any of these holds; otherwise it is a listed extra.

| Reason it counts | Why |
| --- | --- |
| it has a file on disk | you have it, so it is something to watch |
| it is marked watched | the watched mark is kept only in the episodes, and is never lost |
| TVDB tags it Episodic Special, Movies or Pilots | TVDB says it is a real episode, film or pilot of the show |
| TVDB tags it critical to the show's story | TVDB says the story needs it, whatever its category |

This keeps what was asked for earlier, that a show with an unwatched special is not finished, for every special TVDB has tagged as a real episode, and it lets the extras list say what each entry is. What it gets wrong is a real special nobody has tagged: it stays in the extras list until it has a file or is watched.

Each entry's tags are kept with it, whichever kind it is, together with the time TVDB last changed that episode. TVDB's episode list gives that time for every episode, so a refresh sees at once which entries are new or have changed since their tags were read, and reads the tags of those entries only, in the same refresh. An entry tagged on TVDB after it was first read is caught the next time its show is refreshed, rather than never.

## Keeping the two kinds current

Nothing waits for a later refresh. Whatever changes the counting rule's answer for an entry moves it at once, in the same step that saw the change, and the show's computed values and push follow from there as for any other episode change.

| Event | Result, at once |
| --- | --- |
| A TVDB refresh finds a new season 0 entry, or one TVDB has changed | its tags are read in that refresh, and it is sorted by the rule |
| A file lands for a listed extra | the step that records the file makes it a counted special, and it appears in the grid; downloading one of the Childrens Hospital web series episodes puts it on the map as soon as it lands |
| The file of a counted special is deleted, and it is not watched or tagged as a real episode | the step that records the deletion moves it to the extras list |
| A counted special is marked watched | stays counted whatever its tags say, since the watched mark is kept only there |
| TVDB drops an entry | it leaves whichever kind it was in, as a vanished episode does today; a watched mark is never dropped |

A listed extra cannot be marked watched or played, since nothing shows it except the display-only list and it has no file; it can only become counted by getting a file or a tag.

## The marking backfill

The season 0 entries already written in, extras and all, are sorted by a backfill of their own, run once when this is released, rather than left to be caught by later refreshes.

| Step, per show | What it does |
| --- | --- |
| 1 | refreshes the show's episodes from TVDB |
| 2 | reads the tags of every season 0 entry, and keeps them with the TVDB change time |
| 3 | sorts every season 0 entry by the counting rule: counted specials stay in the episodes, extras move to the extras list |
| 4 | saves the show, and pushes it to tvapp, the phone and the web client when anything changed |

It runs as a background driver outside tv-srvr, like the season 0 backfill, so a deploy only pauses it, and it is paced for TVDB. Library shows go first, so the shows that matter are right soonest. There are 5,403 season 0 entries today, in 516 shows; 617 of them are in 66 of the 214 library shows. With one episode list per show and one tag request per entry, the whole run takes about two hours, the library shows the first quarter of an hour of it.

Until the backfill reaches a show, that show counts its season 0 entries as it does now. Once it has passed, no show does: the only season 0 entries left in any show's episodes are ones the counting rule keeps, and the check after the backfill proves it across every show.

## How the extras reach the screen

The extras list is stored with the show but is not part of the show record that tvapp, the phone and the web client's list load in full and receive in every push. Doctor Who has 169 season 0 entries and The Last of Us 55, and every load and push would carry them for nothing. They go out only with the map pane's answer, the same way overviews and stills are fetched only when shown.

Each extra goes out with what the display needs:

| Field | Shown as |
| --- | --- |
| number | S00Exx |
| air date | the date, or "no date" |
| title | the English title |
| category | the TVDB Special Category, or "untagged" |
| runtime | minutes |
| placement | where it falls among the regular episodes, by the same air date and TVDB placement rule as counted specials, such as "after S01E01" |

## In the map pane

The grid shows the regular seasons and the counted specials, as today.

Below the grid, a heading names the extras and their number, such as "TVDB extras (55)". It is collapsed when the map opens, so a long list moves nothing around, and opens with a click. A show with no extras shows no heading.

Opened, the list has one row per extra, in episode number order, in grey: number, date, title, category, runtime and placement. Rows cannot be selected or hovered, and have no watched toggle, play, delete or any other action. Nothing in the list changes anything.

tvapp and the phone do not show the extras list. Their maps show the counted specials only.

## What changes for the shows named above

| Show | Now | After |
| --- | --- | --- |
| The Last of Us | 55 unwatched specials with no file, watch and file gaps, not ready | no specials; its 55 extras in the list, all Behind the Scenes; gaps and ready back to what its regular episodes say |
| Childrens Hospital | 8 undated specials shown as unaired, 10 web series episodes as unwatched with no file | none of the 18 counted, since none is tagged, has a file or is watched; all 18 in the extras list, the 8 marked no date; nothing shown as unaired |
| Outnumbered | all its season 0 entries counted | the Christmas Special 2024 counted and placed after S05E06, as an Episodic Special; the charity sketches in the extras list; watched ones stay counted |
| Ted Lasso, Severance, Only Murders in the Building, Black Mirror, Bob's Burgers, Cheers and the others that went not ready this afternoon | not ready, with gaps, because their next episode in story order is an extra | ready again unless a real tagged special, or one with a file, really is next |
| Archer | its season 0 entries counted, untagged | "Heart of Archness" and its other untagged entries in the extras list, until they have files or are watched |

## Phases

| Phase | Work | Check |
| --- | --- | --- |
| 1 | Season 0 entries keep their TVDB tags and TVDB change time; every TVDB refresh reads the tags of new and changed entries | tags stored for the sample shows above match TVDB; refreshing a show TVDB has not changed sends no tag requests |
| 2 | Every step that can change the counting rule's answer sorts at once: the TVDB refresh, a file landing, a file deleted. The extras list is stored with the show and kept out of the show record that is loaded and pushed | The Last of Us, Childrens Hospital, Outnumbered and Archer come out as in the table above; no show record sent to tvapp, the phone or the web list carries extras |
| 3 | The marking backfill, library shows first, run by the background driver outside tv-srvr | no show anywhere has a season 0 entry in its episodes that is untagged, unwatched and without a file; the shows that went not ready this afternoon are ready again where no real special is next; the library's gap counts drop back accordingly |
| 4 | The map pane's answer carries the extras list, and the map pane shows it below the grid, collapsed, display only | the list opens and closes, shows every field, and nothing in it can be selected or acted on |

## Left as is

| Item | Why |
| --- | --- |
| Undated episodes count as unaired | right for an announced episode with no date yet and for a pilot that never aired; the extras that made it look wrong leave the episodes |
| Regular-season episodes | every TVDB episode of seasons 1 and up, dated or not, is already in the grid |
| Season 0 in intro marking, trim and skip | still left out, as the cleanup decided |
| tvapp and the phone | show counted specials only; the extras list is for the web map pane |
| Promoting an extra by hand | not part of this plan: the extras list has no actions. An extra becomes counted by getting a file, or a tag on TVDB |

## Implementation notes

Carried out on 2026-10-10. Where the work differed from the plan above, or settled something it left open:

| Item | As built | Why |
| --- | --- | --- |
| Where the extras live | A table of their own in the show database, keyed by the show's TVDB id, beside the shows table. | A field on the show record would have had to be copied by hand at every place a record is rebuilt, and stripped at every place one is sent out. Kept apart, nothing that loads or pushes shows can carry them, and a rename leaves them alone. |
| When the sort runs | At the end of every episode refresh, whichever sources it ran: a TVDB refresh, the disk scan after a file lands or goes, the map pane's live refresh. | One place covers every event in the plan's table, after the refresh's last wait. |
| Before the backfill reached a show | Its season 0 was sorted by its first refresh after the release, with the tags it had then, which was none. Entries with no file or watched mark went to the extras at once, and the tagged ones came back when the backfill read their tags. | The sort runs on every refresh, so the plan's "counts as it does now until the backfill reaches it" did not hold. Extras stopped counting sooner; real specials with no file or watched mark were missing from the counts for that while. |
| The marking backfill | The existing background driver, since each show's refresh now reads tags and sorts. It runs library shows first. | No second driver to keep. |
| An entry TVDB gives no last-changed time | Its tags are read once, and kept under the time "unknown". | Without a time there is nothing to compare; reading it on every refresh would cost a request each time for nothing. |
| A failed tag read | Keeps whatever tags the entry had, logs a warning, and is tried again at the show's next TVDB refresh. | A TVDB hiccup should not change what counts. |
