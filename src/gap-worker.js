import axios     from "axios"
import * as urls from "./urls.js";

let cred;

const getEpisodes = async (season) => {
  let   notReady = true;
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
    notReady     &&= !(!watched && haveFile);
    episodes.push({showId, seasonId, episodeNumber, 
                   watched, haveFile, unaired});
  }
  return {episodes, notReady};
}

const getShowState = async (showId, _showName) => {
  let activeSeasonNumber, activeSeasonEpisodes;
  let seasonNum, episodes;
  let afterWatchedIdx = 0;
  let notReady        = false;
  let gapChecking     = true;
  const seasons =
        (await axios.get(urls.childrenUrl(cred, showId)))
        .data.Items;
  for(let seasonIdx = seasons.length-1;
          seasonIdx >= 0; seasonIdx--) {
    const season = seasons[seasonIdx];
    seasonNum    = +season.IndexNumber;
    const {episodes, notReadyIn} = await getEpisodes(season);
    notReady ||= notReadyIn;
    if(!gapChecking) continue

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
    gapChecking = false;
  }
  if(!activeSeasonEpisodes) {
    activeSeasonNumber   = seasonNum;
    activeSeasonEpisodes = episodes;
  }
  seasonNum = activeSeasonNumber
  episodes  = activeSeasonEpisodes;
  let   episodeNum = episodes[episodes.length-1].episodeNumber;
  const waiting    = episodes[episodes.length-1].unaired;

  let missing   = false;
  let hadNoFile = false;
  let idx;
  for(idx = afterWatchedIdx; idx < episodes.length; idx++) {
    if(episodes[idx].unaired) break;
    if(idx == afterWatchedIdx) {
      if(!episodes[idx].haveFile) {
        missing = true;
        break;
      }
    }
    else {
      if(!episodes[idx].haveFile) 
        hadNoFile = true;
      else if(hadNoFile) {
        missing = true;
        break;
      }
    }
  }
  if(missing) episodeNum = episodes[idx].episodeNumber;

  let watchGap = false;
  for(let idx = 0; idx < afterWatchedIdx-1; idx++) {
    if(!episodes[idx].watched) {
      watchGap = true;
      episodeNum = episodes[idx].episodeNumber;
      break;
    }
  }
  return {seasonNum, episodeNum, 
          watchGap, missing, waiting, notReady};
};

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
    const progress = Math.ceil( (i+1) * 100 / allShowsIdName.length );

    if(watchGap || missing  || waiting 
                || notReady || progress === 100)
      self.postMessage({showId, progress,
                        seasonNum, episodeNum, 
                        watchGap, missing, waiting, notReady});
  }
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`seasons-worker done, ${elapsed} secs`);
};
