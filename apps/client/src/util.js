import * as emby from "./emby.js";
import * as tvdb from "./tvdb.js";
import * as srvr from "./srvr.js";

////////// Build seriesMap object from seriesMapIn array //////////
export function buildSeriesMap(seriesMapIn) {
  if (!seriesMapIn || seriesMapIn.length === 0) {
    return null;
  }

  const seriesMap = {};
  for (const season of seriesMapIn) {
    const [seasonNum, episodes] = season;
    const seasonMap = {};
    seriesMap[seasonNum] = seasonMap;
    for (const episode of episodes) {
      const [episodeNum, epiObj] = episode;
      seasonMap[episodeNum] = epiObj;
    }
  }

  return seriesMap;
}

// Get current date in PST timezone as YYYY-MM-DD string
export function getPstDate() {
  return new Date()
    .toLocaleString("en-CA", {
      timeZone: "America/Los_Angeles",
    })
    .slice(0, 10);
}

export function dateWithTZ(date = new Date(), utcOut = false) {
  let year, month, day;
  if (utcOut) {
    year = date.getUTCFullYear();
    month = String(date.getUTCMonth() + 1).padStart(2, "0");
    day = String(date.getUTCDate()).padStart(2, "0");
  } else {
    year = date.getFullYear();
    month = String(date.getMonth() + 1).padStart(2, "0");
    day = String(date.getDate()).padStart(2, "0");
  }
  return `${year}-${month}-${day}`;
}

export function fmtDate(dateIn, includeYear = true, utcIn = false) {
  let date;
  if (dateIn === undefined) date = new Date();
  else if (dateIn instanceof Number)
    date = new Date(
      dateIn + (utcIn ? Date.getTimezoneOffset() * 60 * 1000 : 0),
    );
  else date = new Date(dateIn);
  const startIdx = includeYear ? 0 : 5;
  const str = dateWithTZ(date);
  const res = str.slice(startIdx, 10).replace(/^0/, " ");
  return res;
}

export function fmtSize(show) {
  if (show.inEmby === false) return "";
  const size = show.size;
  if (size < 1e3) return size;
  if (size < 1e6) return Math.round(size / 1e3) + "K";
  if (size < 1e9) return Math.round(size / 1e6) + "M";
  return Math.round(size / 1e9) + "G";
}

export function parseHumanSizeToBytes(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === "number") return value;

  const s = String(value).trim();
  if (!s) return NaN;

  // Support formats like: "1.23 GB", "690 MB", "123 KB", "999 B", plus IEC variants.
  const m = s.match(/^([\d.]+)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)?$/i);
  if (!m) return NaN;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return NaN;

  const unit = String(m[2] || "B").toUpperCase();
  const mul = {
    B: 1,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  };

  const factor = mul[unit] || 1;
  return n * factor;
}

export function fmtBytesSize(value) {
  if (value === undefined || value === null) return "";

  const bytes =
    typeof value === "string" ? parseHumanSizeToBytes(value) : Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) {
    // If it was a string but didn't match our parser, keep it as-is.
    return typeof value === "string" ? value : "";
  }

  // Requested formatting rules:
  // - 1.234 GB when size >= 1e9
  // - else 123 MB when size >= 1e7
  // - else 123 KB when size >= 1e4
  // - else 123 B
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(3)} GB`;
  if (bytes >= 1e7) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e4) return `${Math.round(bytes / 1e3)} KB`;
  return `${Math.round(bytes)} B`;
}

export function setCondFltr(cond, fltrChoice) {
  let tmp = {};
  switch (fltrChoice) {
    case "All":
      tmp.unplayed = 0;
      tmp.gap = 0;
      tmp.ended = 0;
      tmp.waiting = 0;
      tmp.drama = 0;
      tmp.foreign = 0;
      tmp.totry = 0;
      tmp.continue = 0;
      tmp.mark = 0;
      tmp.linda = 0;
      tmp.ban = 0;
      tmp.hasemby = 0; // Show both emby and non-emby shows by default
      tmp.full = 0;
      tmp.haveSubs = 0;
      break;

    case "Try Drama":
      tmp.foreign = 0;
      tmp.unplayed = 1;
      tmp.gap = 0;
      tmp.ended = 0;
      tmp.waiting = -1;
      tmp.drama = 1;
      tmp.foreign = 0;
      tmp.totry = 1;
      tmp.continue = 0;
      tmp.mark = -1;
      tmp.linda = -1;
      tmp.ban = -1;
      tmp.hasemby = 1;
      tmp.full = 0;
      tmp.haveSubs = 0;
      break;

    case "Watching":
      tmp.unplayed = 1;
      tmp.gap = 0;
      tmp.ended = 0;
      tmp.waiting = 0;
      tmp.drama = 0;
      tmp.foreign = 0;
      tmp.totry = -1;
      tmp.continue = -1;
      tmp.mark = -1;
      tmp.linda = -1;
      tmp.ban = -1;
      tmp.hasemby = 0;
      tmp.full = 0;
      tmp.haveSubs = 0;
      break;

    case "Needs Files":
      tmp.unplayed = -1;
      tmp.gap = 0;
      tmp.ended = 0;
      tmp.waiting = -1;
      tmp.drama = 0;
      tmp.foreign = 0;
      tmp.totry = 0;
      tmp.continue = 0;
      tmp.mark = 0;
      tmp.linda = 0;
      tmp.ban = -1;
      tmp.hasemby = 1;
      tmp.full = -1;
      tmp.haveSubs = 0;
      break;

    case "Finished":
      tmp.unplayed = 0;
      tmp.gap = 0;
      tmp.ended = 0;
      tmp.waiting = 0;
      tmp.drama = 0;
      tmp.foreign = 0;
      tmp.totry = 0;
      tmp.continue = 0;
      tmp.mark = 0;
      tmp.linda = 0;
      tmp.ban = -1;
      tmp.hasemby = 1;
      tmp.full = 0;
      tmp.haveSubs = 0;
      break;
  }
  for (const condName in tmp) {
    if (cond.name == condName) {
      cond.filter = tmp[condName];
      return;
    }
  }
}

import {
  smartTitleMatch,
  parseFileSeasonEpisode,
  parseTitleFromFilename,
} from "@tv/share";

export { smartTitleMatch, parseFileSeasonEpisode, parseTitleFromFilename };

const EXTERNAL_TAB_NAME = "tv_external_page";

export function openExternalPage(url) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) return null;
  try {
    // Emby SPA ignores hash-only changes when reusing the tab.  Add a
    // cache-bust query param before the # so the browser does a full load.
    let navUrl = targetUrl;
    const hashIdx = targetUrl.indexOf("#");
    if (hashIdx > 0 && targetUrl.includes("#!/")) {
      const base = targetUrl.slice(0, hashIdx);
      const hash = targetUrl.slice(hashIdx);
      const sep = base.includes("?") ? "&" : "?";
      navUrl = `${base}${sep}_t=${Date.now()}${hash}`;
    }
    const win = window.open(navUrl, EXTERNAL_TAB_NAME);
    if (!win) return null;
    try {
      win.focus();
    } catch {}
    return win;
  } catch {
    return null;
  }
}

export function openNewTab(url) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) return null;
  try {
    return window.open(targetUrl, "_blank");
  } catch {
    return null;
  }
}

export function wrapFileName(name, maxLen = 79) {
  if (!name || name.length <= maxLen) return name;
  const lines = [];
  let remaining = name;
  while (remaining.length > maxLen) {
    // Try whitespace first
    let idx = remaining.lastIndexOf(" ", maxLen);
    if (idx > 0) {
      lines.push(remaining.slice(0, idx));
      remaining = remaining.slice(idx + 1);
      continue;
    }
    // Try period
    idx = remaining.lastIndexOf(".", maxLen - 1);
    if (idx > 0) {
      lines.push(remaining.slice(0, idx + 1));
      remaining = remaining.slice(idx + 1);
      continue;
    }
    // Fall back: break anywhere
    lines.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  if (remaining) lines.push(remaining);
  return lines.join("\n");
}
