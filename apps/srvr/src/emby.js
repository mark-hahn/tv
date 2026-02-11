import * as urls from "./urls.js";
import fetch from "node-fetch";

const deviceNameByDeviceId = {
  "ca632bcd-7279-4fc2-b5b8-6f92ae6ddb08": "mlap2",
  "2095c65339b60175": "chromecast",
  "9f53d43e-e5f7-5161-881a-d91843d0d372": "roku",
  ae3349983dbe45d9aa1d317a7753483e: "tvMaint_chrome",
  aab13fa6d995d7cc: "lindaTab",
};
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

const deviceIsOn = async (deviceId) => {
  let resp = await fetch(urls.sessionUrl(deviceId));
  if (resp.status !== 200) {
    console.error(`error deviceIsOn resp: ${resp.statusText}`);
    return true;
  }
  const session = await resp.json();
  return !!session.length;
};

export const getOnDevices = async () => {
  const url = urls.watchingUrl();
  let resp = await fetch(url);
  if (resp.status !== 200) {
    console.error(`error getOnDevices resp: ${resp.statusText}`);
    return [];
  }
  const respData = await resp.json();
  if (!respData || respData.length === 0) return [];
  const devicesOn = [];
  for (const deviceState of respData) {
    const { Id, DeviceId, DeviceName, Client, NowPlayingItem, PlayState } =
      deviceState;

    const deviceId = DeviceId;
    const deviceName =
      deviceNameByDeviceId[DeviceId] ??
      `${DeviceName}_${Client}`.replaceAll(/\s/g, "");
    const sessionId = Id;

    if (!NowPlayingItem) {
      if (await deviceIsOn(DeviceId))
        devicesOn.push({ deviceId, deviceName, sessionId });
      continue;
    }
    const showName = NowPlayingItem.SeriesName;
    const seasonNumber = NowPlayingItem.ParentIndexNumber;
    const episodeNumber = NowPlayingItem.IndexNumber;
    const episodeName = NowPlayingItem.Name;
    // (13185330000-12584950000) == (60*1000*1000*10), (tick == 100ns)
    const positionTicks = PlayState.PositionTicks;

    // console.log(
    //     `Watching ${showName} on ${deviceName} at ${positionTicks}`);
    devicesOn.push({
      deviceId,
      deviceName,
      sessionId,
      showName,
      seasonNumber,
      episodeNumber,
      episodeName,
      positionTicks,
    });
  }
  return devicesOn;
};

export const getDevices = async () => {
  return await getOnDevices();
};

// Fetch series map from Emby server
export const getSeriesMap = async (show) => {
  if (!show?.Id) return null;

  const seriesId = show.Id;
  const seriesMap = [];

  try {
    const seasonsRes = await fetch(urls.childrenUrl(seriesId));
    if (seasonsRes.status !== 200) return null;
    const seasonsData = await seasonsRes.json();

    for (const seasonRec of seasonsData.Items || []) {
      const seasonId = seasonRec.Id;
      const seasonNumber = +seasonRec.IndexNumber;
      if (isNaN(seasonNumber)) continue;

      const unairedObj = {};
      const unairedRes = await fetch(urls.childrenUrl(seasonId, true));
      if (unairedRes.status === 200) {
        const unairedData = await unairedRes.json();
        for (const episodeRec of unairedData.Items || []) {
          const episodeNumber = +episodeRec.IndexNumber;
          if (!isNaN(episodeNumber)) {
            unairedObj[episodeNumber] = true;
          }
        }
      }

      const episodes = [];
      const episodesRes = await fetch(urls.childrenUrl(seasonId));
      if (episodesRes.status !== 200) continue;
      const episodesData = await episodesRes.json();

      for (const episodeRec of episodesData.Items || []) {
        const episodeNumber = +episodeRec.IndexNumber;
        if (isNaN(episodeNumber)) continue;

        const path = episodeRec?.MediaSources?.[0]?.Path;
        const played = !!episodeRec?.UserData?.Played;
        const avail = episodeRec?.LocationType !== "Virtual";
        const unaired = avail && path ? false : !!unairedObj[episodeNumber];

        if (avail && !path) continue;

        const noFileVal = !path;
        episodes.push([
          episodeNumber,
          {
            error: false,
            played,
            avail,
            noFile: noFileVal,
            unaired,
            deleted: false,
            path,
          },
        ]);
      }
      seriesMap.push([seasonNumber, episodes]);
    }

    return seriesMap;
  } catch (err) {
    console.error("getSeriesMap error:", err);
    return null;
  }
};

// getCurrentlyWatching().then(console.log);
