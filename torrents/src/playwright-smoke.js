import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Usage:
//   node torrents/src/playwright-smoke.js
//   node torrents/src/playwright-smoke.js "<url>"
//
// Cookie sources (no env vars):
// - torrents/cookies/torrentleech.json (Playwright cookie export format) is loaded when present.
// - torrents/cookies/cf-clearance.local.json is used to set/override cf_clearance.
//
// This is a manual smoke test that tells you whether Playwright (a real browser)
// can load a <url>, or if Cloudflare returns the "Just a moment..." challenge.

const DEFAULT_URL =
  'https://www.torrentleech.org/download/241575376/Its.Always.Sunny.in.Philadelphia.S17E06.1080p.WEB.H264-SuccessfulCrab.torrent';

const url = process.argv[2] || DEFAULT_URL;

const HEADLESS = false;

// Try to use the installed Chrome channel (closer to a real user browser).
// If unavailable, Playwright will fall back to bundled Chromium.
const USE_CHROME_CHANNEL = true;

// Make the request look more like a normal browser navigation.
// (Some headers like sec-fetch-* and sec-ch-ua are controlled by Chromium.)
const EXTRA_HEADERS = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
};

// Using the same UA as your Chrome copy-as-curl helps reduce differences.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

// If present, we will parse this file (your DevTools “Copy as cURL”) and apply
// its headers/cookies for the closest possible match.
// Workspace default: tv-series-client/misc/req-browser.txt
const DEFAULT_BROWSER_CURL_PATH_REL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'misc',
  'req-browser.txt'
);

function decodeCaretEscapes(s) {
  // DevTools “Copy as cURL (cmd/powershell)” uses caret escapes.
  // Handle the common cases we see in your captured file.
  return String(s)
    .replace(/\^\"/g, '"')
    .replace(/\^\^/g, '^');
}

function readDoubleQuoted(cmd, startIndex) {
  // Reads a double-quoted string supporting backslash escapes.
  let i = startIndex;
  while (i < cmd.length && cmd[i] !== '"') i++;
  if (i >= cmd.length) return { value: null, nextIndex: cmd.length };
  i++; // skip opening quote
  let out = '';
  while (i < cmd.length) {
    const ch = cmd[i];
    if (ch === '\\') {
      // Keep escaped char (", \n, etc.) minimally.
      if (i + 1 < cmd.length) {
        out += cmd[i + 1];
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      return { value: out, nextIndex: i + 1 };
    }
    out += ch;
    i++;
  }
  return { value: out, nextIndex: i };
}

function findQuotedArg(cmd, flag) {
  const idx = cmd.indexOf(flag);
  if (idx < 0) return null;
  const { value } = readDoubleQuoted(cmd, idx + flag.length);
  return value;
}

function parseCookieHeader(cookieHeader) {
  const out = [];
  const parts = String(cookieHeader)
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out.push({ name: part.slice(0, eq).trim(), value: part.slice(eq + 1) });
  }
  return out;
}

function tryLoadBrowserCurl() {
  // Optional CLI: node playwright-smoke.js <url> --curl-file <path>
  // Default: misc/req-browser.txt
  try {
    const args = process.argv.slice(2);
    let curlPath = DEFAULT_BROWSER_CURL_PATH_REL;
    const flagIdx = args.indexOf('--curl-file');
    if (flagIdx >= 0 && args[flagIdx + 1]) {
      curlPath = path.resolve(args[flagIdx + 1]);
    }
    if (!fs.existsSync(curlPath)) return null;
    const raw = fs.readFileSync(curlPath, 'utf8');
    const text = decodeCaretEscapes(raw).replace(/\r\n/g, '\n');

    // Join caret-continued lines into a single command string.
    const joined = [];
    let cur = '';
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('PS ')) continue;
      if (line.startsWith('curl ')) {
        // Start of command
        cur = line;
        continue;
      }
      if (!cur) continue;
      if (line.endsWith('^')) {
        cur += ' ' + line.slice(0, -1).trim();
      } else {
        cur += ' ' + line;
        joined.push(cur);
        cur = '';
      }
    }
    if (cur) joined.push(cur);
    const cmd = joined[0] || text;

    const headers = {};
    let cookieHeader = '';

    // Extract cookie header.
    cookieHeader =
      findQuotedArg(cmd, ' -b') ||
      findQuotedArg(cmd, '\n-b') ||
      findQuotedArg(cmd, ' --cookie') ||
      '';

    // Extract headers.
    // We only apply the “safe” ones; Chrome will generate the rest.
    const allowed = new Set([
      'accept',
      'accept-language',
      'cache-control',
      'pragma',
      'user-agent',
    ]);

    // Iterate all -H occurrences.
    let scanIdx = 0;
    while (scanIdx < cmd.length) {
      const hIdx = cmd.indexOf(' -H', scanIdx);
      if (hIdx < 0) break;
      const { value: hdr, nextIndex } = readDoubleQuoted(cmd, hIdx + 3);
      scanIdx = Math.max(nextIndex, hIdx + 3);
      if (!hdr) continue;
      const sep = hdr.indexOf(':');
      if (sep <= 0) continue;
      const name = hdr.slice(0, sep).trim().toLowerCase();
      const value = hdr.slice(sep + 1).trim();
      if (!allowed.has(name)) continue;
      headers[name] = value;
    }

    return {
      curlPath,
      headers,
      cookieHeader,
    };
  } catch {
    return null;
  }
}

function toSingleLine(str) {
  return String(str).replace(/[\r\n]+/g, ' ').trim();
}

function escapeForCurlSingleQuotes(value) {
  // bash-style: close quote, escape single quote, reopen
  return String(value).replace(/'/g, `'"'"'`);
}

function buildCurl(url, headers) {
  const hdrEntries = Object.entries(headers || {})
    .filter(([k, v]) => v != null && String(v).length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const parts = [`curl '${escapeForCurlSingleQuotes(url)}'`];
  for (const [k, v] of hdrEntries) {
    parts.push(`-H '${escapeForCurlSingleQuotes(`${k}: ${toSingleLine(v)}`)}'`);
  }
  parts.push('--compressed');
  return parts.join(' \\\n  ');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Always resolve cookies relative to the torrents project, not the shell CWD.
const cookiesDir = path.resolve(__dirname, '..', 'cookies');

function tryLoadTlCookies() {
  try {
    const cookiePath = path.resolve(cookiesDir, 'torrentleech.json');
    if (!fs.existsSync(cookiePath)) return [];
    const raw = fs.readFileSync(cookiePath, 'utf8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies)) return [];
    return cookies;
  } catch {
    return [];
  }
}

function tryLoadLocalCfClearance() {
  try {
    const p = path.resolve(cookiesDir, 'cf-clearance.local.json');
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
  } catch {
    // ignore
  }
  return {};
}

function normalizeCookieForHost(cookie, host) {
  const c = { ...cookie };
  // Keep cookies in domain/path form (do NOT add url), because mixing url+domain
  // can cause context.addCookies() to reject silently.
  if (!c.domain) {
    c.domain = host;
  }
  if (!c.path) {
    c.path = '/';
  }
  // Some exports use expires=-1; Playwright expects undefined for session cookies.
  if (typeof c.expires === 'number' && c.expires < 0) {
    delete c.expires;
  }
  return c;
}

(async () => {
  const targetHost = new URL(url).host;

  const browserCurl = tryLoadBrowserCurl();
  const browserLikeHeaders = { ...EXTRA_HEADERS };
  if (browserCurl?.headers) {
    // Apply only headers we can safely set via extraHTTPHeaders.
    // (We intentionally ignore host/content-length and let Chromium manage them.)
    const blocked = new Set(['host', 'content-length']);
    for (const [k, v] of Object.entries(browserCurl.headers)) {
      if (!k || blocked.has(String(k).toLowerCase())) continue;
      // Never force Cookie here; we set cookies via context.addCookies.
      if (String(k).toLowerCase() === 'cookie') continue;
      browserLikeHeaders[String(k).toLowerCase()] = v;
    }
  }
  const effectiveUserAgent =
    String(browserCurl?.headers?.['user-agent'] || '').trim() || USER_AGENT;

  const browser = await chromium.launch({
    headless: HEADLESS,
    channel: USE_CHROME_CHANNEL ? 'chrome' : undefined,
  });
  const context = await browser.newContext({
    locale: 'en-US',
    userAgent: effectiveUserAgent,
    extraHTTPHeaders: browserLikeHeaders,
  });
  const page = await context.newPage();

  // Playwright/Chromium often omits the Cookie header from request.headers().
  // We'll compute what would be sent from the cookie jar and include it in the
  // curl snippet for copy/paste.
  let cookieHeaderForTarget = '';

  // Capture the first navigation request to the target host so we can see what
  // the browser actually sends (headers/cookies) and copy it.
  let loggedNavReq = false;

  // CDP can expose the full outgoing request headers (including Cookie) that
  // Playwright's request.headers() often omits.
  let cdp;
  let navRequestId;
  try {
    cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', evt => {
      try {
        if (navRequestId) return;
        const reqUrl = evt?.request?.url;
        if (!reqUrl) return;
        const u = new URL(reqUrl);
        if (u.host !== targetHost) return;
        if (evt?.type !== 'Document') return;
        navRequestId = evt.requestId;
      } catch {
        // ignore
      }
    });
    cdp.on('Network.requestWillBeSentExtraInfo', evt => {
      try {
        if (!evt?.headers) return;
        if (!navRequestId) return;
        if (evt.requestId !== navRequestId) return;
        console.log('[pw-smoke] cdp nav request extraInfo headers', evt.headers);
      } catch (e) {
        console.error('[pw-smoke] cdp extraInfo log failed', e?.message || String(e));
      }
    });
  } catch (e) {
    console.error('[pw-smoke] CDP unavailable', e?.message || String(e));
  }

  page.on('request', req => {
    try {
      if (loggedNavReq) return;
      if (!req.isNavigationRequest()) return;
      const reqUrl = req.url();
      if (new URL(reqUrl).host !== host) return;
      loggedNavReq = true;
      const headers = req.headers();
      const curlHeaders = { ...headers };
      if (!curlHeaders.cookie && cookieHeaderForTarget) {
        curlHeaders.cookie = cookieHeaderForTarget;
      }
      console.log('[pw-smoke] nav request', {
        method: req.method(),
        url: reqUrl,
        resourceType: req.resourceType(),
        hasCookieHeader: Boolean(headers.cookie),
        headerNames: Object.keys(headers).sort(),
      });
      console.log('[pw-smoke] nav request headers', headers);
      console.log('[pw-smoke] nav request curl (bash)', buildCurl(reqUrl, curlHeaders));
    } catch (e) {
      console.error('[pw-smoke] request logger failed', e?.message || String(e));
    }
  });

  page.on('response', async res => {
    try {
      const resUrl = res.url();
      if (new URL(resUrl).host !== host) return;
      // Log the main-document response chain (redirects included).
      const req = res.request();
      if (!req.isNavigationRequest()) return;
      if (req.frame() !== page.mainFrame()) return;
      const status = res.status();
      const headers = res.headers();
      console.log('[pw-smoke] nav response', {
        status,
        url: resUrl,
        headerNames: Object.keys(headers).sort(),
      });
      console.log('[pw-smoke] nav response headers', headers);
    } catch (e) {
      console.error('[pw-smoke] response logger failed', e?.message || String(e));
    }
  });

  const host = (new URL(url)).hostname;

  // Load cookies from torrents/cookies/torrentleech.json when available.
  // This helps test whether a previously verified browser session changes the result.
  const tlCookies = tryLoadTlCookies();
  const localCf = tryLoadLocalCfClearance();
  const effectiveTlCf = String(localCf?.torrentleech || '').trim();

  const baseDomain = 'torrentleech.org';
  const cookiesToAdd = [];

  // If we have a real browser curl capture, use its cookies as the best-match.
  if (browserCurl?.cookieHeader) {
    const curlCookies = parseCookieHeader(browserCurl.cookieHeader);
    for (const c of curlCookies) {
      cookiesToAdd.push({
        name: c.name,
        value: c.value,
        domain: baseDomain,
        path: '/',
        secure: true,
        sameSite: 'Lax',
      });
    }
  }

  // Load saved TL session cookies (tluid/tlpass) if present.
  // Only do this when we did NOT load a full browser-cookie header.
  if (!browserCurl?.cookieHeader && tlCookies.length > 0) {
    for (const c of tlCookies) {
      const normalized = normalizeCookieForHost(c, baseDomain);
      // Force domain to baseDomain so it applies to www subdomain as well.
      normalized.domain = baseDomain;
      cookiesToAdd.push(normalized);
    }
  }

  // Override/add cf_clearance from cf-clearance.local.json when missing from curl cookies.
  const hasCfFromCurl = cookiesToAdd.some(c => c?.name === 'cf_clearance');
  if (!hasCfFromCurl && effectiveTlCf) {
    // Remove any existing cf_clearance cookie from the imported set.
    for (let i = cookiesToAdd.length - 1; i >= 0; i--) {
      if (cookiesToAdd[i]?.name === 'cf_clearance') cookiesToAdd.splice(i, 1);
    }
    cookiesToAdd.push({
      name: 'cf_clearance',
      value: effectiveTlCf,
      domain: baseDomain,
      path: '/',
      secure: true,
      sameSite: 'Lax',
    });
  }

  if (cookiesToAdd.length > 0) {
    try {
      await context.addCookies(cookiesToAdd);
    } catch (e) {
      console.error('[pw-smoke] addCookies failed', e?.message || String(e));
      console.error('[pw-smoke] cookiesToAdd names', cookiesToAdd.map(c => c.name));
      console.error('[pw-smoke] effectiveTlCfLen', effectiveTlCf ? effectiveTlCf.length : 0);
    }
  }

  // Build a copy/paste cookie header for the target URL.
  try {
    const jarCookies = await context.cookies(url);
    cookieHeaderForTarget = jarCookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log('[pw-smoke] cookie header preview', {
      cookieCount: jarCookies.length,
      cookieNames: jarCookies.map(c => c.name).sort(),
      cookieHeaderLen: cookieHeaderForTarget.length,
    });
    console.log('[pw-smoke] cookie header', cookieHeaderForTarget);
  } catch (e) {
    console.error('[pw-smoke] cookie header build failed', e?.message || String(e));
  }

  const appliedCookieNames = (await context.cookies(`https://${host}/`)).map(c => c.name).sort();
  console.log('[pw-smoke] start', {
    url,
    headless: HEADLESS,
    host,
    cookiesDir,
    appliedCookieNames,
    curlFile: browserCurl?.curlPath || null,
    uaFromCurl: Boolean(browserCurl?.headers?.['user-agent']),
    cookieHeaderFromCurl: Boolean(browserCurl?.cookieHeader),
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const title = await page.title();
    const html = await page.content();

    const htmlLower = html.toLowerCase();
    const looksLikeChallenge =
      htmlLower.includes('<title>just a moment') ||
      htmlLower.includes('checking your browser') ||
      htmlLower.includes('cf-chl') ||
      htmlLower.includes('cf-ray') ||
      htmlLower.includes('attention required');

    console.log('[pw-smoke] result', {
      title,
      looksLikeChallenge,
      htmlHead: html.slice(0, 200),
    });

    const safeName =
      (new URL(url)).hostname.replace(/[^a-z0-9.-]/gi, '_') +
      (looksLikeChallenge ? '-challenge' : '-ok');

    await page.screenshot({ path: `${safeName}.png`, fullPage: true });
    console.log('[pw-smoke] screenshot saved', { path: `${safeName}.png` });
  } catch (err) {
    console.error('[pw-smoke] error', err?.message || String(err));
    try {
      await page.screenshot({ path: 'pw-smoke-error.png', fullPage: true });
      console.log('[pw-smoke] screenshot saved', { path: 'pw-smoke-error.png' });
    } catch {
      // ignore
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
