export * from "./episodeData.js";
export * from "./unilog.js";
export * from "./showFolder.js";
export * from "./showFilterSort.js";
export * from "./videoFiles.js";

export const TV_BLOCKED = {
  sample: true,
  ".sfv": true,
  ".FLEMISH.": true,
  ".flemish.": true,
  "Deleted Scenes": true,
  Commentary: true,
  Featurettes: true,
  Features: true,
  "Physical - S01E01": true,
  "Legends.Of.Tomorrow": true,
  "Last.Man.Standing": true,
  "Uncle.From.Another.World": true,
  german: true,
  "Crash and Burn": true,
  "Christine Keeler": true,
  "Love Recipe": true,
  "Millionaire Hot Seat": true,
  Hootenanny: true,
  "bravery-pleaselikeme": true,
  Blacklist: true,
  "Breakfast.at.Tiffany": true,
  "The.Postman.Always.Rings": true,
  Harlots: true,
  "Theater.Camp": true,
  Audio: true,
};

function normalizeBasic(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
  out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  out = out.toLowerCase();
  out = out.replace(/\b([a-z])\./g, "$1"); // collapse initials: "r.j." -> "rj"
  out = out.replace(/\./g, " ");
  out = out.replace(/&/g, " and ");
  out = out.replace(/['\u2019\u2018]/g, ""); // strip apostrophes: "margo's" -> "margos"
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

function extractYearFromTitle(s) {
  const text = String(s || "").trim();
  if (!text) return null;
  const paren = text.match(/\((\d{4})\)(?!.*\(\d{4}\))/);
  if (paren) return paren[1];
  const bare = text.match(/(?:^|\b)(\d{4})(?:\b|$)/);
  return bare ? bare[1] : null;
}

function getCandidateYear(x) {
  if (typeof x === "string") {
    return extractYearFromTitle(x);
  }
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

    const candTitle = coerceCandidateTitle(x);
    if (candTitle) {
      const titleYear = extractYearFromTitle(candTitle);
      if (titleYear) return titleYear;
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

  const resultTitle = (item) => coerceCandidateTitle(item);

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
  if (m1 != null) return resultTitle(m1);

  const m2 = findExact(normalizeBasic, wantBasic, isOneMissingYear);
  if (m2 != null) return resultTitle(m2);

  const m4 = findExact(normalizeAggressive, wantAgg, isSameYear);
  if (m4 != null) return resultTitle(m4);

  const m4b = findExact(normalizeAggressive, wantAgg, isOneMissingYear);
  if (m4b != null) return resultTitle(m4b);

  // Prefix match: if the search title starts with a candidate name (aggressive-normalized)
  // at a word boundary, it's a strong match (e.g. "odd man out complete series" starts with "odd man out")
  const findPrefix = (predicate) => {
    for (let i = 0; i < titleArray.length; i += 1) {
      const item = titleArray[i];
      if (!predicate(item)) continue;
      const candTitle = coerceCandidateTitle(item);
      if (!candTitle) continue;
      const candAgg = normalizeAggressive(candTitle);
      if (!candAgg) continue;
      if (wantAgg.length > candAgg.length && wantAgg.startsWith(candAgg + " "))
        return item;
    }
    return null;
  };

  // If forceChoice is explicitly false, we stop here (strict matching).
  // Prefix match is intentionally excluded from strict mode to avoid false positives
  // where a longer title like "Life, Larry..." prefix-matches a short title like "Life (2007)".
  if (forceChoice === false) return null;

  const mp1 = findPrefix(isSameYear);
  if (mp1 != null) return resultTitle(mp1);
  const mp2 = findPrefix(isOneMissingYear);
  if (mp2 != null) return resultTitle(mp2);

  const m5 = findExact(normalizeAggressive, wantAgg, isOneMissingYear);
  if (m5 != null) return resultTitle(m5);

  const m6 = findExact(normalizeBasic, wantBasic, isDifferentYear);
  if (m6 != null) return resultTitle(m6);

  const m7 = findExact(normalizeAggressive, wantAgg, isDifferentYear);
  if (m7 != null) return resultTitle(m7);

  const mp3 = findPrefix(isDifferentYear);
  if (mp3 != null) return resultTitle(mp3);

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

  return resultTitle(bestCand);
}

// pickTvdbSeries(results, name, year) => chosen TVDB search result | null
//
// TVDB lists the oldest series of a given name under the bare name and gives
// every later series of that name a "(YYYY)" suffix — "Poldark" is the 1975
// series, "Poldark (2015)" is the remake.  So an exact name match is no
// evidence that the right series was found, and taking results[0] always binds
// the show to the oldest one.
//
// Fold each result's own year into its title so smartTitleMatch can weigh the
// year, and when no year is known and more than one result carries the wanted
// name, return null rather than guessing.
export function pickTvdbSeries(results, name, year) {
  const list = Array.isArray(results) ? results : [];
  if (list.length === 0) return null;

  const yearOf = (r) => {
    const raw =
      String(r?.year ?? "") ||
      String(r?.firstAired ?? "") ||
      String(r?.first_air_time ?? "") ||
      String(r?.first_air_date ?? "");
    const y = raw.slice(0, 4);
    return /^\d{4}$/.test(y) ? y : null;
  };

  const titled = [];
  for (const rec of list) {
    const nm = String(rec?.name || "").trim();
    if (!nm) continue;
    const y = yearOf(rec);
    const alreadyHasYear = y && new RegExp(`\\(${y}\\)\\s*$`).test(nm);
    titled.push({ rec, title: y && !alreadyHasYear ? `${nm} (${y})` : nm });
  }
  if (titled.length === 0) return null;

  const wantYearRaw = year != null ? String(year).trim() : "";
  // A trailing "(YYYY)" on the wanted name is the caller naming the series it
  // means, same as TVDB's own disambiguation.  Only the parenthesized form
  // counts — a bare four digits can be the whole name ("1883").
  const wantYear = /^\d{4}$/.test(wantYearRaw)
    ? wantYearRaw
    : String(name || "").match(/\((\d{4})\)\s*$/)?.[1] || null;

  // Without a year the only honest answer for two same-named series is "don't
  // know" — either pick would silently bind the show to the wrong series.
  if (!wantYear) {
    const wantAgg = normalizeAggressive(name);
    let sameName = 0;
    for (const t of titled) {
      if (normalizeAggressive(t.title) === wantAgg) sameName += 1;
    }
    if (sameName > 1) return null;
  }

  const chosen = smartTitleMatch(
    name,
    titled.map((t) => t.title),
    wantYear,
    false,
  );
  if (!chosen) return null;
  return titled.find((t) => t.title === chosen)?.rec || null;
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

  // Step 4b: NxN format (e.g. "1x1 - Title.avi", "Show - 2x03 - Title.avi")
  if (!Number.isInteger(season) || !Number.isInteger(episode)) {
    const m = fname.match(/(?:^|[-_. ])(\d{1,2})x(\d{1,2})(?:\b|[-_ ])/i);
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

  // If ptt produced a title that starts with a NNN-prefix (e.g. "101-Lets Meet Mike and Euan.")
  // it's an episode title, not a series name — null it out so the folder fallback runs.
  if (title && /^\d{3}[\s\-]/.test(title)) {
    title = null;
  }

  // If ptt produced a title starting with NxN (e.g. "1x1 - The Sofa"), discard it
  // so the folder-name fallback provides the series name instead.
  if (title && /^\d{1,2}x\d{1,2}\b/.test(title)) {
    title = null;
  }

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
      if (title.startsWith(nnn)) {
        // NNN at start: "101-Episode Name" — this is an episode title, not a series name
        // Null it out so the folder-name fallback can provide the series name instead
        title = null;
      } else {
        // NNN at end: "Jam and Jerusalem 101 ..." → "Jam and Jerusalem"
        const stripped = title
          .replace(new RegExp("\\s+" + nnn + "\\b.*$"), "")
          .replace(/\s*\.\s*$/, "")
          .trim();
        if (stripped && stripped.length >= 2) title = stripped;
      }
    }
  }

  // PTT may not detect NNN episodes, but the title can still contain an embedded
  // 3-digit code (e.g. "Jam and Jerusalem 101 (11-24-06)."). Strip it.
  if (title && /\s\d{3}\b/.test(title)) {
    const stripped = title
      .replace(/\s\d{3}\b.*$/, "")
      .replace(/\s*\.\s*$/, "")
      .trim();
    if (stripped && stripped.length >= 2) title = stripped;
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
    // Reject episode identifiers (e.g. "2x5", "101") that slipped through as titles.
    if (title && /^\d{1,2}x\d{1,2}$/i.test(title)) title = null;
    if (title && /^\d{3}$/.test(title)) title = null;
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

  // Folder-name fallback: if still no title, try to extract series name from
  // the folder (e.g. "Off.Centre.S01-S02.webrip.mixed" → "Off Centre")
  if (!title && folderName) {
    const folderNoExt = folderName.replace(/\.[^.]+$/, "");
    // Strip after SxxExx or S01-S02 style markers
    const folderClean = folderNoExt
      .replace(/[._]/g, " ")
      .replace(/\s+S\d{1,2}[-–]\s*S?\d{1,2}.*/i, "")
      .replace(/\s+S\d{1,2}[._]?E\d{1,2}.*/i, "")
      .replace(/\s+Season\s+\d+.*/i, "")
      .replace(/\s+\d{4}($|\s).*/, "")
      .trim();
    if (folderClean && folderClean.length >= 2) title = folderClean;
  }

  // Strip "Complete" / "Complete Series" release tags
  // e.g. "The Norm Show - Complete" → "The Norm Show"
  if (title) {
    title = title
      .replace(/\s*-\s*Complete(?:\s+Series)?\s*$/i, "")
      .replace(/\s+Complete(?:\s+Series)?\s*$/i, "")
      .trim();
    if (!title) title = null;
  }

  // Normalize dots used as word separators (e.g. "The.Sketch.Show" → "The Sketch Show").
  // This occurs when a filename uses a mixed separator style: dots within the
  // title but a space before the episode marker (e.g. "The.Sketch.Show s01e01.avi").
  // PTT keeps the dots because it treats the space as the separator.
  // Only replace dots between multi-character words to preserve acronyms.
  if (title && title.includes(".")) {
    title = title
      .replace(/(?<=\w{2,})\.(?=\w)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return title || null;
}

export const STANDARD_RESOLUTIONS = new Set([2160, 1080, 720, 576, 480, 384]);

// True when a title/filename is hevc (x265/h265). Browsers can't play hevc, so
// chksrt has to fully transcode these to get a seekable mp4 mirror (minutes of
// cpu), while h264 only needs a lossless remux (seconds). Everywhere download
// priority is decided, an hevc release therefore loses to an equal-quality
// non-hevc one — see mpfour.js.
export function isHevc(nameOrTitle) {
  return /(x\.?265|h\.?[ .]?265|hevc)/i.test(String(nameOrTitle || ""));
}

export function normalizeVideoHeightToQuality(height) {
  const parsedHeight = Number.parseInt(height, 10);
  if (!Number.isFinite(parsedHeight) || parsedHeight <= 0) return null;
  if (parsedHeight >= 1620) return 2160;
  if (parsedHeight >= 900) return 1080;
  if (parsedHeight >= 648) return 720;
  if (parsedHeight >= 528) return 576;
  if (parsedHeight >= 400) return 480;
  if (parsedHeight >= 340) return 384;
  return null;
}

export function computeShowQuality(fileQuality) {
  if (!fileQuality || Object.keys(fileQuality).length === 0) return null;
  const counts = {};
  for (const q of Object.values(fileQuality)) {
    counts[q] = (counts[q] ?? 0) + 1;
  }
  let best = null;
  let bestCount = 0;
  for (const [res, cnt] of Object.entries(counts)) {
    const r = Number(res);
    if (cnt > bestCount || (cnt === bestCount && r > best)) {
      best = r;
      bestCount = cnt;
    }
  }
  return best;
}

export function getResolution(
  nameOrPath,
  { probeFileFn, findShowFileFn } = {},
) {
  const src = String(nameOrPath || "");

  // ── Step 1: parse <N>p from the name ──────────────────────────────────────
  let nameResolution = null;
  const nameMatch = src.match(/\b(\d{3,4})p\b/i);
  if (nameMatch) {
    nameResolution = Number.parseInt(nameMatch[1], 10);
    if (!Number.isFinite(nameResolution)) nameResolution = null;
  }
  if (nameResolution !== null && STANDARD_RESOLUTIONS.has(nameResolution)) {
    return nameResolution;
  }

  // NTSC/PAL are SD source tags, not a <N>p resolution — map them directly.
  if (/\bntsc\b/i.test(src)) return 480;
  if (/\bpal\b/i.test(src)) return 576;

  // ── Step 2: probe the actual file ─────────────────────────────────────────
  let fileResolution = null;
  if (probeFileFn) {
    let fullPath = null;
    const hasSlash = src.includes("/");

    if (hasSlash) {
      fullPath = src;
    } else if (findShowFileFn) {
      const showName = parseTitleFromFilename(src, "", null);
      if (showName) {
        fullPath = findShowFileFn(showName) ?? null;
      }
    }

    if (fullPath) {
      try {
        const rawHeight = probeFileFn(fullPath);
        if (rawHeight != null) fileResolution = Number.parseInt(rawHeight, 10);
        if (!Number.isFinite(fileResolution)) fileResolution = null;
      } catch {
        fileResolution = null;
      }
    }
  }

  if (fileResolution !== null && STANDARD_RESOLUTIONS.has(fileResolution)) {
    return fileResolution;
  }

  // ── Step 3: normalize whichever non-null value we have ────────────────────
  const heightToNormalize =
    nameResolution !== null
      ? nameResolution
      : fileResolution !== null
        ? fileResolution
        : null;

  if (heightToNormalize === null) return null;
  return normalizeVideoHeightToQuality(heightToNormalize) ?? null;
}

// Format a ms time position/duration as mmm:ss.t
// - minutes (no hours) only shown when value >= 60s
// - leading zero of seconds suppressed when value < 10s
// - tenths of a second always shown
// - 0 -> "--", null/undefined -> "" (blank)
export function fmtPos(ms) {
  if (ms == null) return "";
  if (ms === 0) return "--";
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec - min * 60;
  const tenth = Math.floor((sec % 1) * 10);
  const wholeSec = Math.floor(sec);
  if (min > 0) {
    return `${min}:${String(wholeSec).padStart(2, "0")}.${tenth}`;
  }
  return `${wholeSec}.${tenth}`;
}

// Return the intro-data object for a season from a sparse seasonIntros map
// { [season]: { trimPos, startMark, skipDur } }. Falls back to the nearest
// season that HAS data (closest smaller first, then closest larger). When
// seasonIntros is null/absent/empty, returns an all-null object. Always a
// shallow copy so callers can't mutate stored data.
const EMPTY_SEASON_INTRO = {
  trimPos: null,
  startMark: null,
  skipDur: null,
  none: false,
};

export function getSeasonIntro(seasonIntros, season) {
  const map = seasonIntros;
  if (!map || typeof map !== "object") return { ...EMPTY_SEASON_INTRO };
  const keys = Object.keys(map);
  if (keys.length === 0) return { ...EMPTY_SEASON_INTRO };

  const s = Number(season);
  if (Number.isFinite(s) && map[s] != null) {
    return { ...EMPTY_SEASON_INTRO, ...map[s] };
  }
  if (Number.isFinite(s)) {
    const nums = keys
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    // closest smaller season that has data
    let below = null;
    for (const n of nums) if (n < s) below = n;
    if (below != null) return { ...EMPTY_SEASON_INTRO, ...map[below] };
    // else closest larger season that has data
    for (const n of nums) {
      if (n > s) return { ...EMPTY_SEASON_INTRO, ...map[n] };
    }
  }
  return { ...EMPTY_SEASON_INTRO };
}
