// const URL = 'ws://hahnca.com:8736';
const URL = 'ws://127.0.0.1:8736';

let ws;
const openWs = () => {ws = new WebSocket(URL)};
openWs();

let handleMsg  = null;
let haveSocket = false;

const waitingSends = [];

ws.onmessage = (event) => {
  // console.log("onmessage:" + event.data);
  handleMsg(event.data);
}

ws.onopen = () => {
  console.log("opened websocket");
  haveSocket = true;
  for(const msg of waitingSends) ws.send(msg);
  waitingSends.length = 0;
};

ws.onclose = () => {() =>
  console.log("websocket closed, trying open in 2 secs");
  haveSocket = false;
  setTimeout(openWs, 2000);
};

ws.onerror = (err) => {
  console.error(("websocket error:", err));
  haveSocket = false;
};

const calls      = [];
const fCallQueue = [];
let   nextId     = 0;
let   clint      = null;

if(!clint) {
  clint = setInterval(() => {
    const length = Object.keys(calls).length;
    if(length)
      console.log("calls length:",  Object.keys(calls).length);
  }, 5000);
}

const fCall = (fname, param, sema4) => {
  if(sema4) { 
    const callIdx = calls.findIndex(
                            call => call.sema4 == sema4);
    if(callIdx > -1) {
      fCallQueue.push({fname, param, sema4});
      console.log("queued:", fname);
      return;
    }
  }
  const id = ++nextId;
  console.log("calling:", {id, fname});
  const promise = new Promise((resolve, reject) => {
    calls.push({id, fname, resolve, reject, sema4});
  });
  const msg = `${id}~~~${fname}~~~${param}`;
  if(!haveSocket) waitingSends.push(msg);
  else ws.send(msg);
  return promise;
}

handleMsg = (msg) => { 
  msg = msg.toString();
  const parts = /^(.*)~~~(.*)~~~(.*)$/.exec(msg);
  if(!parts) {
    console.error('skipping bad message:', msg);
    return;
  }
  const [id, status, result] = parts.slice(1);
  console.log("handling msg:", id, status);
  if(id == '0') return;

  const callIdx = calls.findIndex(
                     call =>  call.id == id);
  if(callIdx < 0) {
    console.error("no matching id from msg:", id);
    return;
  }
  const call = calls[callIdx];
  calls.splice(callIdx, 1);
  const {fname, resolve, reject, sema4} = call;
  try {
    const res = JSON.parse(result);
    if(status == 'ok') resolve(res);
    else                reject(res);
  }
  catch(err) {
    console.error("parsing ws result:", {id, result, err});
  }
  
  const queuelIdx = fCallQueue.findIndex(
                      entry => entry.sema4 == sema4);
  if(queuelIdx < 0) return;
  console.log("dequeuing:", fname);
  const entry = fCallQueue[queuelIdx];
  fCallQueue.splice(queuelIdx, 1);
  fCall(entry.fname, entry.param, entry.sema4);
}

export function getAllShows()      
            {return fCall('getAllShows')}

export function getRejects()       
            {return fCall('getRejects')}
export function addReject(name)    
            {return fCall('addReject', name, 'rej')}
export function delReject(name)    
            {return fCall('delReject', name, 'rej')}

export function getPickups()       
            {return fCall('getPickups')}
export function addPickup(name)    
            {return fCall('addPickup', name, 'pkup')}
export function delPickup(name)    
            {return fCall('delPickup', name, 'pkup')}

export function deletePath(path)   
            {return fCall('deletePath', path)}

