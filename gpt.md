
premiered sort 

the show `Monster: The Lizzie Borden Story (2026)` is browsed but and is missing data -- check all sources of data for it -- why doesn't it have a snooze button

find shows just safe start

=================

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
