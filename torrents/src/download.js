import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import Client from 'ssh2-sftp-client';
import { loadCreds } from './qb-cred.js';
import parseTorrent from 'parse-torrent';
import parseTorrentTitle from 'parse-torrent-title';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOWNLOAD_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function safeCookieNames(cookiePairs) {
  return (cookiePairs || [])
    .map(c => String(c).split('=')[0].trim())
    .filter(Boolean);
}

function fail(stage, reason, extra = {}) {
  return { success: false, error: reason, message: reason, stage, reason, ...extra };
}

function ok(extra = {}) {
  return { success: true, ...extra };
}

function looksLikeCloudflareChallenge(html) {
  const s = String(html || '').toLowerCase();
  return (
    s.includes('<title>just a moment') ||
    s.includes('checking your browser') ||
    s.includes('cf-chl') ||
    s.includes('cf-ray') ||
    s.includes('attention required') ||
    s.includes('enable javascript and cookies') ||
    s.includes('verify you are human')
  );
}

function tryLoadBrowserCurlProfile() {
  // Optional best-match replay: if misc/req-browser.txt exists (DevTools Copy as cURL (bash)),
  // we can reuse its cookie/header set when invoking curl.
  try {
    // Prefer torrents/req-browser.txt (user-provided template), fall back to misc/req-browser.txt.
    const candidates = [
      path.join(__dirname, '..', 'req-browser.txt'),
      path.join(__dirname, '..', '..', 'misc', 'req-browser.txt'),
    ];
    const p = candidates.find((x) => fs.existsSync(x));
    if (!p) return null;
    const raw = fs.readFileSync(p, 'utf8');

    const headers = {};
    let cookieHeader = '';
    let capturedUrl = '';

    // URL (single or double quoted)
    const mUrl = raw.match(/\bcurl\s+['"]([^'\"]+)['"]/i);
    if (mUrl) capturedUrl = mUrl[1];

    // -b '...'
    const mB1 = raw.match(/\s-b\s+'([^']*)'/i);
    const mB2 = raw.match(/\s-b\s+"([^\"]*)"/i);
    cookieHeader = (mB1?.[1] || mB2?.[1] || '').trim();

    // -H 'k: v' or -H "k: v"
    const reH1 = /\s-H\s+'([^']+)'/gi;
    const reH2 = /\s-H\s+"([^\"]+)"/gi;
    const pushHeader = (h) => {
      const idx = String(h).indexOf(':');
      if (idx <= 0) return;
      const k = String(h).slice(0, idx).trim().toLowerCase();
      const v = String(h).slice(idx + 1).trim();
      if (!k || !v) return;
      headers[k] = v;
    };
    let mh;
    while ((mh = reH1.exec(raw))) pushHeader(mh[1]);
    while ((mh = reH2.exec(raw))) pushHeader(mh[1]);

    // Some exports (notably Firefox) may include cookies as a header instead of -b.
    if (!cookieHeader && headers.cookie) {
      cookieHeader = String(headers.cookie || '').trim();
      delete headers.cookie;
    }

    return {
      path: p,
      url: capturedUrl,
      headers,
      cookieHeader,
    };
  } catch {
    return null;
  }
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

async function loadLocalCfClearance(provider) {
  try {
    const p = String(provider || '').trim();
    if (!p) return '';
    const inPath = path.join(__dirname, '..', 'cookies', 'cf-clearance.local.json');
    const raw = await fs.promises.readFile(inPath, 'utf8');
    const j = JSON.parse(raw);
    const v = j && typeof j === 'object' && !Array.isArray(j) ? j[p] : '';
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

async function curlFetchBinary(targetUrl, { headers = {}, cookieHeader = '' } = {}) {
  const args = ['-sS', '-L', '--compressed'];

  // Note: we intentionally do NOT pass -H 'cookie:'; use -b for cookies.
  for (const [k, v] of Object.entries(headers || {})) {
    if (!k) continue;
    if (String(k).toLowerCase() === 'cookie') continue;
    if (v == null || String(v).length === 0) continue;
    args.push('-H', `${k}: ${v}`);
  }
  if (cookieHeader) {
    args.push('-b', cookieHeader);
  }

  args.push(targetUrl);

  return await new Promise((resolve) => {
    const child = spawn('curl', args, { windowsHide: true });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (d) => stdoutChunks.push(Buffer.from(d)));
    child.stderr.on('data', (d) => stderrChunks.push(Buffer.from(d)));
    child.on('error', (err) => {
      resolve({ ok: false, code: -1, error: err?.message || String(err), stdout: Buffer.alloc(0), stderr: Buffer.concat(stderrChunks) });
    });
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      resolve({ ok: code === 0 && stdout.length > 0, code, stdout, stderr });
    });
  });
}

function isVideoFile(filePath) {
  const p = String(filePath || '');
  const ext = p.toLowerCase().split('.').pop() || '';
  return ['mkv', 'mp4', 'avi', 'm4v', 'mov', 'ts'].includes(ext);
}

function validateTorrentData(torrentData) {
  try {
    const parsedTorrent = parseTorrent(torrentData);
    const files = Array.isArray(parsedTorrent?.files) ? parsedTorrent.files : [];
    const allPaths = files.map(f => String(f?.path || f?.name || '')).filter(Boolean);

    // Prefer video files for validation (avoid NFO/SRT triggering false failures).
    const pathsToCheck = allPaths.filter(isVideoFile);
    const checkList = pathsToCheck.length > 0 ? pathsToCheck : allPaths;

    let missing = false;
    const checkedFiles = [];

    for (const p of checkList) {
      const base = path.basename(p);
      const noExt = base.replace(/\.[^.]+$/, '');
      const info = parseTorrentTitle.parse(noExt);
      checkedFiles.push({ file: p, parsed: info });
      if (!info?.season || !info?.episode) missing = true;
    }

    if (missing) {
      return fail('validate-torrent-files', 'Torrent file name is missing a season or episode number.', {
        fileCount: allPaths.length,
        checkedCount: checkList.length,
        checkedFiles,
      });
    }

    return ok();
  } catch (e) {
    return fail('parse-torrent', e?.message || String(e));
  }
}

function normalizeProvider(rawProvider, detailUrl) {
  const p = String(rawProvider || '').toLowerCase().trim();
  const url = String(detailUrl || '').toLowerCase();

  if (p === 'iptorrents' || p.includes('iptorrents') || url.includes('iptorrents')) return 'iptorrents';
  if (p === 'torrentleech' || p.includes('torrentleech') || url.includes('torrentleech')) return 'torrentleech';
  return p || 'unknown';
}

let _cachedCreds;
async function getCreds() {
  if (_cachedCreds) return _cachedCreds;
  const credPath = path.join(__dirname, '..', 'cookies', 'download-cred.txt');
  const { creds } = await loadCreds(credPath);
  _cachedCreds = creds;
  return creds;
}

function parseSshTarget(sshTarget) {
  // Basic parse for user@host (ignore ports/options)
  if (!sshTarget) return undefined;
  const at = sshTarget.lastIndexOf('@');
  if (at === -1) return { host: sshTarget };
  const user = sshTarget.slice(0, at);
  const host = sshTarget.slice(at + 1);
  return { user: user || undefined, host: host || undefined };
}

async function getSftpSettings() {
  const creds = await getCreds();

  const sshParts = parseSshTarget(creds.SSH_TARGET);

  const host = creds.SFTP_HOST || sshParts?.host;
  const port = Number(creds.SFTP_PORT || 22);
  const username = creds.SFTP_USER || creds.SFTP_USERNAME || sshParts?.user;
  const password = creds.SFTP_PASS || creds.SFTP_PASSWORD;

  const remoteWatchDir =
    creds.REMOTE_WATCH_DIR ||
    (username ? `/home/${username}/watch/qbittorrent` : undefined);

  if (!host || !username || !password) {
    throw new Error(
      'Missing SFTP config. Put SFTP_PASS and either (SFTP_HOST + SFTP_USER) or SSH_TARGET in torrents/cookies/download-cred.txt.'
    );
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid SFTP_PORT: ${port}`);
  }

  return {
    sftpConfig: { host, port, username, password },
    remoteWatchDir,
  };
}

function sanitizeFilenameForWatch(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  // Keep it simple: drop path separators and weird chars.
  return s
    .replace(/[\\/]+/g, '_')
    .replace(/[\x00-\x1F\x7F]+/g, '')
    .replace(/[^a-zA-Z0-9._\-()\[\] ]+/g, '_')
    .trim();
}

function buildTorrentLeechDirectUrlFromSearchResult(torrent) {
  const fid = torrent?.raw?.fid;
  const filename = torrent?.raw?.filename;
  if (!fid || !filename) return '';
  const f = String(filename);
  if (!f.toLowerCase().endsWith('.torrent')) return '';
  return `https://www.torrentleech.org/download/${encodeURIComponent(String(fid))}/${encodeURIComponent(f)}`;
}

/**
 * Fetch a .torrent directly from a provider using only the search-result fields.
 * NOTE: This intentionally avoids detail-page scraping.
 */
export async function fetchTorrentFileFromSearchResult(torrent) {
  const provider = normalizeProvider(torrent?.raw?.provider, torrent?.detailUrl);

  if (provider !== 'torrentleech') {
    return fail('validate', `Direct torrent download not supported for provider: ${provider}`, { provider });
  }

  const downloadUrl = buildTorrentLeechDirectUrlFromSearchResult(torrent);
  if (!downloadUrl) {
    return fail('validate', 'Missing TorrentLeech fid/filename (or filename not .torrent).', {
      provider,
      fid: torrent?.raw?.fid,
      filename: torrent?.raw?.filename,
    });
  }

  const profile = tryLoadBrowserCurlProfile();
  const headers = profile?.headers || {};
  let cookieHeader = profile?.cookieHeader || '';

  // Source of truth: cf-clearance.local.json (written by client Save Cookies).
  // req-browser.txt is treated as an immutable template; we only patch an in-memory copy.
  const localCf = await loadLocalCfClearance(provider);
  if (localCf) {
    cookieHeader = upsertCookieValue(cookieHeader, 'cf_clearance', localCf);
  }

  const r = await curlFetchBinary(downloadUrl, { headers, cookieHeader });
  const headText = r.stdout.slice(0, 600).toString('utf8');
  const looksHtml = /^\s*</.test(headText) || looksLikeCloudflareChallenge(headText);

  if (!r.ok || looksHtml) {
    const isCloudflare = looksLikeCloudflareChallenge(headText);
    return fail('fetch-torrent', r.error || 'Failed to fetch torrent via curl', {
      provider,
      downloadUrl,
      code: r.code,
      isCloudflare,
      bodyHead: headText.slice(0, 300),
      profilePath: profile?.path,
      hasProfile: Boolean(profile),
      hasCookies: Boolean(cookieHeader),
    });
  }

  return ok({
    provider,
    downloadUrl,
    bytes: r.stdout.length,
    torrentData: r.stdout,
    method: 'curl',
  });
}

/**
 * Upload a .torrent buffer to the configured remote watch folder via SFTP.
 */
export async function uploadTorrentToWatchFolder(torrentData, filenameHint = '') {
  if (!Buffer.isBuffer(torrentData) || torrentData.length === 0) {
    return fail('validate', 'No torrent data provided');
  }

  const hash = Math.random().toString(36).substring(2, 15);
  const hint = sanitizeFilenameForWatch(filenameHint);
  const base = hint ? hint.replace(/\.torrent$/i, '') : hash;
  const safeBase = String(base || hash).slice(0, 120).trim() || hash;
  const torrentFilename = `${safeBase}-${hash}.torrent`;

  let sftpConfig;
  let remoteWatchDir;
  try {
    ({ sftpConfig, remoteWatchDir } = await getSftpSettings());
  } catch (e) {
    return fail('sftp-config', e?.message || String(e));
  }

  const remotePath = `${remoteWatchDir}/${torrentFilename}`;
  const sftp = new Client();
  try {
    await sftp.connect(sftpConfig);
    await sftp.put(torrentData, remotePath);
    await sftp.end();
  } catch (e) {
    try { await sftp.end(); } catch { /* ignore */ }
    return fail('sftp-put', e?.message || String(e), { remotePath });
  }

  return ok({ remotePath, bytes: torrentData.length, filename: torrentFilename });
}

/**
 * Download torrent and prepare for qBittorrent
 * @param {Object} torrent - The complete torrent object
 * @param {Object} cfClearance - cf_clearance cookies by provider
 * @returns {Promise<{success:boolean, stage?:string, reason?:string, provider?:string, httpStatus?:number, httpStatusText?:string, savedFile?:string, cookiesSent?:string[], hasCfClearance?:boolean, downloadUrl?:string, detailUrl?:string, warning?:string}>}
 */
export async function download(torrent, cfClearance = {}) {
  if (!torrent || typeof torrent !== 'object') {
    return fail('validate', 'Torrent data is required');
  }

  const detailUrl = String(torrent?.detailUrl || '').trim();
  const provider = normalizeProvider(torrent?.raw?.provider, detailUrl);

  // TorrentLeech: direct .torrent only (no detail-page scraping).
  if (provider === 'torrentleech') {
    const fetched = await fetchTorrentFileFromSearchResult(torrent);
    if (!fetched.success) return fetched;

    const valid = validateTorrentData(fetched.torrentData);
    if (!valid.success) return valid;

    const hint = torrent?.raw?.filename || torrent?.raw?.title || 'download.torrent';
    const uploaded = await uploadTorrentToWatchFolder(fetched.torrentData, hint);
    if (!uploaded.success) return uploaded;

    return ok({
      provider,
      method: fetched.method,
      downloadUrl: fetched.downloadUrl,
      remotePath: uploaded.remotePath,
      filename: uploaded.filename,
      bytes: fetched.bytes,
    });
  }

  // Non-TL providers: use the legacy detail-page scrape pipeline.
  if (!detailUrl) {
    return fail('validate', 'No detailUrl available for torrent', { provider });
  }

  // Load cookies from provider cookie jar (excluding cf_clearance)
  let allCookies = [];
  const cookieFile = provider === 'iptorrents' ? 'iptorrents.json' : null;
  if (cookieFile) {
    const cookiePath = path.join(__dirname, '..', 'cookies', cookieFile);
    try {
      const cookieData = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      allCookies = cookieData
        .filter(c => c && c.name && c.value && c.name !== 'cf_clearance')
        .map(c => `${c.name}=${c.value}`);
    } catch {
      // ignore
    }
  }

  // Prefer local persisted cf_clearance (written by the client Save Cookies)
  const localCf = await loadLocalCfClearance(provider);
  const fallbackCf =
    cfClearance && typeof cfClearance === 'object' && typeof cfClearance[provider] === 'string'
      ? String(cfClearance[provider]).trim()
      : '';
  const cfCookie = localCf || fallbackCf;
  if (cfCookie) allCookies.push(`cf_clearance=${cfCookie}`);

  const detailOrigin = new URL(detailUrl).origin;
  const referer = provider === 'iptorrents' ? 'https://iptorrents.com/' : `${detailOrigin}/`;

  const headers = {
    'User-Agent': DOWNLOAD_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': referer,
  };
  if (allCookies.length > 0) headers['Cookie'] = allCookies.join('; ');

  const torrentHeaders = {
    ...headers,
    'Accept': 'application/x-bittorrent,application/octet-stream,*/*;q=0.8',
  };

  const response = await fetch(detailUrl, { headers });
  if (!response.ok) {
    const snippet = await response.text().catch(() => '');
    const isCloudflare = looksLikeCloudflareChallenge(snippet);
    return fail('fetch-detail', isCloudflare ? 'Cloudflare challenge page (Just a moment...)' : 'Failed to fetch detail page', {
      provider,
      detailUrl,
      httpStatus: response.status,
      httpStatusText: response.statusText,
      cookiesSent: safeCookieNames(allCookies),
      hasCfClearance: Boolean(cfCookie),
      isCloudflare,
      bodySnippet: snippet ? snippet.substring(0, 500) : undefined,
    });
  }

  const html = await response.text();
  if (looksLikeCloudflareChallenge(html)) {
    return fail('fetch-detail', 'Cloudflare challenge page (Just a moment...)', {
      provider,
      detailUrl,
      httpStatus: response.status,
      httpStatusText: response.statusText,
      cookiesSent: safeCookieNames(allCookies),
      hasCfClearance: Boolean(cfCookie),
      isCloudflare: true,
      bodySnippet: html ? String(html).slice(0, 500) : undefined,
    });
  }

  // Search for .torrent download link
  const torrentLinkPattern = /<a[^>]*href="([^"]*\.torrent)"[^>]*>/i;
  const match = html.match(torrentLinkPattern);
  if (!match) {
    return fail('parse-detail', 'No .torrent download link found in HTML', { provider, detailUrl });
  }

  // Convert relative URL to absolute
  let absoluteDownloadUrl = match[1];
  if (!absoluteDownloadUrl.startsWith('http://') && !absoluteDownloadUrl.startsWith('https://')) {
    const baseUrl = new URL(detailUrl);
    if (absoluteDownloadUrl.startsWith('/')) {
      absoluteDownloadUrl = `${baseUrl.protocol}//${baseUrl.host}${absoluteDownloadUrl}`;
    } else {
      absoluteDownloadUrl = `${baseUrl.protocol}//${baseUrl.host}/${absoluteDownloadUrl}`;
    }
  }

  const torrentResponse = await fetch(absoluteDownloadUrl, { headers: torrentHeaders });
  if (!torrentResponse.ok) {
    const snippet = await torrentResponse.text().catch(() => '');
    const isCloudflare = looksLikeCloudflareChallenge(snippet);
    return fail('fetch-torrent', 'Failed to download torrent', {
      provider,
      downloadUrl: absoluteDownloadUrl,
      httpStatus: torrentResponse.status,
      httpStatusText: torrentResponse.statusText,
      cookiesSent: safeCookieNames(allCookies),
      hasCfClearance: Boolean(cfCookie),
      isCloudflare,
      bodySnippet: snippet ? snippet.substring(0, 500) : undefined,
    });
  }

  const torrentBuffer = await torrentResponse.arrayBuffer();
  const torrentData = Buffer.from(torrentBuffer);

  const valid = validateTorrentData(torrentData);
  if (!valid.success) return valid;

  const hint = torrent?.raw?.filename || torrent?.raw?.title || 'download.torrent';
  const uploaded = await uploadTorrentToWatchFolder(torrentData, hint);
  if (!uploaded.success) return uploaded;

  return ok({
    provider,
    method: 'fetch',
    downloadUrl: absoluteDownloadUrl,
    remotePath: uploaded.remotePath,
    filename: uploaded.filename,
    bytes: torrentData.length,
  });
}

