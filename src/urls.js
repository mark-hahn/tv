let cred;

export async function init(credIn) { cred = credIn; }

export function showListUrl(cred, startIdx=0, limit=10000) {
  return `http://hahnca.com:8096 / emby / Users 
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
             IsUnaired
    &StartIndex=${startIdx}
    &ParentId=4514ec850e5ad0c47b58444e17b6346c
    &Limit=${limit}
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function childrenUrl(cred, parentId='', unAired=false) {
  return `http://hahnca.com:8096 / emby / Users 
          / ${cred.markUsrId} / Items /
    ? ParentId=${parentId}
    ${unAired ? '& IsUnaired = true' : ''}
    & Fields       = MediaSources
    & X-Emby-Token = ${cred.token}
  `.replace(/\s*/g, "");
}

export function postUserDataUrl(cred, id) {
  return `http://hahnca.com:8096 / emby / Users 
          / ${cred.markUsrId} / Items / ${id} / UserData
    ? X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function favoriteUrl(cred, id) {
  return encodeURI(`http://hahnca.com:8096 / emby / Users 
          / ${cred.markUsrId} / FavoriteItems / ${id}
    ?X-Emby-Client=Emby Web
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=1.0.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, ""));
}

export function deleteShowUrl(cred, id) {
  return `http://hahnca.com:8096 / emby / Items / ${id}
    ?X-Emby-Client=EmbyWeb
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=4.6.4.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function embyPageUrl(id) {
  return `http://hahnca.com:8096 / web / index.html #! / item
    ?id=${id}&serverId=ae3349983dbe45d9aa1d317a7753483e
  `.replace(/\s*/g, "");
}

export function toTryListUrl(cred, ) {
  return `http://hahnca.com:8096 / emby / Users / 
          ${cred.markUsrId} / Items
    ?ParentId=1468316
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

export function toTryUrl(cred, id) {
  return `http://hahnca.com:8096 / emby / 
          Collections / 1468316 / Items
    ?Ids=${id}
    &userId=${cred.markUsrId}
    &X-Emby-Client=Emby Web
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=4.6.4.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

