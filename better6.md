
# Reply to better5.md

- in tv-down when the name is on the blocked-name list it should still be overridden by forcing

- i agree with D17 and D18 decisions

- D19: agreed, #4 chooses only among the files tv-down would download now. is it possible the best file in #4 could be blocked later and a file not the best could pass and be downloaded later?  is there a reason to even have #4 test at all? what would change if #4 was removed?

- D20: `The cost: a file you deleted because it was bad comes back` is a real problem. if a file was deleted purposely to block the file then it should not automatically be restored. 

- consider this idea and let me know if you agree with it:
  - a deleted file should only be restored when the user approves it
  - when a file in usb could restore a deleted file then:
    - add a button `Restore?` to the right of the plot button in the tab row
      - the button should have the same background color as the intro button
      - the restore button should have a count of number of files in this situation
    - when restore is clicked there should be a dialog pop-up
      - the dialog should explain the situation
      - the dialog should show the first file name in the list
      - it should have a `Cancel` button that just closes the pop-up
      - it should have a `Block` button
        - when block is clicked the listed file name should be added to blocked-files list
      - it should have a `Restore` button
        - when restore is clicked the listed file should be restored as if the file never existed
    - this will require some kind of stored info to know the file to be restored existed before it was deleted. will the down db know this?

- D21: i agree the queued one is removed whether it is waiting or already downloading

- D22: agreed, do not sort twice

- do not do a warning for torrents with a low resolution like 384p, 480p, 384i, 480i etc.
  - they should be included like any other resolution in the sort
  - i think this only leaves torrents with no seeds as a warning

- D12: agreed
- D15: agreed

- D26 and D27
  - i was only concerned about the user sending two torrents for the same episode. That should give a warning
  - the user is authoritative for which torrent to send for a single episode.  There should be no warning given related to the user's choice.

- D28: i don't understand how it is possible for a non-forced download to be worse than an existing file. don't earlier gates check for that? if it isn't possible then don't waste the effort to check before replacing.

## The fixed order
- the priority should be in this order
  - Resolution
  - Bit depth
  - PROPER or REPACK
  - Source
  - HEVC
  - Size
  - Seeds
  - Bad group
  - Tracker

## note
- this is still a bit confusing for me.  warn me when i am contradictory or there is something neither of us has decided.
