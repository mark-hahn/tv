// IMDB ratings from the official daily dataset.
//
// IMDB fronts its web pages with an AWS WAF CAPTCHA that a headless browser
// cannot solve, so ratings are read from the dataset IMDB publishes instead of
// scraped. The file is a gzipped TSV of every title (~8.5MB, ~1.7M rows):
//
//   tconst  averageRating  numVotes
//   tt0925266  8.4  62400
//
// It is kept on disk gzipped and scanned per lookup — one show is processed
// every few minutes, so a streaming scan (~150ms, early exit on match) costs
// far less than holding 1.7M rows in memory for the life of the process.

import fs from "fs";
import * as path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import fetch from "node-fetch";
import { logHere, unilog } from "@tv/share";
import { SRVR_DATA_DIR } from "./srvrPaths.js";

const IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";
const IMDB_RATINGS_PATH = path.join(SRVR_DATA_DIR, "title.ratings.tsv.gz");
const IMDB_RATINGS_TMP = IMDB_RATINGS_PATH + ".tmp";
const REFRESH_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 120 * 1000;
// a partial download would silently answer misses for most titles
const MIN_VALID_BYTES = 4 * 1024 * 1024;

// tconst -> { ratings, reviewers }, cleared whenever the dataset is replaced
let lookupCache = new Map();

const fileAgeMs = () => {
  const st = fs.statSync(IMDB_RATINGS_PATH, { throwIfNoEntry: false });
  return st ? Date.now() - st.mtimeMs : Infinity;
};

// download to a temp file first so a failed transfer never replaces a good one
const downloadRatings = async () => {
  const resp = await fetch(IMDB_RATINGS_URL, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`${IMDB_RATINGS_URL} → ${resp.status}`);

  await pipeline(resp.body, fs.createWriteStream(IMDB_RATINGS_TMP));

  const bytes = fs.statSync(IMDB_RATINGS_TMP).size;
  if (bytes < MIN_VALID_BYTES) {
    fs.unlinkSync(IMDB_RATINGS_TMP);
    throw new Error(`short download: ${bytes} bytes`);
  }
  fs.renameSync(IMDB_RATINGS_TMP, IMDB_RATINGS_PATH);
  lookupCache = new Map();
  return bytes;
};

export const refreshImdbRatings = async ({ force = false } = {}) => {
  if (!force && fileAgeMs() < REFRESH_MS) return false;
  try {
    const bytes = await downloadRatings();
    unilog(1686, `imdb ratings dataset refreshed: ${bytes} bytes`);
    return true;
  } catch (e) {
    unilog(1687, `imdb ratings dataset refresh failed: ${e.message}`);
    return false;
  }
};

// The dataset carries a raw vote count where the page showed IMDB's abbreviated
// form, which is what is stored and displayed: one decimal below ten thousand
// (2.9k, 9.5k), whole numbers above it (25k, 318k), and no trailing ".0" (6k).
export const formatVotes = (votes) => {
  const n = Number(votes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1000) return String(n);

  let [div, suffix] = n >= 1e6 ? [1e6, "m"] : [1000, "k"];
  let scaled = n / div;
  // 999,500 rounds to 1000k — carry it up to 1m instead
  if (suffix === "k" && Math.round(scaled) >= 1000) {
    div = 1e6;
    suffix = "m";
    scaled = n / div;
  }
  const text = scaled < 10 ? scaled.toFixed(1) : String(Math.round(scaled));
  return text.replace(/\.0$/, "") + suffix;
};

// the dataset writes a rating of 8 as "8.0"; the pages showed (and stored) "8"
const formatRating = (rating) => {
  if (!rating) return null;
  return String(rating).replace(/\.0$/, "");
};

// Scan the gzipped TSV for one title. Returns { ratings, reviewers } or null
// when the title has no rating yet (unreleased / too few votes to publish).
const scanForTconst = async (tconst) => {
  const prefix = tconst + "\t";
  const stream = fs
    .createReadStream(IMDB_RATINGS_PATH)
    .pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let found = null;
  for await (const line of rl) {
    if (!line.startsWith(prefix)) continue;
    const [, averageRating, numVotes] = line.split("\t");
    found = {
      ratings: formatRating(averageRating),
      reviewers: formatVotes(numVotes),
    };
    break;
  }
  rl.close();
  stream.destroy();
  return found;
};

export const getImdbRating = async (tconst) => {
  if (!tconst) return null;
  if (lookupCache.has(tconst)) return lookupCache.get(tconst);

  if (fileAgeMs() === Infinity) {
    const ok = await refreshImdbRatings({ force: true });
    if (!ok) return null;
  }

  try {
    const found = await scanForTconst(tconst);
    lookupCache.set(tconst, found);
    return found;
  } catch (e) {
    unilog(1688, `imdb ratings lookup failed for ${tconst}: ${e.message}`);
    return null;
  }
};

// keep the dataset current; the first call also downloads it if it is missing
export const startImdbRatings = () => {
  void refreshImdbRatings();
  setInterval(() => void refreshImdbRatings(), REFRESH_MS);
};
