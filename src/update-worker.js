
const log = (msg) => {
  log(`update-worker, ${msg}`);
}

//////////// get TvDb Data //////////////

const getTvdbData = async (getTvdbParams) => {
  const { 
     Name, tvdbId, tvdbToken,
     seasonCount, episodeCount, watchedCount,
     deleted
  } = getTvdbParams;

  let extRes, extUrl;
  try{
    extUrl = 
      `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
    extRes = await fetch(extUrl,
                  {headers: {
                      'Content-Type': 'application/json',
                        Authorization:'Bearer ' + tvdbToken
                  }});
    if (!extRes.ok) {
      log(`getTvdbData error, extended Status:`, 
                        Name, {extUrl, extRes});
      return null;
    }
  } catch(err) {  
    log('getTvdbData catch error:', 
                        Name, {extUrl, extRes, err});
    return null;
  }
  const extResObj = await extRes.json();
  const {firstAired, lastAired: lastAiredIn, image, score,
         originalCountry, originalLanguage, overview,
         remoteIds:tvdbRemotes, Status:StatusIn,
         seasons:seasonsIn, averageRuntime,
         originalNetwork:originalNetworkIn} 
            = extResObj.data;
  let lastAired = lastAiredIn ?? firstAired;
  lastAired     = lastAired ?? '';
  let   originalNetwork = originalNetworkIn?.Name ?? '';
  const Status = StatusIn.Name; // e.g. Ended
  const saved  = Date.now();
  const tvdbData = { 
          tvdbId, Name, saved, originalNetwork,
          image, score, overview, 
          firstAired, lastAired, averageRuntime,
          originalCountry, originalLanguage,
          tvdbRemotes, Status};
  Object.assign(tvdbData, {
      seasonCount, episodeCount, watchedCount, deleted
  });
  // log('getTvdbData:', {tvdbData});
  return tvdbData;
}

const getPickup = (getPickupParams) => {
  const {Name, Pickup, Status,
         InToTry, IsFavorite, InLinda, InMark
  } = getPickupParams;
  if( (Status == 'Continuing' ||
        Status == 'Upcoming')         &&
      (Name.startsWith("noemby-") || 
        InToTry              || 
        IsFavorite           || 
        InLinda              || 
        InMark)) {
    if(Pickup) return null;
    log('set pickup: ' + Name);
    return 'add';
  }
  else {
    if(!Pickup) return null;
    log('del pickup: ' + Name);
    return 'del';
  }
}

self.onmessage = async (event) => {
  const allShowsIdName = event.data.allShowsIdName;
  log(`update-worker started`);
  for (let i = 0; i < allShowsIdName.length; i++) {
    const [showId, showName] = allShowsIdName[i];
    self.postMessage(

    );
  }
}

