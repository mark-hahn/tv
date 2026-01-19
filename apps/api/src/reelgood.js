import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReelHtml, ReelgoodBrowser } from './get-reel.js';
import { getTvDataDir } from './tvPaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Constants & Config ---

const avoidGenres = [
  'anime', 'children', 'documentary',
  'family', 'food', 'game Show', 'game-Show',
  'history', 'home &amp; garden', 'musical',
  'reality', 'sport', 'talk', 'stand-up', 'travel'
];

const rx_show = new RegExp('"show:.*?:@global": ?{(.*?)}', 'sg');
const rx_title = new RegExp('"title": ?"(.*?)"', 's');
const rx_slug = new RegExp('"slug": ?"(.*?)"', 'sg');
const rx_genre = new RegExp('href="/tv/genre/([^"]*)"', 'sg');

// Paths (using consistent /root/dev/apps/tv/api/... paths)
const appBase = path.dirname(getTvDataDir()); 
const apiDir = path.join(appBase, 'api');
const reelShowsPath = path.join(apiDir, 'reel-shows.json');
const reelTitlesPath = path.join(apiDir, 'reelgood-titles.json');
const logPath = path.join(apiDir, 'reelgood.log');

// --- State ---

let homeHtml = null;  // Cached HTML from startReel
let reelShows = {};   // Cursor: { "Title": true }
let showTitles = [];  // Titles the user already has (from client)
let resultTitles = []; // Rolling history of emitted results

// --- Persistence Helpers ---

function logToFile(message) {
  try {
    const now = new Date();
    // Simple UTC offset calculation for PST/PDT (-8/-7 hours)
    // Detect DST by checking if we're in March-November
    const month = now.getUTCMonth();
    const isDST = month >= 2 && month <= 10;
    const offsetHours = isDST ? -7 : -8;
    const pstTime = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
    
    const mm = String(pstTime.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(pstTime.getUTCDate()).padStart(2, '0');
    const hh = String(pstTime.getUTCHours()).padStart(2, '0');
    const min = String(pstTime.getUTCMinutes()).padStart(2, '0');
    const sec = String(pstTime.getUTCSeconds()).padStart(2, '0');
    const timestamp = `${mm}/${dd} ${hh}:${min}:${sec}`;
    
    fs.appendFileSync(logPath, `${timestamp} ${message}\n`, 'utf8');
  } catch (err) {
    console.error('Error writing to log:', err);
  }
}

function atomicWriteTextFile(outPath, content) {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Simple atomic write simulation
  const tmpPath = `${outPath}.tmp-${Math.random().toString(16).slice(2)}`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, outPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    console.error(`Error saving ${outPath}:`, err);
  }
}

function atomicWriteJson(outPath, data) {
  const txt = JSON.stringify(data, null, 2) + '\n';
  atomicWriteTextFile(outPath, txt);
}

function loadReelShows() {
  if (!fs.existsSync(reelShowsPath)) {
      return {};
  }
  try {
    const raw = fs.readFileSync(reelShowsPath, 'utf8');
    if (!raw || !raw.trim()) {
       // Only return empty if it's truly 0 bytes, but maybe safer to throw if we expect data?
       // If it is 0 bytes, it's already "lost", so returning {} is practically the truth.
       // However, we shouldn't trigger an overwrite logic here.
       return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    throw new Error('Invalid JSON content (not an object)');
  } catch (err) {
    // If we fail to read or parse, we MUST NOT return {} as if it's a new file.
    // Propagate error so callers know disk state is unknown/bad.
    throw err;
  }
}

function saveReelShows() {
    // Reload from disk to merge changes (concurrency safety attempt)
    let disk = {};
    try {
        if (fs.existsSync(reelShowsPath)) {
            // Check backups?
            // Just load nicely
             const raw = fs.readFileSync(reelShowsPath, 'utf8');
             if (raw.trim()) {
                disk = JSON.parse(raw);
             }
        }
    } catch (e) {
        // If we can't read the disk, we ABORT saving.
        // Overwriting a corrupt/unreadable file with partial memory state means data loss.
        console.error(`saveReelShows aborted: Cannot read ${reelShowsPath}: ${e.message}`);
        return; 
    }

    // Double check we are not overwriting with empty if we expected data
    if (Object.keys(disk).length > 0 && Object.keys(reelShows).length === 0) {
        // Suspicious: disk has data, memory is empty?
        // This might happen if startup failed.
        // But startup fail sets reelShows={} and prevented overwrite.
        // If we are here, reelShows has mutated. 
        console.warn('saveReelShows: Overwriting non-empty disk with potentially empty memory state?');
    }

    const merged = { ...disk, ...reelShows };

    // Create a .bak copy before overwriting, just in case
    try {
        if (fs.existsSync(reelShowsPath)) {
            // Only back up if we have some keys? or always? 
            // Always is safer.
            const bakPath = reelShowsPath + '.bak';
            fs.copyFileSync(reelShowsPath, bakPath);
        }
    } catch (e) {
        console.error('Error creating backup of reel-shows.json:', e);
    }

    atomicWriteJson(reelShowsPath, merged);
}

function loadResultTitles() {
  if (!fs.existsSync(reelTitlesPath)) {
      return [];
  }
  try {
    const raw = fs.readFileSync(reelTitlesPath, 'utf8');
    if (!raw || !raw.trim()) {
        return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
    throw new Error('Invalid JSON content (not an array)');
  } catch (err) {
    console.error('Error loading reelgood-titles.json:', err);
    // Propagate error to prevent overwrite
    throw err;
  }
}

function saveResultTitles() {
    // Safety check: ensure we can read existin file before overwriting
    try {
        loadResultTitles();
    } catch (e) {
        console.error(`saveResultTitles aborted: Cannot read ${reelTitlesPath}: ${e.message}`);
        return;
    }
  atomicWriteJson(reelTitlesPath, resultTitles);
}

function appendResultTitle(entry) {
  if (!entry) return;
  // Ensure we don't duplicate identical consecutive entries if logic flukes, 
  // but strictly we just push and trim.
  resultTitles.push(String(entry));
  while (resultTitles.length > 100) resultTitles.shift();
  saveResultTitles();
}

function shouldPersistResultEntry(entry) {
  const s = String(entry || '');
  return !s.toLowerCase().startsWith('error|') && !s.toLowerCase().startsWith('msg|');
}

function parseResultTitle(entry) {
  const s = String(entry || '');
  const bar = s.indexOf('|');
  if (bar < 0) return '';
  return s.slice(bar + 1).trim();
}

// --- Initialization ---

try {
    reelShows = loadReelShows();
} catch (e) {
    console.error('CRITICAL: Failed to load reel-shows.json on startup.', e.message);
    logToFile(`CRITICAL: Startup load failed: ${e.message}`);
    // Fallback to empty memory state, but do NOT overwrite disk immediately.
    // saveReelShows() will fail to write until disk is readable/fixable.
    reelShows = {};
}

try {
    resultTitles = loadResultTitles();
} catch (e) {
   console.error('CRITICAL: Failed to load reelgood-titles.json on startup.', e.message);
   logToFile(`CRITICAL: Startup load failed (titles): ${e.message}`);
   resultTitles = [];
}
logToFile('Reelgood module loaded.');

// --- Exports ---

function checkReel() {
  // 1. Sanity Check
  if (!homeHtml) return false;

  // 2. Candidate Loop
  // Use local regex to avoid state conflict with getReel (shared rx_show has state)
  const local_rx_show = new RegExp('"show:.*?:@global": ?{(.*?)}', 'sg');
  
  // Re-derive seenTitles logic from getReel
  const seenTitles = new Set(resultTitles.map(parseResultTitle).filter(Boolean));

  let showMatch;
  while ((showMatch = local_rx_show.exec(homeHtml)) !== null) {
      const titleMatches = rx_title.exec(showMatch[0]);
      if (!titleMatches?.length) continue;
      const title = titleMatches[1];

      // test 1: "Already Processed" Check
      if (reelShows[title]) continue;

      // test 2: "Recently Emitted" Check
      if (seenTitles.has(title)) continue;

      // if it passes the two tests and gets to this point then checkReel should return true
      return true;
  }

  // if the Loop Finishes then checkReel should return false
  return false;
}

/**
 * POST /api/startreel
 * Body: { showTitles: ["title1", "title2", ...] }
 */
export async function startReel(showTitlesArg) {
  try {
    showTitles = Array.isArray(showTitlesArg) ? showTitlesArg : [];
    logToFile(`startReel called (showTitles: ${showTitles.length})`);

    // Reload persistence to ensure freshness
    try {
        reelShows = loadReelShows();
    } catch (e) {
        console.error('startReel: loadReelShows failed:', e.message);
        logToFile(`WARNING: startReel could not reload reelShows: ${e.message}`);
    }

    try {
       resultTitles = loadResultTitles();
    } catch (e) {
        console.error('startReel: loadResultTitles failed:', e.message);
    }

    // Load new HTML
    logToFile('Fetching fresh reelgood home page via getReelHtml...');
    try {
        homeHtml = await getReelHtml();
        logToFile(`Home page loaded (${homeHtml.length} bytes)`);

        // Check regex matches count for debugging "no results"
        const testRx = new RegExp('"show:.*?:@global": ?{(.*?)}', 'sg');
        const matchCount = (homeHtml.match(testRx) || []).length;
        logToFile(`Regex (rx_show) found ${matchCount} matches in homeHtml.`);

        // Debug: Save HTML to disk
        try {
            const debugPath = '/root/dev/apps/tv/api/test/homepage.html';
            const debugDir = path.dirname(debugPath);
            if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
            fs.writeFileSync(debugPath, homeHtml, 'utf8');
            logToFile(`Saved homepage to ${debugPath}`);
        } catch (e) {
             console.error('Error saving debug homepage:', e);
        }

    } catch (e) {
        const msg = `Failed to load home page: ${e.message}`;
        console.error(msg);
        logToFile(`ERROR ${msg}`);
        return [`error|${msg}`];
    }

    // Check if we have more titles (uses checkReel)
    const hasMore = checkReel();
    if (!hasMore) {
        return [...resultTitles, 'msg|-- no more titles --'];
    }

    // Return history
    return resultTitles;
  } catch (err) {
    const errmsg = err.message || String(err);
    logToFile(`ERROR in startReel: ${errmsg}`);
    return [`error|${errmsg}`];
  }
}

/**
 * GET /api/getreel
 */
export async function getReel() {
  try {
    if (!homeHtml) {
        logToFile('getReel failed: homeHtml is null/empty. Call startReel first.');
        return [`error|Home page not loaded. Call startReel first.`];
    }

    const addedThisCall = [];
    const add = (entry) => {
        if (shouldPersistResultEntry(entry)) {
            // Check if already in resultTitles to avoid spamming duplicates in history
            // (Though spec says "seenInResultTitles: titles already returned", 
            // usually checking title is enough, but here we append the full string)
            appendResultTitle(entry); 
        }
        addedThisCall.push(entry);
    };

    const haveItSet = new Set((Array.isArray(showTitles) ? showTitles : []).map(s => String(s).toLowerCase())); 
    
    // Check history (seenInResultTitles)
    // "titles already returned historically (so we don’t spam duplicates)"
    const seenTitles = new Set(resultTitles.map(parseResultTitle).filter(Boolean));

    let show;
    rx_show.lastIndex = 0; 

    // Find next candidate
    const browser = new ReelgoodBrowser();
    try {
        while ((show = rx_show.exec(homeHtml)) !== null) {
            const titleMatches = rx_title.exec(show[0]);
            if (!titleMatches?.length) continue;
            const title = titleMatches[1];

            // 1. Check if we already processed this title (cursor)
            if (reelShows[title]) continue;

            // 2. Check if we emitted this title recently (history)
            if (seenTitles.has(title)) {
                reelShows[title] = true; // ensure marked as seen
                continue; 
            }

            // Mark as processed immediately (so we don't process again)
            reelShows[title] = true;
            saveReelShows(); // Flush immediately as per spec "flush reelShows ... after processing candidate title"

            logToFile(`Processing candidate: ${title}`);

            // 3. Check for slug
            rx_slug.lastIndex = 0;
            const slugMatches = rx_slug.exec(show[0]);
            if (!slugMatches?.length) {
                add(`skipped|${title} (no slug)`);
                continue; // move to next
            }
            const slug = slugMatches[1];

            // 4. Check Have It
            let isHaveIt = false;
            if (haveItSet.has(title.toLowerCase())) {
                isHaveIt = true;
            } else {
                 // Fallback to strict check just in case
                 // isHaveIt = showTitles.includes(title); 
            }

            if (isHaveIt) {
                add(`Have It|${title}`);
                logToFile(`REJECT "${title}" (Have It)`);
                continue;
            }

            // 5. Fetch Show Page
            const showUrl = `https://reelgood.com/show/${slug}`;
            let reelPageHtml = '';
            try {
                reelPageHtml = await browser.getHtml(showUrl);
            } catch (e) {
                // If it fails emit fetch error
                const msg = e.message || String(e);
                // Simple status check if error message contains "403" etc
                if (msg.includes('403')) {
                     add(`Fetch Error|${title} 403`);
                } else if (msg.includes('404')) {
                     add(`Fetch Error|${title} 404`);
                } else {
                     add(`Fetch Error|${title} ${msg.slice(0, 50)}`);
                }
                logToFile(`ERROR fetching show ${title}: ${msg}`);
                continue;
            }

            // 6. Check Genres
            let rejectedGenre = null;
            rx_genre.lastIndex = 0;
            let genreMatch;
            while ((genreMatch = rx_genre.exec(reelPageHtml)) !== null) {
                const g = genreMatch[1].toLowerCase();
                if (avoidGenres.includes(g)) {
                    rejectedGenre = g;
                    break;
                }
            }

            if (rejectedGenre) {
                add(`${rejectedGenre}|${title}`);
                logToFile(`REJECT "${title}" (${rejectedGenre})`);
                continue;
            }

            // 7. Success
            add(`ok|${title}`);
            logToFile(`>>> "${title}" OK`);
            
            // We found an OK result, so we return the list accumulated so far
            return addedThisCall;
        }
    } finally {
        await browser.close();
    }

    // Exhausted list without finding new OK result (or only skipped/rejected ones)
    return addedThisCall;

  } catch (err) {
    const errmsg = err.message || String(err);
    logToFile(`ERROR in getReel: ${errmsg}`);
    return [`error|${errmsg}`];
  }
}
