import {MovieDb} from "moviedb-promise ";
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
    
    const { showName, year } = data;
    
    console.log('[tmdb] getTmdb called with:', { showName, year });
    
    moviedb
      .searchMovie({ query: 'Alien' })
      .then((res) => {
        console.log(res);
      })
      .catch(console.error)
      ;(async function () {
        try {
          const res = await moviedb.searchMovie({ query: 'alien' })
          console.log(res)
        } catch (e) {
          console.log(e)
        }
      })()

      resolve([id, true]);
    
  } catch (error) {
    console.error('[tmdb] getTmdb error:', error);
    reject([id, `getTmdb error: ${error.message}`]);
  }
}
