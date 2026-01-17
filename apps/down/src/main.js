(async function() {

  const MAX_WORKERS = 8;

  var FAST_TEST, PROCESS_INTERVAL_MS, appendTvLog, badFile, blocked, blockedCount, buffering, checkFile, checkFileExists, checkFiles, chkCount, chkTvDB, clearBuffer, currentSeq, cycleRunning, cycleSeq, dateStr, debug, delOldFiles, deleteCount, downloadCount, downloadTime, episode, err, errCount, errors, escQuotes, exec, existsCount, fileTimeout, findUsb, flushAndGoLive, flushBuffer, fname, fs, getUsbFiles, inProgress, lastPruneAt, log, logBuffer, map, mkdirp, path, readMap, recent, recentCount, reloadState, request, resetCycleState, rimraf, rsyncDelay, runCycle, scheduleNextCycle, season, seriesName, sizeStr, skipPaths, startBuffering, startTime, stopBuffering, theTvDbToken, time, title, tvDbErrCount, tvPath, tvdbCache, tvdburl, type, usbFilePath, usbFileSize, usbFiles, usbHost, util, writeLine, writeMap;

  debug = false;
  FAST_TEST = false;
  SKIP_DOWNLOAD = false; // Set to false to resume actual downloading
  PROCESS_INTERVAL_MS = FAST_TEST ? 30 * 1000 : 5 * 60 * 1000;

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

  fs = require('fs-plus');
  util = require('util');
  path = require('path');

  var BASEDIR = path.join(__dirname, '..');

  var DEFAULT_TV_DATA_DIR = '/mnt/media/archive/dev/apps/tv-data';
  var TV_DATA_DIR = (typeof process.env.TV_DATA_DIR === 'string' && process.env.TV_DATA_DIR.trim())
    ? process.env.TV_DATA_DIR.trim()
    : DEFAULT_TV_DATA_DIR;

  var APP_DIR = path.join(TV_DATA_DIR, 'down');
  var DATA_DIR = path.join(APP_DIR, 'data');
  var MISC_DIR = path.join(APP_DIR, 'misc');

  var ensureDir = function(dir) {
    try {
      return fs.mkdirpSync(dir);
    } catch (e) {}
  };


  ensureDir(DATA_DIR);
  ensureDir(MISC_DIR);
  var dataPath = function(p) {
    return path.join(DATA_DIR, p);
  };

  // tv.log lives under misc/ (shared TV_DATA_DIR/down/misc/tv.log)
  var TV_LOG_PATH = path.join(MISC_DIR, 'tv.log');
  var TV_FINISHED_PATH = dataPath('tv-finished.json');
  var TV_INPROGRESS_PATH = dataPath('tv-inProgress.json');
  var TV_BLOCKED_PATH = dataPath('tv-blocked.json');
  var TV_MAP_PATH = dataPath('tv-map');

  // Strict: state is always stored under TV_DATA_DIR.

  try {
    fs.mkdirpSync(path.dirname(TV_LOG_PATH));
  } catch (e) {}

  appendTvLog = function(line) {
    try {
      return fs.appendFileSync(TV_LOG_PATH, line);
    } catch (error1) {

    }
  };

  // Ensure state files exist.
  (function ensureStateFilesExist() {
    try {
      if (!fs.existsSync(TV_FINISHED_PATH)) {
        fs.writeFileSync(TV_FINISHED_PATH, '{}');
      }
      if (!fs.existsSync(TV_INPROGRESS_PATH)) {
        fs.writeFileSync(TV_INPROGRESS_PATH, '{}');
      }
    } catch (e) {
      // Non-fatal.
    }
  })();

  // tvJson.js owns tv.json cache and all worker lifecycle.
  var tvJson = require('./tvJson.js');

  // Shared utils package is ESM; load via dynamic import.
  var smartTitleMatch = (await import('@tv/share')).smartTitleMatch;

  // Startup marker (tv.log only)
  (function writeStartupMarker() {
    try {
      var fmt = function() {
        try {
          var dtf = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
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
          var yy = String(d.getFullYear() % 100).padStart(2, '0');
          var mm = String(d.getMonth() + 1).padStart(2, '0');
          var dd = String(d.getDate()).padStart(2, '0');
          var hh = String(d.getHours()).padStart(2, '0');
          var mi = String(d.getMinutes()).padStart(2, '0');
          var ss = String(d.getSeconds()).padStart(2, '0');
          return `${yy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
        }
      };

      var prefix = '';
      try {
        if (fs.existsSync(TV_LOG_PATH)) {
          var st = fs.statSync(TV_LOG_PATH);
          if (st && st.size > 0) prefix = '\n';
        }
      } catch (e) {}

      appendTvLog(`${prefix}==== tv-proc started ${fmt()} ====`);
    } catch (e) {}
  })();

  // ---------------------------------------------------------------------------
  var childProcess = require('child_process');
  exec = childProcess.execSync;
  mkdirp = require('mkdirp');
  request = require('request');
  rimraf = require('rimraf');
  var parseTorrentTitle = require('parse-torrent-title').parse;

  // --- startProc server state ------------------------------------------------
  var cycleRestartNeeded = false;
  var nextCycleTimer = null;
  downloadTime = Date.now();
  log('.... starting tv.coffee v4 ....');

  // Declare per-cycle state in outer scope (CoffeeScript scoping is per-function).
  startTime = time = Date.now();
  deleteCount = chkCount = recentCount = 0;
  existsCount = errCount = downloadCount = blockedCount = 0;
  cycleRunning = false;
  lastPruneAt = 0;
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

    var readBody = function(req, cb) {
      var body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          req.destroy();
        }
      });
      req.on('end', () => cb(null, body));
      req.on('error', (e) => cb(e));
    };

    var startProc = function() {
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
            startProc();
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
              if (body) {
                JSON.parse(body);
              }
              startProc();
              return json(res, 200, {status: 'ok'});
            } catch (e) {
              return json(res, 400, {status: String(e && e.message ? e.message : e)});
            }
          });
          return;
        }

        return json(res, 405, {status: 'method not allowed'});
      }

      // Handle /downloads endpoint
      if (pathname === '/downloads') {
        if (req.method === 'GET') {
          try {
            setCors(res);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(tvJson.getDownloads()));
          } catch (e) {
            return json(res, 500, {status: String(e && e.message ? e.message : e)});
          }
        }

        return json(res, 405, {status: 'method not allowed'});
      }

      // Handle /checkFiles endpoint
      // POST body: ["..."]
      // Returns: { existingTitles: ["..."], existingProcids: [123], tvEntries: [ {...}, ... ] }
      if (pathname === '/checkFiles') {
        if (req.method === 'GET') {
          try {
            var q = parsed.query || {};
            var titles = [];
            if (q.titles) {
              try {
                // Prefer JSON array in the querystring.
                titles = JSON.parse(q.titles);
              } catch (e) {
                // Fallback: comma-separated.
                titles = String(q.titles).split(',').map(s => s.trim()).filter(Boolean);
              }
            } else if (q.title) {
              titles = [String(q.title)];
            }
            var out0 = (tvJson.checkFiles ? tvJson.checkFiles(titles) : {existingTitles: [], existingProcids: []});
            return json(res, 200, out0);
          } catch (e) {
            return json(res, 400, {status: String(e && e.message ? e.message : e)});
          }
        }

        if (req.method === 'POST') {
          return readBody(req, (err1, body) => {
            if (err1) {
              return json(res, 400, {status: String(err1 && err1.message ? err1.message : err1)});
            }
            try {
              var titles2 = body ? JSON.parse(body) : [];
              if (!Array.isArray(titles2)) {
                return json(res, 400, {status: 'body must be a JSON array of titles'});
              }
              var out2 = (tvJson.checkFiles ? tvJson.checkFiles(titles2) : {existingTitles: [], existingProcids: []});
              return json(res, 200, out2);
            } catch (e) {
              return json(res, 400, {status: String(e && e.message ? e.message : e)});
            }
          });
        }

        return json(res, 405, {status: 'method not allowed'});
      }

      // Handle /deleteProcids endpoint
      // POST body: { procIds: [...] } (legacy alias: existingProcids)
      // Returns: { status: 'ok' } OR { status: 'error', error: '...' }
      if (pathname === '/deleteProcids') {
        if (req.method === 'POST') {
          return readBody(req, (err1, body) => {
            if (err1) {
              return json(res, 400, {status: 'error', error: String(err1 && err1.message ? err1.message : err1)});
            }
            try {
              var payload = body ? JSON.parse(body) : {};
              var procids = payload && payload.procIds ? payload.procIds : (payload && payload.existingProcids ? payload.existingProcids : []);
              if (!Array.isArray(procids)) {
                return json(res, 400, {status: 'error', error: 'procIds must be an array'});
              }
              if (!tvJson.deleteProcids) {
                return json(res, 500, {status: 'error', error: 'deleteProcids not supported'});
              }
              var r = tvJson.deleteProcids(procids);
              if (r && r.ok) {
                return json(res, 200, {status: 'ok'});
              }
              return json(res, 500, {status: 'error', error: (r && r.errors) ? r.errors : 'delete failed'});
            } catch (e) {
              return json(res, 400, {status: 'error', error: String(e && e.message ? e.message : e)});
            }
          });
        }

        return json(res, 405, {status: 'error', error: 'method not allowed'});
      }

      // No matching endpoint
      return json(res, 404, {status: 'not found'});
    }).listen(3003, '0.0.0.0');
  })();

  findUsb = `ssh ${usbHost} \"find files -ignore_readdir_race -type f -printf '%CY-%Cm-%Cd-%P-%s\\\\n' 2>/dev/null\" ` + "| grep -Ev .r[0-9]+-[0-9]+$ | grep -Ev .rar-[0-9]+$ " + "| grep -Ev screen[0-9]+.png-[0-9]+$";

  log({findUsb});

  // Timestamps in tv-finished.json must be PST timezone.
  // Use America/Los_Angeles so DST is handled correctly.
  var PST_TZ = 'America/Los_Angeles';

  dateStr = (date) => {
    try {
      var d = new Date(date);
      var dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: PST_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
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
      month = (date.getMonth() + 1).toString().padStart(2, '0');
      day = date.getDate().toString().padStart(2, '0');
      hours = date.getHours().toString().padStart(2, '0');
      minutes = date.getMinutes().toString().padStart(2, '0');
      seconds = date.getSeconds().toString().padStart(2, '0');
      return `${year}/${month}/${day}-${hours}:${minutes}:${seconds}`;
    }
  };

  // Convert a local date/time (YYYY/MM/DD-HH:MM:SS) in PST_TZ to epoch ms.
  var epochMsFromZonedParts = function(y, mo, d, hh, mi, ss) {
    // Initial guess: treat provided components as UTC.
    var t = Date.UTC(y, mo - 1, d, hh, mi, ss);
    // Iteratively adjust to account for timezone offset/DST.
    for (var iter = 0; iter < 3; iter++) {
      var dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: PST_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
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

  var parseMapTimestampMs = function(timex) {
    if (typeof timex !== 'string') {
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
    map = JSON.parse(fs.readFileSync(fname, 'utf8'));
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

  recent = null;
  errors = null;
  inProgress = null;

  // Per-cycle view of current tv.json titles (do not cache across cycles)
  var tvJsonTitles = null;

  blocked = null;
  map = {};

  reloadState = function() {
    var f, j, len, line, mapLines, mapStr, results, t;
    // Do not cache tv-finished.json / tv-inProgress.json here.
    // Those are loaded once per cycle immediately after the USB file list is fetched.
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

  // On load, start the first MAX_WORKERS waiting entries.
  // (disabled) Workers are started by tvJson.js on module load.

  tvPath = '/mnt/media/tv/';

  escQuotes = function(str) {
    return "'" + str.replace(/\\/g, '\\\\').replace(/'/g, "'\\''") + "'";
  };

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
      return process.nextTick(runCycle);
    }
  });

  //#####################################################
  // delete old files in usb/files
  delOldFiles = () => {
    var PRUNE_DAYS, PRUNE_INTERVAL_MS, res;
    PRUNE_INTERVAL_MS = 60 * 60 * 1000;
    if ((Date.now() - lastPruneAt) >= PRUNE_INTERVAL_MS) {
      // Inline prune.sh behavior: delete files older than 60 days on the USB host.
      log(".... deleting old files in usb ~/files ....");
      PRUNE_DAYS = 60;
      try {
        // Wait for remote pruning to finish before scanning dirs/pruning DB,
        // otherwise we may miss entries whose folders are deleted moments later.
        // Suppress all output to keep pm2 logs clean.
        exec(
          `ssh ${usbHost} "find ~/files -mtime +${PRUNE_DAYS} -exec rm -rf {} \\; >/dev/null 2>&1"`,
          {
            timeout: 15 * 60 * 1000
          }
        );
        res = 'prune ok';
      } catch (e) {
        // Non-fatal; continue cycle even if prune fails.
        res = 'prune ok';
      }

      // After the hourly USB prune command completes, prune queued entries whose USB folder no longer exists.
      // Keep SSH calls small: this is one additional SSH call.
      try {
        var dirsOut = exec(
          `ssh ${usbHost} "find files -ignore_readdir_race -type d -printf '%P\\n' 2>/dev/null"`,
          {
            timeout: 300000
          }
        ).toString();
        var dirs = dirsOut.split('\n').map((s) => String(s || '').trim()).filter((s) => s.length);
        var set = new Set(dirs);
        // Hourly prune: also run tvResync (and combine DB scans when available).
        if (tvJson.hourlyUsbPruneAndTvResync) {
          tvJson.hourlyUsbPruneAndTvResync(set);
        } else {
          tvJson.pruneMissingUsbDirs(set);
          if (tvJson.tvResync) tvJson.tvResync();
        }
      } catch (e) {
        // Non-fatal.
      }

      lastPruneAt = Date.now();
      if (!res.startsWith('prune ok')) {
        err(`Prune error: ${res}`);
      }
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

    // Load finished/inProgress maps once per cycle, immediately after
    // the USB file list is available.
    try {
      recent = readMap(TV_FINISHED_PATH);
    } catch (e) {
      recent = {};
    }
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

    usbFiles = usbFiles.map((x) => x.line);
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

    return process.nextTick(checkFile);
  };

  checkFile = () => {
    var blkName, cmd, fext, guessItRes, j, len, parts, skipPath, usbLine, usbLineParts;
    tvDbErrCount = 0;

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
      if (recent && recent[fname]) {
        recentCount++;
        log('------', downloadCount, '/', chkCount, 'SKIPPING RECENT:', fname);
        process.nextTick(checkFile);
        return;
      }

      if (tvJsonTitles && tvJsonTitles[fname] && tvJsonTitles[fname].error) {
        recentCount++;
        log('------', downloadCount, '/', chkCount, 'SKIPPING *ERROR*:', fname);
        process.nextTick(checkFile);
        return;
      }

      if (tvJsonTitles && tvJsonTitles[fname]) {
        recentCount++;
        log('------', downloadCount, '/', chkCount, 'SKIPPING ALREADY QUEUED:', fname);
        process.nextTick(checkFile);
        return;
      }

      if (inProgress && inProgress[fname]) {
        recentCount++;
        log('------', downloadCount, '/', chkCount, 'SKIPPING IN-PROGRESS:', fname);
        process.nextTick(checkFile);
        return;
      }
      log('not recent', usbLine);
      for (blkName in blocked) {
        if (fname.indexOf(blkName) > -1) {
          blockedCount++;
          log('-- BLOCKED:', {blkName, fname});
          process.nextTick(checkFile);
          return;
        }
      }
      log('not blocked', usbLine);

      // file passed all block tests, process it
      currentSeq = ++cycleSeq;
      downloadTime = Date.now();
      season = 1;
      episode = 1;
      try {
        var parsed = parseTorrentTitle(fname) || {};
        ({title, season, episode} = parsed);
        type = parsed.type || 'episode';

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
        if (type !== 'episode') {
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
      // (logging moved to workers)
      return process.nextTick(chkTvDB);
    } else {
      log('.... done ....');
      
      if ((deleteCount + existsCount + errCount + downloadCount + blockedCount) > 0) {
        log("***********************************************************");
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

  tvdbCache = {};
  tvdburl = '';

  chkTvDB = () => {
    // smartTitleMatch() is provided by the shared @tv/share package.

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
      timeout: 15000,
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
        // Prefer a title match across all results (basic normalization first, then aggressive).
        var results = Array.isArray(body && body.data) ? body.data : [];
        var names = results.map((r) => r && r.name).filter((nm) => nm);
        seriesName = smartTitleMatch(title, names);
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
    var e, tvFilePath, tvSeasonPath, usbLongPath, videoPath;
    tvSeasonPath = `${tvPath}${seriesName}/Season ${season}`;
    tvFilePath = `${tvSeasonPath}/${fname}`;
    videoPath = `files/${usbFilePath}`;
    var tvLocalDir = `${tvSeasonPath}/`;

    // usbPath is the folder containing the file on the USB host.
    // Example: "~/files/<torrent-folder>/"
    var usbDir = '';
    try {
      usbDir = path.dirname(usbFilePath);
    } catch (e) {
      usbDir = '';
    }
    if (usbDir === '.' || usbDir === '/') {
      usbDir = '';
    }
    var usbPath = usbDir ? (`~/files/${usbDir}/`) : '~/files/';
    
    if (SKIP_DOWNLOAD) {
      // Skip download mode: no-op in the new model.
      return process.nextTick(checkFile);
    }

    // Finished authority: tv-finished.json (do not create tv.json entries for already-finished).
    if (recent && recent[fname]) {
      existsCount++;
      return process.nextTick(checkFile);
    }

    // In-progress authority: tv-inProgress.json (do not create duplicate tv.json entries
    // for files already queued/downloading).
    if (inProgress && inProgress[fname]) {
      existsCount++;
      return process.nextTick(checkFile);
    }

    // tv.json authority: do not create duplicates for titles already queued.
    if (tvJsonTitles && tvJsonTitles[fname]) {
      existsCount++;
      return process.nextTick(checkFile);
    }

    mkdirp.sync(tvSeasonPath);
    // Create a new tv.json entry (tvJson.js will assign procId when a worker starts).
    try {
      tvJson.addEntry({
        usbPath: usbPath,
        localPath: tvLocalDir,
        title: fname,
        status: 'waiting',
        progress: 0,
        eta: null,
        speed: 0,
        sequence: currentSeq || 0,
        fileSize: usbFileBytes || 0,
        season: season || 0,
        episode: episode || 0,
        dateStarted: 0,
        dateEnded: null
      });

      // Update per-cycle view so later files in the same cycle don't re-queue.
      if (tvJsonTitles) {
        tvJsonTitles[fname] = {error: false};
      }
    } catch (e) {
      // keep going
    }

    return process.nextTick(checkFile);
  };

  badFile = (reason) => {
    errCount++;
    err('marking tv.json error:', {
      reason: reason || 'unknown',
      fname,
      title,
      season,
      episode,
      usbFilePath
    });
    try {
      var usbDir = '';
      try {
        usbDir = path.dirname(usbFilePath);
      } catch (e) {
        usbDir = '';
      }
      if (usbDir === '.' || usbDir === '/') usbDir = '';
      var usbPath = usbDir ? (`~/files/${usbDir}/`) : '~/files/';
      tvJson.markError({
        title: fname,
        usbPath: usbPath,
        reason: reason || 'unknown'
      });
    } catch (e) {}
    return process.nextTick(checkFile);
  };

}).call(this);
