import axios     from "axios"
import * as urls from "./urls.js";

let cred;

const getSeasons = async (show) => {
  const seasonsRes = 
          await axios.get(urls.childrenUrl(cred, show.Id));
  const seasons = seasonsRes.data.Items;
  console.log(`found ${seasons.length} seasons for ${show.Name}`);
  return seasons;
};

self.onmessage = async (event) => {
  cred           = event.data.cred;
  const allShows = event.data.allShows;

  console.log(`worker started with ${allShows.length} shows`);
  await getSeasons(allShows[0]);

  // self.postMessage(result);
};