import fs from 'fs';
import https from 'https';
import zlib from 'zlib';

// Load cookies
const cookiesJson = JSON.parse(fs.readFileSync('./cookies/iptorrents.json', 'utf8'));
const cookieString = cookiesJson.map(c => `${c.name}=${c.value}`).join('; ');

console.log('Testing IPTorrents access...');
console.log('Cookie string:', cookieString.substring(0, 100) + '...\n');

// Test search page
const options = {
  hostname: 'iptorrents.com',
  path: '/t?q=3rd+rock+from+the+sun&qf=',
  method: 'GET',
  headers: {
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
};

const req = https.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  console.log(`Headers:`, JSON.stringify(res.headers, null, 2));
  
  // Handle gzip encoding
  const gunzip = zlib.createGunzip();
  res.pipe(gunzip);
  
  let data = '';
  gunzip.on('data', (chunk) => {
    data += chunk.toString();
  });
  
  gunzip.on('end', () => {
    console.log('\n--- Response Preview (first 2000 chars) ---');
    console.log(data.substring(0, 2000));
    console.log('\n--- End Preview ---\n');
    
    // Check for common indicators
    if (data.includes('Cloudflare')) {
      console.log('⚠️  Cloudflare challenge detected');
    }
    if (data.includes('login') || data.includes('Login')) {
      console.log('⚠️  Login page detected - cookies may be expired');
    }
    if (data.includes('torrent')) {
      console.log('✅ Torrent content found');
    }
    if (data.includes('<table')) {
      console.log('✅ Table found (likely torrent results)');
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.end();
