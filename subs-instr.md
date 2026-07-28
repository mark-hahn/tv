
# check subtitles in torrent
- i prefer torrents that provide subtitles
  - they can be embedded in a video file
  - they can be additional subtitle files in the torrent with the video file

- there are 2 ways to determine if a torrent has subtitles:
  - is there a subtitle file `.srt` in the torrent file
    - the subtitle file has to be retrieved using a url to ipt or tl webpage
      - i think existing code does this
    - this should be checked first
      - because if it has a file then there is no question the torrent has a subtitle
    - if there a subtitle file then skip provider webpage content instructions below

  - does the provider ipt or tl webpage contents mention subtitles in the page text
    - these would usually be embedded
    - an algorithm to scan the text is needed
      - it can't use ai because that would be too expensive
      - it would probably involve reg exp
      - this algorithm can't be guaranteed to be accurate
        - the algorithm must be empirically determined by examining webpage content examples:
          - examples of webpage urls whose contents include mentions of subtitles in text are in subs-yes.txt
          - examples of webpage urls whose contents do not include mentions of subtitles in text are in subs-no.txt
        - examine the two lists to generate the code for the algorithm
          - the algorithm should return yes, no, or maybe when given a url
        - this is a hard problem so let me know if it isn't prossible to get mostly accurate results
    - document the alorithm in subs-algo.md
    - test the algorithm:
      - test against the examples in subs-yes.txt and subs-no.txt
      - pick 10 random provider web pages to test
        - put the urls in a list with the results yes, no, or maybe
        - write that list in subs-random.txt for me to verify
    - document the alorithm in subs-algo.md

- if there are any ambiguities, contradictions, or impossibilities with these instructions:
  - describe the problem in ./subs-problems.md
  - stop so i can help with problems
  - make no changes other than writing to the result files mentioned in these instructions
  
- if there are no ambiguities, contradictions, or impossibilities then implement these instructions:
  - don't stop working until you are confident you have done the best job possible
  - don't worry about LLM token costs
  - take as long as you need
