const URL = 'wss://hahnca.com/tv-series-srvr';

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

// if(!clint) {
//   clint = setInterval(() => {
//     const length = Object.keys(calls).length;
//     if(length) {
//       let fnameList = '';
//       calls.forEach(call => {fnameList += call.fname + ' '});
//       console.log("pending calls:", fnameList);
//     }
//   }, 5000);
// }

const fCall = (fname, param) => {
  const id = ++nextId;
  const promise = new Promise((resolve, reject) => {
    calls.push({id, fname, resolve, reject});
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

handleMsg = async (msg) => { 
  if(msg instanceof Blob) {
    const text = await msg.text();
    console.log("blob msg length:", text.length);
    return;
  }
  msg = msg.toString();
  const parts = /^(.*)~~~(.*)~~~(.*)$/.exec(msg);
  if(!parts) {
    console.error('skipping bad message:', msg);
    return;
  }
  const [id, status, result] = parts.slice(1);
  if(status != 'ok') 
    console.error('Reject from server:', {id, status, result});
  // console.log("handling msg:", id, status);
  if(id == '0') return;

  const callIdx = calls.findIndex(
                     call =>  call.id == id);
  if(callIdx < 0) {
    console.error("no matching id from msg:", id);
    return;
  }
  const call = calls[callIdx];
  calls.splice(callIdx, 1);
  const {fname, resolve, reject} = call;
  try {
    // console.log("parsing ws result:", {id, result});
    const res = JSON.parse(result);
    if(status == 'ok') resolve(res);
    else                reject(res);
  }
  catch(err) {
    console.error("parsing ws result:", {id, result, err});
  }
}

export async function deleteShowFromSrvr(show) {
  await delBlockedWait(show.Name);
  await delBlockedGap(show.Name);
  await delGap([show.Id, true]);
  await delPickup(show.Name);
  await delNoEmby(show.Name);
  await deletePath(show.Path);
  // don't ever delete from remotes
  // don't ever delete from rejects
  // don't ever delete from tvdb
  console.log("deleted show from server:", show.Name);
}

export const lastViewedCache = {};

export const lastViewedByShow = 
              (name) => lastViewedCache[name];

const updateLastViewedCache = async () => {
  const lastViewed = await getLastViewed();
  Object.assign(lastViewedCache, lastViewed);
}
updateLastViewedCache();
setInterval(updateLastViewedCache, 60*1000); // 1 minute

export function getAllShows()      
            {return fCall('getAllShows')}
export function deletePath(path)   
            {return fCall('deletePath', path)}
export function getUrls(typeUrlName)   
            {return fCall('getUrls', typeUrlName)}
export function getLastViewed()      
            {return fCall('getLastViewed')}
export function syncSubs(namePath)   
            {return fCall('syncSubs', namePath)}

export function getBlockedWaits()        
            {return fCall('getBlockedWaits')}
export function addBlockedWait(name)        
            {return fCall('addBlockedWait', name)}
export function delBlockedWait(name)  
            {return fCall('delBlockedWait', name)}

export function getBlockedGaps()        
            {return fCall('getBlockedGaps')}
export function addBlockedGap(name)        
            {return fCall('addBlockedGap', name)}
export function delBlockedGap(name)  
            {return fCall('delBlockedGap', name)}

export function getRejects()       
            {return fCall('getRejects')}
export function addReject(name)    
            {return fCall('addReject', name)}
export function delReject(name)    
            {return fCall('delReject', name)}

export function getPickups()       
            {return fCall('getPickups')}
export function addPickup(name)    
            {return fCall('addPickup', name)}
export function delPickup(name)    
            {return fCall('delPickup', name)}
            
export function getNoEmbys()       
            {return fCall('getNoEmbys')}
export function addNoEmby(show)    
            {return fCall('addNoEmby', show)}
export function delNoEmby(name)    
            {return fCall('delNoEmby', name)}

export function getGaps()       
            {return fCall('getGaps')}
export function addGap(gapIdGapSave)    
            {return fCall('addGap', gapIdGapSave)}
export function delGap(gapIdSave)    
            {return fCall('delGap', gapIdSave)}

export function getAllTvdb()      
            {return fCall('getAllTvdb')}
export function addTvdb(tvdbData)    
            {return fCall('addTvdb', tvdbData)}

export function getRemotes(name)    
            {return fCall('getRemotes', name)}
export function addRemotes(nameRems)    
            {return fCall('addRemotes', nameRems)}
