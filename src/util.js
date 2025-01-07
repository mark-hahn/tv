export function fmtDate(dateStr, includeYear = true) {
  if(!dateStr) return "";
  const date     = dateStr ? new Date(dateStr) : new Date();
  const startIdx = includeYear ? 0 : 5;
  return date.toISOString().slice(startIdx,10).replace(/^0/,' ');
}

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

