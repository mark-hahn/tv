function normalizeBasic(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeAggressive(s) {
  let out = String(s || "");
  const idx = out.indexOf("(");
  if (idx >= 0) {
    out = out.slice(0, idx);
  }
  out = out.toLowerCase();
  out = out.replace(/\./g, " ");
  out = out.replace(/[^a-z0-9\s]/g, " ");
  out = out.trim().replace(/\s+/g, " ");
  return out;
}

function coerceCandidateTitle(x) {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    if (typeof x.Name === "string") return x.Name;
    if (typeof x.name === "string") return x.name;
    if (typeof x.title === "string") return x.title;
  }
  return null;
}

function getCandidateYear(x) {
  if (x && typeof x === "object") {
    // Custom for TV app: Premiered (YYYY-MM-DD or YYYY)
    if (x.Premiered) {
      const s = String(x.Premiered).trim();
      if (s.length >= 4) return s.substring(0, 4);
    }
    // Rotten Tomatoes style
    if (x.startyear) return x.startyear;
    // TMDB style
    if (x.first_air_date) {
      if (
        typeof x.first_air_date === "string" &&
        x.first_air_date.length >= 4
      ) {
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

  const m = a.length,
    n = b.length;
  let prev = new Uint16Array(m + 1);
  let curr = new Uint16Array(m + 1);

  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      const del = prev[i] + 1;
      const ins = curr[i - 1] + 1;
      const sub = prev[i - 1] + cost;
      curr[i] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
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
// forceChoice:
//   true  -> Always find a match (no early exit, no distance threshold).
//   false -> Return null if no match found by step 4 (Aggressive + MissingYear).
export function smartTitleMatch(title, titleArray, year, forceChoice) {
  if (!Array.isArray(titleArray) || titleArray.length === 0) {
    return null;
  }

  const wantBasic = normalizeBasic(title);
  const wantAgg = normalizeAggressive(title);

  const wantYearRaw = year != null ? String(year).trim() : "";
  const wantYear = /^\d{4}$/.test(wantYearRaw) ? wantYearRaw : null;

  const candidateYear = (x) => {
    const cy = getCandidateYear(x);
    if (cy == null) return null;
    const s = String(cy).trim();
    return /^\d{4}$/.test(s) ? s : null;
  };

  const isSameYear = (x) => {
    if (!wantYear) return false;
    const cy = candidateYear(x);
    return cy != null && cy === wantYear;
  };

  const isOneMissingYear = (x) => {
    if (!wantYear) return true;
    return candidateYear(x) == null;
  };

  const isDifferentYear = (x) => {
    if (!wantYear) return false;
    const cy = candidateYear(x);
    return cy != null && cy !== wantYear;
  };

  const findExact = (normalizeFn, wantNorm, predicate) => {
    for (let i = 0; i < titleArray.length; i += 1) {
      const item = titleArray[i];
      if (!predicate(item)) continue;
      const candTitle = coerceCandidateTitle(item);
      if (!candTitle) continue;
      if (normalizeFn(candTitle) === wantNorm) return item;
    }
    return null;
  };

  // Scan in requested priority order:
  // 1) both have years, same year -> basic
  // 2) one doesn't have a year -> basic
  // 3) both have years, same year -> aggressive
  // 4) one doesn't have a year -> aggressive
  // 5) both have years, different years -> basic
  // 6) both have years, different years -> aggressive
  const m1 = findExact(normalizeBasic, wantBasic, isSameYear);
  if (m1 != null) return m1;

  const m2 = findExact(normalizeBasic, wantBasic, isOneMissingYear);
  if (m2 != null) return m2;

  const m4 = findExact(normalizeAggressive, wantAgg, isSameYear);
  if (m4 != null) return m4;

  // If forceChoice is explicity false, we stop here (strict matching).
  if (forceChoice === false) return null;

  const m5 = findExact(normalizeAggressive, wantAgg, isOneMissingYear);
  if (m5 != null) return m5;

  const m6 = findExact(normalizeBasic, wantBasic, isDifferentYear);
  if (m6 != null) return m6;

  const m7 = findExact(normalizeAggressive, wantAgg, isDifferentYear);
  if (m7 != null) return m7;

  // If none of the above match, use Levenshtein.
  let bestCand = null;
  let minDistance = Infinity;
  let bestRank = Infinity;

  const yearRank = (x) => {
    if (isSameYear(x)) return 1;
    if (isOneMissingYear(x)) return 2;
    if (isDifferentYear(x)) return 3;
    return 4;
  };

  for (let k = 0; k < titleArray.length; k += 1) {
    const item = titleArray[k];
    const candTitle = coerceCandidateTitle(item);
    if (!candTitle) continue;

    const normCand = normalizeAggressive(candTitle);
    const dist = levenshtein(wantAgg, normCand);

    // Safety check: ensure distance is reasonable relative to string length
    // If the distance is more than 50% of the shorter string's length,
    // it's probably not a real match.
    // e.g. "Cheers" (6) vs "Funny Woman" (11) -> distance is huge
    const minLen = Math.min(wantAgg.length, normCand.length);
    const maxAllowedDist = Math.max(2, Math.floor(minLen * 0.4)); // 40% threshold

    // If forceChoice is true, we IGNORE the distance threshold (accepting matches "even if big").
    // If forceChoice is false, we would enforce it, but we already returned null above.
    if (!forceChoice && dist > maxAllowedDist) continue;

    const rank = yearRank(item);
    if (dist < minDistance || (dist === minDistance && rank < bestRank)) {
      minDistance = dist;
      bestRank = rank;
      bestCand = item;
    }
  }

  return bestCand;
}

// parseFileSeasonEpisode(fname, folderName, parsedPtt, parsedPttFolder) => { season, episode } | null
//
// Shared cascade for extracting season/episode from a video filename.
// parsedPtt / parsedPttFolder are optional pre-computed results from parse-torrent-title
// (passing them in keeps this package free of that dependency).
//
// Steps:
//  1. Seed from parsedPtt if provided
//  2. Clamp episode > 99 → clear both (compact NNN code misread as episode)
//  3. Clamp episode > 50 → clear episode only
//  4. SxxExx / Sxx.Exx regex
//  5. Compact NNN code (e.g. "101" → S1E01)
//  6. "Season N" / "Episode N" text in filename
//  7. Folder name fallbacks (Season text, S## pattern, parsedPttFolder)
//
// Returns null if nothing was found.
export function parseFileSeasonEpisode(
  fname,
  folderName,
  parsedPtt,
  parsedPttFolder,
) {
  let season = parsedPtt != null ? parsedPtt.season : undefined;
  let episode = parsedPtt != null ? parsedPtt.episode : undefined;

  // Step 2: episode > 99 means parse-torrent-title read a compact NNN code (e.g. 101)
  // as a raw episode number; it also derives season from the leading digit — clear both.
  if (Number.isInteger(episode) && episode > 99) {
    season = undefined;
    episode = undefined;
  } else if (Number.isInteger(episode) && episode > 50) {
    // Step 3: implausibly large 2-digit episode — just clear episode, season may be valid.
    episode = undefined;
  }

  // Step 4: SxxExx / Sxx.Exx / Sxx_Exx / Sxx - Exx
  if (!Number.isInteger(season) || !Number.isInteger(episode)) {
    const m = fname.match(/S(\d{1,2})(?:[._ ]?|-\s*|\s+-\s*)E(\d{1,2})/i);
    if (m) {
      season = parseInt(m[1], 10);
      episode = parseInt(m[2], 10);
    }
  }

  // Step 5: compact NNN (first digit = season, last two = episode; e.g. 101 → S1E01)
  if (!Number.isInteger(season) && !Number.isInteger(episode)) {
    const m = fname.match(/\b([1-9])(\d{2})\b/);
    if (m) {
      season = parseInt(m[1], 10);
      episode = parseInt(m[2], 10);
    }
  }

  // Step 6a: "Season N" text in filename
  if (!Number.isInteger(season)) {
    const m = fname.match(/Season\s+(\d+)/i);
    if (m) season = parseInt(m[1], 10);
  }

  // Step 6b: "Episode N" text in filename
  if (!Number.isInteger(episode)) {
    const m = fname.match(/Episode\s+(\d+)/i);
    if (m) episode = parseInt(m[1], 10);
  }

  // Step 7: folder name fallbacks
  if (!Number.isInteger(season) && folderName) {
    const m1 = (folderName || "").match(/Season\s+(\d+)/i);
    if (m1) {
      season = parseInt(m1[1], 10);
    } else {
      const m2 = (folderName || "").match(/S(\d{1,2})(?!\d)/i);
      if (m2) {
        season = parseInt(m2[1], 10);
      } else if (parsedPttFolder && parsedPttFolder.season != null) {
        season = parsedPttFolder.season;
      }
    }
  }

  if (!Number.isInteger(season) && !Number.isInteger(episode)) return null;
  return {
    season: Number.isInteger(season) ? season : null,
    episode: Number.isInteger(episode) ? episode : null,
  };
}

// parseTitleFromFilename(fname, folderName, parsedPtt) => string | null
//
// Extracts the series title from a video filename.
// parsedPtt is an optional pre-computed result from parse-torrent-title.
//
// Cascade:
//  1. Use parsedPtt.title if available
//  2. Space-separated regex: text before SxxExx / "Season N" / "NxNN" / " - "
//  3. Dot-separated fallback: tokens before SxxExx pattern, strip year tokens
//  4. Returns null if nothing usable was found
//
// NNN compact-code titles (e.g. "Jam and Jerusalem 101") are stripped of the
// code so the caller gets a clean series name.
export function parseTitleFromFilename(fname, folderName, parsedPtt) {
  let title = parsedPtt != null && parsedPtt.title ? parsedPtt.title : null;

  // When parsedPtt found a compact NNN episode (episode > 99), it spliced the
  // NNN code into the title string — strip it.
  if (
    title &&
    parsedPtt != null &&
    Number.isInteger(parsedPtt.episode) &&
    parsedPtt.episode > 99
  ) {
    // e.g. "Jam and Jerusalem 101 (11-24-06)." → "Jam and Jerusalem"
    const nnn =
      String(parsedPtt.season || "") +
      String(
        parsedPtt.episode != null
          ? String(parsedPtt.episode).padStart(2, "0")
          : "",
      );
    if (nnn.length === 3) {
      const stripped = title
        .replace(new RegExp("\\s+" + nnn + "\\b.*$"), "")
        .replace(/\s*\.\s*$/, "")
        .trim();
      if (stripped && stripped.length >= 2) title = stripped;
    }
  }

  // Space-separated fallback: extract text before episode marker
  if (!title) {
    const noExt = fname.replace(/\.[^.]+$/, "");
    const m = noExt.match(
      /^(.*?)(?:\s+-\s+(?:Season|Episode)\s+\d+|\s+S\d{1,2}[._]?E\d+|\s+\d+x\d+)/i,
    );
    if (m && m[1].trim()) {
      title = m[1].trim();
    } else {
      const dashIdx = noExt.indexOf(" - ");
      if (dashIdx > 0) title = noExt.slice(0, dashIdx).trim();
    }
  }

  // Dot-separated fallback: e.g. "Paradise.2025.S02E05.1080p..." → "Paradise"
  if (!title) {
    const seIdx = fname.search(/S\d{1,2}[._]?E\d{1,2}/i);
    if (seIdx > 0) {
      const before = fname.slice(0, seIdx);
      const words = before
        .split(/[._]+/)
        .map((w) => w.trim())
        .filter((w) => w && !/^\d{4}$/.test(w));
      if (words.length) title = words.join(" ");
    }
  }

  return title || null;
}
