import { chromium } from 'playwright';
import base64 from 'base64-js';
import fs from 'fs';

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

    await page.waitForTimeout(2000);
    // await page.waitForLoadState('networkidle')
    const html = await page.content();

    fs.writeFileSync('misc/grated.html', html, 'utf8');
    console.log('Wrote page HTML to misc/grated.html');
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'misc/grated-debug.png' });
    
    // Get page title and some content
    const title = await page.title();
    console.log('Page title:', title);

    const bodyText = await page.textContent('body');
    console.log('Page contains "Lake Bell":', bodyText.includes('Lake Bell'));
    

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
