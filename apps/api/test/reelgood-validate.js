import fs from 'fs';
import path from 'node:path';

function fail(msg) {
  console.error(`[reelgood-validate] ${msg}`);
  process.exitCode = 1;
}

function readJson(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function titleFromEntry(entry) {
  const s = String(entry || '');
  const idx = s.indexOf('|');
  return idx >= 0 ? s.slice(idx + 1).trim() : '';
}

function main() {
  const root = path.resolve(process.cwd());
  const showsPath = path.join(root, 'reel-shows.json');
  const titlesPath = path.join(root, 'reelgood-titles.json');
  const callsPath = path.join(root, 'calls.log');

  if (fs.existsSync(showsPath)) {
    try {
      const shows = readJson(showsPath);
      if (!shows || typeof shows !== 'object' || Array.isArray(shows)) {
        fail(`reel-shows.json is not an object: ${showsPath}`);
      } else {
        console.log('[reelgood-validate] reel-shows.json ok', { keys: Object.keys(shows).length });
      }
    } catch (e) {
      fail(`reel-shows.json is invalid JSON: ${e?.message || String(e)}`);
    }
  } else {
    console.log('[reelgood-validate] reel-shows.json missing (ok)');
  }

  if (fs.existsSync(titlesPath)) {
    try {
      const titles = readJson(titlesPath);
      if (!Array.isArray(titles)) {
        fail(`reelgood-titles.json is not an array: ${titlesPath}`);
      } else {
        const titleCounts = new Map();
        for (const entry of titles) {
          const t = titleFromEntry(entry);
          if (!t) continue;
          titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
        }
        const dups = [...titleCounts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
        console.log('[reelgood-validate] reelgood-titles.json ok', { entries: titles.length, uniqueTitles: titleCounts.size, dupTitles: dups.length });
        if (dups.length) {
          console.log('[reelgood-validate] duplicate titles (top 10):');
          for (const [t, c] of dups.slice(0, 10)) console.log(`- ${c}x ${t}`);
        }
      }
    } catch (e) {
      fail(`reelgood-titles.json is invalid JSON: ${e?.message || String(e)}`);
    }
  } else {
    console.log('[reelgood-validate] reelgood-titles.json missing (ok)');
  }

  if (fs.existsSync(callsPath)) {
    const raw = fs.readFileSync(callsPath, 'utf8');
    const hits = (raw.match(/My Pet Ate What/gi) || []).length;
    console.log('[reelgood-validate] calls.log present', { myPetAteWhatOccurrences: hits });
  }
}

main();
