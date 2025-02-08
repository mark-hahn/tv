import * as emby from "./emby.js";
import * as tvdb from "./tvdb.js";
import * as srvr from "./srvr.js";

let allTvdb = null;

////////// temp one-time mass operation //////////
export async function removeDeadShows(allShows) {
  allTvdb = await tvdb.getAllTvdb();
  let count = 0;
  for(let show of allShows) {
    try {
      const name = show.Name;
      console.log('checking:', name);
      const tvdbData= await allTvdb[show.Name];
      if(!tvdbData) continue;

      const {status, episodeCount, watchedCount} = tvdbData
      if(status != "Ended" || watchedCount < episodeCount) 
        continue;

      await srvr.deleteShowFromSrvr(show);
      await emby.deleteShowFromEmby(show);

      console.log('>>>> removed:', ++count, name);
    }
    catch(e) {
      console.error('removeDeadShows error:', e.message);
      return;
    }
  }
}

////////// temp one-time mass operation //////////
export async function setPickups(allShows) {
  allTvdb = await tvdb.getAllTvdb();
  let count = 0;
  for(let show of allShows) {
    try {
      const name = show.Name;
      const tvdbData= await allTvdb[show.Name];
      if(!tvdbData) continue;

      const {status} = tvdbData
      if( (status == 'Continuing' ||
            status == 'Upcoming') &&
          (show.Name.startsWith("noemby-") || 
           show.InToTry                    || 
           show.IsFavorite                 || 
           show.InLinda                    || 
           show.InMark)) {
        if(show.Pickup) continue;
        console.log('>>>> set pickup:', ++count, name);
        await srvr.addPickup(name)
      }
      else {
        if(!show.Pickup) continue;
        console.log('>>>> del pickup:', ++count, name);
        await srvr.delPickup(name)
      }
    }
    catch(e) {
      console.error('setPickups error:', e.message);
      return;
    }
  }
}

////////// temp one-time mass operation //////////
export async function removeNoMatchsFromTvdbJson() {
  allTvdb = await tvdb.getAllTvdb();
  Object.values(allTvdb).forEach(async (tvdb) => {
    if(tvdb?.remotes?.length === undefined) return;
    for(const remote of tvdb.remotes) {
      if(!remote?.url) continue;
      const remotes = tvdb.remotes.filter(
              (r) => r.url !== "no match");
      await srvr.setTvdbFields(
            {name:tvdb.name, remotes});
    }
  });
}

////////// adjustDeletedFlags //////////
export async function adjustDeletedFlags(allShows) {
  allTvdb = await tvdb.getAllTvdb();
  Object.values(allTvdb).forEach(async (tvdb) => {
    const name = tvdb.name;
    const haveShow = allShows.find(
                        (show) => show.Name == name);
    if(!haveShow && !tvdb.deleted) {
      console.log('setting deleted flag:', name);
      // await srvr.setTvdbFields(
      //         {name, deleted:fmtDate(), dontSave:true});
    }
    else if(!!haveShow && !!tvdb.deleted) {
      console.log('clearing deleted flag:', name);
      // await srvr.setTvdbFields(
      //         {name, $delete:['deleted'], dontSave:true});
    }
  });
  // srvr.setTvdbFields({});
}

////////// temp one-time mass operation //////////
export async function listCountries(allShows) {
  const countries = new Set();
  allShows.forEach(async (show) => {
    const tvdbData = await allTvdb[show.Name];
    if(tvdbData) {
      countries.add(tvdbData.originalCountry);
    }
  })
  setTimeout(() => {
    console.log('countries:', countries);
  }, 10000);
}

////////// temp one-time mass operation //////////
export async function setAllFavs(allShows) {
  allShows.forEach(async (show) => {
    if(show.Id.startsWith("noemby-")) return;
    await emby.saveFav(show.Id, true);
    console.log('saved fav:', show.Name);
  });
}

////////// temp one-time mass operation //////////
export async function setAllTvdbShowIds(allShows) {
  allShows.forEach(async (show) => {
    await srvr.setTvdbFields({
      name:   show.Name,
      showId: show.Id,
    });
  });
  await srvr.setTvdbFields({dontSave:false});
}

////////// temp one-time mass operation (VERY SLOW) //////////
export async function loadAllRemotes(allShows) {
  let showIdx = 0;
  const intvl = setInterval(async () => {
    while(showIdx < allShows.length) {
      if(showIdx % 10 == 0) 
        console.log(new Date().toISOString(), 
                  showIdx + ' of ' +allShows.length);
      // if(Math.random() < 0.75) break;
      const show = allShows[showIdx++];
      const remotes = await tvdb.getRemotes(show);
      if(!remotes) continue;
      const [_remotes, cached] = remotes
      if(cached) continue;
      break;
    }
    if(showIdx == allShows.length) {
      clearInterval(intvl);
      console.log('load remotes done:', showIdx);
    }
  }, 45*1000);
}

export function 
          dateWithTZ(date = new Date(), utcOut = false) {
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
  let date;
  if(dateIn === undefined) date = new Date();
  else if(dateIn instanceof Number) 
    date = new Date( dateIn + 
                (utcIn ? Date.getTimezoneOffset()*60*1000 : 0));
  else
     date = new Date(dateIn);
  const startIdx = includeYear ? 0 : 5;
  const str = dateWithTZ(date);
  const res = str.slice(startIdx, 10).replace(/^0/,' ');
  return res
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
      tmp.foreign  =  0;
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
      tmp.foreign  =  0;
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
      tmp.foreign  =  0;
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  1;
      tmp.foreign  =  0;
      tmp.totry    =  0;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  1;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;

    case 'To-Try': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.foreign  =  0;
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
      tmp.foreign  =  0;
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  1;
      tmp.foreign  =  0;
      tmp.totry    =  1;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  1;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;

    case 'Continue': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.foreign  =  0;
      tmp.totry    =  0;
      tmp.continue =  1;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  1;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;
      
    case 'Download': 
      tmp.unplayed =  0;
      tmp.gap      =  1;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.foreign  =  0;
      tmp.totry    = -1;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  0;
      tmp.favorite =  0;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  0;
      break;
      
    case 'Mark': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.foreign  =  0;
      tmp.totry    =  0;
      tmp.continue =  0;
      tmp.mark     =  1;
      tmp.linda    =  0;
      tmp.favorite = -1;
      tmp.ban      = -1;
      tmp.pickup   =  0;
      tmp.hasemby  =  1;
      break;

    case 'Linda': 
      tmp.unplayed =  1;
      tmp.gap      =  0;
      tmp.waiting  =  0;
      tmp.drama    =  0;
      tmp.foreign  =  0;
      tmp.totry    =  0;
      tmp.continue =  0;
      tmp.mark     =  0;
      tmp.linda    =  1;
      tmp.favorite = -1;
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

