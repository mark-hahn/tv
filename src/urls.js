/////////////////// api key urls ////////////////////////
// copied from client urls.js

const apiKey='9863c23d912349599e395950609c84cc';
const hahnca = 'https://hahnca.com:8920/emby/';

const deviceId = (player) => 
        (player == 'roku') 
        ? '9f53d43e-e5f7-5161-881a-d91843d0d372'   
        : 'ca632bcd-7279-4fc2-b5b8-6f92ae6ddb08';
        
export function watchingUrl(player) {
        return `${hahnca}   Sessions
        ? deviceId = ${deviceId(player)} 
        & api_key  = ${apiKey}`
        .replace(/\s*/g, "");
}

export function embyPageUrl(id) {
  return `https://hahnca.com:8920 / web / index.html #! / item
    ?id=${id}&serverId=ae3349983dbe45d9aa1d317a7753483e
  `.replace(/\s*/g, "");
}
