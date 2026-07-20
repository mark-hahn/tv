import fs from "fs";
import * as path from "node:path";
import fetch from "node-fetch";
import { chromium } from "playwright";
import WebSocket from "ws";
import * as urls from "./urls.js";
import { rottenSearch } from "./rotten.js";
import * as loid from "./loid.js";
import * as util from "./util.js";
import {
  smartTitleMatch,
  getSeasonIntro as getSeasonIntroShared,
} from "@tv/share";
import * as epd from "@tv/share";
import { unilog, logHere } from "@tv/share";
import { SRVR_DATA_DIR } from "./srvrPaths.js";
import {
  backupDb,
  deleteShow,
  loadAllShows,
  saveAllShows,
  saveShow,
} from "./tvdbDb.js";
import { MovieDb } from "moviedb-promise";
import { getTvmazeIdByTvdbId } from "../../api/src/tvmaze.js";
const { log, start, end } = util.getLog("tvdb");
const TVDB_TEMPLATE_PATH = path.join(SRVR_DATA_DIR, "tvdbTemplate.json");

const FAST_UPDATE = false;
const TVDB_UPDATE_DELAY_MS = FAST_UPDATE ? 5 * 1000 : 2 * 60 * 1000;
const moviedb = new MovieDb("327192a334da700f65b882c7a69cb927");

// TVDB API Credentials
const TVDB_APIKEY = "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df";
const TVDB_PIN = "HXEVSDFF";

// Wiki/Reddit button verification: load the page and confirm it is really
// about the show before returning the button. Similarity is
// 1 - (levenshtein / max-length) after collapsing to lower-case alpha chars.
const REDDIT_SIMILARITY_MIN = 0.5; // reddit button kept if similarity > this
const WIKI_SIMILARITY_MIN = 0.8; // wikipedia button kept if similarity > this
// reddit rate-limits by IP and answers 403/429 when it wants us to stop.
// After one of those, make no reddit requests at all for this long.
const REDDIT_BLOCK_MS = 24 * 60 * 60 * 1000;
const VERIFY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// cache token relative to file scope
let cachedToken = null;
let cachedAtMs = 0;

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function getToken() {
  const now = Date.now();
  if (cachedToken && now - cachedAtMs < 20 * 60 * 60 * 1000) return cachedToken;

  const { res, json, text } = await fetchJson(
    "https://api4.thetvdb.com/v4/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: TVDB_APIKEY, pin: TVDB_PIN }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `TVDB login failed: ${res.status} ${text?.slice(0, 200) || ""}`.trim(),
    );
  }

  const token = json?.data?.token;
  if (!token) throw new Error("TVDB login failed: missing token");
  cachedToken = token;
  cachedAtMs = now;
  return token;
}

function buildTvdbUrl(tvdbPath, query) {
  const safePath = String(tvdbPath || "").replace(/^\/+/, "");
  const url = new URL(`https://api4.thetvdb.com/v4/${safePath}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  return url;
}

function setImdbId(tvdb) {
  // Prefer flat prop (set when remotes are fetched)
  if (tvdb?.imdbUrl) {
    const match = /tt\d+/.exec(tvdb.imdbUrl);
    if (match) {
      tvdb.imdbId = match[0];
      return;
    }
  }
  if (!tvdb?.remotes) return;
  for (const remote of tvdb.remotes) {
    if (remote.url && remote.url.includes("imdb.com/title/")) {
      const match = /tt\d+/.exec(remote.url);
      if (match) {
        tvdb.imdbId = match[0];
        return;
      }
    }
  }
}

// One-time migration: extract flat url props from legacy remotes arrays on startup.
// Safe to run repeatedly — skips records that already have flat props.
function migrateRemotesToFlatProps(data) {
  let migrated = 0;
  for (const rec of Object.values(data)) {
    if (!rec || typeof rec !== "object" || !Array.isArray(rec.remotes))
      continue;
    for (const r of rec.remotes) {
      if (!r?.name || !r?.url) continue;
      if (r.name.startsWith("Rotten") && !rec.rottenUrl) {
        rec.rottenUrl = r.url;
        // e.g. "Rotten (97/94)" -> "97/94"
        const m = r.name.match(/\(([^)]+)\)/);
        if (m) rec.rottenRatings = m[1];
        migrated++;
      } else if (r.name.startsWith("IMDB") && !rec.imdbUrl) {
        rec.imdbUrl = r.url;
        const m = r.name.match(/\(([^)]+)\)/);
        if (m) rec.imdbRatings = m[1];
        migrated++;
      } else if (r.name === "Wikipedia" && !rec.wikiUrl) {
        rec.wikiUrl = r.url;
        migrated++;
      } else if (r.name === "Reddit" && !rec.redditUrl) {
        rec.redditUrl = r.url;
        migrated++;
      }
    }
  }
  if (migrated > 0)
    unilog(714, `migrated flat url props for ${migrated} remote entries`);
  return data;
}

function stripLegacyLastWatched(data) {
  for (const rec of Object.values(data || {})) {
    if (rec && typeof rec === "object" && "lastWatched" in rec) {
      delete rec.lastWatched;
    }
  }
  return data;
}

// Dead fields no code reads plus junk keys leaked from API params or internal
// change-tracking flags. Stripped from every record at startup.
const DEAD_TVDB_FIELDS = [
  "downloadStatus",
  "downloadLastCheck",
  "tvmazeStatus",
  "lastDiskCheck",
  "lastMetadataUpdate",
  "introDur",
  "score",
  "added",
  "allWatchedOrHaveFile",
  "haveSubs",
  "lastEmbySync",
  "type",
  "tagline",
  "homepage",
  "backdrop",
  "createdBy",
  "inProduction",
  "spokenLanguages",
  "productionCompanies",
  "numberOfSeasons",
  "numberOfEpisodes",
  "_hasChanges",
  "_push1Changes",
  "dontEnqueue",
  "dontNotify",
  "ratings",
  "notes",
];

function stripDeadFields(data) {
  let cleaned = 0;
  for (const rec of Object.values(data || {})) {
    if (!rec || typeof rec !== "object") continue;
    let hit = false;
    for (const field of DEAD_TVDB_FIELDS) {
      if (field in rec) {
        delete rec[field];
        hit = true;
      }
    }
    if (hit) cleaned++;
  }
  if (cleaned > 0) {
    unilog(1577, `stripped dead fields from ${cleaned} records`);
  }
  return data;
}

// Helper functions for watchedEpis format
// watchedEpis format: [[seasonNum, ep1, ep2, ...], [seasonNum, ep1, ep2, ...]]
// Each entry lists the season number followed by episode numbers that have been played

/**
 * Extract watchedEpis from seriesMap
 * @param {Array} seriesMap - Format: [[seasonNum, [[epNum, {played, ...}], ...]], ...]
 * @returns {Array} watchedEpis - Format: [[seasonNum, ep1, ep2, ...], ...]
 */
function seriesMapToWatchedEpis(seriesMap) {
  if (!seriesMap || !Array.isArray(seriesMap)) return [];

  const watchedEpis = [];
  for (const [seasonNum, episodes] of seriesMap) {
    if (!Array.isArray(episodes)) continue;

    const watchedEps = [];
    for (const [episodeNum, epiObj] of episodes) {
      if (epiObj?.played) {
        watchedEps.push(episodeNum);
      }
    }

    // Only include seasons that have watched episodes
    if (watchedEps.length > 0) {
      watchedEps.sort((a, b) => a - b);
      watchedEpis.push([seasonNum, ...watchedEps]);
    }
  }

  return watchedEpis;
}

/**
 * Calculate watchedCount from watchedEpis
 * @param {Array} watchedEpis - Format: [[seasonNum, ep1, ep2, ...], ...]
 * @returns {number} Total count of watched episodes
 */
function calculateWatchedCount(watchedEpis) {
  if (!watchedEpis || !Array.isArray(watchedEpis)) return 0;

  let count = 0;
  for (const seasonEntry of watchedEpis) {
    if (!Array.isArray(seasonEntry) || seasonEntry.length < 1) continue;
    // First element is season number, rest are episode numbers
    count += seasonEntry.length - 1;
  }
  return count;
}

/**
 * Apply watchedEpis to seriesMap (set played status)
 * @param {Array} seriesMap - Format: [[seasonNum, [[epNum, {played, ...}], ...]], ...]
 * @param {Array} watchedEpis - Format: [[seasonNum, ep1, ep2, ...], ...]
 * @returns {Array} Updated seriesMap with played status
 */
function applyWatchedEpisToSeriesMap(seriesMap, watchedEpis) {
  if (!seriesMap || !Array.isArray(seriesMap)) return seriesMap;
  if (!watchedEpis || !Array.isArray(watchedEpis)) return seriesMap;

  // Build a Set of watched episodes for quick lookup
  const watchedSet = new Map();
  for (const seasonEntry of watchedEpis) {
    if (!Array.isArray(seasonEntry) || seasonEntry.length < 1) continue;
    const [seasonNum, ...episodes] = seasonEntry;
    watchedSet.set(seasonNum, new Set(episodes));
  }

  // Apply played status to seriesMap
  const updatedMap = [];
  for (const [seasonNum, episodes] of seriesMap) {
    const watched = watchedSet.get(seasonNum);
    const updatedEpisodes = [];

    for (const [episodeNum, epiObj] of episodes) {
      const played = watched ? watched.has(episodeNum) : false;
      updatedEpisodes.push([episodeNum, { ...epiObj, played }]);
    }

    updatedMap.push([seasonNum, updatedEpisodes]);
  }

  return updatedMap;
}

/**
 * Fetch series map from TVDB API
 * @param {number} tvdbId - The TVDB ID
 * @param {Array} watchedEpis - Optional watchedEpis to apply played status
 * @returns {Array} seriesMap with episode data
 */
async function getSeriesMap(tvdbId, watchedEpis = null) {
  if (!tvdbId) return [];

  const seriesMap = [];
  let allEpisodes = [];
  let page = 0;
  let safety = 0;
  const seenPages = new Set();
  const missingEpisodeNumBySeason = {};
  const missingEpisodeNumSamples = [];

  // Fetch all episodes with pagination
  while (true) {
    seenPages.add(page);

    const url = buildTvdbUrl(`series/${tvdbId}/episodes/default`, {
      page,
      seasonType: "official",
      perPage: 100,
    });

    let res;
    try {
      const token = await getToken();
      res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        unilog(715, "getSeriesMap: failed to fetch episodes", {
          tvdbId,
          page,
          status: res.status,
        });
        break;
      }
    } catch (e) {
      unilog(716, "getSeriesMap: fetch error", {
        tvdbId,
        page,
        error: e.message,
      });
      break;
    }

    const data = await res.json();
    const episodes = data?.data?.episodes || [];
    const links = data?.links || {};

    allEpisodes = allEpisodes.concat(episodes);

    // Derive next page
    let nextPage = null;
    if (links.next !== undefined && links.next !== null) {
      if (Number.isFinite(links.next)) {
        nextPage = links.next;
      } else if (typeof links.next === "string") {
        const match = links.next.match(/page=(\d+)/);
        if (match) nextPage = Number(match[1]);
      } else if (links.next) {
        nextPage = page + 1;
      }
    }

    if (nextPage === null) break;
    if (seenPages.has(nextPage)) break;
    if (safety++ > 50) break;
    page = nextPage;
  }

  // Group episodes by season
  const seasonMap = {};
  for (const epData of allEpisodes) {
    const seasonNum =
      epData.seasonNumber ??
      epData.airedSeason ??
      epData.airedSeasonNumber ??
      epData.season ??
      (typeof epData.seasonName === "string" && epData.seasonName.match(/\d+/)
        ? Number(epData.seasonName.match(/\d+/)[0])
        : undefined);

    const episodeNum =
      epData.number ?? epData.airedEpisodeNumber ?? epData.episodeNumber;

    if (seasonNum === undefined || seasonNum === null || seasonNum === 0)
      continue;

    if (!seasonMap[seasonNum]) {
      seasonMap[seasonNum] = [];
    }

    const normalizedEpisodeNum = Number(episodeNum);
    if (!Number.isFinite(normalizedEpisodeNum) || normalizedEpisodeNum <= 0) {
      missingEpisodeNumBySeason[seasonNum] =
        (missingEpisodeNumBySeason[seasonNum] || 0) + 1;
      if (missingEpisodeNumSamples.length < 8) {
        missingEpisodeNumSamples.push({
          season: seasonNum,
          episodeNum,
          id: epData?.id ?? null,
          name: epData?.name ?? null,
          aired: epData?.aired ?? null,
        });
      }
    }

    // Unknown air-date should not be treated as unaired.
    let unaired = false;
    let avail = false;
    if (epData.aired) {
      try {
        const airedDate = new Date(epData.aired);
        if (Number.isNaN(airedDate.getTime())) {
          throw new Error("invalid aired date");
        }
        const today = new Date();
        const airedYMD = new Date(
          airedDate.getFullYear(),
          airedDate.getMonth(),
          airedDate.getDate(),
        );
        const todayYMD = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        );
        unaired = airedYMD > todayYMD;
        avail = !unaired;
      } catch (e) {
        unaired = false;
        avail = false;
      }
    }

    seasonMap[seasonNum].push([
      episodeNum,
      {
        error: false,
        played: false,
        avail: avail,
        noFile: true,
        unaired: unaired,
        deleted: false,
        aired: epData.aired || null,
      },
    ]);
  }

  // Fix unaired status: episodes with null aired dates that come after unaired episodes
  // should also be marked as unaired (can't air E03 before E01 airs)
  for (const seasonNum of Object.keys(seasonMap)) {
    const episodes = seasonMap[seasonNum];

    // Sort by episode number to process in order
    episodes.sort((a, b) => a[0] - b[0]);

    // Track if we've encountered an unaired episode
    let hasUnairedEarlier = false;

    for (const [episodeNum, episodeObj] of episodes) {
      // If this episode is marked unaired (has future air date), set the flag
      if (episodeObj.unaired) {
        hasUnairedEarlier = true;
      }
      // If no aired date and an earlier episode is unaired, mark this as unaired too
      else if (hasUnairedEarlier && !episodeObj.aired) {
        episodeObj.unaired = true;
        episodeObj.avail = false;
      }
    }
  }

  // Convert to seriesMap format
  const seasonNums = Object.keys(seasonMap)
    .map(Number)
    .sort((a, b) => a - b);
  for (const seasonNum of seasonNums) {
    seriesMap.push([seasonNum, seasonMap[seasonNum]]);
  }

  if (missingEpisodeNumSamples.length > 0) {
    unilog(
      717,
      "warn",
      "getSeriesMap: episodes missing numeric episode number",
      {
        tvdbId,
        missingEpisodeNumBySeason,
        sample: missingEpisodeNumSamples,
      },
    );
  }

  // Apply watchedEpis if provided
  if (watchedEpis && watchedEpis.length > 0) {
    return applyWatchedEpisToSeriesMap(seriesMap, watchedEpis);
  }

  return seriesMap;
}

const UPDATE_DATA = true;

let allTvdb = {};
try {
  allTvdb = loadAllShows();
  stripDeadFields(stripLegacyLastWatched(migrateRemotesToFlatProps(allTvdb)));
  saveAllShows(allTvdb);
} catch (e) {
  throw new Error(
    `[tvdb] startup aborted: cannot load valid tvdb data from sqlite: ${e.message}`,
  );
}

const runTvdbSweep = () => {
  try {
    saveAllShows(allTvdb);
  } catch (e) {
    unilog(1525, `tvdb sweep failed: ${e.message}`);
  }
};

const runTvdbBackup = () => {
  try {
    backupDb();
  } catch (e) {
    unilog(1526, `tvdb backup failed: ${e.message}`);
  }
};

setInterval(runTvdbSweep, 5 * 60 * 1000);
runTvdbBackup();
setInterval(runTvdbBackup, 24 * 60 * 60 * 1000);

///////////// get theTvdbToken //////////////
// this is a duplicate of the client
// both access tvdb.com independently

// Use shared getToken() instead of maintaining separate theTvdbToken
// const getTheTvdbToken = async () => {
//   await getToken();
// };

///////////////////// GET REMOTES ///////////////////////

const IMDB_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
let imdbBrowser = null;
let imdbContext = null;

async function getImdbBrowser() {
  try {
    if (
      imdbBrowser &&
      typeof imdbBrowser.isConnected === "function" &&
      imdbBrowser.isConnected()
    ) {
      return imdbBrowser;
    }
  } catch {
    // ignore
  }

  try {
    if (imdbBrowser) await imdbBrowser.close();
  } catch {
    // ignore
  }
  imdbContext = null;

  imdbBrowser = await chromium.launch({ headless: true });
  return imdbBrowser;
}

async function getImdbContext() {
  const b = await getImdbBrowser();
  try {
    if (imdbContext) {
      // verify it's still usable by checking browser connection
      if (b.isConnected()) return imdbContext;
    }
  } catch {
    // ignore
  }
  imdbContext = await b.newContext({
    userAgent: IMDB_USER_AGENT,
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  return imdbContext;
}

const extractImdbRating = (html) => {
  if (!html) return null;

  // Primary (current site): still present on many pages.
  let m = /aggregate-rating__score.*?>([\d.]+)</i.exec(html);
  if (m?.[1]) return m[1];

  // Fallback: JSON data embedded in the page.
  m = /"aggregateRating"\s*:\s*\{[^}]*?"ratingValue"\s*:\s*"?([\d.]+)"?/i.exec(
    html,
  );
  if (m?.[1]) return m[1];

  // Last resort: any ratingValue (can be less specific).
  m = /"ratingValue"\s*:\s*"?([\d.]+)"?/i.exec(html);
  if (m?.[1]) return m[1];

  return null;
};

const extractImdbVideo = (html) => {
  if (!html) return null;

  // Try to find direct MP4 video URL
  let m =
    /"url"\s*:\s*"(https:\/\/imdb-video\.media-imdb\.com\/[^"]*\.mp4[^"]*)"/i.exec(
      html,
    );
  if (m?.[1]) {
    return m[1].replace(/\\u0026/g, "&");
  }

  // Fallback: Look for IMDB video page URL
  m = /"url"\s*:\s*"(https:\/\/www\.imdb\.com\/video\/vi\d+\/?)"/.exec(html);
  if (m?.[1]) return m[1];

  // Last resort: Look for any video ID and construct URL
  m = /\/video\/(vi\d+)/i.exec(html);
  if (m?.[1]) {
    return `https://www.imdb.com/video/${m[1]}/`;
  }

  return null;
};

const getUrlAndRatings = async (type, url, name) => {
  if (+type === 2) {
    let page = null;
    let resp = null;
    try {
      const ctx = await getImdbContext();
      page = await ctx.newPage();
      resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      // IMDB sometimes returns HTTP 202 (deferred/CSR render) with an empty
      // skeleton. Wait for JSON-LD or <h1> to appear so the rating is present.
      // For SSR pages (200) this resolves instantly; for deferred pages it waits.
      await page
        .waitForFunction(
          () =>
            document.querySelectorAll('script[type="application/ld+json"]')
              .length > 0 || !!document.querySelector("h1"),
          { timeout: 10000 },
        )
        .catch(() => {});
      // The rating score (and its sibling reviewer-count div) hydrate later
      // than h1/JSON-LD on deferred pages, so give it its own short wait.
      await page
        .waitForSelector(
          '[data-testid="hero-rating-bar__aggregate-rating__score"]',
          { timeout: 5000 },
        )
        .catch(() => {});
    } catch (e) {
      unilog(
        721,
        "err",
        `getUrlAndRatings imdb playwright error for ${name}: ${url}, ${e.message}`,
      );
      try {
        await page?.close();
      } catch {}
      return { ratings: null, reviewers: null, video: null };
    }

    if (!resp || !resp.ok()) {
      const status = resp ? resp.status() : null;
      unilog(
        722,
        "err",
        `getUrlAndRatings imdb fetch error for ${name}: ${url}, status=${status}`,
      );
      try {
        await page?.close();
      } catch {}
      return { ratings: null, reviewers: null, video: null };
    }

    try {
      // Single evaluate: extract rating, video, and challenge detection all at once
      const result = await page
        .evaluate(() => {
          const html = document.documentElement.outerHTML;
          const compact = html.replace(/\r?\n/gm, "").replace(/\s+/gm, " ");

          const hasChallengeMarkers =
            /verify you are human|please verify you are a human|enter the characters you see below|type the characters you see/i.test(
              compact,
            );
          const hasRatingEvidence =
            /ipc-rating-star--rating|"aggregateRating"|"ratingValue"/i.test(
              compact,
            );

          if (hasChallengeMarkers && !hasRatingEvidence) {
            return { challenge: true };
          }

          // --- Rating extraction ---
          let rating = null;

          // 1. JSON-LD
          const scripts = document.querySelectorAll(
            'script[type="application/ld+json"]',
          );
          const visit = (node) => {
            if (!node || typeof node !== "object") return null;
            if (Array.isArray(node)) {
              for (const item of node) {
                const f = visit(item);
                if (f !== null) return f;
              }
              return null;
            }
            const typeVal = node["@type"];
            const typeList = Array.isArray(typeVal) ? typeVal : [typeVal];
            if (
              typeList.some((t) =>
                ["TVSeries", "Movie", "TVMiniSeries"].includes(String(t || "")),
              )
            ) {
              if (node.aggregateRating?.ratingValue !== undefined) {
                const v = parseFloat(String(node.aggregateRating.ratingValue));
                if (!Number.isNaN(v) && v >= 0 && v <= 10) return v;
              }
              // No aggregateRating on this show node — don't recurse into children
              return null;
            }
            if (node["@graph"]) {
              const f = visit(node["@graph"]);
              if (f !== null) return f;
            }
            for (const v of Object.values(node)) {
              const f = visit(v);
              if (f !== null) return f;
            }
            return null;
          };
          for (const s of scripts) {
            try {
              const f = visit(JSON.parse(s.textContent || ""));
              if (f !== null) {
                rating = String(f);
                break;
              }
            } catch {}
          }

          // 2. DOM selectors
          if (!rating) {
            const selectors = [
              '[data-testid="hero-rating-bar__aggregate-rating__score"] [data-testid="rating-histogram-star"]',
              '[data-testid="hero-rating-bar__aggregate-rating"] .ipc-rating-star--rating',
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                const v = parseFloat((el.textContent || "").trim());
                if (!Number.isNaN(v) && v >= 0 && v <= 10) {
                  rating = String(v);
                  break;
                }
              }
            }
          }

          // 3. Regex fallbacks on HTML
          if (!rating) {
            let m = /aggregate-rating__score.*?>([\d.]+)</i.exec(compact);
            if (m?.[1]) rating = m[1];
          }
          if (!rating) {
            let m =
              /"aggregateRating"\s*:\s*\{[^}]*?"ratingValue"\s*:\s*"?([\d.]+)"?/i.exec(
                compact,
              );
            if (m?.[1]) rating = m[1];
          }

          // --- Reviewer count extraction (sibling div of the rating score,
          // under the score's immediate parent, e.g. score/spacer/count) ---
          let reviewers = null;
          const scoreEl = document.querySelector(
            '[data-testid="hero-rating-bar__aggregate-rating__score"]',
          );
          if (scoreEl?.parentElement) {
            const divs = Array.from(scoreEl.parentElement.children).filter(
              (el) => el.tagName === "DIV",
            );
            const countText = (divs[divs.length - 1]?.textContent || "").trim();
            if (/^[\d,.]+[KMB]?$/i.test(countText))
              reviewers = countText.toLowerCase();
          }

          // --- Video extraction ---
          let video = null;
          let m =
            /"url"\s*:\s*"(https:\/\/imdb-video\.media-imdb\.com\/[^"]*\.mp4[^"]*)"/i.exec(
              compact,
            );
          if (m?.[1]) {
            video = m[1].replace(/\\u0026/g, "&");
          } else {
            m =
              /"url"\s*:\s*"(https:\/\/www\.imdb\.com\/video\/vi\d+\/?)"/.exec(
                compact,
              );
            if (m?.[1]) video = m[1];
            else {
              m = /\/video\/(vi\d+)/i.exec(compact);
              if (m?.[1]) video = "https://www.imdb.com/video/" + m[1] + "/";
            }
          }

          return { rating, reviewers, video };
        })
        .catch(() => null);

      try {
        await page.close();
      } catch {}

      if (!result || result.challenge) {
        if (result?.challenge)
          unilog(
            723,
            `getUrlAndRatings imdb challenge page for ${name}: ${url}`,
          );
        return { ratings: null, reviewers: null, video: null };
      }

      if (!result.rating && !result.video)
        return { ratings: null, reviewers: null, video: null };
      return {
        ratings: result.rating,
        reviewers: result.reviewers,
        video: result.video,
      };
    } catch (e) {
      unilog(
        724,
        "err",
        `getUrlAndRatings imdb parse error for ${name}: ${url}, ${e.message}`,
      );
      try {
        await page?.close();
      } catch {}
      return { ratings: null, reviewers: null, video: null };
    }
  }

  switch (+type) {
    default:
      return "getUrlAndRatings invalid type: " + type;
  }
};

///////////// get remote (name, url, & ratings) //////////////

const getRemote = async (id, type, showName) => {
  let url = null;
  let ratings = null;
  let reviewers = null;
  let video = null;
  let urlRatings, name, escShow;

  switch (type) {
    case 2:
      name = "IMDB";
      if (!id) {
        unilog(1441, `getRemote IMDB missing id for ${showName}`);
        return { name, url: null, ratings: null, reviewers: null, video: null };
      }
      url = `https://www.imdb.com/title/${id}`;
      urlRatings = await getUrlAndRatings(2, url, name);
      ratings = urlRatings?.ratings;
      reviewers = urlRatings?.reviewers;
      video = urlRatings?.video;
      break;

    case 4:
      name = "Official Website";
      url = id;
      break;

    case 7:
      name = "Reddit";
      {
        if (loid.isLoidNeeded()) break; // waiting on a new loid cookie
        const escShow = encodeURIComponent(showName);
        const redditApiUrl = `https://www.reddit.com/subreddits/search.json?q=${escShow}&limit=10`;
        try {
          const loidVal = await loid.getLoid();
          const resp = await fetch(redditApiUrl, {
            headers: { "User-Agent": "tv-app/1.0", Cookie: `loid=${loidVal}` },
            signal: AbortSignal.timeout(8000),
          });
          if (!resp.ok) {
            let errDetail = "";
            try {
              const body = (await resp.text()).trim();
              if (body.startsWith("{") || body.startsWith("[")) {
                try {
                  const j = JSON.parse(body);
                  const parts = [j.reason, j.message, j.explanation].filter(
                    (p) => typeof p === "string",
                  );
                  errDetail = parts.length
                    ? ` cause: ${parts.join(" - ")}`
                    : ` cause: json error ${j.error ?? body.slice(0, 120)}`;
                } catch {
                  errDetail = ` cause: bad json ${body.slice(0, 120)}`;
                }
              } else if (/whoa there, pardner|blocked/i.test(body)) {
                errDetail = " cause: blocked by reddit (ip/user-agent ban)";
              } else if (/<title>([^<]*)<\/title>/i.test(body)) {
                const title = body.match(/<title>([^<]*)<\/title>/i)[1].trim();
                errDetail = ` cause: html page "${title}"`;
              } else if (body) {
                errDetail = ` cause: ${body.slice(0, 120)}`;
              }
              if (resp.status === 429) {
                const retry = resp.headers.get("retry-after");
                errDetail += ` (rate limited${retry ? `, retry-after ${retry}s` : ""})`;
              }
            } catch {}
            unilog(
              725,
              `reddit search ${resp.status} for ${showName}${errDetail}`,
            );
            if (resp.status === 403) loid.loidFailed();
            break;
          }
          const json = await resp.json();
          const subs = json?.data?.children?.map((c) => c.data) ?? [];
          const clean = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
          const showClean = clean(showName);
          const match =
            subs.find((s) => clean(s.display_name) === showClean) ??
            subs.find((s) => clean(s.title) === showClean) ??
            subs[0];
          if (match)
            url = `https://www.reddit.com${match.url.replace(/\/$/, "")}`;
        } catch (e) {
          unilog(
            726,
            "err",
            `reddit search error for ${showName}: ${e.message}`,
          );
        }
      }
      break;

    // case 8:   url = id; name = 'Instagram'; break;
    // case 9:   url = `https://www.instagram.com/${id}`; break;
    // case 11:  url = `https://www.youtube.com/channel/${id}`; break;
    // case 12: name = 'The Movie DB';
    //           url = `https://www.themoviedb.org/tv/${id}` +
    //                 `?language=en-US`;
    //          break;
    // case 13: name = 'EIDR'; continue;

    case 18:
      name = "Wikipedia";
      {
        const escShow = encodeURIComponent(showName + " tv series");
        const wikiApiUrl =
          `https://en.wikipedia.org/w/api.php?action=query&list=search` +
          `&srsearch=${escShow}&format=json&srlimit=5&origin=*`;
        try {
          const resp = await fetch(wikiApiUrl, {
            headers: { "User-Agent": "tv-app/1.0" },
            signal: AbortSignal.timeout(8000),
          });
          if (!resp.ok) {
            unilog(
              727,
              "err",
              `wikipedia search ${resp.status} for ${showName}`,
            );
            break;
          }
          const json = await resp.json();
          const results = json?.query?.search ?? [];
          if (results.length > 0) {
            const title = results[0].title;
            url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%20/g, "_")}`;
          }
        } catch (e) {
          unilog(
            728,
            "err",
            `wikipedia search error for ${showName}: ${e.message}`,
          );
        }
      }
      break;

    // case 19: url = `https://www.tvmaze.com/shows/${id}`; break;

    case 99: // rotten tomatoes
      name = "Rotten";
      urlRatings = await rottenSearch(showName);
      if (!urlRatings) return null;
      // console.log("getRemote rottenSearch:", urlRatings);
      url = urlRatings.url;
      ratings =
        urlRatings.criticsScore === 0 && urlRatings.audienceScore === 0
          ? null
          : urlRatings.criticsScore + "/" + urlRatings.audienceScore;
      break;

    default:
      return null;
  }

  if (!url) {
    // log(`getRemote, no url: ${name}`);
    return null;
  }
  // console.log(`getRemote`, { name, url, ratings });
  return { name, url, ratings, reviewers, video };
};

///////////// wiki / reddit url verification //////////////

// collapse a name for comparison: strip html escapes (&amp; &nbsp; &#39; ...)
// first so they don't inject junk letters, then keep only lower-case alpha.
const collapseAlpha = (s) =>
  (s || "")
    .replace(/&[a-z0-9#]+;/gi, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// similarity of two show names, collapsed to lower-case alpha chars
function nameSimilarity(a, b) {
  const x = collapseAlpha(a),
    y = collapseAlpha(b);
  const max = Math.max(x.length, y.length);
  if (!max) return 0;
  return 1 - levenshtein(x, y) / max;
}

// wikipedia page name: <title>NAME - Wikipedia</title>, then drop a trailing
// "(...)" disambiguator like "(TV series)" / "(2024 TV series)".
function wikiNameFromHtml(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  if (!m) return null;
  return m[1]
    .replace(/\s*-\s*Wikipedia\s*$/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

// reddit page name (old.reddit): og:title is "<community title> • r/<slug>";
// the slug is what the user's match examples compare against.
function redditNameFromHtml(html) {
  const og = html.match(/property="og:title"\s+content="([^"]*)"/i);
  if (og) {
    const slug = og[1].match(/r\/([A-Za-z0-9_]+)\s*$/);
    if (slug) return slug[1];
    return og[1];
  }
  const t = html.match(/<title>([^<]*)<\/title>/i);
  return t ? t[1].trim() : null;
}

// www.reddit.com serves a JS-challenge wall to plain fetches; old.reddit does not
const toOldReddit = (u) => u.replace(/:\/\/(www\.)?reddit\.com/, "://old.reddit.com");

// Set when reddit answers 403/429; until this time no reddit request is made at
// all. In memory only -- after a restart the first 403 re-arms it immediately.
let redditBlockedUntilMs = 0;

// Load the page for a wiki/reddit url and confirm it is really about `showName`.
// Returns true (matches), false (definite mismatch, or a 404 meaning the article
// /subreddit does not exist, e.g. a banned sub), or null when the check is
// inconclusive (transient 5xx/429/403, unparseable page, network error). A null
// must never be cached as a result -- the caller keeps the button and retries
// later -- otherwise a rate-limit window silently stamps everything as verified.
async function verifyRemoteName(kind, showName, url) {
  // reddit told us to back off -- make no request at all until the block expires
  if (kind === "reddit" && Date.now() < redditBlockedUntilMs) return null;
  try {
    const fetchUrl = kind === "reddit" ? toOldReddit(url) : url;
    // use global fetch (undici): old.reddit 403s the node-fetch client
    const resp = await globalThis.fetch(fetchUrl, {
      headers: { "User-Agent": VERIFY_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    // 403/429 from reddit = rate limited -> stop hitting it for 24h
    if (kind === "reddit" && (resp.status === 403 || resp.status === 429)) {
      redditBlockedUntilMs = Date.now() + REDDIT_BLOCK_MS;
      unilog(1561, `reddit http=${resp.status} rate limited -- skipping all reddit checks for 24h`);
      return null;
    }
    // transient server errors (5xx) -> inconclusive, keep the button
    if (!resp.ok && resp.status !== 404) {
      unilog(1562, `Skip ${kind}: show="${showName}" http=${resp.status} (inconclusive, button kept)`);
      return null;
    }
    const html = await resp.text();
    const pageName =
      kind === "reddit" ? redditNameFromHtml(html) : wikiNameFromHtml(html);
    // reachable 200 page we couldn't parse a name from -> inconclusive, keep
    if (resp.ok && !pageName) return null;
    const sim = pageName ? nameSimilarity(showName, pageName) : 0;
    const min = kind === "reddit" ? REDDIT_SIMILARITY_MIN : WIKI_SIMILARITY_MIN;
    // a 404 (banned/missing) can never pass, regardless of any parsed name
    const pass = resp.ok && sim > min;
    const shown = pageName ?? `(http ${resp.status})`;
    const detail = `${kind}: show="${showName}" page="${shown}" sim=${sim.toFixed(3)}`;
    if (pass) {
      unilog(1552, `Pass ${detail}`);
    } else {
      unilog(1553, `Fail ${detail}`);
    }
    return pass;
  } catch (e) {
    unilog(1554, `verify ${kind} error for ${showName}: ${e.message}`);
    return null; // inconclusive -> keep button, do not cache a result
  }
}

///////////// get remotes  //////////////
// use tvdb remotes data to find complete remote data

const getRemotes = async (show, tvdbRemotes, fast = false) => {
  const name = show.name;
  const showId = show.id;
  const remotes = [];
  const flatUrls = {}; // flat url props to persist alongside the computed remotes array

  if (show.inEmby)
    remotes.push({ name: "Emby", url: urls.embyPageUrl(showId) });

  // Rotten Tomatoes: always use cached URL; scraping only happens in push3 of background task
  {
    let rottenFound = false;
    const cachedShow = allTvdb ? allTvdb[name] : null;
    if (cachedShow?.rottenUrl) {
      const rName = cachedShow.rottenRatings
        ? `Rotten (${cachedShow.rottenRatings})`
        : "Rotten";
      remotes.push({ name: rName, url: cachedShow.rottenUrl });
      rottenFound = true;
    } else if (cachedShow?.remotes) {
      // backward-compat: records not yet migrated to flat props
      const cachedRotten = cachedShow.remotes.find(
        (r) => r.name && r.name.startsWith("Rotten"),
      );
      if (cachedRotten) {
        remotes.push(cachedRotten);
        rottenFound = true;
      }
    }

    if (!rottenFound) {
      // Construct basic link without scraping
      const cleanName = name
        .trim()
        .toLowerCase()
        .replace(/['":.,!]/g, "")
        .replace(/\s+/g, "_");
      const url = `https://www.rottentomatoes.com/tv/${cleanName}`;
      if (await isValidUrl(url)) {
        remotes.push({ name: "Rotten", url });
      }
    }
  }

  // Always fetch other remotes (Google, Wikipedia, Reddit, IMDB, etc.)
  const encoded = encodeURI(name).replaceAll("&", "%26");
  const url = `https://www.google.com/search` + `?q=${encoded}%20tv%20show`;
  remotes.push({ name: "Google", url });

  // Parallelize independent remote fetches (Wikipedia, Reddit, tvdbRemotes, IMDB)
  const remotesByName = {};

  // Build parallel tasks for uncached remotes
  const parallelTasks = [];

  // Wikipedia + Reddit: build the url (cached or fresh), then verify the loaded
  // page is really about this show before returning the button. The true/false
  // result is cached in the `${x}Verified` flat prop and persisted. On the fast
  // path a url is tested only once and the stored result is reused; the
  // background path (fast=false) re-checks every time regardless of what is
  // stored, so a page that changed (sub banned, article renamed) is caught.
  // A url with no verified flag yet is still shown until its first test runs;
  // only an explicit false hides the button.
  const addVerifiedRemote = async ({
    kind,
    type,
    buttonName,
    urlKey,
    verifiedKey,
  }) => {
    const rec = allTvdb[name];
    let url = rec?.[urlKey] || null;
    let verified = rec?.[verifiedKey]; // true | false; null/undefined = not yet tested
    if (!url) {
      const r = await getRemote(null, type, name);
      url = r?.url || null;
      verified = undefined;
    }
    if (!url) return;
    flatUrls[urlKey] = url;
    // fast=true: test once and reuse the stored result.
    // fast=false (background): always re-check, even when a result is already
    // stored, so a page that changed (sub banned, article renamed) is caught.
    if (!fast || verified == null) {
      const result = await verifyRemoteName(kind, name, url);
      // null = inconclusive (rate limit / transient): keep whatever was stored
      // and persist nothing, so it is re-checked later instead of being
      // silently cached as verified.
      if (result != null) {
        verified = result;
        flatUrls[verifiedKey] = result;
      }
    }
    if (verified !== false) remotes.push({ name: buttonName, url });
  };

  parallelTasks.push(
    addVerifiedRemote({
      kind: "wiki",
      type: 18,
      buttonName: "Wikipedia",
      urlKey: "wikiUrl",
      verifiedKey: "wikiVerified",
    }),
  );
  parallelTasks.push(
    addVerifiedRemote({
      kind: "reddit",
      type: 7,
      buttonName: "Reddit",
      urlKey: "redditUrl",
      verifiedKey: "redditVerified",
    }),
  );

  // Other tvdbRemotes (excluding Wikipedia/Reddit/IMDB handled separately)
  for (const tvdbRemote of tvdbRemotes) {
    if (tvdbRemote.type == 18) continue;
    if (tvdbRemote.type == 7) continue;
    if (tvdbRemote.type == 2) continue;
    if (!tvdbRemote.id) continue;
    parallelTasks.push(
      getRemote(tvdbRemote.id, tvdbRemote.type, tvdbRemote.sourceName).then(
        (remote) => {
          if (remote && remote.url != "no match") {
            if (!remote.ratings) delete remote.ratings;
            remotesByName[remote.name] = remote;
          }
        },
      ),
    );
  }

  // IMDB:
  // fast=true (info pane / gallery): use cache if imdbUrl+imdbRatings present; scrape live if score missing
  // fast=false (background task): always scrape live for fresh ratings
  {
    const cachedShow = allTvdb ? allTvdb[name] : null;
    const useCachedImdb =
      fast && cachedShow?.imdbUrl && cachedShow?.imdbRatings;
    if (useCachedImdb) {
      const imdbEntry = { name: "IMDB", url: cachedShow.imdbUrl };
      imdbEntry.ratings = cachedShow.imdbRatings;
      if (cachedShow.imdbReviewers)
        imdbEntry.reviewers = cachedShow.imdbReviewers;
      if (cachedShow.imdbVideo) imdbEntry.video = cachedShow.imdbVideo;
      remotesByName["IMDB"] = imdbEntry;
    } else {
      parallelTasks.push(
        (async () => {
          const imdbTvdbRemote = tvdbRemotes.find((r) => r.type === 2);
          if (imdbTvdbRemote && imdbTvdbRemote.id) {
            const remote = await getRemote(
              imdbTvdbRemote.id,
              2,
              imdbTvdbRemote.sourceName,
            );
            if (remote && remote.url !== "no match") {
              if (!remote.ratings) delete remote.ratings;
              remotesByName["IMDB"] = remote;
            }
          }
          if (!remotesByName["IMDB"] && cachedShow?.imdbId) {
            const fallbackRemote = await getRemote(cachedShow.imdbId, 2, name);
            if (fallbackRemote) {
              remotesByName["IMDB"] = fallbackRemote;
            }
          }
          // Fallback: fetch IMDB ID from TVDB extended API using TvdbId
          if (!remotesByName["IMDB"] && show.tvdbId) {
            try {
              const token = await getToken();
              const extRes = await fetch(
                `https://api4.thetvdb.com/v4/series/${show.tvdbId}/extended`,
                {
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                  },
                  signal: AbortSignal.timeout(8000),
                },
              );
              if (extRes.ok) {
                const extData = (await extRes.json())?.data;
                const imdbRemoteId = (extData?.remoteIds || []).find(
                  (r) => r.type === 2,
                );
                if (imdbRemoteId?.id) {
                  const remote = await getRemote(
                    imdbRemoteId.id,
                    2,
                    imdbRemoteId.sourceName || name,
                  );
                  if (remote && remote.url !== "no match") {
                    if (!remote.ratings) delete remote.ratings;
                    remotesByName["IMDB"] = remote;
                  }
                }
              }
            } catch (e) {
              unilog(
                729,
                "err",
                `getRemotes IMDB tvdb-extended fallback error for ${name}: ${e.message}`,
              );
            }
          }
          // Fallback: look up IMDB ID via TMDB external_ids when TVDB has no IMDB link
          if (!remotesByName["IMDB"]) {
            const tmdbRemote = tvdbRemotes.find((r) => r.type === 12);
            if (tmdbRemote?.id) {
              try {
                const tmdbRes = await fetch(
                  `https://api.themoviedb.org/3/tv/${tmdbRemote.id}/external_ids?api_key=327192a334da700f65b882c7a69cb927`,
                  { signal: AbortSignal.timeout(8000) },
                );
                if (tmdbRes.ok) {
                  const tmdbData = await tmdbRes.json();
                  if (tmdbData?.imdb_id) {
                    const remote = await getRemote(tmdbData.imdb_id, 2, name);
                    if (remote && remote.url !== "no match") {
                      if (!remote.ratings) delete remote.ratings;
                      remotesByName["IMDB"] = remote;
                    }
                  }
                }
              } catch (e) {
                unilog(
                  730,
                  "err",
                  `getRemotes IMDB tmdb fallback error for ${name}: ${e.message}`,
                );
              }
            }
          }
          // Last resort: IMDB suggestion API search by show name
          if (!remotesByName["IMDB"]) {
            try {
              const slug = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_|_$/g, "");
              const sugRes = await fetch(
                `https://v2.sg.media-imdb.com/suggestion/t/${encodeURIComponent(slug)}.json`,
                { signal: AbortSignal.timeout(8000) },
              );
              if (sugRes.ok) {
                const sugData = await sugRes.json();
                const candidates = (sugData?.d || []).filter(
                  (r) => r.id?.startsWith("tt") && r.q === "TV series",
                );
                // Use smartTitleMatch to verify a candidate actually matches the show name
                const candidateObjs = candidates.map((r) => ({
                  name: r.l,
                  id: r.id,
                }));
                const matched = smartTitleMatch(
                  name,
                  candidateObjs,
                  null,
                  false,
                );
                if (matched) {
                  const remote = await getRemote(matched.id, 2, name);
                  if (remote && remote.url !== "no match") {
                    if (!remote.ratings) delete remote.ratings;
                    remotesByName["IMDB"] = remote;
                  }
                }
              }
            } catch (e) {
              unilog(
                731,
                "err",
                `getRemotes IMDB suggestion fallback error for ${name}: ${e.message}`,
              );
            }
          }
        })(),
      );
    }
  }

  await Promise.all(parallelTasks);

  const imdbRemote = remotesByName["IMDB"];
  if (imdbRemote) {
    imdbRemote.name += imdbRemote.ratings
      ? " (" +
        imdbRemote.ratings +
        ")" +
        (imdbRemote.reviewers ? " (" + imdbRemote.reviewers + ")" : "")
      : "";
    flatUrls.imdbUrl = imdbRemote.url || null;
    flatUrls.imdbRatings = imdbRemote.ratings || null;
    flatUrls.imdbReviewers = imdbRemote.reviewers || null;
    flatUrls.imdbVideo = imdbRemote.video || null;
    remotes.push(imdbRemote);
  }

  for (const [name, remote] of Object.entries(remotesByName)) {
    if (name !== "IMDB" && name !== "Rotten") remotes.push(remote);
  }

  // console.log("getRemotes result:", JSON.stringify(remotes, null, 2));

  return { remotes, urls: flatUrls };
};

function getTvdbImageUrl(extResObj) {
  // Try to find first English poster in artworks array
  const artworks = extResObj?.data?.artworks;
  if (artworks && Array.isArray(artworks)) {
    const englishPoster = artworks.find(
      (art) => art.language === "eng" && art.type === 2 && art.image,
    );
    if (englishPoster) {
      return englishPoster.image;
    }
  }

  // Fallback to main image
  return extResObj?.data?.image || "";
}

// Upcoming/in-development shows often have no extended artwork, but the TVDB
// search index can still carry a real poster thumbnail for them.
async function getTvdbSearchThumbnail(name, tvdbId, token) {
  try {
    const url = `https://api4.thetvdb.com/v4/search?type=series&query=${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    });
    if (!res.ok) return "";
    const obj = await res.json();
    const match = (obj?.data || []).find(
      (d) => String(d.tvdb_id) === String(tvdbId),
    );
    const thumb = match?.thumbnail || "";
    if (!thumb || thumb.includes("/images/missing/")) return "";
    return thumb;
  } catch (e) {
    unilog(1263, `search thumbnail fetch failed for ${name}: ${e.message}`);
    return "";
  }
}

function getTvdbCharacters(extResObj) {
  const characters = extResObj?.data?.characters;
  if (!characters || !Array.isArray(characters)) {
    return [];
  }
  return characters
    .filter((char) => char.peopleType === "Actor")
    .map((char) => ({
      character: char.name,
      actor: char.personName,
      image: char.personImgURL,
      tvdbUrl: char.url,
      sortOrder: char.sort,
      isFeatured: char.isFeatured,
    }));
}

const TVMAZE_CREW_TYPES = [
  "Creator",
  "Executive Producer",
  "Producer",
  "Writer",
];

async function getTvmazeCrew(tvdbId) {
  if (!tvdbId) return [];
  try {
    const tvmazeId = getTvmazeIdByTvdbId(tvdbId);
    if (!tvmazeId) return [];
    const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/crew`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((c) => TVMAZE_CREW_TYPES.includes(c.type))
      .map((c) => ({
        name: c.person?.name ?? "",
        type: c.type,
        image: c.person?.image?.medium ?? c.person?.image?.original ?? null,
      }))
      .filter((c) => c.name);
  } catch {
    return [];
  }
}

// Load TMDB field mapping template
let tvdbTemplate = null;
try {
  tvdbTemplate = JSON.parse(fs.readFileSync(TVDB_TEMPLATE_PATH, "utf8"));
} catch {
  tvdbTemplate = null;
}

// Helper to extract value from object using path notation (e.g., "networks[0].name")
function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split(/[\.\[\]]+/).filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

// Helper to get TMDB data as fallback for missing TVDB fields
async function getTmdbFallback(showName) {
  if (!tvdbTemplate) return null;

  try {
    const res = await moviedb.searchTv({ query: showName });
    const match = res.results?.[0];
    if (!match) return null;

    // Get detailed show info
    const details = await moviedb.tvInfo({ id: match.id });

    const result = {};
    const IMAGE_BASE = "https://image.tmdb.org/t/p/original";

    // Map each field using the template
    for (const [tvdbField, mapping] of Object.entries(tvdbTemplate.fields)) {
      let value = getByPath(details, mapping.tmdbPath);

      // Apply transforms
      if (value !== undefined && value !== null && mapping.transform) {
        switch (mapping.transform) {
          case "prependImageUrl":
            value = value ? `${IMAGE_BASE}${value}` : "";
            break;
          case "tmdbRatingToScore":
            value = value ? Math.round(value * 10000) : null;
            break;
          case "genresArray":
            // Keep as-is, already array of {id, name}
            break;
          case "creatorsArray":
          case "companiesArray":
          case "languagesArray":
            // Keep as-is, already arrays
            break;
        }
      }

      result[tvdbField] = value ?? "";
    }

    return result;
  } catch (err) {
    unilog(732, "getTmdbFallback error for", showName, err.message);
    return null;
  }
}

//////////// GET TVDB DATA //////////////
// fetch data from tvdb.com
// create tvdbData object
// update allTvdb & persisted tvdb db rows
// Calculate waitStr: earliest date when you can start watching any season and
// always have an episode ready (viewer watches 1/day, no air-date cadence assumed).
// For each episode ranked k (0-indexed by air date), you watch it on day startDate+k.
// It must be available: startDate+k >= airDate[k]+2  =>  startDate >= airDate[k]+2-k
// Episodes with a file on disk are already available — effective airDate = "2000-01-01".
// safe_start(season) = max over all k of (airDate[k] + 2 - k)
// waitDate = min(safe_start across all seasons with unwatched episodes).
// Returns "{M-DD}" or "{YY-M-DD}" when future, "" when past/today, null when no data.
const calculateWaitStr = (episodeData) => {
  try {
    if (!Array.isArray(episodeData)) return null;

    const today = new Date().toISOString().slice(0, 10);
    const FILE_AVAILABLE_DATE = "2000-01-01";

    // Build per-season episode map: season -> Map(episodeNum -> airDate).
    // If a file is on disk and the TVDB air date is in the future (unaired),
    // treat it as available today. Already-aired episodes use their TVDB date.
    const seasonData = new Map();
    epd.forEachEpisode(episodeData, (seasonNum, episodeNum) => {
      const airDate = epd.getAired(episodeData, seasonNum, episodeNum);
      if (!airDate) return;
      if (!seasonData.has(seasonNum)) seasonData.set(seasonNum, new Map());
      const hasDiskFile = epd.hasFile(episodeData, seasonNum, episodeNum);
      const effectiveDate = hasDiskFile ? FILE_AVAILABLE_DATE : airDate || "";
      seasonData.get(seasonNum).set(episodeNum, effectiveDate);
    });

    if (seasonData.size === 0) return null;

    let minWaitDate = null;

    for (const [seasonNum, episodes] of seasonData) {
      // Sort unwatched episode air dates ascending (by air date, not episode number).
      // For each rank i (0-indexed): startDate >= airDate[i] + 2 - i
      // safe_start = max over all i
      const unwatchedDates = [...episodes.entries()]
        .filter(([ep]) => !epd.isWatched(episodeData, seasonNum, ep))
        .map(([, d]) => d)
        .filter((d) => d)
        .sort();
      if (unwatchedDates.length === 0) continue;

      let safeStartMs = -Infinity;
      for (let i = 0; i < unwatchedDates.length; i++) {
        const ms =
          new Date(unwatchedDates[i]).getTime() + (2 - i) * 24 * 60 * 60 * 1000;
        if (ms > safeStartMs) safeStartMs = ms;
      }
      const safeStart = new Date(safeStartMs).toISOString().slice(0, 10);

      if (minWaitDate === null || safeStart < minWaitDate) {
        minWaitDate = safeStart;
      }
    }

    if (minWaitDate === null) return null;

    if (minWaitDate > today) {
      const oneYearOut = new Date(
        new Date(today).getTime() + 365 * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);
      if (minWaitDate > oneYearOut) return "";
      const waitMD = minWaitDate.slice(5).replace(/^0/, " ").trim();
      const todayYear = today.slice(0, 4);
      const waitYear = minWaitDate.slice(0, 4);
      const yearPrefix = waitYear !== todayYear ? `${waitYear.slice(2)}-` : "";
      return `{${yearPrefix}${waitMD}}`;
    }
    return ""; // safe to start now
  } catch (e) {
    // Silently fail on date calculation errors
  }
  return null;
};

const toPositiveInt = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const getApiCounts = (seriesData) => {
  const defaultSeasonType = Number(seriesData?.defaultSeasonType);
  const seasonTypeMatches = (itemSeasonType) => {
    if (!Number.isFinite(defaultSeasonType)) return true;
    const seasonTypeId =
      typeof itemSeasonType === "object"
        ? Number(itemSeasonType?.id)
        : Number(itemSeasonType);
    if (!Number.isFinite(seasonTypeId)) return true;
    return seasonTypeId === defaultSeasonType;
  };

  const episodeSeasonNums = [];
  if (Array.isArray(seriesData?.episodes)) {
    for (const epi of seriesData.episodes) {
      const seasonNumber = Number(epi?.seasonNumber);
      if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) continue;
      if (!seasonTypeMatches(epi?.seasonType)) continue;
      episodeSeasonNums.push(seasonNumber);
    }
  }

  const episodeCountFromEpisodes = toPositiveInt(episodeSeasonNums.length);
  const seasonCountFromEpisodes = toPositiveInt(
    new Set(episodeSeasonNums).size,
  );

  let seasonCountFromSeasons = null;
  if (Array.isArray(seriesData?.seasons)) {
    const seasonNums = [];
    for (const season of seriesData.seasons) {
      const seasonNumber = Number(season?.number);
      if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) continue;
      if (!seasonTypeMatches(season?.type)) continue;
      seasonNums.push(seasonNumber);
    }
    seasonCountFromSeasons = toPositiveInt(new Set(seasonNums).size);
  }

  return {
    seasonCount: seasonCountFromEpisodes ?? seasonCountFromSeasons ?? null,
    episodeCount: episodeCountFromEpisodes ?? null,
  };
};

const chooseCount = ({ inputCount, existingCount, apiCount }) => {
  const inputPositive = toPositiveInt(inputCount);
  const apiPositive = toPositiveInt(apiCount);
  // Use the maximum of Emby and TVDB API counts — TVDB knows about future/unaired
  // episodes that Emby doesn't have yet, so we must not let Emby's lower count win.
  if (inputPositive && apiPositive) return Math.max(inputPositive, apiPositive);
  if (inputPositive) return inputPositive;
  if (apiPositive) return apiPositive;
  const existingPositive = toPositiveInt(existingCount);
  if (existingPositive) return existingPositive;
  if (inputCount === 0 || existingCount === 0 || apiCount === 0) return 0;
  return null;
};

const getDefaultOrderCounts = async (tvdbId, token) => {
  try {
    const url = `https://api4.thetvdb.com/v4/series/${tvdbId}/episodes/default?page=0`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    });
    if (!res.ok) return { seasonCount: null, episodeCount: null };
    const body = await res.json();
    const episodes = body?.data?.episodes;
    if (!Array.isArray(episodes))
      return { seasonCount: null, episodeCount: null };

    const filtered = episodes.filter((epi) => {
      const seasonNumber = Number(epi?.seasonNumber);
      return Number.isInteger(seasonNumber) && seasonNumber > 0;
    });
    return {
      seasonCount: toPositiveInt(
        new Set(filtered.map((epi) => Number(epi.seasonNumber))).size,
      ),
      episodeCount: toPositiveInt(filtered.length),
    };
  } catch (_e) {
    return { seasonCount: null, episodeCount: null };
  }
};

const getTvdbData = async (paramObj, resolve, _reject) => {
  const { show, seasonCount, episodeCount, watchedCount, fast } = paramObj;

  // Defensive check - ensure show object exists
  if (!show || !show.name) {
    unilog(733, "getTvdbData: Invalid paramObj - missing show.name", {
      paramObj,
    });
    if (resolve) resolve(null);
    return;
  }

  const inputName = show.name;
  // log("getTvdbData: START", { name, fast });
  const showId = show.id;
  const tvdbId = show.tvdbId;
  if (!tvdbId) {
    unilog(734, "getTvdbData no tvdbId:", show);
    resolve(inputName);
    return;
  }

  let canonicalName = inputName;
  for (const [existingKey, existingRecord] of Object.entries(allTvdb || {})) {
    if (existingKey === inputName) continue;
    const existingTvdbId = String(existingRecord?.tvdbId || "").trim();
    if (existingTvdbId && String(tvdbId).trim() === existingTvdbId) {
      canonicalName = existingRecord?.name || existingKey;
      if (canonicalName !== inputName) {
        unilog(
          735,
          "inf",
          `getTvdbData canonicalized by tvdbId=${tvdbId}: input=" ${inputName}" canonical=" ${canonicalName}"`,
        );
      }
      break;
    }
  }

  const name = canonicalName;
  let extRes, extUrl, token;
  try {
    extUrl = `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
    token = await getToken();
    extRes = await fetch(extUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    });

    if (!extRes.ok) {
      unilog(
        736,
        "err",
        `getTvdbData error, extended status:`,
        name,
        { extUrl },
        JSON.stringify(extRes, null, 2),
      );
      resolve(name);
      return;
    }
  } catch (err) {
    unilog(737, "getTvdbData extended catch error:", name, {
      extUrl,
      extRes,
      err,
    });
    resolve(name);
    return;
  }
  const extResObj = await extRes.json();

  const {
    firstAired,
    lastAired: lastAiredIn,
    nextAired: nextAiredIn,
    overview,
    remoteIds,
    averageRuntime,
    originalCountry,
    originalLanguage,
    originalNetwork: originalNetworkIn,
    status: statusIn,
    trailers: trailersIn,
    genres: genresIn,
  } = extResObj.data;
  const image = getTvdbImageUrl(extResObj);
  const characters = getTvdbCharacters(extResObj);
  const crew = await getTvmazeCrew(tvdbId);
  let lastAired = lastAiredIn ?? firstAired;
  lastAired = lastAired ?? "";
  let nextAired = nextAiredIn ?? "";
  let originalNetwork = originalNetworkIn?.name ?? "";
  const status = statusIn.name; // e.g. Ended

  // Preserve existing non-empty values when API returns empty
  const existing = allTvdb[name] || {};
  if (!allTvdb[name] && !paramObj.transient) {
    const stack = new Error().stack?.split("\n").slice(1, 6).join(" | ") || "";
    unilog(
      1261,
      `new persistent tvdb record for "${name}" tvdbId=${tvdbId} fast=${fast} stack: ${stack}`,
    );
  }
  const apiCounts = getApiCounts(extResObj?.data);
  if (!toPositiveInt(apiCounts.episodeCount)) {
    const defaultCounts = await getDefaultOrderCounts(tvdbId, token);
    apiCounts.episodeCount =
      defaultCounts.episodeCount ?? apiCounts.episodeCount;
    apiCounts.seasonCount = defaultCounts.seasonCount ?? apiCounts.seasonCount;
  }
  const finalSeasonCount = chooseCount({
    inputCount: seasonCount,
    existingCount: existing.seasonCount,
    apiCount: apiCounts.seasonCount,
  });
  const finalEpisodeCount = chooseCount({
    inputCount: episodeCount,
    existingCount: existing.episodeCount,
    apiCount: apiCounts.episodeCount,
  });

  // get remote data, e.g. IMDB for tvdb record
  // remoteIds come from tvdb
  // For transient/preview requests, skip expensive remote scraping so info can render fast.
  // Remotes can be fetched separately after initial paint.
  let remotes = [];
  let fetchedUrls = {};
  if (!paramObj.transient) {
    const remoteResult = await getRemotes(show, remoteIds, fast);
    remotes = remoteResult?.remotes || [];
    fetchedUrls = remoteResult?.urls || {};
  } else {
    // For transient/preview, extract IMDB URL directly from remoteIds (no network calls)
    // so that the reviews pane can load IMDB reviews.
    const imdbRemoteId = Array.isArray(remoteIds)
      ? remoteIds.find((r) => r.type === 2)
      : null;
    if (imdbRemoteId?.id) {
      fetchedUrls.imdbUrl = `https://www.imdb.com/title/${imdbRemoteId.id}`;
    }
  }
  const saved = Date.now();
  const trailersRaw = trailersIn || allTvdb[name]?.trailers;

  const isEnglishTrailer = (t) => {
    const lang = (t?.language || t?.iso_639_1 || t?.lang || "")
      .toString()
      .toLowerCase();
    if (!lang) return true; // legacy entries sometimes omit language
    return (
      lang === "eng" ||
      lang === "en" ||
      lang === "english" ||
      lang.startsWith("en-") ||
      lang.startsWith("en_")
    );
  };

  const trailers = Array.isArray(trailersRaw)
    ? trailersRaw.filter(isEnglishTrailer)
    : trailersRaw;

  // Add IMDB video to trailers if available
  let finalTrailers = trailers ? [...trailers] : [];
  const imdbRemote = remotes.find((r) => r.name && r.name.startsWith("IMDB"));
  if (imdbRemote?.video) {
    finalTrailers.push({
      name: "IMDB Video",
      url: imdbRemote.video,
      language: "eng",
    });
  }

  // Check if we need TMDB fallback for missing fields
  const needsTmdb = !image || !overview || !firstAired || !status;
  let tmdbData = null;
  if (needsTmdb) {
    unilog(740, "Fetching TMDB fallback for", name);
    tmdbData = await getTmdbFallback(name);
  }

  // Last-resort poster: TVDB search thumbnail (upcoming shows often have one
  // even when extended artwork and TMDB are empty).
  let searchThumb = "";
  if (!image && !existing.image && !tmdbData?.image) {
    searchThumb = await getTvdbSearchThumbnail(name, tvdbId, token);
  }

  const preserve = (newVal, existingVal, tmdbVal) => {
    if (newVal !== undefined && newVal !== null && newVal !== "") return newVal;
    if (existingVal !== undefined && existingVal !== null && existingVal !== "")
      return existingVal;
    if (tmdbVal !== undefined && tmdbVal !== null && tmdbVal !== "")
      return tmdbVal;
    return newVal;
  };

  let tvdbData = {
    name,
    tvdbId: tvdbId,
    originalNetwork: preserve(
      originalNetwork,
      existing.originalNetwork,
      tmdbData?.originalNetwork,
    ),
    seasonCount: finalSeasonCount,
    episodeCount: finalEpisodeCount,
    watchedCount,
    image: preserve(image, existing.image, tmdbData?.image || searchThumb),
    overview: preserve(overview, existing.overview, tmdbData?.overview),
    firstAired: preserve(firstAired, existing.firstAired, tmdbData?.firstAired),
    lastAired: preserve(lastAired, existing.lastAired, tmdbData?.lastAired),
    nextAired: preserve(nextAired, existing.nextAired),
    averageRuntime: preserve(
      averageRuntime,
      existing.averageRuntime,
      tmdbData?.averageRuntime,
    ),
    originalCountry: preserve(
      originalCountry,
      existing.originalCountry,
      tmdbData?.originalCountry,
    ),
    originalLanguage: preserve(
      originalLanguage,
      existing.originalLanguage,
      tmdbData?.originalLanguage,
    ),
    status: preserve(status, existing.status, tmdbData?.status),
    remote_ids: remoteIds || [], // Store raw remoteIds from TVDB API
    remotes, // computed display array - not persisted to disk; rebuilt from flat url props
    characters, // Don't preserve arrays - they accumulate
    crew,
    saved,
    // Remote URL flat props — persisted so Google/scrape calls are skipped on subsequent refreshes
    wikiUrl: fetchedUrls.wikiUrl ?? existing.wikiUrl ?? null,
    redditUrl: fetchedUrls.redditUrl ?? existing.redditUrl ?? null,
    wikiVerified: fetchedUrls.wikiVerified ?? existing.wikiVerified ?? null,
    redditVerified: fetchedUrls.redditVerified ?? existing.redditVerified ?? null,
    imdbUrl: fetchedUrls.imdbUrl ?? existing.imdbUrl ?? null,
    imdbRatings: fetchedUrls.imdbRatings ?? existing.imdbRatings ?? null,
    imdbReviewers: fetchedUrls.imdbReviewers ?? existing.imdbReviewers ?? null,
    imdbVideo: fetchedUrls.imdbVideo ?? existing.imdbVideo ?? null,
    rottenUrl: fetchedUrls.rottenUrl ?? existing.rottenUrl ?? null,
    rottenRatings: fetchedUrls.rottenRatings ?? existing.rottenRatings ?? null,
    genres:
      genresIn?.map((g) => g.name).filter(Boolean) || existing.genres || [],
  };

  if (tmdbData?.genres?.length) tvdbData.genres = tmdbData.genres; // TMDB genre names preferred over TVDB extended

  if (finalTrailers && finalTrailers.length > 0)
    tvdbData.trailers = finalTrailers;

  // Determine inEmby status:
  // - If fromEmbySync is set in params, this is an Emby sync, so inEmby = true
  // - Otherwise, use show.inEmby value or preserve existing value
  const isSyncingFromEmby = !!paramObj.fromEmbySync;
  const newInEmby = isSyncingFromEmby
    ? true
    : (show.inEmby ?? existing.inEmby ?? false);

  unilog(
    1226,
    `getNewTvdb setting inEmby=${newInEmby} for ${name} (fromEmbySync=${isSyncingFromEmby}, show.inEmby=${show.inEmby}, existing.inEmby=${existing.inEmby})`,
  );

  // Ensure Emby button is correct in fresh remotes based on inEmby status
  const embyBtnIdx = tvdbData.remotes.findIndex((r) => r.name === "Emby");
  const embyUrl = urls.embyPageUrl(showId || tvdbData.id);
  if (embyBtnIdx >= 0) {
    if (newInEmby) {
      tvdbData.remotes[embyBtnIdx] = { name: "Emby", url: embyUrl };
    } else {
      tvdbData.remotes.splice(embyBtnIdx, 1);
    }
  } else if (newInEmby) {
    tvdbData.remotes.unshift({ name: "Emby", url: embyUrl });
  }

  tvdbData.inEmby = newInEmby;

  // Flattened Emby-specific data (no nested object)
  tvdbData.id = showId || existing.id || existing.emby?.id || null;
  tvdbData.path =
    paramObj.embyPath || existing.path || existing.emby?.path || null;
  tvdbData.dateCreated =
    paramObj.dateCreated ||
    existing.dateCreated ||
    existing.emby?.dateCreated ||
    null;
  tvdbData.premiereDate =
    paramObj.premiereDate ||
    existing.premiereDate ||
    existing.emby?.premiereDate ||
    null;
  tvdbData.inToTry =
    paramObj.inToTry ?? existing.inToTry ?? existing.emby?.inToTry ?? false;
  tvdbData.inContinue =
    paramObj.inContinue ??
    existing.inContinue ??
    existing.emby?.inContinue ??
    false;
  tvdbData.inMark =
    paramObj.inMark ?? existing.inMark ?? existing.emby?.inMark ?? false;
  tvdbData.inLinda =
    paramObj.inLinda ?? existing.inLinda ?? existing.emby?.inLinda ?? false;
  tvdbData.played =
    paramObj.isPlayed ?? existing.played ?? existing.emby?.isPlayed ?? false;
  tvdbData.playCount =
    paramObj.playCount ?? existing.playCount ?? existing.emby?.playCount ?? 0;
  tvdbData.lastPlayedDate =
    paramObj.lastPlayedDate ||
    existing.lastPlayedDate ||
    existing.emby?.lastPlayedDate ||
    null;

  // Flattened Disk/filesystem data (no nested object)
  tvdbData.date =
    paramObj.diskDate || existing.date || existing.disk?.date || null;
  tvdbData.size =
    paramObj.diskSize ?? existing.size ?? existing.disk?.size ?? 0;
  tvdbData.noFiles =
    paramObj.noFiles ?? existing.noFiles ?? existing.disk?.noFiles ?? false;

  // Flattened TVMaze reference (no nested object)
  tvdbData.tvmazeId =
    paramObj.tvmazeId || existing.tvmazeId || existing.tvmaze?.id || null;

  // Gap tracking (already flat - spread from gap object if exists)
  if (paramObj.gap) {
    Object.assign(tvdbData, paramObj.gap);
  } else if (existing.gap) {
    Object.assign(tvdbData, existing.gap);
  }
  // Also preserve any flattened gap fields already on the record (written by perShowCallback)
  const flatGapFields = [
    "watchGap",
    "watchGapSeason",
    "watchGapEpisode",
    "fileGap",
    "fileGapSeason",
    "fileGapEpisode",
    "fileEndError",
    "fileEndErrorSeason",
    "fileEndErrorEpisode",
    "seasonWatchedThenNofile",
    "seasonWatchedThenNofileSeason",
    "seasonWatchedThenNofileEpisode",
    "anyWatched",
    "notReady",
    "lastGapCheck",
    "full",
    "needsIntro",
  ];
  for (const f of flatGapFields) {
    if (tvdbData[f] === undefined && existing[f] !== undefined) {
      if (f === "needsIntro" && existing[f] === true) {
        unilog(
          741,
          `flatGapFields preserved needsIntro=true for ${tvdbData.name || "?"}`,
        );
      }
      tvdbData[f] = existing[f];
    }
  }

  // Ensure notReady has a value - default to true for inEmby shows until gap check runs
  if (tvdbData.notReady === undefined && tvdbData.inEmby) {
    tvdbData.notReady = true;
  }

  // Runtime-state fields set by disk scan / Emby queries — preserve from existing
  tvdbData.episodeData = existing.episodeData ?? null;
  tvdbData.quality = existing.quality ?? null;
  tvdbData.seasonPremiereDates = existing.seasonPremiereDates ?? null;

  // leftEmby timestamp (yyyy-mm-dd format) - set when show is removed from Emby
  tvdbData.leftEmby =
    paramObj.leftEmby || existing.leftEmby || existing.emby?.leftEmby || null;

  // Additional flags
  tvdbData.anticipating =
    paramObj.anticipating ?? existing.anticipating ?? false;
  tvdbData.sitcom = paramObj.sitcom ?? existing.sitcom ?? false;
  if (existing["last-downloaded"] !== undefined) {
    tvdbData["last-downloaded"] = existing["last-downloaded"];
  }
  if (existing.seasonIntros != null)
    tvdbData.seasonIntros = existing.seasonIntros;

  // Calculate waitStr from existing episodeData (fresh series map data hasn't
  // been fetched yet at this stage).
  const calculatedWaitStr = calculateWaitStr(existing.episodeData);
  tvdbData.waitStr =
    calculatedWaitStr !== null
      ? calculatedWaitStr || null
      : (existing.waitStr ?? null);

  setImdbId(tvdbData);

  // log('getTvdbData:', tvdbData);
  if (!paramObj.transient) {
    allTvdb[name] = tvdbData;
    if (inputName !== name && allTvdb[inputName]) {
      const inputTvdbId = String(allTvdb[inputName]?.tvdbId || "").trim();
      if (inputTvdbId && inputTvdbId === String(tvdbId).trim()) {
        delete allTvdb[inputName];
        deleteShow(inputName);
      }
    }
    // Auto-update pickups when inEmby or status changes
    if (pickupChangeCallback) {
      const oldInEmby = existing.inEmby;
      const oldStatus = existing.status;
      if (oldInEmby !== tvdbData.inEmby || oldStatus !== tvdbData.status) {
        pickupChangeCallback(name, tvdbData.inEmby, tvdbData.status);
      }
    }
  }
  // update allTvdb & persisted tvdb db rows
  // log("getTvdbData: END", { name, hasRemotes: !!tvdbData.remotes?.length });
  resolve(tvdbData);
};

/////////  GET/UPDATE TVDB FOR WEB AND LOCAL //////
// each tvdb request from web waits in queue
// every result updates the persisted tvdb db row
const newTvdbQueue = [];
let chkTvdbQueueRunning = false;

// Show process queue: shows queued for full per-show refresh (disk + gap + TVDB)
const showProcessQueue = [];
// Set after tryLocalGetTvdb is defined so enqueueShowProcess can kick processing immediately
let _kickProcessQueue = null;
// Name of the show currently being processed (dequeued but not yet finished)
let currentlyProcessingShow = null;
export const enqueueShowProcess = (showName, opts = {}) => {
  if (
    showName &&
    showName !== currentlyProcessingShow &&
    !showProcessQueue.some((item) => item.name === showName)
  ) {
    const wasEmpty = showProcessQueue.length === 0;
    const item = {
      name: showName,
      skipRotten: !!opts.skipRotten,
      isBackground: !!opts.isBackground,
    };
    if (opts.priority) showProcessQueue.unshift(item);
    else showProcessQueue.push(item);
    // Only notify on 0→1 transition to avoid flooding clients on bulk enqueues
    if (wasEmpty && enqueueCallback) enqueueCallback(showName);
    // Kick processing immediately (no-op if already busy)
    if (_kickProcessQueue) setTimeout(_kickProcessQueue, 0);
  } else if (showName) {
    if (showName === currentlyProcessingShow) {
      unilog(119, `enqueue [${showName}] skipped — currently processing`);
    } else if (showProcessQueue.some((item) => item.name === showName)) {
      unilog(120, `enqueue [${showName}] skipped — already queued`);
    }
  }
};
const dequeueShowProcess = () => showProcessQueue.shift() ?? null;

// Callbacks set by index.js to avoid circular imports
let notifyCallback = null;
export const setNotifyCallback = (fn) => {
  notifyCallback = fn;
};

let pickupChangeCallback = null;
export const setPickupChangeCallback = (fn) => {
  pickupChangeCallback = fn;
};

let enqueueCallback = null;
export const setEnqueueCallback = (fn) => {
  enqueueCallback = fn;
};

let queueDrainCallback = null;
export const setQueueDrainCallback = (fn) => {
  queueDrainCallback = fn;
};

let perShowCallback = null;
export const setPerShowCallback = (fn) => {
  perShowCallback = fn;
};

let preTvdbTickCallback = null;
export const setPreTvdbTickCallback = (fn) => {
  preTvdbTickCallback = fn;
};

// Refreshes consolidated episodeData (set by index.js to avoid circular import).
let refreshEpisodeDataCallback = null;
export const setRefreshEpisodeDataCallback = (fn) => {
  refreshEpisodeDataCallback = fn;
};

const chkTvdbQueue = () => {
  if (chkTvdbQueueRunning || newTvdbQueue.length == 0) return;
  chkTvdbQueueRunning = true;
  const { ws, id, paramObj, resolve: resolveCb } = newTvdbQueue.pop();
  const showName = paramObj.show?.name;

  // Snapshot the old record NOW, before getTvdbData overwrites allTvdb[name].
  // getTvdbData sets allTvdb[name] = tvdbData before resolving the promise, so
  // reading allTvdb[keyName] inside .then() would give the new record, making
  // all change comparisons trivially equal.
  const prevSnapshot =
    showName && allTvdb[showName] ? { ...allTvdb[showName] } : null;

  if (ws && ws.readyState !== WebSocket.OPEN) {
    unilog(742, "chkTvdbQueue: skipping closed WebSocket", id);
    chkTvdbQueueRunning = false;
    chkTvdbQueue();
    return;
  }

  let resolve = null;
  let reject = null;
  const promise = new Promise((resolveIn, rejectIn) => {
    resolve = resolveIn;
    reject = rejectIn;
  });
  promise
    .then((tvdbData) => {
      let finalData = null;
      try {
        if (tvdbData && typeof tvdbData === "object") {
          finalData = tvdbData;
          if (!paramObj.transient) {
            const keyName =
              String(finalData.name || showName || "").trim() || null;
            // Use the snapshot taken before getTvdbData ran; fall back to
            // allTvdb[keyName] only when the show was canonicalized to a
            // different name (snapshot was taken under the original name).
            const prev =
              prevSnapshot ?? (showName !== keyName ? allTvdb[showName] : null);
            const tvdbChanges = [];
            if (prev) {
              if (prev.lastAired !== finalData.lastAired)
                tvdbChanges.push(
                  `lastAired:${prev.lastAired}->${finalData.lastAired}`,
                );
              if (prev.status !== finalData.status)
                tvdbChanges.push(`status:${prev.status}->${finalData.status}`);
              if (
                (prev.seasons?.length ?? 0) !== (finalData.seasons?.length ?? 0)
              )
                tvdbChanges.push(
                  `seasons:${prev.seasons?.length ?? 0}->${finalData.seasons?.length ?? 0}`,
                );
              if (
                (prev.remotes?.length ?? 0) !== (finalData.remotes?.length ?? 0)
              )
                tvdbChanges.push(
                  `remotes:${prev.remotes?.length ?? 0}->${finalData.remotes?.length ?? 0}`,
                );
              if (prev.overview !== finalData.overview)
                tvdbChanges.push(`overview:changed`);
              if (prev.imdbRatings !== finalData.imdbRatings)
                tvdbChanges.push(
                  `imdb:${prev.imdbRatings ?? "none"}->${finalData.imdbRatings ?? "none"}`,
                );
              if (prev.rottenRatings !== finalData.rottenRatings)
                tvdbChanges.push(
                  `rotten:${prev.rottenRatings ?? "none"}->${finalData.rottenRatings ?? "none"}`,
                );
            } else {
              const newRecParts = ["new record"];
              if (finalData.imdbRatings)
                newRecParts.push(`imdb:${finalData.imdbRatings}`);
              if (finalData.rottenRatings)
                newRecParts.push(`rotten:${finalData.rottenRatings}`);
              tvdbChanges.push(newRecParts.join(" "));
            }
            if (!paramObj.suppressNotify) {
              unilog(
                743,
                `tvdb push1 [${keyName}]: ${tvdbChanges.length ? tvdbChanges.join(" ") : "no field changes"}`,
              );
            }
            allTvdb[keyName] = finalData;
            finalData._hasChanges = tvdbChanges.length > 0;
          }
        } else if (typeof tvdbData === "string") {
          finalData = allTvdb[tvdbData];
        }

        if (ws) {
          if (finalData)
            ws.send(JSON.stringify({ id, status: "ok", data: finalData }));
        } else if (resolveCb) {
          resolveCb(finalData || null);
        }
      } catch (e) {
        unilog(744, "chkTvdbQueue processing error:", e);
        if (resolveCb) resolveCb(null);
      }

      if (finalData && !paramObj.transient) {
        finalData.saved = Date.now();
        // Strip the transient flag before saving so it never reaches the db
        const hasChanges = finalData._hasChanges ?? false;
        delete finalData._hasChanges;
        // Save to db so timestamp persists across restarts
        try {
          const keyName = String(finalData.name || showName || "").trim();
          if (keyName) saveShow(keyName, finalData);
        } catch (err) {
          unilog(745, "chkTvdbQueue: save error:", err.message);
        }
        // Push updated record to clients only when fields actually changed
        if (!paramObj.suppressNotify) {
          if (notifyCallback && finalData.name && hasChanges)
            notifyCallback(finalData.name, finalData);
        } else {
          // suppressNotify callers read _hasChanges from the in-memory record
          finalData._hasChanges = hasChanges;
        }
      }
      chkTvdbQueueRunning = false;
      chkTvdbQueue();
    })
    .catch((err) => {
      unilog(746, "chkTvdbQueue: promise rejected", { err });
      if (resolveCb) resolveCb(null);
      chkTvdbQueueRunning = false;
      chkTvdbQueue();
    });
  getTvdbData(paramObj, resolve, reject);
};

//////////// UPDATE TVDB LOOP ////////////////
// get imdb data continuously to update data
// allTvdb is the in-memory copy of tvdb db rows
// only one sequential request can be busy at a time
let tryLocalGetTvdbBusy = false;
const tryLocalGetTvdb = async () => {
  if (tryLocalGetTvdbBusy) return;
  if (showProcessQueue.length === 0) return;
  tryLocalGetTvdbBusy = true;

  const nextItem = showProcessQueue[0];
  // Run pre-tick callback (e.g. full Emby sweep for new/removed shows)
  if (preTvdbTickCallback) {
    try {
      await preTvdbTickCallback({ isBackground: !!nextItem?.isBackground });
    } catch (e) {
      unilog(747, "tryLocalGetTvdb preTick:", e.message);
    }
  }

  const dequeued = dequeueShowProcess();
  if (!dequeued) {
    tryLocalGetTvdbBusy = false;
    return;
  }
  const requestedName = dequeued.name;
  const skipRotten = dequeued.skipRotten;
  const isBackground = dequeued.isBackground;
  currentlyProcessingShow = requestedName;

  const minTvdb = allTvdb[requestedName];
  if (!minTvdb) {
    unilog(
      748,
      "err",
      `tryLocalGetTvdb: no record for queued show "${requestedName}"`,
    );
    currentlyProcessingShow = null;
    tryLocalGetTvdbBusy = false;
    return;
  }

  if (!minTvdb.name) {
    minTvdb.name = requestedName;
  }

  unilog(122, `processing [${minTvdb.name}]`);
  // Notify clients which show is being processed
  if (enqueueCallback) enqueueCallback(minTvdb.name);

  // Foreground (user-selected) shows: refresh the map-relevant data (Emby
  // watched/id + disk files) and push it right away, BEFORE the slow TVDB API
  // scrape below. The open map only needs emby+disk (not Rotten/TVDB/IMDB), so
  // this lets it update within a moment instead of waiting for the full
  // refresh. Skipped for background sweeps to avoid doubling Emby load. No db
  // save here — the map's stale rebuild reads the in-memory record, and the
  // full refresh below persists to tvdb db.
  if (!isBackground && refreshEpisodeDataCallback && minTvdb.inEmby !== false) {
    try {
      await refreshEpisodeDataCallback(minTvdb.name, minTvdb, {
        sources: ["emby", "disk"],
      });
      if (notifyCallback) notifyCallback(minTvdb.name);
    } catch (e) {
      unilog(
        1523,
        `early map refresh failed for ${minTvdb.name}: ${e.message}`,
      );
    }
  }

  const show = {
    name: minTvdb.name,
    tvdbId: minTvdb.tvdbId,
  };
  if (minTvdb.id) show.id = minTvdb.id;
  const paramObj = {
    show,
    seasonCount: minTvdb.seasonCount ?? 0,
    episodeCount: minTvdb.episodeCount ?? 0,
    watchedCount: minTvdb.watchedCount ?? 0,
    fast: false, // Background loop: scrape Rotten and IMDB to refresh tvdb db cache.
    suppressNotify: true, // Combined push1+push2 notify is sent after perShowCallback
  };
  // Await TVDB refresh completion so the updated record is available for further processing
  const tvdbDonePromise = new Promise((res) => {
    newTvdbQueue.unshift({ ws: null, id: null, paramObj, resolve: res });
  });
  chkTvdbQueue();
  let updatedRecord = null;
  try {
    updatedRecord = await tvdbDonePromise;
  } catch (e) {
    unilog(749, "tryLocalGetTvdb: tvdb update failed:", e?.message);
  }
  const processRecord = updatedRecord || allTvdb[minTvdb.name] || minTvdb;
  if (!processRecord.name) {
    processRecord.name = minTvdb.name;
  }

  // Refresh consolidated episodeData (TVDB aired + Emby watched/id + disk
  // files). This single call also keeps the legacy watchedEpis/filesOnDisk/
  // fileQuality/episodeAiredDates props, quality, watchedCount,
  // seasonPremiereDates, waitStr and date/size/noFiles in sync — replacing the
  // former separate Emby/TVDB seriesMap fetches here.
  if (refreshEpisodeDataCallback) {
    try {
      await refreshEpisodeDataCallback(processRecord.name, processRecord);
      saveShow(processRecord.name, allTvdb[processRecord.name]);
    } catch (err) {
      unilog(
        750,
        "err",
        "tryLocalGetTvdb refreshEpisodeData error:",
        err.message,
      );
    }
  }

  // Run per-show process callback (disk check, gap check) with the up-to-date record
  let push2Result = { hasChanges: false, changes: [] };
  if (perShowCallback) {
    try {
      const result = await perShowCallback(processRecord.name, processRecord, {
        suppressNotify: true,
        isBackground,
      });
      if (result) push2Result = result;
    } catch (e) {
      unilog(751, "tryLocalGetTvdb perShow:", e.message);
    }
  }

  // Combined push1+push2 notify (one notification instead of two)
  const push1HasChanges = processRecord._hasChanges ?? false;
  delete processRecord._hasChanges;
  if (push1HasChanges || push2Result.hasChanges) {
    if (notifyCallback)
      notifyCallback(processRecord.name, allTvdb[processRecord.name]);
  } else {
    unilog(123, `tvdb push [${processRecord.name}]: no changes`);
  }

  // Fetch TVmaze crew for shows that don't have it yet (null = not fetched; [] = fetched but none)
  if (
    processRecord.name &&
    processRecord.tvdbId &&
    allTvdb[processRecord.name]
  ) {
    const rec = allTvdb[processRecord.name];
    if (!Array.isArray(rec.crew)) {
      try {
        const tvmazeCrew = await getTvmazeCrew(processRecord.tvdbId);
        rec.crew = tvmazeCrew;
        saveShow(processRecord.name, rec);
        unilog(
          752,
          `tvdb crew [${processRecord.name}]: ${tvmazeCrew.length} from TVmaze`,
        );
        if (notifyCallback)
          notifyCallback(processRecord.name, allTvdb[processRecord.name]);
      } catch (e) {
        unilog(753, "tryLocalGetTvdb crew:", e.message);
      }
    }
  }

  // Push 3: Rotten Tomatoes scrape (slow, runs separately after push1 & push2)
  if (!skipRotten && processRecord.name && allTvdb[processRecord.name]) {
    const rottenStartMs = Date.now();
    try {
      const rottenRemote = await getRemote(null, 99, processRecord.name);
      if (rottenRemote) {
        if (rottenRemote.ratings)
          rottenRemote.name += " (" + rottenRemote.ratings + ")";
        const rec = allTvdb[processRecord.name];
        const existingRemotes = Array.isArray(rec.remotes) ? rec.remotes : [];
        // Replace any existing Rotten entry with fresh scraped one
        rec.remotes = [
          ...existingRemotes.filter((r) => !r.name?.startsWith("Rotten")),
          rottenRemote,
        ];
        rec.rottenUrl = rottenRemote.url || null;
        rec.rottenRatings = rottenRemote.ratings || null;
        saveShow(processRecord.name, rec);
        unilog(
          754,
          `tvdb push3 [${processRecord.name}]: Rotten ${rottenRemote.ratings || "no ratings"}`,
        );
        if (notifyCallback) notifyCallback(processRecord.name, rec);
      } else {
        unilog(124, `tvdb push3 [${processRecord.name}]: Rotten no result`);
      }
    } catch (e) {
      unilog(755, "tryLocalGetTvdb push3 rotten:", e.message);
    }
    const rottenSecs = ((Date.now() - rottenStartMs) / 1000).toFixed(1);
    unilog(
      1277,
      `tvdb push3 [${processRecord.name}]: rotten took ${rottenSecs}s`,
    );
  }

  // If queue is now empty, notify clients
  if (showProcessQueue.length === 0 && queueDrainCallback) {
    try {
      queueDrainCallback();
    } catch (e) {
      unilog(756, "tryLocalGetTvdb queueDrain:", e.message);
    }
  }

  currentlyProcessingShow = null;
  tryLocalGetTvdbBusy = false;
  // If more shows are queued, continue processing after a short delay; otherwise use background cadence.
  if (showProcessQueue.length > 0) setTimeout(tryLocalGetTvdb, 1000);
  else setTimeout(tryLocalGetTvdb, TVDB_UPDATE_DELAY_MS);
};

// calls tryLocalGetTvdb every 5s (FAST_UPDATE) or 2 mins, delay from end of one task to beginning of next
let updateCycleCount = 0;
const updateTvdbLocal = async () => {
  if (UPDATE_DATA) {
    // Enqueue the stalest show if the queue is empty (so everything goes through the queue)
    if (showProcessQueue.length === 0) {
      updateCycleCount++;
      const wantInEmby = updateCycleCount % 10 !== 0;
      let stalest = null;
      let minSaved = Math.min();
      try {
        for (const tvdb of Object.values(allTvdb)) {
          if (!!tvdb.inEmby !== wantInEmby) continue;
          const saved = tvdb.saved;
          if (saved === undefined) {
            stalest = tvdb;
            break;
          }
          if (saved < minSaved) {
            minSaved = saved;
            stalest = tvdb;
          }
        }
      } catch (e) {}
      if (stalest?.name) {
        enqueueShowProcess(stalest.name, { isBackground: true });
        unilog(
          757,
          `timer: enqueued stalest ${wantInEmby ? "emby" : "non-emby"} [${stalest.name}]`,
        );
      }
    }
    await tryLocalGetTvdb();
  }
  setTimeout(updateTvdbLocal, TVDB_UPDATE_DELAY_MS);
};
_kickProcessQueue = tryLocalGetTvdb;
updateTvdbLocal();

///////////////////  FUNCTION CALLS FROM CLIENT  ////////////////////

// WebSocket endpoint handler: returns remotes for a show.
// Expects param JSON: { show: { Name, Id? }, tvdbRemotes: [...], fast: boolean }
export const getRemotesCmd = async (params) => {
  const show = params?.show;
  const tvdbRemotes = params?.tvdbRemotes || [];
  const fast = !!params?.fast;

  if (!show) {
    throw new Error("getRemotes: missing show");
  }

  try {
    const { remotes, urls: fetchedUrls } = await getRemotes(
      show,
      tvdbRemotes,
      fast,
    );

    if (show.name && allTvdb) {
      const existing = allTvdb[show.name];
      if (existing) {
        let changed = false;

        // Persist wiki/reddit url + verify results on every path (fast too) so
        // each url is only tested once, even when the fast info-pane path is the
        // first to test it.
        for (const k of [
          "wikiUrl",
          "redditUrl",
          "wikiVerified",
          "redditVerified",
        ]) {
          if (fetchedUrls[k] !== undefined && existing[k] !== fetchedUrls[k]) {
            existing[k] = fetchedUrls[k];
            changed = true;
          }
        }

        // Full refresh (fast=false) also saves the freshly-scraped remotes/ratings.
        if (!fast) {
          const changes = [];
          if (
            fetchedUrls.imdbRatings !== undefined &&
            fetchedUrls.imdbRatings !== existing.imdbRatings
          )
            changes.push(
              `imdb:${existing.imdbRatings ?? "none"}->${fetchedUrls.imdbRatings ?? "none"}`,
            );
          if (
            fetchedUrls.rottenRatings !== undefined &&
            fetchedUrls.rottenRatings !== existing.rottenRatings
          )
            changes.push(
              `rotten:${existing.rottenRatings ?? "none"}->${fetchedUrls.rottenRatings ?? "none"}`,
            );
          existing.remotes = remotes;
          Object.assign(existing, fetchedUrls);
          changed = true;
          if (changes.length)
            unilog(125, `getRemotes [${show.name}]: ${changes.join(" ")}`);
        }

        if (changed) {
          try {
            saveShow(show.name, existing);
          } catch (err) {
            unilog(
              758,
              `getRemotesCmd: saveTvdbSync failed for ${show.name}: ${err.message}`,
            );
          }
        }
      }
    }

    return remotes;
  } catch (err) {
    unilog(759, `getRemotesCmd: ERROR for ${show.name}: ${err.message}`);
    throw new Error(`getRemotes error: ${err.message}`);
  }
};

export const debugTvdb = async (params) => {
  const { name, tvdbId } = params;

  if (!tvdbId) {
    throw new Error("debugTvdb: missing tvdbId");
  }

  try {
    unilog(760, "debugTvdb: Fetching API data for", { name, tvdbId });

    const extUrl = `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
    const token = await getToken();
    const extRes = await fetch(extUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    });

    if (!extRes.ok) {
      throw new Error(`TVDB API returned status ${extRes.status}`);
    }

    const extResObj = await extRes.json();

    // Save to remote server at /root/dev/apps/tv/samples/save-tvdb.json
    const samplePath = "/root/dev/apps/tv/samples/save-tvdb.json";
    const sampleDir = path.dirname(samplePath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(sampleDir)) {
      fs.mkdirSync(sampleDir, { recursive: true });
    }

    // Write the data
    fs.writeFileSync(samplePath, JSON.stringify(extResObj, null, 2), "utf8");

    unilog(761, "debugTvdb: Saved API data to", samplePath);

    return {
      success: true,
      message: `Saved TVDB API data for "${name}" to ${samplePath}`,
      path: samplePath,
    };
  } catch (err) {
    unilog(762, "debugTvdb: ERROR", { error: err.message });
    throw new Error(`debugTvdb error: ${err.message}`);
  }
};

export const getActorPage = async (params) => {
  const actorName = params?.name || "";
  const tvdbPersonId = params?.tvdbPersonId || null;

  // If we have a TVDB person ID, use the TVDB API to get the IMDB ID directly
  if (tvdbPersonId) {
    try {
      const token = await getToken();
      const res = await fetch(
        `https://api4.thetvdb.com/v4/people/${tvdbPersonId}/extended`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        const imdbRemote = (data?.data?.remoteIds || []).find(
          (r) => r.sourceName === "IMDB",
        );
        if (imdbRemote?.id) {
          return `https://www.imdb.com/name/${imdbRemote.id}`;
        }
      }
    } catch (err) {
      unilog(763, "getActorPage TVDB person lookup error:", err.message);
    }
  }

  if (!actorName) return null;

  try {
    // Search IMDb for the actor
    const searchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(actorName)}&s=nm`;
    const searchResp = await fetch(searchUrl);

    if (!searchResp.ok) {
      return null;
    }

    const html = await searchResp.text();

    const allMatches = [];
    const globalRegex = new RegExp(
      `<a\\s+href="(/name/nm\\d+)/[^"]*"[^>]*>.*?<h3[^>]*>([^<]+)</h3>`,
      "gis",
    );
    let match;
    while ((match = globalRegex.exec(html)) !== null) {
      allMatches.push({ url: match[1], name: match[2].trim() });
    }

    const exactMatch = allMatches.find(
      (m) => m.name.toLowerCase() === actorName.toLowerCase(),
    );

    if (exactMatch) {
      return `https://www.imdb.com${exactMatch.url}`;
    }

    return null;
  } catch (err) {
    unilog(764, "getActorPage error:", err.message);
    return null;
  }
};

export const searchActorsInNonEmby = async (params) => {
  const searchWords = params?.searchWords || [];
  if (!Array.isArray(searchWords) || searchWords.length === 0) {
    return [];
  }

  // Normalize actor name for matching (lowercase, remove non-alpha except spaces)
  const normalizeText = (text) => {
    return String(text || "")
      .replace(/[^a-zA-Z\s]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  };

  // Check if actor matches search words
  const matchesSearchTerm = (actorName, searchWords) => {
    const normActorName = normalizeText(actorName);
    const actorWords = normActorName.split(" ");

    // Check if any search word matches any actor name word (exact match only)
    return searchWords.some((searchWord) =>
      actorWords.some((actorWord) => actorWord === searchWord),
    );
  };

  const matchedShows = [];

  // Search through non-emby shows only
  for (const [showName, show] of Object.entries(allTvdb)) {
    if (show.inEmby !== false) continue; // Only check non-emby shows

    const actualData = show.response?.data || show;
    const characters = actualData?.characters;

    if (!Array.isArray(characters)) continue;

    // Check if any character/actor matches the search
    const hasMatch = characters.some((char) => {
      const actorName = char?.personName || char?.actor || "";
      return matchesSearchTerm(actorName, searchWords);
    });

    if (hasMatch) {
      matchedShows.push(showName);
    }
  }

  unilog(
    765,
    "inf",
    `searchActorsInNonEmby found ${matchedShows.length} matches`,
  );
  return matchedShows;
};

export const getAllTvdb = async (params) => {
  const hasEmby = params?.hasEmby ?? 0;
  // Filter based on hasEmby parameter
  if (hasEmby === 0) {
    // Return all shows
    return allTvdb;
  } else if (hasEmby === 1) {
    // Return only shows with inEmby true (or not false)
    const filtered = {};
    for (const [key, show] of Object.entries(allTvdb)) {
      if (show.inEmby !== false) {
        filtered[key] = show;
      }
    }
    return filtered;
  } else if (hasEmby === -1) {
    // Return only shows with inEmby false
    const filtered = {};
    for (const [key, show] of Object.entries(allTvdb)) {
      if (show.inEmby === false) {
        filtered[key] = show;
      }
    }
    return filtered;
  }

  return allTvdb;
};

// Synchronous access for background sync functions
export const getAllTvdbSync = () => allTvdb;

export const saveTvdbSync = async () => {
  try {
    saveAllShows(allTvdb);
  } catch (err) {
    unilog(767, "saveTvdbSync error:", err.message);
    throw err;
  }
};

// if tvdb already exists replace it
export const getNewTvdb = async (params) => {
  if (!params) throw new Error("getNewTvdb: missing params");

  // HTTP requests are always fast mode - mark to skip slow remote fetching
  params.fast = true;

  return new Promise((resolve, reject) => {
    // Queue the request with appropriate callback
    newTvdbQueue.unshift({ ws: null, id: null, paramObj: params, resolve });
    chkTvdbQueue();
  });
};

export const searchTvdbByImdbId = async (params) => {
  const imdbId = params?.imdbId;
  if (!imdbId) {
    unilog(768, "searchTvdbByImdbId: missing imdbId");
    return null;
  }

  // First check local tvdb cache for a match
  for (const [name, tvdb] of Object.entries(allTvdb)) {
    if (tvdb.imdbId === imdbId) {
      unilog(
        769,
        "inf",
        `searchTvdbByImdbId: found local match for ${imdbId}: ${name}`,
      );
      return tvdb;
    }
  }

  // Not found locally, search TVDB API by remote ID
  try {
    const url = `https://api4.thetvdb.com/v4/search/remoteid/${imdbId}`;
    const token = await getToken();
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      unilog(
        770,
        "err",
        `searchTvdbByImdbId: API search failed for ${imdbId}: ${res.status}`,
      );
      return null;
    }

    const data = await res.json();
    const series = data?.data?.[0];
    if (!series) {
      unilog(771, "inf", `searchTvdbByImdbId: no results for ${imdbId}`);
      return null;
    }

    const tvdbId = series.tvdb_id || series.id;
    if (!tvdbId) {
      unilog(
        772,
        "err",
        `searchTvdbByImdbId: no tvdbId in result for ${imdbId}`,
      );
      return null;
    }

    // Fetch full series data using the tvdbId
    const extUrl = `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
    const extRes = await fetch(extUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!extRes.ok) {
      unilog(
        773,
        "err",
        `searchTvdbByImdbId: extended fetch failed for ${tvdbId}: ${extRes.status}`,
      );
      return null;
    }

    const extResObj = await extRes.json();
    const extData = extResObj?.data;
    if (!extData) {
      unilog(774, `searchTvdbByImdbId: no extended data for ${tvdbId}`);
      return null;
    }

    // Build a tvdb-like object from the API response
    const image = getTvdbImageUrl(extResObj);
    const characters = getTvdbCharacters(extResObj);
    const crew = await getTvmazeCrew(tvdbId);
    const firstAired = extData.firstAired || "";
    const lastAired = extData.lastAired || firstAired || "";
    const nextAired = extData.nextAired || "";
    const status = extData.status?.name || "";
    const originalNetwork = extData.originalNetwork?.name || "";

    const tvdbData = {
      name: extData.name || series.name || "",
      tvdbId: tvdbId,
      imdbId: imdbId,
      image: image,
      overview: extData.overview || series.overview || "",
      firstAired: firstAired,
      lastAired: lastAired,
      nextAired: nextAired,
      status: status,
      originalCountry: extData.originalCountry || "",
      originalLanguage: extData.originalLanguage || "",
      originalNetwork: originalNetwork,
      averageRuntime: extData.averageRuntime || null,
      genres: extData.genres?.map((g) => g.name) || [],
      characters: characters,
      crew: crew,
      remotes: [], // Don't fetch remotes for preview
      inEmby: false,
      WaitStr: null,
    };

    unilog(
      775,
      "inf",
      `searchTvdbByImdbId: fetched data for ${imdbId}: ${tvdbData.name}`,
    );
    return tvdbData;
  } catch (err) {
    unilog(
      776,
      "err",
      `searchTvdbByImdbId: exception for ${imdbId}:`,
      err.message,
    );
    return null;
  }
};

export const setTvdbFields = async (params) => {
  const paramObj = params;
  if (!paramObj) return null;
  let tvdb = null;
  let renamedTvdbName = null;
  let renamedTvdbRecord = null;
  const name = paramObj.name;
  if (name) {
    if (paramObj.$delTvdb) {
      delete allTvdb[name];
    } else if (paramObj.$rename) {
      const newKey = paramObj.$rename;
      const record = allTvdb[name];
      if (!record) {
        unilog(777, "setTvdbFields $rename no tvdb for", name);
        return "no tvdb";
      }
      delete allTvdb[name];
      allTvdb[newKey] = record;
      renamedTvdbName = newKey;
      renamedTvdbRecord = record;
      unilog(778, "inf", `setTvdbFields renamed "${name}" -> "${newKey}"`);
    } else {
      tvdb = allTvdb[name];
      if (!tvdb) {
        unilog(779, "setTvdbFields no tvdb for", name);
        return "no tvdb";
      }
      if (paramObj.$delete) {
        for (const delName of paramObj.$delete) delete tvdb[delName];
      }

      const wasInEmby = tvdb.inEmby;
      const wasStatus = tvdb.status;

      // Handle nested field updates for Phase 1 new structure
      for (const [key, value] of Object.entries(paramObj)) {
        if (
          key === "dontSave" ||
          key === "$delete" ||
          key === "name" ||
          key === "dontNotify" ||
          key === "dontEnqueue"
        )
          continue;

        // Handle nested emby fields (e.g., inToTry)
        if (key.startsWith("emby") && typeof key === "string") {
          const embyField = key.replace(/^emby\.?/, "");
          if (embyField && embyField !== "emby") {
            tvdb.emby = tvdb.emby || {};
            tvdb.emby[embyField] = value;
            continue;
          }
        }

        // Handle nested disk fields
        if (key.startsWith("disk") && typeof key === "string") {
          const diskField = key.replace(/^disk\.?/, "");
          if (diskField && diskField !== "disk") {
            tvdb.disk = tvdb.disk || {};
            tvdb.disk[diskField] = value;
            continue;
          }
        }

        // Handle nested sync fields
        if (key.startsWith("sync") && typeof key === "string") {
          const syncField = key.replace(/^sync\.?/, "");
          if (syncField && syncField !== "sync") {
            tvdb.sync = tvdb.sync || {};
            tvdb.sync[syncField] = value;
            continue;
          }
        }

        // Handle direct assignment for top-level fields and nested objects
        tvdb[key] = value;
      }

      if (wasInEmby && tvdb.inEmby === false) {
        unilog(
          1227,
          `setTvdbFields: inEmby changed ${wasInEmby} -> ${tvdb.inEmby} for ${name}`,
        );
      } else if (wasInEmby !== tvdb.inEmby) {
        unilog(
          1228,
          `setTvdbFields: inEmby changed ${wasInEmby} -> ${tvdb.inEmby} for ${name}`,
        );
      }

      // Keep Emby button in sync with final inEmby/Id values (after field updates).
      if (!Array.isArray(tvdb.remotes)) tvdb.remotes = [];
      const embyIndex = tvdb.remotes.findIndex((r) => r?.name === "Emby");
      const embyId = tvdb?.id == null ? "" : String(tvdb.id).trim();
      const freshEmbyUrl = embyId ? urls.embyPageUrl(embyId) : null;
      if (tvdb.inEmby && freshEmbyUrl) {
        if (embyIndex >= 0) {
          tvdb.remotes[embyIndex] = { name: "Emby", url: freshEmbyUrl };
        } else {
          tvdb.remotes.unshift({ name: "Emby", url: freshEmbyUrl });
        }
      } else if (embyIndex >= 0) {
        tvdb.remotes.splice(embyIndex, 1);
      }

      // Auto-update pickups when inEmby or status changes
      if (
        pickupChangeCallback &&
        (wasInEmby !== tvdb.inEmby || wasStatus !== tvdb.status)
      ) {
        pickupChangeCallback(name, tvdb.inEmby, tvdb.status);
      }

      setImdbId(tvdb);
      if (tvdb.saved === 0) {
        // Queue a refresh for this specific request
        const show = {
          name: tvdb.name,
          tvdbId: tvdb.tvdbId,
        };
        if (tvdb.id) show.id = tvdb.id;
        const refreshParamObj = {
          show,
          seasonCount: tvdb.seasonCount ?? 0,
          episodeCount: tvdb.episodeCount ?? 0,
          watchedCount: tvdb.watchedCount ?? 0,
        };
        return new Promise((resolve) => {
          newTvdbQueue.unshift({
            ws: null,
            id: null,
            paramObj: refreshParamObj,
            resolve: resolve,
          });
          chkTvdbQueue();
        });
      }
      // allTvdb[name] = tvdb;
    }
  }
  if (!paramObj.dontSave) {
    if (paramObj.$delTvdb) {
      deleteShow(name);
    } else if (paramObj.$rename) {
      deleteShow(name);
      saveShow(renamedTvdbName, renamedTvdbRecord);
    } else {
      saveShow(name, allTvdb[name]);
    }
    if (notifyCallback && name && !paramObj.$delTvdb && !paramObj.dontNotify)
      notifyCallback(name);
  }
  // Queue a full per-show refresh (disk + gap) for changes that matter
  if (name && !paramObj.$delTvdb && !paramObj.dontEnqueue) {
    enqueueShowProcess(name);
  }
  return tvdb ?? "ok";
};

// Per-season intro data ------------------------------------------------------
// seasonIntros is a sparse map { [season]: { trimPos, startMark, skipDur } } on
// the tvdb record, or null/absent when no season has been edited.

const EMPTY_SEASON_INTRO = {
  trimPos: null,
  startMark: null,
  skipDur: null,
  none: false,
};

// Return the intro-data object for a season. Falls back to the nearest season
// that HAS data (closest smaller first, then closest larger). When seasonIntros
// is null/absent/empty, returns an ephemeral all-null object. Always a shallow
// copy so callers can't mutate stored data. Uses only seasonIntros' own keys.
export const getSeasonIntro = (record, season) =>
  getSeasonIntroShared(record?.seasonIntros, season);

// Save a single intro field for a season. Creates the season object (other two
// values null) when missing; deletes a season object when all three are null;
// sets seasonIntros to null when no seasons remain. Persists via setTvdbFields.
export const saveSeasonIntro = async (record, season, field, value) => {
  if (!record?.name) return;
  const s = String(Number(season));
  const map =
    record.seasonIntros && typeof record.seasonIntros === "object"
      ? { ...record.seasonIntros }
      : {};
  const obj = map[s] ? { ...map[s] } : { ...EMPTY_SEASON_INTRO };
  obj[field] = value;
  if (
    obj.trimPos == null &&
    obj.startMark == null &&
    obj.skipDur == null &&
    !obj.none
  ) {
    delete map[s];
  } else {
    map[s] = obj;
  }
  const next = Object.keys(map).length === 0 ? null : map;
  unilog(
    780,
    `[seasonIntro] ${record.name} s${s} ${field}=${value} -> ` +
      `${next ? `seasons=${Object.keys(next).join(",")}` : "cleared"}`,
  );
  await setTvdbFields({ name: record.name, seasonIntros: next });
};

export const getTvmazeCrew_cmd = async (params) => {
  const tvdbId = params?.tvdbId;
  return getTvmazeCrew(tvdbId);
};

export const accessTvdb = async (params) => {
  let url = "unknown";
  try {
    const paramObj = params;
    if (!paramObj) throw new Error("invalid params");
    const { path: tvdbPath, query } = paramObj;

    url = buildTvdbUrl(tvdbPath, query).toString();
    // log("accessTvdb: START", { tvdbPath, url });

    let token = await getToken();

    let upstream = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (upstream.status === 401) {
      unilog(127, "accessTvdb: 401, refreshing token");
      cachedToken = null;
      token = await getToken();
      upstream = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    }

    const body = await upstream.text();
    let data = body;
    try {
      if (upstream.headers.get("content-type")?.includes("application/json")) {
        data = JSON.parse(body);
      }
    } catch (parseErr) {
      unilog(781, "accessTvdb: JSON parse error", {
        parseErr,
        bodyExcerpt: body.substring(0, 100),
      });
    }

    if (!upstream.ok) {
      unilog(782, "accessTvdb: UPSTREAM ERROR", {
        status: upstream.status,
        statusText: upstream.statusText,
        url,
        body,
      });
    }
    // else {
    //   log("accessTvdb: END", { ok: upstream.ok, status: upstream.status });
    // }

    return {
      ok: upstream.ok,
      status: upstream.status,
      data,
    };
  } catch (e) {
    unilog(783, "accessTvdb error", { error: e.message, stack: e.stack, url });
    // Return error structure for robustness
    return {
      ok: false,
      status: 500,
      error: `Server error accessing TVDB: ${e.message}`,
    };
  }
};

/**
 * Update tvdb records with gap check data
 * @param {Object} gapData - Gap data keyed by show Id
 * @returns {Promise<number>} - Number of shows updated
 */
export const updateTvdbWithGapData = async (gapData) => {
  if (!gapData || typeof gapData !== "object") return 0;

  const allTvdb = getAllTvdbSync();
  let updatedCount = 0;
  let processedCount = 0;

  for (const [showName, tvdbRecord] of Object.entries(allTvdb)) {
    if (!tvdbRecord?.id) continue;

    const showId = tvdbRecord.id;
    const gaps = gapData[showId];
    if (!gaps) continue;

    tvdbRecord.lastGapCheck = Date.now();
    processedCount++;

    const changed =
      tvdbRecord.notReady !== gaps.notReady ||
      tvdbRecord.anyWatched !== gaps.anyWatched ||
      tvdbRecord.watchGap !== gaps.watchGap ||
      tvdbRecord.watchGapSeason !== gaps.watchGapSeason ||
      tvdbRecord.watchGapEpisode !== gaps.watchGapEpisode ||
      tvdbRecord.fileGap !== gaps.fileGap ||
      tvdbRecord.fileGapSeason !== gaps.fileGapSeason ||
      tvdbRecord.fileGapEpisode !== gaps.fileGapEpisode ||
      tvdbRecord.fileEndError !== gaps.fileEndError ||
      tvdbRecord.fileEndErrorSeason !== gaps.fileEndErrorSeason ||
      tvdbRecord.fileEndErrorEpisode !== gaps.fileEndErrorEpisode ||
      tvdbRecord.seasonWatchedThenNofile !== gaps.seasonWatchedThenNofile ||
      tvdbRecord.seasonWatchedThenNofileSeason !==
        gaps.seasonWatchedThenNofileSeason ||
      tvdbRecord.seasonWatchedThenNofileEpisode !==
        gaps.seasonWatchedThenNofileEpisode;

    if (changed) {
      tvdbRecord.notReady = gaps.notReady;
      tvdbRecord.anyWatched = gaps.anyWatched;
      tvdbRecord.watchGap = gaps.watchGap;
      tvdbRecord.watchGapSeason = gaps.watchGapSeason;
      tvdbRecord.watchGapEpisode = gaps.watchGapEpisode;
      tvdbRecord.fileGap = gaps.fileGap;
      tvdbRecord.fileGapSeason = gaps.fileGapSeason;
      tvdbRecord.fileGapEpisode = gaps.fileGapEpisode;
      tvdbRecord.fileEndError = gaps.fileEndError;
      tvdbRecord.fileEndErrorSeason = gaps.fileEndErrorSeason;
      tvdbRecord.fileEndErrorEpisode = gaps.fileEndErrorEpisode;
      tvdbRecord.seasonWatchedThenNofile = gaps.seasonWatchedThenNofile;
      tvdbRecord.seasonWatchedThenNofileSeason =
        gaps.seasonWatchedThenNofileSeason;
      tvdbRecord.seasonWatchedThenNofileEpisode =
        gaps.seasonWatchedThenNofileEpisode;
      updatedCount++;
    }
  }

  if (processedCount > 0) {
    saveAllShows(allTvdb);
    if (updatedCount > 0) {
      unilog(128, `Updated ${updatedCount} shows`);
    }
  }

  return updatedCount;
};

/**
 * One-time migration: recalculate watchedCount from watchedEpis for all shows
 * Call this once to fix shows where watchedCount doesn't match watchedEpis
 */
export const migrateWatchedCount = async () => {
  const allData = getAllTvdbSync();
  let updatedCount = 0;

  for (const [showName, record] of Object.entries(allData)) {
    if (!record.watchedEpis || !Array.isArray(record.watchedEpis)) continue;

    const calculatedCount = calculateWatchedCount(record.watchedEpis);
    if (record.watchedCount !== calculatedCount) {
      unilog(784, `${showName}: ${record.watchedCount} -> ${calculatedCount}`);
      record.watchedCount = calculatedCount;
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    saveAllShows(allTvdb);
    unilog(129, `Updated ${updatedCount} shows`);
  } else {
    unilog(130, "No updates needed");
  }

  return updatedCount;
};

// Export helper functions for migration and external use
export {
  seriesMapToWatchedEpis,
  applyWatchedEpisToSeriesMap,
  getSeriesMap,
  calculateWatchedCount,
  calculateWaitStr,
};

const isValidUrl = async (url) => {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000), // 5-second timeout
    });
    return res.ok;
  } catch (error) {
    return false;
  }
};
