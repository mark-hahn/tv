import * as urls from "./urls.js";
import fetch from "node-fetch";
import * as epd from "@tv/share";
import { unilog } from "@tv/share";

const deviceNameByDeviceId = {
  "ca632bcd-7279-4fc2-b5b8-6f92ae6ddb08": "mlap2",
  "2095c65339b60175": "chromecast",
  "9f53d43e-e5f7-5161-881a-d91843d0d372": "roku",
  ae3349983dbe45d9aa1d317a7753483e: "tvMaint_chrome",
  aab13fa6d995d7cc: "lindaTab",
};

const deviceIsOn = async (deviceId) => {
  let resp = await fetch(urls.sessionUrl(deviceId));
  if (resp.status !== 200) {
    unilog(104, `error deviceIsOn resp: ${resp.statusText}`); // log-id: 104
    return true;
  }
  const session = await resp.json();
  return !!session.length;
};

export const getOnDevices = async () => {
  const url = urls.watchingUrl();
  let resp = await fetch(url);
  if (resp.status !== 200) {
    unilog(105, `error getOnDevices resp: ${resp.statusText}`); // log-id: 105
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

export const viewShowOnLivingRoomTv = async ({
  showId,
  showName,
  episodeId,
}) => {
  const url = urls.watchingUrl();
  let resp = await fetch(url);
  if (resp.status !== 200) return { found: false };
  const sessions = await resp.json();
  const session = sessions.find((s) => s.DeviceName === "Living Room TV");
  if (!session) return { found: false };
  const viewUrl = urls.viewingUrl(session.Id, showId, showName, episodeId);
  await fetch(viewUrl, { method: "POST" });
  return { found: true };
};

// Fetch series map from Emby server
export const getSeriesMap = async (show) => {
  if (!show?.id) return null;

  const seriesId = show.id;
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
        const pos = episodeRec?.UserData?.PlaybackPositionTicks || 0;
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
            id: episodeRec.Id,
            pos,
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

      unilog(106, `safeGet retry ${i + 1}/${retries} for ${url} - ${msg}`); // log-id: 106
      if (i === retries - 1) throw error;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
};

const getShowState = (showName, showMeta) => {
  // active rows have watched with no watched at end
  // or last epi in last row watched
  let firstEpisode = true;
  let ready = false;
  let checkedReady = false;
  let anyWatched = false;
  let lastWatched = false;
  let watchedShow = false;
  let unwatchedAfterWatched = false;
  let watchGap = false;
  let haveFileShow = false;
  let noFileAfterFile = false;
  let sawUnwatchedNoFile = false;
  let fileGap = false;
  let watchGapSeason = null;
  let watchGapEpisode = null;
  let fileGapSeason = null;
  let fileGapEpisode = null;
  let fileEndError = false;
  let fileEndErrorSeason = null;
  let fileEndErrorEpisode = null;
  let lastSeasonWatched = false;
  let seasonWatchedThenNofile = false;
  let seasonWatchedThenNofileSeason = null;
  let seasonWatchedThenNofileEpisode = null;
  let firstNoFileSeason = null;
  let firstNoFileEpisode = null;
  let anyUnaired = false;
  let sawAnyEpisode = false;
  let anyAiredEpisode = false;
  let fileCount = 0;
  let firstEpisodeFileUnwatched = false;
  let onlyFirstEpisodeHasFile = true;
  let anyEpisodeNoFile = false;
  let anyAiredEpisodeNotWatched = false;
  let anyEpisodeNeitherWatchedNorFile = false;

  try {
    const ed = showMeta?.episodeData;
    const seasons = epd.seasonsPresent(ed);

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

    const today = toYyyyMmDd(new Date());

    // Once we hit an unaired episode, treat all later episodes as unaired.
    let unairedFromHere = false;

    for (const seasonNumber of seasons) {
      const season = ed[seasonNumber];
      let watchedSeason = false;

      let fileEndCount = 0;
      let fileEndStartEpisode = null;
      let firstEpisodeOfSeason = null;
      let seasonNotWatchedNoFiles = true;
      let allSeasonWatched = true;

      for (let i = 0; i < season.length; i++) {
        if (!Array.isArray(season[i])) continue;
        const episodeNumber = i + 1;
        if (firstEpisodeOfSeason === null) firstEpisodeOfSeason = episodeNumber;
        sawAnyEpisode = true;
        const watched = epd.isWatched(ed, seasonNumber, episodeNumber);
        // File on disk is authoritative; it also overrides "unaired".
        const haveFile = epd.hasFile(ed, seasonNumber, episodeNumber);
        const onDisk = haveFile;
        const aired = epd.getAired(ed, seasonNumber, episodeNumber);
        const rawUnaired = aired ? aired > today : false;

        // A file on disk overrides unaired — it clearly aired if we have it
        if (haveFile) fileCount++;
        if (firstEpisode && haveFile && !watched) {
          firstEpisodeFileUnwatched = true;
        }
        if (!firstEpisode && (haveFile || watched)) {
          onlyFirstEpisodeHasFile = false;
        }

        let unaired = unairedFromHere || rawUnaired;
        if (watched) unaired = false;
        else if (onDisk)
          unaired = false; // file on disk overrides unaired
        else if (unaired) unairedFromHere = true;
        if (unaired) anyUnaired = true;
        if (!unaired) anyAiredEpisode = true;

        if (!haveFile && !unaired) anyEpisodeNoFile = true;
        if (!watched && !unaired) anyAiredEpisodeNotWatched = true;
        if (!watched && !haveFile && !unaired)
          anyEpisodeNeitherWatchedNorFile = true;

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
        if (!checkedReady && lastWatched && !watched && !unaired) {
          checkedReady = true;
          ready = haveFile;
        }
        if (watched) {
          watchedShow = true;
          watchedSeason = true;
        }
        if (watchedShow && !watched) unwatchedAfterWatched = true;
        if (!watchGap && unwatchedAfterWatched && watched) {
          if (watchGapSeason === null) {
            watchGapSeason = seasonNumber;
            watchGapEpisode = episodeNumber;
          }
          watchGap = true;
        }

        if (!haveFile && !watched && !unaired) {
          if (fileEndCount === 0) fileEndStartEpisode = episodeNumber;
          fileEndCount++;
        } else {
          fileEndCount = 0;
          fileEndStartEpisode = null;
        }

        const effectiveHaveFile = haveFile || watched;
        haveFileShow ||= effectiveHaveFile;
        if (haveFileShow && !effectiveHaveFile && !unaired)
          noFileAfterFile = true;
        if (!fileGap && noFileAfterFile && effectiveHaveFile) {
          if (fileGapSeason === null) {
            fileGapSeason = seasonNumber;
            fileGapEpisode = episodeNumber;
          }
          console.log(
            `[getShowState] fileGap set for ${showName} S${seasonNumber}E${episodeNumber}`,
          );
          fileGap = true;
        }
        if (!watched && !haveFile && !unaired) sawUnwatchedNoFile = true;
        if (!watched && haveFile && !unaired && sawUnwatchedNoFile) {
          if (!fileGap && !lastWatched) {
            if (fileGapSeason === null) {
              fileGapSeason = seasonNumber;
              fileGapEpisode = episodeNumber;
            }
            console.log(
              `[getShowState] fileGap (unwatched noFile before unwatched file) set for ${showName} S${seasonNumber}E${episodeNumber}`,
            );
            fileGap = true;
          }
          sawUnwatchedNoFile = false;
        }
        seasonNotWatchedNoFiles &&= !(haveFile || unaired || watched);

        lastWatched = watched;
      }
      if (!seasonNotWatchedNoFiles && fileEndCount > 2) {
        console.log(
          `[getShowState] fileEndError set for ${showName} S${seasonNumber}: fileEndCount=${fileEndCount} fileCount=${fileCount}`,
        );
        fileEndError = true;
        if (fileEndErrorSeason === null) {
          fileEndErrorSeason = seasonNumber;
          fileEndErrorEpisode = fileEndStartEpisode;
        }
      }
      if (lastSeasonWatched && !allSeasonWatched && seasonNotWatchedNoFiles) {
        if (seasonWatchedThenNofileSeason === null) {
          seasonWatchedThenNofileSeason = seasonNumber;
          seasonWatchedThenNofileEpisode = firstEpisodeOfSeason;
        }
        seasonWatchedThenNofile = true;
      }
      lastSeasonWatched = allSeasonWatched;
    }

    const tryingShow =
      !anyWatched && firstEpisodeFileUnwatched && onlyFirstEpisodeHasFile;

    const allEpisodesUnaired = sawAnyEpisode && anyUnaired && !anyAiredEpisode;
    const showStatus = String(showMeta?.tvdbStatus || "").trim();
    const firstAired = String(showMeta?.firstAired || "").trim();
    const startDateInFuture = !!firstAired && firstAired > today;
    const skipMissingFileGap =
      !showMeta?.inEmby ||
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
    if (skipMissingFileGap || tryingShow) {
      fileGap = false;
      fileGapSeason = null;
      fileGapEpisode = null;
      fileEndError = false;
      fileEndErrorSeason = null;
      fileEndErrorEpisode = null;
      seasonWatchedThenNofile = false;
      seasonWatchedThenNofileSeason = null;
      seasonWatchedThenNofileEpisode = null;
      watchGap = false;
      watchGapSeason = null;
      watchGapEpisode = null;
    }
  } catch (error) {
    console.error("getShowState error:", error.message);
    return null;
  }
  return {
    notReady: !ready,
    anyWatched,
    fileEndError,
    fileEndErrorSeason,
    fileEndErrorEpisode,
    seasonWatchedThenNofile,
    seasonWatchedThenNofileSeason,
    seasonWatchedThenNofileEpisode,
    watchGap,
    watchGapSeason,
    watchGapEpisode,
    fileGap,
    fileGapSeason,
    fileGapEpisode,
    allAiredHaveFile: sawAnyEpisode && !anyEpisodeNoFile,
    allAiredWatched: sawAnyEpisode && !anyAiredEpisodeNotWatched,
    allWatchedOrHaveFile: sawAnyEpisode && !anyEpisodeNeitherWatchedNorFile,
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

  const showState = getShowState(showName, tvdbRecord);

  if (!showState) {
    unilog(107, `getShowState returned null for ${showName}`); // log-id: 107
    return null;
  }

  const {
    notReady,
    anyWatched,
    fileEndError,
    fileEndErrorSeason,
    fileEndErrorEpisode,
    watchGap,
    watchGapSeason,
    watchGapEpisode,
    fileGap,
    fileGapSeason,
    fileGapEpisode,
    seasonWatchedThenNofile,
    seasonWatchedThenNofileSeason,
    seasonWatchedThenNofileEpisode,
    allAiredHaveFile,
    allAiredWatched,
    allWatchedOrHaveFile,
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
    fileEndErrorSeason,
    fileEndErrorEpisode,
    seasonWatchedThenNofile,
    seasonWatchedThenNofileSeason,
    seasonWatchedThenNofileEpisode,
    allAiredHaveFile,
    allAiredWatched,
    allWatchedOrHaveFile,
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
