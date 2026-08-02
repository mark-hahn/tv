import fsNode from "node:fs";
import utilNode from "node:util";
import pathNode from "node:path";
import childProcess from "node:child_process";
import httpNode from "node:http";
import urlNode from "node:url";
import Database from "better-sqlite3";

import mkdirpPkg from "mkdirp";
import requestPkg from "request";
import rimrafPkg from "rimraf";
import parseTorrentTitlePkg from "parse-torrent-title";
import { ChannelPeer } from "@tv/share/channelPeer";

import * as tvJsonMod from "./tvJson.js";
import * as movieRsync from "./movie-rsync.js";
import {
  smartTitleMatch,
  parseFileSeasonEpisode,
  parseTitleFromFilename,
  TV_BLOCKED,
  getResolution,
  isHevc,
  isWatched as edIsWatched,
  unilog,
  setUnilogSink,
  logHere,
  resolveShowFolderName,
} from "@tv/share";

const __filename = urlNode.fileURLToPath(import.meta.url);
const __dirname = pathNode.dirname(__filename);

const SRVR_LOG_URL = "http://127.0.0.1:8739/api/log";
const DOWNLOADS_CHANNEL_POLL_MS = 1000;
const MOVIE_DOWNLOADS_CHANNEL_POLL_MS = 2000;

let downChannelPeer = null;
let downloadsChannelPollTimer = null;
let downloadsChannelLastJson = "";
let movieDownloadsChannelPollTimer = null;
let movieDownloadsChannelLastJson = "";

const getDownloadsSnapshot = () => tvJsonMod.getDownloads();

const getMovieDownloadsSnapshot = () => movieRsync.getMovieDownJobs();

const snapshotJson = (value) => JSON.stringify(value ?? null);

const publishDownloadsChannel = () => {
  const snapshot = getDownloadsSnapshot();
  const json = snapshotJson(snapshot);
  if (json === downloadsChannelLastJson) return;
  downloadsChannelLastJson = json;
  downChannelPeer?.publishDelta("downloads", snapshot);
};

const publishMovieDownloadsChannel = () => {
  const snapshot = getMovieDownloadsSnapshot();
  const json = snapshotJson(snapshot);
  if (json === movieDownloadsChannelLastJson) return;
  movieDownloadsChannelLastJson = json;
  downChannelPeer?.publishDelta("movieDownloads", snapshot);
};

const getDownloadsChannelSnapshot = () => {
  const snapshot = getDownloadsSnapshot();
  downloadsChannelLastJson = snapshotJson(snapshot);
  return snapshot;
};

const getMovieDownloadsChannelSnapshot = () => {
  const snapshot = getMovieDownloadsSnapshot();
  movieDownloadsChannelLastJson = snapshotJson(snapshot);
  return snapshot;
};

const startDownloadsChannelPolling = () => {
  if (downloadsChannelPollTimer) return;
  downloadsChannelPollTimer = setInterval(() => {
    try {
      publishDownloadsChannel();
    } catch (e) {
      unilog(1503, `downloads poll failed: ${e.message}`);
    }
  }, DOWNLOADS_CHANNEL_POLL_MS);
};

const stopDownloadsChannelPolling = () => {
  if (!downloadsChannelPollTimer) return;
  clearInterval(downloadsChannelPollTimer);
  downloadsChannelPollTimer = null;
  downloadsChannelLastJson = "";
};

const startMovieDownloadsChannelPolling = () => {
  if (movieDownloadsChannelPollTimer) return;
  movieDownloadsChannelPollTimer = setInterval(() => {
    try {
      publishMovieDownloadsChannel();
    } catch (e) {
      unilog(1504, `movieDownloads poll failed: ${e.message}`);
    }
  }, MOVIE_DOWNLOADS_CHANNEL_POLL_MS);
};

const stopMovieDownloadsChannelPolling = () => {
  if (!movieDownloadsChannelPollTimer) return;
  clearInterval(movieDownloadsChannelPollTimer);
  movieDownloadsChannelPollTimer = null;
  movieDownloadsChannelLastJson = "";
};

const startDownChannelPeer = () => {
  if (downChannelPeer) return;
  downChannelPeer = new ChannelPeer({
    channels: {
      downloads: {
        snapshot: getDownloadsChannelSnapshot,
        onFirstSubscriber: startDownloadsChannelPolling,
        onLastUnsubscriber: stopDownloadsChannelPolling,
      },
      movieDownloads: {
        snapshot: getMovieDownloadsChannelSnapshot,
        onFirstSubscriber: startMovieDownloadsChannelPolling,
        onLastUnsubscriber: stopMovieDownloadsChannelPolling,
      },
    },
    log: (message) => unilog(1505, `${message}`),
  });
  downChannelPeer.start();
};

// Scan-cycle log sites (checkFile → chkTvDB → checkFileExists → badFile).
// Every cycle re-logs the same verdict for every unchanged file, flooding
// unilog with exact duplicates. Suppress a cycle-site event when the same
// (id, message) was already sent this cycle or the previous one, so a verdict
// logs once and stays silent until it changes or disappears for a full cycle.
const CYCLE_LOG_IDS = new Set([
  318, 321, 324, 325, 327, 328, 329, 331, 332, 334, 335, 336, 337, 338, 339,
  340, 341, 1185, 1195, 1196, 1197, 1198, 1199, 1200, 1201, 1202, 1203, 1204,
  1205, 1244,
]);
let prevCycleLogKeys = new Set();
let curCycleLogKeys = new Set();

function rotateCycleLogDedup() {
  prevCycleLogKeys = curCycleLogKeys;
  curCycleLogKeys = new Set();
}

setUnilogSink(({ logId, ts, message }) => {
  if (CYCLE_LOG_IDS.has(logId)) {
    const key = `${logId}\0${message}`;
    const dup = prevCycleLogKeys.has(key) || curCycleLogKeys.has(key);
    curCycleLogKeys.add(key);
    if (dup) return;
  }
  fetch(SRVR_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logId, pid: "tv-down", ts, message }),
  }).catch(() => {});
});

process.on("uncaughtException", (err) => {
  unilog(286, `uncaughtException: ${err && (err.stack || err.message || err)}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  unilog(
    287,
    `unhandledRejection: ${reason && (reason.stack || reason.message || reason)}`,
  );
  process.exit(1);
});

process.on("exit", (code) => {
  unilog(288, `process exiting with code ${code}`);
});

async function main() {
  var FAST_TEST,
    PROCESS_INTERVAL_MS,
    SKIP_DOWNLOAD,
    badFile,
    blocked,
    blockedCount,
    buffering,
    checkFile,
    checkFileExists,
    checkFiles,
    chkCount,
    chkTvDB,
    clearBuffer,
    currentSeq,
    cycleRunning,
    cycleSeq,
    dateStr,
    debug,
    delOldFiles,
    deleteCount,
    deleteErrorRecords,
    downloadCount,
    downloadTime,
    episode,
    err,
    errCount,
    errors,
    deleteErrors,
    escQuotes,
    exec,
    existsCount,
    fileTimeout,
    findUsb,
    flushAndGoLive,
    flushBuffer,
    fname,
    folderTitle,
    fs,
    getUsbFiles,
    inProgress,
    lastPruneAt,
    log,
    logBuffer,
    map,
    mkdirp,
    path,
    readMap,
    recentCount,
    reloadState,
    request,
    resetCycleState,
    rimraf,
    rsyncDelay,
    runCycle,
    scheduleNextCycle,
    season,
    seriesName,
    titleYear,
    folderTitleYear,
    sizeStr,
    skipPaths,
    startBuffering,
    startTime,
    stopBuffering,
    theTvDbToken,
    time,
    title,
    tvDbErrCount,
    tvPath,
    tvdbCache,
    tvdburl,
    type,
    usbFilePath,
    usbFileSize,
    usbFiles,
    usbHost,
    util,
    writeLine,
    writeMap,
    forcedFiles,
    processingForced,
    embyMap,
    destTitle,
    _cycleTiming;

  forcedFiles = null;
  processingForced = false;
  // torFilePaths: Set of usbFilePaths registered as coming from the tor pane.
  // Persists across cycles so non-forced tor files are recognized when the
  // normal scan picks them up.
  var torFilePaths = null;

  var usbFileBytes = null;

  debug = false;
  FAST_TEST = false;
  SKIP_DOWNLOAD = false; // Set to false to resume actual downloading
  PROCESS_INTERVAL_MS = FAST_TEST ? 30 * 1000 : 5 * 60 * 1000;
  var videoFileExts = new Set([
    ".mkv",
    ".mp4",
    ".avi",
    ".mov",
    ".m4v",
    ".wmv",
    ".ts",
    ".m2ts",
  ]);
  var isVideoEpisodeFile = function (name) {
    return videoFileExts.has(path.extname(String(name || "")).toLowerCase());
  };

  var cycleTsPST = () => {
    var d = new Date();
    var p = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    var m = {};
    for (var i = 0; i < p.length; i++)
      if (p[i].type !== "literal") m[p[i].type] = p[i].value;
    var hour = m.hour === "24" ? "00" : m.hour;
    return `${m.month}-${m.day} ${hour}:${m.minute}`;
  };

  log = (...x) => {
    unilog(289, ``, ...x);
  };

  err = (...x) => {
    return unilog(290, `error:`, ...x);
  };

  sizeStr = function (n, { digits = 1, base = 1000, suffix = "" } = {}) {
    var UNITS, i, num, sign, str;
    UNITS = ["", "K", "M", "G", "T", "P", "E", "Z", "Y"];
    sign = n < 0 ? "-" : "";
    num = Math.abs(n);
    i = 0;
    while (num >= base && i < UNITS.length - 1) {
      num /= base;
      i++;
    }
    str = num.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
    return `${sign}${str}${UNITS[i]}${suffix}`;
  };

  unilog(291, "starting....");

  rsyncDelay = 1000; // only used for TVDB error retry

  usbHost = "xobtlu@xobtlu.baron.usbx.me";

  fs = fsNode;
  fs.mkdirpSync = function (dir) {
    return fs.mkdirSync(dir, { recursive: true });
  };
  util = utilNode;
  path = pathNode;

  var BASEDIR = path.join(__dirname, "..");

  // Persisted state/logs live under this app folder.
  var APP_DIR = BASEDIR;
  var DATA_DIR = path.join(APP_DIR, "data");
  var MISC_DIR = path.join(DATA_DIR, "misc");

  var ensureDir = function (dir) {
    try {
      return fs.mkdirpSync(dir);
    } catch (e) {}
  };

  ensureDir(DATA_DIR);
  ensureDir(MISC_DIR);
  var dataPath = function (p) {
    return path.join(DATA_DIR, p);
  };

  // tv.log lives under data/misc/
  var TV_LOG_PATH = path.join(MISC_DIR, "tv.log");
  var REJECT_LOG_PATH = dataPath("reject.log");
  var TV_INPROGRESS_PATH = dataPath("tv-inProgress.json");
  var TV_MAP_PATH = dataPath("tv-map");
  var TVDB_DB_PATH = path.join(APP_DIR, "..", "srvr", "data", "tvdb.db");
  var tvdbDb = null;
  var loadEmbyMapFromDb = function () {
    var out = {};
    if (!tvdbDb) {
      tvdbDb = new Database(TVDB_DB_PATH, {
        readonly: true,
        fileMustExist: true,
      });
      tvdbDb.pragma("busy_timeout = 5000");
    }
    var rows = tvdbDb.prepare("SELECT name, json FROM shows").all();
    for (var row of rows) {
      out[row.name] = JSON.parse(row.json);
    }
    return out;
  };
  var FLEXGET_HISTORY_PATH = path.join(
    APP_DIR,
    "..",
    "srvr",
    "data",
    "flexget-history.json",
  );
  var BAD_GROUPS_PATH = path.join(
    APP_DIR,
    "..",
    "srvr",
    "data",
    "badGroups.txt",
  );
  var badGroupsSet = new Set();
  try {
    badGroupsSet = new Set(
      fs
        .readFileSync(BAD_GROUPS_PATH, "utf8")
        .split(/\r?\n/)
        .map(function (l) {
          return l.trim().toLowerCase();
        })
        .filter(Boolean),
    );
  } catch (e) {}

  // State is stored under apps/down/data.

  var writeRejectLog = function (rejectFname, reason) {
    try {
      var ts = dateStr(Date.now());
      var line =
        ts + " | " + (rejectFname || "") + " | " + (reason || "") + "\n";
      fs.appendFileSync(REJECT_LOG_PATH, line);
    } catch (e) {}
  };

  // Ensure state files exist.
  (function ensureStateFilesExist() {
    try {
      if (!fs.existsSync(TV_INPROGRESS_PATH)) {
        fs.writeFileSync(TV_INPROGRESS_PATH, "{}");
      }
    } catch (e) {
      // Non-fatal.
    }
  })();

  // tvJson.js owns tv.json cache and all worker lifecycle.
  const tvJson = tvJsonMod;

  // Startup marker (tv.log only)
  (function writeStartupMarker() {
    try {
      var fmt = function () {
        try {
          var dtf = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Los_Angeles",
            year: "2-digit",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          });
          var parts = dtf.formatToParts(new Date());
          var m = {};
          for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (p && p.type && p.value) m[p.type] = p.value;
          }
          var hour = m.hour === "24" ? "00" : m.hour;
          return `${m.year}/${m.month}/${m.day} ${hour}:${m.minute}:${m.second}`;
        } catch (e) {
          var d = new Date();
          var yy = String(d.getFullYear() % 100).padStart(2, "0");
          var mm = String(d.getMonth() + 1).padStart(2, "0");
          var dd = String(d.getDate()).padStart(2, "0");
          var hh = String(d.getHours()).padStart(2, "0");
          var mi = String(d.getMinutes()).padStart(2, "0");
          var ss = String(d.getSeconds()).padStart(2, "0");
          return `${yy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
        }
      };

      try {
        unilog(1187, `tv-down started ${fmt()}`);
      } catch (e) {}
      unilog(293, `tv-down started`);
    } catch (e) {}
  })();

  // ---------------------------------------------------------------------------
  exec = childProcess.execSync;
  var execAsync = utilNode.promisify(childProcess.exec);
  mkdirp = mkdirpPkg;
  request = requestPkg;
  rimraf = rimrafPkg;
  var parseTorrentTitle = parseTorrentTitlePkg.parse;

  // --- startProc server state ------------------------------------------------
  var cycleRestartNeeded = false;
  var nextCycleTimer = null;
  downloadTime = Date.now();
  unilog(294, ".... starting tv.coffee v4 ....");

  // Declare per-cycle state in outer scope (CoffeeScript scoping is per-function).
  startTime = time = Date.now();
  deleteCount = chkCount = recentCount = 0;
  existsCount = errCount = downloadCount = blockedCount = 0;
  cycleRunning = false;
  lastPruneAt = 0;
  cycleSeq = 0;
  currentSeq = null;

  resetCycleState = function () {
    startTime = time = Date.now();
    downloadTime = Date.now();
    deleteCount = chkCount = recentCount = 0;
    existsCount = errCount = downloadCount = blockedCount = 0;
    cycleSeq = 0;
    currentSeq = null;
    // Clear reject log at the start of each cycle so it always reflects the current cycle only.
    try {
      fs.writeFileSync(REJECT_LOG_PATH, "");
    } catch (e) {}
    _cycleTiming = { cycleStart: Date.now() };
  };

  scheduleNextCycle = function () {
    if (nextCycleTimer) {
      clearTimeout(nextCycleTimer);
    }
    nextCycleTimer = setTimeout(runCycle, PROCESS_INTERVAL_MS);
    return nextCycleTimer;
  };

  runCycle = function () {
    if (cycleRunning) {
      return;
    }

    // Guard: abort if the media mount is not accessible.
    // After a reboot /mnt/media may not be mounted yet; running a cycle in that
    // state causes every disk-existence check to fail and re-queues hundreds of
    // already-downloaded files.
    try {
      const tvStat = fs.statSync(tvPath);
      if (!tvStat.isDirectory()) throw new Error("not a directory");
      // A bare mount-point with nothing in it is also suspicious.
      const tvEntries = fs.readdirSync(tvPath);
      if (tvEntries.length === 0) throw new Error("empty directory");
    } catch (e) {
      unilog(
        295,
        `download check cycle SKIPPED: tvPath not accessible (${tvPath}): ${e.message}`,
      );
      scheduleNextCycle();
      return;
    }

    if (nextCycleTimer) {
      clearTimeout(nextCycleTimer);
      nextCycleTimer = null;
    }
    cycleRunning = true;

    rotateCycleLogDedup();
    reloadState();
    resetCycleState();
    return process.nextTick(delOldFiles);
  };

  // --- HTTP server /startProc (port 3003) -----------------------------------
  // Called from a browser; handle CORS properly.
  (function startServer() {
    var http = httpNode;
    var url = urlNode;

    var setCors = function (res) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    };

    var json = function (res, statusCode, obj) {
      setCors(res);
      res.statusCode = statusCode;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(obj));
    };

    var readBody = function (req, cb) {
      var body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          req.destroy();
        }
      });
      req.on("end", () => cb(null, body));
      req.on("error", (e) => cb(e));
    };

    var startProc = function () {
      // - if a cycle is running, restart after the cycle finishes
      // - if nothing is running, start a new cycle immediately
      if (cycleRunning) {
        cycleRestartNeeded = true;
        return;
      }
      if (nextCycleTimer) {
        clearTimeout(nextCycleTimer);
        nextCycleTimer = null;
      }
      runCycle();
    };

    http
      .createServer((req, res) => {
        if (req.method === "OPTIONS") {
          setCors(res);
          res.statusCode = 204;
          return res.end();
        }

        var parsed = url.parse(req.url, true);

        // Strip proxy prefix if present
        var pathname = parsed.pathname;
        if (pathname.startsWith("/tv-api/api/tvproc/")) {
          pathname = pathname.substring("/tv-api/api/tvproc".length);
        } else if (pathname.startsWith("/tv-api/")) {
          pathname = pathname.substring("/tv-api".length);
        }

        // Handle /startProc endpoint
        if (pathname === "/startProc") {
          if (req.method === "GET") {
            try {
              startProc();
              return json(res, 200, { status: "ok" });
            } catch (e) {
              return json(res, 500, {
                status: String(e && e.message ? e.message : e),
              });
            }
          }

          if (req.method === "POST") {
            var body = "";
            req.on("data", (chunk) => {
              body += chunk;
              if (body.length > 1024 * 1024) {
                req.destroy();
              }
            });
            req.on("end", () => {
              try {
                if (body) {
                  JSON.parse(body);
                }
                startProc();
                return json(res, 200, { status: "ok" });
              } catch (e) {
                return json(res, 400, {
                  status: String(e && e.message ? e.message : e),
                });
              }
            });
            return;
          }

          return json(res, 405, { status: "method not allowed" });
        }

        // Handle /retry endpoint
        // POST body: { title: "..." }
        if (pathname === "/retry") {
          if (req.method === "POST") {
            return readBody(req, (err1, body) => {
              if (err1) {
                return json(res, 400, {
                  status: "error",
                  error: String(err1 && err1.message ? err1.message : err1),
                });
              }
              try {
                setCors(res);
                var parsed2 = body ? JSON.parse(body) : {};
                var titleToRetry =
                  parsed2 && parsed2.title ? String(parsed2.title) : "";
                if (!titleToRetry) {
                  return json(res, 400, {
                    status: "error",
                    error: "title required",
                  });
                }
                var ok = tvJson.retryEntry(titleToRetry);
                if (!ok) {
                  return json(res, 404, {
                    status: "error",
                    error: "entry not found",
                  });
                }
                // Kick off a new USB scan so the file is re-processed immediately.
                startProc();
                return json(res, 200, { status: "ok" });
              } catch (e) {
                return json(res, 500, {
                  status: "error",
                  error: String(e && e.message ? e.message : e),
                });
              }
            });
          }
          if (req.method === "OPTIONS") {
            setCors(res);
            res.statusCode = 204;
            return res.end();
          }
          return json(res, 405, { status: "method not allowed" });
        }

        // Handle /downloads endpoint
        if (pathname === "/downloads") {
          if (req.method === "GET") {
            try {
              setCors(res);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify(tvJson.getDownloads()));
            } catch (e) {
              return json(res, 500, {
                status: String(e && e.message ? e.message : e),
              });
            }
          }

          return json(res, 405, { status: "method not allowed" });
        }

        // Handle /checkFiles endpoint
        // POST body: ["..."]
        // Returns: { existingTitles: ["..."], existingProcids: [123], tvEntries: [ {...}, ... ] }
        if (pathname === "/checkFiles") {
          if (req.method === "GET") {
            try {
              var q = parsed.query || {};
              var titles = [];
              if (q.titles) {
                try {
                  // Prefer JSON array in the querystring.
                  titles = JSON.parse(q.titles);
                } catch (e) {
                  // Fallback: comma-separated.
                  titles = String(q.titles)
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                }
              } else if (q.title) {
                titles = [String(q.title)];
              }
              var out0 = tvJson.checkFiles
                ? tvJson.checkFiles(titles)
                : { existingTitles: [], existingProcids: [] };
              return json(res, 200, out0);
            } catch (e) {
              return json(res, 400, {
                status: String(e && e.message ? e.message : e),
              });
            }
          }

          if (req.method === "POST") {
            return readBody(req, (err1, body) => {
              if (err1) {
                return json(res, 400, {
                  status: String(err1 && err1.message ? err1.message : err1),
                });
              }
              try {
                var titles2 = body ? JSON.parse(body) : [];
                if (!Array.isArray(titles2)) {
                  return json(res, 400, {
                    status: "body must be a JSON array of titles",
                  });
                }
                var out2 = tvJson.checkFiles
                  ? tvJson.checkFiles(titles2)
                  : { existingTitles: [], existingProcids: [] };
                return json(res, 200, out2);
              } catch (e) {
                return json(res, 400, {
                  status: String(e && e.message ? e.message : e),
                });
              }
            });
          }

          return json(res, 405, { status: "method not allowed" });
        }

        // Handle /abortDown endpoint – kill an active download, delete its file, and block it
        // POST body: { title: string }
        // Returns: { status: 'ok' } or { status: 'error', error: '...' }
        if (pathname === "/abortDown") {
          if (req.method === "POST") {
            return readBody(req, (err1, body) => {
              if (err1) {
                return json(res, 400, {
                  status: "error",
                  error: String(err1 && err1.message ? err1.message : err1),
                });
              }
              try {
                var payload = body ? JSON.parse(body) : {};
                var abortTitle =
                  payload && payload.title ? String(payload.title) : "";
                if (!abortTitle) {
                  return json(res, 400, {
                    status: "error",
                    error: "title is required",
                  });
                }
                var aborted = tvJson.abortEntry(abortTitle);
                if (!aborted) {
                  return json(res, 404, {
                    status: "error",
                    error: "entry not found",
                  });
                }
                return json(res, 200, { status: "ok" });
              } catch (e) {
                return json(res, 400, {
                  status: "error",
                  error: String(e && e.message ? e.message : e),
                });
              }
            });
          }
          return json(res, 405, {
            status: "error",
            error: "method not allowed",
          });
        }

        // Handle /deleteProcids endpoint
        // POST body: { procIds: [...] } (legacy alias: existingProcids)
        // Returns: { status: 'ok' } OR { status: 'error', error: '...' }
        if (pathname === "/deleteProcids") {
          if (req.method === "POST") {
            return readBody(req, (err1, body) => {
              if (err1) {
                return json(res, 400, {
                  status: "error",
                  error: String(err1 && err1.message ? err1.message : err1),
                });
              }
              try {
                var payload = body ? JSON.parse(body) : {};
                var procids =
                  payload && payload.procIds
                    ? payload.procIds
                    : payload && payload.existingProcids
                      ? payload.existingProcids
                      : [];
                if (!Array.isArray(procids)) {
                  return json(res, 400, {
                    status: "error",
                    error: "procIds must be an array",
                  });
                }
                if (!tvJson.deleteProcids) {
                  return json(res, 500, {
                    status: "error",
                    error: "deleteProcids not supported",
                  });
                }
                var r = tvJson.deleteProcids(procids);
                if (r && r.ok) {
                  return json(res, 200, { status: "ok" });
                }
                return json(res, 500, {
                  status: "error",
                  error: r && r.errors ? r.errors : "delete failed",
                });
              } catch (e) {
                return json(res, 400, {
                  status: "error",
                  error: String(e && e.message ? e.message : e),
                });
              }
            });
          }

          return json(res, 405, {
            status: "error",
            error: "method not allowed",
          });
        }

        // Handle /deleteErrors endpoint – deletes all error records from the DB
        if (pathname === "/deleteErrors") {
          if (req.method === "POST") {
            try {
              setCors(res);
              var delResult = tvJson.deleteErrorRecords();
              if (delResult && delResult.ok) {
                return json(res, 200, {
                  status: "ok",
                  deleted: delResult.deleted,
                });
              }
              return json(res, 500, {
                status: "error",
                error:
                  delResult && delResult.error
                    ? delResult.error
                    : "delete failed",
              });
            } catch (e) {
              return json(res, 500, {
                status: "error",
                error: String(e && e.message ? e.message : e),
              });
            }
          }
          return json(res, 405, {
            status: "error",
            error: "method not allowed",
          });
        }

        // Handle /forceDown endpoint
        if (pathname === "/forceDown") {
          if (req.method === "POST") {
            return readBody(req, (err1, body) => {
              if (err1) {
                return json(res, 400, {
                  status: "error",
                  error: String(err1 && err1.message ? err1.message : err1),
                });
              }
              try {
                var parsed0 = body ? JSON.parse(body) : [];
                var files, fromTorFlag;
                // Accept either a plain array (legacy) or { files: [...], fromTor: true }.
                if (Array.isArray(parsed0)) {
                  files = parsed0;
                  fromTorFlag = false;
                } else if (parsed0 && Array.isArray(parsed0.files)) {
                  files = parsed0.files;
                  fromTorFlag = parsed0.fromTor === true;
                } else {
                  files = [];
                  fromTorFlag = false;
                }
                if (!Array.isArray(files) || files.length === 0) {
                  return json(res, 400, {
                    status: "error",
                    error: "body must be a non-empty JSON array of file paths",
                  });
                }

                if (fromTorFlag) {
                  if (!torFilePaths) torFilePaths = new Set();
                  for (var tfi = 0; tfi < files.length; tfi++) {
                    torFilePaths.add(String(files[tfi]));
                  }
                }

                forcedFiles = files;
                unilog(
                  296,
                  "Received forced files:",
                  forcedFiles.length,
                  fromTorFlag ? "(fromTor)" : "",
                );

                // Start cycle if not running, or restart if running
                if (cycleRunning) {
                  cycleRestartNeeded = true;
                  // Abort the current cycle so forced files get processed immediately
                  // instead of waiting for all normal USB files to finish.
                  if (usbFiles) usbFiles.length = 0;
                } else {
                  if (nextCycleTimer) {
                    clearTimeout(nextCycleTimer);
                    nextCycleTimer = null;
                  }
                  runCycle();
                }

                return json(res, 200, { status: "ok" });
              } catch (e) {
                return json(res, 400, {
                  status: "error",
                  error: String(e && e.message ? e.message : e),
                });
              }
            });
          }
          return json(res, 405, {
            status: "error",
            error: "method not allowed",
          });
        }

        // Handle /torFiles endpoint — register file paths as from-tor without forcing
        // POST body: JSON array of USB file paths (same format as /forceDown)
        if (pathname === "/torFiles") {
          if (req.method === "POST") {
            return readBody(req, (err1, body) => {
              if (err1) {
                return json(res, 400, {
                  status: "error",
                  error: String(err1 && err1.message ? err1.message : err1),
                });
              }
              try {
                var torFileList = body ? JSON.parse(body) : [];
                if (!Array.isArray(torFileList) || torFileList.length === 0) {
                  return json(res, 400, {
                    status: "error",
                    error: "body must be a non-empty JSON array of file paths",
                  });
                }
                if (!torFilePaths) torFilePaths = new Set();
                for (var tfi2 = 0; tfi2 < torFileList.length; tfi2++) {
                  torFilePaths.add(String(torFileList[tfi2]));
                }
                unilog(297, "Registered tor files:", torFileList.length);
                return json(res, 200, { status: "ok" });
              } catch (e) {
                return json(res, 400, {
                  status: "error",
                  error: String(e && e.message ? e.message : e),
                });
              }
            });
          }
          return json(res, 405, {
            status: "error",
            error: "method not allowed",
          });
        }

        // Handle /delItems endpoint – deletes download records and their files
        if (pathname === "/delItems") {
          if (req.method === "POST") {
            return readBody(req, (err1, body) => {
              if (err1) {
                return json(res, 400, {
                  status: "error",
                  error: String(err1 && err1.message ? err1.message : err1),
                });
              }
              try {
                var parsed1 = body ? JSON.parse(body) : {};
                var titles1 = Array.isArray(parsed1.titles)
                  ? parsed1.titles
                  : [];
                if (titles1.length === 0) {
                  return json(res, 400, {
                    status: "error",
                    error: "titles must be a non-empty array",
                  });
                }
                var localPaths = tvJsonMod.deleteByTitles(titles1);
                // Delete actual files from disk
                for (var lpi = 0; lpi < localPaths.length; lpi++) {
                  var lp = localPaths[lpi];
                  if (lp && pathNode.isAbsolute(lp)) {
                    try {
                      fsNode.rmSync(lp, { recursive: true, force: true });
                    } catch (rmErr) {
                      unilog(
                        298,
                        "delItems: failed to delete",
                        lp,
                        String(rmErr && rmErr.message ? rmErr.message : rmErr),
                      );
                    }
                  }
                }
                return json(res, 200, {
                  status: "ok",
                  deleted: titles1.length,
                });
              } catch (e) {
                return json(res, 500, {
                  status: "error",
                  error: String(e && e.message ? e.message : e),
                });
              }
            });
          }
          return json(res, 405, {
            status: "error",
            error: "method not allowed",
          });
        }

        // Handle /movieDownloads endpoint – returns current movie rsync job status
        if (pathname === "/movieDownloads") {
          if (req.method === "GET") {
            try {
              return json(res, 200, movieRsync.getMovieDownJobs());
            } catch (e) {
              return json(res, 500, {
                status: "error",
                error: String(e && e.message ? e.message : e),
              });
            }
          }
          return json(res, 405, { status: "method not allowed" });
        }

        // Handle /movieCycle endpoint – manually triggers a movie rsync cycle
        if (pathname === "/movieCycle") {
          if (req.method === "POST") {
            movieRsync.triggerCycle().catch(() => {});
            return json(res, 200, { status: "ok" });
          }
          return json(res, 405, { status: "method not allowed" });
        }

        // Handle /movieKill endpoint – aborts all active rsync downloads
        if (pathname === "/movieKill") {
          if (req.method === "POST") {
            movieRsync.killAll();
            return json(res, 200, { status: "ok" });
          }
          return json(res, 405, { status: "method not allowed" });
        }

        // No matching endpoint
        return json(res, 404, { status: "not found" });
      })
      .on("error", (e) => {
        unilog(299, `HTTP server error: ${e && (e.code || e.message || e)}`);
        if (e && e.code === "EADDRINUSE") {
          unilog(300, `port 3003 already in use — exiting so pm2 can retry`);
          process.exit(1);
        }
      })
      .listen(3003, "0.0.0.0", () => {
        unilog(301, `HTTP server listening on port 3003`);
        startDownChannelPeer();
      });

    // Start movie rsync cycling (1 min normal, 5 sec fast after qBt finishes)
    movieRsync.startCycling();
  })();

  findUsb =
    `ssh ${usbHost} \"find files -ignore_readdir_race -type f -printf '%CY-%Cm-%Cd-%P-%s\\\\n' 2>/dev/null\" ` +
    "| grep -Ev .r[0-9]+-[0-9]+$ | grep -Ev .rar-[0-9]+$ " +
    "| grep -Ev screen[0-9]+.png-[0-9]+$" +
    "| grep -Evi '\\.(srr|sfv|nfo|nzb|jpg|jpeg|png|txt|sub|idx|srt|bup|ifo|vob)-[0-9]+$'";

  var FORCE_SCAN_EXCLUDED_EXTENSIONS = new Set([
    "srr",
    "sfv",
    "nfo",
    "nzb",
    "jpg",
    "jpeg",
    "png",
    "txt",
    "sub",
    "idx",
    "srt",
    "bup",
    "ifo",
    "vob",
  ]);

  var shouldSkipUsbLineByScanRules = function (line) {
    var text = String(line || "").trim();
    if (!text) return true;
    var lineNoSize = text.split("-").slice(0, -1).join("-");
    var relPath = lineNoSize.slice(11);
    if (!relPath) return true;
    if (/\.r\d\d$/i.test(relPath) || /\.rar$/i.test(relPath)) return true;
    if (/screen\d+\.png$/i.test(relPath)) return true;
    var ext = path.extname(relPath).toLowerCase().replace(/^\./, "");
    return FORCE_SCAN_EXCLUDED_EXTENSIONS.has(ext);
  };

  // Timestamps in tv-finished.json must be PST timezone.
  // Use America/Los_Angeles so DST is handled correctly.
  var PST_TZ = "America/Los_Angeles";

  dateStr = (date) => {
    try {
      var d = new Date(date);
      var dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: PST_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      var parts = dtf.formatToParts(d);
      var m = {};
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p && p.type && p.value) m[p.type] = p.value;
      }
      var hour = m.hour === "24" ? "00" : m.hour;
      return `${m.year}/${m.month}/${m.day}-${hour}:${m.minute}:${m.second}`;
    } catch (e) {
      // Fallback to local time if Intl is unavailable.
      var day, hours, minutes, month, seconds, year;
      date = new Date(date);
      year = date.getFullYear();
      month = (date.getMonth() + 1).toString().padStart(2, "0");
      day = date.getDate().toString().padStart(2, "0");
      hours = date.getHours().toString().padStart(2, "0");
      minutes = date.getMinutes().toString().padStart(2, "0");
      seconds = date.getSeconds().toString().padStart(2, "0");
      return `${year}/${month}/${day}-${hours}:${minutes}:${seconds}`;
    }
  };

  // Convert a local date/time (YYYY/MM/DD-HH:MM:SS) in PST_TZ to epoch ms.
  var epochMsFromZonedParts = function (y, mo, d, hh, mi, ss) {
    // Initial guess: treat provided components as UTC.
    var t = Date.UTC(y, mo - 1, d, hh, mi, ss);
    // Iteratively adjust to account for timezone offset/DST.
    for (var iter = 0; iter < 3; iter++) {
      var dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: PST_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      var parts = dtf.formatToParts(new Date(t));
      var m = {};
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p && p.type && p.value) m[p.type] = p.value;
      }
      var yy = parseInt(m.year, 10);
      var mm = parseInt(m.month, 10);
      var dd = parseInt(m.day, 10);
      var h2 = parseInt(m.hour, 10);
      var m2 = parseInt(m.minute, 10);
      var s2 = parseInt(m.second, 10);
      var want = Date.UTC(y, mo - 1, d, hh, mi, ss);
      var got = Date.UTC(yy, mm - 1, dd, h2, m2, s2);
      var delta = want - got;
      if (delta === 0) {
        break;
      }
      t += delta;
    }
    return t;
  };

  var parseMapTimestampMs = function (timex) {
    if (typeof timex !== "string") {
      return null;
    }
    var m = timex.match(/^(\d{4})\/(\d{2})\/(\d{2})-(\d{2}):(\d{2}):(\d{2})$/);
    if (m) {
      var y = parseInt(m[1], 10);
      var mo = parseInt(m[2], 10);
      var d = parseInt(m[3], 10);
      var hh = parseInt(m[4], 10);
      var mi = parseInt(m[5], 10);
      var ss = parseInt(m[6], 10);
      if ([y, mo, d, hh, mi, ss].every(Number.isFinite)) {
        try {
          return epochMsFromZonedParts(y, mo, d, hh, mi, ss);
        } catch (e) {
          return null;
        }
      }
    }
    var t = new Date(timex).getTime();
    return Number.isNaN(t) ? null : t;
  };

  readMap = (fname) => {
    var entry, map, timex;
    map = JSON.parse(fs.readFileSync(fname, "utf8"));
    for (entry in map) {
      timex = map[entry];
      map[entry] = parseMapTimestampMs(timex);
    }
    return map;
  };

  writeMap = (fname, map) => {
    var entry, out, timex;
    out = {};
    for (entry in map) {
      timex = map[entry];
      out[entry] = dateStr(timex);
    }
    return fs.writeFileSync(fname, JSON.stringify(out));
  };

  errors = null;
  inProgress = null;

  // Per-cycle view of current tv.json titles (do not cache across cycles)
  var tvJsonTitles = null;
  // Per-cycle S/E dedup map for fromFlex: key = seriesName+"\x00"+SeStr → fname already queued
  var cycleSeMap = null;
  // Per-cycle index of in-flight downloads: key = seasonDir+"\x00"+SeStr → best resolution.
  // Blocks queuing a stale same/worse-quality candidate for an episode already downloading
  // under a different filename (see down-coll-plan.md).
  var inProgressSeIndex = null;

  blocked = null;
  map = {};

  reloadState = function () {
    var f, j, len, line, mapLines, mapStr, results, t;
    // Do not cache tv-finished.json / tv-inProgress.json here.
    // Those are loaded once per cycle immediately after the USB file list is fetched.
    blocked = Object.assign({}, TV_BLOCKED);
    map = {};
    mapStr = fs.readFileSync(TV_MAP_PATH, "utf8");
    mapLines = mapStr.split("\n");
    results = [];
    for (j = 0, len = mapLines.length; j < len; j++) {
      line = mapLines[j];
      [f, t] = line.split(",");
      if (line.length) {
        results.push((map[f.trim()] = t.trim()));
      } else {
        results.push(void 0);
      }
    }
    return results;
  };

  reloadState();

  // On load, workers are started by tvJson.js on module load.

  tvPath = "/mnt/media/tv/";

  // --- Error-download: route "worth downloading" error files through normal pipeline ---
  const TV_ERRORS_PATH = "/mnt/media/tv-errors/";

  const isErrorWorthDownloading = (reason) => {
    if (!reason) return false;
    return (
      reason.startsWith("parse-torrent-title:") ||
      reason === "non-episode" ||
      reason === "thetvdb: no series match"
    );
  };

  escQuotes = function (str) {
    return "'" + str.replace(/\\/g, "\\\\").replace(/'/g, "'\\''") + "'";
  };

  //###############
  // async routines
  getUsbFiles =
    delOldFiles =
    checkFiles =
    checkFile =
    badFile =
    checkFileExists =
    checkFile =
    chkTvDB =
      null;

  //######################################
  // get the api token with retry logic
  theTvDbToken = null;

  const loginToTvDb = (retryCount = 0) => {
    const MAX_RETRIES = 10;
    const RETRY_DELAY_MS = Math.min(30000, 5000 * Math.pow(2, retryCount)); // exponential backoff, max 30s

    request.post(
      "https://api4.thetvdb.com/v4/login",
      {
        json: true,
        body: {
          apikey: "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df",
          pin: "HXEVSDFF",
        },
      },
      (error, response, body) => {
        if (error || response?.statusCode !== 200) {
          const status = response?.statusCode || "unknown";
          const message = error?.message || String(error || `HTTP ${status}`);

          if (retryCount < MAX_RETRIES) {
            unilog(1746, `theTvDb login failed (attempt ${retryCount + 1}/${MAX_RETRIES + 1}): ${message}; status=${status}; retrying in ${RETRY_DELAY_MS}ms`);
            setTimeout(() => loginToTvDb(retryCount + 1), RETRY_DELAY_MS);
          } else {
            unilog(1747, `theTvDb login gave up after ${retryCount + 1} attempts: ${message}; status=${status}; calling process.exit()`);
            return process.exit(1);
          }
        } else {
          theTvDbToken = body.data.token;
          unilog(303, "TheTVDB login successful");
          return process.nextTick(runCycle);
        }
      },
    );
  };

  loginToTvDb();

  //#####################################################
  // delete old files in usb/files
  delOldFiles = () => {
    var PRUNE_DAYS, PRUNE_INTERVAL_MS;
    PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - lastPruneAt >= PRUNE_INTERVAL_MS) {
      // Inline prune.sh behavior: delete files older than 60 days on the USB host.
      // Run async so it doesn't block the cycle — proceed to checkFiles immediately.
      PRUNE_DAYS = 60;
      lastPruneAt = Date.now();
      (async () => {
        var folderCount = 0;
        var fileCount = 0;
        try {
          var { stdout: typesOut } = await execAsync(
            `ssh ${usbHost} "find ~/files -mtime +${PRUNE_DAYS} -printf '%y\\n' 2>/dev/null"`,
            { timeout: 5 * 60 * 1000 },
          );
          var types = typesOut
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          folderCount = types.filter((t) => t === "d").length;
          fileCount = types.filter((t) => t === "f").length;
        } catch (e) {
          // Non-fatal; counts stay 0.
        }
        try {
          await execAsync(
            `ssh ${usbHost} "find ~/files -mtime +${PRUNE_DAYS} -exec rm -rf {} \\; >/dev/null 2>&1"`,
            { timeout: 5 * 60 * 1000 },
          );
          unilog(1779, `usb prune: deleted ${folderCount} folders, ${fileCount} files (older than ${PRUNE_DAYS} days)`);
        } catch (e) {
          unilog(1590, `usb prune failed: ${e.message}`);
        }
        // After prune completes, scan dirs and prune DB entries.
        try {
          var { stdout: dirsOut } = await execAsync(
            `ssh ${usbHost} "find files -ignore_readdir_race -type d -printf '%P\\n' 2>/dev/null"`,
            { timeout: 300000 },
          );
          var dirs = dirsOut
            .split("\n")
            .map((s) => String(s || "").trim())
            .filter((s) => s.length);
          var set = new Set(dirs);
          if (tvJson.hourlyUsbPruneAndTvResync) {
            tvJson.hourlyUsbPruneAndTvResync(set);
          } else {
            tvJson.pruneMissingUsbDirs(set);
            if (tvJson.tvResync) tvJson.tvResync();
          }
        } catch (e) {
          // Non-fatal.
        }
      })();
    }
    return process.nextTick(checkFiles);
  };

  //###########################################################
  // check each remote file, compute series and episode numbers
  usbFilePath =
    usbFileSize =
    usbFiles =
    seriesName =
    season =
    episode =
    fname =
    title =
    folderTitle =
    type =
    destTitle =
      null;
  usbFileBytes = null;
  tvDbErrCount = 0;
  skipPaths = null;

  // DVD staging directory on local server.
  const DVD_STAGE_DIR = "/mnt/media/tmp-dvd";

  // ---------------------------------------------------------------------------
  // DVD folder processing:
  //  1. Scan USB for every VOB/IFO/BUP file under VIDEO_TS directories.
  //  2. Queue each file as an individual download via tvJson.addEntry so the
  //     existing worker infrastructure handles it (one card per file).
  //  3. On each cycle, check whether all files for a given VIDEO_TS disc are
  //     fully staged.  When they are, run makemkvcon on the staged VIDEO_TS
  //     folder, move the resulting MKVs to the proper Season directory, and
  //     clean up.
  // ---------------------------------------------------------------------------
  const processDvdFolders = async () => {
    // Scan USB for all VOB, IFO, and BUP files inside VIDEO_TS dirs.
    let dvdFileScanLines;
    try {
      const { stdout } = await execAsync(
        `ssh ${usbHost} "find files -ignore_readdir_race -type f \\( -iname '*.VOB' -o -iname '*.IFO' -o -iname '*.BUP' \\) -printf '%P\\t%s\\n' 2>/dev/null | sort"`,
        { timeout: 60000 },
      );
      dvdFileScanLines = stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch (e) {
      return; // SSH failed — skip DVD processing this cycle
    }

    if (dvdFileScanLines.length === 0) return;

    // Group files by disc (VIDEO_TS dir) and resolve each torrent folder against Emby.
    // discMap key = vtsDirRelative (e.g. "The Norm Show - Complete/NORMS1/Disc 1/VIDEO_TS")
    // value = { torrentFolder, vtsDirRelative, files: [{relPath, fileBytes}], totalSize }
    const discMap = new Map();
    const torrentFolderOrder = [];
    for (const line of dvdFileScanLines) {
      const tabIdx = line.indexOf("\t");
      if (tabIdx < 0) continue;
      const relPath = line.slice(0, tabIdx); // relative to files/
      const fileBytes = parseInt(line.slice(tabIdx + 1), 10) || 0;
      const parts = relPath.split("/");
      if (parts.length < 2) continue;
      const torrentFolder = parts[0];
      // Only process files inside a VIDEO_TS directory
      const videoTsIdx = parts.findIndex((p) => p.toUpperCase() === "VIDEO_TS");
      if (videoTsIdx < 0) continue;
      const vtsDirRelative = parts.slice(0, videoTsIdx + 1).join("/");
      if (!torrentFolderOrder.includes(torrentFolder))
        torrentFolderOrder.push(torrentFolder);
      if (!discMap.has(vtsDirRelative)) {
        discMap.set(vtsDirRelative, {
          torrentFolder,
          vtsDirRelative,
          files: [],
          totalSize: 0,
        });
      }
      const disc = discMap.get(vtsDirRelative);
      disc.files.push({ relPath, fileBytes });
      disc.totalSize += fileBytes;
    }

    if (discMap.size === 0) return;

    // Resolve each torrent folder against Emby.
    // Build a map: torrentFolder -> { showTitle, tvdbId, embyFolderName, showDotName }
    const torrentMeta = new Map();
    const dvdTorrentFolders = new Set();
    for (const torrentFolder of torrentFolderOrder) {
      if (
        skipPaths &&
        skipPaths.some(
          (sp) => torrentFolder.startsWith(sp) || sp.startsWith(torrentFolder),
        )
      ) {
        unilog(305, `DVD: skipping locked folder "${torrentFolder}"`);
        continue;
      }
      var parsed2 = {};
      try {
        parsed2 =
          parseTorrentTitle(torrentFolder.replace(/\.[a-z0-9]{2,4}$/i, "")) ||
          {};
      } catch (e) {
        parsed2 = {};
      }
      const showTitle = parseTitleFromFilename(torrentFolder, "", parsed2);
      if (!showTitle) {
        unilog(
          306,
          `DVD: cannot parse title from "${torrentFolder}", skipping`,
        );
        continue;
      }
      if (!embyMap) {
        unilog(307, `DVD: no embyMap loaded, skipping "${torrentFolder}"`);
        continue;
      }
      const embyShowNames = Object.keys(embyMap).filter(
        (k) => embyMap[k] && embyMap[k].inEmby,
      );
      const embyKey =
        smartTitleMatch(showTitle, embyShowNames, null, false) || showTitle;
      const embyEntry = embyMap[embyKey];
      if (!embyEntry || !embyEntry.inEmby) {
        unilog(
          308,
          "------",
          "DVD: NOT IN EMBY, SKIPPING:",
          torrentFolder,
          "(",
          showTitle,
          ")",
        );
        continue;
      }
      dvdTorrentFolders.add(torrentFolder);
      torrentMeta.set(torrentFolder, {
        showTitle,
        tvdbId: embyEntry.tvdbId || null,
        embyFolderName: embyEntry.path || embyKey,
        showDotName: torrentFolder.replace(/ /g, "."),
      });
    }

    if (dvdTorrentFolders.size === 0) {
      usbFiles = usbFiles.filter((line) => {
        const noSize = line.split("-").slice(0, -1).join("-");
        const relPath = noSize.slice(11);
        return !dvdTorrentFolders.has(relPath.split("/")[0]);
      });
      return;
    }

    const unixNow = () => Math.floor(Date.now() / 1000);

    // For each disc, either queue missing files or run makemkv if all staged.
    for (const [vtsDirRelative, disc] of discMap) {
      const { torrentFolder } = disc;
      if (!dvdTorrentFolders.has(torrentFolder)) continue;
      const meta = torrentMeta.get(torrentFolder);
      if (!meta) continue;

      // If the DVD:makemkv card for this disc is already finished, skip entirely.
      const makemkvCardTitle = `DVD:makemkv:${vtsDirRelative}`;
      const makemkvCard = tvJson.getEntryByTitle(makemkvCardTitle);
      if (makemkvCard && makemkvCard.status === "finished") continue;

      const localVtsDir = path.join(DVD_STAGE_DIR, vtsDirRelative);

      // Check which files are already staged.
      const missingFiles = disc.files.filter(({ relPath }) => {
        const localPath = path.join(DVD_STAGE_DIR, relPath);
        try {
          return !fs.existsSync(localPath);
        } catch {
          return true;
        }
      });

      if (missingFiles.length > 0) {
        // Queue missing files as individual download entries.
        try {
          fs.mkdirSync(localVtsDir, { recursive: true });
        } catch (e) {}

        // Determine season from vtsDirRelative path (same logic as processDvdDisc).
        const vtsPathParts = vtsDirRelative.split("/");
        let detectedSeason = 1;
        for (let i = 0; i < vtsPathParts.length; i++) {
          const part = vtsPathParts[i];
          // Match: S02D01, S2D1 (Season + Disc format)
          let sm = part.match(/[Ss](\d{1,2})[Dd]\d+/);
          if (!sm) {
            // Match: S02, S2 (standalone season marker)
            sm = part.match(/[Ss](\d{1,2})(?![0-9a-zA-Z])/);
          }
          if (!sm) {
            // Match: Season 1, season1 (with optional whitespace)
            sm = part.match(/[Ss](?:eason)?\s*(\d+)/);
          }
          if (!sm) {
            // Match: trailing number like "NORMS1"
            sm = part.match(/(\d+)\s*$/);
          }
          if (sm) {
            detectedSeason = parseInt(sm[1], 10);
            break;
          }
        }

        for (const { relPath, fileBytes } of missingFiles) {
          const fileName = path.basename(relPath);
          const localDir =
            path.join(DVD_STAGE_DIR, path.dirname(relPath)) + "/";
          // Use full relPath as the DB title for uniqueness across discs.
          // usbPath = "files/" so that usbPath + title = full remote path.
          const dbTitle = relPath; // e.g. "The Norm Show - Complete/NORMS1/Disc 1/VIDEO_TS/VTS_01_1.VOB"

          // Skip if already in DB and not errored (use precise title lookup, not capped getDownloads).
          const existing = tvJson.getEntryByTitle(dbTitle);
          if (existing && !existing.error) continue;

          try {
            fs.mkdirSync(localDir, { recursive: true });
          } catch (e) {}

          tvJson.addEntry({
            usbPath: "files/",
            localPath: localDir,
            title: dbTitle,
            destTitle: fileName,
            seriesName: meta.showTitle,
            tvdbId: meta.tvdbId,
            status: "waiting",
            progress: 0,
            eta: null,
            speed: 0,
            fileSize: fileBytes,
            season: detectedSeason,
            episode: 0,
            dateStarted: 0,
            dateEnded: null,
          });
        }
        unilog(309, `DVD: queued missing file(s) for ${vtsDirRelative}`);
      } else {
        // All files staged — run makemkv if not already done.
        await processDvdDisc(vtsDirRelative, disc, meta);
      }
    }

    // Remove DVD torrent folders from the regular per-file list.
    usbFiles = usbFiles.filter((line) => {
      const noSize = line.split("-").slice(0, -1).join("-");
      const relPath = noSize.slice(11);
      return !dvdTorrentFolders.has(relPath.split("/")[0]);
    });
  };

  // Run makemkvcon on a fully-staged VIDEO_TS disc folder.
  // Determines the season number from the disc path, then moves output MKVs
  // to the correct Season directory.
  const processDvdDisc = async (vtsDirRelative, disc, meta) => {
    const { torrentFolder } = disc;
    const { showTitle, tvdbId, embyFolderName, showDotName } = meta;
    const localVtsDir = path.join(DVD_STAGE_DIR, vtsDirRelative);
    const unixNow = () => Math.floor(Date.now() / 1000);

    // Determine season from path components (e.g. NORMS1 → 1, S02D01 → 2, Disc 2 → use parent).
    const parts = vtsDirRelative.split("/");
    let dvdSeason = 1;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      // Match: S02D01, S2D1 (Season + Disc format)
      let sm = part.match(/[Ss](\d{1,2})[Dd]\d+/);
      if (!sm) {
        // Match: S02, S2 (standalone season marker)
        sm = part.match(/[Ss](\d{1,2})(?![0-9a-zA-Z])/);
      }
      if (!sm) {
        // Match: Season 1, season1 (with optional whitespace)
        sm = part.match(/[Ss](?:eason)?\s*(\d+)/);
      }
      if (!sm) {
        // Match: trailing number like "NORMS1"
        sm = part.match(/(\d+)\s*$/);
      }
      if (sm) {
        dvdSeason = parseInt(sm[1], 10);
        break;
      }
    }

    // Reuse an existing case-variant folder rather than creating a duplicate
    // that differs only by case (ext4 is case-sensitive).
    const dvdFolderName = resolveShowFolderName(tvPath, embyFolderName);
    if (dvdFolderName !== embyFolderName) {
      unilog(
        1469,
        `reusing existing case-variant folder "${dvdFolderName}" instead of "${embyFolderName}"`,
      );
    }
    const seasonDir = `${tvPath}${dvdFolderName}/Season ${dvdSeason}`;
    const makemkvOutDir = path.join(
      DVD_STAGE_DIR,
      torrentFolder,
      "mkv-out",
      vtsDirRelative.replace(/\//g, "__"),
    );

    // Skip if we already ran makemkv for this disc (output dir exists with MKVs).
    let existingMkvs = [];
    try {
      existingMkvs = fs
        .readdirSync(makemkvOutDir)
        .filter((f) => f.toLowerCase().endsWith(".mkv"));
    } catch (e) {}
    if (existingMkvs.length > 0) {
      // Move any un-moved MKVs then return.
      await moveMkvsToSeason(
        existingMkvs,
        makemkvOutDir,
        seasonDir,
        showDotName,
        dvdSeason,
        showTitle,
        tvdbId,
        unixNow,
      );
      // Write guard card and clean up staging so the cycle doesn't re-encode.
      const cardTitle = `DVD:makemkv:${vtsDirRelative}`;
      tvJson.upsertDvdEntry({
        title: cardTitle,
        seriesName: showTitle,
        tvdbId,
        status: "finished",
        progress: 100,
        dateStarted: unixNow(),
        dateEnded: unixNow(),
        localPath: seasonDir + "/",
        usbPath: `files/${torrentFolder}/`,
        season: dvdSeason,
        episode: 0,
        fileSize: disc.totalSize,
        inProgress: false,
        error: false,
      });
      tvJson.deleteDvdFileEntries(disc.files.map((f) => f.relPath));
      try {
        await execAsync(`rm -rf "${localVtsDir}"`, { timeout: 60000 });
      } catch (e) {}
      try {
        await execAsync(`rm -rf "${makemkvOutDir}"`, { timeout: 60000 });
      } catch (e) {}
      return;
    }

    unilog(310, `DVD: running makemkvcon on ${vtsDirRelative}`);

    try {
      fs.mkdirSync(makemkvOutDir, { recursive: true });
    } catch (e) {}

    // Create a card to show makemkv encoding progress.
    const cardTitle = `DVD:makemkv:${vtsDirRelative}`;
    tvJson.upsertDvdEntry({
      title: cardTitle,
      seriesName: showTitle,
      tvdbId,
      status: "encoding",
      progress: 1,
      speed: 0,
      eta: null,
      dateStarted: unixNow(),
      dateEnded: null,
      localPath: makemkvOutDir + "/",
      usbPath: `files/${torrentFolder}/`,
      season: dvdSeason,
      episode: 0,
      fileSize: disc.totalSize,
      inProgress: true,
      error: false,
    });

    const spawnStartMs = Date.now();
    let makemkvFailed = false;
    try {
      await new Promise((resolve, reject) => {
        const args = [
          "--robot",
          "mkv",
          `file:${localVtsDir}`,
          "all",
          makemkvOutDir,
        ];
        const p = childProcess.spawn("/snap/bin/makemkvcon", args, {
          stdio: ["ignore", "pipe", "pipe"],
        });

        let combinedBuf = "";
        let lastUpdateMs = 0;
        const killTimer = setTimeout(
          () => {
            try {
              p.kill();
            } catch (_) {}
            reject(new Error("makemkvcon timeout (4h)"));
          },
          4 * 60 * 60 * 1000,
        );

        // makemkvcon --robot outputs PRGV:current,total,max on stdout.
        // PRGV:current = per-title progress (resets each title)
        //      total   = cumulative disc-wide progress
        //      max     = total disc work units
        const onData = (data) => {
          combinedBuf += data.toString();
          if (combinedBuf.length > 32768)
            combinedBuf = combinedBuf.slice(-32768);
          const now = Date.now();
          if (now - lastUpdateMs < 2000) return;
          lastUpdateMs = now;
          const lines = combinedBuf.split("\n");
          for (let li = lines.length - 1; li >= 0; li--) {
            const m = lines[li].match(/^PRGV:(\d+),(\d+),(\d+)/);
            if (m) {
              const totalDone = parseInt(m[2], 10);
              const maxVal = parseInt(m[3], 10);
              const pct =
                maxVal > 0
                  ? Math.min(99, Math.round((totalDone / maxVal) * 100))
                  : 1;
              const elapsedSec = (now - spawnStartMs) / 1000;
              const eta =
                pct > 1 && elapsedSec > 0
                  ? Math.floor(Date.now() / 1000) +
                    Math.round((elapsedSec * (100 - pct)) / pct)
                  : null;
              tvJson.upsertDvdEntry({
                title: cardTitle,
                seriesName: showTitle,
                status: "encoding",
                progress: pct,
                eta,
              });
              break;
            }
          }
        };
        p.stdout.on("data", onData);
        p.stderr.on("data", onData);

        const stderrChunks = [];
        // collect stderr separately for error reporting
        p.stderr.on("data", (d) => stderrChunks.push(d.toString().slice(-200)));

        p.on("close", (code) => {
          clearTimeout(killTimer);
          if (code === 0 || code === 1)
            resolve(); // code 1 = warnings only
          else
            reject(
              new Error(
                `makemkvcon exit ${code}: ${stderrChunks.join("").slice(-200)}`,
              ),
            );
        });
        p.on("error", (e2) => {
          clearTimeout(killTimer);
          reject(e2);
        });
      });
    } catch (e) {
      err("DVD makemkvcon failed:", e && e.message ? e.message : String(e));
      tvJson.upsertDvdEntry({
        title: cardTitle,
        seriesName: showTitle,
        status: `makemkv failed: ${e && e.message ? e.message : String(e)}`,
        dateEnded: unixNow(),
        inProgress: false,
        error: true,
      });
      makemkvFailed = true;
    }

    if (makemkvFailed) return;

    tvJson.upsertDvdEntry({
      title: cardTitle,
      seriesName: showTitle,
      status: "finished",
      progress: 100,
      dateEnded: unixNow(),
      inProgress: false,
      error: false,
    });

    // Collect output MKVs and move them to the season dir.
    let outputMkvs = [];
    try {
      outputMkvs = fs
        .readdirSync(makemkvOutDir)
        .filter((f) => f.toLowerCase().endsWith(".mkv"));
    } catch (e) {}

    if (outputMkvs.length === 0) {
      unilog(311, `DVD: makemkvcon produced no MKVs for ${vtsDirRelative}`);
      return;
    }

    await moveMkvsToSeason(
      outputMkvs,
      makemkvOutDir,
      seasonDir,
      showDotName,
      dvdSeason,
      showTitle,
      tvdbId,
      unixNow,
    );

    // Clean up staged disc files now that MKVs are moved.
    tvJson.deleteDvdFileEntries(disc.files.map((f) => f.relPath));
    try {
      await execAsync(`rm -rf "${localVtsDir}"`, { timeout: 60000 });
    } catch (e) {}
    try {
      await execAsync(`rm -rf "${makemkvOutDir}"`, { timeout: 60000 });
    } catch (e) {}
  };

  const moveMkvsToSeason = async (
    mkvFiles,
    srcDir,
    seasonDir,
    showDotName,
    dvdSeason,
    showTitle,
    tvdbId,
    unixNow,
  ) => {
    try {
      fs.mkdirSync(seasonDir, { recursive: true });
    } catch (e) {}

    const sNum = `S${String(dvdSeason).padStart(2, "0")}`;

    // Sort by the _tNN title index embedded in the makemkv filename so that
    // an alphabetically-earlier compilation title (e.g. A1_t05.mkv) doesn't
    // displace real episodes.
    const titleIdx = (n) => {
      const m = n.match(/_t(\d+)\.mkv$/i);
      return m ? parseInt(m[1], 10) : 9999;
    };
    const byIndex = [...mkvFiles].sort((a, b) => titleIdx(a) - titleIdx(b));

    // Filter out compilation/omnibus titles: any MKV whose size is >= 2x the
    // median size is assumed to be a concatenated-all-episodes title.
    const sizes = byIndex.map((f) => {
      try {
        return fs.statSync(path.join(srcDir, f)).size;
      } catch {
        return 0;
      }
    });
    const sorted = [...sizes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    const sortedMkvs = byIndex.filter((_, i) => sizes[i] < median * 2);

    if (sortedMkvs.length < byIndex.length) {
      const filtered = byIndex.filter((_, i) => sizes[i] >= median * 2);
      unilog(312, `DVD: filtered compilation title(s): ${filtered.join(", ")}`);
    }

    // Deduplicate: DVDs sometimes store the same episode multiple times (e.g.
    // across disc 1 and disc 2). Two MKVs with identical file size are the
    // same content; keep only the first occurrence of each size.
    const seenSizes = new Set();
    const dedupedMkvs = [];
    const dupMkvs = [];
    for (let i = 0; i < sortedMkvs.length; i++) {
      const sz = sizes[byIndex.indexOf(sortedMkvs[i])];
      if (seenSizes.has(sz)) {
        dupMkvs.push(sortedMkvs[i]);
      } else {
        seenSizes.add(sz);
        dedupedMkvs.push(sortedMkvs[i]);
      }
    }
    if (dupMkvs.length > 0) {
      unilog(
        313,
        `DVD: filtered ${dupMkvs.length} duplicate title(s) (same size): ${dupMkvs.join(", ")}`,
      );
      // Delete the duplicate MKV files from the staging dir.
      for (const dup of dupMkvs) {
        try {
          fs.unlinkSync(path.join(srcDir, dup));
        } catch (e) {}
      }
    }
    const finalMkvs = dedupedMkvs;

    // Find next available episode slot (skip slots already filled by earlier discs).
    let existingEpCount = 0;
    try {
      const epRe = new RegExp(`${sNum}E(\\d+)`, "i");
      const existing = fs.readdirSync(seasonDir).filter((f) => epRe.test(f));
      existing.forEach((f) => {
        const m = f.match(epRe);
        if (m) existingEpCount = Math.max(existingEpCount, parseInt(m[1], 10));
      });
    } catch (e) {}

    for (let i = 0; i < finalMkvs.length; i++) {
      const srcName = finalMkvs[i];
      const eNum = `E${String(existingEpCount + i + 1).padStart(2, "0")}`;
      const destName = `${showDotName}.${sNum}${eNum}.DVDRip.mkv`;
      const srcPath = path.join(srcDir, srcName);
      const destPath = path.join(seasonDir, destName);

      if (fs.existsSync(destPath)) {
        unilog(314, `DVD: already exists: ${destName}`);
        try {
          fs.unlinkSync(srcPath);
        } catch (e) {}
        continue;
      }

      try {
        fs.renameSync(srcPath, destPath);
      } catch (e) {
        try {
          await execAsync(`mv "${srcPath}" "${destPath}"`, { timeout: 120000 });
        } catch (e2) {
          err("DVD move failed:", e2 && e2.message ? e2.message : String(e2));
          continue;
        }
      }
      await tvJson.recordShowDownloaded(showTitle, unixNow(), seasonDir);
      unilog(315, `DVD: moved ${destName} → ${seasonDir}`);
    }
  };

  checkFiles = async () => {
    var j, len, usbLine;

    if (forcedFiles && forcedFiles.length > 0) {
      unilog(316, "checking forced files...", forcedFiles.length);
      processingForced = true;
      usbFiles = forcedFiles.filter(
        (l) => l && l.trim().length && !shouldSkipUsbLineByScanRules(l),
      );
      forcedFiles = null;
    } else {
      processingForced = false;
      try {
        var { stdout: findOut } = await execAsync(findUsb, { timeout: 300000 });
        usbFiles = findOut.split("\n");
      } catch (e) {
        err("findUsb failed:", e.message || e);
        usbFiles = [];
      }
      if (_cycleTiming) _cycleTiming.afterFind = Date.now();
    }

    // Load inProgress map once per cycle, immediately after
    // the USB file list is available.
    try {
      inProgress = readMap(TV_INPROGRESS_PATH);
    } catch (e) {
      inProgress = {};
    }

    // Load queued titles once per cycle and block any file already present there.
    // This prevents duplicates after restarts where tv-inProgress.json may be cleared.
    // Backed by SQLite (tvJson.js).
    try {
      tvJsonTitles = tvJson.getTitlesMap ? tvJson.getTitlesMap() : {};
    } catch (e) {
      tvJsonTitles = {};
    }
    cycleSeMap = {};

    // Build an index of in-flight downloads keyed by season dir + SxxExx → best res.
    // Active downloads (waiting/downloading) occupy an episode even though no live
    // file is on disk yet (old file renamed to .old, new file still in .rsync-tmp),
    // so this lets the fromFlex check skip a stale same/worse-quality candidate for
    // the same episode instead of racing it (see down-coll-plan.md).
    inProgressSeIndex = {};
    try {
      var _activeDownloads = tvJson.getDownloads ? tvJson.getDownloads() : [];
      for (var _di = 0; _di < _activeDownloads.length; _di++) {
        var _de = _activeDownloads[_di];
        if (!_de || _de.error || _de.status === "finished") continue;
        var _deTitle = _de.destTitle || _de.title || "";
        var _deSeMatch = _deTitle.match(/S(\d{2})E(\d{2})/i);
        if (!_deSeMatch) continue;
        var _deSeStr = "S" + _deSeMatch[1] + "E" + _deSeMatch[2];
        var _deDir = String(_de.localPath || "").replace(/\/+$/, "");
        if (!_deDir) continue;
        var _deKey = _deDir + "\x00" + _deSeStr.toUpperCase();
        var _deRes = getResolution(_deTitle) ?? 480;
        if (
          !(_deKey in inProgressSeIndex) ||
          _deRes > inProgressSeIndex[_deKey]
        ) {
          inProgressSeIndex[_deKey] = _deRes;
        }
      }
    } catch (e) {
      inProgressSeIndex = {};
    }

    // Load Emby membership map from srvr's tvdb db once per cycle.
    // Keys are series names; value.inEmby is true if the show is in Emby.
    embyMap = null;
    try {
      embyMap = loadEmbyMapFromDb();
    } catch (e) {
      unilog(1243, `failed to load embyMap from ${TVDB_DB_PATH}: ${e.message}`);
    }

    // Reset TVDB cache each cycle so embyMap changes (inEmby toggled) take effect.
    tvdbCache = {};

    // Sort files by parsed title before processing.
    usbFiles = usbFiles.filter((l) => l && l.trim().length);
    usbFiles = usbFiles
      .map((line) => {
        // Special handling for forcedFiles format: YYYY-MM-DD-Path-Size
        if (processingForced) {
          const parts = line.split("-");
          const size = parts.pop();
          const rest = parts.join("-");
          // rest is YYYY-MM-DD-Path
          // We need to keep the full line format for checkFile to parse later
          // But here we just need sorting key
          // The format passed from client is YYYY-MM-DD-Path-Size.
          // Standard format is YYYY-MM-DD-Path-Size.
          // Line slicing below assumes YYYY/MM/DD-Time-Path-Size format from findUsb?
          // findUsb: %CY-%Cm-%Cd-%P-%s (YYYY-MM-DD-Path-Size).

          // Wait, standard `findUsb` produces: YYYY-MM-DD-Path-Size
          // checking `findUsb` definition:
          // findUsb = ... -printf '%CY-%Cm-%Cd-%P-%s\\n' ... matches YYYY-MM-DD-Path-Size
          // SO format is consistent.

          // However, below logic:
          // var lineNoSize = line.split("-").slice(0, -1).join("-");
          // var filePath = lineNoSize.slice(11); // cuts off YYYY-MM-DD- (11 chars)

          // If filePath starts with / or has strange chars it might fail.
          // Let's assume standard logic works if format is identical.
        }

        var lineNoSize = line.split("-").slice(0, -1).join("-");
        var filePath = lineNoSize.slice(11);
        var parts = filePath.split("/");
        var base = parts[parts.length - 1];
        var parsed = {};
        try {
          parsed =
            parseTorrentTitle(base.replace(/\.[a-z0-9]{2,4}$/i, "")) || {};
        } catch (e) {
          parsed = {};
        }
        var titleKey = (parsed.title || base).toLowerCase();
        var s = Number.isInteger(parsed.season) ? parsed.season : 0;
        var e = Number.isInteger(parsed.episode) ? parsed.episode : 0;
        var key = `${titleKey}\u0000${String(s).padStart(4, "0")}\u0000${String(e).padStart(4, "0")}\u0000${base.toLowerCase()}`;
        return { line, key, base };
      })
      .sort((a, b) => a.key.localeCompare(b.key));

    usbFiles = usbFiles.map((x) => x.line);
    skipPaths = [];
    for (j = 0, len = usbFiles.length; j < len; j++) {
      usbLine = usbFiles[j];
      usbLine = usbLine.split("-").slice(0, -1).join("-");
      if (usbLine.endsWith("!unrar.lock")) {
        skipPaths.push(usbLine.slice(11, -12));
      }
    }
    if (skipPaths.length > 0) {
      unilog(317, "skipping locked paths", skipPaths);
    }

    // DVD pre-pass: detect torrent folders containing VIDEO_TS dirs with VOBs.
    // Process them as whole-folder downloads + local ffmpeg conversion, then
    // remove their individual files from usbFiles so checkFile skips them.
    try {
      await processDvdFolders();
    } catch (e) {
      err("processDvdFolders error:", e && e.message ? e.message : String(e));
    }
    if (_cycleTiming) _cycleTiming.afterDvd = Date.now();

    return process.nextTick(checkFile);
  };

  // Look up tvdbId from embyMap for a given series name.
  const lookupTvdbId = (name, yearOverride = null) => {
    if (!embyMap || !name) return null;
    const key =
      smartTitleMatch(name, Object.keys(embyMap), yearOverride, false) || name;
    return embyMap[key]?.tvdbId || null;
  };

  checkFile = () => {
    var blkName,
      cmd,
      fext,
      guessItRes,
      j,
      len,
      parts,
      skipPath,
      usbLine,
      usbLineParts;
    tvDbErrCount = 0;

    if ((usbLine = usbFiles.shift())) {
      usbLineParts = usbLine.split("-");
      usbFileBytes = parseInt(usbLineParts.pop(), 10);
      usbLine = usbLineParts.join("-");
      usbFilePath = usbLine.slice(11);
      usbFileSize = sizeStr(usbFileBytes, {
        digits: 2,
        suffix: "B",
      });

      for (j = 0, len = skipPaths.length; j < len; j++) {
        skipPath = skipPaths[j];
        if (usbFilePath.startsWith(skipPath)) {
          unilog(318, `skipping locked ${usbFilePath}`);
          process.nextTick(checkFile);
          return;
        }
      }
      chkCount++;
      parts = usbFilePath.split("/");
      fname = parts[parts.length - 1];

      // Parse title early so all history events can use the real show name.
      const pathParts2 = usbFilePath.split("/");
      const folderName2 = pathParts2.length >= 2 ? pathParts2[0] : "";
      try {
        var parsed =
          parseTorrentTitle(fname.replace(/\.[a-z0-9]{2,4}$/i, "")) || {};
        var parsedFolder = {};
        try {
          if (folderName2)
            parsedFolder =
              parseTorrentTitle(folderName2.replace(/\.[a-z0-9]{2,4}$/i, "")) ||
              {};
        } catch (e) {}
        title = parseTitleFromFilename(fname, folderName2, parsed);
        folderTitle = folderName2
          ? parseTitleFromFilename(folderName2, "", parsedFolder)
          : null;
        if (folderTitle === title) folderTitle = null;
        const se = parseFileSeasonEpisode(
          fname,
          folderName2,
          parsed,
          parsedFolder,
        );
        season = se && se.season != null ? se.season : undefined;
        episode = se && se.episode != null ? se.episode : undefined;
        type = parsed.type || "episode";
        titleYear = Number.isInteger(parsed.year) ? parsed.year : undefined;
        folderTitleYear = Number.isInteger(parsedFolder.year)
          ? parsedFolder.year
          : undefined;
      } catch (e) {
        title = null;
        folderTitle = null;
        season = undefined;
        episode = undefined;
        type = "episode";
        titleYear = undefined;
        folderTitleYear = undefined;
        parsed = {};
        parsedFolder = {};
      }

      parts = fname.split(".");
      fext = parts[parts.length - 1].toLowerCase();

      const ALLOWED_EXTS = new Set([
        "mkv",
        "mp4",
        "avi",
        "ts",
        "m2ts",
        "wmv",
        "srt",
        "ass",
        "ssa",
        "asa",
        "srr",
        "nfo",
        "jpg",
        "png",
      ]);

      if (!ALLOWED_EXTS.has(fext)) {
        unilog(
          1195,
          `Down: invalid extension .${fext} for "${fname}" (${title || "unknown show"})`,
        );
        process.nextTick(checkFile);
        return;
      }
      if (
        !processingForced &&
        tvJsonTitles &&
        tvJsonTitles[fname] &&
        tvJsonTitles[fname].error
      ) {
        recentCount++;
        unilog(
          1196,
          `Down: previous error in tvJson for "${fname}" (${title || "unknown show"})`,
        );
        process.nextTick(checkFile);
        return;
      }

      if (!processingForced && tvJsonTitles && tvJsonTitles[fname]) {
        recentCount++;
        process.nextTick(checkFile);
        return;
      }

      if (inProgress && inProgress[fname]) {
        recentCount++;
        process.nextTick(checkFile);
        return;
      }
      for (blkName in blocked) {
        if (fname.indexOf(blkName) > -1) {
          blockedCount++;
          unilog(
            1185,
            `Down: TV_BLOCKED substring "${blkName}" in file "${fname}" (${title || "unknown show"})`,
          );
          process.nextTick(checkFile);
          return;
        }
      }

      // file passed all block tests, process it
      currentSeq = ++cycleSeq;
      downloadTime = Date.now();

      // Provide a clear reason when the parser can't produce S/E.
      if (!title || !Number.isInteger(season) || !Number.isInteger(episode)) {
        var detailParts = [];
        if (title) {
          detailParts.push(`title='${title}'`);
        }
        if (Number.isInteger(season)) {
          detailParts.push(`season=${season}`);
        }
        if (Number.isInteger(episode)) {
          detailParts.push(`episode=${episode}`);
        }
        var detail = detailParts.length
          ? detailParts.join(", ")
          : "no usable fields";

        // If embyMap is loaded, check whether the parsed title matches a known
        // show before creating an error entry.  Files that don't resemble any
        // Emby show (music videos, movies, etc.) are silently skipped so they
        // don't clutter the UI with error entries.
        if (!processingForced && embyMap && title) {
          var embyShowNames = Object.keys(embyMap).filter(
            (k) => embyMap[k] && embyMap[k].inEmby,
          );
          var matchesEmby = smartTitleMatch(
            title,
            embyShowNames,
            titleYear || folderTitleYear || null,
            false,
          );
          if (!matchesEmby && folderTitle) {
            matchesEmby = smartTitleMatch(
              folderTitle,
              embyShowNames,
              folderTitleYear || titleYear || null,
              false,
            );
            if (matchesEmby) {
              title = folderTitle;
              titleYear = folderTitleYear;
            }
          }
          if (!matchesEmby) {
            unilog(
              1197,
              `Down: not a TV show "${fname}" (${title || "unknown show"})`,
            );
            return process.nextTick(checkFile);
          }
        }

        if (title && Number.isInteger(season) && !Number.isInteger(episode)) {
          badFile(
            `parse-torrent-title: found title+season but no episode (${detail}) → not an episode`,
          );
        } else if (
          title &&
          !Number.isInteger(season) &&
          !Number.isInteger(episode)
        ) {
          badFile(
            `parse-torrent-title: found title but no season/episode (${detail}) → not an episode`,
          );
        } else {
          badFile(
            `parse-torrent-title: missing required fields (${detail}) → not an episode`,
          );
        }
        return;
      }
      if (type !== "episode") {
        unilog(321, "\nskipping non-episode:", fname);
        badFile("non-episode");
        return;
      }
      if (!Number.isInteger(season)) {
        err("\nno season integer for " + usbLine + ", defaulting to season 1", {
          title,
          season,
          type,
        });
        season = 1;
      }
      // If file uses compact NNN naming (e.g. 101-Title.avi or Show.101.Title.avi = S01E01),
      // rename to SxxExx format so Emby can match it to the correct episode.
      destTitle = null;
      {
        const dotIdx = fname.lastIndexOf(".");
        const fbase = dotIdx >= 0 ? fname.slice(0, dotIdx) : fname;
        const fext = dotIdx >= 0 ? fname.slice(dotIdx) : "";
        const nnn = `${season}${String(episode).padStart(2, "0")}`;
        const seStr = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
        // Case 0: NxN prefix (e.g. "1x1 - The Sofa.avi" → "S01E01 - The Sofa.avi")
        const nxnPrefixMatch = fbase.match(/^\d{1,2}x\d{1,2}[-_ ]+(.*)/i);
        // Case 1: NNN prefix (e.g. "101-Title.avi" or "101 Title.avi")
        const prefixMatch = fbase.match(new RegExp(`^${nnn}[-_ ]+(.*)`));
        if (nxnPrefixMatch) {
          const rest = nxnPrefixMatch[1].trim();
          destTitle = rest ? `${seStr} - ${rest}${fext}` : `${seStr}${fext}`;
        } else if (prefixMatch) {
          const rest = prefixMatch[1].trim();
          destTitle = rest ? `${seStr} - ${rest}${fext}` : `${seStr}${fext}`;
        } else {
          // Case 2: NNN surrounded by dots/spaces inside the name (e.g. "Show.101.Title.avi")
          const innerMatch = fbase.match(
            new RegExp(`[. _]${nnn}(?:[. _]+(.*)|$)`),
          );
          if (innerMatch) {
            const rest = (innerMatch[1] || "").trim();
            destTitle = rest ? `${seStr} - ${rest}${fext}` : `${seStr}${fext}`;
          }
        }
      }
      // (logging moved to workers)
      return process.nextTick(chkTvDB);
    } else {
      if (_cycleTiming) {
        _cycleTiming.cycleEnd = Date.now();
        const total =
          _cycleTiming.cycleEnd -
          (_cycleTiming.cycleStart || _cycleTiming.cycleEnd);
        if (total >= 60000) {
          const fmt = (a, b) => (b != null && a != null ? `${b - a}ms` : "?");
          unilog(
            324,
            `[cycle-timing] total=${total}ms` +
              ` find=${fmt(_cycleTiming.cycleStart, _cycleTiming.afterFind)}` +
              ` dvd=${fmt(_cycleTiming.afterFind, _cycleTiming.afterDvd)}` +
              ` checkFiles=${fmt(_cycleTiming.afterDvd, _cycleTiming.cycleEnd)}`,
          );
        }
        _cycleTiming = null;
      }
      cycleRunning = false;
      // If a startProc request came in during this cycle, finish the cycle first,
      // then restart immediately (do not abort between files).
      if (cycleRestartNeeded) {
        cycleRestartNeeded = false;
        if (nextCycleTimer) {
          clearTimeout(nextCycleTimer);
          nextCycleTimer = null;
        }
        return process.nextTick(runCycle);
      }

      // In the new model, workers are started only when entries are added
      // and when a worker posts "finished".
      return scheduleNextCycle();
    }
  };

  tvdburl = "";

  chkTvDB = () => {
    // smartTitleMatch() is provided by the shared @tv/share package.

    if (title in tvdbCache) {
      if (tvdbCache[title] === null) {
        // Previously determined this title is not resolvable — skip without hitting TVDB.
        unilog(
          1198,
          `Down: not resolvable (cached) "${fname}" (${title || "unknown show"})`,
        );
        return process.nextTick(checkFile);
      }
      seriesName = tvdbCache[title];
      return process.nextTick(checkFileExists);
    }

    // If the episode-specific title isn't cached but the folder title already is,
    // use the folder result directly without making a TVDB call for the episode title.
    if (folderTitle && folderTitle in tvdbCache) {
      if (tvdbCache[folderTitle] === null) {
        tvdbCache[title] = null;
        unilog(
          1199,
          `Down: not resolvable (folder cached) "${fname}" (${title || "unknown show"})`,
        );
        return process.nextTick(checkFile);
      }
      seriesName = tvdbCache[folderTitle];
      tvdbCache[title] = seriesName;
      return process.nextTick(checkFileExists);
    }

    // If the file title doesn't match any emby show but the folder title does,
    // swap to the folder title before hitting the TVDB API. This handles files
    // like "SCTV - S03E01 - ..." inside "Second.City.Television.S03..." where
    // searching TVDB for "SCTV" could produce a wrong Levenshtein match.
    if (folderTitle && folderTitle !== title && embyMap) {
      var embyShowNamesPrecheck = Object.keys(embyMap).filter(
        (k) => embyMap[k] && embyMap[k].inEmby,
      );
      if (
        embyShowNamesPrecheck.length > 0 &&
        !smartTitleMatch(
          title,
          embyShowNamesPrecheck,
          titleYear || folderTitleYear || null,
          false,
        ) &&
        smartTitleMatch(
          folderTitle,
          embyShowNamesPrecheck,
          folderTitleYear || titleYear || null,
          false,
        )
      ) {
        title = folderTitle;
        titleYear = folderTitleYear;
        folderTitle = null;
        folderTitleYear = undefined;
      }
    }

    // Remember the title we started with so we can cache it after a folderTitle retry.
    var titleBeforeRetry = title;

    unilog(325, "search tvdb:", title);

    // Some shows use "&" on TVDB where the filename has "and" (e.g. "Jam & Jerusalem").
    // Build a list of query variants to try in order.
    var tvdbQueryVariants = [title];
    if (/ and /i.test(title)) {
      tvdbQueryVariants.push(title.replace(/ and /gi, " & "));
    }

    var tryTvdbQuery = (variants) => {
      var query = variants[0];
      var remaining = variants.slice(1);
      tvdburl =
        "https://api4.thetvdb.com/v4/search?type=series&q=" +
        encodeURIComponent(query);
      return request(
        tvdburl,
        {
          json: true,
          timeout: 15000,
          headers: {
            Authorization: "Bearer " + theTvDbToken,
          },
        },
        (error, response, body) => {
          var ref;
          var noResults =
            !error &&
            !((ref = body && body.data) != null ? ref[0] : void 0) &&
            (response != null ? response.statusCode : void 0) === 200;

          // If no results and we have a variant to try, retry with the next variant.
          if (noResults && remaining.length > 0) {
            return tryTvdbQuery(remaining);
          }

          if (
            error ||
            !((ref = body && body.data) != null ? ref[0] : void 0) ||
            (response != null ? response.statusCode : void 0) !== 200
          ) {
            if (error) {
              const message = error && error.message ? error.message : error;
              const status = response && response.statusCode;
              if (++tvDbErrCount >= 15) {
                unilog(1748, `tvdb search gave up for ${fname} after ${tvDbErrCount} failures: ${message} | status: ${status} | downloaded=${downloadCount}`);
                return process.nextTick(checkFile);
              }
              unilog(1749, `tvdb search failed for ${fname}: ${message} | status: ${status}; retrying in ${rsyncDelay}ms (failure ${tvDbErrCount}/15)`);
              return setTimeout(chkTvDB, rsyncDelay);
            } else {
              err(`tvdb no results: fname: ${fname} | url: ${tvdburl}`);
              var embyShowNamesForTvdb =
                !processingForced && embyMap
                  ? Object.keys(embyMap).filter(
                      (k) => embyMap[k] && embyMap[k].inEmby,
                    )
                  : [];
              var tvdbMatchesEmby =
                embyShowNamesForTvdb.length > 0
                  ? smartTitleMatch(
                      title,
                      embyShowNamesForTvdb,
                      titleYear || folderTitleYear || null,
                      false,
                    )
                  : null;
              if (!processingForced && !tvdbMatchesEmby) {
                // If the filename gave an abbreviated title (e.g. "tmaws"), retry with
                // the folder-derived title before giving up.
                if (folderTitle && folderTitle !== title) {
                  title = folderTitle;
                  titleYear = folderTitleYear;
                  folderTitle = null;
                  folderTitleYear = undefined;
                  return process.nextTick(chkTvDB);
                }
                unilog(
                  1200,
                  `Down: no TVDB match, not in Emby "${fname}" (${title || "unknown show"})`,
                );
                // Cache null so remaining episodes from the same folder skip TVDB this cycle.
                tvdbCache[title] = null;
                if (titleBeforeRetry && titleBeforeRetry !== title)
                  tvdbCache[titleBeforeRetry] = null;
                return process.nextTick(checkFile);
              }
              badFile("thetvdb: no series match");
              return;
            }
          } else {
            // Prefer a title match across all results (basic normalization first, then aggressive).
            var results = Array.isArray(body && body.data) ? body.data : [];
            var resultNames = results
              .map((r) => {
                var resultName = r && r.name ? String(r.name) : "";
                if (!resultName) return null;
                var rawYear =
                  (r && r.year != null ? String(r.year) : "") ||
                  (r && r.firstAired ? String(r.firstAired) : "") ||
                  (r && r.first_air_date ? String(r.first_air_date) : "") ||
                  (r && r.first_air_time ? String(r.first_air_time) : "") ||
                  (r && r.premiereDate ? String(r.premiereDate) : "") ||
                  "";
                var matchYear = rawYear.slice(0, 4);
                var alreadyHasYear = new RegExp(
                  "\\(" + matchYear + "\\)\\s*$",
                ).test(resultName);
                return /^\d{4}$/.test(matchYear) && !alreadyHasYear
                  ? `${resultName} (${matchYear})`
                  : resultName;
              })
              .filter(Boolean);

            seriesName = smartTitleMatch(
              title,
              resultNames,
              titleYear || folderTitleYear || null,
            );
            unilog(327, "tvdb got:", { seriesName, title });
            if (map[seriesName]) {
              unilog(328, "Mapping", seriesName, "to", map[seriesName]);
              seriesName = map[seriesName];
            }
            if (!seriesName) {
              // If the filename gave an abbreviated title, retry with the folder-derived title.
              if (folderTitle && folderTitle !== title) {
                title = folderTitle;
                folderTitle = null;
                return process.nextTick(chkTvDB);
              }
              unilog(
                329,
                "------",
                downloadCount,
                "/",
                chkCount,
                "NO SERIES MATCH, SKIPPING:",
                fname,
              );
              unilog(
                1201,
                `Down: no series match on TVDB "${fname}" (${title || "unknown show"})`,
              );
              // Cache null so remaining episodes from the same folder skip TVDB this cycle.
              tvdbCache[title] = null;
              if (titleBeforeRetry && titleBeforeRetry !== title)
                tvdbCache[titleBeforeRetry] = null;
              return process.nextTick(checkFile);
            }
            tvdbCache[title] = seriesName;
            // Also cache the original title (before any folderTitle retry) so
            // subsequent episodes with the same abbreviated filename skip TVDB entirely.
            if (titleBeforeRetry && titleBeforeRetry !== title) {
              tvdbCache[titleBeforeRetry] = seriesName;
            }
            return process.nextTick(checkFileExists);
          }
        },
      );
    };

    return tryTvdbQuery(tvdbQueryVariants);
  };

  function flexBitDepth(s) {
    return /10.?bit|hdr/i.test(String(s || "")) ? 10 : 8;
  }
  function flexFileIsBetterThanSent(usbFname, sentEntry) {
    var sentSrc = String(sentEntry.quality || sentEntry.title || "");
    var usbRes = getResolution(usbFname) ?? 480;
    var sentRes = getResolution(sentSrc) ?? 480;
    if (usbRes !== sentRes) return usbRes > sentRes;
    var usbDepth = flexBitDepth(usbFname);
    var sentDepth = flexBitDepth(sentSrc);
    if (usbDepth !== sentDepth) return usbDepth > sentDepth;
    var usbHevc = isHevc(usbFname);
    var sentHevc = isHevc(sentSrc);
    if (usbHevc !== sentHevc) return sentHevc; // sent needs transcoding → usb is better
    var usbGroup = (
      parseTorrentTitle(usbFname.replace(/\.[a-z0-9]{2,4}$/i, ""))?.group || ""
    ).toLowerCase();
    var sentGroup = (
      parseTorrentTitle(
        String(sentEntry.title || "").replace(/\.[a-z0-9]{2,4}$/i, ""),
      )?.group || ""
    ).toLowerCase();
    var usbBad = badGroupsSet.has(usbGroup);
    var sentBad = badGroupsSet.has(sentGroup);
    if (usbBad !== sentBad) return sentBad; // sent is bad group → usb file is better
    return false;
  }

  checkFileExists = () => {
    var e, tvFilePath, tvSeasonPath, usbLongPath, videoPath;
    const seriesMatchYear = titleYear || folderTitleYear || null;
    const embyKeyForFolder =
      embyMap && seriesName
        ? smartTitleMatch(
            seriesName,
            Object.keys(embyMap),
            seriesMatchYear,
            false,
          ) || seriesName
        : seriesName;
    const embyFolderNameRaw =
      embyMap && embyKeyForFolder && embyMap[embyKeyForFolder]?.path
        ? embyMap[embyKeyForFolder].path
        : embyKeyForFolder || seriesName;
    // Reuse an existing case-variant folder rather than creating a duplicate
    // that differs only by case (ext4 is case-sensitive).
    const embyFolderName = resolveShowFolderName(tvPath, embyFolderNameRaw);
    if (embyFolderName !== embyFolderNameRaw) {
      unilog(
        1470,
        `reusing existing case-variant folder "${embyFolderName}" instead of "${embyFolderNameRaw}"`,
      );
    }
    tvSeasonPath = `${tvPath}${embyFolderName}/Season ${season}`;
    tvFilePath = `${tvSeasonPath}/${fname}`;
    videoPath = `files/${usbFilePath}`;
    var tvLocalDir = `${tvSeasonPath}/`;

    // 2026-03-18: Canonical rename — if destTitle wasn't already set by the
    // NNN/NxN handler and the filename doesn't already contain SxxExx, rename
    // to "<EmbyFolderName> SxxExx<ext>" so Emby reliably matches every episode.
    // Original filename is preserved in the SQLite `title` column for rollback.
    if (
      !destTitle &&
      Number.isInteger(season) &&
      Number.isInteger(episode) &&
      !/S\d{2}E\d{2}/i.test(fname)
    ) {
      const dotIdx = fname.lastIndexOf(".");
      const fext = dotIdx >= 0 ? fname.slice(dotIdx) : "";
      const seStr = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
      destTitle = `${embyFolderName} ${seStr}${fext}`;
    }

    // usbPath is the folder containing the file on the USB host.
    // Example: "~/files/<torrent-folder>/"
    var usbDir = "";
    try {
      usbDir = path.dirname(usbFilePath);
    } catch (e) {
      usbDir = "";
    }
    if (usbDir === "." || usbDir === "/") {
      usbDir = "";
    }
    var usbPath = usbDir ? `~/files/${usbDir}/` : "~/files/";

    if (SKIP_DOWNLOAD) {
      // Skip download mode: no-op in the new model.
      return process.nextTick(checkFile);
    }

    // Disk check first: if the file is already on disk, mark finished and skip.
    // This must run before the tvJsonTitles guard so files that were previously
    // queued as 'waiting' (before disk-check was added) also get caught.
    // Skip this check for forced downloads — the worker will delete and re-fetch.
    if (
      !processingForced &&
      (fs.existsSync(`${tvSeasonPath}/${destTitle || fname}`) ||
        (destTitle && fs.existsSync(`${tvSeasonPath}/${fname}`)))
    ) {
      existsCount++;
      unilog(
        1202,
        `Down: already on disk "${fname}" (${seriesName || "unknown show"})`,
      );
      try {
        // Use the file's mtime on disk as the timestamp so the card shows
        // the real download date rather than today's date.
        let diskMtimeSec = 0;
        try {
          const diskFilePath = `${tvSeasonPath}/${destTitle || fname}`;
          const st = fs.statSync(
            fs.existsSync(diskFilePath)
              ? diskFilePath
              : `${tvSeasonPath}/${fname}`,
          );
          diskMtimeSec = Math.floor(st.mtimeMs / 1000);
        } catch (e) {}
        tvJson.markFinished({
          title: fname,
          localPath: tvLocalDir,
          usbPath: usbPath,
          seriesName: embyKeyForFolder || seriesName || undefined,
          season: season || 0,
          episode: episode || 0,
          fileSize: usbFileBytes || 0,
          destTitle: destTitle || undefined,
          sequence: currentSeq || 0,
          dateStarted: diskMtimeSec || undefined,
          dateEnded: diskMtimeSec || undefined,
        });
      } catch (e) {}
      if (tvJsonTitles) tvJsonTitles[fname] = { error: false };
      return process.nextTick(checkFile);
    }

    // Watched episode filter: skip if this episode has already been watched.
    if (
      !processingForced &&
      embyMap &&
      embyKeyForFolder &&
      Number.isInteger(season) &&
      Number.isInteger(episode)
    ) {
      const epData = embyMap[embyKeyForFolder]?.episodeData;
      const epIsWatched = edIsWatched(epData, season, episode);
      {
        if (epIsWatched) {
          const seStr = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
          existsCount++;
          unilog(331, "SKIP (episode watched):", fname, seStr);
          return process.nextTick(checkFile);
        }
      }
    }

    // In-progress authority: tv-inProgress.json (do not create duplicate tv.json entries
    // for files already queued/downloading).
    if (!processingForced && inProgress && inProgress[fname]) {
      existsCount++;
      unilog(
        1203,
        `Down: already in-progress "${fname}" (${seriesName || "unknown show"})`,
      );
      return process.nextTick(checkFile);
    }

    // tv.json authority: do not create duplicates for titles already queued.
    if (!processingForced && tvJsonTitles && tvJsonTitles[fname]) {
      existsCount++;
      const skipStatus =
        tvJsonTitles[fname].status === "finished"
          ? "already downloaded"
          : "already queued";
      unilog(
        1204,
        `Down: ${skipStatus} in tvJson "${fname}" (${seriesName || "unknown show"})`,
      );
      return process.nextTick(checkFile);
    }

    // Emby filter: only download shows that are in Emby.
    // Fail closed: if embyMap failed to load this cycle, skip the download
    // rather than letting it through. A null embyMap previously bypassed this
    // entire check, so non-Emby shows downloaded anyway.
    if (!processingForced && seriesName) {
      if (!embyMap) {
        unilog(
          1244,
          `skip: embyMap not loaded, cannot verify Emby membership for ${fname} (${seriesName})`,
        );
        return process.nextTick(checkFile);
      }
      const embyKey =
        smartTitleMatch(
          seriesName,
          Object.keys(embyMap),
          seriesMatchYear,
          false,
        ) || seriesName;
      const embyEntry = embyMap[embyKey];
      if (!embyEntry || !embyEntry.inEmby) {
        unilog(
          332,
          "------",
          downloadCount,
          "/",
          chkCount,
          "NOT IN EMBY, SKIPPING:",
          fname,
          "(",
          seriesName,
          ")",
        );
        return process.nextTick(checkFile);
      }
    }

    // For flex downloads (automatic, not forced, not from tor): block if the
    // episode already has a file under any name in the season folder, or if the
    // episode is already watched.
    var fromTor = !!(torFilePaths && torFilePaths.has(usbFilePath));
    if (fromTor && torFilePaths) torFilePaths.delete(usbFilePath);
    var fromFlex = !processingForced && !fromTor;
    if (
      fromFlex &&
      Number.isInteger(season) &&
      season > 0 &&
      Number.isInteger(episode) &&
      episode > 0
    ) {
      var flexSeStr = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
      var flexSeRe = new RegExp(flexSeStr, "i");

      // Skip if a same-or-better-quality download for this exact episode is already
      // in flight under a different filename. During a higher-quality replacement the
      // old file is renamed to .old and the new file lives in .rsync-tmp, so the disk
      // check below sees no live file — without this guard a stale same/worse-quality
      // USB candidate gets queued and races the in-flight download, leaving a duplicate
      // live file on disk (see down-coll-plan.md).
      if (inProgressSeIndex) {
        var _ipKey =
          String(tvSeasonPath).replace(/\/+$/, "") + "\x00" + flexSeStr;
        var _ipRes = inProgressSeIndex[_ipKey];
        if (_ipRes != null && _ipRes >= (getResolution(fname) ?? 480)) {
          existsCount++;
          unilog(
            1535,
            `skip: same/better quality already downloading for ${seriesName || "unknown show"} ${flexSeStr}`,
          );
          return process.nextTick(checkFile);
        }
      }

      // Check flexget-history.json: only allow the most-recently-sent candidate.
      var flexHistKeyExists = false;
      var flexHistMostRecentSent = null;
      try {
        var flexHistText = fs.readFileSync(FLEXGET_HISTORY_PATH, "utf8");
        var flexHistJson = JSON.parse(flexHistText);
        var sHistKey = "S" + String(season).padStart(2, "0");
        var eHistKey = "E" + String(episode).padStart(2, "0");
        var flexHistoryKey = seriesName + "\x00" + sHistKey + "\x00" + eHistKey;
        if (flexHistJson[flexHistoryKey]) {
          flexHistKeyExists = true;
          flexHistMostRecentSent = flexHistJson[flexHistoryKey].reduce(
            function (best, c) {
              if (c.sent === null) return best;
              if (!best || c.sent > best.sent) return c;
              return best;
            },
            null,
          );
        }
      } catch (e3) {
        // Missing or unreadable — fall through to old behavior.
      }

      if (flexHistKeyExists && flexHistMostRecentSent) {
        // Find any existing disk file for this S/E.
        var _diskFile = null;
        try {
          if (flexSeRe) {
            var _seasonFiles = fs.readdirSync(tvSeasonPath);
            _diskFile =
              _seasonFiles.find(function (f) {
                return flexSeRe.test(f) && isVideoEpisodeFile(f);
              }) || null;
          }
        } catch (e4) {
          // Season dir doesn't exist — not on disk.
        }
        var _epOnDisk = !!_diskFile;

        if (!_epOnDisk) {
          // File was sent but never landed on disk — allow download regardless of quality.
          // fall through to download
        } else {
          // File is on disk. Allow if USB is better than what's on disk.
          var _diskRes = getResolution(_diskFile) ?? 480;
          var _usbRes = getResolution(fname) ?? 480;
          var _diskDepth = flexBitDepth(_diskFile);
          var _usbDepth = flexBitDepth(fname);
          var _diskGroup = (
            parseTorrentTitle(_diskFile.replace(/\.[a-z0-9]{2,4}$/i, ""))
              ?.group || ""
          ).toLowerCase();
          var _usbGroup = (
            parseTorrentTitle(fname.replace(/\.[a-z0-9]{2,4}$/i, ""))?.group ||
            ""
          ).toLowerCase();
          var _diskIsBad = badGroupsSet.has(_diskGroup);
          var _usbIsBad = badGroupsSet.has(_usbGroup);
          var _diskIsHevc = isHevc(_diskFile);
          var _usbIsHevc = isHevc(fname);
          var _usbBetterThanDisk =
            _usbRes > _diskRes ||
            (_usbRes === _diskRes && _usbDepth > _diskDepth) ||
            (_usbRes === _diskRes &&
              _usbDepth === _diskDepth &&
              _diskIsHevc &&
              !_usbIsHevc) ||
            (_usbRes === _diskRes &&
              _usbDepth === _diskDepth &&
              _diskIsHevc === _usbIsHevc &&
              _diskIsBad &&
              !_usbIsBad);
          if (!_usbBetterThanDisk) {
            existsCount++;
            unilog(
              1205,
              `Down: skip, disk file same/better quality ${flexSeStr} "${fname}" (${seriesName || "unknown show"})`,
            );
            return process.nextTick(checkFile);
          }
          // USB is better than disk — rename disk file to .old before downloading.
          try {
            var _oldPath = path.join(tvSeasonPath, _diskFile);
            var _oldDst = _oldPath + ".old";
            while (fs.existsSync(_oldDst)) _oldDst = _oldDst + ".old";
            fs.renameSync(_oldPath, _oldDst);
            unilog(
              334,
              "renamed worse disk file to .old:",
              _diskFile,
              "→",
              path.basename(_oldDst),
            );
          } catch (renameErr3) {
            unilog(
              335,
              "rename worse disk file to .old failed:",
              _diskFile,
              renameErr3.message,
            );
          }
        }
        // Allow through — download the better USB file.
      } else if (!flexHistKeyExists) {
        // No flexget history for this episode — block if a same-quality-or-better file
        // already exists on disk for the same S/E.
        var diskFile = null;
        try {
          var seasonFiles = fs.readdirSync(tvSeasonPath);
          diskFile =
            seasonFiles.find(function (f) {
              return flexSeRe.test(f) && isVideoEpisodeFile(f);
            }) || null;
        } catch (e2) {
          // Season dir doesn't exist yet — nothing to compare.
        }
        if (diskFile) {
          var diskRes = getResolution(diskFile) ?? 480;
          var usbRes = getResolution(fname) ?? 480;
          var diskDepth = flexBitDepth(diskFile);
          var usbDepth = flexBitDepth(fname);
          var diskGroup = (
            parseTorrentTitle(diskFile.replace(/\.[a-z0-9]{2,4}$/i, ""))
              ?.group || ""
          ).toLowerCase();
          var usbGroup = (
            parseTorrentTitle(fname.replace(/\.[a-z0-9]{2,4}$/i, ""))?.group ||
            ""
          ).toLowerCase();
          var diskIsBad = badGroupsSet.has(diskGroup);
          var usbIsBad = badGroupsSet.has(usbGroup);
          var diskIsHevc = isHevc(diskFile);
          var usbIsHevc = isHevc(fname);
          var usbIsBetter =
            usbRes > diskRes ||
            (usbRes === diskRes && usbDepth > diskDepth) ||
            (usbRes === diskRes &&
              usbDepth === diskDepth &&
              diskIsHevc &&
              !usbIsHevc) ||
            (usbRes === diskRes &&
              usbDepth === diskDepth &&
              diskIsHevc === usbIsHevc &&
              diskIsBad &&
              !usbIsBad);
          if (!usbIsBetter) {
            existsCount++;
            unilog(
              336,
              downloadCount,
              "/",
              chkCount,
              "SKIP (disk file same/better quality):",
              fname,
              flexSeStr,
            );
            return process.nextTick(checkFile);
          }
          // USB is better — rename the worse disk file to .old before downloading.
          try {
            var oldPath = path.join(tvSeasonPath, diskFile);
            var oldDst = oldPath + ".old";
            while (fs.existsSync(oldDst)) oldDst = oldDst + ".old";
            fs.renameSync(oldPath, oldDst);
            unilog(
              337,
              "renamed worse disk file to .old:",
              diskFile,
              "→",
              path.basename(oldDst),
            );
          } catch (renameErr2) {
            unilog(
              338,
              "rename worse disk file to .old failed:",
              diskFile,
              renameErr2.message,
            );
          }
        }
      }

      // Check if the episode is already watched.
      var embyEntryForWatched = embyMap && embyMap[embyKeyForFolder];
      var epIsWatched = edIsWatched(
        embyEntryForWatched && embyEntryForWatched.episodeData,
        season,
        episode,
      );
      if (epIsWatched) {
        existsCount++;
        unilog(
          339,
          "------",
          downloadCount,
          "/",
          chkCount,
          "SKIP (episode watched):",
          fname,
          flexSeStr,
        );
        return process.nextTick(checkFile);
      }
    }

    mkdirp.sync(tvSeasonPath);

    // Within-cycle S/E dedup for fromFlex: if two files for the same episode arrive in
    // the same USB scan, only keep the better one. Bad group loses to non-bad group;
    // otherwise the first-seen wins.
    if (
      fromFlex &&
      Number.isInteger(season) &&
      season > 0 &&
      Number.isInteger(episode) &&
      episode > 0 &&
      cycleSeMap
    ) {
      var _cycleKey = (seriesName || "") + "\x00" + flexSeStr;
      var _cycleExistingFname = cycleSeMap[_cycleKey];
      if (_cycleExistingFname) {
        var _newGroup = (parseTorrentTitle(fname).group || "").toLowerCase();
        var _oldGroup = (
          parseTorrentTitle(_cycleExistingFname).group || ""
        ).toLowerCase();
        var _newIsBad = badGroupsSet.has(_newGroup);
        var _oldIsBad = badGroupsSet.has(_oldGroup);
        if (_oldIsBad && !_newIsBad) {
          // New file is better — delete the old queued entry and continue to addEntry.
          var _oldEntry = tvJson.getEntryByTitle(_cycleExistingFname);
          if (_oldEntry && typeof _oldEntry.procId === "number") {
            tvJson.deleteProcids([_oldEntry.procId]);
          }
          if (tvJsonTitles) delete tvJsonTitles[_cycleExistingFname];
          unilog(
            340,
            "------",
            downloadCount,
            "/",
            chkCount,
            "CYCLE DEDUP (bad group replaced):",
            _cycleExistingFname,
            "->",
            fname,
          );
        } else {
          // Old file is at least as good — skip the new one.
          unilog(
            341,
            "------",
            downloadCount,
            "/",
            chkCount,
            "CYCLE DEDUP SKIP:",
            fname,
            "(keeping",
            _cycleExistingFname + ")",
          );
          return process.nextTick(checkFile);
        }
      }
    }

    // Create a new tv.json entry (tvJson.js will assign procId when a worker starts).
    try {
      tvJson.addEntry({
        usbPath: usbPath,
        localPath: tvLocalDir,
        title: fname,
        destTitle: destTitle || undefined,
        seriesName: seriesName || undefined,
        tvdbId: lookupTvdbId(seriesName) || undefined,
        status: "waiting",
        progress: 0,
        eta: null,
        speed: 0,
        sequence: currentSeq || 0,
        fileSize: usbFileBytes || 0,
        season: season || 0,
        episode: episode || 0,
        dateStarted: 0,
        dateEnded: null,
        forced: processingForced,
        fromFlex: fromFlex,
      });

      // Update per-cycle views so later files in the same cycle don't re-queue.
      if (tvJsonTitles) {
        tvJsonTitles[fname] = { error: false };
      }
      if (
        cycleSeMap &&
        fromFlex &&
        Number.isInteger(season) &&
        season > 0 &&
        Number.isInteger(episode) &&
        episode > 0
      ) {
        cycleSeMap[(seriesName || "") + "\x00" + flexSeStr] = fname;
      }
    } catch (e) {
      // keep going
    }

    return process.nextTick(checkFile);
  };

  badFile = (reason) => {
    errCount++;
    writeRejectLog(fname, reason);
    err("marking tv.json error:", {
      reason: reason || "unknown",
      fname,
      title,
      season,
      episode,
      usbFilePath,
    });
    try {
      var usbDir = "";
      try {
        usbDir = path.dirname(usbFilePath);
      } catch (e) {
        usbDir = "";
      }
      if (usbDir === "." || usbDir === "/") usbDir = "";
      var usbPath = usbDir ? `~/files/${usbDir}/` : "~/files/";
      if (isErrorWorthDownloading(reason)) {
        // Route through normal worker pipeline — just set localPath to tv-errors.
        try {
          fs.mkdirSync(TV_ERRORS_PATH, { recursive: true });
        } catch {}
        tvJson.addEntry({
          title: fname,
          usbPath: usbPath,
          localPath: TV_ERRORS_PATH,
          reason: reason || "unknown",
          status: "waiting",
          error: 0,
          seriesName: undefined,
          season: season || 0,
          episode: episode || 0,
          fileSize: usbFileBytes || 0,
          sequence: currentSeq || 0,
        });
        if (tvJsonTitles) tvJsonTitles[fname] = { error: false };
      } else {
        tvJson.markError({
          title: fname,
          usbPath: usbPath,
          reason: reason || "unknown",
        });
      }
    } catch (e) {}
    return process.nextTick(checkFile);
  };
}

main().catch((err) => {
  try {
    unilog(342, "FATAL: apps/down crashed:", err && (err.stack || err));
  } catch (e) {
    // ignore
  }
  try {
    process.exit(1);
  } catch (e) {
    // ignore
  }
});
