import * as srvr from "./srvr.js";
import * as util from "./util.js";
import * as urls from "./urls.js";

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
    showErr(`FATAL: TvDbToken Response: ${loginResp.status}`);
    process.exit();
  }
  const loginJSON = await loginResp.json();
  theTvdbToken = loginJSON.data.token;
}

///////////// get remote (name and url) //////////////

const getRemote = async (tvdbRemote) => {
  let {id, type, sourceName:name} = tvdbRemote;
  let url     = null;  
  let ratings = null;
  let urlRatings;
  switch (type) {
    case 2:  
      name = 'IMDB';
      url  = `https://www.imdb.com/title/${id}`;
      urlRatings = await srvr.getUrls(`2||${url}` +
                       `?search=${encodeURI(id)}`);
      ratings = urlRatings.ratings;
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
                  `18||https://www.wikidata.org/wiki/${id}`);
      url = urlRatings.url;
      break;
      
    // case 19: url = `https://www.tvmaze.com/shows/${id}`; break;

    case 99:  
      url = `https://www.rottentomatoes.com/search` +
                    `?search=${encodeURI(id)}`;
      urlRatings = await srvr.getUrls(`99||${url}`);
      url = urlRatings.url;
      console.log(`getRemote, rotten: ` + `${name}, ${url}`);
      break;
    default: return null;
  }
  if(!url) {
    console.log(`getRemote, no url: ${name}`);
    return null;
  }
  if(url.startsWith('no match:')) {
    console.log(`getRemote, no match: ${name}`);
    return null;
  }
  console.log(`getRemote`, {name, url, ratings});
  return {name, url, ratings};
}

///////////// get remotes  //////////////

export const getRemotes = async (show) => {
  const showName = show.Name;
  const showId   = show.Id;
  let remotes = await srvr.getRemotes(showName);
  if(remotes && !remotes.noMatch) return [remotes, true];

  remotes = [];

  if(!showId.startsWith("noemby-"))
    remotes[0] = {name:'Emby', url: urls.embyPageUrl(showId)};

  const tvdbdata = await getTvdbData(showName);
  if(!tvdbdata) {
    console.log(`getRemotes, no tvdbdata: ${showName}`);
    return null;
  }
  const remoteIds = tvdbdata.tvdbRemotes;
  if(!remoteIds) {
    console.log(`getRemotes, no remoteIds: ${showName}`);
    return null;
  }

  const remotesByName = {};
  for(const tvdbShowId of remoteIds) {
    const remote = await getRemote(tvdbShowId);
    if(remote) {
      if(!remote.ratings) delete remote.ratings;
      remotesByName[remote.name] = remote;
    }
  }

  const imdbRemote = remotesByName["IMDB"];
  imdbRemote.name += ' (' + imdbRemote.ratings + ')';
  if(imdbRemote) remotes.push(imdbRemote);

  const rottenRemote = await getRemote(
        {id:showName, type:99, sourceName:"Rotten Tomatoes"});
  if(!rottenRemote.ratings) delete rottenRemote.ratings;
  if(rottenRemote) remotes.push(rottenRemote);

  for(const [name, remote] of Object.entries(remotesByName)) {
    if(name !== "IMDB" && name !== "Rotten Tomatoes")
      remotes.push(remote);
  }
  srvr.addRemotes(showName + '|||' + JSON.stringify(remotes));
  return [remotes, false];
}

//////////// get TvDb Data //////////////

export const getTvdbData = async (searchStr) => {
  const nameIn = searchStr;
  let tvdbData = await srvr.getTvdb(nameIn);
  if(tvdbData && !tvdbData.noMatch) {
    // console.log("getTvdbData, from cache:", {nameIn});
    const twoDays = 48*60*60*1000;
    if ((Date.now() - tvdbData.saved) < 
        (twoDays + Math.round(Math.random() * twoDays))) {
      return tvdbData;
    }
    else await srvr.delTvdb(nameIn);
  }

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
    showErr(`tvdb search:`, {searchStr}, srchRes.status);
    return null;
  }
  const srchResObj = await srchRes.json();
  if(!srchResObj.data[0]) return null;

  const name   = srchResObj.data[0].name;
  const tvdbId = srchResObj.data[0].tvdb_id;

  const extUrl = 
    `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
  const extRes = await fetch(extUrl,
                {headers: {
                    'Content-Type': 'application/json',
                      Authorization:'Bearer ' + theTvdbToken
                }});
  if (!extRes.ok) {
    showErr(`tvdb extended: ${extRes.status}`);
    return null;
  }

  let waitStr = '';
  const extResObj  = await extRes.json();
  const {firstAired, lastAired, nextAired, 
         remoteIds:tvdbRemotes, status:statusIn} = extResObj.data;
  const status = statusIn.name; // e.g. continuing

  let lastAiredTmp = lastAired;
  if(!lastAiredTmp) return null;
  const lastAiredDay  = util.fmtDate(lastAiredTmp);
  const lastAiredNoYr = util.fmtDate(lastAiredTmp, false);
  const today         = util.fmtDate();
  if(lastAiredNoYr && lastAiredDay >= today) 
                        waitStr = `{${lastAiredNoYr}}`;
  const saved = Date.now();

  tvdbData = {
      tvdbId, name, status,
      firstAired, lastAired, nextAired, 
      tvdbRemotes, waitStr, saved};
  console.log("tvdbData:", JSON.stringify(tvdbData, null, 2));
  srvr.addTvdb(JSON.stringify(tvdbData));
  return tvdbData;
}
