const URL = 'ws://192.168.1.103:8736';
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

const fCall = (fname, param, payld) => {
  const callIdx = 
          calls.findIndex((call) => call.fname == fname);
  if(callIdx > -1) {
    fCallQueue.push({fname, param, payld});
    console.log("queued:", fname);
    return;
  }
  const id = ++nextId;
  console.log("calling:", {id, fname});
  const promise = new Promise((resolve, reject) => {
    calls.push({id, fname, resolve, reject, payld});
  });
  const msg = `${id}...${fname}...${param}`;
  if(!haveSocket) waitingSends.push(msg);
  else ws.send(msg);
  return promise;
}

handleMsg = (msg) => { 
  msg = msg.toString();
  const parts = /^(.*)\.\.\.(.*)\.\.\.(.*)$/.exec(msg);
  if(!parts) {
    console.error('skipping bad message:', msg);
    return;
  }
  const [id, status, result] = parts.slice(1);
  console.log("handling msg:", id, status);
  if(id == '0') return;

  const callIdx = calls.findIndex(
    (call) => {
      if(!call) return false;
      else      return (call.id == id);
    }
  );

  if(callIdx < 0) {
    console.error("no matching id from msg:", id);
    return;
  }
  const call = calls[callIdx];
  delete calls[callIdx];
  const {fname, resolve, reject, payld} = call;
  try { 
    const res = JSON.parse(result);
    res.payld = payld
    if(status == 'ok') resolve(res);
    else                reject(res);
  }
  catch(err) {
    console.error("parsing ws result:", {id, result, err});
  }
  
  const queuelIdx = fCallQueue.findIndex(
                    (entry) => entry.fname == fname);
  if(queuelIdx < 0) return;
  console.log("dequeuing:", fname);
  const entry = fCallQueue[queuelIdx];
  delete fCallQueue[queuelIdx];
  fCall(entry.fname, entry.param, entry.payld);
}

export function getAllShows(payld)      
            {return fCall('getAllShows', '', payld)}

export function getRejects(payld)       
            {return fCall('getRejects',  '', payld)}
export function addReject(name, payld)    
            {return fCall('addReject', name, payld)}
export function delReject(name, payld)    
            {return fCall('delReject', name, payld)}

export function getPickups(payld)       
            {return fCall('getPickups',   '', payld)}
export function addPickup(name, payld)    
            {return fCall('addPickup',  name, payld)}
export function delPickup(name, payld)    
            {return fCall('delPickup',  name, payld)}

export function deletePath(path, payld)   
            {return fCall('deletePath', path, payld)}

