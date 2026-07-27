/* global document */
import { chromium } from "playwright";
import { franc } from "franc-min";
import { logHere, unilog } from "@tv/share";

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

// Review content lives on these light-DOM host elements as named-slot children.
// The .card-wrap markup once used for extraction is now only an empty
// shadow-root template on these hosts and carries no review data.
const CARD_SELECTOR = "review-card-audience, review-card-critic, review-card";

// A season page can take a few seconds to render its cards.
const CARD_WAIT_MS = 5000;

// The page loads its reviews from this JSON API. It answers 401 when Rotten
// Tomatoes is refusing us, which is how a block is told apart from a season
// that genuinely has no reviews (both render zero cards).
const REVIEWS_API_RE = /\/napi\/.*reviews/i;

// After a block, stop scraping entirely for this long so things can cool down.
const BLOCK_COOLDOWN_MS = 10 * 60 * 1000;
let blockedUntilMs = 0;

// Counters for working out how much scraping it takes to trip a block, and
// whether the past-the-last-season 404 probes are implicated. They ride along
// in the thrown message so every block is analysable from the logs.
let seasonLoadsSinceBlock = 0;
let notFoundLoadsSinceBlock = 0;
let lastBlockMs = 0;
let blockCount = 0;

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
async function scrapeSeasonReviews(page, season) {
  let seasonStats = {
    numChecked: 0,
    notEnglishCount: 0,
    noReviewCount: 0,
    smallTextCount: 0,
    reviews: [],
  };

  const MAX_CLICKS = 100; // Cap loop to prevent infinite loops, logical stop is reviews >= 50

  const cardsLocator = page.locator(CARD_SELECTOR);

  for (let i = 0; i < MAX_CLICKS; i++) {
    // 1. Extract Reviews
    const rawReviews = await cardsLocator.evaluateAll((cards) => {
      const results = [];

      cards.forEach((card) => {
        const nameEl = card.querySelector('[slot="name"]');
        const author = nameEl ? nameEl.innerText.trim() : "";

        const pubEl = card.querySelector('[slot="publication"]');
        const publication = pubEl ? pubEl.innerText.trim() : "";

        // Text: audience reviews nest the actual text in a [slot="content"]
        // span inside a <drawer-more>; critic reviews put it directly on the
        // [slot="review"] element.
        let text = "";
        const reviewSlot = card.querySelector('[slot="review"]');
        if (reviewSlot) {
          const contentEl = reviewSlot.querySelector('[slot="content"]');
          text = (contentEl || reviewSlot).innerText.trim();
        }

        // NumStars: audience reviews carry a numeric `score` attribute
        // directly on the [slot="rating"] element; critic reviews now mostly
        // show a fresh/rotten sentiment icon with no numeric score, but keep
        // the old "n/d" text fallback in case one is still rendered.
        let numStars = -1;
        const ratingEl = card.querySelector('[slot="rating"]');
        if (ratingEl) {
          const scoreEl = ratingEl.hasAttribute("score")
            ? ratingEl
            : ratingEl.querySelector("[score]");
          if (scoreEl) {
            const val = parseFloat(scoreEl.getAttribute("score"));
            if (!isNaN(val)) numStars = val;
          }

          if (numStars === -1) {
            const fullRatingText = ratingEl.innerText.trim();
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

        // URL: critic reviews link out via [slot="review-link"]; audience
        // reviews have no external link.
        let urlStr;
        const linkEl = card.querySelector('[slot="review-link"]');
        if (linkEl) urlStr = linkEl.getAttribute("href") || undefined;

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
          season,
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
      const previousCount = await cardsLocator.count();

      try {
        // Try force click first
        await loadMoreBtn.click({ force: true, timeout: 3000 });
      } catch {
        // If standard click fails, use JS dispatch
        await loadMoreBtn.dispatchEvent("click");
      }

      // Wait for items to actually be added (poll via the shadow-piercing
      // locator; page.waitForFunction can't see into the shadow root either).
      const loadMoreTimeoutMs = 3000;
      const pollIntervalMs = 100;
      const start = Date.now();
      let grew = false;
      while (Date.now() - start < loadMoreTimeoutMs) {
        if ((await cardsLocator.count()) > previousCount) {
          grew = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      if (!grew) {
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

  // Already-cached shows are still served above; only new scrapes are held off.
  if (Date.now() < blockedUntilMs) {
    const secsLeft = Math.ceil((blockedUntilMs - Date.now()) / 1000);
    throw new Error(
      `Rotten Tomatoes blocked review requests; cooling down for ${secsLeft}s`,
    );
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

  let sawBlocked = false;
  let blockedAtSeason = 0;
  page.on("response", (resp) => {
    if (resp.status() === 401 && REVIEWS_API_RE.test(resp.url())) {
      sawBlocked = true;
    }
  });

  const finalStats = {
    numChecked: 0,
    notEnglishCount: 0,
    noReviewCount: 0,
    smallTextCount: 0,
    // Page loads this scrape cost, so blocks can be correlated with volume.
    // review-calls.log records the whole result, so this lands in the log.
    seasonsScanned: 0,
    reviews: [],
  };

  const MAX_SEASONS = 50;

  try {
    // Scan season review pages incrementally (s01, s02, ...) until a season
    // fails to load or 404s (past the last season); only the last 50 reviews
    // found are returned.
    for (let season = 1; season <= MAX_SEASONS; season++) {
      const seasonUrl = `${cleanUrl}/s${String(season).padStart(2, "0")}/reviews/${sfxButtonName}`;

      let response;
      try {
        response = await page.goto(seasonUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
      } catch (err) {
        if (season === 1) {
          throw new Error(`Failed to load ${seasonUrl}: ${err.message}`);
        }
        break;
      }

      seasonLoadsSinceBlock++;

      // 404 means there is no such season, so the show has ended — stop here.
      // A season that loads fine but has no review cards is NOT the end: shows
      // routinely have a season with no reviews followed by seasons that do,
      // so keep scanning instead of stopping on an empty one.
      if (response && response.status() === 404) {
        notFoundLoadsSinceBlock++;
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
        .waitForSelector(CARD_SELECTOR, { timeout: CARD_WAIT_MS })
        .catch(() => {});

      // Refused: stop now rather than scanning more seasons while blocked.
      if (sawBlocked) {
        blockedAtSeason = season;
        break;
      }

      const seasonStats = await scrapeSeasonReviews(page, season);
      finalStats.seasonsScanned++;

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

  // Being blocked yields zero cards, which is indistinguishable from a show
  // with no reviews. Caching that would pin the show to "no reviews" for the
  // life of the process, so start a cooldown and fail instead of caching.
  if (sawBlocked) {
    blockCount++;
    const sinceLast = lastBlockMs
      ? `${Math.round((Date.now() - lastBlockMs) / 60000)} min since previous block`
      : "first block this process";
    // How much scraping preceded this block, and how much of it was the
    // past-the-last-season 404 probe, so the cooldown can be tuned and the
    // "404s look suspicious" theory checked against real numbers.
    const detail =
      `block #${blockCount} at season ${blockedAtSeason}, after ` +
      `${seasonLoadsSinceBlock} season loads (${notFoundLoadsSinceBlock} of them 404), ` +
      sinceLast;

    blockedUntilMs = Date.now() + BLOCK_COOLDOWN_MS;
    lastBlockMs = Date.now();
    seasonLoadsSinceBlock = 0;
    notFoundLoadsSinceBlock = 0;

    logHere(
      { lvl: "warn", grp: "rotten blocking" },
      `rotten reviews refused (401) for ${cleanUrl}: ${detail}; pausing scraping for ${BLOCK_COOLDOWN_MS / 60000} min`,
    );
    throw new Error(
      `Rotten Tomatoes blocked review requests (${detail}); cooling down for ${BLOCK_COOLDOWN_MS / 60000} min`,
    );
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
