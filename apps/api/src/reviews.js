import { franc } from "franc-min";

const imdbReviewsCache = new Map();

// Caches live for the life of the process; cap them so memory can't grow
// without bound. Maps iterate in insertion order, so deleting the first key
// evicts the oldest entry.
const MAX_CACHE_ENTRIES = 100;
function capCache(map) {
  while (map.size >= MAX_CACHE_ENTRIES) {
    map.delete(map.keys().next().value);
  }
}

const IMDB_GQL_URL = "https://api.graphql.imdb.com/";
const IMDB_GQL_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function getImdbReviews(imdbId) {
  if (!imdbId || typeof imdbId !== "string") {
    throw new Error("Missing imdbId");
  }

  const cleanId = imdbId.replace(/^tt/, "");
  if (!/^\d+$/.test(cleanId)) {
    throw new Error(`Invalid imdbId: ${imdbId}`);
  }
  const titleId = `tt${cleanId}`;
  const cacheKey = titleId;

  if (imdbReviewsCache.has(cacheKey)) {
    return imdbReviewsCache.get(cacheKey);
  }

  const query = `{
    title(id: "${titleId}") {
      reviews(first: 50) {
        edges {
          node {
            id
            author { nickName }
            text { originalText { plainText } }
            authorRating
          }
        }
      }
    }
  }`;

  const res = await fetch(IMDB_GQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": IMDB_GQL_UA,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`IMDB GraphQL request failed: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`IMDB GraphQL error: ${json.errors[0].message}`);
  }

  const edges = json?.data?.title?.reviews?.edges || [];

  const stats = {
    numChecked: 0,
    notEnglishCount: 0,
    noReviewCount: 0,
    smallTextCount: 0,
    reviews: [],
  };

  for (const { node } of edges) {
    const text = node.text?.originalText?.plainText || "";
    const author = node.author?.nickName || "Anonymous";
    const numStarsRaw = node.authorRating ?? -1;
    const reviewId = node.id || "";

    stats.numChecked++;

    const notEnglish = franc(text) !== "eng";
    const noReview = numStarsRaw === -1;
    const smallText = text.length < 100;

    if (notEnglish) stats.notEnglishCount++;
    if (noReview) stats.noReviewCount++;
    if (smallText) stats.smallTextCount++;

    if (!notEnglish && !smallText) {
      stats.reviews.push({
        author,
        publication: "IMDB User",
        text,
        numStars: noReview ? -1 : numStarsRaw / 2, // 10-point to 5-point
        url: reviewId ? `https://www.imdb.com/review/${reviewId}/` : undefined,
      });
    }
  }

  if (stats.reviews.length < 2) {
    stats.reviews = [];
  }

  capCache(imdbReviewsCache);
  imdbReviewsCache.set(cacheKey, stats);

  return stats;
}
