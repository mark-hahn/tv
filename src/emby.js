import axios     from "axios"
import * as srvr from "./srvr.js";
import * as urls from "./urls.js";

const seasonsWorker = 
        new Worker('src/seasons-worker.js', {type: 'module'});

const name      = "mark";
const pwd       = "90-MNBbnmyui";
const apiKey    = "1c399bd079d549cba8c916244d3add2b"
const markUsrId = "894c752d448f45a3a1260ccaabd0adff";
const authHdr   = `UserId="${markUsrId}", `                +
                  'Client="MyClient", Device="myDevice", ' +
                  'DeviceId="123456", Version="1.0.0"';
let token = '';
let cred  = null;

////////////////////////  INIT  ///////////////////////

const getToken = async () => {
  const config = {
    method: 'post',
    url: "http://hahnca.com:8096" +
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


////////////////////////  UTILITIES  ///////////////////////

export async function providers (show) {
  const url = `http://hahnca.com:8096/emby/Items?Recursive=true&Fields=ProviderIds&Ids=${show.Id}&api_key=ba7d62f79cbd4a539b675b05b5663607`;
  const item = (await axios.get(url)).data.Items[0];
  console.log("providers", {url, show, item});
  return item?.ProviderIds;
}

export function getSeasons(allShows, cb) {
  seasonsWorker.onerror = (err) => {
    console.error('Worker error:', err.message);
  }
  const allShowIds = allShows.map((show) => show.Id);
  seasonsWorker.postMessage({cred, allShowIds});

  seasonsWorker.onmessage = cb;
}
 
////////////////////////  MAIN FUNCTIONS  ///////////////////////

const pathToName = {};

export async function loadAllShows() {
  console.log('entering loadAllShows');
  const time1 = new Date().getTime();

  const listPromise   = axios.get(
                        urls.showListUrl(cred, 0, 10000));
  const seriesPromise = srvr.getSeries();
  const rejPromise    = srvr.getRejects();
  const pkupPromise   = srvr.getPickups();
  const [embyShows, srvrShows, rejects, pickups] = 
    await Promise.all(
      [listPromise, seriesPromise, rejPromise, pkupPromise]);

  const shows = [];

  for(let key in embyShows.data.Items) {
    let show = embyShows.data.Items[key];
    Object.assign(show, show.UserData);
    delete show.UserData;
    for(const date of ['DateCreated', 'PremiereDate'])
      if(show[date]) show[date] = show[date].replace(/T.*/, '');

    const embyPath     = show.Path.split('/').pop();
    const showDateSize = srvrShows[embyPath];
    if(!showDateSize) {
      console.log('emby show not in srvr:',   
                    {Name:show.Name, Path:show.Path});
      show.NoSrvr  = true;
      show.Date = 0;
      show.Size = 0;
    }
    else {
      const [date, Size] = showDateSize;
      show.Date = date;
      show.Size = Size;
    }
    shows.push(show);
  }

  for(let rejectName of rejects) {
    const show = shows.find((show) => show.Name == rejectName);
    if(show) show.Reject = true;
  }

  for(let pickupName of pickups) {
    const show = shows.find((show) => show.Name == pickupName);
    if(show) show.Pickup = true;
  }

  const toTryRes = await axios.get(urls.toTryListUrl(cred));
  const toTryIds = [];
  for(let tryEntry of toTryRes.data.Items)
       toTryIds.push(tryEntry.Id);
  for(let show of shows)
       show.InToTry = toTryIds.includes(show.Id);

  const elapsed = new Date().getTime() - time1;
  console.log('all shows loaded, elapsed:', elapsed);
  return shows;
}

const deleteOneFile = async (path) => {
  if(!path) return;
  const encodedPath = encodeURI(path) .replaceAll('/', '@')
                                      .replaceAll('?', '~');
  console.log('deleting file:', path);
  try {
    await srvr.deletePath(encodedPath);
  }
  catch (e) {
    console.error('deletePath:', path, e);
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
        catch(e) { console.error('deleteOneFile:', path, e); }
        return;
      }

      const episodeId = episodeRec.Id;
      userData.Played = !watched;
      if(!userData.LastPlayedDate)
        userData.LastPlayedDate = new Date().toISOString();
      const url = urls.postUserDataUrl(cred, episodeId);
      const setDataRes = await axios({
        method: 'post',
        url:     url,
        data:    userData
      });
      console.log("toggled watched", {
                    epi: `S${seasonNumber}E${episodeNumber}`, 
                    post_url: url,
                    post_res: setDataRes
                  });
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
    let   seasonRec    =  seasonsRes.data.Items[key];
    seasonNumber       = +seasonRec.IndexNumber;
    const seasonId     = +seasonRec.Id;
    const episodesRes  = await axios.get(urls.childrenUrl(cred, seasonId));
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

    userData.LastPlayedDate = new Date().toISOString();
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

export const getSeriesMap = async (seriesId, prune = false) => { 
  const seriesMap = [];
  let pruning = prune;
  const seasonsRes = await axios.get(urls.childrenUrl(cred, seriesId));
  for(let key in seasonsRes.data.Items) {
    let   seasonRec    =  seasonsRes.data.Items[key];
    let   seasonId     =  seasonRec.Id;
    const seasonNumber = +seasonRec.IndexNumber;
    const unairedObj   = {};
    const unairedRes   = await axios.get(urls.childrenUrl(cred, seasonId, true));
    for(let key in unairedRes.data.Items) {
      const episodeRec    = unairedRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      unairedObj[episodeNumber] = true;
    }
    let seasonPath = null;
    const episodes    = [];
    const episodesRes = await axios.get(urls.childrenUrl(cred, seasonId));
    for(let key in episodesRes.data.Items) {
      let   episodeRec    =  episodesRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      if(!episodeNumber) continue;

      const epiFilePath = episodeRec?.MediaSources?.[0]?.Path;
      if (!epiFilePath) {
        console.error('no episode file path', 
                      `S${seasonNumber}E${episodeNumber}`);
        continue;
      }
      const played     = !!episodeRec?.UserData?.Played;
      const avail      =   episodeRec?.LocationType != "Virtual";
      const unaired = 
              !!unairedObj[episodeNumber] && !played && !avail;

      if(avail && !epiFilePath) {
        console.error('avail without path', 
                    `S${seasonNumber}E${episodeNumber}`);
        continue;
      }
      let deleted = false;
      if(pruning) {
        if(!played && avail) pruning = false;
        else {
          seasonPath =  
            epiFilePath?.split('/').slice(0, -1).join('/')
                        .replaceAll('/', '@')
                        .replaceAll('?', '~');
          deleted = avail;
        }
      }
      episodes.push([episodeNumber, [played, avail, unaired, deleted]]);
    }
    if(seasonPath) {
      console.log('deleting season:', seasonPath);
      await srvr.deleteVideos(seasonPath);
    }
    seriesMap.push([seasonNumber, episodes]);
  }
  return seriesMap;
}

export const findGap = async (series, seriesId) => { 

  const dbg = (series == "");
  if(dbg) console.log('debugging ' + series);

  let hadNotWatched     = false;
  let hadWatched        = false;
  let hadNoFile         = false;
  let hadFile           = false;
  let hadUnaired        = false;
  let missingEndFileCnt = -1;
  let lastEpiNums       = null;
  let lastEpiWatched    = false;

  const seasonsRes = await axios.get(urls.childrenUrl(cred, seriesId));
  for(let key in seasonsRes.data.Items) {
    let   seasonRec = seasonsRes.data.Items[key];
    const seasonId  = seasonRec.Id;
    const seasonIdx = +seasonRec.IndexNumber;

    const unairedObj = {};
    const unairedRes = await axios.get(urls.childrenUrl(cred, seasonId, true));
    for(let key in unairedRes.data.Items) {
      const episodeRec    = unairedRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      unairedObj[episodeNumber] = true;
    }

    let firstEpisodeInSeasonNotWatched = false;
    let firstEpisodeInSeason           = true;

    const episRes = await axios.get(urls.childrenUrl(cred, seasonId));
    for(let key in episRes.data.Items) {
      let   episodeRec = episRes.data.Items[key];
      const epiIndex   = +episodeRec.IndexNumber;
      const userData   = episodeRec?.UserData;
      const watched    = !!userData?.Played;
      const haveFile   = (episodeRec.LocationType != "Virtual");
      const unaired    = !!unairedObj[epiIndex] && !watched && !haveFile;

      if(firstEpisodeInSeason && !watched) 
          firstEpisodeInSeasonNotWatched = true;
      if(watched) hadWatched = true;

      if(dbg) console.log(1, {seasonIdx, epiIndex, seasonRec, episodeRec,
                              userData, watched, haveFile, unaired,
                              firstEpisodeInSeason,firstEpisodeInSeasonNotWatched});

      /////////// aired epi after unaired /////////
      if(hadUnaired && !unaired) {
        console.log(`-- aired after unaired -- ${series} ` + 
                    `S${seasonIdx}E${epiIndex}`);
        return([seasonIdx, epiIndex, 'aired after unaired']);
      }
      // unaired at end are ignored
      if(unaired) {
        hadUnaired = true;
        continue;
      }

      if(watched || haveFile) missingEndFileCnt = -1;
      else {
        if(missingEndFileCnt == -1 && 
           lastEpiWatched && !watched && !haveFile) missingEndFileCnt = 0;
        if(missingEndFileCnt != -1 && 
          !watched && !haveFile)                    missingEndFileCnt++;
      }
      lastEpiWatched = watched;

      ///////// not watched at beginning of season /////////
      if(firstEpisodeInSeasonNotWatched && watched && 
            !firstEpisodeInSeason) {
        console.log(`-- not watched at beginning -- ` +
                    `${series}, S${seasonIdx} E${epiIndex}`);
        return([seasonIdx, epiIndex, "not watched at beginning"]);
      }

      ///////// watched gap /////////
      if(hadWatched && !watched) hadNotWatched = true;
      else if(hadNotWatched && watched) {
        console.log(`-- watched gap -- ${series}, S${seasonIdx} E${epiIndex}`);
        return([seasonIdx, epiIndex, "watch gap"]);
      }

      ///////// file gap /////////
      if(haveFile && !hadFile) {
        hadFile = true;
        continue;
      }
      if(hadFile && !haveFile) hadNoFile = true;
      else if(hadNoFile) {
        console.log(`-- file gap -- ${series}, S${seasonIdx} E${epiIndex}`);
        return([seasonIdx, epiIndex, "file gap"]);
      }
      lastEpiNums = [seasonIdx, epiIndex];
    }
    firstEpisodeInSeason = false;
  }

  ///////// recent episodes missing ///////// 
  if(missingEndFileCnt > 1) {
    console.log(`-- ${missingEndFileCnt} end episodes missing -- ${series}`);
    lastEpiNums.push(`${missingEndFileCnt} end episodes missing`);
    return lastEpiNums;
  }
  return null;
}

export async function toggleFav(id, isFav) {
  const config = {
    method: (isFav ? 'delete' : 'post'),
    url:     urls.favoriteUrl(cred, id),
  };
  let favRes;
  try { favRes = await axios(config); }
  catch (e) { return isFav; }
  return (favRes.status == 200 ? favRes.data.IsFavorite : isFav);
}

export async function addReject(name) {
  if(name == "") return false;
  try { await srvr.addReject(name); }
  catch (e) {
    alert('Error: unable to add reject to server' + e);
    return false;
  }
  return true;
}

export async function addPickUp(name) {
  if(name == "") return false;
    try { await srvr.addPickup(name); }
  catch (e) {
    alert('Error: unable to add pickUp to server' + e);
    return false;
  }
  return true;
}

export async function toggleReject(name, reject) {
  if(reject) {
    try { await srvr.delReject(name); }
    catch (e) {
      alert('Error: unable to delete reject from server' + e);
      return reject;
    }
  }
  else {
    try { await srvr.addReject(name); }
    catch (e) { 
      alert('Error: unable to add reject to server' + e);
      return reject;
    }
  }
  return !reject;
}

export async function togglePickup(name, pickup) {
  if(pickup) {
    try { await srvr.delPickup(name); }
    catch (e) {
      alert('Error: unable to delete pickup from server' + e);
      return pickup;
    }
  }
  else {
    try { await srvr.addPickup(name); }
    catch (e) { 
      alert('Error: unable to add pickup to server' + e);
      return pickup;
    }
  }
  return !pickup;
}

export async function deleteShowFromEmby(id) {
  const delRes = await axios.delete(urls.deleteShowUrl(cred, id));
  const res = delRes.status;
  let err = 'ok';
  if(res != 204) {
    err = 'Error: unable to delete show' + delRes.data;
    alert(err);
  }
  return err;
}

export async function toggleToTry(id, inToTry) {
  const config = {
    method: (inToTry ? 'delete' : 'post'),
    url:     urls.toTryUrl(cred, id),
  };
  let toTryRes;
  try { toTryRes = await axios(config); }
  catch (e) {  
    console.log(
        `Error toggleToTry, id:${id}, inToTry:${inToTry}`);
    return inToTry; 
  } 
  if(toTryRes.status !== 204) return inToTry;
  console.log(`toggled inToTry to ${!inToTry}`);
  return !inToTry;
}

/////////////////////  RANDOM RESULTS  ///////////////////////

/*

https://dev.emby.media/doc/restapi/index.html
https://dev.emby.media/reference/RestAPI.html
https://dev.emby.media/home/sdk/apiclients/index.html


[
  {
    "Name": "to-try",
    "ServerId": "ae3349983dbe45d9aa1d317a7753483e",
    "Id": "1468316",
    "CanDelete": true,
    "IsFolder": true,
    "Type": "BoxSet",
    "UserData": {
      "PlaybackPositionTicks": 0,
      "PlayCount": 0,
      "IsFavorite": false,
      "Played": false
    },
    "PrimaryImageAspectRatio": 0.6666666666666666,
    "ImageTags": {
      "Primary": "f12fa256e8dd75df8c74fd3e27e91a5c"
    },
    "BackdropImageTags": []
  }
]

------      get items in TO-TRY collection  -----------
http://hahnca.com:8096/emby/Users/${markUsrId}/Items?ParentId=1468316&ImageTypeLimit=1&Fields=PrimaryImageAspectRatio,ProductionYear,CanDelete&EnableTotalRecordCount=false&X-Emby-Client=Emby Web&X-Emby-Device-Name=Chrome&X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b&X-Emby-Client-Version=4.6.4.0&X-Emby-Token=1e2f0f8dec6c4e039eaaa9657438bb6d

------      add item to TO-TRY collection  -----------
Id: "4487588"
Name: "Yellowstone (2018)"

POST
http://hahnca.com:8096/emby/Collections/1468316/Items?Ids=4487588&userId=${markUsrId}&X-Emby-Client=Emby Web&X-Emby-Device-Name=Chrome&X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b&X-Emby-Client-Version=4.6.4.0&X-Emby-Token=1e2f0f8dec6c4e039eaaa9657438bb6d

------      delete item from TO-TRY collection  -----------
Id: "3705964"
Name: "Cleaning Up"

DELETE
http://hahnca.com:8096/emby/Collections/1468316/Items?Ids=3705964&X-Emby-Client=Emby Web&X-Emby-Device-Name=Chrome&X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b&X-Emby-Client-Version=4.6.4.0&X-Emby-Token=1e2f0f8dec6c4e039eaaa9657438bb6d

------    get episodes  -----------
http://hahnca.com:8096/emby/Users/${markUsrId}/Items/?ParentId=141&X-Emby-Token=adb586c9ecb441a28ad48d510519b587&Fields=Type%2cMediaSources%2cIndexNumber%2cLocationType%2cUnplayedItemCount%2cDateCreated%2cExternalUrls%2cGenres%2cOverview%2cPath%2cPeople%2cPremiereDate

{
    "Items": [
        {
            "Name": "A scintillating conversation about a lethal pesticide",
            "ServerId": "ae3349983dbe45d9aa1d317a7753483e",
            "Id": "4689622",
            // "DateCreated": "2022-05-31T21:50:04.0000000Z",
            "Container": "mkv",
            "PremiereDate": "2022-04-14T07:00:00.0000000Z",
            "ExternalUrls": [],
            "MediaSources": [
                {
                    "Protocol": "File",
                    "Id": "cb3fc73d8ddafc394d6865a589bf15bb",
                    "Path": "/mnt/media/tv/Minx/Season 1/Minx.S01E09.A.scintillating.conversation.about.a.lethal.pesticide.1080p.HMAX.WEB-DL.DDP5.1.x264-NTb.mkv",
                    "Type": "Default",
                    "Container": "mkv",
                    "Size": 1710531651,
                    "Name": "Minx.S01E09.A.scintillating.conversation.about.a.lethal.pesticide.1080p.HMAX.WEB-DL.DDP5.1.x264-NTb",
                    "IsRemote": false,
                    "RunTimeTicks": 15904320000,
                    "SupportsTranscoding": true,
                    "SupportsDirectStream": true,
                    "SupportsDirectPlay": true,
                    "IsInfiniteStream": false,
                    "RequiresOpening": false,
                    "RequiresClosing": false,
                    "RequiresLooping": false,
                    "SupportsProbing": false,
                    "MediaStreams": [
                        {
                            "Codec": "h264",
                            "ColorTransfer": "bt709",
                            "ColorPrimaries": "bt709",
                            "ColorSpace": "bt709",
                            "TimeBase": "1/1000",
                            "VideoRange": "SDR",
                            "DisplayTitle": "1080p H264",
                            "NalLengthSize": "4",
                            "IsInterlaced": false,
                            "BitRate": 8604110,
                            "BitDepth": 8,
                            "RefFrames": 1,
                            "IsDefault": true,
                            "IsForced": false,
                            "Height": 1080,
                            "Width": 1920,
                            "AverageFrameRate": 23.976025,
                            "RealFrameRate": 23.976025,
                            "Profile": "High",
                            "Type": "Video",
                            "AspectRatio": "16:9",
                            "Index": 0,
                            "IsExternal": false,
                            "IsTextSubtitleStream": false,
                            "SupportsExternalStream": false,
                            "Protocol": "File",
                            "PixelFormat": "yuv420p",
                            "Level": 40,
                            "IsAnamorphic": false,
                            "AttachmentSize": 0
                        },
                        {
                            "Codec": "eac3",
                            "Language": "eng",
                            "TimeBase": "1/1000",
                            "DisplayTitle": "English EAC3 5.1 (Default)",
                            "DisplayLanguage": "English",
                            "IsInterlaced": false,
                            "ChannelLayout": "5.1",
                            "BitRate": 384000,
                            "Channels": 6,
                            "SampleRate": 48000,
                            "IsDefault": true,
                            "IsForced": false,
                            "Type": "Audio",
                            "Index": 1,
                            "IsExternal": false,
                            "IsTextSubtitleStream": false,
                            "SupportsExternalStream": false,
                            "Protocol": "File",
                            "AttachmentSize": 0
                        }
                        <... more media streams ...>
                    ],
                    "Formats": [],
                    "Bitrate": 8604110,
                    "RequiredHttpHeaders": {},
                    "ReadAtNativeFramerate": false,
                    "DefaultAudioStreamIndex": 1,
                    "DefaultSubtitleStreamIndex": -1
                }
            ],
            "Path": "/mnt/media/tv/Minx/Season 1/Minx.S01E09.A.scintillating.conversation.about.a.lethal.pesticide.1080p.HMAX.WEB-DL.DDP5.1.x264-NTb.mkv",
            "Overview": "While Joyce takes it easy in New York, things back at Bottom Dollar only get harder for Doug, whose vision for Minx clashes with everything Joyce’s magazine stood for. Bambi helps Shelly get in touch with her sexuality.",
            "Genres": [],
            "RunTimeTicks": 15904320000,
            "Size": 1710531651,
            "Bitrate": 8604110,
            "IndexNumber": 9,
            "ParentIndexNumber": 1,
            "IsFolder": false,
            "Type": "Episode",
            "People": [],
            "GenreItems": [],
            "ParentLogoItemId": "4689614",
            "ParentBackdropItemId": "4689614",
            "ParentBackdropImageTags": [
                "cb8326060ceeadfb4d6c4d15c281feb2"
            ],
            "UserData": {
                "PlaybackPositionTicks": 0,
                "PlayCount": 1,
                "IsFavorite": false,
                "LastPlayedDate": "2022-07-08T03:04:17.0000000Z",
                "Played": true
            },
            "SeriesName": "Minx",
            "SeriesId": "4689614",
            "SeasonId": "4689616",
            "SeriesPrimaryImageTag": "03f5d1d5eed479eef280420d96783d6b",
            "SeasonName": "Season 1",
            "ImageTags": {
                "Primary": "1d0777f834c7d381417f3f478b5aba97"
            },
            "BackdropImageTags": [],
            "ParentLogoImageTag": "695b53e792c04d68de22ea70f9713841",
            "ParentThumbItemId": "4689614",
            "ParentThumbImageTag": "5eb9e1f9911dd53f39ee14dc96de587b",
            "MediaType": "Video"
        }
        <... more items ...>
    ],
    "TotalRecordCount": 10
}


------   series   ------------
    one item from data.Items object
    key of data.Items object is the series id

AirDays: []
BackdropImageTags: ["dd2d6479fc843d9a6e834d3f3f965ffe"]
CanDelete: true
CanDownload: false
ChildCount: 3
CommunityRating: 7.3
DateCreated: "2019-06-26T01:35:06.0000000+00:00"
DisplayOrder: "Aired"
DisplayPreferencesId: "f63033ff6886ecc7083a696cbeced1b0"
Etag: "9a9388246d4af7828bfbec6e79edb3ed"
ExternalUrls: [{Name: "IMDb", Url: "https://www.imdb.com/title/tt6794990"},…]
GenreItems: [{Name: "Drama", Id: 7765}, {Name: "Crime", Id: 8388}, {Name: "Thriller", Id: 8389},…]
Genres: ["Drama", "Crime", "Thriller", "Mystery"]
Id: "303167"
ImageTags: {Banner: "e9f06826b638082dae77c1d187499040", Primary: "2d368c7e7552efb69c25b57e4149b2ab",…}
IsFolder: true
LocalTrailerCount: 0
LockData: false
LockedFields: []
Name: "Absentia"
OfficialRating: "TV-MA"
Overview: "While hunting one of Boston's most notorious serial killers, an FBI agent disappears without a trace and is declared dead. Six years later, she is found in a cabin in the woods, barely alive and with no memory of the years she was missing. Returning home to learn her husband has remarried and her son is being raised by another woman, she soon finds herself implicated in a new series of murders."
ParentId: "5"
Path: "/mnt/media/tv/Absentia"
People: [{Name: "Stana Katic", Id: "776879", Role: "Emily Byrne", Type: "Actor",…},…]
PlayAccess: "Full"
PremiereDate: "2017-09-25T07:00:00.0000000+00:00"
PresentationUniqueKey: "330500-en-4514ec850e5ad0c47b58444e17b6346c"
PrimaryImageAspectRatio: 0.68
ProductionYear: 2017
ProviderIds: {Tvdb: "330500", Imdb: "tt6794990"}
RecursiveItemCount: 20
RemoteTrailers: []
RunTimeTicks: 27000000512
ServerId: "ae3349983dbe45d9aa1d317a7753483e"
SortName: "Absentia"
Studios: [{Name: "AXN", Id: 776890}]
SupportsSync: true
TagItems: []
Taglines: []
Type: "Series"
UserData: {
  IsFavorite: false
  PlayCount: 0
  PlaybackPositionTicks: 0
  Played: false
  PlayedPercentage: 5
  UnplayedItemCount: 19
}
*/