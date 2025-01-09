import axios     from "axios"
import * as urls from "./urls.js";

let cred;

const getEpisodes = async (season, _showName) => {
  let   ready = false;
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
    ready        ||= (!watched && haveFile);
    episodes.push({showId, seasonId, episodeNumber, 
                   watched, haveFile, unaired, episode});
  }
  return {episodes, ready};
}

const getShowState = async (showId, showName) => {
  let activeSeasonNumber, activeSeasonEpisodes;
  let seasonNum, episodes;
  let afterWatchedIdx       = 0;
  let afterWatchedSeasonNum = null;
  let afterWatchedEpisode   = null;
  let ready                 = false;
  let gapChecking           = true;
  const seasons =
        (await axios.get(urls.childrenUrl(cred, showId)))
        .data.Items;
  for(let seasonIdx = seasons.length-1;
          seasonIdx >= 0; seasonIdx--) {
    const season = seasons[seasonIdx];
    const {episodes:episodesIn, ready: readyIn } = 
                await getEpisodes(season, showName);
    ready ||= readyIn;
    if(ready && !gapChecking) break;
    if(!gapChecking) continue;

    episodes  = episodesIn;
    seasonNum = +season.IndexNumber;
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
      if(afterWatchedSeasonNum === null) {
        afterWatchedSeasonNum   = seasonNum;
        afterWatchedEpisode  = 
            episodes[afterWatchedIdx].episode;
      }
    }
    else {
      // last episode watched
      afterWatchedIdx = (seasonIdx === seasons.length-1) 
                          ? episodes.length : 0;

      if(afterWatchedSeasonNum === null &&
          episodes[afterWatchedIdx]     &&
          episodes[afterWatchedIdx].episode) {

        afterWatchedSeasonNum = seasonNum;
        // console.log(`afterWatchedEpisode:`, 
        //       episodes[afterWatchedIdx], 
        //       episodes.length,
        //       {seasonNum, episodes, afterWatchedIdx});
        afterWatchedEpisode   = 
              episodes[afterWatchedIdx].episode;
      }
    }
    gapChecking = false;
  }
  if(!activeSeasonEpisodes) {
    activeSeasonNumber   = seasonNum;
    activeSeasonEpisodes = episodes;
  }
  seasonNum = activeSeasonNumber;
  episodes  = activeSeasonEpisodes;
  let episodeNum = episodes[episodes.length-1].episodeNumber;
  const waiting  = episodes[episodes.length-1].unaired;

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
          afterWatchedSeasonNum, afterWatchedEpisode,
          watchGap, missing, waiting, notReady: !ready};
};

self.onmessage = async (event) => {
  cred                 = event.data.cred;
  const allShowsIdName = event.data.allShowsIdName;
  const startTime      = Date.now();
  console.log(
      `gap-worker started, ${allShowsIdName.length} shows`);
  for (let i = 0; i < allShowsIdName.length; i++) {
    const [showId, showName] = allShowsIdName[i];

    // if(showName !== "Family Guy") continue;

    const showState = await getShowState(showId, showName);
    showState.showId   = showId
    showState.showName = showName
    showState.progress = 
              Math.ceil( (i+1) * 100 / allShowsIdName.length );
    self.postMessage(showState);
  }
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`seasons-worker done, ${elapsed} secs`);
};
