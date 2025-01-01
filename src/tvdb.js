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
      urlRatings = await srvr.getUrls(
              `99||https://www.rottentomatoes.com/search` +
              `?search=${encodeURI(id)}`);
      url     = urlRatings.url;
      ratings = urlRatings.ratings;
      console.log(`getRemote, rotten: ` +
                  `${name}, ${url}, ${ratings}`);
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

  const tvdbShowData = await getTvdbData(showName);
  if(!tvdbShowData) {
    console.log(`getRemotes, no tvdbShowData: ${showName}`);
    return null;
  }
  const {remoteIds: tvdbShowIds} = tvdbShowData;
  if(!tvdbShowIds || tvdbShowIds.noMatch) {
    console.log(`getRemotes, no tvdbShowIds: ${showName}`);
    return null;
  }

  const remotesByName = {};
  for(const tvdbShowId of tvdbShowIds) {
    const remote = await getRemote(tvdbShowId);
    if(remote) remotesByName[remote.name] = remote;
  }

  const imdbRemote = remotesByName["IMDB"];
  if(imdbRemote) remotes.push(imdbRemote);

  const rottenRemote = await getRemote(
        {id:showName, type:99, sourceName:"Rotten Tomatoes"});
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
  const nameIn   = searchStr;
  const tvdbData = await srvr.getTvdb(nameIn);
  if(tvdbData) {
    if(tvdbData.noMatch) return null;
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

  // console.log("srchResObj.data[0]:", srchResObj.data[0]);
  const tvdbId   = srchResObj.data[0].tvdb_id;
  const showName = srchResObj.data[0].name;

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
  const {lastAired:lastAiredIn, tvdbRemotes} = extResObj.data;
  if(!lastAiredIn) return null;
  const lastAired     = util.fmtDate(lastAiredIn);
  const today         = util.fmtDate();
  const lastAiredNoYr = util.fmtDate(lastAiredIn, false);
  if(lastAiredNoYr && lastAired >= today) 
                        waitStr = `{${lastAiredNoYr}}`;
  const saved = Date.now();
  const nameWaitRemsSave = 
   `${showName}|||${waitStr}|||${JSON.stringify(tvdbRemotes)}|||${saved}`;
  // console.log("addTvdb:", {showName, nameWaitRemsSave});
  srvr.addTvdb(nameWaitRemsSave);
  return {showName, waitStr, tvdbRemotes};
}
