import fs from "fs";
import fsp from "fs/promises";
import * as cp from "child_process";
import * as path from "node:path";
import express from "express";
import cors from "cors";
import https from "https";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { rimraf } from "rimraf";
import * as view from "./src/lastViewed.js";
import * as utilNode from "util";
import * as emby from "./src/emby.js";
import * as tvdb from "./src/tvdb.js";
import * as util from "./src/util.js";
import * as email from "./src/email.js";
import * as tmdb from "./src/tmdb.js";
import { handleFix } from "./src/fix.js";
import { handleEmb } from "./src/emb.js";
import fetch from "node-fetch";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import {
  parseFileSeasonEpisode,
  smartTitleMatch,
  parseTitleFromFilename,
  normalizeVideoHeightToQuality,
  getResolution,
  STANDARD_RESOLUTIONS,
} from "@tv/share";
import * as epd from "@tv/share";
import { unilog, logHere } from "@tv/share";
import chokidar from "chokidar";
import cron from "node-cron";
import {
  SRVR_ROOT_DIR,
  SRVR_DATA_DIR,
  SRVR_SECRETS_DIR,
} from "./src/srvrPaths.js";
import * as groupCounts from "./src/groupCounts.js";
import * as urls from "./src/urls.js";
import * as unilogDb from "./src/unilogDb.js";

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

const CONFIG_DIR = path.join(SRVR_ROOT_DIR, "config");
const SECRETS_DIR = SRVR_SECRETS_DIR;
const FLEXGET_HISTORY_PATH = path.join(SRVR_DATA_DIR, "flexget-history.json");
const BAD_GROUPS_PATH = path.join(SRVR_DATA_DIR, "badGroups.txt");
const QBT_CRED_PATH_FLEX = path.join(
  path.dirname(SRVR_ROOT_DIR),
  "api",
  "secrets",
  "qbt-cred.txt",
);
const FLEXGET_CMD = "/root/.local/bin/flexget";
const FLEXGET_CONFIG = path.join(SRVR_ROOT_DIR, "config", "config.yml");

let flexgetIsRunning = false;

function runFfprobe(args, maxBuffer = 2 * 1024 * 1024) {
  return cp.execFileSync("ffprobe", args, {
    maxBuffer,
    encoding: "utf8",
  });
}

function readBadGroupsFromDisk() {
  return fs
    .readFileSync(BAD_GROUPS_PATH, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
}

function syncBadGroupsFromDisk() {
  badGroups.clear();
  for (const group of readBadGroupsFromDisk()) badGroups.add(group);
  return [...badGroups].sort();
}

function writeBadGroupsToDisk(groups) {
  const list = [
    ...new Set(
      groups.map((group) => String(group).trim().toLowerCase()).filter(Boolean),
    ),
  ].sort();
  fs.writeFileSync(
    BAD_GROUPS_PATH,
    list.length ? `${list.join("\n")}\n` : "",
    "utf8",
  );
  badGroups.clear();
  for (const group of list) badGroups.add(group);
  return list;
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    unilog(504, `FATAL: cannot create dir: ${dir}`, e?.message || e);
    process.exit(1);
  }
}

function ensureFile(filePath, defaultStr) {
  try {
    if (fs.existsSync(filePath)) return;
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, defaultStr, "utf8");
  } catch (e) {
    unilog(
      505,
      `FATAL: cannot create required file: ${filePath}`,
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
const SUB_QUEUE_PATH = "/root/dev/apps/tv/apps/asr/data/subQueue.json";
const SUB_QUEUE_CHKSRT_PATH =
  "/root/dev/apps/tv/apps/asr/data/subQueueChkSrt.json";
const ASR_QUEUE_PATH = "/root/dev/apps/tv/apps/asr/data/asrQueue.json";
const SUBTITLE_LOG_PATH = "/root/dev/apps/tv/apps/asr/data/subtitle.log";
const SUBTITLE_LOG_DIR = "/root/dev/apps/tv/apps/asr/data/subtitle-logs/";
const ASR_JS_PATH = "/root/dev/apps/tv/apps/asr/asr.js";
const CHKSRT_HISTORY_PATH = path.join(SRVR_DATA_DIR, "chksrt-history.json");
const CHKSRT_SNOOZED_PATH = path.join(SRVR_DATA_DIR, "chksrt-snoozed.json");
const OPN_CHECK_HISTORY_PATH = path.join(
  SRVR_DATA_DIR,
  "opn-check-history.json",
);
const OPN_DAILY_LIMIT = 500;
const ASR_LOG_BUFFER_MAX = 500;
// .bif sidecar generation (see make-bifs-plan.md)
const BIF_NEEDED_QUEUE_PATH = path.join(SRVR_DATA_DIR, "bifNeededQueue.json");
const BIF_CREATING_PATH = path.join(SRVR_DATA_DIR, "bifCreatingData.json");
const RUN_BIF_PATH = path.join(SRVR_ROOT_DIR, "scripts", "run-bif.js");
// GLOBAL-MSG: Bif — show name cropped to 10 chars, append "..." when cropped.
const cropName = (name) => {
  const s = String(name || "");
  return s.length > 20 ? s.slice(0, 20) + "..." : s;
};
let bifNeededQueue = []; // [{ showName, bifPath }, ...] persisted
let bifCheckTimer = null; // single backoff timer handle
let subQueue = [],
  subQueueChkSrt = [],
  asrQueue = [];
let chksrtHistory = [];
let chksrtSnoozed = {};
let opnCheckHistory = {};
let opnDailyCount = 0;
let opnDailyCountDate = "";
let subQueueBusy = false,
  chkSubQueueDelay = 10_000,
  asrQueueDelay = 10_000;
let currentlyProcessingSubPath = null;
let genSrtRunning = false,
  genSrtChild = null,
  subQueuePendingNow = false;
let asrLogBuffer = [];

// Batch ffmpeg/jobs run under SCHED_IDLE (`chrt -i 0`) + idle I/O class
// (`ionice -c 3`). SCHED_IDLE means the kernel only gives them CPU when no
// normal-priority task wants it, so Emby transcodes and live streaming (both
// normal priority) run at full speed and instantly preempt batch work — while
// batch still uses every idle core to finish fast. This is why CPU load average
// is not a useful health signal; PSI `full` pressure is (see pollGlobalMessages).
const BATCH_SCHED = ["chrt", "-i", "0", "ionice", "-c", "3"];

// Single queue for all batch ffmpeg jobs (subtitle extraction, re-encode, BIF).
// Video streaming is managed separately.
const ffmpegQueue = (() => {
  let tail = Promise.resolve();
  let _pending = 0;
  function run(fn) {
    _pending++;
    const next = tail.then(() => fn()).finally(() => _pending--);
    tail = next.catch(() => {});
    return next;
  }
  // pending includes the currently-running job
  return {
    run,
    get pending() {
      return _pending;
    },
  };
})();
// Total batch jobs pending across all three queues combined.
// Format a batch hdrMsg label: code + (N) when queue > 1 + show name.
function batchLabel(code, showName, n) {
  const prefix = n > 1 ? `${code}(${n})` : code;
  return `${prefix}: ${cropName(showName)}`;
}

// Track current BIF show name since the entry is shifted before onDone fires.
let _currentBifShowName = null;

// Refresh all four batch hdrMsg entries from live queue state.
// Call this whenever any batch queue changes so every pending type is visible.
function syncBatchMsgs() {
  // Reencode (E)
  if (reencodeQueue.length > 0) {
    const e = reencodeQueue[0];
    const se = `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`;
    setGlobalMessage({
      id: "Reencode",
      text: batchLabel(
        "E",
        `${cropName(e.showName)} ${se}`,
        reencodeQueue.length,
      ),
      position: 2003,
    });
  } else {
    setGlobalMessage({ id: "Reencode", action: "hide" });
  }
  // EmbSub (>)
  const embCount = subQueue.length + (subQueueBusy ? 1 : 0);
  if (embCount > 0) {
    const name = subQueueBusy
      ? showNameFromFilePath(currentlyProcessingSubPath || "")
      : showNameFromFilePath(subQueue[0]?.videoFilePath || "");
    setGlobalMessage({
      id: "EmbSub",
      text: batchLabel(">", name, embCount),
      position: 2004,
    });
  } else {
    setGlobalMessage({ id: "EmbSub", action: "hide" });
  }
  // BIF (B)
  const bifCount = bifNeededQueue.length + (_currentBifShowName ? 1 : 0);
  if (bifCount > 0) {
    const name = _currentBifShowName || bifNeededQueue[0]?.showName || "";
    setGlobalMessage({
      id: "Bif",
      text: batchLabel("B", name, bifCount),
      position: 2002,
    });
  } else {
    setGlobalMessage({ id: "Bif", action: "hide" });
  }
  // ASR (+)
  if (asrQueue.length > 0) {
    const name = showNameFromFilePath(asrQueue[0]?.videoPath || "");
    setGlobalMessage({
      id: "Asr",
      text: batchLabel("+", name, asrQueue.length),
      position: 2005,
    });
  } else {
    setGlobalMessage({ id: "Asr", action: "hide" });
  }
}

// Counters for active real-time streaming ffmpegs — shown in hdrMsg.
let _activeVideoStreams = 0;
let _activeSubStreams = 0;
function _updateStreamMsg() {
  if (_activeVideoStreams > 0)
    setGlobalMessage({
      id: "Stream",
      text: _activeVideoStreams > 1 ? `V(${_activeVideoStreams})` : "V",
      position: 2000,
    });
  else setGlobalMessage({ id: "Stream", action: "hide" });
  if (_activeSubStreams > 0)
    setGlobalMessage({
      id: "SubStream",
      text: _activeSubStreams > 1 ? `S(${_activeSubStreams})` : "S",
      position: 2001,
    });
  else setGlobalMessage({ id: "SubStream", action: "hide" });
}
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
const pickupLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config4-pickups.json"),
  "[]",
);
const footerLoad = readTextOrWithChosenPath(
  configReadCandidates("config/config5-footer.txt"),
  "",
);

const headerStr = headerLoad.text;
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

let pickups;
try {
  pickups = JSON.parse(pickupStr);
  if (!Array.isArray(pickups)) {
    throw new Error("pickups config is not an array");
  }
} catch (e) {
  unilog(
    506,
    `FATAL: invalid JSON in pickups config at ${pickupLoad.chosenPath || "<fallback>"}: ${e.message}`,
  );
  process.exit(1);
}

// Load flexget-history.json at startup — create empty {} if missing (first run).
let flexgetHistory = {};
try {
  const histText = fs.readFileSync(FLEXGET_HISTORY_PATH, "utf8");
  flexgetHistory = JSON.parse(histText);
} catch (e) {
  if (e.code !== "ENOENT") {
    unilog(507, `FATAL: flexget-history.json parse error: ${e.message}`);
    process.exit(1);
  }
}

function encodeFileIdBase32(fileId) {
  // base-32 using RFC4648 alphabet: A-Z then 2-7.
  // Output is always exactly 5 chars, left-padded with 'A' (the zero char).
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
  out = out.padStart(5, "A");
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
    parsedPtt = parseTorrentTitle(base.replace(/\.[a-z0-9]{2,4}$/i, ""));
  } catch {}
  try {
    if (folderName)
      parsedPttFolder = parseTorrentTitle(
        String(folderName).replace(/\.[a-z0-9]{2,4}$/i, ""),
      );
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

function persistSubQueue() {
  fs.writeFileSync(SUB_QUEUE_PATH, JSON.stringify(subQueue), "utf8");
}
function persistSubQueueChkSrt() {
  fs.writeFileSync(
    SUB_QUEUE_CHKSRT_PATH,
    JSON.stringify(subQueueChkSrt),
    "utf8",
  );
}
function cleanChkSrtQueue() {
  const before = subQueueChkSrt.length;
  subQueueChkSrt = subQueueChkSrt.filter(
    (e) => e?.videoFilePath && fs.existsSync(e.videoFilePath),
  );
  if (subQueueChkSrt.length !== before) {
    unilog(
      508,
      `cleaned ${before - subQueueChkSrt.length} missing file(s) from queue`,
    );
    persistSubQueueChkSrt();
  }
}
function persistSubQueueGenSrt() {
  fs.writeFileSync(
    "/root/dev/apps/tv/apps/asr/data/subQueueGenSrt.json",
    JSON.stringify([]),
    "utf8",
  );
}
function persistAsrQueue() {
  fs.writeFileSync(ASR_QUEUE_PATH, JSON.stringify(asrQueue), "utf8");
}
function appendAsrLog(line) {
  asrLogBuffer.push(line);
  if (asrLogBuffer.length > ASR_LOG_BUFFER_MAX) {
    asrLogBuffer = asrLogBuffer.slice(-ASR_LOG_BUFFER_MAX);
  }
  notifyClients("asr-log", line);
}
function addToAsrQueue(entries) {
  let added = 0;
  for (const entry of entries) {
    if (!asrQueue.some((e) => e.videoPath === entry.videoPath)) {
      asrQueue.push(entry);
      added++;
    }
  }
  if (added > 0) {
    persistAsrQueue();
    notifyClients("asr-queue-update", {
      count: asrQueue.length,
      running: genSrtRunning,
    });
    syncBatchMsgs();
    asrQueueDelay = 500;
  }
}
function enqueueSubQueue(entry, toFront) {
  if (currentlyProcessingSubPath === entry.videoFilePath) return;
  const idx = subQueue.findIndex(
    (e) => e.videoFilePath === entry.videoFilePath,
  );
  if (idx !== -1) {
    const existing = subQueue[idx];
    if (!entry.lowPriority && existing.lowPriority) {
      subQueue.splice(idx, 1);
      subQueue.unshift({
        ...existing,
        lowPriority: false,
        fromUI: entry.fromUI ?? existing.fromUI,
      });
    }
    return;
  }
  if (toFront) subQueue.unshift(entry);
  else subQueue.push(entry);
  syncBatchMsgs();
}
function enqueueSubQueueChkSrt(entry, toFront) {
  const idx = subQueueChkSrt.findIndex(
    (e) => e.videoFilePath === entry.videoFilePath,
  );
  if (idx !== -1) {
    const existing = subQueueChkSrt[idx];
    if (!entry.lowPriority && existing.lowPriority) {
      subQueueChkSrt.splice(idx, 1);
      subQueueChkSrt.unshift({
        ...existing,
        lowPriority: false,
        fromUI: entry.fromUI ?? existing.fromUI,
      });
    }
    return;
  }
  if (toFront) subQueueChkSrt.unshift(entry);
  else subQueueChkSrt.push(entry);
  const showName = showNameFromFilePath(entry.videoFilePath);
  if (removeFromChksrtSnoozed(showName, entry.videoFilePath)) {
    persistChksrtSnoozed();
  }
}
function loadQueues() {
  try {
    subQueue = JSON.parse(fs.readFileSync(SUB_QUEUE_PATH, "utf8"));
  } catch {
    subQueue = [];
  }
  try {
    subQueueChkSrt = JSON.parse(fs.readFileSync(SUB_QUEUE_CHKSRT_PATH, "utf8"));
  } catch {
    subQueueChkSrt = [];
  }
  try {
    asrQueue = JSON.parse(fs.readFileSync(ASR_QUEUE_PATH, "utf8"));
  } catch {
    asrQueue = [];
  }
}

// ----------------------------------------------------------------------------
// .bif sidecar generation queue (see make-bifs-plan.md)
// ----------------------------------------------------------------------------
function loadBifNeededQueue() {
  try {
    const raw = JSON.parse(fs.readFileSync(BIF_NEEDED_QUEUE_PATH, "utf8"));
    bifNeededQueue = Array.isArray(raw) ? raw : [];
  } catch {
    bifNeededQueue = [];
  }
}
function persistBifNeededQueue() {
  try {
    fs.writeFileSync(
      BIF_NEEDED_QUEUE_PATH,
      JSON.stringify(bifNeededQueue),
      "utf8",
    );
  } catch (e) {
    unilog(509, "persist queue error:", e.message);
  }
}

// True when a pid is still alive (signal 0 probes without killing).
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists but not ours
  }
}

// Read the creating-lock file, or null when absent/invalid.
function readBifCreating() {
  try {
    return JSON.parse(fs.readFileSync(BIF_CREATING_PATH, "utf8"));
  } catch {
    return null;
  }
}

// Schedule a single (non-stacking) checkBifNeededQueue call.
function scheduleBifCheck(ms) {
  if (bifCheckTimer) clearTimeout(bifCheckTimer);
  bifCheckTimer = setTimeout(() => {
    bifCheckTimer = null;
    checkBifNeededQueue();
  }, ms);
}

// Pull the next bif spec off the queue and start generating it, with CPU
// backoff and one-at-a-time serialization.
function checkBifNeededQueue() {
  if (bifNeededQueue.length === 0) return;
  const started = startBifCreate(bifNeededQueue[0]);
  if (!started) {
    scheduleBifCheck(5000);
    return;
  }
  bifNeededQueue.shift();
  persistBifNeededQueue();
  setImmediate(checkBifNeededQueue);
}

// Launch a background worker process that generates the .bif file. Returns
// true when a worker was launched, false when one is already running.
function startBifCreate(bifNeededObj) {
  const lock = readBifCreating();
  if (lock) {
    // Clear a stale lock left by a dead worker; otherwise honor it.
    if (pidAlive(lock.pid)) return false;
    unilog(3, `clearing stale lock (pid ${lock.pid} dead)`);
    try {
      fs.unlinkSync(BIF_CREATING_PATH);
    } catch {}
  }
  let child;
  try {
    child = cp.spawn(
      BATCH_SCHED[0],
      [...BATCH_SCHED.slice(1), "node", RUN_BIF_PATH, bifNeededObj.bifPath],
      {
        detached: true, // own process group so cancel can kill ffmpeg too
        stdio: "ignore",
      },
    );
  } catch (e) {
    unilog(510, "spawn error:", e.message);
    return false;
  }
  try {
    fs.writeFileSync(
      BIF_CREATING_PATH,
      JSON.stringify({
        showName: bifNeededObj.showName,
        pid: child.pid,
        bifPath: bifNeededObj.bifPath,
      }),
      "utf8",
    );
  } catch (e) {
    unilog(511, "lock write error:", e.message);
  }
  _currentBifShowName = bifNeededObj.showName;
  syncBatchMsgs();
  // Hold the batch ffmpeg queue for the duration of the BIF child process so
  // BIF and other batch ffmpeg jobs (subtitle extraction, re-encode) never
  // run concurrently.
  ffmpegQueue.run(
    () =>
      new Promise((resolve) => {
        const onDone = () => {
          try {
            fs.unlinkSync(BIF_CREATING_PATH);
          } catch {}
          unilog(4, `done ${bifNeededObj.showName}`);
          _currentBifShowName = null;
          syncBatchMsgs();
          checkBifNeededQueue();
          resolve();
        };
        child.on("exit", onDone);
        child.on("error", (e) => {
          unilog(512, `worker error ${bifNeededObj.showName}:`, e.message);
          onDone();
        });
      }),
  );
  child.unref();
  return true;
}

// Abort an in-flight bif generation for a show (and clear its lock).
function cancelBifCreate(showName) {
  const lock = readBifCreating();
  if (!lock || lock.showName !== showName) return;
  try {
    process.kill(-lock.pid, "SIGTERM"); // kill the whole process group
  } catch {
    try {
      process.kill(lock.pid, "SIGTERM");
    } catch {}
  }
  try {
    fs.unlinkSync(BIF_CREATING_PATH);
  } catch {}
  unilog(5, `cancel ${showName} pid=${lock.pid}`);
  _currentBifShowName = null;
  syncBatchMsgs();
}

// React to a show's needsIntro flipping. On true: maybe queue a bif. On false:
// cancel any in-flight/queued bif for the show.
function handleNeedsIntroChange(showName, rec, needsIntro) {
  if (needsIntro) {
    // A .bif already exists somewhere in the show folder.
    if (epd.getBifEpisode(rec.episodeData) !== null) return;
    // Need at least one unwatched episode.
    let hasUnwatched = false;
    epd.forEachEpisode(rec.episodeData, (s, e) => {
      if (!epd.isWatched(rec.episodeData, s, e)) hasUnwatched = true;
    });
    if (!hasUnwatched) return;
    // Need at least one video file; capture the first file's path as bifPath.
    const fileSeasons = epd.seasonsWithFile(rec.episodeData);
    if (fileSeasons.length === 0) return;
    const showFolderName = showName.includes("/")
      ? showName
      : (rec.path || rec.emby?.path || showName).split("/").pop();
    let bifPath = null;
    for (const s of fileSeasons) {
      const season = rec.episodeData[s];
      for (let i = 0; i < season.length; i++) {
        if (epd.hasFile(rec.episodeData, s, i + 1)) {
          bifPath = epd.getFullPath(rec.episodeData, showFolderName, s, i + 1);
          break;
        }
      }
      if (bifPath) break;
    }
    if (!bifPath) return;
    // Dedupe: skip if this show is already queued.
    if (bifNeededQueue.some((o) => o.showName === showName)) return;
    bifNeededQueue.push({ showName, bifPath });
    persistBifNeededQueue();
    unilog(6, `queued ${showName} ${bifPath}`);
    syncBatchMsgs();
    checkBifNeededQueue();
  } else {
    cancelBifCreate(showName);
    const before = bifNeededQueue.length;
    bifNeededQueue = bifNeededQueue.filter((o) => o.showName !== showName);
    if (bifNeededQueue.length !== before) {
      persistBifNeededQueue();
      checkBifNeededQueue();
    }
  }
}

function loadChksrtHistory() {
  try {
    const raw = JSON.parse(fs.readFileSync(CHKSRT_HISTORY_PATH, "utf8"));
    chksrtHistory = Array.isArray(raw) ? raw : [];
  } catch {
    chksrtHistory = [];
  }
}
function persistChksrtHistory() {
  try {
    fs.writeFileSync(
      CHKSRT_HISTORY_PATH,
      JSON.stringify(chksrtHistory),
      "utf8",
    );
  } catch (e) {
    unilog(513, "persist error:", e.message);
  }
}
const CHKSRT_SNOOZE_MS = 24 * 60 * 60 * 1000;
function loadChksrtSnoozed() {
  try {
    const raw = JSON.parse(fs.readFileSync(CHKSRT_SNOOZED_PATH, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      // normalize legacy string entries to {videoFilePath, snoozedAt}
      for (const [show, entries] of Object.entries(raw)) {
        if (Array.isArray(entries)) {
          raw[show] = entries.map((e) =>
            typeof e === "string" ? { videoFilePath: e, snoozedAt: 0 } : e,
          );
        }
      }
      chksrtSnoozed = raw;
    } else {
      chksrtSnoozed = {};
    }
  } catch {
    chksrtSnoozed = {};
  }
}
function persistChksrtSnoozed() {
  try {
    fs.writeFileSync(
      CHKSRT_SNOOZED_PATH,
      JSON.stringify(chksrtSnoozed),
      "utf8",
    );
  } catch (e) {
    unilog(514, "persist error:", e.message);
  }
}
function getChksrtSnoozedForShow(showName) {
  const entries = chksrtSnoozed?.[showName];
  return Array.isArray(entries) ? entries : [];
}
function addToChksrtSnoozed(showName, videoFilePath) {
  const current = getChksrtSnoozedForShow(showName);
  if (current.some((e) => e.videoFilePath === videoFilePath)) return false;
  chksrtSnoozed[showName] = [
    ...current,
    { videoFilePath, snoozedAt: Date.now() },
  ];
  return true;
}
function removeFromChksrtSnoozed(showName, videoFilePath) {
  const current = getChksrtSnoozedForShow(showName);
  if (!current.length) return false;
  const next = current.filter((entry) => entry.videoFilePath !== videoFilePath);
  if (next.length === current.length) return false;
  if (next.length > 0) chksrtSnoozed[showName] = next;
  else delete chksrtSnoozed[showName];
  return true;
}
function loadOpnCheckHistory() {
  try {
    const raw = JSON.parse(fs.readFileSync(OPN_CHECK_HISTORY_PATH, "utf8"));
    opnCheckHistory =
      raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    opnCheckHistory = {};
  }
}
function persistOpnCheckHistory() {
  try {
    fs.writeFileSync(
      OPN_CHECK_HISTORY_PATH,
      JSON.stringify(opnCheckHistory),
      "utf8",
    );
  } catch (e) {
    unilog(515, "persist error:", e.message);
  }
}
function logSubtitle(msg) {
  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const ts = now
    .replace(/(\d+)\/(\d+),\s*/, "$1-$2 ")
    .replace(/24:(\d+)/, "00:$1");
  fs.appendFileSync(SUBTITLE_LOG_PATH, ts + " " + msg + "\n", "utf8");
}
async function fileNeedsSubChecked(videoFilePath, showName) {
  if (subQueue.some((e) => e.videoFilePath === videoFilePath)) return false;
  if (subQueueChkSrt.some((e) => e.videoFilePath === videoFilePath))
    return false;
  if (asrQueue.some((e) => e.videoPath === videoFilePath)) return false;
  // A 1080 resolution-fallback file inherits the 2160's subtitles (they are
  // copied at generation), so it is never sub-checked / extracted on its own.
  if (/1080p/i.test(path.basename(videoFilePath))) {
    const parsedRes = parseFileSeasonEpisode(videoFilePath);
    if (parsedRes?.season != null && parsedRes?.episode != null) {
      const sibs = resFindEpisodeVideos(
        path.dirname(videoFilePath),
        parsedRes.season,
        parsedRes.episode,
      );
      if (sibs.some((v) => v.res === 2160)) return false;
    }
  }
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const dir = path.dirname(videoFilePath);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  const basename = path.basename(base);
  if (
    entries.some(
      (f) =>
        f === basename + ".mb.chosen" ||
        (f.startsWith(basename + ".") && f.endsWith(".srt")),
    )
  )
    return false;
  const tvdbAll = tvdb.getAllTvdbSync?.();
  if (!tvdbAll) return true;
  const tvdbRec = tvdbAll[showName];
  if (!tvdbRec) return true;
  const parsed = parseFileSeasonEpisode(videoFilePath);
  if (!parsed) return true;
  const key = `S${String(parsed.season).padStart(2, "0")}E${String(parsed.episode).padStart(2, "0")}`;
  if (epd.isWatched(tvdbRec.episodeData, parsed.season, parsed.episode))
    return false;
  if (tvdbRec.seriesMap) {
    const ep = tvdbRec.seriesMap[key];
    if (ep && ep.aired && new Date(ep.aired) > new Date()) return false;
  }
  return true;
}
function stripSrtFormatting(srt) {
  return srt
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\h/g, " ")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n");
}

function parseSrtTimeMs(t) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
  if (!m) return 0;
  return (
    parseInt(m[1]) * 3600000 +
    parseInt(m[2]) * 60000 +
    parseInt(m[3]) * 1000 +
    parseInt(m[4])
  );
}
function formatSrtTimeMs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(mm).padStart(3, "0")}`;
}
function parseSrt(srt) {
  const entries = [];
  const blocks = srt.trim().split(/\r?\n\r?\n+/);
  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    const timeLine = lines.find((l) => /-->/.test(l));
    if (!timeLine) continue;
    const tm = /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/.exec(
      timeLine,
    );
    if (!tm) continue;
    const startMs = parseSrtTimeMs(tm[1]);
    const endMs = parseSrtTimeMs(tm[2]);
    const timeIdx = lines.indexOf(timeLine);
    const text = lines
      .slice(timeIdx + 1)
      .join("\n")
      .trim();
    if (!text) continue;
    entries.push({ startMs, endMs, text });
  }
  return entries;
}
function serializeSrt(entries) {
  return (
    entries
      .map(
        (e, i) =>
          `${i + 1}\n${formatSrtTimeMs(e.startMs)} --> ${formatSrtTimeMs(e.endMs)}\n${e.text}`,
      )
      .join("\n\n") + "\n"
  );
}
// Fix "rolling/scrolling" subtitle format that causes on-screen flashing.
// Pattern: the same text appears in back-to-back entries with a tiny gap, and
// short (<250 ms) transitional entries carry one line from the previous cue
// and one from the next. Emby renders each entry independently so the 40 ms
// gap causes a visible blink.
function derollSrt(entries) {
  if (entries.length === 0) return entries;

  // Pass 1: merge consecutive identical-text entries where the gap is < 250 ms.
  let merged = [];
  let cur = { ...entries[0] };
  for (let i = 1; i < entries.length; i++) {
    const next = entries[i];
    if (next.text === cur.text && next.startMs - cur.endMs < 250) {
      cur = { ...cur, endMs: next.endMs };
    } else {
      merged.push(cur);
      cur = { ...next };
    }
  }
  merged.push(cur);

  // Detect rolling format: >15 % of merged entries are very short (<250 ms).
  const shortCount = merged.filter((e) => e.endMs - e.startMs < 250).length;
  if (shortCount < 3 || shortCount / merged.length <= 0.15) return merged;

  // Pass 2: remove short (<250 ms) transitional entries that share at least one
  // text line with an immediately adjacent entry (gap < 500 ms on either side).
  const result = [];
  for (let i = 0; i < merged.length; i++) {
    const e = merged[i];
    if (e.endMs - e.startMs >= 250) {
      result.push(e);
      continue;
    }
    const eLines = new Set(
      e.text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const prevGap = i > 0 ? e.startMs - merged[i - 1].endMs : Infinity;
    const nextGap =
      i < merged.length - 1 ? merged[i + 1].startMs - e.endMs : Infinity;

    let shared = false;
    if (prevGap < 500 && i > 0) {
      const prevLines = merged[i - 1].text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (prevLines.some((l) => eLines.has(l))) shared = true;
    }
    if (!shared && nextGap < 500 && i < merged.length - 1) {
      const nextLines = merged[i + 1].text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (nextLines.some((l) => eLines.has(l))) shared = true;
    }
    if (!shared) result.push(e);
  }
  return result;
}
// Returns sanitized SRT string if anything changed, null if unchanged.
function sanitizeSrt(raw) {
  const stripped = stripSrtFormatting(raw);
  const entries = parseSrt(stripped);
  // Sort by start time to fix out-of-order entries from embedded extraction
  const sorted = [...entries].sort((a, b) => a.startMs - b.startMs);
  // Merge entries with identical timestamps (two cues at same time → one entry)
  const merged = [];
  for (const e of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && prev.startMs === e.startMs && prev.endMs === e.endMs) {
      prev.text = prev.text + "\n" + e.text;
    } else {
      merged.push({ ...e });
    }
  }
  const reordered = sorted.some((e, i) => e !== entries[i]);
  const changed =
    reordered || merged.length !== entries.length || stripped !== raw;
  const derolled = derollSrt(merged);
  if (changed || derolled.length !== merged.length) {
    return serializeSrt(derolled);
  }
  return null;
}

async function generateEmbSrts(
  videoFilePath,
  showname,
  season,
  episode,
  fromUI,
) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  syncBatchMsgs();
  let probeStreams = [];
  await new Promise((resolve) => {
    cp.execFile(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", videoFilePath],
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (!err) {
          try {
            probeStreams = JSON.parse(stdout).streams || [];
          } catch {}
        }
        resolve();
      },
    );
  });
  const subStreams = probeStreams.filter((s) => s.codec_type === "subtitle");
  const textCodecs = [
    "subrip",
    "ass",
    "ssa",
    "webvtt",
    "mov_text",
    "text",
    "srt",
  ];
  const textStreams = subStreams.filter((s) => {
    const lang = (s.tags?.language || "").toLowerCase();
    return (
      (lang === "eng" || lang === "en" || lang === "") &&
      textCodecs.includes(s.codec_name)
    );
  });
  for (const s of textStreams) {
    const outPath = `${base}.mb${s.index}.srt`;
    if (fs.existsSync(outPath)) {
      if (fromUI) notifyClients("emb-log", `exists: ${path.basename(outPath)}`);
      continue;
    }
    await ffmpegQueue.run(
      () =>
        new Promise((resolve) => {
          cp.execFile(
            BATCH_SCHED[0],
            [
              ...BATCH_SCHED.slice(1),
              "ffmpeg",
              "-v",
              "quiet",
              "-i",
              videoFilePath,
              "-map",
              `0:${s.index}`,
              "-c:s",
              "srt",
              "-f",
              "srt",
              "pipe:1",
            ],
            { maxBuffer: 4 * 1024 * 1024 },
            (err, stdout) => {
              if (!err && stdout) {
                const sanitized = sanitizeSrt(stdout);
                if (sanitized !== null) {
                  fs.writeFileSync(outPath, sanitized, "utf8");
                  if (fromUI) notifyClients("emb-log", `extracted ${outPath}`);
                } else {
                  const fname = path.basename(outPath);
                  if (fromUI) notifyClients("emb-log", `No change: ${fname}`);
                }
              }
              resolve();
            },
          );
        }),
    );
  }
  const hasNonText = subStreams.some((s) => !textCodecs.includes(s.codec_name));
  const pgsOnly = hasNonText && textStreams.length === 0;
  const hasEmbText = textStreams.length > 0;
  syncBatchMsgs();
  return { pgsOnly, hasEmbText };
}
async function applyOpenSubSrts(videoFilePath, showname, season, episode) {
  const moviesDir = "/mnt/media/movies";
  const isMovie = videoFilePath.startsWith(moviesDir + "/");
  let results;
  if (isMovie) {
    const filename = path.basename(videoFilePath, path.extname(videoFilePath));
    const yearMatch = filename.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : null;
    const title = yearMatch
      ? filename.slice(0, yearMatch.index).replace(/\./g, " ").trim()
      : filename.replace(/\./g, " ");
    try {
      results = await subsSearch({ query: title, year });
    } catch (e) {
      unilog(7, `opensubs search err: ${e.message}`);
      return;
    }
  } else {
    const tvdbAll = tvdb.getAllTvdbSync?.();
    if (!tvdbAll) return;
    const tvdbRec = tvdbAll[showname];
    if (!tvdbRec?.imdbId) {
      unilog(8, `opensubs skip no imdb: ${videoFilePath}`);
      return;
    }
    try {
      results = await subsSearch({
        imdb_id: tvdbRec.imdbId,
        season,
        episode,
      });
    } catch (e) {
      unilog(9, `opensubs search err: ${e.message}`);
      return;
    }
  }
  const items = Array.isArray(results?.data) ? results.data : [];
  if (items.length === 0) {
    unilog(10, `opensubs no results: ${path.basename(videoFilePath)}`);
    return;
  }
  unilog(
    516,
    `opensubs ${items.length} results: ${path.basename(videoFilePath)}`,
  );
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const opnDir = path.dirname(videoFilePath);
  const opnBasename = path.basename(base);
  let existingOpnCount = 0;
  try {
    existingOpnCount = fs
      .readdirSync(opnDir)
      .filter(
        (f) =>
          f.startsWith(opnBasename) &&
          /^\.opn[A-Z2-7]{5}\.srt$/i.test(f.slice(opnBasename.length)),
      ).length;
  } catch {}
  if (existingOpnCount >= 5) return;
  let dlCount = 0;
  for (const r of items) {
    if (existingOpnCount + dlCount >= 5) break;
    const fid = r.file_id || r.attributes?.files?.[0]?.file_id;
    if (!fid) continue;
    const tag = "opn" + encodeFileIdBase32(fid).slice(1);
    const outPath = `${base}.${tag}.srt`;
    if (fs.existsSync(outPath)) continue;
    try {
      const login = loadSubsLogin();
      let dl = await openSubtitlesDownloadWithRetry({
        apiKey: login.apiKey,
        token: subsTokenCache,
        fileId: fid,
      });
      if (!dl?.resp?.ok) continue;
      const url = typeof dl.body?.link === "string" ? dl.body.link.trim() : "";
      if (!url) continue;
      const resp = await fetch(url, { headers: { Accept: "*/*" } });
      if (!resp.ok) continue;
      const txt = await resp.text();
      await fs.promises.writeFile(outPath, stripSrtFormatting(txt), "utf8");
      dlCount++;
      // TEMP: log api filename for release matching
    } catch (e) {
      unilog(11, `opensubs dl err ${fid}: ${e.message}`);
    }
  }
}
async function generateSrtWithAsr(videoFilePath, fromUI) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const srtPath = base + ".asr.srt";
  if (fs.existsSync(srtPath)) {
    asrLogBuffer = [];
    appendAsrLog(
      `=== Skipped: ${path.basename(videoFilePath)} (srt already exists) ===`,
    );
    unilog(12, `asr skip exists: ${videoFilePath}`);
    unilog(13, `skipped (srt exists): ${videoFilePath}`);
    return;
  }
  asrLogBuffer = [];
  appendAsrLog("");
  appendAsrLog(`=== Starting: ${path.basename(videoFilePath)} ===`);
  unilog(14, `asr start: ${videoFilePath}`);
  genSrtRunning = true;
  notifyClients("asr-queue-update", { count: asrQueue.length, running: true });
  syncBatchMsgs();
  try {
    await ffmpegQueue.run(
      () =>
        new Promise((resolve, reject) => {
          const child = cp.spawn(
            BATCH_SCHED[0],
            [...BATCH_SCHED.slice(1), "node", ASR_JS_PATH, videoFilePath],
            {
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          genSrtChild = child;
          child.stdout.on("data", (d) => {
            const line = d.toString().trimEnd();
            unilog(517, line);
            appendAsrLog(line);
          });
          child.stderr.on("data", (d) => {
            const line = d.toString().trimEnd();
            unilog(518, line);
            appendAsrLog(line);
          });
          child.on("close", (code) => {
            genSrtChild = null;
            if (code === 0) resolve();
            else if (code === null) reject(new Error(`__cancelled__`));
            else reject(new Error(`asr.js exited ${code}`));
          });
        }),
    );
    unilog(15, `asr done: ${videoFilePath}`);
    appendAsrLog(`=== Done: ${path.basename(videoFilePath)} ===`);
    if (fromUI)
      notifyClients("subs-progress", {
        path: videoFilePath,
        status: "asr-done",
      });
  } catch (e) {
    unilog(16, `asr error: ${e.message}`);
    if (e.message === "__cancelled__") {
      appendAsrLog(
        `File ${path.basename(videoFilePath)} processing cancelled.`,
      );
    } else {
      appendAsrLog(`=== Error: ${e.message} ===`);
    }
  } finally {
    genSrtRunning = false;
    genSrtChild = null;
    syncBatchMsgs();
    notifyClients("asr-queue-update", {
      count: asrQueue.length,
      running: false,
      entries: asrQueue,
    });
  }
}
function doSubQueueNow() {
  chkSubQueueDelay = 500;
  if (!subQueueBusy) {
    processSubQueueEntry().catch((e) => unilog(519, "error:", e.message));
  } else if (!subQueuePendingNow) {
    subQueuePendingNow = true;
    const poll = () => {
      if (!subQueueBusy) {
        subQueuePendingNow = false;
        processSubQueueEntry().catch((e) => unilog(520, "error:", e.message));
      } else {
        setTimeout(poll, 1000);
      }
    };
    setTimeout(poll, 1000);
  }
}
async function processSubQueueEntry() {
  if (subQueue.length === 0) return;
  const entry = subQueue.shift();
  persistSubQueue();
  subQueueBusy = true;
  currentlyProcessingSubPath = entry.videoFilePath;
  try {
    const parsed = parseFileSeasonEpisode(entry.videoFilePath);
    const showName = showNameFromFilePath(entry.videoFilePath);
    const { pgsOnly, hasEmbText } =
      (await generateEmbSrts(
        entry.videoFilePath,
        showName,
        parsed?.season,
        parsed?.episode,
        entry.fromUI,
      )) || {};
    await sleep(1000);
    await applyOpenSubSrts(
      entry.videoFilePath,
      showName,
      parsed?.season,
      parsed?.episode,
    );
    await sleep(1000);
    const base = entry.videoFilePath.replace(/\.[^.]+$/, "");
    const dir = path.dirname(entry.videoFilePath);
    const basename = path.basename(base);
    let dirEntries;
    try {
      dirEntries = fs.readdirSync(dir);
    } catch {
      dirEntries = [];
    }
    const hasSidecar = dirEntries.some(
      (f) =>
        f === basename + ".mb.chosen" ||
        (f.startsWith(basename + ".") && f.endsWith(".srt")),
    );
    if (!hasSidecar && !pgsOnly && !hasEmbText) {
      addToAsrQueue([
        {
          videoPath: entry.videoFilePath,
          showName,
          season: parsed?.season ?? 0,
          episode: parsed?.episode ?? 0,
          fromUI: entry.fromUI,
          lowPriority: entry.lowPriority,
          source: entry.fromUI ? "ASR pane" : "subtitle pipeline",
          addedAt: Date.now(),
        },
      ]);
    } else {
      enqueueSubQueueChkSrt(
        { videoFilePath: entry.videoFilePath, fromUI: entry.fromUI },
        false,
      );
      cleanChkSrtQueue();
      persistSubQueueChkSrt();
      notifyClients("chksrt-count", subQueueChkSrt.length);
      if (entry.fromUI)
        notifyClients("subs-progress", {
          path: entry.videoFilePath,
          status: "chksrt",
        });
    }
  } finally {
    subQueueBusy = false;
    currentlyProcessingSubPath = null;
    chkSubQueueDelay = 500;
  }
}
function startSubQueueLoop() {
  const loop = async () => {
    if (subQueue.length === 0) {
      chkSubQueueDelay = 10_000;
    } else {
      await processSubQueueEntry().catch((e) => unilog(521, "", e.message));
    }
    setTimeout(loop, chkSubQueueDelay);
  };
  setTimeout(loop, chkSubQueueDelay);
}
function startAsrQueueLoop() {
  const loop = async () => {
    if (!genSrtRunning && asrQueue.length > 0) {
      const entry = asrQueue[0];
      asrQueueDelay = 500;
      generateSrtWithAsr(entry.videoPath, entry.fromUI)
        .catch((e) => unilog(522, "", e.message))
        .finally(() => {
          if (asrQueue[0]?.videoPath === entry.videoPath) {
            asrQueue.shift();
            persistAsrQueue();
            notifyClients("asr-queue-update", {
              count: asrQueue.length,
              running: false,
              entries: asrQueue,
            });
          }
        });
    }
    if (asrQueue.length === 0) asrQueueDelay = 10_000;
    setTimeout(loop, asrQueueDelay);
  };
  setTimeout(loop, asrQueueDelay);
}
cron.schedule(
  "0 5 * * *",
  () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = yesterday.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "2-digit",
      day: "2-digit",
    });
    const mmdd = now.replace("/", "-").replace(/,.*/, "");
    const dest = SUBTITLE_LOG_DIR + "subtitle-" + mmdd + ".log";
    try {
      fs.mkdirSync(SUBTITLE_LOG_DIR, { recursive: true });
      if (fs.existsSync(SUBTITLE_LOG_PATH))
        fs.renameSync(SUBTITLE_LOG_PATH, dest);
      fs.writeFileSync(SUBTITLE_LOG_PATH, "", "utf8");
      unilog(523, "subtitle.log rotated to", dest);
    } catch (e) {
      unilog(524, "log rotate error:", e.message);
    }
  },
  { timezone: "America/Los_Angeles" },
);

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
        unilog(
          525,
          `OpenSubtitles /download HTTP ${status} (file_id=${fileId}, attempt=${attempt}/${maxAttempts})`,
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

const subsCountEpisodes = async (params) => {
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

// Debounced per-show push so rapid tvdb changes coalesce into one notification
const PUSH_DEBOUNCE_MS = 500;
const pendingPushes = new Map();

const debouncedTvdbPush = (name) => {
  if (!name) return;
  if (pendingPushes.has(name)) clearTimeout(pendingPushes.get(name));
  pendingPushes.set(
    name,
    setTimeout(() => {
      pendingPushes.delete(name);
      const record = tvdb.getAllTvdbSync()[name];
      if (record) {
        notifyClients("tvdbUpdated", { name, record });
      }
    }, PUSH_DEBOUNCE_MS),
  );
};

// Set up callbacks so tvdb.js can call back into index.js without circular imports
tvdb.setNotifyCallback((name) => debouncedTvdbPush(name));
tvdb.setEnqueueCallback((name) => notifyClients("showUpdating", { name }));
tvdb.setQueueDrainCallback(() => notifyClients("showQueueEmpty", {}));

// Auto-update pickups when inEmby or status changes on a tvdb record
const handlePickupChange = (name, inEmby, status) => {
  if (inEmby === true) {
    const allTvdbSync = tvdb.getAllTvdbSync();
    const rec = allTvdbSync[name];
    removeFromSnoozeByShow(name, rec?.tvdbId);
  }
  if (inEmby === true && status !== "Ended") {
    // Should be in pickups
    const already = pickups.some((p) => p.toLowerCase() === name.toLowerCase());
    if (!already) {
      unilog(526, "adding:", name);
      addPickup({ name }).catch((err) => unilog(527, "addPickup failed:", err));
    }
  } else {
    // Should not be in pickups
    const idx = pickups.findIndex(
      (p) => p.toLowerCase() === name.toLowerCase(),
    );
    if (idx !== -1) {
      unilog(528, "removing:", name);
      delPickup({ name }).catch((err) => unilog(529, "delPickup failed:", err));
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

      unilog(
        530,
        `${showName} S${seasonNumber}: renaming ${compactFileEps.length} compact-NNN files`,
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
          unilog(531, `Renamed: ${filename} → ${newFilename}`);
          anyFixed = true;
        } catch (e) {
          unilog(532, `Rename failed for ${oldPath}:`, e.message);
        }
      }
    }

    if (anyFixed) {
      unilog(533, `Triggering Emby refresh for ${showName}`);
      try {
        await fetch(
          `${EMBY_BASE_URL}/Items/${showId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&api_key=${EMBY_API_KEY}`,
          { method: "POST" },
        );
      } catch (e) {
        unilog(534, `Emby refresh error:`, e.message);
      }
      // Give Emby time to process before gap check reads updated data
      await new Promise((r) => setTimeout(r, 8000));
    }
  } catch (e) {
    unilog(535, `Error for ${showName}:`, e.message);
  }
  return anyFixed;
};

function resetOpnDailyCountIfNeeded() {
  const todayLA = new Date()
    .toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })
    .replace(/\//g, "-");
  if (opnDailyCountDate !== todayLA) {
    opnDailyCount = 0;
    opnDailyCountDate = todayLA;
  }
}

function getOpnSidecarPath(videoFilePath, fileId) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const tag = "opn" + encodeFileIdBase32(fileId).slice(1);
  return `${base}.${tag}.srt`;
}

function hasOpnSidecar(videoFilePath) {
  const base = videoFilePath.replace(/\.[^.]+$/, "");
  const dir = path.dirname(videoFilePath);
  const basename = path.basename(base);
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  return dirEntries.some(
    (entry) =>
      entry.startsWith(basename) &&
      /^\.opn[A-Z2-7]{5}\.srt$/i.test(entry.slice(basename.length)),
  );
}

async function tryDownloadOpnSrtForVideo({
  showName,
  tvdbRecord,
  videoFilePath,
  parsed,
  key,
  logPrefix,
}) {
  if (!tvdbRecord.inEmby || !tvdbRecord.imdbId) return { attempted: false };
  if (!fs.existsSync(videoFilePath)) return { attempted: false, missing: true };
  if (hasOpnSidecar(videoFilePath)) {
    return { attempted: true, downloaded: false, alreadyPresent: true };
  }

  resetOpnDailyCountIfNeeded();
  if (opnDailyCount >= OPN_DAILY_LIMIT) {
    unilog(17, `${logPrefix} quota exceeded for ${showName} ${key}`);
    return { attempted: true, downloaded: false, quotaExceeded: true };
  }

  let results;
  try {
    results = await subsSearch({
      imdb_id: tvdbRecord.imdbId,
      season: parsed.season,
      episode: parsed.episode,
      language: "en",
    });
  } catch (e) {
    if (e?.message?.includes("406") || e?.details?.status === 406) {
      unilog(18, `${logPrefix} quota exceeded for ${showName} ${key}`);
    } else {
      unilog(19, `${logPrefix} search err ${showName} ${key}: ${e.message}`);
    }
    return { attempted: true, downloaded: false, error: e };
  }

  const items = Array.isArray(results?.data) ? results.data : [];
  if (items.length === 0) {
    unilog(20, `${logPrefix} no results: ${showName} ${key}`);
    return { attempted: true, downloaded: false };
  }

  const result = items[0];
  const fileId = result.file_id || result.attributes?.files?.[0]?.file_id;
  if (!fileId) {
    unilog(21, `${logPrefix} missing file id: ${showName} ${key}`);
    return { attempted: true, downloaded: false };
  }

  const outPath = getOpnSidecarPath(videoFilePath, fileId);
  if (fs.existsSync(outPath)) {
    return { attempted: true, downloaded: false, alreadyPresent: true };
  }

  try {
    const login = loadSubsLogin();
    const dl = await openSubtitlesDownloadWithRetry({
      apiKey: login.apiKey,
      token: subsTokenCache,
      fileId,
    });
    if (!dl?.resp?.ok) {
      if (dl?.resp?.status === 406) {
        unilog(22, `${logPrefix} quota exceeded (dl) for ${showName} ${key}`);
      } else {
        unilog(
          536,
          `${logPrefix} download err ${showName} ${key}: HTTP ${dl?.resp?.status ?? "unknown"}`,
        );
      }
      return { attempted: true, downloaded: false };
    }
    const url = typeof dl.body?.link === "string" ? dl.body.link.trim() : "";
    if (!url) {
      unilog(23, `${logPrefix} missing download link: ${showName} ${key}`);
      return { attempted: true, downloaded: false };
    }
    const resp = await fetch(url, { headers: { Accept: "*/*" } });
    if (!resp.ok) {
      unilog(
        537,
        `${logPrefix} fetch err ${showName} ${key}: HTTP ${resp.status}`,
      );
      return { attempted: true, downloaded: false };
    }
    const txt = await resp.text();
    await fs.promises.writeFile(outPath, stripSrtFormatting(txt), "utf8");
    opnDailyCount++;
    unilog(24, `${logPrefix}: ${outPath}`);
    return { attempted: true, downloaded: true, outPath };
  } catch (e) {
    unilog(
      538,
      `${logPrefix} dl err ${showName} ${key} fid=${fileId}: ${e.message}`,
    );
    return { attempted: true, downloaded: false, error: e };
  }
}

async function checkAndDownloadOpnSrt(showName, tvdbRecord) {
  if (!tvdbRecord.inEmby) return;
  if (!tvdbRecord.imdbId) return;

  resetOpnDailyCountIfNeeded();
  if (opnDailyCount >= OPN_DAILY_LIMIT) return;

  const ed = tvdbRecord.episodeData;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  const eligible = [];
  const showFolder = path.join(tvDir, showName);
  let seasonDirs;
  try {
    seasonDirs = fs.readdirSync(showFolder);
  } catch {
    return;
  }

  for (const seasonDir of seasonDirs) {
    const seasonPath = path.join(showFolder, seasonDir);
    try {
      if (!fs.statSync(seasonPath).isDirectory()) continue;
    } catch {
      continue;
    }
    let files;
    try {
      files = fs.readdirSync(seasonPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!videoFileExtensions.includes(f.split(".").pop())) continue;
      const fp = path.join(seasonPath, f);
      const parsed = parseFileSeasonEpisode(fp);
      if (!parsed) continue;
      const key = `S${String(parsed.season).padStart(2, "0")}E${String(parsed.episode).padStart(2, "0")}`;
      if (epd.isWatched(ed, parsed.season, parsed.episode)) continue;

      const airedStr = epd.getAired(ed, parsed.season, parsed.episode);
      if (!airedStr) continue;
      const airedMs = new Date(airedStr).getTime();
      if (isNaN(airedMs) || airedMs < oneYearAgo || airedMs > now) continue;
      if (hasOpnSidecar(fp)) continue;

      const histKey = `${showName}|||${key}`;
      const lastCheck = opnCheckHistory[histKey];
      if (lastCheck && now - lastCheck < twentyFourHours) continue;

      eligible.push({ filePath: fp, key, airedMs, parsed, histKey });
    }
  }

  if (eligible.length === 0) return;

  eligible.sort((a, b) => a.airedMs - b.airedMs);
  const { filePath, key, parsed, histKey } = eligible[0];
  opnCheckHistory[histKey] = now;
  persistOpnCheckHistory();

  const result = await tryDownloadOpnSrtForVideo({
    showName,
    tvdbRecord,
    videoFilePath: filePath,
    parsed,
    key,
    logPrefix: "opn-bg",
  });

  if (result?.downloaded) {
    delete opnCheckHistory[histKey];
    persistOpnCheckHistory();
    if (removeFromChksrtSnoozed(showName, filePath)) {
      persistChksrtSnoozed();
      enqueueSubQueueChkSrt(
        { videoFilePath: filePath, fromUI: false, lowPriority: false },
        false,
      );
      persistSubQueueChkSrt();
      notifyClients("chksrt-count", subQueueChkSrt.length);
      unilog(25, `opn-bg unsnooze: ${filePath}`);
    }
  }
}

async function processChksrtSnoozedForShow(showName, tvdbRecord) {
  const snoozedEntries = [...getChksrtSnoozedForShow(showName)];
  if (snoozedEntries.length === 0) return;

  let queueChanged = false;
  let snoozedChanged = false;
  for (const { videoFilePath, snoozedAt } of snoozedEntries) {
    if (Date.now() - snoozedAt < CHKSRT_SNOOZE_MS) continue;
    removeFromChksrtSnoozed(showName, videoFilePath);
    snoozedChanged = true;

    if (!fs.existsSync(videoFilePath)) continue;

    const alreadyQueued = subQueueChkSrt.some(
      (entry) => entry.videoFilePath === videoFilePath,
    );
    if (alreadyQueued) continue;

    const parsed = parseFileSeasonEpisode(videoFilePath);
    if (parsed) {
      const key = `S${String(parsed.season).padStart(2, "0")}E${String(parsed.episode).padStart(2, "0")}`;
      await tryDownloadOpnSrtForVideo({
        showName,
        tvdbRecord,
        videoFilePath,
        parsed,
        key,
        logPrefix: "opn-snooze",
      });
    } else {
      unilog(26, `opn-snooze parse err ${showName}: ${videoFilePath}`);
    }

    enqueueSubQueueChkSrt(
      { videoFilePath, fromUI: false, lowPriority: false },
      false,
    );
    unilog(27, `chksrt unsnooze (24h): ${videoFilePath}`);
    queueChanged = true;
  }

  if (snoozedChanged) persistChksrtSnoozed();
  if (queueChanged) {
    persistSubQueueChkSrt();
    notifyClients("chksrt-count", subQueueChkSrt.length);
  }
}

tvdb.setPerShowCallback(async (showName, tvdbRecord, options) => {
  try {
    delete tvdbRecord.haveSubs;
    if (tvdbRecord.inEmby) {
      removeFromSnoozeByShow(showName, tvdbRecord.tvdbId);
    }
    // Subtitle scan for inEmby shows
    if (tvdbRecord.inEmby) {
      const showFolderName = showName.includes("/")
        ? showName
        : (tvdbRecord.path || tvdbRecord.emby?.path || showName)
            .split("/")
            .pop();
      const showFolder = path.join(tvDir, showFolderName);
      try {
        const seasonDirs = fs.readdirSync(showFolder);
        for (const seasonDir of seasonDirs) {
          const seasonPath = path.join(showFolder, seasonDir);
          try {
            if (!fs.statSync(seasonPath).isDirectory()) continue;
          } catch {
            continue;
          }
          const files = fs.readdirSync(seasonPath);
          for (const f of files) {
            if (!videoFileExtensions.includes(f.split(".").pop())) continue;
            const fp = path.join(seasonPath, f);
            if (await fileNeedsSubChecked(fp, showName)) {
              enqueueSubQueue(
                { videoFilePath: fp, fromUI: false, lowPriority: true },
                false,
              );
            }
          }
        }
        persistSubQueue();
      } catch (e) {
        unilog(539, `subtitle scan error for ${showName}: ${e.message}`);
      }
      // Resolution fallback: keep a hidden 1080 .alt next to unwatched 2160s.
      try {
        await scanShowForResFallback(showName, tvdbRecord);
      } catch (e) {
        unilog(1100, `res fallback scan failed for ${showName}: ${e.message}`);
      }
    }
    // Disk check, date/size/noFiles, filesOnDisk/fileQuality/quality and
    // episodeData are all refreshed by refreshEpisodeData (called from the tvdb
    // loop before this callback), so no separate disk scan is needed here.
    const diskChanges = [];
    // lastPlayedDate
    const playedDateChanges = [];
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      try {
        const latestPlayed = await fetchLatestPlayedInfo(tvdbRecord.id);
        if (
          latestPlayed?.lastPlayedDate &&
          latestPlayed.lastPlayedDate !== tvdbRecord.lastPlayedDate
        ) {
          playedDateChanges.push(
            `lastPlayedDate:${tvdbRecord.lastPlayedDate}->${latestPlayed.lastPlayedDate}`,
          );
          tvdbRecord.lastPlayedDate = latestPlayed.lastPlayedDate;
        }
      } catch (e) {}
    }
    // Fix compact-NNN episode mis-indexing (e.g. "101-Title.avi" parsed as E101)
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      await fixCompactEpisodeNaming(tvdbRecord.id, showName);
    }
    // Gap check
    let gapChanges = [];
    const prevNeedsIntro = !!tvdbRecord.needsIntro;
    if (tvdbRecord.inEmby && tvdbRecord.id) {
      const gapData = await emby.gapCheckOne(
        tvdbRecord.id,
        showName,
        tvdbRecord,
      );
      if (showName === "Swiss Toni") {
        unilog(
          540,
          `gapData=${JSON.stringify(gapData)} tvdbRecord.notReady=${tvdbRecord.notReady}`,
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
        delete tvdbRecord.allAiredWatched;
      }
      // Compute full: every episode is either watched or has a file
      const newFull = !!(tvdbRecord.inEmby && gapData.allWatchedOrHaveFile);
      if (!!tvdbRecord.full !== newFull) {
        gapChanges.push(`full:${tvdbRecord.full}->${newFull}`);
        tvdbRecord.full = newFull;
      }
      // Compute needsIntro
      const hasConfiguredIntro =
        tvdbRecord.seasonIntros != null &&
        Object.values(tvdbRecord.seasonIntros).some(
          (si) => si?.trimPos != null || si?.skipDur != null,
        );
      const newNeedsIntro = !!(
        tvdbRecord.inEmby &&
        !tvdbRecord.inLinda &&
        !hasConfiguredIntro &&
        Number(tvdbRecord.episodeCount ?? 0) >
          Number(tvdbRecord.watchedCount ?? 0) &&
        epd.seasonsWithFile(tvdbRecord.episodeData).length > 0
      );
      if (!!tvdbRecord.needsIntro !== newNeedsIntro) {
        gapChanges.push(
          `needsIntro:${tvdbRecord.needsIntro}->${newNeedsIntro}`,
        );
        tvdbRecord.needsIntro = newNeedsIntro;
      }
    } else if (!tvdbRecord.inEmby) {
      // For shows not in emby, set error fields to known constants
      const nonEmbyConstants = [
        ["fileGap", false],
        ["fileGapSeason", null],
        ["fileGapEpisode", null],
        ["fileEndError", false],
        ["fileEndErrorSeason", null],
        ["fileEndErrorEpisode", null],
        ["watchGap", false],
        ["watchGapSeason", null],
        ["watchGapEpisode", null],
        ["seasonWatchedThenNofile", false],
        ["seasonWatchedThenNofileSeason", null],
        ["seasonWatchedThenNofileEpisode", null],
        ["full", false],
        ["needsIntro", false],
        ["notReady", true],
      ];
      for (const [f, v] of nonEmbyConstants) {
        if (tvdbRecord[f] !== v) {
          gapChanges.push(`${f}:${tvdbRecord[f]}->${v}`);
          tvdbRecord[f] = v;
        }
      }
    }
    // React to needsIntro flips: queue or cancel .bif generation.
    const nowNeedsIntro = !!tvdbRecord.needsIntro;
    if (nowNeedsIntro !== prevNeedsIntro) {
      try {
        handleNeedsIntroChange(showName, tvdbRecord, nowNeedsIntro);
      } catch (e) {
        unilog(541, "needsIntro change error:", showName, e.message);
      }
    }
    const push2Changes = [...diskChanges, ...playedDateChanges, ...gapChanges];
    // History: bkgndUpdate (timer-selected) or clientUpdate (user-triggered)
    try {
      const tvdbIdVal = String(tvdbRecord.tvdbId || "").trim() || null;
      const fieldsVal =
        push2Changes.length > 0 ? JSON.stringify(push2Changes) : null;
      const descVal =
        push2Changes.length > 0 ? push2Changes.join(" ") : "No fields changed";
      // hidden       unilog(
      // hidden         464,
      // hidden         "history",
      // hidden         options?.isBackground ? "bkgndUpdate" : "clientUpdate",
      // hidden         showName,
      // hidden         descVal,
      // hidden       );
    } catch (e) {
      unilog(542, "bkgndUpdate/clientUpdate error:", showName, e.message);
    }
    if (push2Changes.length) {
      await tvdb.saveTvdbSync();
      if (!options?.suppressNotify) {
        unilog(28, `${showName}: ${push2Changes.join(" ")}`);
        debouncedTvdbPush(showName);
      }
    } else {
      if (!options?.suppressNotify) {
        unilog(29, `${showName}: no changes`);
      }
    }
    // Background OpenSubtitles check: download one missing .opnXXXXX.srt per show
    try {
      await checkAndDownloadOpnSrt(showName, tvdbRecord);
      await processChksrtSnoozedForShow(showName, tvdbRecord);
    } catch (e) {
      unilog(543, "error for", showName, e.message);
    }
    return { hasChanges: push2Changes.length > 0, changes: push2Changes };
  } catch (e) {
    unilog(544, "error for", showName, e.message);
    return { hasChanges: false, changes: [] };
  }
});
let embyFullSweepTickCount = 0;
tvdb.setPreTvdbTickCallback(async ({ isBackground } = {}) => {
  embyFullSweepTickCount++;
  // TEST: skip sweep on foreground (user-triggered) ticks — revert by removing `&& isBackground`
  if (isBackground && embyFullSweepTickCount % 10 === 1) {
    const caller = `preTick-bg#${embyFullSweepTickCount}`;
    await runEmbyFullSweep(caller);
  }
});

// Wire the consolidated episodeData refresh into the tvdb background loop.
tvdb.setRefreshEpisodeDataCallback(refreshEpisodeData);

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

const probedRawHeightByPath = new Map();

function probeRawHeight(filePath) {
  if (!filePath) return null;
  if (probedRawHeightByPath.has(filePath)) {
    return probedRawHeightByPath.get(filePath);
  }

  let h = null;
  try {
    const out = runFfprobe(
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=height",
        "-of",
        "csv=p=0",
        String(filePath),
      ],
      1024 * 1024,
    ).trim();
    const parsed = Number.parseInt(out, 10);
    h = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    h = null;
  }

  probedRawHeightByPath.set(filePath, h);
  return h;
}

function toEpisodeKey(season, episode) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

let diskShowsCache = null;

const getShowsFromDisk = async (_params) => {
  if (diskShowsCache) return diskShowsCache;
  let errFlg = null;
  const shows = {};

  let maxDate, totalSize;
  let episodesBySeason;
  let fileQuality;
  let showFolderName;

  const recurs = async (path) => {
    if (errFlg || path == tvDir + "/.stfolder") return;
    try {
      const fstat = await fsp.stat(path);
      if (fstat.isDirectory()) {
        const dir = await fsp.readdir(path);
        for (const dirent of dir) await recurs(path + "/" + dirent);
        return;
      }
      const sfx = path.split(".").pop();
      if (videoFileExtensions.includes(sfx)) {
        const date = fmtDateWithTZ(fstat.mtime);
        maxDate = Math.max(maxDate, date);
        const fname = path.split("/").pop();
        const folderName = path.split("/").slice(-2, -1)[0];
        const parsed = parseFileSeasonEpisode(fname, folderName);
        if (
          parsed &&
          Number.isInteger(parsed.season) &&
          Number.isInteger(parsed.episode)
        ) {
          if (!episodesBySeason.has(parsed.season))
            episodesBySeason.set(parsed.season, new Set());
          episodesBySeason.get(parsed.season).add(parsed.episode);
          const ptt = parseTorrentTitle(fname.replace(/\.[a-z0-9]{2,4}$/i, ""));
          const title = parseTitleFromFilename(fname, folderName, ptt);
          const titleMatch =
            !title || !!smartTitleMatch(title, [showFolderName], null, true);
          const quality = getResolution(path, { probeFileFn: probeRawHeight });
          if (titleMatch && quality != null) {
            const epKey = toEpisodeKey(parsed.season, parsed.episode);
            const existing = fileQuality[epKey];
            if (!existing || quality > existing) fileQuality[epKey] = quality;
          }
        }
      }
      totalSize += fstat.size;
    } catch (err) {
      errFlg = err;
    }
  };

  const dir = await fsp.readdir(tvDir);
  for (const dirent of dir) {
    const showPath = tvDir + "/" + dirent;
    const fstat = await fsp.stat(showPath);
    const maxDate = fmtDateWithTZ(fstat.mtime);
    totalSize = 0;
    episodesBySeason = new Map();
    fileQuality = {};
    showFolderName = dirent;

    await recurs(showPath);

    const filesOnDisk = Array.from(episodesBySeason.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([season, epSet]) => [
        season,
        ...Array.from(epSet).sort((a, b) => a - b),
      ]);

    shows[dirent] = [maxDate, totalSize, filesOnDisk, fileQuality];
  }
  if (errFlg) {
    throw new Error(`getShowsFromDisk: Error: ${errFlg.message}`);
  } else {
    diskShowsCache = shows;
    return shows;
  }
};

/**
 * Extract the show name from an absolute video file path under tvDir.
 * Handles shows whose name contains a "/" (e.g. "Good Cop/Bad Cop") by
 * checking whether the two-segment prefix matches a known tvdb entry.
 */
const showNameFromFilePath = (filePath) => {
  const rel = filePath.replace(tvDir + "/", "");
  const parts = rel.split("/");
  if (parts.length >= 2) {
    const twoSeg = parts[0] + "/" + parts[1];
    if (tvdb.getAllTvdbSync()[twoSeg]) return twoSeg;
  }
  return parts[0];
};

/**
 * Check disk for a single show folder
 * @param {string} showFolderName - The show folder name (e.g., "Breaking Bad")
 * @returns {Promise<[number, number, Array, Object, Object]|null>} - [maxDate, totalSize, filesOnDisk, fileQuality, diskByEp] or null if not found
 *   diskByEp: { [season]: { [episode]: { file, res, bif } } } — per-episode file name + resolution + bif-sidecar flag
 */
const getShowDiskInfo = async (showFolderName) => {
  if (!showFolderName) return null;

  let maxDate = 0;
  let totalSize = 0;
  let errFlg = null;
  // Track which episodes are on disk: { season -> Set<episode> }
  const episodesBySeason = new Map();
  const fileQuality = {};
  // Per-episode file name + resolution: { [season]: { [episode]: { file, res } } }
  const diskByEp = {};
  // All .bif sidecar file names found (matched to video bases after the scan).
  const bifFiles = [];

  const recurs = async (dirPath) => {
    if (errFlg || dirPath == tvDir + "/.stfolder") return;
    try {
      const fstat = fs.statSync(dirPath);
      if (fstat.isDirectory()) {
        const dir = fs.readdirSync(dirPath);
        const folderName = path.basename(dirPath);
        for (const dirent of dir)
          await recurs(dirPath + "/" + dirent, folderName);
        return;
      }
      const sfx = dirPath.split(".").pop();
      if (sfx === "bif") {
        bifFiles.push(path.basename(dirPath));
        return;
      }
      if (videoFileExtensions.includes(sfx)) {
        const date = fmtDateWithTZ(fstat.mtime);
        if (!maxDate || date > maxDate) maxDate = date;
        totalSize += fstat.size;
        // Parse season/episode from filename + parent folder name
        const fname = path.basename(dirPath);
        const folderName = path.basename(path.dirname(dirPath));
        const parsed = parseFileSeasonEpisode(fname, folderName);
        if (
          parsed &&
          Number.isInteger(parsed.season) &&
          Number.isInteger(parsed.episode)
        ) {
          if (!episodesBySeason.has(parsed.season))
            episodesBySeason.set(parsed.season, new Set());
          episodesBySeason.get(parsed.season).add(parsed.episode);
          const ptt = parseTorrentTitle(fname.replace(/\.[a-z0-9]{2,4}$/i, ""));
          const title = parseTitleFromFilename(fname, folderName, ptt);
          const titleMatch =
            !title || !!smartTitleMatch(title, [showFolderName], null, true);
          const quality = getResolution(dirPath, {
            probeFileFn: probeRawHeight,
          });
          if (titleMatch) {
            if (quality != null) {
              const epKey = toEpisodeKey(parsed.season, parsed.episode);
              const existing = fileQuality[epKey];
              if (!existing || quality > existing) fileQuality[epKey] = quality;
            }
            // Track per-episode file name; prefer the higher-resolution file.
            if (!diskByEp[parsed.season]) diskByEp[parsed.season] = {};
            const cur = diskByEp[parsed.season][parsed.episode];
            if (!cur || (quality != null && quality > (cur.res ?? 0))) {
              diskByEp[parsed.season][parsed.episode] = {
                file: fname,
                res: quality ?? null,
              };
            }
          }
        }
      }
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
      unilog(545, `Error for ${showFolderName}:`, errFlg.message);
      return null;
    }

    // Match .bif sidecars to episodes: a bif belongs to a video when its name
    // starts with the video file's base name (name without the final extension).
    if (bifFiles.length > 0) {
      for (const eps of Object.values(diskByEp)) {
        for (const info of Object.values(eps)) {
          const base = info.file.replace(/\.[^.]+$/, "");
          if (base && bifFiles.some((bn) => bn.startsWith(base))) {
            info.bif = 1;
          }
        }
      }
    }

    // Encode filesOnDisk in same format as watchedEpis: [[season, ep1, ep2, ...], ...]
    const filesOnDisk = Array.from(episodesBySeason.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([season, epSet]) => [
        season,
        ...Array.from(epSet).sort((a, b) => a - b),
      ]);

    return [maxDate, totalSize, filesOnDisk, fileQuality, diskByEp];
  } catch (err) {
    // Show folder doesn't exist or not accessible
    return null;
  }
};

// Single authoritative refresh of rec.episodeData from the three sources:
// TVDB (aired), Emby (watched + episode id), disk scan (file name + resolution).
// Transitional: also keeps the legacy watchedEpis/filesOnDisk/fileQuality/
// episodeAiredDates props in sync so the web/Android clients keep working until
// they are switched to episodeData. `opts.sources` limits which sources run.
async function refreshEpisodeData(showName, rec, opts = {}) {
  const sources = opts.sources || ["tvdb", "emby", "disk"];
  if (!Array.isArray(rec.episodeData)) rec.episodeData = [];
  const ed = rec.episodeData;

  const folder = showName.includes("/")
    ? showName
    : (rec.path || rec.emby?.path || showName).split("/").pop();
  const folderDiffers = folder !== showName;

  // 1. TVDB aired dates — adds slots for every aired episode.
  let tvdbMap = null;
  if (sources.includes("tvdb") && rec.tvdbId) {
    try {
      tvdbMap = await tvdb.getSeriesMap(rec.tvdbId, null);
      for (const [seasonNum, episodes] of tvdbMap || []) {
        if (!Number.isInteger(seasonNum)) continue;
        for (const [epNum, epData] of episodes) {
          if (!Number.isInteger(epNum) || epNum < 1) continue;
          if (epData?.aired)
            epd.setEpisode(ed, seasonNum, epNum, { aired: epData.aired });
        }
      }
    } catch (e) {
      unilog(30, `tvdb ${showName}: ${e.message}`);
    }
  }

  // 2. Emby watched flag + episode id (in-emby shows only).
  if (sources.includes("emby") && rec.inEmby && rec.id) {
    try {
      const embyMap = await emby.getSeriesMap({
        id: rec.id,
        name: showName,
        tvdbId: rec.tvdbId,
      });
      for (const [seasonNum, episodes] of embyMap || []) {
        if (!Number.isInteger(seasonNum)) continue;
        for (const [epNum, ep] of episodes) {
          if (!Number.isInteger(epNum) || epNum < 1) continue;
          epd.setEpisode(ed, seasonNum, epNum, {
            watched: !!ep.played,
            id: ep.id ? Number(ep.id) : 0,
            pos: ep.pos || 0,
          });
        }
      }
    } catch (e) {
      unilog(31, `emby ${showName}: ${e.message}`);
    }
  }

  // 3. Disk scan — authoritative file name + resolution, plus date/size/noFiles.
  if (sources.includes("disk")) {
    try {
      const diskInfo = await getShowDiskInfo(folder);
      if (diskInfo) {
        const [newDate, newSize, , , diskByEp] = diskInfo;
        rec.date = newDate;
        rec.size = newSize;
        rec.noFiles = false;
        // Clear files for episodes no longer present on disk.
        epd.forEachEpisode(ed, (s, e) => {
          if (epd.hasFile(ed, s, e) && !diskByEp[s]?.[e])
            epd.clearFile(ed, s, e);
        });
        for (const [sStr, eps] of Object.entries(diskByEp || {})) {
          const s = Number(sStr);
          for (const [eStr, info] of Object.entries(eps)) {
            const e = Number(eStr);
            const fileVal = folderDiffers
              ? `${folder}//${info.file}`
              : info.file;
            epd.setEpisode(ed, s, e, {
              file: fileVal,
              res: info.res,
              bif: info.bif ? 1 : 0,
            });
          }
        }
      } else if (!rec.noFiles) {
        rec.noFiles = true;
        rec.date = null;
        rec.size = 0;
        // No folder on disk: clear all files.
        epd.forEachEpisode(ed, (s, e) => {
          if (epd.hasFile(ed, s, e)) epd.clearFile(ed, s, e);
        });
      }
    } catch (e) {
      unilog(32, `disk ${showName}: ${e.message}`);
    }
  }

  // Shows not in Emby never keep files — drop id/file/res, keep aired/watched.
  if (!rec.inEmby) epd.stripToAiredWatched(ed);

  // Derived record fields.
  rec.quality = epd.computeQuality(ed) ?? null;
  rec.watchedCount = epd.countWatched(ed);

  // seasonPremiereDates: first time only, from TVDB map (month of episode 1).
  if (!rec.seasonPremiereDates && Array.isArray(tvdbMap)) {
    const spd = {};
    for (const [seasonNum, episodes] of tvdbMap) {
      const sorted = [...episodes].sort((a, b) => Number(a[0]) - Number(b[0]));
      const first = sorted.find(([n]) => Number(n) === 1) || sorted[0];
      if (first?.[1]?.aired) {
        spd[String(seasonNum)] = first[1].aired.slice(0, 7).replace("-", "/");
      }
    }
    if (Object.keys(spd).length > 0) rec.seasonPremiereDates = spd;
  }

  // waitStr recompute now that aired/watched/files are fresh.
  const freshWaitStr = tvdb.calculateWaitStr(ed);
  if (freshWaitStr !== null) rec.waitStr = freshWaitStr || null;

  // episodeData supersedes these legacy per-episode props.
  delete rec.watchedEpis;
  delete rec.filesOnDisk;
  delete rec.fileQuality;
  delete rec.episodeAiredDates;

  return ed;
}

const upload = async () => {
  let str = headerStr;
  str += '        - "dummy"\n';
  for (let name of pickups)
    str += '        - "' + name.replace(/"/g, "") + '"\n';
  str += footerStr;
  await util.writeFile(configWritePath("config.yml"), str);
  return "ok";
};

let saving = false;

const trySaveConfigYml = async (id, result, resolve, reject) => {
  if (saving) return ["busy", id, result, resolve, reject];
  saving = true;
  pickups.sort((a, b) => {
    const aname = a.replace(/The\s/i, "");
    const bname = b.replace(/The\s/i, "");
    return aname.toLowerCase() > bname.toLowerCase() ? +1 : -1;
  });
  await util.writeFile(configWritePath("config4-pickups.json"), pickups);

  let errResult = null;

  const uploadRes = await upload();
  if (uploadRes != "ok") errResult = uploadRes;

  if (errResult) {
    unilog(546, "trySaveConfigYml error:", errResult);
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

// Run sync immediately (removed reject sync)
// No longer needed since we removed reject filter

const addPickup = async (params) => {
  const name = params?.name;
  const tvdbId = params?.tvdbId;
  unilog(547, "addPickup", name);

  if (!name) {
    throw new Error("addPickup: missing name");
  }

  // Update pickups array (config is the authority; tvdb synced in trySaveConfigYml)
  for (const [idx, pickupNameStr] of pickups.entries()) {
    if (pickupNameStr.toLowerCase() === name.toLowerCase()) {
      unilog(548, "-- removing old matching pickup:", pickupNameStr);
      pickups.splice(idx, 1);
      break;
    }
  }
  unilog(549, "-- adding pickup:", name);
  pickups.push(name);
  try {
    unilog(465, "history", "pickup", name, "Added to pickup list");
  } catch {}
  await new Promise((resolve, reject) =>
    saveConfigYml(null, "ok", resolve, reject),
  );
  return "ok";
};

const delPickup = async (params) => {
  const name = params?.name;
  const tvdbId = params?.tvdbId;
  unilog(550, "delPickup", name);
  if (!name) {
    throw new Error("delPickup: missing name");
  }
  let deletedOne = false;

  // Update pickups array (config is the authority; tvdb synced in trySaveConfigYml)
  for (const [idx, pickupNameStr] of pickups.entries()) {
    if (pickupNameStr.toLowerCase() === name.toLowerCase()) {
      unilog(551, "-- deleting pickup:", pickupNameStr);
      pickups.splice(idx, 1);
      deletedOne = true;
      break;
    }
  }
  if (!deletedOne) {
    unilog(552, "pickup not deleted, no match:", name);
    return "delPickup no match: " + name;
  }
  try {
    unilog(466, "history", "unpickup", name, "Removed from pickup list");
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
  unilog(553, "addNoEmby", name);
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
    unilog(554, "-- sync: inherited Reject=true from global list:", name);
  }

  if (existingKey && existingKey !== name) {
    delete allTvdb[existingKey];
  }
  allTvdb[name] = nextRecord;
  await tvdb.saveTvdbSync();
  try {
    const id = String(nextRecord.tvdbId || "").trim() || null;
    unilog(
      467,
      "history",
      "addEmby",
      name,
      `Added (inEmby=${nextRecord.inEmby})`,
    );
  } catch {}
  return "ok";
};

const delNoEmby = async (params) => {
  const name = params?.name;
  unilog(555, "delNoEmby", name);
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
    unilog(556, "no noembys deleted, no match:", name);
    return "delNoEmby no match:" + name;
  }

  const deletedRecord = allTvdb[deleteKey];
  unilog(557, "deleting no-emby record:", deleteKey);
  delete allTvdb[deleteKey];
  await tvdb.saveTvdbSync();
  try {
    const delTvdbId = String(deletedRecord?.tvdbId || "").trim() || null;
    unilog(468, "history", "remEmby", deleteKey, "Deleted non-Emby show");
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
    unilog(33, `${showName}: ${seasonDir}`);

    let entries = [];
    try {
      entries = await fs.promises.readdir(seasonDir);
    } catch (e) {
      throw new Error(`delSeasonFiles: readdir failed: ${e.message}`);
    }

    for (const entry of entries) {
      const entryPath = path.join(seasonDir, entry);
      unilog(34, `deleting: ${entryPath}`);
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

  unilog(558, "request", {
    showName: showNameRaw,
    tvdbId: params?.tvdbId,
    seriesMapSeasons,
  });

  const showName = safeShowFolderName(showNameRaw);
  if (!showName) {
    unilog(559, "invalid showName", { showNameRaw });
    throw new Error("createShowFolder: invalid showName");
  }

  const showPath = path.join(tvDir, showName);
  const existed = fs.existsSync(showPath);

  try {
    fs.mkdirSync(showPath, { recursive: true });
    unilog(560, "show dir", { showPath, existed });
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
        unilog(561, "season dir", { season, seasonPath });
      } catch (e) {
        throw new Error(`createShowFolder: mkdir season failed: ${e.message}`);
      }
    }
  } else if (seriesMapSeasons !== undefined) {
    unilog(562, "seriesMapSeasons not an array; skipping season dirs", {
      seriesMapSeasonsType: typeof seriesMapSeasons,
    });
  }

  const nfo = buildTvShowNfo(showName, tvdbId);
  if (nfo) {
    const nfoPath = path.join(showPath, "tvshow.nfo");
    try {
      fs.writeFileSync(nfoPath, nfo, "utf8");
      unilog(563, "wrote tvshow.nfo", { nfoPath, tvdbId });
    } catch (e) {
      throw new Error(`createShowFolder: write nfo failed: ${e.message}`);
    }
  }

  try {
    unilog(469, "history", "addEmby", showName, `Created folder: ${showPath}`);
  } catch {}

  return { ok: true, created: !existed, path: showPath };
};

let sharedFilters = null;

const setSharedFilters = async (params) => {
  if (params === undefined || params === null || params === "") {
    sharedFilters = null;
    notifyClients("sharedFiltersChanged", null);
    return { ok: true };
  }

  // No need to jParse, we expect it to be a JS object already
  sharedFilters = params;
  notifyClients("sharedFiltersChanged", sharedFilters);
  return { ok: true };
};

const getSharedFilters = async (_params) => {
  return sharedFilters;
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

const deleteOnePath = async (pathParam) => {
  // If it's just a folder name (no slashes), construct the full path in tvDir
  // Otherwise use the path as-is (for episode file deletions)
  let fullPath =
    pathParam.includes("/") || pathParam.includes("\\")
      ? pathParam
      : path.join(tvDir, pathParam);

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
            unilog(
              564,
              "deletePath: resolved missing season path",
              pathParam,
              "->",
              fullPath,
            );
          }
        }
      }

      if (!stats) {
        unilog(35, "deletePath: path doesn't exist");
        return "ok";
      }
    }

    fs.rmSync(fullPath, { recursive: true, force: true });

    // Wait for filesystem to sync
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify deletion
    try {
      fs.statSync(fullPath);
      unilog(565, "deletePath: path still exists after deletion:", fullPath);
      throw new Error(`Path still exists after deletion: ${fullPath}`);
    } catch (e) {
      if (e.code !== "ENOENT") {
        throw e;
      }
    }
  } catch (e) {
    unilog(566, "error removing path:", fullPath, e.message);
    throw new Error(`Failed to delete path: ${e.message}`);
  }
  return "ok";
};

const deletePath = async (params) => {
  const pathParam = params?.path;
  if (!pathParam) {
    throw new Error("deletePath: missing path parameter");
  }
  return deleteOnePath(pathParam);
};

const deletePaths = async (params) => {
  const paths = params?.paths;
  if (!Array.isArray(paths)) {
    throw new Error("deletePaths: missing paths array");
  }
  const results = [];
  for (const pathParam of paths) {
    try {
      await deleteOnePath(pathParam);
      results.push({ path: pathParam, ok: true });
    } catch (e) {
      results.push({ path: pathParam, ok: false, error: e.message });
    }
  }
  return results;
};

const sendEmailHandler = async (params) => {
  const { body } = params;
  unilog(567, "sendEmailHandler", body);
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

//////////////////  UNILOG  //////////////////

// Live-tail subscribers for the web client Log pane. Populated by the ws
// message handler (fname unilogSubscribe/unilogUnsubscribe) far below; declared
// here so the DB sink can broadcast to it. Empty until a client subscribes.
const unilogSubscribers = new Set();
let unilogLastPruneTime = 0;
const UNILOG_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Prune oldest log_events to keep table under 90_000 rows.
// Only runs when no subscribers have the log pane open and at least 1 hour
// has elapsed since the last prune.
function maybeUnilogPrune() {
  if (unilogSubscribers.size > 0) return;
  if (Date.now() - unilogLastPruneTime < UNILOG_PRUNE_INTERVAL_MS) return;
  const deleted = unilogDb.pruneEvents();
  if (deleted > 0) {
    unilogLastPruneTime = Date.now();
    notifyClients("unilog-pruned", null);
  }
}
function broadcastUnilog(row) {
  if (!row || unilogSubscribers.size === 0) return;
  const msg = JSON.stringify({
    id: 0,
    notification: "unilog-event",
    data: row,
  });
  for (const ws of unilogSubscribers) {
    if (ws.readyState === 1) {
      try {
        ws.send(msg);
      } catch (_) {} // no-unilog
    }
  }
}

// tv-srvr is the single DB writer. Register the in-process sink so unilog()
// calls inside srvr write directly; other processes/clients use POST /api/log.
epd.setUnilogSink(({ logId, message }) =>
  broadcastUnilog(unilogDb.insertEvent({ logId, pid: "tv-srvr", message })),
);

// Central log collector endpoint. Accepts a single event or a batch array.
// pid identifies the EMITTING process/client; ts is stamped by the writer.
app.post("/api/log", (req, res) => {
  try {
    const body = req.body;
    const events = Array.isArray(body) ? body : [body];
    for (const e of events) {
      if (!e || e.logId == null) continue;
      broadcastUnilog(
        unilogDb.insertEvent({
          logId: e.logId,
          pid: e.pid || "unknown",
          message: e.message,
        }),
      );
    }
    res.json({ ok: true, count: events.length });
  } catch (error) {
    console.error("[unilog] /api/log error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Tooling endpoints — used by the local deploy-time reconciler to allocate ids.
// tv-srvr is the only id generator; all log_id and group_id allocation flows here.

app.post("/api/unilog/group", (req, res) => {
  try {
    const id = unilogDb.createGroup(req.body || {});
    res.json({ id });
  } catch (error) {
    console.error("[unilog] /api/unilog/group error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Find a named group by description, or create it if absent. Never changes the
// group_type of an existing group. Used by the reconciler to resolve logHere
// `grp` names to group ids.
app.post("/api/unilog/find-or-create-group", (req, res) => {
  try {
    const { description, groupType } = req.body || {};
    if (!description)
      return res.status(400).json({ error: "description required" });
    res.json(unilogDb.findOrCreateGroup({ description, groupType }));
  } catch (error) {
    console.error("[unilog] /api/unilog/find-or-create-group error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/sites", (req, res) => {
  try {
    const sites = Array.isArray(req.body) ? req.body : [req.body];
    const ids = sites.map((s) => unilogDb.createSite(s));
    res.json({ ids });
  } catch (error) {
    console.error("[unilog] /api/unilog/sites error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/refresh-sites", (req, res) => {
  try {
    const sites = Array.isArray(req.body) ? req.body : [req.body];
    for (const s of sites) unilogDb.refreshSite(s);
    res.json({ refreshed: sites.length });
  } catch (error) {
    console.error("[unilog] /api/unilog/refresh-sites error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Split a duplicate log_id: create a fresh row (copied from the old id's row, or
// stub-like if the old id has no row) and return the new id. Used by the
// deploy-time reconciler when it finds the same id on more than one source line.
app.post("/api/unilog/duplicate-site", (req, res) => {
  try {
    const id = unilogDb.createDuplicateSite(req.body || {});
    res.json({ id });
  } catch (error) {
    console.error("[unilog] /api/unilog/duplicate-site error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/query-sites", (req, res) => {
  try {
    const ids = Array.isArray(req.body) ? req.body : (req.body?.ids ?? []);
    res.json(unilogDb.querySites(ids));
  } catch (error) {
    console.error("[unilog] /api/unilog/query-sites error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/set-level", (req, res) => {
  try {
    const { ids, level } = req.body || {};
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ error: "ids required" });
    const changed = unilogDb.setSiteLevel(ids, level);
    res.json({ ok: true, changed });
  } catch (error) {
    console.error("[unilog] /api/unilog/set-level error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Read-back for the web client log viewer (Log tab). Returns recent events
// (newest first) joined with their sites, plus the distinct pid list.
app.get("/api/unilog/events", (req, res) => {
  try {
    const { pid, level, file, msg, limit, beforeId, afterId } = req.query;
    res.json({
      events: unilogDb.queryEvents({
        pid,
        level,
        file,
        msg,
        limit,
        beforeId,
        afterId,
      }),
      pids: unilogDb.listPids(),
      levels: unilogDb.listLevels(),
      total: unilogDb.countEvents(),
    });
  } catch (error) {
    console.error("[unilog] /api/unilog/events error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/unilog/oldest-ts", (req, res) => {
  try {
    res.json({ ts: unilogDb.getOldestTimestamp() });
  } catch (error) {
    console.error("[unilog] /api/unilog/oldest-ts error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// Groups management (web client Groups pane).
app.get("/api/unilog/groups", (req, res) => {
  try {
    res.json({ groups: unilogDb.listGroups() });
  } catch (error) {
    console.error("[unilog] /api/unilog/groups error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get("/api/unilog/groups/orphans", (req, res) => {
  try {
    res.json({ groupIds: unilogDb.orphanGroupIds() });
  } catch (error) {
    console.error("[unilog] /api/unilog/groups/orphans error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/groups/create", (req, res) => {
  try {
    const { description, logIds } = req.body || {};
    if (!description || !String(description).trim())
      return res.status(400).json({ error: "description required" });
    res.json(
      unilogDb.createGroupWithSites({
        description: String(description).trim(),
        logIds: Array.isArray(logIds) ? logIds : [],
      }),
    );
  } catch (error) {
    console.error("[unilog] /api/unilog/groups/create error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/groups/assign", (req, res) => {
  try {
    const { groupIds, logIds } = req.body || {};
    res.json(
      unilogDb.assignGroupsToSites({
        groupIds: Array.isArray(groupIds) ? groupIds : [],
        logIds: Array.isArray(logIds) ? logIds : [],
      }),
    );
  } catch (error) {
    console.error("[unilog] /api/unilog/groups/assign error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/groups/remove", (req, res) => {
  try {
    const { groupIds, logIds } = req.body || {};
    res.json(
      unilogDb.removeGroupsFromSites({
        groupIds: Array.isArray(groupIds) ? groupIds : [],
        logIds: Array.isArray(logIds) ? logIds : [],
      }),
    );
  } catch (error) {
    console.error("[unilog] /api/unilog/groups/remove error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/groups/delete", (req, res) => {
  try {
    const { groupIds } = req.body || {};
    res.json(unilogDb.deleteGroups(Array.isArray(groupIds) ? groupIds : []));
  } catch (error) {
    console.error("[unilog] /api/unilog/groups/delete error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/groups/site-ids", (req, res) => {
  try {
    const { groupIds } = req.body || {};
    res.json({
      logIds: unilogDb.siteIdsForGroups(
        Array.isArray(groupIds) ? groupIds : [],
      ),
    });
  } catch (error) {
    console.error("[unilog] /api/unilog/groups/site-ids error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/groups/for-sites", (req, res) => {
  try {
    const { logIds } = req.body || {};
    res.json(unilogDb.groupsForSites(Array.isArray(logIds) ? logIds : []));
  } catch (error) {
    console.error("[unilog] /api/unilog/groups/for-sites error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/groups/set-type", (req, res) => {
  try {
    const { groupIds, groupType } = req.body || {};
    const changed = unilogDb.setGroupType(
      Array.isArray(groupIds) ? groupIds : [],
      typeof groupType === "string" ? groupType : "",
    );
    res.json({ ok: true, changed });
  } catch (error) {
    console.error("[unilog] /api/unilog/groups/set-type error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post("/api/unilog/groups/set-name", (req, res) => {
  try {
    const { groupId, description } = req.body || {};
    if (groupId == null || !description || !String(description).trim())
      return res
        .status(400)
        .json({ error: "groupId and description required" });
    res.json(
      unilogDb.setGroupName({
        groupId,
        description: String(description).trim(),
      }),
    );
  } catch (error) {
    console.error("[unilog] /api/unilog/groups/set-name error:", error); // no-unilog
    res.status(500).json({ error: String(error?.message || error) });
  }
});

// The handler should be: async (params) => result
const apiWrapper = (handler) => {
  return async (req, res) => {
    try {
      // GET requests use query params, POST use body
      const params = req.method === "GET" ? req.query : req.body;
      const result = await handler(params);
      res.json(result);
    } catch (error) {
      unilog(568, `Error in ${req.url}:`, error);
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
app.get("/api/getGaps", apiWrapper(getGaps));
app.get("/api/getNoEmbys", apiWrapper(getNoEmbys));
app.get("/api/getDevices", apiWrapper(emby.getDevices));
app.post("/api/embyViewShow", apiWrapper(emby.viewShowOnLivingRoomTv));
app.post("/api/toggleResolution", apiWrapper(handleToggleResolution));
app.post(
  "/api/resFallbackScanAll",
  apiWrapper(async () => {
    const all = tvdb.getAllTvdbSync();
    let scanned = 0;
    for (const [showName, rec] of Object.entries(all)) {
      if (!rec?.inEmby) continue;
      try {
        await scanShowForResFallback(showName, rec);
        scanned++;
      } catch (e) {
        unilog(1101, `resFallbackScanAll failed for ${showName}: ${e.message}`);
      }
    }
    return { ok: true, scanned, reencodeQueued: reencodeQueue.length };
  }),
);
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
      unilog(569, "error:", err);
      return { success: false, error: err.message };
    }
  }),
);
app.post("/api/getActorPage", apiWrapper(tvdb.getActorPage));
app.post(
  "/api/getSeriesMapFromEmby",
  apiWrapper(async (params) => {
    const { showName } = params;
    if (!showName) return { success: false, error: "Missing showName" };
    const allTvdb = tvdb.getAllTvdbSync();
    const rec = allTvdb?.[showName];
    if (!rec) return { success: false, error: "Show not found" };
    try {
      // Refresh watched/id (Emby) and file/res (disk) so the map is live-fresh.
      // aired dates come from the periodic full refresh; skip the TVDB call here.
      await refreshEpisodeData(showName, rec, { sources: ["emby", "disk"] });
      await tvdb.saveTvdbSync();
      const folder = showName.includes("/")
        ? showName
        : (rec.path || rec.emby?.path || showName).split("/").pop();
      const today = new Date().toISOString().slice(0, 10);
      const seriesMap = epd.toSeriesMap(rec.episodeData, folder, today);
      return { success: true, seriesMap, episodeData: rec.episodeData };
    } catch (err) {
      unilog(570, "error:", err);
      return { success: false, error: err.message };
    }
  }),
);
app.post(
  "/api/clearEpisodePositions",
  apiWrapper(async (params) => {
    const { showName, cells } = params;
    if (!showName || !Array.isArray(cells) || cells.length === 0)
      return { ok: false, error: "Missing params" };
    const allTvdb = tvdb.getAllTvdbSync();
    const rec = allTvdb?.[showName];
    if (!rec) return { ok: false, error: "Show not found" };
    const cleared = [];
    for (const { season, episode, id } of cells) {
      if (!id) continue;
      try {
        const isWatched = epd.isWatched(rec.episodeData, season, episode);
        const url = urls.updateUserDataUrl(String(id));
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ PlaybackPositionTicks: 0, Played: isWatched }),
        });
        if (res.ok || res.status === 204) {
          if (Array.isArray(rec.episodeData)) {
            epd.setEpisode(rec.episodeData, season, episode, { pos: 0 });
          }
          cleared.push({ season, episode });
        } else {
          unilog(571, `Emby HTTP ${res.status} for id=${id}`);
        }
      } catch (e) {
        unilog(572, `${showName} S${season}E${episode}:`, e.message);
      }
    }
    if (cleared.length > 0) await tvdb.saveTvdbSync();
    return { ok: true, cleared, episodeData: rec.episodeData };
  }),
);
app.post("/api/searchActorsInNonEmby", apiWrapper(tvdb.searchActorsInNonEmby));
app.post("/api/getTmdb", apiWrapper(tmdb.getTmdb));
app.post("/api/searchTmdbPerson", apiWrapper(tmdb.searchPerson));
app.post("/api/getStreamProviders", apiWrapper(tmdb.getStreamProviders));
app.post("/api/getFile", apiWrapper(getFile));
app.post("/api/getSubFileIds", apiWrapper(getSubFileIds));
app.post("/api/accessTvdb", apiWrapper(tvdb.accessTvdb));
app.post("/api/getTvmazeCrew", apiWrapper(tvdb.getTvmazeCrew_cmd));
app.get("/api/getVipActors", apiWrapper(tvdb.getVipActors));
app.post("/api/setVipActors", apiWrapper(tvdb.setVipActors));
app.post("/api/migrateWatchedCount", apiWrapper(tvdb.migrateWatchedCount));
app.get("/api/getGroupCounts", apiWrapper(groupCounts.getGroupCounts));
app.get("/api/getBadGroups", (_req, res) => {
  try {
    res.json(syncBadGroupsFromDisk());
  } catch {
    res.json([]);
  }
});

app.post(
  "/api/dumpSelectedShows",
  apiWrapper(async (params) => {
    const { showNames } = params;
    if (!Array.isArray(showNames)) {
      return { success: false, error: "showNames must be an array" };
    }
    try {
      const filePath = "/root/dev/apps/tv/selected-shows.txt";
      const content = showNames.join("\n") + (showNames.length > 0 ? "\n" : "");
      await fsp.writeFile(filePath, content, "utf8");
      return { success: true, count: showNames.length, path: filePath };
    } catch (err) {
      unilog(573, "error:", err);
      return { success: false, error: err.message };
    }
  }),
);

app.get(
  "/api/getSitcoms",
  apiWrapper(async () => {
    try {
      const filePath = "/root/dev/apps/tv/sitcoms.txt";
      const content = await fsp.readFile(filePath, "utf8");
      const sitcoms = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      return { success: true, sitcoms };
    } catch (err) {
      unilog(574, "error:", err);
      return { success: false, error: err.message, sitcoms: [] };
    }
  }),
);

app.post(
  "/api/toggleBadGroup",
  apiWrapper(async ({ group }) => {
    const normalizedGroup = String(group || "")
      .trim()
      .toLowerCase();
    if (!normalizedGroup) throw new Error("group is required");

    const groups = new Set(syncBadGroupsFromDisk());
    let action = "added";
    if (groups.has(normalizedGroup)) {
      groups.delete(normalizedGroup);
      action = "removed";
    } else {
      groups.add(normalizedGroup);
    }

    const list = writeBadGroupsToDisk([...groups]);
    return { ok: true, action, group: normalizedGroup, list };
  }),
);
app.post(
  "/api/incrementGroupCount",
  apiWrapper(groupCounts.incrementGroupCount),
);
app.post(
  "/api/triggerEmbySync",
  apiWrapper(async () => {
    unilog(36, "Running full Emby sweep");
    runEmbyFullSweep("triggerEmbySync").catch((e) =>
      unilog(575, "sweep error:", e?.message || e),
    );
    return { ok: true };
  }),
);

app.post(
  "/api/requestEmbyLibraryRefresh",
  apiWrapper(async () => {
    // Fire and forget — manager throttles, dedupes, polls, and pushes WS progress
    embyRefreshManager.request("api");
    return { ok: true };
  }),
);

app.get(
  "/api/embyLibraryRefreshStatus",
  apiWrapper(async () => {
    return embyRefreshManager.getStatus();
  }),
);

app.post(
  "/api/populateFilesOnDisk",
  apiWrapper(async () => {
    const allTvdb = tvdb.getAllTvdbSync();
    let updated = 0;
    let skipped = 0;
    for (const [name, tvdbRecord] of Object.entries(allTvdb)) {
      try {
        await refreshEpisodeData(name, tvdbRecord, { sources: ["disk"] });
        updated++;
      } catch (e) {
        skipped++;
        unilog(37, `${name}: ${e.message}`);
      }
    }
    await tvdb.saveTvdbSync();
    unilog(576, `Done: updated=${updated} skipped=${skipped}`);
    return { ok: true, updated, skipped };
  }),
);

app.post(
  "/api/populateShowQuality",
  apiWrapper(async () => {
    const allTvdb = tvdb.getAllTvdbSync();
    let updated = 0;
    for (const tvdbRecord of Object.values(allTvdb)) {
      const q = epd.computeQuality(tvdbRecord.episodeData) ?? null;
      tvdbRecord.quality = q;
      if (q !== null) updated++;
    }
    await tvdb.saveTvdbSync();
    unilog(38, `Done: updated=${updated}`);
    return { ok: true, updated };
  }),
);

app.post(
  "/api/refreshAllEpisodeData",
  apiWrapper(async (params) => {
    const onlyName = params?.name || null;
    const allTvdb = tvdb.getAllTvdbSync();
    const entries = onlyName
      ? Object.entries(allTvdb).filter(([n]) => n === onlyName)
      : Object.entries(allTvdb);
    let done = 0;
    let errors = 0;
    for (const [name, rec] of entries) {
      try {
        await refreshEpisodeData(name, rec);
        done++;
      } catch (e) {
        errors++;
        unilog(39, `${name}: ${e.message}`);
      }
      if (done % 25 === 0) await tvdb.saveTvdbSync();
    }
    await tvdb.saveTvdbSync();
    unilog(40, `Done: done=${done} errors=${errors}`);
    return { ok: true, done, errors };
  }),
);

app.get(
  "/api/embyTaskStatus",
  apiWrapper(async (params) => {
    const { taskId } = params;
    if (!taskId) return { status: "notask" };
    const res = await fetch(
      `${EMBY_BASE_URL}/ScheduledTasks?api_key=${EMBY_API_KEY}`,
    );
    if (!res.ok) return { status: "fetchfailed" };
    const tasks = await res.json();
    const task = (Array.isArray(tasks) ? tasks : []).find(
      (t) => String(t?.Id) === String(taskId),
    );
    if (!task) return { status: "refreshdone" };
    const stateRaw = String(task?.State || task?.Status || "").trim();
    const state = stateRaw.toLowerCase();
    const progressNum = Number(task?.CurrentProgressPercentage);
    const hasProgress = Number.isFinite(progressNum);
    if (hasProgress && progressNum >= 100) return { status: "refreshdone" };
    if (
      state === "completed" ||
      state === "cancelling" ||
      state === "cancelled"
    )
      return { status: "refreshdone" };
    if (state === "running")
      return {
        status: "refreshing",
        taskStatus: stateRaw,
        progress: hasProgress ? progressNum : undefined,
      };
    if (state === "idle")
      return { status: "refreshdone", taskStatus: stateRaw };
    return { status: "refreshing", taskStatus: stateRaw };
  }),
);

app.post(
  "/api/refreshEmbyItem",
  apiWrapper(async (params) => {
    const { showId, showName } = params;
    if (!showId) return { success: false, error: "missing showId" };
    unilog(577, `Refreshing Emby item for ${showName} (${showId})`);
    // Read DateLastRefreshed and DateLastSaved before triggering so we can detect when either changes
    let refreshedBefore = null;
    let savedBefore = null;
    try {
      const beforeRes = await fetch(
        `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${showId}?Fields=DateLastRefreshed,DateLastSaved&api_key=${EMBY_API_KEY}`,
      );
      if (beforeRes.ok) {
        const beforeData = await beforeRes.json();
        refreshedBefore = beforeData.DateLastRefreshed || null;
        savedBefore = beforeData.DateLastSaved || null;
      }
    } catch (e) {
      unilog(578, `pre-fetch error for ${showName}:`, e.message);
    }

    const triggerTime = Date.now();
    try {
      const res = await fetch(
        `${EMBY_BASE_URL}/Items/${showId}/Refresh?Recursive=true&MetadataRefreshMode=Default&api_key=${EMBY_API_KEY}`,
        { method: "POST" },
      );
      if (!res.ok) unilog(579, `Emby returned ${res.status} for ${showName}`);
    } catch (e) {
      unilog(580, `fetch error for ${showName}:`, e.message);
    }

    // Poll until DateLastRefreshed or DateLastSaved changes (max 30s, poll every 1s)
    const POLL_INTERVAL_MS = 1000;
    const POLL_TIMEOUT_MS = 30 * 1000;
    const pollStart = Date.now();
    let refreshDone = false;
    unilog(581, `Polling for refresh completion of ${showName}`);
    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const pollRes = await fetch(
          `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${showId}?Fields=DateLastRefreshed,DateLastSaved&api_key=${EMBY_API_KEY}`,
        );
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          const refreshedAfter = pollData.DateLastRefreshed || null;
          const savedAfter = pollData.DateLastSaved || null;
          const refreshedChanged =
            refreshedAfter &&
            refreshedAfter !== refreshedBefore &&
            new Date(refreshedAfter).getTime() >= triggerTime;
          const savedChanged =
            savedAfter &&
            savedAfter !== savedBefore &&
            new Date(savedAfter).getTime() >= triggerTime;
          if (refreshedChanged || savedChanged) {
            unilog(
              582,
              `Refresh complete for ${showName} (DateLastRefreshed=${refreshedAfter}, DateLastSaved=${savedAfter})`,
            );
            refreshDone = true;
            break;
          }
        }
      } catch (pollErr) {
        unilog(583, `poll error for ${showName}:`, pollErr.message);
      }
    }
    if (!refreshDone) {
      unilog(584, `Poll timed out for ${showName}, enqueuing anyway`);
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
      unilog(41, "Missing showId or showName");
      return { success: false };
    }
    unilog(585, `Client requested gap check for: ${showName}`);
    tvdb.enqueueShowProcess(showName, { priority: true });
    return { success: true };
  }),
);

app.post(
  "/api/triggerShowSelect",
  apiWrapper(async (params) => {
    const { showName } = params;
    if (!showName) {
      unilog(42, "Missing showName");
      return { success: false };
    }
    tvdb.enqueueShowProcess(showName, { skipRotten: true });
    return { success: true };
  }),
);

// Snooze list
const SNOOZE_FILE = path.join(SRVR_DATA_DIR, "snooze-list.json");

function readSnoozeList() {
  if (!fs.existsSync(SNOOZE_FILE)) return [];
  return JSON.parse(fs.readFileSync(SNOOZE_FILE, "utf8"));
}
function writeSnoozeList(list) {
  fs.writeFileSync(SNOOZE_FILE, JSON.stringify(list), "utf8");
}

function removeFromSnoozeByShow(showName, tvdbId) {
  const list = readSnoozeList();
  const normName = String(showName || "")
    .trim()
    .toLowerCase();
  const normId = String(tvdbId || "").trim();
  const next = list.filter((s) => {
    if (normId && String(s.tvdbId || "").trim() === normId) return false;
    if (
      normName &&
      String(s.name || "")
        .trim()
        .toLowerCase() === normName
    )
      return false;
    return true;
  });
  if (next.length === list.length) return;
  writeSnoozeList(next);
  notifyClients("snoozeListUpdated", next);
  unilog(43, `removed "${showName}" from snooze list (inEmby)`);
}

app.get(
  "/api/snooze-list",
  apiWrapper(async () => readSnoozeList()),
);

app.post(
  "/api/snooze",
  apiWrapper(async ({ tvdbId, name, image, year }) => {
    const list = readSnoozeList();
    if (!list.find((s) => s.tvdbId === tvdbId)) {
      list.push({ tvdbId, name, image, year });
      writeSnoozeList(list);
    }
    return list;
  }),
);

app.post(
  "/api/unsnooze",
  apiWrapper(async ({ tvdbId }) => {
    const list = readSnoozeList().filter((s) => s.tvdbId !== tvdbId);
    writeSnoozeList(list);
    return list;
  }),
);

// CRUD operations
app.post("/api/addNoEmby", apiWrapper(addNoEmby));
app.post("/api/delNoEmby", apiWrapper(delNoEmby));
app.post("/api/addGap", apiWrapper(addGap));
app.post("/api/delGap", apiWrapper(delGap));
app.post("/api/setTvdbFields", apiWrapper(tvdb.setTvdbFields));

// Persist watched state into episodeData (used by the map for non-Emby / local
// episodes). `watchedEpis` is the legacy [[season, ep, ...], ...] array built by
// the client from the current seriesMap.
app.post(
  "/api/setWatchedEpis",
  apiWrapper(async (params) => {
    const { name, watchedEpis } = params || {};
    const allTvdb = tvdb.getAllTvdbSync();
    const rec = allTvdb?.[name];
    if (!rec) return { ok: false, error: "Show not found" };
    if (!Array.isArray(rec.episodeData)) rec.episodeData = [];
    const ed = rec.episodeData;
    const watchedSet = new Set();
    for (const row of watchedEpis || []) {
      if (!Array.isArray(row) || row.length < 1) continue;
      const [s, ...eps] = row;
      for (const e of eps) watchedSet.add(`${s}.${e}`);
    }
    // Apply watched flag to every existing episode.
    epd.forEachEpisode(ed, (s, e) => {
      epd.setEpisode(ed, s, e, { watched: watchedSet.has(`${s}.${e}`) });
    });
    // Create slots for any watched episodes not yet present.
    for (const row of watchedEpis || []) {
      if (!Array.isArray(row) || row.length < 1) continue;
      const [s, ...eps] = row;
      for (const e of eps) {
        if (!epd.getEp(ed, s, e)) epd.setEpisode(ed, s, e, { watched: true });
      }
    }
    rec.watchedCount = epd.countWatched(ed);
    await tvdb.saveTvdbSync();
    return { ok: true };
  }),
);
app.post("/api/setSharedFilters", apiWrapper(setSharedFilters));

app.get("/api/flexget-history", (req, res) => {
  try {
    const result = [];
    for (const [key, list] of Object.entries(flexgetHistory)) {
      if (!Array.isArray(list)) continue;
      const parts = key.split("\x00");
      const showName = parts[0] || "";
      const seasonKey = parts[1] || "";
      const episodeKey = parts[2] || "";
      for (const c of list) {
        if (c.sent !== null) {
          result.push({ ...c, showName, seasonKey, episodeKey });
        }
      }
    }
    result.sort((a, b) => (a.sent || "").localeCompare(b.sent || ""));
    res.json(result);
  } catch (e) {
    unilog(586, "error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/flexget-run", (req, res) => {
  runFlexgetAndProcess().catch((e) =>
    unilog(587, "manual run error:", e.message),
  );
  res.json({ ok: true });
});

app.get("/api/flexget-run-stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  if (flexgetIsRunning) {
    res.write("data: [flexget is already running]\n\n");
    res.end();
    return;
  }

  flexgetIsRunning = true;
  unilog(44, "stream run started");

  const args = [
    "-c",
    FLEXGET_CONFIG,
    "execute",
    "--tasks",
    "fetch-feeds",
    "--dump",
    "accepted",
  ];
  const child = cp.spawn(FLEXGET_CMD, args, {
    env: { ...process.env, COLUMNS: "300" },
  });

  let stdout = "";
  let clientGone = false;

  const sendLine = (line) => {
    if (!clientGone) {
      try {
        let out = line.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /, "");
        if (/^(VERBOSE|WARNING)  /.test(out)) out = out.slice(39);
        res.write(`data: ${out}\n\n`);
      } catch {}
    }
  };

  const bufferStream = (stream) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const parts = buf.split("\n");
      buf = parts.pop();
      for (const line of parts) {
        stdout += line + "\n";
        sendLine(line);
      }
    });
    stream.on("end", () => {
      if (buf) {
        stdout += buf + "\n";
        sendLine(buf);
      }
    });
  };

  bufferStream(child.stdout);
  bufferStream(child.stderr);

  req.on("close", () => {
    clientGone = true;
  });

  child.on("close", async () => {
    try {
      await processFlexgetOutput(stdout);
    } catch (e) {
      unilog(588, "stream run processing error:", e.message);
    } finally {
      flexgetIsRunning = false;
      if (!clientGone) {
        try {
          res.end();
        } catch {}
      }
    }
  });
});

app.get("/api/flexget-status", (req, res) => {
  res.json({ running: flexgetIsRunning });
});

app.get("/api/flexget-config", async (req, res) => {
  try {
    const text = await fs.promises.readFile(FLEXGET_CONFIG, "utf8");
    res.type("text/plain").send(text);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// Open qBittorrent web UI — auto-login page served from hahnca.com so the
// SID cookie is set for hahnca.com (which proxies /qbt/ to qBittorrent).
app.get("/api/qbt-open", async (req, res) => {
  const QBT_CRED_PATH = path.join(
    path.dirname(SRVR_ROOT_DIR),
    "api",
    "secrets",
    "qbt-cred.txt",
  );
  const text = await fs.promises.readFile(QBT_CRED_PATH, "utf8");
  const creds = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    creds[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const qbHost = String(creds.QB_HOST || "");
  const qbUser = encodeURIComponent(
    qbHost.includes("@") ? qbHost.split("@")[0] : creds.QB_USER || "",
  );
  const qbPass = encodeURIComponent(creds.QB_PASS || "");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Opening qBittorrent...</title>
  <style>body{font-family:sans-serif;padding:2em;color:#333}</style>
</head>
<body>
  <p>Logging in to qBittorrent...</p>
  <script>
    fetch('/qbt/api/v2/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=${qbUser}&password=${qbPass}'
    })
    .then(r => r.text())
    .then(t => {
      if (t === 'Ok.') {
        window.location.replace('/qbt/');
      } else {
        document.body.textContent = 'Login failed: ' + t;
      }
    })
    .catch(e => {
      document.body.textContent = 'Error: ' + e.message;
    });
  </script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// Video streaming with codec-aware ffmpeg transcoding
app.get("/api/stream", async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }

  // Security: path must be within tvDir or moviesDir
  const resolved = path.resolve(filePath);
  const moviesDir = "/mnt/media/movies";
  if (
    !resolved.startsWith(tvDir + "/") &&
    resolved !== tvDir &&
    !resolved.startsWith(moviesDir + "/") &&
    resolved !== moviesDir
  ) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: "file not found" });
    return;
  }

  try {
    const probeResult = cp.spawnSync(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-analyzeduration",
        "100000",
        "-probesize",
        "100000",
        "-print_format",
        "json",
        "-show_streams",
        resolved,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    if (probeResult.status !== 0)
      throw new Error(probeResult.stderr?.toString() || "ffprobe failed");
    const probeOut = probeResult.stdout.toString();
    const streams = JSON.parse(probeOut).streams || [];
    const audioStreams = streams.filter((s) => s.codec_type === "audio");
    const defaultAudioStream = audioStreams[0] || null;
    const rawAudio = req.query.audio;
    const requestedAudioIndex =
      rawAudio !== undefined ? parseInt(rawAudio, 10) : null;
    if (rawAudio !== undefined && Number.isNaN(requestedAudioIndex)) {
      res.status(400).json({ error: "invalid audio stream index" });
      return;
    }
    const selectedAudioStream =
      requestedAudioIndex == null
        ? defaultAudioStream
        : audioStreams.find((s) => s.index === requestedAudioIndex) || null;
    if (rawAudio !== undefined && !selectedAudioStream) {
      res.status(400).json({ error: "audio stream not found" });
      return;
    }
    const videoCodec = streams.find(
      (s) => s.codec_type === "video",
    )?.codec_name;
    const audioCodec = selectedAudioStream?.codec_name;
    const selectedAudioIndex = selectedAudioStream?.index ?? null;
    const audioMap =
      selectedAudioIndex != null ? `0:${selectedAudioIndex}` : null;
    const selectedAltAudio =
      selectedAudioIndex != null &&
      defaultAudioStream?.index != null &&
      selectedAudioIndex !== defaultAudioStream.index;

    const vCopy = videoCodec === "h264";
    const aCopy = audioCodec === "aac";

    if (
      vCopy &&
      aCopy &&
      resolved.toLowerCase().endsWith(".mp4") &&
      !selectedAltAudio
    ) {
      const relPath = resolved.replace("/mnt/media", "");
      const url =
        "https://hahnca.com" +
        relPath
          .split("/")
          .map((seg) => encodeURIComponent(seg))
          .join("/");
      unilog(45, `redirect to nginx: ${url}`);
      res.redirect(302, url);
      return;
    }

    const startSec = parseInt(req.query.start) || 0;
    const rawSub = req.query.sub;
    const subIdx = rawSub !== undefined ? parseInt(rawSub, 10) : null;
    const usePgsSub =
      subIdx !== null && !isNaN(subIdx) && subIdx >= 0 && subIdx <= 50;

    const ffmpegArgs =
      startSec > 0
        ? ["-ss", String(startSec), "-i", resolved]
        : ["-i", resolved];

    if (usePgsSub) {
      // Burn PGS bitmap subtitle into video stream via filter_complex overlay
      ffmpegArgs.push(
        "-filter_complex",
        `[0:v][0:${subIdx}]overlay[v]`,
        "-map",
        "[v]",
      );
      if (audioMap) {
        ffmpegArgs.push("-map", audioMap);
      }
      ffmpegArgs.push(
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "23",
        "-g",
        "48",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
      );
    } else if (vCopy) {
      // h264 video in non-MP4 container: copy the stream, ffmpeg will remux into fMP4.
      // No re-encode needed; the source GOP doesn't matter because frag_keyframe
      // will still fragment at existing keyframe boundaries (typically every 2-5s for web sources).
      ffmpegArgs.push("-map", "0:v:0");
      if (audioMap) ffmpegArgs.push("-map", audioMap);
      ffmpegArgs.push("-c:v", "copy");
      if (aCopy) {
        ffmpegArgs.push("-c:a", "copy");
      } else {
        // -ac 2: downmix 5.1/multichannel to stereo — browsers require stereo AAC
        ffmpegArgs.push("-c:a", "aac", "-b:a", "128k", "-ac", "2");
      }
    } else {
      ffmpegArgs.push(
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "23",
        "-g",
        "48",
      );
      ffmpegArgs.push("-map", "0:v:0");
      if (audioMap) ffmpegArgs.push("-map", audioMap);
      if (aCopy) {
        ffmpegArgs.push("-c:a", "copy");
      } else {
        // -ac 2: downmix 5.1/multichannel to stereo — browsers require stereo AAC
        ffmpegArgs.push("-c:a", "aac", "-b:a", "128k", "-ac", "2");
      }
    }
    ffmpegArgs.push(
      "-f",
      "mp4",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      "pipe:1",
    );

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "no-cache");

    const ffmpeg = cp.spawn("ffmpeg", ffmpegArgs);
    _activeVideoStreams++;
    _updateStreamMsg();
    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on("data", () => {});
    ffmpeg.on("error", (err) => {
      unilog(589, "ffmpeg spawn error:", err.message);
      _activeVideoStreams--;
      _updateStreamMsg();
    });
    const killFfmpeg = () => {
      if (ffmpeg.killed) return;
      ffmpeg.kill("SIGKILL");
    };
    req.on("close", killFfmpeg);
    res.on("close", killFfmpeg);
    ffmpeg.on("exit", (code) => {
      _activeVideoStreams--;
      _updateStreamMsg();
      if (code !== 0 && code !== null) unilog(46, `ffmpeg exit code ${code}`);
      if (!res.writableEnded) res.end();
    });
  } catch (err) {
    unilog(590, "error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get("/api/audio-list", async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }
  const resolved = path.resolve(filePath);
  const moviesDir2 = "/mnt/media/movies";
  if (
    !resolved.startsWith(tvDir + "/") &&
    resolved !== tvDir &&
    !resolved.startsWith(moviesDir2 + "/") &&
    resolved !== moviesDir2
  ) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  try {
    const probeOut = runFfprobe([
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      resolved,
    ]);
    const streams = JSON.parse(probeOut).streams || [];
    const tracks = streams
      .filter((s) => s.codec_type === "audio")
      .map((s, idx) => {
        const parts = [];
        const title = String(s.tags?.title || "").trim();
        const lang = String(s.tags?.language || "").trim();
        const codec = String(s.codec_name || "").trim();
        const channels = Number.isFinite(s.channels) ? `${s.channels}ch` : "";
        if (title) parts.push(title);
        else if (lang) parts.push(lang);
        else parts.push(`Track ${idx + 1}`);
        if (codec) parts.push(codec);
        if (channels) parts.push(channels);
        return {
          index: s.index,
          label: parts.join(" | "),
          isDefault: s.disposition?.default === 1,
        };
      });
    res.json(tracks);
  } catch (e) {
    unilog(591, "probe error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

function shiftVttTimestamp(ts, offsetSec) {
  const [hms, msStr] = ts.split(".");
  const [h, m, s] = hms.split(":").map(Number);
  let totalMs = (h * 3600 + m * 60 + s) * 1000 + parseInt(msStr || "0", 10);
  totalMs += Math.round(offsetSec * 1000);
  if (totalMs < 0) totalMs = 0;
  const oh = Math.floor(totalMs / 3600000);
  const om = Math.floor((totalMs % 3600000) / 60000);
  const os = Math.floor((totalMs % 60000) / 1000);
  const oms = totalMs % 1000;
  return `${String(oh).padStart(2, "0")}:${String(om).padStart(2, "0")}:${String(os).padStart(2, "0")}.${String(oms).padStart(3, "0")}`;
}

app.get("/api/subtitle-list", async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }
  const resolved = path.resolve(filePath);
  const moviesDir2 = "/mnt/media/movies";
  if (
    !resolved.startsWith(tvDir + "/") &&
    resolved !== tvDir &&
    !resolved.startsWith(moviesDir2 + "/") &&
    resolved !== moviesDir2
  ) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  const dir = path.dirname(resolved);
  const stem = resStripAlt(path.basename(resolved)).replace(/\.[^.]+$/, "");
  const tracks = [];
  try {
    const probeOut = runFfprobe([
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      resolved,
    ]);
    const streams = JSON.parse(probeOut).streams || [];
    for (const s of streams.filter((s) => s.codec_type === "subtitle")) {
      const lang = (s.tags?.language || "").toLowerCase();
      if (lang && lang !== "eng" && lang !== "en") continue;
      const label = s.tags?.title || s.tags?.language || "eng";
      const isPgs =
        s.codec_name === "hdmv_pgs_subtitle" || s.codec_name === "dvb_subtitle";
      if (isPgs && s.disposition?.forced === 1) continue;
      const isForced = !isPgs && s.disposition?.forced === 1;
      const isSdh =
        !isPgs &&
        !isForced &&
        (s.disposition?.hearing_impaired === 1 ||
          /\bsdh\b/i.test(s.tags?.title || ""));
      tracks.push({
        id: `emb-${s.index}`,
        label,
        type: isPgs ? "pgs" : isForced ? "forced" : isSdh ? "sdh" : "embedded",
        index: s.index,
      });
    }
  } catch (e) {
    unilog(592, "probe error:", e.message);
  }
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".srt") || !f.startsWith(stem)) continue;
      const suffix = f
        .slice(stem.length)
        .replace(/\.srt$/, "")
        .replace(/^\./, "");
      tracks.push({ id: `srt-${f}`, label: suffix || f, type: "srt", file: f });
    }
  } catch (e) {
    // ignore readdir errors
  }
  // TEMP: log button details for chksrt debugging
  try {
    const charFor = (t) => {
      if (t.type === "pgs") return "*";
      if (t.type === "sdh") return "H";
      if (t.type === "embedded") return "T";
      if (t.type === "forced") return "F";
      if (/\.asr\.srt$/.test(t.file || "")) return "+";
      if (/\.mb\d+\.srt$/.test(t.file || "")) return ">";
      if (/\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")) return "V";
      return "S";
    };
    const lines = [`## ${path.basename(resolved)}\n`];
    tracks.forEach((t, i) => {
      const newLabel = `${charFor(t)} ${i + 1}`;
      const filePart = t.file
        ? t.file.slice(stem.length + 1)
        : `(embedded index ${t.index})`;
      lines.push(
        `- old: \`${t.label}\`  new: \`${newLabel}\`  file: \`${filePart}\``,
      );
      if (/\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")) {
        lines.push(`  head "${path.join(dir, t.file)}"`);
        const opnTag = (t.file.match(/\.opn([A-Z2-7]{5})\.srt$/i) || [])[1];
        if (opnTag) {
          // TEMP: decode base32 tag to decimal file_id
          const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
          let fid = 0;
          for (const ch of opnTag.toUpperCase())
            fid = fid * 32 + alpha.indexOf(ch);
          lines.push(
            `  id: ${fid}  https://www.opensubtitles.com/en/subtitles/${fid}`,
          );
        }
      }
    });
    fs.appendFileSync("/root/dev/apps/tv/temp.md", lines.join("\n") + "\n\n");
  } catch (_) {}
  res.json(tracks);
});

app.get("/api/episodeSubs", async (req, res) => {
  const showName = (req.query.show || "").trim();
  const season = parseInt(req.query.s, 10);
  const episode = parseInt(req.query.e, 10);
  if (!showName || isNaN(season) || isNaN(episode)) {
    res.status(400).json({ error: "show, s, e required" });
    return;
  }
  if (showName.includes("/") || showName.includes("\\")) {
    res.status(400).json({ error: "invalid show name" });
    return;
  }
  const seasonDir = path.join(tvDir, showName, `Season ${season}`);
  let entries;
  try {
    entries = fs.readdirSync(seasonDir);
  } catch {
    res.json([]);
    return;
  }
  const seKey = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  const videoExt = /\.(mkv|mp4|avi|m4v|ts)$/i;
  const videoFile = entries.find(
    (f) => videoExt.test(f) && f.toUpperCase().includes(seKey),
  );
  if (!videoFile) {
    res.json([]);
    return;
  }
  const resolved = path.join(seasonDir, videoFile);
  const stem = videoFile.replace(/\.[^.]+$/, "");
  const tracks = [];
  try {
    const probeOut = runFfprobe([
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      resolved,
    ]);
    const streams = JSON.parse(probeOut).streams || [];
    for (const s of streams.filter((s) => s.codec_type === "subtitle")) {
      const lang = (s.tags?.language || "").toLowerCase();
      if (lang && lang !== "eng" && lang !== "en") continue;
      const label = s.tags?.title || s.tags?.language || "eng";
      const isPgs =
        s.codec_name === "hdmv_pgs_subtitle" || s.codec_name === "dvb_subtitle";
      if (isPgs && s.disposition?.forced === 1) continue;
      const isForced = !isPgs && s.disposition?.forced === 1;
      const isSdh =
        !isPgs &&
        !isForced &&
        (s.disposition?.hearing_impaired === 1 ||
          /\bsdh\b/i.test(s.tags?.title || ""));
      tracks.push({
        id: `emb-${s.index}`,
        label,
        type: isPgs ? "pgs" : isForced ? "forced" : isSdh ? "sdh" : "embedded",
        index: s.index,
      });
    }
  } catch (e) {
    unilog(593, "probe error:", e.message);
  }
  try {
    for (const f of entries) {
      if (!f.endsWith(".srt") || !f.startsWith(stem)) continue;
      const suffix = f
        .slice(stem.length)
        .replace(/\.srt$/, "")
        .replace(/^\./, "");
      tracks.push({ id: `srt-${f}`, label: suffix || f, type: "srt", file: f });
    }
  } catch (e) {
    // ignore
  }
  res.json(tracks);
});

app.get("/api/episodeStats", async (req, res) => {
  const showName = (req.query.show || "").trim();
  const season = parseInt(req.query.s, 10);
  const episode = parseInt(req.query.e, 10);
  if (!showName || isNaN(season) || isNaN(episode)) {
    res.status(400).json({ error: "show, s, e required" });
    return;
  }
  if (showName.includes("/") || showName.includes("\\")) {
    res.status(400).json({ error: "invalid show name" });
    return;
  }
  const seasonDir = path.join(tvDir, showName, `Season ${season}`);
  let entries;
  try {
    entries = fs.readdirSync(seasonDir);
  } catch {
    res.status(404).json({ error: "season not found" });
    return;
  }
  const seKey = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  const videoExt = /\.(mkv|mp4|avi|m4v|ts)$/i;
  const videoFile = entries.find(
    (f) => videoExt.test(f) && f.toUpperCase().includes(seKey),
  );
  if (!videoFile) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  const resolved = path.join(seasonDir, videoFile);

  // ffprobe
  let fileSize = null;
  let durationMins = null;
  let videoWidth = null;
  let videoHeight = null;
  let videoBitRate = null;
  let videoBitDepth = null;
  let videoFrameRate = null;
  let hdr = null;
  let audioChannels = null;
  try {
    const probeOut = runFfprobe(
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        resolved,
      ],
      4 * 1024 * 1024,
    );
    const probe = JSON.parse(probeOut);
    const fmt = probe.format || {};
    fileSize = fmt.size ? parseInt(fmt.size, 10) : null;
    durationMins = fmt.duration
      ? Math.round((parseFloat(fmt.duration) / 60) * 10) / 10
      : null;
    const fmtBitRate = fmt.bit_rate ? parseInt(fmt.bit_rate, 10) : null;
    const streams = probe.streams || [];
    const vStream = streams.find((s) => s.codec_type === "video");
    if (vStream) {
      videoWidth = vStream.width || null;
      videoHeight = vStream.height || null;
      videoBitRate = vStream.bit_rate
        ? parseInt(vStream.bit_rate, 10)
        : fmtBitRate;
      const pf = vStream.pix_fmt || "";
      if (/12/.test(pf)) videoBitDepth = 12;
      else if (/10/.test(pf)) videoBitDepth = 10;
      else videoBitDepth = 8;
      const ct = vStream.color_transfer || "";
      const cp2 = vStream.color_primaries || "";
      if (ct === "smpte2084") hdr = "HDR10";
      else if (ct === "arib-std-b67") hdr = "HLG";
      else if (cp2 === "bt2020") hdr = "HDR";
      else hdr = null;
      const fpsStr = vStream.r_frame_rate || vStream.avg_frame_rate || "";
      if (fpsStr && fpsStr.includes("/")) {
        const [num, den] = fpsStr.split("/").map(Number);
        if (den > 0) videoFrameRate = Math.round((num / den) * 1000) / 1000;
      }
    }
    const aStream = streams.find((s) => s.codec_type === "audio");
    if (aStream) {
      audioChannels = aStream.channels || null;
    }
  } catch (e) {
    unilog(594, "probe error:", e.message);
  }

  // parse-torrent-title
  const ptt =
    parseTorrentTitle(videoFile.replace(/\.[a-z0-9]{2,4}$/i, "")) || {};

  res.json({
    fileName: videoFile,
    fileSize,
    durationMins,
    videoWidth,
    videoHeight,
    videoBitRate,
    videoBitDepth,
    videoFrameRate,
    hdr,
    audioChannels,
    ptt,
  });
});

app.get("/api/subtitle", async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }
  const resolved = path.resolve(filePath);
  const moviesDir3 = "/mnt/media/movies";
  if (
    !resolved.startsWith(tvDir + "/") &&
    resolved !== tvDir &&
    !resolved.startsWith(moviesDir3 + "/") &&
    resolved !== moviesDir3
  ) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  const dir = path.dirname(resolved);
  const stem = resStripAlt(path.basename(resolved)).replace(/\.[^.]+$/, "");

  // Explicit embedded stream by index
  if (req.query.index !== undefined) {
    const idx = parseInt(req.query.index, 10);
    res.setHeader("Content-Type", "text/vtt");
    res.setHeader("Cache-Control", "no-cache");
    const ff = cp.spawn("ffmpeg", [
      "-i",
      resolved,
      "-map",
      `0:${idx}`,
      "-f",
      "webvtt",
      "pipe:1",
    ]);
    _activeSubStreams++;
    _updateStreamMsg();
    ff.stdout.pipe(res);
    ff.stderr.on("data", () => {});
    let _subDone1 = false;
    const _subDec1 = () => {
      if (!_subDone1) {
        _subDone1 = true;
        _activeSubStreams--;
        _updateStreamMsg();
      }
    };
    req.on("close", () => ff.kill("SIGKILL"));
    ff.on("error", _subDec1);
    ff.on("exit", () => {
      _subDec1();
      if (!res.writableEnded) res.end();
    });
    return;
  }

  // Explicit sidecar .srt by filename
  if (req.query.file) {
    const srtFile = path.basename(req.query.file);
    if (!srtFile.endsWith(".srt")) {
      res.status(400).json({ error: "invalid file" });
      return;
    }
    try {
      const offsetSec = parseFloat(req.query.offset || "0");
      const clampedOffset = isNaN(offsetSec)
        ? 0
        : Math.max(-10, Math.min(10, offsetSec));
      const srt = fs.readFileSync(path.join(dir, srtFile), "utf8");
      let vtt =
        "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
      if (clampedOffset !== 0) {
        vtt = vtt.replace(
          /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/g,
          (_, t1, t2) =>
            `${shiftVttTimestamp(t1, clampedOffset)} --> ${shiftVttTimestamp(t2, clampedOffset)}`,
        );
      }
      res.setHeader("Content-Type", "text/vtt");
      res.setHeader("Cache-Control", "no-cache");
      res.send(vtt);
    } catch (e) {
      unilog(595, "sidecar error:", e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
    return;
  }

  // 1. Try embedded subtitle stream first (e.g. subrip inside MKV)
  try {
    const probeOut = runFfprobe([
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      resolved,
    ]);
    const streams = JSON.parse(probeOut).streams || [];
    const subStream = streams.find((s) => s.codec_type === "subtitle");
    if (subStream) {
      const idx = subStream.index;
      res.setHeader("Content-Type", "text/vtt");
      res.setHeader("Cache-Control", "no-cache");
      const ff = cp.spawn("ffmpeg", [
        "-i",
        resolved,
        "-map",
        `0:${idx}`,
        "-f",
        "webvtt",
        "pipe:1",
      ]);
      _activeSubStreams++;
      _updateStreamMsg();
      ff.stdout.pipe(res);
      ff.stderr.on("data", () => {});
      let _subDone2 = false;
      const _subDec2 = () => {
        if (!_subDone2) {
          _subDone2 = true;
          _activeSubStreams--;
          _updateStreamMsg();
        }
      };
      req.on("close", () => ff.kill("SIGKILL"));
      ff.on("error", _subDec2);
      ff.on("exit", () => {
        _subDec2();
        if (!res.writableEnded) res.end();
      });
      return;
    }
  } catch (e) {
    unilog(596, "embedded probe error:", e.message);
  }

  // 2. Fall back to sidecar .srt matching stem (xxx.mkv matches xxx.yyy.srt)
  let srtPath = null;
  try {
    const files = fs.readdirSync(dir);
    const match = files.find((f) => f.endsWith(".srt") && f.startsWith(stem));
    if (match) srtPath = path.join(dir, match);
  } catch (e) {
    // ignore readdir errors
  }
  if (!srtPath) {
    res.status(404).json({ error: "no subtitle found" });
    return;
  }
  try {
    const srt = fs.readFileSync(srtPath, "utf8");
    const vtt =
      "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    res.setHeader("Content-Type", "text/vtt");
    res.setHeader("Cache-Control", "no-cache");
    res.send(vtt);
  } catch (e) {
    unilog(597, "sidecar error:", e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// File operations
app.post("/api/deletePath", apiWrapper(deletePath));
app.post("/api/deletePaths", apiWrapper(deletePaths));
app.post("/api/delSeasonFiles", apiWrapper(delSeasonFiles));
app.post("/api/createShowFolder", apiWrapper(createShowFolder));
app.post(
  "/api/embySync",
  apiWrapper(async () => {
    await runEmbyFullSweep("embySync");
    return { ok: true };
  }),
);
// Note: /api/embySync kept for createShowFolderAndRefreshEmby; /api/triggerEmbySync is the primary client trigger

// Subtitles
app.post("/api/subsSearch", apiWrapper(subsSearch));
app.post("/api/subsCountEpisodes", apiWrapper(subsCountEpisodes));
app.post("/api/opn/search", async (req, res) => {
  const { videoPaths } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  const moviesDir = "/mnt/media/movies";
  const results = [];
  for (const vp of videoPaths) {
    const isMovie = vp.startsWith(moviesDir + "/");
    let searchParams;
    if (isMovie) {
      const filename = path.basename(vp, path.extname(vp));
      const yearMatch = filename.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : null;
      const parsed = parseTorrentTitle(filename);
      const title =
        parseTitleFromFilename(filename, "", parsed) ||
        filename.replace(/\./g, " ");
      searchParams = { query: title, year };
    } else {
      const showName = showNameFromFilePath(vp);
      const tvdbAll = tvdb.getAllTvdbSync?.();
      let tvdbRec = tvdbAll?.[showName];
      if (!tvdbRec?.imdbId) {
        // Try to find the TVDB record via parseTitleFromFilename + smartTitleMatch
        const fname = path.basename(vp);
        const ptt = parseTorrentTitle(fname);
        const title = parseTitleFromFilename(fname, showName, ptt);
        if (title) {
          const matched = smartTitleMatch(
            title,
            Object.values(tvdbAll),
            null,
            false,
          );
          if (matched?.imdbId) tvdbRec = matched;
        }
      }
      const parsed = parseFileSeasonEpisode(vp);
      if (tvdbRec?.imdbId) {
        searchParams = {
          imdb_id: tvdbRec.imdbId,
          season: parsed?.season,
          episode: parsed?.episode,
        };
      } else {
        searchParams = {
          query: showName,
          season: parsed?.season,
          episode: parsed?.episode,
        };
      }
    }
    try {
      const data = await subsSearch(searchParams);
      const items = Array.isArray(data?.data) ? data.data : [];
      results.push({
        videoPath: vp,
        items: items.map((r) => {
          const fid = r.file_id || r.attributes?.files?.[0]?.file_id;
          return {
            file_id: fid,
            tag: encodeFileIdBase32(fid),
            release:
              r.attributes?.release ||
              r.attributes?.files?.[0]?.cd_number ||
              String(fid || ""),
          };
        }),
      });
    } catch (e) {
      results.push({ videoPath: vp, items: [], error: e.message });
    }
  }
  res.json({ results });
});
app.post("/api/deleteSubFiles", apiWrapper(deleteSubFiles));
app.post("/api/offsetSubFiles", apiWrapper(offsetSubFiles));
app.post("/api/applySubOffset", async (req, res) => {
  const { videoPath, srtFile, offsetMs } = req.body || {};
  if (typeof videoPath !== "string" || !videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  if (
    typeof srtFile !== "string" ||
    !srtFile ||
    !path.basename(srtFile).endsWith(".srt")
  ) {
    res.status(400).json({ error: "srtFile required and must be .srt" });
    return;
  }
  if (!Number.isFinite(offsetMs) || offsetMs === 0) {
    res.json({ ok: true });
    return;
  }
  const resolvedVideo = path.resolve(videoPath);
  if (!resolvedVideo.startsWith(tvDir + "/")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const srtPath = path.join(
    path.dirname(resolvedVideo),
    path.basename(srtFile),
  );
  const resolvedSrt = path.resolve(srtPath);
  if (!resolvedSrt.startsWith(tvDir + "/") || !resolvedSrt.endsWith(".srt")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!fs.existsSync(resolvedSrt)) {
    res.status(404).json({ error: "srt file not found" });
    return;
  }
  const timeLineRe =
    /^([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(\s*-->\s*)([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(.*)$/;
  let text;
  try {
    text = fs.readFileSync(resolvedSrt, "utf8");
  } catch (e) {
    res.status(500).json({ error: "read failed: " + e.message });
    return;
  }
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = timeLineRe.exec(lines[i]);
    if (!m) continue;
    const startMs = srtTimeToMs(m[1]);
    const endMs = srtTimeToMs(m[3]);
    if (startMs === null || endMs === null) continue;
    lines[i] =
      `${msToSrtTime(Math.max(0, startMs + offsetMs))}${m[2]}${msToSrtTime(Math.max(0, endMs + offsetMs))}${m[4] || ""}`;
  }
  try {
    fs.writeFileSync(resolvedSrt, lines.join("\n"), "utf8");
  } catch (e) {
    res.status(500).json({ error: "write failed: " + e.message });
    return;
  }
  res.json({ ok: true });
});

// ASR subtitle queue endpoints
app.post("/api/asr/subs/enqueue", (req, res) => {
  const { videoPaths, fromUI } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  for (const vp of [...videoPaths].reverse()) {
    const chosenPath = vp.replace(/\.[^.]+$/, "") + ".mb.chosen";
    try {
      fs.unlinkSync(chosenPath);
    } catch {}
    enqueueSubQueue(
      { videoFilePath: vp, fromUI: !!fromUI, lowPriority: false },
      true,
    );
  }
  persistSubQueue();
  doSubQueueNow();
  res.json({ ok: true, queued: videoPaths.length });
});

app.post("/api/asr/gensrt/enqueue", (req, res) => {
  const { videoPaths, fromUI } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  const entries = videoPaths.map((vp) => {
    const showName = showNameFromFilePath(vp);
    const parsed = parseFileSeasonEpisode(vp);
    return {
      videoPath: vp,
      showName,
      season: parsed?.season ?? 0,
      episode: parsed?.episode ?? 0,
      fromUI: !!fromUI,
      lowPriority: false,
      source: fromUI ? "ASR pane" : "subtitle pipeline",
      addedAt: Date.now(),
    };
  });
  addToAsrQueue(entries);
  res.json({ ok: true, queued: videoPaths.length });
});

app.post("/api/asr/emb/generate", async (req, res) => {
  const { videoPaths } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  res.json({ ok: true, queued: videoPaths.length });
  for (const vp of videoPaths) {
    await generateEmbSrts(vp, null, null, null, true).catch((e) =>
      unilog(598, "", e.message),
    );
  }
});

app.get("/api/asr/chksrt/list", (req, res) => {
  cleanChkSrtQueue();
  notifyClients("chksrt-count", subQueueChkSrt.length);
  res.json({
    count: subQueueChkSrt.length,
    path: subQueueChkSrt[0]?.videoFilePath,
  });
});

app.post("/api/asr/chksrt/enqueue", (req, res) => {
  const { videoPaths } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  for (const vp of videoPaths) {
    enqueueSubQueueChkSrt(
      { videoFilePath: vp, fromUI: true, lowPriority: false },
      false,
    );
  }
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  notifyClients("chksrt-count", subQueueChkSrt.length);
  res.json({ ok: true, queued: videoPaths.length });
});

app.post("/api/asr/chksrt/ok", (req, res) => {
  const entry = subQueueChkSrt[0];
  if (entry) {
    const base = resStripAlt(entry.videoFilePath).replace(/\.[^.]+$/, "");
    const dir = path.dirname(entry.videoFilePath);
    const basename = path.basename(base);
    let hasSrt = false;
    try {
      hasSrt = fs
        .readdirSync(dir)
        .some((f) => f.startsWith(basename) && f.endsWith(".srt"));
    } catch {}
    if (!hasSrt) {
      try {
        fs.writeFileSync(path.join(dir, basename + ".mb.chosen"), "", "utf8");
      } catch {}
    }
  }
  subQueueChkSrt.shift();
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  notifyClients("chksrt-count", subQueueChkSrt.length);
  res.json({ ok: true });
});

app.post("/api/asr/chksrt/gensrt", (req, res) => {
  const entry = subQueueChkSrt.shift();
  if (entry) {
    const showName = showNameFromFilePath(entry.videoFilePath);
    const parsed = parseFileSeasonEpisode(entry.videoFilePath);
    addToAsrQueue([
      {
        videoPath: entry.videoFilePath,
        showName,
        season: parsed?.season ?? 0,
        episode: parsed?.episode ?? 0,
        fromUI: false,
        lowPriority: false,
        source: "chksrt player",
        addedAt: Date.now(),
      },
    ]);
  }
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  notifyClients("chksrt-count", subQueueChkSrt.length);
  res.json({ ok: true });
});

app.post("/api/asr/chksrt/snooze", (req, res) => {
  const { videoPath } = req.body || {};
  if (!videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  const showName = showNameFromFilePath(videoPath);
  const idx = subQueueChkSrt.findIndex((e) => e.videoFilePath === videoPath);
  if (idx !== -1) subQueueChkSrt.splice(idx, 1);
  addToChksrtSnoozed(showName, videoPath);
  unilog(47, `chksrt snooze: ${videoPath}`);
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  persistChksrtSnoozed();
  notifyClients("chksrt-count", subQueueChkSrt.length);
  res.json({ ok: true });
});

app.post("/api/asr/chksrt/select", (req, res) => {
  const { videoPath, selectedSrtPath } = req.body || {};
  if (!videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  const base = resStripAlt(videoPath).replace(/\.[^.]+$/, "");
  const dir = path.dirname(videoPath);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }
  const basename = path.basename(base);
  for (const f of entries) {
    if (!/\.srt$/.test(f)) continue;
    if (f.endsWith(".chosen")) continue;
    const full = path.join(dir, f);
    if (full === selectedSrtPath) continue;
    if (f.startsWith(basename + ".")) {
      try {
        fs.unlinkSync(full);
      } catch {}
    }
  }
  if (!selectedSrtPath) {
    try {
      fs.writeFileSync(path.join(dir, basename + ".mb.chosen"), "", "utf8");
    } catch {}
  }
  const idx = subQueueChkSrt.findIndex((e) => e.videoFilePath === videoPath);
  if (idx !== -1) subQueueChkSrt.splice(idx, 1);
  cleanChkSrtQueue();
  persistSubQueueChkSrt();
  notifyClients("chksrt-count", subQueueChkSrt.length);
  res.json({ ok: true });
});

app.get("/api/asr/chksrt/history", (req, res) => {
  res.json(chksrtHistory);
});

app.post("/api/asr/chksrt/history/add", (req, res) => {
  const {
    showName,
    videoFilename,
    embeddedCounts,
    openSubsCount,
    choice,
    embStreamIndex,
    srtFile,
  } = req.body || {};
  if (!showName || !videoFilename || !choice) {
    res.status(400).json({ error: "showName, videoFilename, choice required" });
    return;
  }
  const entry = {
    showName: String(showName),
    videoFilename: String(videoFilename),
    embeddedCounts:
      embeddedCounts && typeof embeddedCounts === "object"
        ? embeddedCounts
        : {},
    openSubsCount: Number(openSubsCount) || 0,
    choice: String(choice),
    embStreamIndex: embStreamIndex != null ? Number(embStreamIndex) : null,
    srtFile: srtFile ? String(srtFile) : null,
    warned: false,
  };
  // Dedup: replace any entry with same showName + videoFilename
  chksrtHistory = chksrtHistory.filter(
    (h) =>
      h.videoFilename !== entry.videoFilename || h.showName !== entry.showName,
  );
  chksrtHistory.unshift(entry);
  if (chksrtHistory.length > 100) chksrtHistory.length = 100;
  persistChksrtHistory();
  res.json({ ok: true });
});

// Intro: get first available video file for a show
app.get("/api/introFirstFile", async (req, res) => {
  const showName = req.query.showName;
  if (!showName) {
    res.status(400).json({ ok: false, error: "showName required" });
    return;
  }
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    const record = allTvdb[showName];
    if (!record?.id) {
      res.json({ ok: false, error: "show not found" });
      return;
    }
    if (record.inEmby === false) {
      res.json({ ok: false, reason: "notInEmby" });
      return;
    }
    const seriesMap = await emby.getSeriesMap(record);
    if (!seriesMap) {
      res.json({ ok: false });
      return;
    }
    const sorted = [...seriesMap].sort((a, b) => a[0] - b[0]);
    let hasUnwatchedEpisode = false;
    let fallbackPath = null;
    let fallbackSeason = null;
    let fallbackEpisode = null;
    let fallbackId = null;
    for (const [season, episodes] of sorted) {
      const sortedEps = [...episodes].sort((a, b) => a[0] - b[0]);
      for (const [episode, ep] of sortedEps) {
        if (!fallbackPath && ep.path && !ep.noFile) {
          fallbackPath = ep.path;
          fallbackSeason = season;
          fallbackEpisode = episode;
          fallbackId = ep.id;
        }
        if (ep?.played) continue;
        hasUnwatchedEpisode = true;
        if (ep.path && !ep.noFile) {
          res.json({ ok: true, path: ep.path, season, episode, id: ep.id });
          return;
        }
      }
    }
    if (fallbackPath) {
      res.json({
        ok: true,
        path: fallbackPath,
        season: fallbackSeason,
        episode: fallbackEpisode,
        id: fallbackId,
      });
      return;
    }
    if (!hasUnwatchedEpisode) {
      res.json({ ok: false, reason: "allWatched" });
      return;
    }
    res.json({ ok: false });
  } catch (err) {
    unilog(599, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// Check whether a video file has a BIF trickplay sidecar (name-320-10.bif).
app.get("/api/hasBif", async (req, res) => {
  const videoPath = req.query.path;
  if (!videoPath) {
    res.status(400).json({ ok: false, error: "path required" });
    return;
  }
  try {
    const parsed = path.parse(videoPath);
    const bifPath = path.join(parsed.dir, `${parsed.name}-320-10.bif`);
    let hasBif = false;
    try {
      await fsp.access(bifPath);
      hasBif = true;
    } catch {
      hasBif = false;
    }
    res.json({ ok: true, hasBif });
  } catch (err) {
    unilog(600, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// Enqueue one or more video files for BIF generation.
// Body: { showName: string, paths: string[] }
app.post("/api/bif/enqueue", async (req, res) => {
  const { showName, paths } = req.body || {};
  if (!showName || !Array.isArray(paths) || paths.length === 0) {
    res.status(400).json({ ok: false, error: "showName and paths[] required" });
    return;
  }
  const lock = readBifCreating();
  const inFlightPath = lock && pidAlive(lock.pid) ? lock.bifPath : null;
  let added = 0;
  for (const videoPath of paths) {
    if (!videoPath) continue;
    const base = path.basename(videoPath);
    if (bifNeededQueue.some((o) => o.bifPath === videoPath)) {
      unilog(48, `skip (queued) ${base}`);
      continue;
    }
    if (inFlightPath === videoPath) {
      unilog(49, `skip (in-flight) ${base}`);
      continue;
    }
    const parsed = path.parse(videoPath);
    const bifDiskPath = path.join(parsed.dir, `${parsed.name}-320-10.bif`);
    try {
      await fsp.access(bifDiskPath);
      unilog(50, `skip (on-disk) ${base}`);
      continue;
    } catch {
      /* not on disk */
    }
    bifNeededQueue.push({ showName, bifPath: videoPath });
    added++;
  }
  if (added > 0) {
    persistBifNeededQueue();
    unilog(51, `enqueued ${added} file(s) for ${showName}`);
    checkBifNeededQueue();
  }
  res.json({ ok: true, added });
});

// Save a single intro field (startMark, skipDur, trimPos) for a season.
app.post("/api/saveSeasonIntro", async (req, res) => {
  const { name, season, field, value } = req.body;
  if (!name || season == null || !field) {
    res.status(400).json({ ok: false, error: "name, season, field required" });
    return;
  }
  const allTvdb = tvdb.getAllTvdbSync();
  const record = allTvdb[name];
  if (!record) {
    res.status(404).json({ ok: false, error: "show not found" });
    return;
  }
  try {
    await tvdb.saveSeasonIntro(record, season, field, value);
    res.json({ ok: true });
  } catch (err) {
    unilog(601, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.get("/api/introNextFile", async (req, res) => {
  const showName = req.query.showName;
  const currentSeason = parseInt(req.query.season, 10);
  const currentEpisode = parseInt(req.query.episode, 10);
  if (!showName || isNaN(currentSeason) || isNaN(currentEpisode)) {
    res
      .status(400)
      .json({ ok: false, error: "showName, season, episode required" });
    return;
  }
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    const record = allTvdb[showName];
    if (!record?.id) {
      res.json({ ok: false, error: "show not found" });
      return;
    }
    if (record.inEmby === false) {
      res.json({ ok: false, reason: "notInEmby" });
      return;
    }
    const seriesMap = await emby.getSeriesMap(record);
    if (!seriesMap) {
      res.json({ ok: false });
      return;
    }
    const sorted = [...seriesMap].sort((a, b) => a[0] - b[0]);
    let found = false;
    for (const [season, episodes] of sorted) {
      const sortedEps = [...episodes].sort((a, b) => a[0] - b[0]);
      for (const [episode, ep] of sortedEps) {
        if (!found) {
          if (season === currentSeason && episode === currentEpisode)
            found = true;
          continue;
        }
        if (ep?.path && !ep?.noFile) {
          res.json({ ok: true, path: ep.path, season, episode, id: ep.id });
          return;
        }
      }
    }
    res.json({ ok: false, reason: "noNextEpisode" });
  } catch (err) {
    unilog(602, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// Intro: skip forward by skipDur on the specified device
async function doSkipIntro(pressedAt, deviceName = "Living Room TV") {
  const sessRes = await fetch(
    `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
    { headers: { Accept: "application/json" } },
  );
  if (!sessRes.ok) {
    unilog(52, `sessions fetch failed: ${sessRes.status}`);
    return { ok: false, error: `sessions ${sessRes.status}` };
  }
  const sessions = await sessRes.json();
  const session = sessions.find(
    (s) => s.NowPlayingItem && s.DeviceName === deviceName,
  );
  if (!session) {
    const deviceNames = sessions.map((s) => s.DeviceName).join(", ");
    const playingDevices = sessions
      .filter((s) => s.NowPlayingItem)
      .map((s) => s.DeviceName);
    unilog(603, `no ${deviceName} session. devices: ${deviceNames}`);
    return {
      ok: false,
      reason: "notPlaying",
      requestedDevice: deviceName,
      playingDevices,
      allDevices: sessions.map((s) => s.DeviceName),
    };
  }
  const rawPositionTicks = session.PlayState?.PositionTicks ?? 0;
  const pressDelay = pressedAt ? Math.max(0, Date.now() - pressedAt) : 0;
  const positionTicks = Math.max(0, rawPositionTicks - pressDelay * 10000);
  const showName =
    session.NowPlayingItem.SeriesName || session.NowPlayingItem.Name;
  const allTvdb = tvdb.getAllTvdbSync();
  const showId = session.NowPlayingItem.SeriesId || session.NowPlayingItem.Id;
  let record = allTvdb[showName];
  if (!record) {
    record = Object.values(allTvdb).find((r) => r.id === showId);
  }
  const season = session.NowPlayingItem.ParentIndexNumber ?? null;
  const skipDur = tvdb.getSeasonIntro(record, season).skipDur;
  if (!skipDur || skipDur <= 0) {
    unilog(53, `no skipDur for show: ${showName}`);
    return { ok: false, reason: "noSkipDur" };
  }
  // Skipping: jump ahead by skipDur from current position.
  const newTicks = Math.round(positionTicks + skipDur * 10000);
  unilog(
    604,
    `show=${showName} pressDelay=${pressDelay}ms rawPos=${Math.round(rawPositionTicks / 10000)}ms skipDur=${skipDur}ms newPos=${Math.round(newTicks / 10000)}ms`,
  );
  const seekRes = await fetch(
    `${EMBY_BASE_URL}/Sessions/${session.Id}/Playing/seek?SeekPositionTicks=${newTicks}&api_key=${EMBY_API_KEY}`,
    { method: "POST", headers: { Accept: "application/json" } },
  );
  if (!seekRes.ok) {
    unilog(54, `seek failed: ${seekRes.status}`);
    return { ok: false, error: `seek ${seekRes.status}` };
  }
  return { ok: true };
}

app.post("/api/skipIntro", async (req, res) => {
  try {
    const { pressedAt, deviceName } = req.body || {};
    const result = await doSkipIntro(pressedAt, deviceName);
    res.json(result);
  } catch (err) {
    unilog(605, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

// Intro: trimming — seek to absolute trimPos position on the specified device
async function doTrimIntro(deviceName = "Living Room TV") {
  const sessRes = await fetch(
    `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
    { headers: { Accept: "application/json" } },
  );
  if (!sessRes.ok) {
    unilog(55, `sessions fetch failed: ${sessRes.status}`);
    return { ok: false, error: `sessions ${sessRes.status}` };
  }
  const sessions = await sessRes.json();
  const session = sessions.find(
    (s) => s.NowPlayingItem && s.DeviceName === deviceName,
  );
  if (!session) {
    return { ok: false, reason: "notPlaying" };
  }
  const showName =
    session.NowPlayingItem.SeriesName || session.NowPlayingItem.Name;
  const allTvdb = tvdb.getAllTvdbSync();
  const showId = session.NowPlayingItem.SeriesId || session.NowPlayingItem.Id;
  let record = allTvdb[showName];
  if (!record) {
    record = Object.values(allTvdb).find((r) => r.id === showId);
  }
  const season = session.NowPlayingItem.ParentIndexNumber ?? null;
  const trimPos = tvdb.getSeasonIntro(record, season).trimPos;
  if (!trimPos || trimPos <= 0) {
    unilog(56, `no trimPos for show: ${showName}`);
    return { ok: false, reason: "noTrimPos" };
  }
  const newTicks = Math.round(trimPos * 10000);
  unilog(
    606,
    `show=${showName} trimPos=${trimPos}ms newPos=${Math.round(newTicks / 10000)}ms`,
  );
  const seekRes = await fetch(
    `${EMBY_BASE_URL}/Sessions/${session.Id}/Playing/seek?SeekPositionTicks=${newTicks}&api_key=${EMBY_API_KEY}`,
    { method: "POST", headers: { Accept: "application/json" } },
  );
  if (!seekRes.ok) {
    unilog(57, `seek failed: ${seekRes.status}`);
    return { ok: false, error: `seek ${seekRes.status}` };
  }
  return { ok: true };
}

app.post("/api/trimIntro", async (req, res) => {
  try {
    const { deviceName } = req.body || {};
    const result = await doTrimIntro(deviceName);
    res.json(result);
  } catch (err) {
    unilog(607, "error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

//////////  EMBY WEB INTRO OVERLAY (tampermonkey emby-ui.user.js)  //////////
// The intro UI lives on the Emby web page; this thin overlay sends button
// presses over the WebSocket and the server does all logic + Emby control.

// Format ms as the intro pane does: "m:ss.t" / "s.t"; 0 -> "--"; null -> ""
function fmtIntroPos(ms) {
  if (ms == null) return "";
  if (ms === 0) return "--";
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec - min * 60;
  const tenth = Math.floor((sec % 1) * 10);
  const wholeSec = Math.floor(sec);
  if (min > 0) return `${min}:${String(wholeSec).padStart(2, "0")}.${tenth}`;
  return `${wholeSec}.${tenth}`;
}

function pushEmbyText(ws, textId, text) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(
      JSON.stringify({
        id: 0,
        notification: "embyText",
        data: { textId, text: text == null ? "" : String(text) },
      }),
    );
  } catch (e) {
    unilog(608, "send error:", e.message);
  }
}

function introTitleText(record, showName, season, episode) {
  const name = record?.name || showName || "";
  let se = "";
  if (season != null && episode != null) {
    se = ` (s${String(season).padStart(2, "0")}e${String(episode).padStart(2, "0")})`;
  }
  const all = tvdb.getAllTvdbSync?.() || {};
  const introCount = Object.values(all).filter((r) => r?.needsIntro).length;
  const prefix = introCount > 0 ? `(${introCount}) ` : "";
  return `${prefix}${name}${se}`;
}

function pushIntroState(ws, record, showName, season, episode) {
  const si = tvdb.getSeasonIntro(record, season);
  pushEmbyText(ws, "title", introTitleText(record, showName, season, episode));
  pushEmbyText(ws, "startMark", fmtIntroPos(si.startMark ?? 0));
  pushEmbyText(ws, "trim", fmtIntroPos(si.trimPos ?? null));
  pushEmbyText(ws, "skip", fmtIntroPos(si.skipDur ?? null));
  pushEmbyText(ws, "ant", record?.anticipating ? "ANT" : "Ant");
}

async function embySeekTicks(sessionId, ticks, runtimeTicks) {
  let t = Math.max(0, Math.round(ticks));
  if (runtimeTicks && t > runtimeTicks) t = runtimeTicks; // past end -> seek to end
  const res = await fetch(
    `${EMBY_BASE_URL}/Sessions/${sessionId}/Playing/seek?SeekPositionTicks=${t}&api_key=${EMBY_API_KEY}`,
    { method: "POST", headers: { Accept: "application/json" } },
  );
  if (!res.ok) unilog(609, `seek failed: ${res.status}`);
}

// Find the playing session + tvdb record for a device name
async function getEmbyIntroContext(deviceName) {
  if (!deviceName) return null;
  const sessRes = await fetch(
    `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
    { headers: { Accept: "application/json" } },
  );
  if (!sessRes.ok) return null;
  const sessions = await sessRes.json();
  const session = sessions.find(
    (s) => s.NowPlayingItem && s.DeviceName === deviceName,
  );
  if (!session) return null;
  const showName =
    session.NowPlayingItem.SeriesName || session.NowPlayingItem.Name;
  const allTvdb = tvdb.getAllTvdbSync();
  const showId = session.NowPlayingItem.SeriesId || session.NowPlayingItem.Id;
  let record = allTvdb[showName];
  if (!record) record = Object.values(allTvdb).find((r) => r.id === showId);
  return {
    session,
    record,
    showName,
    season: session.NowPlayingItem.ParentIndexNumber ?? null,
    episode: session.NowPlayingItem.IndexNumber ?? null,
  };
}

// Seed intro labels from the emby item id (before playback starts)
async function pushIntroStateFromItem(ws, embyItemId) {
  if (!embyItemId) return;
  try {
    const res = await fetch(
      `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${embyItemId}?api_key=${EMBY_API_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return;
    const item = await res.json();
    const showName = item.SeriesName || item.Name;
    const allTvdb = tvdb.getAllTvdbSync();
    const showId = item.SeriesId || item.Id;
    let record = allTvdb[showName];
    if (!record) record = Object.values(allTvdb).find((r) => r.id === showId);
    pushIntroState(
      ws,
      record,
      showName,
      item.ParentIndexNumber ?? null,
      item.IndexNumber ?? null,
    );
  } catch (e) {
    unilog(610, "seed error:", e.message);
  }
}

async function handleEmbyIntroPress(ws, btnId, pressedAt, videoTimeSec) {
  const ctx = await getEmbyIntroContext(ws._embyUi?.deviceName);
  if (!ctx?.session) return; // nothing playing yet
  const { session, record, showName, season, episode } = ctx;
  const name = record?.name;
  let posTicks;
  if (videoTimeSec != null) {
    // Use the browser's live video.currentTime — always accurate, never stale
    posTicks = Math.max(0, Math.round(videoTimeSec * 1000 * 10000));
  } else {
    const rawPositionTicks = session.PlayState?.PositionTicks ?? 0;
    const pressDelay = pressedAt ? Math.max(0, Date.now() - pressedAt) : 0;
    posTicks = Math.max(0, rawPositionTicks - pressDelay * 10000);
  }
  const posMs = Math.round(posTicks / 10000);
  const runtime = session.NowPlayingItem?.RunTimeTicks ?? null;
  const sid = session.Id;
  const si = tvdb.getSeasonIntro(record, season);
  const startMark = si.startMark ?? 0;

  switch (btnId) {
    case "zero":
      await embySeekTicks(sid, 0, runtime);
      break;
    case "back30":
      await embySeekTicks(sid, posTicks - 30 * 1000 * 10000, runtime);
      break;
    case "back10":
      await embySeekTicks(sid, posTicks - 10 * 1000 * 10000, runtime);
      break;
    case "back3":
      await embySeekTicks(sid, posTicks - 3 * 1000 * 10000, runtime);
      break;
    case "fwd10":
      await embySeekTicks(sid, posTicks + 10 * 1000 * 10000, runtime);
      break;
    case "fwd30":
      await embySeekTicks(sid, posTicks + 30 * 1000 * 10000, runtime);
      break;
    case "pre":
      await embySeekTicks(sid, (startMark - 3000) * 10000, runtime);
      break;
    case "trimJump":
      if (si.trimPos) await embySeekTicks(sid, si.trimPos * 10000, runtime);
      break;
    case "skipTest":
      if (si.skipDur)
        await embySeekTicks(sid, posTicks + si.skipDur * 10000, runtime);
      break;
    case "startMark":
      if (name) await tvdb.saveSeasonIntro(record, season, "startMark", posMs);
      break;
    case "trimSet":
      if (name) await tvdb.saveSeasonIntro(record, season, "trimPos", posMs);
      break;
    case "skipSet":
      if (name && posMs >= startMark)
        await tvdb.saveSeasonIntro(
          record,
          season,
          "skipDur",
          posMs - startMark,
        );
      break;
    case "trimClr":
      if (name)
        await tvdb.saveSeasonIntro(
          record,
          season,
          "trimPos",
          si.trimPos === 0 ? null : 0,
        );
      break;
    case "skipClr":
      if (name)
        await tvdb.saveSeasonIntro(
          record,
          season,
          "skipDur",
          si.skipDur === 0 ? null : 0,
        );
      break;
    case "ant":
      if (name)
        await tvdb.setTvdbFields({ name, anticipating: !record?.anticipating });
      break;
    default:
      return;
  }
  // setTvdbFields mutates allTvdb[name] in place; re-read for fresh labels
  const fresh = (name && tvdb.getAllTvdbSync()?.[name]) || record;
  pushIntroState(ws, fresh, showName, season, episode);
}

app.get("/api/introDur", async (req, res) => {
  try {
    const { showName, showId, season } = req.query;
    if (!showName && !showId) {
      res.json({
        introDur: null,
        startMark: null,
        trimPos: null,
        skipDur: null,
      });
      return;
    }
    const allTvdb = tvdb.getAllTvdbSync();
    let record = allTvdb[showName];
    if (!record && showId) {
      record = Object.values(allTvdb).find((r) => r.id === showId);
    }
    const si = tvdb.getSeasonIntro(
      record,
      season != null ? Number(season) : null,
    );
    res.json({
      introDur: record?.introDur ?? null,
      startMark: si.startMark,
      trimPos: si.trimPos,
      skipDur: si.skipDur,
    });
  } catch (err) {
    unilog(611, "error:", err.message);
    res.json({
      introDur: null,
      startMark: null,
      trimPos: null,
      skipDur: null,
      error: err.message,
    });
  }
});

// Email
app.post("/api/sendEmail", apiWrapper(sendEmailHandler));

// ASR queue and log endpoints
app.get("/api/asr/queue", (req, res) => {
  res.json({
    entries: asrQueue,
    count: asrQueue.length,
    running: genSrtRunning,
  });
});

app.post("/api/asr/queue/add", (req, res) => {
  const { videoPaths } = req.body || {};
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    res.status(400).json({ error: "videoPaths required" });
    return;
  }
  const entries = videoPaths.map((vp) => {
    const showName = showNameFromFilePath(vp);
    const parsed = parseFileSeasonEpisode(vp);
    return {
      videoPath: vp,
      showName,
      season: parsed?.season ?? 0,
      episode: parsed?.episode ?? 0,
      fromUI: true,
      lowPriority: false,
      source: "ASR pane",
      addedAt: Date.now(),
    };
  });
  addToAsrQueue(entries);
  res.json({ ok: true, count: asrQueue.length });
});

app.post("/api/asr/queue/remove", (req, res) => {
  const { videoPath } = req.body || {};
  if (!videoPath) {
    res.status(400).json({ error: "videoPath required" });
    return;
  }
  const isProcessing = genSrtRunning && asrQueue[0]?.videoPath === videoPath;
  const idx = asrQueue.findIndex((e) => e.videoPath === videoPath);
  if (idx !== -1) {
    asrQueue.splice(idx, 1);
    persistAsrQueue();
    notifyClients("asr-queue-update", {
      count: asrQueue.length,
      running: genSrtRunning,
    });
  }
  if (isProcessing && genSrtChild) {
    genSrtChild.kill("SIGTERM");
  }
  res.json({ ok: true, count: asrQueue.length });
});

app.get("/api/asr/log", (req, res) => {
  res.json({ lines: asrLogBuffer.join("\n") });
});

app.post("/api/asr/kill", (req, res) => {
  if (genSrtChild) {
    genSrtChild.kill("SIGTERM");
    res.json({ ok: true, killed: true });
  } else {
    res.json({ ok: true, killed: false });
  }
});

// Background operations
app.post(
  "/api/updateTvdb",
  apiWrapper(async () => {
    tvdb.updateTvdb();
    return "ok";
  }),
);

const HTTP_PORT = 8737;
const SRVR_INTERNAL_PORT = 8739;

// HTTPS options - use same certs as API server (located in api/cookies)
const CERT_DIR = path.join(path.dirname(SRVR_ROOT_DIR), "api", "cookies");
const httpsOptions = {
  key: fs.readFileSync(path.join(CERT_DIR, "localhost-key.pem")),
  cert: fs.readFileSync(path.join(CERT_DIR, "localhost-cert.pem")),
};

https.createServer(httpsOptions, app).listen(HTTP_PORT, () => {
  unilog(58, `HTTPS API listening on port ${HTTP_PORT}`);
  loadQueues();
  loadChksrtHistory();
  loadChksrtSnoozed();
  loadOpnCheckHistory();
  startSubQueueLoop();
  startAsrQueueLoop();
  // .bif generation: clear any stale lock, restore queue, resume work.
  try {
    fs.unlinkSync(BIF_CREATING_PATH);
  } catch {}
  loadBifNeededQueue();
  checkBifNeededQueue();
});

app.post("/internal/tv-state", (req, res) => {
  notifyClients("tvMuteState", req.body);
  res.json({ ok: true });
});

function findChksrtPreferred(showName, episodeCode) {
  for (const h of chksrtHistory) {
    if (h.showName !== showName) continue;
    const m = (h.videoFilename || "").match(/[Ss](\d+)[Ee](\d+)/);
    if (!m) continue;
    const hCode = `S${m[1].padStart(2, "0")}E${m[2].padStart(2, "0")}`;
    if (hCode !== episodeCode) continue;
    return h;
  }
  return null;
}

app.get("/internal/chksrt/preferred", (req, res) => {
  const { showName, episodeCode } = req.query;
  if (!showName || !episodeCode) {
    res.status(400).json({ error: "showName and episodeCode required" });
    return;
  }
  const entry = findChksrtPreferred(showName, episodeCode);
  if (!entry) {
    res.json(null);
    return;
  }
  res.json({
    embStreamIndex: entry.embStreamIndex ?? null,
    srtFile: entry.srtFile ?? null,
    warned: entry.warned ?? false,
  });
});

app.post("/internal/chksrt/mark-warned", (req, res) => {
  const { showName, episodeCode } = req.body || {};
  if (!showName || !episodeCode) {
    res.status(400).json({ error: "showName and episodeCode required" });
    return;
  }
  for (const h of chksrtHistory) {
    if (h.showName !== showName) continue;
    const m = (h.videoFilename || "").match(/[Ss](\d+)[Ee](\d+)/);
    if (!m) continue;
    const hCode = `S${m[1].padStart(2, "0")}E${m[2].padStart(2, "0")}`;
    if (hCode !== episodeCode) continue;
    h.warned = true;
    persistChksrtHistory();
    break;
  }
  res.json({ ok: true });
});

app.post("/internal/subtitle-mismatch", (req, res) => {
  const { showName, episodeCode } = req.body || {};
  notifyClients("subtitleMismatch", { showName, episodeCode });
  res.json({ ok: true });
});

let lastNowPlayingShowName = null;
let lastNowPlayingList = [];
let lastPlayingKeys = new Set(); // "showName|season|episode" of all currently-playing items
let lastMissingEpWarning = null;
let lastLivingRoomWasPlaying = false;
let lastAutoSkipKey = null; // "showName|season|episode" of last auto-skipped episode

async function refreshPlayedDatesForShow(showName) {
  if (!showName) return false;
  const allTvdb = tvdb.getAllTvdbSync?.();
  if (!allTvdb) return false;
  const tvdbRecord =
    allTvdb[showName] ||
    Object.values(allTvdb).find((record) => record?.name === showName);
  if (!tvdbRecord?.inEmby || !tvdbRecord?.id) return false;

  const latestPlayed = await fetchLatestPlayedInfo(tvdbRecord.id);
  if (!latestPlayed?.lastPlayedDate) return false;

  const lastPlayedChanged =
    latestPlayed.lastPlayedDate !== (tvdbRecord.lastPlayedDate || null);
  if (!lastPlayedChanged) return false;

  tvdbRecord.lastPlayedDate = latestPlayed.lastPlayedDate;
  await tvdb.saveTvdbSync();
  notifyClients("tvdbUpdated", {
    name: tvdbRecord.name || showName,
    record: tvdbRecord,
  });
  unilog(
    612,
    `refreshed lastPlayedDate for ${showName} -> ${latestPlayed.lastPlayedDate}`,
  );
  return true;
}

app.post("/internal/nowPlaying", (req, res) => {
  const { showName, playing } = req.body;
  const prevPlayingShowNames = new Set(
    (Array.isArray(lastNowPlayingList) ? lastNowPlayingList : [])
      .map((item) => item?.showName)
      .filter(Boolean),
  );
  const nextPlayingList = Array.isArray(playing) ? playing : [];
  const nextPlayingShowNames = new Set(
    nextPlayingList.map((item) => item?.showName).filter(Boolean),
  );
  const stoppedShowNames = [...prevPlayingShowNames].filter(
    (name) => !nextPlayingShowNames.has(name),
  );

  lastNowPlayingShowName = showName ?? null;
  lastNowPlayingList = nextPlayingList;
  if (lastNowPlayingList.length === 0) {
    lastMissingEpWarning = null;
  } else if (lastMissingEpWarning) {
    const stillPlaying = lastNowPlayingList.some(
      (p) =>
        p.device === lastMissingEpWarning.device &&
        p.showName === lastMissingEpWarning.showName,
    );
    if (!stillPlaying) lastMissingEpWarning = null;
  }
  notifyClients("nowPlaying", {
    showName: lastNowPlayingShowName,
    playing: lastNowPlayingList,
  });
  view.recordNowPlaying(lastNowPlayingShowName);
  res.json({ ok: true });

  // Refresh intro-overlay labels for any intro UI tab whose device is now playing
  for (const ws of connectedClients) {
    const ui = ws._embyUi;
    if (!ui || ui.uiId !== "intro" || ws.readyState !== 1) continue;
    const item = lastNowPlayingList.find((p) => p.device === ui.deviceName);
    if (!item) continue;
    // Only push to tabs viewing the same item
    if (ui.embyItemId && item.id && ui.embyItemId !== item.id) continue;
    const record = tvdb.getAllTvdbSync()?.[item.showName];
    pushIntroState(ws, record, item.showName, item.season, item.episode);
  }

  // Auto-skip: detect not-playing -> playing from start
  const lrtv = lastNowPlayingList.find((p) => p.device === "Living Room TV");
  const isNowPlaying = !!lrtv;
  if (
    !lastLivingRoomWasPlaying &&
    isNowPlaying &&
    (lrtv.positionTicks ?? 0) < 3 * 1000 * 10000
  ) {
    const skipKey = `${lrtv.showName}|${lrtv.season}|${lrtv.episode}`;
    const allTvdb = tvdb.getAllTvdbSync();
    const record = allTvdb?.[lrtv.showName];
    const trimPos = tvdb.getSeasonIntro(record, lrtv.season).trimPos;
    if (trimPos > 0 && skipKey !== lastAutoSkipKey) {
      lastAutoSkipKey = skipKey;
      setTimeout(() => {
        doTrimIntro().catch((e) => unilog(613, "error:", e.message));
      }, 2000);
    }
  }
  if (!isNowPlaying) lastAutoSkipKey = null;
  lastLivingRoomWasPlaying = isNowPlaying;

  checkMissingEpisodes(lastNowPlayingList).catch(() => {});
  for (const stoppedShowName of stoppedShowNames) {
    refreshPlayedDatesForShow(stoppedShowName).catch((err) => {
      unilog(
        614,
        `failed to refresh played dates for ${stoppedShowName}:`,
        err.message,
      );
    });
  }
});

async function checkMissingEpisodes(playing) {
  const currentKeys = new Set(
    playing
      .filter(
        (p) => p.showName && p.device && p.season != null && p.episode != null,
      )
      .map((p) => `${p.showName}|${p.season}|${p.episode}`),
  );
  for (const k of lastPlayingKeys) {
    if (!currentKeys.has(k)) lastPlayingKeys.delete(k);
  }

  for (const item of playing) {
    const { showName, device, season, episode } = item;
    if (!showName || !device || season == null || episode == null) continue;

    const key = `${showName}|${season}|${episode}`;
    if (lastPlayingKeys.has(key)) continue;
    lastPlayingKeys.add(key);

    const allTvdbData = tvdb.getAllTvdbSync();
    const tvdbRecord = allTvdbData?.[showName];

    // New episode started — check for unwatched episodes before this one
    if (!tvdbRecord?.id) continue;

    let seriesMap;
    try {
      seriesMap = await emby.getSeriesMap({ id: tvdbRecord.id });
    } catch (_) {
      continue;
    }
    if (!Array.isArray(seriesMap)) continue;

    let missingSeason = null;
    let missingEpisode = null;
    outer: for (const [s, episodes] of seriesMap) {
      if (s > season) break;
      for (const [e, data] of episodes) {
        if (s === season && e >= episode) break outer;
        if (!data.played) {
          missingSeason = s;
          missingEpisode = e;
          break outer;
        }
      }
    }

    if (missingSeason !== null) {
      const warningData = {
        showName,
        missingSeason,
        missingEpisode,
        currentSeason: season,
        currentEpisode: episode,
        device,
      };
      lastMissingEpWarning = warningData;
      notifyClients("missingEpisodeWarning", warningData);
    }
  }
}

http.createServer(app).listen(SRVR_INTERNAL_PORT, "127.0.0.1", () => {
  unilog(59, `Internal HTTP listening on port ${SRVR_INTERNAL_PORT}`);
});

//////////////////  WEBSOCKET SERVER  //////////////////

const wss = new WebSocketServer({ port: 8736 });
unilog(60, "wss listening on port 8736");

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
        unilog(615, "send error:", e.message);
      }
    }
  }
};

// GLOBAL-MSG: server-side entry point (see global-msg-instr.md). Broadcasts a
// message object to all clients with the same signature as the client
// setGlobalMessage(): { id, action, text, position, duration }.
// Also maintains activeServerMessages so new connections can be caught up.
const activeServerMessages = new Map(); // id -> msgObj

export const setGlobalMessage = (msgObj) => {
  if (msgObj && msgObj.id) {
    const id = String(msgObj.id);
    if (msgObj.action === "hide") {
      activeServerMessages.delete(id);
    } else {
      activeServerMessages.set(id, msgObj);
    }
  }
  notifyClients("setGlobalMessage", msgObj);
};

// GLOBAL-MSG: Down + CPU — periodic producers pushed to all clients.
const DOWN_INPROGRESS_PATH = path.join(
  path.dirname(SRVR_ROOT_DIR),
  "down",
  "data",
  "tv-inProgress.json",
);
const GLOBAL_MSG_POLL_MS = 5000;
const CPU_STALL_THRESHOLD = 1; // percent; below this, nothing important is starved

const pollGlobalMessages = () => {
  // GLOBAL-MSG: CPU stall — PSI "full" avg10 from /proc/pressure/cpu. This is the
  // % of the last 10s that even normal-priority work (Emby transcodes, live
  // streaming) was stalled waiting for CPU. It stays 0 while streaming has the
  // CPU it needs (batch work runs SCHED_IDLE and yields), and only climbs when
  // the box is genuinely oversubscribed. Far more meaningful than load average.
  try {
    const psi = fs.readFileSync("/proc/pressure/cpu", "utf8");
    const m = /full\s+avg10=([\d.]+)/.exec(psi);
    const full10 = m ? parseFloat(m[1]) : 0;
    setGlobalMessage({
      id: "CPU",
      text: `Cpu:${Math.round(full10)}`,
      position: 1001,
    });
  } catch (e) {
    unilog(616, "cpu psi error:", e.message);
  }
  // GLOBAL-MSG: Down
  try {
    syncBatchMsgs(); // safety refresh in case any queue update was missed
    let count = 0;
    if (fs.existsSync(DOWN_INPROGRESS_PATH)) {
      const map = JSON.parse(fs.readFileSync(DOWN_INPROGRESS_PATH, "utf8"));
      count = map && typeof map === "object" ? Object.keys(map).length : 0;
    }
    if (count > 0)
      setGlobalMessage({ id: "Down", text: `Down: ${count}`, position: 11 });
    else setGlobalMessage({ id: "Down", action: "hide" });
  } catch (e) {
    unilog(617, "down poll error:", e.message);
  }
};
setInterval(pollGlobalMessages, GLOBAL_MSG_POLL_MS);

wss.on("connection", (ws) => {
  let socketName = appSocketName;
  connectedClients.add(ws);

  if (lastNowPlayingShowName !== null) {
    ws.send(
      JSON.stringify({
        id: 0,
        notification: "nowPlaying",
        data: { showName: lastNowPlayingShowName, playing: lastNowPlayingList },
      }),
    );
  }
  if (lastMissingEpWarning !== null) {
    ws.send(
      JSON.stringify({
        id: 0,
        notification: "missingEpisodeWarning",
        data: lastMissingEpWarning,
      }),
    );
  }

  // GLOBAL-MSG: replay all currently-active server messages to the new client.
  for (const msgObj of activeServerMessages.values()) {
    try {
      ws.send(
        JSON.stringify({
          id: 0,
          notification: "setGlobalMessage",
          data: msgObj,
        }),
      );
    } catch (_) {}
  }

  ws.on("message", (data) => {
    const msg = data.toString();
    let parsed;
    try {
      parsed = JSON.parse(msg);
    } catch (e) {
      unilog(618, "ignoring bad message:", msg);
      return;
    }
    const { id, fname, param } = parsed;

    if (fname == "register") {
      // client registration — no response needed
    } else if (fname == "handleAsr") {
      const asrAction = param?.action;
      if (asrAction === "kill") {
        if (genSrtChild) {
          genSrtChild.kill("SIGTERM");
          try {
            ws.send(
              JSON.stringify({ id, status: "ok", data: { killed: true } }),
            );
          } catch (_) {}
        } else {
          try {
            ws.send(
              JSON.stringify({ id, status: "ok", data: { killed: false } }),
            );
          } catch (_) {}
        }
      } else {
        try {
          ws.send(JSON.stringify({ id, status: "ok", data: null }));
        } catch (_) {}
      }
    } else if (fname == "handleFix") {
      handleFix(ws, id, param);
    } else if (fname == "handleEmb") {
      handleEmb(ws, id, param);
    } else if (fname === "tvRemoteAction") {
      // Broadcast to other clients only; sender handles its own avoidance locally
      const otherClients = [...connectedClients].filter(
        (c) => c !== ws && c.readyState === 1,
      );
      const outMsg = JSON.stringify({
        id: 0,
        notification: "tvRemoteAction",
        data: param,
      });
      for (const client of otherClients) {
        try {
          client.send(outMsg);
        } catch (_) {}
      }
    } else if (fname === "skipIntro") {
      const pressedAt = param?.pressedAt;
      doSkipIntro(pressedAt).catch((err) => unilog(619, "error:", err.message));
    } else if (fname === "embyHello") {
      ws._embyUi = {
        uiId: param?.uiId ?? null,
        deviceName: param?.deviceName ?? null,
        embyItemId: param?.embyItemId ?? null,
      };
      if (param?.uiId === "intro") {
        pushIntroStateFromItem(ws, param?.embyItemId).catch((e) =>
          unilog(620, "error:", e.message),
        );
      }
    } else if (fname === "embyPress") {
      if (ws._embyUi?.uiId === "intro") {
        handleEmbyIntroPress(
          ws,
          param?.btnId,
          param?.pressedAt,
          param?.videoTimeSec,
        ).catch((e) => unilog(621, "error:", e.message));
      }
    } else if (fname === "tvRemoteCollision") {
      notifyClients("tvRemoteLock", null);
    } else if (fname === "unilogSubscribe") {
      unilogSubscribers.add(ws);
    } else if (fname === "unilogUnsubscribe") {
      unilogSubscribers.delete(ws);
      maybeUnilogPrune();
    } else if (fname === "tvRemoteUnlock") {
      const outMsg = JSON.stringify({
        id: 0,
        notification: "tvRemoteUnlock",
        data: null,
      });
      for (const client of connectedClients) {
        if (client !== ws && client.readyState === 1) {
          try {
            client.send(outMsg);
          } catch (_) {}
        }
      }
    } else {
      unilog(622, "WebSocket function not supported (use HTTP):", fname);
      try {
        ws.send(
          JSON.stringify({
            id,
            status: "err",
            data: "Use HTTP API for non-streaming calls",
          }),
        );
      } catch (e) {
        unilog(623, "ws.send error:", e);
      }
    }
  });

  ws.on("error", (err) => {
    unilog(624, socketName, "error:", err.message);
    connectedClients.delete(ws);
    unilogSubscribers.delete(ws);
    maybeUnilogPrune();
    socketName = "unknown websocket";
  });

  ws.on("close", () => {
    // log(socketName + ' closed');
    connectedClients.delete(ws);
    unilogSubscribers.delete(ws);
    maybeUnilogPrune();
    socketName = "unknown websocket";
  });
});

// ==================== FLEXGET PROCESSING ====================

async function addUrlToQbt(torrentUrl) {
  const credText = await fs.promises.readFile(QBT_CRED_PATH_FLEX, "utf8");
  const creds = {};
  for (const rawLine of credText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    creds[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const qbHostRaw = String(creds.QB_HOST || "localhost");
  const qbHost = qbHostRaw.includes("@")
    ? qbHostRaw.split("@").slice(-1)[0]
    : qbHostRaw;
  const qbPort = parseInt(String(creds.QB_PORT || "8080"), 10) || 8080;
  const qbUser = qbHostRaw.includes("@")
    ? qbHostRaw.split("@")[0]
    : String(creds.QB_USER || "");
  const qbPass = String(creds.QB_PASS || "");
  const baseUrl = `https://${qbHost}/qbittorrent/`;

  const loginParams = new URLSearchParams({
    username: qbUser,
    password: qbPass,
  });
  const loginRes = await fetch(`${baseUrl}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
    body: loginParams.toString(),
  });
  const cookie = loginRes.headers.get("set-cookie") || "";

  const form = new FormData();
  form.append("urls", torrentUrl);
  form.append("category", "tv");
  const addRes = await fetch(`${baseUrl}/api/v2/torrents/add`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: baseUrl, Referer: `${baseUrl}/` },
    body: form,
  });
  const resText = await addRes.text().catch(() => "");
  const t = resText.trim().toLowerCase();
  if (!addRes.ok || (t.length > 0 && !t.startsWith("ok"))) {
    throw new Error(`qbt add failed: HTTP ${addRes.status} ${resText}`);
  }
}

function flexgetFmtSent() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}/${get("month")}/${get("day")}-${hour}:${get("minute")}:${get("second")}`;
}

function flexgetBitDepth(title) {
  if (/10.?bit|hdr/i.test(String(title || ""))) return 10;
  return 8;
}

const badGroups = new Set(
  (() => {
    try {
      return readBadGroupsFromDisk();
    } catch {
      return [];
    }
  })(),
);

function flexgetIsBadGroup(title) {
  const parsed = parseTorrentTitle(
    String(title || "").replace(/\.[a-z0-9]{2,4}$/i, ""),
  );
  return badGroups.has((parsed?.group || "").toLowerCase());
}

// Same-run dedup: resolution → bit depth → seeds → bad group
function flexgetIsBetterSameRun(a, b) {
  const aRes = getResolution(a.quality || a.title || "") ?? 480;
  const bRes = getResolution(b.quality || b.title || "") ?? 480;
  if (aRes !== bRes) return aRes > bRes;

  const aDepth = flexgetBitDepth(a.title);
  const bDepth = flexgetBitDepth(b.title);
  if (aDepth !== bDepth) return aDepth > bDepth;

  const aSeeds = parseInt(String(a.torrent_seeds || "0"), 10) || 0;
  const bSeeds = parseInt(String(b.torrent_seeds || "0"), 10) || 0;
  if (aSeeds !== bSeeds) return aSeeds > bSeeds;

  const aBad = flexgetIsBadGroup(a.title);
  const bBad = flexgetIsBadGroup(b.title);
  if (aBad !== bBad) return bBad; // b is bad group → a is better
  return false;
}

// Cross-run comparison: resolution → bad group tiebreaker
function flexgetIsBetterCrossRun(a, b) {
  const aRes = getResolution(a.quality || a.title || "") ?? 480;
  const bRes = getResolution(b.quality || b.title || "") ?? 480;
  if (aRes !== bRes) return aRes > bRes;
  const aBad = flexgetIsBadGroup(a.title);
  const bBad = flexgetIsBadGroup(b.title);
  if (aBad !== bBad) return bBad; // b is bad group → a is better
  return false;
}

async function saveFlexgetHistory() {
  const PRUNE_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - PRUNE_MS;
  for (const key of Object.keys(flexgetHistory)) {
    const list = flexgetHistory[key];
    const maxSent = list.reduce((best, c) => {
      if (!c.sent) return best;
      const t = new Date(
        c.sent.replace(
          /^(\d{4})\/(\d{2})\/(\d{2})-(\d{2}):(\d{2}):(\d{2})$/,
          "$1-$2-$3T$4:$5:$6",
        ),
      ).getTime();
      return t > best ? t : best;
    }, 0);
    if (maxSent > 0 && maxSent < cutoff) {
      delete flexgetHistory[key];
    }
  }
  await util.writeFile(FLEXGET_HISTORY_PATH, flexgetHistory);
}

function parseResolutionStrict(title, quality) {
  const src = String(title || "") + " " + String(quality || "");
  if (/2160p/i.test(src)) return 2160;
  if (/1080p/i.test(src)) return 1080;
  if (/720p/i.test(src)) return 720;
  if (/576p/i.test(src)) return 576;
  if (/480p/i.test(src)) return 480;
  if (/384p/i.test(src)) return 384;
  return 0; // unknown — do not fall back
}

function getEpisodeDiskResolution(showPath, season, episode) {
  try {
    const sKey = `S${String(season).padStart(2, "0")}`;
    const eKey = `E${String(episode).padStart(2, "0")}`;
    const seasonDir = path.join(tvDir, showPath, `Season ${season}`);
    const files = fs.readdirSync(seasonDir);
    const videoExts = new Set([".mkv", ".mp4", ".avi", ".m4v"]);
    const epRe = new RegExp(`${sKey}${eKey}`, "i");
    for (const f of files) {
      if (!epRe.test(f)) continue;
      if (!videoExts.has(path.extname(f).toLowerCase())) continue;
      if (/2160p/i.test(f)) return 2160;
      if (/1080p/i.test(f)) return 1080;
      if (/720p/i.test(f)) return 720;
      if (/576p/i.test(f)) return 576;
      if (/480p/i.test(f)) return 480;
      if (/384p/i.test(f)) return 384;
    }
    return 0;
  } catch {
    return 0;
  }
}

function getEpisodeDiskGroup(showPath, season, episode) {
  try {
    const sKey = `S${String(season).padStart(2, "0")}`;
    const eKey = `E${String(episode).padStart(2, "0")}`;
    const seasonDir = path.join(tvDir, showPath, `Season ${season}`);
    const files = fs.readdirSync(seasonDir);
    const videoExts = new Set([".mkv", ".mp4", ".avi", ".m4v"]);
    const epRe = new RegExp(`${sKey}${eKey}`, "i");
    for (const f of files) {
      if (!epRe.test(f)) continue;
      if (!videoExts.has(path.extname(f).toLowerCase())) continue;
      const parsed = parseTorrentTitle(f.replace(/\.[a-z0-9]{2,4}$/i, ""));
      return (parsed?.group || "").toLowerCase();
    }
    return "";
  } catch {
    return "";
  }
}

function getFirstFilesOnDiskSeasonGap(diskSeasons, torrentSeason) {
  const seasons = [];

  if (Array.isArray(diskSeasons)) {
    seasons.push(...diskSeasons.filter((n) => Number.isInteger(n) && n >= 0));
  }

  if (Number.isInteger(torrentSeason) && torrentSeason >= 0) {
    seasons.push(torrentSeason);
  }

  if (seasons.length === 0) return null;

  seasons.sort((a, b) => a - b);

  const dedupedSeasons = seasons.filter(
    (seasonNum, index) => index === 0 || seasonNum !== seasons[index - 1],
  );

  let expectedSeason = dedupedSeasons[0];
  for (let i = 0; i < dedupedSeasons.length; i += 1) {
    const seasonNum = dedupedSeasons[i];
    if (seasonNum > expectedSeason) return expectedSeason;
    if (seasonNum === expectedSeason) expectedSeason += 1;
  }

  return null;
}

async function storeFlexgetRejectedCandidate(
  list,
  histKey,
  candidate,
  rawTitle,
) {
  if (!candidate.url || list.some((entry) => entry.url === candidate.url))
    return;

  list.push({
    title: rawTitle,
    url: candidate.url || null,
    quality: candidate.quality || null,
    resolution: candidate.resolution || null,
    content_size: candidate.content_size || null,
    torrent_seeds: candidate.torrent_seeds || null,
    torrent_leeches: candidate.torrent_leeches || null,
    proper: candidate.proper || null,
    release_group: candidate.release_group || null,
    task: candidate.task || null,
    regexp: candidate.regexp || null,
    provider: String(candidate.url || "").includes("iptorrents.com")
      ? "ipt"
      : String(candidate.url || "").includes("torrentleech.org")
        ? "tl"
        : null,
    sent: null,
    addedAt: flexgetFmtSent(),
  });
  flexgetHistory[histKey] = list;
  await saveFlexgetHistory();
}

async function processFlexgetCandidate(candidate, storeOnly = false) {
  const rawTitle = String(candidate.title || "").trim();
  if (!rawTitle) return;

  // Exact URL dedup — fast path before any expensive TVDB lookup
  if (candidate.url) {
    for (const list of Object.values(flexgetHistory)) {
      if (list.some((c) => c.url === candidate.url)) {
        unilog(1177, `Flexget: URL already seen "${rawTitle}"`);
        return;
      }
    }
  }

  const ptt = parseTorrentTitle(rawTitle.replace(/\.[a-z0-9]{2,4}$/i, ""));
  const showName = ptt?.title;
  const season = ptt?.season;
  let episode = ptt?.episode;
  if (!episode && Array.isArray(ptt?.episodes) && ptt.episodes.length)
    episode = ptt.episodes[0];
  const newRes = parseResolutionStrict(
    ptt?.resolution || rawTitle,
    candidate.quality,
  );

  if (!showName || !Number.isInteger(season) || !Number.isInteger(episode))
    return;
  if (episode === 0) return; // skip season packs

  const allTvdb = tvdb.getAllTvdbSync();
  const matchedName = smartTitleMatch(
    showName,
    Object.keys(allTvdb),
    null,
    false,
  );
  if (!matchedName) return;
  const rec = allTvdb[matchedName];
  if (!rec?.inEmby) return;

  const sKey = `S${String(season).padStart(2, "0")}`;
  const eKey = `E${String(episode).padStart(2, "0")}`;
  const histKey = `${matchedName}\x00${sKey}\x00${eKey}`;
  const list = flexgetHistory[histKey] || [];

  const isWatched = epd.isWatched(rec.episodeData, season, episode);
  const firstSeasonGap = getFirstFilesOnDiskSeasonGap(
    epd.seasonsWithFile(rec.episodeData),
    season,
  );
  const isPastSeasonGap = firstSeasonGap !== null && season > firstSeasonGap;

  if (isWatched || isPastSeasonGap) {
    await storeFlexgetRejectedCandidate(
      list,
      histKey,
      { ...candidate, resolution: ptt?.resolution || null },
      rawTitle,
    );
    if (isWatched) {
      unilog(
        1178,
        `Flexget: episode watched ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
      unilog(625, `SKIP(watched) ${matchedName} ${sKey}${eKey} "${rawTitle}"`);
    }
    if (isPastSeasonGap) {
      unilog(
        1179,
        `Flexget: past season gap S${String(firstSeasonGap).padStart(2, "0")} ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
      unilog(
        626,
        `SKIP(season-gap-S${String(firstSeasonGap).padStart(2, "0")}) ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
    }
    return;
  }

  const normTitle = (t) =>
    String(t || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const normQuality = (q) =>
    String(q || "")
      .toLowerCase()
      .replace(/\s+/g, "");

  const newNormTitle = normTitle(rawTitle);
  const newNormQuality = normQuality(candidate.quality);
  // Same file from a different provider: same normalized title + quality → deduplicate,
  // but prefer the entry with more seeds if this one is better.
  const sameFileIdx = list.findIndex(
    (c) =>
      normTitle(c.title) === newNormTitle &&
      normQuality(c.quality) === newNormQuality,
  );
  if (sameFileIdx !== -1) {
    const existing = list[sameFileIdx];
    const cSeeds = parseInt(String(candidate.torrent_seeds || "0"), 10) || 0;
    const eSeeds = parseInt(String(existing.torrent_seeds || "0"), 10) || 0;
    if (cSeeds > eSeeds) {
      // Update seeds/leeches/url/provider on the existing entry but keep sent timestamp
      existing.torrent_seeds =
        candidate.torrent_seeds || existing.torrent_seeds;
      existing.torrent_leeches =
        candidate.torrent_leeches || existing.torrent_leeches;
      existing.url = candidate.url || existing.url;
      existing.provider = String(candidate.url || "").includes("iptorrents.com")
        ? "ipt"
        : String(candidate.url || "").includes("torrentleech.org")
          ? "tl"
          : existing.provider;
      flexgetHistory[histKey] = list;
      await saveFlexgetHistory();
      unilog(
        1180,
        `Flexget: same file, better seeds updated ${matchedName} ${sKey}${eKey} "${rawTitle}" (${eSeeds}->${cSeeds} seeds)`,
      );
      unilog(
        627,
        `SKIP(same-file better-seeds) ${matchedName} ${sKey}${eKey} "${rawTitle}" seeds ${eSeeds}->${cSeeds}`,
      );
    } else {
      unilog(
        1181,
        `Flexget: same file from different provider ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
      unilog(
        628,
        `SKIP(same-file) ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
    }
    return;
  }

  const newCandidate = {
    title: rawTitle,
    url: candidate.url || null,
    quality: candidate.quality || null,
    resolution: ptt?.resolution || null,
    content_size: candidate.content_size || null,
    torrent_seeds: candidate.torrent_seeds || null,
    torrent_leeches: candidate.torrent_leeches || null,
    proper: candidate.proper || null,
    release_group: candidate.release_group || null,
    task: candidate.task || null,
    regexp: candidate.regexp || null,
    provider: String(candidate.url || "").includes("iptorrents.com")
      ? "ipt"
      : String(candidate.url || "").includes("torrentleech.org")
        ? "tl"
        : null,
    sent: null,
    addedAt: flexgetFmtSent(),
  };

  list.push(newCandidate);
  flexgetHistory[histKey] = list;

  // Best-quality ever sent — used to decide if a new candidate is an upgrade.
  const lastSent = list.reduce((best, c) => {
    if (c.sent === null) return best;
    if (!best) return c;
    return flexgetIsBetterCrossRun(c, best) ? c : best;
  }, null);

  const episodeOnDisk = epd.hasFile(rec.episodeData, season, episode);
  const diskRes =
    episodeOnDisk && rec.path
      ? getEpisodeDiskResolution(rec.path, season, episode)
      : 0;
  const diskGroup =
    episodeOnDisk && rec.path
      ? getEpisodeDiskGroup(rec.path, season, episode)
      : "";
  const diskIsBadGroup = diskGroup ? badGroups.has(diskGroup) : false;
  const newIsBadGroup = flexgetIsBadGroup(rawTitle);

  if (storeOnly) {
    /* skip: store-only (run-loser) */
  } else if (episodeOnDisk) {
    if (!newRes) {
      unilog(
        1182,
        `Flexget: no resolution parsed ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
      unilog(
        629,
        `SKIP(no-resolution) ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
    } else if (
      diskRes > newRes ||
      (diskRes === newRes && (!diskIsBadGroup || newIsBadGroup))
    ) {
      unilog(
        1183,
        `Flexget: disk quality ${diskRes}p >= new ${newRes}p ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
      unilog(
        630,
        `SKIP(disk-${diskRes}p>=new-${newRes}p) ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
    } else if (newCandidate.url) {
      try {
        await addUrlToQbt(newCandidate.url);
        newCandidate.sent = flexgetFmtSent();
        unilog(
          631,
          `SENT(upgrade-${diskRes}p->${newRes}p) ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
        );
      } catch (e) {
        unilog(632, `qbt add failed for "${rawTitle}":`, e.message);
      }
    }
  } else if (!lastSent) {
    if (newCandidate.url) {
      try {
        await addUrlToQbt(newCandidate.url);
        newCandidate.sent = flexgetFmtSent();
        unilog(633, `SENT(first) ${matchedName} ${sKey}${eKey} "${rawTitle}"`);
      } catch (e) {
        unilog(634, `qbt add failed for "${rawTitle}":`, e.message);
      }
    }
  } else if (flexgetIsBetterCrossRun(newCandidate, lastSent)) {
    if (newCandidate.url) {
      try {
        await addUrlToQbt(newCandidate.url);
        newCandidate.sent = flexgetFmtSent();
        unilog(
          635,
          `SENT(better) ${matchedName} ${sKey}${eKey} "${rawTitle}" over "${lastSent.title}"`,
        );
      } catch (e) {
        unilog(636, `qbt add failed for "${rawTitle}":`, e.message);
      }
    }
  } else {
    unilog(
      1184,
      `Flexget: worse quality than last sent ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
    );
    unilog(637, `SKIP(worse) ${matchedName} ${sKey}${eKey} "${rawTitle}"`);
  }
}

function parseFlexgetDumpOutput(stdout) {
  // flexget 3.x --dump output format (verified from config-test):
  //   ─── Accepted ─── (section header, one per task)
  //   title         : Number One Fan S01E03 720p WEB H264-iNSiDiOUS
  //   url           : https://...
  //   description   : 1.44 GB; TV/Web-DL (S:0 L:0)
  //   quality       : 720p webdl h264
  //   ...
  //   (empty line separates entries)
  const candidates = [];
  const lines = stdout.split(/\r?\n/);
  let inAcceptedSection = false;
  let current = null;
  for (const line of lines) {
    // Section header for accepted entries
    if (/─+\s*Accepted\s*─+/i.test(line)) {
      inAcceptedSection = true;
      continue;
    }
    // Section header for other sections ends accepted block
    if (/─+\s*(Rejected|Undecided|Failed)\s*─+/i.test(line)) {
      inAcceptedSection = false;
      if (current) {
        candidates.push(current);
        current = null;
      }
      continue;
    }
    if (!inAcceptedSection) continue;
    // Empty line = entry separator
    if (/^\s*$/.test(line)) {
      if (current) {
        candidates.push(current);
        current = null;
      }
      continue;
    }
    const fieldMatch = line.match(/^([a-z_]+)\s*:\s*(.*)$/i);
    if (fieldMatch) {
      const key = fieldMatch[1].trim().toLowerCase();
      const val = fieldMatch[2].trim();
      if (key === "title") {
        if (current) candidates.push(current);
        current = {
          title: val,
          regexp: null,
          url: null,
          quality: null,
          release_group: null,
          torrent_seeds: null,
          torrent_leeches: null,
          content_size: null,
          proper: null,
          task: null,
        };
      } else if (current) {
        if (key === "url" || key === "original_url") {
          if (!current.url)
            current.url = val
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">"); // prefer first url; decode HTML entities
        } else if (key === "quality") current.quality = val;
        else if (key === "release_group") current.release_group = val;
        else if (key === "torrent_seeds" || key === "seeds")
          current.torrent_seeds = parseInt(val, 10) || 0;
        else if (key === "torrent_leeches" || key === "leeches")
          current.torrent_leeches = parseInt(val, 10) || 0;
        else if (key === "content_size") current.content_size = val;
        else if (key === "task") current.task = val;
        else if (key === "proper") current.proper = val;
        else if (key === "reason") {
          const m = val.match(/regexp '(.+?)' matched/);
          if (m) current.regexp = m[1];
        } else if (key === "description") {
          // iptorrents: "1.44 GB; TV/Web-DL (S:4 L:4)"
          const ipMatch = val.match(/\(S:(\d+)\s+L:(\d+)\)/);
          // torrentleech: "Category: ... - Seeders: 14 - Leechers: 0"
          const tlMatch = val.match(/Seeders:\s*(\d+).*?Leechers:\s*(\d+)/i);
          const sm = ipMatch || tlMatch;
          if (sm) {
            if (current.torrent_seeds === null)
              current.torrent_seeds = parseInt(sm[1], 10);
            if (current.torrent_leeches === null)
              current.torrent_leeches = parseInt(sm[2], 10);
          }
        }
      }
    }
  }
  if (current) candidates.push(current);
  return candidates;
}

async function processFlexgetOutput(stdout) {
  const candidates = parseFlexgetDumpOutput(stdout);
  if (candidates.length === 0) {
    unilog(61, "no accepted entries");
    return;
  }
  unilog(62, `processing ${candidates.length} accepted candidates`);

  const runGroups = new Map();
  for (let i = 0; i < candidates.length; i++) {
    const rawTitle = String(candidates[i].title || "").trim();
    const ptt = parseTorrentTitle(rawTitle.replace(/\.[a-z0-9]{2,4}$/i, ""));
    const sn = ptt?.title;
    let ep = ptt?.episode;
    if (!ep && Array.isArray(ptt?.episodes) && ptt.episodes.length)
      ep = ptt.episodes[0];
    const roughKey =
      sn && Number.isInteger(ptt?.season) && Number.isInteger(ep)
        ? `${sn}\x00${ptt.season}\x00${ep}`
        : `__solo__${i}`;
    if (!runGroups.has(roughKey)) runGroups.set(roughKey, []);
    runGroups.get(roughKey).push(i);
  }

  const storeOnlySet = new Set();
  for (const indices of runGroups.values()) {
    if (indices.length <= 1) continue;
    let bestIdx = indices[0];
    for (let j = 1; j < indices.length; j++) {
      if (flexgetIsBetterSameRun(candidates[indices[j]], candidates[bestIdx])) {
        storeOnlySet.add(bestIdx);
        bestIdx = indices[j];
      } else {
        storeOnlySet.add(indices[j]);
      }
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    try {
      await processFlexgetCandidate(candidates[i], storeOnlySet.has(i));
    } catch (e) {
      unilog(638, "processCandidate error:", e.message);
    }
  }
  await saveFlexgetHistory();
}

async function runFlexgetAndProcess() {
  if (flexgetIsRunning) return;
  flexgetIsRunning = true;
  try {
    const cmd = `"${FLEXGET_CMD}" -c "${FLEXGET_CONFIG}" execute --tasks fetch-feeds --dump accepted 2>&1`;
    unilog(63, `running flexget execute --tasks fetch-feeds`);
    let stdout = "";
    try {
      const result = await exec(cmd, {
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, COLUMNS: "300" },
      });
      stdout = String(result.stdout || "");
    } catch (e) {
      stdout = String(e.stdout || e.message || "");
      unilog(639, "execute error:", String(e.message || "").slice(0, 200));
    }
    await processFlexgetOutput(stdout);
  } finally {
    flexgetIsRunning = false;
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
  unilog(64, "CALLED - function executing");
  try {
    unilog(65, "Starting...");

    // Get all tvdb records
    const allTvdb = tvdb.getAllTvdbSync();
    const changedShows = []; // Track which shows changed
    if (!allTvdb || Object.keys(allTvdb).length === 0) {
      unilog(66, "syncEmbyUserData: No tvdb records to sync");
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

    unilog(67, "Fetches completed");

    if (!embyResp.ok) {
      unilog(640, "syncEmbyUserData: Emby fetch failed:", embyResp.status);
      return;
    }

    const embyData = await embyResp.json();
    const embyShows = embyData.Items || [];

    // Get collection IDs (handle fetch failures gracefully)
    const toTryData = toTryResp.ok ? await toTryResp.json() : null;
    const continueData = continueResp.ok ? await continueResp.json() : null;
    const markData = markResp.ok ? await markResp.json() : null;
    const lindaData = lindaResp.ok ? await lindaResp.json() : null;

    unilog(641, `Collection responses:`, {
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

    unilog(642, `About to process ${embyShows.length} shows`);
    unilog(
      643,
      `Collection sets sizes: toTry=${toTryIdSet.size}, continue=${continueIdSet.size}, mark=${markIdSet.size}, linda=${lindaIdSet.size}`,
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
        unilog(644, `${name}:`, {
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
        unilog(645, `${name}:`, {
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

        if (tvdbRecord.sync) delete tvdbRecord.sync.lastEmbySync;
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

    unilog(646, `Loop completed, ${updatedCount} shows changed`);

    if (updatedCount > 0) {
      await tvdb.saveTvdbSync();
      unilog(
        647,
        `Changes: ${userDataChangeCount} userData, ${collectionsChangeCount} collections, ${rejectsPickupsChangeCount} rejects/pickups`,
      );

      // Trigger gap check for changed shows after 3 second delay
      // This allows both Emby and disk operations to settle (e.g., delete show + delete folder)
      if (changedShows.length > 0) {
        const logMsg =
          changedShows.length === 1
            ? `[emby change] Checking 1 show: ${changedShows[0].showName}`
            : `[emby change] Checking ${changedShows.length} shows`;
        unilog(648, logMsg);
        setTimeout(() => {
          runGapCheckForShows(changedShows, true).catch((err) => {
            unilog(
              649,
              "syncEmbyUserData: delayed gapCheck failed:",
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
    unilog(650, "syncEmbyUserData error:", err.message);
  }
}

/**
 * Background Emby sweep: detect new/removed shows,
 * sync collections, update metadata. Server-side port of client loadAllShows steps 2-5.
 */
let embyFullSweepRunning = false;
let embyFullSweepQueued = false;
let embyFullSweepQueuedCaller = null;
async function runEmbyFullSweep(caller = "unknown") {
  if (embyFullSweepRunning) {
    embyFullSweepQueued = true;
    embyFullSweepQueuedCaller = caller;
    return;
  }
  embyFullSweepRunning = true;
  try {
    const allTvdb = tvdb.getAllTvdbSync();
    if (!allTvdb || Object.keys(allTvdb).length === 0) return;

    // Snapshot records before sweep for change detection
    const snapRecord = (rec) => JSON.stringify(rec);
    const preSnap = new Map();
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (
        rec &&
        typeof rec === "object" &&
        !Array.isArray(rec) &&
        String(rec.name || "").trim()
      ) {
        preSnap.set(name, snapRecord(rec));
      }
    }

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
      unilog(651, "Emby fetch failed:", embyResp.status);
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
      if (!tvdbId || tvdbId === "0") {
        continue;
      }
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
          unilog(652, `Blocked create for "${name}" — likely candidate exists`);
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
          dateCreated: util.toPstDateTime(embyShow.DateCreated),
          premiereDate: embyShow.PremiereDate?.substring(0, 10),
          fromEmbySync: true,
          isPlayed: embyShow.UserData?.Played || false,
          playCount: embyShow.UserData?.PlayCount || 0,
        };
        try {
          await tvdb.getNewTvdb(param);
          unilog(70, `Created tvdb record: ${name}`);
        } catch (e) {
          unilog(653, `getNewTvdb failed for "${name}":`, e.message);
        }
        continue;
      }

      // Update existing record
      tvdbRecord.id = showId;
      if (!tvdbRecord.name) {
        unilog(654, `Backfilling missing name for tvdbId=${tvdbId}: "${name}"`);
        tvdbRecord.name = name;
        if (tvdbKey !== name) {
          allTvdb[name] = tvdbRecord;
          delete allTvdb[tvdbKey];
          tvdbKey = name;
        }
      }
      if (!tvdbRecord.tvdbId && tvdbId) {
        unilog(655, `Backfilling missing tvdbId=${tvdbId} for "${name}"`);
        // If a duplicate record already owns this tvdbId, merge its TVDB metadata
        // into this Emby-linked record and delete the duplicate.
        const duplicate = findByTvdbId(tvdbId);
        if (duplicate && duplicate.key !== name) {
          unilog(
            656,
            `Merging duplicate tvdbId=${tvdbId} record "${duplicate.key}" into "${name}"`,
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
      tvdbRecord.dateCreated = util.toPstDateTime(embyShow.DateCreated);
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
        unilog(71, `Marking ${name} as not in Emby`);
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
            fs.rmSync(folderPath, { recursive: true, force: true });
            unilog(72, `Deleted folder: ${folderPath}`);
          }
        } catch (e) {
          if (e.code !== "ENOENT") {
            unilog(657, `Failed to delete folder ${folderPath}:`, e.message);
          }
        }
        rec.inEmby = false;
        rec.notReady = true;
        handlePickupChange(name, false, rec.status);
        try {
          unilog(471, "history", "remEmby", name, "Disappeared from Emby");
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
            unilog(658, `Fixing stale ${f} for ${name}: ${rec[f]}->${v}`);
            rec[f] = v;
          }
        }
      }
    }

    await tvdb.saveTvdbSync();

    // Push changed records to clients
    let pushCount = 0;
    for (const [name, rec] of Object.entries(allTvdb)) {
      if (
        !rec ||
        typeof rec !== "object" ||
        Array.isArray(rec) ||
        !String(rec.name || "").trim()
      )
        continue;
      const prev = preSnap.get(name);
      if (prev !== snapRecord(rec)) {
        debouncedTvdbPush(name);
        pushCount++;
      }
    }
    // Also push deletions (records that were in snapshot but no longer exist)
    for (const name of preSnap.keys()) {
      if (!allTvdb[name]) {
        debouncedTvdbPush(name);
        pushCount++;
      }
    }
    if (pushCount > 0)
      unilog(659, `Pushing ${pushCount} changed records to clients`);
  } catch (err) {
    unilog(660, "error:", err.message);
  } finally {
    embyFullSweepRunning = false;
    if (embyFullSweepQueued) {
      embyFullSweepQueued = false;
      const c = embyFullSweepQueuedCaller || "queued";
      embyFullSweepQueuedCaller = null;
      runEmbyFullSweep(c);
    }
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
        // Refresh episodeData file info (also updates date/size/noFiles/quality).
        await refreshEpisodeData(showName, tvdbRecord, { sources: ["disk"] });
        diskUpdateCount++;
      }

      if (diskUpdateCount > 0) {
        await tvdb.saveTvdbSync();
        unilog(661, `Updated disk info for ${diskUpdateCount} shows`);
      }
    }

    // Update lastPlayedDate for each show in batch (2-call Emby fetch per show)
    let lastPlayedChanged = 0;
    for (const { showId, showName, tvdbRecord } of shows) {
      const t0 = Date.now();
      try {
        const latestPlayed = await fetchLatestPlayedInfo(showId);
        const elapsed = Date.now() - t0;
        if (
          latestPlayed?.lastPlayedDate &&
          latestPlayed.lastPlayedDate !== tvdbRecord.lastPlayedDate
        ) {
          tvdbRecord.lastPlayedDate = latestPlayed.lastPlayedDate;
          lastPlayedChanged++;
          appendWatchgapLog(
            `  lastPlayedDate updated | ${elapsed}ms | ${showName} -> ${latestPlayed.lastPlayedDate}`,
          );
        }
      } catch (err) {
        unilog(73, `${showName}: ${err.message}`);
      }
    }
    if (lastPlayedChanged > 0) {
      await tvdb.saveTvdbSync();
      unilog(74, `Updated ${lastPlayedChanged} shows`);
    }

    // Now run gap check with fresh emby and disk data
    const gapData = await emby.gapCheckBatch(shows);
    for (const { showId, showName } of shows) {
      const g = gapData?.[showId];
      if (showName === "Swiss Toni") {
        unilog(662, `showId=${showId} g=${JSON.stringify(g)}`);
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

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    unilog(75, `finished, ${elapsed} secs, ${shows.length} shows`);
  } catch (err) {
    unilog(663, "error:", err.message);
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
    unilog(
      664,
      `${batch.length}/${showsToCheck.length} shows, oldest: ${batch[0].showName}`,
    );
    appendWatchgapLog(
      `[batch ${batch.length}/${showsToCheck.length}] ${batch.map((s) => s.showName).join(", ")}`,
    );
    await runGapCheckForShows(batch, true);
  } catch (err) {
    unilog(665, "runGapCheckBatch error:", err.message);
  }
}

// Phase 3: Set up sync timers
const EMBY_API_KEY = "1c399bd079d549cba8c916244d3add2b";
const EMBY_USER_ID = "894c752d448f45a3a1260ccaabd0adff";
const EMBY_BASE_URL = "http://hahnca.com:8096/emby";
const COLLECTION_IDS = {
  toTry: "1468316",
  continue: "4719143",
  mark: "4697672",
  linda: "4706186",
};

const DISK_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour (full disk check)
const GAP_CHECK_INTERVAL = 6 * 60 * 1000; // 6 minutes (processes batch of 10 shows, checks disk per-show)

async function fetchLatestPlayedInfo(showId) {
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
  return {
    lastPlayedDate: utcStr,
  };
}

// NOTE: syncEmbyUserData periodic sync removed - now using immediate triggers from client
// Collections and user data changes are handled by /api/triggerEmbySync and /api/triggerShowSelect
// NOTE: syncDiskData and runGapCheckBatch periodic timers removed - now handled by tryLocalGetTvdb
// per-show tick via perShowCallback (disk + gap) and preTvdbTickCallback (Emby sweep)

// Regenerate config.yml on startup and schedule flexget every 15 minutes.
upload().catch((e) => unilog(666, "startup upload error:", e.message));
cron.schedule("*/15 * * * *", () => {
  runFlexgetAndProcess().catch((e) => unilog(667, "cron error:", e.message));
});

//////////////////  EMBY REFRESH MANAGER  //////////////////
// All Library/Refresh calls go through here: one running + one pending max,
// minimum 3 s gap between scans, server polls internally and pushes
// libraryProgress / libraryRefreshDone WS events to all clients.

const embyRefreshManager = (() => {
  const MIN_GAP_MS = 3000;
  const POLL_INTERVAL_MS = 2000;
  const POLL_TIMEOUT_MS = 5 * 60 * 1000;

  let running = false;
  let lastFinishedAt = 0;
  let currentProgress = null; // null or { pct: number }
  // pendingShowNames / pendingWaiters accumulate while a scan is running.
  // At the start of each run() they are moved into myShowNames / myWaiters so
  // that new arrivals during this scan queue into the *next* generation and
  // are not resolved until their own dedicated scan completes.
  let pendingShowNames = new Set();
  let pendingWaiters = []; // { resolve }

  async function getLibraryTaskId() {
    try {
      const tasksRes = await fetch(
        `${EMBY_BASE_URL}/ScheduledTasks?api_key=${EMBY_API_KEY}`,
      );
      if (!tasksRes.ok) return null;
      const tasks = await tasksRes.json();
      const task = (Array.isArray(tasks) ? tasks : []).find((t) => {
        const n = String(t?.Name || "").toLowerCase();
        return (
          n.includes("library") && (n.includes("scan") || n.includes("refresh"))
        );
      });
      return task?.Id || null;
    } catch {
      return null;
    }
  }

  async function run(myShowNames, myWaiters) {
    running = true; // set synchronously before first await

    const gap = MIN_GAP_MS - (Date.now() - lastFinishedAt);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));

    let taskId = null;
    unilog(
      668,
      `starting library refresh (shows: ${[...myShowNames].join(", ") || "manual"})`,
    );
    currentProgress = { pct: 0 };
    notifyClients("libraryProgress", { pct: 0 });

    try {
      const res = await fetch(
        `${EMBY_BASE_URL}/Library/Refresh?api_key=${EMBY_API_KEY}`,
        { method: "POST" },
      );
      if (res.ok) {
        taskId = await getLibraryTaskId();
        unilog(76, `taskId: ${taskId || "none"}`);
      } else {
        unilog(669, `Library/Refresh failed: ${res.status} ${res.statusText}`);
      }
    } catch (e) {
      unilog(670, `Library/Refresh error:`, e.message);
    }

    if (taskId) {
      const pollStart = Date.now();
      while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const taskRes = await fetch(
            `${EMBY_BASE_URL}/ScheduledTasks/${taskId}?api_key=${EMBY_API_KEY}`,
          );
          if (taskRes.ok) {
            const task = await taskRes.json();
            const progressNum = Number(task?.CurrentProgressPercentage);
            if (Number.isFinite(progressNum)) {
              currentProgress = { pct: progressNum };
              notifyClients("libraryProgress", { pct: progressNum });
            }
            if (task.State !== "Running") {
              unilog(77, `scan finished (State=${task.State})`);
              break;
            }
          }
        } catch (e) {
          unilog(671, `poll error:`, e.message);
        }
      }
    } else {
      unilog(78, `no taskId, waiting 90s`);
      await new Promise((r) => setTimeout(r, 90 * 1000));
    }

    running = false;
    lastFinishedAt = Date.now();
    currentProgress = null;

    // Resolve this generation's waiters now — they got their scan.
    const showNames = [...myShowNames];
    unilog(
      672,
      `done, notifying clients (shows: ${showNames.join(", ") || "manual"})`,
    );
    notifyClients("libraryRefreshDone", { showNames });
    for (const { resolve } of myWaiters) resolve(showNames);

    // If new requests arrived during this scan, start another run for them.
    if (pendingShowNames.size > 0 || pendingWaiters.length > 0) {
      const nextShowNames = new Set([...pendingShowNames]);
      const nextWaiters = [...pendingWaiters];
      pendingShowNames = new Set();
      pendingWaiters = [];
      unilog(
        673,
        `pending shows: ${[...nextShowNames].join(", ")}, re-running`,
      );
      setTimeout(
        () =>
          run(nextShowNames, nextWaiters).catch((e) =>
            unilog(674, "run error:", e.message),
          ),
        MIN_GAP_MS,
      );
    }
  }

  return {
    request(caller = "unknown", showName = null) {
      const promise = new Promise((resolve) => {
        if (running) {
          // Queue for the next generation scan
          if (showName) pendingShowNames.add(showName);
          pendingWaiters.push({ resolve });
          unilog(
            675,
            `${caller}: refresh in flight, queued${showName ? ` ${showName}` : ""}`,
          );
        } else {
          // Start a new scan immediately with this request as the first in its generation
          if (showName) pendingShowNames.add(showName);
          pendingWaiters.push({ resolve });
          const myShowNames = new Set([...pendingShowNames]);
          const myWaiters = [...pendingWaiters];
          pendingShowNames = new Set();
          pendingWaiters = [];
          run(myShowNames, myWaiters).catch((e) =>
            unilog(676, "run error:", e.message),
          );
        }
      });
      return promise;
    },
    getStatus() {
      return {
        running,
        progress: currentProgress,
      };
    },
  };
})();

//////////////////  CHOKIDAR FILE WATCHER  //////////////////

const changedShows = new Map(); // showName -> { timeout, files: Set<string> }
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
    unilog(79, `${showName} already in flight, queued retry`);
    return;
  }
  inFlightDiskChanges.add(showName);
  try {
    unilog(80, `Processing disk change for: ${showName}`);

    // Update disk info for this show
    const diskInfo = await getShowDiskInfo(showName);
    if (diskInfo) {
      const [maxDate, totalSize] = diskInfo;

      // Update cache if it exists
      if (diskShowsCache) {
        diskShowsCache[showName] = diskInfo;
        unilog(81, `updated cache for ${showName}`);
      }

      // Update tvdb record with new disk info
      const allTvdb = tvdb.getAllTvdbSync();
      const tvdbRecord = allTvdb[showName];
      if (tvdbRecord) {
        // Refresh episodeData file info (also sets date/size/noFiles/quality).
        await refreshEpisodeData(showName, tvdbRecord, { sources: ["disk"] });
        await tvdb.saveTvdbSync();
        debouncedTvdbPush(showName);
        unilog(
          677,
          `Updated disk info for ${showName}: ${totalSize} bytes, ${maxDate}`,
        );
      }
    } else {
      // If we can't get disk info (e.g., folder was deleted), remove from cache
      if (diskShowsCache && showName in diskShowsCache) {
        delete diskShowsCache[showName];
        unilog(82, `removed ${showName} from cache (no disk info)`);
      }
    }

    // Notify clients that disk changed for this show (progress comes from libraryProgress WS events)
    notifyClients("showDiskChanged", { showName });
    unilog(678, `Notified clients about disk change for ${showName}`);

    // Trigger Emby library refresh through manager (throttled, deduped, pushes WS progress)
    unilog(83, `Requesting Emby library refresh for ${showName}`);
    await embyRefreshManager.request(`chokidar:${showName}`, showName);
    unilog(84, `Library refresh done for ${showName}`);

    try {
      const allTvdb = tvdb.getAllTvdbSync();
      const tvdbRecord = allTvdb[showName];
      if (!tvdbRecord?.inEmby || !tvdbRecord?.id) return;

      // Refresh fileGap, watchGap, etc.
      await runGapCheckForShows(
        [{ showId: tvdbRecord.id, showName, tvdbRecord }],
        false,
      );
      unilog(85, `Gap check refreshed for ${showName}`);

      // Refresh watched/id in episodeData from Emby (also dual-writes
      // watchedEpis/watchedCount).
      await refreshEpisodeData(showName, tvdbRecord, { sources: ["emby"] });
      await tvdb.saveTvdbSync();
      unilog(86, `watched refreshed for ${showName}`);
    } catch (err) {
      unilog(679, `Post-download refresh error for ${showName}:`, err.message);
    }
  } catch (err) {
    unilog(680, `Error handling disk change for ${showName}:`, err.message);
  } finally {
    inFlightDiskChanges.delete(showName);
    if (pendingDiskChanges.has(showName)) {
      pendingDiskChanges.delete(showName);
      unilog(87, `Re-running queued disk change for ${showName}`);
      setTimeout(() => handleShowDiskChange(showName), 1000);
    }
  }
}

// Start watching TV directory
const watcher = chokidar.watch(tvDir, {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true, // don't emit events for existing files on startup
  usePolling: false, // use native inotify events
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100,
  },
  depth: 99, // watch all subdirectories
});

watcher
  .on("add", async (filePath) => {
    const ext = filePath.split(".").pop();
    const isVideo = videoFileExtensions.includes(ext);
    const isBif = ext === "bif";
    if (!isVideo && !isBif) return;

    const showName = extractShowNameFromPath(filePath);
    if (!showName) return;

    unilog(88, `${isBif ? "bif" : "video"} added: ${showName}`);

    // Update only the affected show in cache instead of invalidating everything
    if (diskShowsCache) {
      try {
        const showInfo = await getShowDiskInfo(showName);
        if (showInfo) {
          diskShowsCache[showName] = showInfo;
          unilog(89, `updated cache for ${showName}`);
        }
      } catch (err) {
        unilog(681, `failed to update cache for ${showName}:`, err.message);
        // On error, invalidate entire cache to be safe
        diskShowsCache = null;
      }
    }

    // Debounce: accumulate files per show, clear existing timeout and set new one
    const existing = changedShows.get(showName);
    if (existing) {
      clearTimeout(existing.timeout);
      existing.files.add(filePath);
    } else {
      changedShows.set(showName, { timeout: null, files: new Set([filePath]) });
    }
    const entry = changedShows.get(showName);
    entry.timeout = setTimeout(async () => {
      changedShows.delete(showName);
      try {
        const tvdbAll = tvdb.getAllTvdbSync?.();
        const tvdbRec = tvdbAll?.[showName];
        const videoFiles = [...entry.files].filter((fp) =>
          videoFileExtensions.includes(fp.split(".").pop()),
        );
        if (videoFiles.length === 0) {
          handleShowDiskChange(showName);
          return;
        }
        if (tvdbRec && tvdbRec.inEmby) {
          let queued = false;
          for (const fp of videoFiles) {
            const needs = await fileNeedsSubChecked(fp, showName);
            unilog(682, `fileNeedsSubChecked(${path.basename(fp)}) = ${needs}`);
            if (needs) {
              enqueueSubQueue(
                { videoFilePath: fp, fromUI: false, lowPriority: false },
                false,
              );
              queued = true;
            }
          }
          if (queued) {
            persistSubQueue();
            doSubQueueNow();
          }
        }
        if (tvdbRec && tvdbRec.inEmby) {
          await scanShowForResFallback(showName, tvdbRec);
        }
      } catch (err) {
        unilog(683, `sub check error for ${showName}:`, err.message);
      }
      handleShowDiskChange(showName);
    }, DISK_CHANGE_DEBOUNCE_MS);
  })
  .on("unlink", (filePath) => {
    // Strip a trailing `.alt` so hidden 1080 fallbacks (…​.mkv.alt) are seen as
    // video deletions rather than extension "alt" (which would be ignored).
    const ext = resStripAlt(filePath).split(".").pop();
    if (!videoFileExtensions.includes(ext) && ext !== "bif") return;

    const showName = extractShowNameFromPath(filePath);
    if (!showName) return;

    unilog(684, `${ext === "bif" ? "bif" : "video"} deleted: ${showName}`);

    // Debounce: clear existing timeout and set new one
    const unlinkEntry = changedShows.get(showName);
    if (unlinkEntry) clearTimeout(unlinkEntry.timeout);

    const unlinkTimeout = setTimeout(async () => {
      changedShows.delete(showName);
      // Deleting a video (e.g. a 1080 .alt fallback) can leave an unwatched
      // 2160 without its fallback — re-scan so it gets regenerated.
      try {
        const tvdbRec = tvdb.getAllTvdbSync?.()?.[showName];
        if (tvdbRec && tvdbRec.inEmby) {
          await scanShowForResFallback(showName, tvdbRec);
        }
      } catch (err) {
        unilog(
          1124,
          `res scan on delete failed for ${showName}: ${err.message}`,
        );
      }
      handleShowDiskChange(showName);
    }, DISK_CHANGE_DEBOUNCE_MS);

    if (unlinkEntry) unlinkEntry.timeout = unlinkTimeout;
    else
      changedShows.set(showName, { timeout: unlinkTimeout, files: new Set() });
  })
  .on("error", (error) => {
    unilog(685, "Watcher error:", error);
  })
  .on("ready", () => {
    unilog(90, "Initial scan complete. Ready for changes.");
  });

unilog(91, `Watching ${tvDir} for file changes...`);

//////////////////  RESOLUTION FALLBACK (2160 ↔ 1080)  //////////////////
// Keep a hidden 1080 ".alt" fallback next to each unwatched 2160 episode so
// playback can switch resolution (slow wifi can't stream 2160). See
// toggle-resolution-instr.md / toggle-resolution-plan.md.
//
// File convention (Emby ignores any name whose final extension is not a video
// extension, so ".alt" hides a file):
//   active 2160:  Show.S01E01.2160p.mkv
//   hidden 1080:  Show.S01E01.1080p.mkv.alt
// Toggling swaps which member carries the ".alt" suffix.

const RES_SUBTITLE_EXTS = new Set([
  ".srt",
  ".ass",
  ".ssa",
  ".sub",
  ".idx",
  ".sup",
  ".vtt",
  ".smi",
]);
const REENCODE_QUEUE_PATH = path.join(
  SRVR_ROOT_DIR,
  "data",
  "reencode-queue.json",
);

function resHasAlt(name) {
  return name.toLowerCase().endsWith(".alt");
}
function resStripAlt(name) {
  return resHasAlt(name) ? name.slice(0, -4) : name;
}
// Resolution implied by a filename substring (0 = unknown).
function resOfName(name) {
  if (/2160p/i.test(name)) return 2160;
  if (/1080p/i.test(name)) return 1080;
  return 0;
}
// True when name (after stripping a trailing .alt) is a real video file.
function resIsVideoName(name) {
  const ext = resStripAlt(name).split(".").pop().toLowerCase();
  return videoFileExtensions.includes(ext);
}

// All episode video files in a season dir (includes hidden .alt copies).
function resFindEpisodeVideos(seasonDir, season, episode) {
  let files;
  try {
    files = fs.readdirSync(seasonDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of files) {
    if (name.startsWith(".")) continue; // skip dotfiles (.restmp-* etc)
    if (!resIsVideoName(name)) continue;
    const parsed = parseFileSeasonEpisode(
      resStripAlt(name),
      path.basename(seasonDir),
    );
    if (parsed?.season !== season || parsed?.episode !== episode) continue;
    out.push({ name, res: resOfName(name), alt: resHasAlt(name) });
  }
  return out;
}

// Active (non-.alt) 2160 file name for an episode, if any. Never returns a
// hidden .alt copy — the re-encoder must only process a real active 2160 video
// file (an .alt source would produce a broken temp filename and fail).
function res2160FileName(seasonDir, season, episode) {
  const vids = resFindEpisodeVideos(seasonDir, season, episode);
  const f = vids.find((v) => v.res === 2160 && !v.alt);
  return f ? f.name : null;
}

// A kept-aside 1080 ".old" file for an episode (preferred fallback source).
function res1080OldFileName(seasonDir, season, episode) {
  let files;
  try {
    files = fs.readdirSync(seasonDir);
  } catch {
    return null;
  }
  for (const name of files) {
    if (!/\.old$/i.test(name)) continue;
    if (!/1080p/i.test(name)) continue;
    const base = name.replace(/\.old$/i, "");
    if (!resIsVideoName(base)) continue;
    const parsed = parseFileSeasonEpisode(base, path.basename(seasonDir));
    if (parsed?.season === season && parsed?.episode === episode) return name;
  }
  return null;
}

// Best-effort cross-app guard: is the downloader already fetching a 1080 for
// this episode? Optional — if the map can't be read, assume not in progress.
function res1080DownloadInProgress(season, episode) {
  let map;
  try {
    map = JSON.parse(fs.readFileSync(DOWN_INPROGRESS_PATH, "utf8"));
  } catch {
    return false;
  }
  const sKey = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  const re = new RegExp(sKey, "i");
  for (const key of Object.keys(map || {})) {
    if (/1080p/i.test(key) && re.test(key)) return true;
  }
  return false;
}

// Duplicate every 2160 sidecar subtitle under the 1080 basename, then enqueue
// the new 1080 video for a subtitle check (chksrt).
// Copy the 2160 episode's subtitle sidecars AND its chksrt result (the
// `.mb.chosen` marker) onto the generated 1080 basename. The 1080 has identical
// tracks, so the subtitles and the subtitle-check outcome are reused directly —
// no extraction and no re-check are needed.
function res1080CopySubtitles(seasonDir, src2160Name, dst1080Name) {
  const src2160Base = src2160Name.replace(/\.[^.]+$/, "");
  const dst1080Base = dst1080Name.replace(/\.[^.]+$/, "");
  let files;
  try {
    files = fs.readdirSync(seasonDir);
  } catch {
    files = [];
  }
  for (const name of files) {
    if (!name.startsWith(src2160Base)) continue;
    const ext = path.extname(name).toLowerCase();
    const isSub = RES_SUBTITLE_EXTS.has(ext);
    const isChosen = name.endsWith(".mb.chosen"); // chksrt result marker
    if (!isSub && !isChosen) continue;
    const suffix = name.slice(src2160Base.length); // e.g. ".en.srt" or ".mb.chosen"
    const dstName = dst1080Base + suffix;
    const dstPath = path.join(seasonDir, dstName);
    if (fs.existsSync(dstPath)) continue;
    try {
      fs.copyFileSync(path.join(seasonDir, name), dstPath);
    } catch (e) {
      unilog(1102, `sub copy failed for ${dstName}: ${e.message}`);
    }
  }
}

//////  re-encode queue (single ffmpeg worker)  //////
let reencodeQueue = [];
let reencodeRunning = false;

function loadReencodeQueue() {
  try {
    reencodeQueue = JSON.parse(fs.readFileSync(REENCODE_QUEUE_PATH, "utf8"));
    if (!Array.isArray(reencodeQueue)) reencodeQueue = [];
  } catch {
    reencodeQueue = [];
  }
}
function persistReencodeQueue() {
  try {
    fs.writeFileSync(
      REENCODE_QUEUE_PATH,
      JSON.stringify(reencodeQueue),
      "utf8",
    );
  } catch (e) {
    unilog(1103, `reencode queue persist failed: ${e.message}`);
  }
}
function enqueueReencode(entry) {
  // entry: { srcPath, showName, season, episode }
  if (reencodeQueue.some((e) => e.srcPath === entry.srcPath)) return;
  reencodeQueue.push(entry);
  persistReencodeQueue();
  unilog(1104, `reencode queued: ${path.basename(entry.srcPath)}`);
  syncBatchMsgs();
  setTimeout(processReencodeQueue, 0);
}

async function reencodeOneTo1080(entry) {
  const { srcPath, season, episode } = entry;
  if (!fs.existsSync(srcPath)) {
    unilog(1105, `reencode skip — source gone: ${srcPath}`);
    return;
  }
  const seasonDir = path.dirname(srcPath);
  const srcName = path.basename(srcPath);
  // Re-check: a 1080 may have appeared since this was queued.
  if (
    resFindEpisodeVideos(seasonDir, season, episode).some((f) => f.res === 1080)
  ) {
    unilog(1106, `reencode skip — 1080 already present: ${srcName}`);
    return;
  }
  const dst1080Name = srcName.replace(/2160/g, "1080"); // e.g. Show.S01E01.1080p.mkv
  // tmpPath: hidden dotfile so chokidar/Emby ignore it while encoding.
  // vidTmpPath: intermediate video-only MP4. Re-encoding through a separate
  // container and remuxing strips the DoVi configuration record that ffmpeg
  // would otherwise copy from the source into the MKV video track (which makes
  // Emby/Bravia spin on playback). MP4 is used rather than a raw elementary
  // stream because raw video carries no timing, so it would be read back at
  // ffmpeg's default 25 fps and desync the audio on non-25fps sources.
  const tmpPath = path.join(seasonDir, ".restmp-" + dst1080Name);
  const vidTmpPath = tmpPath.replace(/\.mkv$/i, ".mp4");
  const dstPath = path.join(seasonDir, dst1080Name + ".alt");
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch (e) {
    unilog(1107, `could not remove stale temp ${tmpPath}: ${e.message}`);
  }
  try {
    if (fs.existsSync(vidTmpPath)) fs.unlinkSync(vidTmpPath);
  } catch (e) {
    unilog(1121, `could not remove stale vid temp: ${e.message}`);
  }
  unilog(1108, `reencode 2160->1080 start: ${srcName}`);
  await ffmpegQueue.run(
    () =>
      new Promise((resolve, reject) => {
        const REENCODE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes max
        // Step 1: encode video only to a video-only MP4 (preserves timing).
        // HEVC Main 10 keeps the source's 10-bit depth + HDR at a ~10 Mbit/s
        // cap (the bandwidth fallback target); the Bravia hardware-decodes it
        // just like the 4K HEVC sources, so it direct-plays.
        // The encode runs on the AMD VCN hardware encoder via VAAPI
        // (hevc_vaapi) — ~3.7x realtime, offloading the encode off the CPU.
        // Decode + scale stay on the CPU on purpose: full-GPU scale_vaapi leaks
        // GPU surfaces and crashes ("Cannot allocate memory") on long files.
        const args1 = [
          "-y",
          "-vaapi_device",
          "/dev/dri/renderD128",
          "-i",
          srcPath,
          "-map",
          "0:v:0",
          "-vf",
          "scale=-16:1080,crop=iw:1072,format=p010,hwupload",
          "-c:v",
          "hevc_vaapi",
          "-profile:v",
          "main10",
          "-rc_mode",
          "VBR",
          "-b:v",
          "8M",
          "-maxrate",
          "10M",
          "-bufsize",
          "16M",
          "-tag:v",
          "hvc1",
          vidTmpPath,
        ];
        const ff1 = cp.spawn(BATCH_SCHED[0], [
          ...BATCH_SCHED.slice(1),
          "ffmpeg",
          ...args1,
        ]);
        const killTimer = setTimeout(() => {
          ff1.kill("SIGKILL");
        }, REENCODE_TIMEOUT_MS);
        ff1.stderr.on("data", () => {});
        ff1.on("error", (err) => {
          clearTimeout(killTimer);
          reject(err);
        });
        ff1.on("close", (code) => {
          clearTimeout(killTimer);
          if (code !== 0) {
            reject(new Error(`ffmpeg step1 exit ${code}`));
            return;
          }
          // Step 2: remux MP4 video + all non-video streams from source into MKV.
          // -map 0:v:0  = re-encoded H.264 video from step 1
          // -map 1      = everything from source (audio, subs, attachments)
          // -map -1:v   = remove source video (we already have it from step 1)
          const args2 = [
            "-y",
            "-i",
            vidTmpPath,
            "-i",
            srcPath,
            "-map",
            "0:v:0",
            "-map",
            "1",
            "-map",
            "-1:v",
            "-c",
            "copy",
            tmpPath,
          ];
          const ff2 = cp.spawn("ffmpeg", args2);
          ff2.stderr.on("data", () => {});
          ff2.on("error", (err) => {
            try {
              fs.unlinkSync(vidTmpPath);
            } catch {}
            reject(err);
          });
          ff2.on("close", (code2) => {
            try {
              fs.unlinkSync(vidTmpPath);
            } catch {}
            if (code2 === 0) resolve();
            else reject(new Error(`ffmpeg step2 exit ${code2}`));
          });
        });
      }),
  );
  fs.renameSync(tmpPath, dstPath);
  unilog(1109, `reencode 2160->1080 done: ${dst1080Name}.alt`);
  res1080CopySubtitles(seasonDir, srcName, dst1080Name);
}

async function processReencodeQueue() {
  if (reencodeRunning) return;
  const entry = reencodeQueue[0];
  if (!entry) return;
  reencodeRunning = true;
  syncBatchMsgs();
  let encodeSucceeded = false;
  try {
    await reencodeOneTo1080(entry);
    encodeSucceeded = true;
  } catch (e) {
    unilog(1110, `reencode failed for ${entry.srcPath}: ${e.message}`);
    // Clean up stale temp files so they don't fool the scanner.
    const tmpPath = path.join(
      path.dirname(entry.srcPath),
      ".restmp-" + path.basename(entry.srcPath).replace(/2160/g, "1080"),
    );
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    const vidTmpPath = tmpPath.replace(/\.mkv$/i, ".mp4");
    try {
      if (fs.existsSync(vidTmpPath)) fs.unlinkSync(vidTmpPath);
    } catch {}
  } finally {
    if (reencodeQueue[0]?.srcPath === entry.srcPath) {
      reencodeQueue.shift();
      persistReencodeQueue();
    }
    reencodeRunning = false;
    syncBatchMsgs();
    if (reencodeQueue.length > 0) setTimeout(processReencodeQueue, 1000);
  }
}

// Evaluate one episode and, if a 1080 fallback is needed, rename a kept .old
// copy to .alt (preferred) or queue an ffmpeg re-encode of the 2160 file.
async function res1080NeededAndAcquire(
  showName,
  tvdbRecord,
  season,
  episode,
  seasonDir,
) {
  if (!tvdbRecord?.inEmby) return;
  if (epd.isWatched(tvdbRecord.episodeData, season, episode)) return;
  const vids = resFindEpisodeVideos(seasonDir, season, episode);
  if (!vids.some((f) => f.res === 2160)) return;
  if (vids.some((f) => f.res === 1080)) return;
  if (res1080DownloadInProgress(season, episode)) return;

  // Preferred: reuse a kept-aside 1080 .old → rename to .alt.
  const oldName = res1080OldFileName(seasonDir, season, episode);
  if (oldName) {
    const altName = oldName.replace(/\.old$/i, ".alt");
    try {
      fs.renameSync(
        path.join(seasonDir, oldName),
        path.join(seasonDir, altName),
      );
      unilog(1111, `reused kept 1080 .old->.alt: ${altName}`);
      const src2160 = res2160FileName(seasonDir, season, episode);
      if (src2160) {
        res1080CopySubtitles(seasonDir, src2160, resStripAlt(altName));
      }
    } catch (e) {
      unilog(1112, `.old->.alt rename failed for ${altName}: ${e.message}`);
    }
    return;
  }

  // Otherwise re-encode from the 2160 file.
  const src2160 = res2160FileName(seasonDir, season, episode);
  if (!src2160) return;
  enqueueReencode({
    srcPath: path.join(seasonDir, src2160),
    showName,
    season,
    episode,
  });
}

// Scan every season of a show for episodes that need a 1080 fallback.
async function scanShowForResFallback(showName, tvdbRecord) {
  if (!tvdbRecord?.inEmby) return;
  const showFolderName = showName.includes("/")
    ? showName
    : (tvdbRecord.path || tvdbRecord.emby?.path || showName).split("/").pop();
  const showFolder = path.join(tvDir, showFolderName);
  let seasonDirs;
  try {
    seasonDirs = fs.readdirSync(showFolder);
  } catch {
    return;
  }
  for (const seasonDirName of seasonDirs) {
    const seasonDir = path.join(showFolder, seasonDirName);
    try {
      if (!fs.statSync(seasonDir).isDirectory()) continue;
    } catch {
      continue;
    }
    let files;
    try {
      files = fs.readdirSync(seasonDir);
    } catch {
      continue;
    }
    const seen = new Set();
    for (const name of files) {
      if (!resIsVideoName(name)) continue;
      if (resOfName(name) !== 2160) continue;
      const parsed = parseFileSeasonEpisode(resStripAlt(name), seasonDirName);
      if (parsed?.season == null || parsed?.episode == null) continue;
      const key = `${parsed.season}E${parsed.episode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await res1080NeededAndAcquire(
        showName,
        tvdbRecord,
        parsed.season,
        parsed.episode,
        seasonDir,
      );
    }
  }
}

// Swap the ".alt" marker between the active and hidden video for an episode.
function resToggleFiles(seasonDir, season, episode) {
  const vids = resFindEpisodeVideos(seasonDir, season, episode);
  const active = vids.find((v) => !v.alt && (v.res === 2160 || v.res === 1080));
  const alt = vids.find((v) => v.alt && (v.res === 2160 || v.res === 1080));
  if (!active || !alt) {
    throw new Error(
      `resToggle needs one active + one alt (active=${active?.name}, alt=${alt?.name})`,
    );
  }
  const newAltPath = path.join(seasonDir, active.name) + ".alt";
  const newActivePath = path.join(seasonDir, resStripAlt(alt.name));
  fs.renameSync(path.join(seasonDir, active.name), newAltPath);
  fs.renameSync(path.join(seasonDir, alt.name), newActivePath);
  return { newActiveRes: alt.res, newActiveName: resStripAlt(alt.name) };
}

// POST /api/toggleResolution — swap .alt, refresh Emby (await), return episode.
async function handleToggleResolution(params) {
  let { relPath, showName, season, episode, episodeId } = params || {};
  let seasonDir = null;
  if (relPath) {
    const abs = path.join(tvDir, relPath);
    seasonDir = path.dirname(abs);
    showName = showNameFromFilePath(abs);
    const parsed = parseFileSeasonEpisode(
      resStripAlt(path.basename(abs)),
      path.basename(seasonDir),
    );
    season = parsed?.season;
    episode = parsed?.episode;
  } else if (showName != null && season != null && episode != null) {
    season = Number(season);
    episode = Number(episode);
    const rec = tvdb.getAllTvdbSync()[showName];
    const showFolderName = showName.includes("/")
      ? showName
      : (rec?.path || rec?.emby?.path || showName).split("/").pop();
    seasonDir = path.join(tvDir, showFolderName, `Season ${season}`);
  } else {
    return { ok: false, error: "missing relPath or show/season/episode" };
  }
  if (season == null || episode == null) {
    return { ok: false, error: "could not determine season/episode" };
  }
  season = Number(season);
  episode = Number(episode);
  const tvdbRecord = tvdb.getAllTvdbSync()[showName];

  const { newActiveRes } = resToggleFiles(seasonDir, season, episode);
  unilog(1113, `toggled ${showName} S${season}E${episode} -> ${newActiveRes}p`);

  // Trigger an Emby library refresh and wait for it to finish.
  await embyRefreshManager.request(`resToggle:${showName}`, showName);

  // Resolve the Emby episode id if the caller didn't supply one.
  if (!episodeId && tvdbRecord?.id) {
    try {
      const seriesMap = await emby.getSeriesMap({ id: tvdbRecord.id });
      const seasonEntry = (seriesMap || []).find(([s]) => s === season);
      const epEntry = seasonEntry?.[1]?.find(([e]) => e === episode);
      episodeId = epEntry?.[1]?.id || null;
    } catch (e) {
      unilog(1114, `resolve episodeId failed for ${showName}: ${e.message}`);
    }
  }

  return {
    ok: true,
    showId: tvdbRecord?.id || null,
    showName,
    episodeId: episodeId || null,
    resolution: newActiveRes,
  };
}

loadReencodeQueue();
if (reencodeQueue.length > 0) setTimeout(processReencodeQueue, 5000);
