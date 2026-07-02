
# log viewer changes
- ctrl-alt click in cell should load cell value into its filter like plain click does now

## selecting rows
- currently when the viewer pane loads, one or more of the rows are highlighted yellow 
  - the row(s) stays highlighted when scrolling
    - i can't change that highlighting
- fix unwanted highlighting at load
- enable row selection
  - selected rows should be highlighted
- use standard mouse selection logic to select rows
  - plain click should select row and deselect all other rows
  - ctrl-click should toggle row selection on and off
  - shift-click should extend selection
  - selected rows should be hilited

## actions selector
- change button labeled bottom to 2 down arrows and no other text
- add Actions selector to the right of the bottom button 
- the selector label should be `Actions` when collapsed
- selector should have these choices:
  - `Go To Selection`
    - this should scroll so that first selected row is at the top of the visible rows

  - `Select Sites`
    - this should select all rows with log_site.id equal to the id of all selected rows

  - `Clear Selections`
    - this should deselect all rows

  - `Hide Sites`
    - this should hide sites in source code
        - the sites to hide are sites with site ids from selected rows in unilog viewer
      - it should have confirmation dialog before hiding
        - the confirmation dialog should tell how many sites will be hidden
    - it should hide sites by commenting out unilog() calls 
      - it should prepend `// deleted ` to the lines with active unilog() calls to hide the sites
        - that will leave the line as `// deleted unilog(<site id>, ...`
      - it should not comment out unilog calls that are disabled by ending `// no-unilog`
    - the conversion logic at deploy should ignore hidden sites
    - hidden sites will not add any more events to log
      - but old events with hidden sites will still be in log
    - hiding should just change source code and not do or trigger any other action

  - `Unhide Sites`
    - this should unhide sites in source code
      - the sites to unhide are sites with site ids from selected rows in unilog viewer
      - this should not have a confirmation dialog
    - it should unhide sites by un-commenting unilog() calls from source code 
      - it should trim leading `// deleted ` from the unilog() call lines for selected sites
        - that will leave the line as `unilog(<site id>, ...`
    - unhiding should just change source code and not do or trigger any other action

## notes
- make a plan and write it to ./actions-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
