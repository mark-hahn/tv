
## flexget candidate comparison clarification
- the current logic for comparing entries in flexget history is incorrect

- there are 3 places where files from flexget are compared:

  - when multiple files for same episode arrive in one run of flexget:
    - an episode is defined as the show name and s01e01
      - same as key in flexget-history
    - the better one is sent to qbt
    - for the better check these three values are compared
      - highest quality resolution, 640 is default for missing data
      - highest bitdepth, 8 is default for missing data
      - number of seeds

  - when multiple files for same episode arrive in different runs of flexget:
    - if the later file is better than earlier one then send it to qbt
    - if the later file is worse than earlier one just set sent field to null
    - for this better check the seeds are not included in the check
      - highest quality resolution, 640 is default for missing data
      - highest bitdepth, 8 is default for missing data

  - when a file in usb server is checked for downloading in the down cycle:
      - the usb server episode file should be looked up in flexget-history
        - an episode is defined as the show name and s01e01
          - same as key in flexget-history
      - if episode found in flexget-history
        - compare file from usb to the most recent sent file in flexget-history
          - file is compaired by matching resolution (1080) and bit-depth (10)
          - if resolution and bit-depth match the most recent file in flexget-history for the episode then download the usb file
          - if they don't match then skip the usb file

- put a detailed plan to implement this in temp.md
- make no changes other than writing to plan
- notify me of any incompleteness, contradictions, ambiguity, or impossible actions
- feel free to make suggestions

# answers

1. If two candidates have same resolution, bit depth, AND same seed count, the first one stays as best.

2. this is correct: If new candidate has same resolution and bit depth as last sent, `flexgetIsBetterCrossRun` returns false → falls into the SKIP(worse) branch and is stored with `sent: null`.

3. when episode is not found in flexget-history then allow file and proceed with old filtering

4. when flexget history has no `sent` entries then allow file and proceed with old filtering -- actually this case cannot happen but keep check

Note: if i remember correctly there used to be a check in the down cycle to make sure a file already downloaded doesn't match the episode for file being checked -- this match was based purely on show name and s01e01 -- if there was a match the new file was blocked -- this check should not be there any more because a new file for same episode might be a better one and should be downloaded

