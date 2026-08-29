#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure logging
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  success: (msg) => console.log(`✓ ${msg}`),
};

// Audio extraction settings — same as the asr feature (apps/asr/asr.js)
const AUDIO_RATE = '48000';
const AUDIO_BITRATE = '256k';
const AUDIO_CHANNELS = '1';
const AUDIO_FILTER =
  'highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11';
const AUDIO_MIME = 'audio/flac';

// Files API upload: poll until the uploaded audio finishes processing
const FILE_POLL_MS = 2000;
const FILE_POLL_MAX = 150;

const CAPTION_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      start: { type: 'string' },
      end: { type: 'string' },
      text: { type: 'string' },
    },
    required: ['start', 'end', 'text'],
  },
};

class GeminiToSRT {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      throw new Error(
        'Gemini API key not provided. Set GEMINI_API_KEY environment variable or pass --api-key argument.'
      );
    }
    this.client = new GoogleGenerativeAI(this.apiKey);
    this.fileManager = new GoogleAIFileManager(this.apiKey);
    this.model = this.client.getGenerativeModel({ model: 'gemini-3.6-flash' });
    log.info('Gemini client initialized successfully');
  }

  // Input containers we extract audio from (anything ffmpeg can demux)
  static SUPPORTED_EXTENSIONS = [
    '.mp4', '.mkv', '.mpeg', '.mpg', '.mov', '.webm', '.flv', '.wmv',
    '.avi', '.ts', '.m4v', '.3gp', '.m4a', '.mp3', '.aac', '.wav', '.flac',
  ];

  static MAX_VIDEO_DURATION_WITH_AUDIO = 45 * 60; // 45 minutes
  static MAX_VIDEO_DURATION_WITHOUT_AUDIO = 60 * 60; // 60 minutes

  validateVideoFile(videoPath) {
    if (!fs.existsSync(videoPath)) {
      return { valid: false, message: `File not found: ${videoPath}` };
    }

    const stat = fs.statSync(videoPath);
    if (!stat.isFile()) {
      return { valid: false, message: `Not a file: ${videoPath}` };
    }

    const ext = path.extname(videoPath).toLowerCase();
    if (!GeminiToSRT.SUPPORTED_EXTENSIONS.includes(ext)) {
      const supportedList = GeminiToSRT.SUPPORTED_EXTENSIONS.join(', ');
      return { valid: false, message: `Unsupported format: ${ext}. Supported: ${supportedList}` };
    }

    return { valid: true, message: 'Valid' };
  }

  getVideoDuration(videoPath) {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1:nokey_print_value=1',
        videoPath,
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          try {
            const duration = Math.floor(parseFloat(output.trim()));
            resolve(duration);
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });

      ffprobe.on('error', () => {
        resolve(null);
      });
    });
  }

  ffmpeg(args, label) {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);

      let stderr = '';
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      proc.on('error', (e) => reject(new Error(`ffmpeg failed to start: ${e.message}`)));

      proc.on('close', (code) => {
        if (code !== 0) {
          this.dbg(`FFMPEG stderr (${label})`, stderr);
          reject(new Error(`ffmpeg ${label} exited with code ${code}`));
          return;
        }
        resolve();
      });
    });
  }

  // Extract -> filter -> flac, matching apps/asr/asr.js exactly.
  async prepareAudio(videoPath) {
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));
    const rawWav = path.join(dir, `${base}.raw.wav`);
    const procWav = path.join(dir, `${base}.proc.wav`);
    const flac = path.join(dir, `${base}.flac`);

    log.info('Extracting audio...');
    await this.ffmpeg(
      ['-y', '-i', videoPath, '-ac', AUDIO_CHANNELS, '-ar', AUDIO_RATE,
       '-b:a', AUDIO_BITRATE, '-vn', rawWav],
      'extract'
    );

    log.info('Filtering audio...');
    await this.ffmpeg(
      ['-y', '-i', rawWav, '-af', AUDIO_FILTER, '-ac', AUDIO_CHANNELS,
       '-ar', AUDIO_RATE, '-b:a', AUDIO_BITRATE, '-f', 'wav', procWav],
      'filter'
    );

    log.info('Encoding flac...');
    await this.ffmpeg(['-y', '-i', procWav, '-c:a', 'flac', flac], 'flac');

    fs.unlinkSync(rawWav);
    fs.unlinkSync(procWav);

    const sizeMb = fs.statSync(flac).size / 1024 / 1024;
    log.info(`Audio ready: ${path.basename(flac)} (${sizeMb.toFixed(1)} MB)`);
    this.dbg('AUDIO', `${flac} (${sizeMb.toFixed(1)} MB)`);

    return this.uploadAudio(flac);
  }

  // Inline base64 caps out around 20MB, so the flac goes through the Files API.
  async uploadAudio(audioPath) {
    log.info('Uploading audio to Gemini...');
    const upload = await this.fileManager.uploadFile(audioPath, {
      mimeType: AUDIO_MIME,
      displayName: path.basename(audioPath),
    });

    let file = upload.file;
    for (let i = 0; file.state === FileState.PROCESSING && i < FILE_POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, FILE_POLL_MS));
      file = await this.fileManager.getFile(file.name);
    }

    if (file.state !== FileState.ACTIVE) {
      this.dbg('UPLOAD failed', file);
      throw new Error(`Uploaded audio is ${file.state}, not ACTIVE`);
    }

    this.dbg('UPLOAD', { name: file.name, uri: file.uri, sizeBytes: file.sizeBytes });
    log.info('Audio uploaded');

    return { fileData: { mimeType: file.mimeType, fileUri: file.uri } };
  }

  dbg(label, data) {
    if (!this.debugFile) return;
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.appendFileSync(
      this.debugFile,
      `\n===== ${label} =====\n${body}\n`,
      'utf-8'
    );
  }

  async transcribeVideo(fileData) {
    log.info('Requesting transcription from Gemini...');

    const prompt = `Generate accessibility captions (subtitles for the deaf and
hard of hearing) for this audio track. This is the user's own personal media file and
the captions are for their private playback use only.

Listen to the recording and produce one caption cue for each utterance you hear.
Each cue needs a start time, an end time, and the words that were said.

Rules for the cues:
- Times use HH:MM:SS,mmm and must line up with the audio.
- Keep each cue to a single short line or two of dialogue; split long speeches
  into several consecutive cues rather than one long block.
- Cover all audible dialogue, including background and overlapping speech.

Return a JSON array of objects with the fields "start", "end", and "text",
and nothing else.`;

    const RETRY_STATUSES = [429, 500, 503];
    const MAX_ATTEMPTS = 6;
    const BASE_DELAY_MS = 5000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this.dbg(`PROMPT (attempt ${attempt})`, prompt);
      try {
        const response = await this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }, fileData] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: CAPTION_SCHEMA,
          },
        });
        const r = response.response;
        this.dbg('RESPONSE finishReason', r.candidates?.[0]?.finishReason ?? 'none');
        this.dbg('RESPONSE usageMetadata', r.usageMetadata ?? {});
        this.dbg('RESPONSE promptFeedback', r.promptFeedback ?? {});
        const text = r.text();
        this.dbg('RESPONSE raw text', text);
        return text;
      } catch (error) {
        this.dbg(`ERROR (attempt ${attempt})`, error.stack || error.message);
        const retryable = RETRY_STATUSES.includes(error.status);
        if (!retryable || attempt === MAX_ATTEMPTS) {
          log.error(`Transcription failed: ${error.message}`);
          throw error;
        }
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        log.info(
          `Gemini returned ${error.status}; retrying in ${delay / 1000}s ` +
            `(attempt ${attempt}/${MAX_ATTEMPTS - 1})`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  parseGeminiResponse(responseText) {
    log.info('Parsing transcription response...');

    // Try to extract JSON array from response
    let jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      // Try to find JSON object
      jsonMatch = responseText.match(/\{[\s\S]*\}/);
    }

    if (!jsonMatch) {
      throw new Error('Could not find JSON in Gemini response');
    }

    try {
      let data = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(data)) {
        // If single object, wrap in array
        data = [data];
      }
      this.dbg(`PARSED ${data.length} cues`, data);
      return data;
    } catch (error) {
      throw new Error(`Invalid JSON in Gemini response: ${error.message}`);
    }
  }

  timeToMilliseconds(timeStr) {
    // Handle both comma and period as decimal separator
    timeStr = timeStr.replace(',', '.');

    const parts = timeStr.split(':');
    if (parts.length !== 3) {
      throw new Error(`Invalid time format: ${timeStr}`);
    }

    try {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);

      const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
      return Math.floor(totalMs);
    } catch (error) {
      throw new Error(`Could not parse time ${timeStr}: ${error.message}`);
    }
  }

  millisecondsToSrtTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const milliseconds = ms % 1000;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
  }

  generateSrt(subtitleData, outputFile) {
    log.info(`Generating SRT file: ${outputFile}`);

    const srtContent = [];

    subtitleData.forEach((entry, i) => {
      try {
        const start = this.millisecondsToSrtTime(this.timeToMilliseconds(entry.start));
        const end = this.millisecondsToSrtTime(this.timeToMilliseconds(entry.end));
        const text = entry.text || '';

        const srtEntry = `${i + 1}\n${start} --> ${end}\n${text}\n`;
        srtContent.push(srtEntry);
      } catch (error) {
        log.warn(`Skipping malformed entry ${i + 1}: ${error.message}`);
      }
    });

    fs.writeFileSync(outputFile, srtContent.join('\n'), 'utf-8');
    log.success(`SRT file created with ${srtContent.length} entries`);
  }

  reportGaps(subtitleData, gapThresholdMs = 30000) {
    const gaps = [];
    let prevEnd = 0;
    subtitleData.forEach((entry, i) => {
      let start;
      try {
        start = this.timeToMilliseconds(entry.start);
      } catch {
        return;
      }
      if (start - prevEnd >= gapThresholdMs) {
        gaps.push({
          afterCue: i,
          from: this.millisecondsToSrtTime(prevEnd),
          to: this.millisecondsToSrtTime(start),
          seconds: Math.round((start - prevEnd) / 1000),
        });
      }
      try {
        prevEnd = Math.max(prevEnd, this.timeToMilliseconds(entry.end));
      } catch {
        /* keep prevEnd */
      }
    });
    this.dbg(`GAPS >= ${gapThresholdMs / 1000}s`, gaps);
    gaps.forEach((g) =>
      log.warn(`gap of ${g.seconds}s with no captions: ${g.from} -> ${g.to}`)
    );
    return gaps;
  }

  async processVideo(videoPath, outputFile = null) {
    // Validate video
    const validation = this.validateVideoFile(videoPath);
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    log.info(`Video validated: ${validation.message}`);

    // Determine output file
    if (!outputFile) {
      const baseName = path.basename(videoPath, path.extname(videoPath));
      outputFile = `${baseName}.srt`;
    }
    log.info(`Output file: ${outputFile}`);

    this.debugFile = `${outputFile.replace(/\.srt$/, '')}.gemini.log`;
    fs.writeFileSync(this.debugFile, `video: ${videoPath}\n`, 'utf-8');
    log.info(`Debug log: ${this.debugFile}`);

    // Upload and transcribe
    const fileData = await this.prepareAudio(videoPath);
    const geminiResponse = await this.transcribeVideo(fileData);

    // Parse and generate SRT
    const subtitleData = this.parseGeminiResponse(geminiResponse);
    this.reportGaps(subtitleData);
    this.generateSrt(subtitleData, outputFile);

    return outputFile;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Gemini Video-to-SRT Converter

Usage:
  node gemini-to-srt.js <video_file> [OPTIONS]

Options:
  --output, -o FILE     Output SRT filename (default: video_name.srt)
  --api-key KEY         Gemini API key (defaults to GEMINI_API_KEY env var)
  --help, -h            Show this help message

Examples:
  node gemini-to-srt.js video.mp4
  node gemini-to-srt.js video.mp4 --output subtitles.srt
  node gemini-to-srt.js video.mp4 --api-key YOUR_KEY

Supported formats:
  .mp4 .mov .webm .mpeg .flv .wmv .3gp

Environment:
  Set GEMINI_API_KEY environment variable to avoid passing --api-key each time
    `);
    process.exit(0);
  }

  const videoFile = args[0];
  let outputFile = null;
  let apiKey = null;

  for (let i = 1; i < args.length; i++) {
    if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    } else if (args[i] === '--api-key' && args[i + 1]) {
      apiKey = args[i + 1];
      i++;
    }
  }

  try {
    const converter = new GeminiToSRT(apiKey);
    const srtFile = await converter.processVideo(videoFile, outputFile);
    log.success(`Successfully created: ${srtFile}`);
    console.log(`\n✓ Subtitle file created: ${srtFile}`);
    process.exit(0);
  } catch (error) {
    log.error(`${error.message}`);
    console.error(`\nError: ${error.message}`, error);
    process.exit(1);
  }
}

main();