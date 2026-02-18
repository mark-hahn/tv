/**
 * Scrapes IMDb for an actor's filmography and returns structured JSON
 * Combines scraping, parsing, and filtering into one module
 */

import { chromium } from "playwright";

// Words to filter out from roles (case-insensitive)
const FILTER_WORDS = [
  "director",
  "producer",
  "narrator",
  "host",
  "voice",
  "uncredited",
  "narrated",
  "various",
  "writer",
];

// Actor name matching logic
function matchActor(candidateName, searchName) {
  const normalize = (str) =>
    str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "");
  const normalizedCandidate = normalize(candidateName);
  const normalizedSearch = normalize(searchName);
  return (
    normalizedCandidate.includes(normalizedSearch) ||
    normalizedSearch.includes(normalizedCandidate)
  );
}

function extractAttribute(html, attrName, startTag = "") {
  const regex = new RegExp(`${startTag}[^>]*${attrName}="([^"]*)"`, "i");
  const match = html.match(regex);
  return match ? match[1] : null;
}

function parseCard(cardHtml) {
  const card = {};

  // Extract IMDb ID from data-testid or href
  const testId = extractAttribute(cardHtml, "data-testid");
  if (testId) {
    const idMatch = testId.match(/(tt\d+)/);
    if (idMatch) card.imdbId = idMatch[1];
  }

  if (!card.imdbId) {
    const buttonIdMatch = cardHtml.match(/id="(tt\d+)"/);
    if (buttonIdMatch) card.imdbId = buttonIdMatch[1];
  }

  if (!card.imdbId) {
    const hrefMatch = cardHtml.match(/href="\/title\/(tt\d+)/);
    if (hrefMatch) card.imdbId = hrefMatch[1];
  }

  // Extract title
  const titleMatch = cardHtml.match(
    /<a class="ipc-metadata-list-summary-item__t"[^>]*>([^<]+)<\/a>/,
  );
  if (titleMatch) card.title = titleMatch[1].trim();

  // Extract image URL and srcset
  const imgMatch = cardHtml.match(
    /<img[^>]*src="([^"]*)"[^>]*srcset="([^"]*)"/,
  );
  if (imgMatch) {
    card.imageUrl = imgMatch[1];
    card.imageSrcset = imgMatch[2];
  } else {
    const simpleImgMatch = cardHtml.match(/<img[^>]*src="([^"]*)"/);
    if (simpleImgMatch) {
      card.imageUrl = simpleImgMatch[1];
    }
  }

  // Extract rating
  const ratingMatch = cardHtml.match(
    /<span class="ipc-rating-star--rating">([^<]+)<\/span>/,
  );
  if (ratingMatch) {
    card.rating = parseFloat(ratingMatch[1]);
  }

  // Extract type (TV Series, TV Movie, etc.)
  const typeMatch = cardHtml.match(
    /<span>([^<]*(?:TV Series|TV Movie|TV Mini Series|Video|Short|Music Video))<\/span>/i,
  );
  if (typeMatch) {
    card.type = typeMatch[1].trim();
  }

  // Extract role/character
  const roleMatches = [];
  const roleRegex =
    /<li role="presentation" class="ipc-inline-list__item"><span class="ipc-btn--not-interactable"[^>]*>([^<]+)<\/span>(?:<span class="[^"]*">([^<]*)<\/span>)?<\/li>/g;
  let roleMatch;
  while ((roleMatch = roleRegex.exec(cardHtml)) !== null) {
    let role = roleMatch[1].trim();
    if (roleMatch[2]) {
      role += roleMatch[2].trim();
    }
    roleMatches.push(role);
  }

  // Filter out roles that are actually metadata (like years, episode counts)
  const roles = roleMatches.filter(
    (r) =>
      !r.match(/^\d{4}/) &&
      !r.match(/episode/) &&
      !r.includes("–") &&
      r !== "TV Series" &&
      r !== "TV Movie" &&
      r !== "Video" &&
      r !== "Short",
  );

  if (roles.length > 0) {
    card.role = roles[0];
  }

  // Extract year(s)
  const yearMatch = cardHtml.match(
    /<span class="ipc-metadata-list-summary-item__li[^"]*"[^>]*>(\d{4}(?:–\d{4})?)<\/span>/,
  );
  if (yearMatch) {
    card.year = yearMatch[1];
  }

  // Extract episode count
  const episodeMatch = cardHtml.match(/(\d+)\s+episode/i);
  if (episodeMatch) {
    card.episodeCount = parseInt(episodeMatch[1]);
  }

  // Extract all links
  card.links = [];
  const linkRegex = /href="([^"]*)"/g;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(cardHtml)) !== null) {
    const link = linkMatch[1];
    if (link && !link.startsWith("#") && !card.links.includes(link)) {
      card.links.push(link);
    }
  }

  // Extract status (Post-production, Pre-production, etc.)
  const statusMatch = cardHtml.match(
    /<span class="ipc-metadata-list-summary-item__li[^"]*"[^>]*>((?:Post-production|Pre-production|Completed|Production Unknown))<\/span>/i,
  );
  if (statusMatch) {
    card.status = statusMatch[1];
  }

  return card;
}

function shouldFilterOut(role) {
  if (!role) return false;
  const normalizedRole = role.toLowerCase();
  return FILTER_WORDS.some((word) => normalizedRole.includes(word));
}

async function getActorCredits(actorName, options = {}) {
  const { headless = true, verbose = false } = options;

  const log = (...args) => {
    if (verbose) console.log(...args);
  };

  log(`Scraping IMDb credits for: ${actorName}`);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to IMDb
    log("Navigating to IMDb...");
    await page.goto("https://www.imdb.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1000);

    // Search for actor
    log("Searching for actor...");
    const searchInput = await page.locator("#suggestion-search");
    await searchInput.waitFor({ state: "visible", timeout: 10000 });
    await searchInput.fill(actorName);
    await searchInput.press("Enter");

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Find best matching actor
    log("Finding best actor match...");
    await page.waitForTimeout(500);

    let actorLinks = await page
      .locator(
        '[data-testid="find-results-section-name"] a.ipc-metadata-list-summary-item__t',
      )
      .all();

    if (actorLinks.length === 0) {
      actorLinks = await page
        .locator('[data-testid="find-results-section-name"] a')
        .all();
    }

    let bestMatchLink = null;
    for (const link of actorLinks) {
      const linkText = await link.textContent();
      if (linkText && linkText.trim() && matchActor(linkText, actorName)) {
        log(`✓ Found match: ${linkText.trim()}`);
        bestMatchLink = link;
        break;
      }
    }

    if (!bestMatchLink) {
      const allLinks = await page.locator("a").all();
      for (const link of allLinks) {
        const linkText = await link.textContent();
        if (
          linkText &&
          linkText.trim().toLowerCase().includes(actorName.toLowerCase())
        ) {
          const href = await link.getAttribute("href");
          if (href && href.includes("/name/nm")) {
            bestMatchLink = link;
            break;
          }
        }
      }
    }

    if (!bestMatchLink) {
      throw new Error("Could not find matching actor");
    }

    // Click on actor name
    log("Clicking on actor...");
    await bestMatchLink.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
    
    // Capture actor page URL
    const actorPageUrl = page.url();

    // Find Actor filmography filter button
    log("Looking for Actor filmography filter...");
    const filterButtons = await page
      .locator('button[id*="imdb.concept.name_credit_category"]')
      .all();

    let actorButton = null;
    for (const button of filterButtons) {
      const buttonText = await button.textContent();
      if (buttonText && buttonText.includes("Actor")) {
        const buttonClass = await button.getAttribute("class");
        if (
          buttonClass &&
          (buttonClass.includes("selected") || buttonClass.includes("active"))
        ) {
          log("✓ Actor filter is already active");
          actorButton = button;
          break;
        }
        actorButton = button;
        break;
      }
    }

    if (!actorButton) {
      throw new Error("Could not find Actor filter button");
    }

    const buttonClass = await actorButton.getAttribute("class");
    const isAlreadyActive =
      buttonClass &&
      (buttonClass.includes("selected") || buttonClass.includes("active"));

    if (!isAlreadyActive) {
      await actorButton.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await actorButton.evaluate((button) => button.click());
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(1000);
    }

    // Click "See all" button to expand full filmography
    log("Looking for 'See all' button...");
    try {
      const seeAllButton = await page
        .locator('button:has-text("See all")')
        .first();
      const isVisible = await seeAllButton.isVisible({ timeout: 3000 });

      if (isVisible) {
        log("✓ Clicking 'See all' button");
        await seeAllButton.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await seeAllButton.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      log("  'See all' button not found");
    }

    // Scroll to load all content
    log("Scrolling to load all content...");
    let previousCardCount = 0;
    let unchangedCount = 0;

    for (let i = 0; i < 100; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);

      const currentCardCount = await page
        .locator(".ipc-metadata-list-summary-item")
        .count();

      if (currentCardCount === previousCardCount) {
        unchangedCount++;
        if (unchangedCount >= 3) {
          log(`✓ Loaded ${currentCardCount} cards`);
          break;
        }
      } else {
        unchangedCount = 0;
      }
      previousCardCount = currentCardCount;
    }

    // Extract cards
    log("Extracting and parsing cards...");
    const allCards = await page
      .locator(".ipc-metadata-list-summary-item")
      .all();

    // Filter to only Previous section (accord_2) and parse
    const cards = [];
    for (const card of allCards) {
      const html = await card.evaluate((el) => el.outerHTML);
      if (html.includes("accord_2") && !html.includes("accord_1_unrel")) {
        const parsed = parseCard(html);
        if (parsed.imdbId) {
          cards.push(parsed);
        }
      }
    }

    log(`✓ Parsed ${cards.length} cards from Previous section`);

    // Filter out non-acting roles
    const actingCredits = cards.filter((card) => {
      if (!card.role || !shouldFilterOut(card.role)) {
        return true;
      }
      log(`  Filtering out: ${card.title} (${card.role})`);
      return false;
    });

    log(`✓ Final count: ${actingCredits.length} acting credits`);

    return { credits: actingCredits, actorPageUrl };
  } catch (error) {
    console.error("Error scraping IMDb:", error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// For command-line usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const actorName = process.argv[2] || "Bryan Cranston";

  getActorCredits(actorName, { headless: false, verbose: true })
    .then((credits) => {
      console.log("\n=== RESULTS ===");
      console.log(JSON.stringify(credits, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error);
      process.exit(1);
    });
}

export { getActorCredits };
