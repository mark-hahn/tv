import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Client from "ssh2-sftp-client";
import { sshCurlFetch } from "./sshTunnel.js";
import { loadCreds } from "./qb-cred.js";
import parseTorrent from "parse-torrent";
import parseTorrentTitle from "parse-torrent-title";

import {
  getApiDataDir,
  getApiMiscDir,
  getApiSecretsDir,
  preferSharedReadPath,
} from "./tvPaths.js";

const LOG_APPS_API_DATA_MISC_TEMP_TXT = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function appendTorrentBytesLog({ provider, method, downloadUrl, torrentData }) {
  if (!LOG_APPS_API_DATA_MISC_TEMP_TXT) return;
  try {
    const outPath = path.join(getApiMiscDir(), "temp.txt");
    const buf = Buffer.isBuffer(torrentData)
      ? torrentData
      : Buffer.from(torrentData || []);

    let parsed = null;
    try {
      parsed = parseTorrent(buf);
    } catch {
      parsed = null;
    }

    const maxBytes = (() => {
      const raw = String(process.env.TOR_LOG_TORRENT_MAX_BYTES || "").trim();
      const n = raw ? Number(raw) : 200_000;
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200_000;
    })();

    const truncated = buf.length > maxBytes;
    const slice = truncated ? buf.subarray(0, maxBytes) : buf;

    const payload = {
      ts: new Date().toISOString(),
      event: "torrent-bytes",
      provider: provider || undefined,
      method: method || undefined,
      downloadUrl: downloadUrl || undefined,
      bytes: buf.length,
      truncated,
      loggedBytes: slice.length,
      infoHash: parsed?.infoHash || undefined,
      name: parsed?.name || undefined,
      torrentBase64: slice.toString("base64"),
    };

    fs.appendFileSync(outPath, JSON.stringify(payload) + "\n", "utf8");
  } catch {
    // ignore logging failures
  }
}

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
  // Prefer data/curl-tl.txt (primary). NO FALLBACKS.
  try {
    const candidates = [path.join(getApiDataDir(), "curl-tl.txt")];
    const p = candidates.find((x) => fs.existsSync(x));
    if (!p) return null;
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
    const inPath = path.join(getApiDataDir(), "cf-clearance.local.json");
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

function validateTorrentData(torrentData) {
  try {
    const parsedTorrent = parseTorrent(torrentData);
    const files = Array.isArray(parsedTorrent?.files)
      ? parsedTorrent.files
      : [];
    const allPaths = files
      .map((f) => String(f?.path || f?.name || ""))
      .filter(Boolean);

    // Prefer video files for validation (avoid NFO/SRT triggering false failures).
    const pathsToCheck = allPaths.filter(isVideoFile);
    const checkList = pathsToCheck.length > 0 ? pathsToCheck : allPaths;

    let missing = false;
    const checkedFiles = [];

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
      }

      checkedFiles.push({ file: p, parsed: info });
      if (!info?.season || !info?.episode) missing = true;
    }

    if (missing) {
      try {
        const debugInfo = {
          message: "Validation failed",
          files: allPaths,
          checkedFiles: checkedFiles,
        };
        fs.writeFileSync(
          "/root/dev/apps/tv/temp.txt",
          JSON.stringify(debugInfo, null, 2),
        );
        try {
          fs.writeFileSync("/root/dev/apps/tv/temp.torrent", torrentData);
        } catch (e) {
          console.error("Failed to dump torrent", e);
        }
      } catch (err) {
        console.error("Failed to write debug info to temp.txt", err);
      }

      return fail(
        "validate-torrent-files",
        "Torrent file name is missing a season or episode number.",
        {
          fileCount: allPaths.length,
          checkedCount: checkList.length,
          checkedFiles,
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
  const videoPaths = allPaths.filter(isVideoFile);
  const picked = videoPaths.length > 0 ? videoPaths : allPaths;

  const titles = picked.map((p) => path.basename(p));

  return Array.from(new Set(titles)).filter(Boolean);
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
  const headers = profile?.headers || {};
  let cookieHeader = profile?.cookieHeader || "";

  // Source of truth: cf-clearance.local.json (written by client Save Cookies).
  // req-browser.txt is treated as an immutable template; we only patch an in-memory copy.
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

  // Debug support: persist the fetched torrent bytes (base64; truncated by TOR_LOG_TORRENT_MAX_BYTES).
  appendTorrentBytesLog({
    provider,
    method: "curl",
    downloadUrl,
    torrentData: r.stdout,
  });

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

  // Source of truth for cf_clearance is the local file written by the client Save Cookies.
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

  const fetched = await fetchTorrentFile(torrent);
  if (!fetched.success) return fetched;

  const valid = validateTorrentData(fetched.torrentData);
  if (!valid.success) return valid;

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
