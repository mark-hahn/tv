
# script to extract a show from tvdb.json 
- there is a script ./show.cjs that does this:
  - extracts a show from tvdb.json
  - the show json has an object with key of "episodeData"
    - the value of that key is an array of show seasons
      - the season array entries have corresponding season numbers (not shown) that are the 0-based index number
      - each entry of the seasons array is an episode array
        - the episode entries have corresponding episode numbers (not shown) that are the 1-based index number
        - the episode array contains data elements for that episode
  - the script writes the formatted show json to show.jsonc
  - then in show.jsonc it collapses the episode array into a single line
    - e.g. `["2012-06-03",
              0,
              4853385,
              "Veep.S01E07.Full.Disclosure.1080p.BluRay.DD5.1.x264-SA89.mkv",
              1080
            ],` becomes `["2012-06-03",0,4853385,"Veep.S01E07.Full.Disclosure.1080p.BluRay.DD5.1.x264-SA89.mkv",1080],`
  - currently ./show.cjs does all this and adds  a test comment ` // TEST` after the comma of every collapsed line
  - now i want to update ./show.cjs to add the comment ` // S<season> E<episode>` instead of ` // TEST` after the comma of every collapsed line
    - <season> is the season number for season array entries
    - <episode> is the episode number for episode array entries

- read ./show.cjs and understand how it accomplishes the description above and then edit ./show.cjs for the update