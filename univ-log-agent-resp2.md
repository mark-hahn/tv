
# response to univ-logs-plan.md

## finalize univ-log-agent-plan.md and univ-logs-plan.md
- having 2 plans that interact is complicated
- these are the proposed steps to finalize:
  - these instructions will finalize logs-plan
  - i will give answers to logs-plan questions to finalize
  - you will check that agent-plan and logs-plan are compatible
    - we will make final changes to both plans

# detailed response to agent-plan items

0. use a thin AI agent over a deterministic CLI

0.1 the [tag] should not be inside the stored message text. the tag should be a different db field just for backwards compatibilty. eventually tags will be unused since we have id's and short descriptions. tags have often been insufficient and poorly chosen.

1.3 isError is not needed.  error can be determined by a level field
1.4 when a single log line is added to log_events the message id is generated. the log_id is only generated when a new type of message in log_sites is needed
2. 

