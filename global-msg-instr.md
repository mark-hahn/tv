
# display global messages

## display row
- add message display with div id `hdrMsg` above hdrTop in list.vue 
  - it should be the full width of list.vue 
  - it will show only a row of text

## message object
- each message is stored in a message obj with these keys
    - id: a short text str that identifies the message
      - only one message can be shown with the same id
    - action: "show" or "hide"
      - the default is show
      - show adds message object text to hdrMsg and hide removes it
      - hide only needs to include id key
      - show adds the message object to a list of objects to be shown
        - it replaces any existing message object with same id
        - message objects should be stored in a map with id as key
      - hide deletes the message object from list
    - text: the text to show
      - text has no default
    - position: an integer indicating which position in hdrMsg the message is displayed
      - 0 means far left, 1 means the second position, etc.
        - the values aren't sequential, just compared
          - like z-index in html but this is called x-index
      - ties should be resolved with messages sorted by time added
        - oldest should be the leftmost
        - time added should be stored in message object when the call is made
        - time added is not passed in the call
      - position has default of 1e9
        - do position = Math.min(position, 1e9)
          - this means 1e9 is always at far right
    - duration: the max time a message can be shown in secs
      - a value zero means there is no automatic expiration
      - the default is zero
      - when the duration expires the message object should be removed

## function call
- a message object can be added from anywhere in client or server
  - use ws push from the server
  - the function to add/delete a message is `setGlobalMessage(<message obj>)`
    - the call signature should be same in server and client

## hdrmsg text
- the text in hdrMsg will be multiple message object's text concatenated
  - each message text is `<id>: <text>`
    - <id> is the id from the message object
    - <text> is the text from the message object
    - the message texts should be separated by `, `

## first message objects id's
- there will be more added later
- the calls to add/remove objects with these id's has to be added
- make it easy to find the calls for these in code
- none of these have duration
- the id's are:
  - Lib: shown when emby library is being scanned
    - text is percentage completed
    - same as text currently displayed to the left of the library button in hdrtop
      - not shown in hdrtop any more
    - x-index should be 0
  - Qbt: shown when any qbt file is active
    - text is active qbt file count
    - x-index should be 10
  - Down: shown when any Down file is active
    - text is active Down file count
    - x-index should be 11
  - Bif: indicates a bif sidecar is being generated
    - text is show name cropped to 20 chars width, add `...` when cropped
    - shown when ffmpeg is started and hidden when finished
    - x-index should be 1000
  - CPU: cpu load
    - only shown when load is >= 2
    - x-index should be 1001
  
## notes
- make a plan and write it to ./global-msg-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
