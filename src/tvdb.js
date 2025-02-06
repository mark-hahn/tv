import * as srvr from "./srvr.js";
import * as util from "./util.js";
import * as urls from "./urls.js";
import * as emby from "./emby.js";
import     fetch from 'node-fetch';

let allTvdb    = null;
let allRemotes = null;

export const initTvdb = (allTvdbIn, remotesIn) => {
  allTvdb    = allTvdbIn;
  allRemotes = remotesIn;
}

//////////// GET TVDB DATA //////////////

export const getTvdbData = async (paramObj) => {
  const {show, theTvdbToken,
         seasonCount, episodeCount, watchedCount} = paramObj;
  const name   = show.Name;
  const tvdbId = show.TvdbId;
  
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
                        show.Name, {extUrl, extRes});
      return null;
    }
  } catch(err) {  
    console.error('getTvdbData extended catch error:', show.Name, 
                      {extUrl, extRes, err});
    return null;
  }
  const extResObj  = await extRes.json();
  const {firstAired, lastAired: lastAiredIn, image, score,
         originalCountry, originalLanguage, overview,
         remoteIds:tvdbRemotes, status:statusIn,
         seasons:seasonsIn, averageRuntime,
         originalNetwork:originalNetworkIn} 
            = extResObj.data;
  let lastAired = lastAiredIn ?? firstAired;
  lastAired = lastAired ?? '';
  let originalNetwork = originalNetworkIn?.name ?? '';
  const status = statusIn.name; // e.g. Ended
  tvdbData = { tvdbId, name, originalNetwork,
               seasonCount, episodeCount, watchedCount,
               image, score, overview, 
               firstAired, lastAired, averageRuntime,
               originalCountry, originalLanguage,
               tvdbRemotes, status};
    
  allTvdb[name] = tvdbData;
  util.writeFile('../data/tvdb.json', allTvdb);

  // console.log('getTvdbData:', {tvdbData});
  return tvdbData;
}


///////////////////// GET REMOTES ////////////////////

const getUrlRatings = async (type, url, name) => {
  console.log('getUrlRatings', id, {type, url, name});

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
      // fs.writeFile('samples/rotten-search-noline.html', text);

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

export const getRemotes = async (show) => {
  const name   = show.Name;
  const showId = show.Id;

  const remotes = [];

  if(!showId.startsWith("noemby-")) remotes.push( 
            {name:'Emby', url: urls.embyPageUrl(showId)});

  const tvdbdata = allTvdb[name];
  if(tvdbdata) {
    const remoteIds = tvdbdata.tvdbRemotes;
    if(!remoteIds) {
      console.error(`getRemotes, tvdbdata has no remoteIds: ${name}`);
      return null;
    }

    const remotesByName = {};
    for(const idTypeName of remoteIds) {
      const remote = await getRemote(
              idTypeName.id, idTypeName.type, idTypeName.sourceName);
      if(remote) {
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
  }
  const rottenRemote = await getRemote(name, 99, name);
  if(rottenRemote) remotes.push(rottenRemote);

  const encoded = encodeURI(name).replaceAll('&', '%26');
  const url = `https://www.google.com/search` +
                       `?q=${encoded}%20tv%20show`;
  remotes.push({name:'Google', url});

  allRemotes[name] = remotes;
  util.writeFile('../data/remotes.json', allRemotes);

  return remotes;
}

export const updateTvdb = 
         async (id, param, resolve, _reject) => {
  console.log('updateTvdb:', param);
  const paramObj = jParse(param, 'updateTvdb');
  const tvdb    = await getTvdbData(paramObj); // must be first
  const remotes = await getRemotes(paramObj.show);
  resolve([id, {tvdb, remotes}]);
}
