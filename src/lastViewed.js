import fs        from "fs";
import * as fsp  from 'fs/promises';
import * as emby from "./emby.js";
import {jParse}  from "./util.js";

const lastViewedStr =
  fs.readFileSync('data/lastViewed.json', 'utf8');
const lastViewed = jParse(lastViewedStr, 'lastViewed');

let lastShowName = null;
const checkWatch = async () => {
  const showName = await emby.getCurrentlyWatching();
  if(showName !== null)
    lastViewed[showName] = Date.now();
  if(showName != lastShowName) {
    await fsp.writeFile('data/lastViewed.json',
                JSON.stringify(lastViewed));
  }
  lastShowName = showName;
}

setInterval(async () => {
  await checkWatch();
}, 5 * 60 * 1000);  // 5 mins

export const getLastViewed = (id, _param, resolve, _reject) => {
  resolve([id, lastViewed]);
}

await checkWatch();
