import { chromium } from 'playwright';

// Usage:
//   cd torrents
//   node src/playwright-smoke.js "https://www.torrentleech.org/torrent/241463012#torrentinfo"
// or:
//   npm run tl-smoke -- "https://www.torrentleech.org/torrent/241463012#torrentinfo"
//
// This is a manual smoke test that tells you whether Playwright (a real browser)
// can load the detail page, or if Cloudflare returns the "Just a moment..." challenge.

const url =
  process.argv[2] ||
  'https://www.torrentleech.org/torrent/241463012#torrentinfo';

const headless = (process.env.PW_HEADLESS || '').trim() === '1';

(async () => {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('[pw-smoke] start', { url, headless });

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
