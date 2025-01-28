
let ws = null;

export const setWs = async (wsIn) => { 
  ws = wsIn;
}

export const onMessage = async (msg) => { 
  console.log('subs msg in:', msg);
}
