#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import axios from 'axios';
import FormData from 'form-data';

// Hardwired constants (per request)
const VIDEO_PATH =
	'/mnt/media/tv/Cheers/Season 1/Cheers.S01E01.Give.Me.a.Ring.Sometime.1080p.BluRay.x264-OFT.mkv';
const OPENAI_KEY_PATH = '/root/dev/apps/tv/apps/asr/secrets/openai-asr-key.txt';
const OUTPUT_TEXT_PATH = '/root/dev/apps/tv/apps/asr/xscrt.txt';

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_MODEL = 'gpt-4o-transcribe';

// Audio extraction / chunking
const CHUNK_SECONDS = 10 * 60; // 10 minutes
const AUDIO_CODEC = 'libmp3lame';
const AUDIO_BITRATE = '48k';
const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_CHANNELS = 1;

// Runtime
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes per chunk
const MAX_RETRIES = 5;
const KEEP_TEMP = false;

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
			else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(' ')}\n${stderr}`));
		});
	});
}

async function fileExists(filePath) {
	try {
		await fsp.access(filePath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function dirExists(dirPath) {
	try {
		const st = await fsp.stat(dirPath);
		return st.isDirectory();
	} catch {
		return false;
	}
}

async function readOpenAIKey() {
	let key;
	try {
		key = await fsp.readFile(OPENAI_KEY_PATH, 'utf8');
	} catch (e) {
		throw new Error(
			`Failed to read OpenAI key from ${OPENAI_KEY_PATH}.\n` +
				`If you are running locally, this path only exists on the remote host.\n` +
				`Original error: ${e?.message ?? String(e)}`,
		);
	}
	key = key.trim();
	if (!key) throw new Error(`OpenAI key file is empty: ${OPENAI_KEY_PATH}`);
	return key;
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function transcribeWithRetry({ apiKey, audioPath, chunkIndex, totalChunks }) {
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			process.stdout.write(
				`Transcribing chunk ${chunkIndex + 1}/${totalChunks} (attempt ${attempt}/${MAX_RETRIES})...\n`,
			);
			return await transcribeOnce({ apiKey, audioPath });
		} catch (e) {
			const msg = e?.message ?? String(e);
			const retryable =
				msg.includes('429') ||
				msg.includes('timeout') ||
				msg.includes('ETIMEDOUT') ||
				msg.includes('ECONNRESET') ||
				msg.includes('ENOTFOUND') ||
				msg.includes('5') ||
				false;

			if (!retryable || attempt === MAX_RETRIES) throw e;

			const backoffMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
			process.stdout.write(`Retrying after ${backoffMs}ms: ${msg}\n`);
			await sleep(backoffMs);
		}
	}

	throw new Error('unreachable');
}

async function transcribeOnce({ apiKey, audioPath }) {
	const form = new FormData();
	form.append('model', OPENAI_MODEL);
	form.append('response_format', 'text');
	form.append('temperature', '0');
	form.append('language', 'en');
	form.append('file', fs.createReadStream(audioPath), {
		filename: path.basename(audioPath),
		contentType: 'audio/mpeg',
	});

	const reqStart = Date.now();
	process.stdout.write(
		`[OpenAI] -> POST /v1/audio/transcriptions model=${OPENAI_MODEL} file=${path.basename(audioPath)} at ${new Date(reqStart).toISOString()}\n`,
	);

	let res;
	try {
		res = await axios.post(OPENAI_TRANSCRIBE_URL, form, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				...form.getHeaders(),
			},
			timeout: REQUEST_TIMEOUT_MS,
			maxBodyLength: Infinity,
			maxContentLength: Infinity,
			validateStatus: () => true,
		});
	} catch (e) {
		const ms = Date.now() - reqStart;
		process.stdout.write(
			`[OpenAI] <- ERROR after ${ms}ms: ${e?.message ?? String(e)}\n`,
		);
		throw e;
	}

	const ms = Date.now() - reqStart;
	process.stdout.write(
		`[OpenAI] <- ${res.status} ${res.statusText} after ${ms}ms\n`,
	);

	if (res.status >= 200 && res.status < 300) {
		// With response_format=text, OpenAI returns plain text.
		if (typeof res.data === 'string') return res.data;

		// Fallback if API returns JSON.
		if (res.data && typeof res.data.text === 'string') return res.data.text;
		throw new Error(`Unexpected response shape: ${JSON.stringify(res.data).slice(0, 500)}`);
	}

	const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
	throw new Error(`OpenAI transcription failed: ${res.status} ${res.statusText}\n${body}`);
}

async function extractAndChunkAudio({ workDir }) {
	if (!(await fileExists(VIDEO_PATH))) {
		throw new Error(`Video file not found: ${VIDEO_PATH}`);
	}

	// Create chunk files like chunk-000.mp3, chunk-001.mp3, ...
	const outPattern = path.join(workDir, 'chunk-%03d.mp3');

	process.stdout.write('Extracting + chunking audio with ffmpeg...\n');
	await runProcess('ffmpeg', [
		'-hide_banner',
		'-loglevel',
		'error',
		'-i',
		VIDEO_PATH,
		'-vn',
		'-ac',
		String(AUDIO_CHANNELS),
		'-ar',
		String(AUDIO_SAMPLE_RATE),
		'-c:a',
		AUDIO_CODEC,
		'-b:a',
		AUDIO_BITRATE,
		'-f',
		'segment',
		'-segment_time',
		String(CHUNK_SECONDS),
		'-reset_timestamps',
		'1',
		outPattern,
	]);

	const files = (await fsp.readdir(workDir))
		.filter((f) => f.startsWith('chunk-') && f.endsWith('.mp3'))
		.sort();

	if (files.length === 0) throw new Error('No audio chunks produced by ffmpeg.');
	return files.map((f) => path.join(workDir, f));
}

async function chooseOutputPath() {
	const parent = path.dirname(OUTPUT_TEXT_PATH);
	if (!(await dirExists(parent))) {
		await fsp.mkdir(parent, { recursive: true });
	}
	return OUTPUT_TEXT_PATH;
}

function addLineBreaksAfterSentences(text) {
	// Insert a linefeed after every '.' and '?', consuming any following spaces/tabs.
	// This is intentionally simple per request.
	return text.replace(/[.?][ \t]*/g, (m) => m.trimEnd() + '\n');
}

async function main() {
	process.stdout.write(`Video: ${VIDEO_PATH}\n`);
	process.stdout.write(`Key:   ${OPENAI_KEY_PATH}\n`);

	const apiKey = await readOpenAIKey();
	const outPath = await chooseOutputPath();

	// Temp dir for chunks
	const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'xscrt-'));
	process.stdout.write(`Working dir: ${workDir}\n`);

	let chunks = [];
	try {
		chunks = await extractAndChunkAudio({ workDir });
		process.stdout.write(`Chunks: ${chunks.length}\n`);

		const parts = [];
		for (let i = 0; i < chunks.length; i++) {
			const text = await transcribeWithRetry({
				apiKey,
				audioPath: chunks[i],
				chunkIndex: i,
				totalChunks: chunks.length,
			});
			parts.push(text.trim());
		}

		const transcript = parts.filter(Boolean).join('\n\n');
		const formatted = addLineBreaksAfterSentences(transcript).trimEnd() + '\n';
		await fsp.writeFile(outPath, formatted, 'utf8');
		process.stdout.write(`Wrote transcript: ${outPath}\n`);
	} finally {
		if (!KEEP_TEMP) {
			try {
				await fsp.rm(workDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	}
}

main().catch((e) => {
	process.stderr.write(`xscrt failed: ${e?.stack ?? e?.message ?? String(e)}\n`);
	process.exit(1);
});
