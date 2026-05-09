import fs from "fs";
import path from "node:path";
import { franc } from "franc-min";
import { getApiDataDir } from "./tvPaths.js";
import { getCandidateShows, markShowBrowsed } from "./tvmaze.js";
import { smartTitleMatch } from "@tv/share";

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
    console.error(`Error saving ${outPath}:`, err);
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
    console.error("Error loading browse-cards.json:", err);
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

// --- Exports ---

/**
 * Returns the current list of result cards (browse history + new item).
 * Used for both initializing the browse view and fetching the next item.
 */
export async function getBrowseShow() {
  // 1. Get candidates from DB (those with browsed != 1)
  // The query sorts by newest premiered date.
  const candidates = getCandidateShows(100);

  let foundNew = false;
  let pendingBrowsedId = null;

  for (const show of candidates) {
    let title = (show.name || "Unknown").trim();

    // Append year if premiered date is available
    if (show.premiered) {
      // premiered is stored as epoch seconds
      const d = new Date(show.premiered * 1000);
      const y = d.getUTCFullYear();
      if (y && !Number.isNaN(y)) {
        title = `${title} (${y})`;
      }
    }

    const tvmazeId = show.tvmaze_id;

    // Reject if no poster
    if (!show.image || (!show.image.medium && !show.image.original)) {
      markShowBrowsed(tvmazeId);
      continue;
    }

    // Check if we've seen this title in our recent resultTitles
    if (resultTitles.some((entry) => parseResultTitle(entry) === title)) {
      markShowBrowsed(tvmazeId);
      continue;
    }

    // Reject if type is in ignore list
    if (show.type && IGNORED_TYPES.has(show.type.toLowerCase())) {
      markShowBrowsed(tvmazeId);
      continue;
    }

    // Reject if language is not English (silent skip)
    // Accept standard string, or null/undefined
    if (show.language) {
      const lang = String(show.language).trim().toLowerCase();
      if (lang !== "english") {
        markShowBrowsed(tvmazeId);
        continue;
      }
    }

    // Reject if country is in ignore list
    const countryName = show.webChannel?.country?.name;
    if (countryName && IGNORED_COUNTRIES.has(countryName.toLowerCase())) {
      markShowBrowsed(tvmazeId);
      continue;
    }

    const networkCountry = show.network?.country?.name;
    if (networkCountry && IGNORED_COUNTRIES.has(networkCountry.toLowerCase())) {
      markShowBrowsed(tvmazeId);
      continue;
    }

    // Filter Genres
    // Show genres are usually in show.genres (array of strings)
    const genres = Array.isArray(show.genres) ? show.genres : [];
    const lowerGenres = genres.map((g) => g.toLowerCase());

    const rejected = lowerGenres.find((g) => avoidGenres.includes(g));

    if (rejected) {
      markShowBrowsed(tvmazeId);
      if (rejected === "reality") continue;
      // appendResultTitle(`${rejected}|${title}|${JSON.stringify(show)}`);
      appendResultTitle(
        JSON.stringify({
          status: rejected,
          title,
          imdbid: show.externals?.imdb,
          tvdbid: show.externals?.thetvdb,
          data: show,
        }),
      );
      // "If rejected add ... and continue" to look for next one
      continue;
    }

    // Analyze description language
    const summary = (show.summary || "").replace(/<[^>]*>/g, " ").trim();
    if (summary.length > 50) {
      // High certainty check: only if we have sufficient text
      const detected = franc(summary);
      // Skip if detected as non-English (and not 'und'etermined, and allow 'sco' as it is often false positive for English)
      if (detected !== "eng" && detected !== "und" && detected !== "sco") {
        markShowBrowsed(tvmazeId);
        continue;
      }
    }

    // Accepted
    // appendResultTitle(`ok|${title}|${JSON.stringify(show)}`);
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

    // "If all checks pass ... return resultTitles"
    // We stop after finding ONE accepted show, or if we exhaust our candidate batch.
    // If we only found rejected shows in this batch, we might return them.
    // But typical behavior (like getReel) is to return when we have a success or give up.
    // The prompt implies we return immediately upon success.
    break;
  }

  // If no new show was found, return empty titles so the client knows to show "no more".
  if (!foundNew) {
    return { titles: [], pendingBrowsedId: null };
  }
  return { titles: resultTitles, pendingBrowsedId };
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
