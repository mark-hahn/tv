import fs       from 'fs';
import fetch, {fileFrom}    from 'node-fetch';
import open     from 'open';
import {escape} from 'querystring';
import {getSystemErrorMap} from 'util';

const avoidGenres = ['anime','children','documentary',
                     'family','food' ,'game Show','game-Show',
                     'history','home &amp;Garden','musical',
                     'reality','sport','talk' ,'stand-up','travel'];

const useStoredHome = (process.argv[2] === 'useStoredHome');

const rx_show  = new RegExp('"show:.*?:@global": ?{(.*?)}', 'sg');
const rx_title = new RegExp('"title": ?"(.*?)"',            's' );
const rx_slug  = new RegExp('"slug": ?"(.*?)"',             'sg');
const rx_genre = new RegExp('href="/tv/genre/([^"]*)"',     'sg');

// "slug":"the-tragically-hip-no-dress-rehearsal"

const oldShows = JSON.parse(fs.readFileSync("oldShows.json"));

const homeUrl = "https://reelgood.com/new/tv";

(async () => {
  let homeHtml;
  if(!useStoredHome) {
    console.log('fetching a fresh reelgood home page');
    const homeData = await fetch(homeUrl);
    homeHtml = await homeData.text();
    fs.writeFileSync("home.html", homeHtml);
  }
  else {
    console.log('using stored reelgood home page');
    homeHtml = fs.readFileSync("home.html");
  }

  let show;
  rx_show.lastIndex = 0;
  showLoop:
  while((show = rx_show.exec(homeHtml)) !== null) {

    const titleMatches = rx_title.exec(show[0]);
    if(!titleMatches?.length) continue showLoop;

    const title = titleMatches[1];
    if(title in oldShows) continue showLoop;
    
    oldShows[title] = true;
    fs.writeFileSync("oldShows.json", JSON.stringify(oldShows));

    console.log('\n'+title);

    rx_slug.lastIndex = 0;
    const slugMatches = rx_slug.exec(show[0]);
    if(!slugMatches?.length) {
      fs.writeFileSync("no-slug.html", show[0]);
      console.log('no slug found');
      continue showLoop;
    }

    const slug = slugMatches[1];
    const showUrl
        = `https://reelgood.com/show/${encodeURIComponent(slug)}`;

    let reelData;
    try {
      reelData = await fetch(showUrl);
    }
    catch(e) {
      console.log(e+'\n'+'\n');
      process.exit();
    }
    const reelHtml = await reelData.text();

    // fs.writeFileSync("reel.html", reelHtml);

    const chk = (slug, label) => {
      slug = slug.toLowerCase();
      for(const avoid of avoidGenres) {
        if(slug == avoid) {
          console.log('---- skipping', label, avoid);
          return true;
        }
      }
      return false;
    }

    let genreMatches;
    rx_genre.lastIndex = 0;
    while((genreMatches = rx_genre.exec(reelHtml)) !== null) {
      const genre = genreMatches[1];
      if(chk(genre, 'genre')) continue showLoop;
    }

    // rx_slug.lastIndex = 0;
    // while((genreMatches = rx_slug.exec(reelHtml)) !== null) {
    //   const genre = genreMatches[1];
    //   if(chk(genre, 'slug')) continue showLoop;
    // }

    const imbdUrl = `https://www.imdb.com/find/?q=${escape(title)}`;
    const wikiUrl = `https://en.wikipedia.org/wiki/` +
        `${title.replace(/ /g, '_')}%20(TV%20Series)`;
    const googleUrl = `https://www.google.com/search?q=%22` +
        `${title.replace(/ /g, '+')}%22+wiki+tv+show`;
    const tomatoUrl = `https://www.rottentomatoes.com/search/` +
        `?search=${escape(title)}`;

    fs.writeFileSync("links.txt", imbdUrl+'\n\n');
    fs.appendFileSync("links.txt", wikiUrl+'\n\n');
    fs.appendFileSync("links.txt", googleUrl+'\n\n');
    fs.appendFileSync("links.txt", tomatoUrl+'\n\n');

    console.log(`opening ${showUrl}`);
    open(showUrl);

    break;
  }
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

/*
// const homeUrl = "https://reelgood.com/tv";
const homeUrl = "https://reelgood.com/new/tv";
// const homeUrl = "https://reelgood.com/tv/browse/new-tv-on-your-sources";
// const homeUrl = "https://reelgood.com/tv?filter-sort=3"; // sort by release date
*/
