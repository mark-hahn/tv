#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import axios from 'axios';
import FormData from 'form-data';

// Per request
const VIDEO_PATH_DEFAULT =
  '/mnt/media/tv/Cheers/Season 1/Cheers.S01E02.Sams.Women.1080p.BluRay.x264-OFT.mkv';

// These paths exist on the remote host (per repo instructions)
const MISTRAL_KEY_PATH = '/root/dev/apps/tv/apps/asr/secrets/mistral-asr-key.txt';
const OPENAI_KEY_PATH = '/root/dev/apps/tv/apps/asr/secrets/openai-asr-key.txt';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/audio/transcriptions';
const MISTRAL_MODEL = 'voxtral-mini-latest';

const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_MODEL = 'gpt-4o-transcribe';

const CHUNK_SEC = 120; // 2 minutes (fixed)

const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_CHANNELS = 1;

const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_RETRIES = 5;

function usage() {
  // eslint-disable-next-line no-console
  console.log(`\nUsage:\n  node xscr-2.js [videoPath]\n\nDefaults:\n  videoPath: ${VIDEO_PATH_DEFAULT}\n\nOutputs (written next to this script):\n  xscr-2.txt\n  xscr-2-allJsonSegs.json\n\nEnv overrides (optional):\n  MISTRAL_ASR_KEY_PATH (default: ${MISTRAL_KEY_PATH})\n  OPENAI_ASR_KEY_PATH  (default: ${OPENAI_KEY_PATH})\n`);
}

function runProcess(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(' ')}\n${stderr || stdout}`));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function assertReadableFile(p) {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw new Error(`Not a file: ${p}`);
  await fsp.access(p, fs.constants.R_OK);
}

async function readKeyOrThrow(keyPath, friendlyName) {
  try {
    await assertReadableFile(keyPath);
  } catch (e) {
    throw new Error(
      `Failed to read ${friendlyName} key from ${keyPath}.\n` +
        `If you are running locally, this path only exists on the remote host.\n` +
        `Original error: ${e?.message ?? String(e)}`,
    );
  }
  const key = (await fsp.readFile(keyPath, 'utf8')).trim();
  if (!key) throw new Error(`${friendlyName} key file is empty: ${keyPath}`);
  return key;
}

async function getDurationSec(videoPath) {
  const { stdout } = await runProcess('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    videoPath,
  ]);

  const json = JSON.parse(stdout);
  const durStr = json?.format?.duration;
  const dur = Number(durStr);
  if (!Number.isFinite(dur) || dur <= 0) throw new Error(`Could not read duration from ffprobe: ${durStr}`);
  return dur;
}

function formatTime(totalSec) {
  const ms = Math.max(0, Math.round(totalSec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
}

async function extractChunkToFlac({ videoPath, outPath, startSec, durSec }) {
  await runProcess('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    videoPath,
    '-ss',
    String(startSec),
    '-t',
    String(durSec),
    '-vn',
    '-ac',
    String(AUDIO_CHANNELS),
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-c:a',
    'flac',
    outPath,
  ]);
}

async function extractSliceToMp3({ videoPath, outPath, startSec, endSec }) {
  const dur = Math.max(0.05, endSec - startSec);
  await runProcess('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    videoPath,
    '-ss',
    String(startSec),
    '-t',
    String(dur),
    '-vn',
    '-ac',
    String(AUDIO_CHANNELS),
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-c:a',
    'libmp3lame',
    '-b:a',
    '48k',
    outPath,
  ]);
}

async function callMistralVoxtralMini({ apiKey, flacPath }) {
  const form = new FormData();
  form.append('model', process.env.MISTRAL_MODEL || MISTRAL_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('file', fs.createReadStream(flacPath), {
    filename: path.basename(flacPath),
    contentType: 'audio/flac',
  });

  const res = await axios.post(MISTRAL_API_URL, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    timeout: REQUEST_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
    family: 4,
  });

  if (res.status >= 200 && res.status < 300) return res.data;
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  throw new Error(`Mistral Voxtral transcription failed: ${res.status} ${res.statusText}\n${body}`);
}

async function callOpenAITranscribe({ apiKey, audioPath }) {
  const form = new FormData();
  form.append('model', OPENAI_MODEL);
  form.append('response_format', 'text');
  form.append('temperature', '0');
  form.append('file', fs.createReadStream(audioPath), {
    filename: path.basename(audioPath),
    contentType: 'audio/mpeg',
  });

  const res = await axios.post(OPENAI_API_URL, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    timeout: REQUEST_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });

  if (res.status >= 200 && res.status < 300) {
    if (typeof res.data === 'string') return res.data;
    if (res.data && typeof res.data.text === 'string') return res.data.text;
    throw new Error(`Unexpected OpenAI response shape: ${JSON.stringify(res.data).slice(0, 800)}`);
  }

  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  throw new Error(`OpenAI transcription failed: ${res.status} ${res.statusText}\n${body}`);
}

async function withRetry(fn, { label }) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn({ attempt });
    } catch (e) {
      const msg = e?.message ?? String(e);
      const retryable =
        msg.includes('429') ||
        msg.includes('timeout') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('EAI_AGAIN') ||
        msg.includes('5') ||
        false;

      if (!retryable || attempt === MAX_RETRIES) throw e;
      const backoffMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      process.stdout.write(`[retry] ${label} attempt ${attempt} failed; waiting ${backoffMs}ms: ${msg}\n`);
      await sleep(backoffMs);
    }
  }
  throw new Error('unreachable');
}

function normalizeMiniJsonSegments(miniJson, fallbackDurationSec) {
  const segs = Array.isArray(miniJson?.segments) ? miniJson.segments : null;
  if (segs && segs.length) {
    return segs
      .map((s) => ({
        start: Number(s?.start),
        end: Number(s?.end),
        text: String(s?.text ?? '').trim(),
      }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.text);
  }

  const topText = typeof miniJson?.text === 'string' ? miniJson.text.trim() : '';
  if (topText) {
    return [{ start: 0, end: Math.max(0.25, Number(fallbackDurationSec) || CHUNK_SEC), text: topText }];
  }

  return [];
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(0);
  }

  const videoPath = argv[0] || VIDEO_PATH_DEFAULT;
  const chunkSec = CHUNK_SEC;

  await assertReadableFile(videoPath);

  const mistralKeyPath = process.env.MISTRAL_ASR_KEY_PATH || MISTRAL_KEY_PATH;
  const openaiKeyPath = process.env.OPENAI_ASR_KEY_PATH || OPENAI_KEY_PATH;

  const mistralKey = await readKeyOrThrow(mistralKeyPath, 'Mistral');
  const openaiKey = await readKeyOrThrow(openaiKeyPath, 'OpenAI');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outTxtPath = path.join(__dirname, 'xscr-2.txt');
  const outJsonSegsPath = path.join(__dirname, 'xscr-2-allJsonSegs.json');

  process.stdout.write(`Video:  ${videoPath}\n`);
  process.stdout.write(`Chunk:  ${chunkSec}s\n`);
  process.stdout.write(`Mistral: ${process.env.MISTRAL_MODEL || MISTRAL_MODEL} (${MISTRAL_API_URL})\n`);
  process.stdout.write(`OpenAI:  ${OPENAI_MODEL} (${OPENAI_API_URL})\n`);

  const durationSec = await getDurationSec(videoPath);
  const totalChunks = Math.ceil(durationSec / chunkSec);
  process.stdout.write(`Duration: ${durationSec.toFixed(2)}s (${totalChunks} chunks)\n`);

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'xscr-2-'));

  const allJsonSegs = [];

  try {
    // Phase 1: Voxtral mini over 2-minute chunks
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startSec = chunkIndex * chunkSec;
      const durSec = Math.min(chunkSec, durationSec - startSec);
      if (durSec <= 0.01) break;

      const flacPath = path.join(tmpDir, `chunk-${String(chunkIndex).padStart(4, '0')}.flac`);
      process.stdout.write(`\n[Voxtral] chunk ${chunkIndex + 1}/${totalChunks} start=${startSec.toFixed(2)} dur=${durSec.toFixed(2)}\n`);

      await extractChunkToFlac({ videoPath, outPath: flacPath, startSec, durSec });

      const miniJson = await withRetry(
        () => callMistralVoxtralMini({ apiKey: mistralKey, flacPath }),
        { label: 'mistral' },
      );

      const segs = normalizeMiniJsonSegments(miniJson, durSec);
      if (!segs.length) {
        process.stdout.write('[Voxtral] warning: no segments returned for this chunk\n');
      }

      for (const s of segs) {
        allJsonSegs.push({
          text: s.text,
          start: startSec + s.start,
          end: startSec + s.end,
        });
      }

      // Keep temp dir from ballooning
      try {
        await fsp.rm(flacPath, { force: true });
      } catch {
        // ignore
      }
    }

    await fsp.writeFile(outJsonSegsPath, JSON.stringify(allJsonSegs, null, 2), 'utf8');
    process.stdout.write(`\nWrote segments JSON: ${outJsonSegsPath} (count=${allJsonSegs.length})\n`);

    // Phase 2: For each segment, slice audio and transcribe with OpenAI
    await fsp.writeFile(outTxtPath, '', 'utf8');

    const ws = fs.createWriteStream(outTxtPath, { flags: 'a' });

    process.stdout.write(`\n[OpenAI] transcribing ${allJsonSegs.length} segments...\n`);

    for (let i = 0; i < allJsonSegs.length; i++) {
      const seg = allJsonSegs[i];
      const rawStart = Number(seg.start);
      const rawEnd = Number(seg.end);

      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) continue;

      // Ensure minimum duration for the slice (very short segments can be error-prone)
      const startSec = Math.max(0, rawStart);
      const endSec = Math.min(durationSec, Math.max(rawEnd, rawStart + 0.35));

      const slicePath = path.join(tmpDir, `seg-${String(i).padStart(6, '0')}.mp3`);

      process.stdout.write(
        `[OpenAI] seg ${i + 1}/${allJsonSegs.length} ${formatTime(startSec)} - ${formatTime(endSec)}\n`,
      );

      await extractSliceToMp3({ videoPath, outPath: slicePath, startSec, endSec });

      const openaiText = await withRetry(
        () => callOpenAITranscribe({ apiKey: openaiKey, audioPath: slicePath }),
        { label: 'openai' },
      );

      ws.write('\n');
      ws.write(`${formatTime(startSec)} - ${formatTime(endSec)}\n`);
      ws.write(`${String(seg.text ?? '').trim()}\n`);
      ws.write(`${String(openaiText ?? '').trim()}\n`);

      try {
        await fsp.rm(slicePath, { force: true });
      } catch {
        // ignore
      }
    }

    await new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.end(resolve);
    });

    process.stdout.write(`\nWrote: ${outTxtPath}\n`);
  } finally {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
