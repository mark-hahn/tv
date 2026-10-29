// OpenSubtitles REST client: owns the JWT token cache (persisted to
// secrets/subs-token.txt), login/refresh, and the subtitles search + download
// endpoints, plus the higher-level subsSearch / subsCountEpisodes helpers.

import fs from "fs";
import * as path from "node:path";
import fetch from "node-fetch";
import { unilog, logHere, smartTitleMatch } from "@tv/share";
import { SRVR_SECRETS_DIR } from "./srvrPaths.js";
import * as util from "./util.js";
import * as tvdb from "./tvdb.js";

const SECRETS_DIR = SRVR_SECRETS_DIR;
const subsLoginPath = path.join(SECRETS_DIR, "subs-login.txt");
const subsTokenReadPath = path.join(SECRETS_DIR, "subs-token.txt");
const subsTokenWritePath = path.join(SECRETS_DIR, "subs-token.txt");

// OpenSubtitles requires a real app User-Agent; it will 403 on generic ones (e.g. node-fetch).
const openSubtitlesUserAgent = "tv-srvr v1.0.0";

let subsTokenCache = null;
try {
  const token = fs.readFileSync(subsTokenReadPath, "utf8");
  subsTokenCache =
    typeof token === "string" && token.trim() ? token.trim() : null;
} catch {
  subsTokenCache = null;
}

// Current cached OpenSubtitles JWT (or null).
export function getSubsToken() {
  return subsTokenCache;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function normalizeImdbId(imdbId) {
  if (imdbId === undefined || imdbId === null) return "";
  const s = String(imdbId).trim();
  if (!s) return "";
  // remove leading tt and any non-digits
  return s.replace(/^tt/i, "").replace(/\D/g, "");
}

function isSubsTokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString("utf8"),
    );
    const exp = payload?.exp;
    if (!Number.isFinite(exp)) return true;
    // Refresh if expired or within 24h of expiry
    return Date.now() / 1000 > exp - 86400;
  } catch {
    return true;
  }
}

export function loadSubsLogin() {
  let loginStr;
  try {
    loginStr = fs.readFileSync(subsLoginPath, "utf8");
  } catch (e) {
    throw new Error(`subsSearch: missing ${subsLoginPath}`);
  }

  let login;
  try {
    login = JSON.parse(loginStr);
  } catch (e) {
    throw new Error(`subsSearch: invalid JSON in ${subsLoginPath}`);
  }

  const apiKey = typeof login?.apiKey === "string" ? login.apiKey.trim() : "";
  const username =
    typeof login?.username === "string" ? login.username.trim() : "";
  const password =
    typeof login?.password === "string" ? login.password.trim() : "";

  if (!apiKey) throw new Error("subsSearch: missing apiKey");
  // username/password only required for login refresh path

  return { apiKey, username, password };
}

async function persistSubsToken(token) {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) throw new Error("subsSearch: empty token");
  subsTokenCache = t;
  try {
    fs.mkdirSync(path.dirname(subsTokenWritePath), { recursive: true });
  } catch {}
  await util.writeFile(subsTokenWritePath, t);
}

async function openSubtitlesLogin({ apiKey, username, password }) {
  if (!username || !password) {
    throw new Error("subsSearch: cannot login (missing username/password)");
  }

  const url = "https://api.opensubtitles.com/api/v1/login";
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "User-Agent": openSubtitlesUserAgent,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => "");
    body = { error: (text || "").slice(0, 500) };
  }

  if (!resp.ok) {
    const msg =
      body?.message ||
      body?.error ||
      `OpenSubtitles login failed (${resp.status})`;
    throw new Error(`subsSearch: ${msg}`);
  }

  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token)
    throw new Error("subsSearch: login succeeded but no token returned");
  return token;
}

async function openSubtitlesSubtitles({
  apiKey,
  token,
  imdbDigits,
  tmdbId,
  query,
  year,
  page,
  season,
  episode,
  moviehash,
}) {
  const url = new URL("https://api.opensubtitles.com/api/v1/subtitles");
  const params = {
    page: String(page),
    languages: "en",
  };
  if (query) {
    params.query = query;
    params.type = "movie";
    if (year) params.year = String(year);
  } else {
    if (tmdbId) params.parent_tmdb_id = String(tmdbId);
    else params.parent_imdb_id = imdbDigits;
    if (season !== undefined && season !== null) {
      params.season_number = String(season);
    }
    if (episode !== undefined && episode !== null) {
      params.episode_number = String(episode);
    }
  }
  // Flags the results made for the file with this hash (moviehash_match); it
  // does not narrow the search.
  if (moviehash) params.moviehash = moviehash;

  url.search = new URLSearchParams(params).toString();

  const headers = {
    "Api-Key": apiKey,
    "User-Agent": openSubtitlesUserAgent,
    Accept: "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url.toString(), { headers });

  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => "");
    body = {
      error: text || `OpenSubtitles non-JSON response (${resp.status})`,
    };
  }

  return { resp, body };
}

// The account's download quota as OpenSubtitles counts it (/infos/user):
// {allowed, used, remaining}. Its answer has no time the count starts
// afresh; only a download's answer does. A request answered 429 is tried
// again once its retry-after has passed, and one refused for the login once
// more after a new login.
export async function subsDownloadQuota() {
  const login = loadSubsLogin();
  const ask = async () => {
    for (let attempt = 1; ; attempt++) {
      const resp = await fetch("https://api.opensubtitles.com/api/v1/infos/user", {
        headers: {
          "Api-Key": login.apiKey,
          "User-Agent": openSubtitlesUserAgent,
          Accept: "application/json",
          ...(subsTokenCache ? { Authorization: `Bearer ${subsTokenCache}` } : {}),
        },
      });
      if (resp.status !== 429 || attempt >= 3) return resp;
      await sleep(1000 * (Number(resp.headers.get("retry-after")) || 1));
    }
  };
  let resp = await ask();
  if (resp.status === 401 || resp.status === 403) {
    await persistSubsToken(await openSubtitlesLogin(login));
    resp = await ask();
  }
  if (!resp.ok) throw new Error(`OpenSubtitles /infos/user HTTP ${resp.status}`);
  const d = (await resp.json())?.data;
  if (!Number.isInteger(d?.remaining_downloads))
    throw new Error("OpenSubtitles /infos/user gave no download quota");
  return {
    allowed: d.allowed_downloads,
    used: d.downloads_count,
    remaining: d.remaining_downloads,
  };
}

// The API allows 5 requests a second; a search answered 429 is tried again
// once the time its retry-after asks for has passed.
async function searchRetrying429(args) {
  for (let attempt = 1; ; attempt++) {
    const r = await openSubtitlesSubtitles(args);
    if (r.resp.status !== 429 || attempt >= 3) return r;
    await sleep(1000 * (Number(r.resp.headers.get("retry-after")) || 1));
  }
}

async function openSubtitlesDownload({ apiKey, token, fileId }) {
  const url = "https://api.opensubtitles.com/api/v1/download";
  const headers = {
    "Api-Key": apiKey,
    "User-Agent": openSubtitlesUserAgent,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ file_id: fileId }),
  });

  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => "");
    body = { error: (text || "").slice(0, 500) };
  }

  return { resp, body };
}

export async function openSubtitlesDownloadWithRetry({
  apiKey,
  token,
  fileId,
  maxAttempts = 3,
}) {
  // Retry transient upstream errors, and the API's limit of 5 requests a
  // second (429) once the time its retry-after asks for has passed.
  const retryStatus = new Set([429, 502, 503, 504]);
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      last = await openSubtitlesDownload({ apiKey, token, fileId });
      if (last?.resp?.ok) return last;
      const status = last?.resp?.status;
      if (retryStatus.has(status) && attempt < maxAttempts) {
        unilog(1732, `OpenSubtitles /download HTTP ${status} (file_id=${fileId}, attempt=${attempt}/${maxAttempts}), retrying`);
        await sleep(
          status === 429
            ? 1000 * (Number(last.resp.headers.get("retry-after")) || 1)
            : 400 * attempt,
        );
        continue;
      }
      if (retryStatus.has(status)) {
        unilog(1733, `OpenSubtitles /download gave up with HTTP ${status} for file_id=${fileId} after ${attempt} attempts`);
      }
      return last;
    } catch (e) {
      // Network error / fetch throw: retry.
      if (attempt < maxAttempts) {
        unilog(3096, `OpenSubtitles /download failed for file_id=${fileId} (attempt=${attempt}/${maxAttempts}): ${e?.message || String(e)}${e?.code ? ` (${e.code})` : ""}, retrying`);
        await sleep(400 * attempt);
        continue;
      }
      unilog(3097, `OpenSubtitles /download gave up for file_id=${fileId} after ${attempt} attempts: ${e?.message || String(e)}${e?.code ? ` (${e.code})` : ""}`);
      throw e;
    }
  }
  return last;
}

export const subsSearch = async (params) => {
  const imdbDigits = normalizeImdbId(params?.imdb_id);
  const tmdbId = params?.tmdb_id || null;
  const query = params?.query || null;
  const year = params?.year || null;
  let page = params?.page;
  const season = params?.season;
  const episode = params?.episode;
  const moviehash = params?.moviehash || null;

  if (!imdbDigits && !tmdbId && !query) {
    throw new Error("subsSearch: missing imdb_id, tmdb_id or query");
  }

  if (page === undefined || page === null || page === "") page = 1;
  page = Number(page);
  if (!Number.isFinite(page) || page < 1) page = 1;

  const login = loadSubsLogin();

  // First attempt with existing token (if any)
  try {
    const { resp, body } = await searchRetrying429({
      apiKey: login.apiKey,
      token: subsTokenCache,
      imdbDigits,
      tmdbId,
      query,
      year,
      page,
      season,
      episode,
      moviehash,
    });

    if (resp.ok) {
      return body;
    }

    // Refresh token on auth failure and retry once.
    if (resp.status === 401 || resp.status === 403) {
      const newToken = await openSubtitlesLogin(login);
      await persistSubsToken(newToken);

      const retry = await searchRetrying429({
        apiKey: login.apiKey,
        token: subsTokenCache,
        imdbDigits,
        tmdbId,
        query,
        year,
        page,
        season,
        episode,
        moviehash,
      });

      if (retry.resp.ok) {
        return retry.body;
      }

      const err = new Error(
        `subsSearch: OpenSubtitles HTTP ${retry.resp.status}`,
      );
      err.details = retry.body;
      throw err;
    }

    const err = new Error(`subsSearch: OpenSubtitles HTTP ${resp.status}`);
    err.details = body;
    throw err;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("subsSearch:")) throw e;
    throw new Error(`subsSearch: ${e.message}${e.code ? ` (${e.code})` : ""}`);
  }
};

// Every IMDb id OpenSubtitles keeps a show named name under: it can split one
// show over several (Interview with the Vampire: seasons 1-2 under one, 3
// under another). Its shows titled like name, from year when both have one.
export async function subsShowImdbIds(name, year) {
  const norm = (s) =>
    String(s ?? "")
      .replace(/\s*\(\d{4}\)$/, "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const want = norm(name);
  const url = new URL("https://api.opensubtitles.com/api/v1/features");
  url.search = new URLSearchParams({ query: want, type: "tvshow" }).toString();
  const headers = {
    "Api-Key": loadSubsLogin().apiKey,
    "User-Agent": openSubtitlesUserAgent,
    Accept: "application/json",
  };
  let resp;
  for (let attempt = 1; ; attempt++) {
    resp = await fetch(url.toString(), { headers });
    if (resp.status !== 429 || attempt >= 3) break;
    await sleep(1000 * (Number(resp.headers.get("retry-after")) || 1));
  }
  if (!resp.ok)
    throw new Error(`subsSearch: OpenSubtitles features HTTP ${resp.status}`);
  const body = await resp.json();
  return (body?.data ?? [])
    .map((f) => f.attributes)
    .filter(
      (a) =>
        a?.imdb_id &&
        norm(a.title) === want &&
        (!year || !a.year || String(a.year) === String(year)),
    )
    .map((a) => String(a.imdb_id));
}

// The torrent pane's Chk Subs (tv-api's /api/tor/chk-subs): for each request
// {key, season, episode, imdb_id | query[, year]}, how many distinct releases
// OpenSubtitles has, a hearing-impaired copy of a release counting with it.
export const subsCountEpisodes = async (params) => {
  const requests = Array.isArray(params?.requests) ? params.requests : null;
  if (!requests || requests.length === 0) {
    throw new Error("subsCountEpisodes: requests required");
  }

  const normalizeReleaseKey = (item) => {
    const release =
      String(item?.attributes?.release || "").trim() ||
      String(item?.attributes?.files?.[0]?.file_name || "").trim();
    return release
      .toLowerCase()
      .replace(/\.(hi|sdh)\b/g, "")
      .replace(/\b(hi|sdh|hearing[ ._-]?impaired)\b/g, "")
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "");
  };

  const isHearingImpaired = (item) => {
    if (item?.attributes?.hearing_impaired === true) return true;
    const release = String(item?.attributes?.release || "").toLowerCase();
    const fileName = String(
      item?.attributes?.files?.[0]?.file_name || "",
    ).toLowerCase();
    return /\bhi\b|\.hi\b|\bsdh\b|hearing[ ._-]?impaired/.test(
      `${release} ${fileName}`,
    );
  };

  const processRequest = async (request) => {
    const key = String(request?.key || "");
    try {
      const query = String(request?.query || "").trim();
      let resolvedImdbId = normalizeImdbId(request?.imdb_id);
      if (!resolvedImdbId && query) {
        const tvdbAll = tvdb.getAllTvdbSync?.() || {};
        let tvdbRec =
          tvdbAll?.[query] ||
          Object.values(tvdbAll).find(
            (rec) =>
              String(rec?.name || "").toLowerCase() === query.toLowerCase(),
          );
        if (!tvdbRec?.imdbId) {
          const matched = smartTitleMatch(
            query,
            Object.values(tvdbAll),
            null,
            false,
          );
          if (matched?.imdbId) tvdbRec = matched;
        }
        resolvedImdbId = normalizeImdbId(tvdbRec?.imdbId);
      }

      const searchParams = { ...request };
      if (resolvedImdbId) {
        searchParams.imdb_id = resolvedImdbId;
        delete searchParams.query;
      }

      const data = await subsSearch(searchParams);
      const items = Array.isArray(data?.data) ? data.data : [];

      const dedupedMap = new Map();
      for (const item of items) {
        const dedupeKey = normalizeReleaseKey(item);
        if (!dedupeKey) continue;
        const existing = dedupedMap.get(dedupeKey);
        if (!existing) {
          dedupedMap.set(dedupeKey, item);
          continue;
        }
        if (isHearingImpaired(existing) && !isHearingImpaired(item)) {
          dedupedMap.set(dedupeKey, item);
        }
      }
      const countedItems = [...dedupedMap.values()];

      return { key, count: countedItems.length, error: null };
    } catch (e) {
      return { key, count: 0, error: e?.message || String(e) };
    }
  };

  const OPN_CONCURRENCY = 3;
  const results = [];
  for (let i = 0; i < requests.length; i += OPN_CONCURRENCY) {
    const batch = requests.slice(i, i + OPN_CONCURRENCY);
    results.push(...(await Promise.all(batch.map(processRequest))));
  }

  return { results };
};

// Proactively refresh token on startup if missing or expired
setImmediate(async () => {
  if (!isSubsTokenExpired(subsTokenCache)) return;
  try {
    const login = loadSubsLogin();
    const newToken = await openSubtitlesLogin(login);
    await persistSubsToken(newToken);
    unilog(1, "token refreshed on startup");
  } catch (e) {
    unilog(2, `startup token refresh failed: ${e.message}`);
  }
});
