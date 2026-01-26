const STORAGE_KEY = "tv.searchHistory.v1";
const MAX_ENTRIES = 50;

function safeParseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeQuery(query) {
  return String(query ?? "").trim();
}

export function isValidSearchQuery(query) {
  const q = normalizeQuery(query);
  if (!q) return false;
  // Avoid persisting UI status messages into history.
  if (/^--/.test(q)) return false;
  if (/^no series\.?$/i.test(q)) return false;
  return true;
}

export function loadSearchHistory() {
  const parsed = safeParseJson(localStorage.getItem(STORAGE_KEY));
  if (!Array.isArray(parsed)) return [];
  return parsed.map((x) => normalizeQuery(x)).filter((x) => Boolean(x));
}

export function saveSearchHistory(entries) {
  const arr = Array.isArray(entries) ? entries : [];
  const cleaned = arr
    .map((x) => normalizeQuery(x))
    .filter((x) => Boolean(x))
    .slice(0, MAX_ENTRIES);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  return cleaned;
}

export function addSearchHistoryEntry(query) {
  const q = normalizeQuery(query);
  if (!isValidSearchQuery(q)) return loadSearchHistory();

  const history = loadSearchHistory();
  const next = [q, ...history.filter((x) => x !== q)].slice(0, MAX_ENTRIES);
  return saveSearchHistory(next);
}
