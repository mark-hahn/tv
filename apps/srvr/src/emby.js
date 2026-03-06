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

const toYyyyMmDd = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const safeGet = async (url, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (error) {
      const msg = error.message || String(error);
      // Don't retry on 404
      if (error.message && error.message.includes("404")) throw error;

      console.warn(`safeGet retry ${i + 1}/${retries} for ${url} - ${msg}`);
      if (i === retries - 1) throw error;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
};

const getShowState = async (showId, _showName, showMeta) => {
  // active rows have watched with no watched at end
  // or last epi in last row watched
  let firstEpisode = true;
  let ready = false;
  let checkedReady = false;
  let anyWatched = false;
  let lastWatched = false;
  let watchedShow = false;
  let watchedLastEpiLastSea = true;
  let unwatchedAfterWatched = false;
  let watchGap = false;
  let haveFileShow = false;
  let noFileAfterFile = false;
  let fileGap = false;
  let watchGapSeason = null;
  let watchGapEpisode = null;
  let fileGapSeason = null;
  let fileGapEpisode = null;
  let fileEndError = false;
  let lastSeasonWatched = false;
  let seasonWatchedThenNofile = false;
  let firstNoFileSeason = null;
  let firstNoFileEpisode = null;
  let anyUnaired = false;
  let sawAnyEpisode = false;
  let anyAiredEpisode = false;
  let fileCount = 0;
  let firstEpisodeFileUnwatched = false;

  try {
    const seasonsRes = await safeGet(urls.childrenUrl(showId));
    const seasonsData = await seasonsRes.json();
    const seasons = seasonsData?.Items;
    if (!seasons) {
      console.error("getShowState error: seasons is undefined", { showId });
      return null;
    }

    // If show has no seasons/episodes, it's not ready to watch
    if (seasons.length === 0) {
      return {
        notReady: true,
        anyWatched: false,
        fileEndError: false,
        seasonWatchedThenNofile: false,
        watchGap: false,
        watchGapSeason: null,
        watchGapEpisode: null,
        fileGap: false,
        fileGapSeason: null,
        fileGapEpisode: null,
      };
    }

    // Once we hit an unaired episode, treat all later episodes as unaired.
    let unairedFromHere = false;
    for (let seasonIdx = 0; seasonIdx < seasons.length; seasonIdx++) {
      const season = seasons[seasonIdx];
      const seasonId = season.Id;
      const seasonNumber = season.IndexNumber;
      let watchedSeason = false;

      let fileEndCount = 0;
      let seasonNotWatchedNoFiles = true;
      let allSeasonWatched = true;

      const unairedObj = {};

      const unairedRes = await safeGet(urls.childrenUrl(seasonId, true));
      const unairedData = await unairedRes.json();
      for (let key in unairedData.Items) {
        const episode = unairedData.Items[key];
        const episodeNumber = +episode.IndexNumber;
        unairedObj[episodeNumber] = true;
      }

      const episodesRes = await safeGet(urls.childrenUrl(seasonId));
      const episodesData = await episodesRes.json();
      const episodes = episodesData.Items;
      for (let episodeIdx = 0; episodeIdx < episodes.length; episodeIdx++) {
        const episode = episodes[episodeIdx];
        const episodeNumber = episode.IndexNumber;
        if (episodeNumber === undefined) continue;
        sawAnyEpisode = true;
        const userData = episode?.UserData;
        const watched = !!userData?.Played;
        const haveFile = episode.LocationType != "Virtual";

        if (haveFile) fileCount++;
        if (firstEpisode && haveFile && !watched) {
          firstEpisodeFileUnwatched = true;
        }

        let unaired = unairedFromHere || !!unairedObj[episodeNumber];
        if (watched) unaired = false;
        else if (unaired) unairedFromHere = true;
        if (unaired) anyUnaired = true;
        if (!unaired) anyAiredEpisode = true;

        // Track the first aired episode that has no file.
        if (!unaired && !haveFile && firstNoFileSeason === null) {
          firstNoFileSeason = seasonNumber;
          firstNoFileEpisode = episodeNumber;
        }

        allSeasonWatched &&= watched;
        if (watched) anyWatched = true;

        if (firstEpisode && haveFile && !watched) {
          checkedReady = true;
          ready = true;
        }
        firstEpisode = false;
        if (!checkedReady && lastWatched && !watched) {
          checkedReady = true;
          ready = haveFile;
        }
        if (watched) {
          watchedShow = true;
          watchedSeason = true;
        }
        if (episodeIdx == episodes.length - 1) {
          // last epi in season
          watchedLastEpiLastSea = watched;
        }

        if (watchedShow && !watched) unwatchedAfterWatched = true;
        if (!watchGap && unwatchedAfterWatched && watched) {
          if (watchGapSeason === null) {
            watchGapSeason = seasonNumber;
            watchGapEpisode = episodeNumber;
          }
          watchGap = true;
        }

        if (!haveFile && !watched && !unaired) fileEndCount++;
        else fileEndCount = 0;

        haveFileShow ||= haveFile;
        if (haveFileShow && !haveFile) noFileAfterFile = true;
        if (!fileGap && noFileAfterFile && haveFile) {
          if (fileGapSeason === null) {
            fileGapSeason = seasonNumber;
            fileGapEpisode = episodeNumber;
          }
          fileGap = true;
        }
        seasonNotWatchedNoFiles &&= !(haveFile || unaired || watched);

        lastWatched = watched;
      }
      if (!seasonNotWatchedNoFiles && fileEndCount > 2) {
        if (!(fileCount === 1 && firstEpisodeFileUnwatched)) {
          fileEndError = true;
        }
      }
      if (lastSeasonWatched && !allSeasonWatched && seasonNotWatchedNoFiles)
        seasonWatchedThenNofile = true;
      lastSeasonWatched = allSeasonWatched;
    }

    const allEpisodesUnaired = sawAnyEpisode && anyUnaired && !anyAiredEpisode;
    const showStatus = String(showMeta?.tvdbStatus || "").trim();
    const firstAired = String(showMeta?.firstAired || "").trim();
    const today = toYyyyMmDd(new Date());
    const startDateInFuture = !!firstAired && firstAired > today;
    const skipMissingFileGap =
      allEpisodesUnaired ||
      startDateInFuture ||
      showStatus.toLowerCase() === "upcoming";

    // If a show has no files at all AND nothing watched AND nothing unaired,
    // treat it as Missing File (FileGap).
    if (
      !skipMissingFileGap &&
      !fileGap &&
      sawAnyEpisode &&
      !haveFileShow &&
      !anyWatched &&
      !anyUnaired
    ) {
      if (fileGapSeason === null && firstNoFileSeason !== null) {
        fileGapSeason = firstNoFileSeason;
        fileGapEpisode = firstNoFileEpisode;
      }
      fileGap = true;
    }

    // If we found the first unwatched episode (after watched ones) and it has
    // no file, flag it as a file gap even if fileEndCount is below threshold.
    if (
      !skipMissingFileGap &&
      checkedReady &&
      !ready &&
      anyWatched &&
      !watchGap &&
      !fileGap &&
      !fileEndError &&
      !seasonWatchedThenNofile
    ) {
      if (fileGapSeason === null && firstNoFileSeason !== null) {
        fileGapSeason = firstNoFileSeason;
        fileGapEpisode = firstNoFileEpisode;
      }
      fileGap = true;
    }

    // List/Map treat any of these as "Missing File". If user said skip it,
    // suppress all file-missing related signals.
    if (skipMissingFileGap) {
      fileGap = false;
      fileGapSeason = null;
      fileGapEpisode = null;
      fileEndError = false;
      seasonWatchedThenNofile = false;
    }
  } catch (error) {
    console.error("getShowState error:", error.message);
    return null;
  }
  return {
    notReady: !ready,
    anyWatched,
    fileEndError,
    seasonWatchedThenNofile,
    watchGap,
    watchGapSeason,
    watchGapEpisode,
    fileGap,
    fileGapSeason,
    fileGapEpisode,
  };
};

/**
 * Check gaps for a single show
 * @param {string} showId - Emby show ID
 * @param {string} showName - Show name
 * @param {Object} tvdbRecord - tvdb record for the show
 * @returns {Promise<Object|null>} - Gap data for the show
 */
export const gapCheckOne = async (showId, showName, tvdbRecord) => {
  if (!showId || !tvdbRecord) return null;

  const showState = await getShowState(showId, showName, tvdbRecord);

  if (!showState) {
    console.error(`[gapCheckOne] getShowState returned null for ${showName}`);
    return null;
  }

  const {
    notReady,
    anyWatched,
    fileEndError,
    watchGap,
    watchGapSeason,
    watchGapEpisode,
    fileGap,
    fileGapSeason,
    fileGapEpisode,
    seasonWatchedThenNofile,
  } = showState;

  return {
    notReady,
    anyWatched,
    watchGap,
    watchGapSeason,
    watchGapEpisode,
    fileGap,
    fileGapSeason,
    fileGapEpisode,
    fileEndError,
    seasonWatchedThenNofile,
  };
};

/**
 * Check gaps for multiple shows
 * @param {Array<{showId: string, showName: string, tvdbRecord: Object}>} shows - Array of shows to check
 * @returns {Promise<Object>} - Gap data keyed by show Id
 */
export const gapCheckBatch = async (shows) => {
  const gapData = {};

  for (const { showId, showName, tvdbRecord } of shows) {
    const data = await gapCheckOne(showId, showName, tvdbRecord);
    if (data) {
      gapData[showId] = data;
    }
  }

  return gapData;
};
