
replace the emby and sel buttons on the remote with `Door` -- do this in tvapprc mode and normal mode -- do it on the phone and in the web page remote -- it should toggle showing the door video on the tv just as ctrl-clicking does on /ring page 

premiered sort 

the show `Monster: The Lizzie Borden Story (2026)` is browsed but and is missing data -- check all sources of data for it -- why doesn't it have a snooze button

find shows just safe start

=================

i need a feature that requires two projects to call each other. each project needs to understand how the other works.
how do i get llm conversations in different projects to talk to each other.

One of the 2 projects is this /root/apps/tv wsl project. The other is /root/dev/apps/hvac2 on hahnca.com server.

the tv project should accept a command to show a video stream on the tv.  The hvac2 project should issue the command and provide the video stream from the ring doorbell camera.

The ui for hvac2 has not been designed yet. The architecture in the tv has not been designed yet.

- in the actors pane remove the count button 
- call the number of shows an actor is in actorCount
  - the count button in the actors pane used to show actors by actorCount
- when actors button in hdrtop is clicked sort actors by actorCount 
  - show actorCount in the info field at the left of each show row

# intro search
- currently i have to open the intro video pane and scrub to find the skip region
  - this is hard to do without passing over the skip region
- i want to show a series of stills like a film strip so i can quickly scan them
- when producing the mp4 mirror files also strip some keyframes as stills
  - strip them so the stills have the minimum spacing but at least 10 secs apart
- add a button `Strip` to the intro video header to the left of the none button
  - when clicked open up a filmStrip pane that covers the entire window
    - show the images wrapped in the window
    - use infinite scroll
    - each image should be 100px wide with normal aspect ratio
    - when an image is clicked:
      - close the filmStrip pane
      - queue the video in the intro video pane to that frame
      - pause the video

as a test prepare stills from a `Kiss Me Kate` and `Peacemaker` s01e01 episode

when in tvapp and the info key is used to show a map and an episode is selected in the map then the hide key should toggle the watched state for that episode and update the map immediately
