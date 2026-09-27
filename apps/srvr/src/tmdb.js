import { unilog, logHere } from "@tv/share"
import { MovieDb } from "moviedb-promise";
import { showIdsFor } from "./tvdb.js";
import { showImage, episodeImage, personImage, tmdbShowId } from "./images.js";
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
    const { showName, season, episode, credits, seriesId, imdbId } = data;

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

    // The show by its own ids first; a search by name only when they find none.
    const startedAt = Date.now();
    const ids = showIdsFor({ showName, imdbId });
    const showId = await tmdbShowId(ids, showName);
    const searchMs = Date.now() - startedAt;

    if (!season || !episode) {
      if (Date.now() - startedAt >= SLOW_TMDB_MS) {
        unilog(1446, `slow getTmdb series ${showName}: ${Date.now() - startedAt}ms (searchTv ${searchMs}ms)`);
      }
      return showId ? { id: Number(showId) } : null;
    }

    // Get episode information. guest_stars comes back inside this one response,
    // so guests cost no extra round trip. An episode TMDB lacks still has its
    // still from the other providers.
    const episodeStartedAt = Date.now();
    let episodeInfo = {};
    if (showId) {
      try {
        episodeInfo = await moviedb.episodeInfo({
          id: showId,
          season_number: parseInt(season),
          episode_number: parseInt(episode),
        });
      } catch (error) {
        if (error.status !== 404) throw error;
        const s = String(season).padStart(2, "0");
        const e = String(episode).padStart(2, "0");
        unilog(1795, `tmdb 404, episode not found: ${showName} S${s}E${e}`);
      }
    }
    const episodeMs = Date.now() - episodeStartedAt;

    // Get guest actors (filter by known_for_department === "Acting")
    const guestActorList =
      episodeInfo.guest_stars?.filter(
        (actor) => actor.known_for_department === "Acting",
      ) || [];

    const [image, guests] = await Promise.all([
      episodeImage(ids, showName, season, episode),
      Promise.all(
        guestActorList.map(async (guest) => ({
          ...guest,
          image: await personImage(guest.name),
        })),
      ),
    ]);

    const totalMs = Date.now() - startedAt;
    if (totalMs >= SLOW_TMDB_MS) {
      unilog(1447, `slow getTmdb ${showName} S${season}E${episode}: ${totalMs}ms ` +
          `(searchTv ${searchMs}ms, episodeInfo ${episodeMs}ms, ${guestActorList.length} guests)`);
    }

    return {
      guests,
      image: image || null,
      overview: episodeInfo.overview ?? null,
      name: episodeInfo.name ?? null,
      aired: episodeInfo.air_date ?? null,
      runtime: episodeInfo.runtime ?? null,
    };
  } catch (error) {
    if (error.status === 404) {
      const s = String(season).padStart(2, "0");
      const e = String(episode).padStart(2, "0");
      unilog(2607, `tmdb 404, episode not found: ${showName} S${s}E${e}`);
    } else {
      unilog(1796, `getTmdb error: ${error.message}`);
    }
    throw new Error(`getTmdb error: ${error.message}`);
  }
}

/**
 * The landscape image for a tvapp show card (see images.js for the order it is
 * chosen in). url is empty when no provider has one, which is the caller's cue
 * to go on showing the poster.
 */
export async function getBackdrop(params) {
  const { showName } = params;
  return { url: await showImage("thumb", showIdsFor(params), showName) };
}

/**
 * Photos of people in one show, all chosen the same way (see images.js).
 * people is [{name, tvdbPeopleId?, tmdbPersonId?}]; season and episode, when
 * given, make them that episode's guests. Answers "" for anyone with no photo.
 */
// By name alone (see images.js).
export async function getPersonImages({ people }) {
  return Promise.all((people ?? []).map((person) => personImage(person.name)));
}

export async function getStreamProviders(params) {
  // The show by its own ids first; a search by name only when they find none.
  const tmdbId = await tmdbShowId(showIdsFor(params), params.showName);
  if (!tmdbId) {
    return { providers: [], error: "show not found" };
  }
  const match = { id: Number(tmdbId) };

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
