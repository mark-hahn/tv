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
import { checkFlexgetStatus } from "../api/src/usb.js";
import fetch from "node-fetch";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import {
  SRVR_ROOT_DIR,
  SRVR_DATA_DIR,
  SRVR_SECRETS_DIR,
} from "./src/srvrPaths.js";

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

function readJsonTextOr(filePathOrPaths, fallbackObj) {
  return readTextOr(filePathOrPaths, JSON.stringify(fallbackObj));
}

function configReadCandidates(relativePath) {
  // Prefer CWD for backwards compatibility, but fall back to module dir.
  return [
    path.join(process.cwd(), relativePath),
    path.join(SRVR_ROOT_DIR, relativePath),
  ];
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

const noEmbyPath = path.join(SRVR_DATA_DIR, "noemby.json");

// Strict: persisted state must live under TV_DATA_DIR.
ensureFile(noEmbyPath, "[]");

const noEmbyStr = readJsonTextOr(noEmbyPath, []);

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

const notesPath = path.join(SRVR_DATA_DIR, "notes.json");
ensureFile(notesPath, "{}");
let notesCache = {};
try {
  const notesStr = fs.readFileSync(notesPath, "utf8");
  notesCache = JSON.parse(notesStr || "{}") || {};
} catch (e) {
  // First run or corrupt JSON: create/reset to empty.
  try {
    ensureDir(path.dirname(notesPath));
    fs.writeFileSync(notesPath, "{}", "utf8");
  } catch {}
  notesCache = {};
}

// Ensure we never keep/persist empty notes.
try {
  let changed = false;
  const cleaned = {};
  for (const [rawKey, rawVal] of Object.entries(notesCache ?? {})) {
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key) {
      changed = true;
      continue;
    }

    const val = rawVal === undefined || rawVal === null ? "" : String(rawVal);
    if (val.trim() === "") {
      changed = true;
      continue;
    }

    if (key !== rawKey || val !== rawVal) changed = true;
    cleaned[key] = val;
  }

  if (changed) {
    notesCache = cleaned;
    try {
      fs.writeFileSync(notesPath, JSON.stringify(notesCache), "utf8");
    } catch {}
  }
} catch {}

const rejects = JSON.parse(rejectStr);
const pickups = JSON.parse(pickupStr);
const noEmbys = JSON.parse(noEmbyStr);
const notes = notesCache;

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

function parseSeasonEpisodeFromFilename(fileName) {
  // Uses parse-torrent-title. Returns { season, episode } or null.
  if (!fileName) return null;
  const base = String(fileName);

  let parsed;
  try {
    parsed = parseTorrentTitle(base);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const season = Number.isFinite(Number(parsed.season))
    ? Number(parsed.season)
    : Array.isArray(parsed.seasons) && parsed.seasons.length
      ? Number(parsed.seasons[0])
      : NaN;
  const episode = Number.isFinite(Number(parsed.episode))
    ? Number(parsed.episode)
    : Array.isArray(parsed.episodes) && parsed.episodes.length
      ? Number(parsed.episodes[0])
      : NaN;

  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return { season, episode };
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
  if (gap.FileGap === true) return true;
  if (gap.WatchGap === true) return true;
  if (gap.NotReady === true) return true;

  // Explicit season/episode markers (allow 0).
  if (gap.FileGapSeason !== null && gap.FileGapSeason !== undefined)
    return true;
  if (gap.FileGapEpisode !== null && gap.FileGapEpisode !== undefined)
    return true;
  if (gap.WatchGapSeason !== null && gap.WatchGapSeason !== undefined)
    return true;
  if (gap.WatchGapEpisode !== null && gap.WatchGapEpisode !== undefined)
    return true;

  // Non-empty wait string can also indicate a gap state.
  if (typeof gap.WaitStr === "string" && gap.WaitStr.trim() !== "") return true;

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

// Set up callback for tvdb to add shows to pickup list
tvdb.setAddToPickupsCallback((showName) => {
  // Check if already in pickup list
  const alreadyInPickups = pickups.some(
    (pickup) => pickup.toLowerCase() === showName.toLowerCase(),
  );
  if (!alreadyInPickups) {
    console.log("Auto-adding to pickups (not in emby):", showName);
    pickups.push(showName);
    // Save and upload config asynchronously without blocking
    (async () => {
      await trySaveConfigYml(
        null,
        null,
        () => {},
        () => {},
      );
    })();
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
    if (totalSize == 0) {
      console.log("empty show:", dirent);
    }
  }
  if (errFlg) {
    throw new Error(`getShowsFromDisk: Error: ${errFlg.message}`);
  } else {
    return shows;
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

  // Phase 5: Also save tvdb when config is saved (batches reject/pickup updates)
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

// Synchronize rejects between noEmby.json and config2-rejects.json on startup.
const startupRejectsSync = () => {
  let changedRejects = false;
  let changedNoEmbys = false;

  // Add noEmby rejects to rejects list
  for (const show of noEmbys) {
    if (show.Reject) {
      if (!rejects.some((r) => r.toLowerCase() === show.Name.toLowerCase())) {
        rejects.push(show.Name);
        console.log("[sync] Added to rejects from noEmby:", show.Name);
        changedRejects = true;
      }
    }
  }

  // Add keys from rejects list to noEmby shows if they match
  for (const rName of rejects) {
    const show = noEmbys.find(
      (s) => s.Name.toLowerCase() === rName.toLowerCase(),
    );
    if (show && !show.Reject) {
      show.Reject = true;
      console.log(
        "[sync] Set Reject=true on noEmby from rejects list:",
        show.Name,
      );
      changedNoEmbys = true;
    }
  }

  if (changedRejects) {
    // Save and upload
    console.log("[sync] Saving and uploading rejects...");
    saveConfigYml(
      "startup",
      "ok",
      () => {},
      () => {},
    );
  } else {
    // Force upload to ensure config.yml matches disk state (cleans up stale entries)
    upload();
  }

  if (changedNoEmbys) {
    try {
      fs.writeFileSync(noEmbyPath, JSON.stringify(noEmbys));
      console.log("[sync] Saved updated noemby.json");
    } catch (e) {
      console.error("[sync] failed to save noemby:", e);
    }
  }
};

// Synchronize pickups from config4-pickups.json to tvdb.json on startup
const startupPickupsSync = () => {
  const allTvdb = tvdb.getAllTvdbSync();
  let changedTvdb = false;

  // Create normalized pickups set for fast lookup
  const normalizedPickups = new Set(pickups.map((p) => p.toLowerCase()));

  // Set pickup=true on tvdb records that match the pickups list
  for (const pickupName of pickups) {
    const normalizedName = pickupName.toLowerCase();
    for (const [recordName, record] of Object.entries(allTvdb)) {
      if (recordName.toLowerCase() === normalizedName) {
        if (!record.pickup) {
          record.pickup = true;
          changedTvdb = true;
        }
        break;
      }
    }
  }

  // Set pickup=false on tvdb records that don't match pickups list
  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (record.pickup && !normalizedPickups.has(recordName.toLowerCase())) {
      record.pickup = false;
      changedTvdb = true;
    }
  }

  if (changedTvdb) {
    console.log("[sync] Saving tvdb with updated pickups...");
    tvdb.saveTvdbSync().catch((err) => {
      console.error("[sync] failed to save tvdb:", err);
    });
  }
};

// Run sync immediately
startupRejectsSync();
startupPickupsSync();

const getRejects = async (_param) => {
  // Phase 5: Read from tvdb instead of separate rejects array
  const allTvdb = tvdb.getAllTvdbSync();
  const rejectsFromTvdb = [];

  for (const [name, record] of Object.entries(allTvdb)) {
    if (record.reject) {
      rejectsFromTvdb.push(name);
    }
  }

  return rejectsFromTvdb;
};

const addReject = async (params) => {
  const { name } = params;
  console.log("addReject", name);

  // Phase 5: Update tvdb.reject field
  const allTvdb = tvdb.getAllTvdbSync();
  const normalizedName = name.toLowerCase();
  let tvdbRecord = null;

  // Find matching record (case-insensitive)
  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (recordName.toLowerCase() === normalizedName) {
      tvdbRecord = record;
      break;
    }
  }

  if (tvdbRecord) {
    tvdbRecord.reject = true;
    // Save deferred to saveConfigYml below
  }

  // Backward compat: update old rejects array
  // 1. Ensure it exists in rejects list
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

  // 2. Sync to noEmbys if present
  const noEmbyShow = noEmbys.find(
    (s) => s.Name.toLowerCase() === name.toLowerCase(),
  );
  if (noEmbyShow && !noEmbyShow.Reject) {
    noEmbyShow.Reject = true;
    console.log("-- sync: set Reject=true on noEmby:", noEmbyShow.Name);
    util.writeFile(noEmbyPath, noEmbys); // fire and forget write
  }

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
  const { name } = params;
  console.log("delReject", name);
  let deletedOne = false;

  // Phase 5: Update tvdb.reject field
  const allTvdb = tvdb.getAllTvdbSync();
  const normalizedName = name.toLowerCase();

  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (recordName.toLowerCase() === normalizedName && record.reject) {
      record.reject = false;
      // Save deferred to saveConfigYml below
      deletedOne = true;
      break;
    }
  }

  // Backward compat: remove from old rejects array
  // 1. Remove from rejects list
  for (const [idx, rejectNameStr] of rejects.entries()) {
    if (rejectNameStr.toLowerCase() === name.toLowerCase()) {
      console.log("-- deleting reject:", rejectNameStr);
      rejects.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }

  // 2. Sync to noEmbys: if present, clear the flag
  const noEmbyShow = noEmbys.find(
    (s) => s.Name.toLowerCase() === name.toLowerCase(),
  );
  if (noEmbyShow && noEmbyShow.Reject) {
    noEmbyShow.Reject = false;
    console.log("-- sync: cleared Reject on noEmby:", noEmbyShow.Name);
    util.writeFile(noEmbyPath, noEmbys);
    deletedOne = true; // Consider it a success if we removed the flag from noEmby too
  }

  if (!deletedOne) {
    console.log("-- reject not deleted -- no match:", name);
    return "delReject not deleted: " + name;
  }

  return new Promise((resolve, reject) => {
    saveConfigYml(
      null,
      "ok",
      ([_, result]) => resolve(result),
      ([_, error]) => reject(new Error(error)),
    );
  });
};

const getPickups = async (_param) => {
  // Phase 5: Read from tvdb instead of separate pickups array
  const allTvdb = tvdb.getAllTvdbSync();
  const pickupsFromTvdb = [];

  for (const [name, record] of Object.entries(allTvdb)) {
    if (record.pickup) {
      pickupsFromTvdb.push(name);
    }
  }

  return pickupsFromTvdb;
};

const addPickup = async (params) => {
  const name = params?.name;
  console.log("addPickup", name);

  if (!name) {
    throw new Error("addPickup: missing name");
  }

  // Phase 5: Update tvdb.pickup field
  const allTvdb = tvdb.getAllTvdbSync();
  const normalizedName = name.toLowerCase();

  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (recordName.toLowerCase() === normalizedName) {
      record.pickup = true;
      // Save deferred to saveConfigYml below
      break;
    }
  }

  // Backward compat: update old pickups array
  for (const [idx, pickupNameStr] of pickups.entries()) {
    if (pickupNameStr.toLowerCase() === name.toLowerCase()) {
      console.log("-- removing old matching pickup:", pickupNameStr);
      pickups.splice(idx, 1);
      break;
    }
  }
  console.log("-- adding pickup:", name);
  pickups.push(name);
  await new Promise((resolve, reject) =>
    saveConfigYml(null, "ok", resolve, reject),
  );
  return "ok";
};

const delPickup = async (params) => {
  const name = params?.name;
  console.log("delPickup", name);
  if (!name) {
    throw new Error("delPickup: missing name");
  }
  let deletedOne = false;

  // Phase 5: Update tvdb.pickup field
  const allTvdb = tvdb.getAllTvdbSync();
  const normalizedName = name.toLowerCase();

  for (const [recordName, record] of Object.entries(allTvdb)) {
    if (recordName.toLowerCase() === normalizedName && record.pickup) {
      record.pickup = false;
      // Save deferred to saveConfigYml below
      deletedOne = true;
      break;
    }
  }

  // Backward compat: update old pickups array
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
  await new Promise((resolve, reject) =>
    saveConfigYml(null, "ok", resolve, reject),
  );
  return "ok";
};

const getNoEmbys = async (_params) => {
  return noEmbys;
};

const addNoEmby = async (params) => {
  const show = params.show || params;
  const name = show.Name;
  console.log("addNoEmby", name);
  if (!name) throw new Error("addNoEmby: missing show Name");

  for (const [idx, show] of noEmbys.entries()) {
    if (show.Name.toLowerCase() === name.toLowerCase()) {
      console.log("removing old noemby:", name);
      noEmbys.splice(idx, 1);
      break;
    }
  }

  // Sync: if this new noEmby has Reject=true, ensure it's in config2-rejects.json
  if (show.Reject) {
    if (!rejects.some((r) => r.toLowerCase() === name.toLowerCase())) {
      rejects.push(name);
      console.log("-- sync: added to rejects list from new noEmby:", name);
      // Trigger save and upload
      saveConfigYml(
        "internal-addNoEmby",
        "ok",
        () => {},
        () => {},
      );
    }
  } else {
    // If it's NOT rejected, but the global list says it IS, force it to true?
    // Usually "global list" is the authority for bans.
    // "when show is added to either file add it to the other" implies bidirectional sync.
    // If global list has it, the noEmby show should probably inherit it.
    if (rejects.some((r) => r.toLowerCase() === name.toLowerCase())) {
      show.Reject = true;
      console.log("-- sync: inherited Reject=true from global list:", name);
    }
  }

  console.log("adding noemby:", name);
  noEmbys.push(show);
  await util.writeFile(noEmbyPath, noEmbys);
  return "ok";
};

const delNoEmby = async (params) => {
  const name = params?.name;
  console.log("delNoEmby", name);
  if (!name) throw new Error("delNoEmby: missing name");
  let deletedOne = false;
  let wasRejected = false;

  for (const [idx, show] of noEmbys.entries()) {
    if (!show.Name || show.Name.toLowerCase() === name.toLowerCase()) {
      console.log("deleting no-emby because now in emby:", name);
      if (show.Reject) wasRejected = true;
      noEmbys.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }

  if (wasRejected) {
    // "when show is removed from either file remove it from the other"
    const rIdx = rejects.findIndex(
      (r) => r.toLowerCase() === name.toLowerCase(),
    );
    if (rIdx !== -1) {
      console.log(
        "-- sync: removing from rejects because noEmby was deleted:",
        name,
      );
      rejects.splice(rIdx, 1);
      // Trigger save and upload
      saveConfigYml(
        "internal-delNoEmby",
        "ok",
        () => {},
        () => {},
      );
    }
  }

  if (!deletedOne) {
    console.log("no noembys deleted, no match:", name);
    return "delNoEmby no match:" + name;
  }
  await util.writeFile(noEmbyPath, noEmbys);
  return "ok";
};

const getGaps = async (_param) => {
  // Phase 5: Read from tvdb instead of separate gaps object
  const allTvdb = tvdb.getAllTvdbSync();
  const gapsFromTvdb = {};

  for (const [name, record] of Object.entries(allTvdb)) {
    if (record.gap) {
      gapsFromTvdb[record.emby.id] = record.gap;
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
  const showPath = params?.showPath;
  const season = params?.season;

  if (!showName || !showPath || season === undefined || season === null) {
    throw new Error("delSeasonFiles: requires showName, showPath, season");
  }

  const seasonDir = path.join(showPath, `Season ${season}`);
  console.log(`[delSeasonFiles] ${showName}: ${seasonDir}`);

  if (!fs.existsSync(seasonDir)) {
    throw new Error(`no such dir: ${seasonDir}`);
  }

  let entries = [];
  try {
    entries = fs.readdirSync(seasonDir);
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

  return { status: "ok" };
};

const createShowFolder = async (params) => {
  const showNameRaw = params?.showName;
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
  return notesCache[showName] ?? "";
};

const getAllNotes = async (_params) => {
  // Phase 5: Read from tvdb instead of separate notesCache
  const allTvdb = tvdb.getAllTvdbSync();
  const notesFromTvdb = {};

  for (const [name, record] of Object.entries(allTvdb)) {
    if (
      record.note &&
      typeof record.note === "string" &&
      record.note.trim() !== ""
    ) {
      notesFromTvdb[name] = record.note;
    }
  }

  return notesFromTvdb;
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

  // Phase 5: Update tvdb.note field
  const allTvdb = tvdb.getAllTvdbSync();
  const tvdbRecord = allTvdb[key];

  if (!tvdbRecord) {
    throw new Error(`saveNote: show not found in tvdb: ${key}`);
  }

  // Never store empty notes: treat as delete.
  if (noteText.trim() === "") {
    if (!tvdbRecord.note) {
      return "ok";
    }
    tvdbRecord.note = "";
    await tvdb.saveTvdbSync();

    // Backward compat: also update old notesCache
    if (notesCache[key] !== undefined) {
      delete notesCache[key];
      try {
        await util.writeFile(notesPath, notesCache);
      } catch (e) {
        // Ignore write errors for deprecated file
      }
    }
    return "ok";
  }

  const prev = tvdbRecord.note;
  if (prev === finalNote) {
    return "ok";
  }

  tvdbRecord.note = finalNote;
  // Notes are always saved immediately (explicit user action)
  await tvdb.saveTvdbSync();

  // Backward compat: also update old notesCache
  notesCache[key] = finalNote;
  try {
    await util.writeFile(notesPath, notesCache);
  } catch (e) {
    // Ignore write errors for deprecated file
  }

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

  // Persist the augmented request for inspection.
  try {
    await util.writeFile("samples/fileIdObjs.json", fileIdObjs);
  } catch (e) {
    throw new Error(`applySubFiles: write failed: ${e.message}`);
  }

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

      const parsed = parseSeasonEpisodeFromFilename(fileName);
      if (!parsed) continue;

      const key = `${parsed.season}-${parsed.episode}`;
      const candidates = byKey.get(key);
      if (!candidates || candidates.length === 0) continue;

      foundKeys.add(key);

      const fileBase = fileName.slice(0, -(ext.length + 1));

      // Find the first candidate that (a) doesn't already exist on disk and
      // (b) successfully downloads. Only write one new srt per video per call.
      let wroteOneForThisVideo = false;
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
          wroteOneForThisVideo = true;
          break;
        } catch {
          // If write fails, try next candidate (maybe different season path or name).
          continue;
        }
      }

      if (wroteOneForThisVideo) {
        // Ensure only one new srt per video per call.
        continue;
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
  const fullPath =
    pathParam.includes("/") || pathParam.includes("\\")
      ? pathParam
      : path.join(tvDir, pathParam);

  console.log("deletePath: deleting", fullPath);

  try {
    await rimraf(fullPath);
    console.log("deletePath: rimraf completed for:", fullPath);

    // Verify the directory/file is actually gone
    if (fs.existsSync(fullPath)) {
      console.error("deletePath: path still exists after rimraf:", fullPath);
      throw new Error(`Path still exists after deletion: ${fullPath}`);
    }

    console.log("deletePath success: path confirmed deleted:", fullPath);
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
app.get("/api/getPickups", apiWrapper(getPickups));
app.get("/api/getGaps", apiWrapper(getGaps));
app.get("/api/getNoEmbys", apiWrapper(getNoEmbys));
app.get("/api/getDevices", apiWrapper(emby.getDevices));
app.get("/api/getLastViewed", apiWrapper(view.getLastViewed));
app.get("/api/getSharedFilters", apiWrapper(getSharedFilters));
app.get("/api/getAllNotes", apiWrapper(getAllNotes));

// Endpoints with parameters
app.post("/api/getRemotes", apiWrapper(tvdb.getRemotesCmd));
app.post("/api/getNewTvdb", apiWrapper(tvdb.getNewTvdb));
app.post("/api/getActorPage", apiWrapper(tvdb.getActorPage));
app.post("/api/getTmdb", apiWrapper(tmdb.getTmdb));
app.post("/api/getNote", apiWrapper(getNote));
app.post("/api/getFile", apiWrapper(getFile));
app.post("/api/getSubFileIds", apiWrapper(getSubFileIds));
app.post("/api/accessTvdb", apiWrapper(tvdb.accessTvdb));

// CRUD operations
app.post("/api/addReject", apiWrapper(addReject));
app.post("/api/delReject", apiWrapper(delReject));
app.post("/api/addPickup", apiWrapper(addPickup));
app.post("/api/delPickup", apiWrapper(delPickup));
app.post("/api/addNoEmby", apiWrapper(addNoEmby));
app.post("/api/delNoEmby", apiWrapper(delNoEmby));
app.post("/api/addGap", apiWrapper(addGap));
app.post("/api/delGap", apiWrapper(delGap));
app.post("/api/setTvdbFields", apiWrapper(tvdb.setTvdbFields));
app.post("/api/setSharedFilters", apiWrapper(setSharedFilters));
app.post("/api/saveNote", apiWrapper(saveNote));

// File operations
app.post("/api/deletePath", apiWrapper(deletePath));
app.post("/api/delSeasonFiles", apiWrapper(delSeasonFiles));
app.post("/api/createShowFolder", apiWrapper(createShowFolder));

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
      console.log(socketName + " connected");
    }

    // Only handleAsr uses WebSocket now (for streaming audio)
    if (fname == "handleAsr") {
      handleAsr(ws, id, param);
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
    socketName = "unknown websocket";
  });

  ws.on("close", () => {
    // log(socketName + ' closed');
    socketName = "unknown websocket";
  });
});

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function runUsbCheck() {
  try {
    await checkFlexgetStatus();
    // console.log("USB status check passed.");
  } catch (err) {
    console.error("USB status check failed:", err.message);
    try {
      await email.sendEmail(`USB Status Check Failed:\n${err.message}`);
    } catch (e) {
      console.error("Failed to send error email:", e);
    }
  }
}

// Phase 3: Incremental sync functions

/**
 * Phase 3.1: Sync Emby user data (watched status, play counts) into tvdb
 * Runs every 5 minutes to keep user data fresh without full reload
 */
async function syncEmbyUserData() {
  try {
    console.log("[Phase 3] syncEmbyUserData: Starting...");

    // Get all tvdb records
    const allTvdb = tvdb.getAllTvdbSync();
    if (!allTvdb || Object.keys(allTvdb).length === 0) {
      console.log("[Phase 3] syncEmbyUserData: No tvdb records to sync");
      return;
    }

    // Get current Emby sessions/user data
    // We'll fetch shows from Emby to get updated UserData
    const embyUrl =
      "https://hahnca.com:8920/emby/Users/894c752d448f45a3a1260ccaabd0adff/Items?api_key=1c399bd079d549cba8c916244d3add2b&IncludeItemTypes=Series&Recursive=true&Fields=UserData&StartIndex=0&Limit=10000";

    const resp = await fetch(embyUrl);
    if (!resp.ok) {
      console.error(
        "[Phase 3] syncEmbyUserData: Emby fetch failed:",
        resp.status,
      );
      return;
    }

    const data = await resp.json();
    const embyShows = data.Items || [];

    let updatedCount = 0;
    const now = Date.now();

    // Update tvdb records with fresh Emby user data
    for (const embyShow of embyShows) {
      const name = embyShow.Name;
      const tvdbRecord = allTvdb[name];

      if (!tvdbRecord || !tvdbRecord.inEmby) continue;

      // Check if user data changed (also check UnplayedItemCount for episode watches)
      const userData = embyShow.UserData || {};
      const changed =
        tvdbRecord.Played !== userData.Played ||
        tvdbRecord.PlayCount !== userData.PlayCount ||
        tvdbRecord.IsFavorite !== userData.IsFavorite ||
        tvdbRecord.LastPlayedDate !== userData.LastPlayedDate ||
        tvdbRecord.UnplayedItemCount !== userData.UnplayedItemCount;

      if (changed) {
        // Set flattened properties directly on tvdbRecord
        tvdbRecord.Played = userData.Played || false;
        tvdbRecord.PlayCount = userData.PlayCount || 0;
        tvdbRecord.IsFavorite = userData.IsFavorite || false;
        tvdbRecord.LastPlayedDate = userData.LastPlayedDate || null;
        tvdbRecord.UnplayedItemCount = userData.UnplayedItemCount || 0;

        // Delete old nested emby properties
        if (tvdbRecord.emby) {
          delete tvdbRecord.emby.isPlayed;
          delete tvdbRecord.emby.playCount;
          delete tvdbRecord.emby.isFavorite;
          delete tvdbRecord.emby.lastPlayedDate;
          delete tvdbRecord.emby.unplayedCount;
        }

        tvdbRecord.sync = tvdbRecord.sync || {};
        tvdbRecord.sync.lastEmbySync = now;
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      await tvdb.saveTvdbSync();
      console.log(`[Phase 3] syncEmbyUserData: Updated ${updatedCount} shows`);
    } else {
      console.log("[Phase 3] syncEmbyUserData: No changes detected");
    }
  } catch (err) {
    console.error("[Phase 3] syncEmbyUserData error:", err.message);
  }
}

/**
 * Phase 3.2: Sync disk filesystem data into tvdb
 * Runs every hour to update file dates and sizes
 */
async function syncDiskData() {
  try {
    console.log("[Phase 3] syncDiskData: Starting...");

    // Get all tvdb records
    const allTvdb = tvdb.getAllTvdbSync();
    if (!allTvdb || Object.keys(allTvdb).length === 0) {
      console.log("[Phase 3] syncDiskData: No tvdb records to sync");
      return;
    }

    // Get disk data
    const diskShows = await getShowsFromDisk({});

    let updatedCount = 0;
    const now = Date.now();

    // Update tvdb records with fresh disk data
    for (const [name, tvdbRecord] of Object.entries(allTvdb)) {
      const embyPath = tvdbRecord.emby?.path;
      if (!embyPath) continue;

      const pathPart = embyPath.split("/").pop();
      const diskInfo = diskShows[pathPart];
      if (!diskInfo) continue;

      const newDate = diskInfo ? diskInfo[0] : null;
      const newSize = diskInfo ? diskInfo[1] : 0;
      const newNoFiles = !diskInfo;

      // Check if disk data changed
      const changed =
        tvdbRecord.disk?.date !== newDate ||
        tvdbRecord.disk?.size !== newSize ||
        tvdbRecord.disk?.noFiles !== newNoFiles;

      if (changed) {
        tvdbRecord.disk = tvdbRecord.disk || {};
        tvdbRecord.disk.date = newDate;
        tvdbRecord.disk.size = newSize;
        tvdbRecord.disk.noFiles = newNoFiles;
        tvdbRecord.sync = tvdbRecord.sync || {};
        tvdbRecord.sync.lastDiskCheck = now;
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      await tvdb.saveTvdbSync();
      console.log(`[Phase 3] syncDiskData: Updated ${updatedCount} shows`);
    } else {
      console.log("[Phase 3] syncDiskData: No changes detected");
    }
  } catch (err) {
    console.error("[Phase 3] syncDiskData error:", err.message);
  }
}

// Phase 3: Set up sync timers
const EMBY_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DISK_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour

setInterval(syncEmbyUserData, EMBY_SYNC_INTERVAL);
setInterval(syncDiskData, DISK_SYNC_INTERVAL);

// Run initial syncs after startup delay
setTimeout(syncEmbyUserData, 2 * 60 * 1000); // 2 minutes after start
setTimeout(syncDiskData, 3 * 60 * 1000); // 3 minutes after start

setInterval(runUsbCheck, CHECK_INTERVAL_MS);
// Run initial check after 1 minute (allow startup)
setTimeout(runUsbCheck, 60 * 1000);
