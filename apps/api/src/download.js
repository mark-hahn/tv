import fs from "fs";
import path from "path";
import Client from "ssh2-sftp-client";
import { sshCurlFetch } from "./sshTunnel.js";
import { loadCreds } from "./qb-cred.js";
import parseTorrent from "parse-torrent";
import parseTorrentTitle from "parse-torrent-title";

import { getApiDataDir, getApiSecretsDir } from "./tvPaths.js";
import { unilog } from "@tv/share";

const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function safeCookieNames(cookiePairs) {
  return (cookiePairs || [])
    .map((c) => String(c).split("=")[0].trim())
    .filter(Boolean);
}

function fail(stage, reason, extra = {}) {
  return {
    success: false,
    error: reason,
    message: reason,
    stage,
    reason,
    ...extra,
  };
}

function ok(extra = {}) {
  return { success: true, ...extra };
}

function looksLikeCloudflareChallenge(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("<title>just a moment") ||
    s.includes("checking your browser") ||
    s.includes("cf-chl") ||
    s.includes("cf-ray") ||
    s.includes("attention required") ||
    s.includes("enable javascript and cookies") ||
    s.includes("verify you are human")
  );
}

function tryLoadBrowserCurlProfile() {
  try {
    const p = path.join(getApiDataDir(), "curl-tl.txt");
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");

    const headers = {};
    let cookieHeader = "";
    let capturedUrl = "";

    // URL (single or double quoted)
    const mUrl = raw.match(/\bcurl\s+['"]([^'\"]+)['"]/i);
    if (mUrl) capturedUrl = mUrl[1];

    // -b '...'
    const mB1 = raw.match(/\s-b\s+'([^']*)'/i);
    const mB2 = raw.match(/\s-b\s+"([^\"]*)"/i);
    cookieHeader = (mB1?.[1] || mB2?.[1] || "").trim();

    // -H 'k: v' or -H "k: v"
    const reH1 = /\s-H\s+'([^']+)'/gi;
    const reH2 = /\s-H\s+"([^\"]+)"/gi;
    const pushHeader = (h) => {
      const idx = String(h).indexOf(":");
      if (idx <= 0) return;
      const k = String(h).slice(0, idx).trim().toLowerCase();
      const v = String(h)
        .slice(idx + 1)
        .trim();
      if (!k || !v) return;
      headers[k] = v;
    };
    let mh;
    while ((mh = reH1.exec(raw))) pushHeader(mh[1]);
    while ((mh = reH2.exec(raw))) pushHeader(mh[1]);

    // Some exports (notably Firefox) may include cookies as a header instead of -b.
    if (!cookieHeader && headers.cookie) {
      cookieHeader = String(headers.cookie || "").trim();
      delete headers.cookie;
    }

    return {
      path: p,
      url: capturedUrl,
      headers,
      cookieHeader,
    };
  } catch {
    return null;
  }
}

function upsertCookieValue(cookieHeader, cookieName, cookieValue) {
  const name = String(cookieName || "").trim();
  const value = String(cookieValue || "").trim();
  if (!name || !value) return String(cookieHeader || "").trim();

  const parts = String(cookieHeader || "")
    .split(";")
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  let replaced = false;
  const out = parts.map((p) => {
    const idx = p.indexOf("=");
    if (idx <= 0) return p;
    const k = p.slice(0, idx).trim();
    if (k !== name) return p;
    replaced = true;
    return `${name}=${value}`;
  });

  if (!replaced) out.push(`${name}=${value}`);
  return out.join("; ");
}

async function loadLocalCfClearance(provider) {
  try {
    const p = String(provider || "").trim();
    if (!p) return "";
    const inPath = path.join(getApiDataDir(), "cf_clearance-cookies.json");
    const raw = await fs.promises.readFile(inPath, "utf8");
    const j = JSON.parse(raw);
    const v = j && typeof j === "object" && !Array.isArray(j) ? j[p] : "";
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

async function curlFetchBinary(
  targetUrl,
  { headers = {}, cookieHeader = "" } = {},
) {
  return sshCurlFetch(targetUrl, { headers, cookieHeader });
}

// Thin fetch-compatible wrapper around sshCurlFetch for the IPTorrents download path.
async function sshFetch(url, { headers = {} } = {}) {
  const r = await sshCurlFetch(url, { headers });
  return {
    ok: r.ok,
    status: r.ok ? 200 : 0,
    statusText: r.ok ? "OK" : `curl exit ${r.code}`,
    text: async () => r.stdout.toString("utf8"),
    arrayBuffer: async () => r.stdout,
  };
}

function isVideoFile(filePath) {
  const p = String(filePath || "");
  const ext = p.toLowerCase().split(".").pop() || "";
  return ["mkv", "mp4", "avi", "m4v", "mov", "ts"].includes(ext);
}

// Directories that typically contain non-episode bonus content.
const EXTRAS_DIR_RE =
  /(?:^|[/\\])(?:featurettes?|extras?|bonus|behind[_\s-]the[_\s-]scenes|interviews?|deleted[_\s-]scenes?|trailers?|specials?|sample)[/\\]/i;

function isExtrasPath(filePath) {
  return EXTRAS_DIR_RE.test(String(filePath || ""));
}

function torrentNameHasSeasonRange(name) {
  const s = String(name || "");
  return (
    /s\d{1,2}\s*-\s*(?:s\s*)?\d{1,2}/i.test(s) ||
    /seasons?\s+\d{1,2}\s*-\s*\d{1,2}/i.test(s) ||
    /seasons?\s+\d{1,2}(?:\s+\d{1,2})+/i.test(s) ||
    /\bcomplete\s+series\b/i.test(s)
  );
}

function validateTorrentData(torrentData) {
  try {
    const parsedTorrent = parseTorrent(torrentData);
    const files = Array.isArray(parsedTorrent?.files)
      ? parsedTorrent.files
      : [];
    const allPaths = files
      .map((f) => String(f?.path || f?.name || ""))
      .filter(Boolean);

    // Season-range packs (S01-S03) and complete-series torrents often contain
    // DVD/ISO files whose names lack episode numbers.  The torrent name itself
    // is sufficient proof that the content covers whole seasons.
    if (torrentNameHasSeasonRange(parsedTorrent?.name)) {
      return ok();
    }

    // DVD torrents contain .vob files whose names never have S/E numbers.
    // qbt-unrar.sh on the USB server generates proper S/E names after download.
    const hasDvdFiles = allPaths.some((p) => /\.vob$/i.test(String(p || "")));
    if (hasDvdFiles) {
      return ok();
    }

    // Prefer video files for validation (avoid NFO/SRT triggering false failures).
    // Also exclude well-known extras/bonus directories so featurettes don't cause failures.
    const videoFiles = allPaths.filter(isVideoFile);
    const mainVideos = videoFiles.filter((p) => !isExtrasPath(p));
    const checkList =
      mainVideos.length > 0
        ? mainVideos
        : videoFiles.length > 0
          ? videoFiles
          : allPaths;

    const checkedFiles = [];
    let anyHasSE = false;

    for (const p of checkList) {
      const base = path.basename(p);
      const noExt = base.replace(/\.[^.]+$/, "");
      const info = parseTorrentTitle.parse(noExt);

      // If basename parsing missed season/episode, try parsing the full path
      if (!info.season || !info.episode) {
        // Try parsing the full path, but be careful of directory names confusing the parser
        // We only want to look at the immediate parent directory + filename if possible,
        // or just rely on the full path if the parser handles it well.
        // For "The Cyanide And Happiness Show/The Cyanide And Happiness Show - Season - 02 [2015 - 2016] 1080p ... / filename"
        // the middle directory has "Season - 02" but no episode.
        // The filename has "S02.E01".
        const fullInfo = parseTorrentTitle.parse(p);

        if (!info.season && fullInfo.season) info.season = fullInfo.season;

        // Critically, if filename has "S02.E01", it should have been picked up.
        // If "S02.E01" is parsed as season 2, episode 1, then info.episode should be defined.

        // If full path has episode, take it.
        if (!info.episode && fullInfo.episode) info.episode = fullInfo.episode;

        // Fallback: Manually check for SxxExx or Sxx.Exx pattern in the basename if the parser failed
        if (!info.episode) {
          const m = base.match(/S(\d+)[._]?E(\d+)/i);
          if (m) {
            info.season = parseInt(m[1], 10);
            info.episode = parseInt(m[2], 10);
          }
        }

        // Fallback: handle NNN-Title format where first digit is season, next two are episode (e.g. 101-, 207-)
        if (!info.episode) {
          const m = base.match(/^(\d)(\d{2})[-\s]/);
          if (m) {
            info.season = parseInt(m[1], 10);
            info.episode = parseInt(m[2], 10);
          }
        }
      }

      checkedFiles.push({ file: p, parsed: info });
      if (info?.season && info?.episode) anyHasSE = true;
    }

    if (!anyHasSE) {
      return fail(
        "validate-torrent-files",
        "Torrent file name is missing a season or episode number.",
        {
          fileCount: allPaths.length,
          checkedCount: checkList.length,
          checkedFiles,
          torrentName: parsedTorrent?.name || "Unknown",
        },
      );
    }

    return ok();
  } catch (e) {
    return fail("parse-torrent", e?.message || String(e));
  }
}

export function validateTorrentBytes(torrentData) {
  return validateTorrentData(torrentData);
}

export function extractTorrentFileTitles(torrentData) {
  const parsed = parseTorrent(torrentData);
  const files = Array.isArray(parsed?.files) ? parsed.files : [];

  const allPaths = files
    .map((f) => String(f?.path || f?.name || ""))
    .filter(Boolean);

  // Prefer video files so tv-proc matching is closer to what's actually downloaded.
  // Exclude DVD files — they have no S/E info and qbt-unrar.sh generates proper names.
  const dvdRe = /\.(vob|ifo|bup)$/i;
  const nonDvdPaths = allPaths.filter((p) => !dvdRe.test(p));
  const videoPaths = nonDvdPaths.filter(isVideoFile);
  const picked = videoPaths.length > 0 ? videoPaths : nonDvdPaths;

  const titles = picked.map((p) => path.basename(p));

  return Array.from(new Set(titles)).filter(Boolean);
}

export function extractTorrentFileDetails(torrentData) {
  const parsed = parseTorrent(torrentData);
  const files = Array.isArray(parsed?.files) ? parsed.files : [];
  const dvdRe = /\.(vob|ifo|bup)$/i;
  return files
    .filter((f) => {
      const p = String(f?.path || f?.name || "");
      return p && !dvdRe.test(p);
    })
    .map((f) => ({
      path: String(f.path || f.name || ""),
      size: typeof f.length === "number" ? f.length : null,
    }));
}

export function extractTorrentInfo(torrentData) {
  const parsed = parseTorrent(torrentData);
  const files = extractTorrentFileDetails(torrentData);
  const trackers = Array.isArray(parsed?.announce)
    ? Array.from(
        new Set(
          parsed.announce
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      )
    : [];
  const webSeeds = Array.isArray(parsed?.urlList)
    ? Array.from(
        new Set(
          parsed.urlList
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      )
    : [];

  return {
    name: String(parsed?.name || "").trim(),
    infoHash: String(parsed?.infoHash || "")
      .trim()
      .toLowerCase(),
    totalSize: typeof parsed?.length === "number" ? parsed.length : null,
    pieceLength:
      typeof parsed?.pieceLength === "number" ? parsed.pieceLength : null,
    fileCount: files.length,
    private:
      typeof parsed?.private === "boolean"
        ? parsed.private
        : Boolean(parsed?.private),
    createdAt:
      parsed?.created instanceof Date
        ? parsed.created.toISOString()
        : String(parsed?.created || "").trim() || "",
    createdBy: String(parsed?.createdBy || "").trim(),
    comment: String(parsed?.comment || "").trim(),
    trackers,
    webSeeds,
    files,
  };
}

function normalizeProvider(rawProvider, detailUrl) {
  const p = String(rawProvider || "")
    .toLowerCase()
    .trim();
  const url = String(detailUrl || "").toLowerCase();

  if (
    p === "iptorrents" ||
    p.includes("iptorrents") ||
    url.includes("iptorrents")
  )
    return "iptorrents";
  if (
    p === "torrentleech" ||
    p.includes("torrentleech") ||
    url.includes("torrentleech")
  )
    return "torrentleech";
  return p || "unknown";
}

let _cachedCreds;
async function getCreds() {
  if (_cachedCreds) return _cachedCreds;
  const credPath = path.join(getApiSecretsDir(), "download-cred.txt");
  try {
    if (!fs.existsSync(credPath)) {
      throw new Error(`Missing required download credentials: ${credPath}`);
    }
  } catch (e) {
    throw new Error(e?.message || String(e));
  }
  const { creds } = await loadCreds(credPath);
  _cachedCreds = creds;
  return creds;
}

function parseSshTarget(sshTarget) {
  // Basic parse for user@host (ignore ports/options)
  if (!sshTarget) return undefined;
  const at = sshTarget.lastIndexOf("@");
  if (at === -1) return { host: sshTarget };
  const user = sshTarget.slice(0, at);
  const host = sshTarget.slice(at + 1);
  return { user: user || undefined, host: host || undefined };
}

async function getSftpSettings() {
  const creds = await getCreds();

  const sshParts = parseSshTarget(creds.SSH_TARGET);

  const host = creds.SFTP_HOST || sshParts?.host;
  const port = Number(creds.SFTP_PORT || 22);
  const username = creds.SFTP_USER || creds.SFTP_USERNAME || sshParts?.user;
  const password = creds.SFTP_PASS || creds.SFTP_PASSWORD;

  const remoteWatchDir =
    creds.REMOTE_WATCH_DIR ||
    (username ? `/home/${username}/watch/qbittorrent` : undefined);

  if (!host || !username || !password) {
    throw new Error(
      "Missing SFTP config. Put SFTP_PASS and either (SFTP_HOST + SFTP_USER) or SSH_TARGET in apps/api/secrets/download-cred.txt.",
    );
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid SFTP_PORT: ${port}`);
  }

  return {
    sftpConfig: { host, port, username, password },
    remoteWatchDir,
  };
}

function sanitizeFilenameForWatch(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  // Keep it simple: drop path separators and weird chars.
  return (
    s
      .replace(/[\\/]+/g, "_")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]+/g, "")
      .replace(/[^a-zA-Z0-9._\-()\[\] ]+/g, "_")
      .trim()
  );
}

function extractBtih(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match =
    /xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i.exec(text) ||
    /btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i.exec(text);
  return match?.[1] ? String(match[1]).trim().toLowerCase() : "";
}

function getTorrentInfoHash(torrent) {
  const direct =
    torrent?.raw?.infoHash || torrent?.raw?.info_hash || torrent?.raw?.hash;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim().toLowerCase();
  }
  return extractBtih(
    torrent?.raw?.magnet || torrent?.raw?.magnetLink || torrent?.raw?.link,
  );
}

async function fetchTorrentFileFromInfoHash(torrent, provider) {
  const infoHash = getTorrentInfoHash(torrent);
  if (!infoHash) {
    return fail("validate", "No torrent file available for this provider", {
      provider,
    });
  }

  const candidates = [
    `https://itorrents.org/torrent/${infoHash.toUpperCase()}.torrent`,
    `https://itorrents.org/torrent/${infoHash}.torrent`,
  ];

  for (const downloadUrl of candidates) {
    try {
      const response = await sshFetch(downloadUrl, {
        headers: {
          "User-Agent": DOWNLOAD_USER_AGENT,
          Accept: "application/x-bittorrent,application/octet-stream,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          Referer: "https://itorrents.org/",
        },
      });
      if (!response.ok) continue;

      const torrentData = Buffer.from(await response.arrayBuffer());
      const valid = validateTorrentData(torrentData);
      if (!valid.success) continue;

      return ok({
        provider,
        method: "info-hash-cache",
        downloadUrl,
        bytes: torrentData.length,
        torrentData,
      });
    } catch {
      // try next cache candidate
    }
  }

  return fail("fetch-torrent", "No torrent file available for this provider", {
    provider,
    infoHash,
  });
}

function buildTorrentLeechDirectUrlFromSearchResult(torrent) {
  const fid = torrent?.raw?.fid;
  const filename = torrent?.raw?.filename;
  if (!fid || !filename) return "";
  const f = String(filename);
  if (!f.toLowerCase().endsWith(".torrent")) return "";
  return `https://www.torrentleech.org/download/${encodeURIComponent(String(fid))}/${encodeURIComponent(f)}`;
}

/**
 * Fetch a .torrent directly from a provider using only the search-result fields.
 * NOTE: This intentionally avoids detail-page scraping.
 */
export async function fetchTorrentFileFromSearchResult(torrent) {
  const provider = normalizeProvider(
    torrent?.raw?.provider,
    torrent?.detailUrl,
  );

  if (provider !== "torrentleech") {
    return fail(
      "validate",
      `Direct torrent download not supported for provider: ${provider}`,
      { provider },
    );
  }

  const downloadUrl = buildTorrentLeechDirectUrlFromSearchResult(torrent);
  if (!downloadUrl) {
    return fail(
      "validate",
      "Missing TorrentLeech fid/filename (or filename not .torrent).",
      {
        provider,
        fid: torrent?.raw?.fid,
        filename: torrent?.raw?.filename,
      },
    );
  }

  const profile = tryLoadBrowserCurlProfile();
  // Send cookies only.  The browser headers captured in curl-tl.txt (notably a
  // Firefox User-Agent) do not match curl's TLS fingerprint, so Cloudflare
  // answers with a 403 challenge page.  The search path sends cookies with no
  // headers at all and is never challenged.
  const headers = {};
  let cookieHeader = profile?.cookieHeader || "";

  const localCf = await loadLocalCfClearance(provider);
  if (localCf) {
    cookieHeader = upsertCookieValue(cookieHeader, "cf_clearance", localCf);
  }

  const r = await curlFetchBinary(downloadUrl, { headers, cookieHeader });
  const headText = r.stdout.slice(0, 600).toString("utf8");
  const looksHtml =
    /^\s*</.test(headText) || looksLikeCloudflareChallenge(headText);

  if (!r.ok || looksHtml) {
    const isCloudflare = looksLikeCloudflareChallenge(headText);
    return fail(
      "fetch-torrent",
      r.error || "Failed to fetch torrent via curl",
      {
        provider,
        downloadUrl,
        code: r.code,
        isCloudflare,
        bodyHead: headText.slice(0, 300),
        profilePath: profile?.path,
        hasProfile: Boolean(profile),
        hasCookies: Boolean(cookieHeader),
      },
    );
  }

  const valid = validateTorrentData(r.stdout);
  if (!valid.success) {
    return fail(
      "validate",
      valid.error || valid.reason || "Invalid torrent data",
      {
        provider,
        downloadUrl,
        bytes: r.stdout.length,
      },
    );
  }

  return ok({
    provider,
    downloadUrl,
    bytes: r.stdout.length,
    torrentData: r.stdout,
    method: "curl",
  });
}

/**
 * Fetch a .torrent for any provider, without uploading it anywhere.
 * Returns { success, torrentData, bytes, provider, method, downloadUrl, ... }
 */
export async function fetchTorrentFile(torrent) {
  if (!torrent || typeof torrent !== "object") {
    return fail("validate", "Torrent data is required");
  }

  const detailUrl = String(torrent?.detailUrl || "").trim();
  const provider = normalizeProvider(torrent?.raw?.provider, detailUrl);

  if (provider === "torrentleech") {
    return await fetchTorrentFileFromSearchResult(torrent);
  }

  if (provider === "thepiratebay" || provider === "eztv") {
    return await fetchTorrentFileFromInfoHash(torrent, provider);
  }

  // Limetorrents: try direct CDN link (raw.link / itorrents.net), then fall
  // back to scraping the per-torrent detail page (raw.desc).
  if (provider === "limetorrents") {
    const directLink = String(torrent?.raw?.link || "").trim();
    unilog(136, "directLink:", directLink);
    if (
      directLink &&
      (directLink.startsWith("http://") || directLink.startsWith("https://"))
    ) {
      try {
        const dlOrigin = new URL(directLink).origin;
        const torHeaders = {
          "User-Agent": DOWNLOAD_USER_AGENT,
          Accept: "application/x-bittorrent,application/octet-stream,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          Referer: `${dlOrigin}/`,
        };
        const dlResp = await sshFetch(directLink, { headers: torHeaders });
        unilog(137, "directLink fetch ok:", dlResp.ok);
        if (dlResp.ok) {
          const torrentData = Buffer.from(await dlResp.arrayBuffer());
          const valid = validateTorrentData(torrentData);
          unilog(
            138,
            "directLink valid:",
            valid.success,
            "bytes:",
            torrentData.length,
          );
          if (valid.success) {
            return ok({
              provider,
              downloadUrl: directLink,
              bytes: torrentData.length,
              torrentData,
              method: "direct-link",
            });
          }
        }
      } catch (e) {
        unilog(139, "directLink exception:", e?.message);
        // fall through to detail page
      }
    }

    // Fall back to scraping the per-torrent detail page
    const pageUrl = String(torrent?.raw?.desc || "").trim();
    unilog(140, "pageUrl:", pageUrl);
    if (!pageUrl) {
      return fail(
        "validate",
        "No detail page URL available for limetorrents torrent",
        { provider },
      );
    }
    const pageHeaders = {
      "User-Agent": DOWNLOAD_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      Referer: `${new URL(pageUrl).origin}/`,
    };
    const pageResp = await sshFetch(pageUrl, { headers: pageHeaders });
    unilog(141, "pageResp ok:", pageResp.ok);
    if (!pageResp.ok) {
      return fail("fetch-detail", "Failed to fetch limetorrents detail page", {
        provider,
        detailUrl: pageUrl,
      });
    }
    const pageHtml = await pageResp.text();
    if (looksLikeCloudflareChallenge(pageHtml)) {
      return fail(
        "fetch-detail",
        "Cloudflare challenge page (Just a moment...)",
        { provider, detailUrl: pageUrl },
      );
    }
    const torrentLinkMatch = pageHtml.match(
      /<a[^>]*href="([^"]*\.torrent)"[^>]*>/i,
    );
    if (!torrentLinkMatch) {
      return fail(
        "parse-detail",
        "No .torrent download link found in limetorrents detail page",
        { provider, detailUrl: pageUrl },
      );
    }
    let torrentDlUrl = torrentLinkMatch[1];
    if (
      !torrentDlUrl.startsWith("http://") &&
      !torrentDlUrl.startsWith("https://")
    ) {
      const base = new URL(pageUrl);
      torrentDlUrl = torrentDlUrl.startsWith("/")
        ? `${base.protocol}//${base.host}${torrentDlUrl}`
        : `${base.protocol}//${base.host}/${torrentDlUrl}`;
    }
    const torHeaders2 = {
      "User-Agent": DOWNLOAD_USER_AGENT,
      Accept: "application/x-bittorrent,application/octet-stream,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      Referer: `${new URL(pageUrl).origin}/`,
    };
    const torResp = await sshFetch(torrentDlUrl, { headers: torHeaders2 });
    if (!torResp.ok) {
      return fail(
        "fetch-torrent",
        "Failed to download limetorrents torrent from detail page",
        { provider, downloadUrl: torrentDlUrl },
      );
    }
    const torrentData = Buffer.from(await torResp.arrayBuffer());
    const valid = validateTorrentData(torrentData);
    if (!valid.success) {
      return fail(
        "validate",
        valid.error || valid.reason || "Invalid torrent data",
        {
          provider,
          downloadUrl: torrentDlUrl,
          bytes: torrentData.length,
        },
      );
    }

    return ok({
      provider,
      downloadUrl: torrentDlUrl,
      bytes: torrentData.length,
      torrentData,
      method: "detail-page",
    });
  }

  if (!detailUrl) {
    return fail("validate", "No detailUrl available for torrent", { provider });
  }

  // Load cookies from provider cookie jar (excluding cf_clearance)
  let allCookies = [];
  const cookieFile = provider === "iptorrents" ? "iptorrents.json" : null;
  if (cookieFile) {
    const cookiePath = path.join(getApiDataDir(), cookieFile);
    try {
      const cookieData = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
      allCookies = cookieData
        .filter((c) => c && c.name && c.value && c.name !== "cf_clearance")
        .map((c) => `${c.name}=${c.value}`);
    } catch {
      // ignore
    }
  }

  // We intentionally do not rely on any client-sent cfClearance.
  const cfCookie = await loadLocalCfClearance(provider);
  if (cfCookie) allCookies.push(`cf_clearance=${cfCookie}`);

  const detailOrigin = new URL(detailUrl).origin;
  const referer =
    provider === "iptorrents" ? "https://iptorrents.com/" : `${detailOrigin}/`;

  const headers = {
    "User-Agent": DOWNLOAD_USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    Referer: referer,
  };
  if (allCookies.length > 0) headers["Cookie"] = allCookies.join("; ");

  const torrentHeaders = {
    ...headers,
    Accept: "application/x-bittorrent,application/octet-stream,*/*;q=0.8",
  };

  const response = await sshFetch(detailUrl, { headers });
  if (!response.ok) {
    const snippet = await response.text().catch(() => "");
    const isCloudflare = looksLikeCloudflareChallenge(snippet);
    return fail(
      "fetch-detail",
      isCloudflare
        ? "Cloudflare challenge page (Just a moment...)"
        : "Failed to fetch detail page",
      {
        provider,
        detailUrl,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        cookiesSent: safeCookieNames(allCookies),
        hasCfClearance: Boolean(cfCookie),
        isCloudflare,
        bodySnippet: snippet ? snippet.substring(0, 500) : undefined,
      },
    );
  }

  const html = await response.text();
  if (looksLikeCloudflareChallenge(html)) {
    return fail(
      "fetch-detail",
      "Cloudflare challenge page (Just a moment...)",
      {
        provider,
        detailUrl,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        cookiesSent: safeCookieNames(allCookies),
        hasCfClearance: Boolean(cfCookie),
        isCloudflare: true,
        bodySnippet: html ? String(html).slice(0, 500) : undefined,
      },
    );
  }

  // Search for .torrent download link
  const torrentLinkPattern = /<a[^>]*href="([^"]*\.torrent)"[^>]*>/i;
  const match = html.match(torrentLinkPattern);
  if (!match) {
    return fail("parse-detail", "No .torrent download link found in HTML", {
      provider,
      detailUrl,
      cookiesSent: safeCookieNames(allCookies),
      hasCfClearance: Boolean(cfCookie),
    });
  }

  // Convert relative URL to absolute
  let absoluteDownloadUrl = match[1];
  if (
    !absoluteDownloadUrl.startsWith("http://") &&
    !absoluteDownloadUrl.startsWith("https://")
  ) {
    const baseUrl = new URL(detailUrl);
    if (absoluteDownloadUrl.startsWith("/")) {
      absoluteDownloadUrl = `${baseUrl.protocol}//${baseUrl.host}${absoluteDownloadUrl}`;
    } else {
      absoluteDownloadUrl = `${baseUrl.protocol}//${baseUrl.host}/${absoluteDownloadUrl}`;
    }
  }

  const torrentResponse = await sshFetch(absoluteDownloadUrl, {
    headers: torrentHeaders,
  });
  if (!torrentResponse.ok) {
    const snippet = await torrentResponse.text().catch(() => "");
    const isCloudflare = looksLikeCloudflareChallenge(snippet);
    return fail("fetch-torrent", "Failed to download torrent", {
      provider,
      downloadUrl: absoluteDownloadUrl,
      httpStatus: torrentResponse.status,
      httpStatusText: torrentResponse.statusText,
      cookiesSent: safeCookieNames(allCookies),
      hasCfClearance: Boolean(cfCookie),
      isCloudflare,
      bodySnippet: snippet ? snippet.substring(0, 500) : undefined,
    });
  }

  const torrentBuffer = await torrentResponse.arrayBuffer();
  const torrentData = Buffer.from(torrentBuffer);

  const headText = torrentData.slice(0, 600).toString("utf8");
  const looksHtml =
    /^\s*</.test(headText) || looksLikeCloudflareChallenge(headText);
  if (looksHtml) {
    return fail("fetch-torrent", "HTML returned instead of torrent", {
      provider,
      downloadUrl: absoluteDownloadUrl,
      bytes: torrentData.length,
      cookiesSent: safeCookieNames(allCookies),
      hasCfClearance: Boolean(cfCookie),
      bodySnippet: headText.slice(0, 500),
      isCloudflare: looksLikeCloudflareChallenge(headText),
    });
  }

  const valid = validateTorrentData(torrentData);
  if (!valid.success) {
    return fail(
      "validate",
      valid.error || valid.reason || "Invalid torrent data",
      {
        provider,
        downloadUrl: absoluteDownloadUrl,
        bytes: torrentData.length,
      },
    );
  }

  return ok({
    provider,
    method: "fetch",
    downloadUrl: absoluteDownloadUrl,
    bytes: torrentData.length,
    torrentData,
  });
}

/**
 * Upload a .torrent buffer to the configured remote watch folder via SFTP.
 */
export async function uploadTorrentToWatchFolder(
  torrentData,
  filenameHint = "",
) {
  if (!Buffer.isBuffer(torrentData) || torrentData.length === 0) {
    return fail("validate", "No torrent data provided");
  }

  const hash = Math.random().toString(36).substring(2, 15);
  const hint = sanitizeFilenameForWatch(filenameHint);
  const base = hint ? hint.replace(/\.torrent$/i, "") : hash;
  const safeBase =
    String(base || hash)
      .slice(0, 120)
      .trim() || hash;
  const torrentFilename = `${safeBase}-${hash}.torrent`;

  let sftpConfig;
  let remoteWatchDir;
  try {
    ({ sftpConfig, remoteWatchDir } = await getSftpSettings());
  } catch (e) {
    return fail("sftp-config", e?.message || String(e));
  }

  const remotePath = `${remoteWatchDir}/${torrentFilename}`;
  const tmpRemotePath = `${remoteWatchDir}/.${torrentFilename}.${hash}.tmp`;
  const sftp = new Client();
  try {
    await sftp.connect(sftpConfig);

    // Atomic-ish write for qBittorrent watch folders:
    // upload to a temp filename (non-.torrent) so qBittorrent doesn't attempt
    // to parse it while it's still being written, then rename into place.
    await sftp.put(torrentData, tmpRemotePath);
    await sftp.rename(tmpRemotePath, remotePath);
    await sftp.end();
  } catch (e) {
    try {
      // Best-effort cleanup of temp file.
      await sftp.delete(tmpRemotePath);
    } catch {
      /* ignore */
    }
    try {
      await sftp.end();
    } catch {
      /* ignore */
    }
    return fail("sftp-put", e?.message || String(e), { remotePath });
  }

  return ok({
    remotePath,
    bytes: torrentData.length,
    filename: torrentFilename,
  });
}

/**
 * Download torrent and prepare for qBittorrent
 * @param {Object} torrent - The complete torrent object
 * @returns {Promise<{success:boolean, stage?:string, reason?:string, provider?:string, httpStatus?:number, httpStatusText?:string, savedFile?:string, cookiesSent?:string[], hasCfClearance?:boolean, downloadUrl?:string, detailUrl?:string, warning?:string}>}
 */
export async function download(torrent) {
  if (!torrent || typeof torrent !== "object") {
    return fail("validate", "Torrent data is required");
  }

  // fetchTorrentFile already validates the torrent bytes in every branch.
  const fetched = await fetchTorrentFile(torrent);
  if (!fetched.success) return fetched;

  const hint =
    torrent?.raw?.filename || torrent?.raw?.title || "download.torrent";
  const uploaded = await uploadTorrentToWatchFolder(fetched.torrentData, hint);
  if (!uploaded.success) return uploaded;

  return ok({
    provider: fetched.provider,
    method: fetched.method,
    downloadUrl: fetched.downloadUrl,
    remotePath: uploaded.remotePath,
    filename: uploaded.filename,
    bytes: fetched.bytes,
  });
}
