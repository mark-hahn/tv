import express from "express";
import https from "https";
import fs from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import parseTorrent from "parse-torrent";
import * as search from "./search.js";
import { searchTorrentsInChild } from "./searchInChild.js";
import * as download from "./download.js";
import {
  detectTorrentSubtitlesByUrl,
  detectTorrentSubtitlesForTorrent,
} from "./torrentSubtitles.js";
import {
  start as startTvmaze,
  searchShowsByName,
  unmarkShowBrowsed,
} from "./tvmaze.js";
import {
  getQbtInfo,
  getQbtFiles,
  delQbtTorrent,
  recheckQbtTorrent,
  spaceAvail,
  spaceAvailUsb,
  spaceAvailMedia,
  flexgetHistory,
  addQbtTorrent,
  addQbtMagnet,
  getUsbFiles,
  renameUsbFile,
  deleteUsbFiles,
  getUsbMovies,
  deleteUsbMovies,
  usbCpToken,
  readUsbTextFile,
} from "./usb.js";
import { getLocalFiles, renameLocalFile, swapLocalOld } from "./local.js";
import { isTextBuffer } from "./textProbe.js";
import { enrichQbtStats } from "./qbt-stats.js";
import {
  getBrowseShow,
  getAllBrowse,
  hasBrowseShow,
  ackBrowsed,
  removeResultTitleByTvdbId,
  buildShowTitle,
} from "./browse.js";
import * as reviews from "./reviews.js";
import { checkFiles as tvProcCheckFiles } from "./tv-proc.js";
import { getActorCredits } from "./imdb-credits.js";
import {
  parseFileSeasonEpisode,
  parseTitleFromFilename,
  TV_BLOCKED,
} from "@tv/share";
import { ChannelPeer } from "@tv/share/channelPeer";
import { unilog, setUnilogSink, logHere } from "@tv/share";
import parseTorrentTitlePkg from "parse-torrent-title";
import {
  getApiDataDir,
  getTvprocJsonPath,
  getApiMiscDir,
  getApiSecretsDir,
} from "./tvPaths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTERNAL_SRVR_SUBS_COUNT_URL =
  "http://127.0.0.1:8739/api/subsCountEpisodes";
const INTERNAL_SRVR_LOG_URL = "http://127.0.0.1:8739/api/log";
const QBT_CHANNEL_POLL_MS = 5000;
const BROWSE_HAS_MORE_CHANNEL_POLL_MS = 60000;

setUnilogSink(({ logId, ts, message }) => {
  fetch(INTERNAL_SRVR_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logId, pid: "tv-api", ts, message }),
  }).catch(() => {});
});
const VIDEO_EXTENSIONS = new Set([
  ".mkv",
  ".mp4",
  ".avi",
  ".m4v",
  ".mov",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".ts",
  ".m2ts",
  ".webm",
]);
const PACKED_ARCHIVE_EXTENSIONS = new Set([".rar", ".001"]);
const FORCE_DOWN_POLL_MS = 10000;
const FORCE_DOWN_MAX_POLLS = 720;
function formatPstTimestamp(date = new Date()) {
  // Match the reelgood logger behavior: approximate PST/PDT using month.
  const now = date instanceof Date ? date : new Date();
  const month = now.getUTCMonth();
  const isDST = month >= 2 && month <= 10; // Approximate DST period (Mar-Nov)
  const offsetHours = isDST ? -7 : -8;
  const pstTime = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);

  const mm = String(pstTime.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(pstTime.getUTCDate()).padStart(2, "0");
  const hh = String(pstTime.getUTCHours()).padStart(2, "0");
  const min = String(pstTime.getUTCMinutes()).padStart(2, "0");
  const ss = String(pstTime.getUTCSeconds()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}:${ss}`;
}

function appendCallsLog({ endpoint, method, ok, result, error }) {
  try {
    const outPath = path.join(getApiMiscDir(), "calls.log");

    const asArray = Array.isArray(result)
      ? result.map(String)
      : result &&
          typeof result === "object" &&
          Array.isArray(result.existingTitles)
        ? result.existingTitles.map(String)
        : [];
    const last5 = asArray.length > 5 ? asArray.slice(-5) : asArray;
    const payload = {
      ts: formatPstTimestamp(new Date()),
      endpoint,
      method,
      ok: Boolean(ok),
      last5,
      count: Array.isArray(result) ? result.length : null,
      error: error
        ? {
            message: error?.message || String(error),
            stack: error?.stack || null,
          }
        : null,
    };
    const txt = `==========\n${JSON.stringify(payload, null, 2)}\n`;
    fs.appendFileSync(outPath, txt, "utf8");
  } catch {
    // ignore logging failures
  }
}

function appendReviewCallsLog({
  endpoint,
  method,
  event,
  ok,
  args,
  result,
  error,
}) {
  try {
    const outPath = path.join(getApiMiscDir(), "review-calls.log");

    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let logResult = result;
    if (Array.isArray(result)) {
      logResult = {
        count: result.length,
        reviews: result.slice(0, 2),
      };
    } else if (result && Array.isArray(result.reviews)) {
      logResult = {
        ...result,
        reviews: result.reviews.slice(0, 2),
      };
    }

    const payload = {
      ts: formatPstTimestamp(new Date()),
      endpoint,
      method,
      event,
      ok: event === "START" ? undefined : Boolean(ok),
      args,
      result: logResult,
      error: error
        ? {
            message: error?.message || String(error),
            stack: error?.stack || null,
          }
        : null,
    };
    const txt = `==========\n${JSON.stringify(payload, null, 2)}\n`;
    fs.appendFileSync(outPath, txt, "utf8");
  } catch (err) {
    unilog(203, "Review logging failed", err);
  }
}

function isVideoPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function isPackedArchivePath(filePath) {
  const text = String(filePath || "").toLowerCase();
  const ext = path.extname(text);
  if (PACKED_ARCHIVE_EXTENSIONS.has(ext)) return true;
  return /\.r\d\d$/i.test(text);
}

function getPackedArchiveStem(filePath) {
  return String(filePath || "").replace(/\.(rar|r\d\d|001)$/i, "");
}

function getPackedArchiveRepresentatives(files) {
  const byStem = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const filePath = String(file?.path || "");
    if (!isPackedArchivePath(filePath)) continue;
    const stem = getPackedArchiveStem(filePath);
    if (!stem) continue;
    const current = byStem.get(stem);
    const ext = path.extname(filePath).toLowerCase();
    const rank = ext === ".rar" ? 0 : ext === ".001" ? 1 : 2;
    if (!current || rank < current.rank) {
      byStem.set(stem, { filePath, rank });
    }
  }
  return [...byStem.values()].map((entry) => entry.filePath);
}

function formatPstDateOnly(input = Date.now()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(input));
  } catch {
    return new Date(input).toISOString().slice(0, 10);
  }
}

async function handoffForcedTorrentToTvDown({
  addTag,
  infoHash,
  torrentTitle,
  torrentFiles,
}) {
  const qbtFilter = infoHash ? { hash: infoHash } : { tag: addTag };
  const metadataFiles = Array.isArray(torrentFiles)
    ? torrentFiles
        .map((file) => ({
          path: String(file?.path || "").replace(/^\/+/, ""),
          size:
            typeof file?.size === "number" && Number.isFinite(file.size)
              ? Math.max(0, Math.trunc(file.size))
              : 0,
        }))
        .filter((file) => file.path)
    : [];

  unilog(204, "forced handoff started", {
    addTag,
    infoHash,
    files: metadataFiles.length,
  });

  if (metadataFiles.length === 0) {
    unilog(205, "forced handoff has no usable torrent files", {
      addTag,
      infoHash,
      torrentTitle,
    });
    return;
  }

  for (let attempt = 0; attempt < FORCE_DOWN_MAX_POLLS; attempt += 1) {
    try {
      const tagged = await getQbtInfo(qbtFilter);
      const list = Array.isArray(tagged) ? tagged : [];
      const torrent = list[0] || null;
      if (!torrent) {
        await new Promise((resolve) => setTimeout(resolve, FORCE_DOWN_POLL_MS));
        continue;
      }

      const amountLeft = Number(torrent?.amount_left);
      const savePath = String(torrent?.save_path || "").trim();
      if (!Number.isFinite(amountLeft) || amountLeft > 0 || !savePath) {
        await new Promise((resolve) => setTimeout(resolve, FORCE_DOWN_POLL_MS));
        continue;
      }

      const completedAtRaw = Number(torrent?.completion_on);
      const completedAt =
        Number.isFinite(completedAtRaw) && completedAtRaw > 0
          ? completedAtRaw * 1000
          : Date.now();
      const datePart = formatPstDateOnly(completedAt);
      const payload = metadataFiles
        .map((file) => {
          const relPath = String(file.path || "").replace(/^\/+/, "");
          if (!relPath || relPath.startsWith("..")) return "";
          return `${datePart}-${relPath}-${file.size}`;
        })
        .filter(Boolean);

      if (payload.length === 0) {
        unilog(206, "forced handoff could not compute metadata paths", {
          addTag,
          infoHash,
          savePath,
        });
        return;
      }

      const response = await fetch("http://127.0.0.1:3003/forceDown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `forceDown HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }

      unilog(207, "forced handoff sent to tv-down", {
        addTag,
        infoHash,
        count: payload.length,
      });
      return;
    } catch (error) {
      unilog(1716, `forced handoff poll failed for ${infoHash || addTag || torrentTitle}: ${error?.message || String(error)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, FORCE_DOWN_POLL_MS));
  }

  unilog(1717, `forced handoff timed out for ${infoHash || addTag || torrentTitle}`);
}

function getYearFromShowContext(showContext) {
  const directYear = String(showContext?.year || "").trim();
  if (/^(19|20)\d{2}$/.test(directYear)) return directYear;

  const firstAired = String(showContext?.firstAired || "").trim();
  const match = firstAired.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function getSeasonEpisodeForTorrentPath(relPath) {
  const pathText = String(relPath || "").trim();
  if (!pathText) return null;

  const fname = path.basename(pathText);
  const folderName = path.basename(path.dirname(pathText));

  let parsedFile = null;
  let parsedFolder = null;
  try {
    parsedFile = parseTorrentTitlePkg.parse(fname) || null;
  } catch {
    parsedFile = null;
  }
  try {
    parsedFolder = parseTorrentTitlePkg.parse(folderName) || null;
  } catch {
    parsedFolder = null;
  }

  return (
    parseFileSeasonEpisode(fname, folderName, parsedFile, parsedFolder) || null
  );
}

function deriveTorrentShowName(showContext, torrent, videoPath) {
  const contextName = String(showContext?.name || "").trim();
  if (contextName) return contextName;

  const parsedTitle = String(torrent?.parsed?.title || "").trim();
  if (parsedTitle) return parsedTitle;

  const fname = path.basename(String(videoPath || ""));
  const folderName = path.basename(path.dirname(String(videoPath || "")));
  let parsed = null;
  try {
    parsed = parseTorrentTitlePkg.parse(fname) || null;
  } catch {
    parsed = null;
  }

  return String(parseTitleFromFilename(fname, folderName, parsed) || "").trim();
}

async function fetchEpisodeSubtitleCounts(requests) {
  const response = await fetch(INTERNAL_SRVR_SUBS_COUNT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }

  return Array.isArray(data?.results) ? data.results : [];
}

function appendDownloadsRequestLog(reqBody) {
  try {
    const outPath = path.join(getApiMiscDir(), "temp.txt");
    const body = reqBody && typeof reqBody === "object" ? reqBody : {};

    const hasTl = body.tl != null;
    const tlBody = hasTl ? body.tl : null;
    const torrent = hasTl
      ? tlBody && typeof tlBody === "object" && "torrent" in tlBody
        ? tlBody.torrent
        : tlBody
      : body.torrent;

    const torrentObj = torrent && typeof torrent === "object" ? torrent : null;
    const raw =
      torrentObj && typeof torrentObj.raw === "object" ? torrentObj.raw : null;

    const safeStr = (v, max = 240) => {
      const s = v == null ? "" : String(v);
      if (s.length <= max) return s;
      return s.slice(0, max) + `…(+${s.length - max})`;
    };

    const payload = {
      ts: new Date().toISOString(),
      endpoint: "/downloads",
      hasTl,
      forceDownload: body.forceDownload === true,
      topKeys: Object.keys(body || {}).slice(0, 50),
      tlKeys:
        tlBody && typeof tlBody === "object"
          ? Object.keys(tlBody).slice(0, 50)
          : null,
      torrentKeys: torrentObj ? Object.keys(torrentObj).slice(0, 50) : null,
      torrent: torrentObj
        ? {
            provider: torrentObj?.provider || raw?.provider || undefined,
            rawYear: raw?.year ?? undefined,
            id: raw?.id ?? torrentObj?.id ?? undefined,
            fid: raw?.fid ?? undefined,
            title: safeStr(
              raw?.title ?? torrentObj?.title ?? torrentObj?.clientTitle ?? "",
            ),
            filename: safeStr(raw?.filename ?? ""),
            detailUrl: safeStr(torrentObj?.detailUrl ?? ""),
            rawKeys: raw ? Object.keys(raw).slice(0, 50) : null,
          }
        : null,
    };

    fs.appendFileSync(outPath, JSON.stringify(payload) + "\n", "utf8");
  } catch {
    // ignore logging failures
  }
}

function appendDownloadsResultLog(payload) {
  try {
    const outPath = path.join(getApiMiscDir(), "temp.txt");
    const entry = { ts: new Date().toISOString(), ...payload };
    fs.appendFileSync(outPath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // ignore
  }
}

function tvEntryHasError(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (!("error" in entry)) return false;
  const v = entry.error;
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim();
    return Boolean(s) && s !== "0";
  }
  return v !== 0 && v !== false;
}

function tvEntriesErrorTitles(tvEntries) {
  const list = Array.isArray(tvEntries) ? tvEntries : [];
  return list.filter(tvEntryHasError);
}

function extractYearFromString(s) {
  const text = String(s || "");
  const m = text.match(/\b(19\d{2}|20\d{2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n < 1950 || n > 2050) return null;
  return n;
}

// console.log("[tv-api] module loaded", {
//   ts: new Date().toISOString(),
//   cwd: process.cwd(),
//   node: process.version,
// });

function readRequiredFile(filePath, label) {
  try {
    return fs.readFileSync(filePath);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Missing required ${label} at ${filePath}. (${msg})`);
  }
}

const app = express();

const API_PORT = 3001;
const DUMP_INFO = false;
let qbtChannelPeer = null;
let qbtChannelPollTimer = null;
let qbtChannelLastJson = "";
let browseHasMoreChannelPollTimer = null;
let browseHasMoreChannelLastJson = "";
// Hard-wired (no env vars per repo convention): emit CORS headers for direct
// (non-proxied) browser requests. nginx injects them on the proxied path.
const INTERNAL_CORS = true;

// Load SSL certificate
const httpsOptions = {
  key: readRequiredFile(
    path.join(getApiSecretsDir(), "localhost-key.pem"),
    "TLS key (localhost-key.pem)",
  ),
  cert: readRequiredFile(
    path.join(getApiSecretsDir(), "localhost-cert.pem"),
    "TLS cert (localhost-cert.pem)",
  ),
};

// CORS notes:
// - Public browser traffic hits this service through nginx.
// - nginx already injects CORS headers on that path.
// - If we *also* set them here, nginx may forward a second header and some
//   clients will observe a combined value like "*, *" (invalid), which breaks
//   browser CORS.
//
// So: only emit CORS headers for direct (non-proxied) browser requests.
app.use((req, res, next) => {
  const hasOrigin =
    typeof req.headers.origin === "string" && req.headers.origin.length > 0;
  const behindProxy = Boolean(
    req.headers["x-forwarded-host"] ||
    req.headers["x-forwarded-proto"] ||
    req.headers["x-forwarded-for"],
  );

  if (hasOrigin && !behindProxy && INTERNAL_CORS) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    const reqHeaders = req.headers["access-control-request-headers"];
    res.setHeader(
      "Access-Control-Allow-Headers",
      typeof reqHeaders === "string" && reqHeaders.trim()
        ? reqHeaders
        : "Content-Type, Authorization",
    );
  }

  if (req.method === "OPTIONS" && hasOrigin) {
    // Preflight: return no-content. If proxied, nginx will attach CORS headers.
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json());

const OPENSUBTITLES_BASE_URL = "https://api.opensubtitles.com/api/v1";

function getSubsLoginPath() {
  return path.join(getApiSecretsDir(), "subs-login.txt");
}

function getSubsTokenPath() {
  return path.join(getApiSecretsDir(), "subs-token.txt");
}

async function readTextIfExists(filePath) {
  try {
    const txt = await fs.promises.readFile(filePath, "utf8");
    return String(txt || "").trim();
  } catch {
    return "";
  }
}

async function readJsonIfExists(filePath) {
  try {
    const txt = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function writeTextFile(filePath, text) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, String(text || "") + "\n", "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function osFetchJson(
  url,
  { apiKey, token, method = "GET", jsonBody } = {},
) {
  const headers = {
    Accept: "application/json",
    // Some edge/CDN configurations behave better when a UA is present.
    "User-Agent": "tv-series-client/1.0 (torrents-proxy)",
    "X-User-Agent": "tv-series-client/1.0 (torrents-proxy)",
  };
  if (apiKey) headers["Api-Key"] = apiKey;
  if (token) headers.Authorization = `Bearer ${token}`;

  let body;
  if (jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(jsonBody);
  }

  const resp = await fetch(url, { method, headers, body });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    data,
    text,
  };
}

async function osLoginAndPersistToken() {
  const loginPath = getSubsLoginPath();
  const login = await readJsonIfExists(loginPath);
  const apiKey = String(login?.apiKey || "").trim();
  const username = String(login?.username || "").trim();
  const password = String(login?.password || "").trim();
  if (!apiKey || !username || !password) {
    throw new Error(`Missing apiKey/username/password in ${loginPath}`);
  }

  const resp = await osFetchJson(`${OPENSUBTITLES_BASE_URL}/login`, {
    apiKey,
    method: "POST",
    jsonBody: { username, password },
  });

  if (!resp.ok) {
    const detail = resp.data ? JSON.stringify(resp.data) : resp.text;
    throw new Error(
      `OpenSubtitles login failed: HTTP ${resp.status} ${resp.statusText} ${detail}`,
    );
  }

  const token = String(resp.data?.token || "").trim();
  if (!token) {
    throw new Error("OpenSubtitles login response missing token");
  }
  await writeTextFile(getSubsTokenPath(), token);
  return { apiKey, token };
}

function normalizeImdbIdToDigits(imdbId) {
  const raw = String(imdbId || "").trim();
  if (!raw) return "";
  const s = raw.toLowerCase().startsWith("tt") ? raw.slice(2) : raw;
  const digits = s.replace(/\D/g, "");
  return digits;
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

// POST /api/cf_clearance - Persist provider cf_clearance values for local tooling
// Body: { ipt_cf?: string, tl_cf?: string }
app.post("/api/cf_clearance", async (req, res) => {
  try {
    const body = req.body || {};
    const ipt = typeof body.ipt_cf === "string" ? body.ipt_cf.trim() : "";
    const tl = typeof body.tl_cf === "string" ? body.tl_cf.trim() : "";

    const outPath = path.join(getApiDataDir(), "cf_clearance-cookies.json");
    let current = {};
    try {
      const raw = await fs.promises.readFile(outPath, "utf8");
      const j = JSON.parse(raw);
      if (j && typeof j === "object" && !Array.isArray(j)) current = j;
    } catch {
      // ignore
    }

    if (ipt) current.iptorrents = ipt;
    if (tl) current.torrentleech = tl;

    await fs.promises.writeFile(
      outPath,
      JSON.stringify(current, null, 2) + "\n",
      "utf8",
    );
    unilog(210, "saved", {
      path: outPath,
      keys: Object.keys(current),
      iptLen: current.iptorrents ? String(current.iptorrents).length : 0,
      tlLen: current.torrentleech ? String(current.torrentleech).length : 0,
    });

    res.json({ ok: true, path: outPath, keys: Object.keys(current) });
  } catch (error) {
    unilog(211, "error", error);
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

// Initialize torrent search providers
search.initializeProviders();

app.post("/api/tvproc/startProc", async (req, res) => {
  const jsonPath = getTvprocJsonPath();
  try {
    await fs.promises.writeFile(jsonPath, "[]\n", "utf8");
    res.json({ ok: true, path: jsonPath, cleared: true });
  } catch (error) {
    const code = error?.code;
    if (code === "ENOENT") {
      res.json({ ok: true, path: jsonPath, cleared: true });
      return;
    }
    unilog(214, "tvproc clear error:", error);
    res
      .status(500)
      .json({ error: error?.message || String(error), path: jsonPath });
  }
});

app.get("/api/tvproc/startProc", async (req, res) => {
  try {
    const title = req.query.title;
    if (!title) {
      return res.status(400).json({ error: "title parameter required" });
    }
    const url = `https://hahnca.com/tv-down-dev/startProc?title=${encodeURIComponent(title)}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    unilog(215, "startProc proxy error:", error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.post("/api/tvproc/forceDown", async (req, res) => {
  try {
    const files = req.body; // already parsed by express.json()
    const response = await fetch("http://127.0.0.1:3003/forceDown", {
      method: "POST",
      body: JSON.stringify(files),
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`HTTP ${response.status}: ${txt}`);
    }
    const result = await response.json();
    res.json(result);
  } catch (err) {
    unilog(216, "forceDown proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

const getQbtInfoPayload = async (query = {}) => {
  const filterObj = {};
  if (typeof query.hash === "string" && query.hash) filterObj.hash = query.hash;
  if (typeof query.category === "string" && query.category)
    filterObj.category = query.category;
  if (typeof query.tag === "string" && query.tag) filterObj.tag = query.tag;
  if (typeof query.filter === "string" && query.filter)
    filterObj.filter = query.filter;

  const useFilter = Object.keys(filterObj).length > 0 ? filterObj : undefined;
  const info = await getQbtInfo(useFilter);
  // Only the full unfiltered list drives stat sampling/pruning.
  if (!useFilter) await enrichQbtStats(info);

  if (DUMP_INFO) {
    try {
      const outPath = path.resolve(
        __dirname,
        "..",
        "..",
        "samples",
        "sample-qbt",
        "qbt-info.json",
      );
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(info, null, 2), "utf8");
    } catch (e) {
      unilog(217, "qbt info dump error:", e);
    }
  }

  return info;
};

const getQbtChannelSnapshot = async () => {
  const info = await getQbtInfoPayload();
  qbtChannelLastJson = JSON.stringify(info);
  return info;
};

const pollQbtChannel = async () => {
  try {
    const info = await getQbtInfoPayload();
    const json = JSON.stringify(info);
    if (json === qbtChannelLastJson) return;
    qbtChannelLastJson = json;
    qbtChannelPeer?.publishDelta("qbtInfo", info);
  } catch (e) {
    unilog(1498, `qbtInfo poll failed: ${e.message}`);
  }
};

const startQbtChannelPolling = () => {
  if (qbtChannelPollTimer) return;
  qbtChannelPollTimer = setInterval(() => {
    pollQbtChannel().catch((e) => {
      unilog(1499, `qbtInfo poll crashed: ${e.message}`);
    });
  }, QBT_CHANNEL_POLL_MS);
};

const stopQbtChannelPolling = () => {
  if (!qbtChannelPollTimer) return;
  clearInterval(qbtChannelPollTimer);
  qbtChannelPollTimer = null;
  qbtChannelLastJson = "";
};

const getBrowseHasMorePayload = () => ({ available: hasBrowseShow() });

const getBrowseHasMoreChannelSnapshot = () => {
  const payload = getBrowseHasMorePayload();
  browseHasMoreChannelLastJson = JSON.stringify(payload);
  return payload;
};

const publishBrowseHasMoreChannel = () => {
  const payload = getBrowseHasMorePayload();
  const json = JSON.stringify(payload);
  if (json === browseHasMoreChannelLastJson) return;
  browseHasMoreChannelLastJson = json;
  qbtChannelPeer?.publishDelta("browseHasMore", payload);
};

const startBrowseHasMoreChannelPolling = () => {
  if (browseHasMoreChannelPollTimer) return;
  browseHasMoreChannelPollTimer = setInterval(() => {
    try {
      publishBrowseHasMoreChannel();
    } catch (e) {
      unilog(1500, `browseHasMore poll failed: ${e.message}`);
    }
  }, BROWSE_HAS_MORE_CHANNEL_POLL_MS);
};

const stopBrowseHasMoreChannelPolling = () => {
  if (!browseHasMoreChannelPollTimer) return;
  clearInterval(browseHasMoreChannelPollTimer);
  browseHasMoreChannelPollTimer = null;
  browseHasMoreChannelLastJson = "";
};

app.get("/api/qbt/info", async (req, res) => {
  try {
    res.json(await getQbtInfoPayload(req.query || {}));
  } catch (error) {
    unilog(218, "qbt info error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/qbt/files", async (req, res) => {
  try {
    const hash = String(req.query?.hash ?? "").trim();
    if (!hash) {
      res.status(400).json({ error: "hash required" });
      return;
    }
    res.json(await getQbtFiles({ hash }));
  } catch (error) {
    unilog(2049, `qbt files error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Client helper: delTorrent(<hash>)
// Deletes torrent in qBittorrent, including files by default.
app.post("/api/qbt/delTorrent", async (req, res) => {
  try {
    const q = req.query || {};
    const b = req.body || {};

    const hash =
      typeof b.hash === "string" && b.hash
        ? b.hash
        : typeof q.hash === "string" && q.hash
          ? q.hash
          : "";

    if (!hash) {
      res.status(400).json({ error: "hash required" });
      return;
    }

    const deleteFiles =
      typeof b.deleteFiles === "boolean" ? b.deleteFiles : true;
    const result = await delQbtTorrent({ hash, deleteFiles });
    res.json(result);
  } catch (error) {
    unilog(219, "qbt delTorrent error:", error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.post("/api/qbt/recheck", async (req, res) => {
  try {
    const b = req.body || {};
    const hash = b.hash || "all";
    const result = await recheckQbtTorrent({ hash });
    res.json(result);
  } catch (error) {
    unilog(220, "qbt recheck error:", error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.post("/api/qbt/addMagnet", async (req, res) => {
  try {
    const b = req.body || {};
    const magnetUrl = typeof b.magnetUrl === "string" ? b.magnetUrl.trim() : "";
    if (!magnetUrl) {
      res.status(400).json({ error: "magnetUrl required" });
      return;
    }
    const result = await addQbtMagnet({ magnetUrl });
    res.json(result);
  } catch (error) {
    unilog(221, "qbt addMagnet error:", error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.get("/api/space/avail", async (req, res) => {
  try {
    const info = await spaceAvail();
    res.json(info);
  } catch (error) {
    unilog(222, "spaceAvail error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/space/usb", async (req, res) => {
  try {
    const info = await spaceAvailUsb();
    res.json(info);
  } catch (error) {
    unilog(223, "spaceAvailUsb error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/space/srvr", async (req, res) => {
  try {
    const info = await spaceAvailMedia();
    res.json(info);
  } catch (error) {
    unilog(224, "spaceAvailMedia error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/flexget", async (req, res) => {
  try {
    const txt = await flexgetHistory();
    res.type("text/plain").send(txt);
  } catch (error) {
    unilog(225, "flexget error:", error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.get("/api/usb/files", async (req, res) => {
  try {
    const tree = await getUsbFiles();
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/usb/rename", async (req, res) => {
  const { oldPath, newName } = req.body || {};
  try {
    if (!oldPath || !newName) {
      return res.status(400).json({ error: "Missing oldPath or newName" });
    }
    const result = await renameUsbFile(oldPath, newName);
    res.json(result);
  } catch (err) {
    const oldName =
      String(oldPath || "")
        .split("/")
        .pop() || String(oldPath);
    unilog(
      228,
      `usb rename error for ${oldName} -> ${newName}: ${err?.message || String(err)}`,
    );
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/usb/deleteFiles", async (req, res) => {
  try {
    const b = req.body || {};
    const paths = Array.isArray(b.paths) ? b.paths : [];
    if (paths.length === 0) {
      return res.status(400).json({ error: "paths must be a non-empty array" });
    }
    const result = await deleteUsbFiles(paths);
    res.json(result);
  } catch (err) {
    unilog(229, "usb deleteFiles error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get("/api/usb/movies", async (req, res) => {
  try {
    const tree = await getUsbMovies();
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post("/api/usb/deleteMovies", async (req, res) => {
  try {
    const b = req.body || {};
    const paths = Array.isArray(b.paths) ? b.paths : [];
    if (paths.length === 0) {
      return res.status(400).json({ error: "paths must be a non-empty array" });
    }
    const result = await deleteUsbMovies(paths);
    res.json(result);
  } catch (err) {
    unilog(230, "usb deleteMovies error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get("/api/local/movies", async (req, res) => {
  try {
    const tree = await getLocalFiles("/mnt/media/movies");
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

const USB_HOST_FOR_MEDIAINFO = "xobtlu@xobtlu.baron.usbx.me";
const USB_FILES_ROOT_MI = "/home/xobtlu/files";
const USB_MOVIES_ROOT_MI = "/home/xobtlu/movies";

app.post("/api/usb/mediainfo", async (req, res) => {
  try {
    const { relPath, movieMode } = req.body;
    if (!relPath) return res.status(400).json({ error: "Missing relPath" });
    const str = String(relPath).trim();
    if (!str || str.includes(".."))
      return res.status(400).json({ error: "Invalid relPath" });
    const root = movieMode ? USB_MOVIES_ROOT_MI : USB_FILES_ROOT_MI;
    const fullPath = `${root}/${str}`;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(execFile);
    const sshArgs = [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=20",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
    ];
    const escapedPath = fullPath.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(
      "ssh",
      [...sshArgs, USB_HOST_FOR_MEDIAINFO, `mediainfo -- '${escapedPath}'`],
      { maxBuffer: 5 * 1024 * 1024 },
    );
    const output = stdout
      .split("\n")
      .filter((l) => !/^Encoding settings\s*:/i.test(l))
      .join("\n");

    // Count subtitle streams from mediainfo text output (sections starting with "Text")
    const sections = output.split(/\n\n+/);
    const ENGLISH_LANG_TAGS = new Set(["eng", "en", "english"]);
    let subsCount = 0;
    for (const sec of sections) {
      if (!/^Text\b/i.test(sec.trim())) continue;
      const langMatch = sec.match(/^Language\s*:\s*(.+)/im);
      const lang = langMatch ? langMatch[1].trim().toLowerCase() : "";
      if (lang === "" || ENGLISH_LANG_TAGS.has(lang)) subsCount++;
    }

    // Count .srt sidecar files for this specific file (same base name prefix,
    // matching the /api/local/mediainfo behavior).
    const fileName = str.split("/").pop();
    const dirPath = `${root}/${str.substring(0, str.lastIndexOf("/"))}`.replace(
      /\/$/,
      "",
    );
    const baseNoExt = fileName.replace(/\.[^.]+$/, "");
    // Escape glob metacharacters for find -iname, then shell-quote.
    const basePattern = baseNoExt
      .replace(/[[\]*?\\]/g, "\\$&")
      .replace(/'/g, "'\\''");
    const escapedDir = dirPath.replace(/'/g, "'\\''");
    let srtsCount = 0;
    try {
      const { stdout: srtOut } = await execAsync(
        "ssh",
        [
          ...sshArgs,
          USB_HOST_FOR_MEDIAINFO,
          `find '${escapedDir}' -maxdepth 1 -iname '${basePattern}*.srt' | wc -l`,
        ],
        { maxBuffer: 64 * 1024 },
      );
      srtsCount = parseInt(srtOut.trim()) || 0;
    } catch (_) {}

    res.json({ output, subsCount, srtsCount });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post("/api/usb/textfile", async (req, res) => {
  try {
    const { relPath, movieMode, maxChars } = req.body;
    if (!relPath) return res.status(400).json({ error: "Missing relPath" });
    const data = await readUsbTextFile(relPath, !!movieMode, maxChars);
    res.json(data);
  } catch (err) {
    unilog(2114, `usb textfile error: ${err.message}`);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get("/api/usb/cp-token", async (req, res) => {
  try {
    const token = await usbCpToken();
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post("/api/local/rename", async (req, res) => {
  const { oldPath, newName } = req.body || {};
  try {
    if (!oldPath || !newName) {
      return res.status(400).json({ error: "Missing oldPath or newName" });
    }
    const result = await renameLocalFile(oldPath, newName);
    res.json(result);
  } catch (err) {
    const oldName =
      String(oldPath || "")
        .split("/")
        .pop() || String(oldPath);
    unilog(
      231,
      `local rename error for ${oldName} -> ${newName}: ${err?.message || String(err)}`,
    );
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/local/swap", async (req, res) => {
  const { relPath, movieMode } = req.body || {};
  try {
    if (!relPath) return res.status(400).json({ error: "Missing relPath" });
    const result = await swapLocalOld(relPath, !!movieMode);
    res.json(result);
  } catch (err) {
    const name =
      String(relPath || "")
        .split("/")
        .pop() || String(relPath);
    unilog(2052, `local swap error for ${name}: ${err?.message || String(err)}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/local/files", async (req, res) => {
  try {
    const tree = await getLocalFiles();
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/local/mediainfo", async (req, res) => {
  try {
    const { relPath, movieMode } = req.body;
    if (!relPath) {
      return res.status(400).json({ error: "Missing relPath" });
    }
    const relPathStr = String(relPath).trim();
    if (
      !relPathStr ||
      path.isAbsolute(relPathStr) ||
      relPathStr.includes("\0") ||
      relPathStr.split(/[\\/]+/).includes("..")
    ) {
      return res.status(400).json({ error: "Invalid relPath" });
    }
    const root = movieMode ? "/mnt/media/movies" : "/mnt/media/tv";
    const rootPath = path.resolve(root);
    const fullPath = path.resolve(rootPath, relPathStr);
    if (!(fullPath === rootPath || fullPath.startsWith(rootPath + path.sep))) {
      return res.status(400).json({ error: "Invalid relPath" });
    }
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(execFile);
    const { stdout } = await execAsync("mediainfo", [fullPath], {
      maxBuffer: 5 * 1024 * 1024,
    });

    const output = stdout
      .split("\n")
      .filter((l) => !/^Encoding settings\s*:/i.test(l))
      .join("\n");

    const fileName = relPathStr.split("/").pop();

    // Count subtitle streams that are English or have no language tag (mirrors getSubtitleStreams in asr.js).
    const ENGLISH_LANG_TAGS = new Set(["eng", "en", "english"]);
    let subsCount = 0;
    try {
      const { stdout: fpOut } = await execAsync(
        "ffprobe",
        ["-v", "quiet", "-print_format", "json", "-show_streams", fullPath],
        { maxBuffer: 5 * 1024 * 1024 },
      );
      const streams = JSON.parse(fpOut).streams || [];
      subsCount = streams.filter((s) => {
        if (s.codec_type !== "subtitle") return false;
        const lang = (s.tags?.language || "").toLowerCase().trim();
        return lang === "" || ENGLISH_LANG_TAGS.has(lang);
      }).length;
    } catch (_) {
      // ffprobe unavailable — subsCount stays 0
    }

    // Count .srt sidecar files for this specific file (same base name prefix)
    let srtsCount = 0;
    try {
      const { readdir } = await import("node:fs/promises");
      const dir = path.dirname(fullPath);
      const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
      const entries = await readdir(dir);
      // (chosen markers are `<base>.mb.chosen` — they never end in .srt)
      srtsCount = entries.filter((e) => {
        const el = e.toLowerCase();
        return el.startsWith(baseName) && el.endsWith(".srt");
      }).length;
    } catch (_) {
      // ignore read errors
    }

    res.json({ output, fileName, subsCount, srtsCount });
  } catch (err) {
    unilog(233, "mediainfo error:", err);
    res.status(500).json({ error: err.message });
  }
});

const TEXT_PROBE_BYTES = 100;
const TEXT_VIEW_MAX_BYTES = 2 * 1024 * 1024;

// probe:true returns only size/isText, used to enable the View button
app.post("/api/local/textfile", async (req, res) => {
  try {
    const { relPath, movieMode, probe } = req.body;
    if (!relPath) {
      return res.status(400).json({ error: "Missing relPath" });
    }
    // maxChars caps the read to the head of the file, so oversized text
    // files can still be previewed
    const maxChars =
      Number(req.body.maxChars) > 0 ? Math.floor(Number(req.body.maxChars)) : 0;
    const relPathStr = String(relPath).trim();
    if (
      !relPathStr ||
      path.isAbsolute(relPathStr) ||
      relPathStr.includes("\0") ||
      relPathStr.split(/[\\/]+/).includes("..")
    ) {
      return res.status(400).json({ error: "Invalid relPath" });
    }
    const root = movieMode ? "/mnt/media/movies" : "/mnt/media/tv";
    const rootPath = path.resolve(root);
    const fullPath = path.resolve(rootPath, relPathStr);
    if (!fullPath.startsWith(rootPath + path.sep)) {
      return res.status(400).json({ error: "Invalid relPath" });
    }
    const { open, stat, readFile } = await import("node:fs/promises");
    const st = await stat(fullPath);
    if (!st.isFile()) {
      return res.status(400).json({ error: "Not a file" });
    }

    const buf = Buffer.alloc(TEXT_PROBE_BYTES);
    const fh = await open(fullPath, "r");
    let bytesRead = 0;
    try {
      ({ bytesRead } = await fh.read(buf, 0, TEXT_PROBE_BYTES, 0));
    } finally {
      await fh.close();
    }
    const isText = isTextBuffer(buf.subarray(0, bytesRead));
    const tooBig = st.size > TEXT_VIEW_MAX_BYTES;

    if (probe || !isText || (tooBig && !maxChars)) {
      return res.json({ size: st.size, isText, tooBig });
    }
    if (maxChars) {
      const head = Buffer.alloc(maxChars);
      const fh2 = await open(fullPath, "r");
      let headRead = 0;
      try {
        ({ bytesRead: headRead } = await fh2.read(head, 0, maxChars, 0));
      } finally {
        await fh2.close();
      }
      return res.json({
        size: st.size,
        isText,
        tooBig,
        content: head.subarray(0, headRead).toString("utf8"),
      });
    }
    const content = await readFile(fullPath, "utf8");
    res.json({ size: st.size, isText, tooBig, content });
  } catch (err) {
    unilog(1564, `textfile error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

const TOR_SENT_PATH = path.join(getApiMiscDir(), "tor-sent.json");
const TOR_SENT_HISTORY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

function logRecentSent(action, details = {}) {
  try {
    const detailsStr =
      Object.keys(details).length > 0 ? ` | ${JSON.stringify(details)}` : "";
    unilog(1194, `${action}${detailsStr}`);
  } catch {
    // ignore logging errors
  }
}

function loadTorSent() {
  try {
    if (fs.existsSync(TOR_SENT_PATH)) {
      const j = JSON.parse(fs.readFileSync(TOR_SENT_PATH, "utf8"));
      if (j && typeof j === "object" && !Array.isArray(j)) {
        const cutoff = Date.now() - TOR_SENT_HISTORY_WINDOW_MS;
        const pruned = {};
        let removed = 0;
        for (const [k, ts] of Object.entries(j)) {
          const t = Number(ts);
          if (Number.isFinite(t) && t >= cutoff) pruned[k] = t;
          else removed++;
        }
        if (removed > 0) {
          fs.writeFileSync(TOR_SENT_PATH, JSON.stringify(pruned), "utf8");
          logRecentSent("LOAD", {
            entryCount: Object.keys(pruned).length,
            removed,
          });
        } else {
          logRecentSent("LOAD", { entryCount: Object.keys(pruned).length });
        }
        return pruned;
      }
    }
    logRecentSent("LOAD", { entryCount: 0, note: "file not found or invalid" });
  } catch (e) {
    logRecentSent("LOAD_ERROR", { error: e.message });
  }
  return {};
}

app.get("/api/tor/sent", (req, res) => {
  const data = loadTorSent();
  logRecentSent("GET", {
    entryCount: Object.keys(data).length,
    ip: req.ip || req.connection?.remoteAddress,
  });
  res.json(data);
});

app.post("/api/tor/sent", (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  if (keys.length === 0) {
    logRecentSent("POST_ERROR", { error: "keys required" });
    return res.status(400).json({ error: "keys required" });
  }
  const data = loadTorSent();
  const now = Date.now();
  const beforeCount = Object.keys(data).length;
  let newKeys = 0;
  let updatedKeys = 0;
  for (const k of keys) {
    if (k && typeof k === "string") {
      if (data[k]) updatedKeys++;
      else newKeys++;
      data[k] = now;
    }
  }
  try {
    fs.writeFileSync(TOR_SENT_PATH, JSON.stringify(data), "utf8");
    const afterCount = Object.keys(data).length;
    logRecentSent("POST", {
      keysProvided: keys.length,
      newKeys,
      updatedKeys,
      beforeCount,
      afterCount,
      timestamp: now,
      ip: req.ip || req.connection?.remoteAddress,
      sampleKeys: keys.slice(0, 3),
    });
  } catch (e) {
    logRecentSent("POST_WRITE_ERROR", {
      error: e.message,
      keysCount: keys.length,
    });
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true });
});

app.get("/api/search", async (req, res) => {
  const showName = req.query.show;
  const limit = parseInt(req.query.limit) || 100;
  const iptCfRaw = req.query.ipt_cf;
  const tlCfRaw = req.query.tl_cf;
  const more = req.query.more === "true";
  const staged = req.query.staged === "true";
  const category = req.query.category || "tv";
  // season may be a single number or a comma-separated list of seasons
  const seasons = String(req.query.season ?? "")
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n) && n >= 0);
  let needed = [];

  // Parse needed array if provided
  if (req.query.needed) {
    try {
      needed = JSON.parse(req.query.needed);
    } catch (err) {
      unilog(234, "Error parsing needed array:", err);
    }
  }

  if (!showName) {
    return res.status(400).json({ error: "Show name is required" });
  }

  try {
    // If the client doesn't pass cf_clearance values, fall back to the local persisted file.
    // This allows the UI to avoid localStorage for cookies.
    const iptCf =
      typeof iptCfRaw === "string" && iptCfRaw.trim()
        ? iptCfRaw.trim()
        : await loadLocalCfClearance("iptorrents");
    const tlCf =
      typeof tlCfRaw === "string" && tlCfRaw.trim()
        ? tlCfRaw.trim()
        : await loadLocalCfClearance("torrentleech");
    const result = await searchTorrentsInChild({
      showName,
      limit,
      iptCf,
      tlCf,
      needed,
      more,
      staged,
      category,
      seasons,
    });
    res.json(result);
  } catch (error) {
    unilog(235, "Search error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/subs/search?imdb_id=1234567&page=1
// GET /api/subs/search?q=tt0083399&page=1
// GET /api/subs/search?q=osdb:18563&page=1
// - Reads secrets/subs-login.txt (JSON: {apiKey, username, password})
// - Uses secrets/subs-token.txt (token string)
// - If not logged in, auto-logins and retries once
app.get("/api/subs/search", async (req, res) => {
  try {
    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const imdbIdDigits = normalizeImdbIdToDigits(req.query.imdb_id);
    if (!qRaw && !imdbIdDigits) {
      return res
        .status(400)
        .json({ error: "imdb_id or q query parameter required" });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const loginPath = getSubsLoginPath();
    const login = await readJsonIfExists(loginPath);
    const apiKey = String(login?.apiKey || "").trim();
    if (!apiKey) {
      return res.status(500).json({ error: `Missing apiKey in ${loginPath}` });
    }

    let token = await readTextIfExists(getSubsTokenPath());

    const url = new URL(`${OPENSUBTITLES_BASE_URL}/subtitles`);
    if (qRaw) {
      url.searchParams.set("query", qRaw);
    } else {
      // For TV shows, OpenSubtitles stores most episode subtitles under the *parent* (series) imdb id.
      // Using imdb_id here often returns only a tiny subset.
      url.searchParams.set("parent_imdb_id", imdbIdDigits);
    }
    url.searchParams.set("page", String(page));

    // Hint to reduce payload; client still filters.
    url.searchParams.set("languages", "en");

    const transientStatuses = new Set([429, 500, 502, 503, 504, 520, 522, 524]);

    const fetchWithRetry = async () => {
      let last = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        last = await osFetchJson(url.toString(), { apiKey, token });
        if (last.ok) return last;
        if (!transientStatuses.has(last.status)) return last;
        if (attempt === 4) return last;
        unilog(1718, `OpenSubtitles subtitles request failed with HTTP ${last.status} for ${qRaw || imdbIdDigits} (attempt ${attempt + 1}/5), retrying`);
        await sleep(300 * (attempt + 1) * (attempt + 1));
      }
      return last;
    };

    let resp = await fetchWithRetry();

    // OpenSubtitles auth errors are typically 401/403.
    if (!resp.ok && (resp.status === 401 || resp.status === 403)) {
      const fresh = await osLoginAndPersistToken();
      token = fresh.token;
      resp = await fetchWithRetry();
    }

    if (!resp.ok) {
      unilog(1719, `OpenSubtitles subtitles request gave up with HTTP ${resp.status} for ${qRaw || imdbIdDigits}`);
      let detail = resp.data || resp.text;
      if (typeof detail === "string") {
        const s = detail.trim();
        if (
          s.toLowerCase().includes("<!doctype html") ||
          s.toLowerCase().includes("<html")
        ) {
          detail = s.slice(0, 1200);
        }
      }
      res.status(resp.status || 500).json({
        error: `OpenSubtitles subtitles request failed: HTTP ${resp.status} ${resp.statusText}`,
        detail,
      });
      return;
    }

    res.json(resp.data);
  } catch (error) {
    unilog(236, "search error:", error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

async function handleDownloadRequest(req, res) {
  try {
    const body = req.body || {};
    const hasTl = body.tl != null;
    const tlBody = hasTl ? body.tl : null;
    const torrent = hasTl
      ? tlBody && typeof tlBody === "object" && "torrent" in tlBody
        ? tlBody.torrent
        : tlBody
      : body.torrent;
    const forceDownload = body.forceDownload === true;
    const dlSavePath = body.savePath ? String(body.savePath).trim() : null;

    appendDownloadsRequestLog(body);

    unilog(237, "request", {
      forceDownload,
      provider: torrent?.provider || torrent?.raw?.provider || undefined,
      id: torrent?.raw?.id || torrent?.id || undefined,
      title: torrent?.raw?.title || torrent?.title || undefined,
    });

    // Standard wrapper shape returned to the client.
    const baseWrapper = {
      existingTitles: [],
      existingProcids: [],
      tvEntries: [],
      errorTitles: [],
    };

    const torTitle = () =>
      String(
        torrent?.raw?.title ||
          torrent?.title ||
          torrent?.clientTitle ||
          "unknown",
      ).trim();

    if (!torrent) {
      res.status(400).json({
        ...baseWrapper,
        success: false,
        stage: "validate",
        error: "Torrent data is required",
      });
      return;
    }

    // Block if torrent title contains any TV_BLOCKED substring (skipped when forceDownload).
    if (!forceDownload) {
      const title = torTitle();
      const blockedKey = Object.keys(TV_BLOCKED).find((k) => title.includes(k));
      if (blockedKey) {
        unilog(1170, `API: TV_BLOCKED substring "${blockedKey}" in "${title}"`);
        res.json({
          ...baseWrapper,
          success: false,
          stage: "tv-blocked",
          error: `Torrent title blocked: ${blockedKey}`,
        });
        return;
      }
    }

    // Shared pipeline for both modes: fetch → validate → year guardrail →
    // tv-proc → qbt add. Force mode differences: TV_BLOCKED is skipped
    // (above), an existing duplicate is deleted and re-added instead of
    // reported, the finished torrent is handed off to tv-down, and success
    // responses carry provider/method/downloadUrl/bytes/hash + debug:true.
    const fetched = await download.fetchTorrentFile(torrent);
    if (!fetched || typeof fetched !== "object") {
      unilog(
        1171,
        `API: fetch-torrent failed (unexpected result) for "${torTitle()}"`,
      );
      res.json({
        ...baseWrapper,
        success: false,
        stage: "fetch-torrent",
        error: "Unexpected fetchTorrentFile result",
      });
      return;
    }
    if (!fetched.success) {
      unilog(
        1172,
        `API: fetch-torrent failed: ${fetched.error || "fetch failed"} for "${torTitle()}"`,
      );
      res.json({ ...baseWrapper, ...fetched });
      return;
    }

    const isMovieDownload =
      dlSavePath && String(dlSavePath).replace(/\/+$/, "").endsWith("/movies");
    const valid = isMovieDownload
      ? { success: true }
      : download.validateTorrentBytes(fetched.torrentData);
    if (!valid.success) {
      unilog(
        1173,
        `API: invalid torrent bytes: ${valid.error || "unknown"} for "${torTitle()}"`,
      );
      res.json({ ...baseWrapper, ...valid });
      return;
    }

    // Guardrail: if the request implies a specific year, and the torrent's internal name
    // includes a conflicting year, refuse to upload (prevents "wrong show" mismatches).
    const yearMismatch = (() => {
      try {
        const expectedYear =
          (Number.isFinite(Number(torrent?.raw?.year))
            ? Number(torrent?.raw?.year)
            : null) ||
          extractYearFromString(
            torrent?.raw?.title || torrent?.title || torrent?.clientTitle,
          );
        if (!expectedYear || expectedYear < 1950 || expectedYear > 2050)
          return null;

        const parsed = parseTorrent(fetched.torrentData);
        const parsedName = String(parsed?.name || "").trim();
        const actualYear = extractYearFromString(parsedName);
        if (!actualYear || actualYear === expectedYear) return null;

        const requestedTitle = String(
          torrent?.raw?.title || torrent?.title || torrent?.clientTitle || "",
        ).trim();
        unilog(
          1174,
          `API: year mismatch (requested ${expectedYear}, torrent says ${actualYear}) for "${requestedTitle}"`,
        );
        return {
          ...baseWrapper,
          success: false,
          stage: "validate-torrent-metadata",
          error: `Torrent year mismatch (requested ${expectedYear}, torrent says ${actualYear})`,
          yearError: `${actualYear}|${expectedYear}|${requestedTitle}`,
          expectedYear,
          actualYear,
          torrentName: parsedName || undefined,
          downloadUrl: fetched?.downloadUrl || undefined,
          provider: fetched?.provider || undefined,
          ...(forceDownload ? { debug: true } : {}),
        };
      } catch {
        // ignore metadata validation failures
        return null;
      }
    })();
    if (yearMismatch) {
      res.json(yearMismatch);
      return;
    }

    let titles = [];
    try {
      titles = download.extractTorrentFileTitles(fetched.torrentData);
    } catch (e) {
      unilog(
        1175,
        `API: parse-torrent failed: ${e?.message || String(e)} for "${torTitle()}"`,
      );
      res.json({
        ...baseWrapper,
        success: false,
        stage: "parse-torrent",
        error: e?.message || String(e),
      });
      return;
    }

    let tvProcResult = baseWrapper;
    try {
      appendCallsLog({
        endpoint: "tv-proc:/checkFiles request",
        method: "POST",
        ok: true,
        result: titles,
      });
      tvProcResult = await tvProcCheckFiles(titles);
      appendCallsLog({
        endpoint: "tv-proc:/checkFiles response",
        method: "POST",
        ok: true,
        result: tvProcResult,
      });
    } catch (e) {
      appendCallsLog({
        endpoint: "tv-proc:/checkFiles",
        method: "POST",
        ok: false,
        result: null,
        error: e,
      });
      // Don't upload if tv-proc fails.
      res.json({
        ...baseWrapper,
        success: false,
        stage: "tv-proc",
        error: e?.message || String(e),
      });
      return;
    }

    // If any file titles are already present, do NOT send to qBittorrent.
    const existingTitles = Array.isArray(tvProcResult?.existingTitles)
      ? tvProcResult.existingTitles
      : [];
    const errorTitles = tvEntriesErrorTitles(tvProcResult?.tvEntries);
    if (existingTitles.length > 0 || errorTitles.length > 0) {
      unilog(
        1176,
        `API: tv-proc blocked (${existingTitles.length} existing, ${errorTitles.length} errors) for "${torTitle()}"`,
      );
      appendDownloadsResultLog({
        stage: "tv-proc-blocked",
        existingTitles,
        errorTitles,
      });
      res.json(
        errorTitles.length > 0
          ? { ...tvProcResult, errorTitles }
          : tvProcResult,
      );
      return;
    }

    const hint =
      torrent?.raw?.filename || torrent?.raw?.title || "download.torrent";
    const addTag = `tapi_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const infoHashOf = (data) => {
      try {
        return String(parseTorrent(data)?.infoHash || "")
          .trim()
          .toLowerCase();
      } catch {
        return "";
      }
    };
    const infoHash = infoHashOf(fetched.torrentData);

    // Force mode: hand the completed torrent's files to tv-down for pickup.
    const handoffToTvDown = () => {
      if (!forceDownload || isMovieDownload) return;
      void handoffForcedTorrentToTvDown({
        addTag,
        infoHash: infoHash || undefined,
        torrentTitle: torTitle(),
        torrentFiles: download.extractTorrentFileDetails(fetched.torrentData),
      });
    };

    // Success payload differs by mode (kept exactly as the old two paths).
    const successPayload = (extra = {}) =>
      forceDownload
        ? {
            ...tvProcResult,
            success: true,
            provider: fetched.provider,
            method: fetched.method,
            downloadUrl: fetched.downloadUrl,
            qbAdd: addRes,
            bytes: fetched.bytes,
            hash: infoHash || undefined,
            debug: true,
            ...extra,
          }
        : {
            ...tvProcResult,
            success: true,
            stage: "qbt-add",
            qbAdd: addRes,
            qbtTag: addTag,
            ...extra,
          };

    let addRes;
    try {
      addRes = await addQbtTorrent({
        torrentData: fetched.torrentData,
        filename: hint,
        tags: addTag,
        ...(dlSavePath ? { savePath: dlSavePath } : {}),
      });
    } catch (e) {
      unilog(240, "qbt add threw", {
        addTag,
        force: forceDownload,
        error: e?.message || String(e),
      });
      appendDownloadsResultLog({
        stage: "qbt-add-threw",
        addTag,
        error: e?.message || String(e),
      });
      res.json({
        ...tvProcResult,
        success: false,
        stage: "qbt-add",
        error: e?.message || String(e),
      });
      return;
    }

    unilog(241, "qbt add response", {
      addTag,
      force: forceDownload,
      ok: addRes.ok,
      status: addRes.status,
      text: addRes.text,
    });
    appendDownloadsResultLog({
      stage: "qbt-add-response",
      addTag,
      ok: addRes.ok,
      status: addRes.status,
      text: addRes.text,
    });

    if (!addRes.ok) {
      // qB sometimes returns "Fails." but still adds the torrent. If we can find a torrent
      // with the unique tag we used for this request, treat it as success.
      try {
        const tagged = await getQbtInfo({ tag: addTag });
        const list = Array.isArray(tagged) ? tagged : [];
        if (list.length > 0) {
          unilog(242, "qbt add disambiguated as success via tag", {
            addTag,
            force: forceDownload,
            count: list.length,
          });
          handoffToTvDown();
          res.json(successPayload(forceDownload ? { qbtTag: addTag } : {}));
          return;
        }
      } catch {
        // ignore
      }

      // qB uses 200 OK with body "Fails." for duplicates and other add failures.
      // Disambiguate by checking whether the torrent exists after the add attempt.
      if (infoHash) {
        try {
          const qbtInfo = await getQbtInfo({ hash: infoHash });
          const list = Array.isArray(qbtInfo) ? qbtInfo : [];
          if (list.length > 0) {
            if (forceDownload) {
              // Force mode: delete existing torrent and re-add
              try {
                await delQbtTorrent({ hash: infoHash, deleteFiles: true });
              } catch {
                // ignore delete error
              }
              try {
                await addQbtTorrent({
                  torrentData: fetched.torrentData,
                  filename: hint,
                  tags: addTag,
                });
              } catch {
                // ignore re-add error
              }
              handoffToTvDown();
              // No qbAdd in this response (the original add failed).
              const payload = successPayload();
              delete payload.qbAdd;
              res.json(payload);
              return;
            }

            const existing = list[0] || {};
            const existingName = String(existing?.name || "").trim();
            const title = existingName || torTitle() || infoHash;
            unilog(243, "qbt add disambiguated as duplicate via hash", {
              addTag,
              infoHash,
              title,
            });
            res.json({
              ...tvProcResult,
              success: false,
              stage: "qbt",
              error: `QbitTorrent already has torrent ${title}`,
              hash: infoHash,
              qbt: {
                name: existingName || undefined,
                state: existing?.state || undefined,
                progress:
                  typeof existing?.progress === "number"
                    ? existing.progress
                    : undefined,
              },
            });
            return;
          }
        } catch {
          // ignore
        }
      }

      res.json({
        ...tvProcResult,
        success: false,
        stage: "qbt-add",
        error: `qBittorrent add failed: ${addRes.text || "Fails."}`,
        qbAdd: addRes,
      });
      return;
    }

    unilog(244, "qbt add success", { addTag, force: forceDownload });
    appendDownloadsResultLog({
      stage: "qbt-add-success",
      addTag,
      qbAdd: addRes,
    });
    handoffToTvDown();
    res.json(successPayload());
  } catch (error) {
    unilog(248, "Download error:", error);
    res.status(500).json({
      existingTitles: [],
      existingProcids: [],
      success: false,
      stage: "exception",
      error: error?.message || String(error),
    });
  }
}

// POST /api/download - Download a torrent file
app.post("/api/download", handleDownloadRequest);

// Back-compat alias for older clients/nginx rewrites.
app.post("/downloads", handleDownloadRequest);

app.post("/api/tor/info", async (req, res) => {
  const torrent = req.body?.torrent;
  if (!torrent || typeof torrent !== "object") {
    return res
      .status(400)
      .json({ success: false, error: "torrent object required" });
  }
  const provider = String(torrent?.raw?.provider || torrent?.provider || "")
    .trim()
    .toLowerCase();
  const publicProviders = new Set(["thepiratebay", "limetorrents", "eztv"]);
  try {
    const fetched = await download.fetchTorrentFile(torrent);
    if (!fetched || !fetched.success) {
      return res.json({
        success: false,
        error: publicProviders.has(provider)
          ? "No torrent file available for this provider"
          : fetched?.error || "Failed to fetch torrent",
      });
    }
    const info = download.extractTorrentInfo(fetched.torrentData);
    return res.json({
      success: true,
      provider: fetched.provider,
      method: fetched.method,
      downloadUrl: fetched.downloadUrl,
      bytes: fetched.bytes,
      info,
    });
  } catch (e) {
    return res.json({ success: false, error: e?.message || String(e) });
  }
});

app.post("/api/tor/chk-subs", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  const showContext = req.body?.showContext || {};
  if (!items || items.length === 0) {
    return res
      .status(400)
      .json({ success: false, error: "items array required" });
  }

  const year = getYearFromShowContext(showContext);
  const imdbId = String(showContext?.imdbId || "").trim();

  const processItem = async (item) => {
    const key = String(item?.key || "").trim();
    const torrent = item?.torrent;
    if (!torrent || typeof torrent !== "object") {
      return { key, count: 0, message: "", error: "torrent object required" };
    }

    let files;
    try {
      const fetched = await download.fetchTorrentFile(torrent);
      if (!fetched?.success) {
        return {
          key,
          count: 0,
          message: "",
          error: fetched?.error || "Failed to fetch torrent",
        };
      }
      files = download.extractTorrentFileDetails(fetched.torrentData);
    } catch (e) {
      return { key, count: 0, message: "", error: e?.message || String(e) };
    }

    // Run provider subs check and OpenSubtitles count in parallel.
    const [providerSubs, opnResult] = await Promise.all([
      detectTorrentSubtitlesForTorrent(torrent, { files }),
      (async () => {
        let videoFiles = files.filter((file) => isVideoPath(file?.path));
        const packedArchiveFiles = files.filter((file) =>
          isPackedArchivePath(file?.path),
        );
        const packedArchiveRepresentatives =
          videoFiles.length === 0 && packedArchiveFiles.length > 0
            ? getPackedArchiveRepresentatives(packedArchiveFiles).map(
                (filePath) => ({
                  path: filePath,
                  size:
                    files.find(
                      (file) => String(file?.path || "") === filePath,
                    )?.size ?? null,
                  packedArchive: true,
                }),
              )
            : [];

        if (
          videoFiles.length === 0 &&
          packedArchiveRepresentatives.length > 0
        ) {
          videoFiles = packedArchiveRepresentatives;
        }

        if (videoFiles.length === 0) {
          return {
            count: 0,
            message:
              packedArchiveFiles.length > 0
                ? "Packed archive"
                : "No video files",
          };
        }

        const opnRequests = [];
        for (const file of videoFiles) {
          const videoPath = String(file?.path || "");
          const seasonEpisode = getSeasonEpisodeForTorrentPath(videoPath);
          const showName = deriveTorrentShowName(showContext, torrent, videoPath);
          if (
            showName &&
            Number.isInteger(seasonEpisode?.season) &&
            Number.isInteger(seasonEpisode?.episode)
          ) {
            const request = {
              key: `${key}|${videoPath}`,
              season: seasonEpisode.season,
              episode: seasonEpisode.episode,
            };
            if (imdbId) request.imdb_id = imdbId;
            else request.query = showName;
            if (!imdbId && year) request.year = year;
            opnRequests.push(request);
          }
        }

        if (opnRequests.length > 0) {
          const opnResults = await fetchEpisodeSubtitleCounts(opnRequests);
          const counts = opnResults
            .map((entry) => Number(entry?.count))
            .filter((count) => Number.isFinite(count));
          return {
            count: counts.length > 0 ? Math.min(...counts) : 0,
            message: "",
          };
        }

        return { count: 0, message: "" };
      })(),
    ]);

    const result = {
      key,
      count: opnResult.count,
      message: opnResult.message || "",
      error: null,
      providerSubs,
    };
    qbtChannelPeer?.publishDelta("chkSubsResult", [result]);
    return result;
  };

  try {
    // Process up to 3 items concurrently. Each item runs 2 checks in parallel:
    // the provider page/torrent-file check and the OpenSubtitles count.
    const CHK_SUBS_CONCURRENCY = 3;
    const results = [];
    for (let i = 0; i < items.length; i += CHK_SUBS_CONCURRENCY) {
      const batch = items.slice(i, i + CHK_SUBS_CONCURRENCY);
      results.push(...(await Promise.all(batch.map(processItem))));
    }
    return res.json({ success: true, results });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, error: e?.message || String(e) });
  }
});

app.get("/api/tor/subs", async (req, res) => {
  const detailUrl = String(req.query.url || "").trim();
  if (!detailUrl) {
    return res.status(400).json({ success: false, error: "url query required" });
  }

  try {
    const result = await detectTorrentSubtitlesByUrl(detailUrl);
    return res.json({ success: true, result });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, error: e?.message || String(e) });
  }
});

// GET /api/torrent-file?show=ShowName
// Get and upload a torrent file for a show using public providers (TPB/LIM/EZT)
app.get("/api/torrent-file", async (req, res) => {
  const showName = req.query.show;
  if (!showName) {
    return res.status(400).json({ error: "show query parameter required" });
  }
  const savePath = req.query.savePath
    ? String(req.query.savePath).trim()
    : null;
  try {
    // If the client sent a specific magnet (the user selected a specific result),
    // use it directly instead of doing a fresh search that may return the wrong torrent.
    const magnetUrl = String(req.query.magnet || "").trim();
    if (magnetUrl.startsWith("magnet:")) {
      unilog(249, "using provided magnet for:", showName);
      const magRes = await addQbtMagnet({ magnetUrl, savePath });
      if (!magRes.ok) {
        return res
          .status(500)
          .json({ error: `Magnet add failed: ${magRes.text}` });
      }
      return res.json({ success: true, filename: "(magnet)", bytes: 0 });
    }

    // If the client sent a direct torrent URL (e.g. Limetorrents link), try to
    // extract the info hash and use a magnet link (avoids truncated torrent files
    // from caching services like itorrents.net).
    const linkUrl = String(req.query.link || "").trim();
    if (linkUrl.startsWith("http")) {
      const hashMatch = linkUrl.match(/([0-9a-fA-F]{40})\.torrent/i);
      if (hashMatch) {
        const infoHash = hashMatch[1].toUpperCase();
        const dn = encodeURIComponent(showName);
        const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${dn}`;
        const magRes = await addQbtMagnet({ magnetUrl: magnet, savePath });
        if (!magRes.ok) {
          return res
            .status(500)
            .json({ error: `Magnet add failed: ${magRes.text}` });
        }
        return res.json({ success: true, filename: "(magnet)", bytes: 0 });
      }
      // No hash in URL — fall through to getTorrentFile search
      unilog(250, "no hash in link URL, falling through to search:", linkUrl);
    }

    const fileBuffer = await search.getTorrentFile(showName);
    if (!fileBuffer) {
      return res.status(404).json({ error: "No torrent file found for show" });
    }
    unilog(
      251,
      "adding via qbt WebAPI for:",
      showName,
      "bytes:",
      fileBuffer.length,
    );
    const addRes = await addQbtTorrent({
      torrentData: fileBuffer,
      filename: showName,
      savePath,
    });
    unilog(252, "qbt add result:", {
      ok: addRes.ok,
      status: addRes.status,
      text: addRes.text,
    });
    if (!addRes.ok) {
      return res
        .status(500)
        .json({ error: `qBittorrent add failed: ${addRes.text || "Fails."}` });
    }
    res.json({
      success: true,
      filename: showName,
      bytes: fileBuffer.length,
    });
  } catch (err) {
    unilog(253, "torrent-file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/getBrowseShow
app.get("/api/getBrowseShow", async (req, res) => {
  try {
    const { titles, pendingBrowsedId } = await getBrowseShow();
    appendCallsLog({
      endpoint: "/api/getBrowseShow",
      method: "GET",
      ok: true,
    });
    res.json({ titles, pendingBrowsedId });
  } catch (error) {
    unilog(254, "getBrowseShow error:", error);
    appendCallsLog({
      endpoint: "/api/getBrowseShow",
      method: "GET",
      ok: false,
      result: null,
      error,
    });
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/getAllBrowse", async (req, res) => {
  try {
    const result = await getAllBrowse();
    // Do not log this call to avoid spamming the log if called frequently or on every page load
    // appendCallsLog({
    //   endpoint: "/api/getAllBrowse",
    //   method: "GET",
    //   ok: true,
    //   result,
    // });
    res.json(result);
  } catch (error) {
    unilog(255, "getAllBrowse error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/hasBrowseShow — lightweight check whether a candidate show exists
app.get("/api/hasBrowseShow", (req, res) => {
  res.json(getBrowseHasMorePayload());
});

// GET /api/browseSearch?q=text — search tvmaze.sqlite by name (ignores browsed status)
app.get("/api/browseSearch", (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json([]);
    const shows = searchShowsByName(q);
    const results = shows.map((show) => ({
      status: "ok",
      title: buildShowTitle(show),
      imdbid: show.externals?.imdb,
      tvdbid: show.externals?.thetvdb,
      data: show,
    }));
    res.json(results);
  } catch (error) {
    unilog(256, "browseSearch error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/getBrowseShow (for compat if needed, though arguments are ignored now)
app.post("/api/getBrowseShow", async (req, res) => {
  try {
    const { titles, pendingBrowsedId } = await getBrowseShow();
    appendCallsLog({
      endpoint: "/api/getBrowseShow",
      method: "POST",
      ok: true,
    });
    res.json({ titles, pendingBrowsedId });
  } catch (error) {
    unilog(257, "getBrowseShow error:", error);
    appendCallsLog({
      endpoint: "/api/getBrowseShow",
      method: "POST",
      ok: false,
      result: null,
      error,
    });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ackBrowsed — client calls this after show is displayed
app.post("/api/ackBrowsed", (req, res) => {
  const tvmazeId = Number(req.body?.tvmazeId);
  if (!Number.isFinite(tvmazeId))
    return res.status(400).json({ error: "invalid tvmazeId" });
  ackBrowsed(tvmazeId);
  publishBrowseHasMoreChannel();
  res.json({ ok: true });
});

// POST /api/removeBrowseCard — remove a show from browse-cards.json without touching db
app.post("/api/removeBrowseCard", (req, res) => {
  const { tvdbId, name } = req.body || {};
  if (!tvdbId && !name)
    return res.status(400).json({ error: "missing tvdbId or name" });
  removeResultTitleByTvdbId(tvdbId || null, name || null);
  publishBrowseHasMoreChannel();
  res.json({ ok: true });
});

// POST /api/unackBrowsed — reset browsed=0 so show returns to browse rotation
app.post("/api/unackBrowsed", (req, res) => {
  const { tvdbId } = req.body || {};
  if (!tvdbId) return res.status(400).json({ error: "missing tvdbId" });
  unmarkShowBrowsed(tvdbId);
  removeResultTitleByTvdbId(tvdbId);
  publishBrowseHasMoreChannel();
  res.json({ ok: true });
});

app.post("/api/getActorPage", async (req, res) => {
  let actorName = req.body;
  if (typeof actorName === "object" && actorName !== null && actorName.name) {
    actorName = actorName.name;
  }
  try {
    // Search IMDb for the actor
    const searchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(actorName)}&s=nm`;
    const searchResp = await fetch(searchUrl);

    if (!searchResp.ok) {
      unilog(258, "getActorPage IMDb search failed:", searchResp.status);
      const wikiUrl = `https://en.wikipedia.org/wiki/${actorName.replace(/\s+/g, "_")}`;
      res.json(wikiUrl);
      return;
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
      res.json(actorUrl);
      return;
    }

    // No exact match found, return Wikipedia URL
    const wikiUrl = `https://en.wikipedia.org/wiki/${actorName.replace(/\s+/g, "_")}`;
    res.json(wikiUrl);
  } catch (err) {
    unilog(259, "getActorPage error:", err.message);
    const wikiUrl = `https://en.wikipedia.org/wiki/${actorName.replace(/\s+/g, "_")}`;
    res.json(wikiUrl);
  }
});

// Browser operation queue to prevent concurrent Playwright instances
class BrowserQueue {
  constructor() {
    this.queue = [];
    this.running = false;
  }

  async enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.running || this.queue.length === 0) return;

    this.running = true;
    const { task, resolve, reject } = this.queue.shift();

    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running = false;
      this.processQueue(); // Process next item
    }
  }
}

const browserQueue = new BrowserQueue();

// Server-side cache for actor credits (in-memory)
const actorCreditsCache = new Map();
const ACTOR_CREDITS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-flight request tracking to prevent concurrent browser launches
const inFlightRequests = new Map();

app.post("/api/getActorCredits", async (req, res) => {
  unilog(260, `/api/getActorCredits received`);
  let actorName = req.body;
  if (typeof actorName === "object" && actorName !== null && actorName.name) {
    actorName = actorName.name;
  }
  unilog(261, `Actor name: ${actorName}`);
  try {
    const cacheKey = actorName.toLowerCase().trim();
    const cached = actorCreditsCache.get(cacheKey);

    // Check if cached and not expired
    if (cached && Date.now() - cached.timestamp < ACTOR_CREDITS_CACHE_TTL) {
      unilog(262, `Returning cached credits for actor: ${actorName}`);
      return res.json(cached.data);
    }

    // Check if request is already in-flight for this actor
    if (inFlightRequests.has(cacheKey)) {
      unilog(263, `Waiting for in-flight request for actor: ${actorName}`);
      const result = await inFlightRequests.get(cacheKey);
      unilog(264, `In-flight request completed`);
      return res.json(result);
    }

    // Create promise for this request to allow others to wait
    unilog(265, `Fetching credits for actor: ${actorName}`);
    const fetchPromise = browserQueue
      .enqueue(() =>
        getActorCredits(actorName, {
          // Headed reduces IMDb bot detection. Only works because pm2 runs
          // tv-api under xvfb-run (see the pm2 config on the remote server).
          headless: false,
        }),
      )
      .then((result) => {
        // Cache the result
        actorCreditsCache.set(cacheKey, {
          data: result,
          timestamp: Date.now(),
        });
        inFlightRequests.delete(cacheKey);
        return result;
      })
      .catch((err) => {
        inFlightRequests.delete(cacheKey);
        throw err;
      });

    inFlightRequests.set(cacheKey, fetchPromise);
    const result = await fetchPromise;
    res.json(result);
  } catch (err) {
    unilog(266, "getActorCredits error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/reviews/getImdbReviews", async (req, res) => {
  const imdbId = req.query.imdbId;
  const args = { imdbId };
  try {
    appendReviewCallsLog({
      endpoint: "/api/reviews/getImdbReviews",
      method: "GET",
      event: "START",
      args,
    });
    const result = await reviews.getImdbReviews(imdbId);
    appendCallsLog({
      endpoint: "/api/reviews/getImdbReviews",
      method: "GET",
      ok: true,
      result,
    });
    appendReviewCallsLog({
      endpoint: "/api/reviews/getImdbReviews",
      method: "GET",
      event: "END",
      ok: true,
      args,
      result,
    });
    res.json(result);
  } catch (error) {
    unilog(268, "getImdbReviews error:", error);
    appendCallsLog({
      endpoint: "/api/reviews/getImdbReviews",
      method: "GET",
      ok: false,
      result: null,
      error,
    });
    appendReviewCallsLog({
      endpoint: "/api/reviews/getImdbReviews",
      method: "GET",
      event: "END",
      ok: false,
      args,
      result: null,
      error,
    });
    res.json({
      ok: false,
      error: error?.message || String(error),
      numChecked: 0,
      notEnglishCount: 0,
      noReviewCount: 0,
      smallTextCount: 0,
      reviews: [],
    });
  }
});

https.createServer(httpsOptions, app).listen(API_PORT, () => {
  // Start tvmaze sync only in the api server, not when imported by other apps
  startTvmaze();
  qbtChannelPeer = new ChannelPeer({
    channels: {
      qbtInfo: {
        snapshot: getQbtChannelSnapshot,
        onFirstSubscriber: startQbtChannelPolling,
        onLastUnsubscriber: stopQbtChannelPolling,
      },
      browseHasMore: {
        snapshot: getBrowseHasMoreChannelSnapshot,
        onFirstSubscriber: startBrowseHasMoreChannelPolling,
        onLastUnsubscriber: stopBrowseHasMoreChannelPolling,
      },
      chkSubsResult: {
        snapshot: () => null,
      },
    },
    log: (message) => unilog(1501, `${message}`),
  });
  qbtChannelPeer.start();
});
