import { chromium } from 'playwright';
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

  const browser = await chromium.launch({
    headless: false, // Must be visible for manual login
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  // Navigate to login page
  if (site === 'iptorrents') {
    await page.goto('https://iptorrents.com/login.php');
  } else if (site === 'torrentleech') {
    await page.goto('https://www.torrentleech.org/user/account/login/');
  }

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
  const browser = await chromium.launch({
    headless: true, // Changed back to true for headless servers
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
      
      // Save cookies after successful search
      if (iptResults.length > 0) {
        await saveCookies(context, 'iptorrents.json');
      }
    }

    // Search TorrentLeech
    if (credentials.torrentleech) {
      console.log('Searching TorrentLeech...');
      const tlResults = await searchTorrentLeech(context, showName, credentials.torrentleech);
      allResults.push(...tlResults);
      
      // Save cookies after successful search
      if (tlResults.length > 0) {
        await saveCookies(context, 'torrentleech.json');
      }
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
      console.log('Using IPTorrents cookies');
    } 
    // Otherwise login with username/password
    else if (auth.username && auth.password) {
      console.log('Logging into IPTorrents...');
      await page.goto('https://iptorrents.com/login.php', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      
      // Take screenshot to debug
      await page.screenshot({ path: 'ipt-login.png' });
      console.log('Screenshot saved as ipt-login.png');
      
      // Try multiple possible selectors
      const usernameSelector = await page.$('#username') || await page.$('input[name="username"]') || await page.$('#inputUsername');
      const passwordSelector = await page.$('#password') || await page.$('input[name="password"]') || await page.$('#inputPassword');
      
      if (!usernameSelector || !passwordSelector) {
        throw new Error('Could not find login form fields. Check ipt-login.png');
      }
      
      await page.fill('#username, input[name="username"], #inputUsername', auth.username);
      await page.fill('#password, input[name="password"], #inputPassword', auth.password);
      
      // Try to find submit button
      const submitBtn = await page.$('button[type="submit"]') || await page.$('input[type="submit"]') || await page.$('#submitButton');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      
      await page.waitForTimeout(3000);
    }

    // Try the API endpoint directly (similar to TorrentLeech)
    console.log('Trying IPTorrents API endpoint...');
    const apiUrl = `https://iptorrents.com/api/torrents?q=${encodeURIComponent(showName)}`;
    console.log('API URL:', apiUrl);
    
    const apiResponse = await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
    
    if (apiResponse && apiResponse.ok()) {
      const apiText = await page.evaluate(() => document.body?.textContent || '');
      
      if (apiText.trim().startsWith('{') || apiText.trim().startsWith('[')) {
        try {
          const jsonData = JSON.parse(apiText);
          console.log('IPTorrents API returned JSON:', Object.keys(jsonData));
          
          if (jsonData.data && Array.isArray(jsonData.data)) {
            const torrentUrls = jsonData.data.map(t => `https://iptorrents.com/details.php?t=${t.id || t.t}`);
            results.push(...torrentUrls);
            console.log(`Found ${torrentUrls.length} results from IPTorrents API`);
            await page.close();
            return results;
          }
        } catch (e) {
          console.log('API response not valid JSON, falling back to web scraping');
        }
      }
    }

    // Fall back to web search
    console.log('Navigating to search...');
    const searchUrl = `https://iptorrents.com/t?q=${encodeURIComponent(showName)}&qf=ti`;
    console.log('Search URL:', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Check actual URL after navigation
    const currentUrl = page.url();
    console.log('Current URL after navigation:', currentUrl);
    
    // Check if response is JSON (like TorrentLeech)
    const pageText = await page.evaluate(() => document.body?.textContent || '');
    const isJsonResponse = pageText.trim().startsWith('{') || pageText.trim().startsWith('[');
    
    if (isJsonResponse) {
      console.log('IPTorrents returned JSON response');
      try {
        const jsonData = JSON.parse(pageText);
        console.log('JSON keys:', Object.keys(jsonData));
        console.log('JSON preview:', JSON.stringify(jsonData).substring(0, 500));
      } catch (e) {
        console.log('Failed to parse JSON:', e.message);
      }
    }
    
    // Take screenshot of results
    await page.screenshot({ path: 'ipt-results.png' });
    console.log('Results screenshot saved as ipt-results.png');

    // Check if login was successful
    const loginFailed = await page.$('input[name="username"]');
    if (loginFailed) {
      throw new Error('IPTorrents login failed - still on login page');
    }

    // Wait for results table - try multiple selectors
    const resultsExist = await Promise.race([
      page.waitForSelector('table.torrents tbody tr', { timeout: 5000 }).catch(() => null),
      page.waitForSelector('.t-row', { timeout: 5000 }).catch(() => null),
      page.waitForSelector('table tbody tr', { timeout: 5000 }).catch(() => null)
    ]);

    if (!resultsExist) {
      console.log('No results table found. Check ipt-results.png');
      return results;
    }

    // Extract torrent URLs - try multiple patterns
    const linkDebug = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/details.php"], a[href*="/torrent/"], a[href*="t="]');
      
      // Debug: log all links found
      return Array.from(links).map(link => ({
        href: link.href,
        text: link.textContent.trim().substring(0, 50),
        classes: link.className,
        parent: link.parentElement?.tagName
      }));
    });
    
    console.log('All links found:', JSON.stringify(linkDebug, null, 2));
    
    const torrents = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/details.php"], a[href*="/torrent/"], a[href*="t="]');
      return [...new Set(Array.from(links).map(link => link.href).filter(href => 
        href.includes('/details.php') || href.includes('/torrent/') || href.includes('t=')
      ))];
    });

    console.log('Filtered torrents:', torrents);
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
      console.log('Using TorrentLeech cookies');
    }
    // Otherwise login with username/password
    else if (auth.username && auth.password) {
      console.log('Logging into TorrentLeech...');
      
      // Try the main login page first
      let loginUrl = 'https://www.torrentleech.org/user/account/login/';
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch(async () => {
        // If that fails, try alternative
        loginUrl = 'https://www.torrentleech.org/login.php';
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
      });
      
      await page.waitForTimeout(2000);
      
      // Take screenshot to debug
      await page.screenshot({ path: 'tl-login.png' });
      console.log('Screenshot saved as tl-login.png');
      
      // Get all input fields and log them for debugging
      const inputs = await page.$eval('input', els => 
        els.map(el => ({ 
          type: el.type, 
          name: el.name, 
          id: el.id, 
          placeholder: el.placeholder 
        }))
      );
      console.log('Found input fields:', JSON.stringify(inputs, null, 2));
      
      // Try to find username field (more flexible)
      const usernameFilled = await page.evaluate((username) => {
        const possibleFields = [
          document.querySelector('input[name="username"]'),
          document.querySelector('#username'),
          document.querySelector('input[type="text"]'),
          document.querySelector('input[placeholder*="username" i]'),
          document.querySelector('input[placeholder*="email" i]'),
          ...Array.from(document.querySelectorAll('input')).filter(i => 
            i.type === 'text' || i.type === 'email'
          )
        ].filter(Boolean);
        
        if (possibleFields.length > 0) {
          possibleFields[0].value = username;
          possibleFields[0].dispatchEvent(new Event('input', { bubbles: true }));
          possibleFields[0].dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, auth.username);
      
      // Try to find password field
      const passwordFilled = await page.evaluate((password) => {
        const possibleFields = [
          document.querySelector('input[name="password"]'),
          document.querySelector('#password'),
          document.querySelector('input[type="password"]'),
          ...Array.from(document.querySelectorAll('input[type="password"]'))
        ].filter(Boolean);
        
        if (possibleFields.length > 0) {
          possibleFields[0].value = password;
          possibleFields[0].dispatchEvent(new Event('input', { bubbles: true }));
          possibleFields[0].dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, auth.password);
      
      if (!usernameFilled || !passwordFilled) {
        throw new Error('Could not find login form fields. Check tl-login.png and console output');
      }
      
      console.log('Credentials entered, submitting form...');
      
      // Try to submit
      const submitted = await page.evaluate(() => {
        const possibleButtons = [
          document.querySelector('button[type="submit"]'),
          document.querySelector('input[type="submit"]'),
          document.querySelector('button.submit'),
          document.querySelector('.loginButton'),
          ...Array.from(document.querySelectorAll('button')).filter(b => 
            b.textContent.toLowerCase().includes('login') || 
            b.textContent.toLowerCase().includes('sign in')
          )
        ].filter(Boolean);
        
        if (possibleButtons.length > 0) {
          possibleButtons[0].click();
          return true;
        }
        
        // Try submitting form directly
        const form = document.querySelector('form');
        if (form) {
          form.submit();
          return true;
        }
        
        return false;
      });
      
      if (!submitted) {
        // Last resort: press Enter
        await page.keyboard.press('Enter');
      }
      
      await page.waitForTimeout(3000);
    }

    // Navigate to search
    console.log('Navigating to search...');
    const searchUrl = `https://www.torrentleech.org/torrents/browse/list/query/${encodeURIComponent(showName)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Take screenshot of results
    await page.screenshot({ path: 'tl-results.png' });
    console.log('Results screenshot saved as tl-results.png');

    // Check if login was successful
    const loginFailed = await page.$('input[name="username"]');
    if (loginFailed) {
      throw new Error('TorrentLeech login failed - still on login page');
    }

    // TorrentLeech returns JSON instead of HTML
    const pageText = await page.evaluate(() => document.body?.textContent || '');
    
    // Try to parse as JSON
    try {
      const jsonData = JSON.parse(pageText);
      
      if (jsonData.torrentList && Array.isArray(jsonData.torrentList)) {
        console.log(`Found ${jsonData.torrentList.length} torrents in JSON response`);
        
        // Convert torrent data to detail page URLs
        const torrentUrls = jsonData.torrentList.map(torrent => {
          // Extract torrent ID from filename or use fid
          const torrentId = torrent.fid;
          return `https://www.torrentleech.org/torrent/${torrentId}`;
        });
        
        results.push(...torrentUrls);
        console.log(`Found ${torrentUrls.length} results on TorrentLeech`);
        
        await page.close();
        return results;
      }
    } catch (jsonError) {
      console.log('Response is not JSON, trying HTML scraping...');
    }

    // Log page content for debugging
    const pageContent = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        hasTable: !!document.querySelector('table'),
        hasTbody: !!document.querySelector('tbody'),
        tableCount: document.querySelectorAll('table').length,
        downloadLinkCount: document.querySelectorAll('a[href*="/download/"]').length,
        torrentLinkCount: document.querySelectorAll('a[href*="/torrent/"]').length,
        bodyText: document.body?.textContent?.trim().substring(0, 200) || '',
        htmlSnippet: document.documentElement?.innerHTML?.substring(0, 500) || '',
        allLinks: Array.from(document.querySelectorAll('a')).slice(0, 20).map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 50) }))
      };
    });
    console.log('TorrentLeech page info:', JSON.stringify(pageContent, null, 2));

    // Wait for results - try multiple selectors
    const resultsExist = await Promise.race([
      page.waitForSelector('.table-responsive table tbody tr', { timeout: 5000 }).catch(() => null),
      page.waitForSelector('.torrentTable tbody tr', { timeout: 5000 }).catch(() => null),
      page.waitForSelector('table tbody tr', { timeout: 5000 }).catch(() => null),
      page.waitForSelector('table tr', { timeout: 5000 }).catch(() => null)
    ]);

    if (!resultsExist) {
      console.log('No results table found. Check tl-results.png and page info above');
      return results;
    }

    // Extract torrent URLs - try multiple patterns
    const torrents = await page.evaluate(() => {
      // First try to find download links
      const downloadLinks = document.querySelectorAll('a[href*="/download/"]');
      if (downloadLinks.length > 0) {
        return [...new Set(Array.from(downloadLinks).map(link => link.href))];
      }
      
      // Fall back to detail page links
      const detailLinks = document.querySelectorAll('a[href*="/torrent/"], a[href*="/details/"], a[href*="torrentid="]');
      return [...new Set(Array.from(detailLinks).map(link => link.href).filter(href => 
        (href.includes('/torrent/') || href.includes('/details/') || href.includes('torrentid=')) &&
        /\d+/.test(href)  // Must contain numbers
      ))];
    });

    results.push(...torrents);
    console.log(`Found ${torrents.length} results on TorrentLeech`);

  } catch (error) {
    console.error('TorrentLeech error:', error.message);
  } finally {
    await page.close();
  }

  return results;
}

// Test function
async function testSearch() {
  // Load credentials from environment variables
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

  // Validate credentials are loaded
  if (!credentials.iptorrents.username || !credentials.iptorrents.password) {
    console.error('ERROR: IPTorrents credentials not found in .env file');
    console.log('Make sure your .env file contains: IPT_USERNAME and IPT_PASSWORD');
  }
  
  if (!credentials.torrentleech.username || !credentials.torrentleech.password) {
    console.error('ERROR: TorrentLeech credentials not found in .env file');
    console.log('Make sure your .env file contains: TL_USERNAME and TL_PASSWORD');
  }

  console.log('Searching for "3rd Rock from the Sun"...\n');
  const results = await searchPrivateTrackers('3rd Rock from the Sun', credentials);
  
  console.log(`\n=== Found ${results.length} total results ===\n`);
  results.forEach((url, index) => {
    console.log(`${index + 1}. ${url}`);
  });

  return results;
}

// Run test
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMainModule || import.meta.url === `file://${process.argv[1]}`) {
  // Check if --manual-login flag is provided
  const args = process.argv.slice(2);
  
  console.log('Command line args:', args);
  console.log('Script is running as main module');
  
  if (args.includes('--manual-login')) {
    const site = args.includes('iptorrents') ? 'iptorrents' : 
                 args.includes('torrentleech') ? 'torrentleech' : null;
    
    if (!site) {
      console.log('Usage: node torrents.js --manual-login [iptorrents|torrentleech]');
      console.log('Example: node torrents.js --manual-login iptorrents');
      process.exit(1);
    }
    
    console.log(`Starting manual login for: ${site}`);
    manualLogin(site).catch(console.error);
  } else {
    console.log('Running normal search...');
    testSearch().catch(console.error);
  }
}

export { searchPrivateTrackers, manualLogin };