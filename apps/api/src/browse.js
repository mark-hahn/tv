import fs from "fs";
import path from "node:path";
import { getApiDataDir } from "./tvPaths.js";
import { getCandidateShows, markShowBrowsed } from "./tvmaze.js";

// --- Constants & Config ---

const avoidGenres = [
  "anime",
  "children",
  "documentary",
  "family",
  "food",
  "game Show",
  "game-show",
  "history",
  "home & garden",
  "musical",
  "reality",
  "sport",
  "talk",
  "stand-up",
  "travel",
  "war",
  "western",
  "diy",
  "legal",
  "medical",
  "nature",
  "sports",
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
    return Array.isArray(parsed) ? parsed.map(String) : [];
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
  const bar = s.indexOf("|");
  return bar < 0 ? s : s.slice(bar + 1).trim();
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

  for (const show of candidates) {
    const title = (show.name || "Unknown").trim();
    const tvmazeId = show.tvmaze_id;

    // Mark as browsed immediately
    markShowBrowsed(tvmazeId);

    // Check if we've seen this title in our recent resultTitles
    if (resultTitles.some((entry) => parseResultTitle(entry) === title)) {
      continue;
    }

    // Reject if not Scripted
    // "Reality" is used as the generic label for non-scripted in our UI context
    if (show.type !== "Scripted") {
      appendResultTitle(`Reality|${title}`);
      continue;
    }

    // Reject if not English
    if (show.language && show.language !== "English") {
      appendResultTitle(`Language|${title}`);
      continue;
    }

    // Filter Genres
    // Show genres are usually in show.genres (array of strings)
    const genres = Array.isArray(show.genres) ? show.genres : [];
    const lowerGenres = genres.map((g) => g.toLowerCase());

    const rejected = lowerGenres.find((g) => avoidGenres.includes(g));

    if (rejected) {
      appendResultTitle(`${rejected}|${title}`);
      // "If rejected add ... and continue" to look for next one
      continue;
    }

    // Accepted
    appendResultTitle(`ok|${title}`);
    foundNew = true;

    // "If all checks pass ... return resultTitles"
    // We stop after finding ONE accepted show, or if we exhaust our candidate batch.
    // If we only found rejected shows in this batch, we might return them.
    // But typical behavior (like getReel) is to return when we have a success or give up.
    // The prompt implies we return immediately upon success.
    break;
  }

  // If we exhausted candidates loop without finding anything, we just return the current list.
  return resultTitles;
}
