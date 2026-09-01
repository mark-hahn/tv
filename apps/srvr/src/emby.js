import fs from "fs";
import * as urls from "./urls.js";
import fetch from "node-fetch";
import * as epd from "@tv/share";
import { unilog, logHere } from "@tv/share";

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
    unilog(104, `error deviceIsOn resp: ${resp.statusText}`);
    return true;
  }
  const session = await resp.json();
  return !!session.length;
};

export const getOnDevices = async () => {
  const url = urls.watchingUrl();
  let resp = await fetch(url);
  if (resp.status !== 200) {
    unilog(105, `error getOnDevices resp: ${resp.statusText}`);
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

// Emby's remote play command needs one episode. A Map cell names one outright;
// otherwise it is the show's next-up episode -- the first one that is unwatched
// and has a file, the same one the info pane calls Next Up. The record comes
// from the series map either way so playback can resume where it left off.
const playTargetEpisode = async (showId, episodeId) => {
  const seriesMap = await getSeriesMap({ id: showId });
  if (!seriesMap) return episodeId ? { id: episodeId, pos: 0 } : null;
  const seasons = [...seriesMap].sort((a, b) => a[0] - b[0]);
  for (const [seasonNumber, episodes] of seasons) {
    if (seasonNumber <= 0) continue;
    for (const [, episode] of [...episodes].sort((a, b) => a[0] - b[0])) {
      if (episodeId) {
        if (episode.id === episodeId) return episode;
        continue;
      }
      if (episode.played || episode.noFile || !episode.avail || episode.unaired)
        continue;
      return episode;
    }
  }
  return episodeId ? { id: episodeId, pos: 0 } : null;
};

const playOnSession = async (sessionId, showId, showName, episodeId) => {
  const episode = await playTargetEpisode(showId, episodeId);
  if (!episode) {
    unilog(1894, `no episode to play for ${showName}`);
    return;
  }
  const { url, body } = urls.playingUrl(sessionId, episode.id, episode.pos);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok)
    unilog(
      1895,
      `play rejected for ${showName} episode ${episode.id}: ${resp.status}`,
    );
};

export const viewShowOnLivingRoomTv = async ({
  showId,
  showName,
  episodeId,
  play,
}) => {
  const url = urls.watchingUrl();
  let resp = await fetch(url);
  if (resp.status !== 200) return { found: false };
  const sessions = await resp.json();
  // The Emby app registers more than one "Living Room TV" session (same
  // DeviceId, different Client names) and they all claim SupportsRemoteControl,
  // but only one is live — the dead ones answer the Viewing POST with a 500
  // "NotFound". So try each in turn and keep the first that actually accepts it.
  const candidates = sessions.filter((s) => s.DeviceName === "Living Room TV");
  if (candidates.length === 0) return { found: false };
  for (const session of candidates) {
    const viewUrl = urls.viewingUrl(session.Id, showId, showName, episodeId);
    const viewResp = await fetch(viewUrl, { method: "POST" });
    if (viewResp.ok) {
      if (play) await playOnSession(session.Id, showId, showName, episodeId);
      return { found: true, client: session.Client };
    }
    unilog(
      1388,
      `Viewing rejected by ${session.Client} session ${session.Id}: ${viewResp.status}`,
    );
  }
  return { found: false };
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
    unilog(690, "getSeriesMap error:", err);
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

      if (i === retries - 1) {
        unilog(
          1728,
          `safeGet gave up for ${url} after ${retries} attempts: ${msg}`,
        );
        throw error;
      }
      unilog(
        1729,
        `safeGet failed for ${url} (attempt ${i + 1}/${retries}): ${msg}, retrying`,
      );
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
};

export const ignoreStrayKey = (season, episode) => `S${season}E${episode}`;

const TV_DIR = "/mnt/media/tv";

// Sign a stray result: episode, filename, size and mtime of every stray. An
// ignore is only good against the exact result it was granted for, and this is
// what "the same result" means.
function signStrays(showName, rec, strays) {
  return strays
    .map((s) => {
      let size = "?";
      let mtime = "?";
      const full = epd.getFullPath(
        rec?.episodeData,
        folderOfRecord(showName, rec),
        s.season,
        s.episode,
        TV_DIR,
      );
      if (full) {
        try {
          const st = fs.statSync(full);
          size = st.size;
          mtime = Math.round(st.mtimeMs);
        } catch {
          // Unreadable counts as its own state, and differs from a good stat.
        }
      }
      return `${ignoreStrayKey(s.season, s.episode)}|${s.name}|${size}|${mtime}`;
    })
    .sort()
    .join(";");
}

// Sign the whole gap-check result: every occurrence of every gap type, plus
// the stray file identities. Any movement here retires every ignore the show
// has, because an ignore was a judgement about this exact result.
function signGaps(showName, rec, hits, strays) {
  const parts = [];
  for (const kind of Object.keys(hits).sort()) {
    const list = hits[kind]
      .map((h) => ignoreStrayKey(h.season, h.episode))
      .sort()
      .join(",");
    if (list) parts.push(`${kind}:${list}`);
  }
  const straySig = signStrays(showName, rec, strays);
  if (straySig) parts.push(`stray:${straySig}`);
  return parts.join(";");
}

/**
 * The signature of a record's gap result right now, for callers granting an
 * ignore. Without stamping this at grant time the next gap check compares
 * against a stale signature and throws the new ignore straight away.
 *
 * Derived from the same getShowState pass so the two can never disagree.
 */
export function currentGapSig(showName, rec) {
  const state = getShowState(showName, {
    ...rec,
    ignoreGaps: [],
    gapSig: null,
  });
  return state?.gapSig ?? "";
}

// The folder a record's files live in, without pulling in showPaths (which
// would import tvdb.js and close a cycle back to here).
const folderOfRecord = (showName, rec) =>
  String(rec?.path || rec?.emby?.path || showName || "")
    .split("/")
    .pop();

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
  let resDrop = false;
  let resDropSeason = null;
  let resDropEpisode = null;
  let strayCount = 0;
  let strayFiles = [];
  let straySeason = null;
  let strayEpisode = null;
  // Every occurrence of every gap, collected during the pass and judged after
  // it. The flags below still latch on the first hit so the pass itself is
  // unchanged, but the reported values are re-derived from these lists once
  // ignoreGaps is known -- an ignored episode must not hide a later one.
  let gapSig = "";
  let ignoreGaps = [];
  const rawStrays = [];
  const hits = {
    watchGap: [],
    fileGap: [],
    resDrop: [],
    fileEndError: [],
    seasonWatchedThenNofile: [],
  };
  const hit = (kind, season, episode) => {
    if (season == null || episode == null) return;
    hits[kind].push({ season, episode });
  };
  let bestResSoFar = null;
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
        resDrop: false,
        resDropSeason: null,
        resDropEpisode: null,
        stray: false,
        strayCount: 0,
        strayFiles: [],
        straySeason: null,
        strayEpisode: null,
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

        // A file for an episode TVDB never gave an air date. One of these is
        // usually TVDB lagging behind a just-aired episode; a cluster of them
        // in one season is the signature of a different show misfiled into
        // this show's folder, which is what let a 10-episode DVDRip pose as
        // Guilt (2019)'s 4-episode season 1. Recorded here rather than acted
        // on, because the two cases look identical from episodeData alone.
        //
        // Collected raw here; ignoring is applied after the pass, because
        // whether an ignore still counts depends on the whole result.
        if (haveFile && !aired) {
          rawStrays.push({
            season: seasonNumber,
            episode: episodeNumber,
            name: epd.getFileName(ed, seasonNumber, episodeNumber) || "",
          });
        }

        // Resolution drop: any episode file lower res than an earlier one.
        if (haveFile) {
          const res = epd.getRes(ed, seasonNumber, episodeNumber);
          if (res) {
            if (bestResSoFar !== null && res < bestResSoFar && !watched)
              hit("resDrop", seasonNumber, episodeNumber);
            if (
              bestResSoFar !== null &&
              res < bestResSoFar &&
              !resDrop &&
              !watched
            ) {
              resDropSeason = seasonNumber;
              resDropEpisode = episodeNumber;
              resDrop = true;
              // Logged only as it turns on or moves to another episode, so a
              // standing drop does not repeat every gap check.
              const resDropIsNew =
                !showMeta?.resDrop ||
                showMeta.resDropSeason !== seasonNumber ||
                showMeta.resDropEpisode !== episodeNumber;
              if (resDropIsNew) {
                unilog(2323, `resDrop set for ${showName} S${seasonNumber}E${episodeNumber}: ${res} < ${bestResSoFar}`);
              }
            }
            if (bestResSoFar === null || res > bestResSoFar) bestResSoFar = res;
          }
        }
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
        if (unwatchedAfterWatched && watched)
          hit("watchGap", seasonNumber, episodeNumber);
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
        if (noFileAfterFile && effectiveHaveFile)
          hit("fileGap", seasonNumber, episodeNumber);
        if (!fileGap && noFileAfterFile && effectiveHaveFile) {
          if (fileGapSeason === null) {
            fileGapSeason = seasonNumber;
            fileGapEpisode = episodeNumber;
          }
          unilog(
            691,
            `fileGap set for ${showName} S${seasonNumber}E${episodeNumber}`,
          );
          fileGap = true;
        }
        if (!watched && !haveFile && !unaired) sawUnwatchedNoFile = true;
        if (!watched && haveFile && !unaired && sawUnwatchedNoFile) {
          if (!lastWatched) hit("fileGap", seasonNumber, episodeNumber);
          if (!fileGap && !lastWatched) {
            if (fileGapSeason === null) {
              fileGapSeason = seasonNumber;
              fileGapEpisode = episodeNumber;
            }
            unilog(
              692,
              `fileGap (unwatched noFile before unwatched file) set for ${showName} S${seasonNumber}E${episodeNumber}`,
            );
            fileGap = true;
          }
          sawUnwatchedNoFile = false;
        }
        seasonNotWatchedNoFiles &&= !(haveFile || unaired || watched);

        lastWatched = watched;
      }
      if (!seasonNotWatchedNoFiles && fileEndCount > 2)
        hit("fileEndError", seasonNumber, fileEndStartEpisode);
      if (!seasonNotWatchedNoFiles && fileEndCount > 2) {
        unilog(
          693,
          `fileEndError set for ${showName} S${seasonNumber}: fileEndCount=${fileEndCount} fileCount=${fileCount}`,
        );
        fileEndError = true;
        if (fileEndErrorSeason === null) {
          fileEndErrorSeason = seasonNumber;
          fileEndErrorEpisode = fileEndStartEpisode;
        }
      }
      if (lastSeasonWatched && !allSeasonWatched && seasonNotWatchedNoFiles)
        hit("seasonWatchedThenNofile", seasonNumber, firstEpisodeOfSeason);
      if (lastSeasonWatched && !allSeasonWatched && seasonNotWatchedNoFiles) {
        if (seasonWatchedThenNofileSeason === null) {
          seasonWatchedThenNofileSeason = seasonNumber;
          seasonWatchedThenNofileEpisode = firstEpisodeOfSeason;
        }
        seasonWatchedThenNofile = true;
      }
      lastSeasonWatched = allSeasonWatched;
    }

    // Re-derive every reported gap from its full occurrence list, skipping
    // ignored episodes. This has to happen here, before the corrections below:
    // those suppress file-missing signals for "trying" and skip-marked shows
    // and add a fileGap of their own, and they must have the last word.
    // Latching on the first hit during the pass would have let one ignored
    // episode hide every later one of the same kind, which is why the pass
    // collects them all instead.
    gapSig = signGaps(showName, showMeta, hits, rawStrays);
    const sigHeld = gapSig === (showMeta?.gapSig ?? null);
    // Earlier names for this list, folded in once and cleared as records pass.
    const legacy = [
      ...(Array.isArray(showMeta?.ignoreStrays) ? showMeta.ignoreStrays : []),
      ...(Array.isArray(showMeta?.strayOk) ? showMeta.strayOk : []),
    ].map((v) => (typeof v === "string" ? v.split("|")[0] : v?.ep));
    ignoreGaps = sigHeld
      ? [
          ...new Set(
            [
              ...(Array.isArray(showMeta?.ignoreGaps)
                ? showMeta.ignoreGaps
                : []),
              ...legacy,
            ].filter(Boolean),
          ),
        ]
      : [];

    const ignoreSet = new Set(ignoreGaps);
    const firstOf = (kind) =>
      hits[kind].filter(
        (h) => !ignoreSet.has(ignoreStrayKey(h.season, h.episode)),
      )[0] || null;
    const wg = firstOf("watchGap");
    watchGap = !!wg;
    watchGapSeason = wg?.season ?? null;
    watchGapEpisode = wg?.episode ?? null;
    const fg = firstOf("fileGap");
    fileGap = !!fg;
    fileGapSeason = fg?.season ?? null;
    fileGapEpisode = fg?.episode ?? null;
    const rd = firstOf("resDrop");
    resDrop = !!rd;
    resDropSeason = rd?.season ?? null;
    resDropEpisode = rd?.episode ?? null;
    const fe = firstOf("fileEndError");
    fileEndError = !!fe;
    fileEndErrorSeason = fe?.season ?? null;
    fileEndErrorEpisode = fe?.episode ?? null;
    const sw = firstOf("seasonWatchedThenNofile");
    seasonWatchedThenNofile = !!sw;
    seasonWatchedThenNofileSeason = sw?.season ?? null;
    seasonWatchedThenNofileEpisode = sw?.episode ?? null;

    for (const s of rawStrays) {
      if (ignoreSet.has(ignoreStrayKey(s.season, s.episode))) continue;
      strayCount++;
      if (straySeason === null) {
        straySeason = s.season;
        strayEpisode = s.episode;
      }
      if (s.name) strayFiles.push(s.name);
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
    unilog(694, `getShowState error for ${showName}:`, error.message);
    return null;
  }
  const strayOk = null;
  const ignoreStrays = null;

  const stray = strayCount > 0;
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
    resDrop,
    resDropSeason,
    resDropEpisode,
    stray,
    strayCount,
    strayFiles,
    straySeason,
    strayEpisode,
    ignoreGaps,
    gapSig,
    ignoreStrays,
    strayOk,
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
    unilog(107, `getShowState returned null for ${showName}`);
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
    resDrop,
    resDropSeason,
    resDropEpisode,
    stray,
    strayCount,
    strayFiles,
    straySeason,
    strayEpisode,
    ignoreGaps,
    gapSig,
    ignoreStrays,
    strayOk,
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
    resDrop,
    resDropSeason,
    resDropEpisode,
    stray,
    strayCount,
    strayFiles,
    straySeason,
    strayEpisode,
    ignoreGaps,
    gapSig,
    ignoreStrays,
    strayOk,
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
