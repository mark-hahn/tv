
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Singleton state
let browser = null;
let page = null;
let textById = new Map();

function hashText(text) {
  let hash = 0;
  if (!text || text.length === 0) return hash;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

export async function getReviews(rottenUrl, buttonName) {
  textById.clear();

  let sfxButtonName = 'all-critics';
  if (buttonName === 'Top critics') sfxButtonName = 'top-critics';
  else if (buttonName === 'All Audience') sfxButtonName = 'all-audience';
  else if (buttonName === 'Verified Audience') sfxButtonName = 'verified-audience';

  const cleanUrl = rottenUrl.replace(/\/$/, '');
  const reviewsUrl = `${cleanUrl}/s01/reviews/${sfxButtonName}`;

  if (!browser) {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }

  // Navigate
  try {
    await page.goto(reviewsUrl, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    throw new Error(`Failed to load ${reviewsUrl}: ${err.message}`);
  }

  // Handle Load More
  try {
    // Limit iterations to prevent infinite loops (e.g. 50 clicks max)
    const MAX_CLICKS = 50;
    for (let i = 0; i < MAX_CLICKS; i++) {
      // Find button by text "Load More". 
      // RT buttons are often <button>Load More</button>
      const loadMoreBtn = page.getByRole('button', { name: 'Load More', exact: true });
      if (await loadMoreBtn.isVisible()) {
        await loadMoreBtn.click();
        // Wait a bit for content to load. 
        // Better to wait for new cards, but simple timeout is safer given unknown DOM changes.
        await page.waitForTimeout(1500);
      } else {
        break;
      }
    }
  } catch (e) {
    console.error('[reviews] Load More error:', e);
  }

  // Save HTML
  try {
    const html = await page.content();
    // Path: /root/apps/tv/apps/api/test/reviews.html
    // __dirname is .../apps/api/src
    const outPath = path.resolve(__dirname, '..', 'test', 'reviews.html');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf8');
  } catch (e) {
    console.error('[reviews] Failed to save HTML:', e);
  }

  // Parse Reviews
  const reviews = await page.evaluate(() => {
    const cards = document.querySelectorAll('.reviews-cards .card-wrap');
    const results = [];

    cards.forEach(card => {
      // Author
      const authorEl = card.querySelector('.name-wrap');
      const author = authorEl ? authorEl.innerText.trim() : '';

      // Publication
      const pubEl = card.querySelector('.publication-wrap');
      const publication = pubEl ? pubEl.innerText.trim() : '';

      // Text
      // "text":"<string>" is a "<span slot=<string></span>"
      const spanSlot = card.querySelector('span[slot]');
      const text = spanSlot ? spanSlot.innerText.trim() : '';

      // NumStars
      let numStars = -1;
      const starGroup = card.querySelector('rating-stars-group');
      if (starGroup && starGroup.hasAttribute('score')) {
        const val = parseFloat(starGroup.getAttribute('score'));
        if (!isNaN(val)) numStars = val;
      } 
      
      if (numStars === -1) {
        // scan spans for style margin-top: 1.4px
        const spans = Array.from(card.querySelectorAll('span'));
        // style properties in JS are camelCase, but checking inline expectation
        // style="margin-top: 1.4px;" might mean checking attribute or computed style.
        // The user description is specific about HTML: <span style="margin-top: 1.4px;">
        // In DOM `el.style.marginTop` should be '1.4px'.
        const ratingSpan = spans.find(s => s.style.marginTop === '1.4px');
        if (ratingSpan) {
          const content = ratingSpan.innerText.trim();
          const parts = content.split('/'); 
          if (parts.length === 2) {
             const n = parseFloat(parts[0]);
             const d = parseFloat(parts[1]);
             if (!isNaN(n) && !isNaN(d) && d !== 0) {
               // round((<num> / <den>) * 10) / 2
               numStars = Math.round((n / d) * 10) / 2;
             }
          }
        }
      }

      // URL
      let urlStr = undefined;
      const anchors = Array.from(card.querySelectorAll('a'));
      const fullLink = anchors.find(a => a.innerText.includes('Go to Full Review'));
      if (fullLink) urlStr = fullLink.href;

      // More
      // "See More" button
      // Could be button or link
      const buttons = Array.from(card.querySelectorAll('button, a')); 
      const moreBtn = buttons.find(b => b.innerText.includes('See More'));
      const more = !!moreBtn;

      results.push({
        author,
        publication,
        text,
        numStars,
        url: urlStr,
        more
      });
    });
    return results;
  });

  // Add IDs and populate textById
  const processed = reviews.map(r => {
    // Simple hash
    let hash = 0;
    const s = r.text;
    if (s.length > 0) {
      for (let i = 0; i < s.length; i++) {
        const char = s.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; 
      }
    }
    const reviewId = hash;
    
    if (r.more) {
      textById.set(reviewId, r.text);
    }
    return { ...r, reviewId };
  });

  return processed;
}

export async function getRemainingReview(reviewId) {
  const id = parseInt(reviewId, 10);
  if (isNaN(id)) return null;

  const storedText = textById.get(id);
  // textById entry might be missing if server restarted or called logic error
  if (!storedText) return null;

  if (storedText.startsWith('~~')) {
    return storedText.substring(2);
  }

  if (!page) throw new Error('Browser page not initialized. Call getReviews first.');

  // Find card
  // We locate by the stored text.
  // Warning: if multiple reviews have identical text, this gets the first.
  const cardLocator = page.locator('.reviews-cards .card-wrap').filter({ hasText: storedText }).first();
  
  if (await cardLocator.count() === 0) {
    throw new Error(`Review card not found for id ${id}`);
  }

  const seeMoreBtn = cardLocator.getByText('See More');
  if (await seeMoreBtn.isVisible()) {
    await seeMoreBtn.click();
    await page.waitForTimeout(500); // Wait for expansion
  }

  // Get expanded text
  const textEl = cardLocator.locator('span[slot]');
  const expandedText = await textEl.innerText();

  textById.set(id, '~~' + expandedText);
  return expandedText; // User asked to return new expanded text
}
