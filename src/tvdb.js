
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

const cache = [];
const cacheStr = window.localStorage.getItem("tvdbNameCache");
if(cacheStr) {
  try {
    const cacheArr = JSON.parse(cacheStr);
    cacheArr.forEach(c => cache.push(c));
  } catch(e) {
    showErr(`cache parse error: ${e}`);
    cache.length = 0;
  }
}

const formatWaitStr = (lastAired) => {
  if(!lastAired) return '<Unknown>';
  const today = new Date().toISOString().substring(0, 10);
  console.log("formatWaitStr: ", {lastAired, today});
  if(lastAired > today) return `{${lastAired}}`;
  else return '{Ready}';
}

export const getWaitData = async (searchStr) => {
  // let searchStr = show;
  // if(typeof searchStr !== 'string') {
  //   searchStr = show.Name;
    // console.log("getWait show.Seasons: ", show.Seasons);
    // const Seasons = show.Seasons;
    // if(Seasons && Seasons.length) {
    //   const lastSeason = Seasons[Seasons.length-1];
    //   if(lastSeason.length) {
    //     const lastEp = lastSeason[lastSeason.length-1];
    //     if(!lastEp.unaired) {
    //       console.log("getWait lastEp: ", lastEp);
    //       return ['{Ready}', searchStr, lastEp.date];
    //     }
    //   }
    // }
  // }
  const cacheEntry = cache.find(c => c.searchStr === searchStr);
  if(cacheEntry && 
      (Date.now() - cacheEntry.saved) < 48*60*60*1000) { // 2 days
    const lastAired = cacheEntry.lastAired;
    return [formatWaitStr(lastAired), 
            cacheEntry.seriesName, lastAired];
  }
  if(!theTvDbToken) await getToken();

  const srchUrl = 'https://api4.thetvdb.com/v4/' +
                  'search?type=series&query='    + 
                   encodeURIComponent(searchStr)
  const srchResp = await fetch(srchUrl,
    {headers: {
      'Content-Type': 'application/json',
       Authorization:'Bearer ' + theTvDbToken}
    }
  );
  if (!srchResp.ok) {
    showErr(`tvdb search: ${srchResp.status}`);
    return formatWaitStr();
  }
  const srchJSON = await srchResp.json();
  if(!srchJSON.data[0]) {
    showErr(`No series found for ${searchStr}`);
    return formatWaitStr();
  }
  const seriesId   = srchJSON.data[0].tvdb_id;
  const seriesName = srchJSON.data[0].name;

  const extUrl = 
    `https://api4.thetvdb.com/v4/series/${seriesId}/extended`;
  const extResp = await fetch(extUrl,
    {headers: {
        'Content-Type': 'application/json',
        Authorization:'Bearer ' + theTvDbToken
      }
    }
  );
  if (!extResp.ok) {
    showErr(`tvdb extended: ${extResp.status}`);
    return formatWaitStr();
  }
  const extJSON   = await extResp.json();
  const lastAired = extJSON.data.lastAired;
  if(!lastAired) {
    showErr(`no lastAired for ${searchStr}`);
    return formatWaitStr();
  }

  const oldIdx = cache.findIndex(c => c.searchStr === searchStr);
  if(oldIdx > -1) cache.splice(oldIdx, 1);
  const dateStr = new Date(lastAired)
                      .toISOString().substring(0, 10);
  cache.push({searchStr, lastAired: dateStr, 
              saved:Date.now(), seriesName});

  window.localStorage.setItem(
                "tvdbNameCache", JSON.stringify(cache));

  return [formatWaitStr(lastAired), seriesName, lastAired];
}
