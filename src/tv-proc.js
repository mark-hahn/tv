const DEFAULT_TVPROC_BASE_URL = 'http://localhost:3003';

function normalizeTitles(titles) {
  const arr = Array.isArray(titles) ? titles : [];
  return arr
    .map((t) => String(t || '').trim())
    .filter(Boolean);
}

/**
 * Ask tv-proc which of these filenames/titles are already downloaded.
 *
 * POST {baseUrl}/checkFiles
 * Body: JSON array of strings
 * Response: JSON array of strings (the already-downloaded subset)
 */
export async function checkFiles(titles, { baseUrl, timeoutMs = 5000 } = {}) {
  const list = normalizeTitles(titles);
  const root = String(baseUrl || DEFAULT_TVPROC_BASE_URL).replace(/\/+$/, '');
  const url = `${root}/checkFiles`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(list),
      signal: controller.signal,
    });

    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!resp.ok) {
      const detail = text ? text.slice(0, 500) : '';
      throw new Error(`tv-proc checkFiles failed: HTTP ${resp.status} ${resp.statusText}${detail ? ` :: ${detail}` : ''}`);
    }

    if (!Array.isArray(data)) {
      throw new Error(`tv-proc checkFiles expected JSON array, got ${data === null ? 'null' : typeof data}`);
    }

    return data.map((t) => String(t));
  } finally {
    clearTimeout(timer);
  }
}
