
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

const formatWaitStr = (lastAired) => {
  if(!lastAired) return '<Unknown>';
  const waitTime = new Date(lastAired).getTime();
  const nowTime  = Date.now();
  if(waitTime > nowTime) return `<${lastAired}>`;
  else return '<Ready>';
}

export const getWaitData = async (searchStr) => {
  let cache = [];
  const cacheEntry = cache.find(c => c.searchStr === searchStr);
  if(cacheEntry && 
      (Date.now() - cacheEntry.saved) < 48*60*60*1000) { // 2 days
    const lastAired = cacheEntry.lastAired;
    return [formatWaitStr(lastAired), cacheEntry.seriesName];
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
  cache.push({searchStr, lastAired, 
              saved:Date.now(), seriesName});

  window.localStorage.setItem(
                "tvdbNameCache", JSON.stringify(cache));

  return [formatWaitStr(lastAired), seriesName];
}
