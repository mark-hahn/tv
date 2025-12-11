import ptt from 'parse-torrent-title';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extract release group from title if parser missed it
 * @param {string} title - Torrent title
 * @returns {string|null} Release group name
 */
function extractGroup(title) {
  // Remove common suffixes that aren't groups
  let cleaned = title
    .replace(/\s*\[no rar\]\s*$/i, '')           // Remove [no rar] suffix
    .replace(/\s*\[req\]\s*/i, '')               // Remove [req] prefix/suffix
    .trim();
  
  // Common codecs, tags, and scene markers that are NOT release groups
  const excludedTerms = new Set([
    // Codecs
    'X264', 'X265', 'H264', 'H265', 'HEVC', 'AVC', 'XVID', 'DIVX', 'VP9', 'AV1',
    // Common endings
    'X0R', 'SCENE', 'NO', 'RAR', 'COMPLETE', 'BLURAY', 'WEBRIP', 'WEBDL',
    'HDTV', 'BDRIP', 'DVDRIP', 'PROPER', 'REPACK', 'INTERNAL', 'LIMITED',
    'MKV', 'MP4', 'AVI', 'WEB', 'DL',
    // Quality indicators
    '720P', '1080P', '2160P', '480P', '576P', '4K', 'UHD'
  ]);
  
  // Match patterns like: -GROUP, [GROUP], (GROUP), or ending with GROUP
  // Order matters - check brackets first as they're most specific
  const patterns = [
    /\[([A-Z][A-Za-z0-9]+)\]$/,            // Ends with [TAoE] - highest priority
    /[-\s]([A-Z][A-Za-z0-9]+)\)?$/,        // Ends with -SiGMA or EDGE2020) or EDGE2020
    /\(([A-Z][A-Za-z0-9]+)\)$/,            // Ends with (GROUP)
    /\b([A-Z][A-Za-z0-9]+)$/               // Last word that starts with uppercase
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
  const parsed = ptt.parse(trimmedTitle);
  let groupSrc = 'parse';
  let group = null;
  
  // Get group from parser or extract manually
  if (parsed.group) {
    group = parsed.group.toUpperCase();
    groupSrc = 'parse';
  } else {
    const manualGroup = extractGroup(trimmedTitle);
    if (manualGroup) {
      group = manualGroup.toUpperCase();
      groupSrc = 'calc';
    } else {
      // Log to bad-groups file
      const badGroupsFile = path.join(__dirname, '..', '..', 'sample-torrents', 'bad-groups-live.txt');
      const timestamp = new Date().toISOString();
      const entry = `${timestamp}\nTitle: ${trimmedTitle}\n\n`;
      try {
        fs.appendFileSync(badGroupsFile, entry, 'utf8');
      } catch (err) {
        console.error('Failed to write to bad-groups-live.txt:', err.message);
      }
    }
  }
  
  // Clean and compare titles with multiple strategies
  const applyBase = (title) => {
    return title
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // Remove diacritics
      .trim()                           // Trim whitespace
      .replace(/\s+/g, ' ')             // Collapse whitespace to single space
      .replace(/\b(and|the)\b/gi, '')   // Remove words "and" and "the"
      .replace(/\s+/g, ' ')             // Collapse whitespace again
      .trim()                           // Trim again
      .toUpperCase();                   // Convert to uppercase
  };
  
  const cleanVariations = (title) => {
    return [
      // 1) Just base changes
      applyBase(title),
      
      // 2) Remove paren chars at end leaving contents
      applyBase(title.replace(/\(([^)]+)\)\s*$/, '$1')),
      
      // 3) Remove paren chars at end including contents
      applyBase(title.replace(/\([^)]+\)\s*$/, '')),
      
      // 4) Remove any non alphanum chars
      applyBase(title.replace(/[^a-zA-Z0-9\s]/g, '')),
      
      // 5) Change 2 and remove any non alphanum chars
      applyBase(title.replace(/\(([^)]+)\)\s*$/, '$1').replace(/[^a-zA-Z0-9\s]/g, '')),
      
      // 6) Change 3 and remove any non alphanum chars
      applyBase(title.replace(/\([^)]+\)\s*$/, '').replace(/[^a-zA-Z0-9\s]/g, ''))
    ];
  };
  
  const parsedVariations = cleanVariations(parsed.title);
  const showNameVariations = cleanVariations(showName);
  
  // Check if any variation matches
  let nameMatch = false;
  for (const parsedVar of parsedVariations) {
    for (const showVar of showNameVariations) {
      if (parsedVar === showVar) {
        nameMatch = true;
        break;
      }
    }
    if (nameMatch) break;
  }
  
  return {
    parsed,
    group,
    groupSrc,
    nameMatch,
    clientTitle: showName,
    raw: torrent
  };
}
