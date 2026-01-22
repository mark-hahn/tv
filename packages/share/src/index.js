function normalizeBasic(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeAggressive(s) {
  let out = String(s || '');
  const idx = out.indexOf('(');
  if (idx >= 0) {
    out = out.slice(0, idx);
  }
  out = out.toLowerCase();
  out = out.replace(/\./g, ' ');
  out = out.replace(/[^a-z0-9\s]/g, ' ');
  out = out.trim().replace(/\s+/g, ' ');
  return out;
}

function coerceCandidateTitle(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    if (typeof x.name === 'string') return x.name;
    if (typeof x.title === 'string') return x.title;
  }
  return null;
}

function getCandidateYear(x) {
  if (x && typeof x === 'object') {
    // Rotten Tomatoes style
    if (x.startyear) return x.startyear;
    // TMDB style
    if (x.first_air_date) {
      if (typeof x.first_air_date === 'string' && x.first_air_date.length >= 4) {
        return x.first_air_date.substring(0, 4);
      }
    }
  }
  return null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  if (a.length > b.length) [a, b] = [b, a];

  const m = a.length, n = b.length;
  let prev = new Uint16Array(m + 1);
  let curr = new Uint16Array(m + 1);

  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const cost = (a.charCodeAt(i - 1) === bj) ? 0 : 1;
      const del = prev[i] + 1;
      const ins = curr[i - 1] + 1;
      const sub = prev[i - 1] + cost;
      curr[i] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

// smartTitleMatch(title, titleArray) => chosenName
// Strategy:
// 1) exact basic-normalized match
// 2) exact aggressive-normalized match
// 3) fallback to Levenshtein distance match
//
// Optimized for Objects with Year info:
// If 'year' (number or string) is provided, we prioritize
// candidates that match that year.
export function smartTitleMatch(title, titleArray, year) {
  if (!Array.isArray(titleArray) || titleArray.length === 0) {
    return null;
  }

  // Filter by year if caller provided one
  let candidates = titleArray;
  if (year) {
    // We treat year simply as a string match for robustness
    const wantYear = String(year).trim();
    if (wantYear.match(/^\d{4}$/)) {
      const yearMatches = titleArray.filter(c => {
        const cy = getCandidateYear(c);
        return cy && String(cy).trim() === wantYear;
      });
      if (yearMatches.length > 0) {
        candidates = yearMatches;
      }
    }
  }

  const wantBasic = normalizeBasic(title);
  for (let i = 0; i < candidates.length; i += 1) {
    const cand = coerceCandidateTitle(candidates[i]);
    if (!cand) continue;
    if (normalizeBasic(cand) === wantBasic) {
      return candidates[i];
    }
  }

  const wantAgg = normalizeAggressive(title);
  for (let j = 0; j < candidates.length; j += 1) {
    const cand2 = coerceCandidateTitle(candidates[j]);
    if (!cand2) continue;
    if (normalizeAggressive(cand2) === wantAgg) {
      return candidates[j];
    }
  }

  let bestCand = null;
  let minDistance = Infinity;

  for (let k = 0; k < candidates.length; k += 1) {
    const cand3 = coerceCandidateTitle(candidates[k]);
    if (!cand3) continue;
    
    const dist = levenshtein(wantAgg, normalizeAggressive(cand3));
    if (dist < minDistance) {
      minDistance = dist;
      bestCand = candidates[k]; // return original object
    }
  }
  
  return bestCand;
}
