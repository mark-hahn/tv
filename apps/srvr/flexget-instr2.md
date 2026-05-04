## major updates to flexget processing instructions

# run flexget on local server
- usb server flexget will be idled
- install flexget on local hahnca.com server
- exec flexget directly from srvr
  - do not run in daemon mode
  - execute every 15 mins
  - suggestion: exec('flexget execute --tasks fetch-feeds --dump', `<func>`)
  - get results directly from flexget stdout
    - parse plain text --dump format
    - no flexget-data.json file is needed
- no action needed after updating config.yml

## decide incrementally
- rename pending-flexget.json to flexget-history.json
- check each candidate as they are received from flexget
  - no 24 hr delay
  - no added timestamp is needed
- multiple files may be sent to qbt for same episode
  - sent whenever better file is found
- add `sent` timestamp field to candidate
  - set when candidate is sent to qbt
  - null for candidates not sent
- first candidate for episode is always sent to qbt with no checking
  - all info is saved in flexget-history.json as usual
- new candidates for episode may be sent based on decision logic
  - new candidate is compared to candidate most recently sent
  - if candidate is worse that previous then don't send
    - set sent field to null
  - if candidate is better that previous then send it to qbt
  - always save info in flexget-history.json

## handling multiple files downstream
- qbt might be downloading multiple files for same episode
- allow all files to finish downloading
- worse files may finish after better ones
  - we need to ignore the worse files
  - down srvr should look up every file from qbt in flexget-history.json
    - if found and it is not the most recent sent then ignore file
      - log as usual for skipped files

## rename existing video episode files
- a new video file may be downloaded for same episode as existing file
- when this happens rename old video file by adding `.old` suffix
  - leave sidecar files unchanged
- this processing is part of down server logic
- this is independent of flexget operation

## change to one-time test
- i won't manually examine final config-test/config.yml
- execute flexget on final config.yml as the confirmation

## changes to web client
- flex tab pane is redesigned
- pane will list files sent to qbt
  - data will come from flexget-history.json
  - each file sent will be one line in list
  - sort list by sent timestamp
- line should be `yyy/mm/dd hh:mm:ss S01E01 <show name> <idx>`
  - `<idx>` indicates order of files sent for single episode
    - for first sent `<idx>` should be blank
    - for others it should indicate order sent as in `(position number)` 
      - first duplicate episode will be (2), then (3), etc.
- clicking on line should bring up a dialog with all information stored for candidate

## instructions
- plan was moved to apps/srvr/flexget-plan.md
- update the plan
- make no changes other than writing to plan
- notify me of any incompleteness, contradictions, ambiguity, or impossible actions
- feel free to make suggestions

