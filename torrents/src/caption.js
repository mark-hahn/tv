import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
 
/**
 * Check if a torrent has captions/subtitles by fetching its detail page
 * @param {string} detailUrl - The URL to the torrent detail page
 * @param {string} provider - The torrent provider (iptorrents or torrentleech)
 * @returns {Promise<boolean>} - True if captions are found, false otherwise
 */
export async function hasCaptions(detailUrl, provider) {
  try {
    // Fetch the detail page using native https/http module
    const html = await fetchWithRedirects(detailUrl);
    
    // Save the HTML to sample-torrents folder
    const sampleDir = path.join(__dirname, '..', '..', 'sample-torrents');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(sampleDir)) {
      fs.mkdirSync(sampleDir, { recursive: true });
    }
    
    // Determine filename based on provider
    let filename;
    if (provider.toLowerCase() === 'iptorrents') {
      filename = 'iptorrents-detail.html';
    } else if (provider.toLowerCase() === 'torrentleech') {
      filename = 'torrentleech-detail.html';
    } else {
      filename = `${provider}-detail.html`;
    }
    
    const filePath = path.join(sampleDir, filename);
    
    // Write HTML to file
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`Saved detail page to: ${filePath}`);
    
    // For now, always return true
    // TODO: Parse HTML to actually check for captions/subtitles
    return true;
    
  } catch (error) {
    console.error('Error checking captions:', error);
    return false;
  }
}

/**
 * Fetch URL with automatic redirect following
 * @param {string} url - URL to fetch
 * @param {number} maxRedirects - Maximum number of redirects to follow
 * @returns {Promise<string>} - HTML content
 */
function fetchWithRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }
    
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    protocol.get(url, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
        const redirectUrl = res.headers.location;
        if (!redirectUrl) {
          reject(new Error('Redirect without location header'));
          return;
        }
        
        // Handle relative redirects
        const nextUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, url).href;
        
        console.log(`Following redirect to: ${nextUrl}`);
        
        // Follow the redirect
        fetchWithRedirects(nextUrl, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch detail page: ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}
