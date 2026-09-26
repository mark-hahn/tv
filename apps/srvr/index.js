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
import * as gaps from "./src/gaps.js";
import * as tvdb from "./src/tvdb.js";
import * as util from "./src/util.js";
import * as email from "./src/email.js";
import * as tmdb from "./src/tmdb.js";
import { handleFix, readFixState, tailFixLog } from "./src/fix.js";
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
  vidDemoteToOld,
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
  tvRemoteLockInfo,
  tvRemoteUnlock,
  tvTvGet,
} from "./src/tvRemoteKey.js";
import * as subsQueue from "./src/subsQueue.js";
import * as stills from "./src/stills.js";
import * as recode from "./src/recode.js";

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
import * as showPaths from "./src/showPaths.js";
import * as dupeFolders from "./src/dupeFolders.js";
import * as strayEpisodes from "./src/strayEpisodes.js";
import * as fileOps from "./src/fileOps.js";
import * as localHistory from "./src/localHistory.js";
import { startOldFileCleanup } from "./src/oldFiles.js";
const { getFile, deletePath, deletePaths, delSeasonFiles, createShowFolder } =
  fileOps;
import { registerMediaRoutes } from "./src/routes/media.js";
import { registerStillsRoutes } from "./src/routes/stills.js";
import { registerUsbRoutes } from "./src/routes/usb.js";
import * as unilogRoutes from "./src/routes/unilog.js";
const { broadcastUnilog } = unilogRoutes;
const registerUnilogRoutes = unilogRoutes.registerUnilogRoutes;
// Local aliases keep existing call sites terse (disk domain lives in src/disk.js).
const showNameFromFilePath = showPaths.showNameFromFilePath;
const refreshEpisodeData = disk.refreshEpisodeData;
const getShowsFromDisk = disk.getShowsFromDisk;
const getShowDiskInfo = disk.getShowDiskInfo;
const safeShowFolderName = disk.safeShowFolderName;
const seasonFolderName = disk.seasonFolderName;
const buildTvShowNfo = disk.buildTvShowNfo;
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
  abortAsr,
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
  // Recode — library files being replaced with h264 the tv can play
  const recodePending = recode.getRecodePending();
  if (recodePending.length > 0) {
    setGlobalMessage({
      id: "Recode",
      text: `Recode:${recodePending.length}`,
      position: 2008,
    });
  } else {
    setGlobalMessage({ id: "Recode", action: "hide" });
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

tvdb.setPerShowCallback(async (showName, tvdbRecord, options) => {
  try {
    if (tvdbRecord.inEmby) {
      removeFromSnoozeByShow(showName, tvdbRecord.tvdbId);
    }
    // Subtitle scan for inEmby shows
    if (tvdbRecord.inEmby) {
      const showFolderName = showPaths.showFolderFor(showName, tvdbRecord);
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
    // Gap check
    let gapChanges = [];
    const prevNeedsIntro = !!tvdbRecord.needsIntro;
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      const gapData = await gaps.gapCheckOne(
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
          "stray",
          "strayCount",
        ];
        for (const f of gapFields) {
          if (tvdbRecord[f] !== gapData[f])
            gapChanges.push(`${f}:${tvdbRecord[f]}->${gapData[f]}`);
        }
        // Files for episodes this show never aired. Logged as it turns on, so
        // a standing condition does not repeat every gap check.
        const strayIsNew = !tvdbRecord.stray && gapData.stray;
        if (strayIsNew) {
          unilog(
            2156,
            `${showName}: ${gapData.strayCount} file(s) for episodes it never aired, from S${gapData.straySeason}E${gapData.strayEpisode}: ${(gapData.strayFiles || []).join(", ")}`,
          );
        }
        Object.assign(tvdbRecord, gapData);
        // The live flag clears the moment the files go -- moved out, deleted,
        // or TVDB finally publishing the air date. strayNote is the record
        // that it happened at all, and is never cleared automatically, so a
        // single non-aired file always leaves something to verify against.
        // Written whenever the flag is up and no note exists yet, not only on
        // the transition, so a show already flagged still gets one.
        if (gapData.stray && !tvdbRecord.strayNote) {
          tvdbRecord.strayNote = `${gapData.strayCount} non-aired file(s) from S${gapData.straySeason}E${gapData.strayEpisode} seen ${strayEpisodes.strayStamp()}`;
        }
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
      // so this is the earliest warning that its stills are wanted — jump them
      // to the front of the build queue.
      if (nowNeedsIntro) {
        try {
          const introFile = epd.selectIntroFile(tvdbRecord);
          if (introFile?.path)
            await stills.startStills(introFile.path, { urgent: true });
        } catch (e) {
          unilog(2402, `intro stills start failed for ${showName}: ${e.message}`);
        }
      }
    }
    // Auto collection updates (run after the gap check, which sets anyWatched)
    const collectionChanges = applyAutoCollections(showName, tvdbRecord);
    const push2Changes = [
      ...diskChanges,
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
let librarySweepTickCount = 0;
tvdb.setPreTvdbTickCallback(async ({ isBackground } = {}) => {
  librarySweepTickCount++;
  // TEST: skip sweep on foreground (user-triggered) ticks — revert by removing `&& isBackground`
  if (isBackground && librarySweepTickCount % 10 === 1) {
    const caller = `preTick-bg#${librarySweepTickCount}`;
    await runLibrarySweep(caller);
  }
});

// Wire the consolidated episodeData refresh into the tvdb background loop.
tvdb.setRefreshEpisodeDataCallback(disk.refreshEpisodeData);

// waitStr transitions drive automatic hiding/unhiding (shows with no episodes
// on disk are ignored by hideShowIfNeeded).
tvdb.setWaitStrChangedCallback(
  async (showName, tvdbRecord, { before, after }) => {
    if (!tvdbRecord) return;
    // The wait ending is a notification in its own right, so it moves the show
    // to the head of the watched sort whatever its emby/disk state is, and
    // that stamp is the unhide, so the flag goes with it.
    if (before && !after) {
      await markWaitOverViewedNow(showName, tvdbRecord);
      if (tvdbRecord.hiddenFromRow) await setHiddenFromRow(showName, false);
      return;
    }
    if (!tvdbRecord.inEmby || !tvdbRecord.id) return;
    if (!hasEpisodesOnDisk(tvdbRecord)) return;
    if (!before && after) {
      // waitStr newly set: hide the show unless it is already hidden.
      await hideShowIfNeeded(showName, tvdbRecord);
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
app.get("/api/getPlayUrl", apiWrapper(getPlayUrl));
app.post("/api/playProgress", apiWrapper(playProgress));
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
// Every show folder in the media tree.
async function showFolders() {
  const entries = await fsp.readdir(tvDir, { withFileTypes: true });
  return entries
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
}

// Group the show folders by the library record they resolve to: the one whose
// `path` names the folder, else the one named like it. A record claimed both
// ways by two different folders is a duplicate. Shared by the merge and its
// dry-run report so both judge the same way.
async function planDupeFolderGroups() {
  const allTvdb = tvdb.getAllTvdbSync() || {};
  const byPath = new Map();
  for (const [key, rec] of Object.entries(allTvdb)) {
    if (rec?.inEmby && rec.path) byPath.set(rec.path, { key, rec });
  }
  return dupeFolders.planDuplicateFolders(await showFolders(), (folder) =>
    byPath.get(folder) ||
    (allTvdb[folder]?.inEmby ? { key: folder, rec: allTvdb[folder] } : null),
  );
}

// Fold every duplicate show folder that can be proven safe into the folder
// holding the show. Refusals are logged and left alone.
async function mergeDuplicateShowFolders(caller, onlyShow = null) {
  const groups = (await planDupeFolderGroups()).filter(
    (g) => !onlyShow || g.showName === onlyShow,
  );
  const results = [];
  let merged = 0;
  let refused = 0;

  for (const group of groups) {
    for (const plan of group.plans) {
      if (!plan.ok) {
        refused++;
        results.push({
          showName: group.showName,
          loserFolder: plan.loserFolder,
          ok: false,
          reason: plan.reason,
        });
        unilog(
          2146,
          `${group.showName}: not merging "${plan.loserFolder}" — ${plan.reason}`,
        );
        continue;
      }
      try {
        const r = dupeFolders.executeFolderMerge(plan);
        merged++;
        results.push({
          showName: group.showName,
          loserFolder: plan.loserFolder,
          winnerFolder: plan.winnerFolder,
          ok: true,
          ...r,
        });
        unilog(
          2147,
          `${group.showName}: merged "${plan.loserFolder}" into "${plan.winnerFolder}" — ${r.moved} video(s) moved, ${r.demoted.length} demoted to .old, folder ${r.removed ? "removed" : `kept (${r.leftBehind.length} video(s) left)`}`,
        );
      } catch (e) {
        results.push({
          showName: group.showName,
          loserFolder: plan.loserFolder,
          ok: false,
          reason: e.message,
        });
        unilog(
          2148,
          `${group.showName}: merging "${plan.loserFolder}" into "${plan.winnerFolder}" failed: ${e.message}`,
        );
      }
    }
    // The record's path was last-write-wins across the duplicates; point it at
    // the folder that actually holds the show. Only meaningful once the group
    // has a winner, which a refused group does not.
    if (group.rec && group.winner) group.rec.path = group.winner;
  }

  if (merged) await tvdb.saveTvdbSync();
  return { merged, refused, results };
}

// Shows carrying files for episodes they never aired, and what quarantining
// them would move. Reads only. `showName` limits it to one show.
app.post(
  "/api/strayEpisodeReport",
  apiWrapper(async (params) =>
    strayEpisodes.planAllStrayQuarantines(params?.showName || null),
  ),
);

// Moves those files to /mnt/media/tv-errors/. Server-side only; deliberately
// not automatic -- see the note at the top of strayEpisodes.js.
app.post(
  "/api/strayEpisodeQuarantine",
  apiWrapper(async (params) => {
    const plans = strayEpisodes.planAllStrayQuarantines(
      params?.showName || null,
    );
    const results = [];
    let movedAny = false;
    for (const plan of plans) {
      if (!plan.ok) {
        results.push({
          showName: plan.showName,
          ok: false,
          reason: plan.reason,
        });
        continue;
      }
      try {
        const r = strayEpisodes.executeStrayQuarantine(plan);
        movedAny = true;
        results.push({ showName: plan.showName, ok: true, ...r });
        const seasons = [
          ...new Set(plan.releases.filter((x) => x.move).map((x) => x.season)),
        ];
        // Keep the outcome on the record: once the files are gone the live
        // flag clears, and this note is all that is left to check against.
        const rec = tvdb.getAllTvdbSync()?.[plan.showName];
        if (rec) {
          rec.strayNote = `${r.videos} file(s) from S${seasons.join("/")} quarantined to tv-errors ${strayEpisodes.strayStamp()}`;
        }
        unilog(
          2157,
          `${plan.showName}: quarantined ${r.videos} stray episode(s) (${r.moved.length} file(s)) to tv-errors from season(s) ${seasons.join(", ")}`,
        );
      } catch (e) {
        results.push({ showName: plan.showName, ok: false, reason: e.message });
        unilog(2152, `${plan.showName}: quarantine failed: ${e.message}`);
      }
    }
    if (movedAny) await tvdb.saveTvdbSync();
    return { success: true, results };
  }),
);

// Exactly what the map pane's Gapchk button would do to one show, as a list
// the confirmation dialog can show before anything happens. Reads only.
app.post(
  "/api/gapchkPreview",
  apiWrapper(async (params) => {
    const showName = params?.showName;
    if (!showName) return { success: false, error: "showName required" };
    const rec = tvdb.getAllTvdbSync()?.[showName];
    if (!rec) return { success: false, error: "show not found" };
    const actions = [];

    for (const plan of strayEpisodes.planAllStrayQuarantines(showName)) {
      if (plan.ok) {
        const videos = plan.files.filter((f) =>
          videoFileExtensions.includes(f.name.split(".").pop()),
        );
        actions.push({
          kind: "quarantine",
          title: `Move ${videos.length} video(s) + ${plan.files.length - videos.length} sidecar(s) to tv-errors`,
          detail: plan.reason,
          items: videos.map((f) => `Season ${f.season}/${f.name}`),
        });
      } else if (plan.reason) {
        actions.push({
          kind: "quarantine-skip",
          title: "No files quarantined",
          detail: plan.reason,
          items: [],
        });
      }
    }

    for (const g of await planDupeFolderGroups()) {
      if (g.showName !== showName) continue;
      for (const plan of g.plans) {
        actions.push({
          kind: plan.ok ? "merge" : "merge-skip",
          title: plan.ok
            ? `Merge folder "${plan.loserFolder}" into "${plan.winnerFolder}"`
            : `Will NOT merge folder "${plan.loserFolder}"`,
          detail: plan.reason,
          items: plan.moves.map((m) => m.seasonDir),
        });
      }
    }

    const accepting = strayEpisodes.straysToAccept(showName, rec);
    if (accepting.length) {
      actions.push({
        kind: "accept",
        title: `Accept ${accepting.length} stray file(s) as this show's episodes`,
        detail:
          "they stop counting as strays; replacing any of them with a different release flags it again",
        items: accepting.map((a) => `${a.key}  (${a.min ?? "?"} min)`),
      });
    }

    if (rec.strayNote) {
      actions.push({
        kind: "clearNote",
        title: "Clear the stray note",
        detail: rec.strayNote,
        items: [],
      });
    }
    actions.push({
      kind: "gapcheck",
      title: "Re-run the gap check",
      detail: "rewrites the note only if something is still wrong",
      items: [],
    });
    // Every stray this show currently has, so the dialog's Ignore button knows
    // which episodes it would be silencing.
    const strays = [];
    for (const plan of strayEpisodes.planAllStrayQuarantines(showName)) {
      for (const release of plan.releases || []) {
        for (const r of release.runtimes || []) {
          strays.push({
            season: r.season,
            episode: r.episode,
            name: r.name,
            min: r.min,
          });
        }
      }
    }
    return { success: true, showName, actions, strays };
  }),
);

// Episodes whose gap-check errors are suppressed for this show -- missing
// file, resolution drop, watch gap, stray, all of them. The list is only good
// for the gap result it was granted against: the check signs the whole result
// into gapSig and throws the entire list away the moment that signature moves,
// so any change at all puts every episode back in front of the user.
const asEpKeys = (list) =>
  (Array.isArray(list) ? list : [])
    .map((v) => (typeof v === "string" ? v.split("|")[0] : v?.ep))
    .filter(Boolean);

function addIgnoreGaps(rec, episodes) {
  const set = new Set(asEpKeys(rec.ignoreGaps));
  const before = set.size;
  for (const ep of episodes) {
    const s = Number(ep?.season);
    const e = Number(ep?.episode);
    if (!Number.isInteger(s) || !Number.isInteger(e)) continue;
    set.add(gaps.ignoreStrayKey(s, e));
  }
  rec.ignoreGaps = [...set].sort();
  const added = set.size - before;
  if (added) {
    // Stamp the result this ignore was granted against, or the next gap check
    // compares it to a stale signature and discards it immediately.
    rec.gapSig = gaps.currentGapSig(rec?.name, rec);
    // Ignoring an episode settles it, so the lasting note about it goes too.
    // If other strays are still outstanding the next gap check writes a fresh
    // note naming those instead of the ones just dealt with.
    delete rec.strayNote;
  }
  return added;
}

function removeIgnoreGaps(rec, episodes) {
  const drop = new Set();
  for (const ep of episodes) {
    const s = Number(ep?.season);
    const e = Number(ep?.episode);
    if (Number.isInteger(s) && Number.isInteger(e))
      drop.add(gaps.ignoreStrayKey(s, e));
  }
  const before = (rec.ignoreGaps || []).length;
  rec.ignoreGaps = asEpKeys(rec.ignoreGaps).filter((v) => !drop.has(v));
  return before - rec.ignoreGaps.length;
}

app.post(
  "/api/ignoreGaps",
  apiWrapper(async (params) => {
    const showName = params?.showName;
    const episodes = Array.isArray(params?.episodes) ? params.episodes : [];
    if (!showName) return { success: false, error: "showName required" };
    const rec = tvdb.getAllTvdbSync()?.[showName];
    if (!rec) return { success: false, error: "show not found" };
    const before = (rec.ignoreGaps || []).length;
    // The list is permanent and the button acts on whatever cells happen to be
    // selected, so there has to be a way back out of a mis-click.
    const removing = params?.remove === true;
    if (removing) removeIgnoreGaps(rec, episodes);
    else addIgnoreGaps(rec, episodes);
    await tvdb.saveTvdbSync();
    const changed = Math.abs((rec.ignoreGaps || []).length - before);
    if (changed) {
      unilog(
        2182,
        `${showName}: ${removing ? "un-ignoring" : "ignoring"} ${changed} episode(s) for gap checks — list is now ${rec.ignoreGaps.join(", ") || "empty"}`,
      );
    }
    return {
      success: true,
      added: removing ? 0 : changed,
      removed: removing ? changed : 0,
      ignoreGaps: rec.ignoreGaps,
    };
  }),
);

// Mark the strays the quarantine left behind as reviewed and fine, so a show
// that has been fully triaged can go quiet. Writes the same ignoreGaps list
// the Ignore buttons use -- there is only one list.
app.post(
  "/api/acceptStrays",
  apiWrapper(async (params) => {
    const showName = params?.showName;
    if (!showName) return { success: false, error: "showName required" };
    const rec = tvdb.getAllTvdbSync()?.[showName];
    if (!rec) return { success: false, error: "show not found" };
    const accepting = strayEpisodes.straysToAccept(showName, rec);
    if (!accepting.length) return { success: true, accepted: 0 };
    const added = addIgnoreGaps(
      rec,
      accepting.map((a) => ({ season: a.season, episode: a.episode })),
    );
    await tvdb.saveTvdbSync();
    unilog(
      2183,
      `${showName}: accepted ${added} stray file(s) as this show's episodes: ${accepting.map((a) => a.key).join(", ")}`,
    );
    return { success: true, accepted: added };
  }),
);

// strayNote is never cleared on its own -- this is the only thing that clears
// it, once the note has been read and the show checked.
app.post(
  "/api/clearStrayNote",
  apiWrapper(async (params) => {
    const showName = params?.showName;
    if (!showName) return { success: false, error: "showName required" };
    const rec = tvdb.getAllTvdbSync()?.[showName];
    if (!rec) return { success: false, error: "show not found" };
    delete rec.strayNote;
    await tvdb.saveTvdbSync();
    return { success: true };
  }),
);

// Runs the merge now instead of waiting for the next library sweep. `showName`
// limits it to one show, which is what the map pane's Gapchk button sends.
app.post(
  "/api/dupeFolderMerge",
  apiWrapper(async (params) => ({
    success: true,
    ...(await mergeDuplicateShowFolders("api", params?.showName || null)),
  })),
);

// Dry run of the duplicate-folder merge the library sweep performs: reports
// what would move and, for the pairs it refuses, why. Reads only.
app.post(
  "/api/dupeFolderReport",
  apiWrapper(async () => {
    const groups = await planDupeFolderGroups();
    return {
      success: true,
      groups: groups.map((g) => ({
        showName: g.showName,
        winner: g.winner,
        counts: g.counts,
        plans: g.plans.map((p) => ({
          loserFolder: p.loserFolder,
          ok: p.ok,
          reason: p.reason,
          seasons: p.moves.map((m) => m.seasonDir),
          arriveAsOld: p.moves.flatMap((m) => m.arriveAsOld),
          demotions: p.demotions.map((d) => path.basename(d)),
        })),
      })),
    };
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
      const folder = showPaths.showFolderFor(showName, rec);
      const today = util.toPstDateIso(new Date());

      // Fast path: build the map from the stored episodeData (populated by
      // the periodic full refresh) with no disk access. The client paints this
      // instantly, then requests a live refresh (stale omitted) in the
      // background to catch any file changes since the last sweep.
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

      // Refresh file/res (disk) so the map is live-fresh. aired dates come
      // from the periodic full refresh; skip the TVDB call here.
      const t0 = Date.now();
      await refreshEpisodeData(showName, rec, { sources: ["disk"] });
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
    for (const { season, episode } of cells) {
      if (!epd.getEp(rec.episodeData, season, episode)) continue;
      epd.setEpisode(rec.episodeData, season, episode, { pos: 0 });
      cleared.push({ season, episode });
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
app.post("/api/getPoster", apiWrapper(tvdb.getPoster));
app.post("/api/getTvmazeCrew", apiWrapper(tvdb.getTvmazeCrew_cmd));
app.post("/api/migrateWatchedCount", apiWrapper(tvdb.migrateWatchedCount));
// The remote's address rides along so a collision log can name the device
// behind a sender id. Browsers arrive through nginx, hence the forwarded
// header; the phone app hits the port directly.
app.post(
  "/api/tvRemoteKey",
  (req, _res, next) => {
    req.body.from =
      req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "unknown";
    next();
  },
  apiWrapper(keySendWithChk),
);
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
// Hide button: a toggle keyed on hiddenFromRow. When not hidden it hides
// (lastPlayed back); when hidden it unhides (lastPlayed to today).
app.post(
  "/api/hideShow",
  apiWrapper(async (params) => {
    const showName = params?.name;
    if (!showName) return { ok: false, error: "Missing name" };
    const rec = tvdb.getAllTvdbSync()?.[showName];
    if (!rec) return { ok: false, error: "Show not found" };
    const canHide =
      (rec.inEmby !== false && rec.id && hasEpisodesOnDisk(rec)) ||
      rec.lastPlayedDate ||
      rec.fakeLastPlayed;
    if (!canHide) return { ok: false, error: "Nothing to hide" };

    let action;
    if (!rec.hiddenFromRow) {
      await stampFakeLastPlayed(rec, Date.now() - HIDE_BACKDATE_MS);
      await setHiddenFromRow(showName, true);
      action = "hidden";
    } else {
      await stampFakeLastPlayed(rec, Date.now());
      await setHiddenFromRow(showName, false);
      action = "unhidden";
    }
    unilog(2517, `${action} ${showName}`);
    return { ok: true, action };
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

// Set the watched mark on one episode, for the web client's map and tvapp's.
app.post(
  "/api/setEpisodeWatched",
  apiWrapper(async (params) => {
    const { name, season, episode, watched } = params || {};
    if (!name || !Number.isInteger(season) || !Number.isInteger(episode))
      return { ok: false, error: "Missing params" };
    const rec = tvdb.getAllTvdbSync()?.[name];
    if (!rec) return { ok: false, error: "Show not found" };
    if (!Array.isArray(rec.episodeData))
      return { ok: false, error: "No episodeData" };
    if (!epd.getEp(rec.episodeData, season, episode))
      return { ok: false, error: "Episode not found" };

    // Position goes with the mark either way: watched has nothing left to
    // resume, and unwatched is being put back to the start.
    epd.setEpisode(rec.episodeData, season, episode, {
      watched: !!watched,
      pos: 0,
    });
    rec.watchedCount = epd.countWatched(rec.episodeData);
    await tvdb.saveTvdbSync();
    debouncedTvdbPush(name);
    unilog(2518, `${name} S${season}E${episode} watched=${!!watched}`);
    return { ok: true, watched: !!watched };
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
// Film-strip stills and on-click video windows for intro/chksrt (see src/stills.js)
registerStillsRoutes(app);

// File operations
app.post("/api/deletePath", apiWrapper(deletePath));
app.post("/api/deletePaths", apiWrapper(deletePaths));
app.post("/api/delSeasonFiles", apiWrapper(delSeasonFiles));
// The web add flow: the folder puts the show in the library, so the record
// the add just made from TVDB is linked to it here and then, not by a sweep.
app.post(
  "/api/createShowFolder",
  apiWrapper(async (params) => {
    const res = await createShowFolder(params);
    const folder = path.basename(res.path);
    const allTvdb = tvdb.getAllTvdbSync();
    const tvdbId = String(params?.tvdbId || "").trim();
    const name = allTvdb[params?.showName]
      ? params.showName
      : Object.keys(allTvdb).find((k) => String(allTvdb[k]?.tvdbId) === tvdbId);
    if (!name) throw new Error(`createShowFolder: no record for ${params?.showName}`);
    addToLibrary(name, allTvdb[name], folder);
    await tvdb.saveTvdbSync();
    debouncedTvdbPush(name);
    return res;
  }),
);

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

app.post("/api/asr/gensrt/abort", (req, res) => {
  res.json(abortAsr());
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
      recode: await recode.getRecodeQueueStatus(),
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
    const sorted = epd.toSeriesMap(
      record.episodeData,
      showPaths.showFolderFor(showName, record),
      util.toPstDateIso(new Date()),
    );
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
    const sorted = epd.toSeriesMap(
      record.episodeData,
      showPaths.showFolderFor(showName, record),
      util.toPstDateIso(new Date()),
    );
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
  // Build film-strip stills ahead of time for every episode intro marking
  // will open (see introEpisodePaths). startStills is a no-op once a set
  // exists, so sweeping every few seconds costs a stat per show.
  setInterval(() => {
    sweepIntroStills().catch((e) => {
      unilog(2403, `intro stills sweep failed: ${e.message}`);
    });
  }, INTRO_STILLS_SWEEP_MS);
  recode.start();
  startOldFileCleanup();
});

const INTRO_STILLS_SWEEP_MS = 5_000;

// The episode intro marking will open, for every show with an entry in the
// chksrt queue — in queue order — followed by every other show flagged
// needsIntro. Their stills are built ahead of time so the strip is already up
// when the Intro button is pressed. selectIntroFile lives in @tv/share so this
// picks exactly the episode the client will open.
async function introEpisodePaths() {
  const allTvdb = tvdb.getAllTvdbSync() || {};
  const out = [];
  const seenShow = new Set();
  const consider = async (record) => {
    if (!record || seenShow.has(record.name)) return;
    seenShow.add(record.name);
    // Already-marked shows will never be opened for intro editing, so their
    // stills would be wasted work.
    if (intro.hasConfiguredIntro(record)) return;
    const result = epd.selectIntroFile(record);
    if (result?.path) out.push(result.path);
  };
  for (const entry of subsState.subQueueChkSrt) {
    const videoFilePath = entry?.videoFilePath;
    if (!videoFilePath) continue;
    const showName = showNameFromFilePath(videoFilePath);
    if (showName) await consider(allTvdb[showName]);
  }
  for (const record of Object.values(allTvdb)) {
    if (record?.needsIntro) await consider(record);
  }
  return out;
}

async function sweepIntroStills() {
  for (const p of await introEpisodePaths()) {
    try {
      await stills.startStills(p);
    } catch (e) {
      unilog(2404, `intro stills queue failed for ${path.basename(p)}: ${e.message}`);
    }
  }
}

// The episode the intro player opens for a show.
function introFileFor(record) {
  const pick = epd.selectIntroFile(record);
  if (!pick?.path) return null;
  return { path: pick.path, season: pick.season, episode: pick.episode };
}

app.get("/api/introFile", async (req, res) => {
  const showName = req.query.showName;
  if (!showName) {
    res.status(400).json({ ok: false, error: "showName required" });
    return;
  }
  const record = tvdb.getAllTvdbSync()[showName];
  if (!record) {
    res.json({ ok: false, error: "show not found" });
    return;
  }
  try {
    const pick = introFileFor(record);
    if (!pick) {
      res.json({ ok: false, error: "no playable episode" });
      return;
    }
    res.json({ ok: true, ...pick });
  } catch (e) {
    unilog(2127, `introFile failed for ${showName}: ${e.message}`);
    res.json({ ok: false, error: e.message });
  }
});

// Same pick for a batch of shows, as a flat path list. The Queues pane marks
// its lines with it, so it asks about only the shows its queues actually
// contain rather than the whole library.
app.post("/api/introFiles", async (req, res) => {
  const showNames = req.body?.showNames;
  if (!Array.isArray(showNames)) {
    res.status(400).json({ ok: false, error: "showNames required" });
    return;
  }
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    const paths = [];
    for (const showName of showNames) {
      const record = allTvdb[showName];
      if (!record) continue;
      const pick = introFileFor(record);
      if (pick?.path) paths.push(pick.path);
    }
    res.json({ ok: true, paths });
  } catch (e) {
    unilog(2129, `introFiles failed: ${e.message}`);
    res.json({ ok: false, error: e.message });
  }
});

app.post("/internal/tv-state", (req, res) => {
  notifyClients("tvMuteState", req.body);
  if (req.body.adbOk === false)
    setGlobalMessage({
      id: "TvAdb",
      text: "TV ADB error",
      position: 0,
      color: "red",
    });
  else setGlobalMessage({ id: "TvAdb", action: "hide" });
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

let lastNowPlayingShowName = null;
let lastNowPlayingList = [];
let lastPlayingKeys = new Set(); // "showName|season|episode" of all currently-playing items
let lastMissingEpWarning = null;

// What tvapp's player is playing, from its playProgress reports. It is the
// only player, so it is the whole now-playing list.
let tvappNowPlaying = null;
recode.setPlayingPathGetter(() => {
  if (!tvappNowPlaying) return null;
  const { showName, season, episode } = tvappNowPlaying;
  const rec = tvdb.getAllTvdbSync()?.[showName];
  if (!rec) return null;
  const folder = showPaths.showFolderFor(showName, rec);
  return epd.getFullPath(rec.episodeData, folder, season, episode, tvDir);
});

function publishNowPlaying() {
  lastNowPlayingShowName = tvappNowPlaying?.showName ?? null;
  lastNowPlayingList = tvappNowPlaying ? [tvappNowPlaying] : [];
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

  checkMissingEpisodes(lastNowPlayingList).catch((e) => {
    unilog(1371, `checkMissingEpisodes failed: ${e.message}`);
  });
}

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
    const ed = tvdbRecord?.episodeData;
    if (!Array.isArray(ed)) continue;

    let missingSeason = null;
    let missingEpisode = null;
    epd.forEachEpisode(ed, (s, e) => {
      if (missingSeason !== null) return;
      if (s > season || (s === season && e >= episode)) return;
      if (!epd.isWatched(ed, s, e)) {
        missingSeason = s;
        missingEpisode = e;
      }
    });

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

//////////////////  TVAPP PLAYBACK  //////////////////
// tvapp plays episode files in its own player straight off nginx, which serves
// tvDir at TV_URL. getPlayUrl says what to play and where to start;
// playProgress hears back how far it got.

const TV_URL = "https://hahnca.com/tv";
const SRVR_PUBLIC_URL = "https://hahnca.com/tv-srvr";
const TVAPP_DEVICE = "tvapp";
const TICKS_PER_MS = 10000; // episodeData pos is in 100-ns ticks

// Next-up: the first episode past season 0 with a file and not watched.
function nextUpEpisode(ed) {
  let found = null;
  epd.forEachEpisode(ed, (season, episode) => {
    if (found || season <= 0) return;
    if (epd.hasFile(ed, season, episode) && !epd.isWatched(ed, season, episode))
      found = { season, episode };
  });
  return found;
}

// The file's subtitles. subs is every .srt in the folder for the episode --
// the file's own and any an alt release of it left -- as urls (tv-srvr hands
// them out as vtt), labelled by their tag (mb4, opnXXXXX, ...). The one to
// start on: chksrt's embedded pick as subIndex, a stream index for the player
// to pick itself, because extracting one here takes ffmpeg a pass over the
// whole file; else subPick, the index in subs of chksrt's .srt or the file's
// own. chksrt keys its history by the show's folder name.
function subsForFile(file, season, episode) {
  const folder = file.slice(tvDir.length + 1).split("/")[0];
  const pref = findChksrtPreferred(folder, fmtSeasonEpisode(season, episode));
  const stem = epd.vidStripAlt(path.basename(file)).replace(/\.[^.]+$/, "");
  const sameEpisode = (f) => {
    const m = f.match(/[Ss](\d+)[Ee](\d+)/);
    return !!m && Number(m[1]) === season && Number(m[2]) === episode;
  };
  const srts = fs
    .readdirSync(path.dirname(file))
    .filter((f) => f.endsWith(".srt") && (f.startsWith(stem) || sameEpisode(f)));
  const pick =
    pref?.embStreamIndex != null
      ? -1
      : srts.includes(pref?.srtFile)
        ? srts.indexOf(pref.srtFile)
        : srts.findIndex((f) => f.startsWith(stem));
  return {
    subs: srts.map((f) => ({
      url:
        `${SRVR_PUBLIC_URL}/api/subtitle?path=${encodeURIComponent(file)}` +
        `&file=${encodeURIComponent(f)}`,
      label: f.slice(0, -".srt".length).split(".").pop(),
    })),
    subPick: pick,
    subIndex: pref?.embStreamIndex ?? null,
  };
}

// The named episode (season and episode both given), else next-up.
async function getPlayUrl({ showName, season: s, episode: e }) {
  const rec = tvdb.getAllTvdbSync()?.[showName];
  if (!rec) throw new Error(`getPlayUrl: no show ${showName}`);
  const ed = rec.episodeData;
  const target =
    s != null && e != null
      ? { season: Number(s), episode: Number(e) }
      : nextUpEpisode(ed);
  if (!target) return { url: null };
  const { season, episode } = target;
  const folder = showPaths.showFolderFor(showName, rec);
  const file = epd.getFullPath(ed, folder, season, episode, tvDir);
  if (!file) return { url: null };
  const rel = file.slice(tvDir.length + 1);
  const intro = tvdb.getSeasonIntro(rec, season);
  return {
    url: `${TV_URL}/${rel.split("/").map(encodeURIComponent).join("/")}`,
    showName,
    season,
    episode,
    posMs: Math.round(epd.getPos(ed, season, episode) / TICKS_PER_MS),
    trimPosMs: Math.max(0, Math.round(intro.trimPos || 0)),
    skipDurMs: Math.max(0, Math.round(intro.skipDur || 0)),
    ...subsForFile(file, season, episode),
  };
}

// tvapp's player reports when it starts, every few seconds while it is up, on
// pause, and when it stops or runs to the end. The record keeps the resume
// position and, at the end, the watched mark.
async function playProgress({ showName, season, episode, posMs, durMs, state }) {
  const rec = tvdb.getAllTvdbSync()?.[showName];
  if (!rec) throw new Error(`playProgress: no show ${showName}`);
  const ed = rec.episodeData;
  const code = fmtSeasonEpisode(season, episode);
  if (!Number.isInteger(season) || !Number.isInteger(episode) || !epd.getEp(ed, season, episode))
    throw new Error(`playProgress: no episode ${code} in ${showName}`);
  const ended = state === "ended";
  const stopped = ended || state === "stopped";
  const started =
    !stopped &&
    !(
      tvappNowPlaying?.showName === showName &&
      tvappNowPlaying.season === season &&
      tvappNowPlaying.episode === episode
    );
  const pos = ended ? 0 : Math.max(0, Math.round(posMs)) * TICKS_PER_MS;
  epd.setEpisode(ed, season, episode, ended ? { watched: true, pos } : { pos });
  if (ended) rec.watchedCount = epd.countWatched(ed);
  if (started || stopped) {
    rec.lastPlayedDate = util.toPstDateTimeMs(new Date());
    rec.lastPlayedEpisode = code;
    rec.fakeLastPlayed = null;
    rec.hiddenFromRow = false;
    unilog(2497, `${showName} ${code} ${state} at ${Math.round(posMs / 1000)}s`);
  }
  await tvdb.saveTvdbSync();
  // Only when the list would show it: every push makes tvapp reload all its
  // shows, and one every report while a 4K video fills tvapp's heap ran it
  // out of memory.
  if (started || stopped) debouncedTvdbPush(showName);
  tvappNowPlaying = stopped
    ? null
    : {
        showName,
        device: TVAPP_DEVICE,
        season,
        episode,
        positionTicks: pos,
        runtimeTicks: durMs > 0 ? Math.round(durMs) * TICKS_PER_MS : null,
        id: null,
      };
  publishNowPlaying();
  return { ok: true };
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
  // A remote lock in force is replayed too: the lock only ever went out to the
  // remotes connected at the time, and a remote that connects afterwards would
  // otherwise have every key silently dropped with no overlay to say why.
  const remoteLock = tvRemoteLockInfo();
  if (remoteLock) {
    ws.send(
      JSON.stringify({ id: 0, notification: "tvRemoteLock", data: remoteLock }),
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

/**
 * Background library sweep. The disk says what is in the library: a record
 * is in it (`inEmby`) while its folder is there, and a folder holding videos
 * that no library record claims comes in under the record named like it.
 */
let librarySweepRunning = false;
let librarySweepQueued = false;
let librarySweepQueuedCaller = null;
const unclaimedFoldersLogged = new Set();
async function runLibrarySweep(caller = "unknown") {
  if (librarySweepRunning) {
    librarySweepQueued = true;
    librarySweepQueuedCaller = caller;
    return;
  }
  librarySweepRunning = true;
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

    const isTvdbShow = (r) =>
      !!(
        r &&
        typeof r === "object" &&
        !Array.isArray(r) &&
        String(r.name || "").trim()
      );

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

    // Step 2: A library show whose folder is gone leaves the library. A show
    // named with a "/" lives in a nested folder, so each is checked directly.
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (!isTvdbShow(rec) || !rec.inEmby) continue;
      const folder = showPaths.showFolderFor(name, rec);
      if (await isDirectory(path.join(tvDir, folder))) continue;
      unilog(2519, `${name} left the library: its folder ${folder} is gone`);
      rec.inEmby = false;
      rec.notReady = true;
      rec.inContinue = false;
      rec.inLinda = false;
      rec.inMark = false;
      rec.inToTry = false;
      handlePickupChange(name, false, rec.status);
    }

    // Step 3: A folder holding videos that no library show claims joins the
    // library under the record named like it. With no such record it waits
    // for the web add flow, which makes one; with a library record of that
    // name living elsewhere it is a duplicate folder, merged below.
    const claimed = new Set();
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (isTvdbShow(rec) && rec.inEmby)
        claimed.add(showPaths.showFolderFor(name, rec).split("/")[0]);
    }
    for (const folder of await showFolders()) {
      if (claimed.has(folder)) continue;
      if (!(await folderHasVideo(path.join(tvDir, folder)))) continue;
      const rec = allTvdb[folder];
      if (isTvdbShow(rec) && !rec.inEmby) {
        try {
          addToLibrary(folder, rec, folder);
        } catch (e) {
          unilog(2520, `${folder} could not join the library: ${e.message}`);
        }
      } else if (!rec && !unclaimedFoldersLogged.has(folder)) {
        unclaimedFoldersLogged.add(folder);
        unilog(2521, `folder ${folder} holds videos but no show record claims it; add the show from the web client`);
      }
    }

    // Step 3b: One record claimed by two folders. Fold the extras into the
    // folder holding the show, so everything working from the record can see
    // the whole show again. Merges that cannot be proven safe are logged and
    // skipped.
    await mergeDuplicateShowFolders("librarySweep");

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

    // ponytail: drops the links to Emby's web pages that records made before
    // kill-emby Phase 3 still carry; delete once no record has one.
    for (const rec of Object.values(allTvdb)) {
      if (Array.isArray(rec?.remotes) && rec.remotes.some((r) => r?.name === "Emby"))
        rec.remotes = rec.remotes.filter((r) => r?.name !== "Emby");
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
    unilog(2522, `library sweep (${caller}) failed: ${err.message}`);
  } finally {
    librarySweepRunning = false;
    if (librarySweepQueued) {
      librarySweepQueued = false;
      const c = librarySweepQueuedCaller || "queued";
      librarySweepQueuedCaller = null;
      runLibrarySweep(c);
    }
  }
}

async function isDirectory(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}

// True once any video turns up under dir. Dot-directories hold work in
// progress (rsync staging), not library files.
async function folderHasVideo(dir) {
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith(".")) continue;
    if (d.isDirectory()) {
      if (await folderHasVideo(path.join(dir, d.name))) return true;
    } else if (videoFileExtensions.includes(d.name.split(".").pop())) {
      return true;
    }
  }
  return false;
}

// Put a record in the library, living in `folder`. A show coming in (not
// just re-pointed) is stamped as added now and takes its tvdbId as its id.
function addToLibrary(name, rec, folder) {
  rec.path = folder;
  if (rec.inEmby) return;
  const id = String(rec.tvdbId || "");
  if (!id) throw new Error(`${name} has no tvdbId`);
  const taken = Object.entries(tvdb.getAllTvdbSync()).find(
    ([key, r]) => key !== name && String(r?.id) === id,
  );
  if (taken) throw new Error(`id ${id} is already ${taken[0]}'s`);
  rec.inEmby = true;
  rec.id = id;
  rec.dateCreated = util.toPstDateTimeMs(new Date());
  handlePickupChange(name, true, rec.status);
  unilog(2523, `${name} joined the library in folder ${folder}`);
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

    // Now run gap check with fresh disk data
    const gapData = await gaps.gapCheckBatch(shows);
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

// Auto collection rules (applied in the background tvdb update, per show).
const CONTINUE_IDLE_DAYS = 30;

// True when any episode that has aired (or already has a file) is unwatched.
function hasUnwatchedEpisodes(rec) {
  const today = util.toPstDateIso(new Date());
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
function applyAutoCollections(showName, rec) {
  const changes = [];
  if (!rec.inEmby) return changes;
  if (!rec.anyWatched) {
    if (
      !rec.inToTry &&
      rec.notReady === false &&
      !rec.watchedCount &&
      !rec.waitStr &&
      !rec.inMark &&
      !rec.inLinda
    ) {
      rec.inToTry = true;
      changes.push("inToTry:false->true(ready unwatched)");
      unilog(1998, `set toTry for ${showName}: ready and never watched`);
    }
    return changes;
  }
  if (rec.inToTry) {
    rec.inToTry = false;
    changes.push("inToTry:true->false(watched)");
    unilog(
      1989,
      `cleared toTry for ${showName}: ${rec.watchedCount} episodes watched`,
    );
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
    rec.inContinue = true;
    changes.push(`inContinue:false->true(idle ${idleDays}d)`);
    unilog(
      1990,
      `set continue for ${showName}: unwatched episodes left, idle ${idleDays} days`,
    );
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

//////////////////  SHOW HIDE / UNHIDE  //////////////////
// "Hiding" means pushing the show's last viewing back two years so it drops to
// the bottom of the watched sort; "unhiding" bumps it to now. The stamp is
// fakeLastPlayed, which the sort reads ahead of lastPlayedDate and a real play
// clears. hiddenFromRow tracks the hidden state; it is set on hide and cleared
// on unhide, when a wait ends, and when the show is played. The automatic
// paths ignore shows with no episodes on disk; the button also takes any show
// with a last viewing, real or fake.

const HIDE_BACKDATE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

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

async function stampFakeLastPlayed(rec, ms) {
  rec.fakeLastPlayed = util.toPstDateTimeMs(new Date(ms));
  await tvdb.saveTvdbSync();
}

// Hide a show unless it is already hidden, then mark it hidden.
async function hideShowIfNeeded(showName, rec) {
  if (rec.hiddenFromRow) return;
  await stampFakeLastPlayed(rec, Date.now() - HIDE_BACKDATE_MS);
  await setHiddenFromRow(showName, true);
  unilog(2524, `hiding ${showName}`);
}

// The wait on a show being over is a notification: stamp its last viewing as
// now so it heads the watched sort.
async function markWaitOverViewedNow(showName, rec) {
  await stampFakeLastPlayed(rec, Date.now());
  unilog(2525, `wait over for ${showName}: last viewed set to now`);
}

// Regenerate config.yml on startup and schedule flexget every 15 minutes.
upload().catch((e) => unilog(666, "startup upload error:", e.message));
cron.schedule("*/15 * * * *", () => {
  flexget
    .runFlexgetAndProcess()
    .catch((e) => unilog(667, "cron error:", e.message));
});

//////////////////  CHOKIDAR FILE WATCHER  //////////////////

const changedShows = new Map(); // showName -> { timeout, files: Set<string> }
const DISK_CHANGE_DEBOUNCE_MS = 3000; // 3 seconds

// Tracks shows currently being processed to prevent parallel calls
const inFlightDiskChanges = new Set();
const pendingDiskChanges = new Set();

/**
 * Handle disk change for a show (debounced)
 */
// This handler never re-scrapes TVDB, so a waitStr recompute here can read as
// cleared just because TVDB has not announced the next episode's air date yet.
// Persisting that clear also eats the set->clear flip the background loop
// compares against the record, and that flip is the only thing that unhides a
// show and stamps its wait as over -- so the old value is put back and the
// clear is left entirely to the loop, which re-scrapes TVDB first.
function keepWaitStrForLoop(rec, waitStrBefore) {
  if (waitStrBefore && !rec.waitStr) rec.waitStr = waitStrBefore;
}

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
        keepWaitStrForLoop(tvdbRecord, waitStrBefore);
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

    // Notify clients that disk changed for this show
    notifyClients("showDiskChanged", { showName });
    unilog(678, `Notified clients about disk change for ${showName}`);

    // A folder that came or went moves the show in or out of the library.
    await runLibrarySweep(`chokidar:${showName}`);

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

      // Hide immediately when the show newly enters the "waiting, with
      // episodes on disk" state: either waitStr just appeared, or the first
      // episode(s) landed while waitStr was already set (that case has no
      // waitStr flip for the loop to catch). This is deliberately HIDE-only —
      // an early hide is harmless (the next full loop tick corrects it if
      // wrong) but an early UNHIDE is not: this handler only refreshes the
      // disk, never re-scrapes TVDB, so a newly-downloaded episode can
      // make waitStr transiently read as cleared even though TVDB simply
      // hasn't announced the next episode's air date yet. Trusting that here
      // would unhide a show every time an episode lands, undoing a hide the
      // moment it was set. Unhiding on a real waitStr clear is left entirely
      // to the background loop, which re-scrapes TVDB first.
      const waitStrAfter = tvdbRecord.waitStr;
      const hasEpisodesNow = hasEpisodesOnDisk(tvdbRecord);
      const waitStrJustSet = !waitStrBefore && waitStrAfter;
      const firstEpisodesJustLanded =
        !hadEpisodesOnDiskBefore && hasEpisodesNow;
      if (
        hasEpisodesNow &&
        waitStrAfter &&
        (waitStrJustSet || firstEpisodesJustLanded)
      ) {
        await hideShowIfNeeded(showName, tvdbRecord);
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

    const showName = showNameFromFilePath(filePath);
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
        if (!tvdbRec) {
          unilog(
            2136,
            `no tvdb record for ${showName} — ${videoFiles.length} new file(s) skipped the sub queue`,
          );
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
            // A file the tv's player stalls on is replaced before anything else
            // looks at it: the subs and the chksrt mirror belong to the recoded
            // file, not to the one about to be moved aside. The recode's own
            // output lands back here as a fresh add and takes this path then.
            if (await recode.enqueueRecode(fp)) continue;
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

    const showName = showNameFromFilePath(filePath);
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
  // A show folder removed with no video in it (e.g. one just added) fires no
  // video unlink, so the folder going is what takes it out of the library.
  .on("unlinkDir", (dirPath) => {
    if (path.dirname(dirPath) !== tvDir) return;
    const showName = showNameFromFilePath(dirPath);
    unilog(2532, `show folder deleted: ${showName}`);
    handleShowDiskChange(showName);
  })
  .on("error", (error) => {
    unilog(685, "Watcher error:", error);
  })
  .on("ready", () => {
    unilog(90, "Initial scan complete. Ready for changes.");
  });

unilog(91, `Watching ${tvDir} for file changes...`);

//////////////////  SUBTITLE BACKSTOP SWEEP  //////////////////
//
// The file watcher is what normally puts a new download in front of chksrt,
// and for months it silently did not: it took the show name from the folder,
// missed every show whose folder differs from its tvdb name, and dropped those
// files without a trace. That specific bug is fixed, but the shape of it --
// one gate on the only path to the sub queue -- is worth a second route that
// does not depend on any lookup being right.
//
// So this walks the library and enqueues any active video with no subtitle
// sidecar at all. fileNeedsSubChecked does the real work: it already skips
// files that are queued, snoozed, or have an .srt / .mb.chosen next to them,
// so a settled library adds nothing and the sweep is just a directory walk.
const SUB_BACKSTOP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SUB_BACKSTOP_START_DELAY_MS = 10 * 60 * 1000;

async function runSubBackstopSweep() {
  let scanned = 0;
  let queued = 0;
  try {
    for (const showFolder of fs.readdirSync(tvDir)) {
      if (showFolder.startsWith(".")) continue;
      const showDir = path.join(tvDir, showFolder);
      let seasonDirs;
      try {
        if (!fs.statSync(showDir).isDirectory()) continue;
        seasonDirs = fs.readdirSync(showDir);
      } catch {
        continue;
      }
      for (const seasonDir of seasonDirs) {
        if (seasonDir.startsWith(".")) continue;
        const seasonPath = path.join(showDir, seasonDir);
        let files;
        try {
          if (!fs.statSync(seasonPath).isDirectory()) continue;
          files = fs.readdirSync(seasonPath);
        } catch {
          continue;
        }
        for (const f of files) {
          if (f.startsWith(".")) continue;
          if (!videoFileExtensions.includes(f.split(".").pop())) continue;
          const fp = path.join(seasonPath, f);
          scanned++;
          const showName = showNameFromFilePath(fp);
          const rec = tvdb.getAllTvdbSync?.()?.[showName];
          if (!rec?.inEmby) continue;
          if (!(await fileNeedsSubChecked(fp, showName))) continue;
          enqueueSubQueue(
            { videoFilePath: fp, fromUI: false, lowPriority: true },
            false,
          );
          queued++;
          unilog(
            2165,
            `${showName}: ${f} had no subtitles and was never queued — the watcher missed it`,
          );
        }
      }
    }
    if (queued) {
      persistSubQueue();
      doSubQueueNow();
    }
    unilog(
      2166,
      `subtitle backstop swept ${scanned} video(s), queued ${queued}`,
    );
  } catch (e) {
    unilog(2167, `subtitle backstop: ${e.message}`);
  }
}

setTimeout(() => {
  runSubBackstopSweep();
  setInterval(runSubBackstopSweep, SUB_BACKSTOP_INTERVAL_MS);
}, SUB_BACKSTOP_START_DELAY_MS);

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
    try {
      // Takes the loser's sidecars with it, so the surviving file is not left
      // beside another release's subtitles.
      if (!vidDemoteToOld(src)) throw new Error("rename produced no file");
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
      `sweep=${librarySweepRunning ? 1 : 0} clients=${connectedClients.size} ` +
      `subDone=${subsState.subDone} asrDone=${subsState.asrDone} ` +
      `maxLoopLag=${maxLoopLagMs}ms`,
  );
  maxLoopLagMs = 0; // report the worst lag per beat, not since boot
}, WATCHDOG_HEARTBEAT_MS);
