import fs                  from "fs";
import util                from "util";
import * as cp             from 'child_process';
import { WebSocketServer } from 'ws';
import {rimraf}            from 'rimraf'
import fetch               from 'node-fetch';
import * as view           from './src/lastViewed.js';
import * as subs           from "./src/subs.js";

process.setMaxListeners(50);
const dontupload  = false;
const tvDir = '/mnt/media/tv';
const exec  = util.promisify(cp.exec);

const headerStr  = fs.readFileSync('config/config1-header.txt',   'utf8');
const rejectStr  = fs.readFileSync('config/config2-rejects.json', 'utf8');
const middleStr  = fs.readFileSync('config/config3-middle.txt',   'utf8');
const pickupStr  = fs.readFileSync('config/config4-pickups.json', 'utf8');
const footerStr  = fs.readFileSync('config/config5-footer.txt',   'utf8');
const waitingStr = fs.readFileSync('data/blockedWaits.json',      'utf8');
const blkGapsStr = fs.readFileSync('data/blockedGaps.json',       'utf8');
const noEmbyStr  = fs.readFileSync('data/noemby.json',            'utf8');
const gapsStr    = fs.readFileSync('data/gaps.json',              'utf8');
const allTvdbStr = fs.readFileSync('data/tvdb.json',              'utf8');
const allRemStr  = fs.readFileSync('data/remotes.json',           'utf8');

const blockedWaits = JSON.parse(waitingStr);
const blockedGaps  = JSON.parse(blkGapsStr);
const rejects      = JSON.parse(rejectStr);
const pickups      = JSON.parse(pickupStr);
const noEmbys      = JSON.parse(noEmbyStr);
const gaps         = JSON.parse(gapsStr);
const allTvdb      = JSON.parse(allTvdbStr);
const allRemotes   = JSON.parse(allRemStr);

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

const fmtDate = (dateStr) => {
  const date = dateStr ? new Date(dateStr) : new Date();
  return fmtDateWithTZ(date);
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
  fs.writeFileSync('config/config.yml', str);

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
  fs.writeFileSync('config/config2-rejects.json', 
                           JSON.stringify(rejects)); 
  fs.writeFileSync('config/config4-pickups.json', 
                           JSON.stringify(pickups)); 
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
  fs.writeFileSync('data/blockedWaits.json', 
                        JSON.stringify(blockedWaits));
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
  fs.writeFileSync('data/blockedWaits.json', JSON.stringify(blockedWaits));
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
  fs.writeFileSync('data/blockedGaps.json', 
                        JSON.stringify(blockedGaps));
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
   fs.writeFileSync('data/blockedGaps.json', 
                            JSON.stringify(blockedGaps));
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
  fs.writeFileSync('data/noemby.json', JSON.stringify(noEmbys)); 
  resolve([id, 'ok']);
}

const delNoEmby = async (id, name, resolve, reject) => {
  console.log('delNoEmby', id, name);
  let deletedOne = false;
  for(const [idx, show] of noEmbys.entries()) {
    if(!show.Name ||
        show.Name.toLowerCase() === name.toLowerCase()) {
      console.log('deleting existing:', name);
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
  fs.writeFileSync('data/noemby.json', JSON.stringify(noEmbys)); 
  resolve([id, 'ok']);
}

const getGaps = (id, _param, resolve, _reject) => {
  resolve([id, gaps]);
};

const addGap = async (id, gapIdGapSave, resolve, _reject) => {
  const [gapId, gap, save] = JSON.parse(gapIdGapSave);
  // console.logapIdGapSaveg('addGap', id, {gapIdGapSave});
  gaps[gapId] = gap;
  if(save) 
    fs.writeFileSync('data/gaps.json', JSON.stringify(gaps)); 
  resolve([id, 'ok']);
}

const delGap = async (id, gapIdSave, resolve, _reject) => {
  console.log('delGap', id, {gapIdSave});
  const [gapId, save] = JSON.parse(gapIdSave);
  try{
    if(gapId !== null) delete gaps[gapId];
  }
  catch(e){
    console.error('delGap', e.message);
  }
  if(save) 
    fs.writeFileSync('data/gaps.json', JSON.stringify(gaps)); 
  resolve([id, 'ok']);
}

const getAllTvdb = (id, _param, resolve, _reject) => {
  console.log('getAllTvdb', id);
  resolve([id, allTvdb]);
};

const addTvdb = async (id, tvdbDataStr, resolve, reject) => {
  console.log('addTvdb', id);
  let tvdbData;
  try { tvdbData = JSON.parse(tvdbDataStr); }
  catch (e) { reject([id, 'addTvdb: ' + e.message]); return; }
  const name = tvdbData.name;
  allTvdb[name] = tvdbData;
  fs.writeFileSync('data/tvdb.json', JSON.stringify(allTvdb)); 
  resolve([id, 'ok']);
}

const getRemotes = (id, name, resolve, _reject) => {
  console.log(`getRemotes`, {id, name});
  const remotes = allRemotes[name];
  if(!remotes) {
    console.error(`getRemotes no match`, {id, name});
    resolve([id, {noMatch: true}]);
    return
  } 
  // console.log(`getRemotes success`, remotes);
  resolve([id, remotes]);
};

const addRemotes = async (id, nameRems, resolve, reject) => {
  // console.log(`addRemotes`, {id, nameRems});
  const [name, remotesStr] = nameRems.split('|||');
  let remotes;
  try {
    remotes = JSON.parse(remotesStr);
  }
  catch (e) {
    reject([id, 'addRemotes: '+e.message]);
    return;
  }
  remotes.forEach((remote) => {
    if(remote.ratings === null) delete remote.ratings;
  });
  // console.log('addRemotes', id, name);
  allRemotes[name] = remotes;
  fs.writeFileSync('data/remotes.json', JSON.stringify(allRemotes)); 
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

const getUrls = async (id, typeUrlName, resolve, reject) => {
  console.log('getUrls', id, typeUrlName);
  const [type, url, name] = typeUrlName.split('||');

  let resp = await fetch(url);
  if (!resp.ok) {
    console.error(`getUrls resp: ${typeUrlName}, ${resp.status}`);
    reject([id, {type, url, name}]);
    return
  }
  const html = (await resp.text())
                .replaceAll(/(\r\n|\n|\r)/gm, "")
                .replaceAll(/\s+/gm, " ");

  const rottenStripSfx = (name) => {
    name = name.trim();
    const pfxNameParts = /^(.*?)(\s+\(.*?\))?$/i.exec(name);
    if(!pfxNameParts) {
      console.log('no rotten name pfx match:', {type, url, name});
      resolve([id, 'no match: ' + {type, url, name}]);
      return;
    }
    return pfxNameParts[1];
  }

  let idFnameParam;

  switch (+type) {
    case 2:  // IMDB
      // console.log('samples/imdb-page.html');
      // fs.writeFileSync('samples/imdb-page.html', html);
      try{
        idFnameParam = /imUuxf">(\d\.\d)<\/span>/i.exec(html);
        if(idFnameParam === null) throw 'wikidata parse error';
      }
      catch (e) {
        reject([id, {type, url, name, e}]);
        return
      }
      resolve([id, {ratings:idFnameParam[1]}]);
      return;

    case 18:  // wikidata
      try{
        idFnameParam = /lang="en"><a href="(.*?)"\shreflang="en"/i.exec(html);
        if(idFnameParam === null) throw 'wikidata parse error';
      }
      catch (e) {
        reject([id, {type, url, name, e}]);
        return
      }
      resolve([id, {url:idFnameParam[1]}]);
      return;

    case 98:  // google
      if(name == 'The Crow Girl')
        fs.writeFile('samples/google-Eilean-search.html', html);
      return

    case 99:  // rotten tomatoes
      // fs.writeFile('samples/rotten-search-noline.html', text);

      const namePfx = rottenStripSfx(name);
      let titleRegx = new RegExp(/search-result-title">TV shows</g);
      titleRegx.lastIndex = 0;
      const titleParts = titleRegx.exec(html);
      if(titleParts === null) {
        console.log('no rotten title match:', {type, url, name});
        resolve([id, 'no match: ' + {type, url, name}]);
        return;
      }

  // need escaping: ] ( ) [ { } * + ? / $ . | ^ \

      const urlNameRegx = new RegExp(
    /<a href="([^"]*)" class="unset" data-qa="info-name" slot="title">([^<]*)<\/a>/g
    );

      urlNameRegx.lastIndex = titleRegx.lastIndex;
      let textUrl;
      for(let i=0; i<3; i++) {
        const nameParts = urlNameRegx.exec(html);
        if(nameParts === null || i == 3) {
          console.log('no rotten url name match:', {type, url, name});
          resolve([id, 'no match: ' + {type, url, name}]);
          return;
        }
        let textName;
        [textUrl, textName] = nameParts.slice(1);
        const textNamePfx = rottenStripSfx(textName);
        if(textNamePfx == namePfx) break;
      }
      resolve([id, {name:"Rotten Tomatoes", url:textUrl}]);
      return;

    default: resolve([id, 'getUrls no type: ' + type]);
  }
}
//////////////////  CALL FUNCTION SYNCHRONOUSLY  //////////////////

const queue = [];
let running = false;

const runOne = () => {
  if(running || queue.length == 0) return;
  running == true;

  const {idFnameParam, ws} = queue.pop();
  if(ws.readyState !== WebSocket.OPEN) return;

  const [id, fname, param] = idFnameParam;

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
    console.log('idResult err:', {idError});
    const [id, error] = idError;
    console.log('rejected:', id);
    ws.send(`${id}~~~err~~~${JSON.stringify(error)}`); 
    running == false;
    runOne();
  });

  // call function fname
  // console.log(`call function`, {id, fname, param});
  switch (fname) {
    case 'getAllShows':   getAllShows(       id,    '', resolve, reject); break;
    case 'deletePath':    deletePath(        id, param, resolve, reject); break;
    case 'getUrls':       getUrls(           id, param, resolve, reject); break;
    case 'getLastViewed': view.getLastViewed(id,    '', resolve, reject); break;
    case 'syncSubs':      subs.syncSubs(     id, param, resolve, reject)

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
    
    case 'getAllTvdb':   getAllTvdb(  id, param, resolve, reject); break;
    case 'addTvdb':      addTvdb(     id, param, resolve, reject); break;
    
    case 'getRemotes':  getRemotes(id, param, resolve, reject); break;
    case 'addRemotes':  addRemotes(id, param, resolve, reject); break;

    default: reject([id, 'unknownfunction: ' + fname]);
  };
}

//////////////////  WEBSOCKET SERVER  //////////////////

const wss = new WebSocketServer({ port: 8736 });
console.log('wss listening on port 8736');

wss.on('connection', (ws, req) => {
  console.log('client connected');

  ws.on('error', console.error);

  ws.on('message', (data) => {
    const msg = data.toString();
    // console.log('received:', msg);

    const parts = /^(.*)~~~(.*)~~~(.*)$/.exec(msg);
    if(!parts) {
      console.error('ignoring bad message:', msg);
      return;
    }
    const idFnameParam = parts.slice(1);

    queue.unshift({ws, idFnameParam});
    runOne();
  });
 
  ws.on('close', () => console.log('wss closed'));
});

// test commit
