# new tv pane button layout

- divide the tv pane into a 3x5 grid
  - the cells should have 3px black (#000) borders
  - some cells have color backgrounds
  - each color should be very light
  - each cell is a button
    - the entire cell area should be clickable
    - grid cells don't have to be real html button elements
    - button icons and text should be same as current buttons
- button assignments with icon or text, x/y position (1-based) and background color:
  - return: circular arrow, 1/1, white
  - dpad up: up, 2/1, yellow
  - home: home, 3/1, white

  - dpad left: left, 1/2, yellow
  - dpad center: OK, 2/2, green
  - dpad right: right, 3/2, yellow

  - emby: E, 1/3, white
  - dpad down: down, 2/3, yellow
  - keyboard: A, 3/3, white

  - vol-: Vol-, 1/4, white
  - vol+: Vol+, 2/4, white
  - mute: Mute, 3/4, white

  - google: Google, 1/5, white
  - roku: Roku, 2/5, white
  - off: Off, 3/5, white

- button functions:
  - existing buttons should behave same as now
  - emby (E) button should just switch app to emby
  - keyboard (A) is for future use
