(function() {
  'use strict';

  var fs = require('fs');
  var path = require('path');
  var spawn = require('child_process').spawn;

  var BASEDIR = path.join(__dirname, '..');
  var DATA_DIR = path.join(BASEDIR, 'data');
  var TV_JSON_PATH = path.join(DATA_DIR, 'tv.json');
  var TV_LOG_PATH = path.join(BASEDIR, 'misc', 'tv.log');

  var appendTvLog = function(line) {
    try {
      fs.appendFileSync(TV_LOG_PATH, line);
    } catch (e) {
      // best-effort only
    }
  };

  var formatLaTimestamp = function(d) {
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
      var parts = dtf.formatToParts(d);
      var m = {};
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p && p.type && p.value) m[p.type] = p.value;
      }
      return m.year + '/' + m.month + '/' + m.day + ' ' + m.hour + ':' + m.minute + ':' + m.second;
    } catch (e) {
      var yy = String(d.getFullYear() % 100).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      var hh = String(d.getHours()).padStart(2, '0');
      var mi = String(d.getMinutes()).padStart(2, '0');
      var ss = String(d.getSeconds()).padStart(2, '0');
      return yy + '/' + mm + '/' + dd + ' ' + hh + ':' + mi + ':' + ss;
    }
  };

  var pad2 = function(n) {
    var v = (typeof n === 'number' && Number.isFinite(n)) ? String(Math.floor(n)) : String(n || '0');
    return v.padStart(2, '0');
  };

  var formatDurationMmSs = function(totalSeconds) {
    if (!(typeof totalSeconds === 'number' && Number.isFinite(totalSeconds) && totalSeconds >= 0)) return '--:--';
    var s = Math.floor(totalSeconds);
    var mm = Math.floor(s / 60);
    var ss = s % 60;
    return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  };

  var formatGb = function(bytes) {
    if (!(typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0)) return '0.000 GB';
    return (bytes / 1e9).toFixed(3) + ' GB';
  };

  var logWorkerGroup = function(workerId, whenDate, season, episode, seriesName, fileSizeBytes, durationSeconds, errorText) {
    try {
      var wid = String(workerId);
      var ts = formatLaTimestamp(whenDate);
      var se = 'S' + pad2(season) + 'E' + pad2(episode);
      var name = (seriesName || '').trim();
      var line1 = '[' + wid + '] ' + ts + ' ' + se + (name ? (' ' + name) : '');

      var sizeStr = formatGb(fileSizeBytes);
      var durStr = formatDurationMmSs(durationSeconds);
      var line2 = '    ' + sizeStr + ' ' + durStr;
      if (errorText) {
        line2 += ' ' + String(errorText).trim();
      }

      appendTvLog(line1 + '\n' + line2 + '\n\n');
    } catch (e) {
      // best-effort only
    }
  };

  var unixNow = function() {
    return Math.floor(Date.now() / 1000);
  };

  var readFileUtf8Safe = function(p) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (e) {
      return null;
    }
  };

  var parseJsonArraySafe = function(raw) {
    try {
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  };

  var atomicWriteFileSync = function(targetPath, contents) {
    var dir = path.dirname(targetPath);
    var tmp = path.join(dir, '.' + path.basename(targetPath) + '.tmp.' + process.pid + '.' + Date.now());
    fs.writeFileSync(tmp, contents);
    fs.renameSync(tmp, targetPath);
  };

  // Best-effort CAS-ish patching to reduce multi-writer clobbering.
  // Not a perfect lock, but avoids overwriting when we detect the file changed
  // during our patch computation.
  var patchTvJson = function(localPath, title, patch, opts) {
    opts = opts || {};
    var createIfMissing = !!opts.createIfMissing;
    var tries = 0;
    while (tries++ < 12) {
      var baseRaw = readFileUtf8Safe(TV_JSON_PATH);
      var baseArr = parseJsonArraySafe(baseRaw || '[]');

      var idx = baseArr.findIndex(function(o) {
        return o && o.localPath === localPath && o.title === title;
      });

      if (idx < 0) {
        if (!createIfMissing) {
          return false;
        }
        baseArr.push(Object.assign({localPath: localPath, title: title}, patch));
      } else {
        baseArr[idx] = Object.assign({}, baseArr[idx], patch);
      }

      // Re-read and ensure no one changed the file since our initial read.
      var nowRaw = readFileUtf8Safe(TV_JSON_PATH);
      if ((nowRaw || '') !== (baseRaw || '')) {
        continue;
      }

      try {
        atomicWriteFileSync(TV_JSON_PATH, JSON.stringify(baseArr));
      } catch (e) {
        // If writing failed, retry a couple times.
        continue;
      }

      // Verify our patch stuck; if not, retry.
      try {
        var verifyArr = parseJsonArraySafe(readFileUtf8Safe(TV_JSON_PATH) || '[]');
        var vIdx = verifyArr.findIndex(function(o) {
          return o && o.localPath === localPath && o.title === title;
        });
        if (vIdx >= 0) {
          return true;
        }
      } catch (e) {}
    }
    return false;
  };

  var parseEtaSeconds = function(chunk) {
    // rsync progress2 shows remaining time as MM:SS or HH:MM:SS
    var m = chunk.match(/(\d+):(\d+)(?::(\d+))?/);
    if (!m) return null;
    if (m[3] !== undefined) {
      var hh = parseInt(m[1], 10);
      var mm = parseInt(m[2], 10);
      var ss = parseInt(m[3], 10);
      if ([hh, mm, ss].some(function(x) { return !Number.isFinite(x); })) return null;
      return hh * 3600 + mm * 60 + ss;
    }
    var mm2 = parseInt(m[1], 10);
    var ss2 = parseInt(m[2], 10);
    if ([mm2, ss2].some(function(x) { return !Number.isFinite(x); })) return null;
    return mm2 * 60 + ss2;
  };

  var runJob = function(job, workerId) {
    var localDir = job.tvLocalDir;
    var fname = job.fname;
    var tvFilePath = job.tvFilePath;
    var usbLongPath = job.usbLongPath;
    var fileSizeBytes = job.fileSizeBytes;
    var sequence = job.sequence;
    var season = job.season;
    var episode = job.episode;
    var seriesName = job.seriesName;

    var startedAtMs = Date.now();

    // Worker start log group.
    logWorkerGroup(workerId, new Date(), season, episode, seriesName, fileSizeBytes, null, null);

    // Local per-job speed state (no module-level mutable globals).
    var lastBytes = 0;
    var lastAtMs = Date.now();
    var samples = [];
    var lastSpeed = null;

    var speedFromProgress = function(progress) {
      if (!(typeof fileSizeBytes === 'number' && Number.isFinite(fileSizeBytes) && fileSizeBytes > 0)) return null;
      if (!(typeof progress === 'number' && Number.isFinite(progress))) return null;
      if (progress < 0) progress = 0;
      if (progress > 100) progress = 100;
      var bytesDone = fileSizeBytes * (progress / 100);
      var nowMs = Date.now();
      var dt = (nowMs - lastAtMs) / 1000;
      var dBytes = bytesDone - lastBytes;
      if (dt > 0 && dBytes >= 0) {
        var inst = dBytes / dt;
        if (Number.isFinite(inst)) {
          samples.push(inst);
          if (samples.length > 5) samples = samples.slice(-5);
          var sum = 0;
          for (var i = 0; i < samples.length; i++) sum += samples[i];
          lastSpeed = samples.length ? (sum / samples.length) : null;
        }
      }
      lastBytes = bytesDone;
      lastAtMs = nowMs;
      return lastSpeed == null ? null : Math.round(lastSpeed);
    };

    // Initial state: mark downloading and claim worker.
    patchTvJson(localDir, fname, {
      worker: workerId,
      status: 'downloading',
      progress: 0,
      speed: 0,
      eta: null,
      sequence: sequence,
      fileSize: fileSizeBytes,
      season: season,
      episode: episode,
      dateStarted: unixNow()
    }, {createIfMissing: true});

    var rsyncArgs = ['-av', '-e', 'ssh', '--timeout=20', '--info=progress2', usbLongPath, tvFilePath];
    var rsyncProc = spawn('rsync', rsyncArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    var rsyncOutput = '';
    var lastProgress = 0;
    var progressUpdateInterval = 500;
    var lastProgressUpdateTime = 0;

    var finish = function(kind, patch) {
      patch = patch || {};
      patch.worker = null;
      patch.eta = patch.eta === undefined ? null : patch.eta;
      patch.dateEnded = patch.dateEnded === undefined ? unixNow() : patch.dateEnded;
      patchTvJson(localDir, fname, patch, {createIfMissing: true});

      // Worker finished log group.
      try {
        var durSec = (Date.now() - startedAtMs) / 1000;
        var errText = null;
        if (kind !== 'finished') {
          errText = patch && patch.status ? String(patch.status) : String(kind);
        }
        logWorkerGroup(workerId, new Date(), season, episode, seriesName, fileSizeBytes, durSec, errText);
      } catch (e) {}

      try {
        if (process && typeof process.send === 'function') {
          process.send({
            type: 'done',
            kind: kind,
            worker: workerId,
            localPath: localDir,
            title: fname,
            elapsedMs: Date.now() - startedAtMs
          });
        }
      } catch (e) {}
    };

    rsyncProc.stdout.on('data', function(data) {
      var chunk = data.toString();
      rsyncOutput += chunk;

      var pm = chunk.match(/(\d+)%/);
      if (!pm) return;

      var progress = parseInt(pm[1], 10);
      if (!Number.isFinite(progress)) return;

      if (progress > lastProgress && (Date.now() - lastProgressUpdateTime) >= progressUpdateInterval) {
        lastProgress = progress;
        lastProgressUpdateTime = Date.now();

        var update = {
          worker: workerId,
          status: 'downloading',
          progress: progress
        };

        var spd = speedFromProgress(progress);
        if (spd != null) update.speed = spd;

        var etaSec = parseEtaSeconds(chunk);
        if (etaSec != null) {
          update.eta = unixNow() + etaSec;
        }

        patchTvJson(localDir, fname, update, {createIfMissing: true});
      }
    });

    rsyncProc.stderr.on('data', function(data) {
      rsyncOutput += data.toString();
    });

    rsyncProc.on('close', function(code) {
      if (code !== 0) {
        var errMsg = code === 23 ? 'Missing' : ('rsync exit code ' + code);
        finish('error', {
          status: errMsg,
          progress: lastProgress
        });
        return;
      }

      finish('finished', {
        status: 'finished',
        progress: 100,
        eta: null
      });
    });

    rsyncProc.on('error', function(err) {
      var errMsg = err && err.message ? err.message : 'rsync spawn error';
      finish('error', {
        status: errMsg,
        progress: lastProgress
      });
    });

    return rsyncProc;
  };

  (function main() {
    var current = null;

    var sendReady = function(workerId) {
      try {
        if (process && typeof process.send === 'function') {
          process.send({type: 'ready', worker: workerId});
        }
      } catch (e) {}
    };

    process.on('message', function(msg) {
      try {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'start') {
          if (current) {
            // Ignore: already running.
            return;
          }
          var workerId = msg.worker;
          var job = msg.job;
          current = runJob(job, workerId);
          return;
        }
        if (msg.type === 'ping') {
          sendReady(msg.worker);
          return;
        }
        if (msg.type === 'abort') {
          if (current && typeof current.kill === 'function') {
            try { current.kill('SIGTERM'); } catch (e) {}
          }
          current = null;
          return;
        }
      } catch (e) {
        // best-effort only
      }
    });

    // Tell parent we are ready once started.
    sendReady(null);
  })();

}).call(this);
