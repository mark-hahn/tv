
# adding buttons in tab panes
- many tab panes have list items that can be clicked with modifers like ctrl & shift
  - the list click modifier actions are hard to remember
- every list item in pane descriptions below should be selectable and use buttons instead of modifiers
  - list item selecting uses the standard ctrl-click & shift-click behavior
    - except in the usb and local panes where the select behavior of folders and files stays the same
  - the buttons operate on the selected item(s)
    - all buttons described in the pane section below appear together in the last line of the header at the far right
    - buttons should be in the order they are listed in the pane section below
- in all pane sections below alt-click on a list item copies the torrent title or file path to the clipboard
  - some panes already had this behavior
- don't remove any old buttons 
  - exception: in the pane sections below if the button already exists remove the existing button
    - in other words move the old button to its new position
- if there are any pane list actions not in a button below or in an existing button then let me know

## tor pane buttons
- Sel:   Select the show in the shows list that matches the first selected show in tor list
- From:  Clear selections and then select all items whose show matches the selected show in shows list
  - also scroll to first item newly selected
- All:   Clear selections and then select all items whose show matches the first selection in tor list
  - also scroll to first item newly selected
- Show:  open the torrent detail web page in ipt or tl
  - open in new browser tab
  - this is what a plain click used to do
- Send:  send all selected torrents to qbt
  - only if file isn't already on disk
  - this is what a ctrl-click used to do
- Force: send selected files to qbt 
  - even if the file is already in the disk
  - this is the force-download operation
  - gate with a confirmation dialog describing action

## flex pane buttons
- Sel:   Select the show in the shows list that matches the first selected show in flex list
- From:  Clear selections and then select the items whose show matches the selected show in shows list
  - also scroll to first item newly selected
- All:   Clear selections and then select all items whose show matches the first selection in list
  - also scroll to first item newly selected
- Info:  open info box for first select list item 
  - this used to be done with a plain click

## qbt pane buttons
- Sel:   Select the show in the shows list that matches the first selected show in flex list
  - this used to be done with a plain click
- From:  Clear selections and then select the items whose show matches the selected show in shows list
  - also scroll to first item newly selected
- All:   Clear selections and then select all items whose show matches the first selection in list
  - also scroll to first item newly selected
- Force: send selected files to qbt no matter what their sent status is
  - gate with a confirmation dialog describing action
- Del:   delete selected torrents from qbt and the corresponding files in usb disk
  - this used be done with ctrl-click
  - gate with a confirmation dialog

## Down pane buttons
- Sel:   Select the show in the shows list that matches the first selected show in flex list
  - this used to be done with a plain click
- From:  Clear selections and then select the items whose show matches the selected show in shows list
  - also scroll to first item newly selected
- All:   Clear selections and then select all items whose show matches the first selection in list
  - also scroll to first item newly selected
- Del:   delete selected files from local disk
  - gate with a confirmation dialog

## Usb pane buttons
- Sel:   Select the show in the shows list that matches the first selected show in flex list
- From:  Clear selections and then select the items whose show matches the selected show in shows list
  - also scroll to first item newly selected
- Force: send selected files to download
  - used to be forced down button
- Del:   delete selected files from usb disk
  - gate with a confirmation dialog

## Local pane buttons
- Sel:   Select the show in the shows list that matches the first selected show in flex list
  - this used to be done with to button
- From:  Clear selections and then select the items whose show matches the selected show in shows list
  - also scroll to first item newly selected
  - this used to be done with from button
- Err:   Clear selections and then select all items that have errors
  - used to be errs button but this just selects errors, not toggle a pane with error list
  - also scroll to first item newly selected
- Info:  open info box for first select list item 
  - this used to be done with Info button
- Del:   delete selected files from local disk
  - used to be Del button

## Instructions
- create a plan in buttons-plan.md
- make no changes other than writing plan
- notify me of any contradictions, ambiguity, or impossible actions
- feel free to make suggestions
