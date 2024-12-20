import * as srvr from "./srvr.js";

let showErr      = null;
let theTvDbToken = null;

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
  theTvDbToken = loginJSON.data.token;
}

///////////// init cache //////////////  

let cache = [];
const cacheStr = window.localStorage.getItem("tvdbNameCache");
if(cacheStr) {
  try {
    cache = JSON.parse(cacheStr);
  } catch(e) {
    showErr(`cache parse error: ${e}`);
    cache.length = 0;
  }
}

///////////// get remotes (name and url) //////////////

const getRemotes = async (extData) => {
  const remoteIds = extData.remoteIds;
  const remotes = [];
  const names   = {};
  for(let i=0; i < remoteIds.length; i++) {
    const remoteId = remoteIds[i];
    let {id, type, sourceName:name} = remoteId;
    let url ='';  
    switch (type) {
      case 2:  url = `https://www.imdb.com/title/${id}`; break;
      case 3:
       url = `https://tvlistings.zap2it.com/overview.html` +
             `?programSeriesId=SH03415789&tmsId=${id}` +
             `&from=showcard&aid=gapzap`
        break;
      case 4:  name = 'Official Website';
               url = id; 
               break;
      case 7:  url = `https://www.reddit.com/r/${id}`; break;
      case 8:  url = id; break;
      case 9:  url = `https://www.instagram.com/${id}`; break;
      case 11: url = `https://www.youtube.com/channel/${id}`; break;
      case 12: name = 'The Movie DB';
               url = `https://www.themoviedb.org/tv/${id}?language=en-US`;
               break;
      case 18: name = 'Wikipedia';
               url = await srvr.getUrls(
                      `18||https://www.wikidata.org/wiki/${id}`);
               break;
      case 19: url = `https://www.tvmaze.com/shows/${id}`; break;
      default: continue
    }
    if(names[name]) continue;
    names[name] = true;
    remotes.push({name, url});
  }
  remotes.sort((a, b) => 
            a.name.toLowerCase().replace(/^the /, '') > 
            b.name.toLowerCase().replace(/^the /, '') ? 1 : -1);

  // console.log("get remotes: ", remotes[0].type, remotes[0].name, 
  //                   remotes[0].name.toLowerCase().replace(/^the /, ''));

  return remotes;
}

//////////// get TvDb Data //////////////

export const getTvDbData = async (searchStr) => {
  const cacheEntry = cache.find(c => 
                        c.searchStr === searchStr || 
                        c.exactName === searchStr);
  if(cacheEntry && 
      (Date.now() - cacheEntry.saved) < 48*60*60*1000) { // 2 days
    // console.log("cache hit: ", {searchStr, cacheEntry,
    //                              cachelength:cache.length});
    const {exactName, waitStr, remotes, saved} = cacheEntry;
    const remaining = cache.filter(c =>
                        c.searchStr !== searchStr &&
                        c.exactName !== searchStr);
    if(remaining.length != cache.length - 1) {
      cache = remaining;  
      window.localStorage.setItem(
                "tvdbNameCache", JSON.stringify(remaining));
    }
    return {exactName, waitStr, remotes, saved};
  }
  // console.log("cache miss:", {searchStr});

  if(!theTvDbToken) await getToken();

  const srchUrl = 'https://api4.thetvdb.com/v4/' +
                  'search?type=series&query='    + 
                   encodeURIComponent(searchStr);
  const srchResp = await fetch(srchUrl,
                    {headers: {
                      'Content-Type': 'application/json',
                      Authorization:'Bearer ' + theTvDbToken}
                    });
  if (!srchResp.ok) {
    showErr(`tvdb search:`, {searchStr}, srchResp.status);
    return null;
  }
  const srchJSON = await srchResp.json();
  if(!srchJSON.data[0]) return null;

  const tvdbId    = srchJSON.data[0].tvdb_id;
  const exactName = srchJSON.data[0].name;

  const extUrl = 
    `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
  const extResp = await fetch(extUrl,
                {headers: {
                    'Content-Type': 'application/json',
                      Authorization:'Bearer ' + theTvDbToken
                }});
  if (!extResp.ok) {
    showErr(`tvdb extended: ${extResp.status}`);
    return null;
  }

  let waitStr = '';
  const extJSON     = await extResp.json();
  const lastAiredIn = extJSON.data.lastAired;
  if(!lastAiredIn) return null;
  const lastAired =
     new Date(lastAiredIn).toISOString().substring(0, 10);
  const today = new Date().toISOString().substring(0, 10);
  if(lastAired >= today) waitStr = `{${lastAired}}`;
  
  const remotes = await getRemotes(extJSON.data);

  cache.push({searchStr, saved:Date.now(), 
              exactName, waitStr, remotes});
  window.localStorage.setItem(
                "tvdbNameCache", JSON.stringify(cache));

  return {exactName, waitStr, remotes};
}
