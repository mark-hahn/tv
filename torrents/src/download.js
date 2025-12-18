import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
    
    if (allCookies.length > 0) {
      headers['Cookie'] = allCookies.join('; ');
      console.log('Sending cookies:', allCookies.join('; ').substring(0, 200) + '...');
    }
    
    console.log('Request headers:', JSON.stringify(headers, null, 2));
    
    const response = await fetch(detailUrl, { headers });
    if (!response.ok) {
      console.log(`Failed to fetch detail page: ${response.status} ${response.statusText}`);
      const snippet = await response.text().catch(() => '');
      return fail('fetch-detail', 'Failed to fetch detail page', {
        provider,
        detailUrl,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        cookiesSent: safeCookieNames(allCookies),
        hasCfClearance: Boolean(cfCookie),
        bodySnippet: snippet ? snippet.substring(0, 500) : undefined,
      });
    }
    
    const html = await response.text();
    console.log(`Fetched ${html.length} bytes of HTML`);

    const sampleDir = path.join(__dirname, '..', '..', 'sample-torrents');
    let savedDetailPath;
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
    let absoluteDownloadUrl = downloadUrl;
    if (!downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
      const baseUrl = new URL(torrent.detailUrl);
      if (downloadUrl.startsWith('/')) {
        absoluteDownloadUrl = `${baseUrl.protocol}//${baseUrl.host}${downloadUrl}`;
      } else {
        absoluteDownloadUrl = `${baseUrl.protocol}//${baseUrl.host}/${downloadUrl}`;
      }
    }
    
    console.log(`Downloading from: ${absoluteDownloadUrl}`);
    
    // Fetch the .torrent file with same cookies
    const torrentResponse = await fetch(absoluteDownloadUrl, { headers });
    
    if (!torrentResponse.ok) {
      console.log(`Failed to download torrent: ${torrentResponse.status} ${torrentResponse.statusText}`);
      const snippet = await torrentResponse.text().catch(() => '');
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
      const torrentSavePath = path.join(__dirname, '..', '..', 'sample-torrents', torrentFilename);
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

