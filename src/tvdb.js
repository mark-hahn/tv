/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */

let showErr      = null;
let theTvDbToken = null;

export const init = (showErrIn) => {
  showErr = showErrIn;
}

///////////// get the api token //////////////
 
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
  // console.log({theTvDbToken});
  // console.log('init, loginJSON:', loginJSON);
}


//////////// getLastDate //////////////

export const getLastDate = async (seriesName) => {
  let cache = [];
  const cacheStr = window.localStorage.getItem("tvdbNameCache");
  if(cacheStr) cache = JSON.parse(cacheStr);

  const cachedDate = cache.find(c => c.seriesName === seriesName);
  if(cachedDate && 
      (Date.now() - cachedDate.saved) < 48*60*60*1000) { // 2 days
    const lastAired = cachedDate.lastAired;
    console.log('cache hit:', 
        {seriesName, lastAired, saved:new Date(cachedDate.saved)});
    return lastAired
  }
  console.log('cache miss:', cachedDate ?
      {cache, seriesName, lastAired, 
              saved:new Date(cachedDate.saved)} :
      {cache, seriesName});

  if(!theTvDbToken) await getToken();

  const srchUrl = 'https://api4.thetvdb.com/v4/' +
                  'search?type=series&query='    + 
                   encodeURIComponent(seriesName)
  const srchResp = await fetch(srchUrl,
    {headers: {
      'Content-Type': 'application/json',
       Authorization:'Bearer ' + theTvDbToken}
    }
  );
  if (!srchResp.ok) {
    showErr(`tvdb search err: ${srchResp.status}`);
    return '0000/00/00';
  }
  const srchJSON = await srchResp.json();
  const seriesId = srchJSON.data[0].tvdb_id;

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
    return '0000/00/00';
  }
  const extJSON   = await extResp.json();
  const lastAired = extJSON.data.lastAired;
  if(!lastAired) return '0000/00/00';

  const oldIdx = cache.findIndex(c => c.seriesName === seriesName);
  if(oldIdx > -1) cache.splice(oldIdx, 1);
  cache.push({seriesName, lastAired, saved:Date.now()});

  console.log('new cache:', cache);
  window.localStorage.setItem(
                "tvdbNameCache", JSON.stringify(cache));

  return lastAired;
}
