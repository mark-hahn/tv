import axios     from "axios"
import * as urls from "./urls.js";

let cred;

const getShowState = async (showId, showName) => {
  // active rows have watched or last epi in last row watched
  let ready      = false;  // first non-watched has file
  let waiting    = false;  // unaired in active row
  let watchedGap = false; 
  let fileGap    = false; 
  let allWatched = true;
  let haveWatched = false;
  let haveFile    = false;
  try {
    const seasonsRes = 
          await axios.get(urls.childrenUrl(cred, showId));
    for(let key in seasonsRes.data.Items) {
      const seasonRec   =  seasonsRes.data.Items[key];
      const seasonId    =  seasonRec.Id;
      const episodesRes = 
              await axios.get(urls.childrenUrl(cred, seasonId));
      for(let key in episodesRes.data.Items) {
        const episodeRec = episodesRes.data.Items[key];
        const userData   = episodeRec?.UserData;
        if(userData?.Played) watchedCount++;
      }
    }
  }
  catch(error) { 
    console.error('getShowState', {error});
    return null;
  }
  return {};
}


self.onmessage = async (event) => {
  cred                 = event.data.cred;
  const allShowsIdName = event.data.allShowsIdName;
  const startTime      = Date.now();
  console.log(
      `gap-worker started, ${allShowsIdName.length} shows`);
  for (let i = 0; i < allShowsIdName.length; i++) {
    const [showId, showName] = allShowsIdName[i];
    const {seasonNum, episodeNum, watchGap, 
           missing, waiting, notReady} = 
              await getShowState(showId, showName);
    const progress = Math.ceil( 
                      (i+1) * 100 / allShowsIdName.length );

    if(watchGap || missing  || waiting 
                || notReady || progress === 100) {
      self.postMessage(
             {showId, progress,
              seasonNum, episodeNum, 
              watchGap, missing, waiting, notReady}
      );
    }
  }
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`seasons-worker done, ${elapsed} secs`);
};

