import axios     from "axios"
import * as urls from "./urls.js";

let cred;

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
         watched, haveFile, unaired 
    };
  }
  return Episodes;
}

const getSeasons = async (showId) => {
  const Seasons = [];
  const seasons =
        (await axios.get(urls.childrenUrl(cred, showId)))
        .data.Items;
  for(let key in seasons) {
    let   season          = seasons[key];
    const seasonNumber    = +season.IndexNumber;
    Seasons[seasonNumber] = await getEpisodes(season.Id);
  }
  return Seasons;
};

const getGap = (_seasons) => {
  return null;
  
  const dbg = (series == "");
  if(dbg) console.log('debugging ' + series);

  let hadNotWatched     = false;
  let hadWatched        = false;
  let hadNoFile         = false;
  let hadFile           = false;
  let hadUnaired        = false;
  let missingEndFileCnt = -1;
  let lastEpiNums       = null;
  let lastEpiWatched    = false;

  const seasonsRes = await axios.get(urls.childrenUrl(cred, seriesId));
  for(let key in seasonsRes.data.Items) {
    let   seasonRec = seasonsRes.data.Items[key];
    const seasonId  = seasonRec.Id;
    const seasonIdx = +seasonRec.IndexNumber;

    const unairedObj = {};
    const unairedRes = await axios.get(urls.childrenUrl(cred, seasonId, true));
    for(let key in unairedRes.data.Items) {
      const episodeRec    = unairedRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      unairedObj[episodeNumber] = true;
    }

    let firstEpisodeInSeasonNotWatched = false;
    let firstEpisodeInSeason           = true;

    const episRes = await axios.get(urls.childrenUrl(cred, seasonId));
    for(let key in episRes.data.Items) {
      let   episodeRec = episRes.data.Items[key];
      const epiIndex   = +episodeRec.IndexNumber;
      const userData   = episodeRec?.UserData;
      const watched    = !!userData?.Played;
      const haveFile   = (episodeRec.LocationType != "Virtual");
      const unaired    = !!unairedObj[epiIndex] && !watched && !haveFile;

      if(firstEpisodeInSeason && !watched) 
          firstEpisodeInSeasonNotWatched = true;
      if(watched) hadWatched = true;

      if(dbg) console.log(1, {seasonIdx, epiIndex, seasonRec, episodeRec,
                              userData, watched, haveFile, unaired,
                              firstEpisodeInSeason,firstEpisodeInSeasonNotWatched});

      /////////// aired epi after unaired /////////
      if(hadUnaired && !unaired) {
        console.log(`-- aired after unaired -- ${series} ` + 
                    `S${seasonIdx}E${epiIndex}`);
        return([seasonIdx, epiIndex, 'aired after unaired']);
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
        console.log(`-- not watched at beginning -- ` +
                    `${series}, S${seasonIdx} E${epiIndex}`);
        return([seasonIdx, epiIndex, "not watched at beginning"]);
      }

      ///////// watched gap /////////
      if(hadWatched && !watched) hadNotWatched = true;
      else if(hadNotWatched && watched) {
        console.log(`-- watched gap -- ${series}, S${seasonIdx} E${epiIndex}`);
        return([seasonIdx, epiIndex, "watch gap"]);
      }

      ///////// file gap /////////
      if(haveFile && !hadFile) {
        hadFile = true;
        continue;
      }
      if(hadFile && !haveFile) hadNoFile = true;
      else if(hadNoFile) {
        console.log(`-- file gap -- ${series}, S${seasonIdx} E${epiIndex}`);
        return([seasonIdx, epiIndex, "file gap"]);
      }
      lastEpiNums = [seasonIdx, epiIndex];
    }
    firstEpisodeInSeason = false;
  }

  ///////// recent episodes missing ///////// 
  if(missingEndFileCnt > 1) {
    console.log(`-- ${missingEndFileCnt} end episodes missing -- ${series}`);
    lastEpiNums.push(`${missingEndFileCnt} end episodes missing`);
    return lastEpiNums;
  }
  return null;
}

self.onmessage = async (event) => {
  cred             = event.data.cred;
  const allShowIds = event.data.allShowIds;

  console.log(
      `seasons-worker started, ${allShowIds.length} shows`);

  for (let i = 0; i < allShowIds.length; i++) {
    const showId  = allShowIds[i];
    const seasons = await getSeasons(showId);
    const gap = getGap(seasons);
    self.postMessage({showId, seasons, gap});
  }

  console.log("seasons-worker done");
};
