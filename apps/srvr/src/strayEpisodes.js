// Stray episode files: files on disk for episodes TVDB never gave an air date
// to. The gap check flags them per show (see getShowState in emby.js); this
// module decides what, if anything, to do about them.
//
// Three different problems produce a stray, and they need opposite handling:
//
//   * A misfiled show. A whole release of some other series sits in this
//     show's folder, so Emby invented episode slots from files that were never
//     this show's -- a 10-episode DVDRip posing as Guilt (2019)'s 4-episode
//     season 1. The tell is that the release carries MORE episodes than the
//     season has. The fix is to move the entire release out, including the
//     files that happen to land on real episode numbers: leaving those behind
//     is worse than doing nothing, because they then look like legitimate
//     episodes of a show they do not belong to.
//
//   * An episode-numbering offset. One legitimate release numbered on a
//     different scheme, so its tail runs past the end of the season -- Get
//     Smart's DVD rip numbering S1 as E09-E36 against TVDB's 30 episodes.
//     These ARE the show's episodes. Nothing may be moved; the numbering is
//     what is wrong.
//
//   * TVDB lag. A just-downloaded episode whose air date has not been
//     published yet. Self-correcting, so it is left alone.
//
// The release size test separates the first from the other two, and the age
// test keeps a fresh download from ever being touched.
//
// Nothing is deleted -- files are moved to /mnt/media/tv-errors/, where down
// already parks files it could not place, and a name already taken there is
// left alone rather than overwritten.

import fs from "fs";
import * as path from "node:path";
import * as epd from "@tv/share";
import * as tvdb from "./tvdb.js";
import { showFolderFor } from "./showPaths.js";
import { resIsVideoName, resIsSampleName } from "./videoFiles.js";

const TV_DIR = "/mnt/media/tv";
const TV_ERRORS_DIR = "/mnt/media/tv-errors";

// A file this new could still be waiting on TVDB to publish its air date.
const STRAY_MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// How far a release has to overshoot the season before it is called a
// different show rather than a numbering quirk. `airedInSeason` counts only
// the slots TVDB has dated, and TVDB is routinely missing dates for recent or
// obscure episodes, so a release running a few past the count means nothing:
// Rebus (6 files, 4 dated) and Get Smart S2 (33 files, 30 dated) are both the
// real show. A misfiled one overshoots by a lot -- Guilt's 10-episode DVDRip
// against a 4-episode season. Both tests must pass.
const STRAY_RELEASE_RATIO = 2;
const STRAY_RELEASE_EXCESS = 3;

// PST stamp for the lasting note left on the record.
export function strayStamp(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("month")}-${get("day")} ${hour}:${get("minute")}`;
}

// Files of one release share everything but their SxxExx token, so dropping
// that token turns a filename into an identity for the release it came from.
function releaseKeyOf(name) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[.\-_ ]?[Ss]\d{1,2}[Ee]\d{1,3}[.\-_ ]?/, "|")
    .toLowerCase();
}

// Every file that belongs to one video: the video itself plus the sidecars
// carrying its basename (".en.srt", ".asr.srt", ".nfo", "-thumb.jpg", ...).
function siblingsOf(seasonDir, videoName) {
  const base = videoName.replace(/\.[^.]+$/, "");
  try {
    return fs.readdirSync(seasonDir).filter((n) => n.startsWith(base));
  } catch {
    return [];
  }
}

function videosIn(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter(
        (n) => !n.startsWith(".") && resIsVideoName(n) && !resIsSampleName(n),
      );
  } catch {
    return [];
  }
}

// How many episodes TVDB actually aired for a season. Slots Emby invented from
// the stray files themselves carry no air date, so they do not count.
function airedInSeason(ed, season) {
  const arr = ed?.[season];
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (epd.getAired(ed, season, i + 1)) n++;
  }
  return n;
}

/**
 * What would be quarantined for one record and why.
 * Returns { showName, folder, ok, reason, releases, files }, where `releases`
 * describes every release holding a stray -- moved or not -- so the report
 * explains the ones it declines as well as the ones it takes.
 */
export function planStrayQuarantine(showName, rec) {
  const ed = rec?.episodeData;
  const folder = showFolderFor(showName, rec);
  const base = {
    showName,
    folder,
    ok: false,
    reason: "",
    releases: [],
    files: [],
  };
  if (!Array.isArray(ed)) return { ...base, reason: "no episodeData" };

  const showDir = path.join(TV_DIR, folder);

  // Which episodes are stray, by season.
  const strayBySeason = new Map();
  epd.forEachEpisode(ed, (s, e) => {
    if (!epd.hasFile(ed, s, e) || epd.getAired(ed, s, e)) return;
    const name = epd.getFileName(ed, s, e);
    if (!name) return;
    if (!strayBySeason.has(s)) strayBySeason.set(s, new Set());
    strayBySeason.get(s).add(path.basename(name));
  });
  if (strayBySeason.size === 0) return { ...base, reason: "no stray files" };

  const releases = [];
  const files = [];

  for (const [season, strayNames] of strayBySeason) {
    const seasonDir = path.join(showDir, `Season ${season}`);
    const aired = airedInSeason(ed, season);

    // Group every video in the season by its release, so a release can be
    // judged whole rather than by the handful of files that tripped the flag.
    const byRelease = new Map();
    for (const name of videosIn(seasonDir)) {
      const key = releaseKeyOf(name);
      if (!byRelease.has(key)) byRelease.set(key, []);
      byRelease.get(key).push(name);
    }

    for (const [key, names] of byRelease) {
      const strays = names.filter((n) => strayNames.has(n));
      if (strays.length === 0) continue;

      const info = {
        season,
        release: key,
        episodes: names.length,
        strays: strays.length,
        airedInSeason: aired,
        move: false,
        reason: "",
      };

      if (aired === 0) {
        info.reason = `season has no aired episodes on TVDB yet — nothing to judge against`;
      } else if (
        names.length < aired * STRAY_RELEASE_RATIO ||
        names.length - aired < STRAY_RELEASE_EXCESS
      ) {
        info.reason = `release has ${names.length} episode(s) for a ${aired}-episode season — not enough of an overshoot to be a different show, so these are treated as this show's episodes under odd numbering`;
      } else {
        const tooNew = names.find((n) => {
          try {
            return (
              Date.now() - fs.statSync(path.join(seasonDir, n)).mtimeMs <
              STRAY_MIN_AGE_MS
            );
          } catch {
            return true;
          }
        });
        if (tooNew) {
          info.reason = `release has a recent file ("${tooNew}") — TVDB may still catch up`;
        } else {
          info.move = true;
          info.reason = `release has ${names.length} episode(s) for a ${aired}-episode season — far too many to be this show`;
          for (const n of names) {
            for (const f of siblingsOf(seasonDir, n)) {
              files.push({ season, seasonDir, name: f });
            }
          }
        }
      }
      releases.push(info);
    }
  }

  const moving = releases.filter((r) => r.move);
  return {
    ...base,
    ok: files.length > 0,
    reason: (moving.length ? moving : releases).map((r) => r.reason).join("; "),
    releases,
    files,
  };
}

/** Move a plan's files under /mnt/media/tv-errors/<folder>/Season N/. */
export function executeStrayQuarantine(plan) {
  const moved = [];
  const skipped = [];
  for (const { season, seasonDir, name } of plan.files) {
    const dstDir = path.join(TV_ERRORS_DIR, plan.folder, `Season ${season}`);
    fs.mkdirSync(dstDir, { recursive: true });
    const src = path.join(seasonDir, name);
    const dst = path.join(dstDir, name);
    if (fs.existsSync(dst)) {
      skipped.push(name);
      continue;
    }
    fs.renameSync(src, dst);
    moved.push(name);
  }
  return {
    moved,
    skipped,
    videos: moved.filter((n) => resIsVideoName(n)).length,
  };
}

/** Every flagged show, planned. `onlyShow` limits it to one record. */
export function planAllStrayQuarantines(onlyShow = null) {
  const all = tvdb.getAllTvdbSync() || {};
  const out = [];
  for (const [name, rec] of Object.entries(all)) {
    if (onlyShow && name !== onlyShow) continue;
    if (!rec?.stray) continue;
    out.push(planStrayQuarantine(name, rec));
  }
  return out;
}
