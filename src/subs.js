import fs         from "fs";
import {Writable} from "stream"; 
import {jParse}   from "./util.js";

const videoSfxs = [ "mp4", "mkv", "avi" ];

const subReqQueueStr = fs.readFileSync('data/subReqs.json', 'utf8');
let subReqQueue = jParse(subReqQueueStr, 'subs queue') ?? [];

let ws = null;

let statusName    = '';
let statusMinutes = 0;

const eofArr = new Uint32Array(1);
eofArr[0] = 0x07162534;

const pathToSrtPath = (path) =>  
        path.split('.').slice(0, -1).join('.') + '.en-gen.srt';

let sendEndTime;
let sending = false;

const sendOneFile = () => {
  const namePath = subReqQueue[0];
  if(!ws || sending || namePath === undefined) return;
  sending = true;

  const path = namePath.path;
  console.log('subs, sending file:', path);
  const sendStartTime = Date.now();

  let chunkFinishedCb = null;

  const writeStream = new  Writable({
    write(chunk, _encoding, next) {
      if(ws.readyState !== WebSocket.OPEN) {
        const errMsg = 'subs, ws not open in writeStream write';
        console.error(errMsg);
        next(Error(errMsg));
        return;
      }
      console.log('subs, writeStream chunk:', 
                    chunk.constructor.name, chunk.length);
      chunkFinishedCb = next;
      ws.send(chunk);
    }
  });

  fs.createReadStream(path, {highWaterMark: 1e7})
    .pipe(writeStream)
    .on('error', (err) => {
        console.error('subs, error in readStream:', err.message)})
    .on('close', () => {
      console.log('subs, finished sending', path);
      ws.send(eofArr);
      sendEndTime = Date.now();
      console.log(`subs, send time: ${
            ((sendEndTime - sendStartTime) / 1000).toFixed(0)} secs`);
    });
}

export const setWs = (wsIn) => {
  if(wsIn != ws) {
    ws = wsIn; 
    if(ws) {
      ws.on('drain', onDrainCb);
      console.log('subs server websocket set');
      sendOneFile();
    }
  }
}

export const fromSubSrvr = (data) => {
  const dataObj = jParse(data, "fromSubSrvr data");
  if(dataObj !== null) {
    if(dataObj.ack) {
      if(chunkFinishedCb) {
        chunkFinishedCb();
        chunkFinishedCb = null;
      }
      else console.log('subs, ack received with no chunk callback');
      return;
    }
    else if(dataObj.error) 
      console.error('error fromSubSrvr', dataObj.error);
    else {
      const namePath = subReqQueue[0];
      console.log('subs, fromSubSrvr:', 
                        Object.assign({}, namePath, dataObj));
      statusName    = namePath.name;
      statusMinutes = dataObj.mins;
      if(!dataObj.srt) return;
      console.log('received srt file');
      fs.writeFileSync(pathToSrtPath(namePath.path), dataObj.srt);
      subReqQueue.shift();
      const processEndTime = Date.now();
      console.log(`subs, conversion time: ${
                  ((processEndTime - sendEndTime)/(60*1000))} mins`);
    }
  }
  sending = false;
}

const addSubReq = (name, path) => {
  console.log('subs, addSubReq:', {name, path});
  let pathAddedCount = 0;
  let errMsg = null;
  const recurs = (path) => {
    if(errMsg) return;
    try {
      const fstat = fs.statSync(path);
      if(fstat.isDirectory()) {
        const dir = fs.readdirSync(path);
        for (const dirent of dir) 
          recurs(path + '/' + dirent);
        return;
      }
      const sfx = path.split('.').pop().toLowerCase();
      if(videoSfxs.includes(sfx)) {
        let pathAlreadyInQueue = false;
        for(let namePath of subReqQueue) {
          if(namePath.path == path) {
            pathAlreadyInQueue = true;
            break;
          }
        }
        if(!pathAlreadyInQueue && 
           !fs.existsSync(pathToSrtPath(path))) {
          subReqQueue.push({name, path});
          pathAddedCount++;
        }
      }
    }
    catch (err) { errMsg = err.message }
  }
  recurs(path);
  if(errMsg) return errMsg;
  if(pathAddedCount !== 0) 
      fs.writeFileSync('data/subReqs.json', JSON.stringify(subReqQueue));
  // console.log('addSubReq', {pathAddedCount, subReqQueue});
  sendOneFile();
  return null;
}

const getSubStatus = (name) => {
  let nameCount = 0;
  for(let namePath of subReqQueue) {
    if(namePath.name == name) nameCount++;
  }
  const status = {
    count: nameCount,
    mins: ((name == statusName) ? statusMinutes : 0),
    ok: true,
  };
  console.log('subs, getSubStatus:', name, status);
  return status;
}

export const syncSubs = (id, namePath, resolve, reject) => {
  console.log('subs, syncSubs:', namePath);
  let namePathObj = jParse(namePath, 'syncSubs');
  if(!namePathObj) reject([id, 'syncSubs parse error']);
  else {
    const {name, path} = namePathObj;
    let addErr = null;
    if(path) addErr = addSubReq(name, path);
    const    status = getSubStatus(name);
    if(addErr === null && status?.ok) 
      resolve([id, status]);
    else
      reject( [id, {addErr, status}]);
  }
}

