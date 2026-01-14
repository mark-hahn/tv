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

    // Back-compat: old tv-proc returned a raw array of titles.
    if (Array.isArray(data)) {
      return { existingTitles: data.map((t) => String(t)), existingProcids: [] };
    }

    // New shape: { existingTitles: string[], existingProcids: any[] }
    if (!data || typeof data !== 'object') {
      throw new Error(`tv-proc checkFiles expected JSON object, got ${data === null ? 'null' : typeof data}`);
    }

    const existingTitles = Array.isArray(data.existingTitles) ? data.existingTitles.map((t) => String(t)) : [];
    const existingProcids = Array.isArray(data.existingProcids) ? data.existingProcids : [];
    return { existingTitles, existingProcids };
  } finally {
    clearTimeout(timer);
  }
}
