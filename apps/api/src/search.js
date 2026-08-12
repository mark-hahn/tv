// Torrent search logic
import fs from "fs";
import path from "path";
import { normalize } from "./normalize.js";
import { getApiDataDir } from "./tvPaths.js";
import { patchProviderWithSshTunnel } from "./sshTunnel.js";

import TorrentSearchApi from "torrent-search-api";
import os from "os";
import { unilog } from "@tv/share";

// When true and the show name contains a year, TPB/LIM/EZT are first searched with the
// year included. If that yields >20 results the no-year search is skipped; otherwise
// both sets of results are combined.
const ALWAYS_DO_BOTH_SEARCHES = true;

// Per-provider fetch timeout for public providers
const PROVIDER_TIMEOUT_MS = 90_000;

// TV category codes returned by apibay (205=SD, 207=SD-episodes, 208=HD-TV, 212=UHD)
const TPB_TV_CATEGORIES = new Set(["202", "205", "207", "208", "212"]);

// Movie category codes returned by apibay (201=Movies, 202=DVDR, 207=HD, 209=3D, 211=DVDR)
const TPB_MOVIE_CATEGORIES = new Set(["201", "202", "207", "209", "211"]);

// Race a promise against a timeout; rejects with a descriptive error on timeout
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Direct apibay (ThePirateBay) search. movie=true searches cat=200 and keeps
// movie categories; otherwise TV categories. Returns null on failure (HTTP
// error, bad JSON, network error) so callers can tell an outage from zero
// results.
async function searchTpbApibay(query, limit = 100, { movie = false } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    const res = await fetch(
      `https://apibay.org/q.php?q=${encodeURIComponent(query)}${movie ? "&cat=200" : ""}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) {
      unilog(169, `apibay HTTP ${res.status} for "${query}"`);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) {
      unilog(170, `apibay non-array response for "${query}"`);
      return null;
    }
    const categories = movie ? TPB_MOVIE_CATEGORIES : TPB_TV_CATEGORIES;
    const real = data.filter((r) => String(r.id) !== "0");
    const matched = real.filter((r) =>
      categories.has(String(r.category ?? "")),
    );
    return matched.slice(0, limit).map((r) => ({
      provider: "ThePirateBay",
      id: r.id,
      title: r.name,
      size: Number(r.size),
      seeds: Number(r.seeders),
      peers: Number(r.leechers),
      time: new Date(Number(r.added) * 1000).toISOString(),
      magnet: `magnet:?xt=urn:btih:${r.info_hash}&dn=${encodeURIComponent(r.name)}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce`,
      category: r.category,
    }));
  } catch (e) {
    unilog(171, `failed for "${query}": ${e.message}`);
    return null;
  }
}

// Provider code mapping for stats display
const PROVIDER_CODE_MAP = {
  IpTorrents: "IPT",
  TorrentLeech: "TL",
  ThePirateBay: "TPB",
  Limetorrents: "LIM",
  Eztv: "EZT",
};

function getProviderCode(provider) {
  const raw = String(provider || "").trim();
  return (
    PROVIDER_CODE_MAP[raw] ||
    PROVIDER_CODE_MAP[
      Object.keys(PROVIDER_CODE_MAP).find(
        (k) => k.toLowerCase() === raw.toLowerCase(),
      )
    ] ||
    raw
  );
}

const DATA_DIR = getApiDataDir();

// IPT/TL results from the base search are cached in a tmp file so the
// follow-up more=true search (which runs in a fresh forked process) can
// combine them with the extra-provider results without re-searching IPT/TL.
const IPTL_CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function iptTlCacheFilePath(showName, seasons = []) {
  const safe = String(showName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .slice(0, 80);
  const seasonPart = seasons.length
    ? `-s${seasons.map((s) => String(s).padStart(2, "0")).join("_")}`
    : "";
  return path.join(os.tmpdir(), `tor-iptl-cache-${safe}${seasonPart}.json`);
}

function writeIptTlCache(showName, results, seasons = []) {
  try {
    fs.writeFileSync(
      iptTlCacheFilePath(showName, seasons),
      JSON.stringify(results),
      "utf8",
    );
  } catch {
    // ignore
  }
}

function readIptTlCache(showName, seasons = []) {
  try {
    const p = iptTlCacheFilePath(showName, seasons);
    if (Date.now() - fs.statSync(p).mtimeMs > IPTL_CACHE_MAX_AGE_MS) return [];
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const COOKIES_DIR = DATA_DIR;
const IPTORRENTS_CUSTOM_PATH = path.join(DATA_DIR, "iptorrents-custom.json");

function formatActiveProviders(activeProviders) {
  const arr = Array.isArray(activeProviders) ? activeProviders : [];
  return arr
    .map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object") {
        if (typeof p.name === "string" && p.name.trim()) return p.name.trim();
        if (typeof p.provider === "string" && p.provider.trim())
          return p.provider.trim();
      }
      return String(p);
    })
    .filter(Boolean);
}

function addTorrentWarning(torrent, code, message) {
  if (!torrent || typeof torrent !== "object") return;
  if (!Array.isArray(torrent.warnings)) torrent.warnings = [];
  const c = String(code || "").trim();
  if (!c) return;
  if (torrent.warnings.some((w) => w && w.code === c)) return;
  torrent.warnings.push({ code: c, message: String(message || "").trim() });
}

function computeWarningSummary(torrents) {
  const summary = {};
  for (const t of torrents || []) {
    const ws = Array.isArray(t?.warnings) ? t.warnings : [];
    for (const w of ws) {
      const code = String(w?.code || "").trim();
      if (!code) continue;
      summary[code] = (summary[code] || 0) + 1;
    }
  }
  return summary;
}

// Season-pack selection shared by the noemby and loadall modes: keep all
// complete-series torrents and season packs; for seasons without a season
// pack keep the episode torrents; for season 1 also keep the E01 episodes.
function selectSeasonPackTorrents(torrents) {
  const seasonsByNumber = {};
  const completeSeriesTorrents = [];

  for (const torrent of torrents) {
    if (torrent.completeSeries) {
      completeSeriesTorrents.push(torrent);
      continue;
    }
    const season = torrent.parsed.season;
    if (season === undefined || season === null) continue;

    if (!seasonsByNumber[season]) {
      seasonsByNumber[season] = { seasonTorrents: [], episodeTorrents: [] };
    }

    if (
      torrent.parsed.episode === undefined ||
      torrent.parsed.episode === null
    ) {
      seasonsByNumber[season].seasonTorrents.push(torrent);
    } else {
      seasonsByNumber[season].episodeTorrents.push(torrent);
    }
  }

  const selected = [...completeSeriesTorrents];
  Object.keys(seasonsByNumber)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((seasonNum) => {
      const seasonData = seasonsByNumber[seasonNum];
      if (seasonData.seasonTorrents.length > 0) {
        selected.push(...seasonData.seasonTorrents);

        // Exception: for season 1, also include episode 1 torrents
        if (Number(seasonNum) === 1) {
          selected.push(
            ...seasonData.episodeTorrents.filter((t) => t.parsed.episode === 1),
          );
        }
      } else {
        // No season torrents, include all episode torrents
        selected.push(...seasonData.episodeTorrents);
      }
    });

  return selected;
}

// Load cookies from files
function loadCookiesArray(filename) {
  const filepath = path.join(COOKIES_DIR, filename);
  if (fs.existsSync(filepath)) {
    try {
      const cookiesJson = JSON.parse(fs.readFileSync(filepath, "utf8"));
      // Convert Playwright cookie format to cookie string array
      return cookiesJson.map((cookie) => `${cookie.name}=${cookie.value}`);
    } catch {
      return null;
    }
  }
  return null;
}

function loadCookiesFromCurl(filename) {
  try {
    const p = path.join(DATA_DIR, filename);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");

    // Match -H 'Cookie: ...' or -H "Cookie: ..." or -b '...'
    // Note: curl-ipt.txt format seen previously: -H 'Cookie: ...'
    let cookieStr = "";

    // Try Cookie header
    const mH = raw.match(/-H\s+['"]Cookie:\s*([^'"]+)['"]/i);
    if (mH) {
      cookieStr = mH[1];
    } else {
      // Try -b
      const mB = raw.match(/-b\s+['"]([^'"]+)['"]/i);
      if (mB) cookieStr = mB[1];
    }

    if (!cookieStr) return null;

    return cookieStr
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

// Parse size string to bytes for comparison
function parseSizeToBytes(sizeStr) {
  if (!sizeStr) return 0;
  if (typeof sizeStr === "number") return sizeStr;

  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|GiB|MiB|KiB|TB|TiB)?$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();

  const multipliers = {
    B: 1,
    KB: 1024,
    KIB: 1024,
    MB: 1024 * 1024,
    MIB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    GIB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
    TIB: 1024 * 1024 * 1024 * 1024,
  };

  return value * (multipliers[unit] || 1);
}

function getIPTorrentsUserAgent() {
  // 1. Try curl-ipt.txt. NO FALLBACKS.
  try {
    const p = path.join(DATA_DIR, "curl-ipt.txt");
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      const m = raw.match(/-H\s+['"]User-Agent:\s*([^'"]+)['"]/i);
      if (m && m[1]) return m[1];
    }
  } catch {}
  return null;
}

// Initialize providers
let iptCookies = null;
let tlCookies = null;

export function initializeProviders() {
  // Use authoritative curl files. No fallbacks.
  iptCookies = loadCookiesFromCurl("curl-ipt.txt");
  tlCookies = loadCookiesFromCurl("curl-tl.txt");

  // Warn if missing (effectively failing initialization for that provider)
  if (!iptCookies) unilog(176, "IPTorrents disabled: (curl-ipt.txt missing)");
  if (!tlCookies) unilog(177, "TorrentLeech disabled: (curl-tl.txt missing)");

  if (iptCookies) {
    try {
      // Prefer custom provider config when present; otherwise fall back to built-in.
      if (fs.existsSync(IPTORRENTS_CUSTOM_PATH)) {
        TorrentSearchApi.removeProvider("IpTorrents");
        const customIptConfig = JSON.parse(
          fs.readFileSync(IPTORRENTS_CUSTOM_PATH, "utf8"),
        );

        // Force User-Agent from curl-ipt.txt if available
        const ua = getIPTorrentsUserAgent();
        if (ua) {
          customIptConfig.headers = {
            ...(customIptConfig.headers || {}),
            "User-Agent": ua,
          };
        }

        TorrentSearchApi.loadProvider(customIptConfig);
      } else {
        unilog(
          178,
          `IPTorrents custom config missing: ${IPTORRENTS_CUSTOM_PATH} (using default provider config)`,
        );
      }
      TorrentSearchApi.enableProvider("IpTorrents", iptCookies);
      patchProviderWithSshTunnel(TorrentSearchApi.getProvider("IpTorrents"));
    } catch (e) {
      unilog(179, "Failed to enable IPTorrents:", e.message);
    }
  }

  if (tlCookies) {
    try {
      TorrentSearchApi.enableProvider("TorrentLeech", tlCookies);
      patchProviderWithSshTunnel(TorrentSearchApi.getProvider("TorrentLeech"));
    } catch (e) {
      unilog(180, "Failed to enable TorrentLeech:", e.message);
    }
  }

  // Enable public providers (no authentication needed)
  try {
    TorrentSearchApi.enableProvider("ThePirateBay");
  } catch (e) {
    unilog(181, "Failed to enable ThePirateBay:", e.message);
  }
  try {
    TorrentSearchApi.enableProvider("Limetorrents");
  } catch (e) {
    unilog(182, "Failed to enable Limetorrents:", e.message);
  }
  try {
    TorrentSearchApi.enableProvider("Eztv");
  } catch (e) {
    unilog(183, "Failed to enable Eztv:", e.message);
  }
}

/**
 * Search for torrents
 * @param {Object} params - Search parameters
 * @param {string} params.showName - Name of the show to search for
 * @param {number} params.limit - Maximum number of results
 * @param {string} params.iptCf - Optional IPTorrents cf_clearance override
 * @param {string} params.tlCf - Optional TorrentLeech cf_clearance override
 * @param {Array} params.needed - Optional array of needed episodes (e.g., ["S01", "S02E03"])
 * @param {boolean} params.more - If true, add TPB/LIM/EZT results on top of cached IPT/TL results
 * @param {number|string} params.season - Optional season number; restricts the provider
 *   queries to that season (TV only) and disables the `needed` filtering
 * @returns {Object} Search results with torrents array
 */
export async function searchTorrents({
  showName,
  limit = 1000,
  iptCf,
  tlCf,
  needed = [],
  more = false,
  staged = false,
  category = "tv",
  seasons = [],
}) {
  const activeProvidersRaw = TorrentSearchApi.getActiveProviders();
  const activeProviders = formatActiveProviders(activeProvidersRaw);
  unilog(184, `\nSearching for: ${showName} (limit: ${limit})`);
  unilog(185, "Enabled providers:", activeProviders.join(", "));

  const sanitizeForProviderSearch = (name) => {
    return String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // Override cookies if cf_clearance provided. The originals are never
  // restored — this only stays contained because each search runs in its own
  // forked process (search-worker.js).
  const iptCookiesForSearch = iptCookies ? [...iptCookies] : [];
  const tlCookiesForSearch = tlCookies ? [...tlCookies] : [];

  if (iptCf) {
    // Remove existing cf_clearance and add new one
    const filtered = iptCookiesForSearch.filter(
      (c) => !c.startsWith("cf_clearance="),
    );
    filtered.push(`cf_clearance=${iptCf}`);
    try {
      if (fs.existsSync(IPTORRENTS_CUSTOM_PATH)) {
        TorrentSearchApi.removeProvider("IpTorrents");
        const customIptConfig = JSON.parse(
          fs.readFileSync(IPTORRENTS_CUSTOM_PATH, "utf8"),
        );

        // Force User-Agent from curl-ipt.txt if available
        const ua = getIPTorrentsUserAgent();
        if (ua) {
          customIptConfig.headers = {
            ...(customIptConfig.headers || {}),
            "User-Agent": ua,
          };
        }

        TorrentSearchApi.loadProvider(customIptConfig);
      } else {
        unilog(
          186,
          `IPTorrents custom config missing: ${IPTORRENTS_CUSTOM_PATH} (cf_clearance override will use default provider config)`,
        );
      }
      TorrentSearchApi.enableProvider("IpTorrents", filtered);
      patchProviderWithSshTunnel(TorrentSearchApi.getProvider("IpTorrents"));
      unilog(187, "Using provided IPTorrents cf_clearance");
    } catch (e) {
      unilog(
        188,
        "Failed to apply IPTorrents cf_clearance override:",
        e.message,
      );
    }
  }

  if (tlCf) {
    // Remove existing cf_clearance and add new one
    const filtered = tlCookiesForSearch.filter(
      (c) => !c.startsWith("cf_clearance="),
    );
    filtered.push(`cf_clearance=${tlCf}`);
    TorrentSearchApi.enableProvider("TorrentLeech", filtered);
    patchProviderWithSshTunnel(TorrentSearchApi.getProvider("TorrentLeech"));
    unilog(189, "Using provided TorrentLeech cf_clearance");
  }

  // Provider search:
  // - Sanitize the show name for provider searching (strip punctuation, collapse whitespace)
  // - Also try a parens-stripped variant
  // - Keep provider category as "TV" (existing behavior)
  let torrents = [];
  const baseName = String(showName || "").trim();
  const hasParens = baseName.match(/\([^)]+\)\s*$/);
  const nameWithoutParens = hasParens
    ? baseName.replace(/\([^)]+\)\s*$/, "").trim()
    : "";

  const sanitized = sanitizeForProviderSearch(baseName);
  const sanitizedWithoutParens = nameWithoutParens
    ? sanitizeForProviderSearch(nameWithoutParens)
    : "";

  // Season restriction: search providers for "<name> S03" and "<name> Season 3"
  // instead of the bare show name. TV only. More than one season (a map-pane
  // episode list can span seasons) adds a query pair per season.
  const seasonNums =
    category === "movie"
      ? []
      : [
          ...new Set(
            (Array.isArray(seasons) ? seasons : [seasons])
              .map((s) => parseInt(s, 10))
              .filter((n) => !Number.isNaN(n) && n >= 0),
          ),
        ].sort((a, b) => a - b);
  const seasonQueries = (name) => {
    if (seasonNums.length === 0) return [name];
    return seasonNums.flatMap((n) => [
      `${name} S${String(n).padStart(2, "0")}`,
      `${name} Season ${n}`,
    ]);
  };

  const queries = [sanitized, sanitizedWithoutParens]
    .filter(Boolean)
    .flatMap(seasonQueries);
  const seenQuery = new Set();
  const uniqueQueries = [];
  for (const q of queries) {
    const key = q.toUpperCase();
    if (seenQuery.has(key)) continue;
    seenQuery.add(key);
    uniqueQueries.push(q);
  }

  // Determine which providers to search based on category and `more` flag
  let rawCombined = [];
  let tpbFailed = false;

  if (category === "movie") {
    // Movie mode: search all 4 providers in parallel, no caching, no EZTV
    // Clear any existing TV cache for this show so it's not reused on mode exit
    try {
      const cachePath = iptTlCacheFilePath(showName);
      if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
    } catch {
      /* ignore */
    }

    const movieResults = await Promise.all(
      uniqueQueries.flatMap((q) => [
        withTimeout(
          TorrentSearchApi.search(["IpTorrents"], q, "TV", limit),
          PROVIDER_TIMEOUT_MS,
          "IpTorrents",
        ).catch((e) => {
          unilog(190, `IpTorrents: ${e.message}`);
          return [];
        }),
        withTimeout(
          TorrentSearchApi.search(["TorrentLeech"], q, "Movies", limit),
          PROVIDER_TIMEOUT_MS,
          "TorrentLeech",
        ).catch((e) => {
          unilog(191, `TorrentLeech: ${e.message}`);
          return [];
        }),
        searchTpbApibay(q, limit, { movie: true }).then((r) => r ?? []),
        withTimeout(
          TorrentSearchApi.search(["Limetorrents"], q, "Movies", limit),
          PROVIDER_TIMEOUT_MS,
          "Limetorrents",
        ).catch((e) => {
          unilog(192, `Limetorrents: ${e.message}`);
          return [];
        }),
      ]),
    );
    rawCombined = movieResults.flat();
  } else if (!more) {
    // Normal TV search: IPT/TL only — search them in parallel rather than sequentially
    const resultsArrays = await Promise.all(
      uniqueQueries.flatMap((q) => [
        withTimeout(
          TorrentSearchApi.search(["IpTorrents"], q, "TV", limit),
          PROVIDER_TIMEOUT_MS,
          "IpTorrents",
        ).catch((e) => {
          unilog(193, `IpTorrents: ${e.message}`);
          return [];
        }),
        withTimeout(
          TorrentSearchApi.search(["TorrentLeech"], q, "TV", limit),
          PROVIDER_TIMEOUT_MS,
          "TorrentLeech",
        ).catch((e) => {
          unilog(194, `TorrentLeech: ${e.message}`);
          return [];
        }),
      ]),
    );
    rawCombined = resultsArrays.flat();
  } else {
    // more=true: combine cached IPT/TL results + fresh TPB/LIM/EZT searches
    const cachedIptTl = readIptTlCache(showName, seasonNums);

    // Detect a year in the show name (e.g. "Show (2004)" or "Show 2004")
    const yearMatch =
      ALWAYS_DO_BOTH_SEARCHES &&
      baseName.match(/\s*\(\d{4}\)\s*$|\s+\d{4}\s*$/);

    const searchTpbLimEzt = async (queries) =>
      (
        await Promise.all(
          queries.flatMap((q) => [
            searchTpbApibay(q, limit).then((r) => {
              if (r === null) {
                tpbFailed = true;
                return [];
              }
              return r;
            }),
            withTimeout(
              TorrentSearchApi.search(["Limetorrents"], q, "TV", limit),
              PROVIDER_TIMEOUT_MS,
              "Limetorrents",
            ).catch((e) => {
              unilog(195, `Limetorrents: ${e.message}`);
              return [];
            }),
            withTimeout(
              TorrentSearchApi.search(["Eztv"], q, "All", limit),
              PROVIDER_TIMEOUT_MS,
              "Eztv",
            ).catch((e) => {
              unilog(196, `Eztv: ${e.message}`);
              return [];
            }),
          ]),
        )
      ).flat();

    let tpbLimEztResults;
    if (yearMatch) {
      // Build no-year queries up front so both phases can run in parallel
      const nameNoYear = baseName
        .replace(/\s*\(\d{4}\)\s*$/, "")
        .replace(/\s+\d{4}\s*$/, "")
        .trim();
      const sanitizedNoYear = sanitizeForProviderSearch(nameNoYear);
      const noYearQueries = sanitizedNoYear
        ? seasonQueries(sanitizedNoYear).filter(
            (q) =>
              !uniqueQueries.some((u) => u.toUpperCase() === q.toUpperCase()),
          )
        : [];
      // Run year and no-year searches in parallel; dedupe handles overlaps
      const [withYearResults, withoutYearResults] = await Promise.all([
        searchTpbLimEzt(uniqueQueries),
        noYearQueries.length
          ? searchTpbLimEzt(noYearQueries)
          : Promise.resolve([]),
      ]);
      tpbLimEztResults = [...withYearResults, ...withoutYearResults];
    } else {
      tpbLimEztResults = await searchTpbLimEzt(uniqueQueries);
    }

    rawCombined = [...cachedIptTl, ...tpbLimEztResults];
  }

  const seen = new Set();
  const deduped = [];
  for (const t of rawCombined) {
    const key = `${t?.provider}|${t?.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }
  torrents = deduped;

  // Cache IPT/TL-only results for subsequent more=true calls (only on more=false TV)
  if (!more && category !== "movie") {
    writeIptTlCache(showName, deduped, seasonNums);
  }

  // Count by provider in raw results (before normalization/filtering).
  // The UI uses this to decide whether to show "missing provider" cookie warnings.
  const rawProviderCounts = {};
  torrents.forEach((t) => {
    const provider = t.provider || "Unknown";
    rawProviderCounts[provider] = (rawProviderCounts[provider] || 0) + 1;
  });

  // Normalized provider code counts (for providerStats in return value)
  const rawProviderCodeCounts = {};
  for (const [provider, count] of Object.entries(rawProviderCounts)) {
    const code = getProviderCode(provider);
    rawProviderCodeCounts[code] = (rawProviderCodeCounts[code] || 0) + count;
  }
  // Always include all expected providers so stats show even when a provider returns 0
  const expectedProviderCodes =
    category === "movie"
      ? ["IPT", "TL", "TPB", "LIM"]
      : more
        ? ["IPT", "TL", "TPB", "LIM", "EZT"]
        : ["IPT", "TL"];
  for (const code of expectedProviderCodes) {
    if (!(code in rawProviderCodeCounts)) rawProviderCodeCounts[code] = 0;
  }

  // Normalize and filter torrents
  unilog(197, `pre-filter raw titles (${torrents.length} total):`);
  torrents.forEach((t, i) => {
    const title = t?.title || t?.raw?.title || "(no title)";
    const provider = t?.provider || "?";
    unilog(198, `[${i + 1}] [${provider}] ${title}`);
  });
  const normalized = torrents.map((t) => normalize(t, showName));

  const matches = normalized.filter((t) => t && t.nameMatch);

  // Add year to raw data
  matches.forEach((torrent) => {
    if (torrent.raw) {
      // If parsed.year exists, use it
      if (torrent.parsed.year) {
        torrent.raw.year = torrent.parsed.year;
      } else {
        // Try to extract year from title - matches (YYYY) or year surrounded by non-alphanumeric
        const yearRegex = /\((\d{4})\)|[^\w](\d{4})[^\w]/g;
        const years = [];
        let match;
        while ((match = yearRegex.exec(torrent.raw.title)) !== null) {
          const year = parseInt(match[1] || match[2]);
          if (year > 1950 && year < 2050) {
            years.push(year);
          }
        }
        // Use the lowest year if any were found
        if (years.length > 0) {
          torrent.raw.year = Math.min(...years);
        }
      }
    }
  });

  // Add detailUrl to torrent
  matches.forEach((torrent) => {
    if (torrent.raw) {
      const provider = torrent.raw.provider?.toLowerCase();
      const searchQ = encodeURIComponent(
        String(showName || "")
          .replace(/\([^)]+\)\s*$/, "")
          .replace(/[?.]+\s*$/g, "")
          .trim(),
      );

      if (provider === "torrentleech" && torrent.raw.fid) {
        torrent.detailUrl = `https://www.torrentleech.org/torrent/${torrent.raw.fid}#torrentinfo`;
      } else if (provider === "iptorrents" && torrent.raw.desc) {
        torrent.detailUrl = torrent.raw.desc;
      } else if (provider === "thepiratebay") {
        torrent.detailUrl = `https://thepiratebay.org/search.php?q=${searchQ}&cat=205`;
      } else if (provider === "limetorrents") {
        torrent.detailUrl = `https://www.limetorrents.lol/search/tv/${searchQ}/`;
      } else if (provider === "eztv") {
        torrent.detailUrl = `https://eztvx.to/search/${String(showName || "")
          .replace(/\([^)]+\)\s*$/, "")
          .replace(/[?.]+\s*$/g, "")
          .trim()
          .replace(/\s+/g, "+")}`;
      }
    }
  });

  // Filter out torrents without season information (movies, etc.)
  // Allow season-range and "complete series" torrents through
  // Skip entirely in movie mode — movies don't have season info
  const tvOnly =
    category === "movie"
      ? matches
      : matches.filter((torrent) => {
          const hasSeason =
            torrent?.parsed?.season !== undefined &&
            torrent?.parsed?.season !== null;
          const hasSeasonRange = !!torrent?.seasonRange?.isRange;
          const isCompleteSeries = !!torrent?.completeSeries;
          return hasSeason || hasSeasonRange || isCompleteSeries;
        });

  // In movie mode: drop anything that looks like a TV episode (has season/episode info)
  const movieFiltered =
    category === "movie"
      ? tvOnly.filter((torrent) => {
          const hasSeason =
            torrent?.parsed?.season !== undefined &&
            torrent?.parsed?.season !== null;
          const hasEpisode =
            torrent?.parsed?.episode !== undefined &&
            torrent?.parsed?.episode !== null;
          return !hasSeason && !hasEpisode;
        })
      : tvOnly;

  // Filter by year if show name contains a year
  let yearFiltered = movieFiltered;
  const showYearRegex = /\((\d{4})\)/g;
  const showYears = [];
  let showYearMatch;
  while ((showYearMatch = showYearRegex.exec(showName)) !== null) {
    const year = parseInt(showYearMatch[1]);
    if (year > 1950 && year < 2050) {
      showYears.push(year);
    }
  }

  if (showYears.length > 0) {
    const showYear = Math.min(...showYears);
    yearFiltered = movieFiltered.filter(
      (torrent) => !torrent?.raw?.year || torrent.raw.year === showYear,
    );
  }

  // Filter out unwanted torrents by excluded strings in title
  const excludedStrings = ["nordic", "mobile"];
  const filtered1 = yearFiltered.filter((torrent) => {
    const title = String(torrent?.raw?.title || "").toLowerCase();
    return !excludedStrings.some((excluded) => title.includes(excluded));
  });

  // Do NOT filter on 0 seeds or 480p/384p; attach warnings for the client to filter.
  const filtered2 = filtered1;
  filtered2.forEach((torrent) => {
    const titleLower = String(torrent?.raw?.title || "").toLowerCase();
    const res = String(torrent?.parsed?.resolution || "").toLowerCase();

    if (
      res.includes("384") ||
      titleLower.includes("384p") ||
      titleLower.includes(" 384 ")
    ) {
      addTorrentWarning(torrent, "low_res_384", "Low resolution (384p)");
    }

    if (
      res.includes("480") ||
      titleLower.includes("480p") ||
      titleLower.includes(" 480 ")
    ) {
      addTorrentWarning(torrent, "low_res_480", "Low resolution (480p)");
    }

    const seeds = parseInt(torrent?.raw?.seeds || 0);
    if (Number.isFinite(seeds) && seeds <= 0) {
      addTorrentWarning(torrent, "zero_seeds", `No seeds (seeds=${seeds})`);
    }
  });

  // Add seasonEpisode to all torrents
  filtered2.forEach((torrent) => {
    const { season, episode } = torrent.parsed;
    if (torrent.completeSeries) {
      torrent.parsed.seasonEpisode = "ALL";
    } else if (season !== undefined && season !== null) {
      if (episode === undefined || episode === null) {
        torrent.parsed.seasonEpisode = `S${String(season).padStart(2, "0")}`;
      } else {
        torrent.parsed.seasonEpisode = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
      }
    }
  });

  // Filter and sort based on needed array
  let filtered = filtered2;
  const isLoadAll = needed && needed.includes("loadall");
  const isNoEmby = needed && needed.includes("noemby");
  // A season-restricted search is unfiltered unless the caller also gave an
  // explicit season/episode list (the map pane Tor button), which must still
  // be applied to the results.
  const hasExplicitNeeded =
    Array.isArray(needed) && needed.some((n) => /^S\d/i.test(String(n)));
  const isForce =
    (needed && needed.includes("force")) ||
    (seasonNums.length > 0 && !hasExplicitNeeded);

  if (isNoEmby || isLoadAll) {
    // Return all season torrents, and episode torrents only for seasons
    // without a season torrent (plus the S01E01 exception).
    filtered = selectSeasonPackTorrents(filtered2);
  } else if (isForce) {
    // For force, return all torrents without filtering
    filtered = filtered2;
  } else if (needed && needed.length > 0) {
    // Filter torrents based on needed array
    filtered = filtered2.filter((torrent) => {
      const { season, episode } = torrent.parsed;
      const range = torrent.seasonRange;

      // Do not hard-filter by resolution; client can use warnings.

      // Complete series torrents match any needed season
      if (torrent.completeSeries) {
        return needed.length > 0;
      }

      // Handle season range torrents: ignore parsed season/episode and match any season in range
      if (range && range.isRange) {
        const start = Number(range.startSeason);
        const end = Number(range.endSeason);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          // Sanity check: prevent massive loops if someone names a torrent "S01-S9999"
          // or if year is parsed as season end. Limit range scan to 100 seasons.
          if (end - start > 100) {
            // If range is huge, just check if our needed season is in [start, end] arithmetically
            // instead of iterating string generation.
            for (const needStr of needed) {
              if (needStr.startsWith("S")) {
                const sNum = parseInt(needStr.slice(1), 10);
                if (!Number.isNaN(sNum) && sNum >= start && sNum <= end) {
                  return true;
                }
              }
            }
            return false;
          }

          for (let s = start; s <= end; s++) {
            const seasonStr = `S${String(s).padStart(2, "0")}`;
            if (needed.includes(seasonStr)) {
              return true;
            }
          }
        }
        return false;
      }

      // Non-range: Check if it's a season or episode torrent
      if (!episode) {
        // Season torrent - check if Sxx is in needed
        const seasonStr = `S${String(season).padStart(2, "0")}`;
        if (needed.includes(seasonStr)) {
          return true;
        }
      } else {
        // Episode torrent - check if SxxExx is in needed, OR if parent season Sxx is in needed.
        // The season marker Sxx is only for season-pack torrents; if individual episodes for
        // this season are listed in needed, an individual episode torrent must match exactly.
        const seasonStr = `S${String(season).padStart(2, "0")}`;
        const episodeStr = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

        if (needed.includes(episodeStr)) {
          return true;
        }
        if (needed.includes(seasonStr)) {
          const hasIndividualForSeason = needed.some((n) =>
            n.startsWith(seasonStr + "E"),
          );
          if (!hasIndividualForSeason) {
            return true;
          }
        }
      }

      return false;
    });
  }

  // Sort torrents (apply to both loadall and regular cases)
  filtered.sort((a, b) => {
    // Skip sorting for dummy torrents (they stay at the end)
    if (a.notorrent || b.notorrent) {
      return a.notorrent ? 1 : -1;
    }

    // Highest-priority: sort by the same label shown in the UI (season/episode at left).
    // Ordering: season packs first, then season-range packs, then individual episodes.
    const key = (t) => {
      if (t.completeSeries) {
        return { season: 0, kind: -1, episode: 0, endSeason: 9999 };
      }

      const range = t.seasonRange;
      if (range && range.isRange) {
        const startSeason = Number(range.startSeason);
        const endSeason = Number(range.endSeason);
        return {
          season: Number.isFinite(startSeason) ? startSeason : 9999,
          kind: 1, // range
          episode: 0,
          endSeason: Number.isFinite(endSeason) ? endSeason : 9999,
        };
      }

      const season = Number(t?.parsed?.season);
      const episode = Number(t?.parsed?.episode);
      const hasSeason = Number.isFinite(season);
      const hasEpisode = Number.isFinite(episode) && episode > 0;

      return {
        season: hasSeason ? season : 9999,
        kind: hasEpisode ? 2 : 0, // 0 season pack, 2 episode
        episode: hasEpisode ? episode : 0,
        endSeason: 0,
      };
    };

    const ak = key(a);
    const bk = key(b);

    if (ak.season !== bk.season) return ak.season - bk.season;
    if (ak.kind !== bk.kind) return ak.kind - bk.kind;
    if (ak.kind === 1 && ak.endSeason !== bk.endSeason)
      return ak.endSeason - bk.endSeason;
    if (ak.kind === 2 && ak.episode !== bk.episode)
      return ak.episode - bk.episode;

    // 1080 before 720
    const aHas1080 = a.parsed.resolution?.includes("1080") || false;
    const bHas1080 = b.parsed.resolution?.includes("1080") || false;
    if (aHas1080 !== bHas1080) {
      return aHas1080 ? -1 : 1;
    }

    // 10-bit before non-10-bit
    const aHas10bit = a.parsed.bitDepth === 10;
    const bHas10bit = b.parsed.bitDepth === 10;
    if (aHas10bit !== bHas10bit) {
      return aHas10bit ? -1 : 1;
    }

    // More seeds before fewer seeds
    const aSeeds = a.raw?.seeds || 0;
    const bSeeds = b.raw?.seeds || 0;
    if (aSeeds !== bSeeds) {
      return bSeeds - aSeeds; // More seeds first
    }

    // Larger size before smaller size (low priority)
    const aSize = a.raw?.size;
    const bSize = b.raw?.size;

    // If one has size and the other doesn't, prioritize the one with size
    if (aSize && !bSize) return -1;
    if (!aSize && bSize) return 1;

    // If both have size, compare them
    if (aSize && bSize) {
      const aSizeBytes = parseSizeToBytes(aSize);
      const bSizeBytes = parseSizeToBytes(bSize);
      if (aSizeBytes !== bSizeBytes) {
        return bSizeBytes - aSizeBytes; // Larger first
      }
    }

    // TorrentLeech before IPTorrents (lowest priority)
    const aProvider = a.raw?.provider?.toLowerCase() || "";
    const bProvider = b.raw?.provider?.toLowerCase() || "";
    const aIsTL = aProvider === "torrentleech";
    const bIsTL = bProvider === "torrentleech";
    if (aIsTL !== bIsTL) {
      return aIsTL ? -1 : 1;
    }

    return 0;
  });

  // Count by provider (for filtered results only)
  const providerCounts = {};
  filtered.forEach((t) => {
    if (t.raw) {
      const provider = t.raw.provider;
      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    }
  });

  // Build providerStats: normalized code -> { filtered, total }
  const providerStats = {};
  for (const [code, total] of Object.entries(rawProviderCodeCounts)) {
    providerStats[code] = { total, filtered: 0 };
  }
  for (const [provider, count] of Object.entries(providerCounts)) {
    const code = getProviderCode(provider);
    if (!providerStats[code]) providerStats[code] = { total: 0, filtered: 0 };
    providerStats[code].filtered += count;
  }

  const warningSummary = computeWarningSummary(filtered);

  if (staged && more && category !== "movie") {
    const iptTlTorrents = [];
    const extraProviderTorrents = [];
    for (const torrent of filtered) {
      const code = getProviderCode(torrent?.raw?.provider || torrent?.provider);
      if (code === "IPT" || code === "TL") {
        iptTlTorrents.push(torrent);
      } else {
        extraProviderTorrents.push(torrent);
      }
    }

    return {
      show: showName,
      count: filtered.length,
      iptTlTorrents,
      extraProviderTorrents,
      rawProviderCounts,
      warningSummary,
      providerStats,
      hasMoreProviders: more,
      tpbError: more && tpbFailed ? true : undefined,
    };
  }

  return {
    show: showName,
    count: filtered.length,
    torrents: filtered,
    rawProviderCounts,
    warningSummary,
    providerStats,
    hasMoreProviders: more,
    tpbError: more && tpbFailed ? true : undefined,
  };
}

/**
 * Get a torrent file for a show from public providers (ThePirateBay, LimeTorrents, EZTV).
 * @param {string} showName - Name of the show to search for
 * @returns {Promise<Buffer|null>} Torrent file buffer, or null if not found
 */
export async function getTorrentFile(showName) {
  const query = String(showName || "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!query) return null;

  const limit = 20;
  const [tpb, lim, ezt] = await Promise.all([
    searchTpbApibay(query, limit).then((r) => r ?? []),
    withTimeout(
      TorrentSearchApi.search(["Limetorrents"], query, "TV", limit),
      PROVIDER_TIMEOUT_MS,
      "Limetorrents",
    ).catch((e) => {
      unilog(199, `Limetorrents for ${showName}: ${e.message}`);
      return [];
    }),
    withTimeout(
      TorrentSearchApi.search(["Eztv"], query, "All", limit),
      PROVIDER_TIMEOUT_MS,
      "Eztv",
    ).catch((e) => {
      unilog(200, `Eztv for ${showName}: ${e.message}`);
      return [];
    }),
  ]);
  const results = [...tpb, ...lim, ...ezt];

  if (!results.length) return null;

  const tmpDir = os.tmpdir();
  for (const result of results) {
    try {
      const safeName = String(result.title || "torrent")
        .replace(/[^a-zA-Z0-9._\- ]/g, "_")
        .slice(0, 80);
      const outPath = path.join(
        tmpDir,
        `tsa-${Date.now()}-${safeName}.torrent`,
      );
      await TorrentSearchApi.downloadTorrent(result, outPath);
      if (fs.existsSync(outPath)) {
        const data = fs.readFileSync(outPath);
        try {
          fs.unlinkSync(outPath);
        } catch {}
        // Validate it's a real bencoded torrent (starts with 'd')
        if (data.length > 0 && data[0] === 0x64) return data;
      }
    } catch {
      // try next result
    }
  }
  return null;
}
