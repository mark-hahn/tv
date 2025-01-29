import fs       from "fs";
import {jParse} from "./util.js";

const videoSfxs = [ "mp4", "mkv", "avi" ];

const subReqQueueStr = fs.readFileSync('data/subReqs.json', 'utf8');
let subReqQueue = jParse(subReqQueueStr, 'subs queue') ?? [];

let ws = null;

var sendFinishedArr = new ArrayBuffer(16);
var view = new Uint8Array(sendFinishedArr);
for(var i = 0; i < 16; i++) view[i] = i;

let onDrainCb = () => {};

const pathToSrtPath = (path) =>  
        path.split('.').slice(0, -1).join('.') + '.en-gen.srt';

let sending = false;
const sendOneFile = () => {
  if(!ws) {
    console.error('sendOneFile called before syncSubs');
    return;
  }
  if(sending) return;
  sending = true;

  const path = subReqQueue[0];
  if(path === undefined) { 
    sending = false;
    return;
  }

  // const writeStream = new  WritableStream({
  //   write(chunk) {

  //     console.log('chunk.length:', chunk.length);

  //     return new Promise((resolve, _reject) => {
  //       onDrainCb = resolve;
  //       ws.send(chunk);
  //     });
  //   }
  // });

  const writeStream = fs.createWriteStream('writeStream.mkv');

  const readStream = fs.createReadStream(path, {highWaterMark: 1e7});
  readStream.pipe(writeStream);
  readStream.on('error', (err) => {
        console.error('subs, error in readStream:', err.message)});
  readStream.on('close', () => {
    console.log('finished sending', path);
    onDrainCb = sendOneFile;
    ws.send(sendFinishedArr);
  });
}

export const fromSubSrvr = (data) => {
  if(!data.startsWith('error')) {
    const pathSent = subReqQueue.shift();
    fs.writeFileSync(pathToSrtPath(pathSent), data);
  }
  else console.error(data);
  sending = false;
}

const addSubReq = (name, path) => {
  console.log('subs addSubReq:', {name, path});
  let pathAddedCount = 0;
  let errmSG = null;
  const recurs = (path) => {
    if(errmSG) return;
    try {
      const fstat = fs.statSync(path);
      if(fstat.isDirectory()) {
        const dir = fs.readdirSync(path);
        for (const dirent of dir) 
          recurs(path + '/' + dirent);
        return;
      }
      const pathParts = path.split('.');
      const sfx = pathParts.pop().toLowerCase();
      if(videoSfxs.includes(sfx)) {
        const srtPath = pathToSrtPath(path);
        if(!subReqQueue.includes(path) && !fs.existsSync(srtPath)) {
          subReqQueue.push(path);
          pathAddedCount++;
        }
      }
    }
    catch (err) { errmSG = err.message }
  }
  recurs(path);
  if(errmSG) return errmSG;
  if(pathAddedCount > 0) 
      fs.writeFileSync('data/subReqs.json', JSON.stringify(subReqQueue));
  console.log({pathAddedCount, subReqQueue});
  // console.log({subReqQueue});
  sendOneFile();
  return null;
}

let statusName    = '';
let statusMinutes = 0;

const getSubStatus = (name) => {
  console.log('subs getSubStatus:', name);
  return {
    count: subReqQueue.length,
    mins: ((name == statusName) ? statusMinutes : 0),
    ok: true,
  };
}

export const syncSubs = (id, wsIn, namePath, resolve, reject) => {
  console.log('syncSubs:', namePath);
  if(wsIn != ws) {
    ws = wsIn; 
    ws.on('drain', onDrainCb);
  }
  let namePathObj = jParse(namePath, 'syncSubs');
  if(!namePathObj) reject([id, 'syncSubs parse error']);
  else {
    const {name, path} = namePathObj;
    let addErr = null;
    if(path) addErr = addSubReq(name, path);
    const status    = getSubStatus(name);
    if(addErr === null && status?.ok) 
      resolve([id, status]);
    else
      reject( [id, {addErr, status}]);
  }
}

