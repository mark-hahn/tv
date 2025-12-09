import ptt from 'parse-torrent-title';

/**
 * Handle torrent selection
 * @param {Object} torrent - The selected torrent object
 * @returns {Object} Response object with status
 */
export function selTorrent(torrent) {
  const parsed = ptt.parse(torrent.title);
  console.log('Parsed torrent:', parsed);
  
  // TODO: Add torrent processing 
  
  return { status: 'ok' };
}
