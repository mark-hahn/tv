import ptt from 'parse-torrent-title';

/**
 * Handle torrent selection
 * @param {Object} torrent - The selected torrent object
 * @returns {Object} Response object with status
 */
export function selTorrent(torrent) {
  const parsed = ptt.parse(torrent.title);
  const output = {
    parsed,
    raw: torrent
  };
  console.log('Torrent:', JSON.stringify(output, null, 2));
  
  // TODO: Add torrent processing 
  
  return { status: 'ok' };
}
