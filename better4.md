
# response from user to better3.md

- i agree more than i expected.
- i assume forcing overrides tests. when forcing then is the routine call just skipped over?
  - which tests can be overriden by forcing?

## factors each case sends

#4: i don't understand why this is needed at all and i think it is bad. if a file is deleted and any candidate is available the best candidate should be downloaded to fill in for the missing episode file.

#7: i assume this should be the same test as flexget one run vs. past run. it is the same situation of knowing another exists.

#10 and #11: what is the reason for sorting twice in succession?
explain `warning grouping`

## other decisions
D12: explain difference between `episode's recorded video` and the `first matching file in the season folder.` aren't they both recorded?

D13: `comparing to an episode in the history with nothing sent` makes no sense. it should be against existing file on disk. does your new plan remove that test completely?

D15: explain this in more detail and when it matters. what do you mean by grouping.

D16: how can two names parse to different show names but match the same show? isn't there only one show chosen from parsing, etc.?

## Decisions most likely to need my call
Q1: i agree but i didn't know re-encoding was done any more.  when is re-encoding needed?

Q2: use your decision.

Q3: use alternative.

Q4: does this affect anything that file size bit-rate doesn't? i want highest quality of encoding. if we make them a factor what priority do you suggest and where would it come in the ordering of factors? 

Q5: use your decision.

Q6: i do want size to matter when more than 20% bigger. where would this be in priority.

## a question for you 
- are multiple torrents for same episode ever sent to qbt from tor pane?  if not how are they decided?  the user selecting what to send seems important. should there be a confirmation?
