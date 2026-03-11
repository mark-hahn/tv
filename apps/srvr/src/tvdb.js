import fs from "fs";
import * as path from "node:path";
import fetch from "node-fetch";
import { chromium } from "playwright";
import WebSocket from "ws";
import * as urls from "./urls.js";
import * as emby from "./emby.js";
import { rottenSearch } from "./rotten.js";
import * as util from "./util.js";
const { getPstDate } = util;
import { SRVR_DATA_DIR } from "./srvrPaths.js";
import { MovieDb } from "moviedb-promise";
const { log, start, end } = util.getLog("tvdb");
const TVDB_PATH = path.join(SRVR_DATA_DIR, "tvdb.json");
const TVDB_BACKUP_PATH = path.join(SRVR_DATA_DIR, "tvdb.json.bak");
const TVDB_TEMPLATE_PATH = path.join(SRVR_DATA_DIR, "tvdbTemplate.json");

const FAST_UPDATE = false;
const TVDB_UPDATE_DELAY_MS = FAST_UPDATE ? 5 * 1000 : 2 * 60 * 1000;
const moviedb = new MovieDb("327192a334da700f65b882c7a69cb927");

// TVDB API Credentials
const TVDB_APIKEY = "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df";
const TVDB_PIN = "HXEVSDFF";

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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureFile(filePath, defaultStr) {
  if (fs.existsSync(filePath)) return;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, defaultStr, "utf8");
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

ensureDir(SRVR_DATA_DIR);
ensureFile(TVDB_PATH, "{}");
ensureFile(TVDB_BACKUP_PATH, "{}");

const isRecordObject = (v) => v && typeof v === "object" && !Array.isArray(v);

function parseTvdbJson(text, filePath) {
  const parsed = util.jParse(text, filePath);
  if (!isRecordObject(parsed)) return null;
  return parsed;
}

function loadTvdbAtStartup() {
  const primaryText = fs.readFileSync(TVDB_PATH, "utf8");
  const primaryParsed = parseTvdbJson(primaryText, TVDB_PATH);
  if (primaryParsed) return migrateRemotesToFlatProps(primaryParsed);

  const backupText = fs.readFileSync(TVDB_BACKUP_PATH, "utf8");
  const backupParsed = parseTvdbJson(backupText, TVDB_BACKUP_PATH);
  if (backupParsed) {
    console.error(
      `[tvdb] startup recovery: invalid primary JSON at ${TVDB_PATH}; restoring from backup ${TVDB_BACKUP_PATH}`,
    );
    fs.writeFileSync(TVDB_PATH, JSON.stringify(backupParsed), "utf8");
    return migrateRemotesToFlatProps(backupParsed);
  }

  throw new Error(
    `[tvdb] FATAL: invalid JSON in both ${TVDB_PATH} and ${TVDB_BACKUP_PATH}`,
  );
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
    console.log(
      `[tvdb] migrated flat url props for ${migrated} remote entries`,
    );
  return data;
}

async function saveTvdbFiles(data) {
  // Strip computed runtime prop 'remotes' — rebuilt from flat url props on each refresh
  const toSave = Object.fromEntries(
    Object.entries(data).map(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v) && "remotes" in v) {
        const { remotes: _, ...rest } = v;
        return [k, rest];
      }
      return [k, v];
    }),
  );
  await util.writeFile(TVDB_PATH, toSave);
  await util.writeFile(TVDB_BACKUP_PATH, toSave);
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
        log("err", "getSeriesMap: failed to fetch episodes", {
          tvdbId,
          page,
          status: res.status,
        });
        break;
      }
    } catch (e) {
      log("err", "getSeriesMap: fetch error", {
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

  // Convert to seriesMap format
  const seasonNums = Object.keys(seasonMap)
    .map(Number)
    .sort((a, b) => a - b);
  for (const seasonNum of seasonNums) {
    seriesMap.push([seasonNum, seasonMap[seasonNum]]);
  }

  if (missingEpisodeNumSamples.length > 0) {
    log("warn", "getSeriesMap: episodes missing numeric episode number", {
      tvdbId,
      missingEpisodeNumBySeason,
      sample: missingEpisodeNumSamples,
    });
  }

  // Apply watchedEpis if provided
  if (watchedEpis && watchedEpis.length > 0) {
    return applyWatchedEpisToSeriesMap(seriesMap, watchedEpis);
  }

  return seriesMap;
}

const UPDATE_DATA = true;

let addToPickupsCallback = null;

let allTvdb = null;
try {
  allTvdb = loadTvdbAtStartup();
} catch {
  throw new Error(
    `[tvdb] startup aborted: cannot load valid tvdb data from ${TVDB_PATH}`,
  );
}

// Phase 5: Migrate separate JSON files into tvdb.json
let phase5MigrationNeeded = false;

// 5.1: Migrate gaps.json
const gapsPath = path.join(SRVR_DATA_DIR, "gaps.json");
if (fs.existsSync(gapsPath) && !fs.existsSync(gapsPath + ".backup")) {
  log("Phase 5.1: Migrating gaps.json into tvdb.json");
  try {
    const gaps = util.jParse(fs.readFileSync(gapsPath, "utf8"));
    let gapCount = 0;

    for (const [embyId, gapData] of Object.entries(gaps)) {
      const tvdb = Object.values(allTvdb).find((t) => t.emby?.id === embyId);
      if (tvdb && !tvdb.gap) {
        tvdb.gap = gapData;
        gapCount++;
        phase5MigrationNeeded = true;
      }
    }

    log(`Phase 5.1: Migrated ${gapCount} gaps from gaps.json`);
    fs.renameSync(gapsPath, gapsPath + ".backup");
  } catch (e) {
    log("err", "Phase 5.1: gaps.json migration failed:", e);
  }
}

// 5.2: Migrate notes.json
const notesPath = path.join(SRVR_DATA_DIR, "notes.json");
if (fs.existsSync(notesPath) && !fs.existsSync(notesPath + ".backup")) {
  log("Phase 5.2: Migrating notes.json into tvdb.json");
  try {
    const notes = util.jParse(fs.readFileSync(notesPath, "utf8"));
    let noteCount = 0;

    for (const [showName, note] of Object.entries(notes)) {
      if (allTvdb[showName] && !allTvdb[showName].note) {
        allTvdb[showName].note = note;
        noteCount++;
        phase5MigrationNeeded = true;
      }
    }

    log(`Phase 5.2: Migrated ${noteCount} notes from notes.json`);
    fs.renameSync(notesPath, notesPath + ".backup");
  } catch (e) {
    log("err", "Phase 5.2: notes.json migration failed:", e);
  }
}

// 5.3: Migrate lastViewed.json
const lastViewedPath = path.join(SRVR_DATA_DIR, "lastViewed.json");
if (
  fs.existsSync(lastViewedPath) &&
  !fs.existsSync(lastViewedPath + ".backup")
) {
  log("Phase 5.3: Migrating lastViewed.json into tvdb.json");
  try {
    const lastViewed = util.jParse(fs.readFileSync(lastViewedPath, "utf8"));
    let viewedCount = 0;

    for (const [showName, timestamp] of Object.entries(lastViewed)) {
      if (allTvdb[showName] && !allTvdb[showName].lastViewed) {
        allTvdb[showName].lastViewed = timestamp;
        viewedCount++;
        phase5MigrationNeeded = true;
      }
    }

    log(
      `Phase 5.3: Migrated ${viewedCount} lastViewed timestamps into tvdb.json`,
    );
    fs.renameSync(lastViewedPath, lastViewedPath + ".backup");
  } catch (e) {
    log("err", "Phase 5.3: lastViewed.json migration failed:", e);
  }
}

// Save Phase 5 migrations
if (phase5MigrationNeeded) {
  log("Phase 5: Saving tvdb.json with migrated data from separate files");
  saveTvdbFiles(allTvdb)
    .then(() => {
      log("Phase 5: Migration complete - backup files created");
    })
    .catch((e) => {
      log("err", "Phase 5: Migration save failed:", e);
    });
}

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

  imdbBrowser = await chromium.launch({ headless: true });
  return imdbBrowser;
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
    let context = null;
    let page = null;
    let resp = null;
    try {
      const b = await getImdbBrowser();
      context = await b.newContext({
        userAgent: IMDB_USER_AGENT,
        locale: "en-US",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      page = await context.newPage();
      resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(500);
    } catch (e) {
      log(
        "err",
        `getUrlAndRatings imdb playwright error: ${url}, ${e.message}`,
      );
      return { ratings: null, video: null };
    }

    if (!resp || !resp.ok()) {
      const status = resp ? resp.status() : null;
      log("err", `getUrlAndRatings imdb fetch error: ${url}, status=${status}`);
      try {
        await context?.close();
      } catch {}
      return { ratings: null, video: null };
    }

    try {
      await page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => {});
      let html = await page
        .evaluate(() => document.documentElement.outerHTML)
        .catch(() => null);
      const compactHtml = (html || "")
        .replaceAll(/\r?\n/gm, "")
        .replaceAll(/\s+/gm, " ");
      const hasChallengeMarkers =
        /verify you are human|please verify you are a human|enter the characters you see below|type the characters you see/i.test(
          compactHtml,
        );
      const hasRatingEvidence =
        /ipc-rating-star--rating|"aggregateRating"|"ratingValue"/i.test(
          compactHtml,
        );
      if (hasChallengeMarkers && !hasRatingEvidence) {
        log("err", `getUrlAndRatings imdb challenge page: ${url}`);
        try {
          await context?.close();
        } catch {}
        return { ratings: null, video: null };
      }

      html = compactHtml;
      let rating = null;
      const jsonLdRating = await page
        .evaluate(() => {
          const scripts = Array.from(
            document.querySelectorAll('script[type="application/ld+json"]'),
          );
          const visit = (node) => {
            if (!node) return null;
            if (Array.isArray(node)) {
              for (const item of node) {
                const found = visit(item);
                if (found !== null) return found;
              }
              return null;
            }
            if (typeof node !== "object") return null;

            const typeVal = node["@type"];
            const typeList = Array.isArray(typeVal) ? typeVal : [typeVal];
            const isTitleType = typeList.some((t) =>
              ["TVSeries", "Movie", "TVMiniSeries", "TVEpisode"].includes(
                String(t || ""),
              ),
            );
            if (
              isTitleType &&
              node.aggregateRating?.ratingValue !== undefined
            ) {
              const v = parseFloat(String(node.aggregateRating.ratingValue));
              if (!Number.isNaN(v) && v >= 0 && v <= 10) return v;
            }

            if (node["@graph"]) {
              const found = visit(node["@graph"]);
              if (found !== null) return found;
            }
            for (const v of Object.values(node)) {
              const found = visit(v);
              if (found !== null) return found;
            }
            return null;
          };

          for (const s of scripts) {
            try {
              const parsed = JSON.parse(s.textContent || "");
              const found = visit(parsed);
              if (found !== null) return found;
            } catch {
              // ignore malformed JSON-LD blocks
            }
          }
          return null;
        })
        .catch(() => null);
      if (
        typeof jsonLdRating === "number" &&
        !Number.isNaN(jsonLdRating) &&
        jsonLdRating >= 0 &&
        jsonLdRating <= 10
      ) {
        rating = String(jsonLdRating);
      }

      const ratingSelectors = [
        '[data-testid="hero-rating-bar__aggregate-rating__score"] [data-testid="rating-histogram-star"]',
        '[data-testid="hero-rating-bar__aggregate-rating"] [data-testid="rating-histogram-star"]',
        '[data-testid="hero-rating-bar__aggregate-rating"] .ipc-rating-star--rating',
        '[data-testid="rating-histogram-star"]',
        ".ipc-rating-star--rating",
      ];
      if (!rating) {
        for (const selector of ratingSelectors) {
          const ratingText = await page
            .locator(selector)
            .first()
            .textContent({ timeout: 1500 })
            .catch(() => null);
          const ratingVal = parseFloat(String(ratingText || "").trim());
          if (!Number.isNaN(ratingVal) && ratingVal >= 0 && ratingVal <= 10) {
            rating = String(ratingVal);
            break;
          }
        }
      }
      if (!rating) {
        rating = extractImdbRating(html);
      }
      const video = extractImdbVideo(html);
      if (!rating && !video) {
        try {
          await context?.close();
        } catch {}
        return { ratings: null, video: null };
      }
      try {
        await context?.close();
      } catch {}
      return { ratings: rating, video: video };
    } catch (e) {
      log("err", `getUrlAndRatings imdb parse error: ${url}, ${e.message}`);
      try {
        await context?.close();
      } catch {}
      return { ratings: null, video: null };
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
  let video = null;
  let urlRatings, name, escShow;

  switch (type) {
    case 2:
      name = "IMDB";
      url = `https://www.imdb.com/title/${id}`;
      urlRatings = await getUrlAndRatings(2, url, name);
      ratings = urlRatings?.ratings;
      video = urlRatings?.video;
      break;

    case 4:
      name = "Official Website";
      url = id;
      break;

    case 7:
      name = "Reddit";
      {
        const escShow = encodeURIComponent(showName);
        const redditApiUrl = `https://www.reddit.com/subreddits/search.json?q=${escShow}&limit=10`;
        try {
          const resp = await fetch(redditApiUrl, {
            headers: { "User-Agent": "tv-app/1.0" },
            signal: AbortSignal.timeout(8000),
          });
          if (!resp.ok) {
            log("err", `reddit search ${resp.status} for ${showName}`);
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
          log("err", `reddit search error for ${showName}: ${e.message}`);
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
            log("err", `wikipedia search ${resp.status} for ${showName}`);
            break;
          }
          const json = await resp.json();
          const results = json?.query?.search ?? [];
          if (results.length > 0) {
            const title = results[0].title;
            url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%20/g, "_")}`;
          }
        } catch (e) {
          log("err", `wikipedia search error for ${showName}: ${e.message}`);
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
      ratings = urlRatings.criticsScore + "/" + urlRatings.audienceScore;
      break;

    default:
      return null;
  }

  if (!url) {
    // log(`getRemote, no url: ${name}`);
    return null;
  }
  // console.log(`getRemote`, { name, url, ratings });
  return { name, url, ratings, video };
};

///////////// get remotes  //////////////
// use tvdb remotes data to find complete remote data

const getRemotes = async (show, tvdbRemotes, fast = false) => {
  const name = show.Name;
  const showId = show.Id;
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
      remotes.push({ name: "Rotten", url });
    }
  }

  // Always fetch other remotes (Google, Wikipedia, Reddit, IMDB, etc.)
  const encoded = encodeURI(name).replaceAll("&", "%26");
  const url = `https://www.google.com/search` + `?q=${encoded}%20tv%20show`;
  remotes.push({ name: "Google", url });

  // Wikipedia: use cached flat prop; if missing, fetch and persist it.
  const cachedWikiUrl = allTvdb[name]?.wikiUrl;
  if (cachedWikiUrl) {
    remotes.push({ name: "Wikipedia", url: cachedWikiUrl });
  } else {
    const wikiRemote = await getRemote(null, 18, name);
    if (wikiRemote?.url) {
      remotes.push({ name: "Wikipedia", url: wikiRemote.url });
      flatUrls.wikiUrl = wikiRemote.url;
    }
  }

  // Reddit: use cached flat prop; if missing, fetch and persist it.
  const cachedRedditUrl = allTvdb[name]?.redditUrl;
  if (cachedRedditUrl) {
    remotes.push({ name: "Reddit", url: cachedRedditUrl });
  } else {
    const redditRemote = await getRemote(null, 7, name);
    if (redditRemote?.url) {
      remotes.push({ name: "Reddit", url: redditRemote.url });
      flatUrls.redditUrl = redditRemote.url;
    }
  }

  const remotesByName = {};
  for (const tvdbRemote of tvdbRemotes) {
    if (tvdbRemote.type == 18) continue;
    if (tvdbRemote.type == 7) continue; // Reddit handled separately above
    if (tvdbRemote.type == 2) continue; // IMDB handled separately below
    const remote = await getRemote(
      tvdbRemote.id,
      tvdbRemote.type,
      tvdbRemote.sourceName,
    );
    if (remote && remote.url != "no match") {
      if (!remote.ratings) delete remote.ratings;
      remotesByName[remote.name] = remote;
    }
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
      if (cachedShow.imdbVideo) imdbEntry.video = cachedShow.imdbVideo;
      remotesByName["IMDB"] = imdbEntry;
    } else {
      // Scrape live: try tvdb remoteId type=2 first
      const imdbTvdbRemote = tvdbRemotes.find((r) => r.type === 2);
      if (imdbTvdbRemote) {
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
      // Fallback: use imdbId from tvdb record
      if (!remotesByName["IMDB"] && cachedShow?.imdbId) {
        const fallbackRemote = await getRemote(cachedShow.imdbId, 2, name);
        if (fallbackRemote) {
          remotesByName["IMDB"] = fallbackRemote;
        }
      }
    }
  }

  const imdbRemote = remotesByName["IMDB"];
  if (imdbRemote) {
    imdbRemote.name += imdbRemote.ratings
      ? " (" + imdbRemote.ratings + ")"
      : "";
    flatUrls.imdbUrl = imdbRemote.url || null;
    flatUrls.imdbRatings = imdbRemote.ratings || null;
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
    log("err", "getTmdbFallback error for", showName, err.message);
    return null;
  }
}

//////////// GET TVDB DATA //////////////
// fetch data from tvdb.com
// create tvdbData object
// update allTvdb & tvdb.json
// Calculate waitStr from nextAired and lastAired dates
const calculateWaitStr = (nextAired, lastAired) => {
  try {
    // Use the greater of nextAired and lastAired
    const next = nextAired || "";
    const last = lastAired || "";
    const airDate = next > last ? next : last;
    if (!airDate) return null;

    // Check if date is in the future
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (airDate >= today) {
      // Format as {MMM DD} or {Mon DD}
      const airDateNoYr = airDate.slice(5).replace(/^0/, " ").trim();
      return `{${airDateNoYr}}`;
    }
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
  if (inputPositive) return inputPositive;
  const apiPositive = toPositiveInt(apiCount);
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
  if (!show || !show.Name) {
    log("err", "getTvdbData: Invalid paramObj - missing show.Name", {
      paramObj,
    });
    if (resolve) resolve(null);
    return;
  }

  const inputName = show.Name;
  // log("getTvdbData: START", { name, fast });
  // Use PST for added date
  const added = allTvdb[inputName]?.added ?? getPstDate();
  const showId = show.Id;
  const tvdbId = show.TvdbId || show.tvdbId;
  if (!tvdbId) {
    log("err", "getTvdbData no tvdbId:", show);
    resolve(inputName);
    return;
  }

  let canonicalName = inputName;
  for (const [existingKey, existingRecord] of Object.entries(allTvdb || {})) {
    if (existingKey === inputName) continue;
    const existingTvdbId = String(
      existingRecord?.tvdbId || existingRecord?.TvdbId || "",
    ).trim();
    if (existingTvdbId && String(tvdbId).trim() === existingTvdbId) {
      canonicalName = existingRecord?.Name || existingKey;
      if (canonicalName !== inputName) {
        log(
          "inf",
          `getTvdbData canonicalized by tvdbId=${tvdbId}: input=\"${inputName}\" canonical=\"${canonicalName}\"`,
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
      log(
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
    log("err", "getTvdbData extended catch error:", name, {
      extUrl,
      extRes,
      err,
    });
    resolve(name);
    return;
  }
  const extResObj = await extRes.json();

  // DEBUG: Log remoteIds for debugging
  if (name.toLowerCase().includes("boomer")) {
    console.log(
      `[DEBUG] ${name} - TVDB API remoteIds:`,
      extResObj.data?.remoteIds,
    );
    console.log(
      `[DEBUG] ${name} - Full extResObj.data:`,
      JSON.stringify(extResObj.data, null, 2),
    );
  }

  const {
    firstAired,
    lastAired: lastAiredIn,
    nextAired: nextAiredIn,
    score,
    overview,
    remoteIds,
    averageRuntime,
    originalCountry,
    originalLanguage,
    originalNetwork: originalNetworkIn,
    status: statusIn,
    trailers: trailersIn,
  } = extResObj.data;
  const image = getTvdbImageUrl(extResObj);
  const characters = getTvdbCharacters(extResObj);
  let lastAired = lastAiredIn ?? firstAired;
  lastAired = lastAired ?? "";
  let nextAired = nextAiredIn ?? "";
  let originalNetwork = originalNetworkIn?.name ?? "";
  const status = statusIn.name; // e.g. Ended

  // Preserve existing non-empty values when API returns empty
  const existing = allTvdb[name] || {};
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
    log("Fetching TMDB fallback for", name);
    tmdbData = await getTmdbFallback(name);
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
    Name: name,
    tvdbId: tvdbId,
    originalNetwork: preserve(
      originalNetwork,
      existing.originalNetwork,
      tmdbData?.originalNetwork,
    ),
    seasonCount: finalSeasonCount,
    episodeCount: finalEpisodeCount,
    watchedCount,
    image: preserve(image, existing.image, tmdbData?.image),
    score: preserve(score, existing.score, tmdbData?.score),
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
    added,
    saved,
    // Remote URL flat props — persisted so Google/scrape calls are skipped on subsequent refreshes
    wikiUrl: fetchedUrls.wikiUrl ?? existing.wikiUrl ?? null,
    redditUrl: fetchedUrls.redditUrl ?? existing.redditUrl ?? null,
    imdbUrl: fetchedUrls.imdbUrl ?? existing.imdbUrl ?? null,
    imdbRatings: fetchedUrls.imdbRatings ?? existing.imdbRatings ?? null,
    imdbVideo: fetchedUrls.imdbVideo ?? existing.imdbVideo ?? null,
    rottenUrl: fetchedUrls.rottenUrl ?? existing.rottenUrl ?? null,
    rottenRatings: fetchedUrls.rottenRatings ?? existing.rottenRatings ?? null,
  };

  // Add optional TMDB-only fields if available
  if (tmdbData?.backdrop)
    tvdbData.backdrop = preserve(null, existing.backdrop, tmdbData.backdrop);
  if (tmdbData?.genres)
    tvdbData.genres = preserve(null, existing.genres, tmdbData.genres);
  if (tmdbData?.homepage)
    tvdbData.homepage = preserve(null, existing.homepage, tmdbData.homepage);
  if (tmdbData?.tagline)
    tvdbData.tagline = preserve(null, existing.tagline, tmdbData.tagline);
  if (tmdbData?.type)
    tvdbData.type = preserve(null, existing.type, tmdbData.type);
  if (tmdbData?.numberOfSeasons)
    tvdbData.numberOfSeasons = preserve(
      null,
      existing.numberOfSeasons,
      tmdbData.numberOfSeasons,
    );
  if (tmdbData?.numberOfEpisodes)
    tvdbData.numberOfEpisodes = preserve(
      null,
      existing.numberOfEpisodes,
      tmdbData.numberOfEpisodes,
    );
  if (tmdbData?.inProduction !== undefined)
    tvdbData.inProduction = preserve(
      null,
      existing.inProduction,
      tmdbData.inProduction,
    );
  if (tmdbData?.createdBy)
    tvdbData.createdBy = preserve(null, existing.createdBy, tmdbData.createdBy);
  if (tmdbData?.productionCompanies)
    tvdbData.productionCompanies = preserve(
      null,
      existing.productionCompanies,
      tmdbData.productionCompanies,
    );
  if (tmdbData?.spokenLanguages)
    tvdbData.spokenLanguages = preserve(
      null,
      existing.spokenLanguages,
      tmdbData.spokenLanguages,
    );

  if (finalTrailers && finalTrailers.length > 0)
    tvdbData.trailers = finalTrailers;

  // Determine inEmby status:
  // - If lastEmbySync is present in params, this is an Emby sync, so inEmby = true
  // - Otherwise, use show.inEmby value or preserve existing value
  const isSyncingFromEmby = !!paramObj.lastEmbySync;
  const newInEmby = isSyncingFromEmby
    ? true
    : (show.inEmby ?? existing.inEmby ?? false);

  // Ensure Emby button is correct in fresh remotes based on inEmby status
  const embyBtnIdx = tvdbData.remotes.findIndex((r) => r.name === "Emby");
  const embyUrl = urls.embyPageUrl(showId || tvdbData.Id);
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
  tvdbData.Id = showId || existing.Id || existing.emby?.id || null;
  tvdbData.Path =
    paramObj.embyPath || existing.Path || existing.emby?.path || null;
  tvdbData.DateCreated =
    paramObj.dateCreated ||
    existing.DateCreated ||
    existing.emby?.dateCreated ||
    null;
  tvdbData.PremiereDate =
    paramObj.premiereDate ||
    existing.PremiereDate ||
    existing.emby?.premiereDate ||
    null;
  tvdbData.InToTry =
    paramObj.inToTry ?? existing.InToTry ?? existing.emby?.inToTry ?? false;
  tvdbData.InContinue =
    paramObj.inContinue ??
    existing.InContinue ??
    existing.emby?.inContinue ??
    false;
  tvdbData.InMark =
    paramObj.inMark ?? existing.InMark ?? existing.emby?.inMark ?? false;
  tvdbData.InLinda =
    paramObj.inLinda ?? existing.InLinda ?? existing.emby?.inLinda ?? false;
  tvdbData.IsFavorite =
    paramObj.isFavorite ??
    existing.IsFavorite ??
    existing.emby?.isFavorite ??
    false;
  tvdbData.Played =
    paramObj.isPlayed ?? existing.Played ?? existing.emby?.isPlayed ?? false;
  tvdbData.PlayCount =
    paramObj.playCount ?? existing.PlayCount ?? existing.emby?.playCount ?? 0;
  tvdbData.LastPlayedDate =
    paramObj.lastPlayedDate ||
    existing.LastPlayedDate ||
    existing.emby?.lastPlayedDate ||
    null;

  // Flattened Disk/filesystem data (no nested object)
  tvdbData.Date =
    paramObj.diskDate || existing.Date || existing.disk?.date || null;
  tvdbData.Size =
    paramObj.diskSize ?? existing.Size ?? existing.disk?.size ?? 0;
  tvdbData.NoFiles =
    paramObj.noFiles ?? existing.NoFiles ?? existing.disk?.noFiles ?? false;

  // Flattened Download tracking (no nested object)
  tvdbData.downloadStatus =
    paramObj.downloadStatus ||
    existing.downloadStatus ||
    existing.download?.status ||
    null;
  tvdbData.downloadLastCheck =
    paramObj.downloadLastCheck ||
    existing.downloadLastCheck ||
    existing.download?.lastCheck ||
    null;

  // Flattened TVMaze reference (no nested object)
  tvdbData.tvmazeId =
    paramObj.tvmazeId || existing.tvmazeId || existing.tvmaze?.id || null;
  tvdbData.tvmazeStatus =
    paramObj.tvmazeStatus ||
    existing.tvmazeStatus ||
    existing.tvmaze?.status ||
    null;

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
    "seasonWatchedThenNofile",
    "anyWatched",
    "notReady",
    "lastGapCheck",
  ];
  for (const f of flatGapFields) {
    if (tvdbData[f] === undefined && existing[f] !== undefined)
      tvdbData[f] = existing[f];
  }

  // Ensure notReady has a value - default to true for inEmby shows until gap check runs
  if (tvdbData.notReady === undefined && tvdbData.inEmby) {
    tvdbData.notReady = true;
  }

  // Notes
  tvdbData.Notes = paramObj.note ?? existing.Notes ?? existing.note ?? "";

  // leftEmby timestamp (yyyy-mm-dd format) - set when show is removed from Emby
  tvdbData.leftEmby =
    paramObj.leftEmby || existing.leftEmby || existing.emby?.leftEmby || null;

  // Additional flags
  tvdbData.Reject =
    paramObj.reject ?? existing.Reject ?? existing.reject ?? false;
  tvdbData.reject = tvdbData.Reject; // keep lowercase in sync
  tvdbData.Pickup =
    paramObj.pickup ?? existing.Pickup ?? existing.pickup ?? false;
  tvdbData.pickup = tvdbData.Pickup; // keep lowercase in sync
  tvdbData.lastWatched = paramObj.lastWatched || existing.lastWatched || null;

  // Calculate waitStr from nextAired and lastAired if available
  const calculatedWaitStr = calculateWaitStr(
    tvdbData.nextAired,
    tvdbData.lastAired,
  );
  tvdbData.WaitStr =
    paramObj.waitStr ||
    calculatedWaitStr ||
    existing.WaitStr ||
    existing.waitStr ||
    null;

  // Flattened Sync timestamps (no nested object)
  tvdbData.lastEmbySync =
    paramObj.lastEmbySync ||
    existing.lastEmbySync ||
    existing.sync?.lastEmbySync ||
    null;
  tvdbData.lastDiskCheck =
    paramObj.lastDiskCheck ||
    existing.lastDiskCheck ||
    existing.sync?.lastDiskCheck ||
    null;
  tvdbData.lastMetadataUpdate = Date.now();

  setImdbId(tvdbData);

  // log('getTvdbData:', tvdbData);
  if (!paramObj.transient) {
    allTvdb[name] = tvdbData;
    if (inputName !== name && allTvdb[inputName]) {
      const inputTvdbId = String(
        allTvdb[inputName]?.tvdbId || allTvdb[inputName]?.TvdbId || "",
      ).trim();
      if (inputTvdbId && inputTvdbId === String(tvdbId).trim()) {
        delete allTvdb[inputName];
      }
    }
  }
  // update allTvdb & tvdb.json
  // log("getTvdbData: END", { name, hasRemotes: !!tvdbData.remotes?.length });
  resolve(tvdbData);
};

/////////  GET/UPDATE TVDB FOR WEB AND LOCAL //////
// each tvdb request from web waits in queue
// every result updates json file tvdb.json
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
    showProcessQueue.push({ name: showName, skipRotten: !!opts.skipRotten });
    // Only notify on 0→1 transition to avoid flooding clients on bulk enqueues
    if (wasEmpty && enqueueCallback) enqueueCallback(showName);
    // Kick processing immediately (no-op if already busy)
    if (_kickProcessQueue) setTimeout(_kickProcessQueue, 0);
  }
};
const dequeueShowProcess = () => showProcessQueue.shift() ?? null;

// Callbacks set by index.js to avoid circular imports
let notifyCallback = null;
export const setNotifyCallback = (fn) => {
  notifyCallback = fn;
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

const chkTvdbQueue = () => {
  if (chkTvdbQueueRunning || newTvdbQueue.length == 0) return;
  chkTvdbQueueRunning = true;
  const { ws, id, paramObj, resolve: resolveCb } = newTvdbQueue.pop();
  const showName = paramObj.show?.Name;
  // log("chkTvdbQueue: processing", {
  //   id,
  //   showName,
  //   queueLength: newTvdbQueue.length,
  // });

  if (ws && ws.readyState !== WebSocket.OPEN) {
    log("chkTvdbQueue: skipping closed WebSocket", id);
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
            const keyName = finalData.Name || finalData.name;
            const prev = allTvdb[keyName];
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
              tvdbChanges.push(`new record`);
            }
            if (!paramObj.suppressNotify) {
              log(
                `tvdb push1 [${keyName}]: ${tvdbChanges.length ? tvdbChanges.join(" ") : "no field changes"}`,
              );
            }
            allTvdb[keyName] = finalData;
            finalData._hasChanges = tvdbChanges.length > 0;
            if (paramObj.suppressNotify) {
              finalData._push1Changes = tvdbChanges;
            }
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
        console.error("chkTvdbQueue processing error:", e);
        if (resolveCb) resolveCb(null);
      }

      if (finalData && !paramObj.transient) {
        finalData.saved = Date.now();
        // Save to disk so timestamp persists across restarts
        saveTvdbFiles(allTvdb).catch((err) => {
          log("err", "chkTvdbQueue: save error:", err.message);
        });
        // Push updated record to clients only when fields actually changed
        if (!paramObj.suppressNotify) {
          if (notifyCallback && finalData.Name && finalData._hasChanges)
            notifyCallback(finalData.Name, finalData);
          delete finalData._hasChanges;
        }
        // When suppressNotify, _hasChanges/_push1Changes are preserved for the caller
      }
      chkTvdbQueueRunning = false;
      chkTvdbQueue();
    })
    .catch((err) => {
      log("err", "chkTvdbQueue: promise rejected", { err });
      if (resolveCb) resolveCb(null);
      chkTvdbQueueRunning = false;
      chkTvdbQueue();
    });
  getTvdbData(paramObj, resolve, reject);
};

//////////// UPDATE TVDB LOOP ////////////////
// get imdb data continuously to update data
// allTvdb is in memory copy of tvdb.json
// only one sequential request can be busy at a time
let tryLocalGetTvdbBusy = false;
const tryLocalGetTvdb = async () => {
  if (tryLocalGetTvdbBusy) return;
  if (showProcessQueue.length === 0) return;
  tryLocalGetTvdbBusy = true;

  // Run pre-tick callback (e.g. full Emby sweep for new/removed shows)
  if (preTvdbTickCallback) {
    try {
      await preTvdbTickCallback();
    } catch (e) {
      log("err", "tryLocalGetTvdb preTick:", e.message);
    }
  }

  const dequeued = dequeueShowProcess();
  if (!dequeued) {
    tryLocalGetTvdbBusy = false;
    return;
  }
  const requestedName = dequeued.name;
  const skipRotten = dequeued.skipRotten;
  currentlyProcessingShow = requestedName;

  const minTvdb = allTvdb[requestedName];
  if (!minTvdb) {
    log("err", `tryLocalGetTvdb: no record for queued show "${requestedName}"`);
    currentlyProcessingShow = null;
    tryLocalGetTvdbBusy = false;
    return;
  }

  log("");
  log(`processing [${minTvdb.Name}]`);
  // Notify clients which show is being processed
  if (enqueueCallback) enqueueCallback(minTvdb.Name);
  const show = {
    Name: minTvdb.Name,
    TvdbId: minTvdb.tvdbId,
  };
  if (minTvdb.Id) show.Id = minTvdb.Id;
  const paramObj = {
    show,
    seasonCount: minTvdb.seasonCount ?? 0,
    episodeCount: minTvdb.episodeCount ?? 0,
    watchedCount: minTvdb.watchedCount ?? 0,
    fast: false, // Background loop: scrape Rotten and IMDB to refresh tvdb.json cache.
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
    log("err", "tryLocalGetTvdb: tvdb update failed:", e?.message);
  }
  const processRecord = updatedRecord || allTvdb[minTvdb.Name] || minTvdb;

  // Fetch and persist series map data using the fresh record (try Emby first, fallback to TVDB)
  try {
    let seriesMap = null;

    // Try Emby if show is in Emby
    if (processRecord.inEmby && processRecord.Id) {
      seriesMap = await emby.getSeriesMap({
        Name: processRecord.Name,
        TvdbId: processRecord.tvdbId,
        Id: processRecord.Id,
      });
      if (seriesMap && seriesMap.length > 0) {
        processRecord.watchedEpis = seriesMapToWatchedEpis(seriesMap);
        await saveTvdbFiles(allTvdb);
      }
    }

    // Fallback to TVDB if Emby fails or show not in Emby
    if (!seriesMap && processRecord.tvdbId) {
      seriesMap = await getSeriesMap(
        processRecord.tvdbId,
        processRecord.watchedEpis,
      );
    }
  } catch (err) {
    log("err", "tryLocalGetTvdb seriesMap fetch error:", err.message);
  }

  // Run per-show process callback (disk check, gap check) with the up-to-date record
  let push2Result = { hasChanges: false, changes: [] };
  if (perShowCallback) {
    try {
      const result = await perShowCallback(processRecord.Name, processRecord, {
        suppressNotify: true,
      });
      if (result) push2Result = result;
    } catch (e) {
      log("err", "tryLocalGetTvdb perShow:", e.message);
    }
  }

  // Combined push1+push2 notify (one notification instead of two)
  const push1HasChanges = processRecord._hasChanges ?? false;
  const push1Changes = processRecord._push1Changes ?? [];
  delete processRecord._hasChanges;
  delete processRecord._push1Changes;
  const allPushChanges = [...push1Changes, ...push2Result.changes];
  if (push1HasChanges || push2Result.hasChanges) {
    log(`tvdb push [${processRecord.Name}]: ${allPushChanges.join(" ")}`);
    if (notifyCallback)
      notifyCallback(processRecord.Name, allTvdb[processRecord.Name]);
  } else {
    log(`tvdb push [${processRecord.Name}]: no changes`);
  }

  // Push 3: Rotten Tomatoes scrape (slow, runs separately after push1 & push2)
  if (!skipRotten && processRecord.Name && allTvdb[processRecord.Name]) {
    try {
      const rottenRemote = await getRemote(null, 99, processRecord.Name);
      if (rottenRemote) {
        if (rottenRemote.ratings)
          rottenRemote.name += " (" + rottenRemote.ratings + ")";
        const rec = allTvdb[processRecord.Name];
        const existingRemotes = Array.isArray(rec.remotes) ? rec.remotes : [];
        // Replace any existing Rotten entry with fresh scraped one
        rec.remotes = [
          ...existingRemotes.filter((r) => !r.name?.startsWith("Rotten")),
          rottenRemote,
        ];
        rec.rottenUrl = rottenRemote.url || null;
        rec.rottenRatings = rottenRemote.ratings || null;
        await saveTvdbFiles(allTvdb);
        log(
          `tvdb push3 [${processRecord.Name}]: Rotten ${rottenRemote.ratings || "no ratings"}`,
        );
        if (notifyCallback) notifyCallback(processRecord.Name, rec);
      } else {
        log(`tvdb push3 [${processRecord.Name}]: Rotten no result`);
      }
    } catch (e) {
      log("err", "tryLocalGetTvdb push3 rotten:", e.message);
    }
  }

  // If queue is now empty, notify clients
  if (showProcessQueue.length === 0 && queueDrainCallback) {
    try {
      queueDrainCallback();
    } catch (e) {
      log("err", "tryLocalGetTvdb queueDrain:", e.message);
    }
  }

  currentlyProcessingShow = null;
  tryLocalGetTvdbBusy = false;
  // If more shows are queued, continue processing after a short delay; otherwise use background cadence.
  if (showProcessQueue.length > 0) setTimeout(tryLocalGetTvdb, 1000);
  else setTimeout(tryLocalGetTvdb, TVDB_UPDATE_DELAY_MS);
};

// calls tryLocalGetTvdb every 5s (FAST_UPDATE) or 2 mins, delay from end of one task to beginning of next
const updateTvdbLocal = async () => {
  if (UPDATE_DATA) {
    // Enqueue the stalest show if the queue is empty (so everything goes through the queue)
    if (showProcessQueue.length === 0) {
      let stalest = null;
      let minSaved = Math.min();
      try {
        for (const tvdb of Object.values(allTvdb)) {
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
      if (stalest?.Name) {
        enqueueShowProcess(stalest.Name);
        log(`timer: enqueued stalest [${stalest.Name}]`);
      }
    }
    await tryLocalGetTvdb();
  }
  setTimeout(updateTvdbLocal, TVDB_UPDATE_DELAY_MS);
};
_kickProcessQueue = tryLocalGetTvdb;
updateTvdbLocal();

///////////////////  FUNCTION CALLS FROM CLIENT  ////////////////////
export const setAddToPickupsCallback = (callback) => {
  addToPickupsCallback = callback;
};

// WebSocket endpoint handler: returns remotes for a show.
// Expects param JSON: { show: { Name, Id? }, tvdbRemotes: [...], fast: boolean }
export const getRemotesCmd = async (params) => {
  const show = params?.show;
  const tvdbRemotes = params?.tvdbRemotes || [];
  const fast = !!params?.fast;
  // fast: true = use cached data (no Rotten Tomatoes or IMDB scraping)
  // fast: false = scrape Rotten Tomatoes and IMDB with Playwright for fresh ratings
  // log("getRemotesCmd: START", { showName: show?.Name, fast });

  if (!show) {
    throw new Error("getRemotes: missing show");
  }

  try {
    const { remotes, urls: fetchedUrls } = await getRemotes(
      show,
      tvdbRemotes,
      fast,
    );

    // When fetching fresh data (fast=false), save remotes and flat url props
    if (!fast && show.Name && allTvdb && allTvdb[show.Name]) {
      allTvdb[show.Name].remotes = remotes;
      Object.assign(allTvdb[show.Name], fetchedUrls);
      // Save to disk asynchronously without blocking response
      saveTvdbSync().catch((err) => {
        log("err", "getRemotesCmd: saveTvdbSync failed:", err.message);
      });
    }

    // log("getRemotesCmd: END", {
    //   showName: show?.Name,
    //   remotesCount: remotes?.length,
    // });
    return remotes;
  } catch (err) {
    log("getRemotesCmd: ERROR", { error: err.message });
    throw new Error(`getRemotes error: ${err.message}`);
  }
};

export const debugTvdb = async (params) => {
  const { name, tvdbId } = params;

  if (!tvdbId) {
    throw new Error("debugTvdb: missing tvdbId");
  }

  try {
    log("debugTvdb: Fetching API data for", { name, tvdbId });

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

    log("debugTvdb: Saved API data to", samplePath);

    return {
      success: true,
      message: `Saved TVDB API data for "${name}" to ${samplePath}`,
      path: samplePath,
    };
  } catch (err) {
    log("err", "debugTvdb: ERROR", { error: err.message });
    throw new Error(`debugTvdb error: ${err.message}`);
  }
};

export const getActorPage = async (params) => {
  const actorName = params?.name || "";
  if (!actorName) {
    throw new Error("getActorPage: missing name");
  }

  const wikiUrl = `https://en.wikipedia.org/wiki/${actorName.replace(/\s+/g, "_")}`;

  try {
    // Search IMDb for the actor
    const searchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(actorName)}&s=nm`;
    const searchResp = await fetch(searchUrl);

    if (!searchResp.ok) {
      log("err", "getActorPage IMDb search failed:", searchResp.status);
      return wikiUrl;
    }

    const html = await searchResp.text();

    // Find all matches to check for exact name match
    // IMDb uses format: <a href="/name/nm1234567/?ref_=..."><h3 class="ipc-title__text">Actor Name</h3></a>
    let match;
    const allMatches = [];
    const globalRegex = new RegExp(
      `<a\\s+href="(/name/nm\\d+)/[^"]*"[^>]*>.*?<h3[^>]*>([^<]+)</h3>`,
      "gis",
    );

    while ((match = globalRegex.exec(html)) !== null) {
      allMatches.push({ url: match[1], name: match[2].trim() });
    }

    // Find exact match (case-insensitive)
    const exactMatch = allMatches.find(
      (m) => m.name.toLowerCase() === actorName.toLowerCase(),
    );

    if (exactMatch) {
      const actorUrl = `https://www.imdb.com${exactMatch.url}`;
      return actorUrl;
    }

    // No exact match found, return Wikipedia URL
    return wikiUrl;
  } catch (err) {
    log("err", "getActorPage error:", err.message);
    return wikiUrl;
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

  log("inf", `searchActorsInNonEmby found ${matchedShows.length} matches`);
  return matchedShows;
};

export const getAllTvdb = async (params) => {
  const hasEmby = params?.hasEmby ?? 0;

  // DEBUG Swiss Toni
  const swissToni = allTvdb["Swiss Toni"];
  if (swissToni) {
    console.log("[DEBUG getAllTvdb] Swiss Toni:", {
      notReady: swissToni.notReady,
      inEmby: swissToni.inEmby,
      fileGap: swissToni.fileGap,
      fileEndError: swissToni.fileEndError,
    });
  } else {
    console.log("[DEBUG getAllTvdb] Swiss Toni NOT FOUND in allTvdb");
  }

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
    await saveTvdbFiles(allTvdb);
  } catch (err) {
    log("err", "saveTvdbSync error:", err.message);
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
    log("err", "searchTvdbByImdbId: missing imdbId");
    return null;
  }

  // First check local tvdb.json for a match
  for (const [name, tvdb] of Object.entries(allTvdb)) {
    if (tvdb.imdbId === imdbId) {
      log(
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
      log(
        "err",
        `searchTvdbByImdbId: API search failed for ${imdbId}: ${res.status}`,
      );
      return null;
    }

    const data = await res.json();
    const series = data?.data?.[0];
    if (!series) {
      log("inf", `searchTvdbByImdbId: no results for ${imdbId}`);
      return null;
    }

    const tvdbId = series.tvdb_id || series.id;
    if (!tvdbId) {
      log("err", `searchTvdbByImdbId: no tvdbId in result for ${imdbId}`);
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
      log(
        "err",
        `searchTvdbByImdbId: extended fetch failed for ${tvdbId}: ${extRes.status}`,
      );
      return null;
    }

    const extResObj = await extRes.json();
    const extData = extResObj?.data;
    if (!extData) {
      log("err", `searchTvdbByImdbId: no extended data for ${tvdbId}`);
      return null;
    }

    // Build a tvdb-like object from the API response
    const image = getTvdbImageUrl(extResObj);
    const characters = getTvdbCharacters(extResObj);
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
      score: extData.score || null,
      originalCountry: extData.originalCountry || "",
      originalLanguage: extData.originalLanguage || "",
      originalNetwork: originalNetwork,
      averageRuntime: extData.averageRuntime || null,
      genres: extData.genres?.map((g) => g.name) || [],
      characters: characters,
      remotes: [], // Don't fetch remotes for preview
      inEmby: false,
      WaitStr: calculateWaitStr(nextAired, lastAired),
    };

    log(
      "inf",
      `searchTvdbByImdbId: fetched data for ${imdbId}: ${tvdbData.name}`,
    );
    return tvdbData;
  } catch (err) {
    log("err", `searchTvdbByImdbId: exception for ${imdbId}:`, err.message);
    return null;
  }
};

export const setTvdbFields = async (params) => {
  const paramObj = params;
  if (!paramObj) return null;
  let tvdb = null;
  const name = paramObj.name;
  if (name) {
    if (paramObj.$delTvdb) {
      delete allTvdb[name];
    } else {
      tvdb = allTvdb[name];
      if (!tvdb) {
        log("err", "setTvdbFields no tvdb for", name);
        return "no tvdb";
      }
      if (paramObj.$delete) {
        for (const delName of paramObj.$delete) delete tvdb[delName];
      }

      // Handle nested field updates for Phase 1 new structure
      for (const [key, value] of Object.entries(paramObj)) {
        if (key === "dontSave" || key === "$delete" || key === "name") continue;

        // Handle nested emby fields (e.g., inToTry, isFavorite)
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

      // Keep Emby button in sync with final inEmby/Id values (after field updates).
      if (!Array.isArray(tvdb.remotes)) tvdb.remotes = [];
      const embyIndex = tvdb.remotes.findIndex((r) => r?.name === "Emby");
      const embyId = tvdb?.Id == null ? "" : String(tvdb.Id).trim();
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

      setImdbId(tvdb);
      if (tvdb.saved === 0) {
        // Queue a refresh for this specific request
        const show = {
          Name: tvdb.Name,
          tvdbId: tvdb.tvdbId,
        };
        if (tvdb.Id) show.Id = tvdb.Id;
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
    await saveTvdbFiles(allTvdb);
  }
  // Queue a full per-show refresh (disk + gap) for changes that matter
  if (name && !paramObj.$delTvdb && !paramObj.dontEnqueue)
    enqueueShowProcess(name);
  return tvdb ?? "ok";
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
      log("accessTvdb: 401, refreshing token");
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
      log("accessTvdb: JSON parse error", {
        parseErr,
        bodyExcerpt: body.substring(0, 100),
      });
    }

    if (!upstream.ok) {
      log("accessTvdb: UPSTREAM ERROR", {
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
    log("accessTvdb error", { error: e.message, stack: e.stack, url });
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
    if (!tvdbRecord?.Id) continue;

    const showId = tvdbRecord.Id;
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
      tvdbRecord.seasonWatchedThenNofile !== gaps.seasonWatchedThenNofile;

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
      tvdbRecord.seasonWatchedThenNofile = gaps.seasonWatchedThenNofile;
      updatedCount++;
    }
  }

  if (processedCount > 0) {
    await saveTvdbSync();
    if (updatedCount > 0) {
      console.log(`[updateTvdbWithGapData] Updated ${updatedCount} shows`);
    }
  }

  return updatedCount;
};

// Export helper functions for migration and external use
export { seriesMapToWatchedEpis, applyWatchedEpisToSeriesMap, getSeriesMap };
