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

//////////// get WaitStr //////////////

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
 
const formatWaitStr = (lastAired) => {
  if(!lastAired) return '{Unknown}';
  const today = new Date().toISOString().substring(0, 10);
  // console.log("formatWaitStr: ", {lastAired, today});
  if(lastAired > today) return `{${lastAired}}`;
  else return '{Ready}';
}

const getRemotes = async (extData) => {
  const remoteIds = extData.remoteIds;
  const remotes = [];
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
      case 4:  url = id; break;
      case 7:  url = `https://www.reddit.com/r/${id}`; break;
      case 8:  url = id; break;
      case 9:  url = `https://www.instagram.com/${id}`; break;
      case 11: url = `https://www.youtube.com/channel/${id}`; break;
      case 12:
        url = `https://www.themoviedb.org/tv/${id}?language=en-US`;
        break;
      case 18:
        url = await srvr.getUrls(
                `18||https://www.wikidata.org/wiki/${id}`);
        name = 'Wikipedia';
        break;
      case 19: url = `https://www.tvmaze.com/shows/${id}`; break;
      default: continue
    }
    remotes.push({name, url});
  }
  return remotes;
}


//////////// get TvDb Data //////////////

export const getTvDbData = async (searchStr) => {
  const cacheEntry = cache.find(c => 
                        c.searchStr === searchStr || 
                        c.exactName === searchStr);
  if(cacheEntry && 
      (Date.now() - cacheEntry.saved) < 48*60*60*1000) { // 2 days
    // console.log("cache hit: ", {searchStr});
    const {exactName, lastAired, remotes} = cacheEntry;
    return {waitStr: formatWaitStr(lastAired), 
            exactName, lastAired, remotes};
  }
  console.log("cache miss: ", {searchStr});

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
  if(!srchJSON.data[0]) {
    showErr(`No series found for ${searchStr}`);
    return null;
  }
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
  const extJSON   = await extResp.json();
  const lastAired = extJSON.data.lastAired;
  if(!lastAired) {
    console.error(`getTvDbData, no lastAired:`, {searchStr, exactName});
    return null;
  }
  const remotes = await getRemotes(extJSON.data);

  const cacheCopy = cache.filter(c => 
       c.searchStr !== searchStr && 
       c.exactName !== exactName);
  cache.splice(0, cache.length, ...cacheCopy)

  const dateStr = new Date(lastAired)
                      .toISOString().substring(0, 10);
  cache.push({searchStr, lastAired: dateStr, 
              saved:Date.now(), exactName, remotes});
  window.localStorage.setItem(
                "tvdbNameCache", JSON.stringify(cache));

  return {waitStr: formatWaitStr(lastAired), 
          exactName, lastAired, remotes};
}
