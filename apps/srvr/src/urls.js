/////////////////// api key urls ////////////////////////
// copied from client urls.js

const apiKey = "9863c23d912349599e395950609c84cc";
const hahnca = "http://hahnca.com:8096/emby/";
const markUsrId = "894c752d448f45a3a1260ccaabd0adff";

export function watchingUrl() {
  return `${hahnca} Sessions 
    ? api_key = ${apiKey}`.replace(/\s*/g, "");
}

export function sessionUrl(deviceId) {
  return `${hahnca}   Sessions
        ? ControllableByUserId = ${markUsrId}
        & deviceId = ${deviceId} 
        & api_key  = ${apiKey}`.replace(/\s*/g, "");
}

export function embyPageUrl(id) {
  return `https://hahnca.com:8920 / web / index.html #! / item
    ?id=${id}&serverId=ae3349983dbe45d9aa1d317a7753483e
  `.replace(/\s*/g, "");
}

export function viewingUrl(sessionId, showId, showName, episodeId) {
  const name = encodeURIComponent(showName);
  if (episodeId) {
    return `${hahnca}Sessions/${sessionId}/Viewing?ItemType=Episode&ItemId=${episodeId}&ItemName=${name}&api_key=${apiKey}`;
  }
  return `${hahnca}Sessions/${sessionId}/Viewing?ItemType=Series&ItemId=${showId}&ItemName=${name}&api_key=${apiKey}`;
}

export function playingUrl(sessionId, episodeId, startPositionTicks = 0) {
  const start = startPositionTicks
    ? `&StartPositionTicks=${startPositionTicks}`
    : "";
  return {
    url:
      `${hahnca}Sessions/${sessionId}/Playing` +
      `?ItemIds=${episodeId}&PlayCommand=PlayNow${start}&api_key=${apiKey}`,
    body: {
      ControllingUserId: markUsrId,
      SubtitleStreamIndex: 0,
      AudioStreamIndex: 0,
      StartIndex: 0,
    },
  };
}

export function childrenUrl(parentId = "", unAired = false) {
  if (!parentId) return "";
  return `${hahnca} Users
          / ${markUsrId} / Items /
    ? ParentId=${parentId}
    ${unAired ? "& IsUnaired = true" : ""}
    & Fields = MediaSources,DateCreated,Genres,Overview,People,ProviderIds,ExternalUrls,Path,SortName,ProductionYear,Status,UserData,PlayAccess,IsFolder,Type,Tags,PremiereDate
    & api_key = ${apiKey}
  `.replace(/\s*/g, "");
}

export function updateUserDataUrl(itemId) {
  return `${hahnca}Users/${markUsrId}/Items/${itemId}/UserData?api_key=${apiKey}`;
}
