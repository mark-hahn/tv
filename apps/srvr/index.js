import fs from "fs";
import fsp from "fs/promises";
import * as cp from "child_process";
import * as path from "node:path";
import express from "express";
import cors from "cors";
import https from "https";
import http from "http";
import { rimraf } from "rimraf";
import * as view from "./src/lastViewed.js";
import * as utilNode from "util";
import * as emby from "./src/emby.js";
import * as tvdb from "./src/tvdb.js";
import * as util from "./src/util.js";
import * as email from "./src/email.js";
import * as tmdb from "./src/tmdb.js";
import { handleFix, readFixState, tailFixLog } from "./src/fix.js";
import fetch from "node-fetch";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import {
  parseFileSeasonEpisode,
  smartTitleMatch,
  parseTitleFromFilename,
  normalizeVideoHeightToQuality,
  getResolution,
  STANDARD_RESOLUTIONS,
  applyComputedProps,
  filterShowList,
  sortShowList,
  compareShowNames,
} from "@tv/share";
import * as epd from "@tv/share";
import { unilog, logHere } from "@tv/share";
import chokidar from "chokidar";
import cron from "node-cron";
import {
  SRVR_ROOT_DIR,
  SRVR_DATA_DIR,
  SRVR_SECRETS_DIR,
} from "./src/srvrPaths.js";
import * as groupCounts from "./src/groupCounts.js";
import * as urls from "./src/urls.js";
import * as unilogDb from "./src/unilogDb.js";
import { srtTimeToMs, msToSrtTime } from "./src/srt.js";
import {
  CONFIG_DIR,
  ensureDir,
  configReadCandidates,
  readTextOrWithChosenPath,
  configWritePath,
} from "./src/config.js";
import {
  videoFileExtensions,
  resStripAlt,
  resFindEpisodeVideos,
} from "./src/videoFiles.js";
import {
  syncBadGroupsFromDisk,
  writeBadGroupsToDisk,
  hasBadGroup,
  isBadGroup,
} from "./src/badGroups.js";
import {
  flexgetFmtSent,
  flexgetIsBetterSameRun,
  flexgetIsBetterCrossRun,
  parseResolutionStrict,
  getFirstFilesOnDiskSeasonGap,
} from "./src/flexgetScore.js";
import { subsSearch, subsCountEpisodes } from "./src/opensubtitles.js";
import {
  encodeFileIdBase32,
  deleteSubFiles,
  getSubFileIds,
  offsetSubFiles,
} from "./src/subFiles.js";
import {
  wss,
  connectedClients,
  activeServerMessages,
  handleChannelFrame,
  notifyClients,
  publishChannelDelta,
  registerLocalChannel,
  setGlobalMessage,
  unsubscribeAllChannels,
} from "./src/messaging.js";
import {
  keySendWithChk,
  tvRemoteFilterOpen,
  tvRemoteUnlock,
  tvTvGet,
} from "./src/tvRemoteKey.js";
import * as subsQueue from "./src/subsQueue.js";
import * as mpfour from "./src/mpfour.js";

const FIX_LOG_CHANNEL_POLL_MS = 1000;

registerLocalChannel("badGroups", {
  snapshot: () => syncBadGroupsFromDisk(),
});

registerLocalChannel("lastViewed", {
  snapshot: () => view.getLastViewedSync(),
});
view.onLastViewedChange((lastViewed) => {
  publishChannelDelta("lastViewed", lastViewed);
});

const getChksrtSnapshot = () => ({
  count: subsState.subQueueChkSrt.length,
  path: subsState.subQueueChkSrt[0]?.videoFilePath,
});

const publishChksrtState = () => {
  const snapshot = getChksrtSnapshot();
  notifyClients("chksrt-count", snapshot.count);
  publishChannelDelta("chksrt", snapshot);
  return snapshot;
};

registerLocalChannel("chksrt", {
  snapshot: getChksrtSnapshot,
});

const getFlexgetSnapshot = () => ({
  history: flexget.getSentHistoryRows(),
  status: { running: flexget.isFlexgetRunning() },
});

registerLocalChannel("flexget", {
  snapshot: getFlexgetSnapshot,
});
flexget.onFlexgetChange(() => {
  publishChannelDelta("flexget", getFlexgetSnapshot());
});

let fixLogPollTimer = null;
let fixLogOffset = 0;
let fixLogLastStateJson = "";

const fixLogStateJson = (payload) =>
  JSON.stringify({
    running: payload?.running === true,
    status: payload?.status ?? null,
    currentPath: payload?.currentPath ?? null,
    currentFile: payload?.currentFile ?? null,
    currentIndex: payload?.currentIndex ?? 0,
    totalFiles: payload?.totalFiles ?? 0,
    nextOffset: payload?.nextOffset ?? 0,
  });

const getFixLogSnapshot = () => {
  const payload = tailFixLog(0);
  fixLogOffset = payload.nextOffset ?? 0;
  fixLogLastStateJson = fixLogStateJson(payload);
  return payload;
};

const pollFixLogChannel = () => {
  const payload = tailFixLog(fixLogOffset);
  const stateJson = fixLogStateJson(payload);
  if (!payload.log && stateJson === fixLogLastStateJson) return;
  fixLogOffset = payload.nextOffset ?? fixLogOffset;
  fixLogLastStateJson = stateJson;
  publishChannelDelta("fixLog", payload);
  if (!payload.running && readFixState()?.running !== true) {
    clearInterval(fixLogPollTimer);
    fixLogPollTimer = null;
  }
};

const startFixLogChannel = () => {
  if (fixLogPollTimer) return;
  fixLogPollTimer = setInterval(pollFixLogChannel, FIX_LOG_CHANNEL_POLL_MS);
};

const stopFixLogChannel = () => {
  if (!fixLogPollTimer) return;
  clearInterval(fixLogPollTimer);
  fixLogPollTimer = null;
};

registerLocalChannel("fixLog", {
  snapshot: getFixLogSnapshot,
  onFirstSubscriber: startFixLogChannel,
  onLastUnsubscriber: stopFixLogChannel,
});

registerLocalChannel("asrLog", {
  snapshot: () => ({ lines: subsState.asrLogBuffer }),
});
subsQueue.onAsrLog((entry) => {
  publishChannelDelta("asrLog", { line: entry });
});

registerLocalChannel("asrQueue", {
  snapshot: () => subsQueue.getAsrQueueSnapshot(),
});
subsQueue.onAsrQueueChange((payload) => {
  publishChannelDelta("asrQueue", payload);
});

registerLocalChannel("embLog", {
  snapshot: () => ({ lines: subsState.embLogBuffer.join("\n") }),
});
subsQueue.onEmbLog((line) => {
  publishChannelDelta("embLog", { line });
});

registerLocalChannel("subsProgress", {
  snapshot: () => null,
});
subsQueue.onSubsProgress((payload) => {
  publishChannelDelta("subsProgress", payload);
});
import * as intro from "./src/intro.js";
import * as flexget from "./src/flexget.js";
import * as disk from "./src/disk.js";
import * as fileOps from "./src/fileOps.js";
import * as localHistory from "./src/localHistory.js";
const { getFile, deletePath, deletePaths, delSeasonFiles, createShowFolder } =
  fileOps;
import { registerMediaRoutes } from "./src/routes/media.js";
import { registerUsbRoutes } from "./src/routes/usb.js";
import * as unilogRoutes from "./src/routes/unilog.js";
const { broadcastUnilog } = unilogRoutes;
const registerUnilogRoutes = unilogRoutes.registerUnilogRoutes;
// Local aliases keep existing call sites terse (disk domain lives in src/disk.js).
const showNameFromFilePath = disk.showNameFromFilePath;
const refreshEpisodeData = disk.refreshEpisodeData;
const getShowsFromDisk = disk.getShowsFromDisk;
const getShowDiskInfo = disk.getShowDiskInfo;
const safeShowFolderName = disk.safeShowFolderName;
const seasonFolderName = disk.seasonFolderName;
const buildTvShowNfo = disk.buildTvShowNfo;
import { EMBY_BASE_URL, EMBY_USER_ID, EMBY_API_KEY } from "./src/embyConfig.js";
subsQueue.init({ syncBatchMsgs });
// Local aliases keep existing call sites terse (subsQueue domain lives in
// src/subsQueue.js). State lives on the shared subsState object.
const { subsState } = subsQueue;
const {
  persistSubQueue,
  persistSubQueueChkSrt,
  cleanChkSrtQueue,
  persistAsrQueue,
  appendAsrLog,
  addToAsrQueue,
  enqueueSubQueue,
  enqueueSubQueueChkSrt,
  loadQueues,
  loadChksrtHistory,
  persistChksrtHistory,
  loadChksrtSnoozed,
  persistChksrtSnoozed,
  getChksrtSnoozedForShow,
  addToChksrtSnoozed,
  removeFromChksrtSnoozed,
  loadOpnCheckHistory,
  persistOpnCheckHistory,
  fileNeedsSubChecked,
  generateEmbSrts,
  applyOpenSubSrts,
  generateSrtWithAsr,
  doSubQueueNow,
  processSubQueueEntry,
  startSubQueueLoop,
  startAsrQueueLoop,
  resetOpnDailyCountIfNeeded,
  getOpnSidecarPath,
  hasOpnSidecar,
  tryDownloadOpnSrtForVideo,
  checkAndDownloadOpnSrt,
  processChksrtSnoozedForShow,
} = subsQueue;

const tvdbIdByName = (name) => {
  if (!name) return null;
  const all = tvdb.getAllTvdbSync();
  const rec =
    all[name] ||
    Object.values(all).find(
      (r) => r?.name?.toLowerCase() === name.toLowerCase(),
    );
  return String(rec?.tvdbId || "").trim() || null;
};

const SECRETS_DIR = SRVR_SECRETS_DIR;

function runFfprobe(args, maxBuffer = 2 * 1024 * 1024) {
  return cp.execFileSync("ffprobe", args, {
    maxBuffer,
    encoding: "utf8",
  });
}

ensureDir(SRVR_DATA_DIR);
ensureDir(SECRETS_DIR);
// Config lives alongside this module (not dependent on process.cwd()).
ensureDir(CONFIG_DIR);

process.setMaxListeners(50);
const tvDir = "/mnt/media/tv";
// Refresh all four batch hdrMsg entries from live queue state.
// Call this whenever any batch queue changes so every pending type is visible.
function syncBatchMsgs() {
  // EmbSub (Sub)
  const embCount = subsState.subQueue.length;
  if (embCount > 0) {
    setGlobalMessage({
      id: "EmbSub",
      text: `Sub:${embCount}`,
      position: 2004,
    });
  } else {
    setGlobalMessage({ id: "EmbSub", action: "hide" });
  }
  // ASR (Asr)
  if (subsState.asrQueue.length > 0) {
    setGlobalMessage({
      id: "Asr",
      text: `Asr:${subsState.asrQueue.length}`,
      position: 2005,
    });
  } else {
    setGlobalMessage({ id: "Asr", action: "hide" });
  }
  // ChkSrt (Chk) — files awaiting human srt review
  if (subsState.subQueueChkSrt.length > 0) {
    setGlobalMessage({
      id: "ChkSrt",
      text: `Chk:${subsState.subQueueChkSrt.length}`,
      position: 2006,
    });
  } else {
    setGlobalMessage({ id: "ChkSrt", action: "hide" });
  }
  // Mp4 — mpfour seekable-mirror encode backlog
  const mp4Pending = mpfour.getMp4Pending();
  if (mp4Pending.length > 0) {
    setGlobalMessage({
      id: "Mp4",
      text: `Mp4:${mp4Pending.length}`,
      position: 2007,
    });
  } else {
    setGlobalMessage({ id: "Mp4", action: "hide" });
  }
}

const exec = utilNode.promisify(cp.exec);

const headerLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config1-header.txt"),
  "",
);
const pickupLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config4-pickups.json"),
  "[]",
);
const footerLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config5-footer.txt"),
  "",
);

const headerStr = headerLoad.text;
const pickupStr = pickupLoad.text;
const footerStr = footerLoad.text;

let pickups;
try {
  pickups = JSON.parse(pickupStr);
  if (!Array.isArray(pickups)) {
    throw new Error("pickups config is not an array");
  }
} catch (e) {
  unilog(
    506,
    `FATAL: invalid JSON in pickups config at ${pickupLoad.chosenPath || "<fallback>"}: ${e.message}`,
  );
  process.exit(1);
}

function parseSeasonEpisodeFromFilename(fileName, folderName) {
  // Returns { season, episode } or null.
  if (!fileName) return null;
  const base = String(fileName);

  let parsedPtt = null;
  let parsedPttFolder = null;
  try {
    parsedPtt = parseTorrentTitle(base.replace(/\.[a-z0-9]{2,4}$/i, ""));
  } catch (e) {
    unilog(1360, `title parse threw for ${base}: ${e.message}`);
  }
  try {
    if (folderName)
      parsedPttFolder = parseTorrentTitle(
        String(folderName).replace(/\.[a-z0-9]{2,4}$/i, ""),
      );
  } catch (e) {
    unilog(1361, `title parse threw for folder ${folderName}: ${e.message}`);
  }

  const result = parseFileSeasonEpisode(
    base,
    folderName || "",
    parsedPtt,
    parsedPttFolder,
  );
  if (!result || result.season == null || result.episode == null) return null;
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function gapEntryHasGap(gap) {
  if (!gap || typeof gap !== "object") return false;

  // Boolean flags that indicate a gap condition.
  if (gap.fileGap === true) return true;
  if (gap.watchGap === true) return true;
  if (gap.notReady === true) return true;

  // Explicit season/episode markers (allow 0).
  if (gap.fileGapSeason !== null && gap.fileGapSeason !== undefined)
    return true;
  if (gap.fileGapEpisode !== null && gap.fileGapEpisode !== undefined)
    return true;
  if (gap.watchGapSeason !== null && gap.watchGapSeason !== undefined)
    return true;
  if (gap.watchGapEpisode !== null && gap.watchGapEpisode !== undefined)
    return true;

  // Non-empty wait string can also indicate a gap state.
  if (typeof gap.waitStr === "string" && gap.waitStr.trim() !== "") return true;

  return false;
}

function stripGapTransientFields(gap) {
  if (!gap || typeof gap !== "object") return false;
  let changed = false;

  // `Waiting` is transient client state; never persist it.
  if (Object.prototype.hasOwnProperty.call(gap, "Waiting")) {
    delete gap.Waiting;
    changed = true;
  }

  // Legacy field removed from the data model; never persist it.
  if (Object.prototype.hasOwnProperty.call(gap, "BlockedGap")) {
    delete gap.BlockedGap;
    changed = true;
  }

  return changed;
}

// Emby DeviceNames reported by the Emby app on each TV
const TV_DEVICE_NAMES = ["Living Room TV"];

// Delay before the auto-skip trim seek. Kept short so none of the intro plays;
// the player often isn't ready to seek this early, which doTrimIntro handles by
// verifying the position landed and retrying.
const AUTO_SKIP_DELAY_MS = 250;

// Debounced per-show push so rapid tvdb changes coalesce into one notification
const PUSH_DEBOUNCE_MS = 500;
const pendingPushes = new Map();

const debouncedTvdbPush = (name) => {
  if (!name) return;
  if (pendingPushes.has(name)) clearTimeout(pendingPushes.get(name));
  pendingPushes.set(
    name,
    setTimeout(() => {
      pendingPushes.delete(name);
      const record = tvdb.getAllTvdbSync()[name];
      if (record) {
        notifyClients("tvdbUpdated", { name, record });
      }
    }, PUSH_DEBOUNCE_MS),
  );
};

// Set up callbacks so tvdb.js can call back into index.js without circular imports
tvdb.setNotifyCallback((name) => debouncedTvdbPush(name));
tvdb.setEnqueueCallback((name) => notifyClients("showUpdating", { name }));
tvdb.setQueueDrainCallback(() => notifyClients("showQueueEmpty", {}));

// Auto-update pickups when inEmby or status changes on a tvdb record
const handlePickupChange = (name, inEmby, status) => {
  if (inEmby === true) {
    const allTvdbSync = tvdb.getAllTvdbSync();
    const rec = allTvdbSync[name];
    removeFromSnoozeByShow(name, rec?.tvdbId);
  }
  if (inEmby === true && status !== "Ended") {
    // Should be in pickups
    const already = pickups.some((p) => p.toLowerCase() === name.toLowerCase());
    if (!already) {
      unilog(526, "adding:", name);
      addPickup({ name }).catch((err) => unilog(527, "addPickup failed:", err));
    }
  } else {
    // Should not be in pickups
    const idx = pickups.findIndex(
      (p) => p.toLowerCase() === name.toLowerCase(),
    );
    if (idx !== -1) {
      unilog(528, "removing:", name);
      delPickup({ name }).catch((err) => unilog(529, "delPickup failed:", err));
    }
  }
};
tvdb.setPickupChangeCallback(handlePickupChange);

// Detect and fix the "compact NNN" mis-indexing: Emby reads a filename like
// "101-Title.avi" in Season 1 as episode 101 instead of S1E01. This leaves the
// real TVDB-sourced virtual stubs (E1-E21) un-linked. We rename the files to
// SxxExx format so the next Emby scan matches them correctly.
const fixCompactEpisodeNaming = async (showId, showName) => {
  let anyFixed = false;
  try {
    const seasonsRes = await fetch(
      `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${showId}&Fields=MediaSources,Path,LocationType&api_key=${EMBY_API_KEY}`,
    );
    if (!seasonsRes.ok) return false;
    const seasonsData = await seasonsRes.json();
    const seasons = seasonsData?.Items || [];

    for (const season of seasons) {
      const seasonId = season.Id;
      const seasonNumber = season.IndexNumber;
      if (!Number.isFinite(seasonNumber) || seasonNumber < 1) continue;

      const epsRes = await fetch(
        `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${seasonId}&Fields=MediaSources,Path,LocationType&api_key=${EMBY_API_KEY}`,
      );
      if (!epsRes.ok) continue;
      const epsData = await epsRes.json();
      const episodes = epsData?.Items || [];

      let hasVirtual = false;
      const compactFileEps = [];
      for (const ep of episodes) {
        const epNum = ep.IndexNumber;
        if (!Number.isFinite(epNum)) continue;
        const path = ep?.MediaSources?.[0]?.Path || ep?.Path || "";
        const isVirtual = ep.LocationType === "Virtual" || !path;
        if (epNum >= 1 && epNum <= 99 && isVirtual) {
          hasVirtual = true;
        } else if (epNum >= 100) {
          // Check compact NNN: first digit(s) = season, last two = episode
          const compactSeason = Math.floor(epNum / 100);
          const compactEp = epNum % 100;
          if (compactSeason === seasonNumber && compactEp >= 1 && path) {
            compactFileEps.push({ epNum, path, compactEp });
          }
        }
      }

      if (!hasVirtual || compactFileEps.length === 0) continue;

      unilog(
        530,
        `${showName} S${seasonNumber}: renaming ${compactFileEps.length} compact-NNN files`,
      );
      for (const { path: oldPath, compactEp } of compactFileEps) {
        const dir = oldPath.substring(0, oldPath.lastIndexOf("/"));
        const filename = oldPath.substring(oldPath.lastIndexOf("/") + 1);
        const ext = filename.substring(filename.lastIndexOf("."));
        // Strip leading NNN- prefix from title
        const titlePart = filename
          .replace(/^\d{3}[-\s]/, "")
          .replace(/\.[^.]+$/, "");
        const sStr = String(seasonNumber).padStart(2, "0");
        const eStr = String(compactEp).padStart(2, "0");
        const newFilename = `S${sStr}E${eStr} - ${titlePart}${ext}`;
        const newPath = `${dir}/${newFilename}`;
        if (oldPath === newPath) continue;
        try {
          fs.renameSync(oldPath, newPath);
          unilog(531, `Renamed for ${showName}: ${filename} → ${newFilename}`);
          anyFixed = true;
        } catch (e) {
          unilog(532, `Rename failed for ${showName}: ${oldPath}:`, e.message);
        }
      }
    }

    if (anyFixed) {
      unilog(533, `Triggering Emby refresh for ${showName}`);
      try {
        await fetch(
          `${EMBY_BASE_URL}/Items/${showId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&api_key=${EMBY_API_KEY}`,
          { method: "POST" },
        );
      } catch (e) {
        unilog(534, `Emby refresh error for ${showName}:`, e.message);
      }
      // Give Emby time to process before gap check reads updated data
      await new Promise((r) => setTimeout(r, 8000));
    }
  } catch (e) {
    unilog(535, `Error for ${showName}:`, e.message);
  }
  return anyFixed;
};

tvdb.setPerShowCallback(async (showName, tvdbRecord, options) => {
  try {
    if (tvdbRecord.inEmby) {
      removeFromSnoozeByShow(showName, tvdbRecord.tvdbId);
    }
    // Subtitle scan for inEmby shows
    if (tvdbRecord.inEmby) {
      const showFolderName = showName.includes("/")
        ? showName
        : (tvdbRecord.path || tvdbRecord.emby?.path || showName)
            .split("/")
            .pop();
      const showFolder = path.join(tvDir, showFolderName);
      try {
        const seasonDirs = fs.readdirSync(showFolder);
        for (const seasonDir of seasonDirs) {
          const seasonPath = path.join(showFolder, seasonDir);
          try {
            if (!fs.statSync(seasonPath).isDirectory()) continue;
          } catch {
            continue;
          }
          const files = fs.readdirSync(seasonPath);
          for (const f of files) {
            if (!videoFileExtensions.includes(f.split(".").pop())) continue;
            const fp = path.join(seasonPath, f);
            if (await fileNeedsSubChecked(fp, showName)) {
              enqueueSubQueue(
                { videoFilePath: fp, fromUI: false, lowPriority: true },
                false,
              );
            }
          }
        }
        persistSubQueue();
      } catch (e) {
        unilog(539, `subtitle scan error for ${showName}: ${e.message}`);
      }
    }
    // Disk check, date/size/noFiles, filesOnDisk/fileQuality/quality and
    // episodeData are all refreshed by refreshEpisodeData (called from the tvdb
    // loop before this callback), so no separate disk scan is needed here.
    const diskChanges = [];
    // lastPlayedDate
    const playedDateChanges = [];
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      try {
        const latestPlayed = await fetchLatestPlayedInfo(tvdbRecord.id);
        const prevPlayedDate = tvdbRecord.lastPlayedDate;
        if (applyLatestPlayed(tvdbRecord, latestPlayed)) {
          playedDateChanges.push(
            `lastPlayedDate:${prevPlayedDate}->${tvdbRecord.lastPlayedDate}` +
              ` (${tvdbRecord.lastPlayedEpisode})`,
          );
        }
      } catch (e) {
        unilog(
          1362,
          `lastPlayedDate fetch failed for ${showName}: ${e.message}`,
        );
      }
    }
    // Fix compact-NNN episode mis-indexing (e.g. "101-Title.avi" parsed as E101)
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      await fixCompactEpisodeNaming(tvdbRecord.id, showName);
    }
    // Gap check
    let gapChanges = [];
    const prevNeedsIntro = !!tvdbRecord.needsIntro;
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      const gapData = await emby.gapCheckOne(
        tvdbRecord.id,
        showName,
        tvdbRecord,
      );
      if (gapData) {
        const gapFields = [
          "notReady",
          "watchGap",
          "watchGapSeason",
          "watchGapEpisode",
          "fileGap",
          "fileGapSeason",
          "fileGapEpisode",
          "resDrop",
          "resDropSeason",
          "resDropEpisode",
          "fileEndError",
          "fileEndErrorSeason",
          "fileEndErrorEpisode",
          "seasonWatchedThenNofile",
          "seasonWatchedThenNofileSeason",
          "seasonWatchedThenNofileEpisode",
          "anyWatched",
        ];
        for (const f of gapFields) {
          if (tvdbRecord[f] !== gapData[f])
            gapChanges.push(`${f}:${tvdbRecord[f]}->${gapData[f]}`);
        }
        Object.assign(tvdbRecord, gapData);
        tvdbRecord.lastGapCheck = util.toPstDateTimeMs(new Date());
        delete tvdbRecord.allAiredHaveFile;
        delete tvdbRecord.allAiredWatched;
        delete tvdbRecord.allWatchedOrHaveFile;
      }
      // Compute full: every episode is either watched or has a file
      const newFull = !!(tvdbRecord.inEmby && gapData.allWatchedOrHaveFile);
      if (!!tvdbRecord.full !== newFull) {
        gapChanges.push(`full:${tvdbRecord.full}->${newFull}`);
        tvdbRecord.full = newFull;
      }
      // Compute needsIntro. A season with trimPos/skipDur OR one explicitly
      // marked "none" (checked, no intro) counts as configured.
      const hasConfiguredIntro =
        tvdbRecord.seasonIntros != null &&
        Object.values(tvdbRecord.seasonIntros).some(
          (si) =>
            si?.trimPos != null || si?.skipDur != null || si?.none === true,
        );
      const newNeedsIntro = !!(
        tvdbRecord.inEmby &&
        !hasConfiguredIntro &&
        Number(tvdbRecord.episodeCount ?? 0) >
          Number(tvdbRecord.watchedCount ?? 0) &&
        epd.seasonsWithFile(tvdbRecord.episodeData).length > 0
      );
      if (!!tvdbRecord.needsIntro !== newNeedsIntro) {
        gapChanges.push(
          `needsIntro:${tvdbRecord.needsIntro}->${newNeedsIntro}`,
        );
        tvdbRecord.needsIntro = newNeedsIntro;
      }
    } else if (!tvdbRecord.inEmby) {
      // For shows not in emby, set error fields to known constants
      const nonEmbyConstants = [
        ["fileGap", false],
        ["fileGapSeason", null],
        ["fileGapEpisode", null],
        ["fileEndError", false],
        ["fileEndErrorSeason", null],
        ["fileEndErrorEpisode", null],
        ["watchGap", false],
        ["watchGapSeason", null],
        ["watchGapEpisode", null],
        ["seasonWatchedThenNofile", false],
        ["seasonWatchedThenNofileSeason", null],
        ["seasonWatchedThenNofileEpisode", null],
        ["full", false],
        ["needsIntro", false],
        ["notReady", true],
      ];
      for (const [f, v] of nonEmbyConstants) {
        if (tvdbRecord[f] !== v) {
          gapChanges.push(`${f}:${tvdbRecord[f]}->${v}`);
          tvdbRecord[f] = v;
        }
      }
    }
    const nowNeedsIntro = !!tvdbRecord.needsIntro;
    if (nowNeedsIntro !== prevNeedsIntro) {
      // The client sets needsIntro immediately before opening the intro player,
      // so this is the only advance warning we get — push that episode to the
      // head of the mirror queue. Too late to beat the first seek on a slow
      // hevc transcode, but it beats every later one.
      // On the way back down the intro has been configured, so release the
      // claim and stop the encode unless chksrt still wants it.
      try {
        const introFile = epd.selectIntroFile(tvdbRecord);
        if (introFile?.path) {
          if (nowNeedsIntro) mpfour.prioritizeIntro(introFile.path);
          else mpfour.dropIntro(introFile.path);
        }
      } catch (e) {
        unilog(
          1965,
          `intro mirror priority failed for ${showName}: ${e.message}`,
        );
      }
    }
    // Auto collection updates (run after the gap check, which sets anyWatched)
    const collectionChanges = await applyAutoCollections(showName, tvdbRecord);
    const push2Changes = [
      ...diskChanges,
      ...playedDateChanges,
      ...gapChanges,
      ...collectionChanges,
    ];
    if (push2Changes.length) {
      await tvdb.saveTvdbSync();
      if (!options?.suppressNotify) {
        unilog(28, `${showName}: ${push2Changes.join(" ")}`);
        debouncedTvdbPush(showName);
      }
    } else {
      if (!options?.suppressNotify) {
        unilog(29, `${showName}: no changes`);
      }
    }
    // Background OpenSubtitles check: download one missing .opnXXXXX.srt per show
    try {
      await checkAndDownloadOpnSrt(showName, tvdbRecord);
      await processChksrtSnoozedForShow(showName, tvdbRecord);
    } catch (e) {
      unilog(543, "error for", showName, e.message);
    }
    return { hasChanges: push2Changes.length > 0, changes: push2Changes };
  } catch (e) {
    unilog(544, "error for", showName, e.message);
    return { hasChanges: false, changes: [] };
  }
});
let embyFullSweepTickCount = 0;
tvdb.setPreTvdbTickCallback(async ({ isBackground } = {}) => {
  embyFullSweepTickCount++;
  // TEST: skip sweep on foreground (user-triggered) ticks — revert by removing `&& isBackground`
  if (isBackground && embyFullSweepTickCount % 10 === 1) {
    const caller = `preTick-bg#${embyFullSweepTickCount}`;
    await runEmbyFullSweep(caller);
  }
});

// Wire the consolidated episodeData refresh into the tvdb background loop.
tvdb.setRefreshEpisodeDataCallback(disk.refreshEpisodeData);

// waitStr transitions drive automatic hiding/unhiding (shows with no episodes
// on disk are ignored entirely — see hideShowIfNeeded/unhideLatestTvIfNeeded).
tvdb.setWaitStrChangedCallback(
  async (showName, tvdbRecord, { before, after }) => {
    if (!tvdbRecord?.inEmby || !tvdbRecord?.id) return;
    if (!hasEpisodesOnDisk(tvdbRecord)) return;
    if (!before && after) {
      // waitStr newly set: hide the show unless it is already hidden.
      await hideShowIfNeeded(showName, tvdbRecord, `waitStrHide:${showName}`);
    } else if (before && !after) {
      // waitStr cleared: bring it back to the latest tv row.
      await unhideLatestTvIfNeeded(showName, tvdbRecord);
    }
  },
);

function rpcParamToString(param) {
  // Param is usually a raw string, but tolerate JSON-stringified strings.
  if (param === undefined || param === null) return "";
  if (typeof param !== "string") return String(param);
  const trimmed = param.trim();
  if (trimmed === "") return "";
  if (trimmed === "null") return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : String(parsed);
    } catch {
      return param;
    }
  }
  return param;
}

// Single authoritative refresh of rec.episodeData (see src/disk.js).

const upload = async () => {
  let str = headerStr;
  str += '        - "dummy"\n';
  for (let name of pickups)
    str += '        - "' + name.replace(/"/g, "") + '"\n';
  str += footerStr;
  await util.writeFile(configWritePath("config.yml"), str);
  return "ok";
};

let saving = false;

const trySaveConfigYml = async (id, result, resolve, reject) => {
  if (saving) return ["busy", id, result, resolve, reject];
  saving = true;
  pickups.sort((a, b) => compareShowNames({ name: a }, { name: b }));
  await util.writeFile(configWritePath("config4-pickups.json"), pickups);

  let errResult = null;

  const uploadRes = await upload();
  if (uploadRes != "ok") errResult = uploadRes;

  if (errResult) {
    unilog(546, "trySaveConfigYml error:", errResult);
    saving = false;
    return ["err", id, errResult, resolve, reject];
  }

  saving = false;
  return ["ok", id, result, resolve, reject];
};

// this always sends a response to the client
// can be called and forgotten
const saveConfigYml = async (idIn, resultIn, resolveIn, rejectIn) => {
  const tryRes = await trySaveConfigYml(idIn, resultIn, resolveIn, rejectIn);
  const [status, id, result, resolve, reject] = tryRes;
  switch (status) {
    case "busy":
      setTimeout(() => saveConfigYml(id, result, resolve, reject), 1000);
      break;
    case "ok":
      if (resolve) resolve([id, result]);
      break;
    case "err":
      if (reject) reject([id, tryRes]);
      break;
  }
};

const addPickup = async (params) => {
  const name = params?.name;
  const tvdbId = params?.tvdbId;
  unilog(547, "addPickup", name);

  if (!name) {
    throw new Error("addPickup: missing name");
  }

  // Update pickups array (config is the authority; tvdb synced in trySaveConfigYml)
  for (const [idx, pickupNameStr] of pickups.entries()) {
    if (pickupNameStr.toLowerCase() === name.toLowerCase()) {
      unilog(548, "-- removing old matching pickup:", pickupNameStr);
      pickups.splice(idx, 1);
      break;
    }
  }
  unilog(549, "-- adding pickup:", name);
  pickups.push(name);
  await new Promise((resolve, reject) =>
    saveConfigYml(null, "ok", resolve, reject),
  );
  return "ok";
};

const delPickup = async (params) => {
  const name = params?.name;
  const tvdbId = params?.tvdbId;
  unilog(550, "delPickup", name);
  if (!name) {
    throw new Error("delPickup: missing name");
  }
  let deletedOne = false;

  // Update pickups array (config is the authority; tvdb synced in trySaveConfigYml)
  for (const [idx, pickupNameStr] of pickups.entries()) {
    if (pickupNameStr.toLowerCase() === name.toLowerCase()) {
      unilog(551, "-- deleting pickup:", pickupNameStr);
      pickups.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if (!deletedOne) {
    unilog(552, "pickup not deleted, no match:", name);
    return "delPickup no match: " + name;
  }
  await new Promise((resolve, reject) =>
    saveConfigYml(null, "ok", resolve, reject),
  );
  return "ok";
};

const getNoEmbys = async (_params) => {
  const allTvdb = tvdb.getAllTvdbSync();
  const out = [];

  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (record?.inEmby === false) {
      if (!record.name) record.name = recordName;
      out.push(record);
    }
  }

  return out;
};

const addNoEmby = async (params) => {
  const show = params.show || params;
  const name = String(show?.name || "").trim();
  unilog(553, "addNoEmby", name);
  if (!name) throw new Error("addNoEmby: missing show name");

  const allTvdb = tvdb.getAllTvdbSync();
  let existingKey = null;
  let existing = null;

  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (recordName.toLowerCase() === name.toLowerCase()) {
      existingKey = recordName;
      existing = record;
      break;
    }
  }

  const nextRecord = {
    ...(existing || {}),
    ...(show || {}),
    name: name,
    id: show?.id || existing?.id || `noemby-${Math.random()}`,
    inEmby: false,
    inToTry: show?.inToTry ?? existing?.inToTry ?? false,
    inContinue: show?.inContinue ?? existing?.inContinue ?? false,
    inMark: show?.inMark ?? existing?.inMark ?? false,
    inLinda: show?.inLinda ?? existing?.inLinda ?? false,
  };

  if (existingKey && existingKey !== name) {
    delete allTvdb[existingKey];
  }
  allTvdb[name] = nextRecord;
  await tvdb.saveTvdbSync();
  return "ok";
};

const delNoEmby = async (params) => {
  const name = params?.name;
  unilog(555, "delNoEmby", name);
  if (!name) throw new Error("delNoEmby: missing name");
  let deleteKey = null;

  const allTvdb = tvdb.getAllTvdbSync();
  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (
      recordName.toLowerCase() === name.toLowerCase() &&
      record?.inEmby === false
    ) {
      deleteKey = recordName;
      break;
    }
  }

  if (!deleteKey) {
    unilog(556, "no noembys deleted, no match:", name);
    return "delNoEmby no match:" + name;
  }

  unilog(557, "deleting no-emby record:", deleteKey);
  delete allTvdb[deleteKey];
  await tvdb.saveTvdbSync();
  return "ok";
};

const getGaps = async (_param) => {
  // Phase 5: Read from tvdb instead of separate gaps object
  const allTvdb = tvdb.getAllTvdbSync();
  const gapsFromTvdb = {};

  for (const [name, record] of Object.entries(allTvdb)) {
    if (record.gap && record.id) {
      gapsFromTvdb[record.id] = record.gap;
    }
  }

  return gapsFromTvdb;
};

const addGap = async (params) => {
  const { gapId, gap, save } = params || {};

  if (gapId !== null && gapId !== undefined) {
    stripGapTransientFields(gap);

    // Phase 5: Update tvdb.gap field
    const allTvdb = tvdb.getAllTvdbSync();
    let showName = null;

    // Find show by Emby ID
    for (const [name, record] of Object.entries(allTvdb)) {
      if (record.emby?.id === gapId && record.inEmby) {
        showName = name;
        break;
      }
    }

    if (showName) {
      if (gapEntryHasGap(gap)) {
        allTvdb[showName].gap = gap;
      } else {
        allTvdb[showName].gap = null;
      }
      // Only save tvdb when save flag is true
      if (save) await tvdb.saveTvdbSync();
    }
  }

  return "ok";
};

const delGap = async (params) => {
  const { gapId, save } = params || {};

  if (gapId !== null) {
    // Phase 5: Update tvdb.gap field
    const allTvdb = tvdb.getAllTvdbSync();

    // Find show by Emby ID
    for (const [name, record] of Object.entries(allTvdb)) {
      if (record.emby?.id === gapId) {
        record.gap = null;
        // Only save tvdb when save flag is true
        if (save) await tvdb.saveTvdbSync();
        break;
      }
    }
  }

  return "ok";
};

// The Custom button's settings, sent here by the web client's hdrtop Send
// button and handed back to the web client and tvapp. The button is permanent
// in both, so the settings outlive a restart on disk rather than living only
// in memory.
const CUSTOM_SETTINGS_FILE = path.join(SRVR_DATA_DIR, "custom-settings.json");

const readCustomSettings = () => {
  if (!fs.existsSync(CUSTOM_SETTINGS_FILE)) return null;
  return JSON.parse(fs.readFileSync(CUSTOM_SETTINGS_FILE, "utf8"));
};

let sharedFilters = readCustomSettings();

const setSharedFilters = async (params) => {
  if (params === undefined || params === null || params === "") {
    sharedFilters = null;
    fs.rmSync(CUSTOM_SETTINGS_FILE, { force: true });
    notifyClients("sharedFiltersChanged", null);
    return { ok: true };
  }

  // No need to jParse, we expect it to be a JS object already
  sharedFilters = params;
  fs.writeFileSync(CUSTOM_SETTINGS_FILE, JSON.stringify(sharedFilters), "utf8");
  notifyClients("sharedFiltersChanged", sharedFilters);
  // tvapp cannot be notified: it holds no socket here. tv-tv is the one thing
  // that can reach it, so the push goes out through there -- the Send button
  // being the only source of a change is what lets tvapp do without a poll.
  tvTvGet("/tv/tvappcustom");
  return { ok: true };
};

const getSharedFilters = async (_params) => {
  return sharedFilters;
};

/**
 * The show list under a set of filter/sort settings, ordered, as bare names.
 * The settings come in the request, or are the shared ones when none are —
 * which is how tvapp's Custom button asks, having none of its own.
 *
 * This runs the very same @tv/share filter and sort the web client runs
 * locally, so a client that cannot do it itself still gets the identical
 * list. Only names go back: every caller already holds the show records.
 */
const getSharedFilterShows = async (params) => {
  const settings =
    (params && Object.keys(params).length > 0 ? params : sharedFilters) || {};
  // Shallow copies: applyComputedProps derives its props in place, and the
  // dataset it would otherwise write them into is the one tv-srvr saves back
  // to tvdb.db.
  const derived = {};
  const shows = [];
  for (const [name, rec] of Object.entries(tvdb.getAllTvdbSync())) {
    const copy = applyComputedProps({ ...rec, name: rec.name || name });
    derived[name] = copy;
    shows.push(copy);
  }
  const filtered = filterShowList(
    shows,
    {
      fltrChoice: settings.fltrChoice,
      filterStr: settings.filterStr,
      descrSearchStr: settings.descrSearchStr,
      condFilters: settings.condFilters,
    },
    derived,
  );
  const sorted = sortShowList(
    filtered,
    settings.sortChoice || "Alpha",
    derived,
    !!settings.reversed,
  );
  return {
    names: sorted.map((show) => show.name),
    selectedShow: settings.selectedShow || null,
  };
};

const sendEmailHandler = async (params) => {
  const { body } = params;
  unilog(567, "sendEmailHandler", body);
  try {
    await email.sendEmail(body);
    return "ok";
  } catch (error) {
    throw new Error(error.message);
  }
};

//////////////////  HTTP REST API  //////////////////

// Event-loop lag monitor. A timer that should fire every LAG_SAMPLE_MS; how
// late it actually fires is how long the loop was blocked by sync work. This is
// the difference between "a handler was slow" and "the whole process stalled",
// which no request-level timing can tell you.
const LAG_SAMPLE_MS = 500;
const LAG_REPORT_MS = 1000;
let maxLoopLagMs = 0;
let lagLastAt = Date.now();
setInterval(() => {
  const now = Date.now();
  const lag = now - lagLastAt - LAG_SAMPLE_MS;
  lagLastAt = now;
  if (lag > maxLoopLagMs) maxLoopLagMs = lag;
  if (lag >= LAG_REPORT_MS) {
    unilog(
      1448,
      `event loop blocked ${lag}ms — all requests stalled for that long`,
    );
  }
}, LAG_SAMPLE_MS);

const app = express();

// Use standard CORS middleware
app.use(cors());

// strict: false allows JSON primitives (strings/numbers) as body, not just objects/arrays
app.use(express.json({ strict: false }));

// Legacy CORS manual headers (just in case, though cors() should handle it)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

// Server-side request timing. The client already logs how long a call took from
// its side; this logs how long the same call took from ours. When the client
// reports a slow/timed-out call and nothing shows up here, the time was spent
// off-server (network/nginx), not in a handler.
const SLOW_API_MS = 3000;
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    // A handler that streams a long-running job's output (embedded subtitle
    // extraction) is slow by design and the client never waits on it, so it
    // sets res.locals.slowExempt rather than reporting a false alarm here.
    if (ms >= SLOW_API_MS && !res.locals.slowExempt) {
      unilog(
        1449,
        `slow ${req.method} ${req.path} took ${ms}ms status=${res.statusCode} loopLag=${maxLoopLagMs}ms`,
      );
    }
  });
  next();
});

//////////////////  UNILOG  //////////////////

// tv-srvr is the single DB writer. Register the in-process sink so unilog()
// calls inside srvr write directly; other processes/clients use POST /api/log.
epd.setUnilogSink(({ logId, ts, message }) =>
  broadcastUnilog(
    unilogDb.insertEventDedup({ logId, pid: "tv-srvr", ts, message }),
  ),
);
registerUnilogRoutes(app);
registerUsbRoutes(app);

// Log server startup.
unilog(1215, "Started t-srvr");

// Show/file name from an api call's params, when one of the usual fields is
// there — so an api error log names what it was working on.
const paramName = (params) => {
  const name =
    params?.show?.name ||
    params?.show?.Name ||
    params?.name ||
    params?.showName ||
    params?.file ||
    params?.fileName;
  return name ? ` (${name})` : "";
};

// The handler should be: async (params) => result
const apiWrapper = (handler) => {
  return async (req, res) => {
    // GET requests use query params, POST use body
    const params = req.method === "GET" ? req.query : req.body;
    try {
      const result = await handler(params);
      res.json(result);
    } catch (error) {
      const msg = error?.message || String(error);
      unilog(
        568,
        `Error in ${req.url}${paramName(params)}: ${msg}\n${error?.stack || ""}`,
      );
      res.status(500).json({ error: msg });
    }
  };
};

// Data retrieval endpoints
app.get(
  "/api/getAllTvdb",
  apiWrapper(async (params) => {
    const hasEmby = params.hasEmby ? parseInt(params.hasEmby) : 0;
    return await tvdb.getAllTvdb({ hasEmby });
  }),
);
app.get("/api/getShowsFromDisk", apiWrapper(getShowsFromDisk));
app.get("/api/getGaps", apiWrapper(getGaps));
app.get("/api/getNoEmbys", apiWrapper(getNoEmbys));
app.get("/api/getDevices", apiWrapper(emby.getDevices));
app.post("/api/embyViewShow", apiWrapper(emby.viewShowOnLivingRoomTv));
app.get("/api/getLastViewed", apiWrapper(view.getLastViewed));
app.get("/api/getSharedFilters", apiWrapper(getSharedFilters));
// GET with no params uses the shared settings; POST carries its own.
app.get("/api/getSharedFilterShows", apiWrapper(getSharedFilterShows));
app.post("/api/getSharedFilterShows", apiWrapper(getSharedFilterShows));
app.post("/api/local/history", apiWrapper(localHistory.getLocalHistory));

// Endpoints with parameters
app.post("/api/getRemotes", apiWrapper(tvdb.getRemotesCmd));
app.post("/api/debugTvdb", apiWrapper(tvdb.debugTvdb));
app.post("/api/getNewTvdb", apiWrapper(tvdb.getNewTvdb));
app.post("/api/searchTvdbByImdbId", apiWrapper(tvdb.searchTvdbByImdbId));
app.post(
  "/api/getSeriesMapFromTvdb",
  apiWrapper(async (params) => {
    const { tvdbId, watchedEpis } = params;
    if (!tvdbId) {
      return { success: false, error: "Missing tvdbId" };
    }
    try {
      const seriesMap = await tvdb.getSeriesMap(tvdbId, watchedEpis || null);
      return { success: true, seriesMap };
    } catch (err) {
      unilog(569, "error:", err);
      return { success: false, error: err.message };
    }
  }),
);
app.post("/api/getActorPage", apiWrapper(tvdb.getActorPage));
app.post(
  "/api/getSeriesMapFromEmby",
  apiWrapper(async (params) => {
    const { showName, stale } = params;
    if (!showName) return { success: false, error: "Missing showName" };
    const allTvdb = tvdb.getAllTvdbSync();
    const rec = allTvdb?.[showName];
    if (!rec) return { success: false, error: "Show not found" };
    try {
      const folder = showName.includes("/")
        ? showName
        : (rec.path || rec.emby?.path || showName).split("/").pop();
      const today = new Date().toISOString().slice(0, 10);

      // Fast path: build the map from the already-cached episodeData in
      // tvdb.json (populated by the periodic full refresh) with no live Emby
      // or disk access. The client paints this instantly, then requests a
      // live refresh (stale omitted) in the background to catch any changes
      // made in Emby since the last sweep.
      if (stale) {
        const seriesMap = epd.markGapErrors(
          epd.toSeriesMap(rec.episodeData, folder, today),
          rec,
        );
        return {
          success: true,
          seriesMap,
          episodeData: rec.episodeData,
          stale: true,
        };
      }

      // Refresh watched/id (Emby) and file/res (disk) so the map is live-fresh.
      // aired dates come from the periodic full refresh; skip the TVDB call here.
      const t0 = Date.now();
      await refreshEpisodeData(showName, rec, { sources: ["emby", "disk"] });
      const tRefresh = Date.now();
      await tvdb.saveTvdbSync();
      const tSave = Date.now();
      const seriesMap = epd.markGapErrors(
        epd.toSeriesMap(rec.episodeData, folder, today),
        rec,
      );
      const total = Date.now() - t0;
      if (total > 3000) {
        unilog(
          1520,
          `slow getSeriesMapFromEmby ${showName}: refresh=${tRefresh - t0}ms save=${tSave - tRefresh}ms build=${Date.now() - tSave}ms total=${total}ms`,
        );
      }
      return { success: true, seriesMap, episodeData: rec.episodeData };
    } catch (err) {
      unilog(570, "error:", err);
      return { success: false, error: err.message };
    }
  }),
);
app.post(
  "/api/clearEpisodePositions",
  apiWrapper(async (params) => {
    const { showName, cells } = params;
    if (!showName || !Array.isArray(cells) || cells.length === 0)
      return { ok: false, error: "Missing params" };
    const allTvdb = tvdb.getAllTvdbSync();
    const rec = allTvdb?.[showName];
    if (!rec) return { ok: false, error: "Show not found" };
    const cleared = [];
    for (const { season, episode, id } of cells) {
      if (!id) continue;
      try {
        const isWatched = epd.isWatched(rec.episodeData, season, episode);
        const url = urls.updateUserDataUrl(String(id));
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ PlaybackPositionTicks: 0, Played: isWatched }),
        });
        if (res.ok || res.status === 204) {
          if (Array.isArray(rec.episodeData)) {
            epd.setEpisode(rec.episodeData, season, episode, { pos: 0 });
          }
          cleared.push({ season, episode });
        } else {
          unilog(571, `Emby HTTP ${res.status} for id=${id}`);
        }
      } catch (e) {
        unilog(572, `${showName} S${season}E${episode}:`, e.message);
      }
    }
    if (cleared.length > 0) await tvdb.saveTvdbSync();
    return { ok: true, cleared, episodeData: rec.episodeData };
  }),
);
app.post("/api/searchActorsInNonEmby", apiWrapper(tvdb.searchActorsInNonEmby));
app.post("/api/getTmdb", apiWrapper(tmdb.getTmdb));
app.post("/api/searchTmdbPerson", apiWrapper(tmdb.searchPerson));
app.post("/api/getStreamProviders", apiWrapper(tmdb.getStreamProviders));
// A GET, unlike the other tmdb calls: the tv app asks for one card's image at
// a time as the list is scrolled.
app.get("/api/getBackdrop", apiWrapper(tmdb.getBackdrop));
app.post("/api/getFile", apiWrapper(getFile));
app.post("/api/getSubFileIds", apiWrapper(getSubFileIds));
app.post("/api/accessTvdb", apiWrapper(tvdb.accessTvdb));
app.post("/api/getTvmazeCrew", apiWrapper(tvdb.getTvmazeCrew_cmd));
app.post("/api/migrateWatchedCount", apiWrapper(tvdb.migrateWatchedCount));
app.post("/api/tvRemoteKey", apiWrapper(keySendWithChk));
app.post("/api/tvRemoteFilterOpen", apiWrapper(tvRemoteFilterOpen));
app.get("/api/getGroupCounts", apiWrapper(groupCounts.getGroupCounts));
app.get("/api/getBadGroups", (_req, res) => {
  try {
    res.json(syncBadGroupsFromDisk());
  } catch (e) {
    unilog(1363, `getBadGroups failed: ${e.message}`);
    res.json([]);
  }
});

app.post(
  "/api/dumpSelectedShows",
  apiWrapper(async (params) => {
    const { showNames } = params;
    if (!Array.isArray(showNames)) {
      return { success: false, error: "showNames must be an array" };
    }
    try {
      const filePath = "/root/dev/apps/tv/selected-shows.txt";
      const content = showNames.join("\n") + (showNames.length > 0 ? "\n" : "");
      await fsp.writeFile(filePath, content, "utf8");
      return { success: true, count: showNames.length, path: filePath };
    } catch (err) {
      unilog(573, "error:", err);
      return { success: false, error: err.message };
    }
  }),
);

app.post(
  "/api/toggleBadGroup",
  apiWrapper(async ({ group }) => {
    const normalizedGroup = String(group || "")
      .trim()
      .toLowerCase();
    if (!normalizedGroup) throw new Error("group is required");

    const groups = new Set(syncBadGroupsFromDisk());
    let action = "added";
    if (groups.has(normalizedGroup)) {
      groups.delete(normalizedGroup);
      action = "removed";
    } else {
      groups.add(normalizedGroup);
    }

    const list = writeBadGroupsToDisk([...groups]);
    publishChannelDelta("badGroups", list);
    return { ok: true, action, group: normalizedGroup, list };
  }),
);
app.post(
  "/api/incrementGroupCount",
  apiWrapper(groupCounts.incrementGroupCount),
);
app.post(
  "/api/triggerEmbySync",
  apiWrapper(async () => {
    unilog(36, "Running full Emby sweep");
    runEmbyFullSweep("triggerEmbySync").catch((e) =>
      unilog(575, "sweep error:", e?.message || e),
    );
    return { ok: true };
  }),
);

app.post(
  "/api/requestEmbyLibraryRefresh",
  apiWrapper(async () => {
    // Fire and forget — manager throttles, dedupes, polls, and pushes WS progress
    embyRefreshManager.request("api");
    return { ok: true };
  }),
);

// Push a show to the far right of the emby "continue watching" / "latest tv"
// lists by backdating its dates two years, effectively hiding it.
// Hide button: a toggle keyed on hiddenFromRow. When not hidden it hides
// (both dates back); when hidden it unhides both rows (both dates to today).
app.post(
  "/api/hideShow",
  apiWrapper(async (params) => {
    const showName = params?.name;
    if (!showName) return { ok: false, error: "Missing name" };
    const rec = tvdb.getAllTvdbSync()?.[showName];
    if (!rec?.id) return { ok: false, error: "Show not in emby" };
    if (!hasEpisodesOnDisk(rec))
      return { ok: false, error: "No episodes on disk" };

    let action;
    let changed;
    if (!rec.hiddenFromRow) {
      changed = await hideShowInEmby(showName, rec);
      await setHiddenFromRow(showName, true);
      action = "hidden";
    } else {
      const cw = await unhideContinueWatching(showName, rec);
      const lt = await unhideLatestTv(rec);
      changed = [];
      if (cw > 0) changed.push(`lastPlayed(${cw} epis)`);
      if (lt > 0) changed.push(`dateCreated(${lt} epis)`);
      await setHiddenFromRow(showName, false);
      action = "unhidden";
    }
    unilog(
      1661,
      `${action} ${showName}: ${changed.length ? changed.join(", ") : "no date change"}`,
    );
    if (changed.length > 0) {
      embyRefreshManager
        .request(`hideShow:${showName}`, showName)
        .catch((e) => unilog(1662, `refresh failed: ${e.message}`));
    }
    return { ok: true, action, changed };
  }),
);

app.get(
  "/api/embyLibraryRefreshStatus",
  apiWrapper(async () => {
    return embyRefreshManager.getStatus();
  }),
);

app.post(
  "/api/populateFilesOnDisk",
  apiWrapper(async () => {
    const allTvdb = tvdb.getAllTvdbSync();
    let updated = 0;
    let skipped = 0;
    for (const [name, tvdbRecord] of Object.entries(allTvdb)) {
      try {
        await refreshEpisodeData(name, tvdbRecord, { sources: ["disk"] });
        updated++;
      } catch (e) {
        skipped++;
        unilog(37, `${name}: ${e.message}`);
      }
    }
    await tvdb.saveTvdbSync();
    unilog(576, `Done: updated=${updated} skipped=${skipped}`);
    return { ok: true, updated, skipped };
  }),
);

app.post(
  "/api/populateShowQuality",
  apiWrapper(async () => {
    const allTvdb = tvdb.getAllTvdbSync();
    let updated = 0;
    for (const tvdbRecord of Object.values(allTvdb)) {
      const q = epd.computeQuality(tvdbRecord.episodeData) ?? null;
      tvdbRecord.quality = q;
      if (q !== null) updated++;
    }
    await tvdb.saveTvdbSync();
    unilog(38, `Done: updated=${updated}`);
    return { ok: true, updated };
  }),
);

app.post(
  "/api/refreshAllEpisodeData",
  apiWrapper(async (params) => {
    const onlyName = params?.name || null;
    const allTvdb = tvdb.getAllTvdbSync();
    const entries = onlyName
      ? Object.entries(allTvdb).filter(([n]) => n === onlyName)
      : Object.entries(allTvdb);
    let done = 0;
    let errors = 0;
    for (const [name, rec] of entries) {
      try {
        await refreshEpisodeData(name, rec);
        done++;
      } catch (e) {
        errors++;
        unilog(39, `${name}: ${e.message}`);
      }
      if (done % 25 === 0) await tvdb.saveTvdbSync();
    }
    await tvdb.saveTvdbSync();
    unilog(40, `Done: done=${done} errors=${errors}`);
    return { ok: true, done, errors };
  }),
);

app.get(
  "/api/embyTaskStatus",
  apiWrapper(async (params) => {
    const { taskId } = params;
    if (!taskId) return { status: "notask" };
    const res = await fetch(
      `${EMBY_BASE_URL}/ScheduledTasks?api_key=${EMBY_API_KEY}`,
    );
    if (!res.ok) return { status: "fetchfailed" };
    const tasks = await res.json();
    const task = (Array.isArray(tasks) ? tasks : []).find(
      (t) => String(t?.Id) === String(taskId),
    );
    if (!task) return { status: "refreshdone" };
    const stateRaw = String(task?.State || task?.Status || "").trim();
    const state = stateRaw.toLowerCase();
    const progressNum = Number(task?.CurrentProgressPercentage);
    const hasProgress = Number.isFinite(progressNum);
    if (hasProgress && progressNum >= 100) return { status: "refreshdone" };
    if (
      state === "completed" ||
      state === "cancelling" ||
      state === "cancelled"
    )
      return { status: "refreshdone" };
    if (state === "running")
      return {
        status: "refreshing",
        taskStatus: stateRaw,
        progress: hasProgress ? progressNum : undefined,
      };
    if (state === "idle")
      return { status: "refreshdone", taskStatus: stateRaw };
    return { status: "refreshing", taskStatus: stateRaw };
  }),
);

// Emby's per-item refresh is fire-and-forget — 4.8 exposes no completion signal
// for it (DateLastRefreshed/DateLastSaved are not returned by any endpoint), so
// give it a short settle window before reprocessing instead of polling.
const EMBY_REFRESH_SETTLE_MS = 4000;

app.post(
  "/api/refreshEmbyItem",
  apiWrapper(async (params) => {
    const { showId, showName } = params;
    if (!showId) return { success: false, error: "missing showId" };
    unilog(577, `Refreshing Emby item for ${showName} (${showId})`);

    try {
      const res = await fetch(
        `${EMBY_BASE_URL}/Items/${showId}/Refresh?Recursive=true&MetadataRefreshMode=Default&api_key=${EMBY_API_KEY}`,
        { method: "POST" },
      );
      if (!res.ok) unilog(579, `Emby returned ${res.status} for ${showName}`);
    } catch (e) {
      unilog(580, `fetch error for ${showName}:`, e.message);
    }

    await new Promise((r) => {
      setTimeout(r, EMBY_REFRESH_SETTLE_MS);
    });

    tvdb.enqueueShowProcess(showName);
    return { success: true };
  }),
);

app.post(
  "/api/triggerShowGapCheck",
  apiWrapper(async (params) => {
    const { showId, showName } = params;
    if (!showId || !showName) {
      unilog(41, "Missing showId or showName");
      return { success: false };
    }
    unilog(585, `Client requested gap check for: ${showName}`);
    tvdb.enqueueShowProcess(showName, { priority: true });
    return { success: true };
  }),
);

app.post(
  "/api/triggerShowSelect",
  apiWrapper(async (params) => {
    const { showName } = params;
    if (!showName) {
      unilog(42, "Missing showName");
      return { success: false };
    }
    tvdb.enqueueShowProcess(showName, { skipRotten: true });
    return { success: true };
  }),
);

// Snooze list
const SNOOZE_FILE = path.join(SRVR_DATA_DIR, "snooze-list.json");

function readSnoozeList() {
  if (!fs.existsSync(SNOOZE_FILE)) return [];
  return JSON.parse(fs.readFileSync(SNOOZE_FILE, "utf8"));
}
function writeSnoozeList(list) {
  fs.writeFileSync(SNOOZE_FILE, JSON.stringify(list), "utf8");
}

function removeFromSnoozeByShow(showName, tvdbId) {
  const list = readSnoozeList();
  const normName = String(showName || "")
    .trim()
    .toLowerCase();
  const normId = String(tvdbId || "").trim();
  const next = list.filter((s) => {
    if (normId && String(s.tvdbId || "").trim() === normId) return false;
    if (
      normName &&
      String(s.name || "")
        .trim()
        .toLowerCase() === normName
    )
      return false;
    return true;
  });
  if (next.length === list.length) return;
  writeSnoozeList(next);
  notifyClients("snoozeListUpdated", next);
  unilog(43, `removed "${showName}" from snooze list (inEmby)`);
}

app.get(
  "/api/snooze-list",
  apiWrapper(async () => readSnoozeList()),
);

app.post(
  "/api/snooze",
  apiWrapper(async ({ tvdbId, name, image, year }) => {
    const list = readSnoozeList();
    if (!list.find((s) => s.tvdbId === tvdbId)) {
      list.push({ tvdbId, name, image, year });
      writeSnoozeList(list);
    }
    return list;
  }),
);

app.post(
  "/api/unsnooze",
  apiWrapper(async ({ tvdbId }) => {
    const list = readSnoozeList().filter((s) => s.tvdbId !== tvdbId);
    writeSnoozeList(list);
    return list;
  }),
);

// CRUD operations
app.post("/api/addNoEmby", apiWrapper(addNoEmby));
app.post("/api/delNoEmby", apiWrapper(delNoEmby));
app.post("/api/addGap", apiWrapper(addGap));
app.post("/api/delGap", apiWrapper(delGap));
app.post("/api/setTvdbFields", apiWrapper(tvdb.setTvdbFields));

// Persist watched state into episodeData (used by the map for non-Emby / local
// episodes). `watchedEpis` is the legacy [[season, ep, ...], ...] array built by
// the client from the current seriesMap.
app.post(
  "/api/setWatchedEpis",
  apiWrapper(async (params) => {
    const { name, watchedEpis } = params || {};
    const allTvdb = tvdb.getAllTvdbSync();
    const rec = allTvdb?.[name];
    if (!rec) return { ok: false, error: "Show not found" };
    if (!Array.isArray(rec.episodeData)) rec.episodeData = [];
    const ed = rec.episodeData;
    const watchedSet = new Set();
    for (const row of watchedEpis || []) {
      if (!Array.isArray(row) || row.length < 1) continue;
      const [s, ...eps] = row;
      for (const e of eps) watchedSet.add(`${s}.${e}`);
    }
    // Apply watched flag to every existing episode.
    epd.forEachEpisode(ed, (s, e) => {
      epd.setEpisode(ed, s, e, { watched: watchedSet.has(`${s}.${e}`) });
    });
    // Create slots for any watched episodes not yet present.
    for (const row of watchedEpis || []) {
      if (!Array.isArray(row) || row.length < 1) continue;
      const [s, ...eps] = row;
      for (const e of eps) {
        if (!epd.getEp(ed, s, e)) epd.setEpisode(ed, s, e, { watched: true });
      }
    }
    rec.watchedCount = epd.countWatched(ed);
    await tvdb.saveTvdbSync();
    return { ok: true };
  }),
);
app.post("/api/setSharedFilters", apiWrapper(setSharedFilters));

app.get("/api/flexget-history", (req, res) => {
  try {
    res.json(flexget.getSentHistoryRows());
  } catch (e) {
    unilog(586, "error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/flexget-run", (req, res) => {
  flexget
    .runFlexgetAndProcess()
    .catch((e) => unilog(587, "manual run error:", e.message));
  res.json({ ok: true });
});

app.get("/api/flexget-run-stream", async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
  });

  const sendLine = (line) => {
    if (clientGone) return;
    try {
      let out = line.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /, "");
      if (/^(VERBOSE|WARNING)  /.test(out)) out = out.slice(39);
      res.write(`data: ${out}\n\n`);
    } catch (e) {
      unilog(1364, `flexget SSE write failed: ${e.message}`);
    }
  };

  const started = await flexget.runFlexgetStream(sendLine);
  if (started === false && !clientGone) {
    res.write("data: [flexget is already running]\n\n");
  }
  if (!clientGone) {
    try {
      res.end();
    } catch (e) {
      unilog(1365, `flexget SSE end failed: ${e.message}`);
    }
  }
});

app.get("/api/flexget-status", (req, res) => {
  res.json({ running: flexget.isFlexgetRunning() });
});

app.get("/api/flexget-config", async (req, res) => {
  try {
    const text = await flexget.readFlexgetConfig();
    res.type("text/plain").send(text);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// Open qBittorrent web UI — auto-login page served from hahnca.com so the
// SID cookie is set for hahnca.com (which proxies /qbt/ to qBittorrent).
app.get("/api/qbt-open", async (req, res) => {
  const QBT_CRED_PATH = path.join(
    path.dirname(SRVR_ROOT_DIR),
    "api",
    "secrets",
    "qbt-cred.txt",
  );
  const text = await fs.promises.readFile(QBT_CRED_PATH, "utf8");
  const creds = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    creds[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const qbHost = String(creds.QB_HOST || "");
  const qbUser = encodeURIComponent(
    qbHost.includes("@") ? qbHost.split("@")[0] : creds.QB_USER || "",
  );
  const qbPass = encodeURIComponent(creds.QB_PASS || "");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Opening qBittorrent...</title>
  <style>body{font-family:sans-serif;padding:2em;color:#333}</style>
</head>
<body>
  <p>Logging in to qBittorrent...</p>
  <script>
    fetch('/qbt/api/v2/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=${qbUser}&password=${qbPass}'
    })
    .then(r => r.text())
    .then(t => {
      if (t === 'Ok.') {
        window.location.replace('/qbt/');
      } else {
        document.body.textContent = 'Login failed: ' + t;
      }
    })
    .catch(e => {
      document.body.textContent = 'Error: ' + e.message;
    });
  </script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// Video streaming with codec-aware ffmpeg transcoding (see src/routes/media.js)
registerMediaRoutes(app);

// File operations
app.post("/api/deletePath", apiWrapper(deletePath));
app.post("/api/deletePaths", apiWrapper(deletePaths));
app.post("/api/delSeasonFiles", apiWrapper(delSeasonFiles));
app.post("/api/createShowFolder", apiWrapper(createShowFolder));
app.post(
  "/api/embySync",
  apiWrapper(async () => {
    await runEmbyFullSweep("embySync");
    return { ok: true };
  }),
);
// Note: /api/embySync kept for createShowFolderAndRefreshEmby; /api/triggerEmbySync is the primary client trigger

// Subtitles
app.post("/api/subsSearch", apiWrapper(subsSearch));
app.post("/api/subsCountEpisodes", apiWrapper(subsCountEpisodes));
app.post("/api/opn/search", async (req, res) => {
  const { videoPaths } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  const moviesDir = "/mnt/media/movies";
  const results = [];
  for (const vp of videoPaths) {
    const isMovie = vp.startsWith(moviesDir + "/");
    let searchParams;
    if (isMovie) {
      const filename = path.basename(vp, path.extname(vp));
      const yearMatch = filename.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : null;
      const parsed = parseTorrentTitle(filename);
      const title =
        parseTitleFromFilename(filename, "", parsed) ||
        filename.replace(/\./g, " ");
      searchParams = { query: title, year };
    } else {
      const showName = showNameFromFilePath(vp);
      const tvdbAll = tvdb.getAllTvdbSync?.();
      let tvdbRec = tvdbAll?.[showName];
      if (!tvdbRec?.imdbId) {
        // Try to find the TVDB record via parseTitleFromFilename + smartTitleMatch
        const fname = path.basename(vp);
        const ptt = parseTorrentTitle(fname);
        const title = parseTitleFromFilename(fname, showName, ptt);
        if (title) {
          const matched = smartTitleMatch(
            title,
            Object.values(tvdbAll),
            null,
            false,
          );
          if (matched?.imdbId) tvdbRec = matched;
        }
      }
      const parsed = parseFileSeasonEpisode(vp);
      if (tvdbRec?.imdbId) {
        searchParams = {
          imdb_id: tvdbRec.imdbId,
          season: parsed?.season,
          episode: parsed?.episode,
        };
      } else {
        searchParams = {
          query: showName,
          season: parsed?.season,
          episode: parsed?.episode,
        };
      }
    }
    try {
      const data = await subsSearch(searchParams);
      const items = Array.isArray(data?.data) ? data.data : [];
      results.push({
        videoPath: vp,
        items: items.map((r) => {
          const fid = r.file_id || r.attributes?.files?.[0]?.file_id;
          return {
            file_id: fid,
            tag: encodeFileIdBase32(fid),
            release:
              r.attributes?.release ||
              r.attributes?.files?.[0]?.cd_number ||
              String(fid || ""),
          };
        }),
      });
    } catch (e) {
      results.push({ videoPath: vp, items: [], error: e.message });
    }
  }
  res.json({ results });
});
app.post("/api/deleteSubFiles", apiWrapper(deleteSubFiles));
app.post("/api/offsetSubFiles", apiWrapper(offsetSubFiles));
app.post("/api/applySubOffset", async (req, res) => {
  const { videoPath, srtFile, offsetMs } = req.body || {};
  if (typeof videoPath !== "string" || !videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  if (
    typeof srtFile !== "string" ||
    !srtFile ||
    !path.basename(srtFile).endsWith(".srt")
  ) {
    res.status(400).json({ error: "srtFile required and must be .srt" });
    return;
  }
  if (!Number.isFinite(offsetMs) || offsetMs === 0) {
    res.json({ ok: true });
    return;
  }
  const resolvedVideo = path.resolve(videoPath);
  if (!resolvedVideo.startsWith(tvDir + "/")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const srtPath = path.join(
    path.dirname(resolvedVideo),
    path.basename(srtFile),
  );
  const resolvedSrt = path.resolve(srtPath);
  if (!resolvedSrt.startsWith(tvDir + "/") || !resolvedSrt.endsWith(".srt")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!fs.existsSync(resolvedSrt)) {
    res.status(404).json({ error: "srt file not found" });
    return;
  }
  const timeLineRe =
    /^([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(\s*-->\s*)([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(.*)$/;
  let text;
  try {
    text = fs.readFileSync(resolvedSrt, "utf8");
  } catch (e) {
    res.status(500).json({ error: "read failed: " + e.message });
    return;
  }
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = timeLineRe.exec(lines[i]);
    if (!m) continue;
    const startMs = srtTimeToMs(m[1]);
    const endMs = srtTimeToMs(m[3]);
    if (startMs === null || endMs === null) continue;
    lines[i] =
      `${msToSrtTime(Math.max(0, startMs + offsetMs))}${m[2]}${msToSrtTime(Math.max(0, endMs + offsetMs))}${m[4] || ""}`;
  }
  try {
    fs.writeFileSync(resolvedSrt, lines.join("\n"), "utf8");
  } catch (e) {
    res.status(500).json({ error: "write failed: " + e.message });
    return;
  }
  res.json({ ok: true });
});

// ASR subtitle queue endpoints
app.post("/api/asr/subs/enqueue", (req, res) => {
  const { videoPaths, fromUI } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  for (const vp of [...videoPaths].reverse()) {
    const chosenPath = vp.replace(/\.[^.]+$/, "") + ".mb.chosen";
    try {
      fs.unlinkSync(chosenPath);
    } catch (e) {
      if (e.code !== "ENOENT")
        unilog(1366, `chosen marker delete failed: ${e.message}`);
    }
    enqueueSubQueue(
      { videoFilePath: vp, fromUI: !!fromUI, lowPriority: false },
      true,
    );
  }
  persistSubQueue();
  doSubQueueNow();
  res.json({ ok: true, queued: videoPaths.length });
});

app.post("/api/asr/gensrt/enqueue", (req, res) => {
  const { videoPaths, fromUI } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  const entries = videoPaths.map((vp) => {
    const showName = showNameFromFilePath(vp);
    const parsed = parseFileSeasonEpisode(vp);
    return {
      videoPath: vp,
      showName,
      season: parsed?.season ?? 0,
      episode: parsed?.episode ?? 0,
      fromUI: !!fromUI,
      lowPriority: false,
      source: fromUI ? "ASR pane" : "subtitle pipeline",
      addedAt: Date.now(),
    };
  });
  addToAsrQueue(entries);
  res.json({ ok: true, queued: videoPaths.length });
});

app.post("/api/asr/emb/generate", async (req, res) => {
  const { videoPaths } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  res.json({ ok: true, queued: videoPaths.length });
  for (const vp of videoPaths) {
    await generateEmbSrts(vp, null, null, null, true).catch((e) =>
      unilog(598, "", e.message),
    );
  }
});

// Queues pane: contents of the processing queues, each with the in-flight
// entry's live stage and, where the work is predictable enough to be worth a
// number, an ETA. Polled while the pane is open.
app.get("/api/queues", async (req, res) => {
  try {
    res.json({
      sub: subsQueue.getSubQueueStatus(),
      asr: subsQueue.getAsrQueueStatus(),
      mp4: await mpfour.getMp4QueueStatus(),
      chksrt: subsQueue.getChkSrtQueueStatus(),
    });
  } catch (e) {
    unilog(2042, `queues snapshot failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/asr/chksrt/list", (req, res) => {
  cleanChkSrtQueue();
  const snapshot = publishChksrtState();
  syncBatchMsgs();
  res.json(snapshot);
});

app.post("/api/asr/chksrt/enqueue", (req, res) => {
  const { videoPaths } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  for (const vp of videoPaths) {
    enqueueSubQueueChkSrt(
      { videoFilePath: vp, fromUI: true, lowPriority: false },
      false,
    );
  }
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  publishChksrtState();
  syncBatchMsgs();
  res.json({ ok: true, queued: videoPaths.length });
});

app.post("/api/asr/chksrt/ok", (req, res) => {
  const { videoPath } = req.body || {};
  if (!videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  // result saved — this file no longer needs a seekable mirror
  mpfour.cancelEncode(videoPath);
  const base = resStripAlt(videoPath).replace(/\.[^.]+$/, "");
  const dir = path.dirname(videoPath);
  const basename = path.basename(base);
  let hasSrt = false;
  try {
    hasSrt = fs
      .readdirSync(dir)
      .some((f) => f.startsWith(basename) && f.endsWith(".srt"));
  } catch (e) {
    unilog(1367, `srt scan failed for ${dir}: ${e.message}`);
  }
  if (!hasSrt) {
    try {
      fs.writeFileSync(path.join(dir, basename + ".mb.chosen"), "", "utf8");
    } catch (e) {
      unilog(1368, `chosen marker write failed for ${basename}: ${e.message}`);
    }
  }
  const idx = subsState.subQueueChkSrt.findIndex(
    (e) => e.videoFilePath === videoPath,
  );
  if (idx !== -1) subsState.subQueueChkSrt.splice(idx, 1);
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  publishChksrtState();
  syncBatchMsgs();
  res.json({ ok: true });
});

// "All Off" — same handling as /ok, applied to every queued episode of a show:
// leave the srt files alone, mark files that have none, drop them from the queue.
app.post("/api/asr/chksrt/ok-show", (req, res) => {
  const { showName } = req.body || {};
  if (!showName) {
    res.status(400).json({ error: "showName required" });
    return;
  }
  const matches = subsState.subQueueChkSrt.filter(
    (e) => showNameFromFilePath(e.videoFilePath) === showName,
  );
  for (const entry of matches) {
    const videoPath = entry.videoFilePath;
    // result saved — this file no longer needs a seekable mirror
    mpfour.cancelEncode(videoPath);
    const base = resStripAlt(videoPath).replace(/\.[^.]+$/, "");
    const dir = path.dirname(videoPath);
    const basename = path.basename(base);
    let hasSrt = false;
    try {
      hasSrt = fs
        .readdirSync(dir)
        .some((f) => f.startsWith(basename) && f.endsWith(".srt"));
    } catch (e) {
      unilog(1958, `srt scan failed for ${dir}: ${e.message}`);
    }
    if (!hasSrt) {
      try {
        fs.writeFileSync(path.join(dir, basename + ".mb.chosen"), "", "utf8");
      } catch (e) {
        unilog(
          1959,
          `chosen marker write failed for ${basename}: ${e.message}`,
        );
      }
    }
    const idx = subsState.subQueueChkSrt.findIndex(
      (e) => e.videoFilePath === videoPath,
    );
    if (idx !== -1) subsState.subQueueChkSrt.splice(idx, 1);
  }
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  publishChksrtState();
  syncBatchMsgs();
  res.json({ ok: true, count: matches.length });
});

app.post("/api/asr/chksrt/gensrt", (req, res) => {
  const { videoPath } = req.body || {};
  if (!videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  const idx = subsState.subQueueChkSrt.findIndex(
    (e) => e.videoFilePath === videoPath,
  );
  if (idx !== -1) subsState.subQueueChkSrt.splice(idx, 1);
  const showName = showNameFromFilePath(videoPath);
  const parsed = parseFileSeasonEpisode(videoPath);
  addToAsrQueue([
    {
      videoPath,
      showName,
      season: parsed?.season ?? 0,
      episode: parsed?.episode ?? 0,
      fromUI: false,
      lowPriority: false,
      source: "chksrt player",
      addedAt: Date.now(),
    },
  ]);
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  publishChksrtState();
  syncBatchMsgs();
  res.json({ ok: true });
});

app.post("/api/asr/chksrt/unsnooze", (req, res) => {
  const { videoPath } = req.body || {};
  if (!videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  const showName = showNameFromFilePath(videoPath);
  if (removeFromChksrtSnoozed(showName, videoPath)) {
    persistChksrtSnoozed();
  }
  res.json({ ok: true });
});

app.post("/api/asr/chksrt/snooze", (req, res) => {
  const { videoPath } = req.body || {};
  if (!videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  const showName = showNameFromFilePath(videoPath);
  const idx = subsState.subQueueChkSrt.findIndex(
    (e) => e.videoFilePath === videoPath,
  );
  if (idx !== -1) subsState.subQueueChkSrt.splice(idx, 1);
  addToChksrtSnoozed(showName, videoPath);
  unilog(47, `chksrt snooze: ${videoPath}`);
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  persistChksrtSnoozed();
  publishChksrtState();
  syncBatchMsgs();
  res.json({ ok: true });
});

app.post("/api/asr/chksrt/select", (req, res) => {
  const { videoPath, selectedSrtPath } = req.body || {};
  if (!videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  const base = resStripAlt(videoPath).replace(/\.[^.]+$/, "");
  const dir = path.dirname(videoPath);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }
  const basename = path.basename(base);
  for (const f of entries) {
    if (!/\.srt$/.test(f)) continue;
    if (f.endsWith(".chosen")) continue;
    const full = path.join(dir, f);
    if (full === selectedSrtPath) continue;
    if (f.startsWith(basename + ".")) {
      try {
        fs.unlinkSync(full);
      } catch (e) {
        unilog(1369, `srt delete failed for ${f}: ${e.message}`);
      }
    }
  }
  if (!selectedSrtPath) {
    try {
      fs.writeFileSync(path.join(dir, basename + ".mb.chosen"), "", "utf8");
    } catch (e) {
      unilog(1370, `chosen marker write failed for ${basename}: ${e.message}`);
    }
  }
  const idx = subsState.subQueueChkSrt.findIndex(
    (e) => e.videoFilePath === videoPath,
  );
  if (idx !== -1) subsState.subQueueChkSrt.splice(idx, 1);
  // result saved — this file no longer needs a seekable mirror
  mpfour.cancelEncode(videoPath);
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  publishChksrtState();
  syncBatchMsgs();
  res.json({ ok: true });
});

app.post("/api/asr/chksrt/select-show", (req, res) => {
  const { showName } = req.body || {};
  if (!showName) {
    res.status(400).json({ error: "showName required" });
    return;
  }
  const matches = subsState.subQueueChkSrt.filter(
    (e) => showNameFromFilePath(e.videoFilePath) === showName,
  );
  for (const entry of matches) {
    const videoPath = entry.videoFilePath;
    const base = resStripAlt(videoPath).replace(/\.[^.]+$/, "");
    const dir = path.dirname(videoPath);
    const basename = path.basename(base);
    let dirEntries;
    try {
      dirEntries = fs.readdirSync(dir);
    } catch (e) {
      unilog(1873, `srt scan failed for ${dir}: ${e.message}`);
      dirEntries = [];
    }
    for (const f of dirEntries) {
      if (!/\.srt$/.test(f)) continue;
      if (f.endsWith(".chosen")) continue;
      if (!f.startsWith(basename + ".")) continue;
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch (e) {
        unilog(1874, `srt delete failed for ${f}: ${e.message}`);
      }
    }
    try {
      fs.writeFileSync(path.join(dir, basename + ".mb.chosen"), "", "utf8");
    } catch (e) {
      unilog(1875, `chosen marker write failed for ${basename}: ${e.message}`);
    }
    // result saved — this file no longer needs a seekable mirror
    mpfour.cancelEncode(videoPath);
    const idx = subsState.subQueueChkSrt.findIndex(
      (e) => e.videoFilePath === videoPath,
    );
    if (idx !== -1) subsState.subQueueChkSrt.splice(idx, 1);
  }
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  publishChksrtState();
  syncBatchMsgs();
  res.json({ ok: true, count: matches.length });
});

app.get("/api/asr/chksrt/history", (req, res) => {
  res.json(subsState.chksrtHistory);
});

app.post("/api/asr/chksrt/history/add", (req, res) => {
  const {
    showName,
    videoFilename,
    embeddedCounts,
    openSubsCount,
    choice,
    embStreamIndex,
    srtFile,
  } = req.body || {};
  if (!showName || !videoFilename || !choice) {
    res.status(400).json({ error: "showName, videoFilename, choice required" });
    return;
  }
  const entry = {
    showName: String(showName),
    videoFilename: String(videoFilename),
    embeddedCounts:
      embeddedCounts && typeof embeddedCounts === "object"
        ? embeddedCounts
        : {},
    openSubsCount: Number(openSubsCount) || 0,
    choice: String(choice),
    embStreamIndex: embStreamIndex != null ? Number(embStreamIndex) : null,
    srtFile: srtFile ? String(srtFile) : null,
    warned: false,
  };
  // Dedup: replace any entry with same showName + videoFilename
  subsState.chksrtHistory = subsState.chksrtHistory.filter(
    (h) =>
      h.videoFilename !== entry.videoFilename || h.showName !== entry.showName,
  );
  subsState.chksrtHistory.unshift(entry);
  if (subsState.chksrtHistory.length > 100)
    subsState.chksrtHistory.length = 100;
  persistChksrtHistory();
  res.json({ ok: true });
});

// Intro: get first available video file for a show
app.get("/api/introFirstFile", async (req, res) => {
  const showName = req.query.showName;
  if (!showName) {
    res.status(400).json({ ok: false, error: "showName required" });
    return;
  }
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    const record = allTvdb[showName];
    if (!record?.id) {
      res.json({ ok: false, error: "show not found" });
      return;
    }
    if (record.inEmby === false) {
      res.json({ ok: false, reason: "notInEmby" });
      return;
    }
    const seriesMap = await emby.getSeriesMap(record);
    if (!seriesMap) {
      res.json({ ok: false });
      return;
    }
    const sorted = [...seriesMap].sort((a, b) => a[0] - b[0]);
    let hasUnwatchedEpisode = false;
    let fallbackPath = null;
    let fallbackSeason = null;
    let fallbackEpisode = null;
    let fallbackId = null;
    for (const [season, episodes] of sorted) {
      const sortedEps = [...episodes].sort((a, b) => a[0] - b[0]);
      for (const [episode, ep] of sortedEps) {
        if (!fallbackPath && ep.path && !ep.noFile) {
          fallbackPath = ep.path;
          fallbackSeason = season;
          fallbackEpisode = episode;
          fallbackId = ep.id;
        }
        if (ep?.played) continue;
        hasUnwatchedEpisode = true;
        if (ep.path && !ep.noFile) {
          res.json({ ok: true, path: ep.path, season, episode, id: ep.id });
          return;
        }
      }
    }
    if (fallbackPath) {
      res.json({
        ok: true,
        path: fallbackPath,
        season: fallbackSeason,
        episode: fallbackEpisode,
        id: fallbackId,
      });
      return;
    }
    if (!hasUnwatchedEpisode) {
      res.json({ ok: false, reason: "allWatched" });
      return;
    }
    res.json({ ok: false });
  } catch (err) {
    unilog(599, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// Save a single intro field (startMark, skipDur, trimPos) for a season.
app.post("/api/saveSeasonIntro", async (req, res) => {
  const { name, season, field, value } = req.body;
  if (!name || season == null || !field) {
    res.status(400).json({ ok: false, error: "name, season, field required" });
    return;
  }
  const allTvdb = tvdb.getAllTvdbSync();
  const record = allTvdb[name];
  if (!record) {
    res.status(404).json({ ok: false, error: "show not found" });
    return;
  }
  try {
    await tvdb.saveSeasonIntro(record, season, field, value);
    // Once the show has a configured intro (trimPos, skipDur, or an explicit
    // "none"), it no longer needsIntro. Clear the flag immediately instead of
    // waiting for the next background update.
    await intro.reconcileNeedsIntro(name);
    res.json({ ok: true });
  } catch (err) {
    unilog(601, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.get("/api/introNextFile", async (req, res) => {
  const showName = req.query.showName;
  const currentSeason = parseInt(req.query.season, 10);
  const currentEpisode = parseInt(req.query.episode, 10);
  if (!showName || isNaN(currentSeason) || isNaN(currentEpisode)) {
    res
      .status(400)
      .json({ ok: false, error: "showName, season, episode required" });
    return;
  }
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    const record = allTvdb[showName];
    if (!record?.id) {
      res.json({ ok: false, error: "show not found" });
      return;
    }
    if (record.inEmby === false) {
      res.json({ ok: false, reason: "notInEmby" });
      return;
    }
    const seriesMap = await emby.getSeriesMap(record);
    if (!seriesMap) {
      res.json({ ok: false });
      return;
    }
    const sorted = [...seriesMap].sort((a, b) => a[0] - b[0]);
    let found = false;
    for (const [season, episodes] of sorted) {
      const sortedEps = [...episodes].sort((a, b) => a[0] - b[0]);
      for (const [episode, ep] of sortedEps) {
        if (!found) {
          if (season === currentSeason && episode === currentEpisode)
            found = true;
          continue;
        }
        if (ep?.path && !ep?.noFile) {
          res.json({ ok: true, path: ep.path, season, episode, id: ep.id });
          return;
        }
      }
    }
    res.json({ ok: false, reason: "noNextEpisode" });
  } catch (err) {
    unilog(602, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// Intro: skip forward by skipDur on the specified device (see src/intro.js)
app.post("/api/skipIntro", async (req, res) => {
  try {
    const { pressedAt, deviceName } = req.body || {};
    const result = await intro.doSkipIntro(pressedAt, deviceName);
    // Nothing playing: the skip key doubles as "select the show to resume".
    // tv-tv answers as soon as it knows the target, so this does not wait out
    // the key sequence.
    if (result?.reason === "notPlaying") tvTvGet("/tv/selectshow");
    res.json(result);
  } catch (err) {
    unilog(605, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// Intro: trimming — seek to absolute trimPos position (see src/intro.js)
app.post("/api/trimIntro", async (req, res) => {
  try {
    const { deviceName } = req.body || {};
    const result = await intro.doTrimIntro(deviceName);
    res.json(result);
  } catch (err) {
    unilog(607, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// Used by emby-skip-intro.user.js (tampermonkey) — only trimPos/skipDur are
// consumed; introDur is kept at null for response-shape compatibility.
app.get("/api/introDur", async (req, res) => {
  try {
    const { showName, showId, season } = req.query;
    if (!showName && !showId) {
      res.json({
        introDur: null,
        startMark: null,
        trimPos: null,
        skipDur: null,
      });
      return;
    }
    const allTvdb = tvdb.getAllTvdbSync();
    let record = allTvdb[showName];
    if (!record && showId) {
      record = Object.values(allTvdb).find((r) => r.id === showId);
    }
    const si = tvdb.getSeasonIntro(
      record,
      season != null ? Number(season) : null,
    );
    res.json({
      introDur: null,
      startMark: si.startMark,
      trimPos: si.trimPos,
      skipDur: si.skipDur,
    });
  } catch (e) {
    unilog(1579, `introDur error: ${e.message}`);
    res.json({
      introDur: null,
      startMark: null,
      trimPos: null,
      skipDur: null,
      error: e.message,
    });
  }
});

// Email
app.post("/api/sendEmail", apiWrapper(sendEmailHandler));

// ASR queue and log endpoints
app.get("/api/asr/queue", (req, res) => {
  res.json({
    entries: subsState.asrQueue,
    count: subsState.asrQueue.length,
    running: subsState.genSrtRunning,
  });
});

app.post("/api/asr/queue/add", (req, res) => {
  const { videoPaths } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  const entries = videoPaths.map((vp) => {
    const showName = showNameFromFilePath(vp);
    const parsed = parseFileSeasonEpisode(vp);
    return {
      videoPath: vp,
      showName,
      season: parsed?.season ?? 0,
      episode: parsed?.episode ?? 0,
      fromUI: true,
      lowPriority: false,
      source: "ASR pane",
      addedAt: Date.now(),
    };
  });
  addToAsrQueue(entries);
  res.json({ ok: true, count: subsState.asrQueue.length });
});

app.post("/api/asr/queue/remove", (req, res) => {
  const { videoPath } = req.body || {};
  if (!videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  const isProcessing =
    subsState.genSrtRunning && subsState.asrQueue[0]?.videoPath === videoPath;
  const idx = subsState.asrQueue.findIndex((e) => e.videoPath === videoPath);
  if (idx !== -1) {
    subsState.asrQueue.splice(idx, 1);
    persistAsrQueue();
    subsQueue.publishAsrQueueUpdate();
  }
  if (isProcessing && subsState.genSrtChild) {
    subsState.genSrtChild.kill("SIGTERM");
  }
  res.json({ ok: true, count: subsState.asrQueue.length });
});

app.get("/api/asr/log", (req, res) => {
  res.json({ lines: subsState.asrLogBuffer });
});

app.post("/api/asr/kill", (req, res) => {
  if (subsState.genSrtChild) {
    subsState.genSrtChild.kill("SIGTERM");
    res.json({ ok: true, killed: true });
  } else {
    res.json({ ok: true, killed: false });
  }
});

// Background operations
app.post(
  "/api/updateTvdb",
  apiWrapper(async () => {
    tvdb.updateTvdb();
    return "ok";
  }),
);

const HTTP_PORT = 8737;
const SRVR_INTERNAL_PORT = 8739;

// HTTPS options - use same certs as API server (located in api/cookies)
const CERT_DIR = path.join(path.dirname(SRVR_ROOT_DIR), "api", "cookies");
const httpsOptions = {
  key: fs.readFileSync(path.join(CERT_DIR, "localhost-key.pem")),
  cert: fs.readFileSync(path.join(CERT_DIR, "localhost-cert.pem")),
};

https.createServer(httpsOptions, app).listen(HTTP_PORT, () => {
  unilog(58, `HTTPS API listening on port ${HTTP_PORT}`);
  loadQueues();
  loadChksrtHistory();
  loadChksrtSnoozed();
  loadOpnCheckHistory();
  startSubQueueLoop();
  startAsrQueueLoop();
  // seekable-mp4 mirrors for the chksrt queue + intro episodes (own loop, not
  // ffmpegQueue)
  mpfour.start({ syncBatchMsgs, introEpisodePaths });
});

// The episode intro marking will open, for every show with an entry in the
// chksrt queue — in queue order. mpfour mirrors these ahead of the rest of the
// queue so one mirror serves both features: chksrt needs the file seekable to
// check subtitle sync, intro needs it seekable to scan for the intro.
// selectIntroFile lives in @tv/share so this picks exactly the episode the
// client will open.
function introEpisodePaths() {
  const allTvdb = tvdb.getAllTvdbSync() || {};
  const out = [];
  const seenShow = new Set();
  for (const entry of subsState.subQueueChkSrt) {
    const videoFilePath = entry?.videoFilePath;
    if (!videoFilePath) continue;
    const showName = showNameFromFilePath(videoFilePath);
    if (!showName || seenShow.has(showName)) continue;
    seenShow.add(showName);
    const record = allTvdb[showName];
    if (!record) continue;
    // Already-marked shows will never be opened for intro editing, so mirroring
    // their intro episode is wasted work. This also makes dropIntro() stick —
    // without it the next sweep would re-add what the needsIntro clear removed.
    if (intro.hasConfiguredIntro(record)) continue;
    const result = epd.selectIntroFile(record);
    if (result?.path) out.push(result.path);
  }
  return out;
}

app.post("/internal/tv-state", (req, res) => {
  notifyClients("tvMuteState", req.body);
  res.json({ ok: true });
});

function findChksrtPreferred(showName, episodeCode) {
  for (const h of subsState.chksrtHistory) {
    if (h.showName !== showName) continue;
    const m = (h.videoFilename || "").match(/[Ss](\d+)[Ee](\d+)/);
    if (!m) continue;
    const hCode = `S${m[1].padStart(2, "0")}E${m[2].padStart(2, "0")}`;
    if (hCode !== episodeCode) continue;
    return h;
  }
  return null;
}

app.get("/internal/chksrt/preferred", (req, res) => {
  const { showName, episodeCode } = req.query;
  if (!showName || !episodeCode) {
    res.status(400).json({ error: "showName and episodeCode required" });
    return;
  }
  const entry = findChksrtPreferred(showName, episodeCode);
  if (!entry) {
    res.json(null);
    return;
  }
  res.json({
    embStreamIndex: entry.embStreamIndex ?? null,
    srtFile: entry.srtFile ?? null,
    warned: entry.warned ?? false,
  });
});

app.post("/internal/chksrt/mark-warned", (req, res) => {
  const { showName, episodeCode } = req.body || {};
  if (!showName || !episodeCode) {
    res.status(400).json({ error: "showName and episodeCode required" });
    return;
  }
  for (const h of subsState.chksrtHistory) {
    if (h.showName !== showName) continue;
    const m = (h.videoFilename || "").match(/[Ss](\d+)[Ee](\d+)/);
    if (!m) continue;
    const hCode = `S${m[1].padStart(2, "0")}E${m[2].padStart(2, "0")}`;
    if (hCode !== episodeCode) continue;
    h.warned = true;
    persistChksrtHistory();
    break;
  }
  res.json({ ok: true });
});

app.post("/internal/subtitle-mismatch", (req, res) => {
  const { showName, episodeCode } = req.body || {};
  notifyClients("subtitleMismatch", { showName, episodeCode });
  res.json({ ok: true });
});

let lastNowPlayingShowName = null;
let lastNowPlayingList = [];
let lastPlayingKeys = new Set(); // "showName|season|episode" of all currently-playing items
let lastMissingEpWarning = null;
let lastAutoSkipKey = null; // "showName|season|episode" of last auto-skipped episode

async function refreshPlayedDatesForShow(showName) {
  if (!showName) return false;
  const allTvdb = tvdb.getAllTvdbSync?.();
  if (!allTvdb) return false;
  const tvdbRecord =
    allTvdb[showName] ||
    Object.values(allTvdb).find((record) => record?.name === showName);
  if (!tvdbRecord?.inEmby || !tvdbRecord?.id) return false;

  const latestPlayed = await fetchLatestPlayedInfo(tvdbRecord.id);
  if (!applyLatestPlayed(tvdbRecord, latestPlayed)) return false;

  if (tvdbRecord.hiddenFromRow) {
    tvdbRecord.hiddenFromRow = false;
    unilog(1909, `clearing hiddenFromRow for ${showName}: show was played`);
  }
  await tvdb.saveTvdbSync();
  notifyClients("tvdbUpdated", {
    name: tvdbRecord.name || showName,
    record: tvdbRecord,
  });
  unilog(
    612,
    `refreshed lastPlayedDate for ${showName} -> ` +
      `${tvdbRecord.lastPlayedDate} (${tvdbRecord.lastPlayedEpisode})`,
  );
  return true;
}

app.post("/internal/nowPlaying", (req, res) => {
  const { showName, playing } = req.body;
  const prevPlayingShowNames = new Set(
    (Array.isArray(lastNowPlayingList) ? lastNowPlayingList : [])
      .map((item) => item?.showName)
      .filter(Boolean),
  );
  const nextPlayingList = Array.isArray(playing) ? playing : [];
  const nextPlayingShowNames = new Set(
    nextPlayingList.map((item) => item?.showName).filter(Boolean),
  );
  const stoppedShowNames = [...prevPlayingShowNames].filter(
    (name) => !nextPlayingShowNames.has(name),
  );

  lastNowPlayingShowName = showName ?? null;
  lastNowPlayingList = nextPlayingList;
  if (lastNowPlayingList.length === 0) {
    lastMissingEpWarning = null;
  } else if (lastMissingEpWarning) {
    const stillPlaying = lastNowPlayingList.some(
      (p) =>
        p.device === lastMissingEpWarning.device &&
        p.showName === lastMissingEpWarning.showName,
    );
    if (!stillPlaying) lastMissingEpWarning = null;
  }
  notifyClients("nowPlaying", {
    showName: lastNowPlayingShowName,
    playing: lastNowPlayingList,
  });
  view.recordNowPlaying(lastNowPlayingShowName);
  res.json({ ok: true });

  // Auto-skip: fire when an episode is near its start (either TV). Keyed on the
  // episode rather than a not-playing -> playing edge: the TV session keeps its
  // NowPlayingItem across show changes and while paused at the Emby home screen,
  // so that edge frequently never happens again after the first play.
  const lrtv = lastNowPlayingList.find((p) =>
    TV_DEVICE_NAMES.includes(p.device),
  );
  const isNowPlaying = !!lrtv;
  if (isNowPlaying) {
    const posMs = Math.round((lrtv.positionTicks ?? 0) / 10000);
    const fresh = (lrtv.positionTicks ?? 0) < 3 * 1000 * 10000;
    const skipKey = `${lrtv.showName}|${lrtv.season}|${lrtv.episode}`;
    if (fresh && skipKey !== lastAutoSkipKey) {
      lastAutoSkipKey = skipKey;
      const allTvdb = tvdb.getAllTvdbSync();
      const record = allTvdb?.[lrtv.showName];
      const trimPos = tvdb.getSeasonIntro(record, lrtv.season).trimPos;
      unilog(1333, `start ${skipKey} posMs=${posMs} trimPos=${trimPos}`);
      if (trimPos > 0) {
        setTimeout(() => {
          intro
            .doTrimIntro(lrtv.device)
            .catch((e) => unilog(613, "error:", e.message));
        }, AUTO_SKIP_DELAY_MS);
      }
    }
  } else {
    lastAutoSkipKey = null;
  }

  checkMissingEpisodes(lastNowPlayingList).catch((e) => {
    unilog(1371, `checkMissingEpisodes failed: ${e.message}`);
  });
  for (const stoppedShowName of stoppedShowNames) {
    refreshPlayedDatesForShow(stoppedShowName).catch((err) => {
      unilog(
        614,
        `failed to refresh played dates for ${stoppedShowName}:`,
        err.message,
      );
    });
  }
});

async function checkMissingEpisodes(playing) {
  const currentKeys = new Set(
    playing
      .filter(
        (p) => p.showName && p.device && p.season != null && p.episode != null,
      )
      .map((p) => `${p.showName}|${p.season}|${p.episode}`),
  );
  for (const k of lastPlayingKeys) {
    if (!currentKeys.has(k)) lastPlayingKeys.delete(k);
  }

  for (const item of playing) {
    const { showName, device, season, episode } = item;
    if (!showName || !device || season == null || episode == null) continue;

    const key = `${showName}|${season}|${episode}`;
    if (lastPlayingKeys.has(key)) continue;
    lastPlayingKeys.add(key);

    const allTvdbData = tvdb.getAllTvdbSync();
    const tvdbRecord = allTvdbData?.[showName];

    // New episode started — check for unwatched episodes before this one
    if (!tvdbRecord?.id) continue;

    let seriesMap;
    try {
      seriesMap = await emby.getSeriesMap({ id: tvdbRecord.id });
    } catch (_) {
      continue;
    }
    if (!Array.isArray(seriesMap)) continue;

    let missingSeason = null;
    let missingEpisode = null;
    outer: for (const [s, episodes] of seriesMap) {
      if (s > season) break;
      for (const [e, data] of episodes) {
        if (s === season && e >= episode) break outer;
        if (!data.played) {
          missingSeason = s;
          missingEpisode = e;
          break outer;
        }
      }
    }

    if (missingSeason !== null) {
      const warningData = {
        showName,
        missingSeason,
        missingEpisode,
        currentSeason: season,
        currentEpisode: episode,
        device,
      };
      lastMissingEpWarning = warningData;
      notifyClients("missingEpisodeWarning", warningData);
    }
  }
}

http.createServer(app).listen(SRVR_INTERNAL_PORT, "127.0.0.1", () => {
  unilog(59, `Internal HTTP listening on port ${SRVR_INTERNAL_PORT}`);
});

//////////////////  WEBSOCKET SERVER  //////////////////

const appSocketName = "web app websocket";

// GLOBAL-MSG: CPU — periodic producer pushed to all clients.
const GLOBAL_MSG_POLL_MS = 5000;
const CPU_STALL_THRESHOLD = 1; // percent; below this, nothing important is starved

const pollGlobalMessages = () => {
  // GLOBAL-MSG: CPU stall — PSI "full" avg10 from /proc/pressure/cpu. This is the
  // % of the last 10s that even normal-priority work (Emby transcodes, live
  // streaming) was stalled waiting for CPU. It stays 0 while streaming has the
  // CPU it needs (batch work runs SCHED_IDLE and yields), and only climbs when
  // the box is genuinely oversubscribed. Far more meaningful than load average.
  try {
    const psi = fs.readFileSync("/proc/pressure/cpu", "utf8");
    const m = /full\s+avg10=([\d.]+)/.exec(psi);
    const full10 = m ? parseFloat(m[1]) : 0;
    // Sits just right of the show counts (position 0), and only when there is
    // actual stall to report — "Cpu:0" is noise.
    const pct = Math.round(full10);
    if (pct >= CPU_STALL_THRESHOLD) {
      setGlobalMessage({
        id: "CPU",
        text: `Cpu:${pct}`,
        position: 0.5,
      });
    } else {
      setGlobalMessage({ id: "CPU", action: "hide" });
    }
  } catch (e) {
    unilog(616, "cpu psi error:", e.message);
  }
  // The Dwn hdrMsg belongs to the client, which counts the down pane's whole
  // active set (downloading + waiting + future + encoding) from tv-down's own
  // channel. This poll used to set it too, from tv-inProgress.json, which holds
  // only the files actually in flight — two different numbers on one message
  // id, so the header alternated between them every few seconds.
  syncBatchMsgs(); // safety refresh in case any queue update was missed
};
setInterval(pollGlobalMessages, GLOBAL_MSG_POLL_MS);

wss.on("connection", (ws) => {
  let socketName = appSocketName;
  connectedClients.add(ws);

  if (lastNowPlayingShowName !== null) {
    ws.send(
      JSON.stringify({
        id: 0,
        notification: "nowPlaying",
        data: { showName: lastNowPlayingShowName, playing: lastNowPlayingList },
      }),
    );
  }
  if (lastMissingEpWarning !== null) {
    ws.send(
      JSON.stringify({
        id: 0,
        notification: "missingEpisodeWarning",
        data: lastMissingEpWarning,
      }),
    );
  }

  // GLOBAL-MSG: replay all currently-active server messages to the new client.
  for (const msgObj of activeServerMessages.values()) {
    try {
      ws.send(
        JSON.stringify({
          id: 0,
          notification: "setGlobalMessage",
          data: msgObj,
        }),
      );
    } catch (e) {
      unilog(1373, `ws send setGlobalMessage failed: ${e.message}`);
    }
  }

  ws.on("message", (data) => {
    const msg = data.toString();
    let parsed;
    try {
      parsed = JSON.parse(msg);
    } catch (e) {
      unilog(618, "ignoring bad message:", msg);
      return;
    }
    if (
      (parsed.ch || parsed.op === "register") &&
      handleChannelFrame(ws, parsed)
    )
      return;
    const { id, fname, param } = parsed;

    if (fname == "register") {
      // client registration — no response needed
    } else if (fname == "handleAsr") {
      const asrAction = param?.action;
      if (asrAction === "kill") {
        if (subsState.genSrtChild) {
          subsState.genSrtChild.kill("SIGTERM");
          try {
            ws.send(
              JSON.stringify({ id, status: "ok", data: { killed: true } }),
            );
          } catch (e) {
            unilog(1374, `ws send asr reply failed: ${e.message}`);
          }
        } else {
          try {
            ws.send(
              JSON.stringify({ id, status: "ok", data: { killed: false } }),
            );
          } catch (e) {
            unilog(1375, `ws send asr reply failed: ${e.message}`);
          }
        }
      } else {
        try {
          ws.send(JSON.stringify({ id, status: "ok", data: null }));
        } catch (e) {
          unilog(1376, `ws send asr ack failed: ${e.message}`);
        }
      }
    } else if (fname == "handleFix") {
      handleFix(ws, id, param);
    } else if (fname === "skipIntro") {
      const pressedAt = param?.pressedAt;
      intro
        .doSkipIntro(pressedAt)
        .catch((err) => unilog(619, "error:", err.message));
    } else if (fname === "unilogSubscribe") {
      unilogRoutes.addUnilogSubscriber(ws);
    } else if (fname === "unilogUnsubscribe") {
      unilogRoutes.removeUnilogSubscriber(ws);
    } else if (fname === "tvRemoteUnlock") {
      tvRemoteUnlock();
      const outMsg = JSON.stringify({
        id: 0,
        notification: "tvRemoteUnlock",
        data: null,
      });
      for (const client of connectedClients) {
        if (client !== ws && client.readyState === 1) {
          try {
            client.send(outMsg);
          } catch (e) {
            unilog(1378, `ws broadcast tvRemoteUnlock failed: ${e.message}`);
          }
        }
      }
    } else {
      unilog(622, "WebSocket function not supported (use HTTP):", fname);
      try {
        ws.send(
          JSON.stringify({
            id,
            status: "err",
            data: "Use HTTP API for non-streaming calls",
          }),
        );
      } catch (e) {
        unilog(623, "ws.send error:", e);
      }
    }
  });

  ws.on("error", (err) => {
    unilog(624, socketName, "error:", err.message);
    unsubscribeAllChannels(ws);
    connectedClients.delete(ws);
    unilogRoutes.removeUnilogSubscriber(ws);
    socketName = "unknown websocket";
  });

  ws.on("close", () => {
    // log(socketName + ' closed');
    unsubscribeAllChannels(ws);
    connectedClients.delete(ws);
    unilogRoutes.removeUnilogSubscriber(ws);
    socketName = "unknown websocket";
  });
});

// Phase 3: Incremental sync functions

/**
 * Background Emby sweep: detect new/removed shows,
 * sync collections, update metadata. Server-side port of client loadAllShows steps 2-5.
 */
let embyFullSweepRunning = false;
let embyFullSweepQueued = false;
let embyFullSweepQueuedCaller = null;
async function runEmbyFullSweep(caller = "unknown") {
  if (embyFullSweepRunning) {
    embyFullSweepQueued = true;
    embyFullSweepQueuedCaller = caller;
    return;
  }
  embyFullSweepRunning = true;
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    if (!allTvdb || Object.keys(allTvdb).length === 0) return;

    // Snapshot records before sweep for change detection
    const snapRecord = (rec) => JSON.stringify(rec);
    const preSnap = new Map();
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (
        rec &&
        typeof rec === "object" &&
        !Array.isArray(rec) &&
        String(rec.name || "").trim()
      ) {
        preSnap.set(name, snapRecord(rec));
      }
    }

    const now = Date.now();
    const isTvdbShow = (r) =>
      !!(
        r &&
        typeof r === "object" &&
        !Array.isArray(r) &&
        String(r.name || "").trim()
      );

    // Fetch Emby show list + 4 collections in parallel
    const embyShowUrl =
      `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?api_key=${EMBY_API_KEY}` +
      `&IncludeItemTypes=Series&Recursive=true` +
      `&Fields=Name,Id,DateCreated,Genres,Overview,Path,PremiereDate,ProviderIds,UserData` +
      `&StartIndex=0&Limit=10000`;
    const [embyResp, toTryResp, continueResp, markResp, lindaResp] =
      await Promise.all([
        fetch(embyShowUrl),
        fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${COLLECTION_IDS.toTry}&api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
        fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${COLLECTION_IDS.continue}&api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
        fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${COLLECTION_IDS.mark}&api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
        fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${COLLECTION_IDS.linda}&api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
      ]);
    if (!embyResp.ok) {
      unilog(651, "Emby fetch failed:", embyResp.status);
      return;
    }
    const embyData = await embyResp.json();
    const embyShows = embyData.Items || [];

    const parseIds = async (resp) =>
      new Set(
        (resp.ok ? (await resp.json()).Items || [] : []).map((i) => i.Id),
      );
    const [toTryIds, continueIds, markIds, lindaIds] = await Promise.all([
      parseIds(toTryResp),
      parseIds(continueResp),
      parseIds(markResp),
      parseIds(lindaResp),
    ]);

    // Helpers (ported from client emby.js)
    const findByTvdbId = (targetId) => {
      if (!targetId) return null;
      const id = String(targetId).trim();
      for (const [key, rec] of Object.entries(allTvdb)) {
        if (String(rec?.tvdbId || "").trim() === id)
          return { key, record: rec };
      }
      return null;
    };
    const normalizeTitle = (name) => {
      let out = String(name || "");
      const idx = out.indexOf("(");
      if (idx >= 0) out = out.slice(0, idx);
      return out
        .toLowerCase()
        .replace(/\./g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    };
    const findCandidate = (embyName, embyTvdbId) => {
      const norm = normalizeTitle(embyName);
      if (!norm) return null;
      for (const [key, rec] of Object.entries(allTvdb)) {
        if (!isTvdbShow(rec)) continue;
        const candName = String(rec.name || "").trim();
        if (!candName || candName === embyName) continue;
        if (normalizeTitle(candName) !== norm) continue;
        return { key, record: rec };
      }
      return null;
    };

    // Step 1: Key/Name mismatch cleanup
    const keysToDelete = [];
    for (const [key, show] of Object.entries(allTvdb)) {
      if (!isTvdbShow(show) || !show.name || key === show.name) continue;
      if (allTvdb[show.name] && allTvdb[show.name] !== show) {
        keysToDelete.push(key);
      } else if (!allTvdb[show.name]) {
        allTvdb[show.name] = show;
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      delete allTvdb[key];
      try {
        await tvdb.setTvdbFields({ name: key, $delTvdb: true });
      } catch (e) {
        unilog(1379, `tvdb delete failed for ${key}: ${e.message}`);
      }
    }

    // Step 2: Sync Emby shows into tvdb
    for (const embyShow of embyShows) {
      const name = embyShow.Name;
      const tvdbId = embyShow.ProviderIds?.Tvdb || embyShow.TvdbId;
      if (!tvdbId || tvdbId === "0") {
        continue;
      }
      const embyPath = embyShow.Path?.split("/").pop() || "";
      const showId = embyShow.Id;

      let tvdbKey = name;
      let tvdbRecord = allTvdb[tvdbKey];
      if (!tvdbRecord) {
        const byId = findByTvdbId(tvdbId);
        if (byId) {
          tvdbKey = byId.key;
          tvdbRecord = byId.record;
        }
      }

      if (!tvdbRecord) {
        // Block creation if a likely-same-show candidate exists
        if (findCandidate(name, tvdbId)) {
          unilog(652, `Blocked create for "${name}" — likely candidate exists`);
          continue;
        }
        const param = {
          show: { name: name, id: showId, tvdbId: tvdbId },
          seasonCount: 0,
          episodeCount: 0,
          watchedCount: 0,
          name,
          showId,
          tvdbId,
          embyPath,
          "emby.genres": embyShow.Genres || [],
          "emby.overview": embyShow.Overview || "",
          dateCreated: util.toPstDateTimeMs(embyShow.DateCreated),
          premiereDate: embyShow.PremiereDate?.substring(0, 10).replace(
            /-/g,
            "/",
          ),
          fromEmbySync: true,
          isPlayed: embyShow.UserData?.Played || false,
          playCount: embyShow.UserData?.PlayCount || 0,
        };
        try {
          await tvdb.getNewTvdb(param);
          unilog(70, `Created tvdb record: ${name}`);
        } catch (e) {
          unilog(653, `getNewTvdb failed for "${name}":`, e.message);
        }
        continue;
      }

      // Update existing record
      tvdbRecord.id = showId;
      if (!tvdbRecord.name) {
        unilog(654, `Backfilling missing name for tvdbId=${tvdbId}: "${name}"`);
        tvdbRecord.name = name;
        if (tvdbKey !== name) {
          allTvdb[name] = tvdbRecord;
          delete allTvdb[tvdbKey];
          tvdbKey = name;
        }
      }
      if (!tvdbRecord.tvdbId && tvdbId) {
        unilog(655, `Backfilling missing tvdbId=${tvdbId} for "${name}"`);
        // If a duplicate record already owns this tvdbId, merge its TVDB metadata
        // into this Emby-linked record and delete the duplicate.
        const duplicate = findByTvdbId(tvdbId);
        if (duplicate && duplicate.key !== name) {
          unilog(
            656,
            `Merging duplicate tvdbId=${tvdbId} record "${duplicate.key}" into "${name}"`,
          );
          const dup = duplicate.record;
          const TVDB_META_FIELDS = [
            "tvdbId",
            "image",
            "status",
            "overview",
            "firstAired",
            "lastAired",
            "nextAired",
            "averageRuntime",
            "originalCountry",
            "originalLanguage",
            "originalNetwork",
            "score",
            "trailers",
            "characters",
            "remotes",
            "imdbUrl",
            "imdbId",
            "imdbRatings",
            "rottenUrl",
            "rottenRatings",
            "wikiUrl",
            "redditUrl",
            "saved",
          ];
          for (const field of TVDB_META_FIELDS) {
            if (dup[field] !== undefined && !tvdbRecord[field]) {
              tvdbRecord[field] = dup[field];
            }
          }
          delete allTvdb[duplicate.key];
        } else {
          tvdbRecord.tvdbId = tvdbId;
        }
      }
      tvdbRecord.path = embyPath;
      tvdbRecord.genres = embyShow.Genres || [];
      tvdbRecord.overview = embyShow.Overview || "";
      tvdbRecord.dateCreated = util.toPstDateTimeMs(embyShow.DateCreated);
      tvdbRecord.premiereDate = embyShow.PremiereDate?.substring(0, 10).replace(
        /-/g,
        "/",
      );
      tvdbRecord.played = embyShow.UserData?.Played || false;
      tvdbRecord.playCount = embyShow.UserData?.PlayCount || 0;
      tvdbRecord.inToTry = toTryIds.has(showId);
      tvdbRecord.inContinue = continueIds.has(showId);
      tvdbRecord.inMark = markIds.has(showId);
      tvdbRecord.inLinda = lindaIds.has(showId);
      if (!tvdbRecord.inEmby) {
        unilog(
          1229,
          `embyFullSweep setting inEmby=true for ${name} (was ${tvdbRecord.inEmby})`,
        );
        tvdbRecord.inEmby = true;
        handlePickupChange(name, true, tvdbRecord.status);
      }
    }

    // Step 3: Detect disappeared shows → mark inEmby=false
    const embyNameSet = new Set(embyShows.map((s) => s.Name));
    const embyTvdbIdSet = new Set(
      embyShows.map((s) => String(s.ProviderIds?.Tvdb || "")).filter(Boolean),
    );
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (!isTvdbShow(rec) || rec.inEmby === false) continue;
      const stillInEmby =
        embyNameSet.has(name) ||
        (rec.tvdbId && embyTvdbIdSet.has(String(rec.tvdbId)));
      if (!stillInEmby) {
        unilog(71, `Marking ${name} as not in Emby`);
        unilog(
          1230,
          `embyFullSweep setting inEmby=false for ${name} (was ${rec.inEmby})`,
        );
        // Delete show folder from disk so Emby cannot re-add it on next scan
        const folderName =
          typeof rec.path === "string" &&
          rec.path &&
          !rec.path.includes("/") &&
          !rec.path.includes("\\")
            ? rec.path
            : name;
        const folderPath = path.join(tvDir, folderName);
        try {
          const st = fs.statSync(folderPath);
          if (st.isDirectory()) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            unilog(72, `Deleted folder: ${folderPath}`);
          }
        } catch (e) {
          if (e.code !== "ENOENT") {
            unilog(657, `Failed to delete folder ${folderPath}:`, e.message);
          }
        }
        rec.inEmby = false;
        rec.notReady = true;
        rec.inContinue = false;
        rec.inLinda = false;
        rec.inMark = false;
        rec.inToTry = false;
        handlePickupChange(name, false, rec.status);
      }
    }

    // Step 4: Fix any pre-existing inEmby=false records with stale error fields
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (isTvdbShow(rec) && rec.inEmby === false) {
        const nonEmbyConstants = [
          ["fileGap", false],
          ["fileEndError", false],
          ["full", false],
          ["notReady", true],
          ["inContinue", false],
          ["inLinda", false],
          ["inMark", false],
          ["inToTry", false],
        ];
        for (const [f, v] of nonEmbyConstants) {
          if (rec[f] !== v) {
            unilog(658, `Fixing stale ${f} for ${name}: ${rec[f]}->${v}`);
            rec[f] = v;
          }
        }
      }
    }

    await tvdb.saveTvdbSync();

    // Push changed records to clients
    let pushCount = 0;
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (
        !rec ||
        typeof rec !== "object" ||
        Array.isArray(rec) ||
        !String(rec.name || "").trim()
      )
        continue;
      const prev = preSnap.get(name);
      if (prev !== snapRecord(rec)) {
        debouncedTvdbPush(name);
        pushCount++;
      }
    }
    // Also push deletions (records that were in snapshot but no longer exist)
    for (const name of preSnap.keys()) {
      if (!allTvdb[name]) {
        debouncedTvdbPush(name);
        pushCount++;
      }
    }
    if (pushCount > 0)
      unilog(659, `Pushing ${pushCount} changed records to clients`);
  } catch (err) {
    unilog(660, "error:", err.message);
  } finally {
    embyFullSweepRunning = false;
    if (embyFullSweepQueued) {
      embyFullSweepQueued = false;
      const c = embyFullSweepQueuedCaller || "queued";
      embyFullSweepQueuedCaller = null;
      runEmbyFullSweep(c);
    }
  }
}

/**
 * Run gap check for specific shows
 * @param {Array} shows - Array of {showId, showName, tvdbRecord}
 * @param {boolean} checkDiskFirst - If true, check disk for each show before gap checking
 */
async function runGapCheckForShows(shows, checkDiskFirst = true) {
  if (!shows || shows.length === 0) return;

  const startTime = Date.now();
  try {
    let diskUpdateCount = 0;

    // Check disk for each show individually if requested
    if (checkDiskFirst) {
      for (const { showId, showName, tvdbRecord } of shows) {
        // Refresh episodeData file info (also updates date/size/noFiles/quality).
        await refreshEpisodeData(showName, tvdbRecord, { sources: ["disk"] });
        diskUpdateCount++;
      }

      if (diskUpdateCount > 0) {
        await tvdb.saveTvdbSync();
        unilog(661, `Updated disk info for ${diskUpdateCount} shows`);
      }
    }

    // Update lastPlayedDate for each show in batch (2-call Emby fetch per show)
    let lastPlayedChanged = 0;
    for (const { showId, showName, tvdbRecord } of shows) {
      const t0 = Date.now();
      try {
        const latestPlayed = await fetchLatestPlayedInfo(showId);
        const elapsed = Date.now() - t0;
        if (applyLatestPlayed(tvdbRecord, latestPlayed)) {
          lastPlayedChanged++;
          appendWatchgapLog(
            `  lastPlayedDate updated | ${elapsed}ms | ${showName} -> ` +
              `${tvdbRecord.lastPlayedDate} (${tvdbRecord.lastPlayedEpisode})`,
          );
        }
      } catch (err) {
        unilog(73, `${showName}: ${err.message}`);
      }
    }
    if (lastPlayedChanged > 0) {
      await tvdb.saveTvdbSync();
      unilog(74, `Gapcheck updated ${lastPlayedChanged} shows`);
    }

    // Now run gap check with fresh emby and disk data
    const gapData = await emby.gapCheckBatch(shows);
    for (const { showId, showName } of shows) {
      const g = gapData?.[showId];
      if (g) {
        appendWatchgapLog(
          `  ${showName}: notReady=${g.notReady} fileGap=${g.fileGap} anyWatched=${g.anyWatched}${g.fileEndError ? " fileEndError=true" : ""}${g.seasonWatchedThenNofile ? " sWTNF=true" : ""}`,
        );
      } else {
        appendWatchgapLog(`  ${showName}: no gap data (error or skipped)`);
      }
    }
    const updatedCount = await tvdb.updateTvdbWithGapData(gapData);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    unilog(75, `finished, ${elapsed} secs, ${shows.length} shows`);
  } catch (err) {
    unilog(663, "error:", err.message);
  }
}

const GAP_CHECK_BATCH_SIZE = 10;
const WATCHGAP_LOG = path.join(SRVR_DATA_DIR, "watchgap.log");

function appendWatchgapLog(line) {
  const ts = new Date()
    .toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" })
    .slice(0, 19);
  fs.appendFileSync(WATCHGAP_LOG, `${ts} ${line}\n`);
}

/**
 * Phase 3.3: Background gap check - processes shows least-recently-checked first
 */
async function runGapCheckBatch() {
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    if (!allTvdb || Object.keys(allTvdb).length === 0) return;

    const showsToCheck = Object.entries(allTvdb)
      .filter(([_, tvdbRecord]) => tvdbRecord?.inEmby && tvdbRecord?.id)
      .map(([showName, tvdbRecord]) => ({
        showId: tvdbRecord.id,
        showName,
        tvdbRecord,
      }))
      .sort((a, b) => {
        const aLast = a.tvdbRecord.lastGapCheck || "";
        const bLast = b.tvdbRecord.lastGapCheck || "";
        if (aLast !== bLast) return aLast < bLast ? -1 : 1;
        return compareShowNames({ name: a.showName }, { name: b.showName });
      });

    if (showsToCheck.length === 0) return;

    const batch = showsToCheck.slice(0, GAP_CHECK_BATCH_SIZE);
    unilog(
      664,
      `${batch.length}/${showsToCheck.length} shows, oldest: ${batch[0].showName}`,
    );
    appendWatchgapLog(
      `[batch ${batch.length}/${showsToCheck.length}] ${batch.map((s) => s.showName).join(", ")}`,
    );
    await runGapCheckForShows(batch, true);
  } catch (err) {
    unilog(665, "runGapCheckBatch error:", err.message);
  }
}

// Phase 3: Set up sync timers
const COLLECTION_IDS = {
  toTry: "1468316",
  continue: "4719143",
  mark: "4697672",
  linda: "4706186",
};

// Auto collection rules (applied in the background tvdb update, per show).
const CONTINUE_IDLE_DAYS = 30;

// Add/remove one show in one Emby collection. Emby owns collection membership
// -- the sweep reads it back -- so the record field is only updated after Emby
// accepts the change.
async function setEmbyCollection(collId, showId, member) {
  const url =
    `${EMBY_BASE_URL}/Collections/${collId}/Items` +
    `?Ids=${showId}&api_key=${EMBY_API_KEY}`;
  const resp = await fetch(url, { method: member ? "POST" : "DELETE" });
  return resp.ok;
}

// True when any episode that has aired (or already has a file) is unwatched.
function hasUnwatchedEpisodes(rec) {
  const today = new Date().toISOString().slice(0, 10);
  let found = false;
  epd.forEachEpisode(rec.episodeData, (s, e, ep) => {
    if (found) return;
    if (epd.isWatched(rec.episodeData, s, e)) return;
    if (epd.isUnaired(rec.episodeData, s, e, today)) return;
    found = true;
  });
  return found;
}

// Whole days between lastPlayedDate ("YYYY/MM/DD ...", PST) and today (PST).
// Compared as calendar dates so the server's own timezone never matters.
function daysSinceLastPlayed(rec) {
  const played = String(rec.lastPlayedDate || "")
    .slice(0, 10)
    .split("/");
  if (played.length !== 3) return null;
  const today = util.toPstDateOnly(new Date())?.split("/");
  if (!today || today.length !== 3) return null;
  const ms = (p) => Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return Math.floor((ms(today) - ms(played)) / (24 * 60 * 60 * 1000));
}

// A ready show nobody has started, with no waitStr and not claimed by Mark or
// Linda, goes into To Try. Once a show has any watched episode: To Try no
// longer applies, and a show with episodes left that has sat unwatched for
// CONTINUE_IDLE_DAYS goes into Continue. A show already in Mark or Linda is
// left out of Continue.
// Returns the change strings for the push2 log line.
async function applyAutoCollections(showName, rec) {
  const changes = [];
  if (!rec.inEmby || !rec.id) return changes;
  if (!rec.anyWatched) {
    if (
      !rec.inToTry &&
      rec.notReady === false &&
      !rec.watchedCount &&
      !rec.waitStr &&
      !rec.inMark &&
      !rec.inLinda
    ) {
      try {
        if (await setEmbyCollection(COLLECTION_IDS.toTry, rec.id, true)) {
          rec.inToTry = true;
          changes.push("inToTry:false->true(ready unwatched)");
          unilog(1998, `set toTry for ${showName}: ready and never watched`);
        } else {
          unilog(1999, `emby toTry add failed for ${showName}`);
        }
      } catch (e) {
        unilog(2000, `emby toTry add failed for ${showName}: ${e.message}`);
      }
    }
    return changes;
  }
  if (rec.inToTry) {
    try {
      if (await setEmbyCollection(COLLECTION_IDS.toTry, rec.id, false)) {
        rec.inToTry = false;
        changes.push("inToTry:true->false(watched)");
        unilog(
          1989,
          `cleared toTry for ${showName}: ${rec.watchedCount} episodes watched`,
        );
      } else {
        unilog(1983, `emby toTry remove failed for ${showName}`);
      }
    } catch (e) {
      unilog(1984, `emby toTry remove failed for ${showName}: ${e.message}`);
    }
  }
  const idleDays = daysSinceLastPlayed(rec);
  if (
    !rec.inContinue &&
    !rec.inMark &&
    !rec.inLinda &&
    idleDays !== null &&
    idleDays > CONTINUE_IDLE_DAYS &&
    hasUnwatchedEpisodes(rec)
  ) {
    try {
      if (await setEmbyCollection(COLLECTION_IDS.continue, rec.id, true)) {
        rec.inContinue = true;
        changes.push(`inContinue:false->true(idle ${idleDays}d)`);
        unilog(
          1990,
          `set continue for ${showName}: unwatched episodes left, idle ${idleDays} days`,
        );
      } else {
        unilog(1985, `emby continue add failed for ${showName}`);
      }
    } catch (e) {
      unilog(1986, `emby continue add failed for ${showName}: ${e.message}`);
    }
  }
  return changes;
}

const DISK_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour (full disk check)
const GAP_CHECK_INTERVAL = 6 * 60 * 1000; // 6 minutes (processes batch of 10 shows, checks disk per-show)

function fmtSeasonEpisode(season, episode) {
  if (season == null || episode == null) return null;
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");
  return `S${s}E${e}`;
}

async function fetchLatestPlayedInfo(showId) {
  // No IsPlayed filter: a partially-watched (resumable) episode is unplayed but
  // carries the show's newest LastPlayedDate — the same value that drives the
  // continue-watching row — so it must count as the show's last-played too.
  const epUrl =
    `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?api_key=${EMBY_API_KEY}` +
    `&ParentId=${showId}&IncludeItemTypes=Episode&Recursive=true` +
    `&Fields=UserDataLastPlayedDate&SortBy=DatePlayed&SortOrder=Descending&Limit=1`;
  const epResp = await fetch(epUrl);
  if (!epResp.ok) return null;
  const epData = await epResp.json();
  const item = epData.Items?.[0];
  const utcStr = item?.UserData?.LastPlayedDate;
  if (!utcStr) return null;
  // Date and episode both come off this one item, so the pair always describes
  // the same viewing.
  return {
    lastPlayedDate: util.toPstDateTimeMs(utcStr),
    lastPlayedEpisode: fmtSeasonEpisode(
      item.ParentIndexNumber,
      item.IndexNumber,
    ),
  };
}

// "YYYY/MM/DD HH:mm:ss.mmm" -> "YYYY/MM/DD HH:mm:ss".
function toSecondPrecision(pstStr) {
  return String(pstStr || "").split(".")[0];
}

// Move a freshly fetched last-played onto the record, and say whether anything
// moved. Hiding and unhiding stamp fabricated LastPlayedDates onto episodes in
// Emby, so a fetch that only echoes the value we stamped is not a viewing at
// all — it is dropped here and the real last viewing already on the record
// stands. Any other value is a genuine play and retires the stamp.
function applyLatestPlayed(rec, latest) {
  if (!latest?.lastPlayedDate) return false;
  // Emby keeps LastPlayedDate to the second, so the stamp it hands back has
  // lost whatever sub-second part the fabricated one carried. Comparing whole
  // seconds is what makes the echo recognizable.
  if (
    rec.fakeLastPlayed &&
    toSecondPrecision(latest.lastPlayedDate) ===
      toSecondPrecision(rec.fakeLastPlayed)
  )
    return false;
  const episode = latest.lastPlayedEpisode || null;
  if (
    latest.lastPlayedDate === (rec.lastPlayedDate || null) &&
    episode === (rec.lastPlayedEpisode || null) &&
    !rec.fakeLastPlayed
  )
    return false;
  rec.lastPlayedDate = latest.lastPlayedDate;
  rec.lastPlayedEpisode = episode;
  rec.fakeLastPlayed = null;
  return true;
}

//////////////////  EMBY SHOW DATE SHIFTING  //////////////////
// A show is "hidden" by pushing its Emby dates two years into the past so it
// falls to the far right of the "continue watching" and "latest tv" lists, and
// is brought back by setting them to now.
//
// Neither date lives on the series item. Emby gives a series no LastPlayedDate
// at all (its UserData holds only aggregates), and "latest tv" is ordered by
// episode DateCreated — a series' own DateCreated has no effect on its position.
// So both dates are written on episodes: lastPlayed on the most recently played
// one, DateCreated on every episode still inside the recent window.

const HIDE_BACKDATE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

// Emby stores dates with 7 fractional-second digits. The UserData endpoint
// silently ignores a plain toISOString() (3 digits), so pad it out to 7.
// Emby keeps only whole seconds of what is posted, so the stamp is floored
// first -- what goes in then matches what comes back out, which is what lets
// fakeLastPlayed recognize its own echo.
function toEmbyDate(ms) {
  const whole = Math.floor(ms / 1000) * 1000;
  return new Date(whole).toISOString().replace("Z", "0000Z");
}

// Emby's item update overwrites every field from the posted body, so the item
// must be fetched whole, modified, and posted back whole.
async function setItemDateCreated(itemId, targetIso) {
  const itemUrl = `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${itemId}?api_key=${EMBY_API_KEY}`;
  const itemResp = await fetch(itemUrl);
  if (!itemResp.ok) return false;
  const item = await itemResp.json();
  if (!item?.DateCreated) return false;
  item.DateCreated = targetIso;
  const res = await fetch(
    `${EMBY_BASE_URL}/Items/${itemId}?api_key=${EMBY_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    },
  );
  return res.ok || res.status === 204;
}

// "latest tv" ranks a series only by its UNWATCHED episodes — a watched
// episode's DateCreated is ignored no matter how recent — so only unwatched
// episodes are touched here (IsPlayed=false). Hiding (skipOlderThanMs set)
// backdates every unwatched episode still newer than the cutoff; moving only
// the newest would drop the show onto its second-newest unwatched episode.
// Un-hiding only needs the newest unwatched episode moved up, since that alone
// decides where the show lands in "latest tv". A fully-watched show has no
// unwatched episodes and cannot appear in "latest tv" at all, so this no-ops.
async function setEmbyDateCreated(showId, targetIso, skipOlderThanMs) {
  const epUrl =
    `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?api_key=${EMBY_API_KEY}` +
    `&ParentId=${showId}&IncludeItemTypes=Episode&Recursive=true&IsPlayed=false` +
    `&Fields=DateCreated&SortBy=DateCreated&SortOrder=Descending&Limit=10000`;
  const resp = await fetch(epUrl);
  const items = resp.ok ? (await resp.json())?.Items || [] : [];

  const epIds = [];
  for (const ep of items) {
    if (!ep?.Id || !ep.DateCreated) continue;
    if (!skipOlderThanMs) {
      epIds.push(ep.Id); // newest only — list is sorted descending
      break;
    }
    if (new Date(ep.DateCreated).getTime() < skipOlderThanMs) continue;
    epIds.push(ep.Id);
  }

  // Only episodes are touched. The series' own DateCreated is deliberately left
  // alone so the show list keeps showing when the show was really added.
  let count = 0;
  for (const epId of epIds) {
    if (await setItemDateCreated(epId, targetIso)) count++;
  }
  return count;
}

async function setOneEpisodeLastPlayed(ep, targetIso) {
  // Preserve the rest of the play state; only the date moves. LastPlayedDate
  // needs Emby's 7-digit format (targetIso) or the endpoint silently ignores it.
  const res = await fetch(urls.updateUserDataUrl(String(ep.Id)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Played: ep.UserData?.Played ?? true,
      PlayCount: ep.UserData?.PlayCount ?? 1,
      PlaybackPositionTicks: ep.UserData?.PlaybackPositionTicks ?? 0,
      LastPlayedDate: targetIso,
    }),
  });
  return res.ok || res.status === 204;
}

// A series' position in "continue watching" / "next up" is decided by the
// newest LastPlayedDate across all its episodes, so hiding has to backdate
// every episode still newer than the cutoff — moving only the newest would
// just leave the second-newest deciding the spot. This deliberately does NOT
// filter IsPlayed: a half-watched (resumable) episode is unplayed but carries a
// fresh LastPlayedDate that pins the show to the left, so it must move too.
// Un-hiding only needs one episode moved up to now to make the newest play now.
async function setEmbyLastPlayed(showId, targetIso, skipOlderThanMs) {
  const epUrl =
    `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?api_key=${EMBY_API_KEY}` +
    `&ParentId=${showId}&IncludeItemTypes=Episode&Recursive=true` +
    `&Fields=UserDataLastPlayedDate,UserDataPlayCount,UserDataPlaybackPositionTicks` +
    `&SortBy=DatePlayed&SortOrder=Descending&Limit=10000`;
  const resp = await fetch(epUrl);
  const items = resp.ok ? (await resp.json())?.Items || [] : [];

  const targets = [];
  for (const ep of items) {
    if (!ep?.Id || !ep.UserData?.LastPlayedDate) continue;
    if (!skipOlderThanMs) {
      targets.push(ep); // newest only — list is sorted by DatePlayed descending
      break;
    }
    if (new Date(ep.UserData.LastPlayedDate).getTime() < skipOlderThanMs)
      continue;
    targets.push(ep);
  }

  let count = 0;
  for (const ep of targets) {
    if (await setOneEpisodeLastPlayed(ep, targetIso)) count++;
  }
  return count;
}

// Sets both dates to targetIso. Either date is left alone when it doesn't
// exist in Emby, or when skipOlderThanMs is given and it is already older.
// Returns the names of the dates that were actually changed.
async function setEmbyShowDates(showId, targetIso, skipOlderThanMs = null) {
  const changed = [];
  try {
    const lpCount = await setEmbyLastPlayed(showId, targetIso, skipOlderThanMs);
    if (lpCount > 0) changed.push(`lastPlayed(${lpCount} epis)`);
  } catch (e) {
    unilog(1649, `lastPlayed set failed: ${e.message}`);
  }
  try {
    const dcCount = await setEmbyDateCreated(
      showId,
      targetIso,
      skipOlderThanMs,
    );
    if (dcCount > 0) changed.push(`dateCreated(${dcCount} epis)`);
  } catch (e) {
    unilog(1650, `dateCreated set failed: ${e.message}`);
  }
  return changed;
}

//////////////////  SHOW HIDE / UNHIDE  //////////////////
// "Hiding" means pushing BOTH dates back so the show drops to the far right of
// both the "continue watching" and "latest tv" rows. "Unhiding" is always
// per-row: continue watching by bumping lastPlayed to today, latest tv by
// bumping DateCreated to today. hiddenFromRow tracks the hidden state; it is
// set on hide and cleared whenever either row is unhidden (playback also
// unhides continue watching, but that is not detected so the flag is left as
// is). Shows with no episodes on disk are ignored by every path below.

function hasEpisodesOnDisk(rec) {
  return epd.seasonsWithFile(rec?.episodeData).length > 0;
}

async function setHiddenFromRow(showName, value) {
  await tvdb.setTvdbFields({
    name: showName,
    hiddenFromRow: value,
    dontEnqueue: true,
  });
}

// Read the show's real last viewing off Emby and park it on the record before
// any stamping moves it out of reach. Emby keeps one date per episode and no
// history, so once the stamp lands the true viewing is gone from Emby for good
// — the record becomes its only copy.
async function snapshotTruePlayed(showName, rec) {
  try {
    const latest = await fetchLatestPlayedInfo(rec.id);
    if (applyLatestPlayed(rec, latest)) await tvdb.saveTvdbSync();
  } catch (e) {
    unilog(1941, `last played snapshot failed for ${showName}: ${e.message}`);
  }
}

// Remember the fabricated timestamp just written into Emby, so later reads
// recognize it as ours and leave the real last viewing on the record alone.
async function markFakeLastPlayed(rec, targetIso, changed) {
  if (!changed.some((c) => c.startsWith("lastPlayed"))) return;
  rec.fakeLastPlayed = util.toPstDateTimeMs(targetIso);
  await tvdb.saveTvdbSync();
}

// Hide: both dates back. Every played/created episode still newer than the
// cutoff is moved so the show's newest date on each axis is two years old.
async function hideShowInEmby(showName, rec) {
  await snapshotTruePlayed(showName, rec);
  const cutoffMs = Date.now() - HIDE_BACKDATE_MS;
  const targetIso = toEmbyDate(cutoffMs);
  const changed = await setEmbyShowDates(rec.id, targetIso, cutoffMs);
  await markFakeLastPlayed(rec, targetIso, changed);
  return changed;
}

// Unhide continue watching: newest played episode's lastPlayed -> today.
async function unhideContinueWatching(showName, rec) {
  await snapshotTruePlayed(showName, rec);
  const targetIso = toEmbyDate(Date.now());
  const count = await setEmbyLastPlayed(rec.id, targetIso, null);
  await markFakeLastPlayed(rec, targetIso, count > 0 ? ["lastPlayed"] : []);
  return count;
}

// Unhide latest tv: newest episode's DateCreated -> today.
async function unhideLatestTv(rec) {
  return setEmbyDateCreated(rec.id, toEmbyDate(Date.now()), null);
}

// Hide a show unless it is already hidden, then mark it hidden.
async function hideShowIfNeeded(showName, rec, refreshCaller) {
  if (rec.hiddenFromRow) return;
  const changed = await hideShowInEmby(showName, rec);
  await setHiddenFromRow(showName, true);
  unilog(
    1663,
    `hiding ${showName}: ${changed.length ? changed.join(", ") : "no date change"}`,
  );
  if (changed.length > 0) {
    embyRefreshManager
      .request(refreshCaller, showName)
      .catch((e) => unilog(1664, `refresh failed: ${e.message}`));
  }
}

// Re-apply backdating to a show that is already hidden. A newly downloaded
// episode enters Emby with DateCreated=now regardless of hiddenFromRow, so a
// still-hidden show needs this every time a new episode lands or the new
// episode alone would surface it at the left of "latest tv". hideShowInEmby
// only touches episodes still newer than the cutoff, so this is a no-op for
// episodes already backdated by a previous hide.
async function reapplyHideIfAlreadyHidden(showName, rec) {
  if (!rec.hiddenFromRow) return;
  const changed = await hideShowInEmby(showName, rec);
  unilog(
    1667,
    `re-hiding new episode(s) for ${showName}: ${changed.length ? changed.join(", ") : "no date change"}`,
  );
  if (changed.length > 0) {
    embyRefreshManager
      .request(`chokidarRehide:${showName}`, showName)
      .catch((e) => unilog(1668, `refresh failed: ${e.message}`));
  }
}

// Bring a hidden show back to the latest tv row and clear hiddenFromRow.
async function unhideLatestTvIfNeeded(showName, rec) {
  if (!rec.hiddenFromRow) return;
  const cnt = await unhideLatestTv(rec);
  await setHiddenFromRow(showName, false);
  unilog(1665, `unhiding latest tv ${showName}: dateCreated(${cnt} epis)`);
  if (cnt > 0) {
    embyRefreshManager
      .request(`waitStrUnhide:${showName}`, showName)
      .catch((e) => unilog(1666, `refresh failed: ${e.message}`));
  }
}

// NOTE: syncEmbyUserData periodic sync removed - now using immediate triggers from client
// Collections and user data changes are handled by /api/triggerEmbySync and /api/triggerShowSelect
// NOTE: syncDiskData and runGapCheckBatch periodic timers removed - now handled by tryLocalGetTvdb
// per-show tick via perShowCallback (disk + gap) and preTvdbTickCallback (Emby sweep)

// Regenerate config.yml on startup and schedule flexget every 15 minutes.
upload().catch((e) => unilog(666, "startup upload error:", e.message));
cron.schedule("*/15 * * * *", () => {
  flexget
    .runFlexgetAndProcess()
    .catch((e) => unilog(667, "cron error:", e.message));
});

//////////////////  EMBY REFRESH MANAGER  //////////////////
// All Library/Refresh calls go through here: one running + one pending max,
// minimum 3 s gap between scans, server polls internally and pushes
// libraryProgress / libraryRefreshDone WS events to all clients.

const embyRefreshManager = (() => {
  const MIN_GAP_MS = 3000;
  const POLL_INTERVAL_MS = 2000;
  const POLL_TIMEOUT_MS = 5 * 60 * 1000;

  let running = false;
  let lastFinishedAt = 0;
  let currentProgress = null; // null or { pct: number }
  // pendingShowNames / pendingWaiters accumulate while a scan is running.
  // At the start of each run() they are moved into myShowNames / myWaiters so
  // that new arrivals during this scan queue into the *next* generation and
  // are not resolved until their own dedicated scan completes.
  let pendingShowNames = new Set();
  let pendingWaiters = []; // { resolve }

  async function getLibraryTaskId() {
    try {
      const tasksRes = await fetch(
        `${EMBY_BASE_URL}/ScheduledTasks?api_key=${EMBY_API_KEY}`,
      );
      if (!tasksRes.ok) return null;
      const tasks = await tasksRes.json();
      const task = (Array.isArray(tasks) ? tasks : []).find((t) => {
        const n = String(t?.Name || "").toLowerCase();
        return (
          n.includes("library") && (n.includes("scan") || n.includes("refresh"))
        );
      });
      return task?.Id || null;
    } catch (e) {
      unilog(1380, `emby scheduled tasks fetch failed: ${e.message}`);
      return null;
    }
  }

  async function run(myShowNames, myWaiters) {
    running = true; // set synchronously before first await

    const gap = MIN_GAP_MS - (Date.now() - lastFinishedAt);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));

    let taskId = null;
    unilog(
      668,
      `starting library refresh (shows: ${[...myShowNames].join(", ") || "manual"})`,
    );
    currentProgress = { pct: 0 };
    notifyClients("libraryProgress", { pct: 0 });
    publishChannelDelta("libraryRefresh", { type: "progress", pct: 0 });

    try {
      const res = await fetch(
        `${EMBY_BASE_URL}/Library/Refresh?api_key=${EMBY_API_KEY}`,
        { method: "POST" },
      );
      if (res.ok) {
        taskId = await getLibraryTaskId();
        unilog(76, `lib scan taskId: ${taskId || "none"}`);
      } else {
        unilog(669, `Library/Refresh failed: ${res.status} ${res.statusText}`);
      }
    } catch (e) {
      unilog(670, `Library/Refresh error:`, e.message);
    }

    if (taskId) {
      const pollStart = Date.now();
      while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const taskRes = await fetch(
            `${EMBY_BASE_URL}/ScheduledTasks/${taskId}?api_key=${EMBY_API_KEY}`,
          );
          if (taskRes.ok) {
            const task = await taskRes.json();
            const progressNum = Number(task?.CurrentProgressPercentage);
            if (Number.isFinite(progressNum)) {
              currentProgress = { pct: progressNum };
              notifyClients("libraryProgress", { pct: progressNum });
              publishChannelDelta("libraryRefresh", {
                type: "progress",
                pct: progressNum,
              });
            }
            if (task.State !== "Running") {
              unilog(77, `lib scan finished (State=${task.State})`);
              break;
            }
          }
        } catch (e) {
          unilog(671, `lib scan poll error:`, e.message);
        }
      }
    } else {
      unilog(78, `lib scan, no taskId, waiting 90s`);
      await new Promise((r) => setTimeout(r, 90 * 1000));
    }

    running = false;
    lastFinishedAt = Date.now();
    currentProgress = null;

    // Resolve this generation's waiters now — they got their scan.
    const showNames = [...myShowNames];
    unilog(
      672,
      `lib scan done, notifying clients (shows: ${showNames.join(", ") || "manual"})`,
    );
    notifyClients("libraryRefreshDone", { showNames });
    publishChannelDelta("libraryRefresh", { type: "done", showNames });
    for (const { resolve } of myWaiters) resolve(showNames);

    // If new requests arrived during this scan, start another run for them.
    if (pendingShowNames.size > 0 || pendingWaiters.length > 0) {
      const nextShowNames = new Set([...pendingShowNames]);
      const nextWaiters = [...pendingWaiters];
      pendingShowNames = new Set();
      pendingWaiters = [];
      unilog(
        673,
        `lib scan pending shows: ${[...nextShowNames].join(", ")}, re-running`,
      );
      setTimeout(
        () =>
          run(nextShowNames, nextWaiters).catch((e) =>
            unilog(674, "lib scan run error:", e.message),
          ),
        MIN_GAP_MS,
      );
    }
  }

  return {
    request(caller = "unknown", showName = null) {
      const promise = new Promise((resolve) => {
        if (running) {
          // Queue for the next generation scan
          if (showName) pendingShowNames.add(showName);
          pendingWaiters.push({ resolve });
          unilog(
            675,
            `lib scan ${caller}: refresh in flight, queued${showName ? ` ${showName}` : ""}`,
          );
        } else {
          // Start a new scan immediately with this request as the first in its generation
          if (showName) pendingShowNames.add(showName);
          pendingWaiters.push({ resolve });
          const myShowNames = new Set([...pendingShowNames]);
          const myWaiters = [...pendingWaiters];
          pendingShowNames = new Set();
          pendingWaiters = [];
          run(myShowNames, myWaiters).catch((e) =>
            unilog(676, "lib scan run error:", e.message),
          );
        }
      });
      return promise;
    },
    getStatus() {
      return {
        running,
        progress: currentProgress,
      };
    },
  };
})();

registerLocalChannel("libraryRefresh", {
  snapshot: () => embyRefreshManager.getStatus(),
});

//////////////////  CHOKIDAR FILE WATCHER  //////////////////

const changedShows = new Map(); // showName -> { timeout, files: Set<string> }
const DISK_CHANGE_DEBOUNCE_MS = 3000; // 3 seconds

/**
 * Extract show name from file path
 * Path format: /mnt/media/tv/ShowName/Season 01/episode.mkv
 */
function extractShowNameFromPath(filePath) {
  const relativePath = filePath.replace(tvDir + "/", "");
  const parts = relativePath.split("/");
  if (parts.length > 0) {
    return parts[0]; // First part is show name
  }
  return null;
}

// Tracks shows currently being processed to prevent parallel calls
const inFlightDiskChanges = new Set();
const pendingDiskChanges = new Set();

/**
 * Handle disk change for a show (debounced)
 */
async function handleShowDiskChange(showName) {
  if (inFlightDiskChanges.has(showName)) {
    pendingDiskChanges.add(showName);
    unilog(79, `${showName} already in flight, queued retry`);
    return;
  }
  inFlightDiskChanges.add(showName);
  try {
    unilog(80, `Processing disk change for: ${showName}`);

    // State before this disk change: a waitStr set/unset flip OR the first
    // episode(s) landing while waitStr is set drives hide/unhide below,
    // immediately rather than waiting for the background loop.
    const recBefore = tvdb.getAllTvdbSync()?.[showName];
    const waitStrBefore = recBefore?.waitStr;
    const hadEpisodesOnDiskBefore = hasEpisodesOnDisk(recBefore);

    // Update disk info for this show
    const diskInfo = await getShowDiskInfo(showName);
    if (diskInfo) {
      const [maxDate, totalSize] = diskInfo;

      // Update cache if it exists
      disk.setDiskCacheEntry(showName, diskInfo);

      // Update tvdb record with new disk info
      const allTvdb = tvdb.getAllTvdbSync();
      const tvdbRecord = allTvdb[showName];
      if (tvdbRecord) {
        // Refresh episodeData file info (also sets date/size/noFiles/quality).
        await refreshEpisodeData(showName, tvdbRecord, { sources: ["disk"] });
        await tvdb.saveTvdbSync();
        debouncedTvdbPush(showName);
        unilog(
          677,
          `Updated disk info for ${showName}: ${totalSize} bytes, ${maxDate}`,
        );
      }
    } else {
      // If we can't get disk info (e.g., folder was deleted), remove from cache
      disk.deleteDiskCacheEntry(showName);
    }

    // Notify clients that disk changed for this show (progress comes from libraryProgress WS events)
    notifyClients("showDiskChanged", { showName });
    unilog(678, `Notified clients about disk change for ${showName}`);

    // Trigger Emby library refresh through manager (throttled, deduped, pushes WS progress)
    unilog(83, `Requesting Emby library refresh for ${showName}`);
    await embyRefreshManager.request(`chokidar:${showName}`, showName);
    unilog(84, `Library refresh done for ${showName}`);

    try {
      const allTvdb = tvdb.getAllTvdbSync();
      const tvdbRecord = allTvdb[showName];
      if (!tvdbRecord?.inEmby || !tvdbRecord?.id) return;

      // Refresh fileGap, watchGap, etc.
      await runGapCheckForShows(
        [{ showId: tvdbRecord.id, showName, tvdbRecord }],
        false,
      );
      unilog(85, `Gap check refreshed for ${showName}`);

      // Refresh watched/id in episodeData from Emby (also dual-writes
      // watchedEpis/watchedCount).
      await refreshEpisodeData(showName, tvdbRecord, { sources: ["emby"] });
      await tvdb.saveTvdbSync();
      unilog(86, `watched refreshed for ${showName}`);

      // Hide immediately when the show newly enters the "waiting, with
      // episodes on disk" state: either waitStr just appeared, or the first
      // episode(s) landed while waitStr was already set (that case has no
      // waitStr flip for the loop to catch). This is deliberately HIDE-only —
      // an early hide is harmless (the next full loop tick corrects it if
      // wrong) but an early UNHIDE is not: this handler only refreshes
      // disk/emby, never re-scrapes TVDB, so a newly-downloaded episode can
      // make waitStr transiently read as cleared even though TVDB simply
      // hasn't announced the next episode's air date yet. Trusting that here
      // would flip a show back into "latest tv" every time an episode lands,
      // undoing a hide the moment it was set. Unhiding on a real waitStr clear
      // is left entirely to the background loop, which re-scrapes TVDB first.
      const waitStrAfter = tvdbRecord.waitStr;
      const hasEpisodesNow = hasEpisodesOnDisk(tvdbRecord);
      const waitStrJustSet = !waitStrBefore && waitStrAfter;
      const firstEpisodesJustLanded =
        !hadEpisodesOnDiskBefore && hasEpisodesNow;
      if (tvdbRecord.hiddenFromRow) {
        // Already hidden: this new episode needs the same backdating, or it
        // would show up fresh at the left of "latest tv" on its own.
        if (hasEpisodesNow)
          await reapplyHideIfAlreadyHidden(showName, tvdbRecord);
      } else if (
        hasEpisodesNow &&
        waitStrAfter &&
        (waitStrJustSet || firstEpisodesJustLanded)
      ) {
        await hideShowIfNeeded(
          showName,
          tvdbRecord,
          `chokidarHide:${showName}`,
        );
      }
    } catch (err) {
      unilog(679, `Post-download refresh error for ${showName}:`, err.message);
    }
  } catch (err) {
    unilog(680, `Error handling disk change for ${showName}:`, err.message);
  } finally {
    inFlightDiskChanges.delete(showName);
    if (pendingDiskChanges.has(showName)) {
      pendingDiskChanges.delete(showName);
      unilog(87, `Re-running queued disk change for ${showName}`);
      setTimeout(() => handleShowDiskChange(showName), 1000);
    }
  }
}

// Start watching TV directory
const watcher = chokidar.watch(tvDir, {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true, // don't emit events for existing files on startup
  usePolling: false, // use native inotify events
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100,
  },
  depth: 99, // watch all subdirectories
});

watcher
  .on("add", async (filePath) => {
    const ext = filePath.split(".").pop();
    if (!videoFileExtensions.includes(ext)) return;

    const showName = extractShowNameFromPath(filePath);
    if (!showName) return;

    unilog(88, `video added: ${showName}`);

    // Update only the affected show in cache instead of invalidating everything
    await disk.updateDiskCacheForShow(showName);

    // Debounce: accumulate files per show, clear existing timeout and set new one
    const existing = changedShows.get(showName);
    if (existing) {
      clearTimeout(existing.timeout);
      existing.files.add(filePath);
    } else {
      changedShows.set(showName, { timeout: null, files: new Set([filePath]) });
    }
    const entry = changedShows.get(showName);
    entry.timeout = setTimeout(async () => {
      changedShows.delete(showName);
      try {
        const tvdbAll = tvdb.getAllTvdbSync?.();
        const tvdbRec = tvdbAll?.[showName];
        const videoFiles = [...entry.files].filter((fp) =>
          videoFileExtensions.includes(fp.split(".").pop()),
        );
        if (videoFiles.length === 0) {
          handleShowDiskChange(showName);
          return;
        }
        if (tvdbRec && tvdbRec.inEmby) {
          let queued = false;
          for (const fp of videoFiles) {
            // Enforce one active video per episode before chksrt: a replacement
            // download that raced the old file can leave two active files. Demote
            // the lower-res one; if fp itself was the loser, skip enqueuing it.
            const fpSeasonDir = path.dirname(fp);
            const fpSe = parseFileSeasonEpisode(
              resStripAlt(path.basename(fp)),
              path.basename(fpSeasonDir),
            );
            if (fpSe?.season != null && fpSe?.episode != null) {
              const demoted = reconcileDuplicateEpisodeVideos(
                fpSeasonDir,
                fpSe.season,
                fpSe.episode,
              );
              if (demoted.has(fp)) continue;
            }
            const needs = await fileNeedsSubChecked(fp, showName);
            unilog(682, `fileNeedsSubChecked(${path.basename(fp)}) = ${needs}`);
            if (needs) {
              enqueueSubQueue(
                { videoFilePath: fp, fromUI: false, lowPriority: false },
                false,
              );
              queued = true;
            }
          }
          if (queued) {
            persistSubQueue();
            doSubQueueNow();
          }
        }
      } catch (err) {
        unilog(683, `sub check error for ${showName}:`, err.message);
      }
      handleShowDiskChange(showName);
    }, DISK_CHANGE_DEBOUNCE_MS);
  })
  .on("unlink", (filePath) => {
    const ext = filePath.split(".").pop();
    if (!videoFileExtensions.includes(ext)) return;

    const showName = extractShowNameFromPath(filePath);
    if (!showName) return;

    unilog(684, `video deleted: ${showName}`);

    // Debounce: clear existing timeout and set new one
    const unlinkEntry = changedShows.get(showName);
    if (unlinkEntry) clearTimeout(unlinkEntry.timeout);

    const unlinkTimeout = setTimeout(() => {
      changedShows.delete(showName);
      handleShowDiskChange(showName);
    }, DISK_CHANGE_DEBOUNCE_MS);

    if (unlinkEntry) unlinkEntry.timeout = unlinkTimeout;
    else
      changedShows.set(showName, { timeout: unlinkTimeout, files: new Set() });
  })
  .on("error", (error) => {
    unilog(685, "Watcher error:", error);
  })
  .on("ready", () => {
    unilog(90, "Initial scan complete. Ready for changes.");
  });

unilog(91, `Watching ${tvDir} for file changes...`);

// Enforce one active (non-.old) video file per episode. A replacement download
// that races the file it replaces can leave two active videos: worker.js
// renames the pre-existing SxxExx file to .old only once, at rsync start, so a
// same-episode file that lands mid-download is never demoted. When that happens the
// lower-resolution active file is demoted to .old and its chksrt entry / mp4
// mirror are dropped, so chksrt only ever resolves against the surviving active
// file. Returns the Set of absolute paths that were demoted. See down-coll-plan.md.
function reconcileDuplicateEpisodeVideos(seasonDir, season, episode) {
  const demoted = new Set();
  const actives = resFindEpisodeVideos(seasonDir, season, episode).filter(
    (v) => !v.alt,
  );
  if (actives.length < 2) return demoted;
  // Only act when there is a strictly-higher known resolution to keep; never guess
  // on same-resolution ties or when any active file's resolution is unknown.
  if (actives.some((v) => v.res <= 0)) return demoted;
  const bestRes = Math.max(...actives.map((v) => v.res));
  const losers = actives.filter((v) => v.res < bestRes);
  if (losers.length === 0) return demoted;
  for (const loser of losers) {
    const src = path.join(seasonDir, loser.name);
    let dst = src + ".old";
    while (fs.existsSync(dst)) dst += ".old";
    try {
      fs.renameSync(src, dst);
    } catch (e) {
      unilog(
        1537,
        `demote duplicate episode video failed for ${loser.name}: ${e.message}`,
      );
      continue;
    }
    demoted.add(src);
    unilog(
      1538,
      `demoted duplicate ${loser.res}p episode video to .old (keeping ${bestRes}p): ${loser.name}`,
    );
    const idx = subsState.subQueueChkSrt.findIndex(
      (e) => e.videoFilePath === src,
    );
    if (idx !== -1) subsState.subQueueChkSrt.splice(idx, 1);
    mpfour.cancelEncode(src);
  }
  if (demoted.size > 0) {
    cleanChkSrtQueue();
    persistSubQueueChkSrt();
    publishChksrtState();
    syncBatchMsgs();
  }
  return demoted;
}

// Watchdog heartbeat: a periodic status beat (queue depths + running flags) so
// the external tv-watchdog monitor (apps/watchdog) can detect a dead/stuck
// server and spot stuck queues. Read from the unilog DB by matching "hb ".
const WATCHDOG_HEARTBEAT_MS = 2 * 60 * 1000;
setInterval(() => {
  unilog(
    1206,
    `hb subQ=${subsState.subQueue.length} chkQ=${subsState.subQueueChkSrt.length} ` +
      `asrQ=${subsState.asrQueue.length} ` +
      `flex=${flexget.isFlexgetRunning() ? 1 : 0} ` +
      `sweep=${embyFullSweepRunning ? 1 : 0} clients=${connectedClients.size} ` +
      `subDone=${subsState.subDone} asrDone=${subsState.asrDone} ` +
      `maxLoopLag=${maxLoopLagMs}ms`,
  );
  maxLoopLagMs = 0; // report the worst lag per beat, not since boot
}, WATCHDOG_HEARTBEAT_MS);
