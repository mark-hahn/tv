// Global button hover tooltip — shows description after 2s hover on any <button>
// Uses event delegation on document, no per-component wiring needed.

const HOVER_DELAY = 2000;

// Pane-scoped descriptions: key = closest pane id, value = map of button text → description
const PANE_TIPS = {
  // Tab bar (in tabBar)
  tabBar: {
    Info: "Show details, summary, and metadata for the selected show",
    Map: "Season/episode grid showing air dates and download status",
    Actors: "Cast and crew information for the selected show",
    Reviews: "User and critic reviews for the selected show",
    Trailer: "Watch trailers for the selected show",
    Tor: "Search torrents and start downloads for episodes",
    Browse: "Discover and add new shows",
    Flex: "Flexible streaming monitor",
    Qbt: "qBittorrent download status and management",
    Usb: "USB/external drive file management",
    Down: "Download progress monitor and cycle control",
    Local: "Local file browser and subtitle/ASR tools",
    "Add show to Emby": "Add the previewed show to your Emby library",
    "Exit Preview": "Leave preview mode and return to normal view",
  },

  // Info pane
  info: {
    Load: "Add this show to Emby library",
    Refresh: "Re-fetch show metadata from TVDB",
    Delete: "Remove this show from tracking",
  },

  // Map pane
  map: {
    "←": "Pan the episode grid left",
    "→": "Pan the episode grid right",
    History: "Toggle event history overlay on the map",
    Prune: "Remove episodes that are no longer on disk",
  },

  // Actors pane
  actors: {
    "◄": "Go to previous season",
    "►": "Go to next season",
    Shows: "Open actor's full show list",
    "All Credits": "Load all credits for this actor from IMDb",
    IMDb: "Open actor's IMDb page",
    Wikipedia: "Search Wikipedia for this actor",
    "Mr. Skin": "Search Mr. Skin for this actor",
    Done: "Close actor detail and return to cast list",
    Regulars: "Show series regular cast members",
    Guests: "Show guest cast members",
  },

  // Reviews pane — dynamic filter buttons handled by fallback

  // Tor pane
  tor: {
    Get: "Download the selected torrent",
    Tab: "Open torrent detail page in a new tab",
    Search: "Search for torrents matching the current show/episode",
    Force: "Force a new search ignoring cache",
    Info: "Fetch the first selected torrent file and show its metadata",
    "Bad Grp": "Toggle the selected torrent group in badGroups.txt",
    Tabs: "Open all torrent links in new tabs",
    Stream: "Toggle streaming mode for this torrent",
    Cookies: "Show/hide cookie input fields for protected sites",
    "Save Cookies": "Save entered cookies for future searches",
    "Copy URL": "Copy the last search URL to clipboard",
    Close: "Close the debug panel",
    Cancel: "Cancel the current download",
    OK: "Confirm and start the download",
    Delete: "Delete the existing file and re-download",
  },

  // Browse pane
  browse: {
    Stream: "Toggle streaming for the previewed show",
    "Save Tvdb": "Save TVDB debug data for this show",
    Next: "Load the next show suggestion",
    Preview: "Preview this show in the main panes",
    Get: "Add this show to your collection",
    Tvdb: "Toggle raw TVDB data display",
    Select: "Select the matching existing show",
    IMDb: "Open IMDb page for this show",
    RT: "Open Rotten Tomatoes page for this show",
    Google: "Search Google for this show",
    Wiki: "Search Wikipedia for this show",
    Official: "Open the official show website",
  },

  // Local pane
  local: {
    To: "Select the show matching the selected folder",
    From: "Find the folder matching the current show",
    Subs: "Open subtitle adjustment panel",
    Asr: "Open automatic speech recognition panel",
    Fix: "Open file-fix panel",
    Errs: "Toggle error display mode",
    Del: "Delete selected files",
    Ref: "Refresh the file listing",
    Apply: "Apply subtitle offset adjustments",
    "✕": "Close this panel",
    Start: "Start the operation",
    Clear: "Clear the log output",
    Kill: "Kill the running ASR process",
  },

  // Down pane
  down: {
    From: "Scroll to the first currently downloading show",
    Cycle: "Start a new download check cycle",
    Errs: "Toggle error records display",
    Clr: "Clear all error records",
    Bot: "Scroll to the bottom of the list",
    Active: "Toggle showing only active downloads",
    Stop: "Stop automatic download polling",
    Resume: "Resume automatic download polling",
  },

  // Qbt pane
  qbt: {
    "From show": "Highlight the torrent for the current show",
    Active: "Toggle showing only active downloads",
    "Bad Grp": "Toggle the first selected torrent group in badGroups.txt",
    Clean: "Remove torrents whose files are missing from disk",
    Bottom: "Scroll to the bottom of the list",
  },

  // Flex pane
  flex: {
    "From show": "Scroll to the current show's stream",
    Bottom: "Scroll to the bottom of the list",
  },

  // Usb pane
  usb: {
    "From show": "Highlight the current show on USB",
    "Force Down": "Force download of selected items",
    Prune: "Remove files no longer needed",
    Refresh: "Re-scan USB contents",
    Clr: "Clear the prune status line",
  },

  // Sidebar buttons
  simpleButtonsPane: {
    Top: "Scroll the show list to the top",
    Trash: "Show deleted/hidden shows",
    Custom: "Apply custom shared filters",
  },

  // Also match the inner 'buttons' id
  buttons: {
    Top: "Scroll the show list to the top",
    Trash: "Show deleted/hidden shows",
    Custom: "Apply custom shared filters",
  },

  // List header (hdrtop)
  hdrtop: {
    All: "Show all shows (clear filters)",
    Library: "Open library management",
    Send: "Send current filters to the server",
    Actors: "Toggle actors-list browsing mode",
  },

  // List footer (hdrbottom)
  hdrbottom: {
    Top: "Scroll the show list to the top",
    Prev: "Go to previous page of shows",
    Next: "Go to next page of shows",
    All: "Show all shows (clear filters)",
  },
};

// Generic fallback tips by button text (used when pane not matched)
const GENERIC_TIPS = {
  OK: "Confirm",
  Cancel: "Cancel",
  Close: "Close",
  Top: "Scroll to top",
  Prev: "Go to previous page",
  Next: "Go to next page",
  All: "Show all items",
  Bottom: "Scroll to bottom",
};

// Pane IDs to check (ordered from most specific to least)
const PANE_IDS = [
  "tabBar",
  "info",
  "map",
  "actors",
  "reviews",
  "tor",
  "browse",
  "flex",
  "qbt",
  "usb",
  "down",
  "local",
  "simpleButtonsPane",
  "buttons",
  "hdrtop",
  "hdrbottom",
  "sortFltr",
];

function findPaneId(el) {
  let node = el;
  while (node && node !== document.body) {
    if (node.id && PANE_IDS.includes(node.id)) return node.id;
    node = node.parentElement;
  }
  return null;
}

function getTip(btn) {
  const text = btn.textContent?.trim().replace(/\s+/g, " ");
  if (!text) return null;

  const paneId = findPaneId(btn);

  // Check pane-specific tips
  if (paneId && PANE_TIPS[paneId]) {
    // Exact match
    if (PANE_TIPS[paneId][text]) return PANE_TIPS[paneId][text];
    // Partial: button text might have extra chars like badge counts — try startsWith
    for (const [key, val] of Object.entries(PANE_TIPS[paneId])) {
      if (text.startsWith(key)) return val;
    }
  }

  // Sidebar dynamic buttons (filters, genres, collections, sort orders)
  if (paneId === "buttons" || paneId === "simpleButtonsPane") {
    return "Filter shows by: " + text;
  }

  // hdrbot sort/filter buttons
  if (paneId === "hdrbottom" || paneId === "sortFltr") {
    return "Current sort/filter setting";
  }

  // hdrtop watching button — dynamic text
  if (paneId === "hdrtop" && !PANE_TIPS.hdrtop[text]) {
    return "Toggle watching status filter";
  }

  // Generic fallback
  if (GENERIC_TIPS[text]) return GENERIC_TIPS[text];

  return null;
}

let tipEl = null;
let hoverTimer = null;
let currentBtn = null;

function createTipEl() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.id = "btnTip";
  tipEl.style.cssText = `
    position: fixed;
    z-index: 9999;
    background: #333;
    color: #fff;
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 6px;
    max-width: 280px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    line-height: 1.4;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  `;
  document.body.appendChild(tipEl);
  return tipEl;
}

function showTip(btn) {
  const tip = getTip(btn);
  if (!tip) return;
  const el = createTipEl();
  el.textContent = tip;

  // Position above the button
  const rect = btn.getBoundingClientRect();
  el.style.opacity = "0";
  el.style.display = "block";

  // Measure after inserting text
  requestAnimationFrame(() => {
    const tipRect = el.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.top - tipRect.height - 6;

    // Keep on screen
    if (left < 4) left = 4;
    if (left + tipRect.width > window.innerWidth - 4)
      left = window.innerWidth - tipRect.width - 4;
    if (top < 4) top = rect.bottom + 6; // flip below if no room above

    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.opacity = "1";
  });
}

function hideTip() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  currentBtn = null;
  if (tipEl) {
    tipEl.style.opacity = "0";
    tipEl.style.display = "none";
  }
}

export function initBtnTips() {
  document.addEventListener(
    "mouseenter",
    (e) => {
      const btn = e.target.closest?.("button");
      if (!btn) return;
      hideTip();
      currentBtn = btn;
      hoverTimer = setTimeout(() => {
        if (currentBtn === btn) showTip(btn);
      }, HOVER_DELAY);
    },
    true,
  );

  document.addEventListener(
    "mouseleave",
    (e) => {
      const btn = e.target.closest?.("button");
      if (!btn) return;
      if (btn === currentBtn) hideTip();
    },
    true,
  );

  // Also hide on click (user acted)
  document.addEventListener("click", () => hideTip(), true);
}
