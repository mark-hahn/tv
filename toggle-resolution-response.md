
# toggle-resolution-plan response

## Ambiguities, contradictions, impossibilities, suggestions
1. change the long-press key to skip button
  - if that is also unavailable then pick any key that doesn't have a long-press action
2. use yor h264 suggestion
3. .alt is ok
4. follow Suggestion: filename parsing first (no API change)
5. i confirm exactly one selected, nothing else selected
6. do what is needed to avoid race
7. keep the instruction to duplicate them
  - put new 1080 video into queue for chksrt
    - do this after new 1080 and subtitle files are ready
8. do your proposal

# changes and new instructions
- change: when client or android button is clicked/pressed use this sequence:
  - emit home key to tv
  - rename/toggle video files
  - trigger emby library refresh
  - wait for refresh to finish
  - load episode into emby like tv button does

- run a one-time script to visit every show and process them like the tvdb update processing is done, maybe they could be put in queue for ffmpeg

if there is still an Ambiguitiy, contradiction, or impossibility then stop and ask for help

implement plan
