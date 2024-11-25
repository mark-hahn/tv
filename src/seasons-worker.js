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

self.onmessage = async (event) => {
  cred           = event.data.cred;
  const allShows = event.data.allShows;
  console.log(`worker started with ${allShows.length} shows`);

  for (let i = 0; i < allShows.length; i++) {
    const showId = allShows[i].Id;
    self.postMessage(
        {showId, seasons: await getSeasons(showId)} );
  }

  console.log("worker done");
};
