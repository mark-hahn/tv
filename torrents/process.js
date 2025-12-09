import ptt from 'parse-torrent-title';

/**
 * Extract release group from title if parser missed it
 * @param {string} title - Torrent title
 * @returns {string|null} Release group name
 */
function extractGroup(title) {
  // Match patterns like: -GROUP, [GROUP], (GROUP), or ending with GROUP
  // Order matters - check brackets first as they're most specific
  const patterns = [
    /\[([A-Z][A-Za-z0-9]+)\]$/,            // Ends with [TAoE] - highest priority
    /[-\s]([A-Z][A-Za-z0-9]+)\)?$/,        // Ends with -SiGMA or EDGE2020) or EDGE2020
    /\(([A-Z][A-Za-z0-9]+)\)$/,            // Ends with (GROUP)
    /\b([A-Z][A-Za-z0-9]+)$/               // Last word that starts with uppercase
  ];
  
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Handle torrent selection
 * @param {Object} torrent - The selected torrent object
 * @returns {Object} Response object with status
 */
export function selTorrent(torrent) {
  const parsed = ptt.parse(torrent.title);
  let groupSrc = 'parse';
  
  // Only extract group manually if parser didn't find one
  if (!parsed.group) {
    const manualGroup = extractGroup(torrent.title);
    if (manualGroup) {
      parsed.group = manualGroup;
      groupSrc = 'calc';
    }
  }
  
  // Convert group to uppercase
  if (parsed.group) {
    parsed.group = parsed.group.toUpperCase();
  }
  
  const output = {
    parsed,
    groupSrc,
    raw: torrent
  };
  console.log('Torrent:', JSON.stringify(output, null, 2));
  
  // TODO: Add torrent processing 
  
  return { status: 'ok' };
}
