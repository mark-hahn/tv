
# replace the video pane with an emby web tab

- these instructions are not for android
- these instructions are only for emby playing in the browser that launched the emby web page

- the video pane currently used for play, chksrt, and intro has several problems:
  - sometimes it has a full-window gray overlay
  - it loads the video slowly so it has to wait to get to a video position

- i want to use the emby browser app which doesn't have these problems
  - our client can currently show an episode in emby in a separate emby browser tab
  - the current emby browser tab can be opened from several places:
    - there is an emby button in the remotes button row in info pane
      - it opens the first unwatched file
    - the map pane has an emby button that shows the first selected episode in the pane
  - the video pane currently used for play, chksrt, and intro should be removed
    - the ui functionality of those panes will now be provided by the emby web page

- the web page should have an overlay with buttons and displays provided by tampermonkey
  - the current emby web page has a tampermonkey script that provides a button 
    - the current button shows trimPos and skipDur values and does skipping
    - i want to replace that button with an overlay with buttons and displays
  - the overlay should be the full width of the window
  - it should be 60px tall
  - it should be at the very top of the window
  - it should have a 20% transparent black background
  - the entire web page ui is in the overlay
  - it should have thin logic that uses the server for the major logic
    - it should only pass button clicks to the server and get pushed text from the server to display
  
- there should be a different web page ui that matches each current video pane
  - these are the play, chksrt, and intro video panes
  - the UI choice should match the video pane that is currently opened by the calling location
  - all three ui are implemented by one tampermonkey script

- a tampermonkey script for the web page should provide all UI
  - the script should run on every emby page at https://hahnca.com:8920
  - the script will be kept in emby-ui.user.js for editing
    - it will be deployed manually by a user's copy/paste not from a script

- the server is responsible for all logic and control
  - all communication between tampermonkey script and server should use a websocket
    - there should be no other server communication like calling endpoints
    - there should be no polling, just accepting pushes
    - when the tampermonkey loads it should send a hello message 
      - this is for the server to know to set up initial logic state
      - the message should tell the server any info it needs 
        - tampermonkey gets this info from the url that loaded the page
        - this includes an id indicating which of the three ui are in use
    - the server should support multiple clients with multiple web socket connections

  - the UI should send a press message to the server on every button press
    - the message only needs a button id
    - the press message should be sent over the web socket
    - the UI should do nothing else on a button press

  - the UI should show text when the server pushes it over the websocket
    - the text is for show names, video position, dynamic button labels, etc.
    - the pushed message only needs the text message id and text string
    - the the ui should blindly display the pushed text and not generate any text of its own

  - the server should communicate with emby the same way it does currently
    - it should control the emby show playing, pause/play actions, seeks, etc.
    - it should get the playing and video position state from emby
    - it should have the logic for emby and ui control centralized where possible

- there is less logic needed for when a requested seek is past the end of the video
  - just seek to end
  - no display message is needed for this

- make a plan and write it to ./emby-page-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
