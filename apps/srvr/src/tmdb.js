import { smartTitleMatch, unilog, logHere } from "@tv/share"
import { MovieDb } from "moviedb-promise";
const moviedb = new MovieDb("327192a334da700f65b882c7a69cb927");

// A getTmdb call slower than this gets logged with a per-round-trip breakdown,
// so a slow map/actors pane load names the TMDB call that caused it.
const SLOW_TMDB_MS = 1000;

/**
 * Get TMDB data for a TV show
 * @param {number} id - WebSocket message ID
 * @param {string} param - JSON string with {showName, year}
 * @param {Function} resolve - Success callback
 * @param {Function} reject - Error callback
 */
export async function getTmdb(params) {
  try {
    const data = params;
    const { showName, year, season, episode, credits, seriesId, imdbId } = data;

    // If requesting series-level cast/credits data
    if (credits === true && seriesId) {
      try {
        // Try the moviedb-promise method first
        let creditsData;
        try {
          creditsData = await moviedb.tvAggregateCredits({ id: seriesId });
        } catch (methodError) {
          // If method doesn't exist, use direct fetch to TMDB API
          unilog(707, "tvAggregateCredits method not found, using direct API call");
          const response = await fetch(
            `https://api.themoviedb.org/3/tv/${seriesId}/aggregate_credits?api_key=327192a334da700f65b882c7a69cb927`,
          );
          if (!response.ok) {
            throw new Error(
              `TMDB API returned ${response.status}: ${response.statusText}`,
            );
          }
          creditsData = await response.json();
        }
        return creditsData;
      } catch (error) {
        unilog(708, "aggregate_credits error:", error.message);
        throw new Error(`aggregate_credits error: ${error.message}`);
      }
    }

    const startedAt = Date.now();
    const res = await moviedb.searchTv({ query: showName });
    const searchMs = Date.now() - startedAt;

    // Find show with matching original_name, optionally prioritizing year
    const matchingTitle = smartTitleMatch(
      showName,
      res.results || [],
      year,
      false,
    );

    // Find the actual show object that matches the title
    const matchingShow = matchingTitle
      ? res.results.find(
          (show) =>
            show.name === matchingTitle || show.original_name === matchingTitle,
        )
      : null;

    const showId = matchingShow?.id;

    if (!showId || !season || !episode) {
      if (Date.now() - startedAt >= SLOW_TMDB_MS) {
        unilog(1446, `slow getTmdb series ${showName}: ${Date.now() - startedAt}ms (searchTv ${searchMs}ms)`);
      }
      return matchingShow || null;
    }

    // Get episode information. guest_stars comes back inside this one response,
    // so guests cost no extra round trip.
    const episodeStartedAt = Date.now();
    const episodeInfo = await moviedb.episodeInfo({
      id: showId,
      season_number: parseInt(season),
      episode_number: parseInt(episode),
    });
    const episodeMs = Date.now() - episodeStartedAt;

    // Get guest actors (filter by known_for_department === "Acting")
    const guestActorList =
      episodeInfo.guest_stars?.filter(
        (actor) => actor.known_for_department === "Acting",
      ) || [];

    const totalMs = Date.now() - startedAt;
    if (totalMs >= SLOW_TMDB_MS) {
      unilog(1447, `slow getTmdb ${showName} S${season}E${episode}: ${totalMs}ms ` +
          `(searchTv ${searchMs}ms, episodeInfo ${episodeMs}ms, ${guestActorList.length} guests)`);
    }

    return {
      guests: guestActorList,
      image: episodeInfo.still_path
        ? `https://image.tmdb.org/t/p/w300${episodeInfo.still_path}`
        : null,
      overview: episodeInfo.overview ?? null,
      name: episodeInfo.name ?? null,
      aired: episodeInfo.air_date ?? null,
    };
  } catch (error) {
    if (error.status === 404) {
      const s = String(season).padStart(2, "0");
      const e = String(episode).padStart(2, "0");
      unilog(1795, `tmdb 404, episode not found: ${showName} S${s}E${e}`);
    } else {
      unilog(1796, `getTmdb error: ${error.message}`);
    }
    throw new Error(`getTmdb error: ${error.message}`);
  }
}

// The tv app's show-list cards want a landscape image, which a poster is not.
// TMDB's backdrops are 16:9; w780 is wider than any card and small enough that
// a screenful of them decodes without trouble on the tv.
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
// The answer never changes and there are a couple of thousand shows to scroll
// past, so each is looked up once per srvr run. Misses are cached too -- a show
// TMDB has no backdrop for must not be asked about again on every scroll.
const backdropCache = new Map();

/**
 * The landscape image for one show: by TMDB id when the record carries one in
 * its remote_ids, by name search when it does not. url is empty when TMDB has
 * nothing, which is the caller's cue to go on showing the poster.
 */
export async function getBackdrop(params) {
  const { tmdbId, showName } = params;
  const id = String(tmdbId || "").trim();
  const key = id || `name:${String(showName || "").toLowerCase()}`;
  if (backdropCache.has(key)) return { url: backdropCache.get(key) };
  let url = "";
  try {
    url = await findBackdrop(id, showName);
  } catch (e) {
    unilog(1916, `backdrop lookup failed for ${showName}: ${e.message}`);
  }
  backdropCache.set(key, url);
  return { url };
}

async function findBackdrop(tmdbId, showName) {
  let id = tmdbId;
  if (!id) {
    if (!showName) return "";
    // A trailing (YYYY) is this library's way of telling two shows of the same
    // name apart; TMDB has never heard of it, and takes the year separately.
    // Same handling as getStreamProviders below.
    let query = showName;
    let year = null;
    const yearMatch = query.match(/\s*\((\d{4})\)$/);
    if (yearMatch) {
      year = yearMatch[1];
      query = query.slice(0, query.length - yearMatch[0].length).trim();
    }
    const res = await moviedb.searchTv({ query });
    const results = res.results || [];
    const title = smartTitleMatch(query, results, year, false);
    const match = title
      ? results.find((s) => s.name === title || s.original_name === title)
      : null;
    if (!match?.id) return "";
    id = match.id;
  }
  const images = await moviedb.tvImages({ id });
  const backdrops = images.backdrops || [];
  if (backdrops.length === 0) return "";
  // A textless backdrop first -- one with a language on it carries the show's
  // own title art, which the card already has in its name beside the image --
  // and the most voted of whichever set that leaves.
  const textless = backdrops.filter((b) => !b.iso_639_1);
  const pick = (textless.length ? textless : backdrops).reduce((best, b) =>
    (b.vote_average || 0) > (best.vote_average || 0) ? b : best,
  );
  return pick.file_path ? BACKDROP_BASE + pick.file_path : "";
}

export async function searchPerson(params) {
  const { name } = params;
  if (!name) return null;
  try {
    const res = await moviedb.searchPerson({ query: name });
    const person = res.results?.[0];
    if (!person?.profile_path) return null;
    return `https://image.tmdb.org/t/p/w185${person.profile_path}`;
  } catch (error) {
    unilog(712, "searchPerson error:", error.message);
    return null;
  }
}

export async function getStreamProviders(params) {
  let { showName, year } = params;

  // Strip trailing (YYYY) from show name and use as year if not already provided
  const yearMatch = String(showName || "").match(/\s*\((\d{4})\)$/);
  if (yearMatch) {
    if (!year) year = yearMatch[1];
    showName = showName.slice(0, showName.length - yearMatch[0].length).trim();
  }

  const searchRes = await moviedb.searchTv({ query: showName });

  // smartTitleMatch returns a string (the title), not the object
  let matchingTitle = smartTitleMatch(
    showName,
    searchRes.results || [],
    year,
    false,
  );
  if (!matchingTitle && year) {
    matchingTitle = smartTitleMatch(
      showName,
      searchRes.results || [],
      null,
      false,
    );
  }
  if (!matchingTitle) {
    return { providers: [], error: "show not found" };
  }

  // Find the actual show object that matches the title
  const match = searchRes.results.find(
    (show) =>
      show.name === matchingTitle || show.original_name === matchingTitle,
  );
  if (!match?.id) {
    return { providers: [], error: "show not found" };
  }

  const COUNTRIES = ["US", "GB", "AU"];
  const wpRes = await moviedb.tvWatchProviders({ id: match.id });
  const allResults = wpRes.results || {};

  const TYPES = ["flatrate", "rent", "buy"];
  const IMG_BASE = "https://image.tmdb.org/t/p/original";
  const seen = new Set();
  const providers = [];
  for (const cc of COUNTRIES) {
    for (const type of TYPES) {
      for (const p of allResults[cc]?.[type] || []) {
        if (seen.has(p.provider_id)) continue;
        if (/\bwith ads\b/i.test(p.provider_name)) continue;
        seen.add(p.provider_id);
        providers.push({
          name: p.provider_name,
          logoUrl: p.logo_path ? IMG_BASE + p.logo_path : null,
          type,
          providerId: p.provider_id,
          source: "tmdb",
        });
      }
    }
  }

  const tmdbLink =
    allResults.US?.link || allResults.GB?.link || allResults.AU?.link;
  return { providers, tmdbLink, tmdbId: match.id };
}
