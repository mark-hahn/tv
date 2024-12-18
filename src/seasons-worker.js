import axios     from "axios"
import * as urls from "./urls.js";

let cred;

const getEpisodes = async (season) => {
  const seasonId = season.Id;
  const unairedObj = {};
  const unairedRes = await axios.get(
            urls.childrenUrl(cred, seasonId, true));
  for(let key in unairedRes.data.Items) {
    const episode       = unairedRes.data.Items[key];
    const episodeNumber = +episode.IndexNumber;
    unairedObj[episodeNumber] = true;
  }
  const episodes = [];
  const episodesRes =
        (await axios.get(urls.childrenUrl(cred, seasonId)))
        .data.Items;
  for(let key in episodesRes) {
    const episode       = episodesRes[key];
    if(episode.IndexNumber === undefined) continue;
    const showId        = episode.SeriesId;
    const seasonId      = episode.SeasonId;
    const episodeNumber = +episode.IndexNumber;
    const userData = episode?.UserData;
    const watched  = !!userData?.Played;
    const haveFile = (episode.LocationType != "Virtual");
    const unaired  = !!unairedObj[episodeNumber];
    episodes.push({showId, seasonId, episodeNumber, 
                   watched, haveFile, unaired});
  }
  return episodes;
}

const getActiveSeason = async (showId, showName) => {
  // if(showName.includes("Thin")) debugger;
  let activeSeasonNumber, activeSeasonEpisodes;
  let seasonNum, episodes;
  let afterWatchedIdx = 0;
  const seasons =
        (await axios.get(urls.childrenUrl(cred, showId)))
        .data.Items;
  for(let seasonIdx = seasons.length-1;
          seasonIdx >= 0; seasonIdx--) {
    const season = seasons[seasonIdx];
    seasonNum    = +season.IndexNumber;
    episodes     = await getEpisodes(season);
    const lastWatchedIdx = episodes.findLastIndex(
                               episode => episode.watched);
    if(lastWatchedIdx === -1) {
      // no watched episodes in this season
      activeSeasonNumber   = seasonNum;
      activeSeasonEpisodes = episodes;
      continue
    }
    if(lastWatchedIdx !== episodes.length-1) {
      // some episodes watched in this season
      // last not watched
      activeSeasonNumber   = seasonNum;
      activeSeasonEpisodes = episodes;
      afterWatchedIdx      = lastWatchedIdx + 1;
    }
    else {
      // last episode watched
      afterWatchedIdx = (seasonIdx === seasons.length-1) 
                          ? episodes.length : 0;
    }
    break;
  }
  if(!activeSeasonEpisodes) {
    activeSeasonNumber   = seasonNum;
    activeSeasonEpisodes = episodes;
  }
  seasonNum = activeSeasonNumber
  episodes  = activeSeasonEpisodes;
  let  episodeNum = episodes[episodes.length-1].episodeNumber;
  const waiting = episodes[episodes.length-1].unaired;
  const missing = (afterWatchedIdx !== episodes.length) &&
                !episodes[afterWatchedIdx].unaired    &&
                !episodes[afterWatchedIdx].haveFile;
  if(missing) episodeNum = episodes[afterWatchedIdx].episodeNumber;
  let watchGap = false;
  for(let idx = 0; idx < afterWatchedIdx-1; idx++) {
    if(!episodes[idx].watched) {
      watchGap = true;
      episodeNum = episodes[idx].episodeNumber;
      break;
    }
  } 
  return {seasonNum, episodeNum, watchGap, missing, waiting};
};

self.onmessage = async (event) => {
  cred                 = event.data.cred;
  const allShowsIdName = event.data.allShowsIdName;
  const startTime      = Date.now();
  console.log(
      `seasons-worker started, ${allShowsIdName.length} shows`);
  for (let i = 0; i < allShowsIdName.length; i++) {
    const [showId, showName] = allShowsIdName[i];
    const {seasonNum, episodeNum, watchGap, missing, waiting} = 
           await getActiveSeason(showId, showName);
    const progress = Math.ceil( (i+1) * 100 / allShowsIdName.length );

//  if(watchGap || missing || waiting)
//     console.log({showName, progress,
//                  seasonNum, episodeNum, 
//                  watchGap, missing, waiting});

    self.postMessage({showId, progress,
                      seasonNum, episodeNum, 
                      watchGap, missing, waiting});
  }
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`seasons-worker done, ${elapsed} secs`);
};
