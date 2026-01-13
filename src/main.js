(async function() {

  const MAX_WORKERS = 8;

  var FAST_TEST, PROCESS_INTERVAL_MS, appendTvLog, badFile, blocked, blockedCount, buffering, checkFile, checkFileExists, checkFiles, chkCount, chkTvDB, clearBuffer, currentSeq, cycleRunning, cycleSeq, dateStr, debug, delOldFiles, deleteCount, downloadCount, downloadTime, emby, episode, err, errCount, errors, escQuotes, exec, existsCount, fileTimeout, filterRegex, filterRegexTxt, findUsb, flushAndGoLive, flushBuffer, fname, fs, getUsbFiles, inProgress, lastPruneAt, log, logBuffer, map, mkdirp, path, readMap, recent, recentCount, reloadState, request, resetCycleState, rimraf, rsyncDelay, runCycle, scheduleNextCycle, season, seriesName, sizeStr, skipPaths, startBuffering, startTime, stopBuffering, theTvDbToken, time, title, tvDbErrCount, tvPath, tvdbCache, tvdburl, type, usbFilePath, usbFileSize, usbFiles, usbHost, util, writeLine, writeMap;

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
  var TV_INPROGRESS_PATH = dataPath('tv-inProgress.json');
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
      if (!fs.existsSync(TV_INPROGRESS_PATH)) {
        fs.writeFileSync(TV_INPROGRESS_PATH, '{}');
      }
    } catch (e) {
      // Non-fatal.
    }
  })();

  // tvJson.js owns tv.json cache and all worker lifecycle.
  var tvJson = require('./tvJson.js');

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
  // tv.json is backed by SharedArrayBuffer storage (tvJsonCache) and only
  // flushed to disk when:
  // - a new entry is added
  // - a worker posts "finished"
  // (No other writes.)
  var tvJsonCache = null;
  var tvShared = null;
  var nextProcId = 0;
  var workerCount = 0;

  // Shared storage sizing. procId is the index.
  var TV_CAPACITY = 10000;
  var USB_PATH_BYTES = 512;
  var LOCAL_PATH_BYTES = 512;
  var TITLE_BYTES = 256;
  var STATUS_BYTES = 256;

  var TextEncoder_ = global.TextEncoder || require('util').TextEncoder;
  var TextDecoder_ = global.TextDecoder || require('util').TextDecoder;
  var encoder = new TextEncoder_();
  var decoder = new TextDecoder_('utf-8');

  var allocShared = function(capacity) {
    var sab = {
      usbPath: new SharedArrayBuffer(capacity * USB_PATH_BYTES),
      localPath: new SharedArrayBuffer(capacity * LOCAL_PATH_BYTES),
      title: new SharedArrayBuffer(capacity * TITLE_BYTES),
      status: new SharedArrayBuffer(capacity * STATUS_BYTES),
      progress: new SharedArrayBuffer(capacity * Int32Array.BYTES_PER_ELEMENT),
      eta: new SharedArrayBuffer(capacity * Int32Array.BYTES_PER_ELEMENT),
      sequence: new SharedArrayBuffer(capacity * Int32Array.BYTES_PER_ELEMENT),
      season: new SharedArrayBuffer(capacity * Int32Array.BYTES_PER_ELEMENT),
      episode: new SharedArrayBuffer(capacity * Int32Array.BYTES_PER_ELEMENT),
      dateStarted: new SharedArrayBuffer(capacity * Int32Array.BYTES_PER_ELEMENT),
      dateEnded: new SharedArrayBuffer(capacity * Int32Array.BYTES_PER_ELEMENT),
      fileSize: new SharedArrayBuffer(capacity * BigInt64Array.BYTES_PER_ELEMENT)
    };

    return {
      capacity: capacity,
      sab: sab,
      usbPathBytes: new Uint8Array(sab.usbPath),
      localPathBytes: new Uint8Array(sab.localPath),
      titleBytes: new Uint8Array(sab.title),
      statusBytes: new Uint8Array(sab.status),
      progress: new Int32Array(sab.progress),
      eta: new Int32Array(sab.eta),
      sequence: new Int32Array(sab.sequence),
      season: new Int32Array(sab.season),
      episode: new Int32Array(sab.episode),
      dateStarted: new Int32Array(sab.dateStarted),
      dateEnded: new Int32Array(sab.dateEnded),
      fileSize: new BigInt64Array(sab.fileSize)
    };
  };

  var writeFixedString = function(bytesView, idx, stride, s) {
    var off = idx * stride;
    bytesView.fill(0, off, off + stride);
    if (!s) return;
    var b = encoder.encode(String(s));
    var n = Math.min(b.length, stride - 1);
    for (var i = 0; i < n; i++) {
      bytesView[off + i] = b[i];
    }
    bytesView[off + n] = 0;
  };

  var readFixedString = function(bytesView, idx, stride) {
    var off = idx * stride;
    var end = off;
    var max = off + stride;
    while (end < max && bytesView[end] !== 0) end++;
    if (end === off) return '';
    return decoder.decode(bytesView.subarray(off, end));
  };

  var getStatus = function(procId) {
    return readFixedString(tvShared.statusBytes, procId, STATUS_BYTES);
  };

  var setStatus = function(procId, s) {
    writeFixedString(tvShared.statusBytes, procId, STATUS_BYTES, s);
  };

  var materializeEntry = function(procId) {
    var etaVal = tvShared.eta[procId] || 0;
    var endedVal = tvShared.dateEnded[procId] || 0;
    return {
      procId: procId,
      usbPath: readFixedString(tvShared.usbPathBytes, procId, USB_PATH_BYTES),
      localPath: readFixedString(tvShared.localPathBytes, procId, LOCAL_PATH_BYTES),
      title: readFixedString(tvShared.titleBytes, procId, TITLE_BYTES),
      status: getStatus(procId) || 'waiting',
      progress: tvShared.progress[procId] || 0,
      eta: etaVal ? etaVal : null,
      sequence: tvShared.sequence[procId] || 0,
      fileSize: Number(tvShared.fileSize[procId] || 0n),
      season: tvShared.season[procId] || 0,
      episode: tvShared.episode[procId] || 0,
      dateStarted: tvShared.dateStarted[procId] || 0,
      dateEnded: endedVal ? endedVal : null
    };
  };

  var snapshotTvJson = function() {
    var out = [];
    for (var i = 0; i < nextProcId; i++) {
      out.push(materializeEntry(i));
    }
    return out;
  };

  var flushTvJsonToDisk = function() {
    try {
      var arr = snapshotTvJson();
      var dir = path.dirname(TV_JSON_PATH);
      var tmp = path.join(dir, '.' + path.basename(TV_JSON_PATH) + '.tmp.' + process.pid + '.' + Date.now());
      fs.writeFileSync(tmp, JSON.stringify(arr));
      fs.renameSync(tmp, TV_JSON_PATH);
    } catch (e) {}
  };

  var initTvJsonCache = function() {
    var arr = [];
    try {
      if (fs.existsSync(TV_JSON_PATH)) {
        var raw = fs.readFileSync(TV_JSON_PATH, 'utf8');
        var v = JSON.parse(raw);
        if (Array.isArray(v)) arr = v;
      }
    } catch (e) {
      arr = [];
    }

    // nextProcId is last procId + 1; if empty array, start at 0.
    var maxId = -1;
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i];
      if (!o || typeof o !== 'object') continue;
      var pid = (typeof o.procId === 'number' && Number.isInteger(o.procId)) ? o.procId : null;
      if (pid != null && pid > maxId) maxId = pid;
    }
    nextProcId = maxId >= 0 ? (maxId + 1) : 0;

    var cap = Math.max(TV_CAPACITY, nextProcId + 16);
    tvShared = allocShared(cap);
    tvJsonCache = {shared: tvShared};

    // Load existing entries if present.
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i];
      if (!o || typeof o !== 'object') continue;
      var pid = (typeof o.procId === 'number' && Number.isInteger(o.procId)) ? o.procId : null;
      if (pid == null || pid < 0 || pid >= tvShared.capacity) continue;

      writeFixedString(tvShared.usbPathBytes, pid, USB_PATH_BYTES, o.usbPath || '');
      writeFixedString(tvShared.localPathBytes, pid, LOCAL_PATH_BYTES, o.localPath || '');
      writeFixedString(tvShared.titleBytes, pid, TITLE_BYTES, o.title || '');
      setStatus(pid, (o.status === 'future' ? 'waiting' : (o.status || 'waiting')));

      tvShared.progress[pid] = (typeof o.progress === 'number' && Number.isFinite(o.progress)) ? Math.floor(o.progress) : 0;
      tvShared.eta[pid] = (typeof o.eta === 'number' && Number.isFinite(o.eta)) ? Math.floor(o.eta) : 0;
      tvShared.sequence[pid] = (typeof o.sequence === 'number' && Number.isFinite(o.sequence)) ? Math.floor(o.sequence) : 0;
      tvShared.season[pid] = (typeof o.season === 'number' && Number.isFinite(o.season)) ? Math.floor(o.season) : 0;
      tvShared.episode[pid] = (typeof o.episode === 'number' && Number.isFinite(o.episode)) ? Math.floor(o.episode) : 0;
      tvShared.dateStarted[pid] = (typeof o.dateStarted === 'number' && Number.isFinite(o.dateStarted)) ? Math.floor(o.dateStarted) : 0;
      tvShared.dateEnded[pid] = (typeof o.dateEnded === 'number' && Number.isFinite(o.dateEnded)) ? Math.floor(o.dateEnded) : 0;
      tvShared.fileSize[pid] = (typeof o.fileSize === 'number' && Number.isFinite(o.fileSize)) ? BigInt(Math.floor(o.fileSize)) : 0n;
    }

    // Per spec: reset any downloading entries to waiting on load.
    for (var pid = 0; pid < nextProcId; pid++) {
      var st = getStatus(pid);
      if (st === 'downloading') {
        setStatus(pid, 'waiting');
        tvShared.progress[pid] = 0;
        tvShared.eta[pid] = 0;
      }
    }
  };

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
          n.status = 'waiting';
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
          if (s === 'waiting') return 1;
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
          if (s === 'waiting') return 1;
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

  // Initialize shared tvJsonCache from disk (tv.json may be empty).
  // (disabled) SharedArrayBuffer tv.json cache is no longer used.
  // tvJson.js owns tv.json state and worker lifecycle.
  // initTvJsonCache();

  // Keep these functions as no-ops for compatibility
  startBuffering = function() {};
  stopBuffering = function() {};
  clearBuffer = function() {};
  flushBuffer = function() {};
  flushAndGoLive = function() {};

  // ---------------------------------------------------------------------------
  var childProcess = require('child_process');
  exec = childProcess.execSync;

  var workerThreads = require('worker_threads');
  var Worker = workerThreads.Worker;

  mkdirp = require('mkdirp');

  request = require('request');

  rimraf = require('rimraf');

  // Replace guessit with npm module parse-torrent-title
  var parseTorrentTitle = require('parse-torrent-title').parse;

  // --- worker_threads model -------------------------------------------------
  var WORKER_SCRIPT = path.join(__dirname, 'worker.js');

  var findOldestFutureProcId = function() {
    for (var pid = 0; pid < nextProcId; pid++) {
      if (getStatus(pid) === 'waiting') {
        return pid;
      }
    }
    return null;
  };

  var startWorkerForProcId = function(procId) {
    if (procId == null) return;
    if (workerCount >= MAX_WORKERS) return;
    if (!(procId >= 0 && procId < nextProcId)) return;

    // Mark downloading in shared memory.
    setStatus(procId, 'downloading');
    tvShared.progress[procId] = 0;
    tvShared.eta[procId] = 0;
    tvShared.dateEnded[procId] = 0;

    workerCount++;
    var finished = false;

    var w = new Worker(WORKER_SCRIPT, {
      workerData: {
        procId: procId,
        usbHost: usbHost,
        capacity: tvShared.capacity,
        sizes: {
          USB_PATH_BYTES: USB_PATH_BYTES,
          LOCAL_PATH_BYTES: LOCAL_PATH_BYTES,
          TITLE_BYTES: TITLE_BYTES,
          STATUS_BYTES: STATUS_BYTES
        },
        sab: tvShared.sab
      }
    });

    var handleFinish = function(finishedProcId) {
      try {
        if (!(finishedProcId >= 0 && finishedProcId < nextProcId)) {
          return;
        }

        var entry = materializeEntry(finishedProcId);
        var title1 = (entry && entry.title) ? String(entry.title) : '';
        var status1 = (entry && entry.status) ? String(entry.status) : '';
        if (!title1) {
          return;
        }

        // Timestamp value is stored as ms; writeMap() will convert to YYYY/MM/DD-HH:MM:SS.
        var ts = Date.now();

        if (status1 === 'finished') {
          if (recent) {
            recent[title1] = ts;
          }
          return;
        }

        // Any non-finished terminal status is treated as an error message.
        if (status1 && status1 !== 'downloading' && status1 !== 'waiting') {
          try {
            appendTvLog(`${dateStr(ts)} ERROR ${title1}: ${status1}\n`);
          } catch (e) {}
          if (errors) {
            errors[title1] = ts;
          }
        }
      } catch (e) {
        // non-fatal
      }
    };

    var onFinished = function(finishedProcId) {
      if (finished) return;
      finished = true;
      workerCount = Math.max(0, workerCount - 1);

      // Update tv-finished.json for this procId.
      handleFinish(finishedProcId != null ? finishedProcId : procId);

      // On finished, if there is capacity start the oldest waiting entry.
      if (workerCount < MAX_WORKERS) {
        var nextPid = findOldestFutureProcId();
        if (nextPid != null) {
          startWorkerForProcId(nextPid);
        }
      }

      // Flush tv.json after finished message received.
      flushTvJsonToDisk();
    };

    w.on('message', function(msg) {
      if (msg === 'finished') {
        // Legacy form
        onFinished(procId);
        return;
      }
      if (msg && typeof msg === 'object' && msg.type === 'finished') {
        onFinished(typeof msg.procId === 'number' ? msg.procId : procId);
      }
    });
    w.on('error', function() {
      onFinished(procId);
    });
    w.on('exit', function() {
      // If worker exited without sending "finished", still clean up.
      onFinished(procId);
    });
  };

  // --- startProc server state ------------------------------------------------
  var abortBetweenFiles = false;
  var nextCycleTimer = null;

  // (priority scheduling removed in the new worker_threads + procId model)

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

    var startProc = function() {
      // When startProc is called do the same as before when arg was blank:
      // - if a cycle is running, restart after the current file finishes
      // - if nothing is running, start a new cycle immediately
      if (cycleRunning) {
        abortBetweenFiles = true;
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
              // Accept body for backwards compatibility, but ignore any args.
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

      // No matching endpoint
      return json(res, 404, {status: 'not found'});
    }).listen(3003, '0.0.0.0');
  })();

  findUsb = `ssh ${usbHost} \"find files -ignore_readdir_race -type f -printf '%CY-%Cm-%Cd-%P-%s\\\\n' 2>/dev/null\" ` + "| grep -Ev .r[0-9]+-[0-9]+$ | grep -Ev .rar-[0-9]+$ " + "| grep -Ev screen[0-9]+.png-[0-9]+$";

  if (filterRegex) {
    findUsb += " | grep -i " + filterRegex;
  }

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

  //##########
  // constants
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
      try {
        // Do not block the cycle on pruning: run remotely in background.
        // Suppress all output to keep pm2 logs clean.
        exec(
          `ssh ${usbHost} "nohup find ~/files -mtime +${PRUNE_DAYS} -exec rm -rf {} \\; >/dev/null 2>&1 &"`,
          {
            timeout: 30000
          }
        );
        res = 'prune ok';
      } catch (e) {
        // Non-fatal; continue cycle even if prune fails.
        res = 'prune ok';
      }

      // After the hourly USB prune command is kicked off, prune tv.json entries whose USB folder no longer exists.
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
        tvJson.pruneMissingUsbDirs(set);
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
    // Backed by SQLite (tvJson.js); do not read data/tv.json.
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

    // No tv.json pre-population in the new model.
    // Entries are created only when a file is ready to be queued/downloaded.

    // if filterRegex
    //   log usbFiles.join('\n')
    return process.nextTick(checkFile);
  };

  checkFile = () => {
    var blkName, cmd, fext, guessItRes, j, len, parts, skipPath, usbLine, usbLineParts;
    tvDbErrCount = 0;

    // If a startProc request came in while processing, finish the current file,
    // then restart the cycle immediately.
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

      // In the new model, workers are started only when entries are added
      // and when a worker posts "finished".
      return scheduleNextCycle();
    }
  };

  tvdbCache = {};

  tvdburl = '';

  chkTvDB = () => {
    // Normalization helpers for matching TheTVDB search results to parse-torrent-title output.
    // Basic normalization:
    // 1) lowercase 2) trim 3) collapse whitespace
    var normalizeBasic = function(s) {
      return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    };

    // Aggressive normalization:
    // 1) drop "(" and everything after
    // 2) lowercase
    // 3) replace periods with spaces
    // 4) remove non-alphanumeric except whitespace
    // 5) trim
    // 6) collapse whitespace
    var normalizeAggressive = function(s) {
      s = String(s || '');
      var idx = s.indexOf('(');
      if (idx >= 0) {
        s = s.slice(0, idx);
      }
      s = s.toLowerCase();
      s = s.replace(/\./g, ' ');
      s = s.replace(/[^a-z0-9\s]/g, ' ');
      s = s.trim().replace(/\s+/g, ' ');
      return s;
    };

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
        var chosenName = null;
        var normTitleBasic = normalizeBasic(title);
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var nm = r && r.name;
          if (!nm) continue;
          if (normalizeBasic(nm) === normTitleBasic) {
            chosenName = nm;
            break;
          }
        }
        if (!chosenName) {
          var normTitleAgg = normalizeAggressive(title);
          for (var j = 0; j < results.length; j++) {
            var r2 = results[j];
            var nm2 = r2 && r2.name;
            if (!nm2) continue;
            if (normalizeAggressive(nm2) === normTitleAgg) {
              chosenName = nm2;
              break;
            }
          }
        }
        if (!chosenName && results[0] && results[0].name) {
          chosenName = results[0].name;
        }
        seriesName = chosenName;
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
