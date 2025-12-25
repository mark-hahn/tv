import { chromium } from 'playwright';
import base64 from 'base64-js';
import fs from 'fs';

// log(base64.b64encode("mrskin".encode()).decode());
// process.exit(0);

function getTheMan() {
  const theMan = Buffer.from('bXJza2lu', 'base64').toString();
  console.log('Decoded theMan:', theMan);
  return theMan;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getGRated(id, param, resolve, reject) {
  try {
    const result = await getGRatedImpl(param);
    resolve([id, result]);
  } catch (error) {
    reject([id, 'getGRated error: ' + error.message]);
  }
}

async function getGRatedImpl(actorName) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    
    const searchUrl = `https://www.${getTheMan()}.com`;
    console.log('Navigating to:',  getTheMan(), searchUrl);
    await page.goto(searchUrl);
    
    await page.click('#age-gate-agree a');

    const html = await page.content();
    fs.writeFileSync('misc/grated.html', html, 'utf8');
    console.log('Wrote page HTML to misc/grated.html');
    
    
    // Handle age gate if present
    try {
      await page.waitForTimeout(2000);
      
      const ageSelectors = [
        'button:has-text("I\'m more than")',
        'button:has-text("Enter")',
        'button:has-text("Yes")',
        '.age-gate-modal button',
        '[data-testid="age-gate-confirm"]',
        '.confirm-age'
      ];
      
      for (const selector of ageSelectors) {
        try {
          await page.click(selector, { timeout: 2000 });
          console.log('Clicked age gate with:', selector);
          break;
        } catch (e) {
          // Try next selector
        }
      }
      
      await page.waitForTimeout(1000);
      
    } catch (e) {
      console.log('Age gate handling completed or not present');
    }

    // Take a screenshot for debugging
    await page.screenshot({ path: 'grated-debug.png' });
    
    await sleep(2000);

    // Get page title and some content
    const title = await page.title();
    console.log('Page title:', title);
    
    await sleep(2000);

    const bodyText = await page.textContent('body');
    console.log('Page contains "Lake Bell":', bodyText.includes('Lake Bell'));
    
    await sleep(2000);

    // Look for actor links in search results
    const links = await page.$$('a');
    console.log('Found', links.length, 'links on page');
    
    // Normalize the actor name for comparison
    const normalizedActorName = actorName.toLowerCase().trim();
    
    // Find a matching link
    for (const link of links) {
      const text = await link.textContent();
      const href = await link.getAttribute('href');
      
      if (href && text) {
        console.log('Link:', text.trim(), '->', href);
        
        const normalizedText = text.toLowerCase().trim();
        
        // Look for actor profile links
        if (href.includes('/') && !href.includes('search') && !href.includes('browse') && !href.startsWith('http')) {
          if (normalizedText.includes(normalizedActorName) || normalizedActorName.includes(normalizedText)) {
            const fullUrl = new URL(href, `https://www.${getTheMan()}.com`).href;
            return { url: fullUrl };
          }
        }
      }
    }
    
    // No match found
    return { url: 'not found' };
    
  } catch (error) {
    console.error('getGRated error:', error);
    return { err: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Testing call
(async () => {
  const result = await getGRatedImpl('lake bell');
  console.log('Testing getGRated("lake bell"):', result);
})();
