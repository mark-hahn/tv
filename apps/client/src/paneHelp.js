export default {
  info: `
  
*Info Pane Refresh button:*
  Client POSTs to /api/triggerShowGapCheck
    Server enqueues a show refresh 
      disk scan + gap check + TVDB scrape
  Server pushes showUpdating message 
  Server pushes tvdbUpdated with the new record
    Client updates in-memory TVDB cache, refreshes remote links
    dismisses modal
  Server sends showQueueEmpty as a fallback to dismiss the modal if tvdbUpdated didn't clear it
  A 60-second stuck-refresh safety timer logs diagnostics if nothing completes in time`,

  map: `Ctrl+click episode — delete episode file
Alt+click episode — play the episode
Ctrl+click season — delete entire season folder
Ctrl+click "Not in Emby" — create server folder & refresh Emby`,

  actors: `Ctrl+click actor name — open IMDB search for actor`,

  reviews: `Click IMDB / Rotten — filter reviews by source`,

  trailer: `Auto-plays available trailers
Native video controls for play/pause/seek`,

  tor: `Alt+click torrent — force-download (bypass already-downloaded checks)
Ctrl+click torrent — enqueue download`,

  browse: `Click gallery item — select or preview a show
Click external link — open IMDB, RT, Google, etc.
Enter in search — manual search`,

  flex: `Click card — select the show
From show — scroll to current show's downloads`,

  qbt: `Ctrl+click card — delete torrent + files from qBittorrent`,

  usb: `Alt+click item — copy full path to clipboard
Ctrl+click folder — deselect top-level folder / toggle selection
Shift+click file — range-select files`,

  down: `Click card — select the download
Retry button — retry a failed download
Cycle — trigger a download check cycle`,

  local: `Alt+click item — copy full path to clipboard
Ctrl+click folder — deselect top-level folder / toggle selection
Shift+click file — range-select files`,
};
