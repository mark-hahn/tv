import parseTorrentTitle from "parse-torrent-title";

/**
 * Extract season range from title (e.g., S01-S02, S1-S5, S1-2)
 * @param {string} title - Torrent title
 * @returns {Object|null} Object with startSeason, endSeason, and fullMatch, or null if not found
 */
function extractSeasonRange(title) {
  // Match patterns like:
  // - S01-S02, (S1-S5), (S1-2)
  // - seasons 1-2, season 1-2
  // - Season 1 2 3 4 5 (space-separated list)
  // with optional whitespace and case-insensitive.
  const patterns = [
    /s(\d{1,2})\s*-\s*(?:s\s*)?(\d{1,2})/i,
    /seasons?\s+(\d{1,2})\s*-\s*(\d{1,2})/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      const startSeason = parseInt(match[1], 10);
      const endSeason = parseInt(match[2], 10);

      return {
        startSeason,
        endSeason,
        fullMatch: match[0],
        isRange: true,
      };
    }
  }

  // Match space-separated season lists: "Season 1 2 3 4 5"
  const listMatch = title.match(/seasons?\s+(\d{1,2}(?:\s+\d{1,2})+)/i);
  if (listMatch) {
    const nums = listMatch[1].split(/\s+/).map(Number);
    return {
      startSeason: Math.min(...nums),
      endSeason: Math.max(...nums),
      fullMatch: listMatch[0],
      isRange: true,
    };
  }

  return null;
}

/**
 * Extract release group from title if parser missed it
 * @param {string} title - Torrent title
 * @returns {string|null} Release group name
 */
function extractGroup(title) {
  // Remove common suffixes that aren't groups
  let cleaned = title
    .replace(/\s*\[no rar\]\s*$/i, "") // Remove [no rar] suffix
    .replace(/\s*\[req\]\s*/i, "") // Remove [req] prefix/suffix
    .trim();

  // Common codecs, tags, and scene markers that are NOT release groups
  const excludedTerms = new Set([
    // Codecs
    "X264",
    "X265",
    "H264",
    "H265",
    "HEVC",
    "AVC",
    "XVID",
    "DIVX",
    "VP9",
    "AV1",
    // Common endings
    "X0R",
    "SCENE",
    "NO",
    "RAR",
    "COMPLETE",
    "BLURAY",
    "WEBRIP",
    "WEBDL",
    "HDTV",
    "BDRIP",
    "DVDRIP",
    "PROPER",
    "REPACK",
    "INTERNAL",
    "LIMITED",
    "MKV",
    "MP4",
    "AVI",
    "WEB",
    "DL",
    // Quality indicators
    "720P",
    "1080P",
    "2160P",
    "480P",
    "576P",
    "384P",
    "4K",
    "UHD",
  ]);

  // Match patterns like: -GROUP, [GROUP], (GROUP), or ending with GROUP
  // Order matters - check brackets first as they're most specific
  const patterns = [
    /\[([A-Z][A-Za-z0-9]+)\]$/, // Ends with [TAoE] - highest priority
    /[-\s]([A-Z][A-Za-z0-9]+)\)?$/, // Ends with -SiGMA or EDGE2020) or EDGE2020
    /\(([A-Z][A-Za-z0-9]+)\)$/, // Ends with (GROUP)
    /\b([A-Z][A-Za-z0-9]+)$/, // Last word that starts with uppercase
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const candidate = match[1].toUpperCase();
      if (!excludedTerms.has(candidate)) {
        return match[1];
      }
    }
  }
  return null;
}

/**
 * Normalize a torrent by parsing and matching against show name
 * @param {Object} torrent - The torrent object to normalize
 * @param {string} showName - The show name to match against
 * @returns {Object} Normalized torrent with parsed data and match status
 */
export function normalize(torrent, showName) {
  // Trim the title to handle trailing spaces
  const trimmedTitle = torrent.title.trim();
  const parsed = parseTorrentTitle.parse(trimmedTitle);

  // parse-torrent-title doesn't recognize NTSC/PAL as a resolution tag —
  // map them directly since they're standard SD source resolutions.
  if (!parsed.resolution) {
    if (/\bntsc\b/i.test(trimmedTitle)) parsed.resolution = "480p";
    else if (/\bpal\b/i.test(trimmedTitle)) parsed.resolution = "576p";
  }

  // Extract season range if present
  const seasonRange = extractSeasonRange(trimmedTitle);

  // (debug logging removed)
  let groupSrc = "parse";
  let group = null;

  // Get group from parser or extract manually
  if (parsed.group) {
    group = parsed.group.toUpperCase();
    groupSrc = "parse";
  } else {
    const manualGroup = extractGroup(trimmedTitle);
    if (manualGroup) {
      group = manualGroup.toUpperCase();
      groupSrc = "calc";
    }
  }

  // Clean and compare titles with multiple strategies
  const applyBase = (title) => {
    return title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
      .trim() // Trim whitespace
      .replace(/\s+/g, " ") // Collapse whitespace to single space
      .replace(/\b(and|the)\b/gi, "") // Remove words "and" and "the"
      .replace(/\s+/g, " ") // Collapse whitespace again
      .trim() // Trim again
      .toUpperCase(); // Convert to uppercase
  };

  const cleanVariations = (title) => {
    return [
      // 1) Just base changes
      applyBase(title),

      // 2) Remove paren chars at end leaving contents
      applyBase(title.replace(/\(([^)]+)\)\s*$/, "$1")),

      // 3) Remove paren chars at end including contents
      applyBase(title.replace(/\([^)]+\)\s*$/, "")),

      // 4) Remove any non alphanum chars
      applyBase(title.replace(/[^a-zA-Z0-9\s]/g, "")),

      // 5) Change 2 and remove any non alphanum chars
      applyBase(
        title.replace(/\(([^)]+)\)\s*$/, "$1").replace(/[^a-zA-Z0-9\s]/g, ""),
      ),

      // 6) Change 3 and remove any non alphanum chars
      applyBase(
        title.replace(/\([^)]+\)\s*$/, "").replace(/[^a-zA-Z0-9\s]/g, ""),
      ),

      // 7) Replace non alphanum chars with spaces (so "Five-Star" -> "Five Star",
      //    matching how providers/parsers turn punctuation into spaces)
      applyBase(title.replace(/[^a-zA-Z0-9\s]/g, " ")),

      // 8) Change 2 and replace non alphanum chars with spaces
      applyBase(
        title.replace(/\(([^)]+)\)\s*$/, "$1").replace(/[^a-zA-Z0-9\s]/g, " "),
      ),

      // 9) Change 3 and replace non alphanum chars with spaces
      applyBase(
        title.replace(/\([^)]+\)\s*$/, "").replace(/[^a-zA-Z0-9\s]/g, " "),
      ),
    ];
  };

  const parsedVariations = cleanVariations(parsed.title);
  const showNameVariations = cleanVariations(showName);

  // Check if any variation matches (exact or starts-with at word boundary)
  let nameMatch = false;
  for (const parsedVar of parsedVariations) {
    for (const showVar of showNameVariations) {
      if (parsedVar === showVar || parsedVar.startsWith(showVar + " ")) {
        nameMatch = true;
        break;
      }
    }
    if (nameMatch) break;
  }

  // Detect "Complete Series" torrents (no season but covers all seasons)
  const completeSeries =
    !parsed.season && /\bcomplete\s+series\b/i.test(trimmedTitle);

  return {
    parsed,
    seasonRange,
    completeSeries,
    group,
    groupSrc,
    nameMatch,
    clientTitle: showName,
    raw: torrent,
  };
}
