
# new skip show intro feature
- the goal is to be able to skip over intro section of videos with one press of a button
- it remembers the length of show intro for each show
  - it doesn't know where intro starts, it just jumps to video position when button pressed

- keep a var introDur in tvdb records
  - it is the duration of the intro
  - it is in ms and does not need to be in every record
  - introDur should be clamped to a min of 0

- there are two time vars startMark and endMark
  - they are video position times in ms
  - when app loads set startMark = 3 mins and endMark = 4 mins
  - they are persistant until app reloads

- use an intro video pane to measure introDur length
  - the info pane should have a button `Intro` between refresh and delete
    - change delete button label to `Del`
  - the intro button should open an intro video pane
    - it should play the first available video file for the selected show
      - it should use the selected show even if the show already has an introDur value
      - if the selected show has no files then button should be disabled and grayed out
      - the disabled status should be maintained live
    - the video pane should be almost the same as chksrt pane
      - the left side of the top should have only the show name
      - the right side of the top should have these items
        1. `Pre` button 
          - when clicked jump the video position to the startMark position minus 3 secs
        2. start button
          - label is startMark time as mm:ss.t
            - mm is minutes, ss is secs, and t is tenths of a sec
          - when clicked set startMark to current position of video
          - set width to guess based on mm:ss.t
          - when clicked save endMark - startMark in introDur clamped to a min of 0
        3. end button
          - label is endMark time as mm:ss.t
          - when clicked set endMark to current position of video
          - set width to same as start button
          - when clicked save endMark - startMark in introDur clamped to a min of 0
        4. introDur display in box
          - box has white bkgnd with black bold text and same font size as buttons
          - show as mm:ss.t
          - it should be live and always show introDur value
        5. `Next` button
          - when clicked change show selection in show list to next show that has no introDur value
            - the next show is the one in the filtered list that would be visible if not covered by video
          - the video pane stays visible so show list is not seen
          - the show in video pane changes to newly selected show
          - if there is no next show with no introDur then exit video
        6. X close button

- when showing emby video in living room skip intro on a button press
  - the button and action should be the same in web app and android
  - the button is a button in the tv pane remote control
    - in mark mode it is the shows button
    - in linda mode it is the apps button
    - in both modes that is the button below the right arrow button
  - skip intro action is activated when button is held down for 300ms
    - when released before 300ms it should do its normal function
  - when activated jump to the video position that is current position plus introDur

- more instructions
  - make a plan and write it to ./intro-plan.md
  - make no changes other than writing to plan
  - describe any ambiguities, contradictions, or impossibilities
  - feel free to make suggestions
