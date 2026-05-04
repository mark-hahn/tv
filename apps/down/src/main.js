import fsNode from "node:fs";
import utilNode from "node:util";
import pathNode from "node:path";
import childProcess from "node:child_process";
import httpNode from "node:http";
import urlNode from "node:url";

import mkdirpPkg from "mkdirp";
import requestPkg from "request";
import rimrafPkg from "rimraf";
import parseTorrentTitlePkg from "parse-torrent-title";

import * as tvJsonMod from "./tvJson.js";
import {
  smartTitleMatch,
  parseFileSeasonEpisode,
  parseTitleFromFilename,
  postHistory,
} from "@tv/share";

const __filename = urlNode.fileURLToPath(import.meta.url);
const __dirname = pathNode.dirname(__filename);

const TV_BLOCKED = {
  sample: true,
  ".sfv": true,
  ".FLEMISH.": true,
  ".flemish.": true,
  "Deleted Scenes": true,
  Commentary: true,
  Featurettes: true,
  Features: true,
  "Physical - S01E01": true,
  "Legends.Of.Tomorrow": true,
  "Last.Man.Standing": true,
  "Uncle.From.Another.World": true,
  german: true,
  "Crash and Burn": true,
  "Christine Keeler": true,
  "Love Recipe": true,
  "Millionaire Hot Seat": true,
  Hootenanny: true,
  "bravery-pleaselikeme": true,
  Blacklist: true,
  "Breakfast.at.Tiffany": true,
  "The.Postman.Always.Rings": true,
  Harlots: true,
  "Theater.Camp": true,
  Audio: true,
};

async function main() {
  // If non-blank, emits targeted trace logs for this show name.
  // If blank, tracing is fully disabled.
  const DEBUG_SHOW = "";

  // ---------------------------------------------------------------------------
  // Targeted tracing (hard-wired; no env vars)
  // Logs only when the show name appears in stage/details/fname/title/paths.
  var TRACE_ENABLED = Boolean(DEBUG_SHOW && String(DEBUG_SHOW).trim());
  var TRACE_SHOW = TRACE_ENABLED ? String(DEBUG_SHOW).trim() : "";
  var TRACE_SHOW_KEY = TRACE_ENABLED ? TRACE_SHOW.toLowerCase() : "";

  var FAST_TEST,
    PROCESS_INTERVAL_MS,
    SKIP_DOWNLOAD,
    appendTvLog,
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
    return `${m.month}-${m.day} ${m.hour}:${m.minute}`;
  };

  log = (...x) => {
    if (debug) {
      console.log("\nLOG:", ...x);
    }
  };

  err = (...x) => {
    return console.error("error:", ...x);
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

  log("starting....");

  rsyncDelay = 1000; // only used for TVDB error retry

  usbHost = "xobtlu@oracle.usbx.me";

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
  var TVDB_JSON_PATH = path.join(APP_DIR, "..", "srvr", "data", "tvdb.json");
  var FLEXGET_HISTORY_PATH = path.join(
    APP_DIR,
    "..",
    "srvr",
    "data",
    "flexget-history.json",
  );

  // State is stored under apps/down/data.

  try {
    fs.mkdirpSync(path.dirname(TV_LOG_PATH));
  } catch (e) {}

  appendTvLog = function (line) {
    try {
      return fs.appendFileSync(TV_LOG_PATH, line);
    } catch (error1) {}
  };

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

  // Targeted trace helper. Only emits when TRACE_SHOW_KEY is present.
  var safeInspect = function (x) {
    try {
      return util.inspect(x, {
        depth: 4,
        breakLength: 160,
        maxArrayLength: 25,
      });
    } catch (e) {
      try {
        return JSON.stringify(x);
      } catch (e2) {
        return String(x);
      }
    }
  };

  var trace = function (stage, details) {
    if (!TRACE_ENABLED) return;
    var hay = "";
    try {
      hay = (
        String(stage || "") +
        " " +
        safeInspect(details || {}) +
        " " +
        String(fname || "") +
        " " +
        String(title || "") +
        " " +
        String(seriesName || "") +
        " " +
        String(usbFilePath || "")
      ).toLowerCase();
    } catch (e) {
      hay = "";
    }
    if (hay.indexOf(TRACE_SHOW_KEY) === -1) return;

    var msg = `[TRACE ${TRACE_SHOW}] ${String(stage || "")}`;
    if (details !== void 0) {
      msg += " " + safeInspect(details);
    }
    try {
      console.log(msg);
    } catch (e) {}
    try {
      appendTvLog(msg + "\n");
    } catch (e) {}
  };

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
          return `${m.year}/${m.month}/${m.day} ${m.hour}:${m.minute}:${m.second}`;
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

      var prefix = "";
      try {
        if (fs.existsSync(TV_LOG_PATH)) {
          var st = fs.statSync(TV_LOG_PATH);
          if (st && st.size > 0) prefix = "\n";
        }
      } catch (e) {}

      appendTvLog(`${prefix}==== tv-down started ${fmt()} ====`);
      console.log(`[${cycleTsPST()}] tv-down started`);
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
  log(".... starting tv.coffee v4 ....");

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
      console.log(
        `[${cycleTsPST()}] download check cycle SKIPPED: tvPath not accessible (${tvPath}): ${e.message}`,
      );
      scheduleNextCycle();
      return;
    }

    if (nextCycleTimer) {
      clearTimeout(nextCycleTimer);
      nextCycleTimer = null;
    }
    cycleRunning = true;

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
                log(
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
                log("Registered tor files:", torFileList.length);
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

        // No matching endpoint
        return json(res, 404, { status: "not found" });
      })
      .listen(3003, "0.0.0.0");
  })();

  findUsb =
    `ssh ${usbHost} \"find files -ignore_readdir_race -type f -printf '%CY-%Cm-%Cd-%P-%s\\\\n' 2>/dev/null\" ` +
    "| grep -Ev .r[0-9]+-[0-9]+$ | grep -Ev .rar-[0-9]+$ " +
    "| grep -Ev screen[0-9]+.png-[0-9]+$" +
    "| grep -Evi '\\.(srr|sfv|nfo|nzb|jpg|jpeg|png|txt|sub|idx|srt|bup|ifo|vob)-[0-9]+$'";

  log({ findUsb });

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
      return `${m.year}/${m.month}/${m.day}-${m.hour}:${m.minute}:${m.second}`;
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

  blocked = null;
  map = {};

  reloadState = function () {
    var f, j, len, line, mapLines, mapStr, results, t;
    // Do not cache tv-finished.json / tv-inProgress.json here.
    // Those are loaded once per cycle immediately after the USB file list is fetched.
    blocked = TV_BLOCKED;
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
          err("theTvDb login error:", error);
          err("theTvDb statusCode:", response && response.statusCode);

          if (retryCount < MAX_RETRIES) {
            err(
              `Retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`,
            );
            setTimeout(() => loginToTvDb(retryCount + 1), RETRY_DELAY_MS);
          } else {
            err("Max retries reached. Exiting.");
            return process.exit();
          }
        } else {
          theTvDbToken = body.data.token;
          log("TheTVDB login successful");
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
    PRUNE_INTERVAL_MS = 60 * 60 * 1000;
    if (Date.now() - lastPruneAt >= PRUNE_INTERVAL_MS) {
      // Inline prune.sh behavior: delete files older than 30 days on the USB host.
      // Run async so it doesn't block the cycle — proceed to checkFiles immediately.
      log(".... deleting old files in usb ~/files (async) ....");
      PRUNE_DAYS = 30;
      lastPruneAt = Date.now();
      (async () => {
        try {
          await execAsync(
            `ssh ${usbHost} "find ~/files -mtime +${PRUNE_DAYS} -exec rm -rf {} \\; >/dev/null 2>&1"`,
            { timeout: 15 * 60 * 1000 },
          );
        } catch (e) {
          // Non-fatal.
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
        console.log(
          `[${cycleTsPST()}] DVD: skipping locked folder "${torrentFolder}"`,
        );
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
        console.log(
          `[${cycleTsPST()}] DVD: cannot parse title from "${torrentFolder}", skipping`,
        );
        continue;
      }
      if (!embyMap) {
        console.log(
          `[${cycleTsPST()}] DVD: no embyMap loaded, skipping "${torrentFolder}"`,
        );
        continue;
      }
      const embyShowNames = Object.keys(embyMap).filter(
        (k) => embyMap[k] && embyMap[k].inEmby,
      );
      const embyKey =
        smartTitleMatch(showTitle, embyShowNames, null, false) || showTitle;
      const embyEntry = embyMap[embyKey];
      if (!embyEntry || !embyEntry.inEmby) {
        log(
          "------",
          "DVD: NOT IN EMBY, SKIPPING:",
          torrentFolder,
          "(",
          showTitle,
          ")",
        );
        postHistory({
          tvdbId: embyEntry?.tvdbId || null,
          showName: showTitle,
          type: "skipDown",
          description: `DVD skip: not in Emby (${showTitle})`,
        });
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
            season: 0,
            episode: 0,
            dateStarted: 0,
            dateEnded: null,
          });
        }
        console.log(
          `[${cycleTsPST()}] DVD: queued missing file(s) for ${vtsDirRelative}`,
        );
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

    // Determine season from path components (e.g. NORMS1 → 1, Disc 2 → use parent).
    const parts = vtsDirRelative.split("/");
    let dvdSeason = 1;
    for (let i = 1; i < parts.length; i++) {
      const sm =
        parts[i].match(/[Ss](?:eason)?\s*(\d+)/) || parts[i].match(/(\d+)\s*$/);
      if (sm) {
        dvdSeason = parseInt(sm[1], 10);
        break;
      }
    }

    const seasonDir = `${tvPath}${embyFolderName}/Season ${dvdSeason}`;
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

    console.log(
      `[${cycleTsPST()}] DVD: running makemkvcon on ${vtsDirRelative}`,
    );

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
      console.log(
        `[${cycleTsPST()}] DVD: makemkvcon produced no MKVs for ${vtsDirRelative}`,
      );
      postHistory({
        tvdbId,
        showName: showTitle,
        type: "errorSync",
        description: `makemkv no output for ${vtsDirRelative}`,
      });
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

    postHistory({
      tvdbId,
      showName: showTitle,
      type: "dvdProc",
      description: `${outputMkvs.length} MKV(s) from ${vtsDirRelative} → ${seasonDir}`,
    });
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
      console.log(
        `[${cycleTsPST()}] DVD: filtered compilation title(s): ${filtered.join(", ")}`,
      );
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
      console.log(
        `[${cycleTsPST()}] DVD: filtered ${dupMkvs.length} duplicate title(s) (same size): ${dupMkvs.join(", ")}`,
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
        console.log(`[${cycleTsPST()}] DVD: already exists: ${destName}`);
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
      console.log(`[${cycleTsPST()}] DVD: moved ${destName} → ${seasonDir}`);
    }
  };

  checkFiles = async () => {
    var j, len, usbLine;

    if (forcedFiles && forcedFiles.length > 0) {
      log("checking forced files...", forcedFiles.length);
      processingForced = true;
      usbFiles = forcedFiles.filter((l) => l && l.trim().length);
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

    // Trace if the target show appears anywhere in the USB list.
    if (TRACE_ENABLED) {
      try {
        var traceCandidates = usbFiles.filter(
          (l) => l && l.toLowerCase().indexOf(TRACE_SHOW_KEY) !== -1,
        );
        if (traceCandidates.length) {
          trace("checkFiles: found target on USB", {
            count: traceCandidates.length,
            examples: traceCandidates.slice(0, 5),
          });
        }
      } catch (e) {}
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

    // Load Emby membership map from srvr's tvdb.json once per cycle.
    // Keys are series names; value.inEmby is true if the show is in Emby.
    try {
      embyMap = JSON.parse(fs.readFileSync(TVDB_JSON_PATH, "utf8"));
    } catch (e) {
      embyMap = null;
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
      log("skipping locked paths", skipPaths);
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
  const lookupTvdbId = (name) => {
    if (!embyMap || !name) return null;
    const key =
      smartTitleMatch(name, Object.keys(embyMap), null, false) || name;
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

      trace("checkFile: considering", {
        usbFilePath,
        fname: null,
        usbFileBytes,
      });

      for (j = 0, len = skipPaths.length; j < len; j++) {
        skipPath = skipPaths[j];
        if (usbFilePath.startsWith(skipPath)) {
          log(`skipping locked ${usbFilePath}`);
          trace("checkFile: skip locked", { usbFilePath, skipPath });
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
      } catch (e) {
        title = null;
        folderTitle = null;
        season = undefined;
        episode = undefined;
        type = "episode";
        parsed = {};
        parsedFolder = {};
      }

      trace("checkFile: filename", { fname, usbFilePath, usbFileBytes });

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
        trace("checkFile: skip extension", { fname, fext });
        postHistory({
          tvdbId: lookupTvdbId(title),
          showName: title || fname,
          type: "skipDown",
          description: `skip extension: .${fext}`,
        });
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
        log("------", downloadCount, "/", chkCount, "SKIPPING *ERROR*:", fname);
        trace("checkFile: skip tvJsonTitles error", { fname });
        postHistory({
          tvdbId: lookupTvdbId(title),
          showName: title || fname,
          type: "skipDown",
          description: "skip: previous error",
        });
        process.nextTick(checkFile);
        return;
      }

      if (!processingForced && tvJsonTitles && tvJsonTitles[fname]) {
        recentCount++;
        const skipStatus =
          tvJsonTitles[fname].status === "finished"
            ? "already downloaded"
            : "already queued";
        log(
          "------",
          downloadCount,
          "/",
          chkCount,
          "SKIPPING",
          skipStatus.toUpperCase() + ":",
          fname,
        );
        trace("checkFile: skip " + skipStatus, { fname });
        postHistory({
          tvdbId: lookupTvdbId(title),
          showName: title || fname,
          type: "skipDown",
          description: "skip: " + skipStatus,
        });
        process.nextTick(checkFile);
        return;
      }

      if (inProgress && inProgress[fname]) {
        recentCount++;
        log(
          "------",
          downloadCount,
          "/",
          chkCount,
          "SKIPPING IN-PROGRESS:",
          fname,
        );
        trace("checkFile: skip in-progress", { fname });
        postHistory({
          tvdbId: lookupTvdbId(title),
          showName: title || fname,
          type: "skipDown",
          description: "skip: in-progress",
        });
        process.nextTick(checkFile);
        return;
      }
      for (blkName in blocked) {
        if (fname.indexOf(blkName) > -1) {
          blockedCount++;
          log("-- BLOCKED:", { blkName, fname });
          trace("checkFile: blocked", { blkName, fname });
          postHistory({
            tvdbId: lookupTvdbId(title),
            showName: title || fname,
            type: "skipDown",
            description: `skip: blocked by ${blkName}`,
          });
          process.nextTick(checkFile);
          return;
        }
      }
      log("not blocked", usbLine);

      // file passed all block tests, process it
      currentSeq = ++cycleSeq;
      downloadTime = Date.now();

      trace("checkFile: parsed", { fname, title, season, episode, type });

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
          var matchesEmby = smartTitleMatch(title, embyShowNames, null, false);
          if (!matchesEmby && folderTitle) {
            matchesEmby = smartTitleMatch(
              folderTitle,
              embyShowNames,
              null,
              false,
            );
            if (matchesEmby) title = folderTitle;
          }
          if (!matchesEmby) {
            log(
              "------",
              downloadCount,
              "/",
              chkCount,
              "NOT A TV SHOW, SKIPPING:",
              fname,
            );
            trace("checkFile: not a tv show, skipping", { fname, title });
            postHistory({
              tvdbId: lookupTvdbId(title),
              showName: title || fname,
              type: "skipDown",
              description: `skip: not a TV show (title: ${title})`,
            });
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
        log("\nskipping non-episode:", fname);
        trace("checkFile: skip non-episode", { fname, title, type });
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
      log(".... done ....");

      if (
        deleteCount + existsCount + errCount + downloadCount + blockedCount >
        0
      ) {
        log("***********************************************************");
      }
      if (_cycleTiming) {
        _cycleTiming.cycleEnd = Date.now();
        const total =
          _cycleTiming.cycleEnd -
          (_cycleTiming.cycleStart || _cycleTiming.cycleEnd);
        if (total >= 60000) {
          const fmt = (a, b) => (b != null && a != null ? `${b - a}ms` : "?");
          log(
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

    trace("chkTvDB: start", { fname, title });

    if (title in tvdbCache) {
      if (tvdbCache[title] === null) {
        // Previously determined this title is not resolvable — skip without hitting TVDB.
        postHistory({
          tvdbId: lookupTvdbId(title),
          showName: title || fname,
          type: "skipDown",
          description: "skip: not resolvable (cached)",
        });
        return process.nextTick(checkFile);
      }
      seriesName = tvdbCache[title];
      trace("chkTvDB: cache hit", { title, seriesName });
      return process.nextTick(checkFileExists);
    }

    // If the episode-specific title isn't cached but the folder title already is,
    // use the folder result directly without making a TVDB call for the episode title.
    if (folderTitle && folderTitle in tvdbCache) {
      if (tvdbCache[folderTitle] === null) {
        tvdbCache[title] = null;
        postHistory({
          tvdbId: lookupTvdbId(title),
          showName: title || fname,
          type: "skipDown",
          description: "skip: not resolvable (folder cached)",
        });
        return process.nextTick(checkFile);
      }
      seriesName = tvdbCache[folderTitle];
      tvdbCache[title] = seriesName;
      trace("chkTvDB: folderTitle cache hit", {
        title,
        folderTitle,
        seriesName,
      });
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
        !smartTitleMatch(title, embyShowNamesPrecheck, null, false) &&
        smartTitleMatch(folderTitle, embyShowNamesPrecheck, null, false)
      ) {
        trace("chkTvDB: swapping to folderTitle (emby precheck)", {
          title,
          folderTitle,
        });
        title = folderTitle;
        folderTitle = null;
      }
    }

    // Remember the title we started with so we can cache it after a folderTitle retry.
    var titleBeforeRetry = title;

    log("search:", title);

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
            trace("chkTvDB: no results, trying variant", {
              query,
              next: remaining[0],
            });
            return tryTvdbQuery(remaining);
          }

          if (
            error ||
            !((ref = body && body.data) != null ? ref[0] : void 0) ||
            (response != null ? response.statusCode : void 0) !== 200
          ) {
            trace("chkTvDB: tvdb error/no data", {
              fname,
              title,
              tvdburl,
              statusCode: response && response.statusCode,
              error: error ? error.message || String(error) : null,
            });
            if (error) {
              err(
                `tvdb search error: ${error && error.message ? error.message : error} | status: ${response && response.statusCode} | fname: ${fname}`,
              );
              if (++tvDbErrCount === 15) {
                err("giving up, downloaded:", downloadCount);
                return;
              }
              err("tvdb err retry, waiting one minute");
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
                  ? smartTitleMatch(title, embyShowNamesForTvdb, null, false)
                  : null;
              if (!processingForced && !tvdbMatchesEmby) {
                // If the filename gave an abbreviated title (e.g. "tmaws"), retry with
                // the folder-derived title before giving up.
                if (folderTitle && folderTitle !== title) {
                  trace("chkTvDB: retrying with folderTitle", {
                    title,
                    folderTitle,
                  });
                  title = folderTitle;
                  folderTitle = null;
                  return process.nextTick(chkTvDB);
                }
                log(
                  "------",
                  downloadCount,
                  "/",
                  chkCount,
                  "NOT A TV SHOW, SKIPPING:",
                  fname,
                );
                trace("chkTvDB: no series match, not in emby, skipping", {
                  fname,
                  title,
                });
                postHistory({
                  tvdbId: lookupTvdbId(title),
                  showName: title || fname,
                  type: "skipDown",
                  description: "skip: no TVDB match, not in Emby",
                });
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
            var names = results.map((r) => r && r.name).filter((nm) => nm);

            // Pass null for year as we don't have it here, or extract if available
            // existing code didn't use year, so we pass undefined/null
            seriesName = smartTitleMatch(title, names);
            trace("chkTvDB: matched series", {
              title,
              resultsCount: names.length,
              topNames: names.slice(0, 10),
              seriesName,
            });
            log("tvdb got:", { seriesName, title });
            if (map[seriesName]) {
              console.log("Mapping", seriesName, "to", map[seriesName]);
              seriesName = map[seriesName];
            }
            trace("chkTvDB: post-map", { title, seriesName });
            if (!seriesName) {
              // If the filename gave an abbreviated title, retry with the folder-derived title.
              if (folderTitle && folderTitle !== title) {
                trace("chkTvDB: no TVDB match, retrying with folderTitle", {
                  title,
                  folderTitle,
                });
                title = folderTitle;
                folderTitle = null;
                return process.nextTick(chkTvDB);
              }
              log(
                "------",
                downloadCount,
                "/",
                chkCount,
                "NO SERIES MATCH, SKIPPING:",
                fname,
              );
              trace("chkTvDB: smartTitleMatch returned null, skipping", {
                fname,
                title,
              });
              postHistory({
                tvdbId: lookupTvdbId(title),
                showName: title || fname,
                type: "skipDown",
                description: "skip: no series match on TVDB",
              });
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

  checkFileExists = () => {
    var e, tvFilePath, tvSeasonPath, usbLongPath, videoPath;
    const embyKeyForFolder =
      embyMap && seriesName
        ? smartTitleMatch(seriesName, Object.keys(embyMap), null, false) ||
          seriesName
        : seriesName;
    const embyFolderName =
      embyMap && embyKeyForFolder && embyMap[embyKeyForFolder]?.path
        ? embyMap[embyKeyForFolder].path
        : embyKeyForFolder || seriesName;
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

    trace("checkFileExists: start", {
      fname,
      title,
      seriesName,
      season,
      episode,
      tvSeasonPath,
      usbFilePath,
    });

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
      trace("checkFileExists: SKIP_DOWNLOAD true", { fname });
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
      log("------", downloadCount, "/", chkCount, "ALREADY ON DISK:", fname);
      trace("checkFileExists: already on disk", { fname, tvSeasonPath });
      postHistory({
        tvdbId: lookupTvdbId(seriesName),
        showName: seriesName || fname,
        type: "skipDown",
        description: `skip: already on disk`,
      });
      try {
        tvJson.markFinished({
          title: fname,
          localPath: tvLocalDir,
          usbPath: usbPath,
          seriesName: seriesName || undefined,
          season: season || 0,
          episode: episode || 0,
          fileSize: usbFileBytes || 0,
          destTitle: destTitle || undefined,
          sequence: currentSeq || 0,
        });
      } catch (e) {}
      if (tvJsonTitles) tvJsonTitles[fname] = { error: false };
      return process.nextTick(checkFile);
    }

    // In-progress authority: tv-inProgress.json (do not create duplicate tv.json entries
    // for files already queued/downloading).
    if (!processingForced && inProgress && inProgress[fname]) {
      existsCount++;
      trace("checkFileExists: already in-progress", { fname });
      postHistory({
        tvdbId: lookupTvdbId(seriesName),
        showName: seriesName || fname,
        type: "skipDown",
        description: "skip: already in-progress",
      });
      return process.nextTick(checkFile);
    }

    // tv.json authority: do not create duplicates for titles already queued.
    if (!processingForced && tvJsonTitles && tvJsonTitles[fname]) {
      existsCount++;
      const skipStatus =
        tvJsonTitles[fname].status === "finished"
          ? "already downloaded"
          : "already queued";
      trace("checkFileExists: " + skipStatus + " (tv.json)", { fname });
      postHistory({
        tvdbId: lookupTvdbId(seriesName),
        showName: seriesName || fname,
        type: "skipDown",
        description: "skip: " + skipStatus,
      });
      return process.nextTick(checkFile);
    }

    // Emby filter: only download shows that are in Emby.
    if (!processingForced && embyMap && seriesName) {
      const embyKey =
        smartTitleMatch(seriesName, Object.keys(embyMap), null, false) ||
        seriesName;
      const embyEntry = embyMap[embyKey];
      if (!embyEntry || !embyEntry.inEmby) {
        log(
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
        trace("checkFileExists: not in emby", { fname, seriesName });
        postHistory({
          tvdbId: lookupTvdbId(seriesName),
          showName: seriesName || fname,
          type: "skipDown",
          description: `skip: not in Emby (${seriesName})`,
        });
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

      // Check if any file for the same S/E already exists in the season folder.
      var epFileExists = false;
      try {
        var seasonFiles = fs.readdirSync(tvSeasonPath);
        epFileExists = seasonFiles.some(function (f) {
          return flexSeRe.test(f);
        });
      } catch (e2) {
        // Season dir doesn't exist yet — no file to find.
      }

      // Check flexget-history.json: only allow the most-recently-sent candidate.
      var flexHistKeyExists = false;
      var flexHistMostRecentSent = null;
      var fnameBase = fname.replace(/\.[a-z0-9]{2,4}$/i, "");
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
        var mostRecentBase = String(flexHistMostRecentSent.title || "").replace(
          /\.[a-z0-9]{2,4}$/i,
          "",
        );
        if (fnameBase !== mostRecentBase) {
          existsCount++;
          log(
            "------",
            downloadCount,
            "/",
            chkCount,
            "FLEX SKIP (not most-recent-sent):",
            fname,
          );
          trace("checkFileExists: flex skip not most-recent-sent", {
            fname,
            flexSeStr,
            mostRecentBase,
          });
          postHistory({
            tvdbId: lookupTvdbId(seriesName),
            showName: seriesName || fname,
            type: "skipDown",
            description: `flex skip: not most-recent-sent for ${flexSeStr}`,
          });
          return process.nextTick(checkFile);
        }
        // Is most-recently-sent — allow through even if an old version exists.
      } else if (epFileExists) {
        // No flexget history for this episode — use original skip behavior.
        existsCount++;
        log(
          "------",
          downloadCount,
          "/",
          chkCount,
          "FLEX SKIP (S/E file exists):",
          fname,
          flexSeStr,
        );
        trace("checkFileExists: flex skip s/e file exists", {
          fname,
          flexSeStr,
        });
        postHistory({
          tvdbId: lookupTvdbId(seriesName),
          showName: seriesName || fname,
          type: "skipDown",
          description: `flex skip: ${flexSeStr} file already exists`,
        });
        return process.nextTick(checkFile);
      }

      // Check if the episode is already watched.
      var embyEntryForWatched = embyMap && embyMap[embyKeyForFolder];
      var watchedEpis = embyEntryForWatched && embyEntryForWatched.watchedEpis;
      var epIsWatched = false;
      if (Array.isArray(watchedEpis)) {
        for (var wi = 0; wi < watchedEpis.length; wi++) {
          var wRow = watchedEpis[wi];
          if (!Array.isArray(wRow) || wRow[0] !== season) continue;
          for (var wj = 1; wj < wRow.length; wj++) {
            if (wRow[wj] === episode) {
              epIsWatched = true;
              break;
            }
          }
          if (epIsWatched) break;
        }
      }
      if (epIsWatched) {
        existsCount++;
        log(
          "------",
          downloadCount,
          "/",
          chkCount,
          "FLEX SKIP (episode watched):",
          fname,
          flexSeStr,
        );
        trace("checkFileExists: flex skip episode watched", {
          fname,
          flexSeStr,
        });
        postHistory({
          tvdbId: lookupTvdbId(seriesName),
          showName: seriesName || fname,
          type: "skipDown",
          description: `flex skip: ${flexSeStr} already watched`,
        });
        return process.nextTick(checkFile);
      }
    }

    // If replacing via flexget (most-recently-sent), rename any existing video
    // file for this episode to .old before the new one is downloaded.
    if (
      fromFlex &&
      epFileExists &&
      flexSeRe &&
      flexHistKeyExists &&
      flexHistMostRecentSent
    ) {
      var videoExtsOld = [
        "mkv",
        "mp4",
        "avi",
        "mov",
        "m4v",
        "wmv",
        "ts",
        "m2ts",
      ];
      try {
        var seasonFilesForRename = fs.readdirSync(tvSeasonPath);
        for (var ri = 0; ri < seasonFilesForRename.length; ri++) {
          var rFile = seasonFilesForRename[ri];
          if (!flexSeRe.test(rFile)) continue;
          var rExt = rFile.split(".").pop().toLowerCase();
          if (!videoExtsOld.includes(rExt)) continue;
          var rSrc = path.join(tvSeasonPath, rFile);
          var rDst = rSrc + ".old";
          while (fs.existsSync(rDst)) rDst = rDst + ".old";
          try {
            fs.renameSync(rSrc, rDst);
            log("flex: renamed to .old:", rFile, "→", path.basename(rDst));
          } catch (renameErr) {
            log("flex: rename to .old failed:", rFile, renameErr.message);
          }
        }
      } catch (e4) {
        // Season dir doesn't exist — nothing to rename.
      }
    }

    mkdirp.sync(tvSeasonPath);
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

      // Update per-cycle view so later files in the same cycle don't re-queue.
      if (tvJsonTitles) {
        tvJsonTitles[fname] = { error: false };
      }

      trace("checkFileExists: queued tv.json entry", {
        fname,
        seriesName,
        season,
        episode,
        usbPath,
        localPath: tvLocalDir,
        sequence: currentSeq || 0,
        fileSize: usbFileBytes || 0,
      });

      postHistory({
        tvdbId: lookupTvdbId(seriesName),
        showName: seriesName || fname,
        type: "acceptDown",
        description: `${fname} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")} → ${tvLocalDir}`,
      });
    } catch (e) {
      // keep going
      trace("checkFileExists: addEntry threw", {
        fname,
        error: e && e.message ? e.message : String(e),
      });
    }

    return process.nextTick(checkFile);
  };

  badFile = (reason) => {
    errCount++;
    writeRejectLog(fname, reason);
    postHistory({
      tvdbId: lookupTvdbId(seriesName),
      showName: seriesName || fname,
      type: "rejDown",
      description: `${reason || "unknown"} | file: ${fname}`,
    });
    trace("badFile: marking error", {
      reason: reason || "unknown",
      fname,
      title,
      season,
      episode,
      usbFilePath,
    });
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
    console.error("FATAL: apps/down crashed:", err && (err.stack || err));
  } catch (e) {
    // ignore
  }
  try {
    process.exit(1);
  } catch (e) {
    // ignore
  }
});
