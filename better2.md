## major logic change for judgement of what file is better everywhere in app

## refactored routine
- i want to refactor all comparisons to decide which candidate is better into one routine.
  - minimum data is sent to routine. just data needed to compare.  optional data can be blank and ignored in the judgement.
  - routine should always compare given data params in the same propriety order.
  - routine should not know what it's result is used for.

## what judgement is needed for each case
- a decision is needed to choose what params to use for each judgement case.
  - it should reflect the needs of each case even when it disagrees with previous logic
  - but it can use previous logic as a starting pont for decision.
    - and example is flexget in one run vs. when comparing to old run. in one run you can be more choosy since you know there is an alternative.
  - you should make every decision right now even when not sure. we will update decisions later.

## finalizing plan
- put response to this response in better3.md. i will then comment on that in better4.md. nd we will go back and forth until we agree on plan.
- make no changes other than writing to better3.md.