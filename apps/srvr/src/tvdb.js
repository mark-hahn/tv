import fs from "fs";
import * as path from "node:path";
import fetch from "node-fetch";
import WebSocket from "ws";
import * as urls from "./urls.js";
import { rottenSearch } from "./rotten.js";
import * as util from "./util.js";
import { SRVR_DATA_DIR } from "./srvrPaths.js";
import { MovieDb } from "moviedb-promise";
const { log, start, end } = util.getLog("tvdb");
const TVDB_PATH = path.join(SRVR_DATA_DIR, "tvdb.json");
const TVDB_TEMPLATE_PATH = path.join(SRVR_DATA_DIR, "tvdbTemplate.json");

const FAST_UPDATE = false;
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

const UPDATE_DATA = true;

let addToPickupsCallback = null;

let allTvdb = null;
try {
  allTvdb = util.jParse(fs.readFileSync(TVDB_PATH, "utf8"));
} catch {
  allTvdb = {};
  try {
    ensureDir(path.dirname(TVDB_PATH));
    fs.writeFileSync(TVDB_PATH, JSON.stringify(allTvdb), "utf8");
  } catch {}
}

// Phase 1: Backward compatibility migration - initialize new fields on existing records
let migrationNeeded = false;
for (const [name, tvdb] of Object.entries(allTvdb)) {
  let recordUpdated = false;

  if (!tvdb.emby) {
    tvdb.emby = {
      id: tvdb.showId || null,
      path: null,
      dateCreated: tvdb.added || null,
      premiereDate: null,
      inToTry: false,
      inContinue: false,
      inMark: false,
      inLinda: false,
      isFavorite: false,
      isPlayed: false,
      playCount: 0,
      lastPlayedDate: null,
    };
    recordUpdated = true;
  }

  if (!tvdb.disk) {
    tvdb.disk = { date: null, size: 0, noFiles: false };
    recordUpdated = true;
  }

  if (!tvdb.download) {
    tvdb.download = { status: null, lastCheck: null };
    recordUpdated = true;
  }

  if (!tvdb.tvmaze) {
    tvdb.tvmaze = { id: null, status: null };
    recordUpdated = true;
  }

  if (tvdb.gap === undefined) {
    tvdb.gap = null;
    recordUpdated = true;
  }

  if (tvdb.note === undefined) {
    tvdb.note = "";
    recordUpdated = true;
  }

  if (tvdb.reject === undefined) {
    tvdb.reject = false;
    recordUpdated = true;
  }

  if (tvdb.pickup === undefined) {
    tvdb.pickup = false;
    recordUpdated = true;
  }

  if (tvdb.lastViewed === undefined) {
    tvdb.lastViewed = null;
    recordUpdated = true;
  }

  if (tvdb.waitStr === undefined) {
    tvdb.waitStr = null;
    recordUpdated = true;
  }

  if (!tvdb.sync) {
    tvdb.sync = {
      lastEmbySync: null,
      lastDiskCheck: null,
      lastMetadataUpdate: tvdb.saved || null,
    };
    recordUpdated = true;
  }

  if (recordUpdated) {
    migrationNeeded = true;
  }
}

// Save migrated data if any records were updated
if (migrationNeeded) {
  log("Phase 1 migration: Saving updated tvdb.json with new schema fields");
  try {
    util.writeFile(TVDB_PATH, allTvdb);
  } catch (e) {
    log("err", "Phase 1 migration save failed:", e);
  }
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

// 5.3: Migrate noemby.json
const noembyPath = path.join(SRVR_DATA_DIR, "noemby.json");
if (fs.existsSync(noembyPath) && !fs.existsSync(noembyPath + ".backup")) {
  log("Phase 5.3: Migrating noemby.json into tvdb.json");
  try {
    const noembys = util.jParse(fs.readFileSync(noembyPath, "utf8"));
    let noembyCount = 0;

    for (const noembyShow of Object.values(noembys)) {
      const name = noembyShow.Name;
      if (!allTvdb[name]) {
        allTvdb[name] = {
          name,
          tvdbId: noembyShow.TvdbId || null,
          showId: noembyShow.Id, // already has "noemby-" prefix
          emby: {
            id: noembyShow.Id,
            path: null,
            dateCreated: noembyShow.added || null,
            premiereDate: null,
            inToTry: noembyShow.InToTry || false,
            inContinue: noembyShow.InContinue || false,
            inMark: noembyShow.InMark || false,
            inLinda: noembyShow.InLinda || false,
            isFavorite: false,
            isPlayed: false,
            playCount: 0,
            lastPlayedDate: null,
          },
          disk: { date: null, size: 0, noFiles: false },
          download: { status: null, lastCheck: null },
          tvmaze: { id: null, status: null },
          sync: {
            lastEmbySync: null,
            lastDiskCheck: null,
            lastMetadataUpdate: null,
          },
          gap: null,
          note: "",
          reject: false,
          pickup: false,
          lastViewed: null,
          waitStr: null,
          added: noembyShow.added || Date.now(),
          saved: 0, // Will trigger TVDB refresh
        };
        noembyCount++;
        phase5MigrationNeeded = true;
      }
    }

    log(`Phase 5.3: Migrated ${noembyCount} noemby shows into tvdb.json`);
    fs.renameSync(noembyPath, noembyPath + ".backup");
  } catch (e) {
    log("err", "Phase 5.3: noemby.json migration failed:", e);
  }
}

// 5.4: Migrate lastViewed.json
const lastViewedPath = path.join(SRVR_DATA_DIR, "lastViewed.json");
if (
  fs.existsSync(lastViewedPath) &&
  !fs.existsSync(lastViewedPath + ".backup")
) {
  log("Phase 5.4: Migrating lastViewed.json into tvdb.json");
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
      `Phase 5.4: Migrated ${viewedCount} lastViewed timestamps into tvdb.json`,
    );
    fs.renameSync(lastViewedPath, lastViewedPath + ".backup");
  } catch (e) {
    log("err", "Phase 5.4: lastViewed.json migration failed:", e);
  }
}

// Save Phase 5 migrations
if (phase5MigrationNeeded) {
  log("Phase 5: Saving tvdb.json with migrated data from separate files");
  try {
    util.writeFile(TVDB_PATH, allTvdb);
    log("Phase 5: Migration complete - backup files created");
  } catch (e) {
    log("err", "Phase 5: Migration save failed:", e);
  }
}

///////////// get theTvdbToken //////////////
// this is a duplicate of the client
// both access tvdb.com independently

// Use shared getToken() instead of maintaining separate theTvdbToken
// const getTheTvdbToken = async () => {
//   await getToken();
// };

///////////////////// GET REMOTES ///////////////////////

let cacheName = null;
let cacheJson;

const imdbFetchHeaders = {
  // IMDb commonly returns HTTP 202 with an empty body to non-browser requests.
  // A realistic UA + accept headers consistently yields normal HTML.
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

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

const getUrlAndRatings = async (type, url, name) => {
  // log('getUrlAndRatings', {type, url, name});

  const fetchWithTimeout = async (u, o) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);
    try {
      return await fetch(u, { ...o, signal: controller.signal });
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Request timed out");
      throw e;
    } finally {
      clearTimeout(id);
    }
  };

  let html, json;

  if ((type == 18 || type == 7) && cacheName === name) json = cacheJson;
  else {
    const fetchOpts =
      +type === 2
        ? { headers: imdbFetchHeaders, redirect: "follow" }
        : undefined;

    let resp;
    try {
      resp = await fetchWithTimeout(url, fetchOpts);
    } catch (e) {
      log(
        "err",
        `getUrlAndRatings fetch error: ${JSON.stringify({
          type,
          url,
          name,
        })}, ${e.message}`,
      );
      return null;
    }

    if (!resp.ok) {
      log(
        "err",
        `getUrlAndRatings fetch error: ${JSON.stringify({
          type,
          url,
          name,
        })}, ${resp.status}`,
      );
      return null;
    }
    if (type == 18 || type == 7) json = await resp.json();
    else {
      html = await resp.text();

      // IMDb bot mitigation can manifest as 202 + empty body.
      if (+type === 2 && (!html || html.length === 0 || resp.status === 202)) {
        try {
          resp = await fetchWithTimeout(url, fetchOpts);
          html = await resp.text();
        } catch (e) {
          log("err", `getUrlAndRatings retry error: ${e.message}`);
          return null;
        }
      }

      html = (html || "").replaceAll(/\r?\n/gm, "").replaceAll(/\s+/gm, " ");
    }
  }

  if (type == 18 || type == 7) {
    cacheName = name;
    cacheJson = json;
  } else cacheName = null;

  let idFnameParam;
  switch (+type) {
    case 2: // log('samples/imdb-page.html'); // IMDB
    // await util.writeFile("samples/imdb-page.html", html);
    {
      const rating = extractImdbRating(html);
      if (!rating) return { ratings: null };
      return { ratings: rating };
    }

    case 7: {
      // reddit
      // fs.writeFileSync(`samples/reddit-${name}.json`,
      //                   JSON.stringify(json, null, 2));
      const allItems = Object.values(json.items || {});
      const redditItems = allItems.filter(
        (item) => item.displayLink == "www.reddit.com",
      );
      if (!redditItems || redditItems.length === 0) return null;
      // for(const item of redditItems) {
      //   log("redditItem:", name, item.link);
      // }
      return { url: redditItems[0].link };
    }

    case 18: {
      // wikipedia
      // fs.writeFileSync(`samples/google-${name}.json`,
      //                   JSON.stringify(json, null, 2));
      const items = Object.values(json.items || {});
      const wikiItem = items.find(
        (item) => item.displayLink == "en.wikipedia.org",
      );
      if (!wikiItem) return null;
      // log("wikiItem:", name, wikiItem.link);
      return { url: wikiItem.link };
    }

    default:
      return "getUrlAndRatings invalid type: " + type;
  }
};

///////////// get remote (name, url, & ratings) //////////////

const getRemote = async (id, type, showName) => {
  let url = null;
  let ratings = null;
  let urlRatings, name, escShow;

  switch (type) {
    case 2:
      name = "IMDB";
      url = `https://www.imdb.com/title/${id}`;
      urlRatings = await getUrlAndRatings(2, url, name);
      ratings = urlRatings?.ratings;
      break;

    case 4:
      name = "Official Website";
      url = id;
      break;

    case 7:
      name = "Reddit";
      escShow = encodeURIComponent(showName);
      urlRatings = await getUrlAndRatings(
        7,
        `https://www.googleapis.com/customsearch/v1?` +
          `key=AIzaSyDSdr8Z26vDP4V5J_sEyXCH4s8O56FyfDc&` +
          `cx=b59f40d0c17b54ff1&q=${escShow}%20tv%20show`,
        showName,
      );
      url = urlRatings?.url;
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
      escShow = encodeURIComponent(showName);
      urlRatings = await getUrlAndRatings(
        18,
        `https://www.googleapis.com/customsearch/v1?` +
          `key=AIzaSyDSdr8Z26vDP4V5J_sEyXCH4s8O56FyfDc&` +
          `cx=b59f40d0c17b54ff1&q=${escShow}%20tv%20show`,
        showName,
      );
      url = urlRatings?.url;
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
    log(`getRemote, no url: ${name}`);
    return null;
  }
  // console.log(`getRemote`, { name, url, ratings });
  return { name, url, ratings };
};

///////////// get remotes  //////////////
// use tvdb remotes data to find complete remote data

const remotesCache = new Map();

const getRemotes = async (
  show,
  tvdbRemotes,
  fast = false,
  clientRequest = false,
) => {
  const cacheKey =
    show.Name +
    "|" +
    show.Id +
    "|" +
    JSON.stringify(tvdbRemotes || {}) +
    "|" +
    fast +
    "|" +
    clientRequest;

  if (clientRequest && remotesCache.has(cacheKey)) {
    return remotesCache.get(cacheKey);
  }

  const name = show.Name;
  const showId = show.Id;
  const remotes = [];

  if (showId && !showId.startsWith("noemby-"))
    remotes.push({ name: "Emby", url: urls.embyPageUrl(showId) });

  if (!fast) {
    if (clientRequest) {
      let rottenFound = false;
      const cachedShow = allTvdb ? allTvdb[name] : null;
      if (cachedShow && cachedShow.remotes) {
        const cachedRotten = cachedShow.remotes.find(
          (r) => r.name && r.name.startsWith("Rotten"),
        );
        if (cachedRotten) {
          remotes.push(cachedRotten);
          rottenFound = true;
        }
      }

      if (!rottenFound) {
        // basic link construction
        const cleanName = name
          .trim()
          .toLowerCase()
          .replace(/['":.,!]/g, "")
          .replace(/\s+/g, "_");
        const url = `https://www.rottentomatoes.com/tv/${cleanName}`;
        remotes.push({ name: "Rotten", url });
      }
    } else {
      const rottenRemote = await getRemote(null, 99, name);
      if (rottenRemote) {
        if (rottenRemote.ratings)
          rottenRemote.name += " (" + rottenRemote.ratings + ")";
        remotes.push(rottenRemote);
      }
    }
  }
  const encoded = encodeURI(name).replaceAll("&", "%26");
  const url = `https://www.google.com/search` + `?q=${encoded}%20tv%20show`;
  remotes.push({ name: "Google", url });

  const wikiRemote = await getRemote(null, 18, name);
  if (wikiRemote) remotes.push({ name: "Wikipedia", url: wikiRemote.url });

  const redditRemote = await getRemote(null, 7, name);
  if (redditRemote) remotes.push({ name: "Reddit", url: redditRemote.url });

  const remotesByName = {};
  for (const tvdbRemote of tvdbRemotes) {
    if (tvdbRemote.type == 18) continue;
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

  const imdbRemote = remotesByName["IMDB"];
  if (imdbRemote) {
    imdbRemote.name += imdbRemote.ratings
      ? " (" + imdbRemote.ratings + ")"
      : "";
    remotes.push(imdbRemote);
  }

  for (const [name, remote] of Object.entries(remotesByName)) {
    if (name !== "IMDB" && name !== "Rotten") remotes.push(remote);
  }

  // console.log("getRemotes result:", JSON.stringify(remotes, null, 2));

  remotesCache.set(cacheKey, remotes);
  if (remotesCache.size > 100) {
    const firstKey = remotesCache.keys().next().value;
    remotesCache.delete(firstKey);
  }

  return remotes;
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
const getTvdbData = async (paramObj, resolve, _reject) => {
  const {
    show,
    deleted,
    seasonCount,
    episodeCount,
    watchedCount,
    clientRequest,
  } = paramObj;
  const name = show.Name;
  log("getTvdbData: START", { name, clientRequest });
  const added = allTvdb[name]?.added ?? new Date().toISOString().slice(0, 10);
  if (deleted) {
    // this shouldn't happen, deleteds filter before here
    log("getTvdbData:", name, "is deleted, skipping tvDb refresh");
    resolve(name);
    return;
  }
  const showId = show.Id;
  const tvdbId = show.TvdbId;
  if (!tvdbId) {
    log("err", "getTvdbData no tvdbId:", show);
    resolve(name);
    return;
  }
  let extRes, extUrl;
  try {
    extUrl = `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
    const token = await getToken();
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
  const {
    firstAired,
    lastAired: lastAiredIn,
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
  let originalNetwork = originalNetworkIn?.name ?? "";
  const status = statusIn.name; // e.g. Ended

  // get remote data, e.g. IMDB for tvdb record
  // remoteIds come from tvdb
  // Skip slow remote fetching for client requests - client will fetch separately if needed
  const remotes = clientRequest
    ? []
    : await getRemotes(show, remoteIds, false, false);
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

  // Check if we need TMDB fallback for missing fields
  const needsTmdb = !image || !overview || !firstAired || !status;
  let tmdbData = null;
  if (needsTmdb) {
    log("Fetching TMDB fallback for", name);
    tmdbData = await getTmdbFallback(name);
  }

  // Preserve existing non-empty values when API returns empty
  const existing = allTvdb[name] || {};
  const preserve = (newVal, existingVal, tmdbVal) => {
    if (newVal !== undefined && newVal !== null && newVal !== "") return newVal;
    if (existingVal !== undefined && existingVal !== null && existingVal !== "")
      return existingVal;
    if (tmdbVal !== undefined && tmdbVal !== null && tmdbVal !== "")
      return tmdbVal;
    return newVal;
  };

  let tvdbData = {
    tvdbId,
    name,
    originalNetwork: preserve(
      originalNetwork,
      existing.originalNetwork,
      tmdbData?.originalNetwork,
    ),
    seasonCount,
    episodeCount,
    watchedCount,
    image: preserve(image, existing.image, tmdbData?.image),
    score: preserve(score, existing.score, tmdbData?.score),
    overview: preserve(overview, existing.overview, tmdbData?.overview),
    firstAired: preserve(firstAired, existing.firstAired, tmdbData?.firstAired),
    lastAired: preserve(lastAired, existing.lastAired, tmdbData?.lastAired),
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
    remotes, // Don't preserve arrays - they accumulate
    characters, // Don't preserve arrays - they accumulate
    added,
    saved,
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

  if (trailers) tvdbData.trailers = trailers;
  if (showId !== undefined) tvdbData.showId = showId;
  if (deleted !== undefined) tvdbData.deleted = deleted;

  // NEW: Emby-specific data (preserve from paramObj or existing)
  tvdbData.emby = {
    id: showId || existing.emby?.id || null,
    path: paramObj.embyPath || existing.emby?.path || null,
    dateCreated: paramObj.dateCreated || existing.emby?.dateCreated || null,
    premiereDate: paramObj.premiereDate || existing.emby?.premiereDate || null,
    inToTry: paramObj.inToTry ?? existing.emby?.inToTry ?? false,
    inContinue: paramObj.inContinue ?? existing.emby?.inContinue ?? false,
    inMark: paramObj.inMark ?? existing.emby?.inMark ?? false,
    inLinda: paramObj.inLinda ?? existing.emby?.inLinda ?? false,
    isFavorite: paramObj.isFavorite ?? existing.emby?.isFavorite ?? false,
    isPlayed: paramObj.isPlayed ?? existing.emby?.isPlayed ?? false,
    playCount: paramObj.playCount ?? existing.emby?.playCount ?? 0,
    lastPlayedDate:
      paramObj.lastPlayedDate || existing.emby?.lastPlayedDate || null,
  };

  // NEW: Disk/filesystem data (preserve from paramObj or existing)
  tvdbData.disk = {
    date: paramObj.diskDate || existing.disk?.date || null,
    size: paramObj.diskSize ?? existing.disk?.size ?? 0,
    noFiles: paramObj.noFiles ?? existing.disk?.noFiles ?? false,
  };

  // NEW: Download tracking summary (preserve from paramObj or existing)
  tvdbData.download = {
    status: paramObj.downloadStatus || existing.download?.status || null,
    lastCheck:
      paramObj.downloadLastCheck || existing.download?.lastCheck || null,
  };

  // NEW: TVMaze reference (preserve from paramObj or existing)
  tvdbData.tvmaze = {
    id: paramObj.tvmazeId || existing.tvmaze?.id || null,
    status: paramObj.tvmazeStatus || existing.tvmaze?.status || null,
  };

  // NEW: Gap tracking (preserve from paramObj or existing)
  tvdbData.gap = paramObj.gap || existing.gap || null;

  // NEW: Notes (preserve from paramObj or existing)
  tvdbData.note = paramObj.note ?? existing.note ?? "";

  // NEW: Additional flags (preserve from paramObj or existing)
  tvdbData.reject = paramObj.reject ?? existing.reject ?? false;
  tvdbData.pickup = paramObj.pickup ?? existing.pickup ?? false;
  tvdbData.lastViewed = paramObj.lastViewed || existing.lastViewed || null;
  tvdbData.waitStr = paramObj.waitStr || existing.waitStr || null;

  // NEW: Sync timestamps (preserve from paramObj or existing)
  tvdbData.sync = {
    lastEmbySync: paramObj.lastEmbySync || existing.sync?.lastEmbySync || null,
    lastDiskCheck:
      paramObj.lastDiskCheck || existing.sync?.lastDiskCheck || null,
    lastMetadataUpdate: Date.now(),
  };

  setImdbId(tvdbData);

  // log('getTvdbData:', tvdbData);
  allTvdb[name] = tvdbData;
  // update allTvdb & tvdb.json
  log("getTvdbData: END", { name, hasRemotes: !!tvdbData.remotes?.length });
  resolve(tvdbData);
};

/////////  GET/UPDATE TVDB FOR WEB AND LOCAL //////
// each tvdb request from web waits in queue
// every result updates json file tvdb.json
const newTvdbQueue = [];
let chkTvdbQueueRunning = false;

const chkTvdbQueue = () => {
  if (chkTvdbQueueRunning || newTvdbQueue.length == 0) return;
  chkTvdbQueueRunning = true;
  const { ws, id, paramObj, resolve: resolveCb } = newTvdbQueue.pop();
  const showName = paramObj.show?.Name;
  log("chkTvdbQueue: processing", {
    id,
    showName,
    queueLength: newTvdbQueue.length,
  });

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
  promise.then((tvdbData) => {
    try {
      if (typeof tvdbData === "object") {
        log("chkTvdbQueue: sending response", { id, name: tvdbData.name });
        if (ws) ws.send(JSON.stringify({ id, status: "ok", data: tvdbData }));
        else if (resolveCb) resolveCb(tvdbData);
        allTvdb[tvdbData.name] = tvdbData;
      } else tvdbData = allTvdb[tvdbData]; // tvdbData is name
    } catch (e) {
      console.error("chkTvdbQueue ws.send error:", e);
    }
    tvdbData.saved = Date.now();
    // Don't save here - background refresh handles saves
    log("chkTvdbQueue: completed", { id, name: tvdbData.name });
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
const tryLocalGetTvdb = () => {
  if (tryLocalGetTvdbBusy) return;
  tryLocalGetTvdbBusy = true;

  // find show with oldest save date
  let minSaved = Math.min();
  let minTvdb = null;
  try {
    const tvdbs = Object.values(allTvdb);
    tvdbs.forEach((tvdb) => {
      if (tvdb.deleted) return;
      if (!tvdb.showId) {
        log("err", "tryLocalGetTvdb no showId and not deleted:", tvdb.name, {
          tvdb,
        });
        return;
      }
      const saved = tvdb.saved;
      if (saved === undefined) {
        log("tryLocalGetTvdb, saved is undefined:", tvdb.name);
        minTvdb = tvdb;
        throw true;
      }
      if (saved < minSaved) {
        minSaved = saved;
        minTvdb = tvdb;
      }
    });
  } catch (e) {}
  if (minTvdb === null) {
    log(
      "err",
      new Date().toTimeString().slice(0, 8),
      `tryLocalGetTvdbBusy, minTvdb is null`,
    );
    tryLocalGetTvdbBusy = false;
    return;
  }

  // Check if show should be added to pickup list:
  // - not in emby (showId starts with 'noemby-' or undefined)
  // - has tvdb data (minTvdb exists)
  // - not deleted
  if (minTvdb && !minTvdb.deleted) {
    const showId = minTvdb.showId;
    const notInEmby = !showId || showId.startsWith("noemby-");
    if (notInEmby && addToPickupsCallback) {
      addToPickupsCallback(minTvdb.name);
    }
  }

  // log('------', new Date().toTimeString().slice(0,8),
  //             `updating tvdb locally:`, minTvdb.name);
  const show = {
    Name: minTvdb.name,
    TvdbId: minTvdb.tvdbId,
  };
  if (minTvdb.showId) show.Id = minTvdb.showId;
  const paramObj = {
    show,
    seasonCount: minTvdb.seasonCount ?? 0,
    episodeCount: minTvdb.episodeCount ?? 0,
    watchedCount: minTvdb.watchedCount ?? 0,
    deleted: minTvdb.deleted,
  };
  newTvdbQueue.unshift({ ws: null, id: null, paramObj });
  chkTvdbQueue();
  tryLocalGetTvdbBusy = false;
};

// calls tryLocalGetTvdb every 6 mins
const updateTvdbLocal = () => {
  // wait for token
  if (UPDATE_DATA) tryLocalGetTvdb();
  const delay = FAST_UPDATE ? 30 * 1000 : 6 * 60 * 1000;
  setTimeout(updateTvdbLocal, delay);
};
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
  log("getRemotesCmd: START", { showName: show?.Name, fast });

  if (!show) {
    throw new Error("getRemotes: missing show");
  }

  try {
    const remotes = await getRemotes(show, tvdbRemotes, fast, true);
    log("getRemotesCmd: END", {
      showName: show?.Name,
      remotesCount: remotes?.length,
    });
    return remotes;
  } catch (err) {
    log("getRemotesCmd: ERROR", { error: err.message });
    throw new Error(`getRemotes error: ${err.message}`);
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

export const getAllTvdb = async (_params) => {
  return allTvdb;
};

// Synchronous access for background sync functions
export const getAllTvdbSync = () => allTvdb;

export const saveTvdbSync = async () => {
  return new Promise((resolve, reject) => {
    fs.writeFile(TVDB_PATH, JSON.stringify(allTvdb), (err) => {
      if (err) {
        log("err", "saveTvdbSync error:", err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

// if tvdb already exists replace it
export const getNewTvdb = async (params) => {
  if (!params) throw new Error("getNewTvdb: missing params");

  // HTTP requests are always client requests - mark to skip slow remote fetching
  params.clientRequest = true;

  const showName = params.show?.Name;
  log("getNewTvdb called:", {
    showName,
    queueLength: newTvdbQueue.length,
    clientRequest: params.clientRequest,
  });

  return new Promise((resolve, reject) => {
    // Queue the request with appropriate callback
    newTvdbQueue.unshift({ ws: null, id: null, paramObj: params, resolve });
    chkTvdbQueue();
  });
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
      setImdbId(tvdb);
      if (tvdb.saved === 0) {
        // Queue a refresh for this specific request
        const show = {
          Name: tvdb.name,
          TvdbId: tvdb.tvdbId,
        };
        if (tvdb.showId) show.Id = tvdb.showId;
        const refreshParamObj = {
          show,
          seasonCount: tvdb.seasonCount ?? 0,
          episodeCount: tvdb.episodeCount ?? 0,
          watchedCount: tvdb.watchedCount ?? 0,
          deleted: tvdb.deleted,
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
  if (!paramObj.dontSave) await util.writeFile(TVDB_PATH, allTvdb);
  return tvdb ?? "ok";
};

export const accessTvdb = async (params) => {
  try {
    const paramObj = params;
    if (!paramObj) throw new Error("invalid params");
    const { path: tvdbPath, query } = paramObj;
    log("accessTvdb: START", { tvdbPath });

    const url = buildTvdbUrl(tvdbPath, query);
    let token = await getToken();

    let upstream = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (upstream.status === 401) {
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
    } catch {}

    log("accessTvdb: END", { ok: upstream.ok, status: upstream.status });
    return {
      ok: upstream.ok,
      status: upstream.status,
      data,
    };
  } catch (e) {
    log("accessTvdb error", e);
    // Return error structure for robustness
    return { ok: false, status: 500, error: e.message };
  }
};
