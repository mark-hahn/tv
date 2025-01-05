import fs        from "fs";
import * as fsp  from 'fs/promises';
import * as emby from "./emby.js";

const lastViewedStr = 
        fs.readFileSync('data/lastViewed.json', 'utf8');
const lastViewed = JSON.parse(lastViewedStr);

const checkWatch = async () => {
  const showName = await emby.getCurrentlyWatching();

  if(lastShowName !== null && showName === null) {
      await fsp.writeFile('data/lastViewed.json', 
                            JSON.stringify(lastViewed));
  }
  if(showName !== null) 
      lastViewed[showName] = Date.now();

  lastShowName = showName;

  console.log({lastShowName, showName, 
                    lastViewed: JSON.stringify(lastViewed, null,2)});
}

let lastShowName = null;
setInterval(async ()=> {
  await checkWatch();
}, 5*60*1000);  // 5 mins

export const getLastViewed = (id, _param, resolve, _reject) => {
  resolve([id, lastViewed]);
}

await checkWatch();
