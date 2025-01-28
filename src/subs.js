import fs from "fs";

let ws = null;
const tvDir = '/mnt/media/tv';
const videoSfxs = [ "mp4", "mkv", "avi" ];

export const setWs = (wsIn) => { 
  ws = wsIn;
}

let subReqQueue;
const subReqQueueStr = fs.readFileSync('data/subReqs.json', 'utf8');
try { subReqQueue = JSON.parse(subReqQueueStr) }
catch(e) {
  console.error('data/subReqs.json parse error:',
                 e.message, subReqQueueStr);
}

const addSubReq = (name, path) => {
  console.log('subs addSubReq:', {name, path});
  const pathList = subReqQueue[name] || [];
  let errFlg = false;
  const recurs = (path) => {
    if(errFlg) return;
    try {
      const fstat = fs.statSync(path);
      if(fstat.isDirectory()) {
        const dir = fs.readdirSync(path);
        for (const dirent of dir) 
          recurs(path + '/' + dirent);
        return;
      }
      const pathParts = path.split('.');
      const sfx = pathParts.pop();
      if(videoSfxs.includes(sfx)) {
        const srtPath = pathParts.join('.')+ '.en-gen.srt';
        if(!fs.existsSync(srtPath)) pathList.push(path)
      }
    }
    catch (err) {
      errFlg = err;
    }
  }
  recurs(path);
  if(errFlg) return false;

  subReqQueue[name] = pathList;

  console.log({subReqQueue});
  
  return '';
}

const getSubStatus = (name)=> {
  console.log('subs getSubStatus:', name);
  let status = {};

  status.ok = true;
  return status;
}

export const syncSubs = (id, namePath, resolve, reject) => {
  console.log('syncSubs:', namePath);
  let namePathObj;
  try {
    namePathObj = JSON.parse(namePath);
  }
  catch(e) {
    const msg = 'syncSubs parse error: ' + e.message;
    console.log(msg);
    reject([id, msg]);
    return;
  }
  const {name, path} = namePathObj;
  let addErr;
  if(path !== '') addErr = addSubReq(name, path);
  const           status = getSubStatus(name);
  if(!addErr && status.ok) resolve([id, status]);
  else                     reject( [id, {addErr, status}]);
}
