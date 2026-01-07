import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

const ROOT = path.resolve(process.cwd());
const subsLoginPath = path.join(ROOT, 'secrets', 'subs-login.txt');
const subsTokenPath = path.join(ROOT, 'secrets', 'subs-token.txt');
const samplesDir = path.join(ROOT, 'samples');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function safeFilename(name) {
  const base = String(name || '').trim() || 'subtitle.srt';
  // Keep it simple: strip path separators and control chars.
  return base
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readJson(filePath) {
  const s = await fs.readFile(filePath, 'utf8');
  return JSON.parse(s);
}

async function readToken() {
  try {
    const t = await fs.readFile(subsTokenPath, 'utf8');
    const token = String(t || '').trim();
    return token || null;
  } catch {
    return null;
  }
}

async function writeToken(token) {
  const t = String(token || '').trim();
  if (!t) throw new Error('Empty token');
  await fs.writeFile(subsTokenPath, t, 'utf8');
  return t;
}

async function osLogin({ apiKey, username, password }) {
  if (!username || !password) throw new Error('Missing username/password in secrets/subs-login.txt');

  const resp = await fetch('https://api.opensubtitles.com/api/v1/login', {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'User-Agent': 'tv-series-srvr/1.0',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  let body = null;
  try {
    body = await resp.json();
  } catch {
    // ignore
  }

  if (!resp.ok) {
    const msg = body?.message || body?.error || `OpenSubtitles login failed (${resp.status})`;
    throw new Error(msg);
  }

  const token = String(body?.token || '').trim();
  if (!token) throw new Error('Login succeeded but token missing');
  return token;
}

async function osDownload({ apiKey, token, fileId }) {
  const resp = await fetch('https://api.opensubtitles.com/api/v1/download', {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'User-Agent': 'tv-series-srvr/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ file_id: fileId }),
  });

  let body = null;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    body = { error: text || 'Non-JSON response' };
  }

  return { resp, body };
}

async function fetchText(url) {
  const resp = await fetch(url, { headers: { Accept: '*/*' } });
  if (!resp.ok) throw new Error(`GET download link failed (${resp.status})`);
  return await resp.text();
}

async function main() {
  const arg = process.argv[2];
  if (!arg) die('Usage: node scripts/download-srt.mjs <file_id>');

  const fileId = Number(arg);
  if (!Number.isFinite(fileId) || fileId <= 0) die('file_id must be a positive number');

  const login = await readJson(subsLoginPath).catch((e) => {
    throw new Error(`Failed to read ${subsLoginPath}: ${e.message}`);
  });

  const apiKey = String(login?.apiKey || '').trim();
  const username = String(login?.username || '').trim();
  const password = String(login?.password || '').trim();
  if (!apiKey) die('Missing apiKey in secrets/subs-login.txt');

  let token = await readToken();

  // First try /download with existing token if present.
  let dl = await osDownload({ apiKey, token, fileId });

  // If auth error, login once and retry.
  if (!dl.resp.ok && (dl.resp.status === 401 || dl.resp.status === 403)) {
    console.log(`Auth failed (${dl.resp.status}); attempting login + retry...`);
    const newToken = await osLogin({ apiKey, username, password });
    token = await writeToken(newToken);
    dl = await osDownload({ apiKey, token, fileId });
  }

  if (!dl.resp.ok) {
    const msg = dl.body?.message || dl.body?.error || `OpenSubtitles download failed (${dl.resp.status})`;
    throw new Error(`${msg}`);
  }

  const link = String(dl.body?.link || '').trim();
  const fileName = safeFilename(dl.body?.file_name || dl.body?.file || `${fileId}.srt`);
  if (!link) throw new Error('Download response missing link');

  const srtText = await fetchText(link);

  await fs.mkdir(samplesDir, { recursive: true });
  const outPath = path.join(samplesDir, fileName.endsWith('.srt') ? fileName : `${fileName}.srt`);
  await fs.writeFile(outPath, srtText, 'utf8');

  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error('ERROR:', e?.message || e);
  process.exit(2);
});
