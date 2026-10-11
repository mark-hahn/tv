// Season 0: which of the entries TVDB lists in season 0 are specials, counted
// like any other episode, and which are extras -- featurettes, podcasts,
// interviews, promos -- kept apart in the extras store (tvdbDb) for the map
// pane to list, where nothing that counts episodes ever reads them. TVDB puts
// everything a show's makers officially released in season 0, and for most
// shows that is extras. See epi-0.md.

import * as epd from "@tv/share";
import { logHere, unilog} from "@tv/share"
import { getToken, clearToken } from "./tvdbToken.js";
import { getExtras, setExtras } from "./tvdbDb.js";
import { placements } from "./storyOrder.js";

const TVDB_EPISODE_URL = "https://api4.thetvdb.com/v4/episodes";
// TVDB Special Category values that make an entry a real episode of the show.
const COUNTED_CATEGORIES = new Set(["Episodic Special", "Movies", "Pilots"]);
// What TVDB says about a season 0 entry, kept the same on a counted special and
// on an extra so an entry can move either way without losing any of it.
const TVDB_FACTS = [
  "aired",
  "tvdbId",
  "title",
  "runtime",
  "airsBeforeSeason",
  "airsBeforeEpisode",
  "airsAfterSeason",
  "category",
  "critical",
  "tagged",
];

// The counting rule: a file, a watched mark, a real-episode category, or TVDB
// calling it critical to the story.
export const isCountedSpecial = (ep) =>
  !!(
    ep.file ||
    ep.watched ||
    ep.critical ||
    COUNTED_CATEGORIES.has(ep.category)
  );

// One of TVDB's episode records (`path` under the episode), or null when TVDB
// has none.
async function fetchEpisode(path, retried = false) {
  const res = await fetch(`${TVDB_EPISODE_URL}/${path}`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  if (res.status === 401 && !retried) {
    clearToken();
    return fetchEpisode(path, true);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TVDB status ${res.status}`);
  return (await res.json())?.data ?? null;
}

// TVDB's tags on one episode: its Special Category and whether it is critical
// to the story. The tags are not in a show's episode list; each entry takes a
// request of its own.
async function fetchTags(tvdbId) {
  const tags = (await fetchEpisode(`${tvdbId}/extended`))?.tagOptions || [];
  const tag = (name) => tags.find((t) => t.tagName === name)?.name ?? null;
  return {
    category: tag("Special Category"),
    critical: tag("Special is Critical to Show's Story") === "Yes",
  };
}

// What TVDB has on one season 0 entry beyond the show's episode list -- its
// English overview and its image -- for the map pane's episode card. TMDB
// numbers specials its own way, so the card cannot ask it as it does for the
// regular seasons.
export async function tvdbEpisodeDetails(tvdbId) {
  const [extended, english] = await Promise.all([
    fetchEpisode(`${tvdbId}/extended`),
    fetchEpisode(`${tvdbId}/translations/eng`),
  ]);
  return {
    overview: english?.overview ?? extended?.overview ?? null,
    image: extended?.image ?? null,
  };
}

// Gives each fresh season 0 entry from TVDB (`fresh`: episode -> facts, each
// with TVDB's lastUpdated) its tags: the ones kept with it when TVDB has not
// changed the episode since they were read, else read now. `tagged` records the
// lastUpdated they were read at. A read that fails keeps what was kept, and is
// tried again at the show's next TVDB refresh.
export async function readTags(showName, rec, fresh) {
  const extras = new Map(getExtras(rec.tvdbId).map((x) => [x.episode, x]));
  for (const [episode, facts] of fresh) {
    const stamp = facts.lastUpdated ?? "unknown";
    delete facts.lastUpdated;
    const kept = epd.getEp(rec.episodeData, 0, episode) ?? extras.get(episode);
    if (kept?.tagged === stamp || !facts.tvdbId) {
      facts.category = kept?.category ?? null;
      facts.critical = kept?.critical ?? false;
      facts.tagged = kept?.tagged ?? null;
      continue;
    }
    try {
      Object.assign(facts, await fetchTags(facts.tvdbId), { tagged: stamp });
    } catch (e) {
      facts.category = kept?.category ?? null;
      facts.critical = kept?.critical ?? false;
      facts.tagged = kept?.tagged ?? null;
      unilog(2853, `${showName} S00E${episode} tags not read: ${e.message}`);
    }
  }
}

// The TVDB facts an entry holds, leaving out the empty ones.
const factsOf = (ep) =>
  Object.fromEntries(
    TVDB_FACTS.filter((name) => ep?.[name] != null && ep[name] !== false).map(
      (name) => [name, ep[name]],
    ),
  );

/**
 * Sorts a show's season 0 by the counting rule: counted specials into its
 * episodes, everything else into its extras. Synchronous, and run after the
 * refresh's last wait, so nothing ever sees a show half sorted.
 *
 * `fresh` is TVDB's season 0 from this refresh (episode -> facts, tags read),
 * or empty when TVDB did not run; `complete` says it is TVDB's whole list, so
 * an entry missing from it is gone from TVDB. An entry moves at once whichever
 * way the rule now points: an extra whose file has landed takes its slot, and
 * a special that lost its file, unwatched and untagged, becomes an extra.
 */
export function sortSeason0(rec, fresh, complete) {
  if (!rec.tvdbId) return;
  const ed = rec.episodeData;
  const kept = new Map(getExtras(rec.tvdbId).map((x) => [x.episode, x]));
  const episodes = new Set([...kept.keys(), ...fresh.keys()]);
  epd.forEachEpisode(ed, (season, episode) => {
    if (season === 0) episodes.add(episode);
  });
  const extras = [];
  for (const episode of [...episodes].sort((a, b) => a - b)) {
    const slot = epd.getEp(ed, 0, episode);
    const tvdbFacts = fresh.get(episode);
    const facts = { ...factsOf(kept.get(episode)), ...factsOf(slot) };
    if (tvdbFacts) {
      // TVDB's word wins, except that an air date it has dropped is left as
      // it was.
      for (const [name, value] of Object.entries(tvdbFacts)) {
        if (name === "aired" && !value) continue;
        facts[name] = value;
      }
    }
    if (isCountedSpecial({ ...slot, ...facts })) {
      epd.setEpisode(ed, 0, episode, facts);
      continue;
    }
    if (slot) epd.deleteEpisode(ed, 0, episode);
    // Gone from TVDB, with no file or watched mark to keep it.
    if (complete && !tvdbFacts) continue;
    extras.push({ episode, ...factsOf(facts) });
  }
  setExtras(rec.tvdbId, extras);
}

/**
 * A show's extras as the map pane lists them, in episode order, each with
 * where it falls among the regular episodes by the same rule as counted
 * specials (storyOrder.js).
 */
export function extrasForDisplay(rec) {
  const extras = getExtras(rec.tvdbId);
  if (extras.length === 0) return [];
  const asSeason0 = [];
  for (const extra of extras) asSeason0[extra.episode - 1] = extra;
  const ed = Array.isArray(rec.episodeData) ? rec.episodeData : [];
  const places = placements([asSeason0, ...ed.slice(1)]);
  return extras.map((extra) => ({
    episode: extra.episode,
    aired: extra.aired ?? null,
    title: extra.title ?? null,
    category: extra.category ?? null,
    runtime: extra.runtime ?? null,
    belongs: places.get(extra.episode)?.belongs ?? null,
  }));
}
