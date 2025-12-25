import { chromium } from 'playwright';
import base64 from 'base64-js';
import fs from 'fs';

const theMan = Buffer.from('bXJza2lu', 'base64').toString();

function log(str) {
  console.log(str.replaceAll(theMan, 'theman'));
}

function writeFile(file, str) {
  fs.writeFileSync(file, str.replaceAll(theMan, 'plplpl'), 'utf8');
}

async function dump(page, name) {
  const html = await page.content();
  writeFile(`misc/${name}.html`, html);
  await page.screenshot({ path: `misc/${name}.png` });
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

////////////  home page and age gate ///////////

    const searchUrl = `https://www.${theMan}.com`;
    log('Navigating to:',  theMan, searchUrl);
    await page.goto(searchUrl);
    await page.click('#age-gate-agree a');
    await sleep(2000);
    await dump(page, 'age');

////////////  login ///////////

    const loginLink = page.locator(
      'a.login.trackable-link[data-trackable-name="Login"][href="/account/login"]:visible'
    );
    await loginLink.waitFor({ state: 'visible', timeout: 15000 });
    await loginLink.click();

    // This site opens a login modal (often without navigating).
    const loginForm = page.locator('form#new_customer, form[action*="/account/login"]').first();
    await loginForm.waitFor({ state: 'attached', timeout: 15000 });
    await sleep(1000);
    await dump(page, 'login');

    const bodyText = await page.textContent('body');
    log('Page contains actorName:', bodyText.includes(actorName));
    

    // Look for actor links in search results
    const links = await page.$$('a');
    log('Found', links.length, 'links on page');
    
    // Normalize the actor name for comparison
    const normalizedActorName = actorName.toLowerCase().trim();
    
    // Find a matching link
    for (const link of links) {
      const text = await link.textContent();
      const href = await link.getAttribute('href');
      
      if (href && text) {
        log('Link:', text.trim(), '->', href);
        
        const normalizedText = text.toLowerCase().trim();
        
        // Look for actor profile links
        if (href.includes('/') && !href.includes('search') && !href.includes('browse') && !href.startsWith('http')) {
          if (normalizedText.includes(normalizedActorName) || normalizedActorName.includes(normalizedText)) {
            const fullUrl = new URL(href, `https://www.${theMan}.com`).href;
            return { url: fullUrl };
          }
        }
      }
    }
    return { url: 'not found' };

  } catch (error) {
    console.error('getGRated error:', error);
    return { err: error.message };
  } finally {
    if (browser) await browser.close();
  }
}

// Testing call
(async () => {
  const result = await getGRatedImpl('lake bell');
  log('Testing getGRated("lake bell"):', result);
})();
