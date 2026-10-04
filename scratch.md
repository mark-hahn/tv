
i'm 172

????????????????????????
.opnXXXXX naming
clnup info in tvapp
back up pause based on pause length
=================

when caption is chosen before apply is pressed then clear the caption list and start showing captions in that list pane.  the captions should appear there at the time to align to voice on tv at that time -- in other words i want to be able to look at captions on the phone and listen to audio to check whether they line up -- explain in detail what you think i meant with the instructions.

# measure the subtitle timing adjustment

- current method of adjusting timing offest isn't accurate
  - i have to estimate offset by watching subs and listening to voice
  - i want to be able to measure timing by pressing a button when i hear the voice

## ui layout button and list
- in subs pane of tvapprc add:
  - add a button `Voice` that is the width of the pane and height of apply button times 1.2
    - the bottom of voice button should align to the top of the apply button
    - when voice is clicked save position of the video in tvapp
  - between the voice button and bottom of subtitle choices button put a scrolling pane
    - it should be width of pane
    - it should list subtitle text lines
      - each line should be a list of subtitle text
        - the list is captions from 3 earlier to the 3 later
      - the line should be truncated chars without `...`

## action sequence
- I will click on voice button exactly at the beginning of the caption by listening
  - you should save the video time postion when clicked into voicePos
- i will scroll the captions list and select the caption that was heard
  - from the subtitle file that is playing set the caption time in capPos
- set the offset timing display to the voicePos minus the capPos
- click to apply button to change all timings in the sub file as it already does
- i can repeat the sequence and revert the old timing by clicking on the voice button again

## implementation challenge
- the tvapprc remote will need to know the video position in the tvapp accurately in real time
- the list will need to be obtained from the subtitle file live position

## actions
- if these instructions are ambiguous, incomplete, contradictory, or you think there is a better way to do this then:
  - write the problems to tv-autoofs.md and stop
  - make no changes other than writing to tv-autoofs.md
- otherwise implement these instructions immediately

the show `The Power of Parker/Season 2/The.Power.Of.Parker.S02E01.Out.On.The.Razz.1080p.HDTV.H264-ORGANiC.mkv` shows a busy indicator forever when opened in client player -- the scrub bar says all 27.55 is loaded

# adj sub timing from web client
- when playing a video in a web browser i want to be able to adjust timing offset
  - the same as when playing in tvapp with subs pane in remote control
  - with controls ofs, apply, and +/- buttons
- the only things I can think of are: 
  - have the remote subtitles pane work on the tab pane
    - a bad idea, this would be a major change to tvapprc only working on tvapp
  - put controls over video at the middle top
    - a button to the left of skip to toggle the controls on/off
  - show controls over main window of web client app and show two web browser tabs at once
- i need suggestions on how to do this

describe the `aired within the last year` gate.  i don't know what/where it is

remove '' from all alt-copies

Loose ends found while writing this

is intro check the only user of in-app video overlay? it should not use any subtitle

we should remove our OpenSubtitles daily quota check.  just let them check the 1000

every result an OpenSubtitles

does ASR queue have it's own srt file sanitizing logic?  it should share the normal one

remove srt from tv-down scan's excluded extensions -- normal scans should not drop .srt files

can the 3 downloads be done in parallel -- time that to see if it an improvement

The play start waits for the job for at most 4 seconds now which is too short. do a one-time test now to see how long searching and finding three subtitles take to download. then set play-start waiting time to twice that.

the subtitle error check when starting playing should include having no subtitles as an error

subtitle error on play should show over any pane in the phone -- it should always be visible until dismissed

 you said `If it is a download, its search result becomes the episode's only chosen row; if it is any other type, none of the episode's rows stay chosen`. any choice from any source should be persisted. if we created new subs rows to just hold chosen would that break anything else?

right now subs table and downloaded field only exist for opensubtitles downloads.  does any code rely on downloaded field to see if a video file has any existing .srt files of any type?
status pill in footer should show light-green background when lower-case w is showing

subtitles with hearing_impaired set should not be skipped in nextCandidate()

# new subtitle logic
- the current subtitle processing is too complicated
  - replace most of the logic

## subtitle types
- subtitle types will be referenced in these instructions by one-letter codes
- these are the one-letter codes:
  - *	PGS (image-based embedded)
  - H	SDH (embedded, flagged as describing music and sound)
  - T	embedded text track
  - F	forced (embedded)
  - +	ASR-generated .asr.srt
  - V <TAG>	.opn<TAG>.srt, where the tag is 5 chars
  - S	any other .srt (sideloaded)

## what to remove
- remove all chksrt code, this includes, but is not limited to:
  - the chksrt video pane
  - the chksrt queue
  - code to delete srt files
  - chksrt comments
  - etc.
- remove all subtitle processing in tvdb update
- remove all opensubtitles file processing
  - except when downloading before playing video (see below)

## what to keep
- keep asr queue and processing
- keep asr button in local pane
- keep legacy subtitle sidecar files in disk
- keep subtitle pane in tvapprc in remote

## search result values to store
- a record subSearchInfo is defined for every opensubtitles search result file
- these are fields of subSearchInfo, most are from data[].attributes:
  - subtitle_id, not from attributes
  - episode, not from attributes
  - chosen, not from attributes defaults to false
  - hearing_impaired
  - hd
  - foreign_parts_only
  - ai_translated
  - machine_translated
  - fps
  - uploader.uploader_id
  - upload_date
  - release
  - comments
  - feature_details.title
- keep a list subSearchResults containing subSearchInfo for every sub file ever returned from a search
  
## when to download a subtitle file
- keep a list subsDownloaded containing subSearchInfo for every sub file downloadeded
- before a video starts playing then needed subtitles are downloaded
  - a subtitle is needed when there are less that 3 entries in subsDownloaded for the episode
- keep downloading until no subtitles are needed or none are left to choose

## choosing files from opensubtitles search to download for an episode
- when a video stops playing for any reason set chosen field of a subsDownloaded entry to true
  - this is the subsDownloaded entry for the subtitle file that was showing
    - it is assumed the last subtitle file playing was chosen as best
- when a subtitle is needed for downloading then choose a file from subSearchResults based on this logic:
  - the entry in subSearchResults isn't the same file as one already downloaded in subsDownloaded
  - choose the first entry in subSearchResults that matches the origin of any file in subsChosen
    - see logic for when two subtitles are from the same origin earlier in this conversation
  - if none are same-origin then chose the first that doesn't have one of these:
    - hearing_impaired true
    - or foreign_parts_only true
  - if there are still none then none are chosen to be downloaded

## subtitle file processing when video or S subtitle file is added to disk
- extract embedded subtitle types T and H
  - do not extract * or F
  - write sanitized subtitle text to sidecar files
    - use file suffixes .T<N>.srt or .H<N>.srt
      - N should be index in file
- rename S file to .S<N>.srt
  - N is max N in .S<N>.srt sidecar files already in disk plus one
- search for episode in opensubtitles.com
  - do not get link from /download
  - do not download any subtitle files
- put file in asr generate queue when both of these are true:
  - there are no embedded subtitle types T or H
  - opensubtitles.com search found no subtitle to download based on choosing rules above

## actions
- if these instructions are ambiguous, incomplete, contradictory, or you think there is a better way to do this then:
  - write the problems to claude2-sublogic.md and stop
  - make no changes other than writing to claude2-sublogic.md
- otherwise implement these instructions immediately

# live subtitle timing adjustment
- keep a var subOfs:
  - it is the timing offset of the currently playing subtitle in seconds
  - it is reset to 0 when a video starts playing or a subtitle selection changes
  - it can only be changed by +/- buttons (see below)
- a var oldSubOfs keeps the last value of subOfs before any change
  - it is also reset to 0 when a video starts playing or a subtitle selection changes
- add these three rows above the close button in the subtitle screen in tvapprc:
  - a row with subOfs display and an `Apply` button
    - the subOfs display shows seconds as toFixed(1)
    - the apply button adjusts timing in the currently showing subtitle file
      - if the current subtitles are embedded then the apply button is disabled
      - if subOfs == oldSubOfs then the apply button is disabled
      - when pressed the playing subtitle file has all timings adjusted and rewritten in-place
        - first the file timing is adjusted by (subOfs - oldSubOfs)
          - this keeps subOfs matching the total amount the file timing has changed since reset
      - then oldSubOfs is set to subOfs
      - then the video is reloaded to use new timing
  - a row with 2 buttons, both labelled `+`
    - the left button increments subOfs by 1 sec
    - the right button increments subOfs by 0.5 sec
  - a row with 2 buttons, both labelled `-`
    - the left button decrements subOfs by 1 sec
    - the right button decrements subOfs by 0.5 sec
- if these instructions are ambiguous, incomplete, contradictory, or you think there is a better way to do this then:
  - write the problems to claude2-subofs-problems.md and stop
  - make no changes other than writing to claude2-subofs-problems.md
- otherwise implement these instructions immediately

# play in web browser parity with tvapp
- i want the full features of tvapp when playing in web browser with play button
  - intro trim and skip 
    - tampermonkey?
  - persist play position for episodes
  - subtitles with live selection
  - mark partial and watched

several shows including `The New Adventures of Old Christine` and `The Knights of Prosperity`have files deleted and i don't remember deleting them

pressing up-arrow during playback should quit playing and then mark the episode watched and then set stored pos to 0 for the next episode to use. long-press up arrow during playback should jump back to beginning or trim pos

tv video is darkened when time bar is showing at the button -- can you keep the full screen normal brightness?

you said `Fthe android phone remote app has an icon with the android robot with antennas in a circle and the tv home page has an icon for tvapp that is a home in a circle.  i want a standard icon for this app to use in those places and everywhere an icon is needed. the favicon for the web app already has a tv which is ok but a bit generic.

suggest icons for this app. it could be as simple as a tv but something that shows it is a app for tv shows in our home would be nice.

ar-off premieres: a wait more than a year away returns "", which is the same as "ready now"`.
i am worried about Far-off premieres being considered ready -- does that mean they will show up in the browse pane?  if so that is unacceptable and they shouldn't be considered for browsing while in that state.

no.
- when a show is snoozed then calculate a waitstr and save it with the show. 
- recalculate waitstr for all snoozed shows when the browse pane is opened but never more often than 24 hrs. 
- when a snoozed show transitions from having a waitstr to not having one then automatically unsnooze it -- if it doesn't have a waitstr then don't auto-check for the transistion. i will unooze them manually.
- when a show doesn't have enough data to calculate a waitstr then consider it to have a waitstr.
- when looking at snoozed shows in the gallery and one is selected and it has a waitstr then show the waitstr text between the get button and where the "no more shows" message is shown
- as a one-time operation backfill snoozed shows with waitstr.

why are you scoping Actor Photos per show? the actor's name is authoritative and we should treat all the same no matter what show they are in or any other metadata

- these 2 downloads are only 30 secs apart:
`American.Hostage.S01E03.Magic.Ticket.Sweepstakes.1080p.AMZN.WEB-DL.DDP5.1.H.264-RAWR.mkv
1/3 - 1080p  09/26.22:15:20  3.456 GB  92 Mb  100%  4:38  Finished` and
`American Hostage S01E03 Magic Ticket Sweepstakes 2160p AMZN WEB-DL DDP5 1 H 265-RAWR.mkv
1/3 - 2160p  09/26.22:45:22  5.792 GB  86 Mb  100%  8:10  Finished`
  so they must have come from the same list of usb files. 
- on flex when 2 files of same episode appear in one list only the best is used
  - the down cycle should also only use the best of matching episodes

when viewing a video that was started by tvapp, and then finished playing, if the pos was less than 4 mins from end mark the show as watched

# one consistent image choice logic
for all images use these providers in order:
  - fanart
  - tvdb
  - tmdb
  - tvmaze
- always include score when choosing from a list
- use searches by name only after trying every possibilty with id
- refactor where possible to share logic
- cache everything since app loaded
- if any code needs some id that isn't easy to get when needed let me know

in tvapp the tv show `The Knights of Prosperity` has a thumb image different than what it had before removing emby -- it is not as good -- find all possible sources of images for the show and show all the images to me with where you got each from

1190797
error: tvdb no results: fname: BEEF.S01E03.I.Am.Inhabited.by.a.Cry.2160p.NF.WEB-DL.DDP5.1.Atmos.H.265-FLUX.mkv | url: https://api4.thetvdb.com/v4/search?type=series&q=BEEF

# torrents history feature
- keep a history of torrents the tor pane sent to the qbt
  - also store in that history the date/time the torrent was sent
  - is there already a history stored for showing the clock icon in the card?
    - if so that history could be just updated to implement this new history feature

- add a `History` button the the left of the del button
  - the button should set the tor pane into history mode and be a toggle
  - it should filter the list of cards to show only ones sent
  - the shown list should be sorted by date/time ascending when the torrent was sent. 
  - when entering the history mode the pane should be scrolled to the bottom 
  - the background of the button should be hilighted with light-red when in history mode

- in all modes the cards for sent torrents should show the date/time sent with the clock icons

- as a one-time operation backfill history based on logs if that is possible.


this type of event 1188520 has been repeating recently

does a compaction cost money

# clearing top filter in tvapp
- when in tvapp and the show list is filtered by search string or actor name 
  - and string or name is showing at top of list
  - and there is no mode selected like sort, filter, or info
  - then a back-arrow key should clear the string or name filter
    - and not go back to tv home

the tv video text bar year display should show one year with no hyphen when start and end years are the same

# play video in browser for entertainment
- in the info and map panes put a button `Play` to the left of the tv button. 
- when Play is clicked show the video in a video pane like chksrt uses. 
  - In the info pane it should show the first unwatched episode 
  - in the map pane it should show the selected episode. 
- the video should have no overlay except when there is an introdur for the show. 
  - then show a small button in the upper right labeled `Skip` in an overlay. 
  - the skip button should jump ahead by introdur amount. 
- if there is an intropos then automatically jump to that position when the video starts playing at 0
                                                                                                                        # new time bar order
- change order to:
  - `<show name>`
  - `<country like USA>`
  - `<episode air date>`
  - `<S01E01>/<episodes in season>`
  - `<N> Seasons`
  - `Watched <epis> of <total epis>`
  - `<status like continuing, Ended, etc.>`
  - `<resolution>`

# new time bar text
- i want a lot of info shown in the time bar text
all items should be separated by the current margin used
- after the timing the text should contain:
  - `<show name>`
  - `<S01E01>/<episodes in season>`
  - `<N> Seasons`
  - `<status like continuing, Ended, etc.>`
  - `<resolution>`
  - `<episode air date>`
  - `Watched <epis> of <total epis>`
  - `<country like USA>`
- if they all don't fit then remove these in this order until the text fits:
  - `Watched <epis> of <total epis>`
  - `<N> Seasons`
  - `<status like continuing, Ended, etc.>`
  - `<episode air date>`
  - `<country like USA>`

when playing video on the tv and the playing is paused there is an overlay, see the image. The center of the screen has some useless play control icons and the bottom right has a settings gear icon which i can't figure out how to press.  i think this is all just a display and not controls.  can we change what that overlay shows?

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
