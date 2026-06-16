import { smartTitleMatch } from "@tv/share";
import { MovieDb } from "moviedb-promise";
const moviedb = new MovieDb("327192a334da700f65b882c7a69cb927");

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
          console.log(
            "[tmdb] tvAggregateCredits method not found, using direct API call",
          );
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
        console.error("[tmdb] aggregate_credits error:", error.message);
        throw new Error(`aggregate_credits error: ${error.message}`);
      }
    }

    const res = await moviedb.searchTv({ query: showName });

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
      return matchingShow || null;
    }

    // Get episode information
    const episodeInfo = await moviedb.episodeInfo({
      id: showId,
      season_number: parseInt(season),
      episode_number: parseInt(episode),
    });

    // Get guest actors (filter by known_for_department === "Acting")
    const guestActorList =
      episodeInfo.guest_stars?.filter(
        (actor) => actor.known_for_department === "Acting",
      ) || [];

    // Fetch images for each guest actor and add to their object
    for (const actorInfo of guestActorList) {
      try {
        const personImages = await moviedb.personImages({
          id: actorInfo.id,
        });
        actorInfo.images = personImages;
      } catch (error) {
        console.error(
          `[tmdb] Failed to fetch images for ${actorInfo.name}:`,
          error.message,
        );
        actorInfo.images = null;
      }
    }

    console.log("[tmdb] Guest actor list with images:", guestActorList);

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
    console.error("[tmdb] getTmdb error:", error);
    throw new Error(`getTmdb error: ${error.message}`);
  }
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
    console.error("[tmdb] searchPerson error:", error.message);
    return null;
  }
}

export async function getStreamProviders(params) {
  let { showName, year } = params;
  console.log(
    `[tmdb] getStreamProviders called: showName="${showName}", year=${year || "none"}`,
  );

  // Strip trailing (YYYY) from show name and use as year if not already provided
  const yearMatch = String(showName || "").match(/\s*\((\d{4})\)$/);
  if (yearMatch) {
    if (!year) year = yearMatch[1];
    showName = showName.slice(0, showName.length - yearMatch[0].length).trim();
    console.log(
      `[tmdb] Extracted year from show name: "${showName}" (${year})`,
    );
  }

  const searchRes = await moviedb.searchTv({ query: showName });
  console.log(
    `[tmdb] TMDB searchTv returned ${searchRes.results?.length || 0} results`,
  );
  if (searchRes.results?.length > 0) {
    console.log(
      `[tmdb] TMDB results:`,
      searchRes.results.map((r) => ({
        name: r.name,
        original_name: r.original_name,
        first_air_date: r.first_air_date,
        id: r.id,
      })),
    );
  }

  // smartTitleMatch returns a string (the title), not the object
  let matchingTitle = smartTitleMatch(
    showName,
    searchRes.results || [],
    year,
    false,
  );
  console.log(
    `[tmdb] smartTitleMatch with year ${year || "none"}: ${matchingTitle ? `found "${matchingTitle}"` : "no match"}`,
  );
  if (!matchingTitle && year) {
    console.log("[tmdb] No match with year, retrying without year");
    matchingTitle = smartTitleMatch(
      showName,
      searchRes.results || [],
      null,
      false,
    );
    console.log(
      `[tmdb] smartTitleMatch without year: ${matchingTitle ? `found "${matchingTitle}"` : "no match"}`,
    );
  }
  if (!matchingTitle) {
    console.log(`[tmdb] No match found for "${showName}"`);
    return { providers: [], error: "show not found" };
  }

  // Find the actual show object that matches the title
  const match = searchRes.results.find(
    (show) =>
      show.name === matchingTitle || show.original_name === matchingTitle,
  );
  if (!match?.id) {
    console.log(
      `[tmdb] Found title "${matchingTitle}" but couldn't find object in results`,
    );
    return { providers: [], error: "show not found" };
  }
  console.log(
    `[tmdb] Matched show: "${match.name || match.original_name}" (id: ${match.id})`,
  );

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
  console.log(
    `[tmdb] Returning ${providers.length} providers, tmdbLink: ${tmdbLink || "none"}, tmdbId: ${match.id}`,
  );
  return { providers, tmdbLink, tmdbId: match.id };
}
