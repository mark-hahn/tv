import axios     from "axios"
import * as urls from "./urls.js";

let cred;

const getShowState = async (showId, showName) => {
  // active rows have watched with no watched at end
  // or last epi in last row watched

  // if(showName.includes('Guy')) debugger;

  let ready                 = false;
  let checkedReady          = false;
  let lastWatched           = false;
  let watchedShow           = false;
  let watchedLastEpiLastSea = true; 
  let waiting               = false;
  let unwatchedAfterWatched = false;
  let watchGap              = false;
  let haveFileShow          = false;
  let noFileAfterFile       = false;
  let fileGap               = false;
  let watchGapSeason        = null; 
  let watchGapEpisode       = null; 
  let fileGapSeason         = null; 
  let fileGapEpisode        = null; 

  try {
    const seasonsRes = 
          await axios.get(urls.childrenUrl(cred, showId));
    const seasons = seasonsRes.data.Items;
    for(let seasonIdx=0; seasonIdx < seasons.length; seasonIdx++) {
      const season       = seasons[seasonIdx];
      const seasonId     = season.Id;
      const seasonNumber = season.IndexNumber;
      let watchedSeason = false;

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
      const episodes = episodesRes.data.Items;
      for(let episodeIdx=0;  episodeIdx < episodes.length; episodeIdx++) {
        const episode       = episodes[episodeIdx];
        const episodeNumber = episode.IndexNumber;
        if(episodeNumber === undefined) continue;
        const userData      = episode?.UserData;
        const watched       = !!userData?.Played;
        const haveFile      = (episode.LocationType != "Virtual");
        const unaired       = !!unairedObj[episodeNumber];

        // ready -- plus sign
        // let ready        = false; // per show
        // let checkedReady = false; // per show
        // let lastWatched  = false; // per show
        if(!checkedReady && lastWatched && !watched) {
           checkedReady = true;
           ready        = haveFile;
        }

        // let watchedShow     = false; // per show
        // let watchedSeason   = false; // per season (row)
        if(watched) {
          watchedShow   = true;
          watchedSeason = true;
        }

        // let watchedLastEpiLastSea = true; // per show
        if(episodeIdx == episodes.length-1) {
          // last epi in season
          if(unaired && (watchedLastEpiLastSea || watchedSeason))
            waiting = true;
          watchedLastEpiLastSea = watched;
        }

        // let unwatchedAfterWatched = false; // per show
        // let watchGap = false;              // per show
        if(watchedShow && !watched)
          unwatchedAfterWatched = true;
        if(!watchGap && unwatchedAfterWatched && watched) {
          if(watchGapSeason === null) {
            watchGapSeason  = seasonNumber;
            watchGapEpisode = episodeNumber
          }
          watchGap = true;
        }

        // let noFileAfterFile = false; // per show
        // let fileGap         = false; // per show
        // let haveFileShow    = false; // per show
        haveFileShow ||= haveFile;
        if(haveFileShow && !haveFile)
          noFileAfterFile = true;
        if(!fileGap && noFileAfterFile && haveFile){
          if(fileGapSeason === null) {
            fileGapSeason  = seasonNumber;
            fileGapEpisode = episodeNumber
          }
          fileGap = true;
        }

        lastWatched = watched;
      }
    }
  }
  catch(error) { 
    console.error('getShowState', {error});
    return null;
  }
  return {notReady:!ready, waiting, 
          watchGap, watchGapSeason, watchGapEpisode, 
          fileGap,  fileGapSeason,  fileGapEpisode};
}


self.onmessage = async (event) => {
  cred                 = event.data.cred;
  const allShowsIdName = event.data.allShowsIdName;
  const startTime      = Date.now();
  console.log(
      `gap-worker started, ${allShowsIdName.length} shows`);
  for (let i = 0; i < allShowsIdName.length; i++) {
    const [showId, showName] = allShowsIdName[i];
    const {notReady, waiting, 
           watchGap, watchGapSeason, watchGapEpisode, 
           fileGap,  fileGapSeason,  fileGapEpisode} = 
              await getShowState(showId, showName);
    const progress = Math.ceil( 
                      (i+1) * 100 / allShowsIdName.length );

    self.postMessage(
          {showId, progress, notReady, waiting, 
          watchGap, watchGapSeason, watchGapEpisode, 
          fileGap,  fileGapSeason,  fileGapEpisode}
    );
  }
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`seasons-worker done, ${elapsed} secs`);
};

