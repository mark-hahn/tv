import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { getApiCookiesDir } from './tvPaths.js';

export class ReelgoodBrowser {
    constructor() {
        this.browser = null;
        this.context = null;
    }

    async init() {
        if (this.browser) return;

        console.log('ReelgoodBrowser: initializing playwright...');
        
        // Load cookie
        let cfClearance = '';
        try {
            const cookieDir = getApiCookiesDir();
            const cookiePath = path.join(cookieDir, 'cf-clearance.local.json');
            if (fs.existsSync(cookiePath)) {
                const data = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
                // Assuming the structure is { "reelgood": "value", ... } or { "iptorrents": "...", "reelgood": "..." }
                // Checking previous code: cfClearance = JSON.parse(...).reelgood;
                cfClearance = data.reelgood || (typeof data.reelgood === 'string' ? data.reelgood.trim() : '');
            }
        } catch (e) {
            console.error('ReelgoodBrowser: failed to read local cookie', e);
        }

        this.browser = await chromium.launch({ headless: true });

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

        this.context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
            extraHTTPHeaders: headers
        });

        const cookies = [
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
            }
        ];

        if (cfClearance) {
            cookies.push({
                name: 'cf_clearance',
                value: cfClearance,
                domain: 'reelgood.com',
                path: '/'
            });
        }

        await this.context.addCookies(cookies);
    }

    async getHtml(url) {
        if (!this.context) await this.init();
        
        const page = await this.context.newPage();
        try {
            console.log(`ReelgoodBrowser: fetching ${url}`);
            // Use a slightly shorter timeout for details to fail fast if stuck? 
            // Default is 30s. Spec said "fast". Using 20s.
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            const content = await page.content();
            return content;
        } catch (error) {
            console.error(`ReelgoodBrowser: error fetching ${url}`, error.message);
            throw error;
        } finally {
            await page.close();
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
        }
    }
}

// Convenience for startReel (single shot)
export async function getReelHtml() {
    const rb = new ReelgoodBrowser();
    try {
        await rb.init();
        return await rb.getHtml('https://reelgood.com/new/tv');
    } finally {
        await rb.close();
    }
}
