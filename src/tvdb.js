import fs             from "fs";
import fetch          from 'node-fetch';
import * as urls      from "./urls.js";
import {rottenSearch} from './rotten.js';
import * as util      from "./util.js";
const {log, start, end} = util.getLog('tvdb');

const UPDATE_DATA = true;

const allTvdb = 
      util.jParse(fs.readFileSync('data/tvdb.json', 'utf8'));

///////////// get theTvdbToken //////////////
// this is a duplicate of the client
// both access tvdb.com independently
let theTvdbToken = null;
let gotTokenTime = 0;
const getTheTvdbToken = async () => {
  const loginResp = await fetch(
    'https://api4.thetvdb.com/v4/login', 
    { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
            "apikey": "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df",
            "pin":    "HXEVSDFF"
        })
    }
  );
  if (!loginResp.ok) {
    log('err', `FATAL: TvDbToken Response: ${loginResp.status}`);
    process.exit();
  }
  const loginJSON = await loginResp.json();
  theTvdbToken = loginJSON.data.token;
  gotTokenTime = Date.now();
}


///////////////////// GET REMOTES ///////////////////////

let cacheName = null;
let cacheJson;

const getUrlAndRatings = async (type, url, name) => {
  // log('getUrlAndRatings', {type, url, name});

  let html, json;

  if ((type == 18 || type == 7) && cacheName) json = cacheJson;
  else {
    let resp = await fetch(url);
    if (!resp.ok) {
      log('err', `getUrlAndRatings fetch error: ${
                    JSON.stringify({type, url, name})}, ${resp.status}`);
      return null;
    }
    if (type == 18 || type == 7) json = await resp.json();
    else html = (await resp.text()).replaceAll(/\r?\n/gm, "")
                                   .replaceAll(/\s+/gm, " ");
  }

  if (type == 18 || type == 7) {
    cacheName = name;
    cacheJson = json;
  }
  else cacheName = null;

  let idFnameParam;
  switch (+type) {
    case 2:  // IMDB
      // log('samples/imdb-page.html');
      // await util.writeFile('samples/imdb-page.html', html);
      idFnameParam = /aggregate-rating__score.*?>([\d.]+)</i.exec(html);
      if(idFnameParam === null) return {ratings:null};
      return {ratings: idFnameParam[1]};

    case 7:  // reddit
      // fs.writeFileSync(`samples/reddit-${name}.json`, 
      //                   JSON.stringify(json, null, 2));
      const allItems    = Object.values(json.items || {});
      const redditItems = allItems.filter(
                               item => item.displayLink == 'www.reddit.com');
      if (!redditItems || redditItems.length === 0) return null;
      // for(const item of redditItems) {
      //   log("redditItem:", name, item.link);
      // }
      return {url: redditItems[0].link};

    case 18:  // wikipedia
      // fs.writeFileSync(`samples/google-${name}.json`, 
      //                   JSON.stringify(json, null, 2));
      const items = Object.values(json.items || {});
      const wikiItem = items.find(
                             item => item.displayLink == 'en.wikipedia.org');
      if (!wikiItem) return null;
      // log("wikiItem:", name, wikiItem.link);
      return {url: wikiItem.link};

    default: return 'getUrlAndRatings invalid type: ' + type;
  }
}


///////////// get remote (name, url, & ratings) //////////////

const getRemote = async (id, type, showName) => {
  let url     = null;  
  let ratings = null;
  let urlRatings, name, escShow;
  
  switch (type) {
    case 2:  
      name = 'IMDB';
      url  = `https://www.imdb.com/title/${id}`;
      urlRatings = await getUrlAndRatings(2, url, name);
      ratings    = urlRatings?.ratings;
      break;

    case 4:  name = 'Official Website'; url = id; break;

    case 7:
      name = 'Reddit';
      escShow = encodeURIComponent(showName);
      urlRatings = await getUrlAndRatings(7,
        `https://www.googleapis.com/customsearch/v1?` +
        `key=AIzaSyDSdr8Z26vDP4V5J_sEyXCH4s8O56FyfDc&` +
        `cx=b59f40d0c17b54ff1&q=${escShow}%20tv%20show`, showName);
      url = urlRatings?.url;
      break;
      
    // case 8:   url = id; name = 'Instagram'; break;
    // case 9:   url = `https://www.instagram.com/${id}`; break;
    // case 11:  url = `https://www.youtube.com/channel/${id}`; break;
    // case 12: name = 'The Movie DB';
    //           url = `https://www.themoviedb.org/tv/${id}` +
    //                 `?language=en-US`;
    //          break;
    // case 13: name = 'EIDR'; continue;

    case 18: 
      name = 'Wikipedia';
      escShow    = encodeURIComponent(showName);
      urlRatings = await getUrlAndRatings(18, 
                    `https://www.googleapis.com/customsearch/v1?`  + 
                    `key=AIzaSyDSdr8Z26vDP4V5J_sEyXCH4s8O56FyfDc&` + 
                    `cx=b59f40d0c17b54ff1&q=${escShow}%20tv%20show`, showName);
      url = urlRatings?.url;
      break;

    // case 19: url = `https://www.tvmaze.com/shows/${id}`; break;

    case 99:  // rotten tomatoes
      name = 'Rotten';
      urlRatings = await rottenSearch(showName);
      if(!urlRatings) return null;
      // log("getRemote rottenSearch:", urlRatings);
      url     = urlRatings.url;
      ratings = urlRatings.criticsScore + '/' + urlRatings.audienceScore;
      break;

    default: return null;
  }
  
  if(!url) {
    log(`getRemote, no url: ${name}`);
    return null;
  }
  // log(`getRemote`, {name, url, ratings});
  return {name, url, ratings};
}

///////////// get remotes  //////////////
// use tvdb remotes data to find complete remote data
const getRemotes = async (show, tvdbRemotes) => {
  const name          = show.Name;
  const showId        = show.Id;
  const remotes       = [];

  if(showId && !showId.startsWith("noemby-")) 
    remotes.push({name:'Emby', url: urls.embyPageUrl(showId)});

  const rottenRemote = await getRemote(null, 99, name);
  if(rottenRemote) {
    if(rottenRemote.ratings) rottenRemote.name += " (" + rottenRemote.ratings + ")";
    remotes.push(rottenRemote);
  }

  const encoded = encodeURI(name).replaceAll('&', '%26');
  const url = `https://www.google.com/search` +
              `?q=${encoded}%20tv%20show`;
  remotes.push({name:'Google', url});

  const wikiRemote = await getRemote(null, 18, name);
  if (wikiRemote) remotes.push({name: 'Wikipedia', url: wikiRemote.url});

  const redditRemote = await getRemote(null, 7, name);
  if (redditRemote) remotes.push({name: 'Reddit', url: redditRemote.url});

  const remotesByName = {};
  for(const tvdbRemote of tvdbRemotes) {
    if(tvdbRemote.type == 18) continue;
    const remote = await getRemote(
            tvdbRemote.id, tvdbRemote.type, tvdbRemote.sourceName);
    if(remote && remote.url != "no match") {
      if(!remote.ratings) delete remote.ratings;
      remotesByName[remote.name] = remote;
    }
  }

  const imdbRemote = remotesByName["IMDB"];
  if(imdbRemote) {
    imdbRemote.name += (imdbRemote.ratings) ?
                  ' (' + imdbRemote.ratings + ')' : '';
    remotes.push(imdbRemote);
  } 

  for(const [name, remote] of Object.entries(remotesByName)) {
    if(name !== "IMDB" && name !== "Rotten")
      remotes.push(remote);
  }

  return remotes;
}

//////////// GET TVDB DATA //////////////
// fetch data from tvdb.com
// create tvdbData object
 // update allTvdb & tvdb.json
const getTvdbData = async (paramObj, resolve, _reject) => {
  const {show, deleted,
         seasonCount, episodeCount, watchedCount} = paramObj;
  const name   = show.Name;
  if(deleted) {
    // this shouldn't happen, deleteds filter before here
    log('getTvdbData:', name, 'is deleted, skipping tvDb refresh');
    resolve(name);
    return;
  }
  const showId = show.Id;
  const tvdbId = show.TvdbId;
  if(!tvdbId) {
    log('err', 'getTvdbData no tvdbId:', show);
    resolve(name);
    return;
  }
  let extRes, extUrl;
  try{
    extUrl = 
      `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
    extRes = await fetch(extUrl,
                  {headers: {
                      'Content-Type': 'application/json',
                        Authorization:'Bearer ' + theTvdbToken
                  }});
    if (!extRes.ok) {
      log('err', `getTvdbData error, extended status:`, 
                        name, {extUrl}, JSON.stringify(extRes, null, 2));
      resolve(name);
      return;
    }
  } catch(err) {  
    log('err', 'getTvdbData extended catch error:', name, 
                      {extUrl, extRes, err});
    resolve(name);
    return;
  }
  const extResObj = await extRes.json();
  const {firstAired, lastAired:lastAiredIn, image, score,
         overview, remoteIds, averageRuntime,
         originalCountry, originalLanguage, 
         originalNetwork:originalNetworkIn,
         status:statusIn}      = extResObj.data;
  let lastAired = lastAiredIn ?? firstAired;
  lastAired = lastAired ?? '';
  let originalNetwork = originalNetworkIn?.name ?? '';
  const status = statusIn.name; // e.g. Ended

  // get remote data, e.g. IMDB for tvdb record
  // remoteIds come from tvdb
  const remotes = await getRemotes(show, remoteIds);
  const saved = Date.now();

  let tvdbData = {tvdbId, name, originalNetwork,
                  seasonCount, episodeCount, watchedCount,
                  dateCreated: new Date().toISOString().slice(0,10),
                  image, score, overview,
                  firstAired, lastAired, averageRuntime,
                  originalCountry, originalLanguage,
                  status, remotes, saved};
  if(showId !== undefined) 
    tvdbData.showId = showId;
  if(deleted !== undefined)
    tvdbData.deleted = deleted;

  // log('getTvdbData:', tvdbData);
  allTvdb[name] = tvdbData;
  // update allTvdb & tvdb.json
  resolve(tvdbData);
}


/////////  GET/UPDATE TVDB FOR WEB AND LOCAL //////
// each tvdb request from web waits in queue
// every result updates json file tvdb.json
const newTvdbQueue = [];
let   chkTvdbQueueRunning = false;

const chkTvdbQueue = () => {
  if(chkTvdbQueueRunning || 
     newTvdbQueue.length == 0) return;
  chkTvdbQueueRunning == true;
  const {ws, id, paramObj} = newTvdbQueue.pop();
  if(ws && ws.readyState !== WebSocket.OPEN) return;

  let resolve = null;
  let reject  = null;
  const promise = new Promise((resolveIn, rejectIn) => {
    resolve = resolveIn; 
    reject  = rejectIn;
  });
  promise.then((tvdbData) => {
    if(typeof tvdbData === 'object') {
      if(ws) ws.send(`${id}~~~ok~~~${JSON.stringify(tvdbData)}`);
      allTvdb[tvdbData.name] = tvdbData;
    }
    else tvdbData = allTvdb[tvdbData]; // tvdbData is name
    tvdbData.saved = Date.now();
    util.writeFile('./data/tvdb.json', allTvdb);
    chkTvdbQueueRunning == false;
    chkTvdbQueue();
  });
  getTvdbData(paramObj, resolve, reject);
}


//////////// UPDATE TVDB LOOP ////////////////
// get imdb data continuously to update data
// allTvdb is in memory copy of tvdb.json
// only one sequential request can be busy at a time
let tryLocalGetTvdbBusy = false;
const tryLocalGetTvdb = () => {
  if(tryLocalGetTvdbBusy) return;
  tryLocalGetTvdbBusy = true;

  // find show with oldest save date
  let minSaved = Math.min();
  let minTvdb  = null;
  try {
    const tvdbs = Object.values(allTvdb);
    tvdbs.forEach((tvdb) => {
      if(tvdb.deleted) return;
      if(!tvdb.showId) {
        log('err', 'tryLocalGetTvdb no showId and not deleted:', 
                       tvdb.name, {tvdb});
        return;
      }
      const saved = tvdb.saved;
      if(saved === undefined) {
        log('tryLocalGetTvdb, saved is undefined:', 
                     tvdb.name);
        minTvdb = tvdb;
        throw true;
      }
      if(saved < minSaved) {
        minSaved = saved;
        minTvdb  = tvdb;
      }
    });
  }
  catch(e){};
  if(minTvdb === null) {
    log('err', new Date().toTimeString().slice(0,8),
                   `tryLocalGetTvdbBusy, minTvdb is null`);  
    tryLocalGetTvdbBusy = false;
    return;
  }
  // log('------', new Date().toTimeString().slice(0,8),
  //             `updating tvdb locally:`, minTvdb.name); 
  const show = {
    Name:   minTvdb.name,
    TvdbId: minTvdb.tvdbId,
  }; 
  if(minTvdb.showId) show.Id = minTvdb.showId;
  const paramObj = {
    show,
    seasonCount:  minTvdb.seasonCount  ?? 0, 
    episodeCount: minTvdb.episodeCount ?? 0, 
    watchedCount: minTvdb.watchedCount ?? 0, 
    deleted:      minTvdb.deleted,
  };
  newTvdbQueue.unshift({ws:null, id:null, paramObj});
  chkTvdbQueue();
  tryLocalGetTvdbBusy = false;
}

// calls tryLocalGetTvdb every 6 mins
const updateTvdbLocal = () => {
  // token expires, refresh every 2 weeks
  if(Date.now() > gotTokenTime + 14*24*60*60*1000) {
    theTvdbToken = null;
    getTheTvdbToken();
  }
  // wait for token
  if(!theTvdbToken) {
    setTimeout(updateTvdbLocal, 1000);
    return;
  }
  // only bother tvdb.com every min
  if (UPDATE_DATA) tryLocalGetTvdb();
  setTimeout(updateTvdbLocal, 6*60*1000); 
  // log(new Date().toTimeString().slice(0,8), 
  //             'tvdb local update finished', );
}
updateTvdbLocal();


///////////////////  FUNCTION CALLS FROM CLIENT  ////////////////////
export const getAllTvdb = (id, _param, resolve, _reject) => {
  // log('getAllTvdb', id);
  // return allTvdb object immediatelty
  resolve([id, allTvdb]);
};

// if tvdb already exists replace it
export const getNewTvdb = async (ws, id, param) => {
  const paramObj = util.jParse(param, 'getNewTvdb');
  // log('getNewTvdb:', paramObj.show.Name);
  newTvdbQueue.unshift({ws, id, paramObj});
  chkTvdbQueue();
}

export const setTvdbFields = 
              async (id, param, resolve, _reject) => {
  const paramObj = util.jParse(param, 'setTvdbFields');
  let tvdb = null;
  const name = paramObj.name;
  if(name) {
    if(paramObj.$delTvdb) {
      delete allTvdb[name];
    }
    else {
      tvdb = allTvdb[name];
      if(!tvdb) { 
        log('err', 'setTvdbFields no tvdb for', name);
        resolve([id, 'no tvdb']); 
        return; 
      }
      if(paramObj.$delete) {
        for(const delName of paramObj.$delete) 
          delete tvdb[delName];
      }
      for(const [key, value] of Object.entries(paramObj)) {
        if(key != 'dontSave' && key != '$delete') 
          tvdb[key] = value;
      }
      // allTvdb[name] = tvdb;
    }
  }
  if(!paramObj.dontSave) 
      await util.writeFile('./data/tvdb.json', allTvdb);
  resolve([id, tvdb ?? 'ok']);
};
