import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Usage:
//   cd torrents
//   node src/playwright-smoke.js "https://www.torrentleech.org/torrent/241463012#torrentinfo"
// or:
//   npm run tl-smoke -- "https://www.torrentleech.org/torrent/241463012#torrentinfo"
//
// Optional cookies:
// - If torrents/cookies/torrentleech.json exists (Playwright cookie export format), the script will load it.
// - Override just cf_clearance with env var TL_CF_CLEARANCE.
//   PowerShell: $env:TL_CF_CLEARANCE="..."; node src\playwright-smoke.js "<url>"
//
// This is a manual smoke test that tells you whether Playwright (a real browser)
// can load the detail page, or if Cloudflare returns the "Just a moment..." challenge.

const url =
  process.argv[2] ||
  'https://www.torrentleech.org/torrent/241463012#torrentinfo';

const headless = (process.env.PW_HEADLESS || '').trim() === '1';
const tlCfClearance = (process.env.TL_CF_CLEARANCE || '').trim();

function tryLoadTlCookies() {
  try {
    const cookiePath = path.resolve(process.cwd(), 'cookies', 'torrentleech.json');
    if (!fs.existsSync(cookiePath)) return [];
    const raw = fs.readFileSync(cookiePath, 'utf8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies)) return [];
    return cookies;
  } catch {
    return [];
  }
}

function tryLoadLocalCfClearance() {
  try {
    const p = path.resolve(process.cwd(), 'cookies', 'cf-clearance.local.json');
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
  } catch {
    // ignore
  }
  return {};
}

function normalizeCookieForHost(cookie, host) {
  const c = { ...cookie };
  // Ensure the cookie is scoped to the right host.
  // Playwright accepts either domain or url.
  if (!c.url) {
    c.url = `https://${host}/`;
  }
  // Some exports use expires=-1; Playwright expects undefined for session cookies.
  if (typeof c.expires === 'number' && c.expires < 0) {
    delete c.expires;
  }
  return c;
}

(async () => {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  const host = (new URL(url)).hostname;

  // Load cookies from torrents/cookies/torrentleech.json when available.
  // This helps test whether a previously verified browser session changes the result.
  const tlCookies = tryLoadTlCookies();
  const localCf = tryLoadLocalCfClearance();
  const effectiveTlCf = tlCfClearance || String(localCf?.torrentleech || '').trim();

  if (tlCookies.length > 0) {
    let cookiesToAdd = tlCookies.map(c => normalizeCookieForHost(c, host));
    if (effectiveTlCf) {
      cookiesToAdd = cookiesToAdd.filter(c => c.name !== 'cf_clearance');
      cookiesToAdd.push({
        name: 'cf_clearance',
        value: effectiveTlCf,
        url: `https://${host}/`,
        path: '/',
      });
    }
    try {
      await context.addCookies(cookiesToAdd);
    } catch {
      // ignore
    }
  } else if (effectiveTlCf) {
    try {
      await context.addCookies([
        {
          name: 'cf_clearance',
          value: effectiveTlCf,
          url: `https://${host}/`,
          path: '/',
        },
      ]);
    } catch {
      // ignore
    }
  }

  const appliedCookieNames = (await context.cookies(`https://${host}/`)).map(c => c.name).sort();
  console.log('[pw-smoke] start', { url, headless, host, appliedCookieNames });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const title = await page.title();
    const html = await page.content();

    const htmlLower = html.toLowerCase();
    const looksLikeChallenge =
      htmlLower.includes('<title>just a moment') ||
      htmlLower.includes('checking your browser') ||
      htmlLower.includes('cf-chl') ||
      htmlLower.includes('cf-ray') ||
      htmlLower.includes('attention required');

    console.log('[pw-smoke] result', {
      title,
      looksLikeChallenge,
      htmlHead: html.slice(0, 200),
    });

    const safeName =
      (new URL(url)).hostname.replace(/[^a-z0-9.-]/gi, '_') +
      (looksLikeChallenge ? '-challenge' : '-ok');

    await page.screenshot({ path: `${safeName}.png`, fullPage: true });
    console.log('[pw-smoke] screenshot saved', { path: `${safeName}.png` });
  } catch (err) {
    console.error('[pw-smoke] error', err?.message || String(err));
    try {
      await page.screenshot({ path: 'pw-smoke-error.png', fullPage: true });
      console.log('[pw-smoke] screenshot saved', { path: 'pw-smoke-error.png' });
    } catch {
      // ignore
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
