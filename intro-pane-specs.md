
# intro video pane spec and changes
- terminology used in these instructions
  - the `intro pane` is the video pane for adding/editing introDur value for show
  - there are 2 modes when intro pane is open
    - it is in `info mode` when pane was opened by intro button in info pane
    - it is in `map mode` when pane was opened by intro button in map pane

- intro is needed for a show if it meets all these conditions
  - it is in emby
  - there is at least one episode of show that has not been watched
    - an episode can be counted as not watched even if it has no file or is unaired
  - it does not already have an introDur value in its tvdb record or has introDur is value null
  - the show is not in linda collection

- add a button `None` to intro pane between test and next buttons
  - when clicked it should set introDur value to zero
    - it should remember startMark and endMark so they can be restored later
    - it should be a toggle so it switches between 0 and startMark/endMark
  - value of zero means the show has no intro and no intro is needed
  - when introDur value is zero show these in intro pane:
    - startMark and endMark button labels should be dashes 
    - the none button should be highlighted
    - intro value should show as zero
  - the skip button in the remote control pane should do nothing when introDur is zero

- persist the mute state on intro video pane player
  - it doesn't persist between app loads
  - when app first loads it should be set to muted

- show the season/episode like (s01e01) after show name in both info mode and map mode

- when intro pane is opened or a show or episode is changed with the next button the show should start playing at pos time of zero

- the next button changes the show or episode loaded in intro pane
  - the selected show in the shows list is not changed unless selected show is removed while in `no intro` filter mode
  - when intro pane is opened it should use selected show from shows list
  - in info mode the next button changes the show
    - it should load the next show that needs an intro
      - it should choose in the sort order selected in the sort dropdown in hdrbot
      - it should load the first episode in the last season that has intro needed
  - in map mode the next button changes the intro pane to the next episode
    - it should stay on the same show
    - if there are no more `intro needed` episodes in the map then next button should do nothing

- if show filter is set to `no intro` then shows list should be updated when intro pane is closed

- move the 0 button to the left left of the << button
  - the 0 button should be 20px wide  

- if there are any ambiguities, contradictions, or impossibilities in these instructions stop and ask me for help
- feel free to make suggestions
