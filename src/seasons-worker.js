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
    const showId        = episode.SeriesId;
    const seasonId      = episode.SeasonId;
    const episodeNumber = +episode.IndexNumber;
    const userData = episode?.UserData;
    const watched  = !!userData?.Played;
    const haveFile = (episode.LocationType != "Virtual");
    const unaired  = !!unairedObj[episodeNumber];
    episodes.push({showId, seasonId, watched, haveFile, unaired});
  }
  return episodes;
}

const getActiveSeason = async (showId) => {
  let activeSeasonNumber, activeSeasonEpisodes;
  let seasonNumber, episodes;
  let afterWatchedIdx = 0;
  const seasons =
        (await axios.get(urls.childrenUrl(cred, showId)))
        .data.Items;
  for(let seasonIdx = seasons.length-1;
          seasonIdx >= 0; seasonIdx--) {
    const season = seasons[seasonIdx];
    seasonNumber = +season.IndexNumber;
    episodes     = await getEpisodes(season);
    const lastWatchedIdx = episodes.findLastIndex(
                               episode => episode.watched);
    if(lastWatchedIdx === -1) {
      // no watched episodes in this season
      activeSeasonNumber   = seasonNumber;
      activeSeasonEpisodes = episodes;
      continue
    }
    if(lastWatchedIdx !== episodes.length-1) {
      // some episodes watched in this season
      // last not watched
      activeSeasonNumber   = seasonNumber;
      activeSeasonEpisodes = episodes;
      afterWatchedIdx      = lastWatchedIdx + 1;
    } // else last episode watched
    break;
  }
  if(!activeSeasonEpisodes) {
    // no watched in any season, use first season
    activeSeasonNumber   = seasonNumber;
    activeSeasonEpisodes = episodes;
  } 
  let   missing     = !episodes[afterWatchedIdx].haveFile;
  const waiting     =  episodes[episodes.length-1].unaired;
  let   episodeNum  = missing ? afterWatchedIdx : episodes.length-1;
  for(let idx = 0; idx < afterWatchedIdx-1; idx++) {
    if(!episodes[idx].watched) {
      missing = true;
      episodeNum = idx;
      break;
    }
  }
  return {seasonNum: activeSeasonNumber, episodeNum,
          missing, waiting};
};

self.onmessage = async (event) => {
  cred                 = event.data.cred;
  const allShowsIdName = event.data.allShowsIdName;
  const startTime      = Date.now();
  console.log(
      `seasons-worker started, ${allShowsIdName.length} shows`);
  for (let i = 0; i < allShowsIdName.length; i++) {
    const [showId, _showName] = allShowsIdName[i];
    const {seasonNum, episodeNum,
           missing, waiting} = await getActiveSeason(showId);
    const progress = Math.ceil( (i+1) * 100 / allShowsIdName.length );
    self.postMessage({showId, progress,
                      seasonNum, episodeNum, 
                      missing, waiting});
  }
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`seasons-worker done, ${elapsed} secs`);
};
