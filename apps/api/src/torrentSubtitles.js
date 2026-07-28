import fs from "fs";
import path from "node:path";
import parseTorrent from "parse-torrent";
import { sshCurlFetch } from "./sshTunnel.js";
import { getApiDataDir } from "./tvPaths.js";

const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SRT_FILE_RE = /\.srt$/i;
const PACKED_ARCHIVE_RE = /\.(?:rar|r\d\d|001)$/i;
const POSITIVE_GROUP_PRIORS = new Set([
  "d3g",
  "ethel",
  "framestor",
  "heteam",
  "kratos",
  "moron",
  "ouija",
  "sigma",
  "xebec",
]);
const NEGATIVE_GROUP_PRIORS = new Set(["megusta"]);

function failStatus(reason, extra = {}) {
  return {
    status: "maybe",
    confidence: "low",
    source: "error",
    reason,
    evidence: [],
    ...extra,
  };
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(String(href || ""), baseUrl).href;
  } catch {
    return "";
  }
}

function providerFromUrl(url) {
  const s = String(url || "").toLowerCase();
  if (s.includes("iptorrents.com")) return "iptorrents";
  if (s.includes("torrentleech.org")) return "torrentleech";
  return "";
}

function providerFromTorrent(torrent) {
  const raw = String(torrent?.raw?.provider || torrent?.provider || "")
    .toLowerCase()
    .trim();
  if (raw.includes("iptorrents")) return "iptorrents";
  if (raw.includes("torrentleech")) return "torrentleech";
  return providerFromUrl(torrent?.detailUrl || torrent?.raw?.desc || "");
}

function readCurlProfile(provider) {
  const filename = provider === "iptorrents" ? "curl-ipt.txt" : "curl-tl.txt";
  const raw = fs.readFileSync(path.join(getApiDataDir(), filename), "utf8");
  const headers = {};
  let cookieHeader = "";

  for (const match of raw.matchAll(/\s-H\s+'([^']+)'|\s-H\s+"([^"]+)"/gi)) {
    const header = match[1] || match[2] || "";
    const idx = header.indexOf(":");
    if (idx <= 0) continue;
    const key = header.slice(0, idx).trim();
    const value = header.slice(idx + 1).trim();
    if (key && value) headers[key] = value;
  }

  const cookieMatch = raw.match(/\s-b\s+'([^']*)'|\s-b\s+"([^"]*)"/i);
  if (cookieMatch) cookieHeader = (cookieMatch[1] || cookieMatch[2] || "").trim();

  for (const key of ["Cookie", "cookie"]) {
    if (!cookieHeader && headers[key]) cookieHeader = String(headers[key]).trim();
    delete headers[key];
  }

  return { headers, cookieHeader };
}

function htmlEntityDecode(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(html) {
  return htmlEntityDecode(
    String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:div|p|pre|li|tr|table|section|article|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pageTitleFromHtml(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToText(match[1]) : "";
}

function cleanTitleForGroup(title) {
  return String(title || "")
    .replace(/^Torrent Details for\s+/i, "")
    .replace(/\s+::\s+TorrentLeech\.org.*$/i, "")
    .replace(/\s+-\s+TorrentLeech.*$/i, "")
    .replace(/\s+-\s+IPTorrents.*$/i, "")
    .replace(/\s+-\s+#\d+\s+Private Tracker.*$/i, "")
    .trim();
}

function groupFromTitle(title) {
  const cleaned = cleanTitleForGroup(title);
  const match = cleaned.match(/-([A-Za-z0-9]+)(?:\s*[\[(][^\])]+[\])])?\s*$/);
  return match?.[1] ? match[1].trim() : "";
}

function groupFromTorrent(torrent, pageTitle = "") {
  const parsedGroup = String(torrent?.parsed?.group || "").trim();
  if (parsedGroup) return parsedGroup;
  return groupFromTitle(
    pageTitle || torrent?.raw?.title || torrent?.title || torrent?.clientTitle || "",
  );
}

function stripProviderChrome(text) {
  return String(text || "")
    .replace(
      /\bTorrent\s+[^\n.]{1,260}\s+has been deleted\.\s+Reason:\s+[^\n.]{1,260}\./gi,
      " ",
    )
    .replace(
      /\b(?:Download|Search)\s+Subtitles\b[^\n]{0,260}(?:Select language #Downloads Name Close)?/gi,
      " ",
    )
    .replace(/\bSelect language #Downloads Name Close\b/gi, " ");
}

function stripAudioSections(text) {
  return String(text || "").replace(
    /(^|\n)\s*Audio(?:\s*#?\d+)?\b[\s\S]{0,1800}?(?=\n\s*(?:Video|Text|Subtitle|Subtitles|Menu|Chapters|General|Source|Torrent Description|Pack Contents|Screens?|$)\b)/gi,
    "\n",
  );
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function findTorrentDownloadUrls(html, detailUrl) {
  const urls = [];
  const seen = new Set();
  let detailHost = "";
  try {
    detailHost = new URL(detailUrl).hostname.toLowerCase();
  } catch {
    detailHost = "";
  }

  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = htmlEntityDecode(match[1] || "").trim();
    if (!href) continue;
    const lower = href.toLowerCase();
    const isTorrentLink =
      lower.includes(".torrent") ||
      lower.includes("/download/") ||
      lower.includes("download.php") ||
      lower.includes("download?id=");
    if (!isTorrentLink) continue;
    const url = absoluteUrl(href, detailUrl);
    if (detailHost) {
      try {
        if (new URL(url).hostname.toLowerCase() !== detailHost) continue;
      } catch {
        continue;
      }
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

function looksLikeHtml(buffer) {
  const head = Buffer.from(buffer || []).slice(0, 600).toString("utf8");
  return /^\s*</.test(head) || /<html\b|<title\b|cloudflare|just a moment/i.test(head);
}

function filesFromTorrentBytes(torrentData) {
  const parsed = parseTorrent(torrentData);
  const files = Array.isArray(parsed?.files) ? parsed.files : [];
  if (files.length > 0) {
    return files
      .map((file) => ({
        path: String(file?.path || file?.name || ""),
        size: typeof file?.length === "number" ? file.length : null,
      }))
      .filter((file) => file.path);
  }

  const name = String(parsed?.name || "").trim();
  return name
    ? [{ path: name, size: typeof parsed?.length === "number" ? parsed.length : null }]
    : [];
}

function hasPackedArchiveFiles(files) {
  return (Array.isArray(files) ? files : []).some((file) =>
    PACKED_ARCHIVE_RE.test(String(file?.path || file?.name || file || "")),
  );
}

export function classifyTorrentSubtitleFiles(files) {
  const subtitleFiles = (Array.isArray(files) ? files : [])
    .map((file) => String(file?.path || file?.name || file || "").trim())
    .filter((filePath) => SRT_FILE_RE.test(filePath));

  if (subtitleFiles.length === 0) {
    return {
      status: "no",
      confidence: "high",
      source: "torrent-file",
      reason: "no .srt files in torrent metadata",
      evidence: [],
    };
  }

  return {
    status: "yes",
    confidence: "high",
    source: "torrent-file",
    reason: ".srt file listed in torrent metadata",
    evidence: subtitleFiles.slice(0, 8),
  };
}

async function fetchProviderPage(detailUrl) {
  const provider = providerFromUrl(detailUrl);
  if (!provider) throw new Error(`Unsupported provider URL: ${detailUrl}`);
  const profile = readCurlProfile(provider);
  const headers = {
    "User-Agent": DOWNLOAD_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    Referer: provider === "iptorrents" ? "https://iptorrents.com/" : "https://www.torrentleech.org/",
    ...profile.headers,
  };
  const result = await sshCurlFetch(detailUrl, {
    headers,
    cookieHeader: profile.cookieHeader,
  });
  if (!result.ok) {
    const stderr = result.stderr.toString("utf8").slice(0, 300);
    throw new Error(`detail fetch failed (exit ${result.code}): ${stderr}`);
  }
  return {
    html: result.stdout.toString("utf8"),
    provider,
    profile,
  };
}

async function fetchTorrentFileListFromPage(detailUrl, html, profile) {
  const urls = findTorrentDownloadUrls(html, detailUrl);
  const headers = {
    "User-Agent": DOWNLOAD_USER_AGENT,
    Accept: "application/x-bittorrent,application/octet-stream,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    Referer: detailUrl,
    ...(profile?.headers || {}),
  };

  for (const url of urls) {
    const result = await sshCurlFetch(url, {
      headers,
      cookieHeader: profile?.cookieHeader || "",
    });
    if (!result.ok || looksLikeHtml(result.stdout)) continue;
    try {
      return {
        files: filesFromTorrentBytes(result.stdout),
        downloadUrl: url,
      };
    } catch {
      // Try the next download link on the page.
    }
  }

  return { files: null, downloadUrl: "" };
}

function analyzePageText(html, { torrent = null } = {}) {
  const pageTitle = pageTitleFromHtml(html);
  const rawText = htmlToText(html);
  const cleanedText = stripAudioSections(stripProviderChrome(rawText));
  const compact = compactText(cleanedText);
  const evidence = [];

  const mediaInfoTextSection =
    /\bText(?:\s*#?\d+)?\b[\s\S]{0,900}\b(?:ID|Format|Codec ID|Title|Language|Default|Forced)\s*(?:[:.]|\.{2,}\s*:)/i.test(
      cleanedText,
    ) ||
    /\bCodec ID\s*(?:[:.]|\.{2,}\s*:)\s*S_TEXT/i.test(cleanedText) ||
    /\bText\s*(?:#?\d+)?\s+(?:ID|Format|Codec ID|Language|Default|Forced)\b/i.test(
      compact,
    );

  if (mediaInfoTextSection) {
    evidence.push("MediaInfo Text section");
    return {
      status: "yes",
      confidence: "high",
      source: "page-mediainfo",
      reason: "MediaInfo Text section found",
      evidence,
    };
  }

  const explicitSubtitle =
    /\b(?:english|eng|multi(?:ple)?|full|forced)\s+subtitles?\b/i.test(compact) ||
    /\bsubtitles?\s*(?:[:=-]|included|available|yes|english|eng|multi|muxed|embedded)\b/i.test(
      compact,
    ) ||
    /\b(?:embedded|muxed)\s+subtitles?\b/i.test(compact) ||
    /(?:^|\s)\.srt\b|\bsrt\b/i.test(compact);

  if (explicitSubtitle) {
    evidence.push("explicit subtitle text");
    return {
      status: "yes",
      confidence: "medium",
      source: "page-text",
      reason: "provider page text explicitly mentions subtitles",
      evidence,
    };
  }

  const explicitNo =
    /\b(?:no|without)\s+(?:embedded\s+)?subtitles?\b/i.test(compact) ||
    /\b(?:subtitles?|subs?)\s*[:=-]\s*(?:none|no|n\/a)\b/i.test(compact);

  if (explicitNo) {
    evidence.push("explicit no-subtitle text");
    return {
      status: "no",
      confidence: "medium",
      source: "page-text",
      reason: "provider page text says subtitles are absent",
      evidence,
    };
  }

  const languageOutsideAudio = /\b(?:english|eng|languages?)\b/i.test(compact);
  const group = groupFromTorrent(torrent, pageTitle);
  const groupKey = group.toLowerCase();

  if (languageOutsideAudio) evidence.push("language mention outside audio section");
  if (group) evidence.push(`release group: ${group}`);

  if (NEGATIVE_GROUP_PRIORS.has(groupKey)) {
    return {
      status: "no",
      confidence: "low",
      source: "group-prior",
      reason: `${group} releases usually do not include subtitles`,
      evidence,
    };
  }

  if (POSITIVE_GROUP_PRIORS.has(groupKey)) {
    return {
      status: "maybe",
      confidence: "low",
      source: "group-prior",
      reason: `${group} has correlated with subtitles, but the page has no direct proof`,
      evidence,
    };
  }

  return {
    status: "no",
    confidence: "medium",
    source: "page-text",
    reason: "no subtitle evidence found in provider page text",
    evidence,
  };
}

export async function detectTorrentSubtitlesByUrl(detailUrl, { torrent = null } = {}) {
  const url = String(detailUrl || "").trim();
  if (!url) return failStatus("missing detail URL");

  let page;
  try {
    page = await fetchProviderPage(url);
  } catch (e) {
    return failStatus(e?.message || String(e));
  }

  let packedArchiveMaybe = false;
  try {
    const torrentFile = await fetchTorrentFileListFromPage(
      url,
      page.html,
      page.profile,
    );
    if (torrentFile.files) {
      const fileResult = classifyTorrentSubtitleFiles(torrentFile.files);
      if (fileResult.status === "yes") {
        return {
          ...fileResult,
          downloadUrl: torrentFile.downloadUrl || undefined,
        };
      }
      packedArchiveMaybe = hasPackedArchiveFiles(torrentFile.files);
    }
  } catch {
    // The page-text pass is still useful when the .torrent link is unavailable.
  }

  const pageResult = analyzePageText(page.html, { torrent });
  if (pageResult.status === "no" && packedArchiveMaybe) {
    return {
      status: "maybe",
      confidence: "low",
      source: "torrent-file",
      reason: "torrent metadata is packed archives, so embedded subtitles cannot be verified without unpacking",
      evidence: pageResult.evidence,
    };
  }
  return pageResult;
}

export async function detectTorrentSubtitlesForTorrent(torrent, { files = null } = {}) {
  const packedArchiveMaybe = hasPackedArchiveFiles(files);
  if (Array.isArray(files)) {
    const fileResult = classifyTorrentSubtitleFiles(files);
    if (fileResult.status === "yes") return fileResult;
  }

  const detailUrl = String(torrent?.detailUrl || torrent?.raw?.desc || "").trim();
  if (!detailUrl) return failStatus("torrent has no provider detail URL");

  const provider = providerFromTorrent(torrent);
  if (provider !== "iptorrents" && provider !== "torrentleech") {
    return failStatus(`unsupported provider: ${provider || "unknown"}`);
  }

  const result = await detectTorrentSubtitlesByUrl(detailUrl, { torrent });
  if (result.status === "no" && packedArchiveMaybe) {
    return {
      status: "maybe",
      confidence: "low",
      source: "torrent-file",
      reason: "torrent metadata is packed archives, so embedded subtitles cannot be verified without unpacking",
      evidence: result.evidence,
    };
  }
  return result;
}