import { chromium } from 'playwright';
import fs from 'fs';

export async function getReelHtml() {
    console.log('Starting playwright script...');
    const cookiePath = '/root/apps/tv/apps/api/cookies/cf-clearance.local.json';
    let cfClearance;
    try {
        cfClearance = JSON.parse(fs.readFileSync(cookiePath, 'utf8')).reelgood;
    } catch (e) {
        console.error(`Failed to read cookie from ${cookiePath}`, e);
        throw e;
    }

    const browser = await chromium.launch({ headless: true });
    
    // Headers derived from req-reelgood.txt
    // Removed Connection, TE, Accept-Encoding to let browser handle them and avoid conflicts
    const headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Priority': 'u=0, i',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
    };

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
        extraHTTPHeaders: headers
    });

    // Cookies derived from req-reelgood.txt
    const cookies = [
        {
            name: 'cf_clearance',
            value: cfClearance,
            domain: 'reelgood.com',
            path: '/'
        },
        {
            name: 'rg.server.csrf_token',
            value: 's%3Arg_csrf_1lbob8c.kP9tD50%2FrAoA0igA7C5Vw91AQ6xk23MSSGLiTvUub3g',
            domain: 'reelgood.com',
            path: '/'
        },
        {
            name: 'rg.client.csrf_token',
            value: 's%3Arg_csrf_1lbob8c.kP9tD50%2FrAoA0igA7C5Vw91AQ6xk23MSSGLiTvUub3g',
            domain: 'reelgood.com',
            path: '/'
        },
        {
            name: 'mp_1215522eade2a5ccbab3b079ca9fb735_mixpanel',
            value: '%7B%22distinct_id%22%3A%20%221994e7fda1b62f-0ae75d4818ec77-8575022-1bcab9-1994e7fda1c1940%22%2C%22%24device_id%22%3A%20%221994e7fda1b62f-0ae75d4818ec77-8575022-1bcab9-1994e7fda1c1940%22%2C%22%24initial_referrer%22%3A%20%22%24direct%22%2C%22%24initial_referring_domain%22%3A%20%22%24direct%22%7D',
            domain: 'reelgood.com',
            path: '/'
        }
    ];

    await context.addCookies(cookies);

    const page = await context.newPage();
    
    try {
        console.log('Navigating to https://reelgood.com/new/tv');
        await page.goto('https://reelgood.com/new/tv', { waitUntil: 'domcontentloaded' });
        
        const content = await page.content();
        return content;
    } catch (error) {
        console.error('An error occurred:', error);
        throw error;
    } finally {
        await browser.close();
    }
}
