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
    // Load cookies for authentication
    const cookies = await loadCookies(provider);
    
    // Fetch the detail page using native https/http module with cookies
    const html = await fetchWithRedirects(detailUrl, 5, cookies);
    
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
 * Load cookies from the cookies folder
 * @param {string} provider - The torrent provider (iptorrents or torrentleech)
 * @returns {Promise<Array>} - Array of cookie objects
 */
async function loadCookies(provider) {
  const cookiesDir = path.join(__dirname, '..', 'cookies');
  let filename;
  
  if (provider.toLowerCase() === 'iptorrents') {
    filename = 'iptorrents.json';
  } else if (provider.toLowerCase() === 'torrentleech') {
    filename = 'torrentleech.json';
  } else {
    return [];
  }
  
  const filePath = path.join(cookiesDir, filename);
  
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading cookies for ${provider}:`, error);
    return [];
  }
}

/**
 * Convert cookie array to Cookie header string
 * @param {Array} cookies - Array of cookie objects
 * @returns {string} - Cookie header string
 */
function cookiesToHeader(cookies) {
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Fetch URL with automatic redirect following
 * @param {string} url - URL to fetch
 * @param {number} maxRedirects - Maximum number of redirects to follow
 * @param {Array} cookies - Array of cookie objects for authentication
 * @returns {Promise<string>} - HTML content
 */
function fetchWithRedirects(url, maxRedirects = 5, cookies = []) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }
    
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      headers: {}
    };
    
    // Add cookies if provided
    if (cookies && cookies.length > 0) {
      options.headers['Cookie'] = cookiesToHeader(cookies);
    }
    
    protocol.get(url, options, (res) => {
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
        
        // Follow the redirect with cookies
        fetchWithRedirects(nextUrl, maxRedirects - 1, cookies)
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
