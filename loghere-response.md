
# response to loghere-plan.md

## Ambiguities and questions
1. one-time-op: add UNIQUE constraint to log_groups.description in db
  - first change any null, blank, or duplicate names to `Group <group id>`
2. noted
3. do not add any Backward compatibility with old logHere calls
  - remove any comments or docs about old style calls
  - remove datection of first string arg for level
  - remove any reference to old type `[tag]` prefix
4. noted. document this
5. noted
6. noted
7. support <missing> sentinel 
8. remove task groups from deploy
  - create no group other than named ones specified in logHere call
9.in reconciliation upgrading old-style call upgrades (console.log, log(), loge()) should strip the `[tag]` from the beginning of the message and add that tag value to the site record like the way the tag property is handled in a logHere param object

## Suggestions
- do not add a // unilog-stub syntax extension
- do not expose findGroupByDescription function as a CLI query
  - unilog agent and cli have been removed
- usage of ensureSrvrStopped is noted

# final notes
- update .github/copilot-instructions.md and any other docs for these changes
- implement loghere-plan.md after making these changes
