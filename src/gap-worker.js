import axios     from "axios"
import * as urls from "./urls.js";

let cred;

const getShowState = async (showId, _showName) => {
  // active rows have watched with no watched at end
  // or last epi in last row watched
  let watchedInLastEpi = false;
  let inActiveRow      = false;

  let waiting = false;  // unaired in active row (inc last epi)

  let haveWatched            = false;
  let nonWatchedAfterWatched = false;
  let watchedGap             = false;  
  let allWatched             = true;
  let ready = false;

  let nonFileAfterFile = false;
  let fileGap          = false; 

  try {
    const seasonsRes = 
          await axios.get(urls.childrenUrl(cred, showId));
    for(let key in seasonsRes.data.Items) {
      const season   = seasonsRes.data.Items[key];
      const seasonId = season.Id;

      const unairedObj = {};
      const unairedRes = await axios.get(
                urls.childrenUrl(cred, seasonId, true));
      for(let key in unairedRes.data.Items) {
        const episode       = unairedRes.data.Items[key];
        const episodeNumber = +episode.IndexNumber;
        unairedObj[episodeNumber] = true;
      }

      const episodesRes = 
              await axios.get(urls.childrenUrl(cred, seasonId));
      const episodes =  episodesRes.data.Items;
      for(let key in episodes) {
        const episode       = episodes[key];
        if(episode.IndexNumber === undefined) continue;
        const showId        = episode.SeriesId;
        const seasonId      = episode.SeasonId;
        const episodeId     = episode.Id;
        const episodeNumber = +episode.IndexNumber;
        const userData      = episode?.UserData;
        const watched       = !!userData?.Played;
        const haveFile      = (episode.LocationType != "Virtual");
        const unaired       = !!unairedObj[episodeNumber];
        const imageTag      = episode?.ImageTags?.Primary;

        let checkedReady = false;
        let lastWatched  = false;

        if(!checkedReady && lastWatched && !watched) {
           checkedReady = true;
           ready        = haveFile;
        }

        if(watched) haveWatched = true;
        else        allWatched = false;

        lastWatched = watched;
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

