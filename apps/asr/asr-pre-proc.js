
/**
 *
 * Full ASR pipeline: FFmpeg decode → RNNoise denoise → VAD silence chunking → Mistral ASR
 *
 * Usage:
 *   node mistral-asr-pipeline.mjs <input-audio-file> [options]
 *
 * Options:
 *   --out <file>          Write transcript to file (default: stdout)
 *   --silence-ms <ms>     Min silence duration to split on (default: 300)
 *   --max-chunk-s <sec>   Max chunk duration in seconds (default: 30)
 *   --overlap-ms <ms>     Overlap buffer at chunk boundaries (default: 200)
 *   --threshold <0-1>     RMS silence threshold (default: 0.015)
 *   --no-denoise          Skip RNNoise denoising step
 *   --model <name>        Mistral ASR model (default: mistral-small-latest)
 *   --keep-chunks         Keep temp WAV chunk files after transcription
 *
 * Setup:
 *   npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg node-wav form-data node-fetch
 *   npm install node-rnnoise   # optional — needs native build tools (node-gyp)
 *   export MISTRAL_API_KEY=your_key_here
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ─── Parse CLI args ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { options: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args.options[key] = true;
      } else {
        args.options[key] = next;
        i++;
      }
    } else if (!args.input) {
      args.input = a;
    }
  }
  return args;
}

const { input, options } = parseArgs(process.argv);

if (!input) {
  console.error('Usage: node mistral-asr-pipeline.mjs <audio-file> [options]');
  process.exit(1);
}

if (!fs.existsSync(input)) {
  console.error('Error: file not found: ' + input);
  process.exit(1);
}

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
if (!MISTRAL_API_KEY) {
  console.error('Error: MISTRAL_API_KEY environment variable is not set.');
  process.exit(1);
}

const CONFIG = {
  silenceMs:  parseInt(options['silence-ms']  ?? '300',  10),
  maxChunkS:  parseInt(options['max-chunk-s'] ?? '30',   10),
  overlapMs:  parseInt(options['overlap-ms']  ?? '200',  10),
  threshold:  parseFloat(options['threshold'] ?? '0.015'),
  denoise:    !options['no-denoise'],
  model:      options['model'] ?? 'mistral-small-latest',
  keepChunks: !!options['keep-chunks'],
  outFile:    options['out'] ?? null,
};

const SAMPLE_RATE = 16000;
const FRAME_MS    = 20;
const FRAME_SIZE  = Math.floor(SAMPLE_RATE * FRAME_MS / 1000); // 320 samples

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { process.stderr.write('[asr] ' + msg + '\n'); }

function tmpPath(suffix) {
  return path.join(os.tmpdir(), 'asr_' + Date.now() + '_' + Math.random().toString(36).slice(2) + suffix);
}

function encodeWav(samples, sampleRate) {
  const numSamples = samples.length;
  const buf = Buffer.allocUnsafe(44 + numSamples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + numSamples * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);         // PCM
  buf.writeUInt16LE(1, 22);         // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

// ─── Step 1: FFmpeg decode ────────────────────────────────────────────────────

async function decodeToWav(inputFile) {
  log('Step 1/4 — decoding audio with FFmpeg...');

  let ffmpegBin;
  try {
    ffmpegBin = require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    ffmpegBin = 'ffmpeg'; // fall back to system ffmpeg
  }

  const outWav = tmpPath('.wav');
  // highpass removes low-freq rumble; helps VAD accuracy
  const filter = 'highpass=f=80,lowpass=f=8000';

  execSync(
    '"' + ffmpegBin + '" -y -i "' + inputFile + '" -ac 1 -ar ' + SAMPLE_RATE +
    ' -sample_fmt s16 -af "' + filter + '" "' + outWav + '"',
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );

  log('  → decoded to 16kHz mono PCM WAV');
  return outWav;
}

// ─── Step 2: RNNoise denoising ────────────────────────────────────────────────

async function denoiseWav(wavPath) {
  if (!CONFIG.denoise) {
    log('Step 2/4 — denoising skipped (--no-denoise)');
    return wavPath;
  }

  log('Step 2/4 — applying RNNoise denoising...');

  let rnnoise;
  try {
    rnnoise = require('node-rnnoise');
  } catch {
    log('  ! node-rnnoise not installed — skipping (npm install node-rnnoise to enable)');
    return wavPath;
  }

  const wav = require('node-wav');
  const { sampleRate, channelData } = wav.decode(fs.readFileSync(wavPath));
  const samples = channelData[0];

  // RNNoise processes 480-sample frames at 48kHz internally.
  // We apply it at 16kHz using 160-sample frames — sufficient for ASR denoising.
  const FRAME_16K = 160;
  const state = rnnoise.newState();
  const denoised = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i += FRAME_16K) {
    const frame = new Float32Array(FRAME_16K);
    frame.set(samples.slice(i, i + FRAME_16K));
    const out = rnnoise.processFrame(state, frame);
    denoised.set(out, i);
  }

  rnnoise.deleteState(state);

  const outWav = tmpPath('_denoised.wav');
  fs.writeFileSync(outWav, encodeWav(denoised, sampleRate));
  log('  → RNNoise denoising complete');
  return outWav;
}

// ─── Step 3: VAD silence chunking ────────────────────────────────────────────

function chunkBySilence(wavPath) {
  log('Step 3/4 — VAD silence detection and chunking...');

  const wav = require('node-wav');
  const { sampleRate, channelData } = wav.decode(fs.readFileSync(wavPath));
  const samples = channelData[0];
  const totalDuration = (samples.length / sampleRate).toFixed(1);
  log('  → audio duration: ' + totalDuration + 's');

  // Build per-frame silence map using RMS energy
  const silenceFrames = [];
  for (let i = 0; i < samples.length; i += FRAME_SIZE) {
    const frame = samples.slice(i, Math.min(i + FRAME_SIZE, samples.length));
    let sum = 0;
    for (let j = 0; j < frame.length; j++) sum += frame[j] * frame[j];
    silenceFrames.push(Math.sqrt(sum / frame.length) < CONFIG.threshold);
  }

  const silenceMinFrames = Math.ceil(CONFIG.silenceMs / FRAME_MS);
  const maxChunkFrames   = Math.ceil((CONFIG.maxChunkS * 1000) / FRAME_MS);
  const overlapFrames    = Math.ceil(CONFIG.overlapMs / FRAME_MS);

  // Find silence-region midpoints as ideal split locations
  const splitPoints = [0];
  let silenceStart = null;
  let lastSplitFrame = 0;

  for (let i = 0; i < silenceFrames.length; i++) {
    if (silenceFrames[i] && silenceStart === null) {
      silenceStart = i;
    } else if (!silenceFrames[i] && silenceStart !== null) {
      const len = i - silenceStart;
      if (len >= silenceMinFrames) {
        const mid = Math.floor(silenceStart + len / 2);
        splitPoints.push(mid);
        lastSplitFrame = mid;
      }
      silenceStart = null;
    }
    // Force-split when max chunk length reached (continuous speech fallback)
    if (i - lastSplitFrame >= maxChunkFrames) {
      splitPoints.push(i);
      lastSplitFrame = i;
    }
  }
  splitPoints.push(silenceFrames.length);

  // Convert frame indices → sample slices, add overlap padding
  const chunks = [];
  for (let i = 0; i < splitPoints.length - 1; i++) {
    const startFrame  = Math.max(0, splitPoints[i] - overlapFrames);
    const endFrame    = Math.min(silenceFrames.length, splitPoints[i + 1] + overlapFrames);
    const startSample = startFrame * FRAME_SIZE;
    const endSample   = Math.min(endFrame * FRAME_SIZE, samples.length);
    const chunkSamples = samples.slice(startSample, endSample);
    const duration = chunkSamples.length / sampleRate;

    if (duration < 0.1) continue; // skip near-empty edge chunks

    chunks.push({
      index: chunks.length,
      startSec: startSample / sampleRate,
      endSec:   endSample   / sampleRate,
      duration,
      samples:  chunkSamples,
      sampleRate,
    });
  }

  log('  → split into ' + chunks.length + ' chunk(s)');
  return chunks;
}

// ─── Step 4: Mistral ASR ──────────────────────────────────────────────────────

async function transcribeChunks(chunks) {
  log('Step 4/4 — transcribing ' + chunks.length + ' chunk(s) via Mistral ASR...');

  let fetch;
  try { fetch = (await import('node-fetch')).default; }
  catch { fetch = global.fetch; }
  if (!fetch) throw new Error('fetch unavailable — install node-fetch: npm install node-fetch');

  let FormData;
  try { FormData = (await import('form-data')).default; }
  catch { FormData = global.FormData; }

  const tmpFiles = [];
  const results  = [];

  for (const chunk of chunks) {
    const label = 'chunk ' + (chunk.index + 1) + '/' + chunks.length +
      ' (' + chunk.startSec.toFixed(1) + 's–' + chunk.endSec.toFixed(1) + 's)';
    log('  → ' + label);

    const tmpFile = tmpPath('_chunk' + chunk.index + '.wav');
    fs.writeFileSync(tmpFile, encodeWav(chunk.samples, chunk.sampleRate));
    tmpFiles.push(tmpFile);

    const form = new FormData();
    form.append('file', fs.createReadStream(tmpFile), {
      filename: 'chunk' + chunk.index + '.wav',
      contentType: 'audio/wav',
    });
    form.append('model', CONFIG.model);

    const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + MISTRAL_API_KEY, ...(form.getHeaders?.() ?? {}) },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error('Mistral API error ' + res.status + ': ' + errText);
    }

    const json = await res.json();
    const text = (json.text ?? '').trim();
    log('     "' + text.slice(0, 80) + (text.length > 80 ? '...' : '') + '"');
    results.push({ ...chunk, text });
  }

  if (!CONFIG.keepChunks) {
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }
  }

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('Starting pipeline for: ' + input);

  const decodedWav  = await decodeToWav(input);
  const denoisedWav = await denoiseWav(decodedWav);
  const chunks      = chunkBySilence(denoisedWav);
  const results     = await transcribeChunks(chunks);

  try { if (decodedWav  !== input) fs.unlinkSync(decodedWav);  } catch {}
  try { if (denoisedWav !== decodedWav) fs.unlinkSync(denoisedWav); } catch {}

  const transcript = results.map(r => r.text).filter(Boolean).join(' ');

  if (CONFIG.outFile) {
    fs.writeFileSync(CONFIG.outFile, transcript + '\n', 'utf8');
    log('Transcript written to: ' + CONFIG.outFile);
  } else {
    process.stdout.write(transcript + '\n');
  }

  log('Done.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

