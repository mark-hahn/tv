
# refactor apps/srvr/index.js
- apps/srvr/index.js is 10,000 lines long
- we need to refactor it into multiple source files
- there is no specific goal of how many files there should be or their size

- we need to split along functional lines
  - for each file we should be able to say what it does in one sentence
  - the quality of the split can be roughly measured numerically
    - how many inter-file imports
    - how many inter-file function calls
    - we should measure this value for each possible split

- edits for refactoring should be limited to the apps/srvr/index.js file
  - can you think of any need for exceptions?

- should there be new project with a new pm2 task?

- should these new files all be in the folder apps/srvr/src?
  - or should there be a subfolder for these

- give comments on this overall idea
  - answer my questions
  - what do you disagree with?

- make suggestions for multiple possible refactorings
  - for each refactor give a list of new files and do these for each file:
    - explain what it does in one sentence
    - give a rough estimate of the length
    - describe the surface area:
      - number of new imports and exports
      - number of calls between the new files
  - compare the refactoring ideas
    - is one clearly better than the others
    - are there trade-offs of different ones

- i know this is a huge task
  - take your time and explore this thouroughly
  - i don't care how many tokens it costs

- put your response in index-refactor-comments.md