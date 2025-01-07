function fmtDateWithTZ(date, utcOut = false) {
  let year, month, day;
  if(utcOut) {
    year = date.getUTCFullYear();
    month = String(date.getUTCMonth() + 1).padStart(2, '0');
    day = String(date.getUTCDate()).padStart(2, '0');
  } else {
    year = date.getFullYear();
    month = String(date.getMonth() + 1).padStart(2, '0');
    day = String(date.getDate()).padStart(2, '0');
  }
  return `${year}-${month}-${day}`;
}

export function fmtDate(dateIn, includeYear = true, utcIn = false) {
  if(dateIn === '' || dateIn === undefined) return "";
  let date;
  if(dateIn === 0) date = new Date();
  else if(dateIn instanceof Number) 
     date = new Date( dateIn + 
                (utcIn ? Date.getTimezoneOffset()*60*1000 : 0));
  else
     date = new Date(dateIn); // strings always local

  const isoStr = date.toISOString();
  const locStr = fmtDateWithTZ(date);
  const utcStr = fmtDateWithTZ(date, true);

  if(dateIn === '2024-05-09') 
    console.log('-------- 2024-05-09 fmtDate ---------', 
                {dateIn, isoStr, locStr, utcStr});

  const startIdx = includeYear ? 0 : 5;
  const str = fmtDateWithTZ(date);
  const res = str.slice(startIdx, 10).replace(/^0/,' ');
  // console.log(`fmtDate: ${dateStr}, ${res}`);
  return res
}
// {
//     "dateStr": "2024-05-09",
//     "isoStr": "2024-05-09T00:00:00.000Z",
//     "locStr": "2024-05-08",
//     "utcStr": "2024-05-09"
// }

export function fmtSize(show) {
  if(show.Id.startsWith("noemby-")) return "";
  const size = show.Size;
  if (size < 1e3) return size;
  if (size < 1e6) return Math.round(size / 1e3) + "K";
  if (size < 1e9) return Math.round(size / 1e6) + "M";
                  return Math.round(size / 1e9) + "G";
}

export function setCondFltr(cond, fltrChoice) {
  let tmp = {};
  switch (fltrChoice) {
    case 'All': 
      tmp.unplayed =  0;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.totry    =  0;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  0;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  0;
      break;

    case 'Ready': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.totry    =  0;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  1;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;

    case 'Drama': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  1;
      tmp.totry    =  0;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  0;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;

    case 'To-Try': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.totry    =  1;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  0;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;

    case 'Try Drama': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  1;
      tmp.totry    =  1;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  0;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;

    case 'Continue': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.totry    =  0;
      tmp.continue =  1;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  1;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;

    case 'Mark': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.totry    =  0;
      tmp.continue =  0;
      tmp.mark     =  1;
      tmp.linda    =  0;
      tmp.favorite =  0;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;

    case 'Linda': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.totry    =  0;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  1;
      tmp.favorite =  0;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;
  }
  for(const condName in tmp) {
    if(cond.name == condName) {
      cond.filter = tmp[condName];
      return;
    }
  }
}

