
# changes to video intro feature

## terminology and notes
- let's call auto-jumping to an absolute position when the video first starts playing `trimming`
  - it jumps automatically when video starts playing
  - in the old code it was specified when introDur was negative
- let's call the jumping to a relative position when the skip button is pressed `skipping`
  - it jumps ahead by a duration value
  - in the old code it was specified when introDur was positive

- all time position and durations are displayed in the same format
  - time pos or duration is shown in seconds units as mmm:ss.t
    - mmm is minutes arbitrarily large
      - ther is no hour number
      - when time is less than 1 min then `mmm:` is suppressed: ss.t
    - ss is seconds
      - when time is less than 10 secs then leading zero is suppressed: s.t
    - t is tenths of a second which is always shown
  - when a value is missing or null it is blank
  - when a value is 0 it is shown as `--`

## vars
- each show has two vars, `trimPos` and `skipDur` that replace the old introDur var
  - a missing show is treated exactly the same as a value of null
    - so in these instructions null means missing or null
  - these are stored in the tvdb record for a show
  - each can be null, 0, or > 0
    - when they are both null it means they need to be set
      - they will be set in the intro video pane for the show
    - when 0 it means the var and the the associated feature is not used
      - this is the same as when introdur was 0
    - when a var is > 0 then it is a positive ms time value that will be used
    - the vars are never < 0
  - when trimPos is > 0 then it specifies a video position to use for trimming
  - when trimPos is zero then there is no trimming
  - when skipDur is > 0 then it specifies a video time duration to use for skipping
  - when skipDur is zero then there is no skipping
  - a show can have > 0 values in both trimPos and skipDur at the same time
    - that means the show supports both trimming and skipping

- there is also a var `startMark` that is stored in the tvdb record for a show
  - it is unchanged from current code
  - startMark is only used for the intro video pane ui
  - there is no endMark var any more

## intro video pane header overlay contents and actions
- the show name is at far left, same as before
  - this leftmost show name div gets all the empty space in the line
- the rest of the items are on the right -- they are these items in this order:
  1. the time of the current video position same as before
  2. the position control buttons `<<`, `<`, `>`, and `>>` same as before
  3. the trimPos button 
    - when clicked the trimPos value is set to the current video position time
    - it has the value of trimPos for the label
  4. the trim button labeled `Trim`
    - when clicked the video should jump to the trimPos
  5. the "clear trim" button sets trimPos var value
    - if the trimPos is > 0 then set trimPos to 0
    - if the trimPos is null then set trimPos to 0
    - if the trimPos is 0 then set trimPos to null
    - it has the label `Clr`
      - it can be confused by having the same label as the "clear skip" button
      - it is differentiated from the "clear skip" button by the name and the position in the button row
  6. the `Pre` button it is the same pre button as before
    - when clicked the video jumps to ((startMark position) - 3 secs)
  7. the startMark button which is the same as before
    - when clicked the startMark value is set to the current video position time
    - it has the value of startMark for the label
  8. the skipDur button
    - when clicked the skipDur value is set to ((current video position time) - startMark)
    - if startMark is null or missing then ignore the click
    - if the current video pos is less than the startMark pos then ignore the click
    - it has the value of skipDur for the label
  9. the skip button labeled `Skip`
    - when clicked the video should jump to (startMark - 3 secs) position
    - this used to be labeled `test`
    - it has identical functionality to old test button
  10. the "clear skip" button sets skipDur var value
    - if the skipDur is > 0 then set skipDur to 0
    - if the skipDur is null then set skipDur to 0
    - if the skipDur is 0 then set skipDur to null
    - it has the label `Clr`
      - it can be confused by having the same label as the "clear trim" button
      - it is differentiated from the "clear trim" button by the name and the position in the button row
  11. the old clear button should be removed
  12. the old none button should be removed
  13. the ant button appears and functions identical to the old ant button
  14. the old epi button should be removed
  15. the old next button should be removed
  16. the X close button shoud close the pane the same as before

- all actions should be performed immediately
  - trimPos, skipDur, and startMark values should be persisted in tvdb immediately when changed
    - keep introDur in tvdb with old values for backwards compatibility
  - there is no state used other than the trimPos, skipDur, and startMark var values

## actions when playing a video in the video pane or emby
- these play instructions do not apply to the intro video pane
- when a video is played there can be trimming and/or skipping jumps
  - when trimPos is > 0 and the video first starts playing the video should jump to trimPos position
    - when trimPos is 0 or null then nothing happens when the video starts playing
  - when skipDur is > 0 and skip button is clicked the video should jump to (current position)+skipDur
    - when skipDur is 0 or null then the skip button does nothing

## showing vars outside of intro video pane
- in the map pane call the first child div of id maphdr2 the info bar
  - the introdur value in the info bar should be replaced by the two values trimPos and skipDur
    - separate them with a pipe | 
- when emby is playing the tampermonkey button should have a label with only the two values trimPos and skipDur
    - separate them with a pipe | 

- make a plan and write it to ./trim-skip-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions

