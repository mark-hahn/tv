#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import axios from 'axios';
import FormData from 'form-data';

// Hardwired constants (per request)
const VIDEO_PATH = '/mnt/media/tv/Cheers/Season 1/Cheers.S01E02.Sams.Women.1080p.BluRay.x264-OFT.mkv';
const API_KEY_PATH = '/root/dev/apps/tv/apps/asr/secrets/openai-asr-key.txt';
const OUTPUT_TEXT_PATH = '/root/dev/apps/tv/apps/asr/xscr-comp.txt';

const OPENAI_MODEL = 'gpt-4o-transcribe';
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';

const SLICE_START_SEC = 0:00:49,750 --> 00:00:59,091;
const SLICE_END_SEC = 58.6;
const SLICE_DUR_SEC = SLICE_END_SEC - SLICE_START_SEC;

const AUDIO_RATE = 16000;

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
  await assertFileReadable(API_KEY_PATH);
  const apiKey = (await fsp.readFile(API_KEY_PATH, 'utf8')).trim();
  if (!apiKey) throw new Error(`Empty API key file: ${API_KEY_PATH}`);
  return apiKey;
}

async function extractAudioSliceToWav(tmpDir) {
  const outWav = path.join(tmpDir, 'slice.wav');

  // Slice 53.1s..58.6s and write small mono WAV (PCM S16LE @ 16k).
  await run('ffmpeg', [
    '-y',
    '-loglevel', 'error',
    '-nostdin',
    '-ss', String(SLICE_START_SEC),
    '-t', String(SLICE_DUR_SEC),
    '-i', VIDEO_PATH,
    '-vn',
    '-ac', '1',
    '-ar', String(AUDIO_RATE),
    '-c:a', 'pcm_s16le',
    outWav,
  ]);

  const st = await fsp.stat(outWav);
  if (!st.isFile() || st.size <= 0) throw new Error('Failed to create WAV slice');

  return {
    path: outWav,
    filename: path.basename(outWav),
    mime: 'audio/wav',
    size: st.size,
  };
}

async function transcribeOnce({ apiKey, uploadInfo }) {
  const form = new FormData();
  form.append('model', OPENAI_MODEL);
  form.append('response_format', 'json');
  form.append('file', fs.createReadStream(uploadInfo.path), {
    filename: uploadInfo.filename,
    contentType: uploadInfo.mime,
  });

  const response = await axios.post(OPENAI_URL, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    timeout: 120_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    family: 4,
  });

  const data = response?.data;
  const text = data?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`Unexpected transcription response (missing text): ${JSON.stringify(data).slice(0, 500)}`);
  }
  return text;
}

async function main() {
  await assertFileReadable(VIDEO_PATH);

  const apiKey = await readApiKey();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tv-xscr-comp-'));

  try {
    // eslint-disable-next-line no-console
    console.log(`Video:  ${VIDEO_PATH}`);
    // eslint-disable-next-line no-console
    console.log(`Slice:  ${SLICE_START_SEC}s..${SLICE_END_SEC}s (${SLICE_DUR_SEC.toFixed(1)}s)`);
    // eslint-disable-next-line no-console
    console.log(`Model:  ${OPENAI_MODEL}`);

    const uploadInfo = await extractAudioSliceToWav(tmpDir);
    // eslint-disable-next-line no-console
    console.log(`Upload: ${uploadInfo.filename} (${(uploadInfo.size / 1024).toFixed(1)}KB)`);

    // Exactly one API call
    const text = await transcribeOnce({ apiKey, uploadInfo });

    await fsp.mkdir(path.dirname(OUTPUT_TEXT_PATH), { recursive: true });
    await fsp.writeFile(OUTPUT_TEXT_PATH, `${text.trim()}\n`, 'utf8');

    // eslint-disable-next-line no-console
    console.log(`Wrote:  ${OUTPUT_TEXT_PATH}`);
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
