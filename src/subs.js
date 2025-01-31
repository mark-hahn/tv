import fs            from "fs";
import {Writable}    from "stream"; 
import {jParse, log} from "./util.js";

const videoSfxs = [ "mp4", "mkv", "avi" ];

const subReqQueueStr = fs.readFileSync('data/subReqs.json', 'utf8');
let subReqQueue = jParse(subReqQueueStr, 'subs queue') ?? [];

let ws = null;
let sending = false;
let sendingName = '';
let statusName = '';
let statusMinutes = null;
let chunkFinishedCb = null;
let fileSizeFromStats = 0;
let sendEndTime;

const cancelArr = new Uint32Array(1);
cancelArr[0]    = 0xab398745;
const eofArr    = new Uint32Array(1);
eofArr[0]       = 0x07162534;
const pingArr   = new Uint32Array(1);
pingArr[0]      = 0x01020304;

export const setWs = (wsIn) => {
  ws = wsIn; 
  sending = false;
  sendingName = '';
  setTimeout(trySendOneFile, 1000);
}

const pathToSrtPath = (path) =>  
        path.split('.').slice(0, -1).join('.') + '.en-gen.srt';

const trySendOneFile = () => {
  let sendByteCount = 0;
  const namePath = subReqQueue[0];
  if(!ws || sending || namePath === undefined) return;

  sending = true;
  sendingName = namePath.name;

  const path = namePath.path;
  let stats;
  try {
    stats = fs.statSync(path);
    fileSizeFromStats = stats.size;
  }
  catch {
    log('error doing stat on file:', path);
    sending = false;
    sendingName = '';
    return;
  }
  log('sending file: ' + path, false, true);
  const sendStartTime = Date.now();

  const writeStream = new  Writable({
    write(chunk, _encoding, next) {
      if(ws.readyState !== WebSocket.OPEN) {
        const errMsg = 'ws not open in writeStream write';
        log(errMsg, true);
        next(Error(errMsg));
        return;
      }
      chunkFinishedCb = next;
      ws.send(chunk);
      sendByteCount += chunk.length;
    }
  });

  fs.createReadStream(path, {highWaterMark: 1e7})
    .pipe(writeStream)
    .on('error', (err) => {
      log('error in readStream: ' + err.message, true);
    })
    .on('close', () => {
      ws.send(eofArr);
      if(sendByteCount != fileSizeFromStats) {
        log(`error, wrong num bytes sent: sent: ${sendByteCount}, ` +
                                    `file size: ${fileSizeFromStats}`);
      }
      sendEndTime = Date.now();
      log(`sent: ${sendByteCount} bytes, time: ${
            ((sendEndTime - sendStartTime) / 1000).toFixed(0)} secs`);
   });
}

export const fromSubSrvr = (paramObj) => {
  if(paramObj.ack) {
    if(chunkFinishedCb) {
      chunkFinishedCb();
      chunkFinishedCb = null;
    }
    else {
      log('ack received with no chunk callback', true);
    }
  }
  else if(paramObj.pong) {
    log('pong from sub srvr');
    return;
  }
  else if(paramObj.error) {
    log('error from sub srvr: ' + paramObj.error, true);
    sending = false;
    sendingName = '';
    return;
  }
  else if(paramObj.stdout) {
    const lines = paramObj.stdout.toString().split("\n");
    for(let line of lines) console.log(line);
    const lastLine = lines[lines.length-2];
    const timeParts = /^.*?--> (\d+):/.exec(lastLine);
    if(timeParts) {
      const namePath = subReqQueue[0];
      statusName     = namePath?.name;
      statusMinutes  = +timeParts[1];
    }
    return;
  }
  else if(paramObj.stderr) {
    log('stderr from sub srvr: ' + paramObj.stderr, true);
    sending = false;
    sendingName = '';
    return;
  }
  else if(paramObj.data) {
    const namePath = subReqQueue[0];
    statusName     = namePath?.name;
    statusMinutes  = paramObj.mins;
    console.log('fromSubSrvr:', statusMinutes, 'minutes');
    if(!paramObj.srt) return;

    log('writing srt file, length: ' + paramObj.srt.length);
    fs.writeFileSync(pathToSrtPath(namePath.path), paramObj.srt);
    subReqQueue.shift();
    fs.writeFileSync('data/subReqs.json', JSON.stringify(subReqQueue));
    const processEndTime = Date.now();
    log(`conversion time: ${
                ((processEndTime - sendEndTime)/(60*1000)).toFixed(0)} mins`);
    sending = false;
    sendingName = '';
  }
  trySendOneFile();
}

const cancelShow = (name) => {
  log('cancelling');
  subReqQueue = subReqQueue.filter((req) => req.name != name);
  fs.writeFileSync('data/subReqs.json', JSON.stringify(subReqQueue));
  if(sendingName == name) { 
    ws.send(cancelArr);
    sending = false;
    sendingName = '';
    trySendOneFile();
  }
}

export const sendPing = () => {
  log('pinging sub server');
  ws.send(pingArr);
}

const addSubReq = (name, path) => {
  console.log('addSubReq:', {name, path});
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
  log(`added ${pathAddedCount} file(s) to queue for ${name}`); 
  trySendOneFile();
  return null;
}

const getSubStatus = (name) => {
  let nameCount = 0;
  for(let namePath of subReqQueue) {
    if(namePath.name == name) nameCount++;
  }
  const status = {
    count: nameCount,
    mins:  statusMinutes,
    ok:    true,
  };
  // console.log('getSubStatus:', name, status);
  return status;
}

export const syncSubs = (id, namePath, resolve, reject) => {
  // log('cc request from web app: ' + namePath, false, true);
  let namePathObj = jParse(namePath, 'syncSubs');
  if(!namePathObj) {
    log('syncSubs parse error', true);
    reject([id, 'syncSubs parse error']);
  }
  else {
    const {name, path, cancel} = namePathObj;
    if(cancel) {
      cancelShow(name);
      resolve([id, 'ok']);
      return;
    } 
    let addErr = null;
    if(path) addErr = addSubReq(name, path);
    const    status = getSubStatus(name);
    if(addErr === null && status?.ok) 
      resolve([id, status]);
    else
      reject( [id, {addErr, status}]);
  }
}
