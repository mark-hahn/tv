import fs                  from "fs";
import * as cp             from 'child_process';
import * as path           from 'node:path';
import { WebSocketServer } from 'ws';
import {rimraf}            from 'rimraf'
import * as view           from './src/lastViewed.js';
import * as utilNode       from "util";
import * as emby           from './src/emby.js';
import * as tvdb           from './src/tvdb.js';
import * as util           from "./src/util.js";
import * as email          from './src/email.js';
import * as tmdb           from './src/tmdb.js';
import fetch               from 'node-fetch';

const dontupload  = false;

process.setMaxListeners(50);
const tvDir = '/mnt/media/tv';
const exec  = utilNode.promisify(cp.exec);

const headerStr  = fs.readFileSync('config/config1-header.txt',   'utf8');
const rejectStr  = fs.readFileSync('config/config2-rejects.json', 'utf8');
const middleStr  = fs.readFileSync('config/config3-middle.txt',   'utf8');
const pickupStr  = fs.readFileSync('config/config4-pickups.json', 'utf8');
const footerStr  = fs.readFileSync('config/config5-footer.txt',   'utf8');
const noEmbyStr  = fs.readFileSync('data/noemby.json',            'utf8');
const gapsPath   = 'data/gaps.json';
const gapsStr    = fs.readFileSync(gapsPath,                      'utf8');

const subsLoginPath = 'secrets/subs-login.txt';
const subsTokenPath = 'secrets/subs-token.txt';

// OpenSubtitles requires a real app User-Agent; it will 403 on generic ones (e.g. node-fetch).
const openSubtitlesUserAgent = 'tv-series-srvr v1.0.0';

let subsTokenCache = null;
try {
  const token = fs.readFileSync(subsTokenPath, 'utf8');
  subsTokenCache = typeof token === 'string' && token.trim() ? token.trim() : null;
} catch {
  subsTokenCache = null;
}

const notesPath = 'data/notes.json';
let notesCache = {};
try {
  const notesStr = fs.readFileSync(notesPath, 'utf8');
  notesCache = JSON.parse(notesStr || '{}') || {};
} catch (e) {
  // First run or corrupt JSON: create/reset to empty.
  try {
    fs.writeFileSync(notesPath, '{}', 'utf8');
  } catch {}
  notesCache = {};
}

// Ensure we never keep/persist empty notes.
try {
  let changed = false;
  const cleaned = {};
  for (const [rawKey, rawVal] of Object.entries(notesCache ?? {})) {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key) {
      changed = true;
      continue;
    }

    const val = rawVal === undefined || rawVal === null ? '' : String(rawVal);
    if (val.trim() === '') {
      changed = true;
      continue;
    }

    if (key !== rawKey || val !== rawVal) changed = true;
    cleaned[key] = val;
  }

  if (changed) {
    notesCache = cleaned;
    try {
      fs.writeFileSync(notesPath, JSON.stringify(notesCache), 'utf8');
    } catch {}
  }
} catch {}

const rejects      = JSON.parse(rejectStr);
const pickups      = JSON.parse(pickupStr);
const noEmbys      = JSON.parse(noEmbyStr);
const gaps         = JSON.parse(gapsStr);
const notes        = notesCache;

function normalizeImdbId(imdbId) {
  if (imdbId === undefined || imdbId === null) return '';
  const s = String(imdbId).trim();
  if (!s) return '';
  // remove leading tt and any non-digits
  return s.replace(/^tt/i, '').replace(/\D/g, '');
}

function loadSubsLogin() {
  let loginStr;
  try {
    loginStr = fs.readFileSync(subsLoginPath, 'utf8');
  } catch (e) {
    throw new Error(`subsSearch: missing ${subsLoginPath}`);
  }

  let login;
  try {
    login = JSON.parse(loginStr);
  } catch (e) {
    throw new Error(`subsSearch: invalid JSON in ${subsLoginPath}`);
  }

  const apiKey = typeof login?.apiKey === 'string' ? login.apiKey.trim() : '';
  const username = typeof login?.username === 'string' ? login.username.trim() : '';
  const password = typeof login?.password === 'string' ? login.password.trim() : '';

  if (!apiKey) throw new Error('subsSearch: missing apiKey');
  // username/password only required for login refresh path

  return { apiKey, username, password };
}

async function persistSubsToken(token) {
  const t = typeof token === 'string' ? token.trim() : '';
  if (!t) throw new Error('subsSearch: empty token');
  subsTokenCache = t;
  await util.writeFile(subsTokenPath, t);
}

async function openSubtitlesLogin({ apiKey, username, password }) {
  if (!username || !password) {
    throw new Error('subsSearch: cannot login (missing username/password)');
  }

  const url = 'https://api.opensubtitles.com/api/v1/login';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'User-Agent': openSubtitlesUserAgent,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    body = { error: (text || '').slice(0, 500) };
  }

  if (!resp.ok) {
    const msg = body?.message || body?.error || `OpenSubtitles login failed (${resp.status})`;
    throw new Error(`subsSearch: ${msg}`);
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) throw new Error('subsSearch: login succeeded but no token returned');
  return token;
}

async function openSubtitlesSubtitles({ apiKey, token, imdbDigits, page }) {
  const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
  url.search = new URLSearchParams({
    parent_imdb_id: imdbDigits,
    page: String(page),
    languages: 'en',
  }).toString();

  const headers = {
    'Api-Key': apiKey,
    'User-Agent': openSubtitlesUserAgent,
    'Accept': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url.toString(), { headers });

  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    body = { error: text || `OpenSubtitles non-JSON response (${resp.status})` };
  }

  return { resp, body };
}

const subsSearch = async (id, param, resolve, reject) => {
  const parsed = util.jParse(param, 'subsSearch');
  const imdbDigits = normalizeImdbId(parsed?.imdb_id);
  let page = parsed?.page;

  if (!imdbDigits) {
    reject([id, { error: 'subsSearch: missing imdb_id' }]);
    return;
  }

  if (page === undefined || page === null || page === '') page = 1;
  page = Number(page);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let login;
  try {
    login = loadSubsLogin();
  } catch (e) {
    reject([id, { error: e.message }]);
    return;
  }

  // First attempt with existing token (if any)
  try {
    const { resp, body } = await openSubtitlesSubtitles({
      apiKey: login.apiKey,
      token: subsTokenCache,
      imdbDigits,
      page,
    });

    if (resp.ok) {
      resolve([id, body]);
      return;
    }

    // Refresh token on auth failure and retry once.
    if (resp.status === 401 || resp.status === 403) {
      const newToken = await openSubtitlesLogin(login);
      await persistSubsToken(newToken);

      const retry = await openSubtitlesSubtitles({
        apiKey: login.apiKey,
        token: subsTokenCache,
        imdbDigits,
        page,
      });

      if (retry.resp.ok) {
        resolve([id, retry.body]);
        return;
      }

      reject([id, { error: `subsSearch: OpenSubtitles HTTP ${retry.resp.status}`, details: retry.body }]);
      return;
    }

    reject([id, { error: `subsSearch: OpenSubtitles HTTP ${resp.status}`, details: body }]);
  } catch (e) {
    reject([id, { error: `subsSearch: ${e.message}` }]);
  }
};

function gapEntryHasGap(gap) {
  if (!gap || typeof gap !== 'object') return false;

  // Boolean flags that indicate a gap condition.
  if (gap.FileGap === true) return true;
  if (gap.WatchGap === true) return true;
  if (gap.NotReady === true) return true;

  // Explicit season/episode markers (allow 0).
  if (gap.FileGapSeason !== null && gap.FileGapSeason !== undefined) return true;
  if (gap.FileGapEpisode !== null && gap.FileGapEpisode !== undefined) return true;
  if (gap.WatchGapSeason !== null && gap.WatchGapSeason !== undefined) return true;
  if (gap.WatchGapEpisode !== null && gap.WatchGapEpisode !== undefined) return true;

  // Non-empty wait string can also indicate a gap state.
  if (typeof gap.WaitStr === 'string' && gap.WaitStr.trim() !== '') return true;

  return false;
}

function stripGapTransientFields(gap) {
  if (!gap || typeof gap !== 'object') return false;
  let changed = false;

  // `Waiting` is transient client state; never persist it.
  if (Object.prototype.hasOwnProperty.call(gap, 'Waiting')) {
    delete gap.Waiting;
    changed = true;
  }

    // Legacy field removed from the data model; never persist it.
  if (Object.prototype.hasOwnProperty.call(gap, 'BlockedGap')) {
    delete gap.BlockedGap;
    changed = true;
  }

  return changed;
}

// Prune gaps on load: only keep shows that currently have gaps.
try {
  if (gaps && typeof gaps === 'object' && !Array.isArray(gaps)) {
    let changed = false;
    for (const [gapId, gap] of Object.entries(gaps)) {
      // Never persist transient/removed fields.
      if (stripGapTransientFields(gap)) changed = true;
      if (!gapEntryHasGap(gap)) {
        delete gaps[gapId];
        changed = true;
      }
    }
    if (changed) {
      try {
        fs.writeFileSync(gapsPath, JSON.stringify(gaps), 'utf8');
      } catch {}
    }
  }
} catch {}

// Set up callback for tvdb to add shows to pickup list
tvdb.setAddToPickupsCallback((showName) => {
  // Check if already in pickup list
  const alreadyInPickups = pickups.some(
    pickup => pickup.toLowerCase() === showName.toLowerCase()
  );
  if (!alreadyInPickups) {
    console.log('Auto-adding to pickups (not in emby):', showName);
    pickups.push(showName);
    // Save and upload config asynchronously without blocking
    (async () => {
      await trySaveConfigYml(null, null, () => {}, () => {});
    })();
  }
});

const videoFileExtensions = [
  "mp4", "mkv", "avi", "mov", "wmv", "flv", "mpeg",
  "3gp", "m4v", "ts", "rm", "vob", "ogv", "divx"
];

function safeShowFolderName(rawName) {
  if (typeof rawName !== 'string') return null;

  let name = rawName.trim();
  if (!name) return null;

  // Prevent traversal / invalid names: remove path separators and trailing dots/spaces.
  name = name.replaceAll('/', ' ').replaceAll('\\', ' ');
  name = name.replace(/[\x00-\x1F\x7F]/g, ' ');
  name = name.replace(/[\.\s]+$/g, '');
  name = name.replace(/\s{2,}/g, ' ').trim();
  if (!name) return null;

  return name;
}

function seasonFolderName(season) {
  // Keep consistent with existing convention used elsewhere: `Season ${season}`.
  // If season is a number, keep it unpadded (Season 1). If it's a string like "01", preserve it.
  if (season === null || season === undefined) return null;
  const s = typeof season === 'number' ? String(season) : String(season).trim();
  if (!s) return null;
  return `Season ${s}`;
}

function rpcParamToString(param) {
  // Param is usually a raw string, but tolerate JSON-stringified strings.
  if (param === undefined || param === null) return '';
  if (typeof param !== 'string') return String(param);
  const trimmed = param.trim();
  if (trimmed === '') return '';
  if (trimmed === 'null') return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : String(parsed);
    } catch {
      return param;
    }
  }
  return param;
}

function fmtDateWithTZ(date, utcOut = false) {
  let year, month, day;
  if(utcOut) {
    year = date.getUTCFullYear();
    month = String(date.getUTCMonth() + 1).padStart(2, '0');
    day = String(date.getUTCDate()).padStart(2, '0');
  } else {
    year = date.getFullYear();
    month = String(date.getMonth() + 1).padStart(2, '0');
    day = String(date.getDate()).padStart(2, '0');
  }
  return `${year}-${month}-${day}`;
}

const getShowsFromDisk = async (id, _param, resolve, reject) => {
  let   errFlg = null;
  const shows = {};

  let maxDate, totalSize;

  const recurs = async (path) => {
    if(errFlg || path == tvDir + '/.stfolder') return;
    try {
      const fstat = fs.statSync(path);
      if(fstat.isDirectory()) {
        const dir = fs.readdirSync(path);
        for (const dirent of dir) 
          await recurs(path + '/' + dirent);
        return;
      }
      const sfx = path.split('.').pop();
      if(videoFileExtensions.includes(sfx)) {
        const date = fmtDateWithTZ(fstat.mtime);
        maxDate    = Math.max(maxDate, date);
      }
      totalSize += fstat.size;
    }
    catch (err) {
      errFlg = err;
    }
  }

  const dir =  fs.readdirSync(tvDir);
  for (const dirent of dir) {
    const showPath = tvDir + '/' + dirent;
    const fstat   = fs.statSync(showPath);
    const maxDate = fmtDateWithTZ(fstat.mtime);
    totalSize = 0;

    await recurs(showPath);

    shows[dirent] = [maxDate, totalSize];
    if(totalSize == 0) {
      console.log('empty show:', dirent);
    }
  }
  if(errFlg) {
    reject([id, `getShowsFromDisk: ${dirent}, ${err.message}`]);
    return;
  }
  else {
    resolve([id, shows]);
    return;
  }
}
 
const upload = async () => {
  let str = headerStr;
  str += '        - "dummy"\n';
  for(let name of rejects)
    str += '        - "' + name.replace(/"/g, '') + '"\n';
  console.log({str});
  str += middleStr;
  for(let name of pickups)
    str += '        - "' + name.replace(/"/g, '') + '"\n';
  str += footerStr;
  console.log('creating config.yml');
  await util.writeFile('config/config.yml', str);

  if(dontupload) {
    console.log("---- didn't upload config.yml ----");
    return 'ok';
  }

  console.log('uploading config.yml');
  const timeBeforeUSB = new Date().getTime();
  const {stdout} = await exec(
          'rsync -av config/config.yml xobtlu@oracle.usbx.me:' +
          '/home/xobtlu/.config/flexget/config.yml');
  console.log(
      'upload delay:', new Date().getTime() - timeBeforeUSB);

  const rx = new RegExp('total size is ([0-9,]*)');
  const matches = rx.exec(stdout);
  if(!matches || parseInt(matches[1].replace(',', '')) < 1000) {
    console.error('\nERROR: config.yml upload failed\n', stdout, '\n');
    return `config.yml upload failed: ${stdout.toString()}`;
  }
  console.log('uploaded config.yml, size:', matches[1]);
  return 'ok';
}

const reload = async () => {
  if(dontupload) {
    console.log("---- didn't reload ----");
    return 'ok';
  }

  console.log('reloading config.yml');
  const timeBeforeUSB = new Date().getTime();
  const {stdout} = await exec(
    'ssh xobtlu@oracle.usbx.me /home/xobtlu/reload-cmd');
  console.log(
      'reload delay:', new Date().getTime() - timeBeforeUSB);

  if(!stdout.includes('Config successfully reloaded'))  {
    console.log('\nERROR: config.yml reload failed\n', stdout, '\n');
    return `config.yml reload failed: ${stdout.toString()}`;
  }
  console.log('reloaded config.yml');
  return 'ok';
}

let saving = false;

const trySaveConfigYml = async (id, result, resolve, reject) => {
  if(saving) return ['busy', id, result, resolve, reject];
  saving = true;
  rejects.sort((a,b) => { 
    return (a.toLowerCase() > b.toLowerCase() ? +1 : -1);
  });
  pickups.sort((a,b) => { 
    const aname = a.replace(/The\s/i, '');
    const bname = b.replace(/The\s/i, '');
    return (aname.toLowerCase() > bname.toLowerCase() ? +1 : -1);
  });
  await util.writeFile('config/config2-rejects.json', rejects);
  await util.writeFile('config/config4-pickups.json', pickups);

  let errResult = null;

  const uploadRes = await upload();
  if(uploadRes != 'ok') errResult = uploadRes;
  if(!errResult) {
    const reloadRes = await reload();
    if(reloadRes != 'ok') errResult = reloadRes;
  }

  if(errResult) {
    console.log('trySaveConfigYml error:', errResult);
    saving = false;
    return ['err', id, errResult, resolve, reject];
  }

  saving = false;
  return ['ok', id, result, resolve, reject];
};

// this always sends a response to the client
// can be called and forgotten
const saveConfigYml = async (idIn, resultIn, resolveIn, rejectIn) => {
  const tryRes = await trySaveConfigYml(idIn, resultIn, resolveIn, rejectIn);    
  const [status, id, result, resolve, reject] = tryRes;
  switch(status) {
    case 'busy': 
      setTimeout(() => saveConfigYml(id, result, resolve, reject), 1000); 
      break;
    case 'ok':  resolve([id, result]); break;
    case 'err': reject( [id, tryRes]); break;
  }
}

const getRejects = (id, _param, resolve, _reject) => {
  resolve([id, rejects]);
};

const addReject = (id, name, resolve, reject) => {
  console.log('addReject', id, name);
  for(const [idx, rejectNameStr] of rejects.entries()) {
    if(rejectNameStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- removing old matching reject:', rejectNameStr);
      rejects.splice(idx, 1);
      break;
    }
  }
  console.log('-- adding reject:', name);
  rejects.push(name);
  saveConfigYml(id, 'ok', resolve, reject);
}

const delReject = (id, name, resolve, reject) => {
  console.log('delReject', id, name);
  let deletedOne = false;
  for(const [idx, rejectNameStr] of rejects.entries()) {
    if(rejectNameStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- deleting reject:', rejectNameStr);
      rejects.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if(!deletedOne) {
    console.log('-- reject not deleted -- no match:', name);
    resolve([id, 'delReject not deleted: ' + name]);
    return
  }
  saveConfigYml(id, 'ok', resolve, reject);
}

const getPickups = (id, _param, resolve, _reject) => {
  resolve([id, pickups]);
};

const addPickup = (id, name, resolve, reject) => {
  console.log('addPickup', id, name);
  for(const [idx, pickupNameStr] of pickups.entries()) {
    if(pickupNameStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- removing old matching pickup:', pickupNameStr);
      pickups.splice(idx, 1);
      break;
    }
  }
  console.log('-- adding pickup:', name);
  pickups.push(name);
  saveConfigYml(id, 'ok', resolve, reject);
}

const delPickup = (id, name, resolve, reject) => {
  console.log('delPickup', id, name);
  let deletedOne = false;
  for(const [idx, pickupNameStr] of pickups.entries()) {
    if(pickupNameStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- deleting pickup:', pickupNameStr);
      pickups.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if(!deletedOne) {
    resolve([id, 'delPickup no match: ' + name]);
    console.log('pickup not deleted, no match:', name);
    return;
  }
  saveConfigYml(id, 'ok', resolve, reject);
}

const getNoEmbys = (id, _param, resolve, _reject) => {
  resolve([id, noEmbys]);
};

const addNoEmby = async (id, showStr, resolve) => {
  const show = JSON.parse(showStr);
  // if(show.Reject) return;
  const name = show.Name;
  console.log('addNoEmby', id, name);
  for(const [idx, show] of noEmbys.entries()) {
    if(show.Name.toLowerCase() === name.toLowerCase()) {
      console.log('removing old noemby:', name);
      noEmbys.splice(idx, 1);
      break;
    }
  }
  console.log('adding noemby:', name);
  noEmbys.push(show);
  await util.writeFile('data/noemby.json', noEmbys); 
  resolve([id, 'ok']);
}

const delNoEmby = async (id, name, resolve, reject) => {
  console.log('delNoEmby', id, name);
  let deletedOne = false;
  for(const [idx, show] of noEmbys.entries()) {
    if(!show.Name ||
        show.Name.toLowerCase() === name.toLowerCase()) {
      console.log('deleting no-emby because now in emby:', name);
      noEmbys.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if(!deletedOne) {
    console.log('no noembys deleted, no match:', name);
    resolve([id, 'delNoEmby no match:' + name]);
    return;
  }
  await util.writeFile('data/noemby.json', noEmbys); 
  resolve([id, 'ok']);
}

const getGaps = (id, _param, resolve, _reject) => {
  resolve([id, gaps]);
};

const addGap = async (id, gapIdGapSave, resolve, _reject) => {
  const [gapId, gap, save] = JSON.parse(gapIdGapSave);
  // console.logapIdGapSaveg('addGap', id, {gapIdGapSave});
  if (gapId !== null && gapId !== undefined) {
    stripGapTransientFields(gap);
    if (gapEntryHasGap(gap)) gaps[gapId] = gap;
    else delete gaps[gapId];
  }
  if(save) await util.writeFile(gapsPath, gaps); 
  resolve([id, 'ok']);
}

const delGap = async (id, gapIdSave, resolve, _reject) => {
  console.log('delGap', id, {gapIdSave});
  const [gapId, save] = JSON.parse(gapIdSave);
  if(gapId !== null) delete gaps[gapId];
  if(save) {
    await util.writeFile(gapsPath, gaps); 
  }
  resolve([id, 'ok']);
}

const delSeasonFiles = async (id, param, resolve, reject) => {
  const params = util.jParse(param, 'delSeasonFiles');
  const showName = params?.showName;
  const showPath = params?.showPath;
  const season = params?.season;

  if (!showName || !showPath || season === undefined || season === null) {
    reject([id, {err: 'delSeasonFiles: requires showName, showPath, season'}]);
    return;
  }

  const seasonDir = path.join(showPath, `Season ${season}`);
  console.log(`[delSeasonFiles] ${showName}: ${seasonDir}`);

  if (!fs.existsSync(seasonDir)) {
    reject([id, {err: `no such dir: ${seasonDir}`}]);
    return;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(seasonDir);
  } catch (e) {
    reject([id, {err: `delSeasonFiles: readdir failed: ${e.message}`}]);
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(seasonDir, entry);
    console.log(`[delSeasonFiles] deleting: ${entryPath}`);
    try {
      await rimraf(entryPath);
    } catch (e) {
      reject([id, {err: `delSeasonFiles: delete failed: ${e.message}`}]);
      return;
    }
  }

  resolve([id, {status: 'ok'}]);
}

const createShowFolder = async (id, param, resolve, reject) => {
  const params = util.jParse(param, 'createShowFolder');
  const showNameRaw = params?.showName;
  const seriesMapSeasons = params?.seriesMapSeasons;

  console.log('[createShowFolder] request', {
    id,
    showName: showNameRaw,
    tvdbId: params?.tvdbId,
    seriesMapSeasons,
  });

  const showName = safeShowFolderName(showNameRaw);
  if (!showName) {
    console.log('[createShowFolder] invalid showName', { showNameRaw });
    reject([id, { err: 'createShowFolder: invalid showName' }]);
    return;
  }

  const showPath = path.join(tvDir, showName);
  const existed = fs.existsSync(showPath);

  try {
    fs.mkdirSync(showPath, { recursive: true });
    console.log('[createShowFolder] show dir', { showPath, existed });
  } catch (e) {
    reject([id, { err: `createShowFolder: mkdir failed: ${e.message}` }]);
    return;
  }

  if (Array.isArray(seriesMapSeasons)) {
    for (const season of seriesMapSeasons) {
      const seasonDirName = seasonFolderName(season);
      if (!seasonDirName) continue;
      const seasonPath = path.join(showPath, seasonDirName);
      try {
        fs.mkdirSync(seasonPath, { recursive: true });
        console.log('[createShowFolder] season dir', { season, seasonPath });
      } catch (e) {
        reject([id, { err: `createShowFolder: mkdir season failed: ${e.message}` }]);
        return;
      }
    }
  } else if (seriesMapSeasons !== undefined) {
    console.log('[createShowFolder] seriesMapSeasons not an array; skipping season dirs', {
      seriesMapSeasonsType: typeof seriesMapSeasons,
    });
  }

  resolve([id, { ok: true, created: !existed, path: showPath }]);
}

let sharedFilters = null;

const setSharedFilters = (id, param, resolve, reject) => {
  // Client sends JSON.stringify(object) or "null".
  if (param === '' || param === undefined || param === null) {
    sharedFilters = null;
    resolve([id, { ok: true }]);
    return;
  }

  const parsed = util.jParse(param, 'setSharedFilters');
  if (parsed === null) {
    sharedFilters = null;
    resolve([id, { ok: true }]);
    return;
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    reject([id, { err: 'setSharedFilters: expected object or null' }]);
    return;
  }

  sharedFilters = parsed;
  resolve([id, { ok: true }]);
};

const getSharedFilters = (id, _param, resolve, _reject) => {
  resolve([id, sharedFilters]);
};

const getNote = (id, param, resolve, reject) => {
  const showName = rpcParamToString(param).trim();
  if (!showName) {
    reject([id, { err: 'getNote: missing showName' }]);
    return;
  }
  resolve([id, notesCache[showName] ?? '' ]);
};

const getAllNotes = (id, _param, resolve, _reject) => {
  // Return a shallow copy so callers can't mutate server cache by reference.
  // Also defensively filter empty notes.
  const out = {};
  for (const [key, val] of Object.entries(notesCache)) {
    if (typeof val === 'string' && val.trim() !== '') out[key] = val;
  }
  resolve([id, out]);
};

const saveNote = async (id, param, resolve, reject) => {
  if (param === undefined || param === null || param === '') {
    reject([id, { err: 'saveNote: missing params' }]);
    return;
  }

  const parsed = util.jParse(param, 'saveNote');
  let showName;
  let noteText;

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    showName = parsed.showName;
    noteText = parsed.noteText;
  } else {
    reject([id, { err: 'saveNote: expected { showName, noteText }' }]);
    return;
  }

  if (typeof showName !== 'string' || showName.trim() === '') {
    reject([id, { err: 'saveNote: invalid showName' }]);
    return;
  }
  if (noteText === undefined || noteText === null) noteText = '';
  if (typeof noteText !== 'string') noteText = String(noteText);

  const key = showName.trim();

  // Never store empty notes: treat as delete.
  if (noteText.trim() === '') {
    if (notesCache[key] === undefined) {
      resolve([id, 'ok']);
      return;
    }
    delete notesCache[key];
    try {
      await util.writeFile(notesPath, notesCache);
    } catch (e) {
      reject([id, { err: `saveNote: write failed: ${e.message}` }]);
      return;
    }
    resolve([id, 'ok']);
    return;
  }

  const prev = notesCache[key];
  if (prev === noteText) {
    resolve([id, 'ok']);
    return;
  }

  notesCache[key] = noteText;
  try {
    // Flush to disk on every change.
    await util.writeFile(notesPath, notesCache);
  } catch (e) {
    reject([id, { err: `saveNote: write failed: ${e.message}` }]);
    return;
  }

  resolve([id, 'ok']);
};

const getFile = (id, param, resolve, reject) => {
  // Param is usually a raw string path (per RPC protocol). Allow "" => tvDir.
  let requestedPath = param;
  if (requestedPath === undefined || requestedPath === null) requestedPath = '';

  // If someone accidentally JSON.stringified a string, tolerate it.
  if (typeof requestedPath === 'string') {
    const trimmed = requestedPath.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || trimmed === 'null') {
      try {
        requestedPath = JSON.parse(trimmed);
      } catch {
        // keep as-is
        requestedPath = param;
      }
    }
  }

  if (typeof requestedPath !== 'string') {
    reject([id, { err: 'getFile: param must be a string path' }]);
    return;
  }

  const rawPath = requestedPath.trim();
  const basePath = tvDir;
  const targetPath = rawPath ? path.resolve(rawPath) : path.resolve(basePath);

  // Safety: only allow listings within tvDir.
  const allowedRoot = path.resolve(basePath) + path.sep;
  if (!(targetPath + path.sep).startsWith(allowedRoot) && targetPath !== path.resolve(basePath)) {
    reject([id, { err: `getFile: path not allowed: ${rawPath}` }]);
    return;
  }

  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (e) {
    reject([id, { err: `getFile: stat failed: ${e.message}` }]);
    return;
  }

  if (!stat.isDirectory()) {
    reject([id, { err: 'getFile: path is not a directory' }]);
    return;
  }

  let dirents;
  try {
    dirents = fs.readdirSync(targetPath, { withFileTypes: true });
  } catch (e) {
    reject([id, { err: `getFile: readdir failed: ${e.message}` }]);
    return;
  }

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });

  dirents.sort((a, b) => collator.compare(a.name, b.name));

  const out = [];
  for (const d of dirents) {
    const name = d.name;
    if (!name) continue;

    if (d.isDirectory()) {
      const childPath = path.join(targetPath, name);
      try {
        const childDirents = fs.readdirSync(childPath, { withFileTypes: true });
        const childNames = childDirents
          .map((cd) => cd.name)
          .filter(Boolean)
          .sort((a, b) => collator.compare(a, b));
        out.push({ [name]: childNames });
      } catch {
        // If we can't read the directory, still return it with empty children.
        out.push({ [name]: [] });
      }
    } else {
      out.push(name);
    }
  }

  resolve([id, out]);
};

const applySubFiles = async (id, param, resolve, reject) => {
  if (param === undefined || param === null || param === '') {
    reject([id, { error: 'applySubFiles: missing params' }]);
    return;
  }

  const parsed = util.jParse(param, 'applySubFiles');
  if (parsed === null) {
    reject([id, { error: 'applySubFiles: invalid JSON params' }]);
    return;
  }

  try {
    // For now: just persist request for inspection.
    await util.writeFile('samples/fileIdObjs.json', parsed);
    resolve([id, 'ok']);
  } catch (e) {
    reject([id, { error: `applySubFiles: write failed: ${e.message}` }]);
  }
};

const deletePath = async (id, path, resolve, _reject) => {
  // console.log('deletePath', id, path);
  try {
    await rimraf(path);
  }
  catch(e) {
    console.log('error removing path:', path, e.message)
    resolve([id, e.message]);
    return
  }
  resolve([id, 'ok']);
};

const sendEmailHandler = async (id, bodyText, resolve, reject) => {
  console.log('sendEmailHandler', id, bodyText);
  try {
    await email.sendEmail(bodyText);
    resolve([id, 'ok']);
  } catch (error) {
    reject([id, error.message]);
  }
};

//////////////////  CALL FUNCTION SYNCHRONOUSLY  //////////////////

const queue = [];
let running = false;

const runOne = () => {
  if(running || queue.length == 0) return;
  running == true;

  const {ws, id, fname, param} = queue.pop();
  if(ws.readyState !== WebSocket.OPEN) return;

  let resolve = null;
  let reject  = null;

  // param called when promise is resolved or rejected
  // there is one unique promise for each function call
  const promise = new Promise((resolveIn, rejectIn) => {
    resolve = resolveIn; 
    reject  = rejectIn;
  });

  promise
  .then((idResult) => {
    const [id, result] = idResult;
    // console.log('resolved:', id);
    ws.send(`${id}~~~ok~~~${JSON.stringify(result)}`); 
    running == false;
    runOne();
  })
  .catch((idError) => {
    console.error('idResult err:', {idError});
    const [id, error] = idError;
    ws.send(`${id}~~~err~~~${JSON.stringify(error)}`); 
    running == false;
    runOne();
  });

  // call function fname
  switch (fname) {
    case 'getShowsFromDisk':   getShowsFromDisk(       id,    '', resolve, reject); break;
    case 'deletePath':    deletePath(        id, param, resolve, reject); break;

    case 'getDevices':    emby.getDevices(   id,    '', resolve, reject); break;
    case 'getLastViewed': view.getLastViewed(id,    '', resolve, reject); break;

    case 'getRejects':  getRejects(id, '',    resolve, reject); break;
    case 'addReject':   addReject( id, param, resolve, reject); break;
    case 'delReject':   delReject( id, param, resolve, reject); break;

    case 'getPickups':  getPickups(id, '',    resolve, reject); break;
    case 'addPickup':   addPickup( id, param, resolve, reject); break;
    case 'delPickup':   delPickup( id, param, resolve, reject); break;

    case 'getNoEmbys':  getNoEmbys(id, '',    resolve, reject); break;
    case 'addNoEmby':   addNoEmby( id, param, resolve, reject); break;
    case 'delNoEmby':   delNoEmby( id, param, resolve, reject); break;
    
    case 'getGaps':     getGaps(   id, '',    resolve, reject); break;
    case 'addGap':      addGap(    id, param, resolve, reject); break;
    case 'delGap':      delGap(    id, param, resolve, reject); break;

    case 'delSeasonFiles': delSeasonFiles(id, param, resolve, reject); break;
    
    case 'getAllTvdb':    tvdb.getAllTvdb(   id, param, resolve, reject); break;
    case 'getNewTvdb':    tvdb.getNewTvdb(   id, param, resolve, reject); break;
    case 'setTvdbFields': tvdb.setTvdbFields(id, param, resolve, reject); break;
    case 'getRemotes':    tvdb.getRemotesCmd(id, param, resolve, reject); break;
    case 'getActorPage':  tvdb.getActorPage( id, param, resolve, reject); break;
    case 'sendEmail':     sendEmailHandler(  id, param, resolve, reject); break;
    
    case 'getTmdb':       tmdb.getTmdb(      id, param, resolve, reject); break;

    case 'setSharedFilters': setSharedFilters(id, param, resolve, reject); break;
    case 'getSharedFilters': getSharedFilters(id, param, resolve, reject); break;

    case 'getNote':  getNote( id, param, resolve, reject); break;
    case 'saveNote': saveNote(id, param, resolve, reject); break;
    case 'getAllNotes': getAllNotes(id, param, resolve, reject); break;

    case 'getFile': getFile(id, param, resolve, reject); break;

    case 'subsSearch': subsSearch(id, param, resolve, reject); break;

    case 'applySubFiles': applySubFiles(id, param, resolve, reject); break;

    case 'createShowFolder': createShowFolder(id, param, resolve, reject); break;

    default: reject([id, 'unknownfunction: ' + fname]);
  };
}

//////////////////  WEBSOCKET SERVER  //////////////////

const wss = new WebSocketServer({ port: 8736 });
console.log('wss listening on port 8736');

const appSocketName = 'web app websocket';

wss.on('connection', (ws) => {
  let socketName = 'unknown websocket';

  ws.on('message', (data) => {
    const msg = data.toString();
    const firstSep = msg.indexOf('~~~');
    const secondSep = firstSep >= 0 ? msg.indexOf('~~~', firstSep + 3) : -1;
    if(firstSep < 0 || secondSep < 0) {
      console.error('ignoring bad message:', msg);
      return;
    }
    const id = msg.slice(0, firstSep);
    const fname = msg.slice(firstSep + 3, secondSep);
    const param = msg.slice(secondSep + 3);
    if(socketName != appSocketName) {
      socketName = appSocketName;
      console.log(socketName + ' connected');
    }
    if(fname == 'getNewTvdb') {
      tvdb.getNewTvdb(ws, id, param) 
    }
    else {
      queue.unshift({ws, id, fname, param});
      runOne();
    }
  });

  ws.on('error', (err) => {
    console.error(socketName, 'error:', err.message);
    socketName = 'unknown websocket';
  });

  ws.on('close', () => {
    // log(socketName + ' closed');
    socketName = 'unknown websocket';
  });
});
