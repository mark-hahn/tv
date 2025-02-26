import fs        from "fs";
import * as fsp  from 'fs/promises';
import * as emby from "./emby.js";
import {jParse}  from "./util.js";

const lastViewedStr =
            fs.readFileSync('data/lastViewed.json', 'utf8');
const lastViewed = jParse(lastViewedStr, 'lastViewed');

export const getLastViewed = (id, _param, resolve, _reject) => {
  resolve([id, lastViewed]);
}

let lastShowNameByDeviceName = {};
const checkWatch  = async () => {
  const states = await emby.getCurrentlyWatching();
  for(const state of states) {
    const {deviceName, showName} = state;
    const lastShowName = lastShowNameByDeviceName[deviceName];
    if(showName) lastViewed[showName] = Date.now();
    if(showName != lastShowName) {
      await fsp.writeFile('data/lastViewed.json',
                            JSON.stringify(lastViewed));
    }
    lastShowNameByDeviceName[deviceName] = showName;
  }
}

setInterval(async () => {
  await checkWatch();
}, 60 * 1000);  // 1 minute

setTimeout(checkWatch, 1000);
