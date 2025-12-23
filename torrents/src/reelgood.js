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
const logPath = path.resolve(__dirname, '..', 'reelgood.log');

// Global cache
let homeHtml = null;
let oldShows = null;

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
  }
  return {};
}

function saveReelShows(shows) {
  try {
    fs.writeFileSync(reelShowsPath, JSON.stringify(shows, null, 2));
  } catch (err) {
    console.error('Error saving reel-shows.json:', err);
  }
}

// Load oldShows once at module load time
oldShows = loadReelShows();

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

export async function startReel() {
  try {
    console.log('Fetching fresh reelgood home page');
    const homeData = await fetch(homeUrl);
    homeHtml = await homeData.text();
    console.log('Home page loaded into memory');
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', errmsg: err.message || String(err) };
  }
}

export async function getReel() {
  try {
    if (!homeHtml) {
      return { status: 'error', errmsg: 'Home page not loaded. Call startReel first.' };
    }

    let show;
    rx_show.lastIndex = 0;
    
    while ((show = rx_show.exec(homeHtml)) !== null) {
      const titleMatches = rx_title.exec(show[0]);
      if (!titleMatches?.length) continue;

      const title = titleMatches[1];
      if (title in oldShows) continue;
      
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

      let reelData;
      try {
        reelData = await fetch(showUrl);
      } catch (e) {
        console.log('Error fetching show page:', e);
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
        logToFile(`REJECTED: "${title}" - genre: ${rejectedGenre}`);
        continue;
      }

      const imbdUrl = `https://www.imdb.com/find/?q=${escape(title)}`;
      const wikiUrl = `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}%20(TV%20Series)`;
      const googleUrl = `https://www.google.com/search?q=%22${title.replace(/ /g, '+')}%22+wiki+tv+show`;
      const tomatoUrl = `https://www.rottentomatoes.com/search/?search=${escape(title)}`;

      // Log accepted show
      logToFile(`ACCEPTED: "${title}"`);

      // Save oldShows at end before returning
      saveReelShows(oldShows);

      return {
        status: 'ok',
        title,
        imbdUrl,
        wikiUrl,
        googleUrl,
        tomatoUrl,
        showUrl
      };
    }

    // Save oldShows even when no show found
    saveReelShows(oldShows);

    return { status: 'no show' };
  } catch (err) {
    return { status: 'error', errmsg: err.message || String(err) };
  }
}
