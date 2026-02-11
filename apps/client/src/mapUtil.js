// Map data compression utilities
// Reduces tvdb record size from ~18K to ~3K per show

// Bitfield flags for episode properties
const FLAG_ERROR = 1;
const FLAG_PLAYED = 2;
const FLAG_AVAIL = 4;
const FLAG_NOFILE = 8;
const FLAG_UNAIRED = 16;
const FLAG_DELETED = 32;

/**
 * Compress map data for storage
 * Converts: [episodeNum, {error, played, avail, noFile, unaired, deleted, path}]
 * To: [episodeNum, flags, path?]
 */
export function compressMap(seriesMap) {
  if (!seriesMap || !Array.isArray(seriesMap)) return seriesMap;

  return seriesMap.map(([seasonNum, episodes]) => {
    const compressedEpisodes = episodes.map(([episodeNum, epiObj]) => {
      let flags = 0;
      if (epiObj.error) flags |= FLAG_ERROR;
      if (epiObj.played) flags |= FLAG_PLAYED;
      if (epiObj.avail) flags |= FLAG_AVAIL;
      if (epiObj.noFile) flags |= FLAG_NOFILE;
      if (epiObj.unaired) flags |= FLAG_UNAIRED;
      if (epiObj.deleted) flags |= FLAG_DELETED;

      // Only include path if episode is available
      if (epiObj.avail && epiObj.path) {
        return [episodeNum, flags, epiObj.path];
      }
      return [episodeNum, flags];
    });

    return [seasonNum, compressedEpisodes];
  });
}

/**
 * Decompress map data from storage
 * Converts: [episodeNum, flags, path?]
 * To: [episodeNum, {error, played, avail, noFile, unaired, deleted, path}]
 */
export function decompressMap(compressedMap) {
  if (!compressedMap || !Array.isArray(compressedMap)) return compressedMap;

  return compressedMap.map(([seasonNum, episodes]) => {
    const decompressedEpisodes = episodes.map((episode) => {
      const [episodeNum, flags, path] = episode;

      const epiObj = {
        error: !!(flags & FLAG_ERROR),
        played: !!(flags & FLAG_PLAYED),
        avail: !!(flags & FLAG_AVAIL),
        noFile: !!(flags & FLAG_NOFILE),
        unaired: !!(flags & FLAG_UNAIRED),
        deleted: !!(flags & FLAG_DELETED),
      };

      // Add path if it exists
      if (path) {
        epiObj.path = path;
      }

      return [episodeNum, epiObj];
    });

    return [seasonNum, decompressedEpisodes];
  });
}
