# don't log redundant `down blocked` events 
- there are many `down blocked` events that are logged multiple times
  - e.g. when scanning usb files for download the same files will be blocked every down cycle
  - they are real events but they don't need to be added to log_events when they are redundant
  - the group name `down blocked` does not refer exclusively to the down server processing
    - it refers to all processing flow from tor or flex to qbt to down 
    - the word down in the name is a coincidence

- in order to detect these redundant events the event records must have enough information
  - e.g. usb files for download must have their file name stored in the event record
  - every log site call that has a `down blocked` group should have the info
    - check all source files for the sites
    - you should process hidden sites the same as non-hidden 
  - you will need to figure out what info is needed for each log site
    - i think maybe only torrent titles and usb file names are needed
      - check this assumption
  - there is no field in event record available specifically for this info
    - we should embed the info in the message field
    - it should be something like this example:
      - `previous error in tvJson for "Call.Me.Fitz.S01E09.1080p.AMZN.WEB-DL.DDP5.1.H.264-GPRS.mkv"` 
      - the needed info is the usb file name at the end

- the dupe detection logic should compare log_id and message in each event
  - events should not be considered as dupes if their timestamps are further apart than 1 hr 
  - dupe events should be filtered in the server before sending to the client
    - the server should keep a cache of events that matches events in the db
      - events in cache older than an approximate hour should be pruned
    - when an event arrives at the centralized processing routine from a remote unilog call that routine should:
      - look at all events in the cache for a match
        - since cache only keeps events less than an hour old the timing requirement is automatic
      - ignore the matched dupes

- as you scan the sites remove from the source code extra unilog calls in the same path 
  - keep the call with highest log_id
  - we are doing this in this scan because it is convenient

- make a plan and write it to ./block-dupes-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
