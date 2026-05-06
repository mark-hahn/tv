
# response to buttons plan

## new instructions
- In flex pane rename force button to Run
- add All button to usb pane
- in all panes add a First button after the All button
  - first button should scroll the list to first selected item 
  - if there is no selected item gray out first button

## answers
1. qbt Force should delete from qbt and re-add (i.e., restart download).
2. del should remove the download record from the database and in-progress list and all other state and then delete the actual file from the server's disk
3. errs button should not change what it does and not move it's position, ignore errs button instructions
4. the local pane top row in header already has a from button, just move it
5. use parse-torrent-title to extract the show names from the torrent titles and then use smartTitleMatch
6. in flex list when selecting using the mouse only allow a single non-header row selection, shift and plain should do same as ctrl-click, from button should select multiple rows after clearing selection
7. use your suggested dialog wording
8. that is correct but when there is no top folder and only a file use parse-torrent-title on file name

## answers to Suggestions
- Keyboard shortcut: bind Enter to ok and Escape to cancel
- Button disable states: disable as per your suggestion
- "All" with empty selection: only enable "All" when at least one item is selected and gray out button otherwise
- add new tor header row

## Instructions
- update plan in buttons-plan.md and highlight changes
- make no edits other than writing plan
- notify me of any more contradictions, ambiguity, or impossible actions
- feel free to make more suggestions
