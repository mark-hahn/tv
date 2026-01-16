// node src/rotten.js "rizzoli-and-isles"

import { chromium } from "playwright";
import * as util    from "./util.js";
const {log, start, end} = util.getLog('rott');

const MAX_STR_DIST = 10;
const NAV_TIMEOUT  = 15_000;
const BASE         = "https://www.rottentomatoes.com";
const argv = process.argv.slice(2);

const ROTTEN_DEBUG = false;
const ROTTEN_HEADED = false;
const ROTTEN_TIMING = false;
const ROTTEN_REUSE = true;
const ROTTEN_REUSE_PAGE = true;
const HAS_DISPLAY = !!process.env.DISPLAY;

const debug = argv.includes('--debug') || ROTTEN_DEBUG;
const headed = argv.includes('--headed') || ROTTEN_HEADED;
const cliQuery = argv.find(a => !a.startsWith('-'));
const TIMING_ENABLED = ROTTEN_TIMING;
const REUSE_BROWSER = ROTTEN_REUSE;
const REUSE_PAGE = ROTTEN_REUSE_PAGE;

const _shared = {
  browser: null,
  context: null,
  page: null,
  headless: null,
  initPromise: null,
  queue: Promise.resolve(),
  hooksInstalled: false,
};

export async function rottenShutdown() {
  const browser = _shared.browser;
  _shared.browser = null;
  _shared.context = null;
  _shared.page = null;
  _shared.initPromise = null;
  if (browser) {
    try { await browser.close(); } catch {}
  }
}

function installShutdownHooks() {
  if (_shared.hooksInstalled) return;
  _shared.hooksInstalled = true;

  const onSignal = async (sig) => {
    try { await rottenShutdown(); }
    finally { process.exit(0); }
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}

async function getSharedBrowserContext({ headless }) {
  installShutdownHooks();

  if (_shared.browser && _shared.context) {
    return { browser: _shared.browser, context: _shared.context };
  }
  if (_shared.initPromise) {
    await _shared.initPromise;
    return { browser: _shared.browser, context: _shared.context };
  }

  _shared.initPromise = (async () => {
    _shared.headless = headless;
    _shared.browser = await chromium.launch({ headless });
    _shared.context = await _shared.browser.newContext();
  })();

  await _shared.initPromise;
  return { browser: _shared.browser, context: _shared.context };
}

async function withSerializedSharedPage(timing, fn) {
  const run = async () => {
    const page = _shared.page || (_shared.page = await timing.time('context.newPage', () => _shared.context.newPage()));
    return await fn(page);
  };
  _shared.queue = _shared.queue.then(run, run);
  return await _shared.queue;
}

function createTiming(log, enabled, label) {
  const starts = new Map();
  const spans = [];
  const t0 = process.hrtime.bigint();
  const nowNs = () => process.hrtime.bigint();

  const start = (name) => {
    if (!enabled) return;
    starts.set(name, nowNs());
  };

  const end = (name, meta = "") => {
    if (!enabled) return;
    const tStart = starts.get(name);
    if (!tStart) return;
    const ms = Number(nowNs() - tStart) / 1e6;
    spans.push({ name, ms, meta });
    starts.delete(name);
  };

  const time = async (name, fn, meta = "") => {
    if (!enabled) return await fn();
    start(name);
    try {
      return await fn();
    } finally {
      end(name, meta);
    }
  };

  const report = (topN = 10) => {
    if (!enabled) return;
    const totalMs = Number(nowNs() - t0) / 1e6;
    const sorted = [...spans].sort((a, b) => b.ms - a.ms);
    log(`timings for ${label}: total=${totalMs.toFixed(0)}ms, spans=${spans.length}`);
    for (const s of sorted.slice(0, topN)) {
      log(`timing: ${String(s.ms.toFixed(0)).padStart(5, ' ')}ms  ${s.name}${s.meta ? '  ' + s.meta : ''}`);
    }
  };

  return { enabled, start, end, time, report, spans };
}

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

async function dismissOverlays(page, timing, spanName = 'dismissOverlays') {
  timing?.start(spanName);
  const selectors = [
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Continue")',
    '[data-qa="close"]',
    '[data-action="close"]',
  ];

  const perSelectorTimeoutMs = 350;
  const maxPasses = 3;
  const clickedSelectors = [];

  const tryClickAny = async () => {
    const attempts = selectors.map(async (sel) => {
      const locator = page.locator(sel).first();
      await locator.waitFor({ state: 'visible', timeout: perSelectorTimeoutMs });
      await locator.click({ timeout: perSelectorTimeoutMs });
      return sel;
    });

    try {
      const sel = await Promise.any(attempts);
      clickedSelectors.push(sel);
      return true;
    } catch {
      return false;
    }
  };

  for (let pass = 0; pass < maxPasses; pass++) {
    const clicked = await tryClickAny();
    if (!clicked) break;
    await page.waitForTimeout(120);
  }

  timing?.end(
    spanName,
    clickedSelectors.length ? `clicked=${clickedSelectors.join(' | ')}` : ''
  );
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

async function findShows(page, query, timing) {
  const srchQuery = query.replace(/[^\d](19|20)\d{2}\)?$/, '').trim();
  queryUrl = `${BASE}/search?search=${encodeURIComponent(srchQuery)}`;
  timing?.start('findShows.goto');
  await page.goto(queryUrl, {waitUntil: "domcontentloaded"});
  timing?.end('findShows.goto', queryUrl);

  await dismissOverlays(page, timing, 'dismissOverlays.search');
  const rows = page.locator('search-page-result[type="tvSeries"] search-page-media-row');
  timing?.start('findShows.wait.firstRow');
  const fastTimeoutMs = 2500;
  const slowTimeoutMs = 15000;
  const gotFast = await rows.first().waitFor({ state: "attached", timeout: fastTimeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!gotFast) {
    await rows.first().waitFor({ state: "attached", timeout: slowTimeoutMs }).catch(() => {});
  }
  timing?.end('findShows.wait.firstRow', gotFast ? `fast=${fastTimeoutMs}ms` : `slow=${slowTimeoutMs}ms`);

  timing?.start('findShows.rows.count');
  const count = await rows.count();
  timing?.end('findShows.rows.count', `count=${count}`);
  if(!count || count === 0) return [];

  timing?.start('findShows.rows.evaluateAll');
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
  timing?.end('findShows.rows.evaluateAll', `count=${shows?.length ?? 0}`);
  return shows;
}
export async function rottenSearch(query) {
  const rottenStartTime = Date.now();
  // log(`starting rottenSearch, query: "${query}"`);
  query = query.toLowerCase().trim();

  const timing = createTiming(log, TIMING_ENABLED, `rottenSearch("${query}")`);

  const headless = !headed || !HAS_DISPLAY;
  if (headed && !HAS_DISPLAY) {
    log('err', 'ROTTEN_HEADED requested but no $DISPLAY; forcing headless');
  }
  let browser;
  let context;
  let page;
  const usingShared = REUSE_BROWSER;

  if (usingShared) {
    ({ browser, context } = await timing.time('shared.getBrowserContext', () => getSharedBrowserContext({ headless })));
    if (_shared.headless !== null && _shared.headless !== headless) {
      timing.end('shared.getBrowserContext', `note=headless-mismatch shared=${_shared.headless} requested=${headless}`);
    }
  } else {
    browser = await timing.time('chromium.launch', () => chromium.launch({ headless }));
  }

  const runOnce = async (page) => {
    page.setDefaultTimeout(NAV_TIMEOUT);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    // get best show from show rows
    const shows = await timing.time('findShows', () => findShows(page, query, timing));
    timing.start('chooseShow');
    const show  = chooseShow(shows, query);
    timing.end('chooseShow', `candidates=${shows?.length ?? 0}`);
    if (!show) {
      log(`Rotten: No matching show found for "${query}"`);
      return null;
    }
    const detailLink = show.href;
    // Go to detail page
    await timing.time('detail.goto', () => page.goto(detailLink, { waitUntil: "domcontentloaded" }), detailLink);
    await dismissOverlays(page, timing, 'dismissOverlays.detail');

    const criticsScore = await timing.time(
      'detail.criticsScore',
      () => page.locator('rt-text[slot="collapsedCriticsScore"]')
        .evaluate(el => Number((el.textContent || '').match(/\d+/)?.[0] ?? ""))
    );
    const audienceScore = await timing.time(
      'detail.audienceScore',
      () => page.locator('rt-text[slot="collapsedAudienceScore"]')
        .evaluate(el => Number((el.textContent || '').match(/\d+/)?.[0] ?? ""))
    );

    if(debug) log(`rotten: "${query }" => "${show.title
                                 }" ${show.startyear
                                  } ${show.endyear
                                  } ${criticsScore
                                  }/${audienceScore
                                  } ${show.sentiment
                             }\n    ${queryUrl
                             }\n    ${detailLink}`);

    return { url: detailLink, criticsScore, audienceScore};
  };

  try {
    if (usingShared) {
      if (REUSE_PAGE) {
        return await timing.time('shared.page.serial', () => withSerializedSharedPage(timing, runOnce));
      }
      page = await timing.time('context.newPage', () => context.newPage());
      return await runOnce(page);
    }

    page = await timing.time('browser.newPage', () => browser.newPage());
    return await runOnce(page);
  } catch (err) {
    log('err', "rottenSearch error", query, err.message);
    return null;
  } finally {
    if (page && usingShared && !REUSE_PAGE) {
      await timing.time('page.close', () => page.close());
    }
    if (page && !usingShared) {
      // page is closed as part of browser.close
    }
    if (!usingShared && browser) {
      await timing.time('browser.close', () => browser.close());
    }
    const elapsed = ((Date.now() - rottenStartTime)/1000).toFixed(0);
    log(`finished rottenSearch: ${elapsed} secs, "${query}"`);
    timing.report(12);
  }
}

if ((process.argv[1] || '').endsWith('/src/rotten.js') && cliQuery) {
  (async () => {
    await rottenSearch(cliQuery);
    await rottenShutdown();
  })();
}
