import fs from 'fs';
import fsp from 'fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import dns from 'node:dns/promises';
import { spawn } from 'child_process';
import axios from 'axios';
import FormData from 'form-data';

import { getAsrSecretsDir } from './asrPaths.js';

// ---------------- Hard-wired config ----------------
const MISTRAL_MODEL = 'voxtral-small-latest';
const MISTRAL_ASR_TIMEOUT_MS = 60000;
const API_RESPONSE_FORMAT = 'verbose_json';
const API_TEMPERATURE = 0;

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 5000;

const CHUNK_SEC = 120;
const TRIM_SEC = 3;
const OVERLAP_SEC = 3;
const TIME_MATCH_MGN = 0.3;

const AUDIO_CONFIG = { rate: 48000, bitrate: '256k' };

const FILE_LIMIT_BYTES = 19 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']);

const HTTPS_AGENT = new https.Agent({ keepAlive: true });

const OFFSET_SEC = CHUNK_SEC - TRIM_SEC - OVERLAP_SEC - TRIM_SEC;
const MIN_CHUNK_SEC = TRIM_SEC + OVERLAP_SEC + TRIM_SEC;

let didLogApiNetInfo = false;

function formatAddrList(addrs) {
  if (!Array.isArray(addrs) || addrs.length === 0) return 'none';
  return addrs
    .map((a) => {
      const address = a?.address ?? 'unknown';
      const family = a?.family ?? 'unknown';
      return `${address} (IPv${family})`;
    })
    .join(', ');
}

async function logApiNetInfoOnce(logger, startMs) {
  if (!logger || didLogApiNetInfo) return;
  didLogApiNetInfo = true;

  logger.log(
    `[${ts(startMs)}] API net: keepAlive=${HTTPS_AGENT?.options?.keepAlive ? '1' : '0'} (env disabled)`,
  );

  try {
    const addrs = await dns.lookup('api.mistral.ai', { all: true });
    logger.log(`[${ts(startMs)}] API dns: api.mistral.ai -> ${formatAddrList(addrs)}`);
  } catch (e) {
    logger.error(`[${ts(startMs)}] API dns lookup failed: ${e?.message || e}`);
  }
}

function previewText(s, maxChars = 2000) {
  const str = typeof s === 'string' ? s : String(s ?? '');
  if (str.length <= maxChars) return str;
  const headLen = Math.max(0, maxChars - 200);
  const head = str.slice(0, headLen);
  const tail = str.slice(-200);
  return `${head}\n...<truncated ${str.length - headLen - 200} chars>...\n${tail}`;
}

function ts(startMs) {
  const secs = Math.floor((Date.now() - startMs) / 1000);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function vs(secs) {
  let ds = Math.round(secs * 10);
  const neg = ds < 0;
  ds = Math.abs(ds);
  let hours = Math.floor(ds / 36000);
  ds %= 36000;
  let minutes = Math.floor(ds / 600);
  ds %= 600;
  let seconds = Math.floor(ds / 10);
  const tenths = ds % 10;
  if (hours > 9) {
    hours = 9;
    minutes = 59;
    seconds = 59;
  }
  const out = `[${String(hours)}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(tenths)}]`;
  return neg ? `-${out}` : out;
}

function isVideoFile(p) {
  return ALLOWED_EXT.has(path.extname(p).toLowerCase());
}

async function pathExists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function srtPathForVideo(videoPath, sfx) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const clean = String(sfx || '').trim();
  return path.join(dir, `${base}.${clean}.srt`);
}

function nextSfx(baseSfx, nextIndex) {
  const raw = String(baseSfx || '').trim();
  const m = raw.match(/^(.*?)(\d+)?$/);
  const prefix = (m?.[1] ?? raw).trim();
  const baseNum = m?.[2] ? Number(m[2]) : null;
  const n = (Number.isFinite(baseNum) ? baseNum + nextIndex : 1 + nextIndex);
  return `${prefix}${n}`;
}

async function pickOutputForVideo(videoPath, sfx, { logger, startMs } = {}) {
  const clean = String(sfx || '').trim();
  if (!clean) throw new Error('Missing sfx');

  const firstPath = srtPathForVideo(videoPath, clean);
  if (!(await pathExists(firstPath))) return { outPath: firstPath, outSfx: clean };

  // If the desired output exists, retry with a sequence suffix: entst2, entst3, ...
  for (let i = 1; i <= 99; i++) {
    const candidateSfx = nextSfx(clean, i);
    const candidatePath = srtPathForVideo(videoPath, candidateSfx);
    if (!(await pathExists(candidatePath))) {
      const base = path.basename(videoPath, path.extname(videoPath));
      if (logger) {
        logger.log(`\n[${ts(startMs)}] Output exists; retrying with suffix: ${base}.${candidateSfx}.srt`);
      }
      return { outPath: candidatePath, outSfx: candidateSfx };
    }
  }

  throw new Error(`No available output name for sfx=${clean}`);
}

function run(cmd, args, { signal, logger } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';

    const abort = () => {
      try { p.kill('SIGKILL'); } catch { /* ignore */ }
    };

    if (signal) {
      if (signal.aborted) abort();
      signal.addEventListener('abort', abort, { once: true });
    }

    p.stdout.on('data', (d) => {
      out += d.toString();
    });
    p.stderr.on('data', (d) => {
      err += d.toString();
    });
    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      if (signal) {
        try { signal.removeEventListener('abort', abort); } catch { /* ignore */ }
      }
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} exited ${code}\n${err || out}`));
    });

    if (logger) {
      // Keep logs similar to asr.js: it doesn't dump ffmpeg output normally.
      void logger;
    }
  });
}

async function getDurationSec(file, { signal } = {}) {
  try {
    const { out } = await run('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      file,
    ], { signal });
    const sec = parseFloat(String(out).trim());
    return Number.isFinite(sec) ? Math.floor(sec) : 0;
  } catch {
    return 0;
  }
}

async function extractAudio(inputVideo, outWav, { signal } = {}) {
  const args = [
    '-y', '-i', inputVideo,
    '-ac', '1',
    '-ar', String(AUDIO_CONFIG.rate),
    '-b:a', AUDIO_CONFIG.bitrate,
    '-vn',
    outWav,
  ];
  await run('ffmpeg', args, { signal });
}

async function preprocessAudio(inputWav, outputWav, { signal, logger, startMs } = {}) {
  const audioFilter = 'highpass=f=80,lowpass=f=8000,dynaudnorm=f=150:g=3:m=3:s=8';
  if (logger) logger.log({ audioFilter });
  await run('ffmpeg', [
    '-y', '-i', inputWav,
    '-af', audioFilter,
    '-ac', '1',
    '-ar', String(AUDIO_CONFIG.rate),
    '-b:a', AUDIO_CONFIG.bitrate,
    '-f', 'wav',
    outputWav,
  ], { signal });
  void startMs;
}

async function getChunks(inWav, tmpDir, { signal } = {}) {
  const totalDuration = await getDurationSec(inWav, { signal });
  const chunkCount = Math.ceil(totalDuration / OFFSET_SEC);
  const chunks = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const chunkStart = chunkIndex * OFFSET_SEC;
    const chunkEnd = Math.min(chunkStart + CHUNK_SEC, totalDuration);
    if ((chunkEnd - chunkStart) < MIN_CHUNK_SEC) break;

    let trimStart = chunkStart + TRIM_SEC;
    let trimEnd = chunkEnd - TRIM_SEC;
    let overlapStart = trimStart + OVERLAP_SEC;
    let overlapEnd = trimEnd - OVERLAP_SEC;
    if (chunkIndex === 0) {
      trimStart = chunkStart;
      overlapStart = chunkStart;
    }
    if (chunkIndex === (chunkCount - 1)) {
      overlapEnd = chunkEnd;
      trimEnd = chunkEnd;
    }

    const wavPath = path.join(tmpDir, `chunk-${String(chunkIndex).padStart(3, '0')}.wav`);
    await run('ffmpeg', [
      '-y', '-i', inWav,
      '-ss', String(chunkStart.toFixed(2)),
      '-to', String(chunkEnd.toFixed(2)),
      '-c:a', 'pcm_s16le',
      '-avoid_negative_ts', 'make_zero',
      wavPath,
    ], { signal });

    chunks.push({ wavPath, chunkIndex, chunkStart, chunkEnd, trimStart, trimEnd, overlapStart, overlapEnd });
  }
  return { totalDuration, chunks };
}

async function getFlac(wavPath, tmpDir, { signal, logger } = {}) {
  const flacPath = path.join(tmpDir, `${path.basename(wavPath, '.wav')}.flac`);
  await run('ffmpeg', ['-y', '-i', wavPath, '-c:a', 'flac', flacPath], { signal });
  const statSize = (await fsp.stat(flacPath)).size;
  if (statSize > FILE_LIMIT_BYTES) {
    const msg = `FLAC file too large: ${statSize} bytes > ${FILE_LIMIT_BYTES} bytes`;
    if (logger) logger.error(msg);
    throw new Error(msg);
  }
  return {
    path: flacPath,
    mime: 'audio/flac',
    filename: path.basename(flacPath),
    size: statSize,
  };
}

function isVoxtralSmall(modelId) {
  return String(modelId || '').toLowerCase().includes('voxtral-small');
}

async function callTranscriptionsApi({ apiKey, uploadInfo, signal, logger, startMs }) {
  const buf = await fsp.readFile(uploadInfo.path);
  const apiStart = Date.now();
  let attempt = 0;

  await logApiNetInfoOnce(logger, startMs);

  while (true) {
    attempt++;

    const form = new FormData();
    form.append('file', buf, { filename: uploadInfo.filename, contentType: uploadInfo.mime });
    form.append('model', MISTRAL_MODEL);
    form.append('return_language', 'false');
    form.append('timestamp_granularities', 'segment');
    form.append('response_format', API_RESPONSE_FORMAT);
    form.append('temperature', String(API_TEMPERATURE));

    try {
      if (logger) {
        logger.log(
          `[${ts(startMs)}] API request: attempt ${attempt}/${MAX_RETRIES} timeout=${MISTRAL_ASR_TIMEOUT_MS}ms bytes=${uploadInfo.size}`,
        );
        logger.log(
          `[${ts(startMs)}] API call: POST https://api.mistral.ai/v1/audio/transcriptions model=${MISTRAL_MODEL} mime=${uploadInfo.mime} filename=${uploadInfo.filename}`,
        );
      }

      const reqStart = Date.now();
      const response = await axios.post(
        'https://api.mistral.ai/v1/audio/transcriptions',
        form,
        {
          headers: { Authorization: `Bearer ${apiKey}`, ...form.getHeaders() },
          timeout: MISTRAL_ASR_TIMEOUT_MS,
          signal,
          httpsAgent: HTTPS_AGENT,
        },
      );

      if (logger) {
        const elapsedMs = Date.now() - reqStart;
        const reqId = response?.headers?.['x-request-id'] || response?.headers?.['request-id'] || response?.headers?.['x-requestid'];
        const ct = response?.headers?.['content-type'];
        logger.log(
          `[${ts(startMs)}] API response: status=${response?.status} elapsedMs=${elapsedMs} requestId=${reqId || 'unknown'} contentType=${ct || 'unknown'}`,
        );
      }

      if (response?.status === 200) {
        response.data.delay = Date.now() - apiStart;
        return response.data;
      }

      const status = response?.status || 'unknown';
      if (logger) logger.error(`[${ts(startMs)}] API error: ${status}, retrying`);
    } catch (err) {
      if (signal?.aborted) throw new Error('killed');

      const status = err?.response?.status || err?.code || err.message || 'unknown';
      const body = err?.response?.data || err?.toString();
      if (logger) {
        logger.error(`[${ts(startMs)}] API request failed (attempt ${attempt}): ${status}`);
        const cfg = err?.config;
        const reqId = err?.response?.headers?.['x-request-id'] || err?.response?.headers?.['request-id'] || err?.response?.headers?.['x-requestid'];
        logger.error(
          `[${ts(startMs)}] API error detail: code=${err?.code || 'unknown'} errno=${err?.errno || 'unknown'} syscall=${err?.syscall || 'unknown'} address=${err?.address || 'unknown'} port=${err?.port || 'unknown'} url=${cfg?.url || 'unknown'} timeout=${cfg?.timeout ?? 'unknown'} requestId=${reqId || 'unknown'}`,
        );
        if (body) logger.error(JSON.stringify(body));
      }

      if (attempt > MAX_RETRIES) {
        throw new Error('FATAL: max retries reached');
      }
    }

    const backoff = Math.min(60000, BASE_DELAY_MS * Math.pow(2, attempt - 1));
    const jitter = Math.floor(Math.random() * 500);
    const delay = backoff + jitter;
    if (logger) logger.log(`[${ts(startMs)}] Waiting ${Math.round(delay / 1000)}s before retry...`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

async function callChatWithAudioApi({ apiKey, uploadInfo, signal, logger, startMs }) {
  const buf = await fsp.readFile(uploadInfo.path);
  const base64Audio = buf.toString('base64');
  const apiStart = Date.now();
  let attempt = 0;

  await logApiNetInfoOnce(logger, startMs);

  // Keep it deterministic and machine-readable.
  const prompt = [
    'Transcribe this audio into subtitle segments.',
    'Return ONLY valid JSON with this exact shape:',
    '{"segments":[{"start":0.0,"end":1.23,"text":"..."}, ...]}',
    'Rules:',
    '- start/end are seconds from start of THIS audio chunk',
    '- Use as many segments as needed for good subtitles',
    '- Keep text clean (no speaker labels)',
  ].join('\n');

  while (true) {
    attempt++;

    const body = {
      model: MISTRAL_MODEL,
      temperature: API_TEMPERATURE,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: base64Audio },
            { type: 'text', text: prompt },
          ],
        },
      ],
    };

    try {
      if (logger) {
        logger.log(
          `[${ts(startMs)}] API request: attempt ${attempt}/${MAX_RETRIES} timeout=${MISTRAL_ASR_TIMEOUT_MS}ms bytes=${uploadInfo.size} base64Chars=${base64Audio.length}`,
        );
        logger.log(
          `[${ts(startMs)}] API call: POST https://api.mistral.ai/v1/chat/completions model=${MISTRAL_MODEL} temp=${API_TEMPERATURE} promptChars=${prompt.length}`,
        );
      }

      const reqStart = Date.now();
      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        body,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: MISTRAL_ASR_TIMEOUT_MS,
          signal,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          httpsAgent: HTTPS_AGENT,
        },
      );

      if (logger) {
        const elapsedMs = Date.now() - reqStart;
        const reqId = response?.headers?.['x-request-id'] || response?.headers?.['request-id'] || response?.headers?.['x-requestid'];
        const ct = response?.headers?.['content-type'];
        const finishReason = response?.data?.choices?.[0]?.finish_reason;
        logger.log(
          `[${ts(startMs)}] API response: status=${response?.status} elapsedMs=${elapsedMs} requestId=${reqId || 'unknown'} contentType=${ct || 'unknown'} finish_reason=${finishReason || 'unknown'}`,
        );
      }

      if (response?.status === 200) {
        const content = response?.data?.choices?.[0]?.message?.content;
        let parsed;
        try {
          parsed = typeof content === 'string' ? JSON.parse(content) : content;
        } catch (e) {
          const finishReason = response?.data?.choices?.[0]?.finish_reason;
          if (logger) {
            logger.error(
              `[${ts(startMs)}] API parse failed (attempt ${attempt}): ${e?.message || e}`,
            );
            logger.error(
              `[${ts(startMs)}] API parse context: contentType=${typeof content} contentChars=${typeof content === 'string' ? content.length : 'n/a'} finish_reason=${finishReason || 'unknown'}`,
            );
            logger.error(`[${ts(startMs)}] API raw content preview:\n${previewText(content)}`);
          }
          throw e;
        }
        const segs = Array.isArray(parsed?.segments) ? parsed.segments : null;
        if (!segs) throw new Error('Chat response missing segments');

        const outSegs = segs
          .map((s) => ({
            start: Number(s?.start),
            end: Number(s?.end),
            text: String(s?.text ?? '').trim(),
          }))
          .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.text);

        response.data.delay = Date.now() - apiStart;
        return { segments: outSegs };
      }

      const status = response?.status || 'unknown';
      if (logger) logger.error(`[${ts(startMs)}] API error: ${status}, retrying`);
    } catch (err) {
      if (signal?.aborted) throw new Error('killed');

      const status = err?.response?.status || err?.code || err.message || 'unknown';
      const body = err?.response?.data || err?.toString();
      if (logger) {
        logger.error(`[${ts(startMs)}] API request failed (attempt ${attempt}): ${status}`);
        const cfg = err?.config;
        const reqId = err?.response?.headers?.['x-request-id'] || err?.response?.headers?.['request-id'] || err?.response?.headers?.['x-requestid'];
        logger.error(
          `[${ts(startMs)}] API error detail: code=${err?.code || 'unknown'} errno=${err?.errno || 'unknown'} syscall=${err?.syscall || 'unknown'} address=${err?.address || 'unknown'} port=${err?.port || 'unknown'} url=${cfg?.url || 'unknown'} timeout=${cfg?.timeout ?? 'unknown'} requestId=${reqId || 'unknown'}`,
        );
        if (body) logger.error(JSON.stringify(body));
      }

      if (attempt > MAX_RETRIES) {
        throw new Error('FATAL: max retries reached');
      }
    }

    const backoff = Math.min(60000, BASE_DELAY_MS * Math.pow(2, attempt - 1));
    const jitter = Math.floor(Math.random() * 500);
    const delay = backoff + jitter;
    if (logger) logger.log(`[${ts(startMs)}] Waiting ${Math.round(delay / 1000)}s before retry...`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

async function callApi({ apiKey, uploadInfo, signal, logger, startMs }) {
  if (logger) {
    logger.log(
      `[${ts(startMs)}] API: ${isVoxtralSmall(MISTRAL_MODEL) ? 'chat/completions (audio)' : 'audio/transcriptions'} model=${MISTRAL_MODEL}`,
    );
  }
  if (isVoxtralSmall(MISTRAL_MODEL)) {
    return callChatWithAudioApi({ apiKey, uploadInfo, signal, logger, startMs });
  }
  return callTranscriptionsApi({ apiKey, uploadInfo, signal, logger, startMs });
}

function processSegments(segments, chunkInfo, { logger, startMs } = {}) {
  if (!segments || segments.length === 0) return [];
  const processedSegments = [];
  if (logger) logger.log('');

  for (const segment of segments) {
    if (segment.start === undefined || segment.end === undefined || !segment.text?.trim()) {
      const msg = `Invalid segment (missing start/end/text), chunk ${chunkInfo.chunkIndex}`;
      if (logger) logger.error(msg);
      throw new Error(msg);
    }

    const start = chunkInfo.chunkStart + segment.start;
    const end = chunkInfo.chunkStart + segment.end;

    if (logger) logger.log(`RAW: ${chunkInfo.chunkIndex}, ${vs(start)}, ${vs(end)}, "${segment.text.trim()}"`);

    const processedSegment = {
      start,
      end,
      text: segment.text.trim(),
      chunk: chunkInfo,
    };

    if (start > chunkInfo.trimStart && end < chunkInfo.trimEnd) processedSegments.push(processedSegment);
  }

  if (logger) logger.log('');
  void startMs;
  return processedSegments;
}

function toSrtTime(totalSec) {
  const totalMs = Math.max(0, Math.round(totalSec * 1000));
  const h = String(Math.floor(totalMs / 3600000)).padStart(2, '0');
  const m = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, '0');
  const ms3 = String(totalMs % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${ms3}`;
}

function writeSrt(segments, outputPath, { logger, startMs } = {}) {
  if (!segments || segments.length === 0) throw new Error(`Video has no segments to write: ${outputPath}`);

  const sortedSegments = segments.sort((a, b) => a.start - b.start);

  function normalizeText(s) {
    if (!s) return '';
    return s
      .toLowerCase()
      .replace(/[^\w\s'’]/g, ' ')
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  let lastStart = +1e9;
  let lastEnd = -1e9;
  let lastText = null;
  let skipSeg;
  let hadDuplicate = false;
  const segOut = [];

  for (const segment of sortedSegments) {
    const start = segment.start;
    const end = segment.end;
    const text = segment.text.trim();

    try {
      skipSeg = true;
      if (text.length === 0) continue;
      const leftMatch = Math.abs(start - lastStart) < TIME_MATCH_MGN;
      const rightMatch = Math.abs(end - lastEnd) < TIME_MATCH_MGN;
      if (leftMatch || rightMatch) {
        hadDuplicate = true;
        if (text === lastText) continue;
        if (logger) {
          logger.log(`\n[${ts(startMs)}] Overlapping segments ...`);
          logger.log(`A ${vs(lastStart)}, ${vs(lastEnd)}, "${lastText}"`);
          logger.log(`B ${vs(start)}, ${vs(end)}, "${text}"`);
        }
        if (text.length > lastText.length) {
          if (logger) logger.log('Using A');
          continue;
        }
        if (logger) logger.log('Using B');
        segOut.pop();
      }
      skipSeg = false;
    } finally {
      if (!skipSeg) segOut.push({ start, end, text, norm: normalizeText(text) });
      if (!hadDuplicate) {
        lastStart = start;
        lastEnd = end;
        lastText = text;
      } else {
        lastStart = lastEnd = -1;
      }
      hadDuplicate = false;
    }
  }

  const mergedSegs = [];
  const GAP_TOL = 2.0;
  const SHORT_SEG_MAX_DUR = 2.0;
  const SHORT_SEG_GAP = 5.0;
  const SINGLE_TOKEN_WINDOW = 30.0;

  for (const seg of segOut) {
    if (mergedSegs.length === 0) {
      mergedSegs.push({ ...seg });
      continue;
    }
    const last = mergedSegs[mergedSegs.length - 1];
    const gap = seg.start - last.end;
    const segDur = seg.end - seg.start;
    const lastDur = last.end - last.start;
    const lastNorm = last.norm || normalizeText(last.text);
    const segNorm = seg.norm || normalizeText(seg.text);

    let shouldMerge = false;
    if (segNorm === lastNorm && segNorm.length > 0) {
      if (seg.start <= last.end + GAP_TOL) shouldMerge = true;
      else if (segDur <= SHORT_SEG_MAX_DUR && lastDur <= SHORT_SEG_MAX_DUR && gap <= SHORT_SEG_GAP) shouldMerge = true;
      else {
        const lastTokens = lastNorm.split(' ').filter(Boolean).length;
        const segTokens = segNorm.split(' ').filter(Boolean).length;
        if (lastTokens === 1 && segTokens === 1 && gap <= SINGLE_TOKEN_WINDOW) shouldMerge = true;
      }
    }

    if (shouldMerge) {
      last.end = Math.max(last.end, seg.end);
      last.start = Math.min(last.start, seg.start);
      if (seg.text.length > last.text.length) last.text = seg.text;
      last.norm = segNorm;
    } else {
      mergedSegs.push({ ...seg });
    }
  }

  const finalSegs = [];
  for (const seg of mergedSegs) {
    if (finalSegs.length === 0) {
      finalSegs.push({ ...seg });
      continue;
    }
    const last = finalSegs[finalSegs.length - 1];
    const lastNorm = last.norm || normalizeText(last.text);
    const segNorm = seg.norm || normalizeText(seg.text);
    const lastTokens = lastNorm.split(' ').filter(Boolean).length;
    const segTokens = segNorm.split(' ').filter(Boolean).length;
    const gap = seg.start - last.end;

    if (lastNorm === segNorm && lastTokens === 1 && segTokens === 1 && gap <= SINGLE_TOKEN_WINDOW) {
      last.end = Math.max(last.end, seg.end);
      if (seg.text.length > last.text.length) last.text = seg.text;
      continue;
    }
    finalSegs.push({ ...seg });
  }

  let srtContent = '';
  let index = 0;
  for (const seg of finalSegs) {
    srtContent += `${++index}\n`;
    srtContent += `${toSrtTime(seg.start)} --> ${toSrtTime(seg.end)}\n`;
    srtContent += `${seg.text}\n\n`;
  }

  fs.writeFileSync(outputPath, srtContent, 'utf8');
  if (logger) logger.log(`\n[${ts(startMs)}] Wrote: ${path.basename(outputPath)}`);
}

async function processOneVideo(videoPath, { sfx, apiKey, tmpDir, signal, logger, startMs, onProgress, numFilesFinished, numFilesTotal }) {
  if (logger) logger.log(`\n[${ts(startMs)}] Processing: ${path.basename(videoPath)}`);

  const { outPath } = await pickOutputForVideo(videoPath, sfx, { logger, startMs });

  const rawWavFile = path.join(tmpDir, 'audio_raw.wav');
  const processedWavFile = path.join(tmpDir, 'audio_processed.wav');

  await extractAudio(videoPath, rawWavFile, { signal });
  if (logger) logger.log(`[${ts(startMs)}] Preprocessing audio...`);
  await preprocessAudio(rawWavFile, processedWavFile, { signal, logger, startMs });

  const { totalDuration, chunks } = await getChunks(processedWavFile, tmpDir, { signal });
  if (logger) logger.log(`[${ts(startMs)}] Duration: ${totalDuration.toFixed(0)}s, ${chunks.length} chunks`);

  const allSegments = [];
  for (const chunkInfo of chunks) {
    if (signal?.aborted) throw new Error('killed');

    const progressFile = chunks.length > 0
      ? Math.max(0, Math.min(100, Math.round(((chunkInfo.chunkIndex + 1) / chunks.length) * 100)))
      : 0;

    if (typeof onProgress === 'function') {
      onProgress({
        filePath: videoPath,
        numFilesFinished,
        numFilesTotal,
        progressFile,
      });
    }

    try {
      const uploadInfo = await getFlac(chunkInfo.wavPath, tmpDir, { signal, logger });
      const apiData = await callApi({ apiKey, uploadInfo, signal, logger, startMs });

      if (apiData?.segments && apiData.segments.length > 0) {
        const processedSegments = processSegments(apiData.segments, chunkInfo, { logger, startMs });
        allSegments.push(...processedSegments);
      } else {
        if (logger) logger.log(`[${ts(startMs)}] Chunk ${String(chunkInfo.chunkIndex).padStart(3)}: ${String(chunkInfo.chunkStart).padStart(4)}s ${String(chunkInfo.chunkEnd).padStart(4)}s, Size: ${String(Math.round(uploadInfo.size / 1e6)).padStart(2)}Mb, ⚠️ no segments`);
      }
    } catch (err) {
      if (logger) logger.log(`[${ts(startMs)}] ${path.basename(videoPath)} | Chunk ${chunkInfo.chunkIndex}/${chunks.length}: ${chunkInfo.chunkStart.toFixed(0)}s-${chunkInfo.chunkEnd.toFixed(0)}s ❌ ${err.message}`);
    }
  }

  if (allSegments.length === 0) throw new Error('No transcription segments found');

  writeSrt(allSegments, outPath, { logger, startMs });

  if (typeof onProgress === 'function') {
    onProgress({
      filePath: videoPath,
      numFilesFinished,
      numFilesTotal,
      progressFile: 100,
    });
  }
}

async function resolveVideoFiles({ folder, file }) {
  const folderPath = path.resolve(folder);
  const st = await fsp.stat(folderPath);
  if (!st.isDirectory()) throw new Error('folder is not a directory');

  if (file) {
    const filePath = path.join(folderPath, file);
    const fst = await fsp.stat(filePath);
    if (!fst.isFile()) throw new Error('file is not a file');
    if (!isVideoFile(filePath)) throw new Error('file is not a supported video format');
    return [filePath];
  }

  const files = await fsp.readdir(folderPath);
  const out = [];
  for (const f of files) {
    const fp = path.join(folderPath, f);
    try {
      const st2 = await fsp.stat(fp);
      if (st2.isFile() && isVideoFile(fp)) out.push(fp);
    } catch {
      // ignore
    }
  }
  if (out.length === 0) throw new Error('No video files found');
  return out;
}

function readApiKey() {
  const keyPath = path.join(getAsrSecretsDir(), 'mistral-asr-key.txt');
  const apiKey = fs.readFileSync(keyPath, 'utf8').trim();
  if (!apiKey) throw new Error('Missing mistral-asr-key.txt contents');
  return apiKey;
}

export async function runAsrJob(job, { signal, onProgress, logger } = {}) {
  const apiKey = readApiKey();
  const startMs = job.startedMs;

  const files = await resolveVideoFiles({ folder: job.folder, file: job.file });
  job.numFilesTotal = files.length;

  if (logger) {
    logger.log(`\nConfiguration:`);
    logger.log(`   Chunk Duration:    ${CHUNK_SEC}s`);
    logger.log(`   Trim Duration:     ${TRIM_SEC}s`);
    logger.log(`   Overlap Duration:  ${OVERLAP_SEC}s`);
    logger.log(`   Time Match Margin: ${TIME_MATCH_MGN}s`);
    logger.log(`   Audio Quality:     max (${AUDIO_CONFIG.rate}Hz, ${AUDIO_CONFIG.bitrate})`);
    logger.log(`   Preprocessing:     true`);
    logger.log(`   Noise Reduction:   true`);
    logger.log(`   API Model:         ${MISTRAL_MODEL}`);
    logger.log(`   API Response:      ${API_RESPONSE_FORMAT}`);
    logger.log(`   API Timeout:       ${Math.round(MISTRAL_ASR_TIMEOUT_MS / 1000)}s`);
    logger.log(`   File Size Limit:   ${(FILE_LIMIT_BYTES / 1024 / 1024).toFixed(1)}MB`);
    logger.log('');
    logger.log(`Found ${files.length} video file(s) to process`);
  }

  const tmpRoot = path.join(os.tmpdir(), 'tv-asr', String(job.asrId));
  await fsp.mkdir(tmpRoot, { recursive: true });

  let finished = 0;
  for (const filePath of files) {
    if (signal?.aborted) throw new Error('killed');

    const tmpDir = path.join(tmpRoot, String(finished));
    await fsp.mkdir(tmpDir, { recursive: true });

    await processOneVideo(filePath, {
      sfx: job.sfx,
      apiKey,
      tmpDir,
      signal,
      logger,
      startMs,
      onProgress,
      numFilesFinished: finished,
      numFilesTotal: files.length,
    });

    finished++;
    job.numFilesFinished = finished;
    job.progressFile = 0;

    if (typeof onProgress === 'function') {
      onProgress({
        filePath,
        numFilesFinished: finished,
        numFilesTotal: files.length,
        progressFile: 0,
      });
    }
  }
}
