// Configuration
// Prod nginx endpoints.
const TV_API_URL = "https://hahnca.com/tv-api";
const TV_SRVR_URL = "https://hahnca.com/tv-srvr";
const TV_DOWN_URL = "https://hahnca.com/tv-down";
const TV_TV_URL = "https://hahnca.com/tv-tv";
// hvac2, which owns the doorbell camera. The tv pane's Door key is one request
// to this and keeps no state: hvac2 knows whether a view is up, and it owns
// the rule that the camera never shows on the wall tablet and the television
// at the same time. See docs/tv-videostream-contract.md.
const RING_URL = "https://hahnca.com/ring";

export const config = {
  torrentsApiUrl: TV_API_URL,
  tvSrvrUrl: TV_SRVR_URL,
  tvDownUrl: TV_DOWN_URL,
  tvTvUrl: TV_TV_URL,
  ringUrl: RING_URL,
};
