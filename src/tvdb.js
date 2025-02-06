import * as srvr from "./srvr.js";
import * as util from "./util.js";
import * as urls from "./urls.js";
import * as emby from "./emby.js";
import     fetch from 'node-fetch';

let theTvdbToken = null;
let allTvdb      = null;
let remotes      = null;

export const initTvdb = (allTvdbIn, remotesIn) => {
  allTvdb = allTvdbIn;
  remotes = remotesIn;
}

const getUrls = async (id, typeUrlName, resolve, reject) => {
  console.log('getUrls', id, typeUrlName);
  const [type, url, name] = typeUrlName.split('||');

  let resp = await fetch(url);
  if (!resp.ok) {
    console.error(`getUrls resp: ${typeUrlName}, ${resp.status}`);
    reject([id, {type, url, name}]);
    return
  }
  const html = (await resp.text())
                .replaceAll(/(\r\n|\n|\r)/gm, "")
                .replaceAll(/\s+/gm, " ");

  const rottenStripSfx = (name) => {
    name = name.trim();
    const pfxNameParts = /^(.*?)(\s+\(.*?\))?$/i.exec(name);
    if(!pfxNameParts) {
      console.log('no rotten name pfx match:', {type, url, name});
      resolve([id, 'no match: ' + {type, url, name}]);
      return;
    }
    return pfxNameParts[1];
  }

  let idFnameParam;

  switch (+type) {
    case 2:  // IMDB
      // console.log('samples/imdb-page.html');
      // await util.writeFile('samples/imdb-page.html', html);
      idFnameParam = /imUuxf">(\d\.\d)<\/span>/i.exec(html);
      if(idFnameParam === null) {
        resolve([id, {ratings:null}]);
        return
      }
      resolve([id, {ratings:idFnameParam[1]}]);
      return;

    case 18:  // wikidata
      idFnameParam = /lang="en"><a href="(.*?)"\shreflang="en"/i.exec(html);
      if(idFnameParam === null) {
        resolve([id, {url:null}]);
        return
      }
      resolve([id, {url:idFnameParam[1]}]);
      return;

    case 98:  // google
      if(name == 'The Crow Girl')
        fs.writeFile('samples/google-Eilean-search.html', html);
      return

    case 99:  // rotten tomatoes
      // fs.writeFile('samples/rotten-search-noline.html', text);

      const namePfx = rottenStripSfx(name);
      let titleRegx = new RegExp(/search-result-title">TV shows</g);
      titleRegx.lastIndex = 0;
      const titleParts = titleRegx.exec(html);
      if(titleParts === null) {
        console.log('no rotten title match:', {type, url, name});
        resolve([id, 'no match: ' + {type, url, name}]);
        return;
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
          resolve([id, 'no match: ' + {type, url, name}]);
          return;
        }
        let textName;
        [textUrl, textName] = nameParts.slice(1);
        const textNamePfx = rottenStripSfx(textName);
        if(textNamePfx == namePfx) break;
      }
      resolve([id, {name:"Rotten Tomatoes", url:textUrl}]);
      return;

    default: resolve([id, 'getUrls no type: ' + type]);
  }
}


///////////// get remote (name and url) //////////////

const getRemote = async (tvdbRemote, showName) => {
  let {id, type} = tvdbRemote;
  let url     = null;  
  let ratings = null;
  let urlRatings, name;
  switch (type) {
    case 2:  
      name = 'IMDB';
      url  = `https://www.imdb.com/title/${id}`;
      urlRatings = await getUrls(
            `2||${url}?search=${encodeURI(id)}||${showName}`);
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
      urlRatings = await getUrls(
            `18||https://www.wikidata.org/wiki/${id}||${showName}`);
      url = urlRatings?.url;
      break;
      
    // case 19: url = `https://www.tvmaze.com/shows/${id}`; break;

    case 99:  
      url = `https://www.rottentomatoes.com/search` +
                    `?search=${encodeURI(id)}`;
      urlRatings = await getUrls(`99||${url}||${showName}`);
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
  if(url.startsWith('no match:')) {
    // console.log(`getRemote, no match: ${name}`);
    return null;
  }
  // console.log(`getRemote`, {name, url, ratings});
  return {name, url, ratings};
}

///////////// get remotes  //////////////

export const getRemotes = async (show) => {
  const showName = show.Name;
  const showId   = show.Id;
  if(!showId) {
    console.error(`getRemotes, no showId:`, {show});
    return null;
  }
  let remotes = await getRemotes(showName);
  if(remotes && !remotes.noMatch) return [remotes, true];

  remotes = [];

  if(!showId.startsWith("noemby-")) remotes[0] = 
            {name:'Emby', url: urls.embyPageUrl(showId)};

  const tvdbdata = await getTvdbData(show);
  if(tvdbdata) {
    const remoteIds = tvdbdata.tvdbRemotes;
    if(!remoteIds) {
      console.error(`getRemotes, no remoteIds: ${showName}`);
      return null;
    }

    const remotesByName = {};
    for(const tvdbShowId of remoteIds) {
      const remote = await getRemote(tvdbShowId, showName);
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
  const rottenRemote = await getRemote(
        {id:showName, type:99}, showName);
  if(rottenRemote) remotes.push(rottenRemote);

  const encoded = encodeURI(showName).replaceAll('&', '%26');
  const url = `https://www.google.com/search` +
               `?q=${encoded}%20tv%20show`;
  remotes.push({name:'Google', url});

  addRemotes(showName + '|||' + JSON.stringify(remotes));
  return [remotes, false];
}

//////////// search for TvDb Data //////////////

export const srchTvdbData = async (searchStr) => {
  if(!theTvdbToken) await getToken();
  const srchUrl = 'https://api4.thetvdb.com/v4/' +
                  'search?type=series&query='    + 
                   encodeURIComponent(searchStr);
  const srchRes = await fetch(srchUrl,
                    {headers: {
                      'Content-Type': 'application/json',
                      Authorization:'Bearer ' + theTvdbToken}
                    });
  if (!srchRes.ok) {
    console.error(`tvdb search error:`, {searchStr}, srchRes.status);
    return null;
  }
  const srchResObj = await srchRes.json();
  const data = srchResObj.data;
  if(!data || data.length == 0) return null;
  return data;
}

//////////// get TvDb Data //////////////

export const getTvdbData = async (show) => {
  const name     = show.Name;
  let   tvdbData = allTvdb[name];
  if(tvdbData) return tvdbData;

  const tvdbId = show.TvdbId;
  if(!tvdbId) {
    console.error(`getTvdbData error, no tvdbId:`, name, {show});
    return null;
  }
  
  if(!theTvdbToken) await getToken();
  
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
      console.error(`getTvdbData, extended status:`, 
                        show.Name, {extUrl, extRes});
      return null;
    }
  } catch(err) {  
    console.error('getTvdbData, extended caught:', show.Name, 
                      {extUrl, extRes, err});
    return null;
  }
  const {seasonCount, episodeCount, watchedCount} = 
              await emby.getEpisodeCounts(show);
  const extResObj  = await extRes.json();
  const {firstAired, lastAired: lastAiredIn, image, score,
         originalCountry, originalLanguage, overview,
         remoteIds:tvdbRemotes, status:statusIn,
         seasons:seasonsIn, averageRuntime,
         originalNetwork:originalNetworkIn} 
            = extResObj.data;
  let lastAired = lastAiredIn ?? firstAired;
  lastAired = lastAired ?? '';
  let   originalNetwork = originalNetworkIn?.name ?? '';
  const status = statusIn.name; // e.g. Ended
  tvdbData = { tvdbId, name, originalNetwork,
               seasonCount, episodeCount, watchedCount,
               image, score, overview, 
               firstAired, lastAired, averageRuntime,
               originalCountry, originalLanguage,
               tvdbRemotes, status};
  delete tvdbData.deleted;
    // if(!tvdbData.image) {
    //   alert('no image in tvdbData');
    //   return;
    // }
  allTvdb[name] = tvdbData;
  util.writeFile('../data/tvdb.json', allTvdb);
  // console.log('getTvdbData:', {tvdbData});
  return tvdbData;
}

export const updateTvdb = async (param) => {
  console.log('updateTvdb:', param);
  



}
