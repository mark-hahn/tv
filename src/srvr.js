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

const calls = {};
let nextId  = 0;

const fCall = (fname, param) => {
  const id = ++nextId;
  console.log("calling:", id, fname);
  const promise = new Promise((resolve, reject) => {
    calls[id] = [resolve, reject];
  });
  const msg = `${id}...${fname}...${param}`;
  if(!haveSocket) waitingSends.push(msg);
  else ws.send(msg);
  return promise;
}

handleMsg = (msg) => { 
  msg = msg.toString()
  const parts = /^(.*)\.\.\.(.*)\.\.\.(.*)$/.exec(msg);
  if(!parts) {
    console.error('skipping bad message:', msg);
    return;
  }
  const [id, status, result] = parts.slice(1);

  console.log("handleMsg:", id, status);
  if(id == '0') return;

  const [resolve, reject] = calls[id]; 
  if(!resolve) {
    console.error("no matching id from msg:", id);
    return;
  }
  delete calls[id];
  try { 
    const res = JSON.parse(result);
    if(status == 'ok') resolve(res);
    else                reject(res);
  }
  catch(err) {
    console.error("parsing ws result:", {id, result, err});
  } 
}

export function getSeries()        {return fCall('getSeries',  '')}

export function getRejects()       {return fCall('getRejects',  '')}
export function addReject(name)    {return fCall('addReject',   name)}
export function delReject(name)    {return fCall('delReject',   name)}

export function getPickups()       {return fCall('getPickups',  '')}
export function addPickup(name)    {return fCall('addPickup',   name)}
export function delPickup(name)    {return fCall('delPickup',   name)}

export function deletePath(path)   {return fCall('deletePath',  path)}

