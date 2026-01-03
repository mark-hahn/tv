(async function() {

  const MAX_WORKERS = 4;

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
  // tv-finished.json is authority for which torrents are finished
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

  // tv.log lives under misc/ (BASEDIR/misc/tv.log)
  var TV_LOG_PATH = path.join(BASEDIR, 'misc', 'tv.log');
  var TV_JSON_PATH = dataPath('tv.json');
  var TV_FINISHED_PATH = dataPath('tv-finished.json');
  var TV_ERRORS_PATH = dataPath('tv-errors.json');
  var TV_BLOCKED_PATH = dataPath('tv-blocked.json');
  var TV_MAP_PATH = dataPath('tv-map');
  var SCAN_LIBRARY_FLAG_PATH = dataPath('scanLibraryFlag');

  try {
    fs.mkdirpSync(path.dirname(TV_LOG_PATH));
  } catch (e) {}

  appendTvLog = function(line) {
    try {
      return fs.appendFileSync(TV_LOG_PATH, line);
    } catch (error1) {

    }
  };

  // One-time migration: rename legacy tv-recent.json to tv-finished.json.
  (function migrateRecentToFinished() {
    try {
      var oldPath = dataPath('tv-recent.json');
      if (fs.existsSync(oldPath) && !fs.existsSync(TV_FINISHED_PATH)) {
        fs.renameSync(oldPath, TV_FINISHED_PATH);
      }
      if (!fs.existsSync(TV_FINISHED_PATH)) {
        fs.writeFileSync(TV_FINISHED_PATH, '{}');
      }
    } catch (e) {
      // Non-fatal.
    }
  })();

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

      appendTvLog(`${prefix}==== tv-proc started ${fmt()} ====\n`);
    } catch (e) {}
  })();

  // --- tv.json status tracking ----------------------------------------------
  // tv.json is an array of file objects.
  // Each update rewrites the entire file and prunes entries older than 1 month.
  var tvJsonCache = {mtimeMs: null, arr: null}; // mtime-aware cache (workers may write)
  var clearedDownloadingOnBoot = false;

  var unixNow = function() {
    return Math.floor(Date.now() / 1000);
  };

  // --- worker pool ---------------------------------------------------------

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
    // mtime-aware cache: workers may update tv.json in other processes.
    try {
      if (!fs.existsSync(TV_JSON_PATH)) {
        tvJsonCache = {mtimeMs: null, arr: []};
        return [];
      }

      try {
        var st0 = fs.statSync(TV_JSON_PATH);
        if (tvJsonCache && tvJsonCache.arr && tvJsonCache.mtimeMs != null && st0 && st0.mtimeMs === tvJsonCache.mtimeMs) {
          return tvJsonCache.arr;
        }
      } catch (e) {}

      var raw = fs.readFileSync(TV_JSON_PATH, 'utf8');
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) {
        tvJsonCache = {mtimeMs: null, arr: []};
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

        // fileSize must be integer bytes (do not infer from disk; tv.json is authority).
        var fileSizeBytes = null;
        if (typeof prevFileSize === 'number' && Number.isFinite(prevFileSize)) {
          fileSizeBytes = prevFileSize;
        } else if (typeof prevFileSize === 'string' && /^\d+$/.test(prevFileSize)) {
          fileSizeBytes = parseInt(prevFileSize, 10);
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

        // Multi-worker fields.
        // worker should always exist (null when idle) and should be cleared on boot.
        if (!Object.prototype.hasOwnProperty.call(n, 'worker')) {
          n.worker = null;
          changed = true;
        } else if (n.worker != null) {
          n.worker = null;
          changed = true;
        }
        if (!(typeof n.priority === 'number' && Number.isFinite(n.priority))) {
          n.priority = 0;
          changed = true;
        }

        // If we crashed mid-download, clear downloading state once on boot.
        if (!clearedDownloadingOnBoot && n.status === 'downloading') {
          n.status = 'future';
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
        }
      })();

      out = pruneOldTvJson(out);
      if (changed) {
        writeTvJson(out);
      }
      clearedDownloadingOnBoot = true;
      var st1 = null;
      try { st1 = fs.statSync(TV_JSON_PATH); } catch (e) {}
      tvJsonCache = {mtimeMs: st1 && st1.mtimeMs != null ? st1.mtimeMs : null, arr: out};
      return out;
    } catch (e) {
      tvJsonCache = {mtimeMs: null, arr: []};
      clearedDownloadingOnBoot = true;
      return [];
    }
  };

  var writeTvJson = function(arr) {
    try {
      var dir = path.dirname(TV_JSON_PATH);
      var tmp = path.join(dir, '.' + path.basename(TV_JSON_PATH) + '.tmp.' + process.pid + '.' + Date.now());
      fs.writeFileSync(tmp, JSON.stringify(arr));
      fs.renameSync(tmp, TV_JSON_PATH);
      var st = null;
      try { st = fs.statSync(TV_JSON_PATH); } catch (e) {}
      tvJsonCache = {mtimeMs: st && st.mtimeMs != null ? st.mtimeMs : null, arr: arr};
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
    var tries = 0;
    while (tries++ < 12) {
      var baseRaw = '[]';
      try {
        if (fs.existsSync(TV_JSON_PATH)) {
          baseRaw = fs.readFileSync(TV_JSON_PATH, 'utf8');
        }
      } catch (e) {
        baseRaw = '[]';
      }

      var arr = [];
      try {
        arr = JSON.parse(baseRaw);
        if (!Array.isArray(arr)) {
          arr = [];
        }
      } catch (e) {
        arr = [];
      }

      arr = pruneOldTvJson(arr);

      var idx = arr.findIndex((o) => o && o.localPath === localPath && o.title === title1);
      var isNewItem = idx < 0;
      var isFinished = patch && patch.status === 'finished';

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

        // no logging
      }

      // Update cache immediately (mtime unknown until next stat).
      tvJsonCache = {mtimeMs: null, arr: arr};

      // Persist changes that matter to scheduling/ownership.
      var needsWrite = isNewItem || isFinished || (patch && (patch.worker != null || patch.priority != null));
      if (!needsWrite) {
        return;
      }

      // Best-effort CAS: if someone else wrote tv.json since our read, retry.
      var nowRaw = '[]';
      try {
        if (fs.existsSync(TV_JSON_PATH)) {
          nowRaw = fs.readFileSync(TV_JSON_PATH, 'utf8');
        }
      } catch (e) {
        nowRaw = '[]';
      }
      if (nowRaw !== baseRaw) {
        continue;
      }

      writeTvJson(arr);
      return;
    }

    // Give up silently; keep service alive.
    // IMPORTANT: do NOT write anything here.
    // Under high write contention (workers updating progress), CAS retries can fail.
    // Writing an empty/stale cache would clobber the authoritative on-disk tv.json.
    try {
      if (fs.existsSync(TV_JSON_PATH)) {
        var raw = fs.readFileSync(TV_JSON_PATH, 'utf8');
        var latest = JSON.parse(raw);
        if (Array.isArray(latest)) {
          tvJsonCache = {mtimeMs: null, arr: latest};
        }
      }
    } catch (e) {}
    return;
  };

  // Trigger one-time normalization/migration at startup.
  readTvJson();

  // Keep these functions as no-ops for compatibility
  startBuffering = function() {};
  stopBuffering = function() {};
  clearBuffer = function() {};
  flushBuffer = function() {};
  flushAndGoLive = function() {};

  // ---------------------------------------------------------------------------
  var childProcess = require('child_process');
  exec = childProcess.execSync;
  var fork = childProcess.fork;

  mkdirp = require('mkdirp');

  request = require('request');

  rimraf = require('rimraf');

  // Replace guessit with npm module parse-torrent-title
  var parseTorrentTitle = require('parse-torrent-title').parse;

  // --- worker pool ---------------------------------------------------------
  var WORKER_SCRIPT = path.join(__dirname, 'worker.js');
  var workers = []; // [{id, proc, busy}]
  var pendingJobs = []; // [{key, job}]

  // Log sequencing (monotonic since startup) and per-cycle start separator.
  var nextDownloadLogSeq = 1;
  var currentCycleId = 0;
  var cycleSeparatorLogged = {}; // { [cycleId:number]: true }

  var appendCycleSeparatorIfNeeded = function(cycleId) {
    try {
      if (!cycleId) return;
      if (cycleSeparatorLogged[cycleId]) return;
      cycleSeparatorLogged[cycleId] = true;

      // Blank line before separator.
      var prefix = '';
      try {
        if (fs.existsSync(TV_LOG_PATH)) {
          var st = fs.statSync(TV_LOG_PATH);
          if (st && st.size > 0) prefix = '\n';
        }
      } catch (e) {}

      appendTvLog(prefix + '======================================================\n');
    } catch (e) {}
  };

  // If /startProc?title=... is received but the matching job isn't runnable yet,
  // keep it around until we successfully apply its priority to a tv.json entry.
  // (Priority is persisted in tv.json; this is only for "remember until available".)
  var pendingStartProcPriority = 0;

  var jobKey = function(localDir, fname) {
    return localDir + '\u0000' + fname;
  };

  var enqueueJob = function(job) {
    // Avoid duplicate concurrent downloads: use tv.json worker/status as the authority.
    try {
      var arr = readTvJson();
      for (var ai = 0; ai < arr.length; ai++) {
        var o = arr[ai];
        if (!o || o.title !== job.fname) continue;
        if (o.worker != null || o.status === 'downloading') {
          return;
        }
      }
    } catch (e) {}

    var key = jobKey(job.tvLocalDir, job.fname);
    for (var i = 0; i < pendingJobs.length; i++) {
      if (pendingJobs[i] && pendingJobs[i].key === key) {
        return;
      }
    }
    pendingJobs.push({key: key, job: job});
  };

  var getPriorityForJob = function(job) {
    try {
      var arr = readTvJson();
      var best = 0;
      for (var i = 0; i < arr.length; i++) {
        var o = arr[i];
        if (!o || o.title !== job.fname) continue;
        var pri = (typeof o.priority === 'number' && Number.isFinite(o.priority)) ? o.priority : 0;
        if (o.localPath === job.tvLocalDir) {
          return pri;
        }
        if (pri > best) {
          best = pri;
        }
      }
      return best;
    } catch (e) {}
    return 0;
  };

  var pickNextJobIndex = function() {
    if (!pendingJobs.length) return -1;
    var bestIdx = 0;
    var bestPri = -Infinity;
    for (var i = 0; i < pendingJobs.length; i++) {
      var pj = pendingJobs[i];
      if (!pj || !pj.job) continue;
      var pri = getPriorityForJob(pj.job);
      if (pri > bestPri) {
        bestPri = pri;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  var assignWork = function() {
    // Fill any available worker slots.
    for (var wi = 0; wi < workers.length; wi++) {
      var w = workers[wi];
      if (!w || w.busy) continue;
      if (!pendingJobs.length) return;

      var idx = pickNextJobIndex();
      if (idx < 0) return;
      var item = pendingJobs.splice(idx, 1)[0];
      if (!item || !item.job) continue;

      // Reserve the entry for this worker in tv.json.
      try {
        upsertTvJson(item.job.tvLocalDir, item.job.fname, {
          worker: w.id
        });
      } catch (e) {}

      // Assign a monotonic per-download log sequence at the moment the download starts.
      try {
        if (item.job && item.job.logSeq == null) {
          item.job.logSeq = nextDownloadLogSeq++;
        }
      } catch (e) {}

      // When a cycle starts its first download, write the separator before any
      // worker log lines for that download.
      try {
        appendCycleSeparatorIfNeeded(item.job && item.job.cycleId);
      } catch (e) {}

      try {
        w.busy = true;
        w.proc.send({type: 'start', worker: w.id, job: item.job});
      } catch (e) {
        w.busy = false;
        // Put job back and keep going.
        pendingJobs.unshift(item);
      }
    }
  };

  var startWorkers = function() {
    var hasId = function(id) {
      for (var j = 0; j < workers.length; j++) {
        if (workers[j] && workers[j].id === id) return true;
      }
      return false;
    };
    for (var i = 1; i <= MAX_WORKERS; i++) {
      if (hasId(i)) {
        continue;
      }
      try {
        var p = fork(WORKER_SCRIPT, [], {stdio: ['inherit', 'inherit', 'inherit', 'ipc']});
        var w = {id: i, proc: p, busy: false};
        workers.push(w);

        p.on('message', (function(wref) {
          return function(msg) {
            try {
              if (!msg || typeof msg !== 'object') return;
              if (msg.type === 'ready') {
                // worker is idle/online
                wref.busy = false;
                assignWork();
                return;
              }
              if (msg.type === 'done') {
                wref.busy = false;
                // If worker finished successfully, record in tv-finished.json (authority).
                if (msg.kind === 'finished' && msg.title) {
                  try {
                    recent[msg.title] = Date.now();
                    writeMap(TV_FINISHED_PATH, recent);
                  } catch (e) {}
                }
                assignWork();
                return;
              }
            } catch (e) {}
          };
        })(w));

        p.on('exit', (function(wref) {
          return function() {
            wref.busy = false;
            // Best-effort respawn on crash.
            try {
              workers = workers.filter((x) => x && x.id !== wref.id);
            } catch (e) {}
            try {
              setTimeout(startWorkers, 2000);
            } catch (e) {}
          };
        })(w));
      } catch (e) {
        // If a worker can't start, keep service alive.
      }
    }
  };

  // --- startProc server state ------------------------------------------------
  var pendingStartProcTitle = null;
  var abortBetweenFiles = false;
  var nextCycleTimer = null;

  var boostPriorityForNeedle = function(needleLower, priorityValue) {
    try {
      if (!needleLower || !priorityValue) return false;
      var arr = readTvJson();
      var best = null;
      var bestScore = null;
      for (var i = 0; i < arr.length; i++) {
        var o = arr[i];
        if (!o || typeof o !== 'object') continue;
        var t = (typeof o.title === 'string') ? o.title : '';
        if (!t) continue;
        if (!t.toLowerCase().includes(needleLower)) continue;
        if (o.status === 'finished') continue;
        if (o.worker != null || o.status === 'downloading') continue;
        var seq = (typeof o.sequence === 'number' && Number.isFinite(o.sequence)) ? o.sequence : 0;
        var ended = toUnixSeconds(o.dateEnded) || 0;
        var started = toUnixSeconds(o.dateStarted) || 0;
        var recency = Math.max(ended, started);
        var score = [seq, recency];
        if (!bestScore) {
          bestScore = score;
          best = o;
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
          best = o;
        }
      }

      if (best && best.localPath && best.title) {
        upsertTvJson(best.localPath, best.title, {priority: priorityValue});
        return true;
      }
    } catch (e) {}
    return false;
  };

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

    // New cycle id (monotonic since startup). Used only for logging separator.
    try {
      currentCycleId++;
    } catch (e) {
      currentCycleId = (currentCycleId || 0) + 1;
    }

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

      // Capture request-time priority (persisted to tv.json when applied).
      pendingStartProcPriority = pendingStartProcTitle ? unixNow() : 0;

      // If jobs already exist in tv.json (e.g. pending queue while all workers are busy),
      // boost priority immediately so the next available worker picks it.
      if (pendingStartProcTitle) {
        try {
          var needleLower = pendingStartProcTitle.toLowerCase();
          var appliedNow = boostPriorityForNeedle(needleLower, pendingStartProcPriority);
          if (appliedNow) {
            // Priority is now persisted; keep the title for this cycle ordering only.
          }
        } catch (e) {}
        try {
          assignWork();
        } catch (e) {}
      }
      
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
    recent = readMap(TV_FINISHED_PATH);
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

  // Start rsync worker pool.
  startWorkers();

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
  // delete old files in usb/files
  delOldFiles = () => {
    var PRUNE_DAYS, PRUNE_INTERVAL_MS, res;
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

    // If startProc requested a title, process a matching file first (if any)
    // and boost its tv.json priority.
    var wantedNeedle = null;
    var wantedPriority = 0;
    var wantedApplied = false;
    if (pendingStartProcTitle) {
      wantedNeedle = pendingStartProcTitle.toLowerCase();
      wantedPriority = pendingStartProcPriority || 0;
      var idx = usbFiles.findIndex((x) => x.base.toLowerCase().includes(wantedNeedle));
      if (idx >= 0) {
        var match = usbFiles.splice(idx, 1)[0];
        usbFiles.unshift(match);
      }
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
      
      // Create "future" entry in tv.json.
      // IMPORTANT: do not overwrite an existing priority with 0; priority is persistent.
      var futPatch = {
        status: 'future',
        sequence: futureSeq,
        fileSize: futFileBytes,
        season: futSeason,
        episode: futEpisode,
        speed: null,
        worker: null
      };
      if (wantedNeedle && !wantedApplied && futFname.toLowerCase().includes(wantedNeedle)) {
        futPatch.priority = wantedPriority || unixNow();
        wantedApplied = true;
      }
      upsertTvJson(futTvLocalDir, futFname, futPatch);
    }

    // Only clear the pending title when we actually applied its priority.
    // Otherwise keep it around for a later cycle / when the matching file appears.
    if (wantedApplied) {
      pendingStartProcTitle = null;
      pendingStartProcPriority = 0;
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
          writeMap(TV_FINISHED_PATH, recent);
          // fs.writeFileSync 'tv-finished.json', JSON.stringify recent
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
      // (logging moved to workers)
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

      // In multi-worker mode, the cycle only enqueues work; workers run concurrently.
      // Kick assignment once more and wait until the next scheduled interval.
      try { assignWork(); } catch (e) {}
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
    var e, tvFilePath, tvSeasonPath, usbLongPath, videoPath;
    tvSeasonPath = `${tvPath}${seriesName}/Season ${season}`;
    tvFilePath = `${tvSeasonPath}/${fname}`;
    videoPath = `files/${usbFilePath}`;
    usbLongPath = `${usbHost}:${videoPath}`;

    var tvLocalDir = `${tvSeasonPath}/`;
    
    if (SKIP_DOWNLOAD) {
      // Skip download mode: just mark as finished and add to recent list
      console.log(`[SKIP_DOWNLOAD] Marking as finished without downloading: ${fname}`);
      
      upsertTvJson(tvLocalDir, fname, {
        status: 'finished',
        progress: 100,
        eta: null,
        sequence: currentSeq,
        fileSize: usbFileBytes,
        season,
        episode,
        worker: null,
        dateStarted: unixNow(),
        dateEnded: unixNow()
      });
      
      downloadCount++;
      recent[fname] = Date.now();
      writeMap(TV_FINISHED_PATH, recent);
      return process.nextTick(checkFile);
    }

    // Finished authority: tv-finished.json (do not infer from disk).
    if (recent && recent[fname]) {
      existsCount++;
      upsertTvJson(tvLocalDir, fname, {
        status: 'finished',
        progress: 100,
        eta: null,
        sequence: currentSeq,
        fileSize: usbFileBytes,
        season,
        episode,
        worker: null,
        dateEnded: unixNow()
      });
      return process.nextTick(checkFile);
    }

    mkdirp.sync(tvSeasonPath);
    // (logging moved to workers)

    // Ensure a tv.json entry exists (future) and queue work for a worker.
    upsertTvJson(tvLocalDir, fname, {
      status: 'future',
      sequence: currentSeq,
      fileSize: usbFileBytes,
      season,
      episode,
      worker: null
    });

    enqueueJob({
      usbLongPath: usbLongPath,
      tvFilePath: tvFilePath,
      tvLocalDir: tvLocalDir,
      fname: fname,
      seriesName: seriesName,
      fileSizeBytes: usbFileBytes,
      season: season,
      episode: episode,
      sequence: currentSeq,
      cycleId: currentCycleId
    });

    assignWork();
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
