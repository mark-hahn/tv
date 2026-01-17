import fs        from "fs";
import * as fsp  from 'fs/promises';
import * as path from 'node:path';
import * as emby from "./emby.js";
import {jParse}  from "./util.js";

const DEFAULT_TV_DATA_DIR = '/mnt/media/archive/dev/apps/tv-data';
const TV_DATA_DIR = (typeof process.env.TV_DATA_DIR === 'string' && process.env.TV_DATA_DIR.trim())
  ? process.env.TV_DATA_DIR.trim()
  : DEFAULT_TV_DATA_DIR;

const SRVR_DATA_DIR = path.join(TV_DATA_DIR, 'srvr', 'data');
const LAST_VIEWED_PATH = path.join(SRVR_DATA_DIR, 'lastViewed.json');
const LEGACY_LAST_VIEWED_PATH = 'data/lastViewed.json';

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function lastViewedReadPath() {
  try {
    if (fs.existsSync(LAST_VIEWED_PATH)) return LAST_VIEWED_PATH;
  } catch {}
  return LEGACY_LAST_VIEWED_PATH;
}

ensureDir(SRVR_DATA_DIR);

const lastViewedStr =
            fs.readFileSync(lastViewedReadPath(), 'utf8');
const lastViewed = jParse(lastViewedStr, 'lastViewed');

export const getLastViewed = (id, _param, resolve, _reject) => {
  resolve([id, lastViewed]);
}

let lastShowNameByDeviceName = {};
const checkWatch  = async () => {
  const onDevices = await emby.getOnDevices();
  for(const onDevice of onDevices) {
    if(!onDevice.showName) continue;
    const {deviceName, showName} = onDevice;
    const lastShowName = lastShowNameByDeviceName[deviceName];
    if(showName) lastViewed[showName] = Date.now();
    if(showName != lastShowName) {
      await fsp.mkdir(path.dirname(LAST_VIEWED_PATH), { recursive: true });
      await fsp.writeFile(LAST_VIEWED_PATH, JSON.stringify(lastViewed));
    }
    lastShowNameByDeviceName[deviceName] = showName;
  }
}

setInterval(async () => {
  await checkWatch();
}, 60 * 1000);  // 1 minute

setTimeout(checkWatch, 1000);
