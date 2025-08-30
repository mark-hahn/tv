import fs                  from "fs";
import * as cp             from 'child_process';
import { WebSocketServer } from 'ws';
import {rimraf}            from 'rimraf'
import * as view           from './src/lastViewed.js';
import * as utilNode       from "util";
import * as emby           from './src/emby.js';
import * as tvdb           from './src/tvdb.js';
import * as util           from "./src/util.js";

const dontupload  = false;

process.setMaxListeners(50);
const tvDir = '/mnt/media/tv';
const exec  = utilNode.promisify(cp.exec);

const headerStr  = fs.readFileSync('config/config1-header.txt',   'utf8');
const rejectStr  = fs.readFileSync('config/config2-rejects.json', 'utf8');
const middleStr  = fs.readFileSync('config/config3-middle.txt',   'utf8');
const pickupStr  = fs.readFileSync('config/config4-pickups.json', 'utf8');
const footerStr  = fs.readFileSync('config/config5-footer.txt',   'utf8');
const waitingStr = fs.readFileSync('data/blockedWaits.json',      'utf8');
const blkGapsStr = fs.readFileSync('data/blockedGaps.json',       'utf8');
const noEmbyStr  = fs.readFileSync('data/noemby.json',            'utf8');
const gapsStr    = fs.readFileSync('data/gaps.json',              'utf8');

const blockedWaits = JSON.parse(waitingStr);
const blockedGaps  = JSON.parse(blkGapsStr);
const rejects      = JSON.parse(rejectStr);
const pickups      = JSON.parse(pickupStr);
const noEmbys      = JSON.parse(noEmbyStr);
const gaps         = JSON.parse(gapsStr);

const videoFileExtensions = [
  "mp4", "mkv", "avi", "mov", "wmv", "flv", "mpeg",
  "3gp", "m4v", "ts", "rm", "vob", "ogv", "divx"
];

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

const getAllShows = async (id, _param, resolve, reject) => {
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
    reject([id, `getAllShows: ${dirent}, ${err.message}`]);
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

const getBlockedWaits = (id, _param, resolve) => {
  resolve([id, blockedWaits]);
};

const addBlockedWait = async (id, name, resolve, _reject) => {
  console.log('addBlockedWait', id, name);
  for(const [idx, blockedWaitStr] of blockedWaits.entries()) {
    if(blockedWaitStr.toLowerCase() === name.toLowerCase()) {
      console.log(
          '-- removing matching blockedWaits:', blockedWaitStr);
      blockedWaits.splice(idx, 1);
      break;
    }
  }
  console.log('-- adding blockedWait:', name);
  blockedWaits.push(name);
  await util.writeFile('data/blockedWaits.json', blockedWaits);
  resolve([id, 'ok']);
}

const delBlockedWait = async (id, name, resolve, _reject) => {
  console.log('delBlockedWait', id, name);
  let deletedOne = false;
  for(const [idx, blockedWaitStr] of blockedWaits.entries()) {
    if(blockedWaitStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- deleting blockedWait:', blockedWaitStr);
      blockedWaits.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if(!deletedOne) {
    console.log('blockedWait not deleted -- no match:', name);
    resolve([id, 'ok']);
    return
  }
  await util.writeFile('data/blockedWaits.json', blockedWaits);
  resolve([id, 'ok']);
}

const getBlockedGaps = (id, _param, resolve) => {
  resolve([id, blockedGaps]);
};

const addBlockedGap = async (id, name, resolve, _reject) => {
  console.log('addBlockedGap', id, name);
  for(const [idx, blockedGapStr] of blockedGaps.entries()) {
    if(blockedGapStr.toLowerCase() === name.toLowerCase()) {
      console.log(
          '-- removing matching blockedGap:', blockedGapStr);
      blockedGaps.splice(idx, 1);
      break;
    }
  }
  console.log('-- adding blockedGap:', name);
  blockedGaps.push(name);
  await util.writeFile('data/blockedGaps.json', blockedGaps);
  resolve([id, 'ok']);
}

const delBlockedGap = async (id, name, resolve, _reject) => {
  console.log('delBlockedGap', id, name);
  let deletedOne = false;
  for(const [idx, blockedGapStr] of blockedGaps.entries()) {
    if(blockedGapStr.toLowerCase() === name.toLowerCase()) {
      console.log('-- deleting blockedGap:', blockedGapStr);
      blockedGaps.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if(!deletedOne) {
    console.log('blockedGap not deleted -- no match:', name);
    resolve([id, 'ok']);
    return
  }
   await util.writeFile('data/blockedGaps.json', blockedGaps);
  resolve([id, 'ok']);
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
  gaps[gapId] = gap;
  if(save) await util.writeFile('data/gaps.json', gaps); 
  resolve([id, 'ok']);
}

const delGap = async (id, gapIdSave, resolve, _reject) => {
  console.log('delGap', id, {gapIdSave});
  const [gapId, save] = JSON.parse(gapIdSave);
  if(gapId !== null) delete gaps[gapId];
  if(save) {
    await util.writeFile('data/gaps.json', gaps); 
  }
  resolve([id, 'ok']);
}

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
    case 'getAllShows':   getAllShows(       id,    '', resolve, reject); break;
    case 'deletePath':    deletePath(        id, param, resolve, reject); break;

    case 'getDevices':    emby.getDevices(   id,    '', resolve, reject); break;
    case 'getLastViewed': view.getLastViewed(id,    '', resolve, reject); break;

    case 'getBlockedWaits': getBlockedWaits( id, '',    resolve, reject); break;
    case 'addBlockedWait':  addBlockedWait(  id, param, resolve, reject); break;
    case 'delBlockedWait':  delBlockedWait(  id, param, resolve, reject); break;

    case 'getBlockedGaps': getBlockedGaps(id, '',    resolve, reject); break;
    case 'addBlockedGap':  addBlockedGap( id, param, resolve, reject); break;
    case 'delBlockedGap':  delBlockedGap( id, param, resolve, reject); break;

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
    
    case 'getAllTvdb':    tvdb.getAllTvdb(   id, param, resolve, reject); break;
    case 'getNewTvdb':    tvdb.getNewTvdb(   id, param, resolve, reject); break;
    case 'setTvdbFields': tvdb.setTvdbFields(id, param, resolve, reject); break;

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
    const parts = /^(.*)~~~(.*)~~~(.*)$/.exec(msg);
    if(!parts) {
      console.error('ignoring bad message:', msg);
      return;
    }
    if(socketName != appSocketName) {
      socketName = appSocketName;
      console.log(socketName + ' connected');
    }
    const [id, fname, param] = parts.slice(1);
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
