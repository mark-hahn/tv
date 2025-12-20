import {MovieDb} from "moviedb-promise";
const moviedb = new MovieDb('327192a334da700f65b882c7a69cb927');

/**
 * Get TMDB data for a TV show
 * @param {number} id - WebSocket message ID
 * @param {string} param - JSON string with {showName, year}
 * @param {Function} resolve - Success callback
 * @param {Function} reject - Error callback
 */
export async function getTmdb(id, param, resolve, reject) {
  try {
    // Parse JSON string if needed
    let data = param;
    if (typeof param === 'string') {
      try {
        data = JSON.parse(param);
      } catch (e) {
        reject([id, `getTmdb: failed to parse JSON: ${e.message}`]);
        return;
      }
    }
    
    const { showName, year, season, episode } = data;
    
    const res = await moviedb.searchTv({ query: showName });
    
    // Find show with matching original_name
    const matchingShow = res.results?.find(show => 
      show.original_name?.toLowerCase() === showName.toLowerCase() ||
      show.name?.toLowerCase() === showName.toLowerCase()
    );

    const showId = matchingShow?.id;

    if (!showId || !season || !episode) {
      resolve([id, matchingShow || null]);
      return;
    }

    // Get episode information
    const episodeInfo = await moviedb.episodeInfo({
      id: showId,
      season_number: parseInt(season),
      episode_number: parseInt(episode)
    });
    
    // Get guest actors (filter by known_for_department === "Acting")
    const guestActorList = episodeInfo.guest_stars?.filter(
      actor => actor.known_for_department === "Acting"
    ) || [];
    
    // Fetch images for each guest actor and add to their object
    for (const actorInfo of guestActorList) {
      try {
        const personImages = await moviedb.personImages({
          id: actorInfo.id
        });
        actorInfo.images = personImages;
      } catch (error) {
        console.error(`[tmdb] Failed to fetch images for ${actorInfo.name}:`, error.message);
        actorInfo.images = null;
      }
    }
    
    console.log('[tmdb] Guest actor list with images:', guestActorList);
    
    resolve([id, guestActorList]);
    
  } catch (error) {
    console.error('[tmdb] getTmdb error:', error);
    reject([id, `getTmdb error: ${error.message}`]);
  }
}
