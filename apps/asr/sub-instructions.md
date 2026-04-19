
# simplification and consolidation of subtitle processing
- keep log file /root/dev/apps/tv/apps/asr/data/subtitle.log
  - at 5 am rotate log file to /root/dev/apps/tv/apps/asr/data/subtitle-logs/ and start empty log file

- there are 3 queues of video files
  - 1st is subQueue that queues up video files that need overall srt processing
  - 2nd is subQueueChkSrt which contains video files waiting for human video checks
  - 3rd is subQueueGenSrt which contains video files waiting for ai subtitle generation 
- every queue entry has videofile path and fromUI flag

- write function fileNeedsSubChecked(videoFilePath, showName) 
  - populate showName from videoFilePath top folder name if missing
  - returns true if all these conditions are true
    - check each condition in order and return false immediately if condition not met
    - file is not already in a queue (subQueue, subQueueChkSrt, subQueueGenSrt)
    - file does not have a sidecar file with sfx of `.enx.srt`, `.enx.srtstub`, `.en<n>.srt` 
    - file episode is not watched or unaired
      - use series map
        - showname/season/episode information is determined by parseFileSeasonEpisode

- function generateEmbSrts(videoFilePath, showname, season, episode, fromUI) 
  - populate showname, season, and episode from videoFilePath if missing
    - use parseFileSeasonEpisode
  - it should create base.en<idx>.srt sidecar file for every embedded subtitle stream
    - stream must be english
    - stream must be text
    - stream should have formatting info removed as it does now
    - don't overwrite any existing srt file
    - each file created should be logged to subtitle.log
  - if fromUI then also log to emb pane in local pane

- function applyOpenSubSrts(videoFilePath, showname, season, episode) 
  - populate showname, season, and episode from videoFilePath if missing
    - use parseFileSeasonEpisode
  - find all english opensubtitles.com srt files for episode
    - make api calls async await
    - iterate through srt files found for each episode from opensubtitles
    - create bas.#<id>.srt sidecar file from each srt file downloaded from opensubtitles.com
      - don't overwrite any existing srt file
    - each file created should be logged to subtitle.log

- function generateSrtWithAsr(videoFilePath, fromUI) 
  - it should start creating base.enx.srt sidecar file using mistral asr
    - don't overwrite any existing srt file
      - if srt file already exists log that to subtitle.log
      - if srt file already exists then finished
    - use existing asr generation code to make srt file
  - if fromUI then send generation logging to asr pane in local pane
    - should be same as existing logging
  - set genSrtRunning to true when started
  - when started log start to subtitle.log
  - clear genSrtRunning flag when finished

- most existing subtitle processing code is replaced
  - new code often uses some old code
  - don't remove any ui
  - buttons in local pane header:
    - asr button action is specified below
    - emb button should call generateEmbSrts with fromui true
      - run generateEmbSrts on every file selected in local pane file list
    - subs button should add files to top of subQueue with fromUI true
      - call doSubQueueNow() 

- there are three sources that add video files to queues

  - asr button in local pane adds files to top of subQueueGenSrt
    - adding at top gives them priority
    - queue every file selected in local pane file list
    - entries added to subQueueGenSrt should have fromUI flag set in queue entry
    - call doSubQueueGenSrtNow() after entries added

  - tvdb update background task should check if subtitles are needed for show before step 3
    - only check if tvdb.inEmby is true
    - show folder contents should be scanned for all video files 
      - if fileNeedsSubChecked(videoFilePath, showname) is true then
        - add file to end of subQueue with fromUI false
        - adding at end gives file low priority
      
  - if chokidar shows video file is added
    - showname is derived from filepath top folder
    - look up tvdb record with showname
    - if any condition is not met then finished
      - tvdb record must exist and tvdb.inEmby must be true
      - fileNeedsSubChecked(videoFilePath, showname) must be true
    - if all conditions are met post file to top of subQueue with fromui false
      - adding at top gives it priority
      - call doSubQueueNow()

- background task should process subQueue entries
  - when app starts set chkSubQueueDelay to 10_000
  - when app starts set subQueueBusy to false
  - check for next file in subQueue
    - if subQueue is empty
      - set chkSubQueueDelay to 10_000
    - if subQueue is not empty process top entry in subQueue
      - taking from top runs priority files first
      - set subQueueBusy to true
      - run generateEmbSrts on file synchronously
        - then delay 1 sec to give time for other processing to run
      - run applyOpenSubSrts on file synchronously
        - then delay 1 sec to give time for other processing to run
      - check if file has a sidecar file with sfx of `.enx.srt`, `.enx.srtstub`, `.en<n>.srt` 
        - if it does not have a sidecar file 
          - move file to top of subQueueGenSrt with fromui false
          - call doSubQueueGenSrtNow()
        - if it does have a sidecar file move file to subQueueChkSrt with fromui false
      - set subQueueBusy to false
      - set chkSubQueueDelay to 500
  - run next check in chkSubQueueDelay ms

  - when doSubQueueNow() function called
    - set chkSubQueueDelay to 500
    - if subQueueBusy is false do check immediately
    - if subQueueBusy is true 
      - poll every 1 sec until subQueueBusy is false
        - then do next check

- monitor subQueueChkSrt and when it isn't empty show Chksrt <subQueueChkSrt length> button in tab select row
  - when Chksrt button is pressed show chksrt video pane for human to approve
    - use top file in subQueueChkSrt
    - chksrt video pane should be identical to current implementation except:
      - bad button label should be GenSrt
      - GenSrt button should 
        - move file from subQueueChkSrt to subQueueGenSrt with fromui false
        - call doSubQueueGenSrtNow()

- background task should check and process subQueueGenSrt entries
  - when app starts set chkGenSrtDelay to 10_000
  - check to start generateSrtWithAsr
    - do not start when genSrtRunning is true
    - do not start when chkGenSrtDelay is 10_000 and cpu load average is > 2
    - if ok to start and subQueueGenSrt is not empty
      - start generateSrtWithAsr on top subQueueGenSrt entry
      - set chkGenSrtDelay to 500
  - if subQueueGenSrt is empty set chkGenSrtDelay to 10_000
  - check again in chkGenSrtDelay ms

  - when doSubQueueGenSrtNow() function is called 
    - set chkGenSrtDelay to 500
    - check immediately

- make a plan to implement these instructions
  - write plan to /root/apps/tv/apps/asr/sub-plan.md
  - list code sections that will be dead after plan implemented
  - list any functionality that is in existing codebase that is not in plan
  - give opinion about plan with suggestions to improve it

- ask about any ambiguous, incomplete, or impossible instructions
- make no changes, just planning for now

# new instructions
- At the end of generateEmbSrts() if the video file has any embedded subtitles that were not extracted into base.en<idx>.srt files, like bitmapped subtitles, then add the sidecar file base.enx.srtstub

- In chksrt video pane when a subtitle button is ctrl-clicked then delete all sidecar files except the one clicked, remove the video file from subQueueChkSrt, and move on to next subQueueChkSrt entry

- all queues should be persistant

# instructions for Codebase Not In Plan

1. Chksrt "Ok" button: the OK button should remove the video file from subQueueChkSrt and do nothing else but move on to next subQueueChkSrt entry.

2.remove srtExists guard from processOneVideo -- generateSrtWithAsr should call processOneVideo in appropriate place -- processOneVideo should be located in place with simplest and safest change

3. ASR is not delayed indefinitely since doSubQueueGenSrtNow can interrupt delay -- but we only want delay on high priority files -- add lowPriority var to subQueueGenSrt entry and set it for entries added by tvdb update background task -- when lowPriority entry is considered for processing and cpu load is > 2 then set chkSubQueueDelay to 10_000 and put off processing it until next loop

4. remove all logging to tv.log and asr-bkgnd.log

5. remove CLI script for processOneVideo -- do not run anything in parallel -- all is sync

6. remove browser Notification for fetchChksrtCount

7. keep  60-second startChksrtPolling

8. keep tvdb.enqueueShowProcess(showName) -- it is separate from adding to subQueue

# response to Opinions and Suggestions

- Implement all suggestions except except this one

5. replace # naming with `base.en<id>.srt` everywhere -- `base.en<id>.srt` should be differentiated from `base.en<d>.srt` by length of `en<id>` == 7

# answers to Questions / Ambiguities

Q1: srvr should call asr.js as a child process -- retire pm2 process

Q2: place it inside `perShowCallback` in srvr/index.js where it already has the updated record.

Q3: OK should just pop entry in subQueueChkSrt -- see earlier instruction

Q4: use your suggested solution 4

Q5: processOneVideo should have its guard removed when called from generateSrtWithAsr -- it is not called from any cli

Q6: subQueueChkSrt` should be in-memory and persisted with a file as all queues are

Q7: persist all queues

Q8: remove cli script for asr processing -- retire pm2 process
