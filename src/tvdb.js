
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

export const getWaitStr = async (seriesName) => {
  let cache = [];
  const cachedDate = cache.find(c => c.seriesName === seriesName);
  if(cachedDate && 
      (Date.now() - cachedDate.saved) < 48*60*60*1000) { // 2 days
    const lastAired = cachedDate.lastAired;
    return formatWaitStr(lastAired);
  }

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
    showErr(`tvdb search: ${srchResp.status}`);
    return formatWaitStr();
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
    return formatWaitStr();
  }
  const extJSON   = await extResp.json();
  const lastAired = extJSON.data.lastAired;
  if(!lastAired) {
    showErr(`no lastAired for ${seriesName}`);
    return formatWaitStr();
  }

  const oldIdx = cache.findIndex(c => c.seriesName === seriesName);
  if(oldIdx > -1) cache.splice(oldIdx, 1);
  cache.push({seriesName, lastAired, saved:Date.now()});

  window.localStorage.setItem(
                "tvdbNameCache", JSON.stringify(cache));

  return formatWaitStr(lastAired);
}
