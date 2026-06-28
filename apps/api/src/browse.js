import fs from "fs";
import path from "node:path";
import { franc } from "franc-min";
import { getApiDataDir } from "./tvPaths.js";
import { getCandidateShows, markShowBrowsed } from "./tvmaze.js";
import { smartTitleMatch, unilog} from "@tv/share"

// --- Constants & Config ---

const IGNORED_COUNTRIES = new Set(
  [
    "Afghanistan",
    "Albania",
    "Algeria",
    "Argentina",
    "Armenia",
    "Austria",
    "Azerbaijan",
    "Bangladesh",
    "Belarus",
    "Belgium",
    "Bolivia, Plurinational State of",
    "Bosnia and Herzegovina",
    "Brazil",
    "Bulgaria",
    "Chile",
    "China",
    "Colombia",
    "Croatia",
    "Cyprus",
    "Czech Republic",
    "Egypt",
    "Estonia",
    "Faroe Islands",
    "Finland",
    "France",
    "French Polynesia",
    "Georgia",
    "Greece",
    "Hong Kong",
    "Hungary",
    "Iceland",
    "India",
    "Indonesia",
    "Iran, Islamic Republic of",
    "Iraq",
    "Israel",
    "Japan",
    "Kazakhstan",
    "Korea, Democratic People's Republic of",
    "Korea, Republic of",
    "Kuwait",
    "Kyrgyzstan",
    "Latvia",
    "Lebanon",
    "Lithuania",
    "Luxembourg",
    "Malaysia",
    "Maldives",
    "Moldova, Republic of",
    "Mongolia",
    "Nigeria",
    "Pakistan",
    "Peru",
    "Philippines",
    "Poland",
    "Portugal",
    "Puerto Rico",
    "Qatar",
    "Romania",
    "Russian Federation",
    "Saudi Arabia",
    "Senegal",
    "Serbia",
    "Singapore",
    "Slovakia",
    "Slovenia",
    "South Africa",
    "Sri Lanka",
    "Taiwan, Province of China",
    "Thailand",
    "Trinidad and Tobago",
    "Tunisia",
    "Turkey",
    "Ukraine",
    "United Arab Emirates",
    "Uzbekistan",
    "Vanuatu",
    "Venezuela, Bolivarian Republic of",
    "Viet Nam",
  ].map((s) => s.toLowerCase()),
);

const IGNORED_TYPES = new Set(
  [
    "Award Show",
    "Documentary",
    "Game Show",
    "News",
    "Panel Show",
    "Reality",
    "Sports",
    "Talk Show",
    "Variety",
  ].map((s) => s.toLowerCase()),
);

const avoidGenres = [
  "anime",
  "children",
  "documentary",
  "family",
  "food",
  "game Show",
  "game-show",
  "home & garden",
  "musical",
  "reality",
  "music",
  "talk",
  "stand-up",
  "travel",
  "war",
  "diy",
  "nature",
  "supernatural",
];

const DATA_DIR = getApiDataDir();
const resultTitlesPath = path.join(DATA_DIR, "browse-cards.json");

// --- State ---

let resultTitles = [];
let resultTitlesLoaded = false;

// --- Persistence Helpers ---

function atomicWriteTextFile(outPath, content) {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${outPath}.tmp-${Math.random().toString(16).slice(2)}`;
  try {
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, outPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    unilog(132, `Error saving ${outPath}:`, err);
  }
}

function atomicWriteJson(outPath, data) {
  atomicWriteTextFile(outPath, JSON.stringify(data, null, 2) + "\n");
}

function loadResultTitles() {
  if (!fs.existsSync(resultTitlesPath)) return [];
  try {
    const raw = fs.readFileSync(resultTitlesPath, "utf8");
    if (!raw || !raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .map(String)
          .filter((t) => !t.startsWith("Reality|") && !t.startsWith("reality|"))
      : [];
  } catch (err) {
    unilog(133, "Error loading browse-cards.json:", err);
    return [];
  }
}

function saveResultTitles() {
  // If we haven't loaded yet, don't overwrite with empty
  if (!resultTitlesLoaded) return;
  atomicWriteJson(resultTitlesPath, resultTitles);
}

function appendResultTitle(entry) {
  if (!entry) return;
  const newTitle = parseResultTitle(entry);
  if (newTitle) {
    // Deduplicate: remove older occurrence of same title (even if rejection status changed)
    resultTitles = resultTitles.filter((e) => parseResultTitle(e) !== newTitle);
  }
  resultTitles.push(String(entry));
  // Keep recent history limited to avoid growing forever
  while (resultTitles.length > 200) resultTitles.shift();
  saveResultTitles();
}
function parseResultTitle(entry) {
  const s = String(entry || "");
  try {
    if (s.trim().startsWith("{")) {
      const o = JSON.parse(s);
      if (o.title) return o.title;
    }
  } catch {}
  const bar = s.indexOf("|");
  if (bar < 0) return s;
  const rest = s.slice(bar + 1);
  const bar2 = rest.indexOf("|");
  return (bar2 < 0 ? rest : rest.slice(0, bar2)).trim();
}

// --- Initialization ---

try {
  resultTitles = loadResultTitles();
  resultTitlesLoaded = true;
} catch (e) {
  resultTitles = [];
}

// --- Filtering ---

function buildShowTitle(show) {
  let title = (show.name || "Unknown").trim();
  if (show.premiered) {
    const d = new Date(show.premiered * 1000);
    const y = d.getUTCFullYear();
    if (y && !Number.isNaN(y)) title = `${title} (${y})`;
  }
  return title;
}

/**
 * Returns the rejection reason string if the show should be skipped,
 * or null if the show passes all filters.
 * Pure check — no side effects (does not call markShowBrowsed).
 */
function getShowRejectionReason(show, title) {
  if (!show.image || (!show.image.medium && !show.image.original))
    return "no-image";

  if (resultTitles.some((entry) => parseResultTitle(entry) === title))
    return "already-seen";

  if (show.type && IGNORED_TYPES.has(show.type.toLowerCase())) return show.type;

  if (show.language) {
    const lang = String(show.language).trim().toLowerCase();
    if (lang !== "english") return "language";
  }

  const countryName = show.webChannel?.country?.name;
  if (countryName && IGNORED_COUNTRIES.has(countryName.toLowerCase()))
    return "country";

  const networkCountry = show.network?.country?.name;
  if (networkCountry && IGNORED_COUNTRIES.has(networkCountry.toLowerCase()))
    return "country";

  const genres = Array.isArray(show.genres) ? show.genres : [];
  const lowerGenres = genres.map((g) => g.toLowerCase());
  const rejectedGenre = lowerGenres.find((g) => avoidGenres.includes(g));
  if (rejectedGenre) return rejectedGenre;

  const summary = (show.summary || "").replace(/<[^>]*>/g, " ").trim();
  if (summary.length > 50) {
    const detected = franc(summary);
    if (detected !== "eng" && detected !== "und" && detected !== "sco")
      return "desc-language";
  }

  return null;
}

// --- Exports ---

/**
 * Returns the current list of result cards (browse history + new item).
 * Used for both initializing the browse view and fetching the next item.
 */
export async function getBrowseShow() {
  const candidates = getCandidateShows(100);

  let foundNew = false;
  let pendingBrowsedId = null;

  for (const show of candidates) {
    const title = buildShowTitle(show);
    const tvmazeId = show.tvmaze_id;

    const rejection = getShowRejectionReason(show, title);
    if (rejection !== null) {
      markShowBrowsed(tvmazeId);
      // Only add a rejected card for genre rejections (except reality which is silent)
      if (avoidGenres.includes(rejection) && rejection !== "reality") {
        appendResultTitle(
          JSON.stringify({
            status: rejection,
            title,
            imdbid: show.externals?.imdb,
            tvdbid: show.externals?.thetvdb,
            data: show,
          }),
        );
      }
      continue;
    }

    // Accepted
    appendResultTitle(
      JSON.stringify({
        status: "ok",
        title,
        imdbid: show.externals?.imdb,
        tvdbid: show.externals?.thetvdb,
        data: show,
      }),
    );
    foundNew = true;
    pendingBrowsedId = tvmazeId;
    break;
  }

  if (!foundNew) {
    return { titles: [], pendingBrowsedId: null };
  }
  return { titles: resultTitles, pendingBrowsedId };
}

export function hasBrowseShow() {
  const candidates = getCandidateShows(100);
  for (const show of candidates) {
    const title = buildShowTitle(show);
    if (getShowRejectionReason(show, title) === null) return true;
  }
  return false;
}

export async function getAllBrowse() {
  return resultTitles;
}

export function ackBrowsed(tvmazeId) {
  if (tvmazeId != null) markShowBrowsed(tvmazeId);
}

export function removeResultTitleByTvdbId(tvdbId, name) {
  const id = tvdbId != null ? Number(tvdbId) : null;
  if (id == null && !name) return;
  const before = resultTitles.length;
  // Build an array of candidate title strings for smartTitleMatch
  const candidateObjects = resultTitles.map((entry, idx) => ({
    _idx: idx,
    title: parseResultTitle(String(entry || "")),
  }));
  const toRemove = new Set();
  if (id != null) {
    resultTitles.forEach((entry, idx) => {
      try {
        const s = String(entry || "");
        if (s.trim().startsWith("{")) {
          const o = JSON.parse(s);
          if (o.tvdbid != null && Number(o.tvdbid) === id) toRemove.add(idx);
        }
      } catch {}
    });
  }
  if (name) {
    const matched = smartTitleMatch(name, candidateObjects, null, false);
    if (matched) {
      const matchedTitle =
        typeof matched === "string" ? matched : matched.title;
      candidateObjects.forEach((c) => {
        if (c.title === matchedTitle) toRemove.add(c._idx);
      });
    }
  }
  if (toRemove.size > 0) {
    resultTitles = resultTitles.filter((_, idx) => !toRemove.has(idx));
    saveResultTitles();
  }
}
