import * as emby from "./emby.js";
import * as tvdb from "./tvdb.js";
import * as srvr from "./srvr.js";

let allTvdb = null;

////////// Build seriesMap object from seriesMapIn array //////////
export function buildSeriesMap(seriesMapIn) {
  if (!seriesMapIn || seriesMapIn.length === 0) {
    return null;
  }
  
  const seriesMap = {};
  for (const season of seriesMapIn) {
    const [seasonNum, episodes] = season;
    const seasonMap = {};
    seriesMap[seasonNum] = seasonMap;
    for (const episode of episodes) {
      const [episodeNum, epiObj] = episode;
      seasonMap[episodeNum] = epiObj;
    }
  }
  
  return seriesMap;
}

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

////////// temp one-time mass operation //////////
export async function removeDontSavesFromTvdbJson() {
  allTvdb = await tvdb.getAllTvdb();
  Object.values(allTvdb).forEach(async (tvdb) => {
    await srvr.setTvdbFields(
      {name:tvdb.name, $delete:['dontSave'], dontSave:true});
  });
  await srvr.setTvdbFields({});
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
      await srvr.setTvdbFields(
              {name, $delete:['deleted'], dontSave:true});
    }
  });
  await srvr.setTvdbFields({});
}

////////// temp one-time mass operation //////////
export function listCountries(allShows) {
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
export function setAllFavs(allShows) {
  allShows.forEach(async (show) => {
    if(show.Id.startsWith("noemby-")) return;
    await emby.saveFav(show.Id, true);
    console.log('saved fav:', show.Name);
  });
}

////////// temp one-time mass operation //////////
export async function clrEndedContinues(allShows) {
  allTvdb = await tvdb.getAllTvdb();
  allShows.forEach(async (show) => {
    const tvdbData = allTvdb[show.Name];
    if(tvdbData.status == "Ended" && show.InContinue) {
      console.log('clr ended:', show.Name);
      await emby.saveContinue(show.Id, false);
    }
  });
}

////////// temp one-time mass operation //////////
export async function fixShowidInTvdbs(allShows) {
  console.log('fixShowidInTvdbs');
  allTvdb = await tvdb.getAllTvdb();
  let count = 0;
  Object.values(allTvdb).forEach(async (tvdb) => {
    const name = tvdb.name;
    const show = allShows.find((show) => show.Name == name);
    if(tvdb.deleted) return;
    if(!show) {
      console.log('no show for tvdb:', name, tvdb.deleted);
      return;
    }
    tvdb.showId = show.Id;
    await srvr.setTvdbFields({name, showId:show.Id});
    count++;
  });
  console.log(`fixed showId in ${count} tvdbs`);
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

////////// temp one-time mass operation //////////
export async function setAllNoEmbyTvdbIds(allShows) {
  allTvdb = await tvdb.getAllTvdb();
  allShows.forEach(async (show) => {
    if(show.Id.startsWith("noemby-")) {
      const tvdb = allTvdb[show.Name];
      if(!tvdb) return;
      delete show.tvdbId;
      show.TvdbId = tvdb.tvdbId;
      console.log('setting tvdbId:', show.Name, show.tvdbId);
      await srvr.addNoEmby(show);
    }
  });
}

////////// temp one-time mass operation (VERY SLOW) //////////
// export async function loadAllRemotes(allShows) {
//   let showIdx = 0;
//   const intvl = setInterval(async () => {
//     while(showIdx < allShows.length) {
//       if(showIdx % 10 == 0) 
//         console.log(new Date().toISOString(), 
//                   showIdx + ' of ' +allShows.length);
//       // if(Math.random() < 0.75) break;
//       const show = allShows[showIdx++];
//       const remotes = await tvdb.getRemotes(show);
//       if(!remotes) continue;
//       const [_remotes, cached] = remotes
//       if(cached) continue;
//       break;
//     }
//     if(showIdx == allShows.length) {
//       clearInterval(intvl);
//       console.log('load remotes done:', showIdx);
//     }
//   }, 45*1000);
// }

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

export function parseHumanSizeToBytes(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === 'number') return value;

  const s = String(value).trim();
  if (!s) return NaN;

  // Support formats like: "1.23 GB", "690 MB", "123 KB", "999 B", plus IEC variants.
  const m = s.match(/^([\d.]+)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)?$/i);
  if (!m) return NaN;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return NaN;

  const unit = String(m[2] || 'B').toUpperCase();
  const mul = {
    B: 1,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  };

  const factor = mul[unit] || 1;
  return n * factor;
}

export function fmtBytesSize(value) {
  if (value === undefined || value === null) return '';

  const bytes = (typeof value === 'string') ? parseHumanSizeToBytes(value) : Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) {
    // If it was a string but didn't match our parser, keep it as-is.
    return (typeof value === 'string') ? value : '';
  }

  // Requested formatting rules:
  // - 1.234 GB when size >= 1e9
  // - else 123 MB when size >= 1e7
  // - else 123 KB when size >= 1e4
  // - else 123 B
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(3)} GB`;
  if (bytes >= 1e7) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e4) return `${Math.round(bytes / 1e3)} KB`;
  return `${Math.round(bytes)} B`;
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
      
    case 'Finished': 
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
  }
  for(const condName in tmp) {
    if(cond.name == condName) {
      cond.filter = tmp[condName];
      return;
    }
  }
}

