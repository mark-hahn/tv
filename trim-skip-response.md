# response to trim-skip-plan.md
- update trim-skip-plan.md using the instructions below

## Ambiguities / contradictions / impossibilities
1. Skip button should seek past the intro (to startMark + introDur)
2. keep Two buttons both labeled Clr identical per instructions
3. add 0 button back in to the left of `<<` as it was before -- it should jump video to 0 pos and do nothing else
4. there are instructions below to Migrate existing introDur shows
5. Pre and Skip should be different -- skip should behave as 1. above -- pre should jump to startmark-3 secs
6. put it in Recommended packages/share
7. do what you have to for Auto-trim mechanism on emby -- additional surface
8. add trimPos/skipDur to /api/introDur rather than renaming

## Suggestions
- keep the two `Clr` button appearances identical
- do the suggested one-time server migration after implementing plan and deploying
  - stop all 4 servers before deploying and migrating
    - so deploying is only copying
  - migrate only shows in emby
  - if introdur is missing/null then add no trimPos/ skipDur
  - if introdur is 0 then set trimPos and skipDur to 0
  - if introdur is > 0 then set trimPos to 0 and skipDur to introdur
  - if introdur is < 0 then set trimPos to abs(introdur) and skipDur to 0
-the intro pane Skip button should seek past the intro (to startMark + introDur)

## implement trim-skip-plan.md and deploy and run one-time script
- if there are serious ambiguities, contradictions, or impossibilities that affect major code changes then stop and tell me instead of deploying
