import * as srvr from "./srvr.js";
import * as util from "./util.js";

let theTvdbToken = null;

let allTvdb = null;
export const getAllTvdb = async () => {
  // all data in tvdb.json
  // cached in allTvdb
  allTvdb ??= await srvr.getAllTvdb();
  return allTvdb;
}

///////////// get theTvdbToken //////////////
// this is a duplicate of the server
// both access tvdb.com independently
const getToken = async () => {
  const loginResp = await fetch(
    'https://api4.thetvdb.com/v4/login', 
    { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 
        JSON.stringify({
            "apikey": "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df",
            "pin": "HXEVSDFF"
        })
    }
  );
  if (!loginResp.ok) {
    console.error(`FATAL: TvDbToken Response: ${loginResp.status}`);
    process.exit();
  }
  const loginJSON = await loginResp.json();
  theTvdbToken = loginJSON.data.token;
}

//////////// search for TvDb Data //////////////

export const srchTvdbData = async (searchStr) => {
  if(!theTvdbToken) await getToken();
  const srchUrl = 'https://api4.thetvdb.com/v4/' +
                  'search?type=series&query='    + 
                   encodeURIComponent(searchStr);
  const srchRes = await fetch(srchUrl,
                    {headers: {
                      'Content-Type': 'application/json',
                      Authorization:'Bearer ' + theTvdbToken}
                    });
  if (!srchRes.ok) {
    console.error(`tvdb search error:`, {searchStr}, srchRes.status);
    return null;
  }
  const srchResObj = await srchRes.json();
  const data = srchResObj.data;
  if(!data || data.length == 0) return null;
  return data;
}

// export const markTvdbDeleted = 
//   async (showName, markDelete) => {
//     const tvdbData = allTvdb[showName];
//     if(!tvdbData) return;
//     if(markDelete) tvdbData.deleted = util.dateWithTZ();
//     else    delete tvdbData.deleted;
//     // console.log('markTvdbDeleted:', 
//     //     {showName, markDelete, str: str.substring(-100, 100)});
//     // if(!tvdbData.image) {
//     //   alert('no image in tvdbData');
//     //   return;
//     // }
//     // addTvdb can add or update tvdb.json
//     await srvr.addTvdb(tvdbData);
//     allTvdb[showName] = tvdbData;
//   };

//////////// get waitStr //////////////

export async function getWaitStr(show) {
  let waitStr = '';
  try {
    const tvdbData = await allTvdb[show.Name];
    if(tvdbData) {
      const lastAired = tvdbData.lastAired;
      if(!lastAired) return '';
      const lastAiredDay  = lastAired;
      const lastAiredNoYr = lastAired.slice(5).replace(/^0/, ' ');  
      const today = util.fmtDate();
      if(lastAiredDay >= today) waitStr = `{${lastAiredNoYr}}`;
      // console.log('getWaitStr:', show.Name, 
      //     {waitStr, lastAiredDay, lastAiredNoYr, today}); 
    }
  } 
  catch(e) { 
    console.error('getWaitStr, tvdb data error:', show.Name, e); 
    return '';
  }
  return waitStr; 
}

//////////// get episode data //////////////

export const getEpisode = async (showName, seasonNum, episodeNum) => {
  if (!theTvdbToken) await getToken();
  
  // Get series ID from allTvdb
  if (!allTvdb) await getAllTvdb();
  const tvdbData = allTvdb[showName];
  
  if (!tvdbData || !tvdbData.tvdbId) {
    console.error('getEpisode: no tvdbId found for show:', showName);
    return null;
  }
  
  const seriesId = tvdbData.tvdbId;
  
  // Fetch episodes for the series with season/episode filter
  const episodeUrl = `https://api4.thetvdb.com/v4/series/${seriesId}/episodes/default?season=${seasonNum}&episodeNumber=${episodeNum}`;
  
  const episodeRes = await fetch(episodeUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + theTvdbToken
    }
  });
  
  if (!episodeRes.ok) {
    console.error(`tvdb episode fetch error:`, {showName, seasonNum, episodeNum, status: episodeRes.status});
    return null;
  }
  
  const episodeResObj = await episodeRes.json();
  const episodes = episodeResObj.data?.episodes;
  
  if (!episodes || episodes.length === 0) {
    console.error('getEpisode: no episode found for:', {showName, seasonNum, episodeNum});
    return null;
  }
  
  // Return the first matching episode
  return episodes[0];
}