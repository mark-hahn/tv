
# response to plan and more instructions

## new instructions
- add test button to video pane between introDur display and next button
  - test should make the video jump forward introDur time just like doing skip in tv pane remote control
  - jump in the video pane not emby

- remove the The 1000ms keyboard hold that opens keyboard
  - remove entire keyboard feature
  - this solves button timing confusion

- add a filter selection called `No Intro` that filters out shows with an intrDur value 
  - all other condfltr and search box are same as `all` selection
  - inemby condfltr should be +1
  - intro filter does not have to be selected to use intro video pane, this filter is just an unrelated convenience

- when looking for next show to select skip any shows not in emby

## suggestion responses
- use hasFiles bool in the tvdb record
- Have the sidebar list component emit @filtered-shows
- startMark/endMark values should use data() props
- there is no need to Cancel the 1000ms keyboard timer since that timer is removed by instructions above

## questions
- explain 8.8 and 8.9
  - measurement is only done in intro video pane
  - there is no skip test except new test button in intro video pane

## Ambiguity and Issue responses
9.1 resolved by removing 1000ms hold
9.2 ok
9.3 ok
9.4 can't you use emby id
9.5 use your suggestion, see instruction to ignore shows not in emby
9.6 correct
9.7 use your suggestion -- box should always display endmark minus startmark and the marks always have values
9.8 correct
9.9 don't add clamp, emby should clamp
9.10 correct

## update plan
- make no changes other than plan
