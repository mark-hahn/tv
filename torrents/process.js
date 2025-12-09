import ptt from 'parse-torrent-title';
import fs from 'fs';
import path from 'path';

const DUMP_SAMPLE_TORRENTS = false;

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
 * @param {string} showName - The show name passed from the client
 * @returns {Object} Response object with status
 */
export function selTorrent(torrent, showName) {
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
  
  const output = {
    parsed,
    groupSrc,
    nameMatch,
    clientTitle: showName,
    raw: torrent
  };
  
  console.log('Torrent:', JSON.stringify(output, null, 2));
  
  // Write sample file based on provider
  if (DUMP_SAMPLE_TORRENTS) {
    const provider = torrent.provider;
    if (provider === 'IpTorrents' || provider === 'TorrentLeech') {
      const filename = provider === 'IpTorrents' ? 'iptorrents-sample.json' : 'torrentleech-sample.json';
      const samplePath = path.join(process.cwd(), '..', 'sample-torrents', filename);
      
      try {
        fs.writeFileSync(samplePath, JSON.stringify(output, null, 2));
      } catch (err) {
        console.error(`Error writing ${filename}:`, err.message);
      }
    }
  }
  
  // TODO: Add torrent processing 
  
  return { status: 'ok' };
}
