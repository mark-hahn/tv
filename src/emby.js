import axios     from "axios"
import * as tvdb from "./tvdb.js";
import * as srvr from "./srvr.js";
import * as urls from "./urls.js";
import * as util from "./util.js";

const gapWorker = 
  new Worker(new URL('gap-worker.js', import.meta.url), 
              {type: 'module'});

const name      = "mark";
const pwd       = "90-MNBbnmyui";
const apiKey    = "1c399bd079d549cba8c916244d3add2b"
const markUsrId = "894c752d448f45a3a1260ccaabd0adff";
const authHdr   = `UserId="${markUsrId}", `                +
                  'Client="MyClient", Device="myDevice", ' +
                  'DeviceId="123456", Version="1.0.0"';
const pruneTvdb = (window.location.href.slice(-5) == 'prune');

let token    = '';
let cred     = null;
let allTvdb  = null;

////////////////////////  INIT  ///////////////////////

const getToken = async () => {
  const config = {
    method: 'post',
    url: "https://hahnca.com:8920" +
         "/emby/Users/AuthenticateByName" +
         `?api_key=${apiKey}`,
    headers: { Authorization: authHdr },
    data: { Username: name, Pw: pwd },
  };
  const embyShows = await axios(config);
  token = embyShows.data.AccessToken;
}

export async function init() {
  await getToken();
  cred = {markUsrId, token};
  urls.init(cred);
}

let rejects = null;
export const isReject = (name) => rejects.includes(name);

// load all shows from emby and server //////////
export async function loadAllShows() {
  allTvdb = await tvdb.getAllTvdb();

  const loadAllShowsStartTime = new Date().getTime();

  const embyPromise   = axios.get(
                        urls.showListUrl(cred, 0, 10000));
  const diskPromise   = srvr.getShowsFromDisk(); 
  const rejPromise    = srvr.getRejects();
  const pkupPromise   = srvr.getPickups();
  const noEmbyPromise = srvr.getNoEmbys();
  const gapPromise    = srvr.getGaps();

  const [embyShows, diskShows, 
         rejectsIn, pickups, noEmbys, gaps] = 
    await Promise.all([embyPromise, diskPromise, 
                       rejPromise, pkupPromise,
                       noEmbyPromise, gapPromise]);
  rejects = rejectsIn
  
  let shows = [];

////////// get shows from emby ////////////
// includes id, name, dates, haveShows, favorites, gaps, etc.
  for(let key in embyShows.data.Items) {
    let show = embyShows.data.Items[key];

    Object.assign(show, show.UserData);
    delete show.UserData;
    for(const date of ['DateCreated', 'PremiereDate']) {
      if(show[date]) show[date] = show[date].substring(0, 10);
    }
    const embyPath     = show.Path.split('/').pop();
    const showDateSize = diskShows[embyPath];
    if(!showDateSize) {
      show.NoFiles = true;
      show.Date = '2017-12-05';
      show.Size = 0;
    }
    else {
      const [date, size] = showDateSize;
      show.Date = date;
      show.Size = size;
    }
    // if(!show.DateCreated) show.DateCreated = show.Date;

    const gapData = gaps[show.Id];
    if(gapData) {
      Object.assign(show, gapData);
      delete gaps[show.Id];
    }

    const tvdbId = show?.ProviderIds?.Tvdb || show?.TvdbId;
    if(!tvdbId || tvdbId == '0') {
      console.error(`loadAllShows, no tvdbId:`, show.Name, {show});
      continue;
    }
    show.TvdbId = tvdbId;
    shows.push(show);
  } 

//////////  add noemby shows from srvr ////////////
  const prunedNoEmbyIds = [];
  for(const noEmbyShow of noEmbys) {
    const idx = shows.findIndex(
                  (show) => show.Name == noEmbyShow.Name);
    if(idx != -1) {
      // If the show now exists in Emby, preserve any collection flags
      // we tracked while it was a noemby show by copying them over and
      // writing them into the real Emby collections before deleting.
      try {
        const embyShow = shows[idx];
        const wantToTry    = !!noEmbyShow.InToTry;
        const wantContinue = !!noEmbyShow.InContinue;
        const wantMark     = !!noEmbyShow.InMark;
        const wantLinda    = !!noEmbyShow.InLinda;

        if (wantToTry) {
          embyShow.InToTry = true;
          await saveToTry(embyShow.Id, true);
        }
        if (wantContinue) {
          embyShow.InContinue = true;
          await saveContinue(embyShow.Id, true);
        }
        if (wantMark) {
          embyShow.InMark = true;
          await saveMark(embyShow.Id, true);
        }
        if (wantLinda) {
          embyShow.InLinda = true;
          await saveLinda(embyShow.Id, true);
        }
      } catch (e) {
        console.error('loadAllShows: upgrade noEmby -> Emby flag copy failed', noEmbyShow?.Name, e);
      }

      console.log('upgrading noEmby by deleting it:', 
                    noEmbyShow.Name);
      await srvr.delNoEmby(noEmbyShow.Name);
      prunedNoEmbyIds.push(noEmbyShow.Id);
      continue;
    }
    
    // Check if S01E01 is unaired in TVDB and set WaitStr
    try {
      const seriesMap = await tvdb.getSeriesMap(noEmbyShow);
      const s1 = seriesMap.find(([seasonNumber]) => seasonNumber === 1);
      if (s1) {
        const e1 = s1[1].find(([episodeNumber]) => episodeNumber === 1);
        const unaired = e1?.[1]?.unaired === true;
        if (unaired) {
          noEmbyShow.S1E1Unaired = true;
          const airDate = e1?.[1]?.aired;
          if (airDate) {
            // Format as {M/DD} matching getWaitStr format
            const dateStr = airDate.slice(5).replace(/^0/, ' ').trim();
            noEmbyShow.WaitStr = `{${dateStr}}`;
          }
        }
      }
    } catch (e) {
      console.error('loadAllShows: tvdb.getSeriesMap error for noemby', noEmbyShow.Name, e);
    }
    
    shows.push(noEmbyShow);
  }
  for(const prunedNoEmbyId of prunedNoEmbyIds) {
    const idx = noEmbys.findIndex(
        (noEmbyShow) => noEmbyShow.Id == prunedNoEmbyId);
    if(idx != -1) noEmbys.splice(idx, 1);
  }

//////////  mark tvdbs with no show as deleted ////////////
  for(const tvdb of Object.values(allTvdb)) {
    if(!tvdb.deleted) {
      const matchingShow = shows.find(
            (show) => show.Name == tvdb.name);
      if(matchingShow && !tvdb.showId) {
        const name   = matchingShow.Name;
        const showId = matchingShow.Id;
        console.log(
            `loadAllShows, tvdb has no showid and not deleted:`, 
               name, {show:matchingShow, tvdb});
        allTvdb[name] =
          await srvr.setTvdbFields({name, showId});
      }
      if(matchingShow) continue;
      console.log(`loadAllShows, !tvdb.deleted with no show:`,
                  tvdb.name, {tvdb});
      allTvdb[tvdb.name] = await srvr.setTvdbFields(
          {name:tvdb.name, deleted:util.fmtDate()});
    }
  }

//////////  create tvdbs ////////////
  if(!pruneTvdb) {
    for(const show of shows) {
      if(!show.TvdbId) {
        console.log(`loadAllShows, no tvdbId:`, show.Name, {show});
        continue;
      }
      const name = show.Name;
      let tvdb = allTvdb[name];
      if(!tvdb || tvdb.showId !== show.Id) {
        console.log(`loadAllShows creating/updating tvdb`, name);
        const epicounts = await getEpisodeCounts(show);
        const param = Object.assign({show}, epicounts);
        tvdb = await srvr.getNewTvdb(param);
      }
      let ratings = 0;
      for(const remote of tvdb.remotes) {
        if(remote.ratings) 
            ratings = remote.ratings;
      }
      show.DateCreated     = tvdb.added;
      show.TvdbId          = tvdb.tvdbId;
      show.OriginalCountry = tvdb.originalCountry;
      show.Ended           = (tvdb.status == 'Ended');
      show.Ratings         = ratings;
      allTvdb[name]        = tvdb;
    }
  }

//////////  pruneTvdb show tvdbs without a show  ////////////
  if(pruneTvdb) {
    const showsFromTvdb = [];
    for(const tvdb of Object.values(allTvdb)) {
      const showIdx = shows.findIndex(
                  (show) => show.Name === tvdb.name);
      if(showIdx !== -1) continue;
      const show = {
        Name:            tvdb.name,
        Id:              'noemby-' + Math.random(),
        TvdbId:          tvdb.tvdbId,     
        OriginalCountry: tvdb.originalCountry,
        Ended:          (tvdb.status == 'Ended'),
        Ratings:         tvdb.ratings,
      }
      showsFromTvdb.push(show);
    }
    shows = showsFromTvdb;
  }

////////  remove gaps with no matching show /////////
  let deletedGap = false;
  for(const gapId in gaps) {
    await srvr.delGap([gapId, false]);
    deletedGap = true;
  }
  if(deletedGap) await srvr.delGap([null, true]);

//////////  process toTry collection  ////////////
  const toTryRes = await axios.get(
        urls.collectionListUrl(cred, toTryCollId));
  const toTryIds = [];
  for(let tryEntry of toTryRes.data.Items)
       toTryIds.push(tryEntry.Id);
  for(let show of shows) {
    // noemby shows are not in Emby collections; keep server-stored flags.
    if (String(show?.Id || '').startsWith('noemby-')) continue;
    show.InToTry = toTryIds.includes(show.Id);
  }

//////////  process continue collection  ////////////
  const continueRes = await axios.get(
        urls.collectionListUrl(cred, continueCollId));
  const continueIds = [];
  for(let tryEntry of continueRes.data.Items)
       continueIds.push(tryEntry.Id);
  for(let show of shows) {
    if (String(show?.Id || '').startsWith('noemby-')) continue;
    show.InContinue = continueIds.includes(show.Id);
  }

//////////  process mark collection  ////////////
  const markRes = await axios.get(
        urls.collectionListUrl(cred, markCollId));
  const markIds = [];
  for(let tryEntry of markRes.data.Items)
       markIds.push(tryEntry.Id);
  for(let show of shows) {
    if (String(show?.Id || '').startsWith('noemby-')) continue;
    show.InMark = markIds.includes(show.Id);
  }

//////////  process linda collection  ////////////
  const lindaRes = await axios.get(
        urls.collectionListUrl(cred, lindaCollId));
  const lindaIds = [];
  for(let tryEntry of lindaRes.data.Items)
       lindaIds.push(tryEntry.Id);
  for(let show of shows) {
    if (String(show?.Id || '').startsWith('noemby-')) continue;
    show.InLinda = lindaIds.includes(show.Id);
  }

//////////  process rejects for usb ////////////
  for(let rejectName of rejects) {
    const matchingShow = 
          shows.find((show) => show.Name == rejectName);
    if(matchingShow) matchingShow.Reject = true;
  }

//////////  process pickups for usb ////////////
  for(let pickupName of pickups) {
    const show = shows.find((show) => show.Name == pickupName);
    if(show) show.Pickup = true;
  }

//////////  finished loadAllShows ////////////
  const elapsed = new Date().getTime() - loadAllShowsStartTime;
  console.log('all shows loaded, elapsed ms:', elapsed);
  return shows;
}

//////////// misc functions //////////////

export function startGapWorker(allShows, cb) {
  gapWorker.onerror = (err) => {
    console.error('Worker:', err.message);
  }
  const allShowsIdName = [];
  for(let show of allShows) {
    const id = show.Id;
    if(id.startsWith('noemby-')) {
      show.NotReady = true;
      continue;
    }
    allShowsIdName.push([id, show.Name]);
  }
  gapWorker.onmessage = cb;
  gapWorker.postMessage({cred, allShowsIdName});
}

export function startUpdateWorker(allShows, cb) {
  gapWorker.onerror = (err) => {
    console.error('Worker:', err.message);
  }
  const allShowsIdName = [];
  for(let show of allShows) {
    const id = show.Id;
    if(id.startsWith('noemby-')) {
      show.NotReady = true;
      continue;
    }
    allShowsIdName.push([id, show.Name]);
  }
  gapWorker.onmessage = cb;
  gapWorker.postMessage({cred, allShowsIdName});
}

const toTryCollId    = '1468316';
const continueCollId = '4719143';
const markCollId     = '4697672';
const lindaCollId    = '4706186';

export async function deleteShowFromEmby(show) {
  try {
    const url = urls.deleteShowUrl(cred, show.Id);
    const delRes = await axios.delete(url, {
      headers: {
        'X-Emby-Authorization': authHdr,
        'X-Emby-Token': cred.token
      }
    });
    const res = delRes.status;
    if(res != 204) {
      const err = 
        `unable to delete ${show.Name} from emby: ${delRes.data}`;
      console.error(err);
      return;
    }
    console.log("deleted show from emby:", show.Name);
  } catch (error) {
    const errData = error.response?.data || '';
    if (errData.includes('Directory not empty')) {
      const msg = `Cannot delete "${show.Name}" - directory still has files. Delete files from disk first.`;
      console.error(msg);
      alert(msg);
    } else {
      console.error('deleteShowFromEmby error:', error);
      console.error('Response data:', errData);
    }
    throw error;
  }
}

const deleteOneFile = async (path) => {
  if(!path) return;
  console.log('deleting file:', path);
  try {
    await srvr.deletePath(path);
  }
  catch (e) {
    console.error('deletePath:', path, e);
    throw e;
  }
}

// action from click on episode in map
export const editEpisode = async (seriesId, 
              seasonNumIn, episodeNumIn, delFile = false, setWatched = null) => {
  let lastWatchedRec = null;

  const seasonsRes = await axios.get(urls.childrenUrl(cred, seriesId));
  for(let key in seasonsRes.data.Items) {
    let   seasonRec    =  seasonsRes.data.Items[key];
    const seasonNumber = +seasonRec.IndexNumber;
    if(seasonNumber != seasonNumIn) continue;

    const seasonId    =  seasonRec.Id;
    const episodesRes = await axios.get(urls.childrenUrl(cred, seasonId));
    for(let key in episodesRes.data.Items) {
      const episodeRec     = episodesRes.data.Items[key];
      const episodeNumber  = +episodeRec.IndexNumber;
      const userData       = episodeRec?.UserData;
      const watched        = userData?.Played;

      if(episodeNumber != episodeNumIn) {
        if(watched) lastWatchedRec = episodeRec;
        continue;
      }

      if(delFile) {
        const path = episodeRec?.MediaSources?.[0]?.Path;
        try { await srvr.deletePath(path); }
        catch(e) { 
          console.error('deleteOneFile:', path, e);
          throw e;
         }
      }

      const episodeId = episodeRec.Id;
      userData.Played = setWatched !== null ? setWatched : !watched;
      if(!userData.LastPlayedDate)
          userData.LastPlayedDate = util.fmtDate();
      const url = urls.postUserDataUrl(cred, episodeId);
      const setDataRes = await axios({
        method: 'post',
        url:     url,
        data:    userData
      });
      // console.log("toggled watched", {
      //               episode: `S${seasonNumber}E${episodeNumber}`, 
      //               post_url: url,
      //               post_res: setDataRes
      //             });
    }
  }
}

// reset last Watched to first unwatched episode
export const setLastWatched = async (seriesId) => {
  let seasonNumber;
  let lastWatchedEpisodeRec = null;
  const seasonsRes = await axios.get(urls.childrenUrl(cred, seriesId));
seasonLoop: 
  for(let key in seasonsRes.data.Items) {
    let seasonRec      =  seasonsRes.data.Items[key];
    seasonNumber       = +seasonRec.IndexNumber;
    const seasonId     = +seasonRec.Id;
    const episodesRes  = 
            await axios.get(urls.childrenUrl(cred, seasonId));
    for(let key in episodesRes.data.Items) {
      const episodeRec = episodesRes.data.Items[key];
      const userData   = episodeRec?.UserData;
      const watched    = userData?.Played;
      if(watched) lastWatchedEpisodeRec = episodeRec;
      else 
        if(lastWatchedEpisodeRec) break seasonLoop;
    }
  }
  if(lastWatchedEpisodeRec) {
    console.log({lastWatchedEpisodeRec});
    const episodeId     =  lastWatchedEpisodeRec.Id;
    const episodeNumber = +lastWatchedEpisodeRec.IndexNumber;
    const userData      =  lastWatchedEpisodeRec?.UserData;

    userData.LastPlayedDate = util.fmtDate();
    const url = urls.postUserDataUrl(cred, episodeId);
    const setDateRes = await axios({
      method: 'post',
      url:     url,
      data:    userData
    });
    console.log("set lastPlayedDate", {
                  seasonNumber, episodeNumber,
                  post_res: setDateRes});
  }
}

export const getEpisodeCounts = async (show) => {
  const showId = show.Id;
  let seasonCount  = 0;
  let episodeCount = 0;
  let watchedCount = 0;
  if(show.Id.startsWith('noemby-')) 
    return {seasonCount, episodeCount, watchedCount};
  try {
    const seasonsRes = 
          await axios.get(urls.childrenUrl(cred, showId));
    for(let key in seasonsRes.data.Items) {
      seasonCount++;
      const seasonRec   =  seasonsRes.data.Items[key];
      const seasonId    =  seasonRec.Id;
      const episodesRes = 
              await axios.get(urls.childrenUrl(cred, seasonId));
      for(let key in episodesRes.data.Items) {
        episodeCount++;
        const episodeRec = episodesRes.data.Items[key];
        const userData   = episodeRec?.UserData;
        if(userData?.Played) watchedCount++;
      }
    }
  }
  catch(e) { 
    console.error('getEpisodeCounts error:', e);
    return {seasonCount:0, episodeCount:0, watchedCount:0};
  }
  return {seasonCount, episodeCount, watchedCount};
}

export const getSeriesMap = async (show, prune = false) => { 
  const seriesId  = show.Id;
  
  // If this is a noemby show (from web search), return empty map
  if (seriesId.startsWith('noemby-')) {
    return [];
  }
  
  const seriesMap = [];
  let pruning = prune;
  const seasonsRes = 
        await axios.get(urls.childrenUrl(cred, seriesId));
  for(let key in seasonsRes.data.Items) {
    let   seasonRec    =  seasonsRes.data.Items[key];
    let   seasonId     =  seasonRec.Id;
    const seasonNumber = +seasonRec.IndexNumber;
    const unairedObj   = {};
    const unairedRes = 
          await axios.get(urls.childrenUrl(cred, seasonId, true));
    for(let key in unairedRes.data.Items) {
      const episodeRec    = unairedRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      unairedObj[episodeNumber] = true;
    }
    const episodes    = [];
    const episodesRes = 
          await axios.get(urls.childrenUrl(cred, seasonId));
    for(let key in episodesRes.data.Items) {
      let   episodeRec    =  episodesRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      if(episodeNumber === undefined) continue;

      const path    =  episodeRec?.MediaSources?.[0]?.Path;
      const played  = !!episodeRec?.UserData?.Played;
      const avail   =   episodeRec?.LocationType != "Virtual";
      const unaired = !!unairedObj[episodeNumber];

      if(avail && !path) {
        console.error('avail without path', 
                 `S${seasonNumber}E${episodeNumber}`);
        continue;
      }

      let deleted = false;
      if(pruning) {
        if(!played && avail) pruning = false;
        else {
          await deleteOneFile(path);
          deleted = avail;     // set even if error
        }
      }

      const error = 
          (seasonNumber  == show.WatchGapSeason  &&
           episodeNumber == show.WatchGapEpisode &&
                            show.WatchGap) ||
          (seasonNumber  == show.FileGapSeason  &&
           episodeNumber == show.FileGapEpisode &&
              show.FileGap);

      const noFileVal = !path;  // noFile is true when there's no path
      if (show.Name === 'Pluribus' && unaired) {
        console.log(`Pluribus S${seasonNumber}E${episodeNumber}: path=${path}, unaired=${unaired}, noFile=${noFileVal}, played=${played}, avail=${avail}`);
      }

      episodes.push([episodeNumber, 
          {error, played, avail, noFile: noFileVal, 
            unaired, deleted, path}]); 
    }
    seriesMap.push([seasonNumber, episodes]);
  }
  return seriesMap;
}

export async function saveFav(id, fav) {
  const config = {
    method: (fav ? 'post' : 'delete'),
    url:     urls.favoriteUrl(cred, id),
  };
  let favRes = await axios(config);
  if(favRes.status != 200) 
      throw new Error('unable to save favorite');
}

export async function saveToTry(id, inToTry) {
  const config = {
    method: (inToTry ? 'post' : 'delete'),
    url:     urls.collectionUrl(cred, id, toTryCollId),
  };
  let toTryRes;
  try { toTryRes = await axios(config); }
  catch (e) {  
    console.error(
        `saveToTry, id:${id}, inToTry:${inToTry}`);
    throw e; 
  } 
  if(toTryRes.status !== 204) {
    const err = 'unable to save totry' + toTryRes.data;
    console.error(err);
    throw new Error(err);
  }
}

export async function saveContinue(id, inContinue) {
  const config = {
    method: (inContinue ? 'post' : 'delete'),
    url:     urls.collectionUrl(cred, id, continueCollId),
  };
  let continueRes;
  try { continueRes = await axios(config); }
  catch (e) {  
    console.error(
        `saveContinue, id:${id}, inContinue:${inContinue}`);
    throw e; 
  } 
  if(continueRes.status !== 204) {
    const err = 'unable to save Continue' + continueRes.data;
    console.error(err);
    throw new Error(err);
  }
}

export async function saveMark(id, inMark) {
  const config = {
    method: (inMark ? 'post' : 'delete'),
    url:     urls.collectionUrl(cred, id, markCollId),
  };
  let markRes;
  try { markRes = await axios(config); }
  catch (e) {  
    console.error(
        `saveMark, id:${id}, inMark:${inMark}`);
    throw e; 
  } 
  if(markRes.status !== 204) {
    const err = 'unable to save Mark ' + markRes.data;
    console.error(err);
    throw new Error(err);
  }
}

export async function saveLinda(id, inLinda) {
  const config = {
    method: (inLinda ? 'post' : 'delete'),
    url:     urls.collectionUrl(cred, id, lindaCollId),
  };
  let lindaRes;
  try { lindaRes = await axios(config); }
  catch (e) {  
    console.error(
        `saveLinda, id:${id}, inLinda:${inLinda}`);
    throw e; 
  } 
  if(lindaRes.status !== 204) {
    const err = 'unable to save Linda' + lindaRes.data;
    console.error(err);
    throw new Error(err);
  }
}

export const createNoemby = async (show) => {
  const dateStr = util.fmtDate();
  Object.assign(show, {
    Id: "noemby-" + Math.random(),
    DateCreated: dateStr, 
    Date: dateStr,
    NotReady: true,
    Seasons: [],
    InToTry: true,
  });
  await srvr.addNoEmby(show);
  return show;
}

export const deleteNoemby = async (name) => {
  console.log('deleteNoemby:', name);
  await srvr.delNoEmby(name);
}

export const startStop = async (show, episodeId, watchButtonTxt) => {
  console.log('startStop:', show, episodeId, watchButtonTxt);
  const devices = await srvr.getDevices();
  for(const device of devices) {
    const {deviceName, sessionId} = device;
    if(watchButtonTxt.startsWith('Stop')) {
      const buttonDeviceName = watchButtonTxt.split(' ')[1];
      if(buttonDeviceName != deviceName) continue;
      const {url, body} = urls.stopUrl(sessionId);
      await axios({method: 'post', url, data: body});
      console.log(`stopped1 ${deviceName}`);
      setTimeout(async () => {
        await axios({method: 'post', url, data: body});
        console.log(`stopped2 ${deviceName}`);
      }, 1000);
      return;
    }
    else {
      const buttonDeviceName = watchButtonTxt.split(' ')[2];
      if(buttonDeviceName != deviceName) continue;
      const {url, body} = urls.playUrl(sessionId, episodeId);
      await axios({method: 'post', url, data: body});
      console.log(`playing1 ${show.Name} on  ${deviceName}`);
      setTimeout(async () => {
        await axios({method: 'post', url, data: body});
        console.log(`playing2 ${show.Name} on  ${deviceName}`);
      }, 1000);
      return;
    }
  }
}

export const afterLastWatched = async (showId) => {
  if(showId.startsWith('noemby-')) 
    return {status: 'noemby'};
  const seasonsRes = 
        await axios.get(urls.childrenUrl(cred, showId));
  const seasonItems = seasonsRes.data.Items;
  for(let key in seasonItems) {
    let   seasonRec    = seasonItems[key];
    const seasonNumber = seasonRec.IndexNumber;
    const seasonId     = seasonRec.Id;
    const unairedObj = {};
    const unairedRes = await axios.get(
              urls.childrenUrl(cred, seasonId, true));
    for(let key in unairedRes.data.Items) {
      const episode       = unairedRes.data.Items[key];
      const episodeNumber = +episode.IndexNumber;
      unairedObj[episodeNumber] = true;
    }
    const episodesRes  = 
           await axios.get(urls.childrenUrl(cred, seasonId));
    const episodeItems = episodesRes.data.Items;
    for(let key in episodeItems) {
      const episodeRec = episodeItems[key];
      const userData   = episodeRec.UserData;
      const watched    = userData.Played;
      if(watched) continue;
      const episodeNumber = episodeRec.IndexNumber;
      const episodeId     = episodeRec.Id;
      const haveFile      = (episodeRec.LocationType != "Virtual");
      const unaired       = !!unairedObj[episodeNumber];
      return {seasonNumber, episodeNumber, episodeId, 
              status: unaired ? 'unaired' :
                    (haveFile ? 'ok' : 'missing')};
    }
  }
  return {status: 'allWatched'};
}

export const refreshLib = async () => {
  try {
    await axios({
      method: 'post',
      url: `https://hahnca.com:8920/emby/Library/Refresh?api_key=${apiKey}`
    });

    const tasksRes = await axios({
      method: 'get',
      url: `https://hahnca.com:8920/emby/ScheduledTasks?api_key=${apiKey}`
    });

    const tasks = Array.isArray(tasksRes?.data) ? tasksRes.data : [];
    const isLibraryRefreshTask = (t) => {
      const n = String(t?.Name || '').toLowerCase();
      // Emby task names vary a bit across versions/translations.
      // Keep this intentionally broad but scoped to "library" + (scan|refresh).
      if (!n.includes('library')) return false;
      if (n.includes('scan') || n.includes('refresh')) return true;
      // Common variants seen in some builds.
      return /scan\s+media\s+library|refresh\s+media\s+library|scan\s+library|refresh\s+library/.test(n);
    };

    const task = tasks.find(isLibraryRefreshTask);
    if (!task?.Id) return { status: 'notask' };
    return { status: 'hasTask', taskId: task.Id };
  } catch (e) {
    return { status: e?.message || String(e) };
  }
};

export const createShowFolderAndRefreshEmby = async ({
  showName,
  tvdbId,
  seriesMapSeasons,
  tvdbData,
  onStatus,
  createTimeoutMs = 15000,
  refreshTimeoutMs = 120000,
} = {}) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  const withTimeout = async (promise, ms, label) => {
    const timeoutMs = Math.max(0, Number(ms) || 0);
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(t);
    }
  };

  const nameStr = String(showName || '').trim();
  const tvdbIdStr = String(tvdbId || '').trim();
  const hasTvdbData = !!tvdbData && typeof tvdbData === 'object' && Object.keys(tvdbData).length > 0;
  const seasons = Array.isArray(seriesMapSeasons)
    ? seriesMapSeasons
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b)
    : [];

  if (!nameStr) return { createdFolder: false, status: 'badargs', err: 'missing showName' };
  if (!tvdbIdStr) return { createdFolder: false, status: 'badargs', err: 'missing tvdbId' };
  if (!hasTvdbData) return { createdFolder: false, status: 'badargs', err: 'missing tvdbData' };

  let createdFolder = false;

  try {
    if (typeof onStatus === 'function') onStatus('Creating folder...');
    await withTimeout(
      srvr.createShowFolder({ showName: nameStr, tvdbId: tvdbIdStr, seriesMapSeasons: seasons, tvdbData }),
      createTimeoutMs,
      'createShowFolder'
    );
    createdFolder = true;
  } catch (e) {
    return { createdFolder: false, status: 'createfailed', err: e?.message || String(e) };
  }

  // Refresh Emby so the new folder gets scanned. Ignore refresh errors, but report them.
  let refreshRes = null;
  try {
    if (typeof onStatus === 'function') onStatus('Refreshing Emby...');
    refreshRes = await refreshLib();
    if (refreshRes?.status === 'hasTask' && refreshRes?.taskId) {
      const startMs = Date.now();
      while (Date.now() - startMs < refreshTimeoutMs) {
        const st = await withTimeout(taskStatus(refreshRes.taskId), 15000, 'emby task status');
        if (st?.status !== 'refreshing') break;
        await sleep(2000);
      }
    }
  } catch (e) {
    return {
      createdFolder: true,
      status: 'refreshfailed',
      err: e?.message || String(e),
      refreshRes,
    };
  }

  return { createdFolder: true, status: 'ok', refreshRes };
};

export const taskStatus = async (taskId) => {
  try {
    const tasksRes = await axios({
      method: 'get',
      url: `https://hahnca.com:8920/emby/ScheduledTasks?api_key=${apiKey}`
    });

    const tasks = Array.isArray(tasksRes?.data) ? tasksRes.data : [];
    const task = tasks.find((t) => String(t?.Id) === String(taskId));
    if (!task) return { status: 'refreshdone' };

    const stateRaw = String(task?.State || task?.Status || '').trim();
    const state = stateRaw.toLowerCase();
    const progressNum = Number(task?.CurrentProgressPercentage);
    const hasProgress = Number.isFinite(progressNum);

    if (hasProgress && progressNum >= 100) return { status: 'refreshdone' };
    if (state && state !== 'running') return { status: 'refreshdone' };

    return {
      status: 'refreshing',
      taskStatus: stateRaw,
      progress: hasProgress ? progressNum : undefined
    };
  } catch (e) {
    return { status: e?.message || String(e) };
  }
};
