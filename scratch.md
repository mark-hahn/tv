


don't browse `In Development`
                                                                                                                              
????????????????
manage upcoming shows
=================

when keys are pressed on two phone remotes at about the same time this is a collision. there is no collision warning if the keys on the 2 remotes are the same key.  right now both keypresses are sent so there are 2 actions.  only 1 key should be sent on this kind of same key collision.

add confirmation to prune

i played the show `The Knights of Prosperity` s01e03 from tvapp.  the stored position was 0 and the show started at 0 but the show was marked as a partial in map pane immediately when playing started. i left it marked as partial

the show `Nightingales (1990)` has what looks like the wrong thumb image in tvapp

when in tvapprc mode:
- replace the top shows button with the hide button
- replace the hide button with the skip button
  - this should do what the skip button did in the regular mode before

when not in tvapprc mode:
- in 3rd row left side add a button `Emby`
  - it should launch the emby app
- in 3rd row right side add a button `Input`
  - it should press the sony input key

when tvapp is showing and the show is selected and not in info, sort, filter mode then the back key should leave tvapp and go to tv home

in the phone episode subpane in the map pane the progress bar works but it has 0 on the left side and the right side

Add a new show from the web client. It should show up in the library immediately, with no "Waiting for Emby scan".
Ctrl-click "Not In Emby" in the map on a show outside the library. It should create the folder and join the library.
Delete a show. It should drop out of the library within seconds.
In the map, delete an episode file or run Prune. The map should refresh.
Toggle watched in the map, including on a show added in step 1.
Use the map's clear-position button on an episode with a resume point.
Hide/Unhide from the info pane and from the tvapp hide key. The show should move in the Watched sort.
The collection toggles should still stick.
The Emby app on the TV should still pick up new shows by itself.

when i tried to delete the show `Hullraisers` when in info pane i got this: `Do you really want to remove Hullraisers from emby and the disk?` -- it shouldn't metion emby, it should just mention disk.  when i clicked ok it gave me this: `Cannot remove "Hullraisers" from Emby: Emby HTTP 500: Object reference not set to an instance of an object.`.

when i showed the subtitle pane in phone for `'A Man on the Inside/Season 2/A.Man.on.the.Inside.S02E01.Orientation.2160p.NF.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv'` it listed subtitles starting with `T:` and none with `S:`, even though it has the sidecar `'A Man on the Inside/Season 2/A.Man.on.the.Inside.S02E01.Orientation.1080p.NF.WEB-DL.DDP5.1.H.264-STC.mb4.srt'`.
also it listed all languages even though it is only supposed to list english.

Web: toggle To Try, Continue, Mark and Linda.
Web: toggle watched on a map episode, and run map Prune.
Web: check the season/episode counts in the info pane. They're now counted from the show record.
Web: the list's TV button, and the map's TV button with an episode selected.
Phone (Metro): the show pane's TV button with an episode selected, the empty cells, and the streamers list.
tvapp: card images, Back at the top, and playing from the map.
Deleting a show: I could only test the error path, so the real Emby delete call is unproven.
Vol+ hold during a video with several subtitle tracks.
A video whose subtitle is a sidecar .srt; it shows as "S: External".

when in browse pane and we switch to preview mode the info pane is opened and data is correct but a stale image shows briefly -- clear stale image

instead of limiting to 10 shows show all that have been 

- when in browse pane show a button `Upcoming` at the right of the bottom remote keys
- when clicked it should switch to upcoming mode
  - in upcoming mode the gallery should show upcoming shows only
  - they should be showing with the earliest at the top
  - show a max of 10 shows in gallery
  - clicking in the gallery should do the same thing as in normal mode and when showing snoozed shows
- when browse button is clicked it should go back to normal mode

fix the YouTube/VLC launch
in tor tor pane when a torrent card has isClicked set then a checkmark is shown.  And when it has isDownloadedBefore  it shows a clock.  those icons are shown because the card torrent title matches some title in list.  when that matching is done there may be more than one card with the same title so multiple cards are marked instead of just the one.  the matching needs to be more specific.  is there a torrent hash that can be used to match instead of just the title? if not, then maybe the file size could me included in the stored info for matching?

when in chksrt video and the timing adjustment slider is not at 0 and the save button is clicked then bring up a confirmation dialog `A timing adjustment has not been applied. Are you sure you want to leave?` with ok and cancel.

chksrt jump to prev/next title

in the chksrt video pane move the scrub controls to middle of the top row 

in trailers pane put a link underneath each trailer to view it on the web

sometimes when clicking ok on a selected show in tvapp it correctly shows the emby ui for ~2s and then the video correctly starts playing but elements of the emby ui are still visible overlaying the video -- using shows button to go back and start over fixes it -- this seems to happen the most when using it the first time in the evening since the day before -- i took a picture of the screen -- it is at "C:\Users\mark\Downloads\PXL_20260921_044949928.MP.jpg"

make a note that when preparing to build/install an apk you shouldn't assume what phone is on the usb cable. Phones are usually swapped.

i want the stored resolutions for each file to be the actual ffprobe resolution.  

in tor pane remove ctrl-click on pane action so old ctrl-click for selection action is restored

in prev/next history in hdrbot when adding a show remove dupes

the show `Line of Duty` has no intro trimPos, skipDur, or none but it isn't showing in the list when filter is set to `No Intro`

in the map pane when the show has `none` for the intro show `none` where the trimPos and skipDur are shown

add navigation jump buttons 0, <<, <, -, >, and >> like thos in intro pane to left of slider in the second row

- the play button in the map pane shows the selected episode in the video pane which allows you to select a subtitle file for that episode and adjust the timing of every title -- remove that button and video mode and move the timing adjustment feature into the chksrt video pane 
- in chksrt video pane add a second header row below the current one -- when a subtitle file is selected, not an embedded subtitle, then show the timing adjustment slider and apply button in that second row -- when there is no slider keep that row but just show nothing in it -- this will keep the actual video frame from jumping up and down when files are selected

when intro strip pane is opened and no stills have been generated then show stills in pane live as they are available

when filter selection `No Intro` is selected in selector in hdrbot then shows with intro set to `none` should not be shown

put file  name in intro strip pane header, far left

- add a header row to the top of the stills pane 
  - this is the pane that overlays the intro pane
- add a `Close` button on right side of the row that closes the pane 
  - it should not do anything else like setting the video
  - if the video has to be set then set it to pos 0
- to the left of the close button add a drop-down selector labeled `Offset:`
  - it should have 0 to 4 as the choices
    - default is 0
  - when the selection changes:
    - do another scan to create stills 
      - the timing of each still should be offset by the selected value of 0 to 4 secs
    - the stills should be added to the stored collection of stills
      - so the total number of stored stills could be as big as 20 mins * 60 secs
    - the stills pane should always only show the stills with matching offset


you said "Updated the hard rule in /root/.claude/CLAUDE.md. It now says to ignore editor-selection metadata pointing at scratch.md, never infer where prompt text came from, and always treat text you type or paste into the prompt as your instruction. Only content that arrives outside the prompt is data."
-- will this stop you from including instructions from other files?  
-- i meant this rule should apply to only any file named scratch.md

add a filter called `No Intro` to drop-down filter selector in hdrbot -- it should filter out shows that have intro data like trim or skip set and only list shows with intro none set -- all other filters should be cleared like the all button in hdrbot does

when tvapp has a selected show that is hidden change the hide button label in all remotes to `Unhide` -- this is the same behaviour the hide button in the info pane

restore the remote controls to their state before these changes: put back the Emby key, its streamers hold, and the Hide key.  restore any logic they use. then do the old door button action when the shows button in row 2 in tvapprc mode is long-pressed -- so the remote still has a way to trigger every action it has now

- i don't care about what displays in emby
  - remove code that reads/writes episode-level DateCreated
    - remove the show button
    - this means the newly added list in emby will not change by our actions
  - the currently watching row in emby will still be updated since we update viewed date

premiered sort 

safe start change -> watched

the show `Monster: The Lizzie Borden Story (2026)` is browsed but and is missing data -- check all sources of data for it -- why doesn't it have a snooze button

replace the emby and sel buttons on the remote with `Door` -- do this in tvapprc mode and normal mode -- do it on the phone and in the web page remote -- it should toggle showing the door video on the tv just as ctrl-clicking does on /ring page 

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
