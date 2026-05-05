
Implementation Plan is correct

# answers

1. If two candidates have same resolution, bit depth, AND same seed count, the first one stays as best.

2. this is correct: If new candidate has same resolution and bit depth as last sent, `flexgetIsBetterCrossRun` returns false → falls into the SKIP(worse) branch and is stored with `sent: null`.

3. when episode is not found in flexget-history then allow file and proceed with old filtering

4. when flexget history has no `sent` entries then allow file and proceed with old filtering -- actually this case cannot happen but keep check

Note: if i remember correctly there used to be a check in the down cycle to make sure a file already downloaded doesn't match the episode file being checked -- this match was based purely on show name and s01e01 -- if there was a match the new file was blocked -- this check should not be there any more because a new file for same episode might be a better one and should be downloaded

