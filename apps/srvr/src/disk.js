// Disk domain: scans the tv media tree for shows/episodes (files, resolution),
// builds Emby tvshow.nfo, and performs the authoritative
// refresh of a record's episodeData from TVDB + Emby + disk. Owns the
// whole-library disk cache (invalidated by the file watcher) and the
// ffprobe-height cache.

import fs from "fs";
import fsp from "fs/promises";
import * as cp from "child_process";
import * as path from "node:path";
import { unilog, logHere } from "@tv/share";
import {
  parseFileSeasonEpisode,
  parseTitleFromFilename,
  smartTitleMatch,
  getResolution,
} from "@tv/share";
import * as epd from "@tv/share";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import * as tvdb from "./tvdb.js";
import { showFolderFor, folderToRecord } from "./showPaths.js";
import * as emby from "./emby.js";
import * as util from "./util.js";
import { videoFileExtensions } from "./videoFiles.js";

const tvDir = "/mnt/media/tv";

// Dot-directories in the media tree hold work in progress, not library files:
// rsync's .rsync-tmp-<pid> staging dirs hold partial copies under their final
// names, and a scan that walked into one recorded the episode as if the file
// already sat in its Season folder — a path that 404s until the copy lands.
function isHiddenName(name) {
  return name.startsWith(".");
}

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
  if (!utcOut) return util.toPstDateTimeMs(date);
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

const MAX_PROBED_RAW_HEIGHT_CACHE = 10000;
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

  if (probedRawHeightByPath.size >= MAX_PROBED_RAW_HEIGHT_CACHE) {
    const oldestKey = probedRawHeightByPath.keys().next().value;
    if (oldestKey !== undefined) probedRawHeightByPath.delete(oldestKey);
  }
  probedRawHeightByPath.set(filePath, h);
  return h;
}

// A probed height is already persisted in the record's episodeData (res slot)
// next to the file it came from, so reuse it instead of running ffprobe again.
// probedRawHeightByPath is empty after a restart; without this, every file whose
// name carries no <N>p tag gets re-probed, and execFileSync stalls the server.
const savedRes = (ed, season, episode, fname) =>
  ed && epd.getFileName(ed, season, episode) === fname
    ? epd.getRes(ed, season, episode)
    : null;

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
  let showEpisodeData;

  const recurs = async (path) => {
    if (errFlg || path == tvDir + "/.stfolder") return;
    try {
      const fstat = await fsp.stat(path);
      if (fstat.isDirectory()) {
        const dir = await fsp.readdir(path);
        for (const dirent of dir) {
          if (isHiddenName(dirent)) continue;
          await recurs(path + "/" + dirent);
        }
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
          const quality =
            savedRes(showEpisodeData, parsed.season, parsed.episode, fname) ??
            getResolution(path, { probeFileFn: probeRawHeight });
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

  const folderIndex = folderToRecord();
  const dir = await fsp.readdir(tvDir);
  for (const dirent of dir) {
    if (isHiddenName(dirent)) continue;
    const showPath = tvDir + "/" + dirent;
    const fstat = await fsp.stat(showPath);
    const maxDate = fmtDateWithTZ(fstat.mtime);
    totalSize = 0;
    episodesBySeason = new Map();
    fileQuality = {};
    showFolderName = dirent;
    showEpisodeData = folderIndex.get(dirent)?.rec?.episodeData ?? null;

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
 * Check disk for a single show folder
 * @param {string} showFolderName - The show folder name (e.g., "Breaking Bad")
 * @returns {Promise<[number, number, Array, Object, Object]|null>} - [maxDate, totalSize, filesOnDisk, fileQuality, diskByEp] or null if not found
 *   diskByEp: { [season]: { [episode]: { file, res } } } — per-episode file name + resolution
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
  // Read before the caller overwrites it, so already-probed files keep their res.
  const showEpisodeData =
    folderToRecord().get(showFolderName)?.rec?.episodeData ?? null;

  const recurs = async (dirPath) => {
    if (errFlg || dirPath == tvDir + "/.stfolder") return;
    try {
      const fstat = fs.statSync(dirPath);
      if (fstat.isDirectory()) {
        const dir = fs.readdirSync(dirPath);
        const folderName = path.basename(dirPath);
        for (const dirent of dir) {
          if (isHiddenName(dirent)) continue;
          await recurs(dirPath + "/" + dirent, folderName);
        }
        return;
      }
      const sfx = dirPath.split(".").pop();
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
          const quality =
            savedRes(showEpisodeData, parsed.season, parsed.episode, fname) ??
            getResolution(dirPath, {
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

  const folder = showFolderFor(showName, rec);
  const folderDiffers = folder !== showName;

  // Episodes each source vouched for this pass, as "<season>.<episode>" keys,
  // plus a per-source ok flag. Together they decide which slots are ghosts —
  // see the prune step below.
  const seen = new Set();
  let tvdbOk = false;
  let embyOk = false;
  let diskOk = false;

  // 1. TVDB aired dates — adds slots for every aired episode.
  let tvdbMap = null;
  if (sources.includes("tvdb") && rec.tvdbId) {
    try {
      tvdbMap = await tvdb.getSeriesMap(rec.tvdbId, null);
      for (const [seasonNum, episodes] of tvdbMap || []) {
        if (!Number.isInteger(seasonNum)) continue;
        for (const [epNum, epData] of episodes) {
          if (!Number.isInteger(epNum) || epNum < 1) continue;
          // Vouch for every episode TVDB lists, even undated ones that get no
          // slot written here — otherwise the prune would treat them as ghosts.
          seen.add(`${seasonNum}.${epNum}`);
          if (epData?.aired)
            epd.setEpisode(ed, seasonNum, epNum, { aired: epData.aired });
        }
      }
      tvdbOk =
        Array.isArray(tvdbMap) && tvdbMap.length > 0 && !tvdbMap.partial;
    } catch (e) {
      unilog(30, `tvdb ${showName}: ${e.message}`);
    }
  }

  // 2. Emby watched flag + episode id (in-emby shows only).
  let embyMs = 0;
  if (sources.includes("emby") && rec.inEmby && rec.id) {
    const embyStart = Date.now();
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
          seen.add(`${seasonNum}.${epNum}`);
          epd.setEpisode(ed, seasonNum, epNum, {
            watched: !!ep.played,
            id: ep.id ? Number(ep.id) : 0,
            pos: ep.pos || 0,
          });
        }
      }
      // getSeriesMap returns null on a non-200, which correctly reads as
      // "Emby data not available" rather than "Emby has no episodes".
      embyOk = Array.isArray(embyMap);
    } catch (e) {
      unilog(31, `emby ${showName}: ${e.message}`);
    }
    embyMs = Date.now() - embyStart;
  }

  // 3. Disk scan — authoritative file name + resolution, plus date/size/noFiles.
  let diskMs = 0;
  if (sources.includes("disk")) {
    const diskStart = Date.now();
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
            seen.add(`${s}.${e}`);
            epd.setEpisode(ed, s, e, {
              file: fileVal,
              res: info.res,
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
      // A null diskInfo means the folder is genuinely absent, which is just as
      // authoritative as a successful scan — both vouch for zero extra files.
      diskOk = true;
    } catch (e) {
      unilog(32, `disk ${showName}: ${e.message}`);
    }
    diskMs = Date.now() - diskStart;
  }

  // Slow-path diagnostic: the map pane refresh (sources emby+disk) has been
  // seen taking several seconds; log the breakdown when a single refresh is
  // slow so the culprit phase is captured without flooding the periodic sweep.
  if (embyMs + diskMs > 1500) {
    unilog(1519, `slow refreshEpisodeData ${showName}: emby=${embyMs}ms disk=${diskMs}ms sources=${sources.join("+")}`);
  }

  // Shows not in Emby never keep files — drop id/file/res, keep aired/watched.
  if (!rec.inEmby) epd.stripToAiredWatched(ed);

  // Prune ghost episodes: slots left behind by an episode that has since
  // vanished from Emby (or TVDB), which nothing else ever removed. Only safe
  // when every source ran and answered — a TVDB outage or an Emby non-200
  // would leave `seen` short and eat real episodes. Shows out of Emby prune on
  // TVDB + disk alone, since Emby contributes nothing to them by definition.
  const allSources = ["tvdb", "emby", "disk"].every((s) => sources.includes(s));
  const embyVouched = rec.inEmby ? embyOk : true;
  if (allSources && tvdbOk && embyVouched && diskOk) {
    const ghosts = epd.pruneGhosts(ed, seen);
    if (ghosts.length > 0) {
      const list = ghosts
        .map(
          ({ season, episode }) =>
            `s${String(season).padStart(2, "0")}e${String(episode).padStart(2, "0")}`,
        )
        .join(" ");
      unilog(1939, `pruned ${ghosts.length} ghost episode(s) from ${showName}: ${list}`);
    }
  }

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
