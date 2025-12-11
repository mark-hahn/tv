import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Client from 'ssh2-sftp-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAVE_TORRENT_FILE = false;
const SAVE_DETAIL_FILE  = false;

// SFTP server configuration
const SFTP_CONFIG = {
  host: 'oracle.usbx.me',
  port: 22,
  username: 'xobtlu',
  password: '90-TYUrtyasd'
};
const REMOTE_WATCH_DIR = '/home/xobtlu/watch/qbittorrent';

/**
 * Download torrent and prepare for qBittorrent
 * @param {Object} torrent - The complete torrent object
 * @param {Object} cfClearance - cf_clearance cookies by provider
 * @returns {Promise<boolean>} - True if successful
 */
export async function download(torrent, cfClearance = {}) {
  console.log('Download function called with torrent:', torrent);
  
  if (!torrent.detailUrl) {
    console.log('No detailUrl available for torrent');
    return false;
  }
  
  try {
    // Determine provider from detailUrl
    const provider = torrent.raw?.provider?.toLowerCase() || 'unknown';
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
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': torrent.detailUrl.includes('iptorrents') ? 'https://iptorrents.com/' : 'https://www.torrentleech.org/'
    };
    
    if (allCookies.length > 0) {
      headers['Cookie'] = allCookies.join('; ');
      console.log('Sending cookies:', allCookies.join('; ').substring(0, 200) + '...');
    }
    
    console.log('Request headers:', JSON.stringify(headers, null, 2));
    
    const response = await fetch(torrent.detailUrl, { headers });
    if (!response.ok) {
      console.log(`Failed to fetch detail page: ${response.status} ${response.statusText}`);
      return false;
    }
    
    const html = await response.text();
    console.log(`Fetched ${html.length} bytes of HTML`);
    
    // Check if we got a sign-in page
    const isSignInPage = html.toLowerCase().includes('sign in') || 
                         html.toLowerCase().includes('login') ||
                         html.toLowerCase().includes('loginform') ||
                         html.includes('type="password"');
    
    if (isSignInPage) {
      console.log('ERROR: Got sign-in page instead of detail page!');
      console.log('First 500 chars of HTML:');
      console.log(html.substring(0, 500));
      
      // Save it anyway for inspection
      const savePath = path.join(__dirname, '..', '..', 'sample-torrents', filename);
      fs.writeFileSync(savePath, html, 'utf8');
      console.log(`Saved sign-in page to: ${savePath} for inspection`);
      return false;
    }
    
    // Save HTML to sample-torrents directory
    if (SAVE_DETAIL_FILE) {
      const savePath = path.join(__dirname, '..', '..', 'sample-torrents', filename);
      fs.writeFileSync(savePath, html, 'utf8');
      console.log(`Saved detail page to: ${savePath}`);
    }
    
    // Search for .torrent download link
    const torrentLinkPattern = /<a[^>]*href="([^"]*\.torrent)"[^>]*>/i;
    const match = html.match(torrentLinkPattern);
    
    if (!match) {
      console.log('ERROR: No .torrent download link found!');
      return false;
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
      return false;
    }
    
    // Get the file content as buffer
    const torrentBuffer = await torrentResponse.arrayBuffer();
    const torrentData = Buffer.from(torrentBuffer);
    console.log(`Downloaded ${torrentData.length} bytes`);
    
    // Generate simple hash from random number
    const hash = Math.random().toString(36).substring(2, 15);
    const torrentFilename = `${hash}.torrent`;
    
    // Save .torrent file to sample-torrents directory
    if (SAVE_TORRENT_FILE) {
      const torrentSavePath = path.join(__dirname, '..', '..', 'sample-torrents', torrentFilename);
      fs.writeFileSync(torrentSavePath, torrentData);
      console.log(`Saved torrent to: ${torrentSavePath}`);
    }
    
    // Upload to remote SFTP server
    const remotePath = `${REMOTE_WATCH_DIR}/${torrentFilename}`;
    
    console.log(`\nUploading to SFTP server...`);
    console.log(`Remote path: ${remotePath}`);
    
    const sftp = new Client();
    try {
      await sftp.connect(SFTP_CONFIG);
      console.log('Connected to SFTP server');
      
      await sftp.put(torrentData, remotePath);
      console.log(`Successfully uploaded to ${remotePath}`);
      
      await sftp.end();
    } catch (sftpError) {
      console.error('SFTP upload failed:', sftpError.message);
      // Don't fail the whole download if SFTP fails
    }
    
  } catch (error) {
    console.error('Error in download function:', error);
    return false;
  }
  
  return true;
}

