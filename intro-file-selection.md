
# update to file selection from map pane
- file selection should move from server to client
- Get episodeData for the show
- scan all episodes in episodeData
  - if any episode is found that has a bif file:
    - use that file with Open in Emby web tab
    - we are finished
  - if no episode has a bif file then start over
    - scan all episodes in episodeData
      - Track the first file as fallbackPath (any episode with a file, regardless of watched status)
      - if we find an unwatched episode with a file:
        - Open built-in intro video pane with that episode
        - we are finished
      - if no unwatched episode has a file:
          - Open built-in intro video pane with fallbackPath
          - we are finished
      - Return error if all episodes are watched or no files exist

- Priority order:
  1. First episode with a bif file (preferred)
    - Open in Emby web tab 
  2. First unwatched episode with a file
    - Open in built-in intro video pane
  3. First episode with a file (any watched status)
    - Open in built-in intro video pane
  4. Error if no files found
  