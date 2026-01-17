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

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

ensureDir(SRVR_DATA_DIR);

function ensureFile(filePath, defaultStr) {
  try {
    if (fs.existsSync(filePath)) return;
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, defaultStr, 'utf8');
  } catch {}
}

ensureFile(LAST_VIEWED_PATH, '{}');

let lastViewed = {};
try {
  const raw = fs.readFileSync(LAST_VIEWED_PATH, 'utf8');
  lastViewed = jParse(raw, 'lastViewed') || {};
} catch {
  lastViewed = {};
  try {
    ensureFile(LAST_VIEWED_PATH, '{}');
  } catch {}
}

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
