import fs from 'fs';
import { escape } from 'querystring';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const avoidGenres = ['anime', 'children', 'documentary',
  'family', 'food', 'game Show', 'game-Show',
  'history', 'home &amp;Garden', 'musical',
  'reality', 'sport', 'talk', 'stand-up', 'travel'];

const rx_show = new RegExp('"show:.*?:@global": ?{(.*?)}', 'sg');
const rx_title = new RegExp('"title": ?"(.*?)"', 's');
const rx_slug = new RegExp('"slug": ?"(.*?)"', 'sg');
const rx_genre = new RegExp('href="/tv/genre/([^"]*)"', 'sg');

const homeUrl = "https://reelgood.com/new/tv";
const reelShowsPath = path.resolve(__dirname, '..', 'reel-shows.json');
const reelTitlesPath = path.resolve(__dirname, '..', 'reelgood-titles.json');
const logPath = path.resolve(__dirname, '..', 'reelgood.log');
const homePagePath = path.resolve(__dirname, '..', '..', 'samples', 'sample-reelgood', 'homepage.html');

// Global cache
let homeHtml = null;
let oldShows = null;
let showTitles = [];
let resultTitles = [];

function loadResultTitles() {
  try {
    if (fs.existsSync(reelTitlesPath)) {
      const parsed = JSON.parse(fs.readFileSync(reelTitlesPath, 'utf8'));
      if (Array.isArray(parsed)) return parsed.map(String);
    }
  } catch (err) {
    console.error('Error loading reelgood-titles.json:', err);
    logToFile(`ERROR loading reelgood-titles.json: ${err.message}`);
  }
  return [];
}

function saveResultTitles(titlesArr) {
  try {
    fs.writeFileSync(reelTitlesPath, JSON.stringify(titlesArr, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving reelgood-titles.json:', err);
    logToFile(`ERROR saving reelgood-titles.json: ${err.message}`);
  }
}

function appendResultTitle(entry) {
  resultTitles.push(String(entry));
  while (resultTitles.length > 100) resultTitles.shift();
  saveResultTitles(resultTitles);
}

function parseResultTitle(entry) {
  const s = String(entry || '');
  const bar = s.indexOf('|');
  if (bar < 0) return '';
  return s.slice(bar + 1).trim();
}

function logToFile(message) {
  try {
    const now = new Date();
    // Simple UTC offset calculation for PST/PDT (-8/-7 hours)
    // Detect DST by checking if we're in March-November
    const month = now.getUTCMonth();
    const isDST = month >= 2 && month <= 10; // Approximate DST period
    const offsetHours = isDST ? -7 : -8;
    const pstTime = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
    
    const mm = String(pstTime.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(pstTime.getUTCDate()).padStart(2, '0');
    const hh = String(pstTime.getUTCHours()).padStart(2, '0');
    const min = String(pstTime.getUTCMinutes()).padStart(2, '0');
    const timestamp = `${mm}/${dd} ${hh}:${min}`;
    
    fs.appendFileSync(logPath, `${timestamp} ${message}\n`, 'utf8');
  } catch (err) {
    console.error('Error writing to log:', err);
  }
}

function loadReelShows() {
  try {
    if (fs.existsSync(reelShowsPath)) {
      return JSON.parse(fs.readFileSync(reelShowsPath, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading reel-shows.json:', err);
    logToFile(`ERROR loading reel-shows.json: ${err.message}`);
  }
  return {};
}

function saveReelShows(shows) {
  try {
    fs.writeFileSync(reelShowsPath, JSON.stringify(shows, null, 2));
  } catch (err) {
    console.error('Error saving reel-shows.json:', err);
    logToFile(`ERROR saving reel-shows.json: ${err.message}`);
  }
}

// Load oldShows once at module load time
oldShows = loadReelShows();
resultTitles = loadResultTitles();

// Log startup - wrapped in try/catch to prevent module load failure
(function logStartup() {
  try {
    fs.appendFileSync(logPath, '\n', 'utf8');
    logToFile('Reelgood started.');
  } catch (err) {
    // Silently fail - don't crash the module
    console.error('Could not write startup log:', err.message);
  }
})();

export async function startReel(showTitlesArg) {
  try {
    showTitles = Array.isArray(showTitlesArg) ? showTitlesArg : [];

    console.log('Fetching fresh reelgood home page');
    const homeData = await fetch(homeUrl);
    homeHtml = await homeData.text();
    console.log('Home page loaded into memory');
    
    // Save to samples directory
    try {
      const sampleDir = path.dirname(homePagePath);
      if (!fs.existsSync(sampleDir)) {
        fs.mkdirSync(sampleDir, { recursive: true });
      }
      fs.writeFileSync(homePagePath, homeHtml, 'utf8');
      console.log('Saved home page to', homePagePath);
    } catch (err) {
      console.error('Error saving home page:', err);
      logToFile(`ERROR saving homepage.html: ${err.message}`);
    }
    
    return resultTitles;
  } catch (err) {
    const errmsg = err.message || String(err);
    logToFile(`ERROR in startReel: ${errmsg}`);
    appendResultTitle(`error|${errmsg}`);
    return resultTitles;
  }
}

export async function getReel() {
  try {
    if (!homeHtml) {
      const msg = 'Home page not loaded. Call startReel first.';
      appendResultTitle(`error|${msg}`);
      return [`error|${msg}`];
    }

    const addedThisCall = [];
    const add = (entry) => {
      appendResultTitle(entry);
      addedThisCall.push(entry);
    };

    const haveItSet = new Set((Array.isArray(showTitles) ? showTitles : []).map(String));
    const seenInResultTitles = new Set(resultTitles.map(parseResultTitle).filter(Boolean));

    let show;
    rx_show.lastIndex = 0;
    
    while ((show = rx_show.exec(homeHtml)) !== null) {
      const titleMatches = rx_title.exec(show[0]);
      if (!titleMatches?.length) continue;

      const title = titleMatches[1];
      if (title in oldShows) continue;
      if (seenInResultTitles.has(title)) {
        // Treat as already processed, same behavior as oldShows.
        oldShows[title] = true;
        continue;
      }
      
      oldShows[title] = true;

      console.log('\nProcessing:', title);

      rx_slug.lastIndex = 0;
      const slugMatches = rx_slug.exec(show[0]);
      if (!slugMatches?.length) {
        console.log('No slug found');
        continue;
      }

      const slug = slugMatches[1];
      const showUrl = `https://reelgood.com/show/${encodeURIComponent(slug)}`;

      if (haveItSet.has(title)) {
        add(`Have It|${title}`);
        logToFile(`REJECT: "${title}" (Have It)`);
        continue;
      }

      let reelData;
      try {
        reelData = await fetch(showUrl);
      } catch (e) {
        console.log('Error fetching show page:', e);
        logToFile(`ERROR fetching show page "${title}": ${e.message || String(e)}`);
        continue;
      }
      const reelHtml = await reelData.text();

      const chk = (slug, label) => {
        slug = slug.toLowerCase();
        for (const avoid of avoidGenres) {
          if (slug == avoid) {
            console.log('---- skipping', label, avoid);
            return avoid;
          }
        }
        return null;
      }

      let shouldSkip = false;
      let rejectedGenre = null;
      let genreMatches;
      rx_genre.lastIndex = 0;
      while ((genreMatches = rx_genre.exec(reelHtml)) !== null) {
        const genre = genreMatches[1];
        const matched = chk(genre, 'genre');
        if (matched) {
          shouldSkip = true;
          rejectedGenre = matched;
          break;
        }
      }

      if (shouldSkip) {
        add(`${rejectedGenre}|${title}`);
        logToFile(`REJECT: "${title}" (${rejectedGenre})`);
        continue;
      }

      // Log accepted show
      logToFile(`>>>  "${title}", ${showUrl}`);

      add(`ok|${title}`);

      // Save oldShows at end before returning
      saveReelShows(oldShows);

      return addedThisCall;
    }

    // Save oldShows even when no show found
    saveReelShows(oldShows);

    return addedThisCall;
  } catch (err) {
    const errmsg = err.message || String(err);
    logToFile(`ERROR in getReel: ${errmsg}`);
    appendResultTitle(`error|${errmsg}`);
    return [`error|${errmsg}`];
  }
}
