import axios     from "axios"
import * as tvdb from "./tvdb.js";
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

let token   = '';
let cred    = null;
let showErr = null;

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

export async function init(showErrIn) {
  showErr = showErrIn;
  srvr.init(showErr);
  await getToken();
  cred = {markUsrId, token};
  urls.init(cred);
}

export function getSeasons(allShows, cb) {
  seasonsWorker.onerror = (err) => {
    showErr('Worker:', err.message);
    throw err;
  }
  const allShowsIdName = 
          allShows.map((show) => [show.Id, show.Name]);
  seasonsWorker.postMessage({cred, allShowsIdName});

  seasonsWorker.onmessage = cb;
}

const toTryCollId    = '1468316';
const continueCollId = '4719143';
const markCollId     = '4697672';
const lindaCollId    = '4706186';

export async function addNoEmby(show) {
  await srvr.addWaiting(show.Name);
  await srvr.addNoEmby(show);
}

export async function setWait(show) {
  if(show) {
    show.Waiting = true;
    show.WaitStr = (await tvdb.getWaitData(show.Name))[0];
    console.log('waiting:', show.Name, show.WaitStr);
  }
  else {
    delete show.Waiting;
    delete show.WaitStr;
    showErr('waiting show not found:', show.Name);
  }
}
export async function loadAllShows() {
  console.log('entering loadAllShows');
  const time1 = new Date().getTime();

  const listPromise   = axios.get(
                        urls.showListUrl(cred, 0, 10000));
  const seriesPromise = srvr.getAllShows(); 
  const waitPromise   = srvr.getWaiting();
  const rejPromise    = srvr.getRejects();
  const pkupPromise   = srvr.getPickups();
  const noEmbyPromise = srvr.getNoEmbys();

  const [embyShows, srvrShows, waitingShows, 
          rejects, pickups, noEmbys] = 
    await Promise.all([listPromise, seriesPromise, 
                       waitPromise, rejPromise, pkupPromise, 
                       noEmbyPromise]);
  const shows = [];

  for(let key in embyShows.data.Items) {
    let show = embyShows.data.Items[key];
    Object.assign(show, show.UserData);
    delete show.UserData;
    for(const date of ['DateCreated', 'PremiereDate'])
      if(show[date]) show[date] = show[date].replace(/T.*/, '');

    const embyPath     = show.Path.split('/').pop();
    const showDateSize = srvrShows[embyPath];
    if(!showDateSize) continue
    else {
      const [date, Size] = showDateSize;
      show.Date = date;
      show.Size = Size;
    }
    if(!show.DateCreated) show.DateCreated = show.Date;
    if(show.Date) shows.push(show);
  }

  for(const show of noEmbys) {
    const showTst = shows.find((s) => s.Name == show.Name);
    if(!showTst) shows.push(show);
  }

  for(let rejectName of rejects) {
    const show = shows.find((show) => show.Name == rejectName);
    if(show) show.Reject = true;
  }

  for(let waitingName of waitingShows) {
    const show = shows.find((show) => show.Name == waitingName);
    if(show) await setWait(show);
  }

  for(let pickupName of pickups) {
    const show = shows.find((show) => show.Name == pickupName);
    if(show) show.Pickup = true;
  }

  const toTryRes = await axios.get(
        urls.collectionListUrl(cred, toTryCollId));
  const toTryIds = [];
  for(let tryEntry of toTryRes.data.Items)
       toTryIds.push(tryEntry.Id);
  for(let show of shows)
       show.InToTry = toTryIds.includes(show.Id);

  const continueRes = await axios.get(
        urls.collectionListUrl(cred, continueCollId));
  const continueIds = [];
  for(let tryEntry of continueRes.data.Items)
       continueIds.push(tryEntry.Id);
  for(let show of shows)
       show.InContinue = continueIds.includes(show.Id);

  const markRes = await axios.get(
        urls.collectionListUrl(cred, markCollId));
  const markIds = [];
  for(let tryEntry of markRes.data.Items)
       markIds.push(tryEntry.Id);
  for(let show of shows)
       show.InMark = markIds.includes(show.Id);

  const lindaRes = await axios.get(
        urls.collectionListUrl(cred, lindaCollId));
  const lindaIds = [];
  for(let tryEntry of lindaRes.data.Items)
       lindaIds.push(tryEntry.Id);
  for(let show of shows)
       show.InLinda = lindaIds.includes(show.Id);

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
    showErr('deletePath:', path, e);
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

      console.log({episodeRec});

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
          showErr('deleteOneFile:', path, e);
          throw e;
         }
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
    let seasonRec      =  seasonsRes.data.Items[key];
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
    const episodes    = [];
    const episodesRes = await axios.get(urls.childrenUrl(cred, seasonId));
    for(let key in episodesRes.data.Items) {
      let   episodeRec    =  episodesRes.data.Items[key];
      const episodeNumber = +episodeRec.IndexNumber;
      if(!episodeNumber) continue;

      const path          =  episodeRec?.MediaSources?.[0]?.Path;
      const played        = !!episodeRec?.UserData?.Played;
      const avail         =   episodeRec?.LocationType != "Virtual";
      const unaired = 
              !!unairedObj[episodeNumber] && !played && !avail;
      let deleted = false;

      if(avail && !path) {
        showErr('avail without path', 
                    `S${seasonNumber}E${episodeNumber}`);
        continue;
      }
      if(pruning) {
        if(!played && avail) pruning = false;
        else {
          await deleteOneFile(path);
          deleted = avail;     // set even if error
        }
      }
      episodes.push([episodeNumber, [played, avail, unaired, deleted]]);
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

export async function addReject(name) {
  if(name == "") return false;
  try { await srvr.addReject(name); }
  catch (e) {
    showErr('unable to add reject to server' + e);
    throw e;
  }
  return true;
}

export async function saveReject(name, reject) {
  if(reject) await srvr.addReject(name);
  else       await srvr.delReject(name);
}

export async function saveWaiting(name, wait) {
  if(wait) await srvr.addWaiting(name);
  else     await srvr.delWaiting(name);
}

export async function savePickup(name, pickup) {
  if(pickup) {
    try { await srvr.addPickup(name); }
    catch (e) {
      showErr('unable to add pickup' + e);
      throw e;
    }
  }
  else {
    try { 
      await srvr.delPickup(name); 
    }
    catch (e) { 
      showErr('unable to save pickup to server: ' +
               e.Message);
      throw e;
    }
  }
}

export async function deleteShowFromEmby(id) {
  const delRes = await axios.delete(urls.deleteShowUrl(cred, id));
  const res = delRes.status;
  if(res != 204) {
    const err = 'unable to delete show' + delRes.data;
    showErr(err);
    throw new Error(err);
  }
  return 'ok';
}

export async function saveToTry(id, inToTry) {
  const config = {
    method: (inToTry ? 'post' : 'delete'),
    url:     urls.collectionUrl(cred, id, toTryCollId),
  };
  let toTryRes;
  try { toTryRes = await axios(config); }
  catch (e) {  
    showErr(
        `saveToTry, id:${id}, inToTry:${inToTry}`);
    throw e; 
  } 
  if(toTryRes.status !== 204) {
    const err = 'unable to save totry' + toTryRes.data;
    showErr(err);
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
    showErr(
        `saveContinue, id:${id}, inContinue:${inContinue}`);
    throw e; 
  } 
  if(continueRes.status !== 204) {
    const err = 'unable to save Continue' + continueRes.data;
    showErr(err);
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
    showErr(
        `saveMark, id:${id}, inMark:${inMark}`);
    throw e; 
  } 
  if(markRes.status !== 204) {
    const err = 'unable to save Mark ' + markRes.data;
    showErr(err);
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
    showErr(
        `saveLinda, id:${id}, inLinda:${inLinda}`);
    throw e; 
  } 
  if(lindaRes.status !== 204) {
    const err = 'unable to save Linda' + lindaRes.data;
    showErr(err);
    throw new Error(err);
  }
}

export const deleteWaitAndNoemby = async (name) => {
  console.log('deleteWaitAndNoemby:', name);
  await srvr.delWaiting(name);
  await srvr.delNoEmby(name);
}

/////////////////////  RANDOM RESULTS  ///////////////////////

/*

https://dev.emby.media/doc/restapi/index.html
https://dev.emby.media/doc/restapi/Item-Information.html
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