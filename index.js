import fs                  from "fs";
import * as fsp            from 'fs/promises';
import util                from "util";
import * as cp             from 'child_process';
import moment              from 'moment';
import { WebSocketServer } from 'ws';

const showdates   = false;
const dontupload  = false;

const ws = new WebSocketServer({ port: 8736 });
console.log('ws listening on port 8736');
// debug

const tvDir = '/mnt/media/tv';
const exec  = util.promisify(cp.exec);
const dat   = () => {
  if(!showdates) return '';
  return moment().format('MM/DD HH-mm-ss:');
}

const headerStr = fs.readFileSync('config/config1-header.txt',   'utf8');
const rejectStr = fs.readFileSync('config/config2-rejects.json', 'utf8');
const middleStr = fs.readFileSync('config/config3-middle.txt',   'utf8');
const pickupStr = fs.readFileSync('config/config4-pickups.json', 'utf8');
const footerStr = fs.readFileSync('config/config5-footer.txt',   'utf8');

const rejects = JSON.parse(rejectStr);
const pickups = JSON.parse(pickupStr);

let dirDate;
let dirSize;

const getSeries = async (id, _param, resolve, reject) => {
  let   errFlg = null;
  const series = {};

  const recurs = async (path) => {
    if(errFlg || path == tvDir + '/.stfolder') return;
    try {
      const fstat = await fsp.stat(path);
      const date  = fstat.mtime.toISOString().substring(0,10);
      if(date.substring(0,4) > '2050') return;     
      dirDate  = Math.max(dirDate, date);
      dirSize += fstat.size;
      if(fstat.isDirectory()) {
        const dir = await fsp.readdir(path);
        for (const dirent of dir) 
          await recurs(path + '/' + dirent);
      }
    }
    catch (err) {
      errFlg = err;
    }
  }

  const dir = await fsp.readdir(tvDir);
  for (const dirent of dir) {
    const seriesPath = tvDir + '/' + dirent;
    dirDate = 0;
    dirSize = 0;
    await recurs(seriesPath);
    series[dirent] = [dirDate, dirSize];
  }
  if(errFlg) {
    reject([id, errFlg]);
    return;
  }
  else {
    resolve([id, series]);
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
  console.log(dat(), '\n\ncreating config.yml');
  fs.writeFileSync('config/config.yml', str);

  if(dontupload) {
    console.log(dat(), "---- didn't upload config.yml ----");
    return 'ok';
  }
  const {stdout} = await exec(
          'rsync -av config/config.yml xobtlu@oracle.usbx.me:' +
          '/home/xobtlu/.config/flexget/config.yml');
  const rx = new RegExp('total size is ([0-9,]*)');
  const matches = rx.exec(stdout);
  if(!matches || parseInt(matches[1].replace(',', '')) < 1000) {
    console.log(dat(), '\nERROR: config.yml upload failed\n', stdout, '\n');
    return `config.yml upload failed: ${stdout.toString()}`;
  }
  console.log(dat(), 'uploaded config.yml, size:', matches[1]);
  return 'ok';
}

const reload = async () => {
  if(dontupload) {
    console.log(dat(), "---- didn't reload ----");
    return 'ok';
  }

  const {stdout} = await exec(
    'ssh xobtlu@oracle.usbx.me /home/xobtlu/reload-cmd');
  
  if(!stdout.includes('Config successfully reloaded'))  {
    console.log(dat(), '\nERROR: config.yml reload failed\n', stdout, '\n');
    return `config.yml reload failed: ${stdout.toString()}`;
  }
  console.log(dat(), 'reloaded config.yml');
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
  fs.writeFileSync('config/config2-rejects.json', JSON.stringify(rejects)); 
  fs.writeFileSync('config/config4-pickups.json', JSON.stringify(pickups)); 

  let errResult = null;

  const uploadRes = await upload();
  if(uploadRes != 'ok') errResult = uploadRes;
  if(!errResult) {
    const reloadRes = await reload();
    if(reloadRes != 'ok') errResult = reloadRes;
  }

  if(errResult) {
    console.log(dat(), 'trySaveConfigYml error:', errResult);
    saving = false;
    return ['err', id, errResult, resolve, reject];
  }

  saving = false;
  return ['ok', id, result, resolve, reject];
};

// this always sends a response to the client
// can be called and forgotten
const saveConfigYml = async (idIn, resultIn, resolveIn, rejectIn) => {
  console.log(dat(), 'saving config.yml');
  const tryRes = await trySaveConfigYml(idIn, resultIn, resolveIn, rejectIn);    
  const [status, id, result, resolve, reject] = tryRes;
  switch(status) {
    case 'busy': 
      setTimeout(() => saveConfigYml(id, result, resolve, reject), 1000); 
      break;
    case 'ok':  resolve([id, result]);       break;
    case 'err': reject( [id, tryRes]); break;
  }
}

const getRejects = (id, _param, resolve, _reject) => {
  resolve([id, rejects]);
};

const addReject = (id, name, resolve, reject) => {
  console.log(dat(), 'addReject', id, name);
  for(const [idx, rejectNameStr] of rejects.entries()) {
    if(rejectNameStr.toLowerCase() === name.toLowerCase()) {
      console.log(dat(), '-- removing old matching reject:', rejectNameStr);
      rejects.splice(idx, 1);
    }
  }
  console.log(dat(), '-- adding reject:', name);
  rejects.push(name);
  saveConfigYml(id, {"ok":"ok"}, resolve, reject);
}

const delReject = (id, name, resolve, reject) => {
  console.log(dat(), 'delReject', id, name);
  let deletedOne = false;
  for(const [idx, rejectNameStr] of rejects.entries()) {
    if(rejectNameStr.toLowerCase() === name.toLowerCase()) {
      console.log(dat(), '-- deleting reject:', rejectNameStr);
      rejects.splice(idx, 1);
      deletedOne = true;
    }
  }
  if(!deletedOne) {
    console.log(dat(), '-- reject not deleted -- no match:', name);
    reject([id, {"delReject":"not found"}]);
    return
  }
  saveConfigYml(id, {"ok":"ok"}, resolve, reject);
}

const getPickups = (id, _param, resolve, _reject) => {
  resolve([id, pickups]);
};

const addPickup = (id, name, resolve, reject) => {
  console.log(dat(), 'addPickup', id, name);
  for(const [idx, pickupNameStr] of pickups.entries()) {
    if(pickupNameStr.toLowerCase() === name.toLowerCase()) {
      console.log(dat(), '-- removing old matching pickup:', pickupNameStr);
      pickups.splice(idx, 1);
    }
  }
  console.log(dat(), '-- adding pickup:', name);
  pickups.push(name);
  saveConfigYml(id, {"ok":"ok"}, resolve, reject);
}

const delPickup = (id, name, resolve, reject) => {
  console.log(dat(), 'delPickup', id, name);
  let deletedOne = false;
  for(const [idx, pickupNameStr] of pickups.entries()) {
    if(pickupNameStr.toLowerCase() === name.toLowerCase()) {
      console.log(dat(), '-- deleting pickup:', pickupNameStr);
      pickups.splice(idx, 1);
      deletedOne = true;
    }
  }
  if(!deletedOne) {
    console.log(dat(), '-- pickup not deleted -- no match:', name);
    reject([id,{"delPickup":"not found"}]);
    return;
  }
  saveConfigYml(id, {"ok":"ok"}, resolve, reject);
}

const deletePath = async (id, path, resolve, reject) => {
  console.log(dat(), 'deletePath', id, path);
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


//////////////////  WEBSOCKET SERVER  //////////////////

ws.on('connection', (socket) => {
  console.log(dat(), 'ws connected');

  socket.send('0`ok`{connected:true}');

  socket.on('message', (msg) => {
    console.log(dat(), 'received', msg);

    const parts = /^(.*)\.\.\.(.*)\.\.\.(.*)$/.exec(msg);
    if(!parts) {
      console.error(dat(), 'skipping bad message:', msg);
      return;
    }
    const [id, fname, param] = parts.slice(1);

    let resolve = null;
    let reject  = null;

    // param called when promise is resolved or rejected
    // there is one unique promise for each function call
    const promise = new Promise((resolveIn, rejectIn) => {
      resolve = resolveIn; 
      reject = rejectIn;
    });

    promise.then((idResult) => {
      const [id, result] = idResult;
      console.log(dat(), 'resolved', id);
      socket.send(`${id}...ok...${JSON.stringify(result)}`); 
    })
    .catch((idError) => {
      const [id, error] = idError;
      console.log(dat(), 'rejected', id);
      socket.send(`${id}...err...${JSON.stringify(error)}`); 
    });

    // call function fname
    switch (fname) {
      case 'getSeries':   getSeries(id, '',      resolve, reject); break;

      case 'getRejects':  getRejects(id, '',     resolve, reject); break;
      case 'addReject':   addReject(id, param,   resolve, reject); break;
      case 'delReject':   delReject(id, param,   resolve, reject); break;

      case 'getPickups':  getPickups(id, '',     resolve, reject); break;
      case 'addPickup':   addPickup(id, param,   resolve, reject); break;
      case 'delPickup':   delPickup(id, param,   resolve, reject); break;
      
      case 'deletePath':  deletePath(id, param,  resolve, reject); break;

      default: reject([id, {unknownfunction: fname}]);
    };
  });
 
  ws.on('error', (err) => console.log(dat(), 'ws error:', err));
  ws.on('close', () =>    console.log(dat(), 'ws closed'));
});

// https://github.com/websockets/ws?tab=readme-ov-file
  