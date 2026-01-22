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

// smartTitleMatch(title, titleArray) => chosenName
// Strategy:
// 1) exact basic-normalized match
// 2) exact aggressive-normalized match
// 3) fallback to first candidate
export function smartTitleMatch(title, titleArray) {
  if (!Array.isArray(titleArray) || titleArray.length === 0) {
    return null;
  }

  const wantBasic = normalizeBasic(title);
  for (let i = 0; i < titleArray.length; i += 1) {
    const cand = coerceCandidateTitle(titleArray[i]);
    if (!cand) continue;
    if (normalizeBasic(cand) === wantBasic) {
      return cand;
    }
  }

  const wantAgg = normalizeAggressive(title);
  for (let j = 0; j < titleArray.length; j += 1) {
    const cand2 = coerceCandidateTitle(titleArray[j]);
    if (!cand2) continue;
    if (normalizeAggressive(cand2) === wantAgg) {
      return cand2;
    }
  }

  return coerceCandidateTitle(titleArray[0]);
}
