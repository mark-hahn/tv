// An actor's filmography, from TMDB.
//
// This was scraped off IMDb until IMDb started answering the server with an
// AWS WAF "let's confirm you are human" page, which no browser we drive can
// get past -- the same wall that already moved ratings onto IMDB's published
// dataset. TMDB's person credits are the same filmography over an ordinary
// JSON API, so no browser is involved at all now.

import { logHere, unilog} from "@tv/share"

const TMDB_API_KEY = "327192a334da700f65b882c7a69cb927";
const TMDB_URL = "https://api.themoviedb.org/3";
const TMDB_IMG_URL = "https://image.tmdb.org/t/p/";
// the card shows a 80x120 poster; the 2x source is for hidpi screens
const POSTER_WIDTH = "w154";
const POSTER_WIDTH_2X = "w342";
const IMDB_NAME_URL = "https://www.imdb.com/name/";
const REQUEST_TIMEOUT_MS = 15000;

// Roles that are appearances rather than parts, dropped as the IMDb scrape
// dropped them so the list reads the same as it did before.
const FILTER_WORDS = [
  "narrator",
  "host",
  "voice",
  "uncredited",
  "narrated",
  "various",
  "self",
];

const normalizeName = (str) =>
  String(str ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");

async function tmdbGet(path, params = {}) {
  const query = new URLSearchParams({ ...params, api_key: TMDB_API_KEY });
  const resp = await fetch(`${TMDB_URL}${path}?${query}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`TMDB ${path} → ${resp.status}`);
  return resp.json();
}

// The person TMDB's search means by this name: an exact name match first, then
// whoever TMDB ranked highest among actors, then whoever it ranked highest.
function pickPerson(results, actorName) {
  const wanted = normalizeName(actorName);
  return (
    results.find((p) => normalizeName(p.name) === wanted) ||
    results.find((p) => p.known_for_department === "Acting") ||
    results[0] ||
    null
  );
}

function shouldFilterOut(role) {
  if (!role) return false;
  const normalizedRole = role.toLowerCase();
  return FILTER_WORDS.some((word) => normalizedRole.includes(word));
}

function creditYear(credit) {
  const date = credit.media_type === "movie"
    ? credit.release_date
    : credit.first_air_date;
  return String(date ?? "").slice(0, 4);
}

function posterUrls(posterPath) {
  if (!posterPath) return {};
  return {
    imageUrl: `${TMDB_IMG_URL}${POSTER_WIDTH}${posterPath}`,
    imageSrcset:
      `${TMDB_IMG_URL}${POSTER_WIDTH}${posterPath} 1x, ` +
      `${TMDB_IMG_URL}${POSTER_WIDTH_2X}${posterPath} 2x`,
  };
}

function toCard(credit) {
  const rating = Number(credit.vote_average);
  return {
    tmdbId: credit.id,
    mediaType: credit.media_type,
    title: credit.name || credit.title,
    year: creditYear(credit),
    episodeCount: credit.episode_count || null,
    rating: rating > 0 ? Math.round(rating * 10) / 10 : null,
    role: credit.character || null,
    ...posterUrls(credit.poster_path),
  };
}

// TMDB lists a show once per character an actor played in it, which the cards
// have no way to tell apart -- keep the one crediting the most episodes.
function dedupeByTitle(cards) {
  const byId = new Map();
  for (const card of cards) {
    const key = `${card.mediaType}:${card.tmdbId}`;
    const seen = byId.get(key);
    if (!seen || (card.episodeCount ?? 0) > (seen.episodeCount ?? 0)) {
      byId.set(key, card);
    }
  }
  return [...byId.values()];
}

async function getActorCredits(actorName) {
  unilog(2199, `getting tmdb credits for ${actorName}`);

  const search = await tmdbGet("/search/person", { query: actorName });
  const person = pickPerson(search.results || [], actorName);
  if (!person) throw new Error(`Could not find matching actor: ${actorName}`);

  const [credits, externalIds] = await Promise.all([
    tmdbGet(`/person/${person.id}/combined_credits`),
    // only for the IMDb button on the actor card -- a person page a human
    // opens in their own browser, which the bot wall never sees
    tmdbGet(`/person/${person.id}/external_ids`).catch((e) => {
      unilog(2200, `imdb id lookup failed for ${actorName}: ${e.message}`);
      return {};
    }),
  ]);

  const cast = Array.isArray(credits.cast) ? credits.cast : [];
  const released = cast.filter((credit) => creditYear(credit));
  const acting = released.filter((credit) => !shouldFilterOut(credit.character));
  const cards = dedupeByTitle(acting.map(toCard));
  // newest first, as the IMDb filmography was ordered
  cards.sort((a, b) => Number(b.year) - Number(a.year));

  unilog(2201, `${cards.length} credits for ${actorName}`);

  const actorPageUrl = externalIds.imdb_id
    ? `${IMDB_NAME_URL}${externalIds.imdb_id}/`
    : null;
  return { credits: cards, actorPageUrl };
}

export { getActorCredits };
