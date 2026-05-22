# intro pane behavior update

- when closing intro pane save startMark to tvdb rec
  - `closing the intro pane` includes changing the show/episode using the next button
  - only save if the user clicked at least one of: 0, startMark, endMark, clear, or none buttons during this show/episode's session
  - if introdur is zero or negative set startMark to zero
- when introdur value is copied to another record then copy startmark also
- remove endMark from tvdb rec and code that used that tvdb rec field
- remove the default of 3 and 4 mins for startmark and endmark in intro pane

- when opening intro pane follow these rules based on values of introdur and startmark from tvdb rec:
  - if no startmark and no introdur then:
    - set introDur, startmark and endmark values in intro pane to zero
    - start video playing at zero
    - this is the none condition which makes sense when nothing is set
  - if there is a startmark and no introdur then:
    - set startmark and endmark to startmark value from tvdb and set introdur to 0
    - start video playing at zero
  - if there is an introdur and no startmark then:
    - use introdur value from tvdb
    - set startmark to zero
    - if introdur is zero set endmark to zero
    - if introdur is non-zero set endmark to abs(introDur value)
    - start video playing at zero
  - if there is both an introdur and startmark then:
    - use introdur value from tvdb
    - if introdur is negative then set startmark value to zero and endmark to abs(introdur value)
    - if introdur is zero then set startmark and endmark to startmark value from tvdb
    - if introdur is positive then:
      - set startmark to startmark value from tvdb
      - set endmark to startmark value plus introdur value
    - start video playing at startmark value

- when video is playing and we need to play video at a time that is past the loaded video then:
  - enter waitingForVideo mode
  - show `Waiting for video` in 16px yellow text in the middle of the top line
    - this replaces the old time display in yellow
  - pause the video at loaded time position minus 10 secs
- When in waitingForVideo mode and the loaded video is longer than the time of the video we want to play then:
  - remove `Waiting for video` and exit waitingForVideo mode
  - start playing at the time we want to play
- if in waitingForVideo mode and any button is clicked or video time changes or video is paused or unpaused then:
  - remove `Waiting for video` msg
  - exit waitingForVideo mode and do any button action needed

- if there are any ambiguities, contradictions, or impossibilities in these instructions stop and ask me for help
- feel free to make suggestions
