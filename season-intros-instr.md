
# keep show intro data by season 
- some shows have different video intro positions and durations for different seasons

## intro data structure
- for each show save trimPos, startMark, and skipDur data by season
- persist data in show tvdb record property seasonIntros
  - seasonIntros should be an object/map with season numbers as keys
    - seasonIntros values should be intro data objects with keys trimPos, startMark, and skipDur
  - seasonIntros does not need an entry for each existing season and can be sparse
  - seasonIntros property should be null or missing until first season data object is added

## retrieving intro data
- there should be a utility function getSeasonIntro to retrieve intro data for season
  - any current code that uses intro data should call this
  - it should have season number as param and return an intro data object
  - if there is no data object for the season then getSeasonIntro should return data from a different season
    - it should first scan smaller numbered seasons n-1, n-2, ...
    - if there are no seasons smaller then it should scan larger numbers n+1, n+2, ...
    - if seasonIntros property is null/missing then getSeasonIntro should return a data object with all values null
      - the object is ephemeral and not persisted

## saving intro data
- seasonIntros season data objects can only be populated by the intro emby web page buttons
  - the trimPos, startMark, and skipDur buttons should save values immediately as they currently do
  - the data should be saved in seasonIntros for the season of the episode open in the intro emby web page
    - if the season data object exists then update the single value
    - if the season data object does not exist then create a new data object for the season
      - the object should be created with one value being saved and the other 2 values should be null
    - after saving a value in the data object if all 3 values are null then delete that season from seasonIntros
      - if there are no seasons after deleting a season the set seasonIntros property to null
  - seasonIntros should be persisted in tvdb.json on any change

## notes
- make a plan and write it to ./season-intros-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
