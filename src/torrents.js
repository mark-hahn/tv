import { chromium } from "playwright";

async function searchTorrents(showName) {
  const results = [];
  
  // TorrentLeech credentials
  const TL_COOKIES = 'tluid=1781680; tlpass=4b3dced91b1d276cc6da1ceb56e2dc1f96a83ef9; PHPSESSID=kffqk34atch1e0dki3cjdnst2n; lastBrowse1=1765220543; lastBrowse2=1765222603; cf_clearance=IHtD4j6EufhyuXiQJIvlumfCaQvGQtnxOhbyEhw2KGE-1765220541-1.2.1.1-UAuc07uCbZlcjX34B1w3mlJ55mIniDK4vW5CkYuOlt8F_uzSXPDjElj5vybZyQ3eaTKcXfdFeZNZiEKvVlgyRUosuWxqTkr8aqi8M300z6fxeafksVpou43R6E8UrieBKl10NJ6yj_34wthC.JPiVznN9_fobdS0f9f8itTY5fcVCmML51Rb67gaZ9_KtI7qkxmne_djsbCvUpvJ.l.ZlK9isHayVQz_.Xc63h8NvH8';
  
  // IPTorrents credentials
  const IPT_COOKIES = 'uid=1961978; pass=HX9iHh25WA4wmZDiUPynh7p1M2OGrJRq; cf_clearance=fUFlDQHu5eTI4nVNeDO15wW5s2C5YoSeBHbeMlk9kMU-1757962029-1.2.1.1-gTTeDX0NHijjjhLv7lQexJGwQECzIkiZvT.ir_oIN6z8dvZNJUbmElu4sKystEK8HowbYA0iU.Ms9k9CexcerfTkCjpTc7EAkJH4J8llmV4YLSR4syBh5vfPxQuFRTI3Pqo4dIFBazPUuQ8Z04s.r7TF9Mk6S02QT5oRL.jNWtTTRs1eBglRf.Cp.smzPbuDpq1eOoJJZnEEwzW_ki2AjkrXWPeXXA2ld4m_ve6ov7w';
  
  const searches = [
    {
      name: 'TorrentLeech',
      url: 'https://www.torrentleech.org/torrents/browse/index/query/',
      searchParam: showName.replace(/\s+/g, '+'),
      cookies: TL_COOKIES,
      note: 'Uses Cloudflare protection - may require browser automation'
    },
    {
      name: 'IPTorrents',
      url: 'https://iptorrents.com/t?q=',
      searchParam: encodeURIComponent(showName),
      cookies: IPT_COOKIES
    }
  ];

  for (const tracker of searches) {
    try {
      const searchUrl = `${tracker.url}${tracker.searchParam}`;
      console.log(`Fetching ${tracker.name}:`, searchUrl);
      
      let html;
      
      // Use Playwright for TorrentLeech to bypass Cloudflare
      if (tracker.name === 'TorrentLeech') {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        
        // Set cookies
        const cookies = [
          { name: 'tluid', value: '1781680', domain: '.torrentleech.org', path: '/' },
          { name: 'tlpass', value: '4b3dced91b1d276cc6da1ceb56e2dc1f96a83ef9', domain: '.torrentleech.org', path: '/' },
          { name: 'PHPSESSID', value: 'kffqk34atch1e0dki3cjdnst2n', domain: '.torrentleech.org', path: '/' },
          { name: 'lastBrowse1', value: '1765220543', domain: '.torrentleech.org', path: '/' },
          { name: 'lastBrowse2', value: '1765222603', domain: '.torrentleech.org', path: '/' },
          { name: 'cf_clearance', value: 'IHtD4j6EufhyuXiQJIvlumfCaQvGQtnxOhbyEhw2KGE-1765220541-1.2.1.1-UAuc07uCbZlcjX34B1w3mlJ55mIniDK4vW5CkYuOlt8F_uzSXPDjElj5vybZyQ3eaTKcXfdFeZNZiEKvVlgyRUosuWxqTkr8aqi8M300z6fxeafksVpou43R6E8UrieBKl10NJ6yj_34wthC.JPiVznN9_fobdS0f9f8itTY5fcVCmML51Rb67gaZ9_KtI7qkxmne_djsbCvUpvJ.l.ZlK9isHayVQz_.Xc63h8NvH8', domain: '.torrentleech.org', path: '/' }
        ];
        await context.addCookies(cookies);
        
        const page = await context.newPage();
        
        try {
          await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
          // Wait for Cloudflare challenge to complete and page content to load
          try {
            // Wait for torrent table or any torrent links to appear (up to 30 seconds for Cloudflare)
            await page.waitForSelector('table.table, a[href*="/download/"]', { timeout: 30000 });
          } catch (e) {
            console.log(`${tracker.name} waiting for content timed out, grabbing what we have...`);
          }
          html = await page.content();
          console.log(`${tracker.name} status: 200 (Playwright)`);
          console.log(`${tracker.name} response length:`, html.length);
        } catch (error) {
          console.log(`${tracker.name} Playwright error:`, error.message);
          await browser.close();
          continue;
        }
        
        await browser.close();
      } else {
        // Use fetch for IPTorrents
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Cookie': tracker.cookies
        };
        
        const response = await fetch(searchUrl, { headers });

        console.log(`${tracker.name} status:`, response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.log(`${tracker.name} error response (first 500 chars):`, errorText.substring(0, 500));
          continue;
        }

        html = await response.text();
        console.log(`${tracker.name} response length:`, html.length);
      }
      
      // Save HTML to file for debugging
      const fs = await import('fs');
      const filename = `samples/torrent-${tracker.name.toLowerCase()}-${showName.replace(/\s+/g, '-')}.html`;
      await fs.promises.writeFile(filename, html);
      console.log(`${tracker.name} saved to:`, filename);
      
      // Parse HTML to extract torrent URLs
      const torrentUrls = extractTorrentUrls(html, tracker.name);
      console.log(`${tracker.name} found ${torrentUrls.length} torrents`);
      results.push(...torrentUrls);
      
    } catch (error) {
      console.error(`Error searching ${tracker.name}:`, error.message, error.cause);
    }
  }
  
  console.log(`Total torrents found: ${results.length}`);
  return results;
}

// Helper function to extract torrent URLs from HTML
function extractTorrentUrls(html, trackerName) {
  const urls = [];
  
  if (trackerName === 'TorrentLeech') {
    // TorrentLeech structure: find download links
    // Example: <a href="/download/1234567/filename.torrent">
    const downloadRegex = /<a[^>]+href="(\/download\/[^"]+)"/gi;
    let match;
    while ((match = downloadRegex.exec(html)) !== null) {
      urls.push('https://www.torrentleech.org' + match[1]);
    }
  } else if (trackerName === 'IPTorrents') {
    // IPTorrents structure: find download links
    // Example: <a href="/download.php/12345/filename.torrent">
    const downloadRegex = /<a[^>]+href="(\/download\.php\/[^"]+)"/gi;
    let match;
    while ((match = downloadRegex.exec(html)) !== null) {
      urls.push('https://iptorrents.com' + match[1]);
    }
  }
  
  return urls;
}

export { searchTorrents };