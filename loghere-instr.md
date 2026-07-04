
# add params to logHere
- change logHere to accept variadic args
  - signature looks like `logHere(<param obj>, <...msgArgs>)`
  - `<param obj>` possible properties follow with key and description:
    - `lvl`: the level string `info`, `debug`, `warn`, or `error`
      - default is `info`
    - `tag`: the tag string
      - default is a blank string
    - `grp`: the group name(s) strings which are called description in db log_groups
      - default is no group
      - the group property can be an array of multiple group names
    - `typ`: the group_type string for all groups
      - default is blank
      - ignored if no groups
      - if not missing:
        - for every pre-existing group do not change their group_type
        - for new groups use this string as the group_type
  - if <param obj> is empty then use all default properties
    - minimal call is `logHere({}, "message");
  - <...msgArgs> are variadic args:
    - the msgArgs are processed into one string that is the `message` property in the site record
    - the msgArgs are converted to strings and concenated with blanks
      - this is identical to how console.log uses its args
    - if there is no msgArg then use `<missing>` as the message

- change the documentation for loghere in .github/copilot-instructions.md and all comments in all source files
- update reconcile to use new loghere signature
  - access unilog db for group operations 

- make a plan and write it to ./loghere-plan.md
- document changes to reconciliation
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
