import fs from 'fs';
import { escape } from 'querystring';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { getApiCookiesDir } from './tvPaths.js';

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
const reelShowsPath = path.resolve(__dirname, '..', 'reel-shows.json');
const reelTitlesPath = path.resolve(__dirname, '..', 'reelgood-titles.json');
const logPath = path.resolve(__dirname, '..', 'reelgood.log');
const homePagePath = path.resolve(__dirname, '..', '..', 'samples', 'sample-reelgood', 'homepage.html');

const REELGOOD_PROVIDER = 'reelgood';

// Global cache
let homeHtml = null;
let oldShows = null;
let showTitles = [];
let resultTitles = [];

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

async function curlFetchText(targetUrl, { headers = {}, cookieHeader = '' } = {}) {
  const args = ['-sS', '-L', '--compressed'];

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

async function fetchReelgoodHtml(url) {
  const profile = tryLoadReelgoodCurlProfile();
  const headers = profile?.headers || {};
  let cookieHeader = profile?.cookieHeader || '';

  // Source of truth: tv-data cookie store (written by client Save Cookies).
  // req-reelgood.txt is treated as an immutable template; patch an in-memory copy only.
  const localCf = await loadLocalCfClearance(REELGOOD_PROVIDER);
  if (localCf) {
    cookieHeader = upsertCookieValue(cookieHeader, 'cf_clearance', localCf);
  }

  if (!profile) {
    // Best-effort fallback to built-in fetch (dev); primary path is req-reelgood.txt.
    const r = await fetch(url);
    return await r.text();
  }

  const r = await curlFetchText(url, { headers, cookieHeader });
  if (!r.ok) {
    const details = (r.stderr || '').trim().slice(0, 400);
    throw new Error(`curl failed (code ${r.code}) for ${url}${details ? `: ${details}` : ''}`);
  }
  return r.stdout;
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

export async function startReel(showTitlesArg) {
  try {
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

export async function getReel() {
  try {
    if (!homeHtml) {
      const msg = 'Home page not loaded. Call startReel first.';
      return [`error|${msg}`];
    }

    const addedThisCall = [];
    const add = (entry) => {
      if (shouldPersistResultEntry(entry)) appendResultTitle(entry);
      addedThisCall.push(entry);
    };

    const haveItSet = new Set((Array.isArray(showTitles) ? showTitles : []).map(String));
    const seenInResultTitles = new Set(resultTitles.map(parseResultTitle).filter(Boolean));

    let show;
    rx_show.lastIndex = 0;
    
    while ((show = rx_show.exec(homeHtml)) !== null) {
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
        reelData = await fetchReelgoodHtml(showUrl);
      } catch (e) {
        console.log('Error fetching show page:', e);
        logToFile(`ERROR fetching show page "${title}": ${e.message || String(e)}`);
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

    return addedThisCall;
  } catch (err) {
    const errmsg = err.message || String(err);
    logToFile(`ERROR in getReel: ${errmsg}`);
    return [`error|${errmsg}`];
  }
}
