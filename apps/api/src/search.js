// Torrent search logic
import fs from "fs";
import path from "path";
import { normalize } from "./normalize.js";
import { getApiDataDir } from "./tvPaths.js";
import { patchProviderWithSshTunnel } from "./sshTunnel.js";

import TorrentSearchApi from "torrent-search-api";
import os from "os";

// When true and the show name contains a year, TPB/LIM/EZT are first searched with the
// year included. If that yields >20 results the no-year search is skipped; otherwise
// both sets of results are combined.
const ALWAYS_DO_BOTH_SEARCHES = true;
const LOG_APPS_API_DATA_TOR_RESULTS_TXT = false;

// Per-provider fetch timeout for public providers
const PROVIDER_TIMEOUT_MS = 90_000;

// TV category codes returned by apibay (205=SD, 207=SD-episodes, 208=HD-TV, 212=UHD)
const TPB_TV_CATEGORIES = new Set(["202", "205", "207", "208", "212"]);

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

async function searchTpbDirect(query, limit = 100) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    const res = await fetch(
      `https://apibay.org/q.php?q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(
        `[searchTpbDirect] apibay HTTP ${res.status} for "${query}"`,
      );
      return [];
    }
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) {
      console.warn(
        `[searchTpbDirect] apibay non-array response for "${query}"`,
      );
      return [];
    }
    const real = data.filter((r) => String(r.id) !== "0");
    const tv = real.filter((r) =>
      TPB_TV_CATEGORIES.has(String(r.category ?? "")),
    );
    return tv.slice(0, limit).map((r) => ({
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
    console.warn(`[searchTpbDirect] failed for "${query}": ${e.message}`);
    return [];
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

// In-memory cache: showName (lowercase) -> deduped raw results from last IPT/TL search
const iptTlSearchCache = new Map();

const DATA_DIR = getApiDataDir();

function iptTlCacheFilePath(showName) {
  const safe = String(showName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .slice(0, 80);
  return path.join(os.tmpdir(), `tor-iptl-cache-${safe}.json`);
}

function writeIptTlCache(showName, results) {
  try {
    fs.writeFileSync(
      iptTlCacheFilePath(showName),
      JSON.stringify(results),
      "utf8",
    );
  } catch {
    // ignore
  }
}

function readIptTlCache(showName) {
  try {
    const raw = fs.readFileSync(iptTlCacheFilePath(showName), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const COOKIES_DIR = DATA_DIR;
const IPTORRENTS_CUSTOM_PATH = path.join(DATA_DIR, "iptorrents-custom.json");
const TOR_RESULTS_LOG_PATH = path.join(DATA_DIR, "tor-results.txt");

function appendTorResultsLog(lines) {
  if (!LOG_APPS_API_DATA_TOR_RESULTS_TXT) return;
  try {
    const arr = Array.isArray(lines) ? lines : [String(lines || "")];
    const txt =
      arr
        .filter(Boolean)
        .map((l) => String(l).replace(/\s+$/g, ""))
        .join("\n") + "\n";
    fs.appendFileSync(TOR_RESULTS_LOG_PATH, txt, "utf8");
  } catch {
    // ignore logging failures
  }
}

function torLog(line) {
  const ts = new Date().toISOString();
  appendTorResultsLog(`[${ts}] ${String(line || "")}`);
  if (process.env.TOR_LOG_STDOUT === "1") {
    console.log(String(line || ""));
  }
}

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

function logProviderSearchResults(
  items,
  { stage = "provider-search results", expectedProviders } = {},
) {
  const arr = Array.isArray(items) ? items : [];
  const groups = new Map();
  for (const t of arr) {
    const provider = torrentProviderName(t);
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider).push(t);
  }

  const expected = Array.isArray(expectedProviders) ? expectedProviders : [];
  for (const p of expected) {
    const name = String(p || "").trim();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
  }

  const maxPerProvider = parseInt(process.env.TOR_PROVIDER_SEARCH_MAX || "100");
  const max = Number.isFinite(maxPerProvider) ? maxPerProvider : 100;

  torLog(`[search] ${stage}: total=${arr.length} providers=${groups.size}`);

  const orderedProviders = [];
  for (const p of expected) {
    const name = String(p || "").trim();
    if (name && groups.has(name)) orderedProviders.push(name);
  }
  for (const name of groups.keys()) {
    if (!orderedProviders.includes(name)) orderedProviders.push(name);
  }

  for (const provider of orderedProviders) {
    const list = groups.get(provider) || [];
    torLog(`========= ${provider} =========`);
    if (!list.length) {
      torLog(`[search] ${provider}: 0 results`);
      continue;
    }
    const slice = max > 0 ? list.slice(0, max) : list;
    slice.forEach((t, i) => {
      const title = t?.title || t?.raw?.title || "";
      const seeds = t?.seeds;
      const size = t?.size;
      const parts = [];
      if (Number.isFinite(Number(seeds))) parts.push(`seeds=${seeds}`);
      if (size) parts.push(`size=${size}`);
      const meta = parts.length ? ` [${parts.join(" ")}]` : "";
      torLog(
        `[search] ${provider} item ${String(i + 1).padStart(3, "0")}/${list.length}${meta}: ${title}`,
      );
    });
    if (slice.length !== list.length) {
      torLog(
        `[search] ${provider} items truncated: logged ${slice.length}/${list.length} (set TOR_PROVIDER_SEARCH_MAX=0 to log all)`,
      );
    }
  }
}

function torrentLogLabel(torrent) {
  if (!torrent) return "(null)";
  const provider = torrent?.raw?.provider || torrent?.provider || "Unknown";
  const title = torrent?.raw?.title || torrent?.title || "";
  const seasonEpisode = torrent?.parsed?.seasonEpisode;
  const range = torrent?.seasonRange?.isRange
    ? `S${String(torrent.seasonRange.startSeason).padStart(2, "0")}-S${String(torrent.seasonRange.endSeason).padStart(2, "0")}`
    : "";
  const left = seasonEpisode || range || "";
  const seeds = torrent?.raw?.seeds;
  const size = torrent?.raw?.size;
  const bits = [];
  if (left) bits.push(left);
  if (Number.isFinite(Number(seeds))) bits.push(`seeds=${seeds}`);
  if (size) bits.push(`size=${size}`);
  const meta = bits.length ? ` [${bits.join(" ")}]` : "";
  return `${provider}${meta} | ${title}`.trim();
}

function torrentProviderName(torrent) {
  return String(torrent?.raw?.provider || torrent?.provider || "Unknown");
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

function logFilterStage(stage, beforeCount, keptCount, removed, meta) {
  const filteredCount = Math.max(0, beforeCount - keptCount);
  torLog(
    `[search] ${stage}: ${beforeCount} -> ${keptCount} (filtered ${filteredCount})`,
  );
  if (meta && typeof meta === "object") {
    const keys = Object.keys(meta);
    if (keys.length)
      torLog(`[search] meta ${JSON.stringify({ stage, ...meta })}`);
  }

  const groups = new Map();
  for (const r of removed || []) {
    const provider = torrentProviderName(r?.item);
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider).push(r);
  }
  for (const [provider, list] of groups.entries()) {
    torLog(`========= ${provider} =========`);
    list.forEach(({ item, reason }) => {
      torLog(
        `[search] filtered(${stage}): ${torrentLogLabel(item)} :: ${reason || "filtered"}`,
      );
    });
  }
}

function filterWithReasons(items, keepFn, reasonFn) {
  const kept = [];
  const removed = [];
  for (const item of items || []) {
    let keep = false;
    try {
      keep = Boolean(keepFn(item));
    } catch {
      keep = false;
    }
    if (keep) {
      kept.push(item);
    } else {
      let reason = "filtered";
      try {
        reason = reasonFn ? String(reasonFn(item) || "filtered") : "filtered";
      } catch {
        reason = "filtered";
      }
      removed.push({ item, reason });
    }
  }
  return { kept, removed };
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
  if (!iptCookies) console.log("IPTorrents disabled: (curl-ipt.txt missing)");
  if (!tlCookies) console.log("TorrentLeech disabled: (curl-tl.txt missing)");

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
        console.error(
          `IPTorrents custom config missing: ${IPTORRENTS_CUSTOM_PATH} (using default provider config)`,
        );
      }
      TorrentSearchApi.enableProvider("IpTorrents", iptCookies);
      patchProviderWithSshTunnel(TorrentSearchApi.getProvider("IpTorrents"));
    } catch (e) {
      console.error("Failed to enable IPTorrents:", e.message);
    }
  }

  if (tlCookies) {
    try {
      TorrentSearchApi.enableProvider("TorrentLeech", tlCookies);
      patchProviderWithSshTunnel(TorrentSearchApi.getProvider("TorrentLeech"));
    } catch (e) {
      console.error("Failed to enable TorrentLeech:", e.message);
    }
  }

  // Enable public providers (no authentication needed)
  try {
    TorrentSearchApi.enableProvider("ThePirateBay");
  } catch (e) {
    console.error("Failed to enable ThePirateBay:", e.message);
  }
  try {
    TorrentSearchApi.enableProvider("Limetorrents");
  } catch (e) {
    console.error("Failed to enable Limetorrents:", e.message);
  }
  try {
    TorrentSearchApi.enableProvider("Eztv");
  } catch (e) {
    console.error("Failed to enable Eztv:", e.message);
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
 * @returns {Object} Search results with torrents array
 */
export async function searchTorrents({
  showName,
  limit = 1000,
  iptCf,
  tlCf,
  needed = [],
  more = false,
}) {
  const activeProvidersRaw = TorrentSearchApi.getActiveProviders();
  const activeProviders = formatActiveProviders(activeProvidersRaw);
  console.log(`\nSearching for: ${showName} (limit: ${limit})`);
  console.log("Enabled providers:", activeProviders.join(", "));

  torLog(`========== search: ${showName} (limit=${limit}) ==========`);

  const sanitizeForProviderSearch = (name) => {
    return String(name || "")
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // Temporarily override cookies if cf_clearance provided
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
        console.error(
          `IPTorrents custom config missing: ${IPTORRENTS_CUSTOM_PATH} (cf_clearance override will use default provider config)`,
        );
      }
      TorrentSearchApi.enableProvider("IpTorrents", filtered);
      patchProviderWithSshTunnel(TorrentSearchApi.getProvider("IpTorrents"));
      console.log("Using provided IPTorrents cf_clearance");
    } catch (e) {
      console.error(
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
    console.log("Using provided TorrentLeech cf_clearance");
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

  const queries = [sanitized, sanitizedWithoutParens].filter(Boolean);
  const seenQuery = new Set();
  const uniqueQueries = [];
  for (const q of queries) {
    const key = q.toUpperCase();
    if (seenQuery.has(key)) continue;
    seenQuery.add(key);
    uniqueQueries.push(q);
  }

  // Determine which providers to search based on the `more` flag
  let rawCombined = [];
  let tpbFailed = false;
  if (!more) {
    // Normal search: IPT/TL only (explicit provider list; they're enabled via initializeProviders)
    const resultsArrays = await Promise.all(
      uniqueQueries.map(async (q) => {
        try {
          const r = await withTimeout(
            TorrentSearchApi.search(
              ["IpTorrents", "TorrentLeech"],
              q,
              "TV",
              limit,
            ),
            PROVIDER_TIMEOUT_MS,
            "IpTorrents/TorrentLeech",
          );
          return Array.isArray(r) ? r : [];
        } catch (e) {
          console.warn(`[search] IpTorrents/TorrentLeech: ${e.message}`);
          return [];
        }
      }),
    );
    rawCombined = resultsArrays.flat();
  } else {
    // more=true: combine cached IPT/TL results + fresh TPB/LIM/EZT searches
    const cacheKey = showName.toLowerCase();
    const cachedIptTl =
      iptTlSearchCache.get(cacheKey) || readIptTlCache(showName);

    // Detect a year in the show name (e.g. "Show (2004)" or "Show 2004")
    const yearMatch =
      ALWAYS_DO_BOTH_SEARCHES &&
      baseName.match(/\s*\(\d{4}\)\s*$|\s+\d{4}\s*$/);

    const searchTpbLimEzt = async (queries) =>
      (
        await Promise.all(
          queries.flatMap((q) => [
            searchTpbDirect(q, limit),
            withTimeout(
              TorrentSearchApi.search(["Limetorrents"], q, "TV", limit),
              PROVIDER_TIMEOUT_MS,
              "Limetorrents",
            ).catch((e) => {
              console.warn(`[searchTpbLimEzt] Limetorrents: ${e.message}`);
              return [];
            }),
            withTimeout(
              TorrentSearchApi.search(["Eztv"], q, "All", limit),
              PROVIDER_TIMEOUT_MS,
              "Eztv",
            ).catch((e) => {
              console.warn(`[searchTpbLimEzt] Eztv: ${e.message}`);
              return [];
            }),
          ]),
        )
      ).flat();

    let tpbLimEztResults;
    if (yearMatch) {
      // Phase 1: search with year
      const withYearResults = await searchTpbLimEzt(uniqueQueries);
      if (withYearResults.length > 20) {
        // Enough results – skip the no-year search
        tpbLimEztResults = withYearResults;
      } else {
        // Phase 2: also search without year
        const nameNoYear = baseName
          .replace(/\s*\(\d{4}\)\s*$/, "")
          .replace(/\s+\d{4}\s*$/, "")
          .trim();
        const sanitizedNoYear = sanitizeForProviderSearch(nameNoYear);
        const noYearQueries =
          sanitizedNoYear &&
          !uniqueQueries.some(
            (q) => q.toUpperCase() === sanitizedNoYear.toUpperCase(),
          )
            ? [sanitizedNoYear]
            : [];
        const withoutYearResults = noYearQueries.length
          ? await searchTpbLimEzt(noYearQueries)
          : [];
        tpbLimEztResults = [...withYearResults, ...withoutYearResults];
      }
    } else {
      tpbLimEztResults = await searchTpbLimEzt(uniqueQueries);
    }

    rawCombined = [...cachedIptTl, ...tpbLimEztResults];
  }

  const seen = new Set();
  const deduped = [];
  const dedupeRemoved = [];
  for (const t of rawCombined) {
    const key = `${t?.provider}|${t?.title}`;
    if (seen.has(key)) {
      dedupeRemoved.push({ item: t, reason: `duplicate key: ${key}` });
      continue;
    }
    seen.add(key);
    deduped.push(t);
  }
  torrents = deduped;

  // Cache IPT/TL-only results for subsequent more=true calls (only on more=false)
  if (!more) {
    iptTlSearchCache.set(showName.toLowerCase(), deduped);
    writeIptTlCache(showName, deduped);
  }

  logFilterStage(
    "provider-search dedupe",
    rawCombined.length,
    torrents.length,
    dedupeRemoved,
    {
      queries: uniqueQueries,
    },
  );
  logProviderSearchResults(torrents, {
    stage: "provider-search results (deduped)",
    expectedProviders: activeProviders,
  });

  // Count by provider in raw results (before normalization/filtering).
  // The UI uses this to decide whether to show "missing provider" cookie warnings.
  const rawProviderCounts = {};
  torrents.forEach((t) => {
    const provider = t.provider || "Unknown";
    rawProviderCounts[provider] = (rawProviderCounts[provider] || 0) + 1;
  });
  torLog(
    `[search] rawProviderCounts(provider-search) ${JSON.stringify(rawProviderCounts)}`,
  );

  // Normalized provider code counts (for providerStats in return value)
  const rawProviderCodeCounts = {};
  for (const [provider, count] of Object.entries(rawProviderCounts)) {
    const code = getProviderCode(provider);
    rawProviderCodeCounts[code] = (rawProviderCodeCounts[code] || 0) + count;
  }
  // Always include all expected providers so stats show even when a provider returns 0
  const expectedProviderCodes = more
    ? ["IPT", "TL", "TPB", "LIM", "EZT"]
    : ["IPT", "TL"];
  for (const code of expectedProviderCodes) {
    if (!(code in rawProviderCodeCounts)) rawProviderCodeCounts[code] = 0;
  }

  // Normalize and filter torrents
  const normalized = torrents.map((t) => normalize(t, showName));
  logFilterStage("normalize", torrents.length, normalized.length, []);

  const nameMatchStage = filterWithReasons(
    normalized,
    (t) => t && t.nameMatch,
    (t) => {
      const rawTitle = t?.raw?.title || t?.title || "";
      return `nameMatch=false (${rawTitle.slice(0, 120)})`;
    },
  );
  const matches = nameMatchStage.kept;
  logFilterStage(
    "name match",
    normalized.length,
    matches.length,
    nameMatchStage.removed,
  );

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
        torrent.detailUrl = `https://eztv.re/search/${String(showName || "")
          .replace(/\([^)]+\)\s*$/, "")
          .replace(/[?.]+\s*$/g, "")
          .trim()
          .replace(/\s+/g, "+")}`;
      }
    }
  });

  // Filter out torrents without season information (movies, etc.)
  // Allow season-range torrents through even if parsed.season is missing
  const tvOnlyStage = filterWithReasons(
    matches,
    (torrent) => {
      const hasSeason =
        torrent?.parsed?.season !== undefined &&
        torrent?.parsed?.season !== null;
      const hasSeasonRange = !!torrent?.seasonRange?.isRange;
      return hasSeason || hasSeasonRange;
    },
    () => "missing season info (and not a season-range torrent)",
  );
  const tvOnly = tvOnlyStage.kept;
  logFilterStage("tv-only", matches.length, tvOnly.length, tvOnlyStage.removed);

  // Filter by year if show name contains a year
  let yearFiltered = tvOnly;
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
    const yearStage = filterWithReasons(
      tvOnly,
      (torrent) => !torrent?.raw?.year || torrent.raw.year === showYear,
      (torrent) => {
        const y = torrent?.raw?.year;
        return `year mismatch (show=${showYear} torrent=${y})`;
      },
    );
    yearFiltered = yearStage.kept;
    logFilterStage(
      "year match",
      tvOnly.length,
      yearFiltered.length,
      yearStage.removed,
      { showYear },
    );
    // (debug removed)
  } else {
    // (debug removed)
  }

  // Filter out unwanted torrents by excluded strings in title
  const excludedStrings = ["2160", "nordic", "mobile"];
  const excludedStage = filterWithReasons(
    yearFiltered,
    (torrent) => {
      const title = String(torrent?.raw?.title || "").toLowerCase();
      return !excludedStrings.some((excluded) => title.includes(excluded));
    },
    (torrent) => {
      const title = String(torrent?.raw?.title || "").toLowerCase();
      const hit = excludedStrings.find((excluded) => title.includes(excluded));
      return `excluded title token: ${hit || "unknown"}`;
    },
  );
  const filtered1 = excludedStage.kept;
  logFilterStage(
    "excluded strings",
    yearFiltered.length,
    filtered1.length,
    excludedStage.removed,
    { excludedStrings },
  );

  // Do NOT filter on 0 seeds or 480p; attach warnings for the client to filter.
  const filtered2 = filtered1;
  let warnedZeroSeeds = 0;
  let warned480 = 0;
  filtered2.forEach((torrent) => {
    const titleLower = String(torrent?.raw?.title || "").toLowerCase();
    const res = String(torrent?.parsed?.resolution || "").toLowerCase();

    if (
      res.includes("480") ||
      titleLower.includes("480p") ||
      titleLower.includes(" 480 ")
    ) {
      warned480 += 1;
      addTorrentWarning(torrent, "low_res_480", "Low resolution (480p)");
    }

    const seeds = parseInt(torrent?.raw?.seeds || 0);
    if (Number.isFinite(seeds) && seeds <= 0) {
      warnedZeroSeeds += 1;
      addTorrentWarning(torrent, "zero_seeds", `No seeds (seeds=${seeds})`);
    }
  });
  logFilterStage(
    "warnings (no filtering)",
    filtered1.length,
    filtered2.length,
    [],
    {
      warned480,
      warnedZeroSeeds,
    },
  );

  torLog(
    `[search] summary counts: ` +
      `${torrents.length} provider results -> ` +
      `${matches.length} name matches -> ` +
      `${tvOnly.length} tv-only -> ` +
      `${showYears.length ? yearFiltered.length + " year-match -> " : ""}` +
      `${filtered1.length} exclude-filter -> ` +
      `${filtered2.length} warnings-attached`,
  );

  // Add seasonEpisode to all torrents
  filtered2.forEach((torrent) => {
    const { season, episode } = torrent.parsed;
    if (season !== undefined && season !== null) {
      if (!episode) {
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
  const isForce = needed && needed.includes("force");

  if (isNoEmby) {
    // For noemby, return all season torrents and episode torrents for seasons without a season torrent
    const seasonsByNumber = {};

    // Group torrents by season
    filtered2.forEach((torrent) => {
      const season = torrent.parsed.season;
      if (season === undefined || season === null) return;

      if (!seasonsByNumber[season]) {
        seasonsByNumber[season] = { seasonTorrents: [], episodeTorrents: [] };
      }

      if (!torrent.parsed.episode) {
        // This is a season torrent
        seasonsByNumber[season].seasonTorrents.push(torrent);
      } else {
        // This is an episode torrent
        seasonsByNumber[season].episodeTorrents.push(torrent);
      }
    });

    // Build filtered list: all season torrents, and episode torrents only for seasons without season torrents
    filtered = [];
    Object.keys(seasonsByNumber)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((seasonNum) => {
        const seasonData = seasonsByNumber[seasonNum];
        if (seasonData.seasonTorrents.length > 0) {
          // Season torrents exist, include all of them
          filtered.push(...seasonData.seasonTorrents);

          // Exception: for season 1, also include episode 1 torrents
          if (Number(seasonNum) === 1) {
            const s01e01Torrents = seasonData.episodeTorrents.filter(
              (t) => t.parsed.episode === 1,
            );
            filtered.push(...s01e01Torrents);
          }
        } else {
          // No season torrents, include all episode torrents
          filtered.push(...seasonData.episodeTorrents);
        }
      });
    const include = new Set(filtered.map((t) => torrentLogLabel(t)));
    const removed = filtered2
      .filter((t) => !include.has(torrentLogLabel(t)))
      .map((t) => {
        const season = t?.parsed?.season;
        const hasSeasonPack =
          seasonsByNumber[season]?.seasonTorrents?.length > 0;
        const isS01E01 =
          Number(season) === 1 && Number(t?.parsed?.episode) === 1;
        const reason =
          hasSeasonPack && !isS01E01
            ? "noemby: season pack exists (drop episodes except S01E01)"
            : "noemby: excluded by selection";
        return { item: t, reason };
      });
    logFilterStage(
      "noemby selection",
      filtered2.length,
      filtered.length,
      removed,
    );
  } else if (isForce) {
    // For force, return all torrents without filtering
    filtered = filtered2;
    logFilterStage(
      "force (no filtering)",
      filtered2.length,
      filtered.length,
      [],
    );
  } else if (isLoadAll) {
    // For loadall, return all season torrents and episode torrents for seasons without a season torrent
    const seasonsByNumber = {};

    // Group torrents by season
    filtered2.forEach((torrent) => {
      const season = torrent.parsed.season;
      if (season === undefined || season === null) return;

      if (!seasonsByNumber[season]) {
        seasonsByNumber[season] = { seasonTorrents: [], episodeTorrents: [] };
      }

      if (!torrent.parsed.episode) {
        // This is a season torrent
        seasonsByNumber[season].seasonTorrents.push(torrent);
      } else {
        // This is an episode torrent
        seasonsByNumber[season].episodeTorrents.push(torrent);
      }
    });

    // Build filtered list: all season torrents, and episode torrents only for seasons without season torrents
    filtered = [];
    Object.keys(seasonsByNumber)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((seasonNum) => {
        const seasonData = seasonsByNumber[seasonNum];
        if (seasonData.seasonTorrents.length > 0) {
          // Season torrents exist, include all of them
          filtered.push(...seasonData.seasonTorrents);

          // Exception: for season 1, also include episode 1 torrents
          if (Number(seasonNum) === 1) {
            const s01e01Torrents = seasonData.episodeTorrents.filter(
              (t) => t.parsed.episode === 1,
            );
            filtered.push(...s01e01Torrents);
          }
        } else {
          // No season torrents, include all episode torrents
          filtered.push(...seasonData.episodeTorrents);
        }
      });
    const include = new Set(filtered.map((t) => torrentLogLabel(t)));
    const removed = filtered2
      .filter((t) => !include.has(torrentLogLabel(t)))
      .map((t) => {
        const season = t?.parsed?.season;
        const hasSeasonPack =
          seasonsByNumber[season]?.seasonTorrents?.length > 0;
        const isS01E01 =
          Number(season) === 1 && Number(t?.parsed?.episode) === 1;
        const reason =
          hasSeasonPack && !isS01E01
            ? "loadall: season pack exists (drop episodes except S01E01)"
            : "loadall: excluded by selection";
        return { item: t, reason };
      });
    logFilterStage(
      "loadall selection",
      filtered2.length,
      filtered.length,
      removed,
    );
  } else if (needed && needed.length > 0) {
    // Track which needed entries were matched
    const matchedNeeded = new Set();

    // Filter torrents based on needed array
    const neededStage = filterWithReasons(
      filtered2,
      (torrent) => {
        const { season, episode } = torrent.parsed;
        const range = torrent.seasonRange;

        // Do not hard-filter by resolution; client can use warnings.

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
                    matchedNeeded.add(needStr);
                    return true;
                  }
                }
              }
              return false;
            }

            for (let s = start; s <= end; s++) {
              const seasonStr = `S${String(s).padStart(2, "0")}`;
              if (needed.includes(seasonStr)) {
                matchedNeeded.add(seasonStr);
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
            matchedNeeded.add(seasonStr);
            return true;
          }
        } else {
          // Episode torrent - check if SxxExx is in needed, OR if parent season Sxx is in needed
          const seasonStr = `S${String(season).padStart(2, "0")}`;
          const episodeStr = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

          if (needed.includes(episodeStr)) {
            matchedNeeded.add(episodeStr);
            return true;
          }
          if (needed.includes(seasonStr)) {
            matchedNeeded.add(seasonStr);
            return true;
          }
        }

        return false;
      },
      (torrent) => {
        const range = torrent?.seasonRange;
        if (range?.isRange) {
          return `needed: range ${String(range.startSeason)}-${String(range.endSeason)} didn't match needed`;
        }

        const season = torrent?.parsed?.season;
        const episode = torrent?.parsed?.episode;
        if (!episode) {
          const seasonStr = `S${String(season).padStart(2, "0")}`;
          return `needed: missing ${seasonStr}`;
        }
        const episodeStr = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
        return `needed: missing ${episodeStr}`;
      },
    );
    filtered = neededStage.kept;
    logFilterStage(
      "needed filter",
      filtered2.length,
      filtered.length,
      neededStage.removed,
      { needed },
    );
  }

  if (!isNoEmby && !isForce && !isLoadAll && !(needed && needed.length > 0)) {
    logFilterStage(
      "default (no additional filtering)",
      filtered2.length,
      filtered.length,
      [],
    );
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
  torLog(`[search] providerCounts(filtered) ${JSON.stringify(providerCounts)}`);

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
  torLog(`[search] warningSummary(returned) ${JSON.stringify(warningSummary)}`);

  // (debug sample saving removed)

  torLog(
    `[search] return payload summary ${JSON.stringify({
      show: showName,
      count: filtered.length,
      rawProviderCounts,
      providerCounts,
      warningSummary,
      providerStats,
    })}`,
  );

  const returnMax = parseInt(process.env.TOR_RETURN_MAX || "0");
  const toLog =
    Number.isFinite(returnMax) && returnMax > 0
      ? filtered.slice(0, returnMax)
      : filtered;
  const returnGroups = new Map();
  toLog.forEach((t, i) => {
    const provider = torrentProviderName(t);
    if (!returnGroups.has(provider)) returnGroups.set(provider, []);
    returnGroups.get(provider).push({ t, i });
  });
  for (const [provider, list] of returnGroups.entries()) {
    torLog(`========= ${provider} =========`);
    list.forEach(({ t, i }) => {
      torLog(
        `[search] return item ${String(i + 1).padStart(3, "0")}/${filtered.length}: ${torrentLogLabel(t)}`,
      );
    });
  }
  if (toLog.length !== filtered.length) {
    torLog(
      `[search] return items truncated: logged ${toLog.length}/${filtered.length} (set TOR_RETURN_MAX=0 to log all)`,
    );
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
    searchTpbDirect(query, limit),
    withTimeout(
      TorrentSearchApi.search(["Limetorrents"], query, "TV", limit),
      PROVIDER_TIMEOUT_MS,
      "Limetorrents",
    ).catch((e) => {
      console.warn(`[getTorrentFile] Limetorrents: ${e.message}`);
      return [];
    }),
    withTimeout(
      TorrentSearchApi.search(["Eztv"], query, "All", limit),
      PROVIDER_TIMEOUT_MS,
      "Eztv",
    ).catch((e) => {
      console.warn(`[getTorrentFile] Eztv: ${e.message}`);
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
        if (data.length > 0) return data;
      }
    } catch {
      // try next result
    }
  }
  return null;
}
