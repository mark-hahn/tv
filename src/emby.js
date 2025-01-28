import * as urls from "./urls.js";
import     fetch from 'node-fetch';

// get currently watching show
// copied from client emby.js
export const getCurrentlyWatching = async (player='roku') => {
  const url = urls.watchingUrl(player);
  let  resp = await fetch(url);
  if (resp.status !== 200) {
    console.error(`error getCurrentlyWatching resp: ${resp.statusText}`);
    return null;
  }
  const dataJson = await resp.json();
  if(!dataJson || dataJson.length === 0) return null;
  const nowPlaying = dataJson[0].NowPlayingItem;
  if(!nowPlaying) return null;
  const showName = nowPlaying.SeriesName;
  console.log(`Watching on ${player}: ${showName}`);
  return showName;
}
