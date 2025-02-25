/////////////////// api key urls ////////////////////////
// copied from client urls.js

const apiKey='9863c23d912349599e395950609c84cc';
const hahnca = 'https://hahnca.com:8920/emby/';

export function watchingUrl() {
  return `${hahnca} Sessions ? api_key = ${apiKey}`
          .replace(/\s*/g, "");
}

export function embyPageUrl(id) {
  return `https://hahnca.com:8920 / web / index.html #! / item
    ?id=${id}&serverId=ae3349983dbe45d9aa1d317a7753483e
  `.replace(/\s*/g, "");
}

// show all players
// const url = watchingUrl();
// let  resp = await fetch(url);
// if (resp.status !== 200) {
//   console.error(`error getCurrentlyWatching resp: ${resp.statusText}`);
// }
// else {
//   const dataJson = await resp.json();
//   console.log({dataJson});
// };