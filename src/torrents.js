// Torrent management module
// Handles setTorrents and getTorrent commands from web client

let torrentStore = new Map(); // Store torrents by ID
let nextTorrentId = 1;

/**
 * Receive torrents from client, assign IDs, and return filtered subset
 * @param {number} id - WebSocket message ID
 * @param {Array} param - Array of torrent objects from client
 * @param {Function} resolve - Success callback
 * @param {Function} reject - Error callback
 */
export function setTorrents(id, param, resolve, reject) {
  try {
    if (!Array.isArray(param)) {
      reject([id, 'setTorrents: param must be an array']);
      return;
    }

    console.log(`[torrents] Received ${param.length} torrents from client`);

    // Assign unique torrentId to each torrent and store
    const torrentsWithIds = param.map(torrent => {
      const torrentId = nextTorrentId++;
      const torrentWithId = {
        ...torrent,
        torrentId
      };
      
      // Store in map for later retrieval
      torrentStore.set(torrentId, torrentWithId);
      
      return torrentWithId;
    });

    console.log(`[torrents] Assigned IDs ${torrentsWithIds[0]?.torrentId} - ${torrentsWithIds[torrentsWithIds.length - 1]?.torrentId}`);

    // For now, return all torrents (no filtering)
    // TODO: Filter/sort by quality, seeds, size, tags, etc.
    resolve([id, { torrents: torrentsWithIds }]);

  } catch (error) {
    console.error('[torrents] setTorrents error:', error);
    reject([id, `setTorrents error: ${error.message}`]);
  }
}

/**
 * Retrieve full torrent data by ID
 * @param {number} id - WebSocket message ID
 * @param {number} param - torrentId to retrieve
 * @param {Function} resolve - Success callback
 * @param {Function} reject - Error callback
 */
export function getTorrent(id, param, resolve, reject) {
  try {
    const torrentId = param;
    
    console.log(`[torrents] getTorrent called with ID: ${torrentId}`);
    console.log(`[torrents] Request data:`, param);

    if (!torrentStore.has(torrentId)) {
      reject([id, `Torrent not found: ${torrentId}`]);
      return;
    }

    const torrent = torrentStore.get(torrentId);
    
    console.log(`[torrents] Returning torrent:`, torrent);

    resolve([id, { torrent }]);

  } catch (error) {
    console.error('[torrents] getTorrent error:', error);
    reject([id, `getTorrent error: ${error.message}`]);
  }
}

/**
 * Clear all stored torrents (optional utility function)
 */
export function clearTorrents() {
  torrentStore.clear();
  nextTorrentId = 1;
  console.log('[torrents] Store cleared');
}
