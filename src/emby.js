import axios     from "axios"
import * as tvdb from "./tvdb.js";
import * as srvr from "./srvr.js";
import * as urls from "./urls.js";
import * as util from "./util.js";

const seasonsWorker = 
  new Worker(new URL('gap-worker.js', import.meta.url), 
              {type: 'module'});

const name      = "mark";
const pwd       = "90-MNBbnmyui";
const apiKey    = "1c399bd079d549cba8c916244d3add2b"
const markUsrId = "894c752d448f45a3a1260ccaabd0adff";
const authHdr   = `UserId="${markUsrId}", `                +
                  'Client="MyClient", Device="myDevice", ' +
                  'DeviceId="123456", Version="1.0.0"';

let token   = '';
let cred    = null;

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

// load all shows from emby and server //////////

export async function loadAllShows(gapCache) {
  console.log('entering loadAllShows');
  const time1 = new Date().getTime();

  const listPromise   = axios.get(
                        urls.showListUrl(cred, 0, 10000));
  const seriesPromise = srvr.getAllShows(); 
  const waitPromise   = srvr.getBlockedWaits();
  const rejPromise    = srvr.getRejects();
  const pkupPromise   = srvr.getPickups();
  const noEmbyPromise = srvr.getNoEmbys();
  const gapPromise    = srvr.getGaps();

  const [embyShows, srvrShows, blockedWaitShows, 
          rejects, pickups, noEmbys, gaps] = 
    await Promise.all([listPromise, seriesPromise, 
                       waitPromise, rejPromise, pkupPromise, 
                       noEmbyPromise, gapPromise]);
  const shows = [];

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
    const showDateSize = srvrShows[embyPath];
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

    if(!show.DateCreated) show.DateCreated = show.Date;

    const gapData = gaps[show.Id];
    if(gapData) {
      Object.assign(show, gapData);
      delete gaps[show.Id];
    }
    shows.push(show);
  }

////////  remove gaps with no matching show /////////
  for(const gapId in gaps) {
    await srvr.delGap(gapId);
  }

//////////  add noemby shows from srvr ////////////
  for(const noEmbyShow of noEmbys) {
    const idx = shows.findIndex(
                  (show) => show.Name == noEmbyShow.Name);
    if(idx != -1) {
      await srvr.delNoEmby(noEmbyShow.Name);
      continue;
    }
    shows.push(noEmbyShow);
  }

//////////  process blockedWaitShows from srvr ////////////
  for(let blockedWaitName of blockedWaitShows) {
    const i = shows.findIndex(
                (show) => show.Name == blockedWaitName);
    if(i > -1) {
      const show = shows[i];
      show.WaitStr = await tvdb.getWaitStr(show);
    }
    else {
      console.log('no show, deleting from blockedWaitShows list:',   
                   blockedWaitName);
      await srvr.delBlockedWait(blockedWaitName);
    }
  }

//////////  process toTry collection  ////////////

  const toTryRes = await axios.get(
        urls.collectionListUrl(cred, toTryCollId));
  const toTryIds = [];
  for(let tryEntry of toTryRes.data.Items)
       toTryIds.push(tryEntry.Id);
  for(let show of shows)
       show.InToTry = toTryIds.includes(show.Id);

//////////  process continue collection  ////////////

  const continueRes = await axios.get(
        urls.collectionListUrl(cred, continueCollId));
  const continueIds = [];
  for(let tryEntry of continueRes.data.Items)
       continueIds.push(tryEntry.Id);
  for(let show of shows)
       show.InContinue = continueIds.includes(show.Id);

//////////  process mark collection  ////////////

  const markRes = await axios.get(
        urls.collectionListUrl(cred, markCollId));
  const markIds = [];
  for(let tryEntry of markRes.data.Items)
       markIds.push(tryEntry.Id);
  for(let show of shows)
       show.InMark = markIds.includes(show.Id);

//////////  process linda collection  ////////////

  const lindaRes = await axios.get(
        urls.collectionListUrl(cred, lindaCollId));
  const lindaIds = [];
  for(let tryEntry of lindaRes.data.Items)
       lindaIds.push(tryEntry.Id);
  for(let show of shows)
       show.InLinda = lindaIds.includes(show.Id);

//////////  process rejects for usb ////////////

  for(let rejectName of rejects) {
    const matchingShow = 
          shows.find((show) => show.Name == rejectName);
    if(matchingShow) {
      matchingShow.Reject = true;
      continue;
    }
    const date = '2001-01-01';
    const rejShow = {
      Name: rejectName,
      Id: "noemby-" + Math.random(),
      DateCreated: date,
      Waiting: false,
      WatchGap: false,
      Missing: false,
      WaitStr: '',
      NotReady: true,
      InToTry: false,
      InContinue: false,
      InMark: false,
      InLinda: false,
      Reject: true,
      Pickup: false,
      Date: date,
      Size: 0,
    };
    shows.push(rejShow);
  }

//////////  process pickups for usb ////////////

  for(let pickupName of pickups) {
    const show = shows.find((show) => show.Name == pickupName);
    if(show) show.Pickup = true;
  }

  const elapsed = new Date().getTime() - time1;
  console.log('all shows loaded, elapsed:', elapsed);

  // console.log('shows:', shows);
  return {shows, blockedWaitShows};
}


//////////// misc functions //////////////

export function startWorker(allShows, cb) {
  seasonsWorker.onerror = (err) => {
    console.error('Worker:', err.message);
  }
  const allShowsIdName = [];
  for(let show of allShows) {
    const id = show.Id;
    if(id.startsWith('noemby-')) continue;
    allShowsIdName.push([id, show.Name]);
  }
  seasonsWorker.onmessage = cb;
  seasonsWorker.postMessage({cred, allShowsIdName});
}

const toTryCollId    = '1468316';
const continueCollId = '4719143';
const markCollId     = '4697672';
const lindaCollId    = '4706186';

export async function deleteShowFromEmby(show) {
  const delRes = await axios.delete(
           urls.deleteShowUrl(cred, show.Id));
  const res = delRes.status;
  if(res != 204) {
    const err = 
      `unable to delete ${show.Name} from emby: ${delRes.data}`;
    console.error(err);
    return;
  }
  console.log("deleted show from emby:", show.Name);
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
              seasonNumIn, episodeNumIn, delFile = false) => {
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
      userData.Played = !watched;
      if(!userData.LastPlayedDate)
          userData.LastPlayedDate = util.fmtDate(0);
      const url = urls.postUserDataUrl(cred, episodeId);
      const setDataRes = await axios({
        method: 'post',
        url:     url,
        data:    userData
      });
      console.log("toggled watched", {
                    episode: `S${seasonNumber}E${episodeNumber}`, 
                    post_url: url,
                    post_res: setDataRes
                  });
    }
  }
}

// get currently watching show
export const getCurrentlyWatching = async (player='roku') => {
  const url = urls.watchingUrl(player);
  const res = await axios.get(url);
  const nowPlaying = res.data[0].NowPlayingItem;
  if(!nowPlaying) {
    // console.log(`Watching on ${player}: nothing`);
    return null;
  }
  const showName = nowPlaying.SeriesName;
  // console.log(`Watching on ${player}: ${showName}`);
  return showName;
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

    userData.LastPlayedDate = util.fmtDate(0);
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

export const getSeasonCount = async (show) => {
  const seriesId = show.Id;
  let seasonsRes;
  try {
    seasonsRes = 
          await axios.get(urls.childrenUrl(cred, seriesId));
    return seasonsRes.data.Items.length;
  }
  catch(e) { 
    console.error('getSeasonCount:', e);
    return 0;
  }
}

export const getSeriesMap = async (show, prune = false) => { 
  const seriesId  = show.Id;
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

      // console.log({episodeRec});

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
          (seasonNumber  == show.GapSeason  &&
           episodeNumber == show.GapEpisode &&
          (show.WatchGap || show.Missing || show.Waiting));

      episodes.push([episodeNumber, 
          {error, played, avail, noFile:!path && !unaired, 
            unaired, deleted}]); 
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

export const deleteNoemby = async (name) => {
  console.log('deleteNoemby:', name);
  await srvr.delNoEmby(name);
}
