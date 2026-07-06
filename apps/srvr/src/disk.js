// Disk domain: scans the tv media tree for shows/episodes (files, resolution,
// .bif sidecars), builds Emby tvshow.nfo, and performs the authoritative
// refresh of a record's episodeData from TVDB + Emby + disk. Owns the
// whole-library disk cache (invalidated by the file watcher) and the
// ffprobe-height cache.

import fs from "fs";
import fsp from "fs/promises";
import * as cp from "child_process";
import * as path from "node:path";
import { unilog } from "@tv/share";
import {
  parseFileSeasonEpisode,
  parseTitleFromFilename,
  smartTitleMatch,
  getResolution,
} from "@tv/share";
import * as epd from "@tv/share";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import * as tvdb from "./tvdb.js";
import * as emby from "./emby.js";
import { videoFileExtensions } from "./videoFiles.js";

const tvDir = "/mnt/media/tv";

function runFfprobe(args, maxBuffer = 2 * 1024 * 1024) {
  return cp.execFileSync("ffprobe", args, {
    maxBuffer,
    encoding: "utf8",
  });
}

export function safeShowFolderName(rawName) {
  if (typeof rawName !== "string") return null;

  let name = rawName.trim();
  if (!name) return null;

  // Prevent traversal / invalid names: remove path separators and trailing dots/spaces.
  name = name.replaceAll("/", " ").replaceAll("\\", " ");
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1F\x7F]/g, " ");
  name = name.replace(/[\.\s]+$/g, "");
  name = name.replace(/\s{2,}/g, " ").trim();
  if (!name) return null;

  return name;
}

export function seasonFolderName(season) {
  // Keep consistent with existing convention used elsewhere: `Season ${season}`.
  // If season is a number, keep it unpadded (Season 1). If it's a string like "01", preserve it.
  if (season === null || season === undefined) return null;
  const s = typeof season === "number" ? String(season) : String(season).trim();
  if (!s) return null;
  return `Season ${s}`;
}

function xmlEsc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildTvShowNfo(showName, tvdbId) {
  const cleanName = String(showName || "").trim();
  const cleanTvdbId = String(tvdbId || "").trim();
  if (!cleanName || !cleanTvdbId) return "";

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    "<tvshow>\n" +
    `  <title>${xmlEsc(cleanName)}</title>\n` +
    `  <tvdbid>${xmlEsc(cleanTvdbId)}</tvdbid>\n` +
    `  <uniqueid type="tvdb" default="true">${xmlEsc(cleanTvdbId)}</uniqueid>\n` +
    "</tvshow>\n"
  );
}

function fmtDateWithTZ(date, utcOut = false) {
  let year, month, day;
  if (utcOut) {
    year = date.getUTCFullYear();
    month = String(date.getUTCMonth() + 1).padStart(2, "0");
    day = String(date.getUTCDate()).padStart(2, "0");
  } else {
    year = date.getFullYear();
    month = String(date.getMonth() + 1).padStart(2, "0");
    day = String(date.getDate()).padStart(2, "0");
  }
  return `${year}-${month}-${day}`;
}

const probedRawHeightByPath = new Map();

function probeRawHeight(filePath) {
  if (!filePath) return null;
  if (probedRawHeightByPath.has(filePath)) {
    return probedRawHeightByPath.get(filePath);
  }

  let h = null;
  try {
    const out = runFfprobe(
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=height",
        "-of",
        "csv=p=0",
        String(filePath),
      ],
      1024 * 1024,
    ).trim();
    const parsed = Number.parseInt(out, 10);
    h = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    h = null;
  }

  probedRawHeightByPath.set(filePath, h);
  return h;
}

function toEpisodeKey(season, episode) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

let diskShowsCache = null;

// Invalidate the whole-library disk cache (called by the file watcher on change).
export function invalidateDiskCache() {
  diskShowsCache = null;
}

// Set one show's cached disk info (no-op when the cache isn't populated).
export function setDiskCacheEntry(showName, diskInfo) {
  if (diskShowsCache) {
    diskShowsCache[showName] = diskInfo;
    unilog(81, `updated cache for ${showName}`);
  }
}

// Drop one show from the cache (e.g. its folder was deleted).
export function deleteDiskCacheEntry(showName) {
  if (diskShowsCache && showName in diskShowsCache) {
    delete diskShowsCache[showName];
    unilog(82, `removed ${showName} from cache (no disk info)`);
  }
}

// Surgically refresh one show in the cache after a file add; full invalidate on error.
export async function updateDiskCacheForShow(showName) {
  if (!diskShowsCache) return;
  try {
    const showInfo = await getShowDiskInfo(showName);
    if (showInfo) {
      diskShowsCache[showName] = showInfo;
      unilog(89, `updated cache for ${showName}`);
    }
  } catch (err) {
    unilog(681, `failed to update cache for ${showName}:`, err.message);
    diskShowsCache = null;
  }
}

export const getShowsFromDisk = async (_params) => {
  if (diskShowsCache) return diskShowsCache;
  let errFlg = null;
  const shows = {};

  let maxDate, totalSize;
  let episodesBySeason;
  let fileQuality;
  let showFolderName;

  const recurs = async (path) => {
    if (errFlg || path == tvDir + "/.stfolder") return;
    try {
      const fstat = await fsp.stat(path);
      if (fstat.isDirectory()) {
        const dir = await fsp.readdir(path);
        for (const dirent of dir) await recurs(path + "/" + dirent);
        return;
      }
      const sfx = path.split(".").pop();
      if (videoFileExtensions.includes(sfx)) {
        const date = fmtDateWithTZ(fstat.mtime);
        maxDate = Math.max(maxDate, date);
        const fname = path.split("/").pop();
        const folderName = path.split("/").slice(-2, -1)[0];
        const parsed = parseFileSeasonEpisode(fname, folderName);
        if (
          parsed &&
          Number.isInteger(parsed.season) &&
          Number.isInteger(parsed.episode)
        ) {
          if (!episodesBySeason.has(parsed.season))
            episodesBySeason.set(parsed.season, new Set());
          episodesBySeason.get(parsed.season).add(parsed.episode);
          const ptt = parseTorrentTitle(fname.replace(/\.[a-z0-9]{2,4}$/i, ""));
          const title = parseTitleFromFilename(fname, folderName, ptt);
          const titleMatch =
            !title || !!smartTitleMatch(title, [showFolderName], null, true);
          const quality = getResolution(path, { probeFileFn: probeRawHeight });
          if (titleMatch && quality != null) {
            const epKey = toEpisodeKey(parsed.season, parsed.episode);
            const existing = fileQuality[epKey];
            if (!existing || quality > existing) fileQuality[epKey] = quality;
          }
        }
      }
      totalSize += fstat.size;
    } catch (err) {
      errFlg = err;
    }
  };

  const dir = await fsp.readdir(tvDir);
  for (const dirent of dir) {
    const showPath = tvDir + "/" + dirent;
    const fstat = await fsp.stat(showPath);
    const maxDate = fmtDateWithTZ(fstat.mtime);
    totalSize = 0;
    episodesBySeason = new Map();
    fileQuality = {};
    showFolderName = dirent;

    await recurs(showPath);

    const filesOnDisk = Array.from(episodesBySeason.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([season, epSet]) => [
        season,
        ...Array.from(epSet).sort((a, b) => a - b),
      ]);

    shows[dirent] = [maxDate, totalSize, filesOnDisk, fileQuality];
  }
  if (errFlg) {
    throw new Error(`getShowsFromDisk: Error: ${errFlg.message}`);
  } else {
    diskShowsCache = shows;
    return shows;
  }
};

/**
 * Extract the show name from an absolute video file path under tvDir.
 * Handles shows whose name contains a "/" (e.g. "Good Cop/Bad Cop") by
 * checking whether the two-segment prefix matches a known tvdb entry.
 */
export const showNameFromFilePath = (filePath) => {
  const rel = filePath.replace(tvDir + "/", "");
  const parts = rel.split("/");
  if (parts.length >= 2) {
    const twoSeg = parts[0] + "/" + parts[1];
    if (tvdb.getAllTvdbSync()[twoSeg]) return twoSeg;
  }
  return parts[0];
};

/**
 * Check disk for a single show folder
 * @param {string} showFolderName - The show folder name (e.g., "Breaking Bad")
 * @returns {Promise<[number, number, Array, Object, Object]|null>} - [maxDate, totalSize, filesOnDisk, fileQuality, diskByEp] or null if not found
 *   diskByEp: { [season]: { [episode]: { file, res, bif } } } — per-episode file name + resolution + bif-sidecar flag
 */
export const getShowDiskInfo = async (showFolderName) => {
  if (!showFolderName) return null;

  let maxDate = 0;
  let totalSize = 0;
  let errFlg = null;
  // Track which episodes are on disk: { season -> Set<episode> }
  const episodesBySeason = new Map();
  const fileQuality = {};
  // Per-episode file name + resolution: { [season]: { [episode]: { file, res } } }
  const diskByEp = {};
  // All .bif sidecar file names found (matched to video bases after the scan).
  const bifFiles = [];

  const recurs = async (dirPath) => {
    if (errFlg || dirPath == tvDir + "/.stfolder") return;
    try {
      const fstat = fs.statSync(dirPath);
      if (fstat.isDirectory()) {
        const dir = fs.readdirSync(dirPath);
        const folderName = path.basename(dirPath);
        for (const dirent of dir)
          await recurs(dirPath + "/" + dirent, folderName);
        return;
      }
      const sfx = dirPath.split(".").pop();
      if (sfx === "bif") {
        bifFiles.push(path.basename(dirPath));
        return;
      }
      if (videoFileExtensions.includes(sfx)) {
        const date = fmtDateWithTZ(fstat.mtime);
        if (!maxDate || date > maxDate) maxDate = date;
        totalSize += fstat.size;
        // Parse season/episode from filename + parent folder name
        const fname = path.basename(dirPath);
        const folderName = path.basename(path.dirname(dirPath));
        const parsed = parseFileSeasonEpisode(fname, folderName);
        if (
          parsed &&
          Number.isInteger(parsed.season) &&
          Number.isInteger(parsed.episode)
        ) {
          if (!episodesBySeason.has(parsed.season))
            episodesBySeason.set(parsed.season, new Set());
          episodesBySeason.get(parsed.season).add(parsed.episode);
          const ptt = parseTorrentTitle(fname.replace(/\.[a-z0-9]{2,4}$/i, ""));
          const title = parseTitleFromFilename(fname, folderName, ptt);
          const titleMatch =
            !title || !!smartTitleMatch(title, [showFolderName], null, true);
          const quality = getResolution(dirPath, {
            probeFileFn: probeRawHeight,
          });
          if (titleMatch) {
            if (quality != null) {
              const epKey = toEpisodeKey(parsed.season, parsed.episode);
              const existing = fileQuality[epKey];
              if (!existing || quality > existing) fileQuality[epKey] = quality;
            }
            // Track per-episode file name; prefer the higher-resolution file.
            if (!diskByEp[parsed.season]) diskByEp[parsed.season] = {};
            const cur = diskByEp[parsed.season][parsed.episode];
            if (!cur || (quality != null && quality > (cur.res ?? 0))) {
              diskByEp[parsed.season][parsed.episode] = {
                file: fname,
                res: quality ?? null,
              };
            }
          }
        }
      }
    } catch (err) {
      errFlg = err;
    }
  };

  try {
    const showPath = tvDir + "/" + showFolderName;
    const fstat = fs.statSync(showPath);
    maxDate = fmtDateWithTZ(fstat.mtime);

    await recurs(showPath);

    if (errFlg) {
      unilog(545, `Error for ${showFolderName}:`, errFlg.message);
      return null;
    }

    // Match .bif sidecars to episodes: a bif belongs to a video when its name
    // starts with the video file's base name (name without the final extension).
    if (bifFiles.length > 0) {
      for (const eps of Object.values(diskByEp)) {
        for (const info of Object.values(eps)) {
          const base = info.file.replace(/\.[^.]+$/, "");
          if (base && bifFiles.some((bn) => bn.startsWith(base))) {
            info.bif = 1;
          }
        }
      }
    }

    // Encode filesOnDisk in same format as watchedEpis: [[season, ep1, ep2, ...], ...]
    const filesOnDisk = Array.from(episodesBySeason.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([season, epSet]) => [
        season,
        ...Array.from(epSet).sort((a, b) => a - b),
      ]);

    return [maxDate, totalSize, filesOnDisk, fileQuality, diskByEp];
  } catch (err) {
    // Show folder doesn't exist or not accessible
    return null;
  }
};

// Single authoritative refresh of rec.episodeData from the three sources:
// TVDB (aired), Emby (watched + episode id), disk scan (file name + resolution).
// `opts.sources` limits which sources run.
export async function refreshEpisodeData(showName, rec, opts = {}) {
  const sources = opts.sources || ["tvdb", "emby", "disk"];
  if (!Array.isArray(rec.episodeData)) rec.episodeData = [];
  const ed = rec.episodeData;

  const folder = showName.includes("/")
    ? showName
    : (rec.path || rec.emby?.path || showName).split("/").pop();
  const folderDiffers = folder !== showName;

  // 1. TVDB aired dates — adds slots for every aired episode.
  let tvdbMap = null;
  if (sources.includes("tvdb") && rec.tvdbId) {
    try {
      tvdbMap = await tvdb.getSeriesMap(rec.tvdbId, null);
      for (const [seasonNum, episodes] of tvdbMap || []) {
        if (!Number.isInteger(seasonNum)) continue;
        for (const [epNum, epData] of episodes) {
          if (!Number.isInteger(epNum) || epNum < 1) continue;
          if (epData?.aired)
            epd.setEpisode(ed, seasonNum, epNum, { aired: epData.aired });
        }
      }
    } catch (e) {
      unilog(30, `tvdb ${showName}: ${e.message}`);
    }
  }

  // 2. Emby watched flag + episode id (in-emby shows only).
  if (sources.includes("emby") && rec.inEmby && rec.id) {
    try {
      const embyMap = await emby.getSeriesMap({
        id: rec.id,
        name: showName,
        tvdbId: rec.tvdbId,
      });
      for (const [seasonNum, episodes] of embyMap || []) {
        if (!Number.isInteger(seasonNum)) continue;
        for (const [epNum, ep] of episodes) {
          if (!Number.isInteger(epNum) || epNum < 1) continue;
          epd.setEpisode(ed, seasonNum, epNum, {
            watched: !!ep.played,
            id: ep.id ? Number(ep.id) : 0,
            pos: ep.pos || 0,
          });
        }
      }
    } catch (e) {
      unilog(31, `emby ${showName}: ${e.message}`);
    }
  }

  // 3. Disk scan — authoritative file name + resolution, plus date/size/noFiles.
  if (sources.includes("disk")) {
    try {
      const diskInfo = await getShowDiskInfo(folder);
      if (diskInfo) {
        const [newDate, newSize, , , diskByEp] = diskInfo;
        rec.date = newDate;
        rec.size = newSize;
        rec.noFiles = false;
        // Clear files for episodes no longer present on disk.
        epd.forEachEpisode(ed, (s, e) => {
          if (epd.hasFile(ed, s, e) && !diskByEp[s]?.[e])
            epd.clearFile(ed, s, e);
        });
        for (const [sStr, eps] of Object.entries(diskByEp || {})) {
          const s = Number(sStr);
          for (const [eStr, info] of Object.entries(eps)) {
            const e = Number(eStr);
            const fileVal = folderDiffers
              ? `${folder}//${info.file}`
              : info.file;
            epd.setEpisode(ed, s, e, {
              file: fileVal,
              res: info.res,
              bif: info.bif ? 1 : 0,
            });
          }
        }
      } else if (!rec.noFiles) {
        rec.noFiles = true;
        rec.date = null;
        rec.size = 0;
        // No folder on disk: clear all files.
        epd.forEachEpisode(ed, (s, e) => {
          if (epd.hasFile(ed, s, e)) epd.clearFile(ed, s, e);
        });
      }
    } catch (e) {
      unilog(32, `disk ${showName}: ${e.message}`);
    }
  }

  // Shows not in Emby never keep files — drop id/file/res, keep aired/watched.
  if (!rec.inEmby) epd.stripToAiredWatched(ed);

  // Derived record fields.
  rec.quality = epd.computeQuality(ed) ?? null;
  rec.watchedCount = epd.countWatched(ed);

  // seasonPremiereDates: first time only, from TVDB map (month of episode 1).
  if (!rec.seasonPremiereDates && Array.isArray(tvdbMap)) {
    const spd = {};
    for (const [seasonNum, episodes] of tvdbMap) {
      const sorted = [...episodes].sort((a, b) => Number(a[0]) - Number(b[0]));
      const first = sorted.find(([n]) => Number(n) === 1) || sorted[0];
      if (first?.[1]?.aired) {
        spd[String(seasonNum)] = first[1].aired.slice(0, 7).replace("-", "/");
      }
    }
    if (Object.keys(spd).length > 0) rec.seasonPremiereDates = spd;
  }

  // waitStr recompute now that aired/watched/files are fresh.
  const freshWaitStr = tvdb.calculateWaitStr(ed);
  if (freshWaitStr !== null) rec.waitStr = freshWaitStr || null;

  // episodeData supersedes these legacy per-episode props.
  delete rec.watchedEpis;
  delete rec.filesOnDisk;
  delete rec.fileQuality;
  delete rec.episodeAiredDates;

  return ed;
}
