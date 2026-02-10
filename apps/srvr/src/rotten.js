// node src/rotten.js "rizzoli-and-isles"

import { chromium } from "playwright";
import fs from "fs"; // Added for saving HTML
import * as util from "./util.js";
import { smartTitleMatch } from "@tv/share";
const { log, start, end } = util.getLog("rott");

const MAX_STR_DIST = 10;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const NAV_TIMEOUT = 15_000;
const BASE = "https://www.rottentomatoes.com";
const argv = process.argv.slice(2);

const ROTTEN_DEBUG = false;
const ROTTEN_HEADED = false;
const ROTTEN_TIMING = false;
const ROTTEN_REUSE = true;
const ROTTEN_REUSE_PAGE = true;
const HAS_DISPLAY = !!process.env.DISPLAY;

const debug = argv.includes("--debug") || ROTTEN_DEBUG;
const headed = argv.includes("--headed") || ROTTEN_HEADED;
const cliQuery = argv.find((a) => !a.startsWith("-"));
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
    try {
      await browser.close();
    } catch {}
  }
}

function installShutdownHooks() {
  if (_shared.hooksInstalled) return;
  _shared.hooksInstalled = true;

  const onSignal = async (sig) => {
    try {
      await rottenShutdown();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
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
    _shared.context = await _shared.browser.newContext({
      userAgent: USER_AGENT,
    });
  })();

  await _shared.initPromise;
  return { browser: _shared.browser, context: _shared.context };
}

async function withSerializedSharedPage(timing, fn) {
  const run = async () => {
    const page =
      _shared.page ||
      (_shared.page = await timing.time("context.newPage", () =>
        _shared.context.newPage(),
      ));
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
    log(
      `timings for ${label}: total=${totalMs.toFixed(0)}ms, spans=${spans.length}`,
    );
    for (const s of sorted.slice(0, topN)) {
      log(
        `timing: ${String(s.ms.toFixed(0)).padStart(5, " ")}ms  ${s.name}${s.meta ? "  " + s.meta : ""}`,
      );
    }
  };

  return { enabled, start, end, time, report, spans };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function dismissOverlays(page, timing, spanName = "dismissOverlays") {
  timing?.start(spanName);

  // Save HTML snapshot before any dismissal attempts
  if (debug) {
    try {
      const html = await page.content();
      fs.writeFileSync("rotten-overlays.html", html);
      // console.log('Saved page content to rotten-overlays.html');
    } catch (e) {
      console.log("Failed to save rotten-overlays.html", e.message);
    }
  }

  // Specific handling for OneTrust
  try {
    // 0. NUCLEAR OPTION: Just delete the element from DOM immediately
    const deleted = await page.evaluate(() => {
      const ids = [
        "#onetrust-banner-sdk",
        "#onetrust-consent-sdk",
        ".ot-floating-button",
      ];
      let count = 0;
      ids.forEach((id) => {
        const el = document.querySelector(id);
        if (el) {
          el.remove();
          count++;
        }
      });
      document.body.style.overflow = "auto"; // Restore scrolling
      return count;
    });
    // if (deleted > 0) console.log(`[Nuclear] Removed ${deleted} OneTrust elements from DOM.`);

    // 1. Try "Reject All" (force click)
    const reject = page.locator("#onetrust-reject-all-handler");
    if ((await reject.count()) > 0) {
      console.log("Clicking OneTrust Reject All (Force)");
      await reject.click({ force: true }).catch(() => {});
      await delay(200);
    }
    // 2. Try "Accept All" (force click)
    else {
      const accept = page.locator("#onetrust-accept-btn-handler");
      if ((await accept.count()) > 0) {
        console.log("Clicking OneTrust Accept All (Force)");
        await accept.click({ force: true }).catch(() => {});
        await delay(200);
      }
    }

    // 3. Try "X" Close Button (The "X" in the corner)
    const closeBtn = page.locator(
      '#onetrust-close-btn-container button, .onetrust-close-btn-ui, button[aria-label="Close"], button[title="Close"]',
    );
    if ((await closeBtn.count()) > 0) {
      // console.log(`Found Close 'X' button. Clicking (Force)...`);
      await closeBtn
        .first()
        .click({ force: true })
        .catch(() => {});
      await delay(200);
    }
  } catch (e) {
    console.log("OneTrust click error:", e.message);
  }

  // 4. Polling for the stubborn popup at 853, 160
  // If the element at this coordinate is NO LONGER a Nav/Link, it means the popup has appeared.
  try {
    // console.log('Polling for popup at 853,160...');
    for (let i = 0; i < 2; i++) {
      // Poll for ~200ms (reduced from 2s)
      const elInfo = await page.evaluate(() => {
        const el = document.elementFromPoint(853, 160);
        return el
          ? {
              tagName: el.tagName,
              className: el.className,
              text: el.textContent?.trim() || "",
            }
          : null;
      });

      // If we hit something that is NOT the navbar, assume it's the popup overlay
      if (elInfo) {
        const tag = elInfo.tagName.toUpperCase();
        const cls = (elInfo.className || "").toUpperCase();
        const txt = elInfo.text;

        // SAFEGUARD: Do not delete known page elements
        if (
          tag === "NAV" ||
          tag.includes("HEADER") ||
          cls.includes("HEADER") ||
          tag === "MEDIA-SCORECARD" ||
          tag === "RT-TEXT" ||
          tag.startsWith("SCORE-BOARD") ||
          txt === "TV Shows" ||
          txt === "Movies"
        ) {
          // console.log(`[Polling] Hit valid page element (${tag}), ignoring...`);
          await delay(200);
          continue;
        }

        // console.log(`Potential Popup detected at 853,160 (Tag: ${tag} Cls: ${cls}). Checking if safe to delete...`);

        const removed = await page.evaluate(() => {
          try {
            const el = document.elementFromPoint(853, 160);
            if (!el) return false;

            let target = el;
            let levels = 0;
            let isOverlay = false;

            // Walk up to find if it's actually an overlay
            while (
              target &&
              target.parentElement &&
              target.tagName !== "BODY" &&
              levels < 20
            ) {
              const t = target.tagName.toUpperCase();
              const c =
                (target.className instanceof SVGAnimatedString
                  ? target.className.baseVal
                  : target.className) || "";
              const i = (target.id || "").toUpperCase();
              const s = window.getComputedStyle(target);

              // SAFEGUARD: Stop climbing if we hit main structural elements
              if (
                t === "NAV" ||
                t === "HEADER" ||
                t.startsWith("RT-HEADER") ||
                t === "MAIN" ||
                t === "MEDIA-SCORECARD" ||
                t.startsWith("SCORE-BOARD") ||
                t === "SECTION"
              ) {
                return false;
              }

              // Detection signals
              if (
                s.position === "fixed" ||
                (s.position === "absolute" && s.zIndex > 100) ||
                i.includes("MODAL") ||
                i.includes("BANNER") ||
                i.includes("ONETRUST") ||
                c.includes("popup") ||
                c.includes("overlay") ||
                c.includes("modal") ||
                t === "IFRAME"
              ) {
                isOverlay = true;
                break; // Found the wrapper to delete
              }
              target = target.parentElement;
              levels++;
            }

            if (isOverlay && target && target.tagName !== "BODY") {
              // confirm it's not the header
              const finalTag = target.tagName.toUpperCase();
              if (!finalTag.includes("HEADER") && finalTag !== "NAV") {
                // console.log('Removing detected overlay:', target.tagName, target.className);
                target.remove();
                if (document.body) document.body.style.overflow = "auto";
                return true;
              }
            }
          } catch (e) {
            console.error("Delete script error:", e.message);
          }
          return false;
        });

        if (removed) {
          // console.log('Successfully deleted popup overlay.');
          await delay(500); // Wait for DOM to settle
          // break; // Don't break, keep polling just in case another one comes up (stacked modals)
        }
      }
      await delay(200);
    }
  } catch (err) {
    console.log("Polling error:", err.message);
  }

  // Check if we are incorrectly clicking the navbar
  try {
    const checkEl = await page.evaluate(() => {
      const el = document.elementFromPoint(853, 160);
      return el ? el.tagName : null;
    });
    if (checkEl === "A" || checkEl === "NAV") {
      // console.log('Skipping forced click at 853,160 because it targets a link/nav element (Popup likely gone).');
    } else {
      // Only click if it's NOT a link, assuming it might be the overlay
      // But since the cookie seems to be working, we'll disable this risky click.
      // console.log('Clicking user provided coordinates: x=853, y=160');
      // await page.mouse.click(853, 160);
      // await delay(500);
    }
  } catch {}

  // try clicking center of screen if an overlay is detected
  try {
    const overlayVisible = await page.evaluate(
      () => !!document.querySelector("#onetrust-banner-sdk, .modal-backdrop"),
    );
    if (overlayVisible) {
      const vp = page.viewportSize();
      if (vp) {
        await page.mouse.click(vp.width / 2, vp.height / 2);
        await delay(200);
      }
    }
  } catch {}

  // Try clicking center of screen as requested for stubborn popups
  try {
    // const vp = page.viewportSize();
    // if (vp) {
    //   await page.mouse.click(vp.width / 2, vp.height / 2);
    //   await delay(500);
    // }
  } catch {}

  // Try to remove generic modal backdrops that cover the screen
  try {
    await page.evaluate(() => {
      const overlays = document.querySelectorAll(
        ".modal-backdrop, .overlay, .popup-overlay, #onetrust-banner-sdk, #onetrust-consent-sdk",
      );
      overlays.forEach((el) => el.remove());
      // Also ensure body is scrollable in case modal froze it
      document.body.style.overflow = "auto";
    });
  } catch {}

  const selectors = [
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Continue")',
    'button:has-text("No thanks")',
    'button:has-text("No Thanks")',
    'button:has-text("Maybe later")',
    'button:has-text("Skip")',
    '[data-qa="close"]',
    '[data-action="close"]',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    '[aria-label="Close request"]',
    '[aria-label="Close Promo"]',
    '[aria-label*="Close"]',
    '[aria-label*="close"]',
    'button[title="Close"]',
    'svg[name="close"]',
    ".close",
    ".close-button",
    ".modal-close",
    "button.close",
    'div[role="button"][aria-label="Close"]',
    'button:text-is("X")',
    'button:text-is("×")',
    'button:text-is("✕")',
    "#close",
  ];

  const perSelectorTimeoutMs = 350;
  const maxPasses = 3;
  const clickedSelectors = [];

  const tryClickAny = async () => {
    const attempts = selectors.map(async (sel) => {
      const locator = page.locator(sel).first();
      await locator.waitFor({
        state: "visible",
        timeout: perSelectorTimeoutMs,
      });
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
    clickedSelectors.length ? `clicked=${clickedSelectors.join(" | ")}` : "",
  );
}

function chooseShow(shows, query) {
  const match = query.match(/[^\d](19|20)\d{2}\)?$/);
  let year = null;
  if (match) {
    year = match[0].replace(/[^\d]/g, "");
    query = query.replace(match[0], "").trim();
  }

  if (debug) {
    log(
      `smartTitleMatch: query="${query}", year="${year}" against ${shows.length} shows`,
    );
  }

  // Use forceChoice=true to allow aggressive normalization and Levenshtein matching
  // This handles cases like "Sensitive Skin (CA)" matching "Sensitive Skin"
  const result = smartTitleMatch(query, shows, year, true);

  if (debug && result) {
    log(`smartTitleMatch selected: "${result.title}" (${result.startyear})`);
  }
  return result;
}

let queryUrl;

async function findShows(page, query, timing) {
  const srchQuery = query.replace(/[^\d](19|20)\d{2}\)?$/, "").trim();
  queryUrl = `${BASE}/search?search=${encodeURIComponent(srchQuery)}`;
  timing?.start("findShows.goto");
  await page.goto(queryUrl, { waitUntil: "domcontentloaded" });
  timing?.end("findShows.goto", queryUrl);

  await dismissOverlays(page, timing, "dismissOverlays.search");
  const rows = page.locator(
    'search-page-result[type="tvSeries"] search-page-media-row',
  );
  timing?.start("findShows.wait.firstRow");
  const fastTimeoutMs = 2500;
  const slowTimeoutMs = 15000;
  const gotFast = await rows
    .first()
    .waitFor({ state: "attached", timeout: fastTimeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!gotFast) {
    await rows
      .first()
      .waitFor({ state: "attached", timeout: slowTimeoutMs })
      .catch(() => {});
  }
  timing?.end(
    "findShows.wait.firstRow",
    gotFast ? `fast=${fastTimeoutMs}ms` : `slow=${slowTimeoutMs}ms`,
  );

  timing?.start("findShows.rows.count");
  const count = await rows.count();
  timing?.end("findShows.rows.count", `count=${count}`);
  if (!count || count === 0) return [];

  timing?.start("findShows.rows.evaluateAll");
  const shows = await rows.evaluateAll((els) =>
    els.map((el) => {
      const infoName = el.querySelector('[data-qa="info-name"]');
      return {
        title: (infoName?.textContent ?? "").trim(),
        href: (infoName?.getAttribute("href") ?? "").trim(),
        releaseyear: (el?.getAttribute("releaseyear") ?? "").trim(),
        startyear: (el?.getAttribute("startyear") ?? "").trim(),
        endyear: (el?.getAttribute("endyear") ?? "").trim(),
        sentiment: (el?.getAttribute("tomatometersentiment") ?? "").trim(),
      };
    }),
  );
  timing?.end("findShows.rows.evaluateAll", `count=${shows?.length ?? 0}`);
  return shows;
}
export async function rottenSearch(query) {
  const rottenStartTime = Date.now();
  // log(`starting rottenSearch, query: "${query}"`);
  query = query.toLowerCase().trim();

  const timing = createTiming(log, TIMING_ENABLED, `rottenSearch("${query}")`);

  const headless = !headed || !HAS_DISPLAY;
  if (headed && !HAS_DISPLAY) {
    log("err", "ROTTEN_HEADED requested but no $DISPLAY; forcing headless");
  }
  let browser;
  let context;
  let page;
  const usingShared = REUSE_BROWSER;

  if (usingShared) {
    ({ browser, context } = await timing.time("shared.getBrowserContext", () =>
      getSharedBrowserContext({ headless }),
    ));
    if (_shared.headless !== null && _shared.headless !== headless) {
      timing.end(
        "shared.getBrowserContext",
        `note=headless-mismatch shared=${_shared.headless} requested=${headless}`,
      );
    }
  } else {
    browser = await timing.time("chromium.launch", () =>
      chromium.launch({ headless }),
    );
  }

  const runOnce = async (page) => {
    page.setDefaultTimeout(NAV_TIMEOUT);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    // get best show from show rows
    const shows = await timing.time("findShows", () =>
      findShows(page, query, timing),
    );
    timing.start("chooseShow");
    const show = chooseShow(shows, query);
    timing.end("chooseShow", `candidates=${shows?.length ?? 0}`);
    if (!show) {
      log(`Rotten: No matching show found for "${query}"`);
      return null;
    }
    const detailLink = show.href;
    // console.log(`Rotten Search URL: ${queryUrl}`);
    // console.log(`Rotten Detail URL: ${detailLink}`);
    // Go to detail page
    await timing.time(
      "detail.goto",
      async () => {
        // Prepare cookie to suppress cookie consent banner if possible
        try {
          const domain = new URL(BASE).hostname;
          await context.addCookies([
            {
              name: "OptanonAlertBoxClosed",
              value: new Date().toISOString(),
              domain: domain.startsWith("www.") ? domain.slice(4) : domain, // .rottentomatoes.com or rottentomatoes.com
              path: "/",
              expires: Date.now() / 1000 + 365 * 24 * 3600, // 1 year
            },
          ]);
        } catch {}

        for (let i = 1; i <= 3; i++) {
          try {
            await page.goto(detailLink, { waitUntil: "domcontentloaded" });
            return;
          } catch (e) {
            console.log(
              `rotten detail.goto failed (attempt ${i}): ${e.message}`,
            );
            if (i === 3) throw e;
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      },
      detailLink,
    );
    await dismissOverlays(page, timing, "dismissOverlays.detail");

    const getScore = async (slot, retrying = false) => {
      // Version Marker
      // console.log(`[Rotten] getScore v2.1 checking ${slot}...`);

      try {
        // Selector variations: camelCase (criticsScore) and kebab-case (critics-score)
        const slotKebab = slot.replace(/([A-Z])/g, "-$1").toLowerCase();

        // Check for media-scorecard or score-board (new layout)
        const loc = page
          .locator(
            `
            media-scorecard rt-text[slot="${slot}"], 
            media-scorecard rt-text[slot="${slotKebab}"],
            score-board rt-text[slot="${slot}"], 
            score-board rt-text[slot="${slotKebab}"],
            score-board-m rt-text[slot="${slot}"],
            score-board-m rt-text[slot="${slotKebab}"]
        `,
          )
          .first();

        await loc.waitFor({ state: "attached", timeout: 3000 });
        const val = await loc.evaluate((el) => {
          // Log what we find inside the element for debugging
          return {
            text: el.textContent || "",
            html: el.innerHTML || "",
          };
        });
        const num = Number((val.text || "").match(/\d+/)?.[0] ?? "");
        // console.log(`rotten getScore ${slot}: found text="${val.text}" -> ${num}`);

        // Take screenshot of the scorecard area

        // Take screenshot of the scorecard area
        if (debug) {
          try {
            const card = page.locator("media-scorecard");
            if ((await card.count()) > 0) {
              await card.screenshot({ path: `rotten-scorecard-${slot}.png` });
              // console.log(`Saved screenshot to rotten-scorecard-${slot}.png`);
            } else {
              // fallback if media-scorecard not found, screenshot whole page
              await page.screenshot({ path: `rotten-page-${slot}.png` });
              // console.log(`Saved page screenshot to rotten-page-${slot}.png`);
            }
          } catch (err) {
            console.log("rotten screnshot error", err.message);
          }
        }

        return num;
      } catch (e) {
        if (!retrying) {
          // console.log(`rotten getScore ${slot} failed, attempting to dismiss overlays and retry.`);
          await dismissOverlays(page, timing, "dismissOverlays.retry");
          return getScore(slot, true);
        }

        // console.log(`rotten getScore ${slot} error: ${e.message}`);

        // DEBUG: Thorough DOM Inspection
        /*
        try {
             const debugInfo = await page.evaluate(() => {
                 const card = document.querySelector('media-scorecard, score-board, score-board-m');
                 if (!card) return 'No scorecard element found in DOM';
                 
                 // Get all children and their attributes
                 const children = Array.from(card.children).map(c => {
                     return `<${c.tagName.toLowerCase()} slot="${c.getAttribute('slot') || ''}" class="${c.className}">`;
                 }).join('\n');
                 
                 return `Tag: ${card.tagName}\nHTML: ${card.innerHTML.substring(0, 1000)}\nChildren:\n${children}`;
             });
             console.log(`DEBUG STRUCT ${slot}:\n${debugInfo}`);
        } catch(dx) { console.log('Debug inspect failed:', dx.message); }
        */

        // Capture HTML snapshot on error
        /*
        try {
          const html = await page.content();
          fs.writeFileSync(`rotten-error-${slot}.html`, html);
          console.log(`Saved page content to rotten-error-${slot}.html`);
        } catch {}
        */

        // Capture screenshot on error too
        try {
          await page.screenshot({ path: `rotten-error-${slot}.png` });
          // console.log(`Saved error screenshot to rotten-error-${slot}.png`);
        } catch {}

        return 0;
      }
    };

    const criticsScore = await timing.time("detail.criticsScore", () =>
      getScore("criticsScore"),
    );
    const audienceScore = await timing.time("detail.audienceScore", () =>
      getScore("audienceScore"),
    );

    if (debug)
      log(
        `rotten: "${query}" => "${show.title}" ${show.startyear} ${
          show.endyear
        } ${criticsScore}/${audienceScore} ${show.sentiment}\n    ${
          queryUrl
        }\n    ${detailLink}`,
      );

    return { url: detailLink, criticsScore, audienceScore };
  };

  try {
    if (usingShared) {
      if (REUSE_PAGE) {
        return await timing.time("shared.page.serial", () =>
          withSerializedSharedPage(timing, runOnce),
        );
      }
      page = await timing.time("context.newPage", () => context.newPage());
      return await runOnce(page);
    }

    page = await timing.time("browser.newPage", () =>
      browser.newPage({ userAgent: USER_AGENT }),
    );
    return await runOnce(page);
  } catch (err) {
    log("err", "rottenSearch error", query, err.message);
    return null;
  } finally {
    if (page && usingShared && !REUSE_PAGE) {
      await timing.time("page.close", () => page.close());
    }
    if (page && !usingShared) {
      // page is closed as part of browser.close
    }
    if (!usingShared && browser) {
      await timing.time("browser.close", () => browser.close());
    }
    const elapsed = ((Date.now() - rottenStartTime) / 1000).toFixed(0);
    log(`finished rottenSearch: ${elapsed} secs, "${query}"`);
    timing.report(12);
  }
}

if ((process.argv[1] || "").endsWith("/src/rotten.js") && cliQuery) {
  (async () => {
    await rottenSearch(cliQuery);
    await rottenShutdown();
  })();
}
