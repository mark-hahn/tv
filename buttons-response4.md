
# more changes and problems for new button consolidation

- plain click should select one row and not toggle
- make all selection highlighting the same color as in tor pane
  - qbt and down highlighting should color pane background instead of blue border
  - highlighting should stay the same when you leave a pane and come back
    - down and flex panes have this problem

## tor pane
- first button doesn't scroll enough
- shift click selects text in cards as well as the cards themselves
- when card is pink showing tor was sent you can't see selection
  - does the ok msg already indicate it was sent, if so just remove pink highlight for sent shows
- force button gives error when torrent already in qbt, it should remove torrent like qbt del button instead: `"QbitTorrent already has torrent Margo.s.Got.Money.Troubles.S01E01.The.Hungry.Ghost.1080p.ATVP.WEB-DL.DDP5.1.Atmos.H.264-BLOOM.mkv`

## flex pane
- shift click selects text in lines as well as the lines themselves
- move info and bottom buttons to between run and sel buttons
- change selection clicking to use modifers like other panes for multiple selection
  - ignore timestamp headers
  - support multiple selections in buttons where possible
- show msg `Running ...` to left of from button while flexget is running, even when not running from from button
  - now it just flashes something for a fraction of a second
  - the thing that flashes is small and touches the run button

## QBT pane
- shift click selects text in cards as well as the cards themselves
