const ws = new WebSocket('ws://192.168.1.103:8736');

let handleMsg = null;

ws.onmessage = (event) => {
  console.log("onmessage:" + event.data);
  handleMsg(event.data);
}

ws.onopen = () => {
  console.log("onopen");
};

ws.onclose = () => {() =>
  console.log("onclose");
};

ws.onerror = (err) => {
  console.log("Error", err);
};

const calls = {};
let nextId  = 0;

const funcCall = (fname, param) => {
  const id = ++nextId;
  ws.send(`${id}\`${fname}\`${param}`);
  const promise = new Promise((resolve, reject) => {
    calls[id] = [resolve, reject];
  });
  return promise;
}

handleMsg = (msg) => { 
  console.log("handleMsg: " + msg);
  const [id, status, result] = msg.split('`');
  const [resolve, reject]    = calls[id]; 
  delete calls[id];
  try {
    const res = JSON.parse(result);
    if(status === 'ok') resolve(res);
    else                 reject(res);
  }
  catch(err) {
    console.log("Error parsing ws result:", {id, result, err});
  } 
}

export function getSeries()      {return funcCall('getSeries',  '')}
export function getRejects()     {return funcCall('getRejects', '')}
export function getPickups()     {return funcCall('getPickups', '')}
export function addReject(name)  {return funcCall('addReject',  name)}
export function delReject(name)  {return funcCall('delReject',  name)}
export function addPickup(name)  {return funcCall('addPickup',  name)}
export function delPickup(name)  {return funcCall('delPickup',  name)}
export function deleteFile(path) {return funcCall('deleteFile', path)}

// ws.close();
