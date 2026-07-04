
# unilog changes

## remove tag
- tag has duplicate functionality with groups
  - groups are better since sites can be conceptually in different collections
- remove tag as a possible param object property in loghere
- do not remove tag from db, it can be a dead field
- strongly recommend that `[tag]` should not be used in msg
  - use a group instead to accomplish the same purpose
- when upgrading old-style debug calls like console.log, move `[<tag>]` in message to a group `<tag>`

## change loghere signature
- change loghere signature to just have one msg arg: `logHere(<obj>, <msg>);` 
  - remove support for variadic args
- a single template string should be used as loghere `<msg>` for consistency
- remove multiple msg arg support from reconciliation logic

## remove server debug agent
- remove .github/agents/server-debug.agent.md file
  - remove any other files only used for server agent
  - remove code only needed for server agent
  - remove any docs for server agent

## update docs for all changes in these instructions
- update docs in copilot-instructions.md, docs, and comments in all files
  - update docs for tag, loghere, and server debug agents
  - remove references to tags
  - remove references to variadic args in loghere
    - remove comparison to console.* args
  - strongly recommended that a single template string should be used as loghere msg for consistency
  - strongly recommend that `[tag]` should not be used in loghere msg
    - use a group instead to accomplish the same purpose
- do not talk about any previous use of these features
  - assume a fresh reader that doesn't need to know about history 
  - e.g. do not say `loghere used to have level as first arg in loghere

# notes
- implement now
  - don't implement now if you have serious concerns about any ambiguities, contradictions, or impossibilities
    - then ask me for any help
