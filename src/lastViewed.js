import fs        from "fs";
import * as fsp  from 'fs/promises';
import * as emby from "./emby.js";
import {jParse}  from "./util.js";

const lastViewedStr =
  fs.readFileSync('data/lastViewed.json', 'utf8');
const lastViewed = jParse(lastViewedStr, 'lastViewed');

let lastShowNameByDevice = {};
const checkWatch  = async () => {
  const shows = await emby.getCurrentlyWatching();
  for(const device of emby.devices) {
    const [_, deviceName] = device;
    const show = shows.find(
                (show) => show.deviceName === deviceName);
    const showName     = show?.showName;
    const lastShowName = lastShowNameByDevice[deviceName];
    if(showName) lastViewed[showName] = Date.now();
    if(showName != lastShowName) {
      await fsp.writeFile('data/lastViewed.json',
                            JSON.stringify(lastViewed));
    }
    lastShowNameByDevice[deviceName] = showName;
  }
}

setInterval(async () => {
  await checkWatch();
}, 60 * 1000);  // 1 minute

export const getLastViewed = (id, _param, resolve, _reject) => {
  resolve([id, lastViewed]);
}

setTimeout(checkWatch, 1000);
