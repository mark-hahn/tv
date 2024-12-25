import * as srvr from "./srvr.js";
import * as util from "./util.js";

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

let tvDbCache = [];
const cacheStr = window.localStorage.getItem("tvdbDataCache");
if(cacheStr) {
  try {
    tvDbCache = JSON.parse(cacheStr);
  } catch(e) {
    showErr(`cache parse error: ${e}`);
    tvDbCache.length = 0;
  }
}

///////////// get remote (name and url) //////////////

export const getRemotes = async (showName) => {
  let cachedRemotes = await srvr.getRemotes(showName);
  if(!cachedRemotes.noMatch) return cachedRemotes;
  
  const {remoteIds} = await getTvDbData(showName);
  if(!remoteIds || remoteIds.noMatch) {
    console.log(`getRemotes, no remoteIds: ${showName}`);
    return null;
  }
  console.log(`getRemotes, remoteIds: ${showName}`,
              {remoteIds});
  remoteIds.push({id:showName, type:99, 
                  sourceName:'Rotten Tomatoes'});
  const remotes = [];
  const names   = {};
  for(let i=0; i < remoteIds.length; i++) {
    const remoteId = remoteIds[i];
    let {type, id, sourceName:name} = remoteId;
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
      case 99: url = await srvr.getUrls(
                      `99||https://www.rottentomatoes.com/search` +
                      `?search=${encodeURI(id)}`);
               break;
      default: continue
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
  return remotes;
}

//////////// get TvDb Data //////////////

export const getTvDbData = async (searchStr) => {
  const cacheEntry = tvDbCache.find(c => 
                        c.searchStr === searchStr || 
                        c.exactName === searchStr);
  if(cacheEntry && 
      (Date.now() - cacheEntry.saved) < 48*60*60*1000) { // 2 days
    // console.log("cache hit: ", {searchStr, cacheEntry,
    //                              cachelength:cache.length});
    const {exactName, waitStr, remoteIds} = cacheEntry;
    const remaining = tvDbCache.filter(c =>
                        c.searchStr !== searchStr &&
                        c.exactName !== searchStr);
    if(remaining.length != tvDbCache.length - 1) {
      tvDbCache = remaining;  
      window.localStorage.setItem(
                "tvdbDataCache", JSON.stringify(remaining));
    }
    return {exactName, waitStr, remoteIds};
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
  const extJSON  = await extResp.json();
  const {lastAired:lastAiredIn, remoteIds} = extJSON.data;
  if(!lastAiredIn) return null;
  const lastAired     = util.fmtDate(lastAiredIn);
  const today         = util.fmtDate();
  const lastAiredNoYr = util.fmtDate(lastAiredIn, false);
  if(lastAiredNoYr && lastAired >= today) 
                        waitStr = `{${lastAiredNoYr}}`;
  
  tvDbCache.push({exactName, waitStr, remoteIds,
                  searchStr, saved:Date.now()});
  window.localStorage.setItem(
                "tvdbDataCache", JSON.stringify(tvDbCache));

  return {exactName, waitStr, remoteIds};
}
