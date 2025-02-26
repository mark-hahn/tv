import * as urls from "./urls.js";
import     fetch from 'node-fetch';

const deviceNameByDeviceId = {
  "ca632bcd-7279-4fc2-b5b8-6f92ae6ddb08": "mlap2",
  "2095c65339b60175"                    : "chromecast",
  "9f53d43e-e5f7-5161-881a-d91843d0d372": "roku",
  "ae3349983dbe45d9aa1d317a7753483e"    : "tvMaint_chrome", 
  "aab13fa6d995d7cc"                    : "lindaTab",
}
/*
export const devices = [
  ["ca632bcd-7279-4fc2-b5b8-6f92ae6ddb08", "mlap2",                      ],
  [    "ae3349983dbe45d9aa1d317a7753483e", "tvMaint_chrome",             ],
  [                    "2095c65339b60175", "chromecast",                 ],  
  ["f4079adb-6e48-4d54-9185-5d92d3b7176b", "embyWeb_chrome",             ],
  [                    "aab13fa6d995d7cc", "lindaTab",                   ],
  ["990deeb0-2421-4136-b888-cd8abf09830a", "embyWeb_chromeWindows",      ],
  ["9f53d43e-e5f7-5161-881a-d91843d0d372", "roku",                       ],
  ["a20a0d2a-efa0-4da9-a715-29fbc7ccacab", "embyWeb_googleChromeWindows",],
];
*/

export const deviceIsOn = async (deviceId) => {
  let  resp = await fetch(urls.sessionUrl(deviceId));
  if (resp.status !== 200) {
    console.error(`error deviceIsOff resp: ${resp.statusText}`);
    return true;
  }
  const session = await resp.json();
  return !!session?.Data;
}

export const getOnDevices = async () => {
  const url = urls.watchingUrl();
  let  resp = await fetch(url);
  if (resp.status !== 200) {
    console.error(`error getOnDevices resp: ${resp.statusText}`);
    return [];
  }
  const respData = await resp.json();
  if(!respData || respData.length === 0) return [];
  const devicesOn = [];
  for(const deviceState of respData) {
    const {Id, DeviceId, DeviceName, Client, 
           NowPlayingItem, PlayState} = deviceState;
    if(!NowPlayingItem) {
      if(await deviceIsOn(DeviceId)) 
          devicesOn.push({deviceId, deviceName});
      continue;
    }
    const deviceId   = DeviceId;
    const deviceName = deviceNameByDeviceId[DeviceId] 
           ?? `${DeviceName}_${Client}`.replaceAll(/\s/g, '');  
    const sessionId = Id;
    const showName  = NowPlayingItem.SeriesName;
    // (13185330000-12584950000) == (60*1000*1000*10), (tick == 100ns)
    const positionTicks = PlayState.PositionTicks;
    console.log(
        `Watching ${showName} on ${deviceName} at ${positionTicks}`);
    devicesOn.push({deviceId, deviceName, 
                    sessionId, showName, positionTicks});
  }
  return devicesOn;
}

export const getShowing = async (id, _param, resolve, _reject) => {
  const onDevices = await getOnDevices();
  resolve([id, onDevices]);
}

// getCurrentlyWatching().then(console.log);
