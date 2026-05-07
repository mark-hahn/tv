
# download movies

## tor pane
- add button `Movie` to tor pane to right of cookies button
- when movie button is clicked switch pane to movie mode with these changes to tor pane
  - movie button label changes to `Exit Movie`
    - Clicking Movie button toggles tor pane back to normal mode
  - season input box is hidden
  - buttons stream, search, and more are hidden
  - row 2 of hdr has a text input box movieSrchText with hint `Search Mpvies`
    - postion box to right of tab button
    - entering search text and pressing enter starts a tor search
      - tor search has category movies
      - same as clicking search button
      - all 4 providers are searched at same time
    - the title in the left side of row 1 is changed to `Tor: <movie search text>`
- in movie mode rest of pane behavior is identical to normal tor pane mode except:
  - cards have no season/episode text `1/1 - `
  - a movie mode flag is set for qbt
  
## qbt pane 
- in movie mode appearance and behavior are unchanged with these exceptions:
  - row 2 of header has text `Movies` on far left
    - style is identical to qBittorrent text at left of row 1 of header
  - sel and from buttons are hidden
  - files are downloaded to /mnt/media/movies
- when tor pane exits movie mode qbt also switches to normal mode
    - movies text is removed from row 2 of header:
    - buttons are restored
    - files are downloaded to /mnt/media/tv
- when qbt pane is switched to movie mode cards list is cleared until movie cards are available
- when qbt pane is switched back to normal mode cards list is cleared until tv cards are available

## other panes are not changed in movie mode
  - they still interact with tv shows instead of movies

## Instructions
- create a plan in movies-plan.md
- make no changes other than writing plan
- notify me of any contradictions, ambiguity, or impossible actions
- feel free to make suggestions
