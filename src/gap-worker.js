import axios     from "axios"
import * as urls from "./urls.js";

let cred;

const getShowState = async (showId, showName) => {
  // active rows have watched with no watched at end
  // or last epi in last row watched

  if(showName.includes('Guy')) debugger;

  let ready                 = false;
  let checkedReady          = false;
  let lastWatched           = false;
  let watchedShow           = false;
  let watchedLastEpiLastSea = true; 
  let allWatchedShow        = true; 
  let waitingShow           = false;
  let unwatchedAfterWatched = false;
  let watchGap              = false;
  let haveFileShow          = false;
  let noFileAfterFile       = false;
  let fileGap               = false;
  let gapSeasonNumber       = null; 
  let gapEpisodeNumber      = null; 

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
        // let allWatchedShow  = true;  // per show
        if(watched) {
          watchedShow   = true;
          watchedSeason = true;
        }
        else allWatchedShow  = false;

        // let watchedLastEpiLastSea = true; // per show
        if(episodeIdx == episodes.length-1) {
          // last epi in season
          if(unaired && (watchedLastEpiLastSea || watchedSeason))
            waitingShow = true;
          watchedLastEpiLastSea = watched;
        }

        // let unwatchedAfterWatched = false; // per show
        // let watchGap = false;              // per show
        if(watchedShow && !watched)
          unwatchedAfterWatched = true;
        if(!watchGap && unwatchedAfterWatched && watched) {
          if(gapSeasonNumber === null) {
            gapSeasonNumber  = seasonNumber;
            gapEpisodeNumber = episodeNumber
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
          if(gapSeasonNumber === null) {
            gapSeasonNumber  = seasonNumber;
            gapEpisodeNumber = episodeNumber
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
  return {notReady:!ready, allWatched:allWatchedShow,
          waiting: waitingShow, watchGap, fileGap,
          gapSeasonNumber, gapEpisodeNumber};
}


self.onmessage = async (event) => {
  cred                 = event.data.cred;
  const allShowsIdName = event.data.allShowsIdName;
  const startTime      = Date.now();
  console.log(
      `gap-worker started, ${allShowsIdName.length} shows`);
  for (let i = 0; i < allShowsIdName.length; i++) {
    const [showId, showName] = allShowsIdName[i];
    const {notReady, allWatched,
           waiting, watchGap, fileGap,
           gapSeasonNumber, gapEpisodeNumber} = 
              await getShowState(showId, showName);
    const progress = Math.ceil( 
                      (i+1) * 100 / allShowsIdName.length );

    if(watchGap || fileGap  || waiting || allWatched
                || notReady || progress === 100) {
      self.postMessage(
             {showId, progress, 
              gapSeasonNumber, gapEpisodeNumber, 
              watchGap, fileGap, waiting, allWatched, notReady}
      );
    }
  }
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`seasons-worker done, ${elapsed} secs`);
};

