
# update agent and log plans and merge them

- these instructions refer to the agent plan but both plans will be affected.
- these instructions have a lot of overlap because i couldn't figure out how to organize everything.

## removing large logging before rollout
- remove the legacy code that writes existing large log lines 
  - remove every log line mentioned in Long Log-Line Report in temp2.md
    - these log lines will not be replaced by new logging
  - be careful to not break code
  - do this one-time operation later as first Rollout step
- we will remove the rest of the legacy console.*/appendFile writes later. 

## initial one-time addition of new logging calls during rollout
- old logging will remain
- there will be a new logging call added to pair with each old log line write
- tags and descriptions will need to be generated
  - tags can come from `[<tag>]` strings at beginning of line if available or blank if not
  - descriptions will be generated from context
    - see description generation section below

##  description generation
- there should be only one logical method in code to fill in descriptions
  - it will be used when running one-time rollout
    - this will add logging calls to pair to most, but not all, existing log lines. 
  - some old logging will not be replaced
  - it will also be used to reconcile logging later by the agent
    - this will be needed when an edit adds traditional logging like console.*
  - the description can come from 2 sources
    - using prompt text when available
      - this is the preferred most reliable method
      - there should be a sanity check algorithm for the prompt
        - if prompt fails the sanity check the we will need to fall back to context analysis
    - context analysis which is always available
      - chat ai can do context-based description generation when doing rollout
      - agent ai can determine context later

              aaarrrggghhh

## changed file reconciliation
- there should be only one logical method in code to reconcile changed files
  - it should be used often in tool chains
    - it should be used when processes like tv-srvr are started
    - it should be be used on all files on any deployment of anything
  - it should only reconcile changed files
    - changes will be detected by checksums
  - it should work the same way if edits come externally or locally
    - it doesn't need to know what called it
- actual alogrithm of what to do with changes is described elsewhere

## detailed response to agent-plan items
- when there is no mention of a topic that means i agree and it shouldn't be changed.

0. use a thin AI agent over a deterministic CLI
0.1 the [tag] should not be inside the stored message text. the tag should be a different db field just for backwards compatibilty. eventually tags will be unused since we have id's and short descriptions. tags have often been insufficient and poorly chosen.

## What the agent must do 
1.3 isError is not needed.  error can be determined by a level field. 
1.6 logRegistry.json is not needed

## Agent definition
3. agent doesn't add the house-style traditional log. there is no logRegistry.json. don't use scripts dir for log-add.js, scripts/ dir is only for one-time use scripts. 

## Keeping src_line accurate
6. Process restart doesn't need to reconcile everything. the standard changed file reconciliation will only reconcile needed files.

## Example end-to-end
7.3 [flexget] should not be in --message 'run started'. the `flexget` tag should be in separate tag field.  log viewer can add  [flexget] later if desired.

## Removing log lines
8. there shouldn't be a delete all by id

## Ambiguities / contradictions / impossibilities
10.1 confirmed: only add new logging to db, no new logging to flat files
10.2 do not update the log_sites DB immediately when editing.  wait until deploy and then use standard changed file reconciliation. 
10.3 the one DB owner (tv-srvr) should handle log_sites and runtime events. It can resolve/avoid multiple path conflicts.
10.4 a CI/lint checks should not be used. any old style console logging should be detected when reconciling changed files. the old style logging should automatically be upgraded to use new logging. This upgrade is something we already need for the one-time scan, so the same logic/code should be used here. that upgrade code needs to be developed and tested before the rollout.
10.5 resolve Anchor ambiguity by passing the problem to the agent. anchor problems are common in ai code editing.
10.6 The code that doesn't support universal logging should be ignored by agent.  old-style logging will continue to be used. 
10.7 handle .vue files as suggested
10.8 don't add prompt field.  store prompt in description field.  add a prompt sanity check that falls back to context-generated description when sanity check fails. This sanity check has to be developed and tested just like the old style logging upgrades.
10.9 don't use Delete all by id. the chat conversation/session id will be the closest thing to grouping by flow.
10.10 we need a conversation/session id as a db field not only for deleting but for tracking flow in the log viewer. You will need to design this id. i don't understand conversations vs. sessions. explain your logic for this in the plan.
10.11 the schema for all tables will have to be checked for updates when we merge agent and log plans into one grand plan.

## Suggestions
- Lint rule can be used for monitoring but shouldn't be used to control and changes.
- don't use a logRegistry.json
- all other suggestions should be followed

## notes
- don't update univ-log-agent-plan.md or univ-logs-plan.md
- create new univ-grand-plan.md that combines agent design and logging design.
  - try to fix organization, my organization is bad
- make no changes other than writing to grand-plan.
- describe any ambiguities, contradictions, or impossibilities
  - especially between agent and logging designs
- feel free to make suggestions
- we will probably need one more round of updates after this
