const URL = 'wss://hahnca.com/tv-series-srvr';

let ws;
const openWs = () => {
  ws = new WebSocket(URL);
  attachWsHandlers();
};

let handleMsg  = null;
let haveSocket = false;

const waitingSends = [];

const calls      = [];
const fCallQueue = [];
let   nextId     = 0;
let   clint      = null;

const rejectAllPending = (reason) => {
  const err = reason || { error: 'websocket disconnected' };
  while (calls.length) {
    const call = calls.shift();
    try {
      call.reject(err);
    } catch {
      // ignore
    }
  }
}

const attachWsHandlers = () => {
  ws.onmessage = (event) => {
    // console.log("onmessage:" + event.data);
    handleMsg(event.data);
  };

  ws.onopen = () => {
    console.log("opened websocket");
    haveSocket = true;
    for (const msg of waitingSends) ws.send(msg);
    waitingSends.length = 0;
  };

  ws.onclose = () => {
    console.log("websocket closed, trying open in 2 secs");
    haveSocket = false;
    rejectAllPending({ error: 'websocket closed' });
    setTimeout(openWs, 2000);
  };

  ws.onerror = (err) => {
    console.error(("websocket error:", err));
    haveSocket = false;
    rejectAllPending({ error: 'websocket error', details: err });
  };
};

openWs();

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
    calls.push({id, fname, param, resolve, reject});
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
    msg = text;
  }
  msg = msg.toString();
  const parts = /^(.*)~~~(.*)~~~(.*)$/.exec(msg);
  if(!parts) {
    console.error('skipping bad message:', msg);
    return;
  }
  const [id, status, result] = parts.slice(1);
  // console.log("handling msg:", id, status);
  if(id == '0') return;

  const callIdx = calls.findIndex(call =>  call.id == id);
  if(callIdx < 0) {
    console.error("no matching id from msg:", id);
    return;
  }
  const call = calls[callIdx];
  calls.splice(callIdx, 1);
  const {fname, param, resolve, reject} = call;
  if(status != 'ok') 
    console.error('Reject from server:', 
                    {id, fname, param, status, result});
  try {
    // console.log("parsing ws result:", {id, result});
    const res = JSON.parse(result);
    if(status == 'ok') resolve(res);
    else                reject(res);
  }
  catch(err) {
    const msg = `handleMsg, error parsing ws result:`;
    console.error(msg, {id, result, err});
    reject(msg);
  }
}

export async function deleteShowFromSrvr(show) {
  await delGap([show.Id, true]);
  if(show.Pickup)  await delPickup(show.Name);
  await delNoEmby(show.Name);
  await deletePath(show.Path);
  // don't ever delete from remotes
  // don't ever delete from rejects
  // don't ever delete from tvdb
  console.log("deleted show from server:", show.Name);
}

export const lastViewedCache = {};

const updateLastViewedCache = async () => {
  const lastViewed = await getLastViewed();
  Object.assign(lastViewedCache, lastViewed);
}
setTimeout(updateLastViewedCache, 0); 
setInterval(updateLastViewedCache, 10*1000); // every 10 secs

export function getShowsFromDisk()      
            {return fCall('getShowsFromDisk')}
export function createShowFolder(params)
            {return fCall('createShowFolder', params)}

// Shared filters (cross-computer) 
export function getSharedFilters()
            {return fCall('getSharedFilters')}
export function setSharedFilters(sharedFilters)
            {return fCall('setSharedFilters', sharedFilters)}

export function deletePath(path)   
            {return fCall('deletePath', path)}
export function delSeasonFiles(showName, showPath, season)
            {return fCall('delSeasonFiles', { showName, showPath, season })}
export function updateTvdb()      
            {return fCall('updateTvdb')}

export function getDevices()      
            {return fCall('getDevices')}
export function getLastViewed()      
            {return fCall('getLastViewed')}

// OpenSubtitles (server-side search)
// tv-series-srvr should implement this endpoint.
// params: { imdb_id?: string, q?: string, page?: number }
export function subsSearch(params)
            {return fCall('subsSearch', params)}

// Apply subtitle files to media files on the server.
// fileIdObjs: [{ file_id:number, showName:string, season:number, episode:number }, ...]
// Returns: "ok" or { error: string }
export function applySubFiles(fileIdObjs)
            {return fCall('applySubFiles', fileIdObjs)}

// Delete previously applied subtitle files on the server.
// fileIdObjs: [{ file_id:number, showName:string, season:number, episode:number }, ...]
// Returns: "ok" or { error: string }
export function deleteSubFiles(fileIdObjs)
            {return fCall('deleteSubFiles', fileIdObjs)}

// Offset (trim) existing subtitle files on the server.
// fileIdObjs: [{ file_id:number, showName:string, season:number, episode:number, offset:number }, ...]
// Returns: "ok" or { error: string } or { ok:true, failures:[...], applied:[...] }
export function offsetSubFiles(fileIdObjs)
            {return fCall('offsetSubFiles', fileIdObjs)}


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
export function getNewTvdb(params)    
            {return fCall('getNewTvdb', params)}
export function setTvdbFields(params) 
              {return fCall('setTvdbFields', params)}
export function getRemotesCmd(params)
            {return fCall('getRemotes', params)}
export function getActorPage(params) 
              {return fCall('getActorPage', params)}

export function sendEmail(emailData)    
            {return fCall('sendEmail', emailData)}

export function getTmdb(params)
            {return fCall('getTmdb', params)}

// Persistent per-show notes
export function saveNote(showName, noteText)
            {return fCall('saveNote', { showName, noteText })}
export function getNote(showName)
            {return fCall('getNote', showName)}
export function getAllNotes()
            {return fCall('getAllNotes')}

// File browser
export async function getFile(path) {
  console.log('RPC getFile call:', path);
  try {
    const res = await fCall('getFile', path);
    console.log('RPC getFile result:', res);
    return res;
  }
  catch (err) {
    console.log('RPC getFile error:', err);
    throw err;
  }
}
