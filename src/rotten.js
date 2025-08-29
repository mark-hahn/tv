import { chromium } from "playwright";

const NAV_TIMEOUT = 15_000;
const BASE        = "https://www.rottentomatoes.com";

async function dismissOverlays(page) {
  const selectors = [
    'button:has-text("Accept All")',
    'button:has-text("I agree")',
    'button:has-text("Continue")',
    '[data-qa="close"]',
    '[data-action="close"]',
  ];
  for (const sel of selectors) {
    try { await page.locator(sel).first().click({ timeout: 1200 }); } catch {}
  }
}

function mostRecent(shows) {
  return shows.reduce((prev, curr) => {
    return (curr.startyear > prev.startyear) ? curr : prev;
  });
}

function getShow(shows, query) {
  query = query.toLowerCase().trim();
  shows.forEach(s => s.titleTrimmed = s.title.toLowerCase().trim());
  let matches = [];
  for (const show of shows) if(query === show.titleTrimmed) matches.push(show);
  if(matches.length === 1) return matches[0];
  if(matches.length   > 1) return mostRecent(matches);
  // no exact title matches
  matches = [];
  // The Bear (2022) => The Bear
  const parts = query.match(/^(.*?)[^a-z0-9\s].*$/);
  const queryTrunc = parts[1].trim(); 
  for (const show of shows) {
    const parts = show.titleTrimmed.match(/^(.*?)[^a-z0-9\s].*$/);
    const titleTrunc = parts[1].trim();
    if(titleTrunc === queryTrunc) matches.push(show);
  }
  if(matches.length === 1) return matches[0];
  if(matches.length   > 1) return mostRecent(matches);
  // no prefix matches
  return null;
}

async function getShows(page, query) {
  await page.goto(`${BASE}/search?search=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
  });
  await dismissOverlays(page);

  const tv = page.locator('search-page-result[type="tvSeries"]');
  await tv.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  const rows = tv.locator("search-page-media-row");
  await rows.first().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  const count = await rows.count();
  if(!count || count === 0) return [];
  const shows = await rows.evaluateAll(els =>
    els.map(el => {
      const infoName = el.querySelector('[data-qa="info-name"]');
      return {
        title: (infoName?.textContent                          ?? '').trim(),
        href:  (infoName?.getAttribute('href')                 ?? '').trim(),
        releaseyear: (el?.getAttribute('releaseyear')          ?? '').trim(),
        startyear:   (el?.getAttribute('startyear')            ?? '').trim(),
        endyear:     (el?.getAttribute('endyear')              ?? '').trim(),
        sentiment:   (el?.getAttribute('tomatometersentiment') ?? '').trim(),
      }
    })
  );
  return shows;
}
export async function getRotten(query, headless = true) {
  query = query.toLowerCase().trim();

  const browser = await chromium.launch({ headless });
  const page    = await browser.newPage();

  page.setDefaultTimeout(NAV_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  try {
    // get best show from show rows
    const shows = await getShows(page, query);
    const show  = getShow(shows, query);
    if (!show) {
      console.log('No matching show found');
      return null;
    }
    const detailLink = show.href;
    // Go to detail page
    await page.goto(detailLink, { waitUntil: "domcontentloaded" });
    await dismissOverlays(page);
    const criticsScore = 
           await page.locator('rt-text[slot="collapsedCriticsScore"]')
      .evaluate(el => Number((el.textContent || '').match(/\d+/)?.[0] ?? NaN));
    const audienceScore = 
           await page.locator('rt-text[slot="collapsedAudienceScore"]')
      .evaluate(el => Number((el.textContent || '').match(/\d+/)?.[0] ?? NaN));

    return { detailLink, criticsScore, audienceScore};
          // title:     show.title,
          // startyear: show.startyear,
          // endyear:   show.endyear,
          // sentiment: show.sentiment,
  } 
  catch (err) {
    console.error("getRotten error", query, err.message);
    return null;
  } 
  finally {
    await browser.close();
  }
}

(async () => {
  console.log(await getRotten("The Bear", false));
})();
