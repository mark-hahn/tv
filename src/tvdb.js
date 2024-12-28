import * as srvr from "./srvr.js";
import * as util from "./util.js";

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

export const getRemotes = async (showName) => {
  let remotes = await srvr.getRemotes(showName);
  if(remotes && !remotes.noMatch) return [remotes, true];

  const tvdbData = await getTvdbData(showName);
  if(!tvdbData) {
    console.log(`getRemotes, no tvdbData: ${showName}`);
    return null;
  }
  const {remoteIds} = tvdbData;
  if(!remoteIds || remoteIds.noMatch) {
    console.log(`getRemotes, no remoteIds: ${showName}`);
    return null;
  }
  // console.log(`getRemotes, remoteIds: ${showName}`, {remoteIds});
  remoteIds.push({id:showName, type:99, 
                  sourceName:'Rotten Tomatoes'});
  remotes     = [];
  const names = {};
  for(let i=0; i < remoteIds.length; i++) {
    let {id, type, sourceName:name} = remoteIds[i];    
    let url ='';  
    switch (type) {
      case 2:  url = `https://www.imdb.com/title/${id}`; break;
      case 3:  break;
      case 4:  name = 'Official Website';
               url = id; 
               break;
      case 7:   url = `https://www.reddit.com/r/${id}`; break;
      case 8:   url = id; break;
      case 9:   url = `https://www.instagram.com/${id}`; break;
      case 11:  url = `https://www.youtube.com/channel/${id}`; break;
      case 12: name = 'The Movie DB';
                url = `https://www.themoviedb.org/tv/${id}` +
                      `?language=en-US`;
               break;
      case 13: name = 'EIDR';
               continue;
      case 18: name = 'Wikipedia';
               url = await srvr.getUrls(
               `18||https://www.wikidata.org/wiki/${id}`);
               break;
      case 19: url = `https://www.tvmaze.com/shows/${id}`; break;
      case 99:  
        url = await srvr.getUrls(
                `99||https://www.rottentomatoes.com/search` +
                `?search=${encodeURI(id)}`);
        console.log(`getRemotes, rotten: ${showName}, ${name}, ${url}`);
        break;
      default: continue;
    }
    if(!url) {
      console.log(`getRemotes, no url: ${showName}, ${name} ${url}`);
      continue;
    }
    if(url.startsWith('no match:')) {
      console.log(`getRemotes, no match: ${showName}, ${name}, ${url}`);
      continue;
    }
    if(names[name]) {
      console.log(
        `getRemotes, skipping duplicate: ${showName}, ${name} ${url}`,{remoteIds});
      continue;
    }
    names[name] = true;
    remotes.push({name, url});
  }
  remotes.sort((a, b) => 
            a.name.toLowerCase().replace(/^the /, '') > 
            b.name.toLowerCase().replace(/^the /, '') ? 1 : -1);

  // console.log("get remotes: ", ${extData.name}, remotes[0].type, remotes[0].name, 
  //                   remotes[0].name.toLowerCase().replace(/^the /, ''));

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
  const {lastAired:lastAiredIn, remoteIds} = extResObj.data;
  if(!lastAiredIn) return null;
  const lastAired     = util.fmtDate(lastAiredIn);
  const today         = util.fmtDate();
  const lastAiredNoYr = util.fmtDate(lastAiredIn, false);
  if(lastAiredNoYr && lastAired >= today) 
                        waitStr = `{${lastAiredNoYr}}`;
  const saved = Date.now();
  const nameWaitRemsSave = 
   `${showName}|||${waitStr}|||${JSON.stringify(remoteIds)}|||${saved}`;
  // console.log("addTvdb:", {showName, nameWaitRemsSave});
  srvr.addTvdb(nameWaitRemsSave);
  return {showName, waitStr, remoteIds};
}
