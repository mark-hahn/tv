
# response to univ-logs-plan.md
- do not include root dir

# Ambiguities / contradictions / impossibilities
1. ignore Tampermonkey 
2. yes, include console.*
3. confirmed, do not include scripts
4. Option A Confirmed, one DB owner in srvr
5. ids are allocated once and never reused
6. generate the busiest files, descriptions are not necessary for every location, use judgement
7. use SQLite

# Suggestions
- Add levels
  - is_error isn't needed since level value can discriminate errors when reading db
- ues Batch client + cross-process POSTs
- Add a pid / process column
- use WAL mode + busy_timeout
- Keep a generated logRegistry.json
- yes, Provide a tiny query helper

# message size problem
- don't cap message size in db
- we will reduce length of existing logging messages by editing logging source
- scan sample sections of existing log files 
  - list long message locations in a report in temp2.md 
  - list locations of lines longer than 120 chars
    - show actual text of longest line for each location
  - sort list with longest first
- we can manually decide which log locations need fixing
- we won't start actual logging until we have decided how to fix existing long lines

# updating logRegistry.json and log_sites db table
- updating all log sites on every deploy would be slow
- we need a way to keep track of log lines added while modifying source code
  - write a script that 


# notes
- update plan at ./univ-logs-plan.md
- write long line report in temp2.md
- make no changes other than writing to plan and report files
- describe any ambiguities, contradictions, or impossibilities
- feel free to make suggestions
