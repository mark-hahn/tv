// node src/rotten.js "rizzoli-and-isles"

import { chromium } from "playwright";
import * as util    from "./util.js";
const {log, start, end} = util.getLog('rott');

const MAX_STR_DIST = 10;
const NAV_TIMEOUT  = 15_000;
const BASE         = "https://www.rottentomatoes.com";
const debug        = !!process.argv[2];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Returns integer edit distance between strings a and b
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure 'a' is shorter to keep memory O(min(m,n))
  if (a.length > b.length) [a, b] = [b, a];

  const m = a.length, n = b.length;
  let prev = new Uint16Array(m + 1);
  let curr = new Uint16Array(m + 1);

  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const cost = (a.charCodeAt(i - 1) === bj) ? 0 : 1;
      const del = prev[i] + 1;        // deletion
      const ins = curr[i - 1] + 1;    // insertion
      const sub = prev[i - 1] + cost; // substitution
      curr[i] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    // swap buffers (no copy)
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

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

function chooseShow(shows, query) {
  if(shows.length === 0) return null;
  if(shows.length === 1) return shows[0];
  query           =  query.toLowerCase().trim();
  const queryYear = (query.match(/[^\d](19|20)\d{2}\)?$/) || [null])[0];
  query           =  query.replace(/[^\d](19|20)\d{2}\)?$/, '').trim();
  shows.forEach(s => 
    s.titleTrimmed = s.title.toLowerCase().trim()
                      .replace(/[^\d](19|20)\d{2}\)?$/, '').trim());
  let minDist  = Infinity;
  let minShows = [];
  for(const show of shows) {
    const dist = levenshtein(query, show.titleTrimmed);
    if(debug) log(
    `dist: "${query}" ~ "${show.titleTrimmed}" => ${dist}`);
    if(dist > MAX_STR_DIST) continue;
    if(dist === minDist) {
      minShows.push(show);
    }
    if(dist < minDist) {
      minDist = dist;
      minShows = [show];
    }
  }
  if(debug) log(`matching shows:`, minShows);
  if(debug) log(`minDist = ${minDist}`);
  if(minShows.length === 0) return null;
  if(minShows.length === 1) return minShows[0];
  if(queryYear) {
    for(const show of minShows) {
      if(show.startyear === queryYear) return show;
    }
  }
  return mostRecent(minShows);
}

let queryUrl;

async function findShows(page, query) {
  const srchQuery = query.replace(/[^\d](19|20)\d{2}\)?$/, '').trim();
  queryUrl = `${BASE}/search?search=${encodeURIComponent(srchQuery)}`;
  await page.goto(queryUrl, {waitUntil: "domcontentloaded"});
  await dismissOverlays(page);
  await page.locator();
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
export async function rottenSearch(query) {
  const rottenStartTime = Date.now();
  // log(`starting rottenSearch, query: "${query}"`);
  query = query.toLowerCase().trim();

  const headless = !debug;
  const browser  = await chromium.launch({ headless });
  const page     = await browser.newPage();

  page.setDefaultTimeout(NAV_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  try {
    // get best show from show rows
    const shows = await findShows(page, query);
    const show  = chooseShow(shows, query);
    if (!show) {
      log(`Rotten: No matching show found for "${query}"`);
      return null;
    }
    const detailLink = show.href;
    // Go to detail page
    await page.goto(detailLink, { waitUntil: "domcontentloaded" });
    await dismissOverlays(page);
    const criticsScore = 
           await page.locator('rt-text[slot="collapsedCriticsScore"]')
      .evaluate(el => Number((el.textContent || '').match(/\d+/)?.[0] ?? ""));
    const audienceScore = 
           await page.locator('rt-text[slot="collapsedAudienceScore"]')
      .evaluate(el => Number((el.textContent || '').match(/\d+/)?.[0] ?? ""));

    if(debug) log(`rotten: "${query }" => "${show.title
                                 }" ${show.startyear
                                  } ${show.endyear
                                  } ${criticsScore
                                  }/${audienceScore
                                  } ${show.sentiment
                             }\n    ${queryUrl
                             }\n    ${detailLink}`);

    return { url: detailLink, criticsScore, audienceScore};
  }
  catch (err) {
    log('err', "rottenSearch error", query, err.message);
    return null;
  } 
  finally {
    await browser.close();
    const elapsed = ((Date.now() - rottenStartTime)/1000).toFixed(0);
    log(`finished rottenSearch: ${elapsed} secs, "${query}"`);
  }
}

if(debug) {
  (async () => { await rottenSearch(process.argv[2], false) })();
}
