import fs                  from "fs";
import {readdir, stat}     from 'fs/promises';
import util                from "util";
import * as cp             from 'child_process';
import moment              from 'moment';
import { WebSocketServer } from 'ws';

const showdates   = false;
const dontupload  = true;
const forceUpload = false;

const ws = new WebSocketServer({ port: 8736 });
console.log('ws listening on port 8736');
// debug

const tvDir = '/mnt/media/tv';
const exec  = util.promisify(cp.exec);
const dat   = () => {
  if(!showdates) return '';
  return moment().format('MM/DD HH-mm-ss:');
}

const headerStr = fs.readFileSync('config/config1-header.txt',   'utf8');
const rejectStr = fs.readFileSync('config/config2-rejects.json', 'utf8');
const middleStr = fs.readFileSync('config/config3-middle.txt',   'utf8');
const pickupStr = fs.readFileSync('config/config4-pickups.json', 'utf8');
const footerStr = fs.readFileSync('config/config5-footer.txt',   'utf8');

const rejects = JSON.parse(rejectStr);
const pickups = JSON.parse(pickupStr);

const nameHash = (name) =>
  ('name-' + name
    .toLowerCase()
    .replace(/^the\s/, '')
    .replace(/[^a-zA-Z0-9]*/g, ''))

const folderDates =  async (id, params, resolve, reject) => {
  console.log(dat(), 'folderDates', {id, params});
  const dateList = {};
  try {
    const dir = await readdir(tvDir);
    for await (const dirent of dir) {
      const showPath = tvDir + '/' + dirent;
      const date     = (await stat(showPath)).mtime;
      const dateStr  = date.toISOString()
                        .substring(0,10).replace(/-/g, '/');
      const hash     =  nameHash(dirent);
      if(hash.length > 7) dateList[hash] = dateStr;
    }
  }
  catch (err) {
    reject([id, err]);
  }
  // console.log(dat(), {dateList});
  resolve([id, dateList]);
}

const recentDates =  async (id, params, resolve, reject) => {
  console.log(dat(), 'recentDates', {id, params});
  let mostRecentDate;
  let dirSize;
  let errFlg = null;
  const recentDates = {};
  const recurs = async (path) => {
    if(errFlg || path == tvDir + '/.stfolder') return;
    try {
      const fstat = await stat(path);
      const [sfx] = path.split('.').slice(-1);
      dirSize += fstat.size;

      if(['mkv','flv','vob','avi','mov','wmv','mp4',
          'mpg','mpeg','m2v','mp2'].includes(sfx)) {
        // console.log(dat(), 'video file',{path, fstat});
        const dateStr = fstat.mtime.toISOString()
                        .substring(0,10).replace(/-/g, '/');
        if(dateStr > '2050') return;
        if(dateStr > mostRecentDate) mostRecentDate = dateStr;
      }

      if(fstat.isDirectory()) {
        const dir = await readdir(path);
        for (const dirent of dir) {
          await recurs(path + '/' + dirent);
        }
      }
    }
    catch (err) {
      // console.error(err);
      errFlg = err;
    }
  }
  const dir = await readdir(tvDir);
  for (const dirent of dir) {
    const topLevelPath = tvDir + '/' + dirent;
    mostRecentDate = '0000/00/00';
    dirSize = 0;
    await recurs(topLevelPath);
    // console.log({dirent, mostRecentDate, dirSize});
    // process.exit();
    recentDates[nameHash(dirent)] = mostRecentDate + '|' + dirSize;
  }
  if(errFlg) {
    reject([id, errFlg]);
    return;
  }
  else {
    resolve([id, recentDates]);
    return;
  }
}
 
const upload = async () => {
  let str = headerStr;
  for(let name of rejects)
    str += '        - "' + name.replace(/"/g, '') + '"\n';
  str += middleStr;
  for(let name of pickups)
    str += '        - "' + name.replace(/"/g, '') + '"\n';
  str += footerStr;
  console.log(dat(), '\n\ncreating config.yml');
  fs.writeFileSync('config/config.yml', str);

  if(dontupload) {
    console.log(dat(), "---- didn't upload config.yml ----");
    return 'ok';
  }
  const {stdout} = await exec(
          'rsync -av config/config.yml xobtlu@oracle.usbx.me:' +
          '/home/xobtlu/.config/flexget/config.yml');
  const rx = new RegExp('total size is ([0-9,]*)');
  const matches = rx.exec(stdout);
  if(!matches || parseInt(matches[1].replace(',', '')) < 1000) {
    console.log(dat(), '\nERROR: config.yml upload failed\n', stdout, '\n');
    return `config.yml upload failed: ${stdout}`;
  }
  console.log(dat(), 'uploaded config.yml, size:', matches[1]);
  return 'ok';
}

const reload = async () => {
  // console.log(dat(), "\n\nPlease reload manually ----\n");

  if(dontupload) {
    console.log(dat(), "---- didn't reload ----");
    return 'ok';
  }

  const {stdout} = await exec(
    'ssh xobtlu@oracle.usbx.me /home/xobtlu/reload-cmd');
  
  if(!stdout.includes('Config successfully reloaded'))  {
    console.log(dat(), '\nERROR: config.yml reload failed\n', stdout, '\n');
    return `config.yml reload failed: ${stdout}`;
  }
  console.log(dat(), 'reloaded config.yml');
  return 'ok';
}

let saveTimeout = null;
let saveResult  = 'ok';
let saving      = false;

const saveConfigYml = () => {
  console.log(dat(), 'saving config.yml');
  rejects.sort((a,b) => { 
    return (a.toLowerCase() > b.toLowerCase() ? +1 : -1);
  });
  pickups.sort((a,b) => { 
    const aname = a.replace(/The\s/i, '');
    const bname = b.replace(/The\s/i, '');
    return (aname.toLowerCase() > bname.toLowerCase() ? +1 : -1);
  });
  fs.writeFileSync('config/config2-rejects.json', JSON.stringify(rejects)); 
  fs.writeFileSync('config/config4-pickups.json', JSON.stringify(pickups)); 
  if(saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout( async () => {
    saveTimeout = null;
    if(saving) {
      setTimeout(saveConfigYml, 10000);
      return;
    }
    saving = true;
    const uploadRes = await upload();
    if(uploadRes != 'ok') saveResult = uploadRes;
    else {
      const reloadRes = await reload();
      if(reloadRes != 'ok') saveResult = reloadRes;
    }
    saving = false;
  }, 10000);  

  // PROBLEM:  returns 'ok' before upload and reload are done

  const result = saveResult;
  saveResult = 'ok';
  return result;
};

// debug
if(forceUpload) {
  upload();
  reload();
}

// app.get('/rejects.json', function (req, res) {
//   res.send(fs.readFileSync('config/config2-rejects.json', 'utf8'));
// });

// app.get('/pickups.json', function (req, res) {
//   res.send(fs.readFileSync('config/config4-pickups.json', 'utf8'));
// });

// app.get('/recentDates', async function (req, res) {
//   const str = JSON.stringify(await recentDates());
//   fs.writeFileSync('recentDates-dbg.json', str);
//   res.send(str);
// });

// app.get('/deleteFile/:path', function (req, res) {
//   let {path} = req.params;
//   if(path === 'undefined') {
//     res.send('{"status" : "skipping delete of undefined path"}');
//     return;
//   }
//   path = decodeURI(path).replaceAll('`', '/').replaceAll('~', '?');
//   let resStr = `{"status":"ok", "path":"${path.replaceAll('"', "'")}"}`;
//   try { 
//     console.log('deleting:', path);
//     fs.unlinkSync(path); 
//   }
//   catch(e) {
//     resStr = `{"status":"${e.message.replaceAll('"', "'")}", "path":"${path.replaceAll('"', "'")}"}`;
//   }
//   res.send(resStr);
// })

// app.post('/rejects/:name', function (req, res) {
//   const name = req.params.name;
//   for(const [idx, rejectNameStr] of rejects.entries()) {
//     if(rejectNameStr.toLowerCase() === name.toLowerCase()) {
//       console.log(dat(), '-- removing old matching reject:', rejectNameStr);
//       rejects.splice(idx, 1);
//     }
//   }
//   console.log(dat(), '-- adding reject:', name);
//   rejects.push(name);
//   res.send(saveConfigYml());
// })

// app.delete('/rejects/:name', function (req, res) {
//   const name = req.params.name;
//   let deletedOne = false;
//   for(const [idx, rejectNameStr] of rejects.entries()) {
//     if(rejectNameStr.toLowerCase() === name.toLowerCase()) {
//       console.log(dat(), '-- deleting reject:', rejectNameStr);
//       rejects.splice(idx, 1);
//       deletedOne = true;
//     }
//   }
//   if(!deletedOne) {
//     console.log(dat(), '-- reject not deleted -- no match:', name);
//     res.send('ok');
//   }
//   else res.send(saveConfigYml());
// })

// app.post('/pickups/:name', function (req, res) {
//   const name = req.params.name;
//   for(const [idx, pickupNameStr] of pickups.entries()) {
//     if(pickupNameStr.toLowerCase() === name.toLowerCase()) {
//       console.log(dat(), '-- removing old matching pickup:', pickupNameStr);
//       pickups.splice(idx, 1);
//     }
//   }
//   console.log(dat(), '-- adding pickup:', name);
//   pickups.push(name);
//   res.send(saveConfigYml());
// })

// app.delete('/pickups/:name', function (req, res) {
//   const name = req.params.name;
//   let deletedOne = false;
//   for(const [idx, pickupNameStr] of pickups.entries()) {
//     if(pickupNameStr.toLowerCase() === name.toLowerCase()) {
//       console.log(dat(), '-- deleting pickup:', pickupNameStr);
//       pickups.splice(idx, 1);
//       deletedOne = true;
//     }
//   }
//   if(!deletedOne) {
//     console.log(dat(), '-- pickup not deleted -- no match:', name);
//     res.send('ok');
//   }
//   else res.send(saveConfigYml());
// })




//////////////////  WEBSOCKET SERVER  //////////////////

ws.on('connection', (socket) => {
  console.log(dat(), 'ws connected');

  socket.send('0:ok:{connected:true}');

  socket.on('message', (msg) => {
    console.log(dat(), 'received', msg.toString());

    const [id, fname, paramsJson] = msg.toString().split('`');

    let resolve = null;
    let reject  = null;

    // param called when promise is resolved or rejected
    // there is one unique promise for each function call
    const promise = new Promise((resolveIn, rejectIn) => {
          resolve = resolveIn; reject = rejectIn;});

    promise.then((idResult) => {
      console.log(dat(), 'resolve', idResult);
      const [id, result] = idResult;
      socket.send(`${id}\`ok\`${JSON.stringify(result)}`); 
    })
    .catch((idError) => {
      console.log(dat(), 'rejected', idError);
      const [id, error] = idError;
      socket.send(`${id}\`err\`${JSON.stringify(error)}`); 
    });

    const params = JSON.parse(paramsJson);

    // call function fname
    switch (fname) {
      case 'folderDates': folderDates(id, params, resolve, reject); break;
      case 'test': recentDates(id, params, resolve, reject); break;

      default: socket.send(
          `${id}\`err\`{"error":"unknown function: ${fname}"}`); 
    };
  });

  ws.on('error', console.error );
  ws.on('close', console.log);
});

// https://github.com/websockets/ws?tab=readme-ov-file
