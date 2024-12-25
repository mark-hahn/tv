const URL = 'wss://hahnca.com/tv-series-srvr';

let ws;
const openWs = () => {ws = new WebSocket(URL)};
openWs();

let handleMsg  = null;
let haveSocket = false;

const waitingSends = [];

let showErr = null;
export function init(showErrIn) {
  showErr = showErrIn;
}

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
  showErr(("websocket error:", err));
  haveSocket = false;
};

const calls      = [];
const fCallQueue = [];
let   nextId     = 0;
let   clint      = null;

if(!clint) {
  clint = setInterval(() => {
    const length = Object.keys(calls).length;
    if(length) {
      let fnameList = '';
      calls.forEach(call => {fnameList += call.fname + ' '});
      console.log("pending calls:", fnameList);
    }
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
  const promise = new Promise((resolve, reject) => {
    calls.push({id, fname, resolve, reject, sema4});
  });
  if(typeof param == 'object') 
        param = JSON.stringify(param);
  const msg = `${id}~~~${fname}~~~${param}`;

  if(!haveSocket) waitingSends.push(msg);
  else {
    // console.log("sending:", msg);
    ws.send(msg);
  }
  return promise;
}

handleMsg = (msg) => { 
  msg = msg.toString();
  const parts = /^(.*)~~~(.*)~~~(.*)$/.exec(msg);
  if(!parts) {
    showErr('skipping bad message:', msg);
    return;
  }
  const [id, status, result] = parts.slice(1);
  // console.log("handling msg:", id, status);
  if(id == '0') return;

  const callIdx = calls.findIndex(
                     call =>  call.id == id);
  if(callIdx < 0) {
    showErr("no matching id from msg:", id);
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
    showErr("parsing ws result:", {id, result, err});
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

export function getBlockedWaits()        
            {return fCall('getBlockedWaits')}
export function addBlockedWait(name)        
            {return fCall('addBlockedWait', name, 'wait')}
export function delBlockedWait(name)  
            {return fCall('delBlockedWait', name, 'wait')}

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
            
export function getNoEmbys()       
            {return fCall('getNoEmbys')}
export function addNoEmby(show)    
            {return fCall('addNoEmby', show, 'noemby')}
export function delNoEmby(name)    
            {return fCall('delNoEmby', name, 'noemby')}

export function getRemotes(name)    
            {return fCall('getRemotes', name,     'remotes')}
export function addRemotes(nameRems)    
            {return fCall('addRemotes',  nameRems, 'remotes')}
export function delRemotes(name)    
            {return fCall('delRemotes',  name,     'remotes')}
            
export function deletePath(path)   
            {return fCall('deletePath', path, 'deletePath')}

export function getUrls(urlReq)   
            {return fCall('getUrls', urlReq, 'getUrls')}

export async function deleteShowFromSrvr(show) {
  await delBlockedWait(show.Name);
  await delPickup(show.Name);
  await delNoEmby(show.Name);
  await delRemotes(show.Name);
  await deletePath(show.Path);
  // don't ever delete from rejects
  console.log("deleted show from server:", show.Name);
}
