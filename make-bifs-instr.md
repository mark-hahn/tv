
# make .bif files

- i want to see tricky images while scrubbing when using intro web page
  - for this to work there has to be a .bif sidecar file for the video file playing

- create a persistant array queue `bifNeededQueue`
  - it should be persisted in apps/srvr/data/bifNeededQueue.json

- when app starts delete apps/srvr/data/bifCreatingData file

- note: rec is a show record in tvdb.json

## queue needed bif specs in bifNeededQueue
- in every run of perShowCallback after refreshEpisodeData runs
  - if needsIntro changed:
    - if needsIntro is true:
        -check these conditions:
          - there is no bif file in any episode of the show folder
            - there is no bif when getBifEpisode(rec.episodeData) returns null
              - getBifEpisode is in packages/share/src/episodeData.js
          - there is a season with an unwatched episode
          - there is a season with a video file
            - the path of the first file in the show should be saved in var `bifPath`
        - if these conditions are met:
          - create a bifNeededObj with these properties:
            - showName: rec.name
            - bifPath: bifPath
          - append the bifNeededObj to bifNeededQueue array
          - call checkBifbifNeededQueue()
    - if needsIntro is false:
      - run cancelBifCreate(rec.name)
      - if any bifNeededObj entry in bifNeededQueue has bifNeededObj.showName = rec.name:
        - remove that bifNeededObj entry from bifNeededQueue
        - call checkBifbifNeededQueue()

## get bifNeededObj from bifNeededQueue
- checkBifbifNeededQueue should do this:
  - if bifNeededQueue is empty:
    - return from checkBifbifNeededQueue
  - if cpu load is > 5:
    - call setTimeout(checkBifbifNeededQueue, 10000)
    - return from checkBifbifNeededQueue
  - call createBifFile(bifNeededQueue[0])
  - if createBifFile returns false then:
    - call setTimeout(checkBifbifNeededQueue, 5000)
    - return from checkBifbifNeededQueue
  - if createBifFile returns true then:
    - remove bifNeededQueue[0] from bifNeededQueue
    - call checkBifbifNeededQueue() on next tick

## start bif file Creation
- createBifFile(bifNeededObj) should do this:
  - if apps/srvr/data/bifCreatingData file exists return false
  - start a system process in background
    - in process run createBifFile(bifNeededObj.bifPath) from apps/srvr/src/bif.js
  - write  {showName: bifNeededObj.showName, pid: <process pid>} to apps/srvr/data/bifCreatingData
  - return true

- when process finishes delete apps/srvr/data/bifCreatingData

## cancel Bif file Creation
- cancelBifCreate(showName) should do this
  - if apps/srvr/data/bifCreatingData exists:
    - if showName == apps/srvr/data/bifCreatingData.showName:
      - abort process with apps/srvr/data/bifCreatingData.pid
      - delete apps/srvr/data/bifCreatingData

## notes
- determine what this logic is intended to do
  - a brief explanation is: 
    - it should create a new bif file when a show needs an intro
    - if intro web page is run for the show before or during bif creation the cancel creation
  - check that this logic does that correctly
  - check for possibility of this logic to hang and quit responding

- make a plan and write it to ./make-bifs-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions

