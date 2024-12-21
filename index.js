import fs                  from "fs";
import * as fsp            from 'fs/promises';
import util                from "util";
import * as cp             from 'child_process';
import { WebSocketServer } from 'ws';
import fetch               from 'node-fetch';

process.setMaxListeners(50);
const dontupload  = false;

const tvDir = '/mnt/media/tv';
// const tvDir = '/mnt/c/Users/mark/apps/tv-series-srvr/media/tv';

const exec  = util.promisify(cp.exec);

const headerStr  = fs.readFileSync('config/config1-header.txt',   'utf8');
const rejectStr  = fs.readFileSync('config/config2-rejects.json', 'utf8');
const middleStr  = fs.readFileSync('config/config3-middle.txt',   'utf8');
const pickupStr  = fs.readFileSync('config/config4-pickups.json', 'utf8');
const footerStr  = fs.readFileSync('config/config5-footer.txt',   'utf8');
const waitingStr = fs.readFileSync('data/blockedWaits.json',      'utf8');
const noEmbyStr  = fs.readFileSync('data/noemby.json',            'utf8');

const blockedWaits = JSON.parse(waitingStr);
const rejects  = JSON.parse(rejectStr);
const pickups  = JSON.parse(pickupStr);
const noEmbys  = JSON.parse(noEmbyStr);

const videoFileExtensions = [
  "mp4", "mkv", "avi", "mov", "wmv", "flv", "mpeg",
  "3gp", "m4v", "ts", "rm", "vob", "ogv", "divx"
];

const fmtDate = (dateStr) => {
  const date = dateStr ? new Date(dateStr) : new Date();
  return date.toISOString().slice(0,10);
}

const getAllShows = async (id, _param, resolve, reject) => {
  let   errFlg = null;
  const shows = {};

  let maxDate, totalSize;

  const recurs = async (path) => {
    if(errFlg || path == tvDir + '/.stfolder') return;
    try {
      const fstat = await fsp.stat(path);
      if(fstat.isDirectory()) {
        const dir = await fsp.readdir(path);
        for (const dirent of dir) 
          await recurs(path + '/' + dirent);
        return;
      }
      const sfx = path.split('.').pop();
      if(videoFileExtensions.includes(sfx)) {
        const date = fmtDate(fstat.mtime);
        maxDate = (maxDate > date) ? maxDate : date;
      }
      totalSize += fstat.size;
    }
    catch (err) {
      errFlg = err;
    }
  }

  const dir = await fsp.readdir(tvDir);
  for (const dirent of dir) {
    const showPath = tvDir + '/' + dirent;
    const fstat   = await fsp.stat(showPath);
    const maxDate = fmtDate(fstat.mtime);
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
  for(let name of rejects)
    str += '        - "' + name.replace(/"/g, '') + '"\n';
  str += middleStr;
  for(let name of pickups)
    str += '        - "' + name.replace(/"/g, '') + '"\n';
  str += footerStr;
  console.log('creating config.yml');
  await fsp.writeFile('config/config.yml', str);

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
  await fsp.writeFile('config/config2-rejects.json', 
                           JSON.stringify(rejects)); 
  await fsp.writeFile('config/config4-pickups.json', 
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
  await fsp.writeFile('data/blockedWaits.json', 
                        JSON.stringify(blockedWaits));
  resolve([id, {"ok":"ok"}]);
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
    resolve([id, {"ok":"ok"}]);
    return
  }
  await fsp.writeFile('data/blockedWaits.json', JSON.stringify(blockedWaits));
  resolve([id, {"ok":"ok"}]);
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
  saveConfigYml(id, {"ok":"ok"}, resolve, reject);
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
  saveConfigYml(id, {"ok":"ok"}, resolve, reject);
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
  saveConfigYml(id, {"ok":"ok"}, resolve, reject);
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
  saveConfigYml(id, {"ok":"ok"}, resolve, reject);
}

const getNoEmbys = (id, _param, resolve, _reject) => {
  resolve([id, noEmbys]);
};

const addNoEmby = async (id, showStr, resolve) => {
  const show = JSON.parse(showStr);
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
  // await fsp.writeFile('data/noemby.json', JSON.stringify(noEmbys)); 
  resolve([id, {"ok":"ok"}]);
}

const delNoEmby = async (id, name, resolve, reject) => {
  console.log('delNoEmby', id, name);
  let deletedOne = false;
  for(const [idx, show] of noEmbys.entries()) {
    if(!show.Name ||
        show.Name.toLowerCase() === name.toLowerCase()) {
      console.log('-- deleting noemby:', name);
      noEmbys.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if(!deletedOne) {
    console.log('-- noembys not deleted -- no match:', name);
    resolve([id, 'delNoEmby no match:' + name]);
    return;
  }
  // await fsp.writeFile('data/noemby.json', JSON.stringify(noEmbys)); 
  resolve([id, {"ok":"ok"}]);
}

const deletePath = async (id, path, resolve, reject) => {
  console.log('deletePath', id, path);
  try {
    path = decodeURI(path).replaceAll('@', '/').replaceAll('~', '?');
    console.log('deleting:', path);
    await fsp.unlink(path); 
  }
  catch(e) {
    reject([id, e]);
    return
  }
  resolve([id, {"ok":"ok"}]);
};

const getUrls = async (id, urlReq, resolve, reject) => {
  let [type, url] = urlReq.split('||');
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`getUrls resp: ${resp.status}`);
    reject([id, {type, url}]);
    return
  }
  const text = await resp.text();

  if(type == 18) { // wikidata
    let parts;
    try{
      parts = /lang="en"><a href="(.*?)"\shreflang="en"/i.exec(text);
      if(parts === null) throw 'wikidata parse error';
    }
    catch (e) {
      reject([id, {type, url, e}]);
      return
    }
    resolve([id, parts[1]]);
    return;
  }

  else if(type == 99) { // rotten tomatoes
    let parts;

    const rtRegEx = new RegExp(
      '<h2 slot="title" ' +
          'data-qa="search-result-title">TV shows</h2>.*?' +
      '<a href="(.*?)".*?' +
          'data-qa="info-name" slot="title">', 'i');
    try {
      parts = rtRegEx.exec(text.replace(/(\r\n|\n|\r)/gm, ""));
      if(parts === null) {
        // await fsp.writeFile('data/rotten-parse.txt', text);
        console.log('rotten tomatoes no match:', url);
        resolve([id, 'no match: ' + url]);
        return;
      }
    }
    catch (e) {rtRegEx
      reject([id, {type, url, e}]);
      return
    }
    resolve([id, parts[1]]);
    return;
  }

  resolve([id, 'getUrls no type: ' + type]);
}

//////////////////  WEBSOCKET SERVER  //////////////////

const wss = new WebSocketServer({ port: 8736 });
console.log('wss listening on port 8736');

wss.on('connection', (ws, req) => {
  const clientId = Math.floor(Math.random() * 1e6);
  console.log(clientId, 'client connected');
  ws.send(`0~~~ok~~~ws connected: ${clientId}`);

  ws.on('error', console.error);

  ws.on('message', (msg) => {
    msg = msg.toString();
    console.log(clientId, 'received:', msg);

    const parts = /^(.*)~~~(.*)~~~(.*)$/.exec(msg);
    if(!parts) {
      console.error(clientId, 'skipping bad message:', msg);
      return;
    }
    const [id, fname, param] = parts.slice(1);

    let resolve = null;
    let reject  = null;

    // param called when promise is resolved or rejected
    // there is one unique promise for each function call
    const promise = new Promise((resolveIn, rejectIn) => {
      resolve = resolveIn; 
      reject  = rejectIn;
    });

    promise.then((idResult) => {
      const [id, result] = idResult;
      console.log(clientId, 'resolved:', id);
      ws.send(`${id}~~~ok~~~${JSON.stringify(result)}`); 
    })
    .catch((idError) => {
      console.log(clientId, 'idResult err:', {idError});
      const [id, error] = idError;
      console.log(clientId, 'rejected:', id);
      ws.send(`${id}~~~err~~~${JSON.stringify(error)}`); 
    });

    // call function fname
    switch (fname) {
      case 'getAllShows': getAllShows(id, '',   resolve, reject); break;

      case 'getBlockedWaits': getBlockedWaits(id, '',   resolve, reject); break;
      case 'addBlockedWait':  addBlockedWait(id, param, resolve, reject); break;
      case 'delBlockedWait':  delBlockedWait(id, param, resolve, reject); break;

      case 'getRejects':  getRejects(id, '',    resolve, reject); break;
      case 'addReject':   addReject( id, param, resolve, reject); break;
      case 'delReject':   delReject( id, param, resolve, reject); break;

      case 'getPickups':  getPickups(id, '',    resolve, reject); break;
      case 'addPickup':   addPickup( id, param, resolve, reject); break;
      case 'delPickup':   delPickup( id, param, resolve, reject); break;
      
      case 'getNoEmbys':  getNoEmbys(id, '',    resolve, reject); break;
      case 'addNoEmby':   addNoEmby( id, param, resolve, reject); break;
      case 'delNoEmby':   delNoEmby( id, param, resolve, reject); break;
      
      case 'deletePath':  deletePath( id, param, resolve, reject); break;

      case 'getUrls':     getUrls(    id, param, resolve, reject); break;

      default: reject([id, 'unknownfunction: ' + fname]);
    };
  });
 
  ws.on('close', () => console.log(clientId, 'wss closed'));
});
