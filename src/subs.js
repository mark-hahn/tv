import fs         from "fs";
import {Writable} from "stream"; 
import {jParse}   from "./util.js";
import date       from 'date-and-time';


const videoSfxs = [ "mp4", "mkv", "avi" ];

const subReqQueueStr = fs.readFileSync('data/subReqs.json', 'utf8');
let subReqQueue = jParse(subReqQueueStr, 'subs queue') ?? [];

let ws = null;

let statusName    = '';
let statusMinutes = 0;

const eofArr = new Uint32Array(1);
eofArr[0] = 0x07162534;

const log = (msg, err = false) => {
  if(err) console.error('subs, ' + msg);
  else    console.log(  'subs, ' + msg);
  fs.appendFileSync('subs.log', 
          date.format(new Date(), 'MM/DD HH:mm:ss ') + msg + '\n')
}

const pathToSrtPath = (path) =>  
        path.split('.').slice(0, -1).join('.') + '.en-gen.srt';

let sendEndTime;
let sending = false;
let chunkFinishedCb = null;

const sendOneFile = () => {
  const namePath = subReqQueue[0];
  console.log('sendOneFile:', {ws, sending, namePath});
  if(!ws || sending || namePath === undefined) return;
  sending = true;

  const path = namePath.path;
  log('sending file: ' + path);
  const sendStartTime = Date.now();

  const writeStream = new  Writable({
    write(chunk, _encoding, next) {
      if(ws.readyState !== WebSocket.OPEN) {
        log('ws not open in writeStream write', true);
        next(Error(errMsg));
        return;
      }
      // console.log('writeStream chunk:', 
      //               chunk.constructor.name, chunk.length);
      chunkFinishedCb = next;
      ws.send(chunk);
    }
  });

  fs.createReadStream(path, {highWaterMark: 1e7})
    .pipe(writeStream)
    .on('error', (err) => {
      log('error in readStream: ' + err.message, true);
    })
    .on('close', () => {
      ws.send(eofArr);
      sendEndTime = Date.now();
      log(`send time: ${
            ((sendEndTime - sendStartTime) / 1000).toFixed(0)} secs`);
   });
}

export const setWs = (wsIn) => {
  if(wsIn != ws) {
    ws = wsIn; 
    if(ws) {
      log('\nconnected: subs server websocket set');
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
      else {
        log('ack received with no chunk callback', true);
        sending = false;
      }
    }
    else if(dataObj.error) {
      log('error fromSubSrvr: ' + dataObj.error, true);
      sending = false;
    }
    else {
      const namePath = subReqQueue[0];
      statusName     = namePath.name;
      statusMinutes  = dataObj.mins;
      console.log('fromSubSrvr:', statusMinutes, 'minutes');
      if(!dataObj.srt) return;

      log('received srt file, length: ' + dataObj.srt.length);
      subReqQueue.shift();
      fs.writeFileSync('data/subReqs.json', JSON.stringify(subReqQueue));
      const processEndTime = Date.now();
      log(`conversion time: ${
                  ((processEndTime - sendEndTime)/(60*1000)).toFixed(0)} mins`);
      sending = false;
      sendOneFile();
    }
  }
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
  console.log('getSubStatus:', name, status);
  return status;
}

export const syncSubs = (id, namePath, resolve, reject) => {
  log('syncSubs from web app: ' + namePath);
  let namePathObj = jParse(namePath, 'syncSubs');
  if(!namePathObj) {
    log('syncSubs parse error', true);
    reject([id, 'syncSubs parse error']);
  }
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
