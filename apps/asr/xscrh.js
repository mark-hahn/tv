#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

import axios from 'axios';
import FormData from 'form-data';

const VIDEO_PATH_DEFAULT = '/mnt/media/tv/Cheers/Season 1/Cheers.S01E02.Sams.Women.1080p.BluRay.x264-OFT.mkv';
const OUTPUT_JSON_PATH_DEFAULT = '/root/dev/apps/tv/apps/asr/xvox.json';
const API_KEY_PATH_DEFAULT = '/root/dev/apps/tv/apps/asr/secrets/mistral-asr-key.txt';

const MISTRAL_MODEL = 'voxtral-mini-latest';
const API_URL = 'https://api.mistral.ai/v1/audio/transcriptions';
const API_RESPONSE_FORMAT = 'verbose_json';

const CHUNK_SEC = 120;
const AUDIO_RATE = 48000;

function usage() {
  // eslint-disable-next-line no-console
  console.log(`\nUsage:\n  node xscrh.js [videoPath] [outputJsonPath]\n\nDefaults:\n  videoPath:      ${VIDEO_PATH_DEFAULT}\n  outputJsonPath: ${OUTPUT_JSON_PATH_DEFAULT}\n\nKey path (fixed unless env override):\n  ${API_KEY_PATH_DEFAULT}\n\nEnv overrides:\n  MISTRAL_ASR_KEY_PATH  (default: ${API_KEY_PATH_DEFAULT})\n  MISTRAL_MODEL         (default: ${MISTRAL_MODEL})\n  CHUNK_SEC             (default: ${CHUNK_SEC})\n`);
}

function run(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} exited ${code}\n${err || out}`));
    });
  });
}

async function assertFileReadable(p) {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw new Error(`Not a file: ${p}`);
  await fsp.access(p, fs.constants.R_OK);
}

async function readApiKey() {
  const keyPath = process.env.MISTRAL_ASR_KEY_PATH || API_KEY_PATH_DEFAULT;
  await assertFileReadable(keyPath);
  const apiKey = (await fsp.readFile(keyPath, 'utf8')).trim();
  if (!apiKey) throw new Error(`Empty API key file: ${keyPath}`);
  return apiKey;
}

async function extractFirstChunkToFlac(videoPath, tmpDir, chunkSec) {
  const outFlac = path.join(tmpDir, 'chunk-000.flac');

  // Extract only the first chunk (0..chunkSec) and write as FLAC.
  // Keep it simple: mono @ 48k.
  await run('ffmpeg', [
    '-y',
    '-ss', '0',
    '-t', String(chunkSec),
    '-i', videoPath,
    '-vn',
    '-ac', '1',
    '-ar', String(AUDIO_RATE),
    '-c:a', 'flac',
    outFlac,
  ]);

  const st = await fsp.stat(outFlac);
  if (!st.isFile() || st.size <= 0) throw new Error('Failed to create FLAC chunk');

  return {
    path: outFlac,
    mime: 'audio/flac',
    filename: path.basename(outFlac),
    size: st.size,
  };
}

async function callMistralTranscribe({ apiKey, uploadInfo, modelId }) {
  const form = new FormData();
  form.append('model', modelId);
  form.append('response_format', API_RESPONSE_FORMAT);
  form.append('timestamp_granularities[]', 'segment');
  form.append('file', fs.createReadStream(uploadInfo.path), {
    filename: uploadInfo.filename,
    contentType: uploadInfo.mime,
  });

  const response = await axios.post(API_URL, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    timeout: 120_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    family: 4,
  });

  return response?.data;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(0);
  }

  const videoPath = argv[0] || VIDEO_PATH_DEFAULT;
  const outputJsonPath = argv[1] || OUTPUT_JSON_PATH_DEFAULT;

  const modelId = process.env.MISTRAL_MODEL || MISTRAL_MODEL;
  const chunkSec = Number(process.env.CHUNK_SEC || CHUNK_SEC);
  if (!Number.isFinite(chunkSec) || chunkSec <= 0) throw new Error(`Invalid CHUNK_SEC: ${process.env.CHUNK_SEC}`);

  await assertFileReadable(videoPath);

  const apiKey = await readApiKey();

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tv-xvox-'));
  try {
    // eslint-disable-next-line no-console
    console.log(`Video: ${videoPath}`);
    // eslint-disable-next-line no-console
    console.log(`Model: ${modelId}`);
    // eslint-disable-next-line no-console
    console.log(`Chunk: first ${chunkSec}s only`);

    const uploadInfo = await extractFirstChunkToFlac(videoPath, tmpDir, chunkSec);
    // eslint-disable-next-line no-console
    console.log(`Upload: ${uploadInfo.filename} (${(uploadInfo.size / 1024 / 1024).toFixed(2)}MB)`);

    const data = await callMistralTranscribe({ apiKey, uploadInfo, modelId });

    await fsp.mkdir(path.dirname(outputJsonPath), { recursive: true });
    await fsp.writeFile(outputJsonPath, JSON.stringify(data, null, 2), 'utf8');

    // eslint-disable-next-line no-console
    console.log(`Wrote: ${outputJsonPath}`);
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
