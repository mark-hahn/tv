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

function decodeJsonStringFragment(s) {
  const raw = String(s ?? '');
  if (!raw) return '';
  try {
    // The regex capture is the inside of a JSON string literal.
    return JSON.parse(`"${raw}"`);
  } catch {
    // Best-effort fallback.
    return raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function extractBalancedJsonObject(s, openBraceIndex, { maxChars = 250000 } = {}) {
  const str = String(s || '');
  const start = Number(openBraceIndex);
  if (!Number.isFinite(start) || start < 0 || start >= str.length) return null;
  if (str[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  const limit = Math.min(str.length, start + Math.max(1, Number(maxChars) || 1));

  for (let i = start; i < limit; i++) {
    const ch = str[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      escapeNext = false;
      continue;
    }

    if (ch === '{') {
      depth++;
      continue;
    }

    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return str.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractHomeShows(html) {
  const s = String(html || '');
  if (!s) return [];

  const out = [];
  const seen = new Set();

  // Current (2025+) Reelgood bootstrap often contains show entities as:
  // entities.entries["show:<id>:@global"] = { title: "...", slug: "...", ... }
  const rxShowKey = /"show:[^\"]+:@global"\s*:\s*\{/g;
  const rxTitle = /"title"\s*:\s*"((?:\\.|[^"\\])*)"/;
  const rxSlug = /"slug"\s*:\s*(?:"((?:\\.|[^"\\])*)"|null)/;

  let m;
  while ((m = rxShowKey.exec(s)) !== null) {
    // The match ends at the opening '{' of the value object.
    const openBraceIndex = m.index + m[0].length - 1;
    const obj = extractBalancedJsonObject(s, openBraceIndex, { maxChars: 250000 });
    if (!obj) continue;

    const mt = rxTitle.exec(obj);
    if (!mt?.[1]) continue;
    const title = decodeJsonStringFragment(mt[1]).trim();
    if (!title) continue;

    const ms = rxSlug.exec(obj);
    const slug = ms?.[1] ? decodeJsonStringFragment(ms[1]).trim() : '';

    const key = `${title}|${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, slug });
    if (out.length >= 5000) break;
  }

  // Back-compat fallback for older homepages: use the previous anchor regex,
  // but still extract title/slug from a bounded window to avoid brace nesting.
  if (out.length === 0) {
    rx_show.lastIndex = 0;
    let show;
    while ((show = rx_show.exec(s)) !== null) {
      const block = show[0];
      const mt = rxTitle.exec(block);
      if (!mt?.[1]) continue;
      const title = decodeJsonStringFragment(mt[1]).trim();
      if (!title) continue;

      const ms = rxSlug.exec(block);
      const slug = ms?.[1] ? decodeJsonStringFragment(ms[1]).trim() : '';
      const key = `${title}|${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, slug });
      if (out.length >= 5000) break;
    }
  }

  return out;
}

const homeUrl = "https://reelgood.com/new/tv";
const reelShowsPath = path.join(getApiBaseDir(), 'reel-shows.json');
const reelTitlesPath = path.join(getApiBaseDir(), 'reelgood-titles.json');
const logPath = path.join(getApiBaseDir(), 'reelgood.log');
const homePagePath = path.resolve(__dirname, '..', '..', 'samples', 'sample-reelgood', 'homepage.html');

const REELGOOD_PROVIDER = 'reelgood';

const REELGOOD_CF_REFRESH_COOLDOWN_MS = Number(process.env.REELGOOD_CF_REFRESH_COOLDOWN_MS || 10 * 60 * 1000); // default: 10m
let _reelgoodLastCfRefreshAtMs = 0;

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

function saveLocalCookieJar(provider, cookiesObj) {
  try {
    const p = String(provider || '').trim();
    const cookies = cookiesObj && typeof cookiesObj === 'object' && !Array.isArray(cookiesObj) ? cookiesObj : null;
    if (!p || !cookies) return false;

    const outPath = path.join(getApiCookiesDir(), 'cf-cookies.local.json');
    let current = {};
    try {
      const raw = fs.readFileSync(outPath, 'utf8');
      const j = JSON.parse(raw);
      if (j && typeof j === 'object' && !Array.isArray(j)) current = j;
    } catch {
      // ignore
    }

    const prev = current[p] && typeof current[p] === 'object' && !Array.isArray(current[p]) ? current[p] : {};
    const next = { ...prev };
    let changed = false;
    for (const [k, v] of Object.entries(cookies)) {
      const kk = String(k || '').trim();
      const vv = String(v || '').trim();
      if (!kk || !vv) continue;
      if (next[kk] !== vv) {
        next[kk] = vv;
        changed = true;
      }
    }

    if (!changed) return false;
    current[p] = next;
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
    // IMPORTANT: do NOT clear reel-shows.json.
    // Reset is meant to refresh in-memory state (e.g. refetch homepage) without
    // wiping the persistent cursor/history.
    oldShows = loadReelShows();
    logToFile('Reelgood state reset (reel-shows preserved; in-memory refreshed)');
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

async function loadLocalCookieJar(provider) {
  try {
    const p = String(provider || '').trim();
    if (!p) return {};
    const inPath = path.join(getApiCookiesDir(), 'cf-cookies.local.json');
    const raw = await fs.promises.readFile(inPath, 'utf8');
    const j = JSON.parse(raw);
    const v = j && typeof j === 'object' && !Array.isArray(j) ? j[p] : null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const kk = String(k || '').trim();
      const vv = typeof val === 'string' ? val.trim() : '';
      if (kk && vv) out[kk] = vv;
    }
    return out;
  } catch {
    return {};
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
  const ua = String(headers?.['user-agent'] || headers?.['User-Agent'] || '').trim();
  const extraHeaders = { ...(headers || {}) };
  delete extraHeaders.cookie;
  delete extraHeaders.Cookie;

  const context = await getSharedPlaywrightContext({ userAgent: ua || undefined });
  let page;
  try {
    const cookies = parseCookieHeaderForDomain(cookieHeader, '.reelgood.com');
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }

    page = await context.newPage();

    // Apply per-call headers at the page level (context is persistent and reused).
    try {
      if (Object.keys(extraHeaders).length > 0) {
        await page.setExtraHTTPHeaders(extraHeaders);
      }
    } catch {
      // ignore
    }

    // Keep overall work bounded, but give CF a real chance to complete.
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Give Cloudflare challenge pages time to run/redirect.
    // We see sporadic CF challenges even with a clearance cookie; in those cases,
    // allow a longer window for JS challenges + redirects to settle.
    const deadline = Date.now() + 60000;
    let attemptedClick = false;
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

      // Best-effort: some CF flows present a checkbox/Turnstile. Try clicking once.
      if (!attemptedClick) {
        attemptedClick = true;
        try {
          const frames = page.frames();
          const cfFrame = frames.find((f) => String(f.url() || '').includes('challenges.cloudflare.com'));
          if (cfFrame) {
            // Try a couple common checkbox patterns.
            await cfFrame.click('input[type="checkbox"]', { timeout: 1500 }).catch(() => {});
            await cfFrame.click('div[role="checkbox"]', { timeout: 1500 }).catch(() => {});
          } else {
            await page.click('input[type="checkbox"]', { timeout: 1200 }).catch(() => {});
            await page.click('div[role="checkbox"]', { timeout: 1200 }).catch(() => {});
          }
        } catch {
          // ignore
        }
      }

      await page.waitForTimeout(750);
    }

    const html = await page.content();

    if (looksLikeCloudflareChallenge(html)) {
      try {
        console.error('[reelgood] playwright challenged', {
          url: targetUrl,
          pageUrl: String(page.url() || ''),
          title: String(await page.title() || '').slice(0, 120),
        });
      } catch {
        console.error('[reelgood] playwright challenged', { url: targetUrl });
      }
    }

    // Best-effort: capture refreshed clearance cookie only if we are not still on a challenge page.
    if (!looksLikeCloudflareChallenge(html)) {
      try {
        const jar = await context.cookies('https://reelgood.com');
        const want = new Set(['cf_clearance', '__cf_bm', '_cfuvid']);
        const picked = {};
        for (const c of jar || []) {
          const name = String(c?.name || '').trim();
          const value = String(c?.value || '').trim();
          if (!name || !value) continue;
          if (!want.has(name)) continue;
          picked[name] = value;
        }
        if (picked.cf_clearance) {
          const updated = saveLocalCfClearance(REELGOOD_PROVIDER, picked.cf_clearance);
          if (updated) {
            console.error('[reelgood] updated cf_clearance via playwright', { len: String(picked.cf_clearance).length });
          }
        }
        const jarUpdated = saveLocalCookieJar(REELGOOD_PROVIDER, picked);
        if (jarUpdated) {
          console.error('[reelgood] updated cf cookies via playwright', { keys: Object.keys(picked) });
        }
      } catch {
        // ignore
      }
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
      await page?.close();
    } catch {
      // ignore
    }
  }
}

async function refreshReelgoodCfClearanceViaPlaywright({ headers = {}, cookieHeader = '', reason = '', force = false } = {}) {
  // Avoid hammering Cloudflare / launching Chromium repeatedly.
  const now = Date.now();
  if (!force && REELGOOD_CF_REFRESH_COOLDOWN_MS > 0 && (now - (_reelgoodLastCfRefreshAtMs || 0)) < REELGOOD_CF_REFRESH_COOLDOWN_MS) {
    return { attempted: false, updated: false, reason: 'cooldown' };
  }

  _reelgoodLastCfRefreshAtMs = now;

  const before = await loadLocalCfClearance(REELGOOD_PROVIDER);
  try {
    // Use the home page as a stable target for solving challenges and minting cf_clearance.
    await playwrightFetchText(homeUrl, { headers, cookieHeader });
  } catch (e) {
    return { attempted: true, updated: false, reason: `error: ${e?.message || String(e)}` };
  }
  const after = await loadLocalCfClearance(REELGOOD_PROVIDER);
  const updated = Boolean(after && after !== before);
  if (updated) {
    console.error('[reelgood] cf_clearance refreshed', { reason: String(reason || '').slice(0, 120) });
  }
  return { attempted: true, updated, reason: updated ? 'updated' : 'nochange' };
}

let _pwBrowser = null;
let _pwLaunching = null;
let _pwContext = null;
let _pwContextLaunching = null;
let _pwLastUsedAtMs = 0;
let _pwCloseTimer = null;

function touchSharedPlaywrightBrowser() {
  _pwLastUsedAtMs = Date.now();
  if (_pwCloseTimer) clearTimeout(_pwCloseTimer);
  if (!Number.isFinite(REELGOOD_PW_IDLE_CLOSE_MS) || REELGOOD_PW_IDLE_CLOSE_MS <= 0) return;

  _pwCloseTimer = setTimeout(async () => {
    try {
      if (!_pwBrowser && !_pwContext) return;
      const idleFor = Date.now() - (_pwLastUsedAtMs || 0);
      if (idleFor < REELGOOD_PW_IDLE_CLOSE_MS) return;
      try {
        // If we used a persistent context, close it first.
        await _pwContext?.close();
      } catch {
        // ignore
      }
      _pwContext = null;
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

function getReelgoodPlaywrightProfileDir() {
  return path.join(getApiCookiesDir(), 'reelgood-pw-profile');
}

async function getSharedPlaywrightContext({ userAgent } = {}) {
  if (_pwContext) {
    touchSharedPlaywrightBrowser();
    return _pwContext;
  }
  if (_pwContextLaunching) return await _pwContextLaunching;

  _pwContextLaunching = (async () => {
    const { chromium } = await import('playwright');

    // Ensure Playwright browser is installed.
    try {
      const exePath = chromium.executablePath();
      if (!exePath || !fs.existsSync(exePath)) {
        const err = new Error('playwright browser not installed (run: npx playwright install)');
        err.code = 'PW_BROWSER_MISSING';
        throw err;
      }
    } catch (e) {
      const err = new Error(e?.message || 'playwright not available');
      err.code = e?.code || 'PW_BROWSER_MISSING';
      throw err;
    }

    const userDataDir = getReelgoodPlaywrightProfileDir();
    try {
      if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    } catch {
      // ignore
    }

    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      locale: 'en-US',
      userAgent: String(userAgent || '').trim() || undefined,
      viewport: { width: 1365, height: 768 },
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    // Basic stealth-ish tweaks (best-effort; no external deps).
    try {
      await ctx.addInitScript(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        } catch {}
        try {
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        } catch {}
        try {
          // eslint-disable-next-line no-undef
          window.chrome = window.chrome || { runtime: {} };
        } catch {}
      });
    } catch {
      // ignore
    }

    _pwContext = ctx;
    try {
      _pwBrowser = ctx.browser();
    } catch {
      // ignore
    }
    touchSharedPlaywrightBrowser();
    return ctx;
  })().finally(() => {
    _pwContextLaunching = null;
  });

  try {
    return await _pwContextLaunching;
  } catch (e) {
    _pwContext = null;
    throw e;
  }
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
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
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
  const localJar = await loadLocalCookieJar(REELGOOD_PROVIDER);
  for (const [k, v] of Object.entries(localJar || {})) {
    if (!k || !v) continue;
    cookieHeader = upsertCookieValue(cookieHeader, k, v);
  }

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

  // If Cloudflare challenged curl, try a lightweight refresh (mint cookies via Playwright
  // on the home page), then retry curl once. This keeps the steady-state path curl-only.
  try {
    const did = await refreshReelgoodCfClearanceViaPlaywright({
      headers,
      cookieHeader,
      reason: `curl challenged for ${url}`,
    });
    if (did.attempted) {
      const localCf2 = await loadLocalCfClearance(REELGOOD_PROVIDER);
      const reqCf2 = getCookieValue(cookieHeader, 'cf_clearance');
      const bestCf2 = chooseBestCfClearance({ fromReq: reqCf2, fromLocal: localCf2 });
      const cookieHeader2 = bestCf2 ? upsertCookieValue(cookieHeader, 'cf_clearance', bestCf2) : cookieHeader;
      const r2 = await curlFetchText(url, {
        headers,
        cookieHeader: cookieHeader2,
        connectTimeoutSec: curlConnectTimeoutSec,
        maxTimeSec: curlMaxTimeSec,
      });
      if (r2.ok && !looksLikeCloudflareChallenge(r2.stdout)) {
        return r2.stdout;
      }
    }
  } catch {
    // ignore refresh failures; continue to existing fallback behavior
  }

  // For some call sites (e.g. per-show fetch inside getReel), we prefer to skip quickly
  // rather than pay the cost of solving challenges via Playwright.
  if (!allowPlaywright) {
    // Even when call sites don't want full Playwright fallback for the *target URL*,
    // it's still safe and useful to refresh cf_clearance once in a while using
    // the home page, then retry curl.
    try {
      const did = await refreshReelgoodCfClearanceViaPlaywright({
        headers,
        cookieHeader,
        reason: `curl challenged (no-pw) for ${url}`,
      });
      if (did.attempted) {
        const localCf2 = await loadLocalCfClearance(REELGOOD_PROVIDER);
        const reqCf2 = getCookieValue(cookieHeader, 'cf_clearance');
        const bestCf2 = chooseBestCfClearance({ fromReq: reqCf2, fromLocal: localCf2 });
        const cookieHeader2 = bestCf2 ? upsertCookieValue(cookieHeader, 'cf_clearance', bestCf2) : cookieHeader;
        const r2 = await curlFetchText(url, {
          headers,
          cookieHeader: cookieHeader2,
          connectTimeoutSec: curlConnectTimeoutSec,
          maxTimeSec: curlMaxTimeSec,
        });
        if (r2.ok && !looksLikeCloudflareChallenge(r2.stdout)) {
          return r2.stdout;
        }
      }
    } catch {
      // ignore refresh failures; fall through to existing error behavior
    }

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

export async function refreshReelgoodClearance({ reason = '' } = {}) {
  const profile = tryLoadReelgoodCurlProfile();
  const headers = profile?.headers || {};
  const cookieHeader = profile?.cookieHeader || '';
  const before = await loadLocalCfClearance(REELGOOD_PROVIDER);
  const r = await refreshReelgoodCfClearanceViaPlaywright({ headers, cookieHeader, reason: reason || 'manual', force: true });
  const after = await loadLocalCfClearance(REELGOOD_PROVIDER);
  return {
    attempted: r.attempted,
    updated: r.updated,
    cooldownMs: REELGOOD_CF_REFRESH_COOLDOWN_MS,
    beforeLen: before ? String(before).length : 0,
    afterLen: after ? String(after).length : 0,
  };
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

    // Keep in-memory state aligned with on-disk cursor/history. This prevents
    // stale in-memory caches from rewriting cleared/edited files.
    oldShows = loadReelShows();
    resultTitles = loadResultTitles();

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

    const homeShows = extractHomeShows(homeHtml);
    if (homeShows.length === 0) {
      logToFile('WARN getReel: parsed 0 shows from homeHtml');
      return ['msg|No shows parsed from home page'];
    }

    for (const hs of homeShows) {
      if (Date.now() > deadlineMs) {
        logToFile('getReel timed out before finding a title');
        break;
      }
      const title = String(hs?.title || '').trim();
      if (!title) continue;
      if (title in oldShows) continue;
      if (seenInResultTitles.has(title)) {
        // Already returned previously (history). Don't persist it to reel-shows.json
        // just because we scanned it.
        continue;
      }

      console.log('\nProcessing:', title);

      const slug = String(hs?.slug || '').trim();
      if (!slug) {
        console.log('No slug found');
        oldShows[title] = true;
        addSkipped(title);
        continue;
      }
      const showUrl = `https://reelgood.com/show/${encodeURIComponent(slug)}`;

      if (haveItSet.has(title)) {
        oldShows[title] = true;
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
        const detail = e?.message || String(e);
        // If we can't fetch the show page (often Cloudflare), treat as skipped.
        // This preserves the invariant: we only return ok when we've actually
        // processed the show page (e.g. for genre filtering).
        logToFile(`WARN show page fetch failed; skipping "${title}": ${detail}`);
        oldShows[title] = true;
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
        oldShows[title] = true;
        add(`${rejectedGenre}|${title}`);
        logToFile(`REJECT: "${title}" (${rejectedGenre})`);
        continue;
      }

      // Log accepted show
      logToFile(`>>>  "${title}", ${showUrl}`);

      oldShows[title] = true;
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
