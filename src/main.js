(async function() {

  var FAST_TEST, PROCESS_INTERVAL_MS, appendTvLog, badFile, blocked, blockedCount, buffering, checkFile, checkFileExists, checkFiles, chkCount, chkTvDB, clearBuffer, currentSeq, cycleRunning, cycleSeq, dateStr, debug, delOldFiles, deleteCount, downloadCount, downloadTime, emby, episode, err, errCount, errors, escQuotes, exec, existsCount, fileTimeout, filterRegex, filterRegexTxt, findUsb, flushAndGoLive, flushBuffer, fname, fs, getUsbFiles, lastPruneAt, log, logBuffer, map, mkdirp, path, readMap, recent, recentCount, reloadState, request, resetCycleState, rimraf, rsyncDelay, runCycle, scheduleNextCycle, season, seriesName, sizeStr, skipPaths, startBuffering, startTime, stopBuffering, theTvDbToken, time, title, tvDbErrCount, tvPath, tvdbCache, tvdburl, type, usbFilePath, usbFileSize, usbFiles, usbHost, util, writeLine, writeMap;

  debug = false;
  FAST_TEST = false;
  SKIP_DOWNLOAD = false; // Set to false to resume actual downloading
  PROCESS_INTERVAL_MS = FAST_TEST ? 30 * 1000 : 2 * 60 * 1000;

  log = (...x) => {
    if (debug) {
      console.log('\nLOG:', ...x);
    }
  };

  err = (...x) => {
    return console.error('error:', ...x);
  };

  sizeStr = function(n, {digits = 1, base = 1000, suffix = ""} = {}) {
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

  log('starting....');

  rsyncDelay = 3000; // 3 secs

  usbHost = "xobtlu@oracle.usbx.me";

  // prune script deletes files older than 30 days
  // tv-recent files limited to 35 days
  fileTimeout = {
    timeout: 2 * 60 * 60 * 1000 // 2 hours
  };

  fs = require('fs-plus');

  util = require('util');

  path = require('path');

  // Project layout:
  // - Source code in ./src
  // - Runtime state/logs in ./data
  var BASEDIR = path.join(__dirname, '..');
  var DATA_DIR = path.join(BASEDIR, 'data');
  var dataPath = function(p) {
    return path.join(DATA_DIR, p);
  };

  var TV_LOG_PATH = dataPath('tv.log');
  var TV_JSON_PATH = dataPath('tv.json');
  var TV_RECENT_PATH = dataPath('tv-recent.json');
  var TV_ERRORS_PATH = dataPath('tv-errors.json');
  var TV_BLOCKED_PATH = dataPath('tv-blocked.json');
  var TV_MAP_PATH = dataPath('tv-map');
  var SCAN_LIBRARY_FLAG_PATH = dataPath('scanLibraryFlag');

  appendTvLog = function(line) {
    try {
      return fs.appendFileSync(TV_LOG_PATH, line);
    } catch (error1) {

    }
  };

  // --- tv.json status tracking ----------------------------------------------
  // tv.json is an array of file objects.
  // Each update rewrites the entire file and prunes entries older than 1 month.
  var tvJsonCache = null; // In-memory cache

  var unixNow = function() {
    return Math.floor(Date.now() / 1000);
  };

  var toUnixSeconds = function(v) {
    if (v == null) {
      return null;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Accept ms timestamps too.
      if (v > 1e12) {
        return Math.floor(v / 1000);
      }
      return Math.floor(v);
    }
    if (typeof v === 'string' && v.length) {
      var t = new Date(v).getTime();
      if (!Number.isNaN(t)) {
        return Math.floor(t / 1000);
      }
    }
    return null;
  };

  var readTvJson = function() {
    // Return cached version if available
    if (tvJsonCache !== null) {
      return tvJsonCache;
    }
    
    try {
      if (!fs.existsSync(TV_JSON_PATH)) {
        tvJsonCache = [];
        return [];
      }
      var raw = fs.readFileSync(TV_JSON_PATH, 'utf8');
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) {
        tvJsonCache = [];
        return [];
      }

      // Normalize any older schema entries in-place.
      var changed = false;
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var o = arr[i];
        if (!o || typeof o !== 'object') {
          continue;
        }

        var prevLocalPath = o.localPath;
        var prevTitle = o.title;
        var prevFileSize = o.fileSize;
        var prevDateStarted = o.dateStarted;
        var prevDateEnded = o.dateEnded;

        var localPath1 = typeof o.localPath === 'string' ? o.localPath : '';
        var title1 = typeof o.title === 'string' ? o.title : '';

        // If localPath looks like it includes a filename, split it.
        var filePath = '';
        var dirPath = '';
        var baseName = '';

        if (localPath1 && !localPath1.endsWith('/') && path.extname(localPath1)) {
          filePath = localPath1;
          dirPath = path.dirname(filePath) + '/';
          baseName = path.basename(filePath);
        } else {
          dirPath = localPath1;
          if (dirPath && !dirPath.endsWith('/')) {
            dirPath += '/';
          }
          baseName = title1;
        }

        // title must be the actual filename.
        if (filePath && baseName) {
          title1 = baseName;
        }

        // fileSize must be integer bytes; compute via stat when possible.
        var fileSizeBytes = null;
        if (typeof prevFileSize === 'number' && Number.isFinite(prevFileSize)) {
          fileSizeBytes = prevFileSize;
        } else if (typeof prevFileSize === 'string' && /^\d+$/.test(prevFileSize)) {
          fileSizeBytes = parseInt(prevFileSize, 10);
        } else {
          var statPath = '';
          if (filePath) {
            statPath = filePath;
          } else if (dirPath && title1) {
            statPath = dirPath + title1;
          }
          try {
            if (statPath && fs.existsSync(statPath)) {
              fileSizeBytes = fs.statSync(statPath).size;
            }
          } catch (e) {}
        }

        var dateStarted1 = toUnixSeconds(prevDateStarted);
        var dateEnded1 = toUnixSeconds(prevDateEnded);

        var n = Object.assign({}, o);
        if (dirPath) n.localPath = dirPath;
        if (title1) n.title = title1;
        if (fileSizeBytes != null) n.fileSize = fileSizeBytes;
        if (dateStarted1 != null) n.dateStarted = dateStarted1;
        if (dateEnded1 != null) n.dateEnded = dateEnded1;

        // Add progress field if missing: 100 for finished, 0 for others.
        if (o.progress == null) {
          if (o.status === 'finished') {
            n.progress = 100;
          } else if (o.status === 'downloading') {
            n.progress = 0;
          }
          changed = true;
        }

        if (n.localPath !== prevLocalPath || n.title !== prevTitle || n.fileSize !== prevFileSize || n.dateStarted !== prevDateStarted || n.dateEnded !== prevDateEnded) {
          changed = true;
        }

        out.push(n);
      }

      // De-dupe: if multiple entries exist for the same filename with the same fileSize
      // (typically due to pre-population guessing a different seriesName/localPath),
      // keep the most recent one.
      (function dedupeByTitleAndSize() {
        var groups = new Map();
        var removedTotal = 0;
        for (var i = 0; i < out.length; i++) {
          var o = out[i];
          if (!o || typeof o !== 'object') continue;
          var t = typeof o.title === 'string' ? o.title : '';
          if (!t) continue;
          var sz = (typeof o.fileSize === 'number' && Number.isFinite(o.fileSize)) ? o.fileSize : null;
          var key = t + '\u0000' + (sz == null ? '' : String(sz));
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(i);
        }

        var statusRank = function(s) {
          if (s === 'finished') return 3;
          if (s === 'downloading') return 2;
          if (s === 'future') return 1;
          return 0;
        };

        var keep = new Array(out.length).fill(true);
        for (var [key, idxs] of groups.entries()) {
          if (!idxs || idxs.length <= 1) continue;

          var bestIdx = idxs[0];
          var bestScore = null;
          for (var j = 0; j < idxs.length; j++) {
            var k = idxs[j];
            var o = out[k] || {};
            var ended = toUnixSeconds(o.dateEnded) || 0;
            var started = toUnixSeconds(o.dateStarted) || 0;
            var recency = Math.max(ended, started);
            var st = statusRank(o.status);
            var prog = (typeof o.progress === 'number' && Number.isFinite(o.progress)) ? o.progress : -1;
            var score = [recency, st, prog];
            if (!bestScore) {
              bestScore = score;
              bestIdx = k;
              continue;
            }
            var better = false;
            for (var si = 0; si < score.length; si++) {
              if (score[si] > bestScore[si]) {
                better = true;
                break;
              }
              if (score[si] < bestScore[si]) {
                break;
              }
            }
            if (better) {
              bestScore = score;
              bestIdx = k;
            }
          }

          for (var j = 0; j < idxs.length; j++) {
            var k = idxs[j];
            if (k !== bestIdx) {
              keep[k] = false;
              changed = true;
              removedTotal++;
            }
          }
        }

        if (changed) {
          out = out.filter((_, i) => keep[i]);
          if (removedTotal > 0) {
            appendTvLog(`[dedupe] readTvJson removed ${removedTotal} duplicate entries\n`);
          }
        }
      })();

      out = pruneOldTvJson(out);
      if (changed) {
        writeTvJson(out);
      }
      tvJsonCache = out;
      return out;
    } catch (e) {
      tvJsonCache = [];
      return [];
    }
  };

  var writeTvJson = function(arr) {
    try {
      tvJsonCache = arr;
      fs.writeFileSync(TV_JSON_PATH, JSON.stringify(arr));
    } catch (e) {
      // don't crash processing if status file can't be written
    }
  };

  var pruneOldTvJson = function(arr) {
    var cutoff = unixNow() - 30 * 24 * 60 * 60; // ~1 month
    return arr.filter((o) => {
      if (!o) return false;
      var d = o.dateEnded != null ? o.dateEnded : o.dateStarted;
      if (d == null) return true;
      var t = toUnixSeconds(d);
      if (t == null) return true;
      return t >= cutoff;
    });
  };

  // A file is uniquely identified by (localPath directory + title filename).
  var upsertTvJson = function(localPath, title1, patch) {
    var arr = pruneOldTvJson(readTvJson());
    var idx = arr.findIndex((o) => o && o.localPath === localPath && o.title === title1);
    var isNewItem = idx < 0;
    var isFinished = patch && patch.status === 'finished';
    var isDownloading = patch && patch.status === 'downloading';
    
    if (isNewItem) {
      arr.push(Object.assign({localPath, title: title1}, patch));
    } else {
      arr[idx] = Object.assign({}, arr[idx], patch);
    }

    // If duplicates exist for the same filename (typically due to pre-population
    // guessing a different seriesName/localPath), keep the most recent one.
    // "Most recent" is determined by dateEnded/dateStarted; ties break by status/progress.
    var dupIdxs = [];
    for (var di = 0; di < arr.length; di++) {
      var d = arr[di];
      if (d && d.title === title1) {
        dupIdxs.push(di);
      }
    }

    if (dupIdxs.length > 1) {
      var statusRank = function(s) {
        if (s === 'finished') return 3;
        if (s === 'downloading') return 2;
        if (s === 'future') return 1;
        return 0;
      };

      var bestIdx = dupIdxs[0];
      var bestScore = null;
      var bestObj = null;

      for (var dk = 0; dk < dupIdxs.length; dk++) {
        var k = dupIdxs[dk];
        var o = arr[k] || {};
        var ended = toUnixSeconds(o.dateEnded) || 0;
        var started = toUnixSeconds(o.dateStarted) || 0;
        var recency = Math.max(ended, started);
        var st = statusRank(o.status);
        var prog = (typeof o.progress === 'number' && Number.isFinite(o.progress)) ? o.progress : -1;

        // Prefer the entry we just updated if everything else is equal.
        var isCurrent = (o.localPath === localPath);

        var score = [recency, st, prog, isCurrent ? 1 : 0];
        if (!bestScore) {
          bestScore = score;
          bestIdx = k;
          bestObj = o;
          continue;
        }
        // Lexicographic compare
        var better = false;
        for (var si = 0; si < score.length; si++) {
          if (score[si] > bestScore[si]) {
            better = true;
            break;
          }
          if (score[si] < bestScore[si]) {
            break;
          }
        }
        if (better) {
          bestScore = score;
          bestIdx = k;
          bestObj = o;
        }
      }

      var removedCount = dupIdxs.length - 1;
      arr = arr.filter((o, i) => {
        if (!o) return false;
        if (o.title === title1) {
          return i === bestIdx;
        }
        return true;
      });

      if (removedCount > 0) {
        var keptPath = bestObj && bestObj.localPath ? bestObj.localPath : localPath;
        var keptStatus = bestObj && bestObj.status ? bestObj.status : (patch && patch.status ? patch.status : '');
        appendTvLog(`[dedupe] removed ${removedCount} duplicate(s) for "${title1}", kept: ${keptStatus} @ ${keptPath}\n`);
      }
    }
    
    // Update cache immediately
    tvJsonCache = arr;
    
    // Only write to disk when adding new item or download finished
    if (isNewItem || isFinished) {
      writeTvJson(arr);
    }
  };

  // Trigger one-time normalization/migration at startup.
  readTvJson();

  // Always show crashes in tv.log (pm2 may otherwise capture them separately).
  var appendFatalToTvLog = function(kind, value) {
    try {
      var msg = value;
      if (value && typeof value === 'object') {
        msg = value.stack || value.message || JSON.stringify(value);
      }
      appendTvLog(`\n[${new Date().toISOString()}] ${kind}: ${String(msg)}\n`);
    } catch (e) {
      try {
        appendTvLog(`\n[${new Date().toISOString()}] ${kind}: (failed to stringify error)\n`);
      } catch (_) {}
    }
  };

  process.on('uncaughtException', (e) => {
    appendFatalToTvLog('uncaughtException', e);
  });

  process.on('unhandledRejection', (reason) => {
    appendFatalToTvLog('unhandledRejection', reason);
  });

  // --- tv.log direct writing (buffering disabled) ----------------------------
  // Write all logs directly to tv.log without buffering.
  // If logging fails, don't crash processing.
  
  writeLine = function(streamName, args) {
    var line;
    line = util.format(...args) + "\n";
    return appendTvLog(line);
  };

  // Keep these functions as no-ops for compatibility
  startBuffering = function() {};
  stopBuffering = function() {};
  clearBuffer = function() {};
  flushBuffer = function() {};
  flushAndGoLive = function() {};

  console.log = function(...args) {
    return writeLine('stdout', args);
  };

  console.error = function(...args) {
    return writeLine('stderr', args);
  };

  // ---------------------------------------------------------------------------
  exec = require('child_process').execSync;

  var spawn = require('child_process').spawn;

  mkdirp = require('mkdirp');

  request = require('request');

  rimraf = require('rimraf');

  // Replace guessit with npm module parse-torrent-title
  var parseTorrentTitle = require('parse-torrent-title').parse;

  // --- startProc server state ------------------------------------------------
  var pendingStartProcTitle = null;
  var abortBetweenFiles = false;
  var nextCycleTimer = null;

  emby = require('./emby.js');

  await emby.init();

  fs.writeFileSync(SCAN_LIBRARY_FLAG_PATH, 'noscan');

  downloadTime = Date.now();

  filterRegex = null;

  filterRegexTxt = '';

  if (process.argv.length === 3) {
    filterRegex = process.argv[2];
    filterRegexTxt = 'filter:' + filterRegex;
  }

  log(`.... starting tv.coffee v4 ${filterRegexTxt} ....`);

  // Declare per-cycle state in outer scope (CoffeeScript scoping is per-function).
  startTime = time = Date.now();

  deleteCount = chkCount = recentCount = 0;

  existsCount = errCount = downloadCount = blockedCount = 0;

  cycleRunning = false;

  lastPruneAt = 0;

  // Sequence number for files processed in the current cycle.
  // Resets on cycle start and increments per file that passes block tests.
  cycleSeq = 0;
  currentSeq = null;

  resetCycleState = function() {
    startTime = time = Date.now();
    downloadTime = Date.now();
    deleteCount = chkCount = recentCount = 0;
    existsCount = errCount = downloadCount = blockedCount = 0;
    cycleSeq = 0;
    currentSeq = null;
  };

  scheduleNextCycle = function() {
    if (nextCycleTimer) {
      clearTimeout(nextCycleTimer);
    }
    nextCycleTimer = setTimeout(runCycle, PROCESS_INTERVAL_MS);
    return nextCycleTimer;
  };

  runCycle = function() {
    if (cycleRunning) {
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
    var http = require('http');
    var url = require('url');

    var setCors = function(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    };

    var json = function(res, statusCode, obj) {
      setCors(res);
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };

    var requestStartProc = function(reqTitle) {
      pendingStartProcTitle = (typeof reqTitle === 'string' ? reqTitle : '').trim();
      
      // If title is blank:
      // - if a cycle is running, restart after the current file finishes
      // - if nothing is running, start a new cycle immediately
      if (!pendingStartProcTitle) {
        if (cycleRunning) {
          abortBetweenFiles = true;
          return;
        }
        // Not currently processing: start new cycle.
        if (nextCycleTimer) {
          clearTimeout(nextCycleTimer);
          nextCycleTimer = null;
        }
        runCycle();
        return;
      }
      
      // Title is not blank - set priority and abort if needed
      if (cycleRunning) {
        // Finish the current file, then restart the cycle.
        abortBetweenFiles = true;
        return;
      }
      // Not currently processing: restart cycle immediately.
      if (nextCycleTimer) {
        clearTimeout(nextCycleTimer);
        nextCycleTimer = null;
      }
      runCycle();
    };

    http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        setCors(res);
        res.statusCode = 204;
        return res.end();
      }

      var parsed = url.parse(req.url, true);
      
      // Strip proxy prefix if present
      var pathname = parsed.pathname;
      if (pathname.startsWith('/torrents-api/api/tvproc/')) {
        pathname = pathname.substring('/torrents-api/api/tvproc'.length);
      } else if (pathname.startsWith('/torrents-api/')) {
        pathname = pathname.substring('/torrents-api'.length);
      }
      
      // Handle /startProc endpoint
      if (pathname === '/startProc') {
        if (req.method === 'GET') {
          try {
            requestStartProc(parsed.query && parsed.query.title);
            return json(res, 200, {status: 'ok'});
          } catch (e) {
            return json(res, 500, {status: String(e && e.message ? e.message : e)});
          }
        }

        if (req.method === 'POST') {
          var body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
              req.destroy();
            }
          });
          req.on('end', () => {
            try {
              var obj = body ? JSON.parse(body) : {};
              requestStartProc(obj && obj.title);
              return json(res, 200, {status: 'ok'});
            } catch (e) {
              return json(res, 400, {status: String(e && e.message ? e.message : e)});
            }
          });
          return;
        }

        return json(res, 405, {status: 'method not allowed'});
      }

      // Handle /downloads endpoint - returns cached tv.json data
      if (pathname === '/downloads') {
        if (req.method === 'GET') {
          try {
            var downloads = readTvJson();
            return json(res, 200, downloads);
          } catch (e) {
            return json(res, 500, {status: String(e && e.message ? e.message : e)});
          }
        }

        return json(res, 405, {status: 'method not allowed'});
      }

      // Handle /clearCache endpoint - invalidates cache and reloads from disk
      if (pathname === '/clearCache') {
        if (req.method === 'POST' || req.method === 'GET') {
          try {
            // Hard reset: empty in-memory cache and overwrite tv.json on disk.
            var clearedCount = 0;
            try {
              clearedCount = readTvJson().length;
            } catch (e) {}
            tvJsonCache = [];
            writeTvJson([]);
            return json(res, 200, {status: 'ok', count: clearedCount});
          } catch (e) {
            return json(res, 500, {status: String(e && e.message ? e.message : e)});
          }
        }

        return json(res, 405, {status: 'method not allowed'});
      }

      // No matching endpoint
      return json(res, 404, {status: 'not found'});
    }).listen(3003, '0.0.0.0');
  })();

  findUsb = `ssh ${usbHost} \"find files -ignore_readdir_race -type f -printf '%CY-%Cm-%Cd-%P-%s\\\\n' 2>/dev/null\" ` + "| grep -Ev .r[0-9]+-[0-9]+$ | grep -Ev .rar-[0-9]+$ " + "| grep -Ev screen[0-9]+.png-[0-9]+$";

  if (filterRegex) {
    findUsb += " | grep -i " + filterRegex;
  }

  log({findUsb});

  dateStr = (date) => {
    var day, hours, minutes, month, seconds, year;
    date = new Date(date);
    year = date.getFullYear();
    month = (date.getMonth() + 1).toString().padStart(2, '0');
    day = date.getDate().toString().padStart(2, '0');
    hours = date.getHours().toString().padStart(2, '0');
    minutes = date.getMinutes().toString().padStart(2, '0');
    seconds = date.getSeconds().toString().padStart(2, '0');
    return `${year}/${month}/${day}-${hours}:${minutes}:${seconds}`;
  };

  readMap = (fname) => {
    var entry, map, timex;
    map = JSON.parse(fs.readFileSync(fname, 'utf8'));
    for (entry in map) {
      timex = map[entry];
      map[entry] = new Date(timex).getTime();
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

  recent = null;

  errors = null;

  blocked = null;

  //##########
  // constants
  map = {};

  reloadState = function() {
    var f, j, len, line, mapLines, mapStr, results, t;
    recent = readMap(TV_RECENT_PATH);
    errors = readMap(TV_ERRORS_PATH);
    blocked = JSON.parse(fs.readFileSync(TV_BLOCKED_PATH, 'utf8'));
    map = {};
    mapStr = fs.readFileSync(TV_MAP_PATH, 'utf8');
    mapLines = mapStr.split('\n');
    results = [];
    for (j = 0, len = mapLines.length; j < len; j++) {
      line = mapLines[j];
      [f, t] = line.split(',');
      if (line.length) {
        results.push(map[f.trim()] = t.trim());
      } else {
        results.push(void 0);
      }
    }
    return results;
  };

  reloadState();

  tvPath = '/mnt/media/tv/';

  escQuotes = function(str) {
    return "'" + str.replace(/\\/g, '\\\\').replace(/'/g, "'\\''") + "'";
  };

  //  .replace(/'|`/g,  "\\'")
  //  .replace(/\(/g, "\\(")
  //  .replace(/\)/g, "\\)")
  //  .replace(/\&/g, "\\&")
  //  .replace(/\s/g, '\\ ')  

  //###############
  // async routines
  getUsbFiles = delOldFiles = checkFiles = checkFile = badFile = checkFileExists = checkFile = chkTvDB = null;

  //######################################
  // get the api token
  theTvDbToken = null;

  request.post('https://api4.thetvdb.com/v4/login', {
    json: true,
    body: {
      "apikey": "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df",
      "pin": "HXEVSDFF"
    }
  }, (error, response, body) => {
    if (error || response.statusCode !== 200) {
      err('theTvDb login error:', error);
      err('theTvDb statusCode:', response && response.statusCode);
      return process.exit();
    } else {
      theTvDbToken = body.data.token;
      // log({theTvDbToken});
      // process.exit();
      // log 'tvdb login', {error, response, body}
      //   process.exit()
      return process.nextTick(runCycle);
    }
  });

  //#####################################################
  // delete old files in usb/files and entries in tv-recent.json
  delOldFiles = () => {
    var PRUNE_DAYS, PRUNE_INTERVAL_MS, recentChgd, recentFname, recentLimit, recentTime, res;
    PRUNE_INTERVAL_MS = 60 * 60 * 1000;
    if ((Date.now() - lastPruneAt) >= PRUNE_INTERVAL_MS) {
      // Inline prune.sh behavior: delete files older than 60 days on the USB host.
      log(".... deleting old files in usb ~/files ....");
      PRUNE_DAYS = 60;
      res = exec(
        `ssh ${usbHost} "find ~/files -mtime +${PRUNE_DAYS} -exec rm -rf {} \\\; ; echo prune ok"`,
        {
        timeout: 300000
        }
      ).toString();
      lastPruneAt = Date.now();
      if (!res.startsWith('prune ok')) {
        err(`Prune error: ${res}`);
      }
    }
    // delete old entries in tv-recent.json
    // tv-recent files limited to 80 days
    recentLimit = new Date(Date.now() - 80 * 24 * 60 * 60 * 1000); // 80 days ago
    recentChgd = false;
    for (recentFname in recent) {
      recentTime = recent[recentFname];
      if (!(new Date(recentTime) < recentLimit)) {
        continue;
      }
      delete recent[recentFname];
      recentChgd = true;
    }
    if (recentChgd) {
      writeMap(TV_RECENT_PATH, recent);
    }
    return process.nextTick(checkFiles);
  };

  //###########################################################
  // check each remote file, compute series and episode numbers
  usbFilePath = usbFileSize = usbFiles = seriesName = season = episode = fname = title = type = null;
  usbFileBytes = null;

  tvDbErrCount = 0;

  skipPaths = null;

  checkFiles = () => {
    var j, len, usbLine;
    usbFiles = exec(findUsb, {
      timeout: 300000
    }).toString().split('\n');

    // Sort files by parsed title before processing.
    usbFiles = usbFiles.filter((l) => l && l.trim().length);
    usbFiles = usbFiles.map((line) => {
      var lineNoSize = line.split('-').slice(0, -1).join('-');
      var filePath = lineNoSize.slice(11);
      var parts = filePath.split('/');
      var base = parts[parts.length - 1];
      var parsed = {};
      try {
        parsed = parseTorrentTitle(base) || {};
      } catch (e) {
        parsed = {};
      }
      var titleKey = (parsed.title || base).toLowerCase();
      var s = Number.isInteger(parsed.season) ? parsed.season : 0;
      var e = Number.isInteger(parsed.episode) ? parsed.episode : 0;
      var key = `${titleKey}\u0000${String(s).padStart(4, '0')}\u0000${String(e).padStart(4, '0')}\u0000${base.toLowerCase()}`;
      return {line, key, base};
    }).sort((a, b) => a.key.localeCompare(b.key));

    // If startProc requested a title, process a matching file first (if any).
    if (pendingStartProcTitle) {
      var wanted = pendingStartProcTitle.toLowerCase();
      var idx = usbFiles.findIndex((x) => x.base.toLowerCase().includes(wanted));
      if (idx >= 0) {
        var match = usbFiles.splice(idx, 1)[0];
        usbFiles.unshift(match);
      }
      pendingStartProcTitle = null;
    }

    usbFiles = usbFiles.map((x) => x.line);
    // fs.writeFileSync 'tv-files.txt', usbFiles.join('\n')
    // process.exit 0
    skipPaths = [];
    for (j = 0, len = usbFiles.length; j < len; j++) {
      usbLine = usbFiles[j];
      usbLine = usbLine.split('-').slice(0, -1).join('-');
      if (usbLine.endsWith('!unrar.lock')) {
        skipPaths.push(usbLine.slice(11, -12));
      }
    }
    if (skipPaths.length > 0) {
      log("skipping locked paths", skipPaths);
    }

    // Pre-populate tv.json with all files that will be processed this cycle
    var futureSeq = 0;
    for (j = 0; j < usbFiles.length; j++) {
      var futLine = usbFiles[j];
      var futLineParts = futLine.split('-');
      var futFileBytes = parseInt(futLineParts.pop(), 10);
      futLine = futLineParts.join('-');
      var futFilePath = futLine.slice(11);
      var futParts = futFilePath.split('/');
      var futFname = futParts[futParts.length - 1];
      var futExt = futFname.split('.').pop();
      
      // Skip non-video files
      if (futExt.length === 6 || ['nfo', 'idx', 'sub', 'txt', 'jpg', 'gif', 'jpeg', 'part'].includes(futExt)) {
        continue;
      }
      
      // Skip if in recent list
      if (recent[futFname]) {
        continue;
      }
      
      // Skip if blocked
      var isBlocked = false;
      for (var blk in blocked) {
        if (futFname.indexOf(blk) > -1) {
          isBlocked = true;
          break;
        }
      }
      if (isBlocked) {
        continue;
      }
      
      // Skip if in errors
      if (errors[futFname]) {
        continue;
      }
      
      // Skip locked paths
      var isLocked = false;
      for (var sp = 0; sp < skipPaths.length; sp++) {
        if (futFilePath.startsWith(skipPaths[sp])) {
          isLocked = true;
          break;
        }
      }
      if (isLocked) {
        continue;
      }
      
      // Parse title, season, episode
      var futParsed = {};
      var futTitle = null;
      var futSeason = null;
      var futEpisode = null;
      try {
        futParsed = parseTorrentTitle(futFname) || {};
        futTitle = futParsed.title;
        futSeason = futParsed.season;
        futEpisode = futParsed.episode;
        
        if (!futTitle || !Number.isInteger(futSeason) || !Number.isInteger(futEpisode)) {
          continue; // Skip non-episodes
        }
      } catch (e) {
        continue; // Skip parse errors
      }
      
      // Get series name from cache or mark for lookup
      var futSeriesName = tvdbCache[futTitle] || map[futTitle] || futTitle;
      if (map[futSeriesName]) {
        futSeriesName = map[futSeriesName];
      }
      
      futureSeq++;
      var futTvSeasonPath = `${tvPath}${futSeriesName}/Season ${futSeason}`;
      var futTvLocalDir = `${futTvSeasonPath}/`;
      
      // Create "future" entry in tv.json
      upsertTvJson(futTvLocalDir, futFname, {
        status: 'future',
        sequence: futureSeq,
        fileSize: futFileBytes,
        season: futSeason,
        episode: futEpisode
      });
    }

    // if filterRegex
    //   log usbFiles.join('\n')
    return process.nextTick(checkFile);
  };

  checkFile = () => {
    var blkName, cmd, fext, guessItRes, j, len, parts, skipPath, usbLine, usbLineParts;
    tvDbErrCount = 0;

    // If a startProc request came in while processing, finish the current file,
    // then restart the cycle immediately (and optionally prioritize a title).
    if (abortBetweenFiles) {
      abortBetweenFiles = false;
      cycleRunning = false;
      if (nextCycleTimer) {
        clearTimeout(nextCycleTimer);
        nextCycleTimer = null;
      }
      runCycle();
      return;
    }

    if (usbLine = usbFiles.shift()) {
      usbLineParts = usbLine.split('-');
      usbFileBytes = parseInt(usbLineParts.pop(), 10);
      usbLine = usbLineParts.join('-');
      usbFilePath = usbLine.slice(11);
      usbFileSize = sizeStr(usbFileBytes, {
        digits: 2,
        suffix: 'B'
      });
      for (j = 0, len = skipPaths.length; j < len; j++) {
        skipPath = skipPaths[j];
        if (usbFilePath.startsWith(skipPath)) {
          log(`skipping locked ${usbFilePath}`);
          process.nextTick(checkFile);
          return;
        }
      }
      chkCount++;
      parts = usbFilePath.split('/');
      fname = parts[parts.length - 1];
      parts = fname.split('.');
      fext = parts[parts.length - 1];
      if (fext.length === 6 || (fext === 'nfo' || fext === 'idx' || fext === 'sub' || fext === 'txt' || fext === 'jpg' || fext === 'gif' || fext === 'jpeg' || fext === 'part')) {
        process.nextTick(checkFile);
        return;
      }
      if (recent[fname]) {
        recentCount++;
        log('------', downloadCount, '/', chkCount, 'SKIPPING RECENT:', fname);
        process.nextTick(checkFile);
        return;
      }
      log('not recent', usbLine);
      for (blkName in blocked) {
        if (fname.indexOf(blkName) > -1) {
          recent[fname] = Date.now();
          writeMap(TV_RECENT_PATH, recent);
          // fs.writeFileSync 'tv-recent.json', JSON.stringify recent
          blockedCount++;
          log('-- BLOCKED:', {blkName, fname});
          process.nextTick(checkFile);
          return;
        }
      }
      log('not blocked', usbLine);
      if (errors[fname]) {
        log('------', downloadCount, '/', chkCount, 'SKIPPING *ERROR*:', fname);
        process.nextTick(checkFile);
        return;
      }
      // file passed all block tests, process it
      flushAndGoLive();
      currentSeq = ++cycleSeq;
      downloadTime = Date.now();
      season = 1;
      episode = 1;
      try {
        var parsed = parseTorrentTitle(fname) || {};
        ({title, season, episode} = parsed);

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
          var detail = detailParts.length ? detailParts.join(', ') : 'no usable fields';

          if (title && Number.isInteger(season) && !Number.isInteger(episode)) {
            badFile(`parse-torrent-title: found title+season but no episode (${detail}) → not an episode`);
          } else if (title && !Number.isInteger(season) && !Number.isInteger(episode)) {
            badFile(`parse-torrent-title: found title but no season/episode (${detail}) → not an episode`);
          } else {
            badFile(`parse-torrent-title: missing required fields (${detail}) → not an episode`);
          }
          return;
        }
        type = 'episode';
        if (!type === 'episode') {
          log('\nskipping non-episode:', fname);
          badFile('non-episode');
          return;
        }
        if (!Number.isInteger(season)) {
          err('\nno season integer for ' + usbLine + ', defaulting to season 1', {title, season, type});
          season = 1;
        }
      } catch (error1) {
        err('\nerror parsing:' + fname);
        badFile(`parse-torrent-title threw: ${error1 && error1.message ? error1.message : 'unknown'}`);
        return;
      }
      appendTvLog('\n>>>>>> ' + (downloadCount + 1) + ' s' + ('' + season).padStart(2, '0') + 'e' + ('' + episode).padStart(2, '0') + ' ' + dateStr(Date.now()) + ' -- ' + usbFileSize + ' --\n' + fname + '\n');
      return process.nextTick(chkTvDB);
    } else {
      log('.... done ....');
      
      // if downloadCount > 0 
      //   fs.writeFileSync(SCAN_LIBRARY_FLAG_PATH, 'scan')
      // else if fs.readFileSync(SCAN_LIBRARY_FLAG_PATH,'utf8') is 'scan'
      //   log 'scanning library'
      //   await emby.scanLibrary()
      //   fs.writeFileSync(SCAN_LIBRARY_FLAG_PATH, 'noscan')
      if ((deleteCount + existsCount + errCount + downloadCount + blockedCount) > 0) {
        log("***********************************************************");
      }
      cycleRunning = false;

      // If we downloaded anything this cycle, start a new cycle immediately.
      // Otherwise, wait until the next scheduled interval.
      if (downloadCount > 0) {
        return runCycle();
      }
      return scheduleNextCycle();
    }
  };

  tvdbCache = {};

  tvdburl = '';

  chkTvDB = () => {
    // if title.includes('Faraway')
    //   seriesName = 'Faraway Downs'
    //   setTimeout checkFileExists, rsyncDelay
    //   return
    if (tvdbCache[title]) {
      seriesName = tvdbCache[title];
      // process.nextTick checkFileExists
      setTimeout(checkFileExists, rsyncDelay);
      return;
    }
    log('search:', title);
    tvdburl = 'https://api4.thetvdb.com/v4/search?type=series&q=' + encodeURIComponent(title);
    return request(tvdburl, {
      json: true,
      headers: {
        Authorization: 'Bearer ' + theTvDbToken
      }
    }, (error, response, body) => {
      var ref;
      // log 'thetvdb', {tvdburl, error, response, body}
      if (error || !((ref = body.data) != null ? ref[0] : void 0) || ((response != null ? response.statusCode : void 0) !== 200)) {
        err('no series name found in theTvDB:', {fname, tvdburl});
        err('search error:', error);
        err('search statusCode:', response && response.statusCode);
        err('search body:', body);
        if (error) {
          if (++tvDbErrCount === 15) {
            err('giving up, downloaded:', downloadCount);
            return;
          }
          err("tvdb err retry, waiting one minute");
          return setTimeout(chkTvDB, rsyncDelay);
        } else {
          badFile('thetvdb: no series match');
          return;
        }
      } else {
        seriesName = body.data[0].name;
        log('tvdb got:', {seriesName, title});
        if (map[seriesName]) {
          console.log('Mapping', seriesName, 'to', map[seriesName]);
          seriesName = map[seriesName];
        }
        tvdbCache[title] = seriesName;
        // process.nextTick checkFileExists
        return setTimeout(checkFileExists, rsyncDelay);
      }
    });
  };

  checkFileExists = () => {
    var e, rsyncCmd, tvFilePath, tvSeasonPath, usbLongPath, videoPath;
    tvSeasonPath = `${tvPath}${seriesName}/Season ${season}`;
    tvFilePath = `${tvSeasonPath}/${fname}`;
    videoPath = `files/${usbFilePath}`;
    usbLongPath = `${usbHost}:${videoPath}`;
    
    if (SKIP_DOWNLOAD) {
      // Skip download mode: just mark as finished and add to recent list
      console.log(`[SKIP_DOWNLOAD] Marking as finished without downloading: ${fname}`);
      var tvLocalDir = `${tvSeasonPath}/`;
      
      upsertTvJson(tvLocalDir, fname, {
        status: 'finished',
        progress: 100,
        eta: null,
        sequence: currentSeq,
        fileSize: usbFileBytes,
        season,
        episode,
        dateStarted: unixNow(),
        dateEnded: unixNow()
      });
      
      downloadCount++;
      recent[fname] = Date.now();
      writeMap(TV_RECENT_PATH, recent);
      return process.nextTick(checkFile);
    }
    
    if (fs.existsSync(tvFilePath)) {
      existsCount++;
      log(`-- EXISTING: ${tvPath}${seriesName}/Season ${season}`);

      // If this file was pre-populated as "future", mark it as finished so it
      // doesn't remain stuck forever.
      var tvLocalDir = `${tvSeasonPath}/`;
      upsertTvJson(tvLocalDir, fname, {
        status: 'finished',
        progress: 100,
        eta: null,
        sequence: currentSeq,
        fileSize: usbFileBytes,
        season,
        episode,
        dateStarted: unixNow(),
        dateEnded: unixNow()
      });
    } else {
      mkdirp.sync(tvSeasonPath);
      // Ensure download is encrypted: force rsync remote shell to SSH.
      rsyncCmd = `rsync -av -e ssh --timeout=20 ${escQuotes(usbLongPath)} ${escQuotes(tvFilePath)}`;
      appendTvLog(usbFilePath.slice(0, -fname.length) + '\n');
      appendTvLog(tvFilePath.slice(0, -fname.length) + '\n');

      var tvLocalDir = `${tvSeasonPath}/`;

      // Update status from 'future' to 'downloading' (entry already exists from pre-population)
      upsertTvJson(tvLocalDir, fname, {
        status: 'downloading',
        progress: 0,
        eta: null,
        sequence: currentSeq,
        fileSize: usbFileBytes,
        season,
        episode,
        dateStarted: unixNow()
      });

      // Use spawn to stream rsync progress and update tv.json in real-time.
      var rsyncArgs = ['-av', '-e', 'ssh', '--timeout=20', '--info=progress2', usbLongPath, tvFilePath];
      var rsyncProc = spawn('rsync', rsyncArgs, {
        timeout: fileTimeout.timeout,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      var rsyncOutput = '';
      var lastProgress = 0;
      var progressUpdateInterval = 500; // ms
      var lastProgressUpdateTime = 0;

      rsyncProc.stdout.on('data', (data) => {
        var chunk = data.toString();
        rsyncOutput += chunk;
        
        // Parse progress and ETA from rsync output (format: "1.23M  45%  123.45kB/s    0:00:12" or "2:30")
        var progressMatch = chunk.match(/(\d+)%/);
        var etaMatch = chunk.match(/(\d+):(\d+)(?::(\d+))?/);
        
        if (progressMatch) {
          var progress = parseInt(progressMatch[1], 10);
          if (progress > lastProgress && (Date.now() - lastProgressUpdateTime) >= progressUpdateInterval) {
            lastProgress = progress;
            lastProgressUpdateTime = Date.now();
            
            var updateData = {
              status: 'downloading',
              progress: progress
            };
            
            // Add ETA if available (rsync shows remaining time as MM:SS or HH:MM:SS)
            if (etaMatch) {
              var etaSeconds = 0;
              if (etaMatch[3] !== undefined) {
                // HH:MM:SS format
                var hours = parseInt(etaMatch[1], 10);
                var minutes = parseInt(etaMatch[2], 10);
                var seconds = parseInt(etaMatch[3], 10);
                etaSeconds = hours * 3600 + minutes * 60 + seconds;
              } else {
                // MM:SS format
                var minutes = parseInt(etaMatch[1], 10);
                var seconds = parseInt(etaMatch[2], 10);
                etaSeconds = minutes * 60 + seconds;
              }
              updateData.eta = unixNow() + etaSeconds;
            }
            
            upsertTvJson(tvLocalDir, fname, updateData);
          }
        }
      });

      rsyncProc.stderr.on('data', (data) => {
        rsyncOutput += data.toString();
      });

      rsyncProc.on('close', (code, signal) => {
        if (code !== 0) {
          // Check if the file was actually created despite the error code.
          // Exit code 23 = "Partial transfer due to error" - may still have the file.
          var fileExists = false;
          var actualSize = 0;
          try {
            if (fs.existsSync(tvFilePath)) {
              var stats = fs.statSync(tvFilePath);
              actualSize = stats.size;
              // Consider it a success if file exists and has reasonable size (> 1MB).
              if (actualSize > 1024 * 1024) {
                fileExists = true;
              }
            }
          } catch (e) {}

          if (!fileExists) {
            var errMsg = code === 23 ? 'Missing' : `rsync exit code ${code}`;
            err(`\nvvvvvvvv\nrsync download error: \n${errMsg} (exit code ${code})\nOutput: ${rsyncOutput.slice(-500)}^^^^^^^^^`);

            // Record error status for this file.
            upsertTvJson(tvLocalDir, fname, {
              status: errMsg,
              progress: lastProgress,
              sequence: currentSeq,
              dateEnded: unixNow()
            });

            badFile(`rsync download error: ${errMsg}`);
            return;
          }
          
          // File exists despite error code - treat as success with warning.
          log(`rsync exit ${code} but file exists (${sizeStr(actualSize, {digits:2, suffix:'B'})}), treating as success`);
          code = 0; // Fall through to success handling below.
        }

        // Success: mark finished.
        downloadCount++;
        time = Date.now();
        appendTvLog('download finished: elapsed(mins): ' + ((Date.now() - downloadTime) / (60 * 1000)).toFixed(1) + '\n');

        // Record finished download with progress=100, clear ETA.
        upsertTvJson(tvLocalDir, fname, {
          status: 'finished',
          progress: 100,
          eta: null,
          sequence: currentSeq,
          dateEnded: unixNow()
        });

        // Continue to next file.
        recent[fname] = Date.now();
        writeMap(TV_RECENT_PATH, recent);
        return process.nextTick(checkFile);
      });

      rsyncProc.on('error', (err) => {
        var errMsg = err && err.message ? err.message : 'rsync spawn error';
        console.error(`\nvvvvvvvv\nrsync spawn error: \n${errMsg}^^^^^^^^^`);

        // Record error status for this file.
        upsertTvJson(tvLocalDir, fname, {
          status: errMsg,
          progress: lastProgress,
          sequence: currentSeq,
          dateEnded: unixNow()
        });

        badFile(`rsync spawn error: ${errMsg}`);
      });

      // Exit early: the rsync 'close' handler will continue processing.
      return;
    }
    
    // File already exists; continue to next file.
    recent[fname] = Date.now();
    writeMap(TV_RECENT_PATH, recent);
    return process.nextTick(checkFile);
  };

  badFile = (reason) => {
    errCount++;
    err('writing tv-errors:', {
      reason: reason || 'unknown',
      fname,
      title,
      season,
      episode,
      usbFilePath
    });
    errors[fname] = Date.now();
    writeMap(TV_ERRORS_PATH, errors);
    return process.nextTick(checkFile);
  };

}).call(this);
