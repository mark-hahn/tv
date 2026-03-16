import express from "express";
import https from "https";
import fs from "fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import parseTorrent from "parse-torrent";
import * as search from "./search.js";
import { searchTorrentsInChild } from "./searchInChild.js";
import * as download from "./download.js";
import "./tvmaze.js";
import {
  getQbtInfo,
  delQbtTorrent,
  spaceAvail,
  spaceAvailUsb,
  spaceAvailMedia,
  flexgetHistory,
  addQbtTorrent,
  addQbtMagnet,
  getUsbFiles,
  getUsbPruneStatus,
  pruneUsbFiles,
  renameUsbFile,
} from "./usb.js";
import { getLocalFiles } from "./local.js";
import { getBrowseShow, getAllBrowse } from "./browse.js";
import * as reviews from "./reviews.js";
import { checkFiles as tvProcCheckFiles } from "./tv-proc.js";
import { getActorCredits } from "./imdb-credits.js";
import { postHistory, parseTitleFromFilename } from "@tv/share";
import parseTorrentTitlePkg from "parse-torrent-title";
import {
  getApiCookiesDir,
  getTvprocJsonPath,
  getApiMiscDir,
  getApiSecretsDir,
  getSecretsDir,
  preferSharedReadPath,
} from "./tvPaths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    console.error("Review logging failed", err);
  }
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

function readRequiredTextFile(filePath, label) {
  try {
    return String(fs.readFileSync(filePath, "utf8") || "").trim();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Missing required ${label} at ${filePath}. (${msg})`);
  }
}

const app = express();

const QBT_TEST_PORT = 3001;
const DUMP_INFO = false;
const FILTER_TORRENTS = false;

// Load SSL certificate (prefer shared cookie store)
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
  const disableInternalCors = process.env.DISABLE_INTERNAL_CORS === "1";
  const behindProxy = Boolean(
    req.headers["x-forwarded-host"] ||
    req.headers["x-forwarded-proto"] ||
    req.headers["x-forwarded-for"],
  );

  if (hasOrigin && !behindProxy && !disableInternalCors) {
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

function getRootSecretsDir() {
  // Checkout-independent shared secrets directory (created if missing).
  return getSecretsDir();
}

function getSubsLoginPath() {
  return path.join(getRootSecretsDir(), "subs-login.txt");
}

function getSubsTokenReadPath() {
  return path.join(getRootSecretsDir(), "subs-token.txt");
}

function getSubsTokenWritePath() {
  return path.join(getRootSecretsDir(), "subs-token.txt");
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
  await writeTextFile(getSubsTokenWritePath(), token);
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
    const inPath = path.join(getApiCookiesDir(), "cf_clearance-cookies.json");
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

    const outPath = path.join(getApiCookiesDir(), "cf_clearance-cookies.json");
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
    console.error("[cf_clearance] saved", {
      path: outPath,
      keys: Object.keys(current),
      iptLen: current.iptorrents ? String(current.iptorrents).length : 0,
      tlLen: current.torrentleech ? String(current.torrentleech).length : 0,
    });

    res.json({ ok: true, path: outPath, keys: Object.keys(current) });
  } catch (error) {
    console.error("[cf_clearance] error", error);
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

async function flexget() {
  return flexgetHistory();
}

// Initialize torrent search providers
search.initializeProviders();

if (
  FILTER_TORRENTS &&
  typeof FILTER_TORRENTS === "object" &&
  !Array.isArray(FILTER_TORRENTS)
) {
  (async () => {
    try {
      const info = await getQbtInfo(FILTER_TORRENTS);
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
      console.log(
        `qbt startup dump wrote ${Array.isArray(info) ? info.length : 0} torrents -> ${outPath}`,
      );
    } catch (e) {
      console.error("qbt startup dump error:", e);
    }
  })();
}

// API endpoint
// app.get("/api/tvdb/*", tvdbProxyGet);

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
    console.error("tvproc clear error:", error);
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
    console.error("startProc proxy error:", error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.post("/api/tvproc/forceDown", async (req, res) => {
  try {
    const files = req.body; // already parsed by express.json()
    if (Array.isArray(files)) {
      for (const fileEntry of files) {
        const lineParts = fileEntry.split("-");
        lineParts.pop(); // remove size
        const filePath = lineParts.join("-").slice(11); // strip YYYY-MM-DD-
        const pathParts = filePath.split("/");
        const folderName = pathParts.length >= 2 ? pathParts[0] : "";
        const fname = pathParts[pathParts.length - 1] || "";
        let parsed = {};
        try {
          parsed = parseTorrentTitlePkg.parse(fname) || {};
        } catch (_) {}
        const showName =
          parseTitleFromFilename(fname, folderName, parsed) || fname;
        postHistory({
          showName,
          type: "forceDown",
          description: fname,
        });
      }
    }
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
    console.error("forceDown proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/qbt/info", async (req, res) => {
  try {
    const q = req.query || {};
    const filterObj = {};
    if (typeof q.hash === "string" && q.hash) filterObj.hash = q.hash;
    if (typeof q.category === "string" && q.category)
      filterObj.category = q.category;
    if (typeof q.tag === "string" && q.tag) filterObj.tag = q.tag;
    if (typeof q.filter === "string" && q.filter) filterObj.filter = q.filter;

    const useFilter = Object.keys(filterObj).length > 0 ? filterObj : undefined;
    const info = await getQbtInfo(useFilter);

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
        console.error("qbt info dump error:", e);
      }
    }

    res.json(info);
  } catch (error) {
    console.error("qbt info error:", error);
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
    console.error("qbt delTorrent error:", error);
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.get("/api/space/avail", async (req, res) => {
  try {
    const info = await spaceAvail();
    res.json(info);
  } catch (error) {
    console.error("spaceAvail error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/space/usb", async (req, res) => {
  try {
    const info = await spaceAvailUsb();
    res.json(info);
  } catch (error) {
    console.error("spaceAvailUsb error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/space/srvr", async (req, res) => {
  try {
    const info = await spaceAvailMedia();
    res.json(info);
  } catch (error) {
    console.error("spaceAvailMedia error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/flexget", async (req, res) => {
  try {
    const txt = await flexget();
    res.type("text/plain").send(txt);
  } catch (error) {
    console.error("flexget error:", error);
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

app.post("/api/usb/prune", async (req, res) => {
  try {
    const result = await pruneUsbFiles();
    res.json(result);
  } catch (err) {
    console.error("usb prune error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get("/api/usb/prune/status", async (req, res) => {
  try {
    const status = getUsbPruneStatus();
    res.json(status);
  } catch (err) {
    console.error("usb prune status error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post("/api/usb/rename", async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) {
      return res.status(400).json({ error: "Missing oldPath or newName" });
    }
    const result = await renameUsbFile(oldPath, newName);
    res.json(result);
  } catch (err) {
    console.error("usb rename error:", err);
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

app.get("/api/search", async (req, res) => {
  const showName = req.query.show;
  const tvdbId = req.query.tvdbId || null;
  const limit = parseInt(req.query.limit) || 100;
  const iptCfRaw = req.query.ipt_cf;
  const tlCfRaw = req.query.tl_cf;
  const more = req.query.more === "true";
  let needed = [];

  // Parse needed array if provided
  if (req.query.needed) {
    try {
      needed = JSON.parse(req.query.needed);
    } catch (err) {
      console.error("Error parsing needed array:", err);
    }
  }

  if (!showName) {
    return res.status(400).json({ error: "Show name is required" });
  }

  postHistory({
    tvdbId,
    showName,
    type: "torSrch",
    description: `search: ${showName}`,
  });

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
    });
    res.json(result);
  } catch (error) {
    console.error("Search error:", error);
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

    let token = await readTextIfExists(getSubsTokenReadPath());

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
    console.error("[subs] search error:", error);
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
    const dlShowName = String(body.showName || "").trim() || null;
    const dlTvdbId = String(body.tvdbId || "").trim() || null;
    // Temporary: hardwire debug on so we always return/emit extra diagnostics.
    const debug = true;

    appendDownloadsRequestLog(body);

    if (debug) {
      console.log("[downloads] request", {
        forceDownload,
        provider: torrent?.provider || torrent?.raw?.provider || undefined,
        id: torrent?.raw?.id || torrent?.id || undefined,
        title: torrent?.raw?.title || torrent?.title || undefined,
      });
    }

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

    const postTorErr = (stage, errorMsg) => {
      postHistory({
        tvdbId: dlTvdbId,
        showName: dlShowName || torTitle(),
        type: "torErr",
        description: `${stage}: ${errorMsg} | ${torTitle()}`,
      });
    };

    if (!torrent) {
      postTorErr("validate", "Torrent data is required");
      res.status(400).json({
        ...baseWrapper,
        success: false,
        stage: "validate",
        error: "Torrent data is required",
      });
      return;
    }

    // Default behavior: consult tv-proc before uploading.
    if (!forceDownload) {
      const fetched = await download.fetchTorrentFile(torrent);
      if (!fetched || typeof fetched !== "object") {
        postTorErr("fetch-torrent", "Unexpected fetchTorrentFile result");
        res.json({
          ...baseWrapper,
          success: false,
          stage: "fetch-torrent",
          error: "Unexpected fetchTorrentFile result",
        });
        return;
      }
      if (!fetched.success) {
        postTorErr("fetch-torrent", fetched.error || "fetch failed");
        res.json({ ...baseWrapper, ...fetched });
        return;
      }

      const valid = download.validateTorrentBytes(fetched.torrentData);
      if (!valid.success) {
        try {
          const rawTitle = String(
            torrent?.raw?.title ||
              torrent?.title ||
              torrent?.clientTitle ||
              "unknown",
          ).trim();
          const safeTitle = rawTitle
            .replace(/[^a-zA-Z0-9._-]/g, "_")
            .slice(0, 80);
          const badPath = `/root/dev/apps/tv/bad-torrent-${safeTitle}.txt`;
          fs.writeFileSync(badPath, fetched.torrentData);
        } catch (e) {
          console.error("[downloads] failed to save bad torrent file", e);
        }
        postTorErr("validate", valid.error || "invalid torrent bytes");
        res.json({ ...baseWrapper, ...valid });
        return;
      }

      // Guardrail: if the request implies a specific year, and the torrent's internal name
      // includes a conflicting year, refuse to upload (prevents "wrong show" mismatches).
      try {
        const expectedYear =
          (Number.isFinite(Number(torrent?.raw?.year))
            ? Number(torrent?.raw?.year)
            : null) ||
          extractYearFromString(
            torrent?.raw?.title || torrent?.title || torrent?.clientTitle,
          );

        if (expectedYear && expectedYear >= 1950 && expectedYear <= 2050) {
          const parsed = parseTorrent(fetched.torrentData);
          const parsedName = String(parsed?.name || "").trim();
          const actualYear = extractYearFromString(parsedName);
          if (actualYear && actualYear !== expectedYear) {
            const requestedTitle = String(
              torrent?.raw?.title ||
                torrent?.title ||
                torrent?.clientTitle ||
                "",
            ).trim();
            postTorErr(
              "validate-torrent-metadata",
              `year mismatch (requested ${expectedYear}, torrent says ${actualYear})`,
            );
            res.json({
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
            });
            return;
          }
        }
      } catch {
        // ignore metadata validation failures
      }

      let titles = [];
      try {
        titles = download.extractTorrentFileTitles(fetched.torrentData);
      } catch (e) {
        postTorErr("parse-torrent", e?.message || String(e));
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
        postTorErr("tv-proc", e?.message || String(e));
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
        if (debug)
          console.log("[downloads] blocked by tv-proc", {
            existingTitles: existingTitles.length,
            errorTitles: errorTitles.length,
          });
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
      let addRes;
      const addTag = `tapi_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      try {
        addRes = await addQbtTorrent({
          torrentData: fetched.torrentData,
          filename: hint,
          tags: addTag,
        });
      } catch (e) {
        if (debug)
          console.log("[downloads] qbt add threw", {
            addTag,
            error: e?.message || String(e),
          });
        appendDownloadsResultLog({
          stage: "qbt-add-threw",
          addTag,
          error: e?.message || String(e),
        });
        const errTorTitle = String(
          torrent?.raw?.title ||
            torrent?.title ||
            torrent?.clientTitle ||
            "unknown",
        ).trim();
        postHistory({
          tvdbId: dlTvdbId,
          showName: dlShowName || errTorTitle,
          type: "torErr",
          description: `qbt add threw: ${e?.message || String(e)} | ${errTorTitle}`,
        });
        res.json({
          ...tvProcResult,
          success: false,
          stage: "qbt-add",
          error: e?.message || String(e),
        });
        return;
      }

      if (debug)
        console.log("[downloads] qbt add response", {
          addTag,
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
            if (debug)
              console.log(
                "[downloads] qbt add disambiguated as success via tag",
                { addTag, count: list.length },
              );
            let tagInfoHash = "";
            try {
              const parsed = parseTorrent(fetched.torrentData);
              tagInfoHash = String(parsed?.infoHash || "")
                .trim()
                .toLowerCase();
            } catch {
              // ignore
            }
            const tagTorTitle = String(
              torrent?.raw?.title ||
                torrent?.title ||
                torrent?.clientTitle ||
                "unknown",
            ).trim();
            postHistory({
              tvdbId: dlTvdbId,
              showName: dlShowName || tagTorTitle,
              type: "torSent",
              hash: tagInfoHash || undefined,
              description: `${tagTorTitle} | provider: ${torrent?.raw?.provider || torrent?.provider || "?"} | tag: ${addTag}`,
            });
            if (debug) {
              res.json({
                ...tvProcResult,
                success: true,
                stage: "qbt-add",
                qbAdd: addRes,
                qbtTag: addTag,
              });
              return;
            }
            res.json(tvProcResult);
            return;
          }
        } catch {
          // ignore
        }

        // qB uses 200 OK with body "Fails." for duplicates and other add failures.
        // Disambiguate by checking whether the torrent exists after the add attempt.
        let infoHash = "";
        try {
          const parsed = parseTorrent(fetched.torrentData);
          infoHash = String(parsed?.infoHash || "")
            .trim()
            .toLowerCase();
        } catch {
          // ignore
        }

        if (infoHash) {
          try {
            const qbtInfo = await getQbtInfo({ hash: infoHash });
            const list = Array.isArray(qbtInfo) ? qbtInfo : [];
            if (list.length > 0) {
              const existing = list[0] || {};
              const existingName = String(existing?.name || "").trim();
              const fallbackTitle = String(
                torrent?.raw?.title ||
                  torrent?.title ||
                  torrent?.clientTitle ||
                  "",
              ).trim();
              const title = existingName || fallbackTitle || infoHash;
              if (debug)
                console.log(
                  "[downloads] qbt add disambiguated as duplicate via hash",
                  { addTag, infoHash, title },
                );
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
        const failTorTitle = String(
          torrent?.raw?.title ||
            torrent?.title ||
            torrent?.clientTitle ||
            "unknown",
        ).trim();
        postHistory({
          tvdbId: dlTvdbId,
          showName: dlShowName || failTorTitle,
          type: "torErr",
          hash: infoHash || undefined,
          description: `qbt add failed: ${addRes.text || "Fails."} | ${failTorTitle}`,
        });
        return;
      }

      // In this mode, always return the tv-proc wrapper unchanged.
      if (debug) {
        console.log("[downloads] qbt add success", { addTag });
        appendDownloadsResultLog({
          stage: "qbt-add-success",
          addTag,
          qbAdd: addRes,
        });
        const torTitle = String(
          torrent?.raw?.title ||
            torrent?.title ||
            torrent?.clientTitle ||
            "unknown",
        ).trim();
        postHistory({
          tvdbId: dlTvdbId,
          showName: dlShowName || torTitle,
          type: "torSent",
          hash: infoHash || undefined,
          description: `${torTitle} | provider: ${torrent?.raw?.provider || torrent?.provider || "?"} | tag: ${addTag}`,
        });
        res.json({
          ...tvProcResult,
          success: true,
          stage: "qbt-add",
          qbAdd: addRes,
          qbtTag: addTag,
        });
        return;
      }
      res.json(tvProcResult);
      return;
    }

    // Force mode: still run tv-proc; skip only the qBittorrent hash pre-check.
    const fetched = await download.fetchTorrentFile(torrent);
    if (!fetched || typeof fetched !== "object") {
      res.json({
        ...baseWrapper,
        success: false,
        stage: "fetch-torrent",
        error: "Unexpected fetchTorrentFile result",
      });
      return;
    }
    if (!fetched.success) {
      res.json({ ...baseWrapper, ...fetched });
      return;
    }

    const valid = download.validateTorrentBytes(fetched.torrentData);
    if (!valid.success) {
      res.json({ ...baseWrapper, ...valid });
      return;
    }

    // Same guardrail in force mode.
    try {
      const expectedYear =
        (Number.isFinite(Number(torrent?.raw?.year))
          ? Number(torrent?.raw?.year)
          : null) ||
        extractYearFromString(
          torrent?.raw?.title || torrent?.title || torrent?.clientTitle,
        );

      if (expectedYear && expectedYear >= 1950 && expectedYear <= 2050) {
        const parsed = parseTorrent(fetched.torrentData);
        const parsedName = String(parsed?.name || "").trim();
        const actualYear = extractYearFromString(parsedName);
        if (actualYear && actualYear !== expectedYear) {
          const requestedTitle = String(
            torrent?.raw?.title || torrent?.title || torrent?.clientTitle || "",
          ).trim();
          res.json({
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
            debug,
          });
          return;
        }
      }
    } catch {
      // ignore metadata validation failures
    }

    let titles = [];
    try {
      titles = download.extractTorrentFileTitles(fetched.torrentData);
    } catch (e) {
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
      res.json(
        errorTitles.length > 0
          ? { ...tvProcResult, errorTitles }
          : tvProcResult,
      );
      return;
    }

    const hint =
      torrent?.raw?.filename || torrent?.raw?.title || "download.torrent";
    let addRes;
    const addTag = `tapi_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
      addRes = await addQbtTorrent({
        torrentData: fetched.torrentData,
        filename: hint,
        tags: addTag,
      });
    } catch (e) {
      if (debug)
        console.error("[downloads] qbt add threw (force)", {
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

    if (debug)
      console.error("[downloads] qbt add response (force)", {
        addTag,
        ok: addRes.ok,
        status: addRes.status,
        text: addRes.text,
      });

    if (!addRes.ok) {
      // Same as non-force mode: if the torrent shows up with our unique tag, the add succeeded.
      try {
        const tagged = await getQbtInfo({ tag: addTag });
        const list = Array.isArray(tagged) ? tagged : [];
        if (list.length > 0) {
          if (debug)
            console.error(
              "[downloads] qbt add disambiguated as success via tag (force)",
              { addTag, count: list.length },
            );
          let infoHash = "";
          try {
            const parsed = parseTorrent(fetched.torrentData);
            infoHash = String(parsed?.infoHash || "")
              .trim()
              .toLowerCase();
          } catch {
            // ignore
          }
          const tagTorTitle = String(
            torrent?.raw?.title ||
              torrent?.title ||
              torrent?.clientTitle ||
              "unknown",
          ).trim();
          postHistory({
            tvdbId: dlTvdbId,
            showName: dlShowName || tagTorTitle,
            type: "torSent",
            hash: infoHash || undefined,
            description: `${tagTorTitle} | provider: ${torrent?.raw?.provider || torrent?.provider || "?"} | tag: ${addTag}`,
          });

          res.json({
            ...tvProcResult,
            success: true,
            provider: fetched.provider,
            method: fetched.method,
            downloadUrl: fetched.downloadUrl,
            qbAdd: addRes,
            bytes: fetched.bytes,
            hash: infoHash || undefined,
            qbtTag: addTag,
            debug,
          });
          return;
        }
      } catch {
        // ignore
      }

      let infoHash = "";
      try {
        const parsed = parseTorrent(fetched.torrentData);
        infoHash = String(parsed?.infoHash || "")
          .trim()
          .toLowerCase();
      } catch {
        // ignore
      }

      if (infoHash) {
        try {
          const qbtInfo = await getQbtInfo({ hash: infoHash });
          const list = Array.isArray(qbtInfo) ? qbtInfo : [];
          if (list.length > 0) {
            const existing = list[0] || {};
            const existingName = String(existing?.name || "").trim();
            const fallbackTitle = String(
              torrent?.raw?.title ||
                torrent?.title ||
                torrent?.clientTitle ||
                "",
            ).trim();
            const title = existingName || fallbackTitle || infoHash;
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

    let infoHash = "";
    try {
      const parsed = parseTorrent(fetched.torrentData);
      infoHash = String(parsed?.infoHash || "")
        .trim()
        .toLowerCase();
    } catch {
      // ignore
    }

    res.json({
      ...tvProcResult,
      success: true,
      provider: fetched.provider,
      method: fetched.method,
      downloadUrl: fetched.downloadUrl,
      qbAdd: addRes,
      bytes: fetched.bytes,
      hash: infoHash || undefined,
      debug,
    });
  } catch (error) {
    console.error("Download error:", error);
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

// GET /api/torrent-file?show=ShowName
// Get and upload a torrent file for a show using public providers (TPB/LIM/EZT)
app.get("/api/torrent-file", async (req, res) => {
  const showName = req.query.show;
  if (!showName) {
    return res.status(400).json({ error: "show query parameter required" });
  }
  try {
    // If the client sent a specific magnet (the user selected a specific result),
    // use it directly instead of doing a fresh search that may return the wrong torrent.
    const magnetUrl = String(req.query.magnet || "").trim();
    if (magnetUrl.startsWith("magnet:")) {
      console.log("[torrent-file] using provided magnet for:", showName);
      const magRes = await addQbtMagnet({ magnetUrl });
      if (!magRes.ok) {
        postHistory({
          showName,
          type: "torErr",
          description: `magnet add failed: ${magRes.text} | ${showName}`,
        });
        return res
          .status(500)
          .json({ error: `Magnet add failed: ${magRes.text}` });
      }
      postHistory({
        showName,
        type: "torSent",
        description: `magnet | ${showName}`,
      });
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
        console.log(
          "[torrent-file] using magnet from link hash for:",
          showName,
          infoHash,
        );
        const magRes = await addQbtMagnet({ magnetUrl: magnet });
        if (!magRes.ok) {
          postHistory({
            showName,
            type: "torErr",
            description: `magnet add failed: ${magRes.text} | ${showName}`,
          });
          return res
            .status(500)
            .json({ error: `Magnet add failed: ${magRes.text}` });
        }
        postHistory({
          showName,
          type: "torSent",
          description: `magnet from link hash | ${showName}`,
        });
        return res.json({ success: true, filename: "(magnet)", bytes: 0 });
      }
      // No hash in URL — fall through to getTorrentFile search
      console.log(
        "[torrent-file] no hash in link URL, falling through to search:",
        linkUrl,
      );
    }

    const fileBuffer = await search.getTorrentFile(showName);
    if (!fileBuffer) {
      return res.status(404).json({ error: "No torrent file found for show" });
    }
    console.log(
      "[torrent-file] adding via qbt WebAPI for:",
      showName,
      "bytes:",
      fileBuffer.length,
    );
    const addRes = await addQbtTorrent({
      torrentData: fileBuffer,
      filename: showName,
    });
    console.log("[torrent-file] qbt add result:", {
      ok: addRes.ok,
      status: addRes.status,
      text: addRes.text,
    });
    if (!addRes.ok) {
      postHistory({
        showName,
        type: "torErr",
        description: `qbt add failed: ${addRes.text || "Fails."} | ${showName}`,
      });
      return res
        .status(500)
        .json({ error: `qBittorrent add failed: ${addRes.text || "Fails."}` });
    }
    postHistory({
      showName,
      type: "torSent",
      description: `torrent file | ${showName}`,
    });
    res.json({
      success: true,
      filename: showName,
      bytes: fileBuffer.length,
    });
  } catch (err) {
    console.error("torrent-file error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/getBrowseShow
app.get("/api/getBrowseShow", async (req, res) => {
  try {
    const result = await getBrowseShow();
    appendCallsLog({
      endpoint: "/api/getBrowseShow",
      method: "GET",
      ok: true,
      result,
    });
    res.json(result);
  } catch (error) {
    console.error("getBrowseShow error:", error);
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
    console.error("getAllBrowse error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/getBrowseShow (for compat if needed, though arguments are ignored now)
app.post("/api/getBrowseShow", async (req, res) => {
  try {
    const result = await getBrowseShow();
    appendCallsLog({
      endpoint: "/api/getBrowseShow",
      method: "POST",
      ok: true,
      result,
    });
    res.json(result);
  } catch (error) {
    console.error("getBrowseShow error:", error);
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
      console.error("getActorPage IMDb search failed:", searchResp.status);
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
    console.error("getActorPage error:", err.message);
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
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(
    `[SERVER ${requestId}] /api/getActorCredits received at ${new Date().toISOString()}`,
  );
  let actorName = req.body;
  if (typeof actorName === "object" && actorName !== null && actorName.name) {
    actorName = actorName.name;
  }
  console.log(`[SERVER ${requestId}] Actor name: ${actorName}`);
  try {
    const cacheKey = actorName.toLowerCase().trim();
    const cached = actorCreditsCache.get(cacheKey);

    // Check if cached and not expired
    if (cached && Date.now() - cached.timestamp < ACTOR_CREDITS_CACHE_TTL) {
      console.log(
        `[SERVER ${requestId}] Returning cached credits for actor: ${actorName}`,
      );
      return res.json(cached.data);
    }

    // Check if request is already in-flight for this actor
    if (inFlightRequests.has(cacheKey)) {
      console.log(
        `[SERVER ${requestId}] Waiting for in-flight request for actor: ${actorName}`,
      );
      const result = await inFlightRequests.get(cacheKey);
      console.log(`[SERVER ${requestId}] In-flight request completed`);
      return res.json(result);
    }

    // Create promise for this request to allow others to wait
    console.log(
      `[SERVER ${requestId}] Fetching credits for actor: ${actorName}`,
    );
    const fetchPromise = browserQueue
      .enqueue(() =>
        getActorCredits(actorName, {
          headless: false,
          verbose: false,
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
    console.error("getActorCredits error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/reviews/getReviews", async (req, res) => {
  const rottenUrl = req.query.url;
  const buttonName = req.query.btn;
  const args = { rottenUrl, buttonName };
  try {
    appendReviewCallsLog({
      endpoint: "/api/reviews/getReviews",
      method: "GET",
      event: "START",
      args,
    });
    const result = await reviews.getReviews(rottenUrl, buttonName);
    appendCallsLog({
      endpoint: "/api/reviews/getReviews",
      method: "GET",
      ok: true,
      result,
    });
    appendReviewCallsLog({
      endpoint: "/api/reviews/getReviews",
      method: "GET",
      event: "END",
      ok: true,
      args,
      result,
    });
    res.json(result);
  } catch (error) {
    console.error("getReviews error:", error);
    appendCallsLog({
      endpoint: "/api/reviews/getReviews",
      method: "GET",
      ok: false,
      result: null,
      error,
    });
    appendReviewCallsLog({
      endpoint: "/api/reviews/getReviews",
      method: "GET",
      event: "END",
      ok: false,
      args,
      result: null,
      error,
    });
    // Treat scraper errors as non-fatal so the client can keep working.
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
    console.error("getImdbReviews error:", error);
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

https.createServer(httpsOptions, app).listen(QBT_TEST_PORT, () => {
  // Always print a startup line, even when TORRENTS_DEBUG disables console.log.
  // process.stderr.write(`=\n`);
  // process.stderr.write(
  //   `========== torrents server started on port ${QBT_TEST_PORT} ==========\n`,
  // );
  // process.stderr.write(`=\n`);
});
