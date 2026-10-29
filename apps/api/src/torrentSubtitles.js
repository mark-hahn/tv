import fs from "fs";
import path from "node:path";
import parseTorrent from "parse-torrent";
import { sshCurlFetch } from "./sshTunnel.js";
import { getApiDataDir } from "./tvPaths.js";

const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SRT_FILE_RE = /\.srt$/i;
const VIDEO_FILE_RE = /\.(?:mkv|mp4|m4v|avi|ts|wmv|mov|mpe?g)$/i;
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
// An NFO subtitle value that names tracks: a count of 1+ or a word, not 0/none/no/n/a.
const NFO_SUB_VALUE = String.raw`(?!0\b|none\b|no\b|n\/a\b)[1-9a-z]`;

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
    /(^|\n)\s*Audio(?:\s*#?\d+)?\b[\s\S]{0,1800}?(?=\n\s*(?:Video|Text|Subtitle|Subtitles|Subs?|Menu|Chapters|General|Source|Torrent Description|Pack Contents|Screens?|$)\b)/gi,
    "\n",
  );
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function findTorrentDownloadUrls(html, detailUrl) {
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
    // IPT's links are page-relative ("download.php/..."), but the site serves
    // them from its root, as download.js resolves them.
    const url = absoluteUrl(/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(href) ? href : `/${href}`, detailUrl);
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

  // The page also links related releases' .torrents: keep only its own,
  // the ones carrying its torrent id.
  const id = String(detailUrl || "").match(/(?:\/torrent\/|\/t\/|[?&]id=)(\d+)/)?.[1];
  if (!id) return urls;
  const ownRe = new RegExp(String.raw`(?:/|[?&]id=)${id}(?:[/&.]|$)`);
  return urls.filter((url) => ownRe.test(url));
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

// The page's answer, overruled by the torrent's file list: an .srt file is a
// yes, and videos that are all .avi (no subtitle tracks) are a no unless the
// page says yes.
export function judgeWithFiles(pageResult, files) {
  if (!Array.isArray(files)) return pageResult;
  const fileResult = classifyTorrentSubtitleFiles(files);
  if (fileResult.status === "yes") return fileResult;
  if (pageResult.status === "yes") return pageResult;
  const videos = files
    .map((file) => String(file?.path || file?.name || file || "").trim())
    .filter((filePath) => VIDEO_FILE_RE.test(filePath));
  if (videos.length > 0 && videos.every((filePath) => /\.avi$/i.test(filePath))) {
    return {
      status: "no",
      confidence: "medium",
      source: "torrent-file",
      reason: "videos are all .avi, which carry no subtitle tracks, and no .srt files",
      evidence: videos.slice(0, 3),
    };
  }
  return pageResult;
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

// The release's own part of a detail page, without comments, related
// torrents and site menus: TL "Torrent Description" (not on every page) or
// "NFO" to "Comments", IPT "Size: 2.90 GB in 2 files" to "Thank Uploader".
// Null when the page has neither (a login, Cloudflare or error page).
function releaseSection(text) {
  const start = text.search(/^(?:Torrent Description|NFO|Size: .+ in \d+ files?)[ \t]*$/m);
  if (start < 0) return null;
  const rest = text.slice(start);
  const end = rest.search(/^(?:Comments|Thank Uploader)[ \t]*$/m);
  return end < 0 ? rest : rest.slice(0, end);
}

// MediaInfo text tracks: a "Text" / "Text #2" line, then its "Key : value"
// lines (IPT puts a blank line between them).
function mediaInfoTextTracks(text) {
  const tracks = [];
  for (const m of text.matchAll(
    /^Text(?:[ \t]*#[ \t]*\d+)?[ \t]*\n((?:[ \t]*\n|[A-Za-z][^\n:]{0,40}:[^\n]*(?:\n|$))+)/gm,
  )) {
    if (/^(?:Format|Codec ID|Language)[ \t]*:/m.test(m[1])) tracks.push(m[1]);
  }
  return tracks;
}

export function analyzePageText(html, { torrent = null } = {}) {
  const pageTitle = pageTitleFromHtml(html);
  const section = releaseSection(htmlToText(html));
  if (section === null) return failStatus(`not a torrent detail page: "${pageTitle}"`);
  const cleanedText = stripAudioSections(stripProviderChrome(section));
  const compact = compactText(cleanedText);
  const evidence = [];

  // A forced track only covers foreign-language parts.
  const textTracks = mediaInfoTextTracks(cleanedText);
  const fullTracks = textTracks.filter(
    (t) => !/^Forced[ \t]*:[ \t]*Yes\b/im.test(t) && !/^Title[ \t]*:[^\n]*\bforced\b/im.test(t),
  );
  // Codec IDs alone catch a MediaInfo whose lines were run together.
  const mediaInfoTextSection =
    fullTracks.length > 0 ||
    (textTracks.length === 0 && /\bCodec ID ?: ?S_(?:TEXT|HDMV|VOBSUB)/.test(compact));

  if (textTracks.length > 0 && fullTracks.length === 0) {
    return {
      status: "no",
      confidence: "medium",
      source: "page-mediainfo",
      reason: "MediaInfo lists only forced subtitle tracks",
      evidence: ["MediaInfo forced Text tracks"],
    };
  }

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

  // Phrases and "label: value" lines are matched within one line of
  // cleanedText: in compact, "Language: English" + "Subtitles: N/A" on the
  // next line reads as "English Subtitles".
  const explicitSubtitle =
    /\b(?:english|eng|multi(?:ple)?|full)[ \t]+subtitles?\b/i.test(cleanedText) ||
    /\bsubtitles?[ \t]*(?:included|available|yes|english|eng|multi|muxed|embedded)\b/i.test(
      cleanedText,
    ) ||
    /\b(?:embedded|muxed)\s+subtitles?\b/i.test(compact) ||
    /(?:^|\s)\.srt\b|\bsrt\b/i.test(compact) ||
    // "Subtitles: English", NFO "Subs ......: 2: English, Spanish", IPT's
    // "Subtitle(s) : English (US)" (not a lone "English (Forced)"), or a
    // "── Subtitles ──" heading over "Count ..: 1" / "Tracks ..: English".
    new RegExp(
      String.raw`\bsub(?:title)?(?:s|\(s\))?[ \t]*\.*[ \t]*[:=][ \t]*(?![^,\n]*\bforced\b[^,\n]*$)${NFO_SUB_VALUE}`,
      "im",
    ).test(cleanedText) ||
    new RegExp(
      String.raw`\bsubtitles?\s*[─━═-]{2,}[\s\S]{0,80}?\b(?:count|tracks?|languages?)\s*\.*\s*:\s*${NFO_SUB_VALUE}`,
      "i",
    ).test(compact);

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
    /\b(?:no|without)[ \t]+(?:embedded[ \t]+)?subtitles?\b/i.test(cleanedText) ||
    /\b(?:subtitles?|subtitle\(s\)|subs?)[ \t]*\.*[ \t]*[:=-][ \t]*(?:none|no|n\/a)\b/i.test(
      cleanedText,
    );

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

  // A MediaInfo that lists General, Video and Audio but no Text track. Read
  // from the section, since cleanedText has its Audio blocks cut.
  const mediaInfoWithoutText =
    textTracks.length === 0 &&
    ["General", "Video", "Audio"].every((heading) =>
      new RegExp(String.raw`^${heading}[ \t]*\n(?:[ \t]*\n)*[A-Za-z][^\n:]{0,40}:`, "m").test(section),
    );
  if (mediaInfoWithoutText) {
    return {
      status: "no",
      confidence: "medium",
      source: "page-mediainfo",
      reason: "MediaInfo lists video and audio but no Text track",
      evidence: ["MediaInfo without Text section"],
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
    status: "maybe",
    confidence: "low",
    source: "page-text",
    reason: "provider page does not say whether there are subtitles",
    evidence,
  };
}

export async function detectTorrentSubtitlesByUrl(
  detailUrl,
  { torrent = null, knownFiles = null } = {},
) {
  const url = String(detailUrl || "").trim();
  if (!url) return failStatus("missing detail URL");

  let page;
  try {
    page = await fetchProviderPage(url);
  } catch (e) {
    return failStatus(e?.message || String(e));
  }

  // Page text analysis is synchronous — run it immediately.
  const pageResult = analyzePageText(page.html, { torrent });

  // High-confidence from page text — skip the torrent download entirely.
  if (pageResult.status === "yes" && pageResult.confidence === "high") {
    return pageResult;
  }

  // Use caller-supplied file list to avoid a redundant torrent download.
  let torrentFiles = Array.isArray(knownFiles) ? knownFiles : null;
  let downloadUrl;

  if (!torrentFiles) {
    try {
      const torrentFile = await fetchTorrentFileListFromPage(
        url,
        page.html,
        page.profile,
      );
      if (torrentFile.files) {
        torrentFiles = torrentFile.files;
        downloadUrl = torrentFile.downloadUrl;
      }
    } catch {
      // page text result is still useful
    }
  }

  const result = judgeWithFiles(pageResult, torrentFiles);
  return result.source === "torrent-file" && downloadUrl ? { ...result, downloadUrl } : result;
}

export async function detectTorrentSubtitlesForTorrent(torrent, { files = null } = {}) {
  // Fast path: .srt already in the known file list.
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

  // Pass known files so the URL-level check skips the torrent re-download.
  return await detectTorrentSubtitlesByUrl(detailUrl, { torrent, knownFiles: files });
}