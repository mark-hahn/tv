// Where each season 0 episode belongs among a show's regular episodes, and the
// story order that follows. Season 0's own numbers say nothing about where a
// special comes in the story, so:
//   - one with an air date goes after the last regular episode that aired on
//     or before it, or before the first if it aired earlier;
//   - one with no air date goes where TVDB's placement (airsBeforeSeason/
//     airsBeforeEpisode, airsAfterSeason) says, when that names an episode or
//     season that exists;
//   - one with neither has no place, and comes after everything else.
// When TVDB's placement disagrees with the air date, the air date wins and the
// disagreement is reported. A placement only ever changes the order: the
// episode keeps its own S00 number everywhere else.

import * as epd from "@tv/share";

const episodeCode = (season, episode) =>
  `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

// The regular episodes, seasons 1 and up, in season and episode order.
function regularEpisodes(ed) {
  const out = [];
  epd.forEachEpisode(ed, (season, episode, ep) => {
    if (season >= 1) out.push({ season, episode, ep });
  });
  return out;
}

// The regular episodes a special can be placed against: the ones TVDB lists
// or dates. An old watched mark for an episode TVDB no longer lists, or a file
// it never did, is no part of what TVDB's placement or an air date means.
function anchorEpisodes(ed) {
  return regularEpisodes(ed).filter((r) => r.ep.tvdbId || r.ep.aired);
}

// Where TVDB puts a special, as the index into `regular` it goes after (-1 for
// before them all); null when TVDB gives no placement, undefined when the one
// it gives names no episode or season the show has.
function tvdbPosition(regular, ep) {
  if (ep.airsBeforeSeason) {
    const before = ep.airsBeforeEpisode || 1;
    const i = regular.findIndex(
      (r) => r.season === ep.airsBeforeSeason && r.episode === before,
    );
    return i >= 0 ? i - 1 : undefined;
  }
  if (ep.airsAfterSeason) {
    let last = -1;
    regular.forEach((r, i) => {
      if (r.season === ep.airsAfterSeason) last = i;
    });
    return last >= 0 ? last : undefined;
  }
  return null;
}

// TVDB's placement in words, as the disagreement is reported.
function tvdbText(ep) {
  if (ep.airsBeforeSeason)
    return `before ${episodeCode(ep.airsBeforeSeason, ep.airsBeforeEpisode || 1)}`;
  return `after S${String(ep.airsAfterSeason).padStart(2, "0")}`;
}

// Where an air date puts a special: after the last regular episode that aired
// on or before it, -1 for before them all, null when no regular episode has an
// air date to measure against.
function airDatePosition(regular, aired) {
  if (!regular.some((r) => r.ep.aired)) return null;
  let at = -1;
  regular.forEach((r, i) => {
    if (r.ep.aired && r.ep.aired <= aired) at = i;
  });
  return at;
}

/**
 * Every season 0 episode's place: a Map from its episode number to
 * { pos, season, after, belongs, source }. pos is the index into the anchor
 * episodes it goes after (-1 before them all), after that episode as
 * { season, episode } (null for before them all), and season the regular
 * season the special is part of; pos and season are null when it has no
 * place. belongs is the place in words ("after S02E06", "before S01E01") or
 * null, and source says where the place came from.
 */
export function placements(ed) {
  const regular = anchorEpisodes(ed);
  const out = new Map();
  const specials = Array.isArray(ed?.[0]) ? ed[0] : [];
  specials.forEach((slot, i) => {
    const ep = epd.episodeFields(slot);
    if (!ep) return;
    const tvdbPos = regular.length ? tvdbPosition(regular, ep) : undefined;
    const airPos =
      ep.aired && regular.length ? airDatePosition(regular, ep.aired) : null;
    let pos = null;
    let source;
    if (airPos !== null) {
      pos = airPos;
      if (tvdbPos === null) source = "air date";
      else if (tvdbPos === airPos) source = "air date; TVDB agrees";
      else source = `air date; TVDB says ${tvdbText(ep)}`;
    } else if (typeof tvdbPos === "number") {
      pos = tvdbPos;
      source = "TVDB placement";
    } else {
      source = "no air date or TVDB placement";
    }
    if (pos === null) {
      out.set(i + 1, { pos: null, season: null, after: null, belongs: null, source });
      return;
    }
    const anchor = pos >= 0 ? regular[pos] : regular[0];
    out.set(i + 1, {
      pos,
      season: anchor.season,
      after: pos >= 0 ? { season: anchor.season, episode: anchor.episode } : null,
      belongs:
        pos >= 0
          ? `after ${episodeCode(anchor.season, anchor.episode)}`
          : `before ${episodeCode(anchor.season, anchor.episode)}`,
      source,
    });
  });
  return out;
}

/**
 * The show's episodes in story order, each { season, episode, ep } with its
 * real season and episode: the regular ones in season and episode order, each
 * placed season 0 episode right after the one it goes after (several at one
 * spot in air date order), and the season 0 episodes with no place after
 * everything else, by number.
 */
export function storyOrder(ed, places = placements(ed)) {
  const regular = regularEpisodes(ed);
  const first = []; // placed before every regular episode
  const after = new Map(); // "<season>.<episode>" of the anchor -> specials
  const unplaced = [];
  for (const [episode, place] of places) {
    const item = { season: 0, episode, ep: epd.getEp(ed, 0, episode) };
    if (place.pos === null) unplaced.push(item);
    else if (!place.after) first.push(item);
    else {
      const key = `${place.after.season}.${place.after.episode}`;
      if (!after.has(key)) after.set(key, []);
      after.get(key).push(item);
    }
  }
  const byAired = (a, b) =>
    (a.ep.aired || "").localeCompare(b.ep.aired || "") || a.episode - b.episode;
  first.sort(byAired);
  for (const list of after.values()) list.sort(byAired);
  const order = [...first];
  for (const r of regular)
    order.push(r, ...(after.get(`${r.season}.${r.episode}`) || []));
  return [...order, ...unplaced.sort((a, b) => a.episode - b.episode)];
}

/**
 * The story order cut into seasons, as [{ season, episodes }], for anything
 * that works season by season: each placed season 0 episode in the regular
 * season it is placed in, and those with no place in a season 0 of their own
 * at the end.
 */
export function storySeasons(ed, places = placements(ed)) {
  const seasons = [];
  for (const item of storyOrder(ed, places)) {
    const season = item.season === 0 ? places.get(item.episode).season ?? 0 : item.season;
    const last = seasons[seasons.length - 1];
    if (last && last.season === season) last.episodes.push(item);
    else seasons.push({ season, episodes: [item] });
  }
  return seasons;
}
