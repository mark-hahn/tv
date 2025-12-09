import { firefox } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const COOKIES_DIR = './cookies';

// Ensure cookies directory exists
if (!fs.existsSync(COOKIES_DIR)) {
  fs.mkdirSync(COOKIES_DIR, { recursive: true });
}

/**
 * Save cookies to file
 */
async function saveCookies(context, filename) {
  const cookies = await context.cookies();
  const filepath = path.join(COOKIES_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(cookies, null, 2));
  console.log(`Cookies saved to ${filepath}`);
}

/**
 * Load cookies from file
 */
function loadCookies(filename) {
  const filepath = path.join(COOKIES_DIR, filename);
  if (fs.existsSync(filepath)) {
    const cookies = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    console.log(`Loaded ${cookies.length} cookies from ${filepath}`);
    return cookies;
  }
  return null;
}

/**
 * Check if cookies are still valid
 */
function areCookiesValid(filename, maxAgeHours = 24) {
  const filepath = path.join(COOKIES_DIR, filename);
  if (!fs.existsSync(filepath)) return false;
  
  const stats = fs.statSync(filepath);
  const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
  return ageHours < maxAgeHours;
}

/**
 * Manually solve Cloudflare and save cookies
 * This function opens a browser for you to manually pass Cloudflare
 */
async function manualLogin(site) {
  console.log(`\n=== Manual Login for ${site} ===`);
  console.log('Browser will open. Please:');
  console.log('1. Log in to the site');
  console.log('2. Pass any Cloudflare challenges');
  console.log('3. Close the browser when done');
  console.log('Cookies will be saved automatically.\n');

  const browser = await firefox.launch({
    headless: false // Must be visible for manual login
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  // Navigate to login page
  if (site === 'iptorrents') {
    await page.goto('https://iptorrents.com/login.php', { waitUntil: 'networkidle' });
  } else if (site === 'torrentleech') {
    await page.goto('https://www.torrentleech.org/user/account/login/', { waitUntil: 'networkidle' });
  }

  console.log('Waiting for you to log in and close the browser...');

  // Wait for user to complete login and close browser
  await page.waitForEvent('close').catch(() => {});
  
  // Save cookies before closing
  await saveCookies(context, `${site}.json`);
  
  await browser.close();
  console.log('✓ Cookies saved successfully!\n');
}

/**
 * Search private torrent trackers and return torrent URLs
 * @param {string} showName - Name of the TV show to search
 * @param {Object} credentials - Login credentials for trackers
 * @param {Object} credentials.iptorrents - {username, password} or {cookies}
 * @param {Object} credentials.torrentleech - {username, password} or {cookies}
 * @returns {Promise<string[]>} Array of torrent page URLs
 */
async function searchPrivateTrackers(showName, credentials = {}) {
  const browser = await firefox.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    viewport: { width: 1920, height: 1080 }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const allResults = [];

  try {
    // Load saved cookies if they exist and are fresh
    const iptCookies = loadCookies('iptorrents.json');
    const tlCookies = loadCookies('torrentleech.json');

    if (iptCookies && areCookiesValid('iptorrents.json', 168)) { // 7 days
      credentials.iptorrents = { cookies: iptCookies };
    }
    if (tlCookies && areCookiesValid('torrentleech.json', 168)) {
      credentials.torrentleech = { cookies: tlCookies };
    }

    // Search IPTorrents
    if (credentials.iptorrents) {
      console.log('Searching IPTorrents...');
      const iptResults = await searchIPTorrents(context, showName, credentials.iptorrents);
      allResults.push(...iptResults);
    }

    // Search TorrentLeech
    if (credentials.torrentleech) {
      console.log('Searching TorrentLeech...');
      const tlResults = await searchTorrentLeech(context, showName, credentials.torrentleech);
      allResults.push(...tlResults);
    }

  } catch (error) {
    console.error('Search error:', error);
  } finally {
    await browser.close();
  }

  return allResults;
}

async function searchIPTorrents(context, showName, auth) {
  const page = await context.newPage();
  const results = [];

  try {
    // If cookies provided, use them
    if (auth.cookies) {
      await context.addCookies(auth.cookies);
    }

    // Navigate to search
    const searchUrl = `https://iptorrents.com/t?q=${encodeURIComponent(showName)}&qf=ti`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Extract torrent URLs
    const torrents = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/details.php"]');
      return [...new Set(Array.from(links).map(link => link.href).filter(href => 
        href.includes('/details.php') && href.includes('t=')
      ))];
    });

    results.push(...torrents);
    console.log(`Found ${torrents.length} results on IPTorrents`);

  } catch (error) {
    console.error('IPTorrents error:', error.message);
  } finally {
    await page.close();
  }

  return results;
}

async function searchTorrentLeech(context, showName, auth) {
  const page = await context.newPage();
  const results = [];

  try {
    // If cookies provided, use them
    if (auth.cookies) {
      await context.addCookies(auth.cookies);
    }

    // Navigate to search
    const searchUrl = `https://www.torrentleech.org/torrents/browse/list/query/${encodeURIComponent(showName)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // TorrentLeech returns JSON
    const pageText = await page.evaluate(() => document.body?.textContent || '');
    
    try {
      const jsonData = JSON.parse(pageText);
      
      if (jsonData.torrentList && Array.isArray(jsonData.torrentList)) {
        const torrentUrls = jsonData.torrentList.map(torrent => 
          `https://www.torrentleech.org/torrent/${torrent.fid}`
        );
        
        results.push(...torrentUrls);
        console.log(`Found ${torrentUrls.length} results on TorrentLeech`);
      }
    } catch (jsonError) {
      console.log('Response is not JSON');
    }

  } catch (error) {
    console.error('TorrentLeech error:', error.message);
  } finally {
    await page.close();
  }

  return results;
}

// Test function
async function testSearch() {
  const credentials = {
    iptorrents: {
      username: process.env.IPT_USERNAME,
      password: process.env.IPT_PASSWORD
    },
    torrentleech: {
      username: process.env.TL_USERNAME,
      password: process.env.TL_PASSWORD
    }
  };

  console.log('Searching for "3rd Rock from the Sun"...\n');
  const results = await searchPrivateTrackers('3rd Rock from the Sun', credentials);
  
  console.log(`\n=== Found ${results.length} total results ===\n`);
  results.forEach((url, index) => {
    console.log(`${index + 1}. ${url}`);
  });

  return results;
}

// Run test or manual login
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMainModule || import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.includes('--manual-login')) {
    const site = args.includes('iptorrents') ? 'iptorrents' : 
                 args.includes('torrentleech') ? 'torrentleech' : null;
    
    if (!site) {
      console.log('Usage: node torrents.js --manual-login [iptorrents|torrentleech]');
      process.exit(1);
    }
    
    manualLogin(site).catch(console.error);
  } else {
    testSearch().catch(console.error);
  }
}

export { searchPrivateTrackers, manualLogin };
