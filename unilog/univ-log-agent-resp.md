
# continuing agent discussion

- i will include all answers to univ-log-agent-plan.md questions later in response to univ-logs-plan.md questions.

- here are some random notes ...

- we would need to be able to remove log lines
  - just removing the call from the source file
  - we would never remove any message entries from db
  - we would need ways to tell what calls to delete
    - delete last added
    - delete by location
    - delete all by id
    - delete all since date/time
    - delete all added in current copilot chat conversation
    - delete by logical description in prompt

- set short descripion in db to be the prompt that created it
  - e.g. a short descripion like "log when a bif build is queued in srvr"

- we would only add new logging to db
  - no new logging to flat files
  - we would eventually remove all old logging to files

- could we check all source file dates/length on every deploy so we could check files modified externally

- update univ-log-agent-plan.md
- make no changes other than writing to plan
- describe any ambiguities, contradictions, or impossibilities
- feel free to make more suggestions
  