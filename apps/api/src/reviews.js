/* global document */
import { chromium } from "playwright";
import { franc } from "franc-min";
import { unilog } from "@tv/share";

// Singleton browser (contexts/pages are per-request to avoid concurrent navigation issues).
let browser = null;

const reviewsCache = new Map();
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

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function getBrowser() {
  try {
    if (
      browser &&
      typeof browser.isConnected === "function" &&
      browser.isConnected()
    )
      return browser;
  } catch {
    // ignore
  }

  try {
    if (browser) await browser.close();
  } catch {
    // ignore
  }

  browser = await chromium.launch({ headless: true });
  return browser;
}

// Scrape one already-loaded season reviews page: extract cards, filter/count,
// and click "Load More" until the season yields >= 50 reviews or no more load.
// Returns that season's stats { numChecked, notEnglishCount, noReviewCount,
// smallTextCount, reviews }.
async function scrapeSeasonReviews(page) {
  let seasonStats = {
    numChecked: 0,
    notEnglishCount: 0,
    noReviewCount: 0,
    smallTextCount: 0,
    reviews: [],
  };

  const MAX_CLICKS = 100; // Cap loop to prevent infinite loops, logical stop is reviews >= 50

  for (let i = 0; i < MAX_CLICKS; i++) {
    // 1. Extract Reviews
    const rawReviews = await page.evaluate(() => {
      const oldCards = Array.from(
        document.querySelectorAll(".reviews-cards .card-wrap"),
      );
      const newCards = Array.from(document.querySelectorAll("review-card"));
      const cards = [...oldCards, ...newCards];
      const results = [];

      cards.forEach((card) => {
        let author = "";
        let publication = "";
        let text = "";
        let numStars = -1;
        let urlStr = undefined;

        if (card.tagName.toLowerCase() === "review-card") {
          // --- NEW STRUCTURE ---

          // Author
          const nameEl = card.querySelector('[slot="name"]');
          author = nameEl ? nameEl.innerText.trim() : "";

          // Publication
          const pubEl = card.querySelector('[slot="publication"]');
          publication = pubEl ? pubEl.innerText.trim() : "";

          // Text
          const textEl = card.querySelector('[slot="content"]');
          text = textEl ? textEl.innerText.trim() : "";

          // NumStars
          const ratingSlot = card.querySelector('[slot="rating"]');
          if (ratingSlot) {
            // Check for 'score' attribute (common in audience reviews)
            if (ratingSlot.hasAttribute("score")) {
              const val = parseFloat(ratingSlot.getAttribute("score"));
              if (!isNaN(val)) numStars = val;
            }

            // Fallback: Try to find text that looks like a score (common in critic reviews)
            if (numStars === -1) {
              const fullRatingText = ratingSlot.innerText.trim();
              if (fullRatingText) {
                const parts = fullRatingText.split("/");
                if (parts.length === 2) {
                  const n = parseFloat(parts[0]);
                  const d = parseFloat(parts[1]);
                  if (!isNaN(n) && !isNaN(d) && d !== 0) {
                    numStars = Math.round((n / d) * 10) / 2;
                  }
                }
              }
            }
          }

          // URL
          const linkEl = card.querySelector('[slot="reviewLink"]');
          if (linkEl) urlStr = linkEl.href;
        } else {
          // --- OLD STRUCTURE ---
          // Author
          const authorEl = card.querySelector(".name-wrap");
          author = authorEl ? authorEl.innerText.trim() : "";

          // Publication
          const pubEl = card.querySelector(".publication-wrap");
          publication = pubEl ? pubEl.innerText.trim() : "";

          // Text
          const spanSlot = card.querySelector("span[slot]");
          text = spanSlot ? spanSlot.innerText.trim() : "";

          // NumStars
          const starGroup = card.querySelector("rating-stars-group");
          if (starGroup && starGroup.hasAttribute("score")) {
            const val = parseFloat(starGroup.getAttribute("score"));
            if (!isNaN(val)) numStars = val;
          }

          if (numStars === -1) {
            const spans = Array.from(card.querySelectorAll("span"));
            const ratingSpan = spans.find((s) => s.style.marginTop === "1.4px");
            if (ratingSpan) {
              const content = ratingSpan.innerText.trim();
              const parts = content.split("/");
              if (parts.length === 2) {
                const n = parseFloat(parts[0]);
                const d = parseFloat(parts[1]);
                if (!isNaN(n) && !isNaN(d) && d !== 0) {
                  numStars = Math.round((n / d) * 10) / 2;
                }
              }
            }
          }

          // URL
          const anchors = Array.from(card.querySelectorAll("a"));
          const fullLink = anchors.find((a) =>
            a.innerText.includes("Go to Full Review"),
          );
          if (fullLink) urlStr = fullLink.href;
        }

        results.push({
          author,
          publication,
          text,
          numStars,
          url: urlStr,
        });
      });
      return results;
    });

    // 2. Filter and Stats — recomputed from all cards currently on the page.
    let currentStats = {
      numChecked: 0,
      notEnglishCount: 0,
      noReviewCount: 0,
      smallTextCount: 0,
      reviews: [],
    };

    for (const r of rawReviews) {
      currentStats.numChecked++;

      let notEnglish = false;
      let noReview = false;
      let smallText = false;

      // Check conditions
      if (franc(r.text || "") !== "eng") notEnglish = true;
      if (r.numStars === -1) noReview = true;
      if ((r.text || "").length < 100) smallText = true;

      // Increment counts
      if (notEnglish) currentStats.notEnglishCount++;
      if (noReview) currentStats.noReviewCount++;
      if (smallText) currentStats.smallTextCount++;

      // Filter
      if (!notEnglish && !smallText) {
        currentStats.reviews.push({
          author: r.author,
          publication: r.publication,
          text: r.text,
          numStars: noReview ? -1 : r.numStars,
          url: r.url,
        });
      }
    }

    seasonStats = currentStats;

    // Stop condition
    if (seasonStats.reviews.length >= 50) {
      break;
    }

    // 3. Load More
    const loadMoreBtn = page.getByRole("button", {
      name: "Load More",
      exact: true,
    });

    // Force click if obscured by overlays (cookies/GDPR)
    if (await loadMoreBtn.isVisible()) {
      const previousCount = await page.evaluate(
        () =>
          document.querySelectorAll("review-card, .reviews-cards .card-wrap")
            .length,
      );

      try {
        // Try force click first
        await loadMoreBtn.click({ force: true, timeout: 3000 });
      } catch {
        // If standard click fails, use JS dispatch
        await loadMoreBtn.dispatchEvent("click");
      }

      // Wait for items to actually be added
      try {
        await page.waitForFunction(
          (prev) =>
            document.querySelectorAll("review-card, .reviews-cards .card-wrap")
              .length > prev,
          previousCount,
          { timeout: 3000 },
        );
      } catch (e) {
        // If no new items loaded, break out
        break;
      }
    } else {
      // No more button
      break;
    }
  }

  return seasonStats;
}

export async function getReviews(rottenUrl, buttonName) {
  let sfxButtonName = "all-critics";
  if (buttonName === "Audience") sfxButtonName = "all-audience";

  if (!rottenUrl || typeof rottenUrl !== "string") {
    throw new Error("Missing rottenUrl");
  }

  const cleanUrl = rottenUrl.replace(/\/$/, "");
  const cacheKey = `${cleanUrl}|${sfxButtonName}`;

  if (reviewsCache.has(cacheKey)) {
    return reviewsCache.get(cacheKey);
  }

  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: DEFAULT_UA,
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const page = await context.newPage();

  const finalStats = {
    numChecked: 0,
    notEnglishCount: 0,
    noReviewCount: 0,
    smallTextCount: 0,
    reviews: [],
  };

  const MAX_SEASONS = 50;

  try {
    // Scan season review pages incrementally (s01, s02, ...) until a season
    // fails to load or yields no review cards; only the last 50 reviews found
    // are returned.
    for (let season = 1; season <= MAX_SEASONS; season++) {
      const seasonUrl = `${cleanUrl}/s${String(season).padStart(2, "0")}/reviews/${sfxButtonName}`;

      try {
        await page.goto(seasonUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
      } catch (err) {
        if (season === 1) {
          throw new Error(`Failed to load ${seasonUrl}: ${err.message}`);
        }
        break;
      }

      // Hide known overlays (OneTrust/GDPR, Login prompts) to ensure clicks work
      await page.addStyleTag({
        content: `
        #onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter,
        .overlay-base, .modal-backdrop, [data-rtappmanager="overlayBase:close"] {
          display: none !important;
          pointer-events: none !important;
        }
      `,
      });

      // Wait for at least one card to appear
      await page
        .waitForSelector("review-card, .reviews-cards .card-wrap", {
          timeout: 3000,
        })
        .catch(() => {});

      const seasonStats = await scrapeSeasonReviews(page);
      // No cards at all = bad response (past the last season) — stop scanning.
      if (seasonStats.numChecked === 0) break;

      finalStats.numChecked += seasonStats.numChecked;
      finalStats.notEnglishCount += seasonStats.notEnglishCount;
      finalStats.noReviewCount += seasonStats.noReviewCount;
      finalStats.smallTextCount += seasonStats.smallTextCount;
      finalStats.reviews.push(...seasonStats.reviews);
    }
  } catch (e) {
    unilog(168, "Processing error:", e);
    // If we hit a hard Playwright/browser failure, reset so next request relaunches cleanly.
    try {
      if (browser) await browser.close();
    } catch {}
    browser = null;
    throw e;
  } finally {
    try {
      await context.close();
    } catch {}
  }

  // Only the most recent 50 reviews (later seasons win).
  finalStats.reviews = finalStats.reviews.slice(-50);

  // If total reviews is less than 2 return empty list
  if (finalStats.reviews.length < 2) {
    finalStats.reviews = [];
  }

  // Cache strict results only if we have some data, OR if we successfully loaded the page but found none.
  // We prefer caching emptiness over refetching emptiness.
  capCache(reviewsCache);
  reviewsCache.set(cacheKey, finalStats);

  return finalStats;
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
