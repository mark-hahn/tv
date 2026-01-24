import crypto from 'node:crypto';
import fs from 'fs';
import path from 'node:path';

import { createFileLogger } from './logger.js';
import { elapsedSecsSince, formatYyyyMmDd_HhMmSs } from './time.js';
import { getAsrLogsDir } from './asrPaths.js';
import { runAsrJob as runVoxtralAsrJob } from './voxtralRunner.js';
import { runAsrJob as runGptAsrJob } from './gptRunner.js';

let _mgr = null;

function makeAsrId() {
  const seed = `${Date.now()}-${crypto.randomUUID()}`;
  const hex = crypto.createHash('sha1').update(seed).digest('hex');
  return (parseInt(hex.slice(0, 8), 16) >>> 0);
}

function emptyResult() {
  return {
    asrId: null,
    filePath: null,
    status: 'error',
    numFilesFinished: 0,
    numFilesTotal: 0,
    started: null,
    elapsedSecs: 0,
    progressFile: 0,
    progressAll: 0,
    estRemainingSecs: 0,
    log: '',
    error: 'unknown',
  };
}

export function getManager() {
  if (_mgr) return _mgr;
  _mgr = new AsrManager();
  return _mgr;
}

class AsrManager {
  constructor() {
    /** @type {Map<number, any>} */
    this.jobs = new Map();
    this.runningJobId = null;
  }

  getJob(asrId) {
    const id = Number(asrId);
    if (!Number.isFinite(id)) return null;
    return this.jobs.get(id) || null;
  }

  jobToResult(job, { includeLog } = { includeLog: false }) {
    if (!job) return null;
    const elapsedSecs = elapsedSecsSince(job.startedMs);
    const progressAll = job.numFilesTotal > 0
      ? Math.max(0, Math.min(100, Math.round((job.numFilesFinished + job.progressFile / 100) / job.numFilesTotal * 100)))
      : 0;

    const estRemainingSecs = progressAll > 1
      ? Math.max(0, Math.round((elapsedSecs / (progressAll / 100)) - elapsedSecs))
      : 0;

    let log = '';
    if (includeLog) {
      try {
        log = fs.readFileSync(job.logPath, 'utf8');
      } catch {
        log = '';
      }
    }

    return {
      asrId: job.asrId,
      filePath: job.filePath || '',
      status: job.status,
      numFilesFinished: job.numFilesFinished,
      numFilesTotal: job.numFilesTotal,
      started: job.startedIso,
      elapsedSecs,
      progressFile: Math.max(0, Math.min(100, Math.round(job.progressFile))),
      progressAll,
      estRemainingSecs,
      log,
      error: job.error || '',
    };
  }

  async controlAsr(args) {
    const cmd = String(args?.command || '').trim();
    if (!cmd) {
      const r = emptyResult();
      r.error = 'Missing command';
      return r;
    }

    if (cmd === 'start') return await this.start(args);
    if (cmd === 'status') return await this.status(args);
    if (cmd === 'dump') return await this.dump(args);
    if (cmd === 'kill') return await this.kill(args);

    const r = emptyResult();
    r.error = `Unknown command: ${cmd}`;
    return r;
  }

  async start(args) {
    if (this.runningJobId != null) {
      const running = this.getJob(this.runningJobId);
      const r = this.jobToResult(running) || emptyResult();
      r.status = 'error';
      r.error = 'ASR already running';
      return r;
    }

    const folder = String(args?.folder || '').trim();
    const file = args?.file == null ? null : String(args.file).trim();
    const sfx = String(args?.sfx || '').trim();
    const provider = String(args?.provider || 'voxtral').trim().toLowerCase();

    if (!folder) {
      const r = emptyResult();
      r.error = 'Missing folder';
      return r;
    }
    if (!sfx) {
      const r = emptyResult();
      r.error = 'Missing sfx';
      return r;
    }
    if (provider !== 'voxtral' && provider !== 'gpt') {
      const r = emptyResult();
      r.error = `Invalid provider: ${provider}`;
      return r;
    }

    const asrId = makeAsrId();
    const startedMs = Date.now();
    const startedIso = new Date(startedMs).toISOString();

    const { yyyy, mm, dd, stamp } = formatYyyyMmDd_HhMmSs(new Date(startedMs));
    const logPath = path.join(getAsrLogsDir(), yyyy, mm, `${stamp}-${asrId}.log`);

    const logger = createFileLogger(logPath);
    logger.log(`# asr log created ${startedIso} id=${asrId}`);

    const job = {
      asrId,
      folder,
      file,
      sfx,
      provider,
      startedMs,
      startedIso,
      logPath,
      status: 'running',
      filePath: '',
      numFilesFinished: 0,
      numFilesTotal: 0,
      progressFile: 0,
      error: '',
      _abortController: new AbortController(),
      _logger: logger,
    };

    this.jobs.set(asrId, job);
    this.runningJobId = asrId;

    // Fire-and-forget job execution.
    void this._run(job);

    return this.jobToResult(job);
  }

  async _run(job) {
    const logger = job._logger;
    try {
      const runner = job.provider === 'gpt' ? runGptAsrJob : runVoxtralAsrJob;
      await runner(job, {
        signal: job._abortController.signal,
        onProgress: (p) => {
          job.filePath = p.filePath || job.filePath;
          job.numFilesFinished = p.numFilesFinished;
          job.numFilesTotal = p.numFilesTotal;
          job.progressFile = p.progressFile;
        },
        logger,
      });

      if (job.status !== 'killed') {
        job.status = 'finished';
      }
    } catch (err) {
      if (job.status === 'killed') return;
      job.status = 'error';
      job.error = err?.message ? String(err.message) : String(err);
      try {
        logger.error(job.error);
      } catch {
        // ignore
      }
    } finally {
      if (this.runningJobId === job.asrId) this.runningJobId = null;
    }
  }

  async status(args) {
    const job = this.getJob(args?.asrId);
    if (!job) {
      const r = emptyResult();
      r.error = 'Unknown asrId';
      return r;
    }
    return this.jobToResult(job);
  }

  async dump(args) {
    const job = this.getJob(args?.asrId);
    if (!job) {
      const r = emptyResult();
      r.error = 'Unknown asrId';
      return r;
    }
    return this.jobToResult(job, { includeLog: true });
  }

  async kill(args) {
    // Kill everything: current running job if any.
    const job = this.getJob(args?.asrId) || (this.runningJobId != null ? this.getJob(this.runningJobId) : null);
    if (!job) {
      const r = emptyResult();
      r.error = 'Nothing to kill';
      return r;
    }

    job.status = 'killed';
    try {
      job._abortController.abort();
    } catch {
      // ignore
    }
    try {
      job._logger.log('killed');
    } catch {
      // ignore
    }
    return this.jobToResult(job);
  }
}
