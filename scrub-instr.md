
# major change to remote control scrubbing in emby playback

- currently our remote left and right arrow keys scrub while emby is playing
  - they do it by sending keys to tv
  - this works badly for our remote control and physical remote control

- i want to change the scrubbing to work by sending position commands to emby
  - emby jumping is fast and accurate
  - this change is only when emby is playing, otherwise it emits same keys as now
    - when emby not playing the debounce and auto-repeat logic and timing is unchanged
  - this is only for left and right buttons in remote
  - the position commands should work the same way as when using introdur to jump over intros

- an internal position variable embyPos mirrors the position in emby playback
  - it is intialized to match emby position when playing starts
  - it is continually adjusted by time elapsed to closely match emby position
    - it never reads emby position from emby api
  - it doesn't have to match emby position exactly
    - whenever a jump is made it will automatically sync up because jump will be to current value of embyPos

- each arrow key action will update embyPos by desired jump distance and then do jump to embyPos value
  - the arrow key debounce and auto-repeat logic will be unchanged
  - the auto-repeat interval will be 1 sec for every jump
    - this interval should be set by an in-code constant at top of file
      - later we will test to see how small we want it
    - the debounce delay and delay to start repeating is unchanged
    - the auto-repeat interval has nothing to do with jump distance
  - the distance for each jump action will vary by auto-repeat count index
    - the first four jumps will offset embyPos by 10 secs
    - after the first four it will offset embyPos by 30 secs
    - timing is same in both forward right key and reverse left key

- this should work the same in web client remote control and android remote control

- make a plan and write it to ./scrub-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
