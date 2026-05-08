
# usb to local downloads
- tor and qbt should only handle single file downloads, not folders
- qbt should download to usb ~/movies folder 
  - then rsync should download files from there to local server /mnt/media/movies folder
  - one rsync per file with up to 8 simultaneously
- row 1 of header changes in movie mode:
  - title in left side should change from `Downloads` to `Movie Downloads`
  - remove cycle, errs, clr, and active buttons
  - show same bit rate stats as in current down pane
- row 2 of header should be hidden
- subpane for cards list will change to new pane movieDownPane
- movieDownPane has a card in list for each rsync downloading
  - there is no selection of cards
  - each card has two rows
    - row 1 is movie file name with no path
    - row 2 is live progress line from rsync
      - output of rsync shows progress like `238,551,040   1%   10.49MB/s    0:26:59`
      - parse this into row 2 format `<total size> | <downloaded progress> | <rate> | Rem: <time remaining> | Eta: <eta> | <status>`
        - `<total size>` is total size of file
        - `<downloaded progress>` is amount downloaded so far
        - `<rate>` should be megabits per second with same format as in old down cards
        - `<time remaining>` is time remaining in hh:mm:ss
        - `<eta>` estimated time of finish in hh:mm:ss in la pst timezone
        - `<status>` is `Downloading` or `Finished`
        - total size and downloaded progress formats should be same as in current down card sizes
  - cards should accumlate as more downloads are started
    - use v-show, not v-if, for normal down subpane and movieDownPane
      - normal down subpane can continue updating while hidden
    - movieDownPane cards are never removed
      - they are not presistant between app loads
      - they are persistant during app running

## Instructions
- remember your thinking work done so far
- update plan in movies-plan.md and highlight differences between last version and this one
- make no changes other than writing plan
- notify me of any contradictions, ambiguity, or impossible actions
- feel free to make suggestions
