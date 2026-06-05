
# show episode qualities in map pane cells
- when loadallshows runs populate fileQuality in allShows and shows arrays from tvdb record
  - i may have function name loadallshows wrong

- populate cells in map pane for a show using fileQuality field 
  - get fileQuality from alltvdb array, allShows array or shows array
    - use whatever array the current code uses to populate cells

- in map pane table cells with files present replace plus sign with a char for each quality value:
  - it is usually the first char in the string representation of the number
    - 480   : 4
    - 576   : 5
    - 720   : 7
    - 1080  : 1
    - 2160  : 2
  - the char for unknown quality should be 0
  - as an example: in map pane cell a watched 1080 file would be shown as `W1` and unwatched 2160 would just be `2`

- for cells with no file present the cell should be exactly just as currently shown
  - char is still minus sign just as currently shown
  - background color should be just as currently shown
  - chars in cells like W and U should be just as currently shown
  - as an example: in map pane cell a watched episode with no file would be shown as `W-` just as currently shown

- cell for episode that don't exist should be blank with white bkgnd

- make a plan and write it to ./map-quality-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
