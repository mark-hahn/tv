
# sweep entire app to find and fix bugs
- scan all source files in app to find and fix bugs
  - only check files in ./apps and ./packages/share/src
  - when chasing a bug you may need to look at more than one file at once
    - but only when necessary
  - look for bugs by examining code
    - you should not look for problems in logs

- some example bugs:
  - possible freeze or permanent looping
  - promise that could possibly not be resolved
  - data sctructures that could grow without bounds
  - error condition that could crash the app
    - undeclared or uninitialized var, etc.
  - unreachable code that is needed
  - all io errors should be caught
    - put logging in catch blocks
  - any bug not in this list

- append reports to bug-sweep/bug-reports.md
  - a report is a description of a problem and how it was resolved
    - it is not a report in the traditional sense of notifying someone else
  - reports should be appended to the file so they can be viewed while processing
    - number reports sequentially
  - reports should be short summaries
  - each report should include:
    - a brief summary of the bug
    - the filename and line number of the code that best shows the bug
    - the severity
    - the risks taken when fixing
    - the resolution, options are:
      - fixed
        - action taken should be briefly summarized
      - recorded a question
        - question recorded in bug-sweep/questions.md
      - put off until some other action is taken in the future
        - record that also in questions.md

- questions should be recorded in bug-sweep/bug-questions.md without stopping
  - questions should be appended to the file so they can be viewed while processing
  - possible situations needing a question:
    - when there is an ambiguity and you don't know what behavior is desired
    - when comments don't agree with code
    - when there is any reason to get needed information from me to continue fixing a bug
    - when a bug may be too expensive to fix
      - i will decide whether you should fix it when i read questions.md later
  - append questions to bug-sweep/questions.md
    - number the questions
    - take no action other than writing to questions.md
  - do not stop working
    - i will answer questions later
    - stop working only on the particular problem that caused the question
    - move on to work on the next problem
        
- do not stop working until all files have been examined
  - expect to work on this a very long time
  - thinking time and token usage can be as large as needed
    - money spent is not an issue
  - i will interrupt if:
    - i disagree with the direction you are taking for a fix
    - you are thinking too hard or not hard enough

- when a file has been examined and found to have no problems then add 1 line logging it to bug-sweep/bug-reports.md so we can keep track of progress

