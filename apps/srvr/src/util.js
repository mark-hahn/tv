import fs   from "fs";
import fsp  from 'fs/promises' 
import * as path from 'node:path';
import date from 'date-and-time';

const DEFAULT_TV_DATA_DIR = '/root/dev/apps/tv/data';
const TV_DATA_DIR = (typeof process.env.TV_DATA_DIR === 'string' && process.env.TV_DATA_DIR.trim())
  ? process.env.TV_DATA_DIR.trim()
  : DEFAULT_TV_DATA_DIR;

const SRVR_MISC_DIR = path.join(TV_DATA_DIR, 'srvr', 'misc');
const SRVR_LOG_PATH = path.join(SRVR_MISC_DIR, 'srvr.log');

try {
  fs.mkdirSync(SRVR_MISC_DIR, { recursive: true });
} catch {}

export const jParse = (str, label) => {
  let obj;
  try { obj = JSON.parse(str); }
  catch(e) {
    console.error(`JSON parse error${label ? ' at ' + label : ''}, ${e.message}`);
    return null;
  }
  return obj;
}

let lastMsg     = null;
let repeatCount = 0;
export const log = (msg, err = false, spacing = false) => {
  if(msg == lastMsg) {
    repeatCount++;
    return;
  }
  lastMsg = msg;
  // https://github.com/knowledgecode/date-and-time
  msg = date.format(new Date(), 'MM/DD HH:mm:ss ') +
            (repeatCount ? (''+repeatCount).padStart(4, ' ')
                         : '    ') + ' ' + msg;
  if(err) console.error(msg);
  else    console.log(msg);
  try {
    if(spacing) fs.appendFileSync(SRVR_LOG_PATH, '\n');
    fs.appendFileSync(SRVR_LOG_PATH, msg + '\n');
  } catch {}
  repeatCount = 0;
}

let busyByPath     = {};
let dataByPath     = {};
let resolvesByPath = {};

const chkWriteFile = async() => {
  let anyWritten = false;
  for (let path in dataByPath) {
    if(busyByPath[path]) continue;
    busyByPath[path] = true;
    let data = dataByPath[path];
    if((typeof data) != 'string') 
      data = JSON.stringify(data);
    await fsp.writeFile(path, data);
    resolvesByPath[path].forEach(
             (resolve) => resolve());
    resolvesByPath[path] = [];
    delete dataByPath[path];
    anyWritten = true;
    busyByPath[path] = false;
  }
  if(anyWritten) await chkWriteFile();
}

export const writeFile = (path, data) => {
  dataByPath[path] = data;
  if(!resolvesByPath[path]) 
      resolvesByPath[path] = [];
  const promise = new Promise((resolve) => {
    resolvesByPath[path].push(resolve);
  });
  chkWriteFile();
  return promise;
}

export function getLog(module) {
  const timers = Object.create(null);

  const start = function (name, hide = false, msg = "") {
    timers[name] = Date.now();
    if (hide) return;
    const line = `[${module}]: ${name} started${msg ? ", " + msg : ""}`;
    console.log(line);
  };

  const end = function (name, onlySlow = false, msg = "") {
    if (!timers[name]) {
      const line = `[${module}]: ${name} ended${msg ? ", " + msg : ""}`;
      console.log(line);
      return;
    }
    const duration = Date.now() - timers[name];
    if (onlySlow && duration < 100) return;
    const line = `[${module}]: ${name} ended, ${duration}ms${msg ? ", " + msg : ""}`;
    console.log(line);
  };

  const log = function (...args) {
    let errFlag = false;
    let errMsgFlag = false;
    let nomodFlag = false;
    let notimeFlag = false;
    
    if (typeof args[0] === "string") {
      errFlag    = args[0].includes("err");
      nomodFlag  = args[0].includes("nomod");
      notimeFlag = args[0].includes("notime");
      errMsgFlag = args[0].includes("errmsg");
    }

    if (errFlag || nomodFlag || notimeFlag || errMsgFlag) args = args.slice(1);

    let errMsg;
    if (errMsgFlag) {
      errMsg = (args[0]?.message) + " -> ";
      args = args.slice(1);
      errFlag = true;
    }

    const par = args.map((a) => {
      if (typeof a === "object" && a !== null) {
        try {
          return JSON.stringify(a, null, 2);
        } catch (e) {
          return JSON.stringify(Object.keys(a)) + (e && e.message ? e.message : "");
        }
      } else {
        return a;
      }
    });

    const timeHdr = date.format(new Date(), 'MM/DD HH:mm:ss');

    const line =
      (nomodFlag  ? "" : "[" + module + "] ") +
      (notimeFlag ? "" : timeHdr  + " ") +
      (errFlag ? " error, " : "") +
      (errMsg != null ? errMsg : "") +
      par.join(" ");

    if (errFlag) console.error(line);
    else console.log(line);
  }

  return { log, start, end };
}
