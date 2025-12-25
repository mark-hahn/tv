import { chromium } from 'playwright';

export async function getMrskin(id, param, resolve, reject) {
  try {
    const result = await getMrskinImpl(param);
    resolve([id, result]);
  } catch (error) {
    reject([id, 'getMrskin error: ' + error.message]);
  }
}

async function getMrskinImpl(actorName) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Try direct search URL
    const searchUrl = `https://www.mrskin.com/search?q=${encodeURIComponent(actorName)}`;
    console.log('Navigating to:', searchUrl);
    await page.goto(searchUrl);
    
    // Handle age gate if present
    try {
      await page.waitForTimeout(2000);
      
      const ageSelectors = [
        'button:has-text("I am 18")',
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
    await page.screenshot({ path: 'mrskin-debug.png' });
    
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
            const fullUrl = new URL(href, 'https://www.mrskin.com').href;
            return { url: fullUrl };
          }
        }
      }
    }
    
    // No match found
    return { url: 'not found' };
    
  } catch (error) {
    console.error('getMrskin error:', error);
    return { err: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Testing call
(async () => {
  const result = await getMrskinImpl('lake bell');
  console.log('Testing getMrskin("lake bell"):', result);
})();
