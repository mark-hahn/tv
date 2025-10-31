let cred;

/*
https://dev.emby.media/doc/restapi/index.html
https://dev.emby.media/doc/restapi/Item-Information.html
https://dev.emby.media/reference/RestAPI.html
https://dev.emby.media/home/sdk/apiclients/index.html
*/

export function init(credIn) { 
  cred = credIn; 
}

export function showListUrl(cred, startIdx=0, limit=10000) {
  return `https://hahnca.com:8920 / emby / Users 
          / ${cred.markUsrId} / Items
    ?SortBy=SortName
    &SortOrder=Ascending
    &IncludeItemTypes=Series
    &Recursive=true 
    &Fields= Name              %2c Id                %2c
             IsFavorite        %2c Played            %2c 
             UnplayedItemCount %2c DateCreated       %2c 
             ExternalUrls      %2c Genres            %2c 
             Overview          %2c Path              %2c 
             People            %2c PremiereDate      %2c 
             IsUnaired         %2c ProviderIds
    &StartIndex=${startIdx}
    &ParentId=4514ec850e5ad0c47b58444e17b6346c
    &Limit=${limit}
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function childrenUrl(cred, parentId='', unAired=false) {
  if(parentId.startsWith("noemby-")) {
    console.error(`childrenUrl, noemby parentId: ${parentId}`);
    return '';
  }
  return `https://hahnca.com:8920 / emby / Users 
          / ${cred.markUsrId} / Items /
    ? ParentId=${parentId}
    ${unAired ? '& IsUnaired = true' : ''}
    & Fields = MediaSources,DateCreated,Genres,Overview,People,ProviderIds,ExternalUrls,Path,SortName,ProductionYear,Status,UserData,PlayAccess,IsFolder,Type,Tags,PremiereDate
    & X-Emby-Token = ${cred.token}
  `.replace(/\s*/g, "");
}

export function postUserDataUrl(cred, id) {
  return `https://hahnca.com:8920 / emby / Users 
          / ${cred.markUsrId} / Items / ${id} / UserData
    ? X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function favoriteUrl(cred, id) {
  return encodeURI(`https://hahnca.com:8920 / emby / Users 
          / ${cred.markUsrId} / FavoriteItems / ${id}
    ?X-Emby-Client=Emby Web
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=1.0.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, ""));
}

export function deleteShowUrl(cred, id) {
  return `https://hahnca.com:8920 / emby / Items / ${id}
    ?X-Emby-Client=EmbyWeb
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=4.6.4.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function embyPageUrl(id) {
  return `https://hahnca.com:8920 / web / index.html #! / item
    ?id=${id}&serverId=ae3349983dbe45d9aa1d317a7753483e
  `.replace(/\s*/g, "");
}

export function collectionListUrl(cred, collId) {
  return `https://hahnca.com:8920 / emby / Users / 
          ${cred.markUsrId} / Items
    ?ParentId=${collId}
    &ImageTypeLimit=1
    &Fields=PrimaryImageAspectRatio,ProductionYear,CanDelete
    &EnableTotalRecordCount=false
    &X-Emby-Client=EmbyWeb
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=4.6.4.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function collectionUrl(cred, showId, collId) {
  return `https://hahnca.com:8920 / emby / 
          Collections / ${collId} / Items
    ?Ids=${showId}
    &userId=${cred.markUsrId}
    &X-Emby-Client=Emby Web
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=4.6.4.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}
 /////////////////// api key urls ////////////////////////

const markUsrId = "894c752d448f45a3a1260ccaabd0adff";
const apiKey    ='9863c23d912349599e395950609c84cc';
const hahnca    = 'https://hahnca.com:8920/emby/';

export function playUrl(sessionId, episodeId) {
  return {url: `${hahnca}  Sessions /
                ${sessionId} / Playing
                ? ItemIds     = ${episodeId} 
                & PlayCommand = PlayNow
                & api_key     = ${apiKey} `
                .replace(/\s*/g, ""),
          body: {
            ControllingUserId:   markUsrId,
            SubtitleStreamIndex: 0,
            AudioStreamIndex:    0,
            StartIndex:          0,
          }
        };
}

export function stopUrl(sessionId) {
  return {url: `${hahnca}  Sessions /
                ${sessionId} / Playing / stop
                ? api_key = ${apiKey} `
                .replace(/\s*/g, ""),
          body: {
            ControllingUserId:   markUsrId,
            Command: "Stop",
            SeekPositionTicks: 0,
          }
        };
}
