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
    
    console.log('[tmdb] getTmdb called with:', 
                { showName, year, season, episode});
    
    const res = await moviedb.searchTv({ query: showName });
    
    // Find show with matching original_name
    const matchingShow = res.results?.find(show => 
      show.original_name?.toLowerCase() === showName.toLowerCase() ||
      show.name?.toLowerCase() === showName.toLowerCase()
    );
    
    if (matchingShow) {
      console.log('[tmdb] Found matching show:', matchingShow);
    } else {
      console.log('[tmdb] No matching show found for:', showName);
      console.log('[tmdb] Available results:', res.results?.map(s => s.original_name));
    }

    const showId = matchingShow?.id;

    if (!showId || !season || !episode) {
      console.log('[tmdb] Missing showId, season, or episode:', { showId, season, episode });
      resolve([id, matchingShow || null]);
      return;
    }

    // Get episode information
    const episodeInfo = await moviedb.episodeInfo({
      id: showId,
      season_number: parseInt(season),
      episode_number: parseInt(episode)
    });
    
    console.log('[tmdb] Episode info:', episodeInfo);
    
    // Get guest actors (filter by known_for_department === "Acting")
    const guestActorList = episodeInfo.guest_stars?.filter(
      actor => actor.known_for_department === "Acting"
    ) || [];
    
    console.log(`[tmdb] Found ${guestActorList.length} guest actors`);
    
    // Fetch images for each guest actor
    for (const actorInfo of guestActorList) {
      console.log('[tmdb] Actor info:', actorInfo);
      
      try {
        const personImages = await moviedb.personImages({
          id: actorInfo.id
        });
        console.log(`[tmdb] Images for ${actorInfo.name}:`, personImages);
      } catch (error) {
        console.error(`[tmdb] Failed to fetch images for ${actorInfo.name}:`, error.message);
      }
    }
    
    resolve([id, episodeInfo]);
    
  } catch (error) {
    console.error('[tmdb] getTmdb error:', error);
    reject([id, `getTmdb error: ${error.message}`]);
  }
}
