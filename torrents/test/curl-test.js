import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Usage (from workspace root):
//   node torrents/test/curl-test.js "https://www.torrentleech.org/download/<fid>/<name>.torrent"
//
// Reads:  misc/req-browser.txt  (DevTools “Copy as cURL (bash)” output)
// Writes: torrents/test/curl-test.torrent

const WORKSPACE_ROOT = path.resolve(process.cwd());
const REQ_BROWSER_CANDIDATES = [
  path.join(WORKSPACE_ROOT, 'torrents', 'req-browser.txt'),
  path.join(WORKSPACE_ROOT, 'misc', 'req-browser.txt'),
];
const OUTPUT_PATH = path.join(WORKSPACE_ROOT, 'torrents', 'test', 'curl-test.torrent');

function fail(msg) {
  console.error(`[curl-test] ${msg}`);
  process.exitCode = 1;
}

function parseReqBrowserTxt(text) {
  // Parses a bash-style curl command like:
  // curl 'https://...' \
  //   -H 'k: v' \
  //   -b 'a=b; c=d'
  const urlMatch = text.match(/\bcurl\s+['"]([^'\"]+)['"]/i);
  const url = urlMatch ? urlMatch[1] : '';

  const headers = {};
  const reH1 = /\s-H\s+'([^']+)'/gi;
  const reH2 = /\s-H\s+"([^\"]+)"/gi;
  const pushHeader = (h) => {
    const idx = String(h).indexOf(':');
    if (idx <= 0) return;
    const k = String(h).slice(0, idx).trim();
    const v = String(h).slice(idx + 1).trim();
    if (!k || !v) return;
    headers[k] = v;
  };
  let mh;
  while ((mh = reH1.exec(text))) pushHeader(mh[1]);
  while ((mh = reH2.exec(text))) pushHeader(mh[1]);

  const b1 = text.match(/\s-b\s+'([^']*)'/i);
  const b2 = text.match(/\s-b\s+"([^\"]*)"/i);
  let cookieHeader = (b1?.[1] || b2?.[1] || '').trim();

  // Firefox often emits cookies as a header instead of -b.
  if (!cookieHeader) {
    const cookieKey = Object.keys(headers).find(k => String(k).toLowerCase() === 'cookie');
    if (cookieKey) {
      cookieHeader = String(headers[cookieKey] || '').trim();
      delete headers[cookieKey];
    }
  }

  return { url, headers, cookieHeader };
}

function upsertCookieValue(cookieHeader, cookieName, cookieValue) {
  const name = String(cookieName || '').trim();
  const value = String(cookieValue || '').trim();
  if (!name || !value) return String(cookieHeader || '').trim();

  const parts = String(cookieHeader || '')
    .split(';')
    .map(s => String(s || '').trim())
    .filter(Boolean);

  let replaced = false;
  const out = parts.map(p => {
    const idx = p.indexOf('=');
    if (idx <= 0) return p;
    const k = p.slice(0, idx).trim();
    if (k !== name) return p;
    replaced = true;
    return `${name}=${value}`;
  });

  if (!replaced) out.push(`${name}=${value}`);
  return out.join('; ');
}

function buildCurlArgs(targetUrl, { headers, cookieHeader, outputPath }) {
  const args = ['-sS', '-L', '--compressed'];

  // Keep as close to browser as possible, but let curl manage a few internals.
  // Don’t pass a Cookie header via -H; use -b.
  for (const [k, v] of Object.entries(headers || {})) {
    if (!k) continue;
    const keyLower = String(k).toLowerCase();
    if (keyLower === 'cookie') continue;
    if (keyLower === 'host') continue;
    if (v == null || String(v).length === 0) continue;
    args.push('-H', `${k}: ${v}`);
  }

  if (cookieHeader) {
    args.push('-b', cookieHeader);
  }

  args.push('--output', outputPath);
  args.push(targetUrl);
  return args;
}

async function runCurl(args) {
  return await new Promise((resolve) => {
    const child = spawn('curl', args, { windowsHide: true });
    const stderrChunks = [];

    child.stderr.on('data', (d) => stderrChunks.push(Buffer.from(d)));
    child.on('error', (err) => {
      resolve({ ok: false, code: -1, stderr: Buffer.concat(stderrChunks).toString('utf8'), error: err?.message || String(err) });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code, stderr: Buffer.concat(stderrChunks).toString('utf8') });
    });
  });
}

async function main() {
  const targetUrl = process.argv[2];
  if (!targetUrl || !String(targetUrl).startsWith('http')) {
    fail('Missing URL arg. Example: node torrents/test/curl-test.js "https://www.torrentleech.org/download/<fid>/<name>.torrent"');
    return;
  }

  const reqBrowserPath = REQ_BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
  if (!reqBrowserPath) {
    fail(`Missing curl profile file. Tried:\n- ${REQ_BROWSER_CANDIDATES.join('\n- ')}`);
    return;
  }

  const raw = fs.readFileSync(reqBrowserPath, 'utf8');
  const profile = parseReqBrowserTxt(raw);

  // req-browser.txt is an immutable template; patch cf_clearance in-memory from local file.
  let localTlCf = '';
  try {
    const cfPath = path.join(WORKSPACE_ROOT, 'torrents', 'cookies', 'cf-clearance.local.json');
    if (fs.existsSync(cfPath)) {
      const j = JSON.parse(fs.readFileSync(cfPath, 'utf8'));
      if (j && typeof j === 'object' && !Array.isArray(j) && typeof j.torrentleech === 'string') {
        localTlCf = j.torrentleech.trim();
      }
    }
  } catch {
    // ignore
  }

  const patchedCookieHeader = localTlCf
    ? upsertCookieValue(profile.cookieHeader, 'cf_clearance', localTlCf)
    : profile.cookieHeader;

  // Use the profile’s headers/cookies, but replace the URL with the CLI arg.
  // (We do NOT edit req-browser.txt.)
  const outDir = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(outDir, { recursive: true });

  const args = buildCurlArgs(targetUrl, {
    headers: profile.headers,
    cookieHeader: patchedCookieHeader,
    outputPath: OUTPUT_PATH,
  });

  console.log('[curl-test] profile', {
    reqBrowserPath,
    profileUrl: profile.url || null,
    headerNames: Object.keys(profile.headers || {}).sort(),
    hasCookies: Boolean(patchedCookieHeader),
    hasLocalCf: Boolean(localTlCf),
    output: OUTPUT_PATH,
    targetUrl,
  });

  const res = await runCurl(args);
  if (!res.ok) {
    console.error('[curl-test] curl failed', { code: res.code, error: res.error });
    if (res.stderr) console.error('[curl-test] curl stderr', res.stderr.slice(0, 4000));
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(OUTPUT_PATH)) {
    fail(`curl reported success but output missing: ${OUTPUT_PATH}`);
    return;
  }

  const buf = fs.readFileSync(OUTPUT_PATH);
  console.log('[curl-test] wrote', { bytes: buf.length, output: OUTPUT_PATH });

  // Very light sanity check: torrent files are bencoded and typically start with 'd'.
  const firstByte = buf[0];
  if (firstByte !== 'd'.charCodeAt(0)) {
    console.warn('[curl-test] warning: output does not look like bencoded torrent (first byte != "d")');
  }
}

main().catch((e) => {
  console.error('[curl-test] exception', e?.message || String(e));
  process.exitCode = 1;
});
