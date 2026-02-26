import fs from "node:fs";
/* global document */
import path from "node:path";
import { chromium } from "playwright";
import { franc } from "franc-min";

// Singleton browser (contexts/pages are per-request to avoid concurrent navigation issues).
let browser = null;

const reviewsCache = new Map();
const imdbReviewsCache = new Map();

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

export async function getReviews(rottenUrl, buttonName) {
  let sfxButtonName = "all-critics";
  if (buttonName === "Audience") sfxButtonName = "all-audience";

  if (!rottenUrl || typeof rottenUrl !== "string") {
    throw new Error("Missing rottenUrl");
  }

  const cleanUrl = rottenUrl.replace(/\/$/, "");
  const reviewsUrl = `${cleanUrl}/s01/reviews/${sfxButtonName}`;
  const cacheKey = reviewsUrl;

  if (reviewsCache.has(cacheKey)) {
    // console.log("[reviews] returning cached: ", cacheKey);
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

  // Navigate
  try {
    await page.goto(reviewsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

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
  } catch (err) {
    try {
      await context.close();
    } catch {}
    throw new Error(`Failed to load ${reviewsUrl}: ${err.message}`);
  }

  let finalStats = {
    numChecked: 0,
    notEnglishCount: 0,
    noReviewCount: 0,
    smallTextCount: 0,
    reviews: [],
  };

  const MAX_CLICKS = 100; // Cap loop to prevent infinite loops, logical stop is reviews >= 50

  try {
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
              const ratingSpan = spans.find(
                (s) => s.style.marginTop === "1.4px",
              );
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

      // 2. Filter and Stats
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

      finalStats = currentStats;

      // Stop condition
      if (finalStats.reviews.length >= 50) {
        break;
      }

      // 3. Load More
      const loadMoreBtn = page.getByRole("button", {
        name: "Load More",
        exact: true,
      });

      // Force click if obscured by overlays (cookies/GDPR)
      if (await loadMoreBtn.isVisible()) {
        // if (i === 0)
        // console.log(`[reviews] Loading more reviews for ${buttonName}...`);

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
              document.querySelectorAll(
                "review-card, .reviews-cards .card-wrap",
              ).length > prev,
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
  } catch (e) {
    console.error("[reviews] Processing error:", e);
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

  // If total reviews is less than 2 return empty list
  if (finalStats.reviews.length < 2) {
    finalStats.reviews = [];
  }

  // Cache strict results only if we have some data, OR if we successfully loaded the page but found none.
  // We prefer caching emptiness over refetching emptiness.
  reviewsCache.set(cacheKey, finalStats);

  return finalStats;
}

export async function getImdbReviews(imdbId) {
  if (!imdbId || typeof imdbId !== "string") {
    throw new Error("Missing imdbId");
  }

  // Clean imdbId (remove "tt" prefix if present, then add it back)
  const cleanId = imdbId.replace(/^tt/, "");
  const reviewsUrl = `https://www.imdb.com/title/tt${cleanId}/reviews/`;
  const cacheKey = reviewsUrl;

  if (imdbReviewsCache.has(cacheKey)) {
    return imdbReviewsCache.get(cacheKey);
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

  // Navigate
  try {
    await page.goto(reviewsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // Wait for at least one review card to appear
    await page
      .waitForSelector(".ipc-list-card__content", {
        timeout: 3000,
      })
      .catch(() => {});
  } catch (err) {
    try {
      await context.close();
    } catch {}
    throw new Error(`Failed to load ${reviewsUrl}: ${err.message}`);
  }

  let finalStats = {
    numChecked: 0,
    notEnglishCount: 0,
    noReviewCount: 0,
    smallTextCount: 0,
    reviews: [],
  };

  try {
    // Click "See all" button to load all reviews at once
    const seeAllBtn = page.locator("button.ipc-see-more__button").first();

    try {
      await seeAllBtn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      await seeAllBtn.click({ timeout: 3000, force: true });
      await page.waitForTimeout(1500);
    } catch (err) {
      // Continue with initial reviews if See all button fails
    }

    // Extract all reviews (now that they're all loaded)
    const rawReviews = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll(".ipc-list-card__content"),
      );
      const results = [];

      cards.forEach((card) => {
        let author = "";
        let text = "";
        let numStars = -1;
        let reviewId = "";

        // Extract rating from ipc-rating-star--rating class
        const ratingEl = card.querySelector(".ipc-rating-star--rating");
        if (ratingEl) {
          const rating = parseFloat(ratingEl.textContent.trim());
          if (!isNaN(rating)) {
            numStars = rating; // Already 10-point scale
          }
        }

        // Extract author from rating star's aria-label
        // Format: "username's rating: X" or "A_username's rating: X"
        const ratingStarEl = card.querySelector(".ipc-rating-star[aria-label]");
        if (ratingStarEl) {
          const ariaLabel = ratingStarEl.getAttribute("aria-label");
          if (ariaLabel) {
            const match = ariaLabel.match(/^(.+?)'s rating:/);
            if (match) {
              author = match[1].trim();
            }
          }
        }

        // Extract review text from ipc-html-content-inner-div class
        const textEl = card.querySelector(".ipc-html-content-inner-div");
        if (textEl) {
          text = textEl.textContent.trim();
        }

        // Extract review ID from Permalink link
        const linkEl = card.querySelector('a[href*="/review/"]');
        if (linkEl) {
          const match = linkEl.href.match(/\/review\/(rw\d+)\//);
          if (match) {
            reviewId = match[1];
          }
        }

        results.push({
          author,
          text,
          numStars,
          reviewId,
        });
      });
      return results;
    });

    // Filter and Stats
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
          author: r.author || "Anonymous",
          publication: "IMDB User",
          text: r.text,
          numStars: noReview ? -1 : r.numStars / 2, // Convert 10-point to 5-point scale
          url: r.reviewId
            ? `https://www.imdb.com/review/${r.reviewId}/`
            : undefined,
        });
      }
    }

    finalStats = currentStats;
  } catch (e) {
    console.error("[imdb reviews] Processing error:", e);
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

  // If total reviews is less than 2 return empty list
  if (finalStats.reviews.length < 2) {
    finalStats.reviews = [];
  }

  imdbReviewsCache.set(cacheKey, finalStats);

  return finalStats;
}
