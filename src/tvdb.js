import * as srvr from "./srvr.js";
import * as util from "./util.js";
import * as urls from "./urls.js";
import * as emby from "./emby.js";

let theTvdbToken = null;
let allTvdb      = null;

export const initAllTvdb = (allTvdbIn) => {
  allTvdb = allTvdbIn;
}

///////////// get api token //////////////
 
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

///////////// get remote (name and url) //////////////

const getRemote = async (tvdbRemote, showName) => {
  let {id, type} = tvdbRemote;
  let url     = null;  
  let ratings = null;
  let urlRatings, name;
  switch (type) {
    case 2:  
      name = 'IMDB';
      url  = `https://www.imdb.com/title/${id}`;
      urlRatings = await srvr.getUrls(
            `2||${url}?search=${encodeURI(id)}||${showName}`);
      ratings = urlRatings?.ratings;
      break;

    case 4:  name = 'Official Website'; url = id; break;

    // case 7:   url = `https://www.reddit.com/r/${id}`; break;
    // case 8:   url = id; name = 'Instagram'; break;
    // case 9:   url = `https://www.instagram.com/${id}`; break;
    // case 11:  url = `https://www.youtube.com/channel/${id}`; break;
    // case 12: name = 'The Movie DB';
    //           url = `https://www.themoviedb.org/tv/${id}` +
    //                 `?language=en-US`;
    //          break;
    // case 13: name = 'EIDR'; continue;

    case 18: 
      name = 'Wikipedia';
      urlRatings = await srvr.getUrls(
            `18||https://www.wikidata.org/wiki/${id}||${showName}`);
      url = urlRatings?.url;
      break;
      
    // case 19: url = `https://www.tvmaze.com/shows/${id}`; break;

    case 99:  
      url = `https://www.rottentomatoes.com/search` +
                    `?search=${encodeURI(id)}`;
      urlRatings = await srvr.getUrls(`99||${url}||${showName}`);
      name = urlRatings?.name;
      url  = urlRatings?.url;
      // console.log(`getRemote rotten name url: ${name}, ${url}`);
      break;
    default: return null;
  }
  
  if(!url) {
    // console.log(`getRemote, no url: ${name}`);
    return null;
  }
  if(url.startsWith('no match:')) {
    // console.log(`getRemote, no match: ${name}`);
    return null;
  }
  // console.log(`getRemote`, {name, url, ratings});
  return {name, url, ratings};
}

///////////// get remotes  //////////////

export const getRemotes = async (show) => {
  const showName = show.Name;
  const showId   = show.Id;
  if(!showId) {
    console.error(`getRemotes, no showId:`, {show});
    return null;
  }
  let remotes = await srvr.getRemotes(showName);
  if(remotes && !remotes.noMatch) return [remotes, true];

  remotes = [];

  if(!showId.startsWith("noemby-")) remotes[0] = 
            {name:'Emby', url: urls.embyPageUrl(showId)};

  const tvdbdata = await getTvdbData(show);
  if(tvdbdata) {
    const remoteIds = tvdbdata.tvdbRemotes;
    if(!remoteIds) {
      console.error(`getRemotes, no remoteIds: ${showName}`);
      return null;
    }

    const remotesByName = {};
    for(const tvdbShowId of remoteIds) {
      const remote = await getRemote(tvdbShowId, showName);
      if(remote) {
        if(!remote.ratings) delete remote.ratings;
        remotesByName[remote.name] = remote;
      }
    }

    const imdbRemote = remotesByName["IMDB"];
    if(imdbRemote) {
      imdbRemote.name += (imdbRemote.ratings !== undefined) ?
                   ' (' + imdbRemote.ratings + ')' : '';
      remotes.push(imdbRemote);
    } 

    for(const [name, remote] of Object.entries(remotesByName)) {
      if(name !== "IMDB" && name !== "Rotten Tomatoes")
        remotes.push(remote);
    }
  }
  const rottenRemote = await getRemote(
        {id:showName, type:99}, showName);
  if(rottenRemote) remotes.push(rottenRemote);

  const encoded = encodeURI(showName).replaceAll('&', '%26');
  const url = `https://www.google.com/search` +
               `?q=${encoded}%20tv%20show`;
  remotes.push({name:'Google', url});

  srvr.addRemotes(showName + '|||' + JSON.stringify(remotes));
  return [remotes, false];
}

// export const setGetRemotes = async (show) => {
//   const name       = show.Name;
//   const tvdbData   = await getTvdbData(show);
//   const tvdbRemote = tvdbData?.tvdbRemotes?.find(
//                         (rem) => rem.sourceName == "IMDB");
//   if(!tvdbRemote) return null;

//   const remotes = await srvr.getRemotes(name);
//   const remote  = await getRemote(tvdbRemote, name);
//   if(!remote || !remotes) return null;

//   const {url, ratings} = remote;
//   const imdbRemote = {name:`IMDB (${ratings})`, ratings, url};
//   remotes[name]    = imdbRemote;
//   await srvr.addRemotes(
//               name + '|||' + JSON.stringify(remotes));
//   return remotes;
// }

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

//////////// get TvDb Data //////////////

export const getTvdbData = async (show) => {
  const name     = show.Name;
  let   tvdbData = allTvdb[name];
  if(tvdbData) return tvdbData;

  const tvdbId = show.TvdbId;
  if(!tvdbId) {
    console.error(`getTvdbData error, no tvdbId:`, name, {show});
    return null;
  }
  
  if(!theTvdbToken) await getToken();
  
  let extRes, extUrl;
  try{
    extUrl = 
      `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
    extRes = await fetch(extUrl,
                  {headers: {
                      'Content-Type': 'application/json',
                        Authorization:'Bearer ' + theTvdbToken
                  }});
    if (!extRes.ok) {
      console.error(`getTvdbData, extended status:`, 
                        show.Name, {extUrl, extRes});
      return null;
    }
  } catch(err) {  
    console.error('getTvdbData, extended caught:', show.Name, 
                      {extUrl, extRes, err});
    return null;
  }
  const {seasonCount, episodeCount, watchedCount} = 
              await emby.getEpisodeCounts(show);
  const extResObj  = await extRes.json();
  const {firstAired, lastAired, image, score,
         originalCountry, originalLanguage, overview,
         remoteIds:tvdbRemotes, status:statusIn,
         seasons:seasonsIn, averageRuntime,
         originalNetwork:originalNetworkIn} 
            = extResObj.data;
  let originalNetwork = 
    originalNetworkIn?.name || '';
  const status   = statusIn.name; // e.g. Ended
  let numSeasons = 0;
  seasonsIn.forEach((season) => {
    numSeasons = Math.max(numSeasons, +season.number);
  });
  const saved = Date.now();
  tvdbData = { tvdbId, name, saved, originalNetwork,
               seasonCount, episodeCount, watchedCount,
               image, score, overview, 
               firstAired, lastAired, averageRuntime,
               originalCountry, originalLanguage,
               tvdbRemotes, status};
  delete tvdbData.deleted;
    if(!tvdbData.image) {
      alert('no image in tvdbData');
      return;
    }
  srvr.addTvdb(JSON.stringify(tvdbData));
  allTvdb[name] = tvdbData;
  // console.log('getTvdbData:', {tvdbData});
  return tvdbData;
}

export const updateTvdbData = async (tvdbData) => {
  console.log('updateTvdbData:', tvdbData);
    if(!tvdbData.image) {
      alert('no image in tvdbData');
      return;
    }
  allTvdb[tvdbData.name] = tvdbData;
  srvr.addTvdb(tvdbData);
}

export const markTvdbDeleted = 
  async (showName, markDelete) => {
    const tvdbData = allTvdb[showName];
    if(!tvdbData) return;
    if(markDelete) tvdbData.deleted = util.dateWithTZ();
    else    delete tvdbData.deleted;
    const str = JSON.stringify(tvdbData);
    // console.log('markTvdbDeleted:', 
    //     {showName, markDelete, str: str.substring(-100, 100)});
    if(!tvdbData.image) {
      alert('no image in tvdbData');
      return;
    }
    await srvr.addTvdb(str);
    allTvdb[showName] = tvdbData;
  };

//////////// get waitStr //////////////

export async function getWaitStr(show) {
  let waitStr = '';
  try {
    const tvdbData = await getTvdbData(show);
    if(tvdbData) {
      const lastAired = tvdbData.lastAired;
      if(!lastAired) return '';
      const lastAiredDay  = lastAired;
      const lastAiredNoYr = lastAired.slice(5).replace(/^0/, ' ');  
      const today = util.fmtDate(0);
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