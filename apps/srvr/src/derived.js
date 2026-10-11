// The show values tv-srvr works out from a show's episodes and a few other
// fields instead of storing them: the counts, quality, readiness, the gap
// flags, the wait date, needsIntro, the aired dates, the last play, the
// next-up episode and where each special belongs (COMPUTED_FIELDS in
// computedFields.js). Anything that walks the episodes in order walks story
// order (storyOrder.js), with each special placed among the regular ones. tvdb.js keeps them
// on the in-memory records (refreshDerived), recomputing a show's whenever its
// episodes or another input change and every show's just after midnight. They
// are never written to tvdb.db, so they can never disagree with the episodes.

import * as epd from "@tv/share";
import * as util from "./util.js";
import { gapStateOf } from "./gaps.js";
import { placements, storyOrder } from "./storyOrder.js";

// The fields the gap check works out.
const GAP_FIELDS = [
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
  "stray",
  "strayCount",
  "strayFiles",
  "straySeason",
  "strayEpisode",
];

// The gap fields of a show out of the library: it has no folder, so nothing
// can be missing from it, and it is never ready to play.
const NO_GAPS = {
  notReady: true,
  watchGap: false,
  watchGapSeason: null,
  watchGapEpisode: null,
  fileGap: false,
  fileGapSeason: null,
  fileGapEpisode: null,
  resDrop: false,
  resDropSeason: null,
  resDropEpisode: null,
  fileEndError: false,
  fileEndErrorSeason: null,
  fileEndErrorEpisode: null,
  seasonWatchedThenNofile: false,
  seasonWatchedThenNofileSeason: null,
  seasonWatchedThenNofileEpisode: null,
  stray: false,
  strayCount: 0,
  strayFiles: [],
  straySeason: null,
  strayEpisode: null,
};

const FILE_AVAILABLE_DATE = "2000-01-01";
const DAY_MS = 24 * 60 * 60 * 1000;

// "S01E02"
const episodeCode = (season, episode) =>
  `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

const hasFileField = (ep) => typeof ep.file === "string" && !!ep.file;

// Whether an episode is one of the show's own: TVDB lists it or dates it, or
// it has been watched. A file the disk turned up for an episode TVDB doesn't
// list is not.
const isShowEpisode = (ep) => !!(ep.tvdbId || ep.aired || ep.watched);

// A season with trimPos/skipDur, or one marked "none" (checked, no intro),
// counts as configured.
export const hasConfiguredIntro = (seasonIntros) =>
  seasonIntros != null &&
  Object.values(seasonIntros).some(
    (si) => si?.trimPos != null || si?.skipDur != null || si?.none === true,
  );

// The episode that plays next: the first unwatched one with a file in story
// order (storyOrder.js), after `after` ({season, episode}) when that is given.
// Null when there is none.
export function nextUpAfter(ed, after = null, places = placements(ed)) {
  const order = storyOrder(ed, places);
  const start = after
    ? order.findIndex(
        (x) => x.season === after.season && x.episode === after.episode,
      ) + 1
    : 0;
  for (const { season, episode, ep } of order.slice(start)) {
    if (!ep.watched && hasFileField(ep)) return { season, episode };
  }
  return null;
}

// Next-up as the clients get it: also how many episodes its season holds, and
// its resolution.
function nextUpOf(ed, places) {
  const next = nextUpAfter(ed, null, places);
  if (!next) return null;
  return {
    ...next,
    seasonEps: ed[next.season]?.length ?? 0,
    res: epd.getRes(ed, next.season, next.episode) || 0,
  };
}

// The placements as the clients get them (see deriveShow), each with the
// nearest regular episodes on either side of it in story order.
function placementsOut(ed, places) {
  const order = storyOrder(ed, places);
  const at = (x) => (x ? { season: x.season, episode: x.episode } : null);
  return Object.fromEntries(
    [...places].map(([episode, { belongs, source }]) => {
      const i = order.findIndex(
        (x) => x.season === 0 && x.episode === episode,
      );
      const prev = order.slice(0, i).findLast((x) => x.season > 0);
      const next = order.slice(i + 1).find((x) => x.season > 0);
      return [episode, { belongs, source, prev: at(prev), next: at(next) }];
    }),
  );
}

// firstAired/lastAired/nextAired, "YYYY/MM/DD" or empty, from the air dates of
// every episode: the earliest, the latest that has aired, and the earliest
// still to air.
function airedDates(ed, today) {
  const dates = [];
  epd.forEachEpisode(ed, (season, episode, ep) => {
    if (typeof ep.aired === "string" && ep.aired) dates.push(ep.aired);
  });
  dates.sort();
  const aired = dates.filter((d) => d <= today);
  const toAir = dates.filter((d) => d > today);
  const fmt = (d) => (d ? d.replace(/-/g, "/") : "");
  return {
    firstAired: fmt(dates[0]),
    lastAired: fmt(aired[aired.length - 1]),
    nextAired: fmt(toAir[0]),
  };
}

// waitStr: the earliest date when you can start watching any season and
// always have an episode ready (viewer watches 1/day, no air-date cadence
// assumed). For each episode ranked k (0-indexed by air date), you watch it on
// day startDate+k. It must be available: startDate+k >= airDate[k]+2, so
// startDate >= airDate[k]+2-k. Episodes with a file on disk are already
// available -- effective airDate = "2000-01-01".
// safe_start(season) = max over all k of (airDate[k] + 2 - k)
// waitDate = min(safe_start across all seasons with unwatched episodes).
// The wait is measured against the next night an episode would be watched:
// today, or tomorrow when one was already played today (lastPlayedDate is a
// PST "YYYY/MM/DD ..." string). Otherwise playing tonight's episode makes the
// remaining ones look one day short until the day rolls over.
// Returns "{M-DD}" or "{YY-M-DD}" when future, "" when past/today, null when
// no data. seasonOf(season, episode) names the season an episode counts in:
// its own, unless the caller places it elsewhere (a special, in story order).
export function calculateWaitStr(
  episodeData,
  lastPlayedDate = null,
  todayIso = null,
  seasonOf = (season) => season,
) {
  try {
    if (!Array.isArray(episodeData)) return null;

    todayIso = todayIso || util.toPstDateIso(new Date());
    const lastPlayedDay =
      typeof lastPlayedDate === "string"
        ? lastPlayedDate.slice(0, 10).replace(/\//g, "-")
        : null;
    const today =
      lastPlayedDay === todayIso
        ? new Date(new Date(todayIso).getTime() + DAY_MS).toISOString().slice(0, 10)
        : todayIso;

    // Per-season episodes: season -> [{ date, watched }]. If a file is on
    // disk and the TVDB air date is in the future (unaired), treat it as
    // available today. Already-aired episodes use their TVDB date.
    const seasonData = new Map();
    epd.forEachEpisode(episodeData, (seasonNum, episodeNum) => {
      const airDate = epd.getAired(episodeData, seasonNum, episodeNum);
      if (!airDate) return;
      const season = seasonOf(seasonNum, episodeNum);
      if (!seasonData.has(season)) seasonData.set(season, []);
      const hasDiskFile = epd.hasFile(episodeData, seasonNum, episodeNum);
      seasonData.get(season).push({
        date: hasDiskFile ? FILE_AVAILABLE_DATE : airDate || "",
        watched: epd.isWatched(episodeData, seasonNum, episodeNum),
      });
    });

    if (seasonData.size === 0) return null;

    let minWaitDate = null;

    for (const episodes of seasonData.values()) {
      // Sort unwatched episode air dates ascending (by air date, not episode
      // number). For each rank i (0-indexed): startDate >= airDate[i] + 2 - i
      // safe_start = max over all i
      const unwatchedDates = episodes
        .filter((ep) => !ep.watched)
        .map((ep) => ep.date)
        .filter((d) => d)
        .sort();
      if (unwatchedDates.length === 0) continue;

      let safeStartMs = -Infinity;
      for (let i = 0; i < unwatchedDates.length; i++) {
        const ms = new Date(unwatchedDates[i]).getTime() + (2 - i) * DAY_MS;
        if (ms > safeStartMs) safeStartMs = ms;
      }
      const safeStart = new Date(safeStartMs).toISOString().slice(0, 10);

      if (minWaitDate === null || safeStart < minWaitDate) {
        minWaitDate = safeStart;
      }
    }

    if (minWaitDate === null) return null;

    if (minWaitDate > today) {
      const waitMD = minWaitDate.slice(5).replace(/^0/, " ").trim();
      const todayYear = today.slice(0, 4);
      const waitYear = minWaitDate.slice(0, 4);
      const yearPrefix = waitYear !== todayYear ? `${waitYear.slice(2)}-` : "";
      return `{${yearPrefix}${waitMD}}`;
    }
    return ""; // safe to start now
  } catch (e) {
    // A date that will not parse leaves the wait unknown.
  }
  return null;
}

// "MM-DD HH:mm" in PST, as the stray note is stamped.
function strayStamp() {
  const t = util.toPstDateTimeMs(new Date());
  return `${t.slice(5, 7)}-${t.slice(8, 10)} ${t.slice(11, 16)}`;
}

/**
 * Every computed value for one show, worked out from its record as it stands.
 * `today` is the PST date, "YYYY-MM-DD".
 *
 * Returns { values, gapSig, ignoreGaps, strayNote }. values holds every
 * COMPUTED_FIELDS field. The other three are the gap check's stored state, set
 * only for a library show: the signature its ignores were granted against, the
 * ignores still good against it, and a stray note for a show that has stray
 * files and no note yet. The caller stores those.
 */
export function deriveShow(name, rec, today) {
  const ed = rec.episodeData;
  let watchedCount = 0;
  let episodeCount = 0;
  let regularEpisodes = 0;
  let regularWatched = 0;
  const seasons = new Set();
  let lastPlayed = null;
  epd.forEachEpisode(ed, (season, episode, ep) => {
    if (ep.watched) watchedCount++;
    if (
      typeof ep.lastPlayed === "string" &&
      ep.lastPlayed &&
      (!lastPlayed || ep.lastPlayed > lastPlayed.at)
    )
      lastPlayed = { at: ep.lastPlayed, season, episode };
    if (!isShowEpisode(ep)) return;
    episodeCount++;
    if (season < 1) return;
    seasons.add(season);
    regularEpisodes++;
    if (ep.watched) regularWatched++;
  });

  const aired = airedDates(ed, today);
  const lastPlayedDate = lastPlayed?.at ?? null;
  // Where each season 0 episode belongs among the regular ones.
  const places = placements(ed);
  const values = {
    watchedCount,
    episodeCount,
    seasonCount: seasons.size,
    quality: epd.computeQuality(ed) ?? null,
    anyWatched: watchedCount > 0,
    // "" is ready now and null unknown: the hide/unhide loop acts only on a
    // wait it knows about (see tryLocalGetTvdb).
    // A placed special waits along with the season it is placed in.
    waitStr: calculateWaitStr(ed, lastPlayedDate, today, (season, episode) =>
      season === 0 ? (places.get(episode)?.season ?? 0) : season,
    ),
    // Season 0 takes no part: a special's opening may not match the show's
    // intro, so it neither needs one marked nor counts as unwatched here.
    needsIntro: !!(
      rec.inLibrary &&
      !rec.inLinda &&
      !hasConfiguredIntro(rec.seasonIntros) &&
      epd.seasonsWithFile(ed).some((season) => season >= 1) &&
      regularEpisodes > regularWatched
    ),
    ...aired,
    lastPlayedDate,
    lastPlayedEpisode: lastPlayed
      ? episodeCode(lastPlayed.season, lastPlayed.episode)
      : null,
    nextUp: nextUpOf(ed, places),
    // Each season 0 episode's place, for the web map's episode pane and
    // tvapp's episode card: { <episode>: { belongs, source, prev, next } },
    // null with no specials. prev and next are the nearest regular episodes
    // on either side of it in story order, as { season, episode }, null at
    // either end; the web map marks them.
    placements: places.size ? placementsOut(ed, places) : null,
  };

  if (!rec.inLibrary) return { values: { ...values, ...NO_GAPS } };

  const state = gapStateOf(name, {
    ...rec,
    firstAired: aired.firstAired.replace(/\//g, "-"),
  });
  // A gap check that failed leaves the gap fields as they were.
  if (!state) {
    for (const field of GAP_FIELDS) values[field] = rec[field] ?? NO_GAPS[field];
    return { values };
  }
  for (const field of GAP_FIELDS) values[field] = state[field];
  return {
    values,
    gapSig: state.gapSig,
    ignoreGaps: state.ignoreGaps,
    strayNote:
      state.stray && !rec.strayNote
        ? `${state.strayCount} non-aired file(s) from S${state.straySeason}E${state.strayEpisode} seen ${strayStamp()}`
        : null,
  };
}
