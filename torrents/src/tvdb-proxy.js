import process from 'node:process';

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
    const tvdbPath = req.params[0] || '';
    const url = buildTvdbUrl(tvdbPath, req.query);

    let token = await getToken();
    let upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    // Retry once on auth failure
    if (upstream.status === 401) {
      cachedToken = null;
      token = await getToken();
      upstream = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    }

    const body = await upstream.text();
    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.send(body);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
