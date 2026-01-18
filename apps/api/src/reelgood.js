import fs from 'fs';
import { escape } from 'querystring';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { getApiBaseDir, getApiCookiesDir } from './tvPaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const avoidGenres = ['anime', 'children', 'documentary',
  'family', 'food', 'game Show', 'game-Show',
  'history', 'home &amp;Garden', 'musical',
  'reality', 'sport', 'talk', 'stand-up', 'travel'];

const rx_show = new RegExp('"show:.*?:@global": ?{(.*?)}', 'sg');
const rx_title = new RegExp('"title": ?"(.*?)"', 's');
const rx_slug = new RegExp('"slug": ?"(.*?)"', 'sg');
const rx_genre = new RegExp('href="/tv/genre/([^"]*)"', 'sg');

const homeUrl = "https://reelgood.com/new/tv";
const reelShowsPath = path.join(getApiBaseDir(), 'reel-shows.json');
const reelTitlesPath = path.join(getApiBaseDir(), 'reelgood-titles.json');
const logPath = path.join(getApiBaseDir(), 'reelgood.log');
const homePagePath = path.resolve(__dirname, '..', '..', 'samples', 'sample-reelgood', 'homepage.html');

const REELGOOD_PROVIDER = 'reelgood';

function looksLikeCloudflareChallenge(html) {
  const s = String(html || '');
  if (!s) return false;
  const head = s.slice(0, 60000).toLowerCase();
  return (
    head.includes('<title>just a moment') ||
    head.includes('cf_chl_opt') ||
    head.includes('/cdn-cgi/challenge-platform') ||
    head.includes('enable javascript and cookies to continue')
  );
}

function parseCookieHeaderForDomain(cookieHeader, domain) {
  const out = [];
  const d = String(domain || '').trim();
  if (!d) return out;

  const parts = String(cookieHeader || '')
    .split(';')
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx <= 0) continue;
    const name = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    if (!name || !value) continue;
    out.push({ name, value, domain: d, path: '/' });
  }
  return out;
}

function saveLocalCfClearance(provider, value) {
  try {
    const p = String(provider || '').trim();
    const v = String(value || '').trim();
    if (!p || !v) return false;

    const outPath = path.join(getApiCookiesDir(), 'cf-clearance.local.json');
    let current = {};
    try {
      const raw = fs.readFileSync(outPath, 'utf8');
      const j = JSON.parse(raw);
      if (j && typeof j === 'object' && !Array.isArray(j)) current = j;
    } catch {
      // ignore
    }

    if (typeof current[p] === 'string' && current[p].trim() === v) return false;
    current[p] = v;
    atomicWriteTextFile(outPath, JSON.stringify(current, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

// Global cache
let homeHtml = null;
let oldShows = null;
let showTitles = [];
let resultTitles = [];

const REELGOOD_PW_IDLE_CLOSE_MS = Number(process.env.REELGOOD_PW_IDLE_CLOSE_MS || 2 * 60 * 1000); // default: 2m

function shouldPersistResultEntry(entry) {
  const s = String(entry || '');
  return !s.toLowerCase().startsWith('error|');
}

function loadResultTitles() {
  try {
    if (fs.existsSync(reelTitlesPath)) {
      const parsed = JSON.parse(fs.readFileSync(reelTitlesPath, 'utf8'));
      if (Array.isArray(parsed)) return parsed.map(String);
    }
  } catch (err) {
    console.error('Error loading reelgood-titles.json:', err);
    logToFile(`ERROR loading reelgood-titles.json: ${err.message}`);
  }
  return [];
}

function atomicWriteTextFile(outPath, content) {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  try {
    fs.renameSync(tmpPath, outPath);
  } catch (err) {
    // Cross-platform fallback: if destination exists and rename failed, try unlink+rename.
    try {
      fs.unlinkSync(outPath);
      fs.renameSync(tmpPath, outPath);
    } catch {
      try { fs.unlinkSync(tmpPath); } catch {}
      throw err;
    }
  }
}

function atomicWriteJson(outPath, data) {
  const txt = JSON.stringify(data, null, 2) + '\n';
  atomicWriteTextFile(outPath, txt);
}

function saveResultTitles(titlesArr) {
  try {
    atomicWriteJson(reelTitlesPath, titlesArr);
  } catch (err) {
    console.error('Error saving reelgood-titles.json:', err);
    logToFile(`ERROR saving reelgood-titles.json: ${err.message}`);
  }
}

function resetReelState() {
  try {
    // IMPORTANT: preserve history (reelgood-titles.json). Reset is only meant to
    // restart the per-homepage processing cursor (reel-shows.json).
    oldShows = {};
    saveReelShows(oldShows);
    logToFile('Reelgood state reset (reel-shows cleared; history preserved)');
  } catch (e) {
    logToFile(`ERROR resetting Reelgood state: ${e?.message || String(e)}`);
  }
}

function appendResultTitle(entry) {
  resultTitles.push(String(entry));
  while (resultTitles.length > 100) resultTitles.shift();
  saveResultTitles(resultTitles);
}

function parseResultTitle(entry) {
  const s = String(entry || '');
  const bar = s.indexOf('|');
  if (bar < 0) return '';
  return s.slice(bar + 1).trim();
}

function logToFile(message) {
  try {
    const now = new Date();
    // Simple UTC offset calculation for PST/PDT (-8/-7 hours)
    // Detect DST by checking if we're in March-November
    const month = now.getUTCMonth();
    const isDST = month >= 2 && month <= 10; // Approximate DST period
    const offsetHours = isDST ? -7 : -8;
    const pstTime = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
    
    const mm = String(pstTime.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(pstTime.getUTCDate()).padStart(2, '0');
    const hh = String(pstTime.getUTCHours()).padStart(2, '0');
    const min = String(pstTime.getUTCMinutes()).padStart(2, '0');
    const timestamp = `${mm}/${dd} ${hh}:${min}`;
    
    fs.appendFileSync(logPath, `${timestamp} ${message}\n`, 'utf8');
  } catch (err) {
    console.error('Error writing to log:', err);
  }
}

function tryLoadReelgoodCurlProfile() {
  // Replay browser headers/cookies from req-reelgood.txt (DevTools Copy as cURL (bash)).
  try {
    const candidates = [
      path.join(__dirname, '..', 'req-reelgood.txt'),
      path.join(__dirname, '..', '..', 'misc', 'req-reelgood.txt'),
    ];
    const p = candidates.find((x) => fs.existsSync(x));
    if (!p) return null;
    const raw = fs.readFileSync(p, 'utf8');

    const headers = {};
    let cookieHeader = '';
    let capturedUrl = '';

    // URL (single or double quoted)
    const mUrl = raw.match(/\bcurl\s+['\"]([^'\"]+)['\"]/i);
    if (mUrl) capturedUrl = mUrl[1];

    // -b '...'
    const mB1 = raw.match(/\s-b\s+'([^']*)'/i);
    const mB2 = raw.match(/\s-b\s+\"([^\"]*)\"/i);
    cookieHeader = (mB1?.[1] || mB2?.[1] || '').trim();

    // -H 'k: v' or -H "k: v"
    const reH1 = /\s-H\s+'([^']+)'/gi;
    const reH2 = /\s-H\s+\"([^\"]+)\"/gi;
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

    // Some exports may include cookies as a header instead of -b.
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

function getCookieValue(cookieHeader, cookieName) {
  const name = String(cookieName || '').trim();
  if (!name) return '';
  const parts = String(cookieHeader || '')
    .split(';')
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx <= 0) continue;
    const k = p.slice(0, idx).trim();
    if (k !== name) continue;
    return p.slice(idx + 1).trim();
  }
  return '';
}

function cfClearanceIssuedAt(cfClearanceValue) {
  // Cloudflare's cf_clearance values commonly embed a unix timestamp segment:
  //   <random>-<epochSeconds>-<...>
  const s = String(cfClearanceValue || '').trim();
  if (!s) return 0;
  const m = s.match(/-(\d{10})-/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function chooseBestCfClearance({ fromReq = '', fromLocal = '' } = {}) {
  const a = String(fromReq || '').trim();
  const b = String(fromLocal || '').trim();
  if (!a) return b;
  if (!b) return a;
  const ta = cfClearanceIssuedAt(a);
  const tb = cfClearanceIssuedAt(b);
  if (ta && tb) return tb > ta ? b : a;
  // If we can't parse timestamps, keep the request template's value by default.
  return a;
}

async function loadLocalCfClearance(provider) {
  try {
    const p = String(provider || '').trim();
    if (!p) return '';
    const inPath = path.join(getApiCookiesDir(), 'cf-clearance.local.json');
    const raw = await fs.promises.readFile(inPath, 'utf8');
    const j = JSON.parse(raw);
    const v = j && typeof j === 'object' && !Array.isArray(j) ? j[p] : '';
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

async function curlFetchText(
  targetUrl,
  { headers = {}, cookieHeader = '', connectTimeoutSec = 10, maxTimeSec = 25 } = {}
) {
  // Keep requests bounded so nginx doesn't hit upstream timeouts (504).
  // Note: values are conservative; Reelgood often responds quickly or fails fast.
  const ct = Number.isFinite(connectTimeoutSec) ? Math.max(1, Math.floor(connectTimeoutSec)) : 10;
  const mt = Number.isFinite(maxTimeSec) ? Math.max(2, Math.floor(maxTimeSec)) : 25;
  const args = ['-sS', '-L', '--compressed', '--connect-timeout', String(ct), '--max-time', String(mt)];

  // Note: intentionally do NOT pass -H 'cookie:'; use -b for cookies.
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
      resolve({ ok: false, code: -1, error: err?.message || String(err), stdout: '', stderr: Buffer.concat(stderrChunks).toString('utf8') });
    });
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      resolve({ ok: code === 0 && stdout.length > 0, code, stdout, stderr });
    });
  });
}

async function playwrightFetchText(targetUrl, { headers = {}, cookieHeader = '' } = {}) {
  // Playwright is already a dependency of @tv/api; keep import lazy so normal startup is fast.
  // Important perf note: launching Chromium is expensive; reuse a shared browser instance.
  const browser = await getSharedPlaywrightBrowser();

  const ua = String(headers?.['user-agent'] || headers?.['User-Agent'] || '').trim();
  const extraHeaders = { ...(headers || {}) };
  delete extraHeaders.cookie;
  delete extraHeaders.Cookie;

  let context;
  try {
    context = await browser.newContext({
      userAgent: ua || undefined,
      locale: 'en-US',
    });

    // Note: cookies are added via addCookies, not via cookie header.
    if (Object.keys(extraHeaders).length > 0) {
      await context.setExtraHTTPHeaders(extraHeaders);
    }

    const cookies = parseCookieHeaderForDomain(cookieHeader, '.reelgood.com');
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }

    const page = await context.newPage();
    // Keep overall work well under default nginx proxy timeouts.
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Give Cloudflare challenge pages time to run/redirect.
    // We see sporadic CF challenges even with a clearance cookie; in those cases,
    // allow a longer window for JS challenges + redirects to settle.
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        // networkidle isn't guaranteed, but it helps when it does trigger.
        await page.waitForLoadState('networkidle', { timeout: 1000 });
      } catch {
        // ignore
      }

      let title = '';
      try {
        title = await page.title();
      } catch {
        title = '';
      }

      const u = String(page.url() || '');
      const t = String(title || '').toLowerCase();
      const looksChallenged =
        t.includes('just a moment') ||
        u.includes('__cf_chl') ||
        u.includes('/cdn-cgi/challenge-platform');
      if (!looksChallenged) break;

      await page.waitForTimeout(750);
    }

    const html = await page.content();

    // Best-effort: capture refreshed clearance cookie if Playwright solved the challenge.
    try {
      const jar = await context.cookies('https://reelgood.com');
      const cf = jar.find((c) => c && c.name === 'cf_clearance');
      if (cf?.value) {
        const updated = saveLocalCfClearance(REELGOOD_PROVIDER, cf.value);
        if (updated) {
          console.error('[reelgood] updated cf_clearance via playwright', { len: String(cf.value).length });
        }
      }
    } catch {
      // ignore
    }

    return html;
  } finally {
    try {
      // Close timer is best-effort; browser stays alive briefly for reuse.
      touchSharedPlaywrightBrowser();
    } catch {
      // ignore
    }

    try {
      // Avoid leaking contexts/pages across calls.
      await context?.close();
    } catch {
      // ignore
    }
  }
}

let _pwBrowser = null;
let _pwLaunching = null;
let _pwLastUsedAtMs = 0;
let _pwCloseTimer = null;

function touchSharedPlaywrightBrowser() {
  _pwLastUsedAtMs = Date.now();
  if (_pwCloseTimer) clearTimeout(_pwCloseTimer);
  if (!Number.isFinite(REELGOOD_PW_IDLE_CLOSE_MS) || REELGOOD_PW_IDLE_CLOSE_MS <= 0) return;

  _pwCloseTimer = setTimeout(async () => {
    try {
      if (!_pwBrowser) return;
      const idleFor = Date.now() - (_pwLastUsedAtMs || 0);
      if (idleFor < REELGOOD_PW_IDLE_CLOSE_MS) return;
      try {
        await _pwBrowser.close();
      } catch {
        // ignore
      }
      _pwBrowser = null;
    } finally {
      _pwCloseTimer = null;
    }
  }, REELGOOD_PW_IDLE_CLOSE_MS + 250);
}

async function getSharedPlaywrightBrowser() {
  if (_pwBrowser) {
    touchSharedPlaywrightBrowser();
    return _pwBrowser;
  }
  if (_pwLaunching) return await _pwLaunching;

  _pwLaunching = (async () => {
    const { chromium } = await import('playwright');

    // Do not attempt Playwright unless the browser executable is present.
    // This avoids noisy failures in environments where server apps are not meant to run (e.g. local workspace).
    try {
      const exePath = chromium.executablePath();
      if (!exePath || !fs.existsSync(exePath)) {
        const err = new Error('playwright browser not installed (run: npx playwright install)');
        err.code = 'PW_BROWSER_MISSING';
        throw err;
      }
    } catch (e) {
      // If we cannot determine an executable path, assume Playwright isn't usable here.
      const err = new Error(e?.message || 'playwright not available');
      err.code = e?.code || 'PW_BROWSER_MISSING';
      throw err;
    }

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    _pwBrowser = browser;
    touchSharedPlaywrightBrowser();
    return browser;
  })().finally(() => {
    _pwLaunching = null;
  });

  try {
    return await _pwLaunching;
  } catch (e) {
    _pwBrowser = null;
    throw e;
  }
}

async function fetchReelgoodHtml(
  url,
  { allowPlaywright = true, curlConnectTimeoutSec, curlMaxTimeSec } = {}
) {
  const profile = tryLoadReelgoodCurlProfile();
  const headers = profile?.headers || {};
  let cookieHeader = profile?.cookieHeader || '';

  // Source of truth: TV data cookie store (written by client Save Cookies).
  // req-reelgood.txt is treated as an immutable template; patch an in-memory copy only.
  const localCf = await loadLocalCfClearance(REELGOOD_PROVIDER);
  const reqCf = getCookieValue(cookieHeader, 'cf_clearance');
  const bestCf = chooseBestCfClearance({ fromReq: reqCf, fromLocal: localCf });
  if (bestCf) {
    cookieHeader = upsertCookieValue(cookieHeader, 'cf_clearance', bestCf);
  }

  if (!profile) {
    // Best-effort fallback to built-in fetch (dev); primary path is req-reelgood.txt.
    const r = await fetch(url);
    const txt = await r.text();
    if (looksLikeCloudflareChallenge(txt)) {
      throw new Error(`cloudflare challenge for ${url} (missing req-reelgood.txt profile)`);
    }
    return txt;
  }

  // Primary path: curl replay. If Cloudflare returns a challenge page, fall back to Playwright.
  const r = await curlFetchText(url, {
    headers,
    cookieHeader,
    connectTimeoutSec: curlConnectTimeoutSec,
    maxTimeSec: curlMaxTimeSec,
  });
  if (r.ok && !looksLikeCloudflareChallenge(r.stdout)) {
    return r.stdout;
  }

  // For some call sites (e.g. per-show fetch inside getReel), we prefer to skip quickly
  // rather than pay the cost of solving challenges via Playwright.
  if (!allowPlaywright) {
    if (!r.ok) {
      const details = (r.stderr || '').trim().slice(0, 400);
      throw new Error(`curl failed (code ${r.code}) for ${url}${details ? `: ${details}` : ''}`);
    }
    throw new Error(`cloudflare challenge for ${url}`);
  }

  // If curl failed or got challenged, try Playwright (Chromium) to execute JS challenges.
  try {
    const html = await playwrightFetchText(url, { headers, cookieHeader });
    if (!looksLikeCloudflareChallenge(html)) {
      console.error('[reelgood] playwright fetch ok', { url });
      return html;
    }
    console.error('[reelgood] playwright still challenged', { url });
  } catch (e) {
    // Common local setup: Playwright is installed as a dependency but browsers are not downloaded.
    if (e?.code !== 'PW_BROWSER_MISSING') {
      console.error('[reelgood] playwright fetch error', { url, error: e?.message || String(e) });
    }
  }

  if (!r.ok) {
    const details = (r.stderr || '').trim().slice(0, 400);
    throw new Error(`curl failed (code ${r.code}) for ${url}${details ? `: ${details}` : ''}`);
  }

  // Curl returned HTML but it looks like Cloudflare challenge.
  throw new Error(`cloudflare challenge for ${url}`);
}

function loadReelShows() {
  try {
    if (fs.existsSync(reelShowsPath)) {
      const raw = fs.readFileSync(reelShowsPath, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        return {};
      } catch (e) {
        // Best-effort recovery for truncated/partial JSON.
        // Extract keys of the form "Title": true
        const repaired = {};
        const rx = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*true/g;
        let m;
        while ((m = rx.exec(raw)) !== null) {
          const k = String(m[1] || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          if (k) repaired[k] = true;
        }
        const count = Object.keys(repaired).length;
        if (count > 0) {
          console.error('Recovered truncated reel-shows.json; rewriting repaired file', { count });
          logToFile(`WARN recovered truncated reel-shows.json (count: ${count}); rewriting repaired file`);
          try {
            atomicWriteJson(reelShowsPath, repaired);
          } catch {
            // ignore rewrite failures; still return repaired in-memory
          }
          return repaired;
        }
        throw e;
      }
    }
  } catch (err) {
    console.error('Error loading reel-shows.json:', err);
    logToFile(`ERROR loading reel-shows.json: ${err.message}`);
  }
  return {};
}

function saveReelShows(shows) {
  try {
    // Merge with on-disk state to reduce lost updates if multiple processes write.
    let disk = {};
    try {
      disk = loadReelShows();
    } catch {
      disk = {};
    }
    const merged = { ...(disk || {}), ...(shows || {}) };
    atomicWriteJson(reelShowsPath, merged);
  } catch (err) {
    console.error('Error saving reel-shows.json:', err);
    logToFile(`ERROR saving reel-shows.json: ${err.message}`);
  }
}

// Load oldShows once at module load time
oldShows = loadReelShows();
resultTitles = loadResultTitles();

// Log startup - wrapped in try/catch to prevent module load failure
(function logStartup() {
  try {
    fs.appendFileSync(logPath, '\n', 'utf8');
    logToFile('Reelgood started.');
  } catch (err) {
    // Silently fail - don't crash the module
    console.error('Could not write startup log:', err.message);
  }
})();

export async function startReel(showTitlesArg, { reset = false } = {}) {
  try {
    if (reset) resetReelState();

    showTitles = Array.isArray(showTitlesArg) ? showTitlesArg : [];

    logToFile(`startReel called (showTitles: ${showTitles.length})`);

    console.log('Fetching fresh reelgood home page');
    homeHtml = await fetchReelgoodHtml(homeUrl);
    console.log('Home page loaded into memory');
    
    // Save to samples directory
    try {
      const sampleDir = path.dirname(homePagePath);
      if (!fs.existsSync(sampleDir)) {
        fs.mkdirSync(sampleDir, { recursive: true });
      }
      fs.writeFileSync(homePagePath, homeHtml, 'utf8');
      console.log('Saved home page to', homePagePath);
    } catch (err) {
      console.error('Error saving home page:', err);
      logToFile(`ERROR saving homepage.html: ${err.message}`);
    }

    // Return full persisted/in-memory history (rolling window) so the caller
    // can render prior results immediately.
    return resultTitles;
  } catch (err) {
    const errmsg = err.message || String(err);
    logToFile(`ERROR in startReel: ${errmsg}`);
    return [`error|${errmsg}`];
  }
}

export async function getReel({ maxMs = 45000 } = {}) {
  try {
    if (!homeHtml) {
      const msg = 'Home page not loaded. Call startReel first.';
      return [`error|${msg}`];
    }

    const startedAt = Date.now();
    const deadlineMs = startedAt + (Number.isFinite(maxMs) ? Math.max(1000, maxMs) : 45000);

    const addedThisCall = [];
    const add = (entry) => {
      if (shouldPersistResultEntry(entry)) appendResultTitle(entry);
      addedThisCall.push(entry);
    };

    const addSkipped = (title) => {
      const t = String(title || '').trim();
      if (!t) return;
      add(`skipped|${t}`);
    };

    const haveItSet = new Set((Array.isArray(showTitles) ? showTitles : []).map(String));
    const seenInResultTitles = new Set(resultTitles.map(parseResultTitle).filter(Boolean));

    let show;
    rx_show.lastIndex = 0;
    
    while ((show = rx_show.exec(homeHtml)) !== null) {
      if (Date.now() > deadlineMs) {
        logToFile('getReel timed out before finding a title');
        break;
      }
      const titleMatches = rx_title.exec(show[0]);
      if (!titleMatches?.length) continue;

      const title = titleMatches[1];
      if (title in oldShows) continue;
      if (seenInResultTitles.has(title)) {
        // Treat as already processed, same behavior as oldShows.
        oldShows[title] = true;
        continue;
      }
      
      oldShows[title] = true;

      console.log('\nProcessing:', title);

      rx_slug.lastIndex = 0;
      const slugMatches = rx_slug.exec(show[0]);
      if (!slugMatches?.length) {
        console.log('No slug found');
        addSkipped(title);
        continue;
      }

      const slug = slugMatches[1];
      const showUrl = `https://reelgood.com/show/${encodeURIComponent(slug)}`;

      if (haveItSet.has(title)) {
        add(`Have It|${title}`);
        logToFile(`REJECT: "${title}" (Have It)`);
        continue;
      }

      let reelData;
      try {
        // Keep per-show page fetches fast: do NOT solve Cloudflare challenges here.
        // The home page should already be in memory; per-show Playwright work is too slow.
        reelData = await fetchReelgoodHtml(showUrl, {
          allowPlaywright: false,
          curlConnectTimeoutSec: 6,
          curlMaxTimeSec: 12,
        });
      } catch (e) {
        console.log('Error fetching show page:', e);
        logToFile(`ERROR fetching show page "${title}": ${e.message || String(e)}`);
        addSkipped(title);
        continue;
      }
      const reelHtml = String(reelData || '');

      const chk = (slug, label) => {
        slug = slug.toLowerCase();
        for (const avoid of avoidGenres) {
          if (slug == avoid) {
            console.log('---- skipping', label, avoid);
            return avoid;
          }
        }
        return null;
      }

      let shouldSkip = false;
      let rejectedGenre = null;
      let genreMatches;
      rx_genre.lastIndex = 0;
      while ((genreMatches = rx_genre.exec(reelHtml)) !== null) {
        const genre = genreMatches[1];
        const matched = chk(genre, 'genre');
        if (matched) {
          shouldSkip = true;
          rejectedGenre = matched;
          break;
        }
      }

      if (shouldSkip) {
        add(`${rejectedGenre}|${title}`);
        logToFile(`REJECT: "${title}" (${rejectedGenre})`);
        continue;
      }

      // Log accepted show
      logToFile(`>>>  "${title}", ${showUrl}`);

      add(`ok|${title}`);

      // Save oldShows at end before returning
      saveReelShows(oldShows);

      return addedThisCall;
    }

    // Save oldShows even when no show found
    saveReelShows(oldShows);

    if (Date.now() > deadlineMs && addedThisCall.length === 0) {
      return ['msg|getReel timed out'];
    }

    return addedThisCall;
  } catch (err) {
    const errmsg = err.message || String(err);
    logToFile(`ERROR in getReel: ${errmsg}`);
    return [`error|${errmsg}`];
  }
}
