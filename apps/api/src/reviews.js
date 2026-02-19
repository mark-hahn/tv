import fs from "node:fs";
/* global document */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { franc } from "franc-min";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        timeout: 4000,
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
          await loadMoreBtn.click({ force: true, timeout: 5000 });
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
            { timeout: 5000 },
          );
        } catch (e) {
          // Fallback specific wait if count didn't change (rare but possible if only few new loaded or latency)
          await page.waitForTimeout(1500);
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

  // Use simple HTTP fetch - IMDB reviews are server-rendered
  let html;
  try {
    const response = await fetch(reviewsUrl, {
      headers: {
        "User-Agent": DEFAULT_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    html = await response.text();
  } catch (err) {
    throw new Error(`Failed to load ${reviewsUrl}: ${err.message}`);
  }

  // Log HTML to file for debugging
  try {
    await fs.promises.writeFile("/root/dev/apps/tv/temp.txt", html, "utf8");
    console.log("[IMDB] Logged HTML to /root/dev/apps/tv/temp.txt");
  } catch (err) {
    console.error("[IMDB] Failed to write HTML log:", err.message);
  }

  const rawReviews = [];
  const debugLog = [];

  debugLog.push(`=== IMDB Review Scraping Debug ===`);
  debugLog.push(`URL: ${reviewsUrl}`);
  debugLog.push(`HTML length: ${html.length} chars`);
  debugLog.push(`\n`);

  // Find all review cards using the ipc-list-card__content class
  const cardPattern =
    /<div[^>]*class="[^"]*ipc-list-card__content[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*ipc-list-card__content|$)/g;

  debugLog.push(`Pattern: Review Cards`);
  debugLog.push(`Regex: ${cardPattern.source}`);
  debugLog.push(`\n`);

  let cardMatch;
  let cardCount = 0;

  while ((cardMatch = cardPattern.exec(html)) !== null) {
    cardCount++;
    const cardContent = cardMatch[1];

    debugLog.push(`--- Card ${cardCount} ---`);
    debugLog.push(`Card content length: ${cardContent.length}`);

    // Extract rating from ipc-rating-star--rating class
    const ratingPattern =
      /<span[^>]*class="[^"]*ipc-rating-star--rating[^"]*"[^>]*>([^<]+)<\/span>/;
    const ratingMatch = cardContent.match(ratingPattern);
    const rating = ratingMatch ? parseFloat(ratingMatch[1].trim()) : -1;

    debugLog.push(`Rating pattern: ${ratingPattern.source}`);
    debugLog.push(`Rating match: ${ratingMatch ? ratingMatch[0] : "none"}`);
    debugLog.push(`Rating: ${rating}`);

    // Extract title from ipc-title__text class
    const titlePattern =
      /<h3[^>]*class="[^"]*ipc-title__text[^"]*"[^>]*>([^<]+)<\/h3>/;
    const titleMatch = cardContent.match(titlePattern);
    const title = titleMatch ? titleMatch[1].trim() : "";

    debugLog.push(`Title pattern: ${titlePattern.source}`);
    debugLog.push(`Title: ${title}`);

    // Extract review text from ipc-html-content-inner-div class
    const textPattern =
      /<div[^>]*class="[^"]*ipc-html-content-inner-div[^"]*"[^>]*>([\s\S]*?)<\/div>/;
    const textMatch = cardContent.match(textPattern);
    let text = "";
    if (textMatch) {
      // Strip HTML tags and decode entities
      text = textMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    }

    debugLog.push(`Text pattern: ${textPattern.source}`);
    debugLog.push(`Text match found: ${!!textMatch}`);
    debugLog.push(`Text length: ${text.length}`);
    if (text && text.length > 0) {
      debugLog.push(`Text preview: ${text.substring(0, 100)}...`);
    }

    // Extract author from ipc-link ipc-link--base class
    const authorPattern =
      /<a[^>]*class="[^"]*ipc-link[^"]*ipc-link--base[^"]*"[^>]*>([^<]+)<\/a>/;
    const authorMatch = cardContent.match(authorPattern);
    const author = authorMatch ? authorMatch[1].trim() : "Anonymous";

    debugLog.push(`Author pattern: ${authorPattern.source}`);
    debugLog.push(`Author: ${author}`);

    // Extract review ID from the card's Permalink link
    const reviewIdPattern = /\/review\/(rw\d+)\//;
    const reviewIdMatch = cardContent.match(reviewIdPattern);
    const reviewId = reviewIdMatch ? reviewIdMatch[1] : `review${cardCount}`;

    debugLog.push(`Review ID: ${reviewId}`);
    debugLog.push(`\n`);

    if (text && text.length >= 100 && rating !== -1) {
      rawReviews.push({
        author,
        publication: "IMDB User",
        text,
        numStars: rating / 2, // Convert 10-point to 5-point scale
        url: `https://www.imdb.com/review/${reviewId}/`,
      });
      debugLog.push(`✓ Added to rawReviews (count: ${rawReviews.length})`);
    } else {
      debugLog.push(
        `✗ Skipped - text too short (${text.length}) or no rating (${rating})`,
      );
    }
    debugLog.push(`\n`);

    // Stop if we have enough reviews
    if (rawReviews.length >= 60) break;
  }

  debugLog.push(`\n=== Summary ===`);
  debugLog.push(`Total cards found: ${cardCount}`);
  debugLog.push(`Raw reviews extracted: ${rawReviews.length}`);

  // Write debug log to file
  try {
    await fs.promises.writeFile(
      "/root/dev/apps/tv/temp2.txt",
      debugLog.join("\n"),
      "utf8",
    );
    console.log("[IMDB] Logged debug info to /root/dev/apps/tv/temp2.txt");
  } catch (err) {
    console.error("[IMDB] Failed to write debug log:", err.message);
  }

  // Filter and Stats
  const finalStats = {
    numChecked: 0,
    notEnglishCount: 0,
    noReviewCount: 0,
    smallTextCount: 0,
    reviews: [],
  };

  for (const r of rawReviews) {
    finalStats.numChecked++;

    let notEnglish = false;
    let noReview = false;
    let smallText = false;

    // Check conditions
    if (franc(r.text || "") !== "eng") notEnglish = true;
    if (r.numStars === -1) noReview = true;
    if ((r.text || "").length < 100) smallText = true;

    // Increment counts
    if (notEnglish) finalStats.notEnglishCount++;
    if (noReview) finalStats.noReviewCount++;
    if (smallText) finalStats.smallTextCount++;

    // Filter
    if (!notEnglish && !smallText) {
      finalStats.reviews.push({
        author: r.author,
        publication: r.publication,
        text: r.text,
        numStars: noReview ? -1 : r.numStars,
        url: r.url,
      });
    }
  }

  // Limit to 50 reviews
  if (finalStats.reviews.length > 50) {
    finalStats.reviews = finalStats.reviews.slice(0, 50);
  }

  // If total reviews is less than 2 return empty list
  if (finalStats.reviews.length < 2) {
    finalStats.reviews = [];
  }

  imdbReviewsCache.set(cacheKey, finalStats);

  return finalStats;
}
