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
import * as loid from "./src/loid.js";
import * as util from "./src/util.js";
import * as email from "./src/email.js";
import * as tmdb from "./src/tmdb.js";
import { handleFix } from "./src/fix.js";
import fetch from "node-fetch";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import {
  parseFileSeasonEpisode,
  smartTitleMatch,
  parseTitleFromFilename,
  normalizeVideoHeightToQuality,
  getResolution,
  STANDARD_RESOLUTIONS,
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
  resOfName,
  resIsVideoName,
  resFindEpisodeVideos,
  res2160FileName,
  res1080OldFileName,
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
  notifyClients,
  setGlobalMessage,
} from "./src/messaging.js";
import { BATCH_SCHED, ffmpegQueue } from "./src/batchQueue.js";
import * as bifQueue from "./src/bifQueue.js";
import * as subsQueue from "./src/subsQueue.js";
import * as mpfour from "./src/mpfour.js";
import * as intro from "./src/intro.js";
import * as flexget from "./src/flexget.js";
import * as disk from "./src/disk.js";
import * as fileOps from "./src/fileOps.js";
const { getFile, deletePath, deletePaths, delSeasonFiles, createShowFolder } =
  fileOps;
import { registerMediaRoutes } from "./src/routes/media.js";
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
bifQueue.init({ syncBatchMsgs });
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
// GLOBAL-MSG: Bif — show name cropped to 10 chars, append "..." when cropped.
const cropName = (name) => {
  const s = String(name || "");
  return s.length > 20 ? s.slice(0, 20) + "..." : s;
};

// Total batch jobs pending across all three queues combined.
// Format a batch hdrMsg label: code + (N) when queue > 1 + show name. The label
// names only the head job, so "++" is appended when the queue spans more than
// one show — otherwise the count reads as if it were all for that one show.
function batchLabel(code, showName, n, queueShowNames) {
  const prefix = n > 1 ? `${code}(${n})` : code;
  const shows = new Set((queueShowNames || []).filter(Boolean));
  const more = shows.size > 1 ? "++" : "";
  return `${prefix}: ${cropName(showName)}${more}`;
}

// Refresh all four batch hdrMsg entries from live queue state.
// Call this whenever any batch queue changes so every pending type is visible.
function syncBatchMsgs() {
  // Reencode (E)
  if (reencodeQueue.length > 0) {
    const e = reencodeQueue[0];
    const se = `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`;
    setGlobalMessage({
      id: "Reencode",
      text: batchLabel(
        "E",
        `${cropName(e.showName)} ${se}`,
        reencodeQueue.length,
        reencodeQueue.map((r) => r.showName),
      ),
      position: 2003,
    });
  } else {
    setGlobalMessage({ id: "Reencode", action: "hide" });
  }
  // EmbSub (>)
  const embCount = subsState.subQueue.length + (subsState.subQueueBusy ? 1 : 0);
  if (embCount > 0) {
    const embNames = [
      ...(subsState.subQueueBusy
        ? [showNameFromFilePath(subsState.currentlyProcessingSubPath || "")]
        : []),
      ...subsState.subQueue.map((e) => showNameFromFilePath(e.videoFilePath)),
    ];
    const name = subsState.subQueueBusy
      ? showNameFromFilePath(subsState.currentlyProcessingSubPath || "")
      : showNameFromFilePath(subsState.subQueue[0]?.videoFilePath || "");
    setGlobalMessage({
      id: "EmbSub",
      text: batchLabel(">", name, embCount, embNames),
      position: 2004,
    });
  } else {
    setGlobalMessage({ id: "EmbSub", action: "hide" });
  }
  // BIF (B)
  const bifCount = bifQueue.getBifCount();
  if (bifCount > 0) {
    const name = bifQueue.getBifHeadName();
    setGlobalMessage({
      id: "Bif",
      text: batchLabel("B", name, bifCount, bifQueue.getBifShowNames()),
      position: 2002,
    });
  } else {
    setGlobalMessage({ id: "Bif", action: "hide" });
  }
  // ASR (+)
  if (subsState.asrQueue.length > 0) {
    const name = showNameFromFilePath(subsState.asrQueue[0]?.videoPath || "");
    setGlobalMessage({
      id: "Asr",
      text: batchLabel(
        "+",
        name,
        subsState.asrQueue.length,
        subsState.asrQueue.map((e) => showNameFromFilePath(e.videoPath)),
      ),
      position: 2005,
    });
  } else {
    setGlobalMessage({ id: "Asr", action: "hide" });
  }
  // ChkSrt (M)
  if (subsState.subQueueChkSrt.length > 0) {
    const name = showNameFromFilePath(
      subsState.subQueueChkSrt[0]?.videoFilePath || "",
    );
    setGlobalMessage({
      id: "ChkSrt",
      text: batchLabel(
        "M",
        name,
        subsState.subQueueChkSrt.length,
        subsState.subQueueChkSrt.map((e) =>
          showNameFromFilePath(e.videoFilePath),
        ),
      ),
      position: 2006,
    });
  } else {
    setGlobalMessage({ id: "ChkSrt", action: "hide" });
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
const TV_DEVICE_NAMES = ["Living Room TV", "Mark's Fire TV"];

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
loid.setLoidNotifyCallback((needed) =>
  notifyClients(needed ? "loidNeeded" : "loidVerified", {}),
);

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
          unilog(531, `Renamed: ${filename} → ${newFilename}`);
          anyFixed = true;
        } catch (e) {
          unilog(532, `Rename failed for ${oldPath}:`, e.message);
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
        unilog(534, `Emby refresh error:`, e.message);
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
    delete tvdbRecord.haveSubs;
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
      // Resolution fallback: keep a hidden 1080 .alt next to unwatched 2160s.
      try {
        await scanShowForResFallback(showName, tvdbRecord);
      } catch (e) {
        unilog(1100, `res fallback scan failed for ${showName}: ${e.message}`);
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
        if (
          latestPlayed?.lastPlayedDate &&
          latestPlayed.lastPlayedDate !== tvdbRecord.lastPlayedDate
        ) {
          playedDateChanges.push(
            `lastPlayedDate:${tvdbRecord.lastPlayedDate}->${latestPlayed.lastPlayedDate}`,
          );
          tvdbRecord.lastPlayedDate = latestPlayed.lastPlayedDate;
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
      if (showName === "Swiss Toni") {
        unilog(
          540,
          `gapData=${JSON.stringify(gapData)} tvdbRecord.notReady=${tvdbRecord.notReady}`,
        );
      }
      if (gapData) {
        const gapFields = [
          "watchGap",
          "watchGapSeason",
          "watchGapEpisode",
          "fileGap",
          "fileEndError",
          "seasonWatchedThenNofile",
          "anyWatched",
        ];
        for (const f of gapFields) {
          if (tvdbRecord[f] !== gapData[f])
            gapChanges.push(`${f}:${tvdbRecord[f]}->${gapData[f]}`);
        }
        Object.assign(tvdbRecord, gapData);
        tvdbRecord.lastGapCheck = Date.now();
        delete tvdbRecord.allAiredHaveFile;
        delete tvdbRecord.allAiredWatched;
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
        !tvdbRecord.inLinda &&
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
    // React to needsIntro flips: queue or cancel .bif generation.
    const nowNeedsIntro = !!tvdbRecord.needsIntro;
    if (nowNeedsIntro !== prevNeedsIntro) {
      try {
        bifQueue.handleNeedsIntroChange(showName, tvdbRecord, nowNeedsIntro);
      } catch (e) {
        unilog(541, "needsIntro change error:", showName, e.message);
      }
    }
    const push2Changes = [...diskChanges, ...playedDateChanges, ...gapChanges];
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
  pickups.sort((a, b) => {
    const aname = a.replace(/The\s/i, "");
    const bname = b.replace(/The\s/i, "");
    return aname.toLowerCase() > bname.toLowerCase() ? +1 : -1;
  });
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

let sharedFilters = null;

const setSharedFilters = async (params) => {
  if (params === undefined || params === null || params === "") {
    sharedFilters = null;
    notifyClients("sharedFiltersChanged", null);
    return { ok: true };
  }

  // No need to jParse, we expect it to be a JS object already
  sharedFilters = params;
  notifyClients("sharedFiltersChanged", sharedFilters);
  return { ok: true };
};

const getSharedFilters = async (_params) => {
  return sharedFilters;
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

//////////////////  UNILOG  //////////////////

// tv-srvr is the single DB writer. Register the in-process sink so unilog()
// calls inside srvr write directly; other processes/clients use POST /api/log.
epd.setUnilogSink(({ logId, message }) =>
  broadcastUnilog(
    unilogDb.insertEventDedup({ logId, pid: "tv-srvr", message }),
  ),
);
registerUnilogRoutes(app);

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
app.post("/api/toggleResolution", apiWrapper(handleToggleResolution));
app.post(
  "/api/resFallbackScanAll",
  apiWrapper(async () => {
    const all = tvdb.getAllTvdbSync();
    let scanned = 0;
    for (const [showName, rec] of Object.entries(all)) {
      if (!rec?.inEmby) continue;
      try {
        await scanShowForResFallback(showName, rec);
        scanned++;
      } catch (e) {
        unilog(1101, `resFallbackScanAll failed for ${showName}: ${e.message}`);
      }
    }
    return { ok: true, scanned, reencodeQueued: reencodeQueue.length };
  }),
);
app.get("/api/getLastViewed", apiWrapper(view.getLastViewed));
app.get("/api/getSharedFilters", apiWrapper(getSharedFilters));

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
    const { showName } = params;
    if (!showName) return { success: false, error: "Missing showName" };
    const allTvdb = tvdb.getAllTvdbSync();
    const rec = allTvdb?.[showName];
    if (!rec) return { success: false, error: "Show not found" };
    try {
      // Refresh watched/id (Emby) and file/res (disk) so the map is live-fresh.
      // aired dates come from the periodic full refresh; skip the TVDB call here.
      await refreshEpisodeData(showName, rec, { sources: ["emby", "disk"] });
      await tvdb.saveTvdbSync();
      const folder = showName.includes("/")
        ? showName
        : (rec.path || rec.emby?.path || showName).split("/").pop();
      const today = new Date().toISOString().slice(0, 10);
      const seriesMap = epd.toSeriesMap(rec.episodeData, folder, today);
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
app.post("/api/getFile", apiWrapper(getFile));
app.post("/api/getSubFileIds", apiWrapper(getSubFileIds));
app.post("/api/accessTvdb", apiWrapper(tvdb.accessTvdb));
app.post("/api/getTvmazeCrew", apiWrapper(tvdb.getTvmazeCrew_cmd));
app.get("/api/getVipActors", apiWrapper(tvdb.getVipActors));
app.post("/api/setVipActors", apiWrapper(tvdb.setVipActors));
app.post("/api/migrateWatchedCount", apiWrapper(tvdb.migrateWatchedCount));
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

app.get(
  "/api/getSitcoms",
  apiWrapper(async () => {
    try {
      const filePath = "/root/dev/apps/tv/sitcoms.txt";
      const content = await fsp.readFile(filePath, "utf8");
      const sitcoms = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      return { success: true, sitcoms };
    } catch (err) {
      unilog(574, "error:", err);
      return { success: false, error: err.message, sitcoms: [] };
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

app.post(
  "/api/refreshEmbyItem",
  apiWrapper(async (params) => {
    const { showId, showName } = params;
    if (!showId) return { success: false, error: "missing showId" };
    unilog(577, `Refreshing Emby item for ${showName} (${showId})`);
    // Read DateLastRefreshed and DateLastSaved before triggering so we can detect when either changes
    let refreshedBefore = null;
    let savedBefore = null;
    try {
      const beforeRes = await fetch(
        `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${showId}?Fields=DateLastRefreshed,DateLastSaved&api_key=${EMBY_API_KEY}`,
      );
      if (beforeRes.ok) {
        const beforeData = await beforeRes.json();
        refreshedBefore = beforeData.DateLastRefreshed || null;
        savedBefore = beforeData.DateLastSaved || null;
      }
    } catch (e) {
      unilog(578, `pre-fetch error for ${showName}:`, e.message);
    }

    const triggerTime = Date.now();
    try {
      const res = await fetch(
        `${EMBY_BASE_URL}/Items/${showId}/Refresh?Recursive=true&MetadataRefreshMode=Default&api_key=${EMBY_API_KEY}`,
        { method: "POST" },
      );
      if (!res.ok) unilog(579, `Emby returned ${res.status} for ${showName}`);
    } catch (e) {
      unilog(580, `fetch error for ${showName}:`, e.message);
    }

    // Poll until DateLastRefreshed or DateLastSaved changes (max 30s, poll every 1s)
    const POLL_INTERVAL_MS = 1000;
    const POLL_TIMEOUT_MS = 30 * 1000;
    const pollStart = Date.now();
    let refreshDone = false;
    unilog(581, `Polling for refresh completion of ${showName}`);
    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const pollRes = await fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${showId}?Fields=DateLastRefreshed,DateLastSaved&api_key=${EMBY_API_KEY}`,
        );
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          const refreshedAfter = pollData.DateLastRefreshed || null;
          const savedAfter = pollData.DateLastSaved || null;
          const refreshedChanged =
            refreshedAfter &&
            refreshedAfter !== refreshedBefore &&
            new Date(refreshedAfter).getTime() >= triggerTime;
          const savedChanged =
            savedAfter &&
            savedAfter !== savedBefore &&
            new Date(savedAfter).getTime() >= triggerTime;
          if (refreshedChanged || savedChanged) {
            unilog(
              582,
              `Refresh complete for ${showName} (DateLastRefreshed=${refreshedAfter}, DateLastSaved=${savedAfter})`,
            );
            refreshDone = true;
            break;
          }
        }
      } catch (pollErr) {
        unilog(583, `poll error for ${showName}:`, pollErr.message);
      }
    }
    if (!refreshDone) {
      unilog(584, `Poll timed out for ${showName}, enqueuing anyway`);
    }

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
app.post(
  "/api/setLoidCookie",
  apiWrapper((params) => loid.saveAndVerifyLoid(params?.cookie)),
);

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

app.get("/api/asr/chksrt/list", (req, res) => {
  cleanChkSrtQueue();
  notifyClients("chksrt-count", subsState.subQueueChkSrt.length);
  syncBatchMsgs();
  res.json({
    count: subsState.subQueueChkSrt.length,
    path: subsState.subQueueChkSrt[0]?.videoFilePath,
  });
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
  notifyClients("chksrt-count", subsState.subQueueChkSrt.length);
  syncBatchMsgs();
  res.json({ ok: true, queued: videoPaths.length });
});

app.post("/api/asr/chksrt/ok", (req, res) => {
  const entry = subsState.subQueueChkSrt[0];
  // result saved — this file no longer needs a seekable mirror
  mpfour.cancelEncode(req.body?.videoPath || entry?.videoFilePath || "");
  if (entry) {
    const base = resStripAlt(entry.videoFilePath).replace(/\.[^.]+$/, "");
    const dir = path.dirname(entry.videoFilePath);
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
        unilog(
          1368,
          `chosen marker write failed for ${basename}: ${e.message}`,
        );
      }
    }
  }
  subsState.subQueueChkSrt.shift();
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  notifyClients("chksrt-count", subsState.subQueueChkSrt.length);
  syncBatchMsgs();
  res.json({ ok: true });
});

app.post("/api/asr/chksrt/gensrt", (req, res) => {
  const entry = subsState.subQueueChkSrt.shift();
  if (entry) {
    const showName = showNameFromFilePath(entry.videoFilePath);
    const parsed = parseFileSeasonEpisode(entry.videoFilePath);
    addToAsrQueue([
      {
        videoPath: entry.videoFilePath,
        showName,
        season: parsed?.season ?? 0,
        episode: parsed?.episode ?? 0,
        fromUI: false,
        lowPriority: false,
        source: "chksrt player",
        addedAt: Date.now(),
      },
    ]);
  }
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  notifyClients("chksrt-count", subsState.subQueueChkSrt.length);
  syncBatchMsgs();
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
  notifyClients("chksrt-count", subsState.subQueueChkSrt.length);
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
  notifyClients("chksrt-count", subsState.subQueueChkSrt.length);
  syncBatchMsgs();
  res.json({ ok: true });
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

// Check whether a video file has a BIF trickplay sidecar (name-320-10.bif).
app.get("/api/hasBif", async (req, res) => {
  const videoPath = req.query.path;
  if (!videoPath) {
    res.status(400).json({ ok: false, error: "path required" });
    return;
  }
  try {
    const parsed = path.parse(videoPath);
    const bifPath = path.join(parsed.dir, `${parsed.name}-320-10.bif`);
    let hasBif = false;
    try {
      await fsp.access(bifPath);
      hasBif = true;
    } catch {
      hasBif = false;
    }
    res.json({ ok: true, hasBif });
  } catch (err) {
    unilog(600, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// Enqueue one or more video files for BIF generation.
// Body: { showName: string, paths: string[] }
app.post("/api/bif/enqueue", async (req, res) => {
  const { showName, paths } = req.body || {};
  if (!showName || !Array.isArray(paths) || paths.length === 0) {
    res.status(400).json({ ok: false, error: "showName and paths[] required" });
    return;
  }
  const added = await bifQueue.enqueueBif(showName, paths);
  res.json({ ok: true, added });
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
    // "none"), it no longer needsIntro. Clear the flag and cancel any pending
    // .bif job immediately instead of waiting for the next background update.
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
      introDur: record?.introDur ?? null,
      startMark: si.startMark,
      trimPos: si.trimPos,
      skipDur: si.skipDur,
    });
  } catch (err) {
    unilog(611, "error:", err.message);
    res.json({
      introDur: null,
      startMark: null,
      trimPos: null,
      skipDur: null,
      error: err.message,
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
    notifyClients("asr-queue-update", {
      count: subsState.asrQueue.length,
      running: subsState.genSrtRunning,
    });
  }
  if (isProcessing && subsState.genSrtChild) {
    subsState.genSrtChild.kill("SIGTERM");
  }
  res.json({ ok: true, count: subsState.asrQueue.length });
});

app.get("/api/asr/log", (req, res) => {
  res.json({ lines: subsState.asrLogBuffer.join("\n") });
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
  // .bif generation: clear any stale lock, restore queue, resume work.
  bifQueue.resumeOnStartup();
  // seekable-mp4 mirrors for the chksrt queue (own loop, not ffmpegQueue)
  mpfour.start({ syncBatchMsgs });
});

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
  if (!latestPlayed?.lastPlayedDate) return false;

  const lastPlayedChanged =
    latestPlayed.lastPlayedDate !== (tvdbRecord.lastPlayedDate || null);
  if (!lastPlayedChanged) return false;

  tvdbRecord.lastPlayedDate = latestPlayed.lastPlayedDate;
  await tvdb.saveTvdbSync();
  notifyClients("tvdbUpdated", {
    name: tvdbRecord.name || showName,
    record: tvdbRecord,
  });
  unilog(
    612,
    `refreshed lastPlayedDate for ${showName} -> ${latestPlayed.lastPlayedDate}`,
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

  // Refresh intro-overlay labels for any intro UI tab whose device is now playing
  for (const ws of connectedClients) {
    const ui = ws._embyUi;
    if (!ui || ui.uiId !== "intro" || ws.readyState !== 1) continue;
    const item = lastNowPlayingList.find((p) => p.device === ui.deviceName);
    if (!item) continue;
    // Only push to tabs viewing the same item
    if (ui.embyItemId && item.id && ui.embyItemId !== item.id) continue;
    const record = tvdb.getAllTvdbSync()?.[item.showName];
    intro.pushIntroState(ws, record, item.showName, item.season, item.episode);
  }

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

// GLOBAL-MSG: Down + CPU — periodic producers pushed to all clients.
const DOWN_INPROGRESS_PATH = path.join(
  path.dirname(SRVR_ROOT_DIR),
  "down",
  "data",
  "tv-inProgress.json",
);
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
    setGlobalMessage({
      id: "CPU",
      text: `Cpu:${Math.round(full10)}`,
      position: 1001,
    });
  } catch (e) {
    unilog(616, "cpu psi error:", e.message);
  }
  // GLOBAL-MSG: Down
  try {
    syncBatchMsgs(); // safety refresh in case any queue update was missed
    let count = 0;
    if (fs.existsSync(DOWN_INPROGRESS_PATH)) {
      const map = JSON.parse(fs.readFileSync(DOWN_INPROGRESS_PATH, "utf8"));
      count = map && typeof map === "object" ? Object.keys(map).length : 0;
    }
    if (count > 0)
      setGlobalMessage({ id: "Down", text: `Down: ${count}`, position: 11 });
    else setGlobalMessage({ id: "Down", action: "hide" });
  } catch (e) {
    unilog(617, "down poll error:", e.message);
  }
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

  if (loid.isLoidNeeded()) {
    try {
      ws.send(JSON.stringify({ id: 0, notification: "loidNeeded", data: {} }));
    } catch (e) {
      unilog(1372, `ws send loidNeeded failed: ${e.message}`);
    }
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
    } else if (fname === "tvRemoteAction") {
      // Broadcast to other clients only; sender handles its own avoidance locally
      const otherClients = [...connectedClients].filter(
        (c) => c !== ws && c.readyState === 1,
      );
      const outMsg = JSON.stringify({
        id: 0,
        notification: "tvRemoteAction",
        data: param,
      });
      for (const client of otherClients) {
        try {
          client.send(outMsg);
        } catch (e) {
          unilog(1377, `ws broadcast tvRemoteAction failed: ${e.message}`);
        }
      }
    } else if (fname === "skipIntro") {
      const pressedAt = param?.pressedAt;
      intro
        .doSkipIntro(pressedAt)
        .catch((err) => unilog(619, "error:", err.message));
    } else if (fname === "embyHello") {
      ws._embyUi = {
        uiId: param?.uiId ?? null,
        deviceName: param?.deviceName ?? null,
        embyItemId: param?.embyItemId ?? null,
      };
      if (param?.uiId === "intro") {
        intro
          .pushIntroStateFromItem(ws, param?.embyItemId)
          .catch((e) => unilog(620, "error:", e.message));
      }
    } else if (fname === "embyPress") {
      if (ws._embyUi?.uiId === "intro") {
        intro
          .handleEmbyIntroPress(
            ws,
            param?.btnId,
            param?.pressedAt,
            param?.videoTimeSec,
          )
          .catch((e) => unilog(621, "error:", e.message));
      }
    } else if (fname === "tvRemoteCollision") {
      notifyClients("tvRemoteLock", null);
    } else if (fname === "unilogSubscribe") {
      unilogRoutes.addUnilogSubscriber(ws);
    } else if (fname === "unilogUnsubscribe") {
      unilogRoutes.removeUnilogSubscriber(ws);
    } else if (fname === "tvRemoteUnlock") {
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
    connectedClients.delete(ws);
    unilogRoutes.removeUnilogSubscriber(ws);
    socketName = "unknown websocket";
  });

  ws.on("close", () => {
    // log(socketName + ' closed');
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
          dateCreated: util.toPstDateTime(embyShow.DateCreated),
          premiereDate: embyShow.PremiereDate?.substring(0, 10),
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
      tvdbRecord.dateCreated = util.toPstDateTime(embyShow.DateCreated);
      tvdbRecord.premiereDate = embyShow.PremiereDate?.substring(0, 10);
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
        if (
          latestPlayed?.lastPlayedDate &&
          latestPlayed.lastPlayedDate !== tvdbRecord.lastPlayedDate
        ) {
          tvdbRecord.lastPlayedDate = latestPlayed.lastPlayedDate;
          lastPlayedChanged++;
          appendWatchgapLog(
            `  lastPlayedDate updated | ${elapsed}ms | ${showName} -> ${latestPlayed.lastPlayedDate}`,
          );
        }
      } catch (err) {
        unilog(73, `${showName}: ${err.message}`);
      }
    }
    if (lastPlayedChanged > 0) {
      await tvdb.saveTvdbSync();
      unilog(74, `Updated ${lastPlayedChanged} shows`);
    }

    // Now run gap check with fresh emby and disk data
    const gapData = await emby.gapCheckBatch(shows);
    for (const { showId, showName } of shows) {
      const g = gapData?.[showId];
      if (showName === "Swiss Toni") {
        unilog(662, `showId=${showId} g=${JSON.stringify(g)}`);
      }
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
      .sort(
        (a, b) =>
          (a.tvdbRecord.lastGapCheck ?? 0) - (b.tvdbRecord.lastGapCheck ?? 0),
      );

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

const DISK_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour (full disk check)
const GAP_CHECK_INTERVAL = 6 * 60 * 1000; // 6 minutes (processes batch of 10 shows, checks disk per-show)

async function fetchLatestPlayedInfo(showId) {
  const epUrl = `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?api_key=${EMBY_API_KEY}&ParentId=${showId}&IncludeItemTypes=Episode&Recursive=true&IsPlayed=true&SortBy=DatePlayed&SortOrder=Descending&Limit=1`;
  const epResp = await fetch(epUrl);
  if (!epResp.ok) return null;
  const epData = await epResp.json();
  const epId = epData.Items?.[0]?.Id;
  if (!epId) return null;
  const detailUrl = `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${epId}?api_key=${EMBY_API_KEY}`;
  const detailResp = await fetch(detailUrl);
  if (!detailResp.ok) return null;
  const detail = await detailResp.json();
  const utcStr = detail.UserData?.LastPlayedDate;
  if (!utcStr) return null;
  return {
    lastPlayedDate: utcStr,
  };
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

    try {
      const res = await fetch(
        `${EMBY_BASE_URL}/Library/Refresh?api_key=${EMBY_API_KEY}`,
        { method: "POST" },
      );
      if (res.ok) {
        taskId = await getLibraryTaskId();
        unilog(76, `taskId: ${taskId || "none"}`);
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
            }
            if (task.State !== "Running") {
              unilog(77, `scan finished (State=${task.State})`);
              break;
            }
          }
        } catch (e) {
          unilog(671, `poll error:`, e.message);
        }
      }
    } else {
      unilog(78, `no taskId, waiting 90s`);
      await new Promise((r) => setTimeout(r, 90 * 1000));
    }

    running = false;
    lastFinishedAt = Date.now();
    currentProgress = null;

    // Resolve this generation's waiters now — they got their scan.
    const showNames = [...myShowNames];
    unilog(
      672,
      `done, notifying clients (shows: ${showNames.join(", ") || "manual"})`,
    );
    notifyClients("libraryRefreshDone", { showNames });
    for (const { resolve } of myWaiters) resolve(showNames);

    // If new requests arrived during this scan, start another run for them.
    if (pendingShowNames.size > 0 || pendingWaiters.length > 0) {
      const nextShowNames = new Set([...pendingShowNames]);
      const nextWaiters = [...pendingWaiters];
      pendingShowNames = new Set();
      pendingWaiters = [];
      unilog(
        673,
        `pending shows: ${[...nextShowNames].join(", ")}, re-running`,
      );
      setTimeout(
        () =>
          run(nextShowNames, nextWaiters).catch((e) =>
            unilog(674, "run error:", e.message),
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
            `${caller}: refresh in flight, queued${showName ? ` ${showName}` : ""}`,
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
            unilog(676, "run error:", e.message),
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
    const isVideo = videoFileExtensions.includes(ext);
    const isBif = ext === "bif";
    if (!isVideo && !isBif) return;

    const showName = extractShowNameFromPath(filePath);
    if (!showName) return;

    unilog(88, `${isBif ? "bif" : "video"} added: ${showName}`);

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
        if (tvdbRec && tvdbRec.inEmby) {
          await scanShowForResFallback(showName, tvdbRec);
        }
      } catch (err) {
        unilog(683, `sub check error for ${showName}:`, err.message);
      }
      handleShowDiskChange(showName);
    }, DISK_CHANGE_DEBOUNCE_MS);
  })
  .on("unlink", (filePath) => {
    // Strip a trailing `.alt` so hidden 1080 fallbacks (…​.mkv.alt) are seen as
    // video deletions rather than extension "alt" (which would be ignored).
    const ext = resStripAlt(filePath).split(".").pop();
    if (!videoFileExtensions.includes(ext) && ext !== "bif") return;

    const showName = extractShowNameFromPath(filePath);
    if (!showName) return;

    unilog(684, `${ext === "bif" ? "bif" : "video"} deleted: ${showName}`);

    // Debounce: clear existing timeout and set new one
    const unlinkEntry = changedShows.get(showName);
    if (unlinkEntry) clearTimeout(unlinkEntry.timeout);

    const unlinkTimeout = setTimeout(async () => {
      changedShows.delete(showName);
      // Deleting a video (e.g. a 1080 .alt fallback) can leave an unwatched
      // 2160 without its fallback — re-scan so it gets regenerated.
      try {
        const tvdbRec = tvdb.getAllTvdbSync?.()?.[showName];
        if (tvdbRec && tvdbRec.inEmby) {
          await scanShowForResFallback(showName, tvdbRec);
        }
      } catch (err) {
        unilog(
          1124,
          `res scan on delete failed for ${showName}: ${err.message}`,
        );
      }
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

//////////////////  RESOLUTION FALLBACK (2160 ↔ 1080)  //////////////////
// Keep a hidden 1080 ".alt" fallback next to each unwatched 2160 episode so
// playback can switch resolution (slow wifi can't stream 2160). See
// toggle-resolution-instr.md / toggle-resolution-plan.md.
//
// File convention (Emby ignores any name whose final extension is not a video
// extension, so ".alt" hides a file):
//   active 2160:  Show.S01E01.2160p.mkv
//   hidden 1080:  Show.S01E01.1080p.mkv.alt
// Toggling swaps which member carries the ".alt" suffix.

// When false, block new ffmpeg 2160->1080 re-encodes; kept-aside 1080 .old
// files are still renamed to .alt (no ffmpeg involved). 1080 alt files
// already on disk keep working for resolution switching either way. Off by
// default: the 2160 player-overload problem this was built for hasn't
// recurred recently.
const RECODE_TO_1080 = false;
const RES_SUBTITLE_EXTS = new Set([
  ".srt",
  ".ass",
  ".ssa",
  ".sub",
  ".idx",
  ".sup",
  ".vtt",
  ".smi",
]);
const REENCODE_QUEUE_PATH = path.join(
  SRVR_ROOT_DIR,
  "data",
  "reencode-queue.json",
);

// Best-effort cross-app guard: is the downloader already fetching a 1080 for
// this episode? Optional — if the map can't be read, assume not in progress.
function res1080DownloadInProgress(season, episode) {
  let map;
  try {
    map = JSON.parse(fs.readFileSync(DOWN_INPROGRESS_PATH, "utf8"));
  } catch {
    return false;
  }
  const sKey = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  const re = new RegExp(sKey, "i");
  for (const key of Object.keys(map || {})) {
    if (/1080p/i.test(key) && re.test(key)) return true;
  }
  return false;
}

// Duplicate every 2160 sidecar subtitle under the 1080 basename, then enqueue
// the new 1080 video for a subtitle check (chksrt).
// Copy the 2160 episode's subtitle sidecars AND its chksrt result (the
// `.mb.chosen` marker) onto the generated 1080 basename. The 1080 has identical
// tracks, so the subtitles and the subtitle-check outcome are reused directly —
// no extraction and no re-check are needed.
function res1080CopySubtitles(seasonDir, src2160Name, dst1080Name) {
  const src2160Base = src2160Name.replace(/\.[^.]+$/, "");
  const dst1080Base = dst1080Name.replace(/\.[^.]+$/, "");
  let files;
  try {
    files = fs.readdirSync(seasonDir);
  } catch (e) {
    unilog(1381, `sub copy scan failed for ${seasonDir}: ${e.message}`);
    files = [];
  }
  for (const name of files) {
    if (!name.startsWith(src2160Base)) continue;
    const ext = path.extname(name).toLowerCase();
    const isSub = RES_SUBTITLE_EXTS.has(ext);
    const isChosen = name.endsWith(".mb.chosen"); // chksrt result marker
    if (!isSub && !isChosen) continue;
    const suffix = name.slice(src2160Base.length); // e.g. ".en.srt" or ".mb.chosen"
    const dstName = dst1080Base + suffix;
    const dstPath = path.join(seasonDir, dstName);
    if (fs.existsSync(dstPath)) continue;
    try {
      fs.copyFileSync(path.join(seasonDir, name), dstPath);
    } catch (e) {
      unilog(1102, `sub copy failed for ${dstName}: ${e.message}`);
    }
  }
}

//////  re-encode queue (single ffmpeg worker)  //////
let reencodeQueue = [];
let reencodeRunning = false;

function loadReencodeQueue() {
  try {
    reencodeQueue = JSON.parse(fs.readFileSync(REENCODE_QUEUE_PATH, "utf8"));
    if (!Array.isArray(reencodeQueue)) reencodeQueue = [];
  } catch (e) {
    // Missing file is normal on first run; anything else is data loss.
    if (e.code !== "ENOENT")
      unilog(1382, `reencode queue load failed: ${e.message}`);
    reencodeQueue = [];
  }
}
function persistReencodeQueue() {
  try {
    fs.writeFileSync(
      REENCODE_QUEUE_PATH,
      JSON.stringify(reencodeQueue),
      "utf8",
    );
  } catch (e) {
    unilog(1103, `reencode queue persist failed: ${e.message}`);
  }
}
function enqueueReencode(entry) {
  // entry: { srcPath, showName, season, episode }
  if (reencodeQueue.some((e) => e.srcPath === entry.srcPath)) return;
  reencodeQueue.push(entry);
  persistReencodeQueue();
  unilog(1104, `reencode queued: ${path.basename(entry.srcPath)}`);
  syncBatchMsgs();
  setTimeout(processReencodeQueue, 0);
}

async function reencodeOneTo1080(entry) {
  const { srcPath, season, episode } = entry;
  if (!fs.existsSync(srcPath)) {
    unilog(1105, `reencode skip — source gone: ${srcPath}`);
    return;
  }
  const seasonDir = path.dirname(srcPath);
  const srcName = path.basename(srcPath);
  // Re-check: a 1080 may have appeared since this was queued.
  if (
    resFindEpisodeVideos(seasonDir, season, episode).some((f) => f.res === 1080)
  ) {
    unilog(1106, `reencode skip — 1080 already present: ${srcName}`);
    return;
  }
  const dst1080Name = srcName.replace(/2160/g, "1080"); // e.g. Show.S01E01.1080p.mkv
  // tmpPath: hidden dotfile so chokidar/Emby ignore it while encoding.
  // vidTmpPath: intermediate video-only MP4. Re-encoding through a separate
  // container and remuxing strips the DoVi configuration record that ffmpeg
  // would otherwise copy from the source into the MKV video track (which makes
  // Emby/Bravia spin on playback). MP4 is used rather than a raw elementary
  // stream because raw video carries no timing, so it would be read back at
  // ffmpeg's default 25 fps and desync the audio on non-25fps sources.
  const tmpPath = path.join(seasonDir, ".restmp-" + dst1080Name);
  const vidTmpPath = tmpPath.replace(/\.mkv$/i, ".mp4");
  const dstPath = path.join(seasonDir, dst1080Name + ".alt");
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch (e) {
    unilog(1107, `could not remove stale temp ${tmpPath}: ${e.message}`);
  }
  try {
    if (fs.existsSync(vidTmpPath)) fs.unlinkSync(vidTmpPath);
  } catch (e) {
    unilog(1121, `could not remove stale vid temp: ${e.message}`);
  }
  unilog(1108, `start reencode 2160->1080: ${srcName}`);
  await ffmpegQueue.run(
    () =>
      new Promise((resolve, reject) => {
        const REENCODE_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours max (SW encode ~1x realtime)
        // Step 1: encode video only to a video-only MP4 (preserves timing).
        // HEVC Main 10 keeps the source's 10-bit depth + HDR; the Bravia
        // hardware-decodes it just like the 4K HEVC sources, so it direct-plays.
        // SW encode (libx265) is used instead of VAAPI: the GPU encoder pads
        // surfaces to a 16-pixel alignment boundary, causing a right-edge
        // stretching artifact on non-standard-aspect sources (e.g. 1.85:1
        // 3840x2076). libx265 accepts any even dimension cleanly.
        // scale=-2:1080 produces the mathematically correct width (e.g. 1998px
        // for 1.85:1) with no padding or edge replication.
        const args1 = [
          "-y",
          "-i",
          srcPath,
          "-map",
          "0:v:0",
          "-vf",
          "scale=-2:1080,crop=iw:1072",
          "-c:v",
          "libx265",
          "-pix_fmt",
          "yuv420p10le",
          "-profile:v",
          "main10",
          "-preset",
          "medium",
          "-b:v",
          "8M",
          "-maxrate",
          "10M",
          "-bufsize",
          "16M",
          "-tag:v",
          "hvc1",
          vidTmpPath,
        ];
        const ff1 = cp.spawn(BATCH_SCHED[0], [
          ...BATCH_SCHED.slice(1),
          "ffmpeg",
          ...args1,
        ]);
        const killTimer = setTimeout(() => {
          ff1.kill("SIGKILL");
        }, REENCODE_TIMEOUT_MS);
        ff1.stderr.on("data", () => {});
        ff1.on("error", (err) => {
          clearTimeout(killTimer);
          reject(err);
        });
        ff1.on("close", (code) => {
          clearTimeout(killTimer);
          if (code !== 0) {
            reject(new Error(`ffmpeg step1 exit ${code}`));
            return;
          }
          // Step 2: remux MP4 video + all non-video streams from source into MKV.
          // -map 0:v:0  = re-encoded H.264 video from step 1
          // -map 1      = everything from source (audio, subs, attachments)
          // -map -1:v   = remove source video (we already have it from step 1)
          const args2 = [
            "-y",
            "-i",
            vidTmpPath,
            "-i",
            srcPath,
            "-map",
            "0:v:0",
            "-map",
            "1",
            "-map",
            "-1:v",
            "-c",
            "copy",
            tmpPath,
          ];
          const ff2 = cp.spawn("ffmpeg", args2);
          ff2.stderr.on("data", () => {});
          ff2.on("error", (err) => {
            try {
              fs.unlinkSync(vidTmpPath);
            } catch (e) {
              if (e.code !== "ENOENT")
                unilog(1383, `temp cleanup failed: ${e.message}`);
            }
            reject(err);
          });
          ff2.on("close", (code2) => {
            try {
              fs.unlinkSync(vidTmpPath);
            } catch (e) {
              if (e.code !== "ENOENT")
                unilog(1384, `temp cleanup failed: ${e.message}`);
            }
            if (code2 === 0) resolve();
            else reject(new Error(`ffmpeg step2 exit ${code2}`));
          });
        });
      }),
  );
  fs.renameSync(tmpPath, dstPath);
  unilog(1109, `reencode done 2160->1080: ${dst1080Name}.alt`);
  res1080CopySubtitles(seasonDir, srcName, dst1080Name);
}

async function processReencodeQueue() {
  if (!RECODE_TO_1080) return; // also blocks any stale entries persisted before this was disabled
  if (reencodeRunning) return;
  const entry = reencodeQueue[0];
  if (!entry) return;
  reencodeRunning = true;
  syncBatchMsgs();
  let encodeSucceeded = false;
  try {
    await reencodeOneTo1080(entry);
    encodeSucceeded = true;
  } catch (e) {
    unilog(1110, `reencode failed for ${entry.srcPath}: ${e.message}`);
    // Clean up stale temp files so they don't fool the scanner.
    const tmpPath = path.join(
      path.dirname(entry.srcPath),
      ".restmp-" + path.basename(entry.srcPath).replace(/2160/g, "1080"),
    );
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (e) {
      unilog(1385, `stale temp cleanup failed for ${tmpPath}: ${e.message}`);
    }
    const vidTmpPath = tmpPath.replace(/\.mkv$/i, ".mp4");
    try {
      if (fs.existsSync(vidTmpPath)) fs.unlinkSync(vidTmpPath);
    } catch (e) {
      unilog(1386, `stale temp cleanup failed for ${vidTmpPath}: ${e.message}`);
    }
  } finally {
    if (reencodeQueue[0]?.srcPath === entry.srcPath) {
      reencodeQueue.shift();
      persistReencodeQueue();
    }
    reencodeRunning = false;
    syncBatchMsgs();
    if (reencodeQueue.length > 0) setTimeout(processReencodeQueue, 1000);
  }
}

// Evaluate one episode and, if a 1080 fallback is needed, rename a kept .old
// copy to .alt (preferred) or queue an ffmpeg re-encode of the 2160 file.
async function res1080NeededAndAcquire(
  showName,
  tvdbRecord,
  season,
  episode,
  seasonDir,
) {
  if (!tvdbRecord?.inEmby) return;
  if (epd.isWatched(tvdbRecord.episodeData, season, episode)) return;
  const vids = resFindEpisodeVideos(seasonDir, season, episode);
  if (!vids.some((f) => f.res === 2160)) return;
  if (vids.some((f) => f.res === 1080)) return;
  if (res1080DownloadInProgress(season, episode)) return;

  // Preferred: reuse a kept-aside 1080 .old → rename to .alt.
  const oldName = res1080OldFileName(seasonDir, season, episode);
  if (oldName) {
    const altName = oldName.replace(/\.old$/i, ".alt");
    try {
      fs.renameSync(
        path.join(seasonDir, oldName),
        path.join(seasonDir, altName),
      );
      unilog(1111, `reused kept 1080 .old->.alt: ${altName}`);
      const src2160 = res2160FileName(seasonDir, season, episode);
      if (src2160) {
        res1080CopySubtitles(seasonDir, src2160, resStripAlt(altName));
      }
    } catch (e) {
      unilog(1112, `.old->.alt rename failed for ${altName}: ${e.message}`);
    }
    return;
  }

  // Otherwise re-encode from the 2160 file.
  if (!RECODE_TO_1080) return;
  const src2160 = res2160FileName(seasonDir, season, episode);
  if (!src2160) return;
  enqueueReencode({
    srcPath: path.join(seasonDir, src2160),
    showName,
    season,
    episode,
  });
}

// Scan every season of a show for episodes that need a 1080 fallback.
async function scanShowForResFallback(showName, tvdbRecord) {
  if (!tvdbRecord?.inEmby) return;
  const showFolderName = showName.includes("/")
    ? showName
    : (tvdbRecord.path || tvdbRecord.emby?.path || showName).split("/").pop();
  const showFolder = path.join(tvDir, showFolderName);
  let seasonDirs;
  try {
    seasonDirs = fs.readdirSync(showFolder);
  } catch {
    return;
  }
  for (const seasonDirName of seasonDirs) {
    const seasonDir = path.join(showFolder, seasonDirName);
    try {
      if (!fs.statSync(seasonDir).isDirectory()) continue;
    } catch {
      continue;
    }
    let files;
    try {
      files = fs.readdirSync(seasonDir);
    } catch {
      continue;
    }
    const seen = new Set();
    for (const name of files) {
      if (!resIsVideoName(name)) continue;
      if (resOfName(name) !== 2160) continue;
      const parsed = parseFileSeasonEpisode(resStripAlt(name), seasonDirName);
      if (parsed?.season == null || parsed?.episode == null) continue;
      const key = `${parsed.season}E${parsed.episode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await res1080NeededAndAcquire(
        showName,
        tvdbRecord,
        parsed.season,
        parsed.episode,
        seasonDir,
      );
    }
  }
}

// Swap the ".alt" marker between the active and hidden video for an episode.
function resToggleFiles(seasonDir, season, episode) {
  const vids = resFindEpisodeVideos(seasonDir, season, episode);
  const active = vids.find((v) => !v.alt && (v.res === 2160 || v.res === 1080));
  const alt = vids.find((v) => v.alt && (v.res === 2160 || v.res === 1080));
  if (!active || !alt) {
    throw new Error(
      `resToggle needs one active + one alt (active=${active?.name}, alt=${alt?.name})`,
    );
  }
  const newAltPath = path.join(seasonDir, active.name) + ".alt";
  const newActivePath = path.join(seasonDir, resStripAlt(alt.name));
  fs.renameSync(path.join(seasonDir, active.name), newAltPath);
  fs.renameSync(path.join(seasonDir, alt.name), newActivePath);
  return { newActiveRes: alt.res, newActiveName: resStripAlt(alt.name) };
}

// POST /api/toggleResolution — swap .alt, refresh Emby (await), return episode.
async function handleToggleResolution(params) {
  let { relPath, showName, season, episode, episodeId } = params || {};
  let seasonDir = null;
  if (relPath) {
    const abs = path.join(tvDir, relPath);
    seasonDir = path.dirname(abs);
    showName = showNameFromFilePath(abs);
    const parsed = parseFileSeasonEpisode(
      resStripAlt(path.basename(abs)),
      path.basename(seasonDir),
    );
    season = parsed?.season;
    episode = parsed?.episode;
  } else if (showName != null && season != null && episode != null) {
    season = Number(season);
    episode = Number(episode);
    const rec = tvdb.getAllTvdbSync()[showName];
    const showFolderName = showName.includes("/")
      ? showName
      : (rec?.path || rec?.emby?.path || showName).split("/").pop();
    seasonDir = path.join(tvDir, showFolderName, `Season ${season}`);
  } else {
    return { ok: false, error: "missing relPath or show/season/episode" };
  }
  if (season == null || episode == null) {
    return { ok: false, error: "could not determine season/episode" };
  }
  season = Number(season);
  episode = Number(episode);
  const tvdbRecord = tvdb.getAllTvdbSync()[showName];

  const { newActiveRes } = resToggleFiles(seasonDir, season, episode);
  unilog(1113, `toggled ${showName} S${season}E${episode} -> ${newActiveRes}p`);

  // Trigger an Emby library refresh and wait for it to finish.
  await embyRefreshManager.request(`resToggle:${showName}`, showName);

  // Resolve the Emby episode id if the caller didn't supply one.
  if (!episodeId && tvdbRecord?.id) {
    try {
      const seriesMap = await emby.getSeriesMap({ id: tvdbRecord.id });
      const seasonEntry = (seriesMap || []).find(([s]) => s === season);
      const epEntry = seasonEntry?.[1]?.find(([e]) => e === episode);
      episodeId = epEntry?.[1]?.id || null;
    } catch (e) {
      unilog(1114, `resolve episodeId failed for ${showName}: ${e.message}`);
    }
  }

  return {
    ok: true,
    showId: tvdbRecord?.id || null,
    showName,
    episodeId: episodeId || null,
    resolution: newActiveRes,
  };
}

loadReencodeQueue();
if (!RECODE_TO_1080 && reencodeQueue.length > 0) {
  // Drain entries persisted before RECODE_TO_1080 was turned off — otherwise
  // processReencodeQueue's early return leaves them stuck forever, showing a
  // permanent "pending" hdrMsg for jobs that will never run.
  unilog(1435, `dropped ${reencodeQueue.length} stale reencode queue entries (RECODE_TO_1080 is off)`);
  reencodeQueue = [];
  persistReencodeQueue();
}
if (reencodeQueue.length > 0) setTimeout(processReencodeQueue, 5000);

// Watchdog heartbeat: a periodic status beat (queue depths + running flags) so
// the external tv-watchdog monitor (apps/watchdog) can detect a dead/stuck
// server and spot stuck queues. Read from the unilog DB by matching "hb ".
const WATCHDOG_HEARTBEAT_MS = 2 * 60 * 1000;
setInterval(() => {
  unilog(
    1206,
    `hb subQ=${subsState.subQueue.length} chkQ=${subsState.subQueueChkSrt.length} ` +
      `asrQ=${subsState.asrQueue.length} bif=${bifQueue.getBifCount()} ` +
      `renc=${reencodeQueue.length} flex=${flexget.isFlexgetRunning() ? 1 : 0} ` +
      `sweep=${embyFullSweepRunning ? 1 : 0} clients=${connectedClients.size} ` +
      `subDone=${subsState.subDone} asrDone=${subsState.asrDone}`,
  );
}, WATCHDOG_HEARTBEAT_MS);
