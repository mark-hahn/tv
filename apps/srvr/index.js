import fs from "fs";
import * as cp from "child_process";
import * as path from "node:path";
import express from "express";
import cors from "cors";
import https from "https";
import WebSocket, { WebSocketServer } from "ws";
import { rimraf } from "rimraf";
import * as view from "./src/lastViewed.js";
import * as utilNode from "util";
import * as emby from "./src/emby.js";
import * as tvdb from "./src/tvdb.js";
import * as util from "./src/util.js";
import * as email from "./src/email.js";
import * as tmdb from "./src/tmdb.js";
import { handleAsr } from "./src/asr.js";
import { handleFix } from "./src/fix.js";
import { checkFlexgetStatus } from "../api/src/usb.js";
import fetch from "node-fetch";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import { parseFileSeasonEpisode } from "@tv/share";
import chokidar from "chokidar";
import {
  SRVR_ROOT_DIR,
  SRVR_DATA_DIR,
  SRVR_SECRETS_DIR,
} from "./src/srvrPaths.js";
import * as history from "./src/history.js";

const tvdbIdByName = (name) => {
  if (!name) return null;
  const all = tvdb.getAllTvdbSync();
  const rec =
    all[name] ||
    Object.values(all).find(
      (r) => r?.name?.toLowerCase() === name.toLowerCase(),
    );
  return String(rec?.tvdbId || "").trim() || null;
};

const dontupload = false;

const CONFIG_DIR = path.join(SRVR_ROOT_DIR, "config");
const SECRETS_DIR = SRVR_SECRETS_DIR;

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error(
      `[tv-srvr] FATAL: cannot create dir: ${dir}`,
      e?.message || e,
    );
    process.exit(1);
  }
}

function ensureFile(filePath, defaultStr) {
  try {
    if (fs.existsSync(filePath)) return;
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, defaultStr, "utf8");
  } catch (e) {
    console.error(
      `[tv-srvr] FATAL: cannot create required file: ${filePath}`,
      e?.message || e,
    );
    process.exit(1);
  }
}

function firstExistingPath(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return paths && paths[0] ? paths[0] : null;
}

ensureDir(SRVR_DATA_DIR);
ensureDir(SECRETS_DIR);
// Config lives alongside this module (not dependent on process.cwd()).
ensureDir(CONFIG_DIR);

process.setMaxListeners(50);
const tvDir = "/mnt/media/tv";
const exec = utilNode.promisify(cp.exec);

function readTextOr(filePathOrPaths, fallback) {
  const paths = Array.isArray(filePathOrPaths)
    ? filePathOrPaths
    : [filePathOrPaths];
  for (const p of paths) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {}
  }
  return fallback;
}

function configReadCandidates(relativePath) {
  // Config is owned by this app under apps/srvr/config.
  return [path.join(SRVR_ROOT_DIR, relativePath)];
}

function readTextOrWithChosenPath(filePathOrPaths, fallback) {
  const paths = Array.isArray(filePathOrPaths)
    ? filePathOrPaths
    : [filePathOrPaths];
  for (const p of paths) {
    try {
      return { text: fs.readFileSync(p, "utf8"), chosenPath: p };
    } catch {}
  }
  return { text: fallback, chosenPath: null };
}

function configWritePath(fileName) {
  return path.join(CONFIG_DIR, fileName);
}

const headerLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config1-header.txt"),
  "",
);
const rejectLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config2-rejects.json"),
  "[]",
);
const middleLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config3-middle.txt"),
  "",
);
const pickupLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config4-pickups.json"),
  "[]",
);
const footerLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config5-footer.txt"),
  "",
);

const headerStr = headerLoad.text;
const rejectStr = rejectLoad.text;
const middleStr = middleLoad.text;
const pickupStr = pickupLoad.text;
const footerStr = footerLoad.text;

// Strict: shared secrets are checkout-independent under TV_DATA_DIR/secrets.
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

let rejects;
try {
  rejects = JSON.parse(rejectStr);
  if (!Array.isArray(rejects)) {
    throw new Error("rejects config is not an array");
  }
} catch (e) {
  console.error(
    `[tv-srvr] FATAL: invalid JSON in rejects config at ${rejectLoad.chosenPath || "<fallback>"}: ${e.message}`,
  );
  process.exit(1);
}

let pickups;
try {
  pickups = JSON.parse(pickupStr);
  if (!Array.isArray(pickups)) {
    throw new Error("pickups config is not an array");
  }
} catch (e) {
  console.error(
    `[tv-srvr] FATAL: invalid JSON in pickups config at ${pickupLoad.chosenPath || "<fallback>"}: ${e.message}`,
  );
  process.exit(1);
}

function encodeFileIdBase32(fileId) {
  // base-32 using RFC4648 alphabet: A-Z then 2-7.
  // Output is minimal-length (no left padding).
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let n = Number(fileId);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.floor(n);

  let out = "";
  do {
    const digit = n % 32;
    out = alphabet[digit] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  // Prefix with '#' so these can be uniquely identified for later deletion.
  return "#" + out;
}

function encodeFileIdBase32Legacy(fileId) {
  // Legacy base-32 encoding used by older subtitle filenames:
  // alphabet: A-P then a-p.
  // Output is minimal-length (no left padding).
  const alphabet = "ABCDEFGHIJKLMNOPabcdefghijklmnop";
  let n = Number(fileId);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.floor(n);

  let out = "";
  do {
    const digit = n % 32;
    out = alphabet[digit] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  return "#" + out;
}

function encodeFileIdBase32LegacyAZ05(fileId) {
  // Legacy base-32 encoding used briefly:
  // alphabet: A-Z then 0-5.
  // Output is minimal-length (no left padding).
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
  let n = Number(fileId);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.floor(n);

  let out = "";
  do {
    const digit = n % 32;
    out = alphabet[digit] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  return "#" + out;
}

const deleteSubFiles = async (params) => {
  if (params === undefined || params === null || params === "") {
    throw new Error("deleteSubFiles: missing params");
  }

  const fileIdObjs = params;
  if (!Array.isArray(fileIdObjs) || fileIdObjs.length === 0) {
    throw new Error("deleteSubFiles: expected non-empty array");
  }

  const showName =
    typeof fileIdObjs[0]?.showName === "string" ? fileIdObjs[0].showName : "";
  if (!showName || showName.trim() === "") {
    throw new Error("deleteSubFiles: missing showName");
  }
  if (showName.includes("/") || showName.includes("\\")) {
    throw new Error("deleteSubFiles: invalid showName");
  }
  for (const entry of fileIdObjs) {
    if (typeof entry?.showName !== "string" || entry.showName !== showName) {
      throw new Error("deleteSubFiles: all entries must have same showName");
    }
  }

  const localShowPath = path.join(tvDir, showName);
  try {
    const st = fs.statSync(localShowPath);
    if (!st.isDirectory()) {
      throw new Error(`Show directory missing: ${localShowPath} (n/a)`);
    }
  } catch {
    throw new Error(`Show directory missing: ${localShowPath} (n/a)`);
  }

  const searchTags = new Set();
  const fileIdsByTag = new Map();
  const fidToNewTag = new Map();
  for (const entry of fileIdObjs) {
    const file_id = entry?.file_id;
    if (!Number.isFinite(Number(file_id))) {
      throw new Error("deleteSubFiles: invalid file_id");
    }
    const fid = Number(file_id);
    const tagNew = encodeFileIdBase32(fid);
    const tagLegacy = encodeFileIdBase32Legacy(fid);
    const tagLegacy2 = encodeFileIdBase32LegacyAZ05(fid);
    fidToNewTag.set(fid, tagNew);

    for (const tag of [tagNew, tagLegacy, tagLegacy2]) {
      searchTags.add(tag);
      if (!fileIdsByTag.has(tag)) fileIdsByTag.set(tag, new Set());
      fileIdsByTag.get(tag).add(fid);
    }
  }

  const deletedFids = new Set();
  const deleted = [];
  const appliedSet = new Set();
  const failures = [];

  const recurs = async (dirPath) => {
    if (dirPath === tvDir + "/.stfolder") return;
    let dirents;
    try {
      dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
      failures.push({ path: dirPath, error: `readdir failed: ${e.message}` });
      return;
    }

    for (const d of dirents) {
      if (d.isSymbolicLink && d.isSymbolicLink()) continue;
      const p = path.join(dirPath, d.name);
      if (d.isDirectory()) {
        await recurs(p);
        continue;
      }
      if (!d.isFile()) continue;
      if (!d.name || !d.name.toLowerCase().endsWith(".srt")) continue;

      const noExt = d.name.slice(0, -4); // remove .srt
      const lastDot = noExt.lastIndexOf(".");
      if (lastDot < 0) continue;
      const tag = noExt.slice(lastDot + 1);
      if (!searchTags.has(tag)) continue;

      try {
        fs.unlinkSync(p);
        deleted.push(p);
        const fids = fileIdsByTag.get(tag);
        if (fids) {
          for (const fid of fids) {
            appliedSet.add(fid);
            deletedFids.add(fid);
          }
        }
      } catch (e) {
        failures.push({ path: p, tag, error: `unlink failed: ${e.message}` });
      }
    }
  };

  await recurs(localShowPath);

  // Report notFound in terms of the *new* tag, but consider legacy deletions as found.
  const notFound = [];
  for (const fid of fidToNewTag.keys()) {
    if (!deletedFids.has(fid)) notFound.push(fidToNewTag.get(fid));
  }

  return {
    ok: true,
    applied: Array.from(appliedSet),
    deletedCount: deleted.length,
    notFoundCount: notFound.length,
    notFound,
    failures,
  };
};

const getSubFileIds = async (params) => {
  const showName = (params?.showName || "").trim();
  if (!showName) {
    throw new Error("getSubFileIds: missing showName");
  }
  if (showName.includes("/") || showName.includes("\\")) {
    throw new Error("getSubFileIds: invalid showName");
  }

  const localShowPath = path.join(tvDir, showName);
  try {
    const st = fs.statSync(localShowPath);
    if (!st.isDirectory()) {
      throw new Error(`Show directory missing: ${localShowPath} (n/a)`);
    }
  } catch {
    throw new Error(`Show directory missing: ${localShowPath} (n/a)`);
  }

  // Match current Base32 tag style: .#<A-Z2-7>.srt
  const tagRe = /\.\#([A-Z2-7]+)\.srt$/;
  const foundSet = new Set();
  const found = [];

  const recurs = (dirPath) => {
    if (dirPath === tvDir + "/.stfolder") return;
    let dirents;
    try {
      dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (d.isSymbolicLink && d.isSymbolicLink()) continue;
      const p = path.join(dirPath, d.name);
      if (d.isDirectory()) {
        recurs(p);
        continue;
      }
      if (!d.isFile()) continue;
      const name = d.name;
      if (!name || !name.toLowerCase().endsWith(".srt")) continue;
      const m = tagRe.exec(name);
      if (!m) continue;
      const tag = m[1];
      if (foundSet.has(tag)) continue;
      foundSet.add(tag);
      found.push(tag);
    }
  };

  recurs(localShowPath);
  return found;
};

function srtTimeToMs(timeStr) {
  // "hh:mm:ss,mmm" -> ms
  const m = /^([0-9]{2}):([0-9]{2}):([0-9]{2}),([0-9]{3})$/.exec(
    String(timeStr || "").trim(),
  );
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4]);
  if (![hh, mm, ss, ms].every((n) => Number.isFinite(n))) return null;
  return ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
}

function msToSrtTime(msTotal) {
  let ms = Number(msTotal);
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  ms = Math.floor(ms);
  const hh = Math.floor(ms / 3600000);
  ms -= hh * 3600000;
  const mm = Math.floor(ms / 60000);
  ms -= mm * 60000;
  const ss = Math.floor(ms / 1000);
  ms -= ss * 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

const offsetSubFiles = async (fileIdObjs) => {
  if (!Array.isArray(fileIdObjs) || fileIdObjs.length === 0) {
    throw new Error("offsetSubFiles: expected non-empty array");
  }

  const showName =
    typeof fileIdObjs[0]?.showName === "string" ? fileIdObjs[0].showName : "";
  if (!showName || showName.trim() === "") {
    throw new Error("offsetSubFiles: missing showName");
  }
  if (showName.includes("/") || showName.includes("\\")) {
    throw new Error("offsetSubFiles: invalid showName");
  }
  for (const entry of fileIdObjs) {
    if (typeof entry?.showName !== "string" || entry.showName !== showName) {
      throw new Error("offsetSubFiles: all entries must have same showName");
    }
  }

  const localShowPath = path.join(tvDir, showName);
  try {
    const st = fs.statSync(localShowPath);
    if (!st.isDirectory()) {
      throw new Error(`Show directory missing: ${localShowPath} (n/a)`);
    }
  } catch {
    throw new Error(`Show directory missing: ${localShowPath} (n/a)`);
  }

  // Validate offset is present on every entry and identical.
  const offsetRaw = fileIdObjs[0]?.offset;
  const offsetMs = Math.trunc(Number(offsetRaw));
  if (!Number.isFinite(offsetMs)) {
    throw new Error("offsetSubFiles: invalid offset");
  }
  for (const entry of fileIdObjs) {
    const o = Math.trunc(Number(entry?.offset));
    if (!Number.isFinite(o) || o !== offsetMs) {
      throw new Error("offsetSubFiles: offset must be the same on every entry");
    }
  }

  const failures = [];
  const appliedSet = new Set();

  const addFailure = (cand, stage, status, details, error) => {
    const fid = Number(cand?.file_id);
    const showName =
      typeof cand?.showName === "string" ? cand.showName : undefined;
    const season = cand?.season;
    const episode = cand?.episode;

    let reason = "";
    if (status !== undefined && status !== null)
      reason = `${stage} HTTP ${status}`;
    else if (error) reason = `${stage}: ${error}`;
    else reason = stage;

    const rec = {
      file_id: fid,
      showName,
      season,
      episode,
      reason,
      stage,
      status,
    };
    if (details !== undefined) rec.details = details;
    failures.push(rec);
  };

  // Build tag set and scan show folder once for all matching SRTs.
  const searchTags = new Set();
  for (const entry of fileIdObjs) {
    const fid = Number(entry?.file_id);
    if (!Number.isFinite(fid)) {
      addFailure(entry, "input", undefined, undefined, "invalid file_id");
      continue;
    }
    searchTags.add(encodeFileIdBase32(fid));
    searchTags.add(encodeFileIdBase32Legacy(fid));
    searchTags.add(encodeFileIdBase32LegacyAZ05(fid));
  }

  const pathsByTag = new Map();
  const recurs = (dirPath) => {
    if (dirPath === tvDir + "/.stfolder") return;
    let dirents;
    try {
      dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
      failures.push({ path: dirPath, error: `readdir failed: ${e.message}` });
      return;
    }
    for (const d of dirents) {
      if (d.isSymbolicLink && d.isSymbolicLink()) continue;
      const p = path.join(dirPath, d.name);
      if (d.isDirectory()) {
        recurs(p);
        continue;
      }
      if (!d.isFile()) continue;
      if (!d.name || !d.name.toLowerCase().endsWith(".srt")) continue;
      const noExt = d.name.slice(0, -4);
      const lastDot = noExt.lastIndexOf(".");
      if (lastDot < 0) continue;
      const tag = noExt.slice(lastDot + 1);
      if (!searchTags.has(tag)) continue;
      if (!pathsByTag.has(tag)) pathsByTag.set(tag, []);
      pathsByTag.get(tag).push(p);
    }
  };

  recurs(localShowPath);

  const timeLineRe =
    /^([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(\s*-->\s*)([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(.*)$/;

  for (const entry of fileIdObjs) {
    const fid = Number(entry?.file_id);
    if (!Number.isFinite(fid)) {
      addFailure(entry, "input", undefined, undefined, "invalid file_id");
      continue;
    }

    const tags = [
      encodeFileIdBase32(fid),
      encodeFileIdBase32Legacy(fid),
      encodeFileIdBase32LegacyAZ05(fid),
    ];
    const srtPaths = [];
    const seen = new Set();
    for (const t of tags) {
      const arr = pathsByTag.get(t);
      if (!arr) continue;
      for (const p of arr) {
        if (seen.has(p)) continue;
        seen.add(p);
        srtPaths.push(p);
      }
    }

    if (srtPaths.length === 0) {
      addFailure(entry, "find", undefined, { tags }, "subtitle .srt not found");
      continue;
    }

    let anyUpdated = false;
    for (const srtPath of srtPaths) {
      let text;
      try {
        text = fs.readFileSync(srtPath, "utf8");
      } catch (e) {
        addFailure(entry, "read", undefined, { path: srtPath }, e.message);
        continue;
      }

      const lines = String(text).split(/\r?\n/);
      let changed = false;
      let matched = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = timeLineRe.exec(line);
        if (!m) continue;
        const startMs = srtTimeToMs(m[1]);
        const endMs = srtTimeToMs(m[3]);
        if (startMs === null || endMs === null) continue;
        matched++;
        const newStart = Math.max(0, startMs + offsetMs);
        const newEnd = Math.max(0, endMs + offsetMs);
        lines[i] =
          `${msToSrtTime(newStart)}${m[2]}${msToSrtTime(newEnd)}${m[4] || ""}`;
        changed = true;
      }

      if (matched === 0) {
        addFailure(
          entry,
          "parse",
          undefined,
          { path: srtPath },
          "no timing lines found",
        );
        continue;
      }
      if (!changed) {
        // Shouldn't happen if matched>0, but keep it safe.
        addFailure(
          entry,
          "parse",
          undefined,
          { path: srtPath },
          "no changes applied",
        );
        continue;
      }

      try {
        fs.writeFileSync(srtPath, lines.join("\n"), "utf8");
        anyUpdated = true;
      } catch (e) {
        addFailure(entry, "write", undefined, { path: srtPath }, e.message);
      }
    }

    if (anyUpdated) {
      appliedSet.add(fid);
    }
  }

  return { ok: true, applied: Array.from(appliedSet), failures };
};

function parseSeasonEpisodeFromFilename(fileName, folderName) {
  // Returns { season, episode } or null.
  if (!fileName) return null;
  const base = String(fileName);

  let parsedPtt = null;
  let parsedPttFolder = null;
  try {
    parsedPtt = parseTorrentTitle(base);
  } catch {}
  try {
    if (folderName) parsedPttFolder = parseTorrentTitle(String(folderName));
  } catch {}

  const result = parseFileSeasonEpisode(
    base,
    folderName || "",
    parsedPtt,
    parsedPttFolder,
  );
  if (!result || result.season == null || result.episode == null) return null;
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeImdbId(imdbId) {
  if (imdbId === undefined || imdbId === null) return "";
  const s = String(imdbId).trim();
  if (!s) return "";
  // remove leading tt and any non-digits
  return s.replace(/^tt/i, "").replace(/\D/g, "");
}

function loadSubsLogin() {
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
  page,
  season,
}) {
  const url = new URL("https://api.opensubtitles.com/api/v1/subtitles");
  const params = {
    parent_imdb_id: imdbDigits,
    page: String(page),
    languages: "en",
  };
  if (season !== undefined && season !== null) {
    params.season_number = String(season);
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

async function openSubtitlesDownloadWithRetry({
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
      if (retryStatus.has(status)) {
        console.log(
          `[subs] OpenSubtitles /download HTTP ${status} (file_id=${fileId}, attempt=${attempt}/${maxAttempts})`,
        );
      }
      if (retryStatus.has(status) && attempt < maxAttempts) {
        await sleep(400 * attempt);
        continue;
      }
      return last;
    } catch (e) {
      // Network error / fetch throw: retry.
      if (attempt < maxAttempts) {
        await sleep(400 * attempt);
        continue;
      }
      throw e;
    }
  }
  return last;
}

const subsSearch = async (params) => {
  const imdbDigits = normalizeImdbId(params?.imdb_id);
  let page = params?.page;
  const season = params?.season;

  if (!imdbDigits) {
    throw new Error("subsSearch: missing imdb_id");
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
      page,
      season,
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
        page,
        season,
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

function gapEntryHasGap(gap) {
  if (!gap || typeof gap !== "object") return false;

  // Boolean flags that indicate a gap condition.
  if (gap.fileGap === true) return true;
  if (gap.watchGap === true) return true;
  if (gap.notReady === true) return true;

  // Explicit season/episode markers (allow 0).
  if (gap.fileGapSeason !== null && gap.fileGapSeason !== undefined)
    return true;
  if (gap.fileGapEpisode !== null && gap.fileGapEpisode !== undefined)
    return true;
  if (gap.watchGapSeason !== null && gap.watchGapSeason !== undefined)
    return true;
  if (gap.watchGapEpisode !== null && gap.watchGapEpisode !== undefined)
    return true;

  // Non-empty wait string can also indicate a gap state.
  if (typeof gap.waitStr === "string" && gap.waitStr.trim() !== "") return true;

  return false;
}

function stripGapTransientFields(gap) {
  if (!gap || typeof gap !== "object") return false;
  let changed = false;

  // `Waiting` is transient client state; never persist it.
  if (Object.prototype.hasOwnProperty.call(gap, "Waiting")) {
    delete gap.Waiting;
    changed = true;
  }

  // Legacy field removed from the data model; never persist it.
  if (Object.prototype.hasOwnProperty.call(gap, "BlockedGap")) {
    delete gap.BlockedGap;
    changed = true;
  }

  return changed;
}

// Prune gaps on load: only keep shows that currently have gaps.
try {
  if (gaps && typeof gaps === "object" && !Array.isArray(gaps)) {
    let changed = false;
    for (const [gapId, gap] of Object.entries(gaps)) {
      // Never persist transient/removed fields.
      if (stripGapTransientFields(gap)) changed = true;
      if (!gapEntryHasGap(gap)) {
        delete gaps[gapId];
        changed = true;
      }
    }
    if (changed) {
      try {
        fs.writeFileSync(gapsPath, JSON.stringify(gaps), "utf8");
      } catch {}
    }
  }
} catch {}

// Set up callbacks so tvdb.js can call back into index.js without circular imports
tvdb.setNotifyCallback((name, record) =>
  notifyClients("tvdbUpdated", { name, record }),
);
tvdb.setEnqueueCallback((name) => notifyClients("showUpdating", { name }));
tvdb.setQueueDrainCallback(() => notifyClients("showQueueEmpty", {}));

// Auto-update pickups when inEmby or status changes on a tvdb record
const handlePickupChange = (name, inEmby, status) => {
  if (inEmby === true && status !== "Ended") {
    // Should be in pickups
    const already = pickups.some((p) => p.toLowerCase() === name.toLowerCase());
    if (!already) {
      console.log("[pickup-auto] adding:", name);
      addPickup({ name }).catch((err) =>
        console.error("[pickup-auto] addPickup failed:", err),
      );
    }
  } else {
    // Should not be in pickups
    const idx = pickups.findIndex(
      (p) => p.toLowerCase() === name.toLowerCase(),
    );
    if (idx !== -1) {
      console.log("[pickup-auto] removing:", name);
      delPickup({ name }).catch((err) =>
        console.error("[pickup-auto] delPickup failed:", err),
      );
    }
  }
};
tvdb.setPickupChangeCallback(handlePickupChange);

// Detect and fix the "compact NNN" mis-indexing: Emby reads a filename like
// "101-Title.avi" in Season 1 as episode 101 instead of S1E01. This leaves the
// real TVDB-sourced virtual stubs (E1-E21) un-linked. We rename the files to
// SxxExx format so the next Emby scan matches them correctly.
const fixCompactEpisodeNaming = async (showId, showName) => {
  let anyFixed = false;
  try {
    const seasonsRes = await fetch(
      `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${showId}&Fields=MediaSources,Path,LocationType&api_key=${EMBY_API_KEY}`,
    );
    if (!seasonsRes.ok) return false;
    const seasonsData = await seasonsRes.json();
    const seasons = seasonsData?.Items || [];

    for (const season of seasons) {
      const seasonId = season.Id;
      const seasonNumber = season.IndexNumber;
      if (!Number.isFinite(seasonNumber) || seasonNumber < 1) continue;

      const epsRes = await fetch(
        `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${seasonId}&Fields=MediaSources,Path,LocationType&api_key=${EMBY_API_KEY}`,
      );
      if (!epsRes.ok) continue;
      const epsData = await epsRes.json();
      const episodes = epsData?.Items || [];

      let hasVirtual = false;
      const compactFileEps = [];
      for (const ep of episodes) {
        const epNum = ep.IndexNumber;
        if (!Number.isFinite(epNum)) continue;
        const path = ep?.MediaSources?.[0]?.Path || ep?.Path || "";
        const isVirtual = ep.LocationType === "Virtual" || !path;
        if (epNum >= 1 && epNum <= 99 && isVirtual) {
          hasVirtual = true;
        } else if (epNum >= 100) {
          // Check compact NNN: first digit(s) = season, last two = episode
          const compactSeason = Math.floor(epNum / 100);
          const compactEp = epNum % 100;
          if (compactSeason === seasonNumber && compactEp >= 1 && path) {
            compactFileEps.push({ epNum, path, compactEp });
          }
        }
      }

      if (!hasVirtual || compactFileEps.length === 0) continue;

      console.log(
        `[fixCompactEpisodeNaming] ${showName} S${seasonNumber}: renaming ${compactFileEps.length} compact-NNN files`,
      );
      for (const { path: oldPath, compactEp } of compactFileEps) {
        const dir = oldPath.substring(0, oldPath.lastIndexOf("/"));
        const filename = oldPath.substring(oldPath.lastIndexOf("/") + 1);
        const ext = filename.substring(filename.lastIndexOf("."));
        // Strip leading NNN- prefix from title
        const titlePart = filename
          .replace(/^\d{3}[-\s]/, "")
          .replace(/\.[^.]+$/, "");
        const sStr = String(seasonNumber).padStart(2, "0");
        const eStr = String(compactEp).padStart(2, "0");
        const newFilename = `S${sStr}E${eStr} - ${titlePart}${ext}`;
        const newPath = `${dir}/${newFilename}`;
        if (oldPath === newPath) continue;
        try {
          fs.renameSync(oldPath, newPath);
          console.log(
            `[fixCompactEpisodeNaming] Renamed: ${filename} → ${newFilename}`,
          );
          anyFixed = true;
        } catch (e) {
          console.error(
            `[fixCompactEpisodeNaming] Rename failed for ${oldPath}:`,
            e.message,
          );
        }
      }
    }

    if (anyFixed) {
      console.log(
        `[fixCompactEpisodeNaming] Triggering Emby refresh for ${showName}`,
      );
      try {
        await fetch(
          `${EMBY_BASE_URL}/Items/${showId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&api_key=${EMBY_API_KEY}`,
          { method: "POST" },
        );
      } catch (e) {
        console.error(
          `[fixCompactEpisodeNaming] Emby refresh error:`,
          e.message,
        );
      }
      // Give Emby time to process before gap check reads updated data
      await new Promise((r) => setTimeout(r, 8000));
    }
  } catch (e) {
    console.error(
      `[fixCompactEpisodeNaming] Error for ${showName}:`,
      e.message,
    );
  }
  return anyFixed;
};

tvdb.setPerShowCallback(async (showName, tvdbRecord, options) => {
  try {
    // Disk check
    const embyPath = tvdbRecord.path || tvdbRecord.emby?.path || showName;
    const pathPart = embyPath.split("/").pop();
    const diskInfo = await getShowDiskInfo(pathPart);
    const diskChanges = [];
    if (diskInfo) {
      const [newDate, newSize] = diskInfo;
      if (tvdbRecord.date !== newDate) {
        diskChanges.push(`Date:${tvdbRecord.date}->${newDate}`);
        tvdbRecord.date = newDate;
      }
      if (tvdbRecord.size !== newSize) {
        diskChanges.push(`Size:${tvdbRecord.size}->${newSize}`);
        tvdbRecord.size = newSize;
      }
      if (tvdbRecord.noFiles) {
        diskChanges.push(`NoFiles:true->false`);
        tvdbRecord.noFiles = false;
      }
    } else if (!tvdbRecord.noFiles) {
      diskChanges.push(`NoFiles:false->true`);
      tvdbRecord.noFiles = true;
      tvdbRecord.date = null;
      tvdbRecord.size = 0;
    }
    // lastWatched
    const lastWatchedChanges = [];
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      try {
        const date = await fetchLastWatchedDate(tvdbRecord.id);
        if (date && date !== tvdbRecord.lastWatched) {
          lastWatchedChanges.push(
            `lastWatched:${tvdbRecord.lastWatched}->${date}`,
          );
          tvdbRecord.lastWatched = date;
        }
      } catch (e) {}
    }
    // Fix compact-NNN episode mis-indexing (e.g. "101-Title.avi" parsed as E101)
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      await fixCompactEpisodeNaming(tvdbRecord.id, showName);
    }
    // Gap check
    let gapChanges = [];
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      const gapData = await emby.gapCheckOne(
        tvdbRecord.id,
        showName,
        tvdbRecord,
      );
      if (showName === "Swiss Toni") {
        console.log(
          `[DEBUG Swiss Toni perShow] gapData=${JSON.stringify(gapData)} tvdbRecord.notReady=${tvdbRecord.notReady}`,
        );
      }
      if (gapData) {
        const gapFields = [
          "watchGap",
          "watchGapSeason",
          "watchGapEpisode",
          "fileGap",
          "fileEndError",
          "seasonWatchedThenNofile",
          "anyWatched",
        ];
        for (const f of gapFields) {
          if (tvdbRecord[f] !== gapData[f])
            gapChanges.push(`${f}:${tvdbRecord[f]}->${gapData[f]}`);
        }
        Object.assign(tvdbRecord, gapData);
        tvdbRecord.lastGapCheck = Date.now();
        delete tvdbRecord.allAiredHaveFile;
      }
      // Compute full: all aired episodes have a file or have been watched
      const newFull = !!(tvdbRecord.inEmby && gapData.allAiredHaveFile);
      if (!!tvdbRecord.full !== newFull) {
        gapChanges.push(`full:${tvdbRecord.full}->${newFull}`);
        tvdbRecord.full = newFull;
      }
    } else if (!tvdbRecord.inEmby) {
      // For shows not in emby, set error fields to known constants
      const nonEmbyConstants = [
        ["fileGap", false],
        ["fileEndError", false],
        ["full", false],
        ["notReady", true],
      ];
      for (const [f, v] of nonEmbyConstants) {
        if (tvdbRecord[f] !== v) {
          gapChanges.push(`${f}:${tvdbRecord[f]}->${v}`);
          tvdbRecord[f] = v;
        }
      }
    }
    const push2Changes = [...diskChanges, ...lastWatchedChanges, ...gapChanges];
    // History: bkgndUpdate (timer-selected) or clientUpdate (user-triggered)
    try {
      const tvdbIdVal = String(tvdbRecord.tvdbId || "").trim() || null;
      const fieldsVal =
        push2Changes.length > 0 ? JSON.stringify(push2Changes) : null;
      const descVal =
        push2Changes.length > 0 ? push2Changes.join(" ") : "No fields changed";
      history.addEvent({
        tvdbId: tvdbIdVal,
        showName,
        type: options?.isBackground ? "bkgndUpdate" : "clientUpdate",
        description: descVal,
        fields: fieldsVal,
      });
    } catch (e) {
      console.error(
        "[history] bkgndUpdate/clientUpdate error:",
        showName,
        e.message,
      );
    }
    if (push2Changes.length) {
      await tvdb.saveTvdbSync();
      if (!options?.suppressNotify) {
        const pushed = tvdb.getAllTvdbSync()[showName];
        console.log(`[perShow push2] ${showName}: ${push2Changes.join(" ")}`);
        notifyClients("tvdbUpdated", { name: showName, record: pushed });
      }
    } else {
      if (!options?.suppressNotify) {
        console.log(`[perShow push2] ${showName}: no changes`);
      }
    }
    return { hasChanges: push2Changes.length > 0, changes: push2Changes };
  } catch (e) {
    console.error("[perShowCallback] error for", showName, e.message);
    return { hasChanges: false, changes: [] };
  }
});
let embyFullSweepTickCount = 0;
tvdb.setPreTvdbTickCallback(async ({ isBackground } = {}) => {
  embyFullSweepTickCount++;
  if (!isBackground || embyFullSweepTickCount % 10 === 1) {
    await runEmbyFullSweep();
  }
});

const videoFileExtensions = [
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "flv",
  "mpeg",
  "3gp",
  "m4v",
  "ts",
  "rm",
  "vob",
  "ogv",
  "divx",
];

function safeShowFolderName(rawName) {
  if (typeof rawName !== "string") return null;

  let name = rawName.trim();
  if (!name) return null;

  // Prevent traversal / invalid names: remove path separators and trailing dots/spaces.
  name = name.replaceAll("/", " ").replaceAll("\\", " ");
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1F\x7F]/g, " ");
  name = name.replace(/[\.\s]+$/g, "");
  name = name.replace(/\s{2,}/g, " ").trim();
  if (!name) return null;

  return name;
}

function seasonFolderName(season) {
  // Keep consistent with existing convention used elsewhere: `Season ${season}`.
  // If season is a number, keep it unpadded (Season 1). If it's a string like "01", preserve it.
  if (season === null || season === undefined) return null;
  const s = typeof season === "number" ? String(season) : String(season).trim();
  if (!s) return null;
  return `Season ${s}`;
}

function xmlEsc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildTvShowNfo(showName, tvdbId) {
  const cleanName = String(showName || "").trim();
  const cleanTvdbId = String(tvdbId || "").trim();
  if (!cleanName || !cleanTvdbId) return "";

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    "<tvshow>\n" +
    `  <title>${xmlEsc(cleanName)}</title>\n` +
    `  <tvdbid>${xmlEsc(cleanTvdbId)}</tvdbid>\n` +
    `  <uniqueid type="tvdb" default="true">${xmlEsc(cleanTvdbId)}</uniqueid>\n` +
    "</tvshow>\n"
  );
}

function rpcParamToString(param) {
  // Param is usually a raw string, but tolerate JSON-stringified strings.
  if (param === undefined || param === null) return "";
  if (typeof param !== "string") return String(param);
  const trimmed = param.trim();
  if (trimmed === "") return "";
  if (trimmed === "null") return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : String(parsed);
    } catch {
      return param;
    }
  }
  return param;
}

function fmtDateWithTZ(date, utcOut = false) {
  let year, month, day;
  if (utcOut) {
    year = date.getUTCFullYear();
    month = String(date.getUTCMonth() + 1).padStart(2, "0");
    day = String(date.getUTCDate()).padStart(2, "0");
  } else {
    year = date.getFullYear();
    month = String(date.getMonth() + 1).padStart(2, "0");
    day = String(date.getDate()).padStart(2, "0");
  }
  return `${year}-${month}-${day}`;
}

const getShowsFromDisk = async (_params) => {
  let errFlg = null;
  const shows = {};

  let maxDate, totalSize;

  const recurs = async (path) => {
    if (errFlg || path == tvDir + "/.stfolder") return;
    try {
      const fstat = fs.statSync(path);
      if (fstat.isDirectory()) {
        const dir = fs.readdirSync(path);
        for (const dirent of dir) await recurs(path + "/" + dirent);
        return;
      }
      const sfx = path.split(".").pop();
      if (videoFileExtensions.includes(sfx)) {
        const date = fmtDateWithTZ(fstat.mtime);
        maxDate = Math.max(maxDate, date);
      }
      totalSize += fstat.size;
    } catch (err) {
      errFlg = err;
    }
  };

  const dir = fs.readdirSync(tvDir);
  for (const dirent of dir) {
    const showPath = tvDir + "/" + dirent;
    const fstat = fs.statSync(showPath);
    const maxDate = fmtDateWithTZ(fstat.mtime);
    totalSize = 0;

    await recurs(showPath);

    shows[dirent] = [maxDate, totalSize];
    // if (totalSize == 0) {
    //   console.log("empty show:", dirent);
    // }
  }
  if (errFlg) {
    throw new Error(`getShowsFromDisk: Error: ${errFlg.message}`);
  } else {
    return shows;
  }
};

/**
 * Check disk for a single show folder
 * @param {string} showFolderName - The show folder name (e.g., "Breaking Bad")
 * @returns {Promise<[number, number]|null>} - [maxDate, totalSize] or null if not found
 */
const getShowDiskInfo = async (showFolderName) => {
  if (!showFolderName) return null;

  let maxDate = 0;
  let totalSize = 0;
  let errFlg = null;

  const recurs = async (path) => {
    if (errFlg || path == tvDir + "/.stfolder") return;
    try {
      const fstat = fs.statSync(path);
      if (fstat.isDirectory()) {
        const dir = fs.readdirSync(path);
        for (const dirent of dir) await recurs(path + "/" + dirent);
        return;
      }
      const sfx = path.split(".").pop();
      if (videoFileExtensions.includes(sfx)) {
        const date = fmtDateWithTZ(fstat.mtime);
        if (!maxDate || date > maxDate) maxDate = date;
      }
      totalSize += fstat.size;
    } catch (err) {
      errFlg = err;
    }
  };

  try {
    const showPath = tvDir + "/" + showFolderName;
    const fstat = fs.statSync(showPath);
    maxDate = fmtDateWithTZ(fstat.mtime);

    await recurs(showPath);

    if (errFlg) {
      console.error(
        `[getShowDiskInfo] Error for ${showFolderName}:`,
        errFlg.message,
      );
      return null;
    }

    return [maxDate, totalSize];
  } catch (err) {
    // Show folder doesn't exist or not accessible
    return null;
  }
};

const upload = async () => {
  let str = headerStr;
  str += '        - "dummy"\n';
  for (let name of rejects)
    str += '        - "' + name.replace(/"/g, "") + '"\n';
  str += middleStr;
  for (let name of pickups)
    str += '        - "' + name.replace(/"/g, "") + '"\n';
  str += footerStr;
  await util.writeFile(configWritePath("config.yml"), str);

  if (dontupload) {
    console.log("---- didn't upload config.yml ----");
    return "ok";
  }

  const { stdout } = await exec(
    `rsync -av "${configWritePath("config.yml")}" xobtlu@oracle.usbx.me:` +
      "/home/xobtlu/.config/flexget/config.yml",
  );

  const rx = new RegExp("total size is ([0-9,]*)");
  const matches = rx.exec(stdout);
  if (!matches || parseInt(matches[1].replace(",", "")) < 1000) {
    console.error("\nERROR: config.yml upload failed\n", stdout, "\n");
    return `config.yml upload failed: ${stdout.toString()}`;
  }
  return "ok";
};

const reload = async () => {
  if (dontupload) {
    console.log("---- didn't reload ----");
    return "ok";
  }

  console.log("reloading config.yml");
  const timeBeforeUSB = new Date().getTime();
  const { stdout } = await exec(
    "ssh xobtlu@oracle.usbx.me /home/xobtlu/reload-cmd",
  );
  console.log("reload delay:", new Date().getTime() - timeBeforeUSB);

  if (!stdout.includes("Config successfully reloaded")) {
    console.log("\nERROR: config.yml reload failed\n", stdout, "\n");
    return `config.yml reload failed: ${stdout.toString()}`;
  }
  console.log("reloaded config.yml");
  return "ok";
};

let saving = false;

const trySaveConfigYml = async (id, result, resolve, reject) => {
  if (saving) return ["busy", id, result, resolve, reject];
  saving = true;
  rejects.sort((a, b) => {
    return a.toLowerCase() > b.toLowerCase() ? +1 : -1;
  });
  pickups.sort((a, b) => {
    const aname = a.replace(/The\s/i, "");
    const bname = b.replace(/The\s/i, "");
    return aname.toLowerCase() > bname.toLowerCase() ? +1 : -1;
  });
  await util.writeFile(configWritePath("config2-rejects.json"), rejects);
  await util.writeFile(configWritePath("config4-pickups.json"), pickups);

  // Sync tvdb.reject from config arrays (config is the authority)
  const allTvdbForSync = tvdb.getAllTvdbSync();
  const normalizedRejectsSet = new Set(rejects.map((r) => r.toLowerCase()));
  for (const [recordName, record] of Object.entries(allTvdbForSync)) {
    const norm = recordName.toLowerCase();
    const isReject = normalizedRejectsSet.has(norm);
    if (isReject) {
      record.reject = true;
    } else if (record.reject) {
      record.reject = false;
    }
  }
  await tvdb.saveTvdbSync();

  let errResult = null;

  const uploadRes = await upload();
  if (uploadRes != "ok") errResult = uploadRes;
  if (!errResult) {
    const reloadRes = await reload();
    if (reloadRes != "ok") errResult = reloadRes;
  }

  if (errResult) {
    console.error("trySaveConfigYml error:", errResult);
    saving = false;
    return ["err", id, errResult, resolve, reject];
  }

  saving = false;
  return ["ok", id, result, resolve, reject];
};

// this always sends a response to the client
// can be called and forgotten
const saveConfigYml = async (idIn, resultIn, resolveIn, rejectIn) => {
  const tryRes = await trySaveConfigYml(idIn, resultIn, resolveIn, rejectIn);
  const [status, id, result, resolve, reject] = tryRes;
  switch (status) {
    case "busy":
      setTimeout(() => saveConfigYml(id, result, resolve, reject), 1000);
      break;
    case "ok":
      if (resolve) resolve([id, result]);
      break;
    case "err":
      if (reject) reject([id, tryRes]);
      break;
  }
};

// Synchronize pickups and rejects from config files to tvdb.json on startup
const startupConfigSync = () => {
  const allTvdb = tvdb.getAllTvdbSync();
  if (!allTvdb || typeof allTvdb !== "object" || Array.isArray(allTvdb)) {
    throw new Error(
      "[tv-srvr] FATAL: startupConfigSync requires object tvdb cache",
    );
  }
  let changedTvdb = false;

  const normalizedRejects = new Set(rejects.map((r) => r.toLowerCase()));

  for (const [recordName, record] of Object.entries(allTvdb)) {
    const norm = recordName.toLowerCase();
    const shouldReject = normalizedRejects.has(norm);
    if (shouldReject && !record.reject) {
      record.reject = true;
      changedTvdb = true;
    }
    if (!shouldReject && record.reject) {
      record.reject = false;
      changedTvdb = true;
    }
  }

  if (changedTvdb) {
    tvdb.saveTvdbSync().catch((err) => {
      console.error("[sync] failed to save tvdb:", err);
    });
  }
};

// Run sync immediately
startupConfigSync();

const getRejects = async (_param) => {
  return rejects;
};

const addReject = async (params) => {
  const { name, tvdbId } = params;
  console.log("addReject", name);

  // Update rejects array (config is the authority; tvdb synced in trySaveConfigYml)
  const existingIdx = rejects.findIndex(
    (r) => r.toLowerCase() === name.toLowerCase(),
  );
  if (existingIdx !== -1) {
    console.log(
      "-- removing old matching reject (case fix):",
      rejects[existingIdx],
    );
    rejects.splice(existingIdx, 1);
  }
  console.log("-- adding reject:", name);
  rejects.push(name);

  try {
    history.addEvent({
      tvdbId: tvdbId || tvdbIdByName(name),
      showName: name,
      type: "reject",
      description: "Added to reject list",
    });
  } catch {}

  return new Promise((resolve, reject) => {
    saveConfigYml(
      null,
      "ok",
      ([_, result]) => resolve(result),
      ([_, error]) => reject(new Error(error)),
    );
  });
};

const delReject = async (params) => {
  const { name, tvdbId } = params;
  console.log("delReject", name);
  let deletedOne = false;

  // Update rejects array (config is the authority; tvdb synced in trySaveConfigYml)
  for (const [idx, rejectNameStr] of rejects.entries()) {
    if (rejectNameStr.toLowerCase() === name.toLowerCase()) {
      console.log("-- deleting reject:", rejectNameStr);
      rejects.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }

  if (!deletedOne) {
    console.log("-- reject not deleted -- no match:", name);
    return "delReject not deleted: " + name;
  }

  try {
    history.addEvent({
      tvdbId: tvdbId || tvdbIdByName(name),
      showName: name,
      type: "unreject",
      description: "Removed from reject list",
    });
  } catch {}

  return new Promise((resolve, reject) => {
    saveConfigYml(
      null,
      "ok",
      ([_, result]) => resolve(result),
      ([_, error]) => reject(new Error(error)),
    );
  });
};

const addPickup = async (params) => {
  const name = params?.name;
  const tvdbId = params?.tvdbId;
  console.log("addPickup", name);

  if (!name) {
    throw new Error("addPickup: missing name");
  }

  // Update pickups array (config is the authority; tvdb synced in trySaveConfigYml)
  for (const [idx, pickupNameStr] of pickups.entries()) {
    if (pickupNameStr.toLowerCase() === name.toLowerCase()) {
      console.log("-- removing old matching pickup:", pickupNameStr);
      pickups.splice(idx, 1);
      break;
    }
  }
  console.log("-- adding pickup:", name);
  pickups.push(name);
  try {
    history.addEvent({
      tvdbId: tvdbId || tvdbIdByName(name),
      showName: name,
      type: "pickup",
      description: "Added to pickup list",
    });
  } catch {}
  await new Promise((resolve, reject) =>
    saveConfigYml(null, "ok", resolve, reject),
  );
  return "ok";
};

const delPickup = async (params) => {
  const name = params?.name;
  const tvdbId = params?.tvdbId;
  console.log("delPickup", name);
  if (!name) {
    throw new Error("delPickup: missing name");
  }
  let deletedOne = false;

  // Update pickups array (config is the authority; tvdb synced in trySaveConfigYml)
  for (const [idx, pickupNameStr] of pickups.entries()) {
    if (pickupNameStr.toLowerCase() === name.toLowerCase()) {
      console.log("-- deleting pickup:", pickupNameStr);
      pickups.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if (!deletedOne) {
    console.log("pickup not deleted, no match:", name);
    return "delPickup no match: " + name;
  }
  try {
    history.addEvent({
      tvdbId: tvdbId || tvdbIdByName(name),
      showName: name,
      type: "unpickup",
      description: "Removed from pickup list",
    });
  } catch {}
  await new Promise((resolve, reject) =>
    saveConfigYml(null, "ok", resolve, reject),
  );
  return "ok";
};

const getNoEmbys = async (_params) => {
  const allTvdb = tvdb.getAllTvdbSync();
  const out = [];

  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (record?.inEmby === false) {
      if (!record.name) record.name = recordName;
      out.push(record);
    }
  }

  return out;
};

const addNoEmby = async (params) => {
  const show = params.show || params;
  const name = String(show?.name || "").trim();
  console.log("addNoEmby", name);
  if (!name) throw new Error("addNoEmby: missing show name");

  const allTvdb = tvdb.getAllTvdbSync();
  let existingKey = null;
  let existing = null;

  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (recordName.toLowerCase() === name.toLowerCase()) {
      existingKey = recordName;
      existing = record;
      break;
    }
  }

  const rejectFromList = rejects.some(
    (r) => r.toLowerCase() === name.toLowerCase(),
  );
  const nextRecord = {
    ...(existing || {}),
    ...(show || {}),
    name: name,
    id: show?.id || existing?.id || `noemby-${Math.random()}`,
    inEmby: false,
    inToTry: show?.inToTry ?? existing?.inToTry ?? false,
    inContinue: show?.inContinue ?? existing?.inContinue ?? false,
    inMark: show?.inMark ?? existing?.inMark ?? false,
    inLinda: show?.inLinda ?? existing?.inLinda ?? false,
    reject: show?.reject ?? existing?.reject ?? false,
  };

  if (rejectFromList && !nextRecord.reject) {
    nextRecord.reject = true;
    console.log("-- sync: inherited Reject=true from global list:", name);
  }

  if (existingKey && existingKey !== name) {
    delete allTvdb[existingKey];
  }
  if (
    !name ||
    String(name).trim() === "undefined" ||
    String(name).trim() === ""
  ) {
    console.error(
      "[blnk rows] syncEmbyShow: bad allTvdb key about to be written",
      {
        name,
        existingKey,
        tvdbId: nextRecord?.tvdbId,
        stack: new Error().stack.split("\n").slice(0, 6).join(" | "),
      },
    );
  }
  allTvdb[name] = nextRecord;
  await tvdb.saveTvdbSync();
  try {
    const id = String(nextRecord.tvdbId || "").trim() || null;
    history.addEvent({
      tvdbId: id,
      showName: name,
      type: "addEmby",
      description: `Added (inEmby=${nextRecord.inEmby})`,
    });
  } catch {}
  return "ok";
};

const delNoEmby = async (params) => {
  const name = params?.name;
  console.log("delNoEmby", name);
  if (!name) throw new Error("delNoEmby: missing name");
  let deleteKey = null;

  const allTvdb = tvdb.getAllTvdbSync();
  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (
      recordName.toLowerCase() === name.toLowerCase() &&
      record?.inEmby === false
    ) {
      deleteKey = recordName;
      break;
    }
  }

  if (!deleteKey) {
    console.log("no noembys deleted, no match:", name);
    return "delNoEmby no match:" + name;
  }

  const deletedRecord = allTvdb[deleteKey];
  console.log("deleting no-emby record:", deleteKey);
  delete allTvdb[deleteKey];
  await tvdb.saveTvdbSync();
  try {
    const delTvdbId = String(deletedRecord?.tvdbId || "").trim() || null;
    history.addEvent({
      tvdbId: delTvdbId,
      showName: deleteKey,
      type: "remEmby",
      description: "Deleted non-Emby show",
    });
  } catch {}
  return "ok";
};

const getGaps = async (_param) => {
  // Phase 5: Read from tvdb instead of separate gaps object
  const allTvdb = tvdb.getAllTvdbSync();
  const gapsFromTvdb = {};

  for (const [name, record] of Object.entries(allTvdb)) {
    if (record.gap && record.id) {
      gapsFromTvdb[record.id] = record.gap;
    }
  }

  return gapsFromTvdb;
};

const addGap = async (params) => {
  const { gapId, gap, save } = params || {};

  if (gapId !== null && gapId !== undefined) {
    stripGapTransientFields(gap);

    // Phase 5: Update tvdb.gap field
    const allTvdb = tvdb.getAllTvdbSync();
    let showName = null;

    // Find show by Emby ID
    for (const [name, record] of Object.entries(allTvdb)) {
      if (record.emby?.id === gapId && record.inEmby) {
        showName = name;
        break;
      }
    }

    if (showName) {
      if (gapEntryHasGap(gap)) {
        allTvdb[showName].gap = gap;
      } else {
        allTvdb[showName].gap = null;
      }
      // Only save tvdb when save flag is true
      if (save) await tvdb.saveTvdbSync();
    }
  }

  return "ok";
};

const delGap = async (params) => {
  const { gapId, save } = params || {};

  if (gapId !== null) {
    // Phase 5: Update tvdb.gap field
    const allTvdb = tvdb.getAllTvdbSync();

    // Find show by Emby ID
    for (const [name, record] of Object.entries(allTvdb)) {
      if (record.emby?.id === gapId) {
        record.gap = null;
        // Only save tvdb when save flag is true
        if (save) await tvdb.saveTvdbSync();
        break;
      }
    }
  }

  return "ok";
};

const delSeasonFiles = async (params) => {
  const showName = params?.showName;
  const showPathParam = params?.showPath;
  const season = params?.season;

  if (!showName || !showPathParam || season === undefined || season === null) {
    throw new Error("delSeasonFiles: requires showName, showPath, season");
  }

  const showPath =
    showPathParam.includes("/") || showPathParam.includes("\\")
      ? showPathParam
      : path.join(tvDir, showPathParam);

  const seasonStr = String(season).trim();
  const parsedSeason = Number.parseInt(seasonStr, 10);
  const normalizedSeason = Number.isNaN(parsedSeason)
    ? null
    : String(parsedSeason);
  const wantedNames = new Set([`Season ${seasonStr}`]);
  if (normalizedSeason !== null) wantedNames.add(`Season ${normalizedSeason}`);

  const directMatches = [];
  for (const seasonName of wantedNames) {
    const dir = path.join(showPath, seasonName);
    try {
      const st = await fs.promises.stat(dir);
      if (st.isDirectory()) directMatches.push(dir);
    } catch (e) {
      if (e?.code !== "ENOENT") {
        throw new Error(`delSeasonFiles: stat failed for ${dir}: ${e.message}`);
      }
    }
  }

  let seasonDirs = directMatches;
  if (!seasonDirs.length && normalizedSeason !== null) {
    let showDirEntries = [];
    try {
      showDirEntries = await fs.promises.readdir(showPath, {
        withFileTypes: true,
      });
    } catch (e) {
      throw new Error(`delSeasonFiles: readdir showPath failed: ${e.message}`);
    }

    seasonDirs = showDirEntries
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        const m = /^Season\s+(\d+)$/i.exec(entry.name);
        if (!m) return false;
        return String(Number.parseInt(m[1], 10)) === normalizedSeason;
      })
      .map((entry) => path.join(showPath, entry.name));
  }

  if (!seasonDirs.length) {
    throw new Error(
      `delSeasonFiles: no season folder found for season ${season} under ${showPath}`,
    );
  }

  for (const seasonDir of seasonDirs) {
    console.log(`[delSeasonFiles] ${showName}: ${seasonDir}`);

    let entries = [];
    try {
      entries = await fs.promises.readdir(seasonDir);
    } catch (e) {
      throw new Error(`delSeasonFiles: readdir failed: ${e.message}`);
    }

    for (const entry of entries) {
      const entryPath = path.join(seasonDir, entry);
      console.log(`[delSeasonFiles] deleting: ${entryPath}`);
      try {
        await rimraf(entryPath);
      } catch (e) {
        throw new Error(`delSeasonFiles: delete failed: ${e.message}`);
      }
    }
  }

  return { status: "ok" };
};

const createShowFolder = async (params) => {
  const showNameRaw = params?.showName;
  const tvdbId = params?.tvdbId;
  const seriesMapSeasons = params?.seriesMapSeasons;

  console.log("[createShowFolder] request", {
    showName: showNameRaw,
    tvdbId: params?.tvdbId,
    seriesMapSeasons,
  });

  const showName = safeShowFolderName(showNameRaw);
  if (!showName) {
    console.log("[createShowFolder] invalid showName", { showNameRaw });
    throw new Error("createShowFolder: invalid showName");
  }

  const showPath = path.join(tvDir, showName);
  const existed = fs.existsSync(showPath);

  try {
    fs.mkdirSync(showPath, { recursive: true });
    console.log("[createShowFolder] show dir", { showPath, existed });
  } catch (e) {
    throw new Error(`createShowFolder: mkdir failed: ${e.message}`);
  }

  if (Array.isArray(seriesMapSeasons)) {
    for (const season of seriesMapSeasons) {
      const seasonDirName = seasonFolderName(season);
      if (!seasonDirName) continue;
      const seasonPath = path.join(showPath, seasonDirName);
      try {
        fs.mkdirSync(seasonPath, { recursive: true });
        console.log("[createShowFolder] season dir", { season, seasonPath });
      } catch (e) {
        throw new Error(`createShowFolder: mkdir season failed: ${e.message}`);
      }
    }
  } else if (seriesMapSeasons !== undefined) {
    console.log(
      "[createShowFolder] seriesMapSeasons not an array; skipping season dirs",
      {
        seriesMapSeasonsType: typeof seriesMapSeasons,
      },
    );
  }

  const nfo = buildTvShowNfo(showName, tvdbId);
  if (nfo) {
    const nfoPath = path.join(showPath, "tvshow.nfo");
    try {
      fs.writeFileSync(nfoPath, nfo, "utf8");
      console.log("[createShowFolder] wrote tvshow.nfo", { nfoPath, tvdbId });
    } catch (e) {
      throw new Error(`createShowFolder: write nfo failed: ${e.message}`);
    }
  }

  try {
    history.addEvent({
      tvdbId: tvdbId || null,
      showName: showName,
      type: "addEmby",
      description: `Created folder: ${showPath}`,
    });
  } catch {}

  return { ok: true, created: !existed, path: showPath };
};

let sharedFilters = null;

const setSharedFilters = async (params) => {
  if (params === undefined || params === null || params === "") {
    sharedFilters = null;
    return { ok: true };
  }

  // No need to jParse, we expect it to be a JS object already
  sharedFilters = params;
  return { ok: true };
};

const getSharedFilters = async (_params) => {
  return sharedFilters;
};

const getNote = async (params) => {
  const showName = (params?.showName || "").trim();
  if (!showName) {
    throw new Error("getNote requires showName");
  }
  const allTvdb = tvdb.getAllTvdbSync();
  const record = allTvdb[showName];
  return record?.notes ?? "";
};

const saveNote = async (params) => {
  if (!params) {
    throw new Error("saveNote: missing params");
  }

  const { showName, noteText } = params;

  if (typeof showName !== "string" || showName.trim() === "") {
    throw new Error("saveNote: invalid showName");
  }

  const finalNote =
    noteText === undefined || noteText === null ? "" : String(noteText);
  const key = showName.trim();

  const allTvdb = tvdb.getAllTvdbSync();
  const tvdbRecord = allTvdb[key];

  if (!tvdbRecord) {
    throw new Error(`saveNote: show not found in tvdb: ${key}`);
  }

  // Never store empty notes: treat as delete.
  if (noteText.trim() === "") {
    if (!tvdbRecord.notes) {
      return "ok";
    }
    tvdbRecord.notes = "";
    await tvdb.saveTvdbSync();
    return "ok";
  }

  const prev = tvdbRecord.notes;
  if (prev === finalNote) {
    return "ok";
  }

  tvdbRecord.notes = finalNote;
  await tvdb.saveTvdbSync();

  return "ok";
};

const getFile = async (params) => {
  // Param is usually an object { path: "..." }
  let requestedPath = params?.path;
  if (requestedPath === undefined || requestedPath === null) requestedPath = "";

  if (typeof requestedPath !== "string") {
    throw new Error("getFile: path must be string");
  }

  const rawPath = requestedPath.trim();
  const basePath = tvDir;
  const targetPath = rawPath ? path.resolve(rawPath) : path.resolve(basePath);

  // Safety: only allow listings within tvDir.
  const allowedRoot = path.resolve(basePath) + path.sep;
  if (
    !(targetPath + path.sep).startsWith(allowedRoot) &&
    targetPath !== path.resolve(basePath)
  ) {
    throw new Error(`getFile: path not allowed: ${rawPath}`);
  }

  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (e) {
    throw new Error(`getFile: stat failed: ${e.message}`);
  }

  if (!stat.isDirectory()) {
    throw new Error("getFile: path is not a directory");
  }

  let dirents;
  try {
    dirents = fs.readdirSync(targetPath, { withFileTypes: true });
  } catch (e) {
    throw new Error(`getFile: readdir failed: ${e.message}`);
  }

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  dirents.sort((a, b) => collator.compare(a.name, b.name));

  const out = [];
  for (const d of dirents) {
    const name = d.name;
    if (!name) continue;

    if (d.isDirectory()) {
      const childPath = path.join(targetPath, name);
      try {
        const childDirents = fs.readdirSync(childPath, { withFileTypes: true });
        const childNames = childDirents
          .map((cd) => cd.name)
          .filter(Boolean)
          .sort((a, b) => collator.compare(a, b));
        out.push({ [name]: childNames });
      } catch {
        // If we can't read the directory, still return it with empty children.
        out.push({ [name]: [] });
      }
    } else {
      out.push(name);
    }
  }

  return out;
};

const applySubFiles = async (params) => {
  console.log(
    `[applySubFiles] Called with ${JSON.stringify(params).slice(0, 200)}`,
  );

  if (params === undefined || params === null || params === "") {
    throw new Error("applySubFiles: missing params");
  }

  const fileIdObjs = params; // Already parsed by Express
  if (!Array.isArray(fileIdObjs) || fileIdObjs.length === 0) {
    throw new Error("applySubFiles: expected non-empty array");
  }

  const showName =
    typeof fileIdObjs[0]?.showName === "string" ? fileIdObjs[0].showName : "";
  if (!showName || showName.trim() === "") {
    throw new Error("applySubFiles: missing showName");
  }
  if (showName.includes("/") || showName.includes("\\")) {
    throw new Error("applySubFiles: invalid showName");
  }
  for (const entry of fileIdObjs) {
    if (typeof entry?.showName !== "string" || entry.showName !== showName) {
      throw new Error("applySubFiles: all entries must have same showName");
    }
  }

  const localShowPath = path.join(tvDir, showName);
  try {
    const st = fs.statSync(localShowPath);
    if (!st.isDirectory()) {
      throw new Error(`Show directory missing: ${localShowPath} (n/a)`);
    }
  } catch {
    throw new Error(`Show directory missing: ${localShowPath} (n/a)`);
  }

  let login;
  try {
    login = loadSubsLogin();
  } catch (e) {
    throw new Error(e.message);
  }

  const failures = [];
  const appliedSet = new Set();

  const addFailure = (cand, stage, status, details, error) => {
    const fid = Number(cand?.file_id);
    const showName =
      typeof cand?.showName === "string" ? cand.showName : undefined;
    const season = cand?.season;
    const episode = cand?.episode;

    let reason = "";
    if (status !== undefined && status !== null)
      reason = `${stage} HTTP ${status}`;
    else if (error) reason = `${stage}: ${error}`;
    else reason = stage;

    const rec = {
      file_id: fid,
      showName,
      season,
      episode,
      reason,
      stage,
      status,
    };
    if (details !== undefined) rec.details = details;
    failures.push(rec);
  };

  // Step 1-4: update entries with local paths, validate, compute fileIdBase32.
  // Note: we fetch OpenSubtitles /download links lazily per video file so one bad
  // file_id (e.g. transient 502) doesn't fail the entire batch.
  const seasonExistsCache = new Map();
  for (const entry of fileIdObjs) {
    const file_id = entry?.file_id;
    const season = entry?.season;
    const episode = entry?.episode;

    if (!Number.isFinite(Number(file_id))) {
      throw new Error("applySubFiles: invalid file_id");
    }
    if (!Number.isFinite(Number(season))) {
      throw new Error(`applySubFiles: invalid season (${file_id})`);
    }
    if (!Number.isFinite(Number(episode))) {
      throw new Error(`applySubFiles: invalid episode (${file_id})`);
    }

    entry.localShowPath = localShowPath + "/";

    // Verify local show path exists.
    try {
      const stShow = fs.statSync(localShowPath);
      if (!stShow.isDirectory()) {
        throw new Error(
          `Show directory missing: ${entry.localShowPath} (${file_id})`,
        );
      }
    } catch {
      throw new Error(
        `Show directory missing: ${entry.localShowPath} (${file_id})`,
      );
    }

    // If the requested season folder doesn't exist, record a failure but keep going.
    const seasonNum = Number(season);
    const expectedSeasonPath = path.join(localShowPath, `Season ${seasonNum}`);
    let seasonExists = seasonExistsCache.get(seasonNum);
    if (seasonExists === undefined) {
      try {
        seasonExists = fs.statSync(expectedSeasonPath).isDirectory();
      } catch {
        seasonExists = false;
      }
      seasonExistsCache.set(seasonNum, seasonExists);
    }
    if (!seasonExists) {
      entry._missingSeasonDir = true;
      addFailure(
        entry,
        "localSeason",
        undefined,
        { path: expectedSeasonPath },
        "Season directory missing",
      );
    }

    entry.fileIdBase32 = encodeFileIdBase32(Number(file_id));
  }

  console.log(
    `[applySubFiles] Building lookup map for ${fileIdObjs.length} file(s)`,
  );

  // Build lookup by season/episode.
  const byKey = new Map();
  for (const entry of fileIdObjs) {
    const key = `${Number(entry.season)}-${Number(entry.episode)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  }

  const srtCacheByFileId = new Map();
  const srtUrlCacheByFileId = new Map();
  const failedByFileId = new Map();

  // For each video file in all season dirs under localShowPath, write a matching srt.
  let seasonDirents;
  try {
    seasonDirents = fs.readdirSync(localShowPath, { withFileTypes: true });
  } catch (e) {
    throw new Error(`applySubFiles: readdir failed: ${e.message}`);
  }

  const foundKeys = new Set();

  for (const dirent of seasonDirents) {
    if (!dirent.isDirectory()) continue;
    const seasonPath = path.join(localShowPath, dirent.name);

    let fileDirents;
    try {
      fileDirents = fs.readdirSync(seasonPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fd of fileDirents) {
      if (!fd.isFile()) continue;
      const fileName = fd.name;
      const ext = fileName.includes(".")
        ? fileName.split(".").pop().toLowerCase()
        : "";
      if (!videoFileExtensions.includes(ext)) continue;

      const parsed = parseSeasonEpisodeFromFilename(fileName, dirent.name);
      if (!parsed) continue;

      const key = `${parsed.season}-${parsed.episode}`;
      const candidates = byKey.get(key);
      if (!candidates || candidates.length === 0) continue;

      foundKeys.add(key);

      const fileBase = fileName.slice(0, -(ext.length + 1));

      // Apply all candidates that don't already exist on disk.
      for (const cand of candidates) {
        const srtName = `${fileBase}.${cand.fileIdBase32}.srt`;
        const outPath = path.join(seasonPath, srtName);
        if (fs.existsSync(outPath)) continue;

        const fid = Number(cand.file_id);

        // Don't create a duplicate if the legacy-tagged subtitle already exists.
        const legacyTag1 = encodeFileIdBase32Legacy(fid);
        const legacyPath1 = path.join(
          seasonPath,
          `${fileBase}.${legacyTag1}.srt`,
        );
        if (fs.existsSync(legacyPath1)) continue;

        const legacyTag2 = encodeFileIdBase32LegacyAZ05(fid);
        const legacyPath2 = path.join(
          seasonPath,
          `${fileBase}.${legacyTag2}.srt`,
        );
        if (fs.existsSync(legacyPath2)) continue;

        // If this file_id already failed earlier in this call, skip it.
        if (failedByFileId.has(fid)) continue;

        let srtText = srtCacheByFileId.get(fid);
        if (srtText === undefined) {
          // Resolve (and cache) /download link for this file_id.
          let url = srtUrlCacheByFileId.get(fid) || null;
          if (!url) {
            try {
              let dl = await openSubtitlesDownloadWithRetry({
                apiKey: login.apiKey,
                token: subsTokenCache,
                fileId: fid,
              });
              if (
                !dl?.resp?.ok &&
                (dl?.resp?.status === 401 || dl?.resp?.status === 403)
              ) {
                const newToken = await openSubtitlesLogin(login);
                await persistSubsToken(newToken);
                dl = await openSubtitlesDownloadWithRetry({
                  apiKey: login.apiKey,
                  token: subsTokenCache,
                  fileId: fid,
                });
              }

              if (!dl?.resp?.ok) {
                const status = dl?.resp?.status;
                if (status === 502 || status === 503 || status === 504) {
                  console.log(
                    `[subs] OpenSubtitles /download HTTP ${status} (file_id=${fid})`,
                  );
                }
                addFailure(cand, "download", status, dl?.body);
                failedByFileId.set(fid, { stage: "download", status });
                continue;
              }

              url =
                typeof dl.body?.link === "string" ? dl.body.link.trim() : "";
              if (!url) {
                addFailure(
                  cand,
                  "download",
                  dl?.resp?.status,
                  dl?.body,
                  "missing link",
                );
                failedByFileId.set(fid, {
                  stage: "download",
                  status: dl?.resp?.status,
                });
                continue;
              }
              srtUrlCacheByFileId.set(fid, url);
              cand.srtFileUrl = url;
            } catch (e) {
              addFailure(
                cand,
                "download",
                null,
                undefined,
                e?.message || String(e),
              );
              failedByFileId.set(fid, { stage: "download", status: null });
              continue;
            }
          } else {
            cand.srtFileUrl = url;
          }

          try {
            const resp = await fetch(url, { headers: { Accept: "*/*" } });
            if (!resp.ok) {
              const status = resp.status;
              if (status === 502 || status === 503 || status === 504) {
                console.log(
                  `[subs] OpenSubtitles .srt GET HTTP ${status} (file_id=${fid})`,
                );
              }
              addFailure(cand, "srt", status);
              failedByFileId.set(fid, { stage: "srt", status });
              continue;
            }
            srtText = await resp.text();
            srtCacheByFileId.set(fid, srtText);
          } catch (e) {
            addFailure(cand, "srt", null, undefined, e?.message || String(e));
            failedByFileId.set(fid, { stage: "srt", status: null });
            continue;
          }
        }

        try {
          await fs.promises.writeFile(outPath, srtText, "utf8");
          appliedSet.add(fid);
        } catch {
          // If write fails, continue to next candidate.
          continue;
        }
      }
    }
  }

  // Any requested season/episode with no matching video file should be reported.
  for (const [key, entries] of byKey.entries()) {
    if (foundKeys.has(key)) continue;
    for (const entry of entries) {
      if (entry?._missingSeasonDir) continue; // already reported a more specific failure
      addFailure(entry, "match", undefined, { key }, "No matching video file");
    }
  }

  return { ok: true, applied: Array.from(appliedSet), failures };
};

const deletePath = async (params) => {
  const pathParam = params?.path;
  if (!pathParam) {
    throw new Error("deletePath: missing path parameter");
  }

  // If it's just a folder name (no slashes), construct the full path in tvDir
  // Otherwise use the path as-is (for episode file deletions)
  let fullPath =
    pathParam.includes("/") || pathParam.includes("\\")
      ? pathParam
      : path.join(tvDir, pathParam);

  console.log("deletePath: deleting", fullPath);

  try {
    // Check if path exists
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch (e) {
      if (e?.code !== "ENOENT") throw e;

      // Season folder names may differ by zero-padding (e.g., Season 05 vs Season 5).
      // If the requested path is missing, try to resolve a same-season sibling dir.
      const baseName = path.basename(fullPath);
      const seasonMatch = /^Season\s+(\d+)$/i.exec(baseName);
      if (seasonMatch) {
        const parentDir = path.dirname(fullPath);
        const seasonNum = Number.parseInt(seasonMatch[1], 10);
        if (!Number.isNaN(seasonNum)) {
          let parentEntries = [];
          try {
            parentEntries = fs.readdirSync(parentDir, { withFileTypes: true });
          } catch (readErr) {
            if (readErr?.code !== "ENOENT") throw readErr;
          }

          const alt = parentEntries
            .filter((entry) => entry.isDirectory())
            .find((entry) => {
              const m = /^Season\s+(\d+)$/i.exec(entry.name);
              if (!m) return false;
              return Number.parseInt(m[1], 10) === seasonNum;
            });

          if (alt) {
            fullPath = path.join(parentDir, alt.name);
            stats = fs.statSync(fullPath);
            console.log(
              "deletePath: resolved missing season path",
              pathParam,
              "->",
              fullPath,
            );
          }
        }
      }

      if (!stats) {
        console.log("deletePath: path doesn't exist");
        return "ok";
      }
    }

    // Use rm -rf for both files and directories
    const rmCmd = `rm -rf "${fullPath}"`;
    cp.execSync(rmCmd);

    // Wait for filesystem to sync
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify deletion
    try {
      fs.statSync(fullPath);
      console.error("deletePath: path still exists after deletion:", fullPath);
      throw new Error(`Path still exists after deletion: ${fullPath}`);
    } catch (e) {
      if (e.code !== "ENOENT") {
        throw e;
      }
    }

    console.log("deletePath success:", fullPath);
  } catch (e) {
    console.error("error removing path:", fullPath, e.message);
    throw new Error(`Failed to delete path: ${e.message}`);
  }
  return "ok";
};

const sendEmailHandler = async (params) => {
  const { body } = params;
  console.log("sendEmailHandler", body);
  try {
    await email.sendEmail(body);
    return "ok";
  } catch (error) {
    throw new Error(error.message);
  }
};

//////////////////  HTTP REST API  //////////////////

const app = express();

// Use standard CORS middleware
app.use(cors());

// strict: false allows JSON primitives (strings/numbers) as body, not just objects/arrays
app.use(express.json({ strict: false }));

// Legacy CORS manual headers (just in case, though cors() should handle it)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

// Helper to wrap async business logic functions for Express
// The handler should be: async (params) => result
const apiWrapper = (handler) => {
  return async (req, res) => {
    try {
      // GET requests use query params, POST use body
      const params = req.method === "GET" ? req.query : req.body;
      const result = await handler(params);
      res.json(result);
    } catch (error) {
      console.error(`[SERVER] Error in ${req.url}:`, error);
      res.status(500).json({ error: error.message || String(error) });
    }
  };
};

// Data retrieval endpoints
app.get(
  "/api/getAllTvdb",
  apiWrapper(async (params) => {
    const hasEmby = params.hasEmby ? parseInt(params.hasEmby) : 0;
    return await tvdb.getAllTvdb({ hasEmby });
  }),
);
app.get("/api/getShowsFromDisk", apiWrapper(getShowsFromDisk));
app.get("/api/getRejects", apiWrapper(getRejects));
app.get("/api/getGaps", apiWrapper(getGaps));
app.get("/api/getNoEmbys", apiWrapper(getNoEmbys));
app.get("/api/getDevices", apiWrapper(emby.getDevices));
app.get("/api/getLastViewed", apiWrapper(view.getLastViewed));
app.get("/api/getSharedFilters", apiWrapper(getSharedFilters));

// Endpoints with parameters
app.post("/api/getRemotes", apiWrapper(tvdb.getRemotesCmd));
app.post("/api/debugTvdb", apiWrapper(tvdb.debugTvdb));
app.post("/api/getNewTvdb", apiWrapper(tvdb.getNewTvdb));
app.post("/api/searchTvdbByImdbId", apiWrapper(tvdb.searchTvdbByImdbId));
app.post(
  "/api/getSeriesMapFromTvdb",
  apiWrapper(async (params) => {
    const { tvdbId, watchedEpis } = params;
    if (!tvdbId) {
      return { success: false, error: "Missing tvdbId" };
    }
    try {
      const seriesMap = await tvdb.getSeriesMap(tvdbId, watchedEpis || null);
      return { success: true, seriesMap };
    } catch (err) {
      console.error("[getSeriesMapFromTvdb] error:", err);
      return { success: false, error: err.message };
    }
  }),
);
app.post("/api/getActorPage", apiWrapper(tvdb.getActorPage));
app.post("/api/searchActorsInNonEmby", apiWrapper(tvdb.searchActorsInNonEmby));
app.post("/api/getTmdb", apiWrapper(tmdb.getTmdb));
app.post("/api/getStreamProviders", apiWrapper(tmdb.getStreamProviders));
app.post("/api/getNote", apiWrapper(getNote));
app.post("/api/getFile", apiWrapper(getFile));
app.post("/api/getSubFileIds", apiWrapper(getSubFileIds));
app.post("/api/accessTvdb", apiWrapper(tvdb.accessTvdb));
app.post(
  "/api/triggerEmbySync",
  apiWrapper(async () => {
    console.log("[triggerEmbySync] Running full Emby sweep");
    await runEmbyFullSweep();
    return { ok: true };
  }),
);

app.post(
  "/api/refreshEmbyItem",
  apiWrapper(async (params) => {
    const { showId, showName } = params;
    if (!showId) return { success: false, error: "missing showId" };
    console.log(
      `[refreshEmbyItem] Refreshing Emby item for ${showName} (${showId})`,
    );
    // Read DateLastRefreshed before triggering so we can detect when it changes
    let refreshedBefore = null;
    try {
      const beforeRes = await fetch(
        `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${showId}?Fields=DateLastRefreshed&api_key=${EMBY_API_KEY}`,
      );
      if (beforeRes.ok) {
        const beforeData = await beforeRes.json();
        refreshedBefore = beforeData.DateLastRefreshed || null;
      }
    } catch (e) {
      console.error(
        `[refreshEmbyItem] pre-fetch error for ${showName}:`,
        e.message,
      );
    }

    const triggerTime = Date.now();
    try {
      const res = await fetch(
        `${EMBY_BASE_URL}/Items/${showId}/Refresh?Recursive=true&MetadataRefreshMode=Default&api_key=${EMBY_API_KEY}`,
        { method: "POST" },
      );
      if (!res.ok)
        console.error(
          `[refreshEmbyItem] Emby returned ${res.status} for ${showName}`,
        );
    } catch (e) {
      console.error(
        `[refreshEmbyItem] fetch error for ${showName}:`,
        e.message,
      );
    }

    // Poll DateLastRefreshed until it advances past triggerTime (max 30s, poll every 1s)
    const POLL_INTERVAL_MS = 1000;
    const POLL_TIMEOUT_MS = 30 * 1000;
    const pollStart = Date.now();
    let refreshDone = false;
    console.log(
      `[refreshEmbyItem] Polling for refresh completion of ${showName}`,
    );
    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const pollRes = await fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${showId}?Fields=DateLastRefreshed&api_key=${EMBY_API_KEY}`,
        );
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          const refreshedAfter = pollData.DateLastRefreshed || null;
          if (
            refreshedAfter &&
            refreshedAfter !== refreshedBefore &&
            new Date(refreshedAfter).getTime() >= triggerTime
          ) {
            console.log(
              `[refreshEmbyItem] Refresh complete for ${showName} (DateLastRefreshed=${refreshedAfter})`,
            );
            refreshDone = true;
            break;
          }
        }
      } catch (pollErr) {
        console.error(
          `[refreshEmbyItem] poll error for ${showName}:`,
          pollErr.message,
        );
      }
    }
    if (!refreshDone) {
      console.warn(
        `[refreshEmbyItem] Poll timed out for ${showName}, proceeding anyway`,
      );
    }

    tvdb.enqueueShowProcess(showName);
    return { success: true };
  }),
);

app.post(
  "/api/triggerShowGapCheck",
  apiWrapper(async (params) => {
    const { showId, showName } = params;
    if (!showId || !showName) {
      console.error("[triggerShowGapCheck] Missing showId or showName");
      return { success: false };
    }
    console.log(
      `[triggerShowGapCheck] Client requested gap check for: ${showName}`,
    );
    const tvdbRecord = tvdb.getAllTvdbSync()[showName];
    if (tvdbRecord && tvdbRecord.inEmby === false) {
      const nonEmbyConstants = [
        ["fileGap", false],
        ["fileEndError", false],
        ["full", false],
        ["notReady", true],
      ];
      let changed = false;
      for (const [f, v] of nonEmbyConstants) {
        if (tvdbRecord[f] !== v) {
          tvdbRecord[f] = v;
          changed = true;
        }
      }
      if (changed) {
        console.log(
          `[triggerShowGapCheck] ${showName} not in Emby, setting error constants`,
        );
        await tvdb.saveTvdbSync();
      }
      return { success: true };
    }
    tvdb.enqueueShowProcess(showName);
    return { success: true };
  }),
);

app.post(
  "/api/triggerShowSelect",
  apiWrapper(async (params) => {
    const { showName } = params;
    if (!showName) {
      console.error("[triggerShowSelect] Missing showName");
      return { success: false };
    }
    tvdb.enqueueShowProcess(showName, { skipRotten: true });
    return { success: true };
  }),
);

// CRUD operations
app.post("/api/addReject", apiWrapper(addReject));
app.post("/api/delReject", apiWrapper(delReject));
app.post("/api/addNoEmby", apiWrapper(addNoEmby));
app.post("/api/delNoEmby", apiWrapper(delNoEmby));
app.post("/api/addGap", apiWrapper(addGap));
app.post("/api/delGap", apiWrapper(delGap));
app.post("/api/setTvdbFields", apiWrapper(tvdb.setTvdbFields));
app.post("/api/setSharedFilters", apiWrapper(setSharedFilters));

// History
app.post("/api/history", (req, res) => {
  try {
    let { tvdbId, showName, type, description, hash, fields } = req.body || {};
    if (!showName || !type) {
      res.status(400).json({ error: "showName and type required" });
      return;
    }
    // Auto-lookup tvdbId from hash (e.g. qbt events referencing a torSent hash)
    if (!tvdbId && hash) {
      const prev = history.getEventsByHash(hash);
      if (prev) {
        if (!tvdbId && prev.tvdbId) tvdbId = prev.tvdbId;
        if ((!showName || showName === hash) && prev.showName)
          showName = prev.showName;
      }
    }
    // Auto-lookup tvdbId from showName
    if (!tvdbId && showName) tvdbId = tvdbIdByName(showName);
    history.addEvent({ tvdbId, showName, type, description, hash, fields });
    res.json({ ok: true });
  } catch (e) {
    console.error("[history] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/history", (req, res) => {
  try {
    const { tvdbId, showName } = req.query;
    let events = [];
    if (tvdbId) {
      events = history.getEvents(tvdbId);
      if (showName) {
        const byName = history.getEventsByName(showName);
        const ids = new Set(events.map((e) => e.id));
        for (const e of byName) {
          if (!ids.has(e.id)) events.push(e);
        }
      }
    } else if (showName) {
      events = history.getEventsByName(showName);
    }
    events.sort((a, b) =>
      a.updateTime < b.updateTime ? -1 : a.updateTime > b.updateTime ? 1 : 0,
    );
    res.json({ events });
  } catch (e) {
    console.error("[history] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/history/byHash", (req, res) => {
  try {
    const { hash } = req.query;
    if (!hash) {
      res.status(400).json({ error: "hash required" });
      return;
    }
    const event = history.getEventsByHash(hash);
    res.json({ event });
  } catch (e) {
    console.error("[history] byHash error:", e.message);
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/saveNote", apiWrapper(saveNote));

// File operations
app.post("/api/deletePath", apiWrapper(deletePath));
app.post("/api/delSeasonFiles", apiWrapper(delSeasonFiles));
app.post("/api/createShowFolder", apiWrapper(createShowFolder));
app.post(
  "/api/embySync",
  apiWrapper(async () => {
    await runEmbyFullSweep();
    return { ok: true };
  }),
);
// Note: /api/embySync kept for createShowFolderAndRefreshEmby; /api/triggerEmbySync is the primary client trigger

// Subtitles
app.post("/api/subsSearch", apiWrapper(subsSearch));
app.post("/api/applySubFiles", apiWrapper(applySubFiles));
app.post("/api/deleteSubFiles", apiWrapper(deleteSubFiles));
app.post("/api/offsetSubFiles", apiWrapper(offsetSubFiles));

// Email
app.post("/api/sendEmail", apiWrapper(sendEmailHandler));

// Background operations
app.post(
  "/api/updateTvdb",
  apiWrapper(async () => {
    tvdb.updateTvdb();
    return "ok";
  }),
);

const HTTP_PORT = 8737;

// HTTPS options - use same certs as API server (located in api/cookies)
const CERT_DIR = path.join(path.dirname(SRVR_ROOT_DIR), "api", "cookies");
const httpsOptions = {
  key: fs.readFileSync(path.join(CERT_DIR, "localhost-key.pem")),
  cert: fs.readFileSync(path.join(CERT_DIR, "localhost-cert.pem")),
};

https.createServer(httpsOptions, app).listen(HTTP_PORT, () => {
  console.log(`HTTPS API listening on port ${HTTP_PORT}`);
});

//////////////////  WEBSOCKET SERVER  //////////////////

const wss = new WebSocketServer({ port: 8736 });
console.log("wss listening on port 8736");

const appSocketName = "web app websocket";
const connectedClients = new Set();

// Broadcast notification to all connected clients
export const notifyClients = (notification, data = null) => {
  if (connectedClients.size === 0) return;

  const msg = JSON.stringify({
    id: 0,
    notification,
    data,
  });

  for (const ws of connectedClients) {
    if (ws.readyState === 1) {
      try {
        ws.send(msg);
      } catch (e) {
        console.error("[notifyClients] send error:", e.message);
      }
    }
  }
};

wss.on("connection", (ws) => {
  let socketName = "unknown websocket";

  ws.on("message", (data) => {
    const msg = data.toString();
    let parsed;
    try {
      parsed = JSON.parse(msg);
    } catch (e) {
      console.error("ignoring bad message:", msg);
      return;
    }
    const { id, fname, param } = parsed;

    if (socketName != appSocketName) {
      socketName = appSocketName;
      connectedClients.add(ws);
      console.log(socketName + " connected");
    }

    // Only handleAsr uses WebSocket
    if (fname == "handleAsr") {
      handleAsr(ws, id, param);
    } else if (fname == "handleFix") {
      handleFix(ws, id, param);
    } else {
      console.warn("WebSocket function not supported (use HTTP):", fname);
      try {
        ws.send(
          JSON.stringify({
            id,
            status: "err",
            data: "Use HTTP API for non-streaming calls",
          }),
        );
      } catch (e) {
        console.error("ws.send error:", e);
      }
    }
  });

  ws.on("error", (err) => {
    console.error(socketName, "error:", err.message);
    connectedClients.delete(ws);
    socketName = "unknown websocket";
  });

  ws.on("close", () => {
    // log(socketName + ' closed');
    connectedClients.delete(ws);
    socketName = "unknown websocket";
  });
});

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function runUsbCheck() {
  try {
    await checkFlexgetStatus();
    console.log("[flexget] USB flexget check ok");
  } catch (err) {
    console.log("[flexget] USB flexget check FAILED:", err.message);
    try {
      let emailBody = `USB Status Check Failed:\n${err.message}`;
      if (err.fullOutput) {
        emailBody += `\n\nFull flexget status output:\n${err.fullOutput}`;
      }
      await email.sendEmail(emailBody);
    } catch (e) {
      console.error("[flexget] Failed to send error email:", e);
    }
  }
}

// Phase 3: Incremental sync functions

/**
 * Phase 3.1: Sync Emby user data and collections into tvdb
 * Runs every 5 minutes to keep user data and collection flags fresh without full reload
 * - Syncs watched status, play counts
 * - Syncs collection flags (toTry, continue, mark, linda)
 * - Syncs reject and pickup flags
 */
// DEPRECATED: syncEmbyUserData is no longer used
// Collection changes are now handled by immediate triggers from client:
// - /api/triggerEmbySync (per-show changes)
// - /api/triggerShowSelect (single-show processing)
// This function remains for reference but is not called.
async function syncEmbyUserData() {
  console.log("[syncEmbyUserData] CALLED - function executing");
  try {
    console.log("[syncEmbyUserData] Starting...");

    // Get all tvdb records
    const allTvdb = tvdb.getAllTvdbSync();
    const changedShows = []; // Track which shows changed
    if (!allTvdb || Object.keys(allTvdb).length === 0) {
      console.error("[Phase 3] syncEmbyUserData: No tvdb records to sync");
      return;
    }

    // Helper function to normalize show names
    const normShowName = (name) => {
      if (name === undefined || name === null) return "";
      return String(name)
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    };

    // Fetch all data in parallel:
    // 1. Emby shows (for user data - watched status, play counts)
    // 2. Collection IDs (for InToTry, InContinue, InMark, InLinda flags)

    const embyUrl = `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?api_key=${EMBY_API_KEY}&IncludeItemTypes=Series&Recursive=true&Fields=UserData&StartIndex=0&Limit=10000`;

    const [embyResp, toTryResp, continueResp, markResp, lindaResp] =
      await Promise.all([
        fetch(embyUrl),
        fetch(
          `${EMBY_BASE_URL}/Collections/${COLLECTION_IDS.toTry}/Items?api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
        fetch(
          `${EMBY_BASE_URL}/Collections/${COLLECTION_IDS.continue}/Items?api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
        fetch(
          `${EMBY_BASE_URL}/Collections/${COLLECTION_IDS.mark}/Items?api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
        fetch(
          `${EMBY_BASE_URL}/Collections/${COLLECTION_IDS.linda}/Items?api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
      ]);

    console.log("[syncEmbyUserData] Fetches completed");

    if (!embyResp.ok) {
      console.error(
        "[Phase 3] syncEmbyUserData: Emby fetch failed:",
        embyResp.status,
      );
      return;
    }

    const embyData = await embyResp.json();
    const embyShows = embyData.Items || [];

    // Get collection IDs (handle fetch failures gracefully)
    const toTryData = toTryResp.ok ? await toTryResp.json() : null;
    const continueData = continueResp.ok ? await continueResp.json() : null;
    const markData = markResp.ok ? await markResp.json() : null;
    const lindaData = lindaResp.ok ? await lindaResp.json() : null;

    console.log(`[syncEmbyUserData] Collection responses:`, {
      toTry: {
        ok: toTryResp.ok,
        status: toTryResp.status,
        hasItems: !!toTryData?.Items,
        count: toTryData?.Items?.length || 0,
      },
      continue: {
        ok: continueResp.ok,
        status: continueResp.status,
        hasItems: !!continueData?.Items,
        count: continueData?.Items?.length || 0,
      },
      mark: {
        ok: markResp.ok,
        status: markResp.status,
        hasItems: !!markData?.Items,
        count: markData?.Items?.length || 0,
      },
      linda: {
        ok: lindaResp.ok,
        status: lindaResp.status,
        hasItems: !!lindaData?.Items,
        count: lindaData?.Items?.length || 0,
      },
    });

    const toTryIds = toTryData?.Items?.map((i) => i.Id) || [];
    const continueIds = continueData?.Items?.map((i) => i.Id) || [];
    const markIds = markData?.Items?.map((i) => i.Id) || [];
    const lindaIds = lindaData?.Items?.map((i) => i.Id) || [];

    const toTryIdSet = new Set(toTryIds);
    const continueIdSet = new Set(continueIds);
    const markIdSet = new Set(markIds);
    const lindaIdSet = new Set(lindaIds);

    let updatedCount = 0;
    const now = Date.now();

    // Debug: track what types of changes are detected
    let userDataChangeCount = 0;
    let collectionsChangeCount = 0;
    let rejectsPickupsChangeCount = 0;

    console.log(
      `[syncEmbyUserData] About to process ${embyShows.length} shows`,
    );
    console.log(
      `[syncEmbyUserData] Collection sets sizes: toTry=${toTryIdSet.size}, continue=${continueIdSet.size}, mark=${markIdSet.size}, linda=${lindaIdSet.size}`,
    );

    // Update tvdb records with fresh Emby user data, collections, rejects, and pickups
    for (const embyShow of embyShows) {
      const name = embyShow.Name;
      const tvdbRecord = allTvdb[name];

      if (!tvdbRecord || !tvdbRecord.inEmby) continue;

      const userData = embyShow.UserData || {};

      // Check if user data changed (normalize values for comparison)
      const oldPlayed = !!tvdbRecord.played;
      const newPlayed = !!userData.Played;
      const oldPlayCount = tvdbRecord.playCount || 0;
      const newPlayCount = userData.PlayCount || 0;
      const oldLastPlayed = tvdbRecord.lastPlayedDate || null;
      const newLastPlayed = userData.LastPlayedDate || null;
      const oldUnplayed = tvdbRecord.UnplayedItemCount || 0;
      const newUnplayed = userData.UnplayedItemCount || 0;

      const userDataChanged =
        oldPlayed !== newPlayed ||
        oldPlayCount !== newPlayCount ||
        oldLastPlayed !== newLastPlayed ||
        oldUnplayed !== newUnplayed;

      // Track watched data changes
      const watchedDataChanged =
        oldPlayed !== newPlayed ||
        oldPlayCount !== newPlayCount ||
        oldLastPlayed !== newLastPlayed ||
        oldUnplayed !== newUnplayed;

      // Debug first show with changes
      if (userDataChanged && userDataChangeCount === 0) {
        console.log(`[DEBUG first userData change] ${name}:`, {
          played: {
            old: oldPlayed,
            new: newPlayed,
            changed: oldPlayed !== newPlayed,
          },
          playCount: {
            old: oldPlayCount,
            new: newPlayCount,
            changed: oldPlayCount !== newPlayCount,
          },
          lastPlayed: {
            old: oldLastPlayed,
            new: newLastPlayed,
            changed: oldLastPlayed !== newLastPlayed,
          },
          unplayed: {
            old: oldUnplayed,
            new: newUnplayed,
            changed: oldUnplayed !== newUnplayed,
          },
        });
      }

      // Check if collection flags changed
      const showId = embyShow.Id;
      const newInToTry = toTryIdSet.has(showId);
      const newInContinue = continueIdSet.has(showId);
      const newInMark = markIdSet.has(showId);
      const newInLinda = lindaIdSet.has(showId);

      const collectionsChanged =
        tvdbRecord.inToTry !== newInToTry ||
        tvdbRecord.inContinue !== newInContinue ||
        tvdbRecord.inMark !== newInMark ||
        tvdbRecord.inLinda !== newInLinda;

      // Debug first collection change
      if (collectionsChanged && collectionsChangeCount === 0) {
        console.log(`[DEBUG first collection change] ${name}:`, {
          toTry: {
            old: tvdbRecord.inToTry,
            new: newInToTry,
            changed: tvdbRecord.inToTry !== newInToTry,
          },
          continue: {
            old: tvdbRecord.inContinue,
            new: newInContinue,
            changed: tvdbRecord.inContinue !== newInContinue,
          },
          mark: {
            old: tvdbRecord.inMark,
            new: newInMark,
            changed: tvdbRecord.inMark !== newInMark,
          },
          linda: {
            old: tvdbRecord.inLinda,
            new: newInLinda,
            changed: tvdbRecord.inLinda !== newInLinda,
          },
        });
      }

      // Check if reject/pickup flags changed
      const normName = normShowName(name);
      const newReject = rejects.some((r) => normShowName(r) === normName);

      const rejectsChanged = tvdbRecord.reject !== newReject;

      if (userDataChanged || collectionsChanged || rejectsChanged) {
        // Update user data
        if (userDataChanged) {
          tvdbRecord.played = userData.Played || false;
          tvdbRecord.playCount = userData.PlayCount || 0;
          tvdbRecord.lastPlayedDate =
            userData.LastPlayedDate || tvdbRecord.lastPlayedDate || null;
          tvdbRecord.UnplayedItemCount = userData.UnplayedItemCount || 0;
          userDataChangeCount++;
        }

        // Update collection flags
        if (collectionsChanged) {
          tvdbRecord.inToTry = newInToTry;
          tvdbRecord.inContinue = newInContinue;
          tvdbRecord.inMark = newInMark;
          tvdbRecord.inLinda = newInLinda;
          collectionsChangeCount++;
        }

        // Update reject flags
        if (rejectsChanged) {
          tvdbRecord.reject = newReject;
          rejectsPickupsChangeCount++;
        }

        delete tvdbRecord.emby;

        tvdbRecord.sync = tvdbRecord.sync || {};
        tvdbRecord.sync.lastEmbySync = now;
        updatedCount++;

        // Track this show for gap checking (only for watched data changes)
        if (watchedDataChanged) {
          changedShows.push({
            showId: embyShow.Id,
            showName: name,
            tvdbRecord,
          });
        }
      }
    }

    console.log(
      `[syncEmbyUserData] Loop completed, ${updatedCount} shows changed`,
    );

    if (updatedCount > 0) {
      await tvdb.saveTvdbSync();
      console.log(
        `[syncEmbyUserData] Changes: ${userDataChangeCount} userData, ${collectionsChangeCount} collections, ${rejectsPickupsChangeCount} rejects/pickups`,
      );

      // Trigger gap check for changed shows after 3 second delay
      // This allows both Emby and disk operations to settle (e.g., delete show + delete folder)
      if (changedShows.length > 0) {
        const logMsg =
          changedShows.length === 1
            ? `[emby change] Checking 1 show: ${changedShows[0].showName}`
            : `[emby change] Checking ${changedShows.length} shows`;
        console.log(logMsg);
        setTimeout(() => {
          runGapCheckForShows(changedShows, true).catch((err) => {
            console.error(
              "[Phase 3] syncEmbyUserData: delayed gapCheck failed:",
              err.message,
            );
          });
        }, 3000);
      }
    }
    // else {
    //   console.log("[Phase 3] syncEmbyUserData: No changes detected");
    // }
  } catch (err) {
    console.error("[Phase 3] syncEmbyUserData error:", err.message);
  }
}

/**
 * Background Emby sweep: detect new/removed shows,
 * sync collections, update metadata. Server-side port of client loadAllShows steps 2-5.
 */
let embyFullSweepRunning = false;
let embyFullSweepQueued = false;
async function runEmbyFullSweep() {
  if (embyFullSweepRunning) {
    embyFullSweepQueued = true;
    return;
  }
  embyFullSweepRunning = true;
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    if (!allTvdb || Object.keys(allTvdb).length === 0) return;

    const now = Date.now();
    const isTvdbShow = (r) =>
      !!(
        r &&
        typeof r === "object" &&
        !Array.isArray(r) &&
        String(r.name || "").trim()
      );

    // Fetch Emby show list + 4 collections in parallel
    const embyShowUrl =
      `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?api_key=${EMBY_API_KEY}` +
      `&IncludeItemTypes=Series&Recursive=true` +
      `&Fields=Name,Id,DateCreated,Genres,Overview,Path,PremiereDate,ProviderIds,UserData` +
      `&StartIndex=0&Limit=10000`;
    const [embyResp, toTryResp, continueResp, markResp, lindaResp] =
      await Promise.all([
        fetch(embyShowUrl),
        fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${COLLECTION_IDS.toTry}&api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
        fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${COLLECTION_IDS.continue}&api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
        fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${COLLECTION_IDS.mark}&api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
        fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${COLLECTION_IDS.linda}&api_key=${EMBY_API_KEY}&Limit=10000`,
        ),
      ]);
    if (!embyResp.ok) {
      console.error("[runEmbyFullSweep] Emby fetch failed:", embyResp.status);
      return;
    }
    const embyData = await embyResp.json();
    const embyShows = embyData.Items || [];

    const parseIds = async (resp) =>
      new Set(
        (resp.ok ? (await resp.json()).Items || [] : []).map((i) => i.Id),
      );
    const [toTryIds, continueIds, markIds, lindaIds] = await Promise.all([
      parseIds(toTryResp),
      parseIds(continueResp),
      parseIds(markResp),
      parseIds(lindaResp),
    ]);

    // Helpers (ported from client emby.js)
    const findByTvdbId = (targetId) => {
      if (!targetId) return null;
      const id = String(targetId).trim();
      for (const [key, rec] of Object.entries(allTvdb)) {
        if (String(rec?.tvdbId || "").trim() === id)
          return { key, record: rec };
      }
      return null;
    };
    const normalizeTitle = (name) => {
      let out = String(name || "");
      const idx = out.indexOf("(");
      if (idx >= 0) out = out.slice(0, idx);
      return out
        .toLowerCase()
        .replace(/\./g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    };
    const findCandidate = (embyName, embyTvdbId) => {
      const norm = normalizeTitle(embyName);
      if (!norm) return null;
      for (const [key, rec] of Object.entries(allTvdb)) {
        if (!isTvdbShow(rec)) continue;
        const candName = String(rec.name || "").trim();
        if (!candName || candName === embyName) continue;
        if (normalizeTitle(candName) !== norm) continue;
        return { key, record: rec };
      }
      return null;
    };

    // Step 1: Key/Name mismatch cleanup
    const keysToDelete = [];
    for (const [key, show] of Object.entries(allTvdb)) {
      if (!isTvdbShow(show) || !show.name || key === show.name) continue;
      if (allTvdb[show.name] && allTvdb[show.name] !== show) {
        keysToDelete.push(key);
      } else if (!allTvdb[show.name]) {
        allTvdb[show.name] = show;
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      delete allTvdb[key];
      try {
        await tvdb.setTvdbFields({ name: key, $delTvdb: true });
      } catch (e) {}
    }

    // Step 2: Sync Emby shows into tvdb
    for (const embyShow of embyShows) {
      const name = embyShow.Name;
      const tvdbId = embyShow.ProviderIds?.Tvdb || embyShow.TvdbId;
      if (!tvdbId || tvdbId === "0") continue;
      const embyPath = embyShow.Path?.split("/").pop() || "";
      const showId = embyShow.Id;

      let tvdbKey = name;
      let tvdbRecord = allTvdb[tvdbKey];
      if (!tvdbRecord) {
        const byId = findByTvdbId(tvdbId);
        if (byId) {
          tvdbKey = byId.key;
          tvdbRecord = byId.record;
        }
      }

      if (!tvdbRecord) {
        // Block creation if a likely-same-show candidate exists
        if (findCandidate(name, tvdbId)) {
          console.warn(
            `[runEmbyFullSweep] Blocked create for "${name}" — likely candidate exists`,
          );
          continue;
        }
        const param = {
          show: { name: name, id: showId, tvdbId: tvdbId },
          seasonCount: 0,
          episodeCount: 0,
          watchedCount: 0,
          name,
          showId,
          tvdbId,
          embyPath,
          "emby.genres": embyShow.Genres || [],
          "emby.overview": embyShow.Overview || "",
          dateCreated: embyShow.DateCreated?.substring(0, 10),
          premiereDate: embyShow.PremiereDate?.substring(0, 10),
          lastEmbySync: now,
          isPlayed: embyShow.UserData?.Played || false,
          playCount: embyShow.UserData?.PlayCount || 0,
        };
        try {
          await tvdb.getNewTvdb(param);
          console.log(`[runEmbyFullSweep] Created tvdb record: ${name}`);
        } catch (e) {
          console.error(
            `[runEmbyFullSweep] getNewTvdb failed for "${name}":`,
            e.message,
          );
        }
        continue;
      }

      // Update existing record
      tvdbRecord.id = showId;
      if (!tvdbRecord.name) {
        console.log(
          `[runEmbyFullSweep] Backfilling missing name for tvdbId=${tvdbId}: "${name}"`,
        );
        tvdbRecord.name = name;
        if (tvdbKey !== name) {
          allTvdb[name] = tvdbRecord;
          delete allTvdb[tvdbKey];
          tvdbKey = name;
        }
      }
      if (!tvdbRecord.tvdbId && tvdbId) {
        console.log(
          `[runEmbyFullSweep] Backfilling missing tvdbId=${tvdbId} for "${name}"`,
        );
        // If a duplicate record already owns this tvdbId, merge its TVDB metadata
        // into this Emby-linked record and delete the duplicate.
        const duplicate = findByTvdbId(tvdbId);
        if (duplicate && duplicate.key !== name) {
          console.log(
            `[runEmbyFullSweep] Merging duplicate tvdbId=${tvdbId} record "${duplicate.key}" into "${name}"`,
          );
          const dup = duplicate.record;
          const TVDB_META_FIELDS = [
            "tvdbId",
            "image",
            "status",
            "overview",
            "firstAired",
            "lastAired",
            "nextAired",
            "averageRuntime",
            "originalCountry",
            "originalLanguage",
            "originalNetwork",
            "score",
            "trailers",
            "characters",
            "remotes",
            "imdbUrl",
            "imdbId",
            "imdbRatings",
            "rottenUrl",
            "rottenRatings",
            "wikiUrl",
            "redditUrl",
            "saved",
          ];
          for (const field of TVDB_META_FIELDS) {
            if (dup[field] !== undefined && !tvdbRecord[field]) {
              tvdbRecord[field] = dup[field];
            }
          }
          delete allTvdb[duplicate.key];
        } else {
          tvdbRecord.tvdbId = tvdbId;
        }
      }
      tvdbRecord.path = embyPath;
      tvdbRecord.genres = embyShow.Genres || [];
      tvdbRecord.overview = embyShow.Overview || "";
      tvdbRecord.dateCreated = embyShow.DateCreated?.substring(0, 10);
      tvdbRecord.premiereDate = embyShow.PremiereDate?.substring(0, 10);
      tvdbRecord.played = embyShow.UserData?.Played || false;
      tvdbRecord.playCount = embyShow.UserData?.PlayCount || 0;
      tvdbRecord.inToTry = toTryIds.has(showId);
      tvdbRecord.inContinue = continueIds.has(showId);
      tvdbRecord.inMark = markIds.has(showId);
      tvdbRecord.inLinda = lindaIds.has(showId);
      if (!tvdbRecord.inEmby) {
        tvdbRecord.inEmby = true;
        handlePickupChange(name, true, tvdbRecord.status);
      }
      tvdbRecord.lastEmbySync = now;
    }

    // Step 3: Detect disappeared shows → mark inEmby=false
    const embyNameSet = new Set(embyShows.map((s) => s.Name));
    const embyTvdbIdSet = new Set(
      embyShows.map((s) => String(s.ProviderIds?.Tvdb || "")).filter(Boolean),
    );
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (!isTvdbShow(rec) || rec.inEmby === false) continue;
      const stillInEmby =
        embyNameSet.has(name) ||
        (rec.tvdbId && embyTvdbIdSet.has(String(rec.tvdbId)));
      if (!stillInEmby) {
        console.log(`[runEmbyFullSweep] Marking ${name} as not in Emby`);
        // Delete show folder from disk so Emby cannot re-add it on next scan
        const folderName =
          typeof rec.path === "string" &&
          rec.path &&
          !rec.path.includes("/") &&
          !rec.path.includes("\\")
            ? rec.path
            : name;
        const folderPath = path.join(tvDir, folderName);
        try {
          const st = fs.statSync(folderPath);
          if (st.isDirectory()) {
            cp.execSync(`rm -rf "${folderPath}"`);
            console.log(`[runEmbyFullSweep] Deleted folder: ${folderPath}`);
          }
        } catch (e) {
          if (e.code !== "ENOENT") {
            console.error(
              `[runEmbyFullSweep] Failed to delete folder ${folderPath}:`,
              e.message,
            );
          }
        }
        rec.inEmby = false;
        rec.notReady = true;
        handlePickupChange(name, false, rec.status);
        try {
          history.addEvent({
            tvdbId: String(rec.tvdbId || "").trim() || null,
            showName: name,
            type: "remEmby",
            description: "Disappeared from Emby",
          });
        } catch {}
      }
    }

    // Step 4: Fix any pre-existing inEmby=false records with stale error fields
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (isTvdbShow(rec) && rec.inEmby === false) {
        const nonEmbyConstants = [
          ["fileGap", false],
          ["fileEndError", false],
          ["full", false],
          ["notReady", true],
        ];
        for (const [f, v] of nonEmbyConstants) {
          if (rec[f] !== v) {
            console.log(
              `[runEmbyFullSweep] Fixing stale ${f} for ${name}: ${rec[f]}->${v}`,
            );
            rec[f] = v;
          }
        }
      }
    }

    await tvdb.saveTvdbSync();
  } catch (err) {
    console.error("[runEmbyFullSweep] error:", err.message);
  } finally {
    embyFullSweepRunning = false;
    if (embyFullSweepQueued) {
      embyFullSweepQueued = false;
      runEmbyFullSweep();
    }
  }
}

/**
 * Phase 3.2: Sync disk filesystem data into tvdb
 * Runs every hour to update file dates and sizes
 */
async function syncDiskData() {
  try {
    // console.log("[Phase 3] syncDiskData: Starting...");

    // Get all tvdb records
    const allTvdb = tvdb.getAllTvdbSync();
    const changedShows = []; // Track which shows had disk changes
    if (!allTvdb || Object.keys(allTvdb).length === 0) {
      // console.log("[Phase 3] syncDiskData: No tvdb records to sync");
      return;
    }

    // Get disk data
    const diskShows = await getShowsFromDisk({});

    let updatedCount = 0;
    const now = Date.now();

    // Update tvdb records with fresh disk data
    for (const [name, tvdbRecord] of Object.entries(allTvdb)) {
      // Try Path first, fall back to Name for shows without Path set
      const embyPath = tvdbRecord.path || tvdbRecord.emby?.path || name;

      const pathPart = embyPath.split("/").pop();
      const diskInfo = diskShows[pathPart];
      if (!diskInfo) continue;

      const newDate = diskInfo ? diskInfo[0] : null;
      const newSize = diskInfo ? diskInfo[1] : 0;
      const newNoFiles = !diskInfo;

      // Check if disk data changed
      const changed =
        tvdbRecord.date !== newDate ||
        tvdbRecord.size !== newSize ||
        tvdbRecord.noFiles !== newNoFiles;

      if (changed) {
        tvdbRecord.date = newDate;
        tvdbRecord.size = newSize;
        tvdbRecord.noFiles = newNoFiles;
        tvdbRecord.sync = tvdbRecord.sync || {};
        tvdbRecord.sync.lastDiskCheck = now;
        updatedCount++;

        // Track this show for gap checking (disk changes can affect file gaps)
        changedShows.push({
          showId: tvdbRecord.id,
          showName: name,
          tvdbRecord,
        });
      }
    }

    if (updatedCount > 0) {
      await tvdb.saveTvdbSync();
      // console.log(`[Phase 3] syncDiskData: Updated ${updatedCount} shows`);

      // Trigger gap check for shows with disk changes after 10 second delay
      // This allows file operations/downloads to settle
      if (changedShows.length > 0) {
        const logMsg =
          changedShows.length === 1
            ? `[disk change] Checking 1 show: ${changedShows[0].showName}`
            : `[disk change] Checking ${changedShows.length} shows`;
        console.log(logMsg);
        setTimeout(() => {
          runGapCheckForShows(changedShows, false).catch((err) => {
            console.error(
              "[Phase 3] syncDiskData: delayed gapCheck failed:",
              err.message,
            );
          });
        }, 10000);
      }
    }
    // else {
    //   console.log("[Phase 3] syncDiskData: No changes detected");
    // }
  } catch (err) {
    console.error("[Phase 3] syncDiskData error:", err.message);
  }
}

/**
 * Run gap check for specific shows
 * @param {Array} shows - Array of {showId, showName, tvdbRecord}
 * @param {boolean} checkDiskFirst - If true, check disk for each show before gap checking
 */
async function runGapCheckForShows(shows, checkDiskFirst = true) {
  if (!shows || shows.length === 0) return;

  const startTime = Date.now();
  try {
    let diskUpdateCount = 0;

    // Check disk for each show individually if requested
    if (checkDiskFirst) {
      for (const { showId, showName, tvdbRecord } of shows) {
        // Try Path first, fall back to showName for shows without Path set
        const embyPath = tvdbRecord.path || tvdbRecord.emby?.path || showName;

        const pathPart = embyPath.split("/").pop();
        const diskInfo = await getShowDiskInfo(pathPart);

        if (diskInfo) {
          const [newDate, newSize] = diskInfo;
          const changed =
            tvdbRecord.date !== newDate || tvdbRecord.size !== newSize;

          if (changed) {
            tvdbRecord.date = newDate;
            tvdbRecord.size = newSize;
            tvdbRecord.noFiles = false;
            diskUpdateCount++;
          }
        } else {
          // Folder doesn't exist or empty
          const changed = tvdbRecord.noFiles !== true;
          if (changed) {
            tvdbRecord.noFiles = true;
            tvdbRecord.date = null;
            tvdbRecord.size = 0;
            diskUpdateCount++;
          }
        }
      }

      if (diskUpdateCount > 0) {
        await tvdb.saveTvdbSync();
        console.log(
          `[runGapCheckForShows] Updated disk info for ${diskUpdateCount} shows`,
        );
      }
    }

    // Update lastWatched for each show in batch (2-call Emby fetch per show)
    let lastWatchedChanged = 0;
    for (const { showId, showName, tvdbRecord } of shows) {
      const t0 = Date.now();
      try {
        const date = await fetchLastWatchedDate(showId);
        const elapsed = Date.now() - t0;
        if (date && date !== tvdbRecord.lastWatched) {
          tvdbRecord.lastWatched = date;
          lastWatchedChanged++;
          appendWatchgapLog(
            `  lastWatched updated | ${elapsed}ms | ${showName} -> ${date}`,
          );
        }
      } catch (err) {
        console.error(`[lastWatched] ${showName}: ${err.message}`);
      }
    }
    if (lastWatchedChanged > 0) {
      await tvdb.saveTvdbSync();
      console.log(`[lastWatched] Updated ${lastWatchedChanged} shows`);
    }

    // Now run gap check with fresh emby and disk data
    const gapData = await emby.gapCheckBatch(shows);
    for (const { showId, showName } of shows) {
      const g = gapData?.[showId];
      if (showName === "Swiss Toni") {
        console.log(
          `[DEBUG Swiss Toni batch] showId=${showId} g=${JSON.stringify(g)}`,
        );
      }
      if (g) {
        appendWatchgapLog(
          `  ${showName}: notReady=${g.notReady} fileGap=${g.fileGap} anyWatched=${g.anyWatched}${g.fileEndError ? " fileEndError=true" : ""}${g.seasonWatchedThenNofile ? " sWTNF=true" : ""}`,
        );
      } else {
        appendWatchgapLog(`  ${showName}: no gap data (error or skipped)`);
      }
    }
    const updatedCount = await tvdb.updateTvdbWithGapData(gapData);

    if (updatedCount > 0) {
      notifyClients("tvdbUpdated");
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[gap check] finished, ${elapsed} secs, ${shows.length} shows`);
  } catch (err) {
    console.error("[runGapCheckForShows] error:", err.message);
  }
}

const GAP_CHECK_BATCH_SIZE = 10;
const WATCHGAP_LOG = path.join(SRVR_DATA_DIR, "watchgap.log");

function appendWatchgapLog(line) {
  const ts = new Date()
    .toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" })
    .slice(0, 19);
  fs.appendFileSync(WATCHGAP_LOG, `${ts} ${line}\n`);
}

/**
 * Phase 3.3: Background gap check - processes shows least-recently-checked first
 */
async function runGapCheckBatch() {
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    if (!allTvdb || Object.keys(allTvdb).length === 0) return;

    const showsToCheck = Object.entries(allTvdb)
      .filter(([_, tvdbRecord]) => tvdbRecord?.inEmby && tvdbRecord?.id)
      .map(([showName, tvdbRecord]) => ({
        showId: tvdbRecord.id,
        showName,
        tvdbRecord,
      }))
      .sort(
        (a, b) =>
          (a.tvdbRecord.lastGapCheck ?? 0) - (b.tvdbRecord.lastGapCheck ?? 0),
      );

    if (showsToCheck.length === 0) return;

    const batch = showsToCheck.slice(0, GAP_CHECK_BATCH_SIZE);
    console.log(
      `[gap-batch] ${batch.length}/${showsToCheck.length} shows, oldest: ${batch[0].showName}`,
    );
    appendWatchgapLog(
      `[batch ${batch.length}/${showsToCheck.length}] ${batch.map((s) => s.showName).join(", ")}`,
    );
    await runGapCheckForShows(batch, true);
  } catch (err) {
    console.error("[Phase 3] runGapCheckBatch error:", err.message);
  }
}

// Phase 3: Set up sync timers
const EMBY_API_KEY = "1c399bd079d549cba8c916244d3add2b";
const EMBY_USER_ID = "894c752d448f45a3a1260ccaabd0adff";
const EMBY_BASE_URL = "https://hahnca.com:8920/emby";
const COLLECTION_IDS = {
  toTry: "1468316",
  continue: "4719143",
  mark: "4697672",
  linda: "4706186",
};

const DISK_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour (full disk check)
const GAP_CHECK_INTERVAL = 6 * 60 * 1000; // 6 minutes (processes batch of 10 shows, checks disk per-show)

async function fetchLastWatchedDate(showId) {
  const epUrl = `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?api_key=${EMBY_API_KEY}&ParentId=${showId}&IncludeItemTypes=Episode&Recursive=true&IsPlayed=true&SortBy=DatePlayed&SortOrder=Descending&Limit=1`;
  const epResp = await fetch(epUrl);
  if (!epResp.ok) return null;
  const epData = await epResp.json();
  const epId = epData.Items?.[0]?.Id;
  if (!epId) return null;
  const detailUrl = `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${epId}?api_key=${EMBY_API_KEY}`;
  const detailResp = await fetch(detailUrl);
  if (!detailResp.ok) return null;
  const detail = await detailResp.json();
  const utcStr = detail.UserData?.LastPlayedDate;
  if (!utcStr) return null;
  return utcStr.substring(0, 10);
}

// NOTE: syncEmbyUserData periodic sync removed - now using immediate triggers from client
// Collections and user data changes are handled by /api/triggerEmbySync and /api/triggerShowSelect
// NOTE: syncDiskData and runGapCheckBatch periodic timers removed - now handled by tryLocalGetTvdb
// per-show tick via perShowCallback (disk + gap) and preTvdbTickCallback (Emby sweep)

runUsbCheck();
setInterval(runUsbCheck, CHECK_INTERVAL_MS);

//////////////////  CHOKIDAR FILE WATCHER  //////////////////

const changedShows = new Map(); // showName -> timeout
const DISK_CHANGE_DEBOUNCE_MS = 3000; // 3 seconds

/**
 * Extract show name from file path
 * Path format: /mnt/media/tv/ShowName/Season 01/episode.mkv
 */
function extractShowNameFromPath(filePath) {
  const relativePath = filePath.replace(tvDir + "/", "");
  const parts = relativePath.split("/");
  if (parts.length > 0) {
    return parts[0]; // First part is show name
  }
  return null;
}

// Tracks shows currently being processed to prevent parallel calls
const inFlightDiskChanges = new Set();
const pendingDiskChanges = new Set();

/**
 * Handle disk change for a show (debounced)
 */
async function handleShowDiskChange(showName) {
  if (inFlightDiskChanges.has(showName)) {
    pendingDiskChanges.add(showName);
    console.log(`[chokidar] ${showName} already in flight, queued retry`);
    return;
  }
  inFlightDiskChanges.add(showName);
  try {
    console.log(`[chokidar] Processing disk change for: ${showName}`);

    // Update disk info for this show
    const diskInfo = await getShowDiskInfo(showName);
    if (diskInfo) {
      const [maxDate, totalSize] = diskInfo;

      // Update tvdb record with new disk info
      const allTvdb = tvdb.getAllTvdbSync();
      const tvdbRecord = allTvdb[showName];
      if (tvdbRecord) {
        tvdbRecord.date = maxDate;
        tvdbRecord.size = totalSize;
        await tvdb.saveTvdbSync();
        console.log(
          `[chokidar] Updated disk info for ${showName}: ${totalSize} bytes, ${maxDate}`,
        );
      }
    }

    // Trigger Emby library refresh so map shows current data
    console.log(`[chokidar] Triggering Emby library refresh for ${showName}`);
    let taskId = null;
    try {
      const refreshRes = await fetch(
        `https://hahnca.com:8920/emby/Library/Refresh?api_key=${EMBY_API_KEY}`,
        { method: "POST" },
      );
      if (refreshRes.ok) {
        // Get the task ID
        const tasksRes = await fetch(
          `https://hahnca.com:8920/emby/ScheduledTasks?api_key=${EMBY_API_KEY}`,
        );
        if (tasksRes.ok) {
          const tasks = await tasksRes.json();
          const libraryTask = tasks.find((t) => {
            const n = String(t?.Name || "").toLowerCase();
            return (
              n.includes("library") &&
              (n.includes("scan") || n.includes("refresh"))
            );
          });
          if (libraryTask?.Id) {
            taskId = libraryTask.Id;
            console.log(`[chokidar] Emby refresh triggered, taskId: ${taskId}`);
          } else {
            console.log(`[chokidar] Emby refresh triggered, no taskId found`);
          }
        }
      } else {
        console.error(
          `[chokidar] Emby refresh failed: ${refreshRes.status} ${refreshRes.statusText}`,
        );
      }
    } catch (refreshErr) {
      console.error(`[chokidar] Emby refresh error:`, refreshErr.message);
    }

    // Notify all connected clients immediately with taskId
    notifyClients("showDiskChanged", { showName, taskId });
    console.log(
      `[chokidar] Notified clients about ${showName} with taskId: ${taskId}`,
    );

    // Wait for Emby scan to finish before running gap check
    if (taskId) {
      const POLL_INTERVAL_MS = 5000;
      const POLL_TIMEOUT_MS = 5 * 60 * 1000;
      const pollStart = Date.now();
      let scanDone = false;
      console.log(
        `[chokidar] Polling Emby scan task ${taskId} for ${showName}`,
      );
      while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const taskRes = await fetch(
            `https://hahnca.com:8920/emby/ScheduledTasks/${taskId}?api_key=${EMBY_API_KEY}`,
          );
          if (taskRes.ok) {
            const task = await taskRes.json();
            if (task.State !== "Running") {
              console.log(
                `[chokidar] Emby scan finished (State=${task.State}) for ${showName}`,
              );
              scanDone = true;
              break;
            }
          }
        } catch (pollErr) {
          console.error(`[chokidar] Task poll error:`, pollErr.message);
        }
      }
      if (!scanDone) {
        console.warn(
          `[chokidar] Emby scan poll timed out for ${showName}, proceeding anyway`,
        );
      }
    } else {
      // No taskId — fall back to fixed wait
      console.log(
        `[chokidar] No taskId, waiting 90s for Emby scan for ${showName}`,
      );
      await new Promise((r) => setTimeout(r, 90 * 1000));
    }

    try {
      const allTvdb = tvdb.getAllTvdbSync();
      const tvdbRecord = allTvdb[showName];
      if (!tvdbRecord?.inEmby || !tvdbRecord?.id) return;

      // Refresh fileGap, watchGap, etc.
      await runGapCheckForShows(
        [{ showId: tvdbRecord.id, showName, tvdbRecord }],
        false,
      );
      console.log(`[chokidar] Gap check refreshed for ${showName}`);

      // Refresh watchedEpis from Emby
      const show = { name: showName, id: tvdbRecord.id };
      const seriesMap = await emby.getSeriesMap(show);
      if (seriesMap && seriesMap.length > 0) {
        const watchedEpis = tvdb.seriesMapToWatchedEpis(seriesMap);
        const freshRecord = tvdb.getAllTvdbSync()[showName];
        if (freshRecord) {
          freshRecord.watchedEpis = watchedEpis;
          await tvdb.saveTvdbSync();
          notifyClients("tvdbUpdated");
          console.log(
            `[chokidar] watchedEpis refreshed for ${showName}:`,
            watchedEpis,
          );
        }
      }
    } catch (err) {
      console.error(
        `[chokidar] Post-download refresh error for ${showName}:`,
        err.message,
      );
    }
  } catch (err) {
    console.error(
      `[chokidar] Error handling disk change for ${showName}:`,
      err.message,
    );
  } finally {
    inFlightDiskChanges.delete(showName);
    if (pendingDiskChanges.has(showName)) {
      pendingDiskChanges.delete(showName);
      console.log(`[chokidar] Re-running queued disk change for ${showName}`);
      setTimeout(() => handleShowDiskChange(showName), 1000);
    }
  }
}

// Start watching TV directory
const watcher = chokidar.watch(tvDir, {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true, // don't emit events for existing files on startup
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100,
  },
  depth: 99, // watch all subdirectories
});

watcher
  .on("add", (filePath) => {
    console.log(`[chokidar] detected add: ${filePath}`);
    const ext = filePath.split(".").pop();
    if (!videoFileExtensions.includes(ext)) return;

    const showName = extractShowNameFromPath(filePath);
    if (!showName) return;

    console.log(`[chokidar] video added: ${showName}`);

    // Debounce: clear existing timeout and set new one
    if (changedShows.has(showName)) {
      clearTimeout(changedShows.get(showName));
    }

    const timeout = setTimeout(() => {
      changedShows.delete(showName);
      console.log(
        `[tvdb loop] chokidar add debounce fired: enqueuing ${showName}`,
      );
      tvdb.enqueueShowProcess(showName);
    }, DISK_CHANGE_DEBOUNCE_MS);

    changedShows.set(showName, timeout);
  })
  .on("unlink", (filePath) => {
    console.log(`[chokidar] detected unlink: ${filePath}`);
    const ext = filePath.split(".").pop();
    if (!videoFileExtensions.includes(ext)) return;

    const showName = extractShowNameFromPath(filePath);
    if (!showName) return;

    console.log(`[chokidar] video deleted: ${showName}`);

    // Debounce: clear existing timeout and set new one
    if (changedShows.has(showName)) {
      clearTimeout(changedShows.get(showName));
    }

    const timeout = setTimeout(() => {
      changedShows.delete(showName);
      console.log(
        `[tvdb loop] chokidar unlink debounce fired: enqueuing ${showName}`,
      );
      tvdb.enqueueShowProcess(showName);
    }, DISK_CHANGE_DEBOUNCE_MS);

    changedShows.set(showName, timeout);
  })
  .on("error", (error) => {
    console.error("[chokidar] Watcher error:", error);
  })
  .on("ready", () => {
    console.log("[chokidar] Initial scan complete. Ready for changes.");
  });

console.log(`[chokidar] Watching ${tvDir} for file changes...`);
