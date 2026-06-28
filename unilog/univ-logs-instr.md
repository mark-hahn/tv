
# universal logging
- the goal is to store all app logging in central persistent storage
  - it can be a flat file or db
    - if it is a flat file:
      - logging store should be rotated every day  
        - rotate logs to /root/dev/apps/tv/logs/all-logging-rotation/ dir
      - the log store file should be /root/dev/apps/tv/logs/all-logging.log
    - if it is a db then store it in /root/dev/apps/tv/logs/all-logging.sqlite
  - store should be machine-readable
    - make sure copilot chat ai can scan store easily for debugging

-  existing writes to log files in all source files should also send their message to the logging storage
  - nothing in .gitignore should send any logging messages
  - server files should send log lines to a common routine that writes to log store
  - the client files should send log lines to a shared routine in client
    - that routine should send log lines directly to server endpoint
    - server endpoint should route logging to server common routine
  - don't change writing to old log files
  - android should not send any logging messages

- the log line is stored in an object
  - object format is normalized
  - object should have these fields
    - unique integer logging id for every logging location
    - error or normal message boolean
    - timestamp
      - normalized to `yyyy/mm/dd hh:mm:ss`
        - if only date is available then `yyyy/mm/dd 00:00:00` is ok
    - short tag like `<tag>` that was shown in logs before as "[<tag>]"
    - short description of logic flow it documents
      - keep under 15 words when possible
      - generate description from the context
      - try to use the same short tag and same short description when logging from same logic flow
    - location of source file log statement writing the log lines:
      - path of source file 
      - line number
        - this will be stale quickly which is ok
        - it will help any tool trying to find the source location when given this log object
        - line numbers should be read while lines above are modifed to keep accuracy
    - path of existing log file written to
    - full message text

- comment should be added to new source code calls sending the log 
  - comment should be `// log-id: <integer logging id>` or `# log-id: <integer logging id>`
    - comment can be at end of logging call line
  - this is to find logging line given a log object

- write a one-time summary in temp.md of the existing log line stats
  - show the log line count and total line count for every source file 
  - organize by project like client, srvr, etc.
    - include stats by project
  - include total stats

- store is not accessed for now
  - later the app will have a tab pane to read logs

- make a plan and write it to ./univ-logs-plan.md
- make no changes other than writing to plan and stats file
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
