// OpenSubtitles REST client: owns the JWT token cache (persisted to
// secrets/subs-token.txt), login/refresh, and the subtitles search + download
// endpoints, plus the higher-level subsSearch / subsCountEpisodes helpers.

import fs from "fs";
import * as path from "node:path";
import fetch from "node-fetch";
import { logHere, unilog, smartTitleMatch } from "@tv/share";
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
  query,
  year,
  page,
  season,
  episode,
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
    params.parent_imdb_id = imdbDigits;
    if (season !== undefined && season !== null) {
      params.season_number = String(season);
    }
    if (episode !== undefined && episode !== null) {
      params.episode_number = String(episode);
    }
  }

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
  // Retry transient upstream errors.
  const retryStatus = new Set([502, 503, 504]);
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      last = await openSubtitlesDownload({ apiKey, token, fileId });
      if (last?.resp?.ok) return last;
      const status = last?.resp?.status;
      if (retryStatus.has(status) && attempt < maxAttempts) {
        logHere(
          { lvl: "warn", grp: "opensubtitles download" },
          `OpenSubtitles /download HTTP ${status} (file_id=${fileId}, attempt=${attempt}/${maxAttempts}), retrying`,
        );
        await sleep(400 * attempt);
        continue;
      }
      if (retryStatus.has(status)) {
        logHere(
          { lvl: "error", grp: "opensubtitles download" },
          `OpenSubtitles /download gave up with HTTP ${status} for file_id=${fileId} after ${attempt} attempts`,
        );
      }
      return last;
    } catch (e) {
      // Network error / fetch throw: retry.
      if (attempt < maxAttempts) {
        logHere(
          { lvl: "warn", grp: "opensubtitles download" },
          `OpenSubtitles /download failed for file_id=${fileId} (attempt=${attempt}/${maxAttempts}): ${e?.message || String(e)}, retrying`,
        );
        await sleep(400 * attempt);
        continue;
      }
      logHere(
        { lvl: "error", grp: "opensubtitles download" },
        `OpenSubtitles /download gave up for file_id=${fileId} after ${attempt} attempts: ${e?.message || String(e)}`,
      );
      throw e;
    }
  }
  return last;
}

export const subsSearch = async (params) => {
  const imdbDigits = normalizeImdbId(params?.imdb_id);
  const query = params?.query || null;
  const year = params?.year || null;
  let page = params?.page;
  const season = params?.season;
  const episode = params?.episode;

  if (!imdbDigits && !query) {
    throw new Error("subsSearch: missing imdb_id or query");
  }

  if (page === undefined || page === null || page === "") page = 1;
  page = Number(page);
  if (!Number.isFinite(page) || page < 1) page = 1;

  const login = loadSubsLogin();

  // First attempt with existing token (if any)
  try {
    const { resp, body } = await openSubtitlesSubtitles({
      apiKey: login.apiKey,
      token: subsTokenCache,
      imdbDigits,
      query,
      year,
      page,
      season,
      episode,
    });

    if (resp.ok) {
      return body;
    }

    // Refresh token on auth failure and retry once.
    if (resp.status === 401 || resp.status === 403) {
      const newToken = await openSubtitlesLogin(login);
      await persistSubsToken(newToken);

      const retry = await openSubtitlesSubtitles({
        apiKey: login.apiKey,
        token: subsTokenCache,
        imdbDigits,
        query,
        year,
        page,
        season,
        episode,
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
    throw new Error(`subsSearch: ${e.message}`);
  }
};

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

  const results = [];
  for (const request of requests) {
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

      results.push({ key, count: countedItems.length, error: null });
    } catch (e) {
      results.push({
        key,
        count: 0,
        error: e?.message || String(e),
      });
    }
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
