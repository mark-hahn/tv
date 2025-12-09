import fs from 'fs';
import https from 'https';
import zlib from 'zlib';
import { JSDOM } from 'jsdom';

// Load cookies
const cookiesJson = JSON.parse(fs.readFileSync('./cookies/iptorrents.json', 'utf8'));
const cookieString = cookiesJson.map(c => `${c.name}=${c.value}`).join('; ');

console.log('Testing IPTorrents HTML structure...');
console.log('Cookie string:', cookieString.substring(0, 100) + '...\n');

// Test search page
const options = {
  hostname: 'iptorrents.com',
  path: '/t?q=3rd+rock+from+the+sun&o=seeders',
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
    console.log('\n--- Analyzing HTML Structure ---\n');
    
    // Parse HTML
    const dom = new JSDOM(data);
    const document = dom.window.document;
    
    // Check for common indicators
    if (data.includes('Cloudflare')) {
      console.log('⚠️  Cloudflare challenge detected');
      return;
    }
    if (data.includes('login') || data.includes('Login')) {
      console.log('⚠️  Login page detected - cookies may be expired');
      return;
    }
    
    // Find the torrents table
    const tables = document.querySelectorAll('table');
    console.log(`Found ${tables.length} table(s)`);
    
    // Look for table with id="torrents" or class containing torrent info
    tables.forEach((table, idx) => {
      const id = table.getAttribute('id');
      const className = table.getAttribute('class');
      console.log(`\nTable ${idx}: id="${id}", class="${className}"`);
      
      if (id === 'torrents' || className?.includes('torrent')) {
        const rows = table.querySelectorAll('tr');
        console.log(`  → This table has ${rows.length} rows`);
        
        if (rows.length > 1) {
          console.log('\n  First data row structure:');
          const firstRow = rows[1];
          const cells = firstRow.querySelectorAll('td');
          cells.forEach((cell, cellIdx) => {
            const text = cell.textContent.trim().substring(0, 50);
            const links = cell.querySelectorAll('a');
            console.log(`    td[${cellIdx}]: "${text}" (${links.length} links)`);
          });
        }
      }
    });
    
    console.log('\n--- End Analysis ---');
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.end();
