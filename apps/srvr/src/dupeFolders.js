// Merging duplicate show folders.
//
// Emby can end up holding two Series items for one show, each pointing at its
// own folder -- a rename that left the old folder behind, or a release whose
// folder name drifted from the show's name. Both items carry the same tvdbId,
// so they collapse onto one tvdb record, and whichever the sweep visits last
// wins the record's `path`. Half the show is then invisible to everything that
// works from the record.
//
// This merges the folders when it can prove they hold one show, and refuses
// otherwise. Refusing is the safe outcome and is expected to be common: two
// folders sharing a tvdbId does NOT mean they hold the same show, only that
// Emby matched both to it -- Emby matches on the folder name, so a misfiled
// season of an entirely different show inherits its neighbour's identity.
//
// The proof required before anything moves:
//   * every video in the losing folder parses to a season/episode,
//   * every one of those is an episode TVDB actually aired for this show
//     (an episode slot with no air date means Emby invented it from the very
//     files being judged, which is the misfiled-show signature),
//   * nothing under the losing folder is still being written.
//
// An episode sitting in both folders is not a refusal: the two files are put
// through `flexgetIsBetterSameRun`, the same comparator flexget uses to choose
// between two candidates for one episode arriving in a single batch
// (resolution -> bit depth -> hevc -> seeds -> bad group). The loser is demoted
// to `.old` exactly as down does when a better release replaces a file already
// on disk, so one active video per episode survives and neither is lost.
//
// Nothing is ever overwritten and no video file is ever deleted: files are
// renamed across, and the losing folder is removed only once it is proven to
// hold no video at all.

import fs from "fs";
import * as path from "node:path";
import * as epd from "@tv/share";
import { parseFileSeasonEpisode } from "@tv/share";
import {
  resIsVideoName,
  resStripAlt,
  resFindEpisodeVideos,
} from "./videoFiles.js";
import { flexgetIsBetterSameRun } from "./flexgetScore.js";

const TV_DIR = "/mnt/media/tv";

// A video touched this recently may still be arriving, so its folder is left
// for a later sweep rather than moved out from under the writer.
const SETTLE_MS = 10 * 60 * 1000;

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const subDirs = (dir) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
};

// Dot-directories in the media tree hold work in progress (rsync's
// .rsync-tmp-<pid> staging dirs), so their presence means a copy is live.
const hasWorkInProgress = (showDir) =>
  subDirs(showDir).some((n) => n.startsWith("."));

// A scene "sample" clip sits next to the episode it was cut from and parses to
// the same season/episode, so counting one would both inflate a folder's size
// and make the episode look like it is already there twice.
const isSampleName = (name) =>
  /(^|[.\-_ ])sample([.\-_ ]|$)/i.test(name.replace(/\.[^.]+$/, ""));

const videosIn = (dir) => {
  try {
    return fs
      .readdirSync(dir)
      .filter(
        (n) => !n.startsWith(".") && resIsVideoName(n) && !isSampleName(n),
      );
  } catch {
    return [];
  }
};

// Every video anywhere under a show folder, as paths relative to it.
export function videosUnder(showDir) {
  const out = [];
  for (const seasonDir of subDirs(showDir)) {
    for (const name of videosIn(path.join(showDir, seasonDir))) {
      out.push(path.join(seasonDir, name));
    }
  }
  for (const name of videosIn(showDir)) out.push(name);
  return out;
}

// A filename is all flexgetIsBetterSameRun needs: it reads resolution and
// bit depth out of `quality`/`title` and the group out of `title`. Neither
// file came from a torrent run, so both score 0 seeds and that tier is a tie.
const asCandidate = (name) => ({ title: name, quality: name });

/**
 * Read a show folder as a list of episodes, and note anything that says the
 * folder does not hold this show.
 *
 * Every folder in a duplicate group gets audited, not just the ones due to be
 * moved: a folder that is going to *receive* files is making the same claim to
 * be this show, and if it is wrong the merge would bury the real show under a
 * misfiled one. Which folder ends up the winner is decided after this, so the
 * check cannot depend on the direction.
 */
export function auditShowFolder(folder, ed) {
  const showDir = path.join(TV_DIR, folder);
  const episodes = [];
  const problems = [];
  if (!isDir(showDir)) return { folder, showDir, episodes, problems: [] };

  for (const seasonDir of subDirs(showDir)) {
    for (const name of videosIn(path.join(showDir, seasonDir))) {
      const parsed = parseFileSeasonEpisode(resStripAlt(name), seasonDir);
      const season = parsed?.season;
      const episode = parsed?.episode;
      if (season == null || episode == null) {
        problems.push(`"${folder}/${seasonDir}/${name}" has no season/episode`);
        continue;
      }
      // An episode slot with no air date was not aired by TVDB for this show:
      // Emby invented it from this very file. That is the signature of a
      // different show sitting in a folder named like this one.
      if (!epd.getAired(ed, season, episode)) {
        problems.push(
          `"${folder}" holds S${season}E${episode} ("${name}"), which this show never aired`,
        );
        continue;
      }
      episodes.push({ seasonDir, name, season, episode });
    }
  }
  return { folder, showDir, episodes, problems };
}

/**
 * Decide whether `loserFolder` can be folded into `winnerFolder`. Both audits
 * come from `auditShowFolder` and must already be clean.
 *
 * Returns { ok, reason, moves, demotions } -- `moves` is per season directory
 * (empty when the losing folder holds nothing but artwork, which is still a
 * merge: the folder goes away), and `demotions` lists the files that lost the
 * same-episode comparison and will be renamed to `.old`.
 */
export function planFolderMerge(showName, winnerAudit, loserAudit) {
  const winnerFolder = winnerAudit.folder;
  const loserFolder = loserAudit.folder;
  const refuse = (reason) => ({
    showName,
    winnerFolder,
    loserFolder,
    ok: false,
    reason,
    moves: [],
    demotions: [],
  });

  if (!winnerFolder || !loserFolder || winnerFolder === loserFolder) {
    return refuse("not two distinct folders");
  }
  if (!isDir(winnerAudit.showDir)) {
    return refuse(`no folder "${winnerFolder}" on disk`);
  }
  if (!isDir(loserAudit.showDir)) {
    return refuse(`no folder "${loserFolder}" on disk`);
  }
  if (hasWorkInProgress(loserAudit.showDir)) {
    return refuse(`"${loserFolder}" has a copy in progress`);
  }

  const moves = [];
  const demotions = [];
  const bySeason = new Map();
  for (const ep of loserAudit.episodes) {
    if (!bySeason.has(ep.seasonDir)) bySeason.set(ep.seasonDir, []);
    bySeason.get(ep.seasonDir).push(ep);
  }

  for (const [seasonDir, eps] of bySeason) {
    const srcSeason = path.join(loserAudit.showDir, seasonDir);
    const dstSeason = path.join(winnerAudit.showDir, seasonDir);
    const arriveAsOld = new Set();
    for (const { name, season, episode } of eps) {
      // Same episode in both folders: settle it the way flexget settles two
      // candidates in one batch instead of refusing the whole merge. Whichever
      // file loses becomes `.old`, so exactly one stays active and neither is
      // thrown away.
      const rivals = resFindEpisodeVideos(dstSeason, season, episode).filter(
        (v) => !v.alt && !isSampleName(v.name),
      );
      if (rivals.length) {
        let best = rivals[0];
        for (const cur of rivals.slice(1)) {
          if (
            flexgetIsBetterSameRun(
              asCandidate(cur.name),
              asCandidate(best.name),
            )
          )
            best = cur;
        }
        if (flexgetIsBetterSameRun(asCandidate(name), asCandidate(best.name))) {
          for (const cur of rivals)
            demotions.push(path.join(dstSeason, cur.name));
        } else {
          arriveAsOld.add(name);
        }
      }
      try {
        const st = fs.statSync(path.join(srcSeason, name));
        if (Date.now() - st.mtimeMs < SETTLE_MS) {
          return refuse(`"${name}" was written in the last 10 min`);
        }
      } catch {
        return refuse(`"${name}" vanished while planning`);
      }
    }
    moves.push({
      seasonDir,
      srcSeason,
      dstSeason,
      arriveAsOld: [...arriveAsOld],
    });
  }

  return {
    showName,
    winnerFolder,
    loserFolder,
    ok: true,
    reason: "",
    moves,
    demotions,
  };
}

// Demoting never overwrites: `.old` is added until the name is free, which is
// the same rule down follows when a better release lands on top of a file.
function renameToOld(filePath) {
  let dst = filePath + ".old";
  while (fs.existsSync(dst)) dst += ".old";
  fs.renameSync(filePath, dst);
  return dst;
}

/**
 * Carry out a plan that came back ok.
 * Returns { moved, demoted, removed, leftBehind }. A file whose name is already
 * taken at the destination is left where it is rather than overwritten, which
 * in turn keeps the losing folder alive.
 */
export function executeFolderMerge(plan) {
  const loserDir = path.join(TV_DIR, plan.loserFolder);
  let moved = 0;
  const demoted = [];

  // Losers of a same-episode comparison step aside first, so the file moving in
  // is the only active video for that episode the moment it lands.
  for (const filePath of plan.demotions) {
    demoted.push(path.basename(renameToOld(filePath)));
  }

  for (const m of plan.moves) {
    // A season the winner does not have yet moves whole, in one rename. There
    // is nothing there to collide with, so nothing arrives as `.old`.
    if (!isDir(m.dstSeason)) {
      fs.renameSync(m.srcSeason, m.dstSeason);
      moved += videosIn(m.dstSeason).length;
      continue;
    }
    const asOld = new Set(m.arriveAsOld);
    for (const name of fs.readdirSync(m.srcSeason)) {
      const src = path.join(m.srcSeason, name);
      let dst = path.join(m.dstSeason, name);
      if (asOld.has(name)) {
        dst += ".old";
        while (fs.existsSync(dst)) dst += ".old";
        demoted.push(path.basename(dst));
      } else if (fs.existsSync(dst)) {
        continue;
      }
      fs.renameSync(src, dst);
      if (resIsVideoName(name)) moved++;
    }
  }

  // Whatever is left is show-level artwork and metadata Emby regenerates --
  // but only once no video is left behind anywhere under it.
  const leftBehind = videosUnder(loserDir);
  if (leftBehind.length) return { moved, demoted, removed: false, leftBehind };
  fs.rmSync(loserDir, { recursive: true, force: true });
  return { moved, demoted, removed: true, leftBehind: [] };
}

/**
 * Group Emby series by the tvdb record they resolve to and, for every record
 * claimed by more than one folder, plan the merge of the extras into the
 * folder holding the most videos.
 *
 * `resolve` maps an Emby series to { key, rec } or null.
 * Returns one entry per duplicated record, each with its plans.
 */
export function planDuplicateFolders(embyShows, resolve) {
  const byRecord = new Map();
  for (const show of embyShows) {
    const folder = String(show?.Path || "")
      .split("/")
      .pop();
    if (!folder) continue;
    const hit = resolve(show);
    if (!hit?.key) continue;
    const entry = byRecord.get(hit.key) || { hit, folders: new Map() };
    entry.folders.set(folder, show);
    byRecord.set(hit.key, entry);
  }

  const out = [];
  for (const [key, entry] of byRecord) {
    if (entry.folders.size < 2) continue;
    const folders = [...entry.folders.keys()];
    const ed = entry.hit.rec?.episodeData;
    const group = {
      showName: key,
      rec: entry.hit.rec,
      winner: null,
      counts: {},
      plans: [],
    };

    if (!Array.isArray(ed)) {
      group.plans = folders.map((f) => ({
        showName: key,
        winnerFolder: null,
        loserFolder: f,
        ok: false,
        reason: "record has no episodeData to check against",
        moves: [],
        demotions: [],
      }));
      out.push(group);
      continue;
    }

    // Audit every folder before choosing between them. One bad folder condemns
    // the whole group: sharing a tvdbId only means Emby matched both to this
    // show, and if either is really a different show then no direction of
    // merge is safe.
    const audits = folders.map((f) => auditShowFolder(f, ed));
    group.counts = Object.fromEntries(
      audits.map((a) => [a.folder, a.episodes.length]),
    );
    const problems = audits.flatMap((a) => a.problems);
    if (problems.length) {
      group.plans = audits.map((a) => ({
        showName: key,
        winnerFolder: null,
        loserFolder: a.folder,
        ok: false,
        reason: problems.join("; "),
        moves: [],
        demotions: [],
      }));
      out.push(group);
      continue;
    }

    // The folder holding the most episodes is the one to keep; a tie goes to
    // the one the record already points at, so a merge never moves the show.
    const recFolder = entry.hit.rec?.path;
    const ranked = audits.slice().sort((a, b) => {
      if (a.episodes.length !== b.episodes.length)
        return b.episodes.length - a.episodes.length;
      if (a.folder === recFolder) return -1;
      if (b.folder === recFolder) return 1;
      return a.folder.localeCompare(b.folder);
    });
    const winnerAudit = ranked[0];
    group.winner = winnerAudit.folder;
    group.plans = ranked
      .slice(1)
      .map((a) => planFolderMerge(key, winnerAudit, a));
    out.push(group);
  }
  return out;
}
