import process from 'node:process';

const LOG_BODY_MAX_CHARS = 800;
const LOG_JSON_KEYS_MAX = 40;

// NOTE: These credentials currently exist client-side in src/tvdb.js.
// This proxy prevents the browser from sending Authorization headers to api4.thetvdb.com.
const TVDB_APIKEY = 'd7fa8c90-36e3-4335-a7c0-6cbb7b0320df';
const TVDB_PIN = 'HXEVSDFF';

let cachedToken = null;
let cachedAtMs = 0;

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function getToken() {
  // Simple refresh strategy: refresh every ~20 hours or on 401.
  const now = Date.now();
  if (cachedToken && now - cachedAtMs < 20 * 60 * 60 * 1000) return cachedToken;

  const { res, json, text } = await fetchJson('https://api4.thetvdb.com/v4/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: TVDB_APIKEY, pin: TVDB_PIN }),
  });

  if (!res.ok) {
    throw new Error(`TVDB login failed: ${res.status} ${text?.slice(0, 200) || ''}`.trim());
  }

  const token = json?.data?.token;
  if (!token) throw new Error('TVDB login failed: missing token');
  cachedToken = token;
  cachedAtMs = now;
  return token;
}

function buildTvdbUrl(tvdbPath, query) {
  const safePath = String(tvdbPath || '').replace(/^\/+/, '');
  const url = new URL(`https://api4.thetvdb.com/v4/${safePath}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  return url;
}

export async function tvdbProxyGet(req, res) {
  try {
    const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAtMs = Date.now();
    const tvdbPath = req.params[0] || '';
    
    // Explicitly debug the incoming request data
    console.log('TVDB Proxy Incoming:', {
      reqId,
      method: req.method,
      originalUrl: req.originalUrl,
      tvdbPath,
      query: req.query,
    });

    const url = buildTvdbUrl(tvdbPath, req.query);

    console.log('TVDB proxy upstream URL:', { reqId, url: url.toString() });

    let token = await getToken();
    let upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    console.log('TVDB upstream status:', { reqId, status: upstream.status });

    // Retry once on auth failure
    if (upstream.status === 401) {
      console.log('TVDB auth failed, refreshing token', { reqId });
      cachedToken = null;
      token = await getToken();
      upstream = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      console.log('TVDB retry status:', { reqId, status: upstream.status });
    }

    const body = await upstream.text();

    const elapsedMs = Date.now() - startedAtMs;
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const bodyLen = body ? body.length : 0;

    let bodySnippet = '';
    if (body) {
      bodySnippet = body.slice(0, LOG_BODY_MAX_CHARS);
    }

    // Best-effort metadata for quick scanning in logs.
    // Avoid dumping huge JSON objects; just report top-level keys.
    let jsonKeys = null;
    try {
      if (contentType.includes('application/json') && body) {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          jsonKeys = Object.keys(parsed).slice(0, LOG_JSON_KEYS_MAX);
        }
      }
    } catch {
      jsonKeys = null;
    }

    const logPayload = {
      reqId,
      upstreamStatus: upstream.status,
      elapsedMs,
      contentType,
      bodyLen,
      jsonKeys,
      bodySnippet,
    };

    if (!upstream.ok) console.error('TVDB proxy response:', logPayload);
    else console.log('TVDB proxy response:', logPayload);

    res.status(upstream.status);
    res.set('Content-Type', contentType);
    res.send(body);
  } catch (e) {
    console.error('TVDB proxy error:', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
}
