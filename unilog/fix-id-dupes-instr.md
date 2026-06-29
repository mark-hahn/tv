
# unilog reconciliation update
- multiple log sites can have the same log_id
  - these duplicates could be in the same file or in separate files

## detecting duplicate log_ids
- duplicate log_id detection should run early in the reconciliation

- in one operation all log_ids for all files should be checked
  - it should detect log_id dupes in the same file and across all files

- reconcile-cache.json should be used for duplicate detection
  - duplicates can be found by examining log_ids in all sites maps
    - the log_ids can be scanned and for each one all others can be checked for a match
      - this is an expensive n-squared operation, is there a fast algorithm
    - the current sites maps don't work if there are duplicate log_ids in the same file
      - the sites map is keyed by log_id so duplicates can't be stored
      - the keys and line numbers need to be inverted so line number is the key and log_id is the value
        - line numbers can't have dupes since only one unilog call is allowed per line
        - we need a one-time script to invert the maps
        - all code using reconcile-cache.json should be updated to use new key/values

## fixing duplicate log_ids
- duplicates should be treated as a new site and created like a stub
  - a new log_id should be assigned
  - in the source the unilog call log_id param needs to be updated
    - nothing else needs to be changed in source for the dupe

- the srvr task should have an endpoint to create a new row in log_sites
  - it should be passed these fields: log_id (old), project, src_file, and src_line 
  - it should return a new log_id to use
  - this needs be called when the dupe is first detected so it can update the unilog call

- the endpoint needs to update the db
  - the new log_site row should be a copy of the original 
    - except these fields:  log_id (new), project, src_file, and src_line 
  - rows need to be added to site_groups so new log_id has same groups as old log_id
    - one new row for each row that had the old log_id
      - same group_id as old but new log_id

- the old_log field in log_sites table will be stale 
  - it wasn't really useful
  - it should be removed from the schema
  - code accessing it should be removed

## notes
- am i forgetting anything that is needed to make this complete
- make a plan and write it to ./unilog/fix-id-dupes-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
