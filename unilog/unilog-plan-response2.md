
# implementation

## notes
- why does The shared unilog(logId, message) routine Look up the site's level from log_sites? the level in log_sites is used later. make no changes for this question, just answer it.

## final changes
- add a group type field to log_groups table. values are these but not limited to these: prompt, conversation, flow, file, source file, task

- problem: when there is a reconciliation from a process start, source files may be edited.  that will cause the deployed source to not match the local source.  the local source is authoritative. 
-- solution: do not do reconciliation on process starts.  Do it only on deploys.

## actions to do now
- do rollout steps 1, 2, and 3
  - leave any test results in db so i can review db contents
  - do nothing else for now
- do not commit to git
