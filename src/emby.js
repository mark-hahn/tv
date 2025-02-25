import * as urls from "./urls.js";
import     fetch from 'node-fetch';

export const devices = [
  ["ca632bcd-7279-4fc2-b5b8-6f92ae6ddb08", "mlap2",                      ],
  [    "ae3349983dbe45d9aa1d317a7753483e", "tvMaint_chrome",             ],
  [                    "2095c65339b60175", "chromecast",                 ],  
  ["f4079adb-6e48-4d54-9185-5d92d3b7176b", "embyWeb_chrome",             ],
  [                    "aab13fa6d995d7cc", "embyForAndroid_SM_X700",     ], // phone?
  ["990deeb0-2421-4136-b888-cd8abf09830a", "embyWeb_chromeWindows",      ],
  ["9f53d43e-e5f7-5161-881a-d91843d0d372", "roku",                       ],
  ["a20a0d2a-efa0-4da9-a715-29fbc7ccacab", "embyWeb_googleChromeWindows",],
];

// get currently watching show
// copied from client emby.js
export const getCurrentlyWatching = async () => {
  const url = urls.watchingUrl();
  let  resp = await fetch(url);
  if (resp.status !== 200) {
    console.error(`error getCurrentlyWatching resp: ${resp.statusText}`);
    return [];
  }
  const respData = await resp.json();
  if(!respData || respData.length === 0) return [];

  const shows = [];
  for(const deviceResp of respData) {
    const {DeviceId, NowPlayingItem, PlayState} = deviceResp;
    if(!NowPlayingItem) continue;
    if((PlayState.PositionTicks ?? 0) === 0) continue;
    const device = devices.find(
        (device) => device[0] === DeviceId);
    if(!device) continue;
    const deviceName = device[1];
    const showName   = NowPlayingItem.SeriesName;
    console.log(`Watching on ${deviceName}: ${showName}`);
    shows.push({showName, deviceName});
  }
  return shows;
}

getCurrentlyWatching().then(console.log);
