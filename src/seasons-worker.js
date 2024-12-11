import axios     from "axios"
import * as urls from "./urls.js";

const DBG = true;

let cred;
let epiShown = false;

const getEpisodes = async (seasonId) => {
  const unairedObj = {};
  const unairedRes = await axios.get(
            urls.childrenUrl(cred, seasonId, true));
  for(let key in unairedRes.data.Items) {
    const episode       = unairedRes.data.Items[key];
    const episodeNumber = +episode.IndexNumber;
    unairedObj[episodeNumber] = true;
  }
  const Episodes = [];
  const episodes =
        (await axios.get(urls.childrenUrl(cred, seasonId)))
        .data.Items;
  for(let key in episodes) {
    const episode       = episodes[key];

    // if( !epiShown) {
    //   epiShown = true;
    //   console.log(episode);
    // } 

    const episodeNumber = +episode.IndexNumber;
    // const showId        = episode.SeriesId;
    // const seasonId      = episode.SeasonId;
    const userData      = episode?.UserData;
    const watched       = !!userData?.Played;
    const haveFile      = (episode.LocationType != "Virtual");
    const unaired = 
        !!unairedObj[episodeNumber] && !watched && !haveFile;
    Episodes[episodeNumber] = {
        //  showId, seasonId, 
         watched, /*watchStr,*/ haveFile, unaired 
    };
  }
  return Episodes;
}

const getSeasons = async (showId, showNumber) => {
  const Seasons = [];
  const seasons =
        (await axios.get(urls.childrenUrl(cred, showId)))
        .data.Items;
  for(let key in seasons) {
    let   season          = seasons[key];
    const seasonNumber    = +season.IndexNumber;
    Seasons[seasonNumber] = 
        await getEpisodes(season.Id, showNumber, seasonNumber);
  }
  return Seasons;
};

let showName;

const getGap = (seasons) => {
  let hadNotWatched     = false;
  let hadWatched        = false;
  let hadNoFile         = false;
  let hadFile           = false;
  let hadUnaired        = false;
  let missingEndFileCnt = -1;
  let lastEpiNums       = null;
  let lastEpiWatched    = false;

  for(let seasonIdx = 0; seasonIdx < seasons.length; seasonIdx++) {
    const season = seasons[seasonIdx];
    if(!season) continue;

    let firstEpisodeInSeasonNotWatched = false;
    let firstEpisodeInSeason           = true;

    for(let epiIndex = 1; epiIndex < season.length; epiIndex++) {
      const episode = season[epiIndex];
      if(!episode) continue;

      // console.log({seasonIdx, epiIndex, episode});

      const {watched, haveFile, unaired} = episode;

      if(firstEpisodeInSeason && !watched) 
          firstEpisodeInSeasonNotWatched = true;
      if(watched) hadWatched = true;

      // console.log({seasonIdx, epiIndex, watched, haveFile, unaired,
      //      firstEpisodeInSeason, firstEpisodeInSeasonNotWatched});

      /////////// aired epi after unaired /////////
      if(hadUnaired && !unaired) {
        console.log(`-- aired after unaired: ${showName}, `+
                                  `S${seasonIdx}E${epiIndex}`);
        return [seasonIdx, epiIndex, 'aired after unaired'];
      }
      // unaired at end are ignored
      if(unaired) {
        hadUnaired = true;
        continue;
      }

      if(watched || haveFile) missingEndFileCnt = -1;
      else {
        if(missingEndFileCnt == -1 && 
           lastEpiWatched && !watched && !haveFile) missingEndFileCnt = 0;
        if(missingEndFileCnt != -1 && 
          !watched && !haveFile)                    missingEndFileCnt++;
      }
      lastEpiWatched = watched;

      ///////// not watched at beginning of season /////////
      if(firstEpisodeInSeasonNotWatched && watched && 
            !firstEpisodeInSeason) {
        console.log(`-- not watched at beginning: ` +
                    `${showName}, S${seasonIdx}E${epiIndex}`);
        return [seasonIdx, epiIndex, 'not watched at beginning'];
      }

      ///////// watched gap /////////
      if(hadWatched && !watched) hadNotWatched = true;
      else if(hadNotWatched && watched) {
        console.log(`-- watched gap: ` +
                    `${showName}, S${seasonIdx}E${epiIndex}`);
        return [seasonIdx, epiIndex, 'watched gap'];
      }

      ///////// file gap /////////
      if(haveFile && !hadFile) {
        hadFile = true;
        continue;
      }
      if(hadFile && !haveFile) hadNoFile = true;
      else if(hadNoFile) {
        console.log(`-- file gap: ${showName}, ` +
                        `S${seasonIdx}E${epiIndex}`);
        return [seasonIdx, epiIndex, "file gap"];
      }
      lastEpiNums = [seasonIdx, epiIndex];
    }
    firstEpisodeInSeason = false;
  }

  ///////// recent episodes missing ///////// 
  if(missingEndFileCnt > 1) {
    console.log(`-- ${missingEndFileCnt} end episodes missing: ` +
                    `${showName}`);
    lastEpiNums.push(`${missingEndFileCnt} end episodes missing`);
    return lastEpiNums;
  }
  return null;
}

self.onmessage = async (event) => {
  cred                 = event.data.cred;
  const allShowsIdName = event.data.allShowsIdName;
  const startTime      = Date.now();
  console.log(
      `seasons-worker started, ${allShowsIdName.length} shows`);
  for (let i = 0; i < allShowsIdName.length; i++) {
    const [showId, showNameIn] = allShowsIdName[i];
    showName = showNameIn;
    const seasons = await getSeasons(showId, i);
    const gap     = getGap(seasons);
    const progress = Math.ceil( (i+1) * 100 / allShowsIdName.length );
    self.postMessage({showId, seasons, gap, progress});
  }
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`seasons-worker done, ${elapsed} secs`);
};
