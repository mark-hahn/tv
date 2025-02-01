import fs   from "fs";
import date from 'date-and-time';

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
  msg = date.format(new Date(), 'MM/DD HH:mm:ss ') +
            (repeatCount ? (''+repeatCount).padStart(4, ' ')
                         : '    ') + ' ' + msg;
  if(err) console.error(msg);
  else    console.log(msg);
  if(spacing) fs.appendFileSync('srvr.log', '\n');
  fs.appendFileSync('srvr.log', msg + '\n');
  repeatCount = 0;
}

