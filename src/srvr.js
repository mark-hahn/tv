const URL = 'ws://192.168.1.103:8736';
let ws;

const openWs = () => {ws = new WebSocket(URL)};
openWs();

let handleMsg = null;
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

const funcCall = (fname, param) => {
  const id = ++nextId;
  console.log("calling:", id, fname);
  const promise = new Promise((resolve, reject) => {
    calls[id] = [resolve, reject];
  });
  const msg = `${id}\`${fname}\`${param}`;
  if(!haveSocket) waitingSends.push(msg);
  else ws.send(msg);
  return promise;
}

handleMsg = (msg) => { 
  const [id, status, result] = msg.split('`');
  console.log("handleMsg:", id, status);
  if(id == '0') return;
  const [resolve, reject] = calls[id]; 
  delete calls[id];
  try {
    const res = JSON.parse(result);
    if(status === 'ok') resolve(res);
    else                 reject(res);
  }
  catch(err) {
    console.error("parsing ws result:", {id, result, err});
  } 
}

export function getSeries()       {return funcCall('getSeries',  '')}
export function getRejects()      {return funcCall('getRejects', '')}
export function getPickups()      {return funcCall('getPickups', '')}
export function addReject(name)   {return funcCall('addReject',  name)}
export function delReject(name)   {return funcCall('delReject',  name)}
export function addPickup(name)   {return funcCall('addPickup',  name)}
export function delPickup(name)   {return funcCall('delPickup',  name)}
export function renameFile(paths) {return funcCall('renameFile', paths)}
export function deleteFile(path)  {return funcCall('deleteFile', path)}

// ws.close();
