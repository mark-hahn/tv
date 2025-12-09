import fs from 'fs';
import path from 'path';
import { normalize } from './normalize.js';

const DUMP_SAMPLE_TORRENTS = false;

/**
 * Handle torrent selection
 * @param {Object} torrent - The selected torrent object (can be raw or already normalized)
 * @param {string} showName - The show name passed from the client
 * @returns {Object} Response object with status
 */
export function selTorrent(torrent, showName) {
  // If torrent is already normalized (has 'raw' field), use it directly
  // Otherwise normalize it
  const output = torrent.raw ? torrent : normalize(torrent, showName);
  
  console.log('Torrent:', JSON.stringify(output, null, 2));
  
  // Write sample file based on provider
  if (DUMP_SAMPLE_TORRENTS) {
    const rawTorrent = torrent.raw || torrent;
    const provider = rawTorrent.provider;
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
