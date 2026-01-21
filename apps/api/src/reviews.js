
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { franc } from 'franc-min';

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
    
    // Hide known overlays (OneTrust/GDPR, Login prompts) to ensure clicks work
    await page.addStyleTag({ content: `
      #onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter,
      .overlay-base, .modal-backdrop, [data-rtappmanager="overlayBase:close"] {
        display: none !important;
        pointer-events: none !important;
      }
    `});

    // Wait for at least one card to appear
    await page.waitForSelector('review-card, .reviews-cards .card-wrap', { timeout: 10000 }).catch(() => {});
  } catch (err) {
    throw new Error(`Failed to load ${reviewsUrl}: ${err.message}`);
  }

  // Handle Load More
  try {
    // Limit iterations to prevent infinite loops (e.g. 50 clicks max)
    const MAX_CLICKS = 5;
    for (let i = 0; i < MAX_CLICKS; i++) {
        // Find button by text "Load More". 
        // RT buttons are often <button>Load More</button>
        const loadMoreBtn = page.getByRole('button', { name: 'Load More', exact: true });

        // Force click if obscured by overlays (cookies/GDPR)
        if (await loadMoreBtn.isVisible()) {
            if (i === 0) console.log(`[reviews] Starting to load more reviews for ${buttonName}...`);
            process.stdout.write('.'); // progress indicator for user

            try {
                // Try force click first
                await loadMoreBtn.click({ force: true, timeout: 5000 });
            } catch {
                // If standard click fails, use JS dispatch
                await loadMoreBtn.dispatchEvent('click');
            }
            await page.waitForTimeout(1500);
        } else {
            break;
        }
    }
    if (MAX_CLICKS > 0) process.stdout.write('\n'); // newline after dots
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
    const oldCards = Array.from(document.querySelectorAll('.reviews-cards .card-wrap'));
    const newCards = Array.from(document.querySelectorAll('review-card'));
    const cards = [...oldCards, ...newCards];
    const results = [];

    cards.forEach(card => {
      let author = '';
      let publication = '';
      let text = '';
      let numStars = -1;
      let urlStr = undefined;
      let more = false;

      if (card.tagName.toLowerCase() === 'review-card') {
           // --- NEW STRUCTURE ---
           
           // Author
           const nameEl = card.querySelector('[slot="name"]');
           author = nameEl ? nameEl.innerText.trim() : '';

           // Publication
           const pubEl = card.querySelector('[slot="publication"]');
           publication = pubEl ? pubEl.innerText.trim() : '';

           // Text
           const textEl = card.querySelector('[slot="content"]');
           text = textEl ? textEl.innerText.trim() : '';

           // NumStars
           const ratingSlot = card.querySelector('[slot="rating"]');
           if (ratingSlot) {
               // Check for 'score' attribute (common in audience reviews)
               if (ratingSlot.hasAttribute('score')) {
                   const val = parseFloat(ratingSlot.getAttribute('score'));
                   if (!isNaN(val)) numStars = val;
               } 
               
               // Fallback: Try to find text that looks like a score (common in critic reviews)
               if (numStars === -1) {
                   const fullRatingText = ratingSlot.innerText.trim();
                   if (fullRatingText) {
                        const parts = fullRatingText.split('/'); 
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

           // More
           if (text.endsWith('...') || text.endsWith('…')) more = true;
           
      } else {
          // --- OLD STRUCTURE ---
          // Author
          const authorEl = card.querySelector('.name-wrap');
          author = authorEl ? authorEl.innerText.trim() : '';

          // Publication
          const pubEl = card.querySelector('.publication-wrap');
          publication = pubEl ? pubEl.innerText.trim() : '';

          // Text
          const spanSlot = card.querySelector('span[slot]');
          text = spanSlot ? spanSlot.innerText.trim() : '';

          // NumStars
          const starGroup = card.querySelector('rating-stars-group');
          if (starGroup && starGroup.hasAttribute('score')) {
            const val = parseFloat(starGroup.getAttribute('score'));
            if (!isNaN(val)) numStars = val;
          } 
          
          if (numStars === -1) {
            const spans = Array.from(card.querySelectorAll('span'));
            const ratingSpan = spans.find(s => s.style.marginTop === '1.4px');
            if (ratingSpan) {
              const content = ratingSpan.innerText.trim();
              const parts = content.split('/'); 
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
          const anchors = Array.from(card.querySelectorAll('a'));
          const fullLink = anchors.find(a => a.innerText.includes('Go to Full Review'));
          if (fullLink) urlStr = fullLink.href;

          // More
          const buttons = Array.from(card.querySelectorAll('button, a')); 
          const moreBtn = buttons.find(b => b.innerText.includes('See More'));
          more = !!moreBtn;
      }

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
  const processed = reviews.filter(r => {
    const lang = franc(r.text);
    return lang === 'eng' || lang === 'und';
  }).map(r => {
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
  const cardLocator = page.locator('review-card, .reviews-cards .card-wrap').filter({ hasText: storedText }).first();
  
  if (await cardLocator.count() === 0) {
    throw new Error(`Review card not found for id ${id}`);
  }

  const seeMoreBtn = cardLocator.getByText('See More');
  if (await seeMoreBtn.isVisible()) {
    await seeMoreBtn.click();
    await page.waitForTimeout(500); // Wait for expansion
  }

  // Get expanded text
  const textEl = cardLocator.locator('[slot="content"], span[slot]').first();
  const expandedText = await textEl.innerText();

  textById.set(id, '~~' + expandedText);
  return expandedText; // User asked to return new expanded text
}
