import * as srvr from "./srvr.js";
import * as util from "./util.js";
import * as urls from "./urls.js";
import      Fuse from 'fuse.js'

const tvdbDataCacheName = "tvdbDataCache2";

let showErr      = null;
let theTvdbToken = null;

export const init = (showErrIn) => {
  showErr = showErrIn;
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
  if(!tvdbdata) {
    console.error(`getRemotes, no tvdbdata: ${showName}`);
    return null;
  }
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
    imdbRemote.name += ' (' + imdbRemote.ratings + ')';
    remotes.push(imdbRemote);
  } 
  const rottenRemote = await getRemote(
        {id:showName, type:99}, showName);
  if(rottenRemote) remotes.push(rottenRemote);

  for(const [name, remote] of Object.entries(remotesByName)) {
    if(name !== "IMDB" && name !== "Rotten Tomatoes")
      remotes.push(remote);
  }

  remotes.push({name:'Google', 
                 url: `https://www.google.com/search` +
                      `?q=${encodeURI(showName)}%20tv%20show`});

  srvr.addRemotes(showName + '|||' + JSON.stringify(remotes));
  return [remotes, false];
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
  
  // todo -- popup identify choice

  // console.log('srchTvdbData:', {searchStr}, data);
  
  const fuseOptions = {includeScore: true, keys: ['name']}
  const fuse = new Fuse(data, fuseOptions);
  const fuseRes = fuse.search(searchStr);
  let minScore = Math.min();
  let matchRes = null;
  for(const res of fuseRes) {
    if(res.score < minScore) {
      minScore = res.score;
      matchRes = res.item;
    } 
  }
  if(!matchRes)  matchRes = data[0];
  const name   = matchRes.name;
  const tvdbId = matchRes.tvdb_id;
  const show = {Name:name, 
                ProviderIds: {Tvdb: tvdbId}};
  return await getTvdbData(show);
}

//////////// get TvDb Data //////////////

export const getTvdbData = async (show) => {
  const name = show.Name;
  let tvdbData = await srvr.getTvdb(name);
  if(tvdbData && !tvdbData.noMatch) {
    // console.log("getTvdbData, from cache:", {nameIn});
    const twoDays = 48*60*60*1000;
    if ((Date.now() - tvdbData.saved) < 
        (twoDays + Math.round(Math.random() * twoDays))) {
      return tvdbData;
    }
    else await srvr.delTvdb(show.Name);
  }

  if(!theTvdbToken) await getToken();

  const tvdbId = show?.ProviderIds?.Tvdb;
  if(!tvdbId) {
    console.error(`getTvdbData, no tvdbId:`, {show});
    return null;
  }
  show.TvdbId = tvdbId;

  const extUrl = 
    `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
  const extRes = await fetch(extUrl,
                {headers: {
                    'Content-Type': 'application/json',
                      Authorization:'Bearer ' + theTvdbToken
                }});
  if (!extRes.ok) {
    console.error(`tvdb extended: ${extRes.status}`);
    return null;
  }
  const extResObj  = await extRes.json();
  const {firstAired, lastAired, nextAired, 
         remoteIds:tvdbRemotes, status:statusIn} = extResObj.data;
  const status = statusIn.name; // e.g. Ended
  const saved = Date.now();
  tvdbData = { tvdbId, name, status,
               firstAired, lastAired, nextAired, 
               tvdbRemotes, saved };
  srvr.addTvdb(JSON.stringify(tvdbData));
  return tvdbData;
}

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
      const today         = util.fmtDate(0);
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