
# major changes to episodeData plan

- add path and emby id to episodeData
- use existing YYYY-MM-DD instead of unix time for aired dates
  - this is for human readability when testing

## compress json text
- only file name is needed for path
  - full path is /mnt/media/tv/<name>/Season <season>/<file name>
  - show name <name> and season number <season> are implicit so only <file name> needs to be stored for path

- use 0 for false/null and 1 for true
  - single-char 0 and 1 are shorter strings

- some vars can be calculated instead of explicitly stored
  - hasFile => path is in data
    - see formatting below when no file exists
  - unaired => aired date > todayYMD

- values for each episode are only aired date, watched, id, file name, and resolution

- change episode array to 1-based
  - first entry is episode 1
  - otherwise every single episode array would have 0 as first entry

- use episode data array instead of object
  - format should be [aired date, watched, emby id, file name, resolution]
    - example is `["2026-06-23", 1, 1234, "Rivals.2024.S02E01.HDR.2160p.WEB.h265-GRACE.mkv", 1080]`
  - if resolution is unknown then last entry can be skipped
    - example is `["2026-06-23", 1, 1234, "Rivals.2024.S02E01.HDR.2160p.WEB.h265-GRACE.mkv"]`
  - if no file is present then file name and resolution can be skipped
    - example is `["2026-06-23", 1, 1234]`
  - for shows not in emby the only episode data is the aired date and watched value
    - example is `["2026-06-23", 1]`
    - there are no files since they are always deleted when show is deleted from emby
      - if there are stale files on disk when show is not in emby then they can be ignored
    - it is important to keep aired date and watched value so they are available if show is put back in emby
  - when a show is unwatched and not in emby the last entry can be dropped
    - example is `["2026-06-23"]`

## episodeData usage
- episodeData should be authoritative
  - data from emby in episodeData should be updated when needed and kept fresh
  - emby api lookups should be replaced with episodeData access whenever possible

- a shared refresh function should refresh all of episodeData
  - code that that collects data like getTvdbData and perShowCallback can be simplified
    - episodeData refresh function could replace much of existing logic that collects data
  - refresh function should be used immediately before UI usage when needed
    - before server calls for data like getSeriesMap are returned
    - before tvdb data is pushed to UI

- episodeData should have shared access and update functions

## notes
- update ./episodeData-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions

