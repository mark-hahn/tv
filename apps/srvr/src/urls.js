/////////////////// api key urls ////////////////////////
// copied from client urls.js

const apiKey = "9863c23d912349599e395950609c84cc";
const hahnca = "https://hahnca.com:8920/emby/";
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
