
# consolidating all episode data in tvdb.json
- the properties filesOnDisk, fileQuality, episodeAiredDates, and watchedEpis are large data objects in the tvdb show records
  - they all have data for each episode of a show
  - they have different messy storage structures
  
- i want to store all old data from all old properties in one tvdb.json show property `episodeData`
  - this will occupy less memory and standardize access
  - episodeData would be an array with one entry per season
    - the episodeData array's implicit 0-based index would be the season number
      - so seasons from 0 to N are represented
      - the number does not need to be explicitly stored
    - each season entry would be an array of episodes
      - the episode array's implicit 0-based index would be the episode number
        - so episodes from 0 to N are represented
    - the array can be sparse
      - for example most shows have no season 0 so they would have an empty array for season 0
    - each episode entry in the episodes array is an episode object 
      - the episode object would have keys for each property being replaced
        - filesOnDisk data would be stored with the key `hasFile` and a boolean value of true if a video file exists for that episode
        - fileQuality data would be stored with the key `res` with an integer value of the resolution like 1080
        - episodeAiredDates data would be stored with the key `aired` and a unix timestamp of a date
        - watchedEpis data would be stored with the key `watched` and a boolean value of true is the episode was watched
    - so the episode data for s02e03 would be in episodeData[2][3] 
    - empty arrays could be stored as null instead of an array
      - you decide which option is the best

  - the in-memory representation of data does not have to match the structure of episodeData in tvdb.json
    - you must design these representations and not make them options in the plan for me to choose
    - it might be the most logical to keep the same structure in-memory
      - the code would be more readable
      - the code might shrink
      - more code would have to change and the changes would be less safe

- make a plan and write it to ./episodeData-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
