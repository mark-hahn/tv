import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const homePagePath = path.resolve(__dirname, '..', 'samples', 'sample-reelgood', 'homepage.html');
const reelShowsPath = path.resolve(__dirname, 'reel-shows.json');

const rx_show = new RegExp('"show:.*?:@global": ?{(.*?)}', 'sg');
const rx_title = new RegExp('"title": ?"(.*?)"', 's');

// Load the HTML
const homeHtml = fs.readFileSync(homePagePath, 'utf8');
console.log(`Loaded homepage.html (${homeHtml.length} bytes)`);

// Load existing shows
const oldShows = JSON.parse(fs.readFileSync(reelShowsPath, 'utf8'));
console.log(`Loaded reel-shows.json (${Object.keys(oldShows).length} shows)`);
console.log('\n=== Titles found that are NOT in reel-shows.json ===\n');

let matchCount = 0;
let titleCount = 0;
let newTitleCount = 0;
let show;

rx_show.lastIndex = 0;

while ((show = rx_show.exec(homeHtml)) !== null) {
  matchCount++;
  const titleMatches = rx_title.exec(show[0]);
  
  if (!titleMatches?.length) {
    console.log(`Match ${matchCount}: No title found`);
    continue;
  }
  
  titleCount++;
  const title = titleMatches[1];
  
  if (!(title in oldShows)) {
    newTitleCount++;
    console.log(`${newTitleCount}. "${title}"`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`Total regex matches: ${matchCount}`);
console.log(`Titles extracted: ${titleCount}`);
console.log(`Titles NOT in reel-shows.json: ${newTitleCount}`);
console.log(`Titles already in reel-shows.json: ${titleCount - newTitleCount}`);
