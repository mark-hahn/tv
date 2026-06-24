
# add var to episodeData that indicates presence of a .bif sidecar

- add a new data entry to the episode data array episodeData[s][e]
  - it is a boolean value 1 if the episode video file has a sidecar .bif file
    - a bif sidecar file has the video file name base plus `*.bif`
      - the base name does not include the final dot so the base of `a.file.name.mkv` is `a.file.name`
      - an example bif file name is `a.file.name-320-10.bif`
  - the bif boolean should be the last entry at the end after resolution
  - if the entry is missing that means it has no bif
    - so bif entry will never be zero
  - if there is a bif entry then resolution entry will be 0 if the resolution is unknown
    - when bif is 1 the resolution entry is always present
    - when bif entry is missing the resolution entry can also be empty to indicate the resolution is unknown
  - the path for a bif file is not stored, it is just a boolean

- the presence of a sidecar.bif file is determined when the disk data for a show is scanned
- it should also trigger a chokidar event when a bif file is added
  - it should push the disk data the same as when a video file is added
- if a show is not in emby then any bif file should be ignored like video files are ignored

- add a new episodeData read accessor getBifEpisode(ed, s) that returns an integer or null
  - it should return the first episode number with a bif or null if no episode has a bif
  - getBifEpisode will not be used for now
    - a new background task will use getBifEpisode to determine if a bif file needs to be generated

- do a one-time tvdb.json scan of all shows in emby and populate the bif values
  - stop pm2 tv-srvr process first as usual
  - report statistics as usual
  - log first 10 shows that have bifs

- no plan file is needed
- stop and let me know if there is any problem implementing this
- implement it now
