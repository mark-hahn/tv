import axios     from "axios"
import * as urls from "./urls.js";

let cred;

const getShowState = async (showId, _showName) => {
  // active rows have watched with no watched at end
  // or last epi in last row watched
  let firstEpisode            = true;
  let ready                   = false;
  let checkedReady            = false;
  let anyWatched              = false;
  let lastWatched             = false;
  let watchedShow             = false;
  let watchedLastEpiLastSea   = true; 
  let waiting                 = false;
  let unwatchedAfterWatched   = false;
  let watchGap                = false;
  let haveFileShow            = false;
  let noFileAfterFile         = false;
  let fileGap                 = false;
  let watchGapSeason          = null; 
  let watchGapEpisode         = null; 
  let fileGapSeason           = null; 
  let fileGapEpisode          = null; 
  let fileEndError            = false;
  let lastSeasonWatched       = false;
  let seasonWatchedThenNofile = false;
  let firstNoFileSeason        = null;
  let firstNoFileEpisode       = null;

  try {
    let seasonsRes;
    let url = urls.childrenUrl(cred, showId);
    try { seasonsRes = await axios.get(url); }
    catch(error) {
      console.error('getShowState axios error', error.message, {url});
      return null;
    }
    const seasons = seasonsRes.data.Items;
    // Once we hit an unaired episode, treat all later episodes as unaired.
    let unairedFromHere = false;
    for(let seasonIdx=0; seasonIdx < seasons.length; seasonIdx++) {
      const season       = seasons[seasonIdx];
      const seasonId     = season.Id;
      const seasonNumber = season.IndexNumber;
      let watchedSeason = false;

      let fileEndCount            = 0;
      let seasonNotWatchedNoFiles = true;
      let allSeasonWatched        = true;

      const unairedObj = {};

      let unairedRes;
      url = urls.childrenUrl(cred, seasonId, true);
      try { unairedRes = await axios.get(url); }
      catch(error) {
        console.error('getShowState axios error', error.message, {url});
        return null;
      }
      for(let key in unairedRes.data.Items) {
        const episode       = unairedRes.data.Items[key];
        const episodeNumber = +episode.IndexNumber;
        unairedObj[episodeNumber] = true;
      }

      let episodesRes;
      url = urls.childrenUrl(cred, seasonId);
      try {episodesRes = await axios.get(url)}
      catch(error) {
        console.error('getShowState axios error', error.message, {url});
        return null;
      }
      const episodes = episodesRes.data.Items;
      for(let episodeIdx=0;  episodeIdx < episodes.length; episodeIdx++) {
        const episode       = episodes[episodeIdx];
        const episodeNumber = episode.IndexNumber;
        if(episodeNumber === undefined) continue;
        const userData      = episode?.UserData;
        const watched       = !!userData?.Played;
        const haveFile      = (episode.LocationType != "Virtual");
        let unaired = unairedFromHere || !!unairedObj[episodeNumber];
        if(watched) unaired = false;
        else if(unaired) unairedFromHere = true;

        // Track the first aired episode that has no file.
        if(!unaired && !haveFile && firstNoFileSeason === null) {
          firstNoFileSeason = seasonNumber;
          firstNoFileEpisode = episodeNumber;
        }

        allSeasonWatched &&= watched;
        if(watched) anyWatched = true;

        if(firstEpisode && haveFile && !watched) {
           checkedReady = true;
           ready        = true;
        }
        firstEpisode = false;
        if(!checkedReady && lastWatched && !watched) {
           checkedReady = true;
           ready        = haveFile;
        }
        if(watched) {
          watchedShow   = true;
          watchedSeason = true;
        }
        if(episodeIdx == episodes.length-1) {
          // last epi in season
          if(unaired && (watchedLastEpiLastSea || watchedSeason))
            waiting = true;
          watchedLastEpiLastSea = watched;
        }

        if(watchedShow && !watched)
          unwatchedAfterWatched = true;
        if(!watchGap && unwatchedAfterWatched && watched) {
          if(watchGapSeason === null) {
            watchGapSeason  = seasonNumber;
            watchGapEpisode = episodeNumber
          }
          watchGap = true;
        }

        if(!haveFile && !watched && !unaired) 
             fileEndCount++;
        else fileEndCount = 0;

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
        seasonNotWatchedNoFiles &&= 
              !(haveFile || unaired || watched);

        lastWatched = watched;
      }
      if(!seasonNotWatchedNoFiles && fileEndCount > 2) {
        fileEndError = true;  
      }
      if(lastSeasonWatched && !allSeasonWatched &&
           seasonNotWatchedNoFiles)
        seasonWatchedThenNofile = true;
      lastSeasonWatched = allSeasonWatched;
    }

  }
  catch(error) { 
    console.error('getShowState error:', error.message);
    return null;
  }
  return {notReady:!ready, waiting, anyWatched, 
         fileEndError, seasonWatchedThenNofile,
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
    const {notReady, waiting, anyWatched, fileEndError,
           watchGap, watchGapSeason, watchGapEpisode, 
           fileGap,  fileGapSeason,  fileGapEpisode,
           seasonWatchedThenNofile} = 
              await getShowState(showId, showName);
    const progress = Math.ceil( 
                      (i+1) * 100 / allShowsIdName.length );

    self.postMessage(
          {showId, progress, notReady, waiting, anyWatched,
          watchGap, watchGapSeason, watchGapEpisode, 
          fileGap,  fileGapSeason,  fileGapEpisode, 
          fileEndError, seasonWatchedThenNofile }
    );
  }
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`gap-worker done, ${elapsed} secs`);
};

