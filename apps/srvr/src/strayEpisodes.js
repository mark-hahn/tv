// Stray episode files: files on disk for episodes TVDB never gave an air date
// to. The gap check flags them per show (see getShowState in emby.js); this
// module decides what, if anything, to do about them.
//
// The flag alone cannot tell you what is wrong, because several unrelated
// situations produce exactly the same signal -- a slot with a file and no air
// date -- and they want opposite handling:
//
//   * a whole release of a DIFFERENT series sitting in this show's folder,
//     which must be moved out entirely;
//   * DVD extras and featurettes numbered as episodes past the end of a
//     season, where only the extras should move;
//   * legitimate episodes of this show numbered on another scheme, or whose
//     air date TVDB has simply not published yet, which must not be touched.
//
// What separates them is not the filename and not TVDB's metadata: it is how
// long the file runs. An episode of this show runs about as long as this
// show's other episodes. So every candidate is measured against the median
// runtime of the episodes TVDB HAS dated for this same show -- a baseline
// taken from the show's own files, because TVDB's `averageRuntime` is not
// reliable enough to judge against (Rebus records 78 minutes for episodes that
// actually run 47).
//
// Judging a release as a unit is wrong. Get Smart's DVD rip carries 21 real
// 25-minute episodes and three 5-to-10-minute extras in one release, acquired
// in a single 12-minute transfer, so condemning the release would throw away
// the show. The release still matters for one decision though: if the files
// that land on DATED episodes are themselves the wrong length, the release is
// not this show at all and the whole thing goes, including the files that
// happen to sit on real episode numbers. Leaving those behind is worse than
// doing nothing -- they then look like legitimate episodes of a show they do
// not belong to.
//
// Nothing is deleted -- files are moved to /mnt/media/tv-errors/, where down
// already parks files it could not place, and a name already taken there is
// left alone rather than overwritten.

import fs from "fs";
import * as cp from "child_process";
import * as path from "node:path";
import * as epd from "@tv/share";
import { parseFileSeasonEpisode } from "@tv/share";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import * as tvdb from "./tvdb.js";
import { showFolderFor } from "./showPaths.js";
import { resIsVideoName, resIsSampleName } from "./videoFiles.js";

const TV_DIR = "/mnt/media/tv";
const TV_ERRORS_DIR = "/mnt/media/tv-errors";

// How far a file's runtime may sit from the season's own median before it
// stops looking like an episode of this show.
const RUNTIME_TOLERANCE = 0.2;
// A median taken from fewer episodes than this is not worth trusting.
const RUNTIME_MIN_SAMPLE = 3;
// A season whose own dated episodes vary by more than this is not a usable
// yardstick -- something in it is already irregular, so nothing is judged
// against it.
const RUNTIME_MAX_SPREAD = 1.6;

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

// Probing is only ever done for a flagged show's own files, so the cache is
// small and lives for the process. Keyed on size+mtime so a replaced file is
// re-measured.
const runtimeCache = new Map();

export function probeRuntimeMin(filePath) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    return null;
  }
  const key = `${filePath}|${st.size}|${st.mtimeMs}`;
  if (runtimeCache.has(key)) return runtimeCache.get(key);

  let mins = null;
  try {
    const out = cp
      .execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "csv=p=0",
          String(filePath),
        ],
        { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30000 },
      )
      .trim();
    const secs = Number.parseFloat(out);
    if (Number.isFinite(secs) && secs > 0) mins = secs / 60;
  } catch {
    mins = null;
  }
  runtimeCache.set(key, mins);
  return mins;
}

const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// A release's identity, from the group tag where the name carries one and the
// SxxExx-stripped name otherwise. `S01E15.mp4` carries neither, so it groups
// alone rather than colliding with every other bare-numbered file.
export function releaseKeyOf(name) {
  const stem = name.replace(/\.[^.]+$/, "");
  let group = null;
  try {
    group = parseTorrentTitle(stem)?.group || null;
  } catch {
    group = null;
  }
  const stripped = stem
    .replace(/[.\-_ ]?[Ss]\d{1,2}[Ee]\d{1,3}[.\-_ ]?/, "|")
    .toLowerCase();
  if (group) return `${group.toLowerCase()}|${stripped.split("|")[0]}`;
  return stripped === "|" ? `solo:${stem.toLowerCase()}` : stripped;
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

const seasonDirsOf = (showDir) => {
  try {
    return fs
      .readdirSync(showDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return [];
  }
};

const seasonNumOf = (seasonDir) => {
  const m = /(\d+)/.exec(seasonDir);
  return m ? Number(m[1]) : null;
};

/**
 * Every video in the show's folder, tagged with the episode it claims, whether
 * TVDB dated that episode, its release, and how long it runs.
 */
function surveyShowFiles(showDir, ed) {
  const out = [];
  for (const seasonDir of seasonDirsOf(showDir)) {
    const season = seasonNumOf(seasonDir);
    if (season == null) continue;
    for (const name of videosIn(path.join(showDir, seasonDir))) {
      const parsed = parseFileSeasonEpisode(name, seasonDir);
      const episode = parsed?.episode;
      if (parsed?.season == null || episode == null) continue;
      out.push({
        seasonDir,
        seasonDirPath: path.join(showDir, seasonDir),
        name,
        season: parsed.season,
        episode,
        dated: !!epd.getAired(ed, parsed.season, episode),
        release: releaseKeyOf(name),
        runtime: null,
      });
    }
  }
  return out;
}

/**
 * What would be quarantined for one record and why.
 * Returns { showName, folder, ok, reason, baseline, releases, files }.
 */
export function planStrayQuarantine(showName, rec) {
  const ed = rec?.episodeData;
  const folder = showFolderFor(showName, rec);
  const base = {
    showName,
    folder,
    ok: false,
    reason: "",
    baseline: null,
    releases: [],
    files: [],
  };
  if (!Array.isArray(ed)) return { ...base, reason: "no episodeData" };

  const showDir = path.join(TV_DIR, folder);
  const survey = surveyShowFiles(showDir, ed);
  if (!survey.some((f) => !f.dated)) {
    return { ...base, reason: "no stray files" };
  }

  // Baseline: how long this show's episodes actually run, measured from the
  // ones TVDB has dated -- PER SEASON, never across the show. A folder can
  // legitimately hold two eras of the same title (Rebus keeps a 46-minute
  // 2024 series next to a 68-minute 2000s one under one record), and a
  // show-wide median matches neither, condemning whichever era is shorter.
  const datedFiles = survey.filter((f) => f.dated);
  for (const f of datedFiles) {
    f.runtime = probeRuntimeMin(path.join(f.seasonDirPath, f.name));
  }
  const baselines = new Map();
  const seasonSkips = [];
  for (const season of new Set(survey.map((f) => f.season))) {
    const runs = datedFiles
      .filter((f) => f.season === season && f.runtime != null)
      .map((f) => f.runtime);
    if (runs.length < RUNTIME_MIN_SAMPLE) {
      seasonSkips.push(
        `S${season}: only ${runs.length} dated episode(s) to measure — no baseline`,
      );
      continue;
    }
    const spread = Math.max(...runs) / Math.min(...runs);
    if (spread > RUNTIME_MAX_SPREAD) {
      seasonSkips.push(
        `S${season}: its own episodes run ${Math.round(Math.min(...runs))}-${Math.round(Math.max(...runs))} min — too irregular to judge against`,
      );
      continue;
    }
    baselines.set(season, median(runs));
  }
  if (baselines.size === 0) {
    return {
      ...base,
      reason:
        seasonSkips.join("; ") || "no season has a usable runtime baseline",
    };
  }

  const offBy = (f) => {
    const b = baselines.get(f.season);
    if (b == null || f.runtime == null) return null;
    return Math.abs(f.runtime - b) / b;
  };
  const wrongLength = (f) => {
    const d = offBy(f);
    return d != null && d > RUNTIME_TOLERANCE;
  };
  const baselineFor = (f) => baselines.get(f.season) ?? null;

  const files = [];
  const releases = [];
  const byRelease = new Map();
  for (const f of survey) {
    if (!byRelease.has(f.release)) byRelease.set(f.release, []);
    byRelease.get(f.release).push(f);
  }

  for (const [release, group] of byRelease) {
    const strays = group.filter((f) => !f.dated);
    if (strays.length === 0) continue;
    for (const f of group) {
      if (f.runtime == null)
        f.runtime = probeRuntimeMin(path.join(f.seasonDirPath, f.name));
    }

    // Only files in a season that has a usable baseline can be judged at all.
    const judgeable = group.filter((f) => baselineFor(f) != null);
    const anchored = judgeable.filter((f) => f.dated && f.runtime != null);
    // The release's own anchored files are the wrong length for the seasons
    // they sit in: this release is not this show, so all of it goes -- the
    // files on real episode numbers included.
    const badAnchors = anchored.filter((f) => wrongLength(f)).length;
    const foreign = anchored.length > 0 && badAnchors > anchored.length / 2;
    const doomed = foreign
      ? group
      : strays.filter((f) => baselineFor(f) != null && wrongLength(f));

    const seasons = [...new Set(group.map((f) => f.season))].sort(
      (a, b) => a - b,
    );
    const shown = seasons
      .map((s) =>
        baselines.has(s) ? `S${s} ${Math.round(baselines.get(s))}` : null,
      )
      .filter(Boolean)
      .join(", ");

    const info = {
      release,
      seasons,
      episodes: group.length,
      strays: strays.length,
      foreign,
      moving: doomed.length,
      runtimes: strays.map((f) => ({
        name: f.name,
        season: f.season,
        episode: f.episode,
        min: f.runtime == null ? null : Math.round(f.runtime * 10) / 10,
        offPct: offBy(f) == null ? null : Math.round(offBy(f) * 100),
        move: doomed.includes(f),
      })),
      reason: "",
    };

    if (foreign) {
      info.reason = `${badAnchors} of ${anchored.length} of this release's dated episodes are the wrong length for their season (${shown} min) — the whole release is a different show`;
    } else if (doomed.length === 0) {
      info.reason = `every stray runs within ${Math.round(RUNTIME_TOLERANCE * 100)}% of its season (${shown} min) — these are this show's episodes, TVDB just has no air date for them`;
    } else {
      info.reason = `${doomed.length} file(s) run nowhere near their season (${shown} min) — extras or another show's files numbered as episodes`;
    }

    for (const f of doomed) {
      for (const s of siblingsOf(f.seasonDirPath, f.name)) {
        files.push({ season: f.season, seasonDir: f.seasonDirPath, name: s });
      }
    }
    releases.push(info);
  }

  const acting = releases.filter((r) => r.moving > 0);
  return {
    ...base,
    ok: files.length > 0,
    baseline: Object.fromEntries(
      [...baselines].map(([s, b]) => [s, Math.round(b * 10) / 10]),
    ),
    reason: [
      ...(acting.length ? acting : releases).map((r) => r.reason),
      ...seasonSkips,
    ].join("; "),
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

/**
 * The strays that survive the quarantine plan -- the files it looked at and
 * decided belong to this show. These are what an "accept" offers to silence,
 * computed from disk rather than from the record's own strayFiles, so it is
 * still right immediately after a quarantine has moved the rest.
 */
export function straysToAccept(showName, rec) {
  const plan = planStrayQuarantine(showName, rec);
  const out = [];
  for (const release of plan.releases || []) {
    for (const r of release.runtimes || []) {
      if (r.move) continue;
      out.push({
        key: `S${r.season}E${r.episode}`,
        season: r.season,
        episode: r.episode,
        name: r.name,
        min: r.min,
      });
    }
  }
  return out;
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
