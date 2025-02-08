import fs        from "fs";
import * as util from "./util.js";
import * as urls from "./urls.js";
import fetch     from 'node-fetch';

export const allTvdb = 
      util.jParse(fs.readFileSync('data/tvdb.json', 'utf8'));

///////////////////// GET REMOTES ////////////////////

const getUrlRatings = async (type, url, name) => {
  console.log('getUrlRatings', {type, url, name});

  let resp = await fetch(url);
  if (!resp.ok) {
    console.error(
      `getUrlRatings fetch error: ${{type, url, name}}, ${resp.status}`);
    return null;
  }
  const html = (await resp.text())
                .replaceAll(/(\r\n|\n|\r)/gm, "")
                .replaceAll(/\s+/gm, " ");

  const rottenStripSfx = (name) => {
    name = name.trim();
    const pfxNameParts = /^(.*?)(\s+\(.*?\))?$/i.exec(name);
    if(!pfxNameParts) {
      console.error('no rotten name pfx match:', {type, url, name});
      return null;
    }
    return pfxNameParts[1];
  }

  let idFnameParam;

  switch (+type) {
    case 2:  // IMDB
      // console.log('samples/imdb-page.html');
      // await util.writeFile('samples/imdb-page.html', html);
      idFnameParam = /imUuxf">(\d\.\d)<\/span>/i.exec(html);
      if(idFnameParam === null) return {ratings:null};
      return {ratings: idFnameParam[1]};

    case 18:  // wikidata
      idFnameParam = /lang="en"><a href="(.*?)"\shreflang="en"/i.exec(html);
      if(idFnameParam === null) return {url: null};
      return {url: idFnameParam[1]};

    case 99:  // rotten tomatoes
      // util.writeFile('samples/rotten-search.html', html);
      const namePfx = rottenStripSfx(name);
      let titleRegx = new RegExp(/search-result-title">TV shows</g);
      titleRegx.lastIndex = 0;
      const titleParts = titleRegx.exec(html);
      if(titleParts === null) {
        console.log('no rotten title match:', {type, url, name});
        return {url:'no match'};
      }

  // need escaping: ] ( ) [ { } * + ? / $ . | ^ \

      const urlNameRegx = new RegExp(
         /<a href="([^"]*)" class="unset" data-qa="info-name" slot="title">([^<]*)<\/a>/g
    );

      urlNameRegx.lastIndex = titleRegx.lastIndex;
      let textUrl;
      for(let i=0; i<3; i++) {
        const nameParts = urlNameRegx.exec(html);
        if(nameParts === null || i == 3) {
          console.log('no rotten url name match:', {type, url, name});
          return {url:'no match'};
        }
        let textName;
        [textUrl, textName] = nameParts.slice(1);
        const textNamePfx = rottenStripSfx(textName);
        if(textNamePfx == namePfx) break;
      }
      return {url:textUrl};

    default: return 'getUrlRatings invalid type: ' + type;
  }
}


///////////// get remote (name, url, & ratings) //////////////

const getRemote = async (id, type, showName) => {
  let url     = null;  
  let ratings = null;
  let urlRatings, name;
  
  switch (type) {
    case 2:  
      name = 'IMDB';
      url  = `https://www.imdb.com/title/${id}`;
      urlRatings = await getUrlRatings(2, url, name);
      ratings = urlRatings?.ratings;
      break;

    case 4:  name = 'Official Website'; url = id; break;

    // case 7:   url = `https://www.reddit.com/r/${id}`; break;
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
      urlRatings = await getUrlRatings(18, 
                    `https://www.wikidata.org/wiki/${id}`, showName);
      url = urlRatings?.url;
      break;
      
    // case 19: url = `https://www.tvmaze.com/shows/${id}`; break;

    case 99:  
      url = `https://www.rottentomatoes.com/search` +
                    `?search=${encodeURI(id)}`;
      urlRatings = await getUrlRatings(99, url, showName);
      name = urlRatings?.name;
      url  = urlRatings?.url;
      // console.log(`getRemote rotten name url: ${name}, ${url}`);
      break;

    default: return null;
  }
  
  if(!url) {
    // console.log(`getRemote, no url: ${name}`);
    return null;
  }
  // console.log(`getRemote`, {name, url, ratings});
  return {name, url, ratings};
}

///////////// get remotes  //////////////

const getRemotes = async (show, tvdbRemotes) => {
  const name   = show.Name;
  const showId = show.Id;

  const remotes = [];

  if(!showId.startsWith("noemby-")) remotes.push( 
            {name:'Emby', url: urls.embyPageUrl(showId)});

  const remotesByName = {};
  for(const tvdbRemote of tvdbRemotes) {
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
    if(name !== "IMDB" && name !== "Rotten Tomatoes")
      remotes.push(remote);
  }

  const rottenRemote = await getRemote(name, 99, name);
  // if(rottenRemote?.url === 'no match') debugger
  if(rottenRemote && rottenRemote.url !== 'no match') 
      remotes.push(rottenRemote);

  const encoded = encodeURI(name).replaceAll('&', '%26');
  const url = `https://www.google.com/search` +
                       `?q=${encoded}%20tv%20show`;
  remotes.push({name:'Google', url});

  return remotes;
}


//////////// GET TVDB DATA //////////////

const getTvdbData = async (paramObj, resolve, _reject) => {
  const {show, seasonCount, episodeCount, watchedCount} = paramObj;
  const name   = show.Name;
  const tvdbId = show.TvdbId;
  if(!tvdbId) {
    console.error('getTvdbData no tvdbId:', show);
    resolve(null);
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
      console.error(`getTvdbData error, extended status:`, 
                        name, {extUrl}, JSON.stringify(extRes,null,2));
      return null;
    }
  } catch(err) {  
    console.error('getTvdbData extended catch error:', name, 
                      {extUrl, extRes, err});
    return null;
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
  const remotes = await getRemotes(show, remoteIds);
  const saved = Date.now();

  let tvdbData = {tvdbId, name, originalNetwork,
                  seasonCount, episodeCount, watchedCount,
                  image, score, overview, 
                  firstAired, lastAired, averageRuntime,
                  originalCountry, originalLanguage,
                  status, remotes, saved};
  // console.log('getTvdbData:', tvdbData);

  resolve(tvdbData);
}


//////////////////  NEW TVDB  //////////////////

const newTvdbQueue        = [];
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
    const tvdbDataStr = JSON.stringify(tvdbData);

    if(ws) ws.send(`${id}~~~ok~~~${tvdbDataStr}`);

    allTvdb[tvdbData.name] = tvdbData;
    util.writeFile('./data/tvdb.json', allTvdb);
 
    chkTvdbQueueRunning == false;
    chkTvdbQueue();
  });
  getTvdbData(paramObj, resolve, reject);
}

let tryLocalGetTvdbBusy = false;
const tryLocalGetTvdb = () => {
  if(tryLocalGetTvdbBusy) return;
  tryLocalGetTvdbBusy = true;

  let minSaved = Math.min();
  let minTvdb  = null;
  try {
    const tvdbs = Object.values(allTvdb);
    tvdbs.forEach((tvdb) => {
      if(!tvdb.showId || tvdb.deleted) return;
      const saved = tvdb?.saved;
      if(saved === undefined) {
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
  const paramObj = {
    show: {
      Name:   minTvdb.name,
      Id:     minTvdb.showId,
      TvdbId: minTvdb.tvdbId,
    },
    seasonCount:  minTvdb.seasonCount  ?? 0, 
    episodeCount: minTvdb.episodeCount ?? 0, 
    watchedCount: minTvdb.watchedCount ?? 0, 
  };
  console.log('tryLocalGetTvdb', new Date().toTimeString(), {paramObj});
  newTvdbQueue.unshift({ws:null, id:null, paramObj});
  chkTvdbQueue();
  tryLocalGetTvdbBusy = false;
}

///////////// get theTvdbToken //////////////
let theTvdbToken = null;
let gotTokenTime = 0;
const getTheTvdbToken = async () => {
  const loginResp = await fetch(
    'https://api4.thetvdb.com/v4/login', 
    { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 
        JSON.stringify({
            "apikey": "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df",
            "pin": "HXEVSDFF"
        })
    }
  );
  if (!loginResp.ok) {
    console.error(`FATAL: TvDbToken Response: ${loginResp.status}`);
    process.exit();
  }
  const loginJSON = await loginResp.json();
  theTvdbToken = loginJSON.data.token;
  gotTokenTime = Date.now();
}

// calls tryLocalGetTvdb every 6 mins
const updateTvdbs = () => {
  if(Date.now() > gotTokenTime + 14*24*60*60*1000) { // 2 weeks
    theTvdbToken = null;
    getTheTvdbToken();
  }
  if(!theTvdbToken) {
    setTimeout(updateTvdbs, 1000);
    return;
  }
  tryLocalGetTvdb();
  setTimeout(updateTvdbs, 6*60*1000);  // 6 mins
}
updateTvdbs();

export const getAllTvdb = (id, _param, resolve, _reject) => {
  console.log('getAllTvdb', id);
  resolve([id, allTvdb]);
};

export const getNewTvdb = async (ws, id, param) => {
  const paramObj = util.jParse(param, 'getNewTvdb');
  console.log('getNewTvdb:', paramObj.show.Name);
  newTvdbQueue.unshift({ws, id, paramObj});
  chkTvdbQueue();
}

export const setTvdbFields = 
              async (id, param, resolve, _reject) => {
  const paramObj = util.jParse(param, 'setTvdbFields');
  const name = paramObj.name;
  let tvdb;
  if(name) {
    tvdb = allTvdb[name];
    if(!tvdb) { 
      console.error('setTvdbFields missing tvdb', id, name);
      resolve([id, 'no tvdb']); 
      return; 
    }
    for(const [key, value] of Object.entries(paramObj)) {
      if(key === '$delete') {
        for(const field of value) delete tvdb[field];
      }
      else tvdb[key] = value;
    }
    allTvdb[name] = tvdb;
  }
  if(!paramObj.dontSave) 
      await util.writeFile('./data/tvdb.json', allTvdb);
  resolve([id, tvdb ?? 'ok']);
};


////////// temp one-time mass operation //////////
// console.log('one-time adding remotes to allTvdb');
// let allRemotes = util.jParse(
//       fs.readFileSync('data/remotes.json', 'utf8'));
// const tvdbs = Object.values(allTvdb);
// tvdbs.forEach((tvdb)=> {
//   const remotes = allRemotes[tvdb.name];
//   if(remotes) {
//     allTvdb[tvdb.name].remotes = remotes;
//     delete allTvdb[tvdb.name].tvdbRemotes;
//   }
// });
// util.writeFile('./data/tvdb.json', allTvdb);
// console.log('end of one-time adding remotes to allTvdb');
