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

const SAVE_TORRENT_FILE = false;
const SAVE_DETAIL_FILE  = false;
const DOWNLOAD_DEBUG    = false;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeCookieNames(cookiePairs) {
  return (cookiePairs || [])
    .map(c => String(c).split('=')[0].trim())
    .filter(Boolean);
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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

  console.error('[torrentFile] TL curl direct download', {
    downloadUrl,
    hasProfile: Boolean(profile),
    hasCookies: Boolean(cookieHeader),
    headerKeys: Object.keys(headers || {}),
    hasLocalCf: Boolean(localCf),
  });

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
  console.log('Download function called with torrent:', torrent);

  let warning;
  
  if (!torrent.detailUrl) {
    console.log('No detailUrl available for torrent');
    return fail('validate', 'No detailUrl available for torrent');
  }
  
  try {
    // Determine provider from detailUrl
    const provider = normalizeProvider(torrent.raw?.provider, torrent.detailUrl);
    const filename = provider === 'iptorrents' ? 'ipt-detail.html' : 
                     provider === 'torrentleech' ? 'tl-detail.html' : 
                     `${provider}-detail.html`;
    
    console.log(`Fetching detail page from: ${torrent.detailUrl}`);
    console.log('Provider:', provider);
    console.log('Available cf_clearance keys:', Object.keys(cfClearance));

    console.error('[download] start', {
      provider,
      detailUrl: torrent?.detailUrl,
      fid: torrent?.raw?.fid,
      filename: torrent?.raw?.filename,
      hasCfClearance: Boolean(cfClearance && typeof cfClearance === 'object' && cfClearance[provider]),
    });
    
    // Load all cookies from the cookie file for this provider
    let allCookies = [];
    const cookieFile = provider === 'iptorrents' ? 'iptorrents.json' : 
                       provider === 'torrentleech' ? 'torrentleech.json' : null;
    
    if (cookieFile) {
      const cookiePath = path.join(__dirname, '..', 'cookies', cookieFile);
      try {
        const cookieData = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
        // Get all cookies EXCEPT cf_clearance (that comes from localStorage)
        allCookies = cookieData
          .filter(c => c.name !== 'cf_clearance')
          .map(c => `${c.name}=${c.value}`);
        console.log(`Loaded ${allCookies.length} cookies from ${cookieFile}:`, allCookies.map(c => c.split('=')[0]));
      } catch (err) {
        console.log(`Could not load cookie file ${cookieFile}:`, err.message);
      }
    }
    
    // Get cf_clearance cookie for this provider from localStorage
    const cfCookie = cfClearance[provider] || '';
    if (cfCookie) {
      console.log(`Using cf_clearance for ${provider}: ${cfCookie.substring(0, 30)}...`);
      allCookies.push(`cf_clearance=${cfCookie}`);
    } else {
      console.log('WARNING: No cf_clearance cookie found for provider:', provider);
      console.log('Available providers in cfClearance:', Object.keys(cfClearance));
    }
    
    // Fetch the detail page with all cookies
    const detailUrl = torrent.detailUrl;
    const detailOrigin = new URL(detailUrl).origin;
    const referer =
      provider === 'iptorrents'
        ? 'https://iptorrents.com/'
        : provider === 'torrentleech'
          ? 'https://www.torrentleech.org/'
          : `${detailOrigin}/`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': referer
    };

    const torrentHeaders = {
      ...headers,
      // Prefer binary content-types for direct .torrent downloads.
      'Accept': 'application/x-bittorrent,application/octet-stream,*/*;q=0.8',
    };
    
    if (allCookies.length > 0) {
      headers['Cookie'] = allCookies.join('; ');
      console.log('Sending cookies:', allCookies.join('; ').substring(0, 200) + '...');
    }
    
    console.log('Request headers:', JSON.stringify(headers, null, 2));

    let absoluteDownloadUrl;
    let torrentResponse;

    // Safe improvement: for TL, attempt the direct download URL first using fid + filename.
    // If it doesn't yield a torrent, fall back to the detail-page scrape.
    if (provider === 'torrentleech') {
      const fid = torrent?.raw?.fid;
      const rawFilename = torrent?.raw?.filename;
      if (fid && rawFilename && String(rawFilename).toLowerCase().endsWith('.torrent')) {
        const directUrl = `https://www.torrentleech.org/download/${encodeURIComponent(String(fid))}/${encodeURIComponent(String(rawFilename))}`;
        try {
          console.error('[TL] direct .torrent attempt', { directUrl });
          const r = await fetch(directUrl, { headers: torrentHeaders });
          const ct = (r.headers?.get?.('content-type') || '').toLowerCase();

          console.error('[TL] direct .torrent response', {
            httpStatus: r.status,
            httpStatusText: r.statusText,
            contentType: ct,
          });

          if (r.ok && !ct.includes('text/html')) {
            absoluteDownloadUrl = directUrl;
            torrentResponse = r;
            console.error('[TL] direct .torrent accepted', { downloadUrl: absoluteDownloadUrl });
          } else {
            // If we got HTML or a failure, fall back to fetching the detail page.
            try {
              const body = await r.text();
              console.error('[TL] direct .torrent rejected; falling back to detail page', {
                httpStatus: r.status,
                httpStatusText: r.statusText,
                contentType: ct,
                isCloudflare: looksLikeCloudflareChallenge(body),
                bodyHead: String(body || '').slice(0, 200),
              });
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore and fall back
        }
      }
    }

    const sampleDir = path.join(__dirname, '..', '..', 'samples', 'sample-torrents');
    let savedDetailPath;

    // Some providers (notably TL) may hand us a direct .torrent URL as detailUrl.
    // In that case, skip detail-page scraping and go straight to downloading.
    if (!torrentResponse && typeof detailUrl === 'string' && detailUrl.toLowerCase().endsWith('.torrent')) {
      absoluteDownloadUrl = detailUrl;
      console.error('[download] detailUrl looks like a direct .torrent; downloading directly', {
        provider,
        downloadUrl: absoluteDownloadUrl,
      });
      torrentResponse = await fetch(absoluteDownloadUrl, { headers: torrentHeaders });
    }

    let html;
    if (!torrentResponse) {
      console.log('Fetching detail page URL:', detailUrl);

      const response = await fetch(detailUrl, { headers });
      console.log('Detail page fetch response status:', response.status, response.statusText);
      console.log('Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));

      if (!response.ok) {
        console.log(`Failed to fetch detail page: ${response.status} ${response.statusText}`);
        const snippet = await response.text().catch(() => '');
        const isCloudflare = looksLikeCloudflareChallenge(snippet);
        if (provider === 'torrentleech') {
          const s = String(snippet || '').toLowerCase();
          const tags = [];
          if (
            s.includes('cloudflare') ||
            s.includes('cf-chl') ||
            s.includes('cf-ray') ||
            s.includes('attention required') ||
            s.includes('just a moment') ||
            s.includes('checking your browser') ||
            s.includes('verify you are human') ||
            s.includes('enable javascript and cookies')
          ) tags.push('cloudflare');
          if (s.includes('sign in') || s.includes('login') || s.includes('loginform') || s.includes('type="password"')) tags.push('login');
          if (s.includes('forbidden') || s.includes('access denied') || s.includes('not authorized')) tags.push('forbidden');
          console.error('[TL] Detail fetch failed summary:', {
            httpStatus: response.status,
            httpStatusText: response.statusText,
            hasCfClearance: Boolean(cfCookie),
            cfLen: cfCookie ? String(cfCookie).length : 0,
            cookiesSent: safeCookieNames(allCookies),
            tags,
            bodyHead: snippet ? String(snippet).slice(0, 200) : '',
          });
        }
        console.log('Response body snippet:', snippet.substring(0, 1000));
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

      html = await response.text();
      console.log(`Fetched ${html.length} bytes of HTML`);

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
      if (SAVE_DETAIL_FILE || DOWNLOAD_DEBUG) {
        ensureDir(sampleDir);
        savedDetailPath = path.join(sampleDir, filename.replace('.html', `-${nowStamp()}.html`));
        fs.writeFileSync(savedDetailPath, html, 'utf8');
        console.log(`Saved detail page to: ${savedDetailPath}`);
      }

      // Check if we got a sign-in page
      const isSignInPage = html.toLowerCase().includes('sign in') ||
        html.toLowerCase().includes('login') ||
        html.toLowerCase().includes('loginform') ||
        html.includes('type="password"');

      if (isSignInPage) {
        console.log('ERROR: Got sign-in page instead of detail page!');
        console.log('First 500 chars of HTML:');
        console.log(html.substring(0, 500));

        if (!savedDetailPath) {
          ensureDir(sampleDir);
          savedDetailPath = path.join(sampleDir, filename.replace('.html', `-signin-${nowStamp()}.html`));
          fs.writeFileSync(savedDetailPath, html, 'utf8');
          console.log(`Saved sign-in page to: ${savedDetailPath} for inspection`);
        }

        return fail('parse-detail', 'Got sign-in/login page instead of detail page', {
          provider,
          detailUrl,
          cookiesSent: safeCookieNames(allCookies),
          hasCfClearance: Boolean(cfCookie),
          savedFile: savedDetailPath,
        });
      }

      // Search for .torrent download link
      const torrentLinkPattern = /<a[^>]*href="([^"]*\.torrent)"[^>]*>/i;
      const match = html.match(torrentLinkPattern);

      if (!match) {
        console.log('ERROR: No .torrent download link found!');
        return fail('parse-detail', 'No .torrent download link found in HTML', {
          provider,
          detailUrl,
          savedFile: savedDetailPath,
        });
      }

      const downloadUrl = match[1];
      console.log(`Found download link: ${downloadUrl}`);

      // Convert relative URL to absolute
      absoluteDownloadUrl = downloadUrl;
      if (!downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
        const baseUrl = new URL(torrent.detailUrl);
        if (downloadUrl.startsWith('/')) {
          absoluteDownloadUrl = `${baseUrl.protocol}//${baseUrl.host}${downloadUrl}`;
        } else {
          absoluteDownloadUrl = `${baseUrl.protocol}//${baseUrl.host}/${downloadUrl}`;
        }
      }

      console.log(`Downloading from: ${absoluteDownloadUrl}`);

      console.error('[download] using scraped .torrent URL', {
        provider,
        downloadUrl: absoluteDownloadUrl,
      });

      // Fetch the .torrent file with same cookies
      torrentResponse = await fetch(absoluteDownloadUrl, { headers: torrentHeaders });
    }
    
    if (!torrentResponse.ok) {
      console.log(`Failed to download torrent: ${torrentResponse.status} ${torrentResponse.statusText}`);
      const snippet = await torrentResponse.text().catch(() => '');
      const isCloudflare = looksLikeCloudflareChallenge(snippet);
      console.error('[download] .torrent fetch failed', {
        provider,
        downloadUrl: absoluteDownloadUrl,
        httpStatus: torrentResponse.status,
        httpStatusText: torrentResponse.statusText,
        isCloudflare,
        bodyHead: String(snippet || '').slice(0, 200),
      });

      // TL-specific fallback: if fetch is blocked by Cloudflare, try invoking curl.
      if (provider === 'torrentleech' && isCloudflare && absoluteDownloadUrl) {
        try {
          const profile = tryLoadBrowserCurlProfile();
          const cookieHeader =
            (profile?.cookieHeader && profile.cookieHeader.includes('cf_clearance='))
              ? profile.cookieHeader
              : (allCookies.length > 0 ? allCookies.join('; ') : '');

          // Use the more browser-like header set when available.
          const curlHeaders = profile?.headers && Object.keys(profile.headers).length > 0
            ? profile.headers
            : {
                accept: torrentHeaders['Accept'],
                'accept-language': headers['Accept-Language'],
                'cache-control': 'no-cache',
                pragma: 'no-cache',
                'user-agent': headers['User-Agent'],
              };

          console.error('[TL] Cloudflare via fetch; trying curl', {
            downloadUrl: absoluteDownloadUrl,
            usingProfile: Boolean(profile),
            profilePath: profile?.path,
            cookieNames: safeCookieNames(cookieHeader.split(';').map(s => s.trim()).filter(Boolean)),
          });

          const r = await curlFetchBinary(absoluteDownloadUrl, { headers: curlHeaders, cookieHeader });
          if (r.ok) {
            const head = r.stdout.slice(0, 256).toString('utf8');
            const looksHtml = head.trim().startsWith('<') || looksLikeCloudflareChallenge(head);
            if (!looksHtml) {
              console.error('[TL] curl download ok', { bytes: r.stdout.length });
              // Continue with normal pipeline using the curl result.
              const torrentData = r.stdout;
              console.log(`Downloaded ${torrentData.length} bytes (curl)`);

              // Validate torrent content (same as normal path)
              try {
                const parsedTorrent = parseTorrent(torrentData);
                const files = Array.isArray(parsedTorrent?.files) ? parsedTorrent.files : [];
                const allPaths = files.map(f => String(f?.path || f?.name || '')).filter(Boolean);

                const pathsToCheck = allPaths.filter(isVideoFile);
                const checkList = pathsToCheck.length > 0 ? pathsToCheck : allPaths;

                const parsedByFile = [];
                let missing = false;

                for (const p of checkList) {
                  const base = path.basename(p);
                  const noExt = base.replace(/\.[^.]+$/, '');
                  const info = parseTorrentTitle.parse(noExt);
                  parsedByFile.push({ file: p, parsed: info });
                  if (!info?.season || !info?.episode) missing = true;
                }

                console.error('parse-torrent files:', checkList);
                console.error('parse-torrent-title results:', parsedByFile.map(x => ({ file: x.file, season: x.parsed?.season, episode: x.parsed?.episode })));

                if (missing) {
                  return fail('validate-torrent-files', 'Torrent file name is missing a season or episode number.', {
                    fileCount: allPaths.length,
                    checkedCount: checkList.length,
                    checkedFiles: parsedByFile.map(x => ({ file: x.file, parsed: x.parsed }))
                  });
                }
              } catch (e) {
                return fail('parse-torrent', e?.message || String(e));
              }

              // From here, reuse the existing upload pipeline: fall through by emulating torrentResponse buffer.
              // We do this by stashing torrentData and skipping the fetch-returned failure.
              torrentResponse = null;

              // Generate simple hash from random number
              const hash = Math.random().toString(36).substring(2, 15);
              const torrentFilename = `${hash}.torrent`;

              // Save .torrent file to sample-torrents directory
              if (SAVE_TORRENT_FILE) {
                const sampleDir = path.join(__dirname, '..', '..', 'samples', 'sample-torrents');
                ensureDir(sampleDir);
                const torrentSavePath = path.join(sampleDir, torrentFilename);
                fs.writeFileSync(torrentSavePath, torrentData);
                console.log(`Saved torrent to: ${torrentSavePath}`);
              }

              // Upload to remote SFTP server
              let sftpConfig;
              let remoteWatchDir;
              try {
                ({ sftpConfig, remoteWatchDir } = await getSftpSettings());
              } catch (e) {
                return fail('sftp-config', e?.message || String(e), { provider });
              }
              const remotePath = `${remoteWatchDir}/${torrentFilename}`;

              console.log(`\nUploading to SFTP server...`);
              console.log(`Remote path: ${remotePath}`);

              const sftp = new Client();
              try {
                await sftp.connect(sftpConfig);
                console.log('Connected to SFTP server');

                await sftp.put(torrentData, remotePath);
                console.log(`Successfully uploaded to ${remotePath}`);

                await sftp.end();
              } catch (sftpError) {
                console.error('SFTP upload failed:', sftpError.message);
                warning = `SFTP upload failed: ${sftpError.message}`;
              }

              return ok({
                provider,
                downloadUrl: absoluteDownloadUrl,
                detailUrl,
                cookiesSent: safeCookieNames(cookieHeader.split(';').map(s => s.trim()).filter(Boolean)),
                hasCfClearance: Boolean(cookieHeader && cookieHeader.includes('cf_clearance=')),
                method: 'curl',
                warning,
              });
            }
            console.error('[TL] curl returned HTML/challenge', { bytes: r.stdout.length, head: head.slice(0, 200) });
          } else {
            console.error('[TL] curl failed', { code: r.code, error: r.error, stderr: r.stderr.toString('utf8').slice(0, 400) });
          }
        } catch (e) {
          console.error('[TL] curl fallback exception', e?.message || String(e));
        }
      }

      return fail('fetch-torrent', 'Failed to download torrent', {
        provider,
        downloadUrl: absoluteDownloadUrl,
        httpStatus: torrentResponse.status,
        httpStatusText: torrentResponse.statusText,
        cookiesSent: safeCookieNames(allCookies),
        hasCfClearance: Boolean(cfCookie),
        bodySnippet: snippet ? snippet.substring(0, 500) : undefined,
      });
    }
    
    // Get the file content as buffer
    const torrentBuffer = await torrentResponse.arrayBuffer();
    const torrentData = Buffer.from(torrentBuffer);
    console.log(`Downloaded ${torrentData.length} bytes`);

    console.error('[download] .torrent downloaded', {
      provider,
      downloadUrl: absoluteDownloadUrl,
      bytes: torrentData.length,
      contentType: (torrentResponse.headers?.get?.('content-type') || ''),
    });

    // Validate torrent content: each relevant file name must contain season & episode.
    // If missing, abort BEFORE sending to the watch folder.
    try {
      const parsedTorrent = parseTorrent(torrentData);
      const files = Array.isArray(parsedTorrent?.files) ? parsedTorrent.files : [];
      const allPaths = files.map(f => String(f?.path || f?.name || '')).filter(Boolean);

      // Prefer video files for validation (avoid NFO/SRT triggering false failures).
      const pathsToCheck = allPaths.filter(isVideoFile);
      const checkList = pathsToCheck.length > 0 ? pathsToCheck : allPaths;

      const parsedByFile = [];
      let missing = false;

      for (const p of checkList) {
        const base = path.basename(p);
        const noExt = base.replace(/\.[^.]+$/, '');
        const info = parseTorrentTitle.parse(noExt);
        parsedByFile.push({ file: p, parsed: info });
        if (!info?.season || !info?.episode) missing = true;
      }

      // For testing: log parse results.
      console.error('parse-torrent files:', checkList);
      console.error('parse-torrent-title results:', parsedByFile.map(x => ({ file: x.file, season: x.parsed?.season, episode: x.parsed?.episode })));

      if (missing) {
        return fail('validate-torrent-files', 'Torrent file name is missing a season or episode number.', {
          fileCount: allPaths.length,
          checkedCount: checkList.length,
          checkedFiles: parsedByFile.map(x => ({ file: x.file, parsed: x.parsed }))
        });
      }
    } catch (e) {
      return fail('parse-torrent', e?.message || String(e));
    }

    const contentType = torrentResponse.headers?.get?.('content-type') || '';
    if (DOWNLOAD_DEBUG && contentType.toLowerCase().includes('text/html')) {
      ensureDir(sampleDir);
      const savePath = path.join(sampleDir, `${provider}-torrent-html-${nowStamp()}.html`);
      fs.writeFileSync(savePath, torrentData.toString('utf8'), 'utf8');
      console.log(`WARNING: Torrent download returned HTML. Saved to: ${savePath}`);
      return fail('fetch-torrent', 'Torrent download returned HTML (likely blocked/login)', {
        provider,
        downloadUrl: absoluteDownloadUrl,
        contentType,
        savedFile: savePath,
      });
    }
    
    // Generate simple hash from random number
    const hash = Math.random().toString(36).substring(2, 15);
    const torrentFilename = `${hash}.torrent`;
    
    // Save .torrent file to sample-torrents directory
    if (SAVE_TORRENT_FILE) {
      ensureDir(sampleDir);
      const torrentSavePath = path.join(__dirname, '..', '..', 'samples', 'sample-torrents', torrentFilename);
      fs.writeFileSync(torrentSavePath, torrentData);
      console.log(`Saved torrent to: ${torrentSavePath}`);
    }
    
    // Upload to remote SFTP server
    let sftpConfig;
    let remoteWatchDir;
    try {
      ({ sftpConfig, remoteWatchDir } = await getSftpSettings());
    } catch (e) {
      return fail('sftp-config', e?.message || String(e), { provider });
    }
    const remotePath = `${remoteWatchDir}/${torrentFilename}`;
    
    console.log(`\nUploading to SFTP server...`);
    console.log(`Remote path: ${remotePath}`);
    
    const sftp = new Client();
    try {
      await sftp.connect(sftpConfig);
      console.log('Connected to SFTP server');
      
      await sftp.put(torrentData, remotePath);
      console.log(`Successfully uploaded to ${remotePath}`);
      
      await sftp.end();
    } catch (sftpError) {
      console.error('SFTP upload failed:', sftpError.message);
      // Don't fail the whole download if SFTP fails
      warning = `SFTP upload failed: ${sftpError.message}`;
    }
    
  } catch (error) {
    console.error('Error in download function:', error);
    return fail('exception', error?.message || String(error));
  }

  return ok(typeof warning === 'string' ? { warning } : undefined);
}

