
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
/*
        "id": "https://www.hbo.com/somebody-somewhere",
        "type": 4,
        "sourceName": "Official Website"
*/

const getRemoteUrls = (extData) => {
  const remoteIds  = extData.remoteIds;
  const remoteUrls = {};
  for(let i=0; i < remoteIds.length; i++) {
    const remoteId = remoteIds[i];
    let url ='';
    switch (remoteId.id) {
      case 2:
        url = `https://www.imdb.com/title/${remoteId.id}`;
        break;


    }
    remoteUrls[remoteId.sourceName] = url;
    console.log("remote", remoteId.sourceName, url);
  }
  return remoteUrls;
}

export const getTvDbData = async (searchStr) => {
  const cacheEntry = cache.find(c => 
                        c.searchStr === searchStr || 
                        c.exactName === searchStr);
  if(cacheEntry && 
      (Date.now() - cacheEntry.saved) < 48*60*60*1000) { // 2 days
    const lastAired = cacheEntry.lastAired;
    // console.log("cache hit: ", {searchStr});
    return {waitStr: formatWaitStr(lastAired), 
            exactName: cacheEntry.exactName, lastAired};
  }
  // console.log("cache miss: ", {searchStr});

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
    console.log(`getTvDbData, no lastAired:`, {searchStr, exactName});
    return null;
  }
  const remoteUrls = getRemoteUrls(extJSON.data);

  while(cache.length) {
    const oldIdx = cache.findIndex(
                    c => c.searchStr === searchStr || 
                         c.exactName === exactName);
    if(oldIdx > -1) cache.splice(oldIdx, 1);
    else break;
  }
  const dateStr = new Date(lastAired)
                      .toISOString().substring(0, 10);
  cache.push({searchStr, lastAired: dateStr, 
              saved:Date.now(), exactName});

  window.localStorage.setItem(
                "tvdbNameCache", JSON.stringify(cache));

  return {waitStr: formatWaitStr(lastAired), 
          exactName, lastAired, remoteUrls};
}


/*
  let searchStr = show;
  if(typeof searchStr !== 'string') {
    searchStr = show.Name;
    console.log("getWait show.Seasons: ", show.Seasons);
    const Seasons = show.Seasons;
    if(Seasons && Seasons.length) {
      const lastSeason = Seasons[Seasons.length-1];
      if(lastSeason.length) {
        const lastEp = lastSeason[lastSeason.length-1];
        if(!lastEp.unaired) {
          console.log("getWait lastEp: ", lastEp);
          return ['{Ready}', searchStr, lastEp.date];
        }
      }
    }
  }

      "remoteIds": [
      {
        "id": "tt12759100",
        "type": 2,
        "sourceName": "IMDB"
      },
      {
        "id": "https://www.hbo.com/somebody-somewhere",
        "type": 4,
        "sourceName": "Official Website"
      },
      {
        "id": "106308",
        "type": 12,
        "sourceName": "TheMovieDB.com"
      }
    ],

*/