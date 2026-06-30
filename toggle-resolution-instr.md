
# switch video playing to a different resolution

- 2160 videos often have problems with emby playback
  - wifi is too slow
- i want to have both 1080 and 2160 versions of same episode video
  - the 2160 video file must be available
  - when i can't play 2160 videos i want to fall back to playing 1080

## the desired setup
- we want a 1080 file
- it is the same show and episode as an existing 2160 video file
- it has the suffix .alt
  - this indicates it is an alternate file to view
- the subtitles for both files are the same
  - there are 2 copies of each subtitle for the episode 
    - they have identical contents
    - they have identical file suffixes
    - one has a basename of the 2160 and the other has the 1080 basename 

## keeping or generating 1080 videos
- these are the conditions where we need a 1080 resolution video:
  - a 2160 video file for the same episode exists
  - the show is in emby
  - the episode has not been watched
  - no 1080 video already exists for the same episode
  - a 1080 video for the same episode is not in process of being downloaded

- these are the possible ways we can get the needed 1080 can file:
  1. a 1080 file was downloaded before
    - it was replaced by a 2160 file and was kept with a .old suffix
      - then we just rename the file by replacing the `.old` suffix with `.alt`
    - this is the preferred method
  2. we generate a new 1080 file by re-encoding the 2160 file
    - after a 2160 file has finished downloading
    - we use ffmpeg to re-encode to 1080
      - the encoding choice is the best for emby playback on all devices
        - is that hvec?
      - the new file has a bitrate <= 10 mbits/sec
      - if 2160 file is 10-bit we keep that in new file
      - all tracks other than video are unchanged
    - the new file will almost have the same filename as the 2160
      - we only replace the `2160` substring with `1080`

- we keep all subtitle files for the episode
  - we copy all of them and rename copies to match the 1080 file basename

## we rename or re-encode the file in these situations:
- a 2160 file has just finished downloading and chokidar finds it
  - and it meets the conditions to add 1080 file
- a show is being processed in the tvdb background task
  - after the show is finished processing:
    - we scan all video files in the show folder to find any that matches the conditions
    - for each episode that matches the condition we process it
- if we are in one of the situations:
  - if files just need suffix swapped we do that imediately
  - if re-encoding is needed we put it in a queue of 2180 video file paths
    - a background process uses ffmpeg 
      - it takes paths from the queue to re-encode

## ui changes in local pane to do the toggle
- in the local pane make these button changes:
  - move the Errs button in the first row of the header to the second row 
    - put it to the left of the Info button
  - add a button `Res` to the top row
    - put it between fix and move, where the errs button was
- enable the Res button when:
  - there are 2 files that meets the condition
    - one file of the 2 files is selected in the local pane file list
    - there are no other files selected
- when the res button is clicked switch the .alt suffix between the files
  - this will trigger a library refresh 
  - then the emby player can play the different resolution
- the button is a toggle for the resolution to be viewed

## ui changes in android remote control to do the toggle
- toggle the resolution when there is this condition
  - a video is currently playing
    - the video has a matching episode meeting the condition
  - the up key is held down with a long press
- when the button is long-pressed do these:
  - send the home key to tv to exit emby
  - then load the other resolution video in emby
    - just like the tv button does in the web client map pane
  - now the other resolution video is ready to play

## notes
- make a plan and write it to ./toggle-resolution-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
