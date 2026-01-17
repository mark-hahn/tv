import path from 'node:path';
import fs from 'node:fs';

export const DEFAULT_TV_DATA_DIR = '/root/dev/apps/tv-data';

export function getTvDataDir() {
  let v = process.env.TV_DATA_DIR;
  if (typeof v === 'string') {
    v = v.trim();
    if (v) return v;
  }
  return DEFAULT_TV_DATA_DIR;
}

export function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

export function getTvPaths() {
  const base = getTvDataDir();
  const secretsDir = path.join(base, 'secrets');

  const apiDir = path.join(base, 'api');
  const downDir = path.join(base, 'down');
  const srvrDir = path.join(base, 'srvr');

  return {
    base,
    secretsDir,
    api: {
      baseDir: apiDir,
      cookiesDir: path.join(apiDir, 'cookies'),
      miscDir: path.join(apiDir, 'misc'),
      dataDir: path.join(apiDir, 'data'),
    },
    down: {
      baseDir: downDir,
      dataDir: path.join(downDir, 'data'),
      miscDir: path.join(downDir, 'misc'),
    },
    srvr: {
      baseDir: srvrDir,
      dataDir: path.join(srvrDir, 'data'),
      miscDir: path.join(srvrDir, 'misc'),
    },
  };
}

export function ensureTvDataLayout() {
  const p = getTvPaths();
  ensureDir(p.base);
  ensureDir(p.secretsDir);
  ensureDir(p.api.baseDir);
  ensureDir(p.api.cookiesDir);
  ensureDir(p.api.dataDir);
  ensureDir(p.api.miscDir);
  ensureDir(p.down.baseDir);
  ensureDir(p.down.dataDir);
  ensureDir(p.down.miscDir);
  ensureDir(p.srvr.baseDir);
  ensureDir(p.srvr.dataDir);
  ensureDir(p.srvr.miscDir);
  return p;
}

export function normalizeBasic(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function normalizeAggressive(s) {
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
// 3) fallback to first non-empty candidate
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

  for (let k = 0; k < titleArray.length; k += 1) {
    const cand3 = coerceCandidateTitle(titleArray[k]);
    if (cand3) return cand3;
  }
  return null;
}
