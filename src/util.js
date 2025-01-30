import fs   from "fs";
import date from 'date-and-time';

export const jParse = (str, label) => {
  let obj;
  try { obj = JSON.parse(str); }
  catch(e) {
    console.error(`JSON parse error${label ? ' at ' + label : ''}, e.message}`);
    return null;
  }
  return obj;
}

export const log = (msg, err = false, spacing = false) => {
  if(err) console.error('subs, ' + msg);
  else    console.log(  'subs, ' + msg);
  if(spacing) fs.appendFileSync('srvr.log', '\n');
  fs.appendFileSync('srvr.log', 
          date.format(new Date(), 'MM/DD HH:mm:ss ') + msg + '\n')
}

